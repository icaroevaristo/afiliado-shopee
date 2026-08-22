import { describe, expect, it, vi } from 'vitest';
import { AppError } from '@shopee-auto-affiliate-ai/shared';

import { CommercialDispatchOutboxPublisher } from '../src/commercial-dispatch-outbox-publisher';
import {
  COMMERCIAL_CONFIRMATION_TOKEN,
  CommercialPipelineConfirmationService,
  commercialConfirmationIds,
} from '../src/commercial-pipeline-confirmation-service';
import type {
  CommercialConfirmationPersistenceInput,
  CommercialDispatchOutboxRecord,
  CommercialDispatchOutboxRepository,
  CommercialPipelineRunData,
  CommercialPipelineRunRecord,
  CommercialPipelineRunRepository,
  GeneratedCopyRecord,
  ShopeeOfferRecord,
  WhatsAppDispatchRecord,
  WhatsAppGroupRecord,
} from '../src/repositories';

const now = new Date('2026-07-25T22:00:00.000Z');
const preview =
  'Oferta segura\n\nProduto ficticio\n\nhttps://example.invalid/affiliate/product';

const offer = (
  overrides: Partial<ShopeeOfferRecord> = {},
): ShopeeOfferRecord => ({
  id: 'product-id',
  source: 'MOCK',
  providerProductId: 'mock-product',
  productName: 'Produto ficticio',
  shopName: 'Loja ficticia',
  categoryIds: ['test'],
  price: '29.90',
  priceMin: '29.90',
  priceMax: '29.90',
  discountRate: 20,
  rating: 4.8,
  sales: 1000,
  commissionRate: 10,
  imageUrl: 'https://example.invalid/image',
  productLink: 'https://example.invalid/product',
  affiliateLink: 'https://example.invalid/affiliate/product',
  fetchedAt: now,
  lastSeenAt: now,
  createdAt: now,
  updatedAt: now,
  score: null,
  scoreUpdatedAt: null,
  ...overrides,
});

const group = (
  overrides: Partial<WhatsAppGroupRecord> = {},
): WhatsAppGroupRecord => ({
  id: 'group-id',
  name: 'Grupo ficticio autorizado',
  destination: 'opaque-internal-destination',
  type: 'GROUP',
  active: true,
  available: true,
  fingerprint: 'grp_123456789abc',
  sourceInstanceName: 'affiliate-bot',
  discoveredAt: now,
  lastSyncedAt: now,
  ...overrides,
});

const readyRun = (
  overrides: Partial<CommercialPipelineRunRecord> = {},
): CommercialPipelineRunRecord => ({
  id: 'dry-run-id',
  mode: 'DRY_RUN',
  status: 'COMPLETED',
  productId: 'product-id',
  groupDestinationId: 'group-id',
  productName: 'Produto ficticio',
  productPrice: '29.90',
  groupName: 'Grupo ficticio autorizado',
  groupFingerprint: 'grp_123456789abc',
  score: 95,
  candidateCount: 1,
  eligibleCount: 1,
  rejectedCount: 0,
  rejectionSummary: {},
  selectionReasons: ['Maior score'],
  copyPreview: preview,
  plannedSubIds: ['whatsapp', 'grp_123456789abc'],
  createdAt: now,
  completedAt: now,
  ...overrides,
});

class MemoryRuns implements CommercialPipelineRunRepository {
  records: CommercialPipelineRunRecord[];

  constructor(record: CommercialPipelineRunRecord) {
    this.records = [record];
  }

  async create(data: CommercialPipelineRunData) {
    const record = { ...data, id: 'created', createdAt: data.createdAt ?? now };
    this.records.push(record);
    return record;
  }

  async update(id: string, data: Partial<CommercialPipelineRunData>) {
    const index = this.records.findIndex((record) => record.id === id);
    this.records[index] = { ...this.records[index], ...data };
    return this.records[index];
  }

  async list() {
    return { items: this.records, total: this.records.length };
  }

  async findById(id: string) {
    return this.records.find((record) => record.id === id) ?? null;
  }

  async findByDispatchId(dispatchId: string) {
    return (
      this.records.find((record) => record.dispatchId === dispatchId) ?? null
    );
  }
}

class MemoryOutboxes implements CommercialDispatchOutboxRepository {
  records: CommercialDispatchOutboxRecord[] = [];
  copies: GeneratedCopyRecord[] = [];
  dispatches: WhatsAppDispatchRecord[] = [];

  constructor(private readonly runs: MemoryRuns) {}

  async createPendingConfirmation(
    input: CommercialConfirmationPersistenceInput,
  ) {
    const run = this.runs.records.find((record) => record.id === input.runId);
    if (!run || run.mode !== 'DRY_RUN' || run.status !== 'COMPLETED')
      return null;
    run.mode = 'CONFIRMED';
    run.status = 'STARTED';
    const record: CommercialDispatchOutboxRecord = {
      id: input.outboxId,
      commercialRunId: input.runId,
      dispatchId: input.dispatch.id,
      jobId: input.jobId,
      status: 'PENDING',
      instanceName: null,
      failureCode: null,
      createdAt: input.confirmedAt,
      publishedAt: null,
    };
    if ('copy' in input && input.copy) {
      this.copies.push({ ...input.copy, createdAt: input.confirmedAt });
    }
    this.dispatches.push({
      ...input.dispatch,
      status: 'PENDING',
      attemptCount: 0,
    });
    this.records.push(record);
    await this.runs.update(input.runId, {
      mode: 'CONFIRMED',
      status: 'STARTED',
      confirmedAt: input.confirmedAt,
      dispatchId: input.dispatch.id,
      jobId: null,
      finalStatus: 'PENDING',
      investigationRequired: false,
      failureCode: null,
      completedAt: null,
    });
    return record;
  }

  async list() {
    return { items: this.records, total: this.records.length };
  }

  async findById(id: string) {
    return this.records.find((record) => record.id === id) ?? null;
  }

  async findPublicationContext(id: string) {
    const outbox = await this.findById(id);
    if (!outbox) return null;
    const run = await this.runs.findById(outbox.commercialRunId);
    const dispatch = this.dispatches.find(
      (item) => item.id === outbox.dispatchId,
    );
    if (!run || !dispatch) return null;
    return { outbox, run, dispatch };
  }

  async markPublished(id: string, publishedAt: Date) {
    const record = await this.findById(id);
    if (!record || record.status === 'AMBIGUOUS') return null;
    record.status = 'PUBLISHED';
    record.publishedAt = publishedAt;
    record.failureCode = null;
    await this.runs.update(record.commercialRunId, { jobId: record.jobId });
    return record;
  }

  async markAmbiguous(id: string, failureCode: string, completedAt: Date) {
    const record = await this.findById(id);
    if (!record) return null;
    record.status = 'AMBIGUOUS';
    record.failureCode = failureCode;
    await this.runs.update(record.commercialRunId, {
      status: 'FAILED',
      finalStatus: 'AMBIGUOUS',
      investigationRequired: true,
      failureCode,
      completedAt,
    });
    return record;
  }
}

const build = ({
  run = readyRun(),
  currentOffer = offer(),
  groups = [group()],
  alreadySent = false,
  environment = {},
}: {
  run?: CommercialPipelineRunRecord;
  currentOffer?: ShopeeOfferRecord | null;
  groups?: WhatsAppGroupRecord[];
  alreadySent?: boolean;
  environment?: Partial<{
    groupSendEnabled: boolean;
    safeMode: boolean;
    schedulerEnabled: boolean;
    maximumMessagesPerRun: number;
  }>;
} = {}) => {
  const runs = new MemoryRuns(run);
  const outboxes = new MemoryOutboxes(runs);
  const jobs = new Set<string>();
  const enqueue = vi.fn(async (_dispatchId: string, jobId: string) => {
    jobs.add(jobId);
  });
  const publisher = new CommercialDispatchOutboxPublisher({
    outboxes,
    queue: { hasJob: async (jobId) => jobs.has(jobId), enqueue },
    logger: { info: vi.fn(), error: vi.fn() },
    clock: () => now,
  });
  const generate = vi.fn(() => preview);
  const service = new CommercialPipelineConfirmationService({
    runs,
    offers: { findOfferById: async () => currentOffer } as never,
    groups: { list: async () => groups } as never,
    outboxes,
    deliveryHistory: {
      wasProductSentToGroup: async () => alreadySent,
      findLastSentAtByGroup: async () => null,
    },
    copy: { generate },
    publisher,
    instanceName: 'affiliate-bot',
    environment: {
      groupSendEnabled: true,
      safeMode: true,
      schedulerEnabled: false,
      maximumMessagesPerRun: 1,
      ...environment,
    },
    logger: { info: vi.fn(), error: vi.fn() },
    clock: () => now,
  });
  return { service, runs, outboxes, publisher, enqueue, generate };
};

describe('CommercialPipelineConfirmationService', () => {
  it('persiste copy, dispatch, run e outbox antes de publicar o job', async () => {
    const state = build();
    const result = await state.service.confirm(
      'dry-run-id',
      COMMERCIAL_CONFIRMATION_TOKEN,
    );
    const ids = commercialConfirmationIds('dry-run-id');

    expect(result).toMatchObject({ status: 'queued', messageWasSent: false });
    expect(state.outboxes.copies[0]).toMatchObject({
      id: ids.copyId,
      mensagem: preview,
    });
    expect(state.outboxes.dispatches[0]).toMatchObject({
      id: ids.dispatchId,
      status: 'PENDING',
      attemptCount: 0,
    });
    expect(state.outboxes.records[0]).toMatchObject({
      id: ids.outboxId,
      jobId: ids.jobId,
      status: 'PUBLISHED',
    });
    expect(state.runs.records[0]).toMatchObject({
      mode: 'CONFIRMED',
      dispatchId: ids.dispatchId,
      jobId: ids.jobId,
      finalStatus: 'PENDING',
    });
    expect(state.enqueue).toHaveBeenCalledOnce();
  });

  it('deixa outbox PENDING quando ocorre crash depois do commit e antes do publisher', async () => {
    const state = build();
    const publish = vi
      .spyOn(state.publisher, 'publish')
      .mockRejectedValueOnce(new Error('crash'));

    await expect(
      state.service.confirm('dry-run-id', COMMERCIAL_CONFIRMATION_TOKEN),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_DISPATCH_FAILED' });
    expect(publish).toHaveBeenCalledOnce();
    expect(state.outboxes.records[0].status).toBe('PENDING');
    expect(state.runs.records[0]).toMatchObject({
      mode: 'CONFIRMED',
      investigationRequired: false,
    });
  });

  it.each([
    ['token', 'INVALID', 'COMMERCIAL_CONFIRMATION_INVALID'],
    ['run', COMMERCIAL_CONFIRMATION_TOKEN, 'COMMERCIAL_RUN_NOT_READY'],
  ])('bloqueia %s invalido sem outbox', async (kind, token, code) => {
    const state = build({
      run: kind === 'run' ? readyRun({ status: 'FAILED' }) : readyRun(),
    });
    await expect(
      state.service.confirm('dry-run-id', token),
    ).rejects.toMatchObject({
      code,
    });
    expect(state.outboxes.records).toHaveLength(0);
  });

  it.each([
    [
      'produto',
      offer({ productName: 'Produto alterado' }),
      [group()],
      false,
      'COMMERCIAL_PRODUCT_CHANGED',
    ],
    [
      'grupo',
      offer(),
      [group({ fingerprint: 'grp_changed0000' })],
      false,
      'COMMERCIAL_GROUP_CHANGED',
    ],
    ['historico', offer(), [group()], true, 'PRODUCT_ALREADY_SENT'],
  ] as const)(
    'revalida %s antes da transacao',
    async (_name, product, groups, sent, code) => {
      const state = build({
        currentOffer: product,
        groups: [...groups],
        alreadySent: sent,
      });
      await expect(
        state.service.confirm('dry-run-id', COMMERCIAL_CONFIRMATION_TOKEN),
      ).rejects.toMatchObject({ code });
      expect(state.outboxes.records).toHaveLength(0);
      expect(state.runs.records[0].mode).toBe('DRY_RUN');
    },
  );

  it.each([
    [{ groupSendEnabled: false }, 'GROUP_SEND_DISABLED'],
    [{ safeMode: false }, 'COMMERCIAL_SAFE_MODE_REQUIRED'],
    [{ schedulerEnabled: true }, 'COMMERCIAL_SCHEDULER_BLOCKED'],
    [{ maximumMessagesPerRun: 2 }, 'COMMERCIAL_MESSAGE_LIMIT_INVALID'],
  ] as const)('bloqueia ambiente inseguro', async (environment, code) => {
    const state = build({ environment });
    await expect(
      state.service.confirm('dry-run-id', COMMERCIAL_CONFIRMATION_TOKEN),
    ).rejects.toMatchObject({ code });
    expect(state.outboxes.records).toHaveLength(0);
  });

  it('uma corrida concorrente confirma e publica somente uma vez', async () => {
    const state = build();
    const results = await Promise.allSettled([
      state.service.confirm('dry-run-id', COMMERCIAL_CONFIRMATION_TOKEN),
      state.service.confirm('dry-run-id', COMMERCIAL_CONFIRMATION_TOKEN),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(state.outboxes.records).toHaveLength(1);
    expect(state.enqueue).toHaveBeenCalledOnce();
  });

  it('bloqueia colisao persistida como AMBIGUOUS sem publicar', async () => {
    const state = build();
    vi.spyOn(state.outboxes, 'createPendingConfirmation').mockRejectedValueOnce(
      new AppError(
        'Estado persistido inconsistente',
        'COMMERCIAL_OUTBOX_INCONSISTENT',
      ),
    );

    await expect(
      state.service.confirm('dry-run-id', COMMERCIAL_CONFIRMATION_TOKEN),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_OUTBOX_INCONSISTENT' });
    expect(state.enqueue).not.toHaveBeenCalled();
    expect(state.runs.records[0]).toMatchObject({
      status: 'FAILED',
      finalStatus: 'AMBIGUOUS',
      investigationRequired: true,
      failureCode: 'COMMERCIAL_OUTBOX_INCONSISTENT',
    });
  });

  it('preserva a copy aprovada e nunca chama provider', async () => {
    const state = build();
    await state.service.confirm('dry-run-id', COMMERCIAL_CONFIRMATION_TOKEN);
    expect(state.generate).toHaveBeenCalledOnce();
    expect(state.outboxes.copies[0].mensagem).toBe(preview);
  });

  it('reutiliza copy candidate-scoped sem criar GeneratedCopy legacy', async () => {
    const state = build();

    await state.service.confirm('dry-run-id', COMMERCIAL_CONFIRMATION_TOKEN, {
      existingGeneratedCopyId: 'ai-copy-1',
    });

    expect(state.generate).not.toHaveBeenCalled();
    expect(state.outboxes.copies).toHaveLength(0);
    expect(state.outboxes.dispatches[0].generatedCopyId).toBe('ai-copy-1');
  });

  it('revalida o grupo persistido mesmo quando ha outros grupos elegiveis', async () => {
    const state = build({
      groups: [
        group(),
        group({
          id: 'other-group',
          name: 'Outro grupo',
          fingerprint: 'grp_abcdef123456',
        }),
      ],
    });

    await expect(
      state.service.confirm('dry-run-id', COMMERCIAL_CONFIRMATION_TOKEN),
    ).resolves.toMatchObject({ selectedGroup: { name: 'Grupo ficticio autorizado' } });
    expect(state.outboxes.dispatches[0]?.destinationId).toBe('group-id');
  });

  it('falha fechado na confirmacao quando a fingerprint logica esta duplicada', async () => {
    const state = build({
      groups: [
        group(),
        group({ id: 'duplicate-group' }),
      ],
    });

    await expect(
      state.service.confirm('dry-run-id', COMMERCIAL_CONFIRMATION_TOKEN),
    ).rejects.toMatchObject({
      code: 'COMMERCIAL_AUTOMATION_DUPLICATE_LOGICAL_GROUP',
    });
    expect(state.outboxes.records).toHaveLength(0);
  });
});
