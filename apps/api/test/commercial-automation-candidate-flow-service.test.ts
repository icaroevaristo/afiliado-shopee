import { describe, expect, it, vi } from 'vitest';
import { AppError } from '@shopee-auto-affiliate-ai/shared';

import {
  CommercialAutomationCandidateFlowService,
} from '../src/commercial-automation-candidate-flow-service';
import { CommercialMessageDraftService } from '../src/commercial-message-draft-service';
import { fingerprintCommercialOffer } from '../src/commercial-offer-snapshot';
import type { CommercialPipelineDryRunResult } from '../src/commercial-pipeline-service';
import type {
  CommercialGroupCampaignRecord,
  CommercialPromotionCopyContext,
  CommercialPromotionCandidateRecord,
  CommercialPromotionQueueItem,
  GeneratedCopyRecord,
  WhatsAppInstanceRecord,
  WhatsAppGroupRecord,
} from '../src/repositories';

const NOW = new Date('2026-08-08T12:00:00.000Z');
const preparationOptions = { executionId: 'execution-1' } as const;
const attemptOptions = {
  executionId: 'execution-1',
  reservedAt: NOW,
  leaseExpiresAt: new Date('2026-08-08T12:05:00.000Z'),
} as const;
const GROUP_FINGERPRINT = 'grp_123456789abc';
const PRODUCT_LINK = 'https://shopee.com.br/product/1/product-1';
const AFFILIATE_LINK = 'https://s.shopee.com.br/affiliate/product-1';
const PROVIDER_PRODUCT_ID = 'provider-product-1';
const SNAPSHOT_FINGERPRINT = fingerprintCommercialOffer({
  source: 'OFFICIAL',
  providerProductId: PROVIDER_PRODUCT_ID,
  productLink: PRODUCT_LINK,
  affiliateLink: AFFILIATE_LINK,
  price: '99.90',
  priceMin: null,
  priceMax: null,
  discountRate: 20,
  commissionRate: 10,
  offerStartsAt: null,
  offerEndsAt: new Date('2026-08-09T12:00:00.000Z'),
  unavailableAt: null,
});

const candidateRecord = (
  overrides: Partial<CommercialPromotionCandidateRecord> = {},
): CommercialPromotionCandidateRecord => ({
  id: 'candidate-1',
  campaignId: 'campaign-1',
  productId: 'product-1',
  snapshotId: 'snapshot-1',
  generatedCopyId: 'copy-1',
  status: 'COPY_READY',
  rankPosition: 1,
  commercialScore: 88,
  scorePolicyVersion: 'official-v2',
  minimumScoreUsed: 60,
  scoreBreakdown: {
    policyVersion: 'official-v2',
    rawTotal: 88,
    finalScore: 88,
    components: { promotion: 88 },
  },
  promotionSignals: ['PRICE_DROP'],
  priceDropPercent: '10',
  queuedAt: NOW,
  lastEvaluatedAt: NOW,
  expiresAt: new Date('2026-08-09T12:00:00.000Z'),
  dedupeUntil: null,
  blockedReason: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

const campaign = (
  overrides: Partial<CommercialGroupCampaignRecord> = {},
): CommercialGroupCampaignRecord => ({
  id: 'campaign-1',
  name: 'Campanha do grupo',
  logicalGroupFingerprint: GROUP_FINGERPRINT,
  anchorDestinationId: 'group-1',
  nicheId: 'niche-1',
  niche: {
    id: 'niche-1',
    name: 'Casa',
    slug: 'casa',
    active: true,
  },
  anchorDestination: {
    id: 'group-1',
    name: 'Grupo comercial',
    fingerprint: GROUP_FINGERPRINT,
    active: true,
    available: true,
  },
  active: true,
  cadenceMinutes: 15,
  timezone: 'America/Sao_Paulo',
  allowedStartTime: '07:00',
  allowedEndTime: '22:00',
  dailyLimit: 60,
  failureCount: 0,
  nextEligibleAt: null,
  attemptExecutionId: null,
  attemptReservedAt: null,
  attemptLeaseExpiresAt: null,
  queueTargetSize: 40,
  dedupeDays: 30,
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

const group = (
  overrides: Partial<WhatsAppGroupRecord> = {},
): WhatsAppGroupRecord => ({
  id: 'group-1',
  name: 'Grupo comercial',
  destination: '120363000000000000@g.us',
  active: true,
  type: 'GROUP',
  available: true,
  fingerprint: GROUP_FINGERPRINT,
  sourceInstanceName: 'affiliate-bot',
  assignedInstanceName: 'affiliate-bot',
  discoveredAt: NOW,
  lastSyncedAt: NOW,
  ...overrides,
});

const copy = (): GeneratedCopyRecord => ({
  id: 'copy-1',
  productId: 'product-1',
  titulo: 'Oferta especial',
  mensagem: 'Produto validado para o grupo.',
  cta: AFFILIATE_LINK,
  hashtags: '#oferta',
  source: 'AI',
  provider: 'openai',
  model: 'test-model',
  promptVersion: 'commercial-ai-copy-v1',
  validationVersion: 'commercial-ai-copy-v1',
  inputFingerprint: 'fingerprint-1',
  snapshotId: 'snapshot-1',
  createdFromCandidateId: 'candidate-1',
  createdAt: NOW,
});

const context = (
  overrides: Partial<CommercialPromotionCopyContext['candidate']> = {},
  productOverrides: Partial<CommercialPromotionCopyContext['product']> = {},
): CommercialPromotionCopyContext => ({
  candidate: candidateRecord(overrides),
  campaign: campaign(),
  niche: {
    id: 'niche-1',
    name: 'Casa',
    slug: 'casa',
    active: true,
    categoryIds: [],
    includeKeywords: [],
    excludeKeywords: [],
    minPrice: null,
    maxPrice: null,
    minDiscountRate: 0,
    minRating: 0,
    minSales: 0,
    minCommissionRate: 0,
    minimumScore: 60,
    createdAt: NOW,
    updatedAt: NOW,
  },
  product: {
    id: 'product-1',
    source: 'OFFICIAL',
    providerProductId: PROVIDER_PRODUCT_ID,
    productLink: PRODUCT_LINK,
    productName: 'Produto validado',
    shopName: 'Loja validada',
    price: '99.90',
    priceMin: null,
    priceMax: null,
    discountRate: 20,
    commissionRate: 10,
    rating: 4.8,
    sales: 100,
    affiliateLink: AFFILIATE_LINK,
    urlImagem: 'https://example.invalid/image.jpg',
    offerStartsAt: null,
    offerEndsAt: new Date('2026-08-09T12:00:00.000Z'),
    unavailableAt: null,
    commercialSnapshotRevision: 1,
    commercialSnapshotFingerprint: SNAPSHOT_FINGERPRINT,
    updatedAt: NOW,
    ...productOverrides,
  },
  snapshot: {
    id: 'snapshot-1',
    productId: 'product-1',
    revision: 1,
    fingerprint: SNAPSHOT_FINGERPRINT,
    price: '99.90',
    priceMin: null,
    priceMax: null,
    discountRate: 20,
    commissionRate: 10,
    observedRating: 4.8,
    observedSales: 100,
    offerStartsAt: null,
    offerEndsAt: new Date('2026-08-09T12:00:00.000Z'),
    unavailableAt: null,
    capturedAt: NOW,
    createdAt: NOW,
  },
  previousSnapshot: null,
});

const queueItem = (
  overrides: Partial<CommercialPromotionQueueItem> = {},
): CommercialPromotionQueueItem => {
  const candidate = candidateRecord(overrides);
  const { scoreBreakdown: _scoreBreakdown, ...withoutBreakdown } = candidate;
  void _scoreBreakdown;
  return {
    ...withoutBreakdown,
    productName: 'Produto validado',
    price: '99.90',
    discountRate: 20,
    snapshotRevision: 1,
  };
};

const pipelineResult = (): CommercialPipelineDryRunResult => ({
  runId: 'run-1',
  mode: 'dry-run',
  status: 'ready',
  provider: 'official',
  candidateCount: 1,
  eligibleCount: 1,
  rejectedCount: 0,
  rejectionSummary: {},
  scorePolicyVersion: 'official-v2',
  minimumScoreUsed: 60,
  maximumScoreObserved: 88,
  selectedScoreBreakdown: {
    policyVersion: 'official-v2',
    rawTotal: 88,
    finalScore: 88,
    components: { promotion: 88 },
  },
  selectedProduct: {
    id: 'product-1',
    name: 'Produto validado',
    price: '99.90',
    score: 88,
    affiliateLinkPresent: true,
  },
  selectedGroup: {
    id: 'group-1',
    name: 'Grupo comercial',
    fingerprint: GROUP_FINGERPRINT,
  },
  selectionReasons: [],
  copyPreview: 'copy',
  plannedSubIds: [],
  dispatchWillBeCreated: false,
  jobWillBeCreated: false,
  messageWillBeSent: false,
});

const createSubject = (input: {
  candidate?: Partial<CommercialPromotionCandidateRecord>;
  product?: Partial<CommercialPromotionCopyContext['product']>;
  campaign?: Partial<CommercialGroupCampaignRecord>;
  group?: Partial<WhatsAppGroupRecord>;
  useListAll?: boolean;
} = {}) => {
  let currentCandidate = candidateRecord(input.candidate);
  const currentCampaign = campaign(input.campaign);
  const currentGroup = group(input.group);
  const currentContext = () =>
    context(currentCandidate, input.product);
  const copyRecord = copy();
  const queue = queueItem(currentCandidate);
  const listAll = vi.fn(async () => [currentGroup]);
  const groups = {
    list: vi.fn(async () => [currentGroup]),
    listAll: input.useListAll ? listAll : undefined,
  };
  const campaigns = {
    list: vi.fn(async () => ({ items: [currentCampaign], total: 1 })),
    findByLogicalGroupFingerprint: vi.fn(),
    reserveAttempt: vi.fn(async (input: {
      campaignId: string;
      executionId: string;
      reservedAt: Date;
      leaseExpiresAt: Date;
    }) => ({
      kind: 'RESERVED' as const,
      campaignId: input.campaignId,
      executionId: input.executionId,
      reservedAt: input.reservedAt,
      leaseExpiresAt: input.leaseExpiresAt,
      acquired: true,
    })),
    releaseAttempt: vi.fn(async (input: {
      campaignId: string;
      executionId: string;
    }) => ({
      kind: 'RELEASED' as const,
      campaignId: input.campaignId,
      executionId: input.executionId,
      released: true,
    })),
    renewAttempt: vi.fn(async (input: {
      campaignId: string;
      executionId: string;
      renewedAt: Date;
      leaseExpiresAt: Date;
    }) => ({
      kind: 'RENEWED' as const,
      campaignId: input.campaignId,
      executionId: input.executionId,
      leaseExpiresAt: input.leaseExpiresAt,
      renewed: true,
    })),
  };
  campaigns.findByLogicalGroupFingerprint.mockResolvedValue(currentCampaign);
  const candidates = {
    listQueue: vi.fn<
      (input: { campaignId: string; page?: number; limit?: number }) =>
        Promise<{ items: CommercialPromotionQueueItem[]; total: number }>
    >(async () => ({ items: [queue], total: 1 })),
  };
  const copies = {
    loadContext: vi.fn<
      (candidateId: string) => Promise<CommercialPromotionCopyContext | null>
    >(async () => currentContext()),
    findCopyForCandidate: vi.fn(async () => ({
      candidate: candidateRecord({ status: 'COPY_READY' }),
      copy: copyRecord,
      snapshotRevision: 1,
    })),
  };
  const copyGeneration = {
    findCopy: vi.fn(),
    preview: vi.fn(),
    generate: vi.fn(),
  };
  copyGeneration.findCopy.mockResolvedValue({
    candidateId: 'candidate-1',
    status: 'COPY_READY' as const,
    generatedCopyId: 'copy-1',
    source: 'AI' as const,
    provider: 'openai',
    model: 'test-model',
    promptVersion: 'commercial-ai-copy-v1',
    validationVersion: 'commercial-ai-copy-v1',
    snapshotRevision: 1,
    sanitizedCopy: {
      titulo: 'Oferta especial',
      mensagem: 'Produto validado para o grupo.',
      cta: '[LINK_AFILIADO]',
      hashtags: '#oferta',
    },
    createdAt: NOW,
  });
  copyGeneration.preview.mockResolvedValue({ eligible: true, blockers: [] });
  copyGeneration.generate.mockImplementation(async () => {
      currentCandidate = candidateRecord({
        status: 'COPY_READY',
        generatedCopyId: 'copy-1',
      });
      return undefined;
  });
  const mining = {
    mine: vi.fn(),
  };
  mining.mine.mockResolvedValue({ rejectionSummary: {} });
  const deliveryHistory = {
    wasProductSentToGroup: vi.fn<
      (productId: string, groupId: string) => Promise<boolean>
    >(async () => false),
    findLastSentAtByGroup: vi.fn<
      (groupId: string) => Promise<Date | null>
    >(async (groupId) => {
      void groupId;
      return null;
    }),
  };
  const pipeline = {
    dryRunFromPromotionCandidate: vi.fn(async () => pipelineResult()),
  };
  const instances = {
    findByName: vi.fn<
      (name: string) => Promise<WhatsAppInstanceRecord | null>
    >(async (name: string) => ({
        name,
        active: true,
        createdAt: NOW,
        updatedAt: NOW,
      })),
  };
  const service = new CommercialAutomationCandidateFlowService({
    groups,
    campaigns,
    candidates,
    deliveryHistory,
    copies,
    mining,
    copyGeneration,
    draft: new CommercialMessageDraftService(),
    pipeline,
    instances,
    instanceName: 'affiliate-bot',
    clock: () => NOW,
  });
  const target = {
    groupId: currentGroup.id,
    groupName: currentGroup.name,
    logicalGroupFingerprint: currentGroup.fingerprint,
    campaignId: currentCampaign.id,
    nicheId: currentCampaign.nicheId,
    dailyLimit: currentCampaign.dailyLimit,
    failureCount: currentCampaign.failureCount,
    nextEligibleAt: currentCampaign.nextEligibleAt,
  };
  return {
    service,
    target,
    groups,
    instances,
    listAll,
    campaigns,
    candidates,
    copies,
    copyGeneration,
    mining,
    deliveryHistory,
    pipeline,
    setCampaign: (value: Partial<CommercialGroupCampaignRecord>) => {
      Object.assign(currentCampaign, value);
    },
    setCandidate: (value: Partial<CommercialPromotionCandidateRecord>) => {
      currentCandidate = candidateRecord(value);
    },
  };
};

const selection = (
  target: ReturnType<typeof createSubject>['target'],
  candidateStatus: 'COPY_READY' | 'QUEUED' = 'COPY_READY',
  candidateId = 'candidate-1',
) => ({
  target,
  candidateId,
  candidateStatus,
  queue: { candidateCount: 1, eligibleCount: 1, rejectedCount: 0 },
});

describe('CommercialAutomationCandidateFlowService', () => {
  it('transporta o dailyLimit obrigatorio da campanha para o target sem aplicar quota', async () => {
    // dailyLimit e Int obrigatorio no schema; null nao e um estado valido.
    const subject = createSubject({
      campaign: { dailyLimit: 7, queueTargetSize: 2 },
    });

    await expect(subject.service.listTargets()).resolves.toEqual([
      expect.objectContaining({
        campaignId: 'campaign-1',
        groupId: 'group-1',
        dailyLimit: 7,
      }),
    ]);

    await subject.service.preflight(subject.target);

    expect(subject.candidates.listQueue).toHaveBeenCalledWith({
      campaignId: 'campaign-1',
      page: 1,
      limit: 2,
    });
  });

  it('ignora target em backoff e preserva targets vencidos, atuais e sem backoff', async () => {
    const subject = createSubject({
      campaign: {
        nextEligibleAt: new Date('2026-08-08T12:00:01.000Z'),
      },
    });

    await expect(subject.service.listTargets()).rejects.toMatchObject({
      code: 'COMMERCIAL_AUTOMATION_NO_ELIGIBLE_TARGET',
    });
    expect(subject.deliveryHistory.findLastSentAtByGroup).not.toHaveBeenCalled();

    subject.setCampaign({ nextEligibleAt: NOW });
    await expect(subject.service.listTargets()).resolves.toHaveLength(1);

    subject.setCampaign({
      nextEligibleAt: new Date('2026-08-08T11:59:59.999Z'),
    });
    await expect(subject.service.listTargets()).resolves.toHaveLength(1);

    subject.setCampaign({ nextEligibleAt: null });
    await expect(subject.service.listTargets()).resolves.toHaveLength(1);
  });

  it('trata alteracao do dailyLimit na revalidacao como target alterado', async () => {
    const subject = createSubject({ campaign: { dailyLimit: 7 } });
    const [target] = await subject.service.listTargets();

    subject.setCampaign({ dailyLimit: 11 });

    await expect(subject.service.preflight(target)).rejects.toMatchObject({
      code: 'COMMERCIAL_AUTOMATION_TARGET_CHANGED',
    });
    expect(subject.candidates.listQueue).not.toHaveBeenCalled();
  });

  it('mantem dailyLimit isolado entre campanhas e recarrega seu valor atual', async () => {
    const subject = createSubject({ campaign: { dailyLimit: 7 } });
    const secondCampaign = campaign({
      id: 'campaign-2',
      nicheId: 'niche-2',
      logicalGroupFingerprint: 'grp_abcdef123456',
      anchorDestinationId: 'group-2',
      dailyLimit: 19,
    });
    const secondGroup = group({
      id: 'group-2',
      fingerprint: 'grp_abcdef123456',
    });
    subject.groups.list.mockResolvedValue([group(), secondGroup]);
    subject.campaigns.findByLogicalGroupFingerprint.mockImplementation(
      async (fingerprint: string) =>
        fingerprint === GROUP_FINGERPRINT
          ? campaign({ dailyLimit: 11 })
          : secondCampaign,
    );

    const targets = await subject.service.listTargets();

    expect(targets).toEqual([
      expect.objectContaining({
        campaignId: 'campaign-1',
        groupId: 'group-1',
        dailyLimit: 11,
      }),
      expect.objectContaining({
        campaignId: 'campaign-2',
        groupId: 'group-2',
        dailyLimit: 19,
      }),
    ]);
  });

  it('reutiliza COPY_READY e preserva o ranking da fila', async () => {
    const subject = createSubject();

    const result = await subject.service.prepare(
      selection(subject.target),
      preparationOptions,
    );

    expect(result).toMatchObject({
      runId: 'run-1',
      candidateId: 'candidate-1',
      generatedCopyId: 'copy-1',
      groupId: 'group-1',
      deliveryMode: 'IMAGE',
    });
    expect(subject.mining.mine).not.toHaveBeenCalled();
    expect(subject.copyGeneration.generate).not.toHaveBeenCalled();
    expect(subject.pipeline.dryRunFromPromotionCandidate).toHaveBeenCalledOnce();
    expect(subject.pipeline.dryRunFromPromotionCandidate).toHaveBeenCalledWith(
      expect.objectContaining({ executionId: 'execution-1' }),
    );
  });

  it('usa copy generation existente para QUEUED com uma unica tentativa', async () => {
    const subject = createSubject({
      candidate: { status: 'QUEUED', generatedCopyId: null },
    });

    const result = await subject.service.prepare(
      selection(subject.target, 'QUEUED'),
      preparationOptions,
    );

    expect(result.generatedCopyId).toBe('copy-1');
    expect(subject.copyGeneration.preview).not.toHaveBeenCalled();
    expect(subject.copyGeneration.generate).toHaveBeenCalledOnce();
  });

  it('executa o callback do marker imediatamente antes de gerar copy para QUEUED', async () => {
    const subject = createSubject({
      candidate: { status: 'QUEUED', generatedCopyId: null },
    });
    const events: string[] = [];
    subject.copyGeneration.generate.mockImplementation(async () => {
      events.push('copyGenerate');
      subject.setCandidate({ status: 'COPY_READY', generatedCopyId: 'copy-1' });
    });

    await subject.service.prepare(selection(subject.target, 'QUEUED'), {
      ...preparationOptions,
      beforeExternalCopyGeneration: async () => {
        events.push('beforeExternalMarker');
        events.push('externalMarked');
      },
    });

    expect(events).toEqual([
      'beforeExternalMarker',
      'externalMarked',
      'copyGenerate',
    ]);
    expect(subject.copyGeneration.generate).toHaveBeenCalledOnce();
  });

  it('nao chama generate quando o callback do marker falha', async () => {
    const subject = createSubject({
      candidate: { status: 'QUEUED', generatedCopyId: null },
    });
    const markerFailure = new Error('marker unavailable');

    await expect(
      subject.service.prepare(selection(subject.target, 'QUEUED'), {
        ...preparationOptions,
        beforeExternalCopyGeneration: async () => {
          throw markerFailure;
        },
      }),
    ).rejects.toBe(markerFailure);

    expect(subject.copyGeneration.generate).not.toHaveBeenCalled();
    expect(subject.pipeline.dryRunFromPromotionCandidate).not.toHaveBeenCalled();
  });

  it('ignora o callback do marker e generate quando o candidato ja esta COPY_READY', async () => {
    const subject = createSubject();
    const beforeExternalCopyGeneration = vi.fn(async () => undefined);

    await subject.service.prepare(selection(subject.target), {
      ...preparationOptions,
      beforeExternalCopyGeneration,
    });

    expect(beforeExternalCopyGeneration).not.toHaveBeenCalled();
    expect(subject.copyGeneration.generate).not.toHaveBeenCalled();
  });

  it('faz preflight de QUEUED somente com leituras antes de minerar ou chamar IA', async () => {
    const subject = createSubject({
      candidate: { status: 'QUEUED', generatedCopyId: null },
    });

    await expect(subject.service.preflight(subject.target)).resolves.toMatchObject({
      outcome: 'READY',
      candidateId: 'candidate-1',
      candidateStatus: 'QUEUED',
    });

    expect(subject.mining.mine).not.toHaveBeenCalled();
    expect(subject.copyGeneration.generate).not.toHaveBeenCalled();
    expect(subject.pipeline.dryRunFromPromotionCandidate).not.toHaveBeenCalled();
  });

  it('fixa C1 do preflight e falha sem selecionar C2 quando C1 fica invalido', async () => {
    const subject = createSubject({
      candidate: { status: 'QUEUED', generatedCopyId: null },
    });
    let includeBetterC2 = false;
    let c1 = context({ status: 'QUEUED', generatedCopyId: null });
    const c2 = context({
      id: 'candidate-2',
      status: 'QUEUED',
      generatedCopyId: null,
      rankPosition: 1,
    });
    subject.candidates.listQueue.mockImplementation(async () => ({
      items: includeBetterC2
        ? [
            queueItem({
              id: 'candidate-2',
              status: 'QUEUED',
              generatedCopyId: null,
              rankPosition: 1,
            }),
            queueItem({
              id: 'candidate-1',
              status: 'QUEUED',
              generatedCopyId: null,
              rankPosition: 2,
            }),
          ]
        : [
            queueItem({
              id: 'candidate-1',
              status: 'QUEUED',
              generatedCopyId: null,
              rankPosition: 2,
            }),
          ],
      total: includeBetterC2 ? 2 : 1,
    }));
    subject.copies.loadContext.mockImplementation(async (candidateId: string) =>
      candidateId === 'candidate-1' ? c1 : c2,
    );

    const preflight = await subject.service.preflight(subject.target);
    expect(preflight).toMatchObject({
      outcome: 'READY',
      candidateId: 'candidate-1',
      candidateStatus: 'QUEUED',
    });

    includeBetterC2 = true;
    c1 = context(
      { status: 'QUEUED', generatedCopyId: null, rankPosition: 2 },
      { affiliateLink: '' },
    );
    subject.candidates.listQueue.mockClear();
    subject.copies.loadContext.mockClear();

    await expect(
      subject.service.prepare(
        selection(subject.target, 'QUEUED', 'candidate-1'),
        preparationOptions,
      ),
    ).rejects.toMatchObject({
      code: 'COMMERCIAL_AUTOMATION_NO_ELIGIBLE_CANDIDATE',
    });

    expect(subject.candidates.listQueue).not.toHaveBeenCalled();
    expect(subject.copies.loadContext).toHaveBeenCalledWith('candidate-1');
    expect(subject.copies.loadContext).not.toHaveBeenCalledWith('candidate-2');
    expect(subject.copyGeneration.generate).not.toHaveBeenCalled();
    expect(subject.pipeline.dryRunFromPromotionCandidate).not.toHaveBeenCalled();
  });

  it('reabastece somente a campanha do target sem chamar IA ou criar run', async () => {
    const subject = createSubject();

    await subject.service.replenish(subject.target);

    expect(subject.mining.mine).toHaveBeenCalledWith('campaign-1', {
      confirm: 'MINERAR_PROMOCOES',
    });
    expect(subject.copyGeneration.generate).not.toHaveBeenCalled();
    expect(subject.pipeline.dryRunFromPromotionCandidate).not.toHaveBeenCalled();
  });

  it('encerra preflight sem candidato sem mineracao, IA ou run', async () => {
    const subject = createSubject();
    subject.candidates.listQueue.mockResolvedValue({ items: [], total: 0 });

    await expect(subject.service.preflight(subject.target)).resolves.toEqual({
      outcome: 'NO_CANDIDATE',
    });

    expect(subject.mining.mine).not.toHaveBeenCalled();
    expect(subject.copyGeneration.generate).not.toHaveBeenCalled();
    expect(subject.pipeline.dryRunFromPromotionCandidate).not.toHaveBeenCalled();
  });

  it('ignora copy pronta ja entregue e procura o proximo candidato sem duplicar', async () => {
    const subject = createSubject();
    subject.deliveryHistory.wasProductSentToGroup.mockResolvedValue(true);

    await expect(
      subject.service.prepare(selection(subject.target), preparationOptions),
    ).rejects.toMatchObject({
      code: 'COMMERCIAL_AUTOMATION_NO_ELIGIBLE_CANDIDATE',
    });
    expect(subject.copyGeneration.findCopy).not.toHaveBeenCalled();
    expect(subject.copyGeneration.generate).not.toHaveBeenCalled();
    expect(subject.pipeline.dryRunFromPromotionCandidate).not.toHaveBeenCalled();
  });

  it('classifica imagem ausente em COPY_READY como ausencia de candidato', async () => {
    const subject = createSubject({ product: { urlImagem: '' } });

    await expect(subject.service.preflight(subject.target)).resolves.toEqual({
      outcome: 'NO_CANDIDATE',
    });
    expect(subject.copyGeneration.generate).not.toHaveBeenCalled();
    expect(subject.pipeline.dryRunFromPromotionCandidate).not.toHaveBeenCalled();
  });

  it('bloqueia campanha ausente antes da mineracao', async () => {
    const subject = createSubject();
    subject.campaigns.findByLogicalGroupFingerprint.mockResolvedValue(
      null,
    );

    await expect(
      subject.service.prepare(selection(subject.target), preparationOptions),
    ).rejects.toMatchObject({
      code: 'COMMERCIAL_GROUP_CAMPAIGN_NOT_FOUND',
    });
    expect(subject.mining.mine).not.toHaveBeenCalled();
  });

  it('bloqueia grupo inativo ou indisponivel', async () => {
    const subject = createSubject({
      group: { active: false, available: false },
    });

    await expect(
      subject.service.prepare(selection(subject.target), preparationOptions),
    ).rejects.toMatchObject({
      code: 'NO_AUTHORIZED_GROUP',
    });
    expect(subject.mining.mine).not.toHaveBeenCalled();
  });

  it('bloqueia instancia inativa antes da reserva e da copy sem reroute', async () => {
    const subject = createSubject({ useListAll: true });
    const fallbackGroup = group({
      id: 'group-b',
      name: 'Grupo B',
      destination: '120363000000000001@g.us',
      fingerprint: 'grp_abcdef123456',
      sourceInstanceName: 'instance-b',
      assignedInstanceName: 'instance-b',
    });
    subject.listAll.mockResolvedValue([group(), fallbackGroup]);
    subject.instances.findByName.mockImplementation(async (name: string) => ({
      name,
      active: name === 'instance-b',
      createdAt: NOW,
      updatedAt: NOW,
    }));

    await expect(
      subject.service.reserveAttempt(subject.target, attemptOptions),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_AUTOMATION_TARGET_CHANGED' });
    await expect(
      subject.service.prepare(selection(subject.target), preparationOptions),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_AUTOMATION_TARGET_CHANGED' });

    expect(subject.campaigns.reserveAttempt).not.toHaveBeenCalled();
    expect(subject.copyGeneration.findCopy).not.toHaveBeenCalled();
    expect(subject.copyGeneration.generate).not.toHaveBeenCalled();
    expect(subject.copyGeneration.preview).not.toHaveBeenCalled();
    expect(subject.pipeline.dryRunFromPromotionCandidate).not.toHaveBeenCalled();
  });

  it('bloqueia instancia ausente antes da reserva e da copy sem fallback', async () => {
    const subject = createSubject({ useListAll: true });
    const fallbackGroup = group({
      id: 'group-b',
      name: 'Grupo B',
      destination: '120363000000000001@g.us',
      fingerprint: 'grp_abcdef123456',
      sourceInstanceName: 'instance-b',
      assignedInstanceName: 'instance-b',
    });
    subject.listAll.mockResolvedValue([group(), fallbackGroup]);
    subject.instances.findByName.mockImplementation(async (name: string) =>
      name === 'affiliate-bot'
        ? null
        : {
            name,
            active: true,
            createdAt: NOW,
            updatedAt: NOW,
          },
    );

    await expect(
      subject.service.reserveAttempt(subject.target, attemptOptions),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_AUTOMATION_TARGET_CHANGED' });
    await expect(
      subject.service.prepare(selection(subject.target), preparationOptions),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_AUTOMATION_TARGET_CHANGED' });

    expect(subject.campaigns.reserveAttempt).not.toHaveBeenCalled();
    expect(subject.copyGeneration.findCopy).not.toHaveBeenCalled();
    expect(subject.copyGeneration.generate).not.toHaveBeenCalled();
    expect(subject.copyGeneration.preview).not.toHaveBeenCalled();
    expect(subject.pipeline.dryRunFromPromotionCandidate).not.toHaveBeenCalled();
  });

  it('revalida a instancia antes da preparacao e bloqueia a corrida active-inactive', async () => {
    const subject = createSubject({ useListAll: true });
    subject.instances.findByName
      .mockResolvedValueOnce({
        name: 'affiliate-bot',
        active: true,
        createdAt: NOW,
        updatedAt: NOW,
      })
      .mockResolvedValueOnce({
        name: 'affiliate-bot',
        active: false,
        createdAt: NOW,
        updatedAt: NOW,
      })
      .mockImplementation(async () => ({
        name: 'affiliate-bot',
        active: false,
        createdAt: NOW,
        updatedAt: NOW,
      }));

    await expect(subject.service.listTargets()).resolves.toHaveLength(1);
    await expect(
      subject.service.reserveAttempt(subject.target, attemptOptions),
    ).rejects.toMatchObject({ code: 'NO_AUTHORIZED_GROUP' });
    await expect(
      subject.service.prepare(selection(subject.target), preparationOptions),
    ).rejects.toMatchObject({ code: 'NO_AUTHORIZED_GROUP' });

    expect(subject.campaigns.reserveAttempt).not.toHaveBeenCalled();
    expect(subject.copyGeneration.findCopy).not.toHaveBeenCalled();
    expect(subject.copyGeneration.generate).not.toHaveBeenCalled();
    expect(subject.copyGeneration.preview).not.toHaveBeenCalled();
    expect(subject.pipeline.dryRunFromPromotionCandidate).not.toHaveBeenCalled();
  });

  it('seleciona o alvo menos recentemente enviado com desempate deterministico', async () => {
    const subject = createSubject();
    const groupTwo = group({
      id: 'group-2',
      fingerprint: 'grp_abcdef123456',
    });
    subject.groups.list.mockResolvedValue([
      group(),
      groupTwo,
    ]);
    subject.campaigns.findByLogicalGroupFingerprint.mockImplementation(
      async (fingerprint: string) =>
        fingerprint === GROUP_FINGERPRINT
          ? campaign()
          : campaign({
              id: 'campaign-2',
              logicalGroupFingerprint: 'grp_abcdef123456',
              anchorDestinationId: 'group-2',
              nicheId: 'niche-2',
              niche: {
                id: 'niche-2',
                name: 'Eletronicos',
                slug: 'eletronicos',
                active: true,
              },
              anchorDestination: {
                id: 'group-2',
                name: 'Grupo dois',
                fingerprint: 'grp_abcdef123456',
                active: true,
                available: true,
              },
            }),
    );
    subject.deliveryHistory.findLastSentAtByGroup.mockImplementation(
      async (groupId: string) =>
        groupId === 'group-1' ? new Date('2026-08-08T11:00:00.000Z') : null,
    );

    const targets = await subject.service.listTargets();

    expect(targets.map(({ groupId }) => groupId)).toEqual([
      'group-2',
      'group-1',
    ]);
    subject.groups.list.mockResolvedValue([groupTwo, group()]);
    const permutedTargets = await subject.service.listTargets();
    expect(permutedTargets.map(({ groupId }) => groupId)).toEqual([
      'group-2',
      'group-1',
    ]);

    expect(subject.mining.mine).not.toHaveBeenCalled();
  });

  it('ignora grupo de outra instancia', async () => {
    const subject = createSubject({
      group: { sourceInstanceName: 'other-instance' },
    });

    await expect(
      subject.service.prepare(selection(subject.target), preparationOptions),
    ).rejects.toMatchObject({
      code: 'NO_AUTHORIZED_GROUP',
    });
    expect(subject.mining.mine).not.toHaveBeenCalled();
  });

  it('mantem rotacao justa A-B-C sem cursor ou aleatoriedade', async () => {
    const targets = [
      group({ id: 'group-a', fingerprint: 'grp_aaaaaaaaaaaa' }),
      group({ id: 'group-b', fingerprint: 'grp_bbbbbbbbbbbb' }),
      group({ id: 'group-c', fingerprint: 'grp_cccccccccccc' }),
    ];
    const subject = createSubject();
    const lastSentAt = new Map<string, Date>();
    subject.groups.list.mockResolvedValue(targets);
    subject.campaigns.findByLogicalGroupFingerprint.mockImplementation(
      async (fingerprint: string) =>
        campaign({
          id: `campaign-${fingerprint}`,
          logicalGroupFingerprint: fingerprint,
          nicheId: `niche-${fingerprint}`,
          niche: {
            id: `niche-${fingerprint}`,
            name: 'Nicho',
            slug: 'nicho',
            active: true,
          },
        }),
    );
    subject.deliveryHistory.findLastSentAtByGroup.mockImplementation(
      async (groupId: string) => lastSentAt.get(groupId) ?? null,
    );

    const first = await subject.service.listTargets();
    expect(first[0]?.groupId).toBe('group-a');

    const sentAt = new Date('2026-08-08T12:01:00.000Z');
    lastSentAt.set('group-a', sentAt);
    const second = await subject.service.listTargets();
    expect(second[0]?.groupId).toBe('group-b');

    lastSentAt.set('group-b', sentAt);
    const third = await subject.service.listTargets();
    expect(third[0]?.groupId).toBe('group-c');

    lastSentAt.set('group-c', sentAt);
    const fourth = await subject.service.listTargets();
    expect(fourth.map(({ groupId }) => groupId)).toEqual([
      'group-a',
      'group-b',
      'group-c',
    ]);
  });

  it('isola nicho e dedupe entre grupos de instancias distintas', async () => {
    const subject = createSubject({ useListAll: true });
    const groupA = group({
      id: 'group-a',
      name: 'Grupo A',
      destination: '120363000000000001@g.us',
      fingerprint: 'grp_aaaaaaaaaaaa',
      sourceInstanceName: 'instance-a',
      assignedInstanceName: 'instance-a',
    });
    const groupB = group({
      id: 'group-b',
      name: 'Grupo B',
      destination: '120363000000000002@g.us',
      fingerprint: 'grp_bbbbbbbbbbbb',
      sourceInstanceName: 'instance-b',
      assignedInstanceName: 'instance-b',
    });
    const campaignA = campaign({
      id: 'campaign-a',
      logicalGroupFingerprint: groupA.fingerprint,
      anchorDestinationId: groupA.id,
      nicheId: 'niche-a',
      niche: { id: 'niche-a', name: 'Casa A', slug: 'casa-a', active: true },
    });
    const campaignB = campaign({
      id: 'campaign-b',
      logicalGroupFingerprint: groupB.fingerprint,
      anchorDestinationId: groupB.id,
      nicheId: 'niche-b',
      niche: {
        id: 'niche-b',
        name: 'Eletronicos B',
        slug: 'eletronicos-b',
        active: true,
      },
    });
    subject.listAll.mockResolvedValue([groupA, groupB]);
    subject.instances.findByName.mockImplementation(async (name: string) => ({
      name,
      active: true,
      createdAt: NOW,
      updatedAt: NOW,
    }));
    subject.campaigns.findByLogicalGroupFingerprint.mockImplementation(
      async (fingerprint: string) =>
        fingerprint === groupA.fingerprint ? campaignA : campaignB,
    );
    const candidateA = candidateRecord({
      id: 'candidate-a',
      campaignId: campaignA.id,
      productId: 'product-1',
      status: 'QUEUED',
      generatedCopyId: null,
    });
    const candidateB = candidateRecord({
      id: 'candidate-b',
      campaignId: campaignB.id,
      productId: 'product-1',
      status: 'QUEUED',
      generatedCopyId: null,
    });
    subject.candidates.listQueue.mockImplementation(
      async ({ campaignId }: { campaignId: string }) => ({
        items: [
          queueItem(campaignId === campaignA.id ? candidateA : candidateB),
        ],
        total: 1,
      }),
    );
    const contextA = context({
      id: candidateA.id,
      campaignId: campaignA.id,
      productId: 'product-1',
      status: 'QUEUED',
      generatedCopyId: null,
    });
    contextA.campaign = campaignA;
    const contextB = context({
      id: candidateB.id,
      campaignId: campaignB.id,
      productId: 'product-1',
      status: 'QUEUED',
      generatedCopyId: null,
    });
    contextB.campaign = campaignB;
    subject.copies.loadContext.mockImplementation(async (candidateId: string) =>
      candidateId === candidateA.id ? contextA : contextB,
    );
    subject.deliveryHistory.wasProductSentToGroup.mockImplementation(
      async (productId: string, groupId: string) => {
        expect(productId).toBe('product-1');
        return groupId === groupA.id;
      },
    );
    subject.copyGeneration.preview.mockResolvedValue({
      eligible: true,
      blockers: [],
    });

    const targets = await subject.service.listTargets();
    expect(targets.map(({ groupId, instanceName, nicheId }) => ({
      groupId,
      instanceName,
      nicheId,
    }))).toEqual([
      { groupId: groupA.id, instanceName: 'instance-a', nicheId: campaignA.nicheId },
      { groupId: groupB.id, instanceName: 'instance-b', nicheId: campaignB.nicheId },
    ]);

    const targetA = targets.find(({ groupId }) => groupId === groupA.id);
    const targetB = targets.find(({ groupId }) => groupId === groupB.id);
    expect(targetA).toBeDefined();
    expect(targetB).toBeDefined();
    await expect(subject.service.preflight(targetA!)).resolves.toEqual({
      outcome: 'NO_CANDIDATE',
    });
    await expect(subject.service.preflight(targetB!)).resolves.toMatchObject({
      outcome: 'READY',
      candidateId: candidateB.id,
      candidateStatus: 'QUEUED',
    });
    expect(subject.copyGeneration.preview).toHaveBeenCalledOnce();
  });

  it('mantem produto e nicho vinculados ao grupo correto entre instancias', async () => {
    const subject = createSubject({ useListAll: true });
    const groupA = group({
      id: 'group-a-niche',
      name: 'Grupo A Nicho',
      destination: '120363000000000003@g.us',
      fingerprint: 'grp_cccccccccccc',
      sourceInstanceName: 'instance-a',
      assignedInstanceName: 'instance-a',
    });
    const groupB = group({
      id: 'group-b-niche',
      name: 'Grupo B Nicho',
      destination: '120363000000000004@g.us',
      fingerprint: 'grp_dddddddddddd',
      sourceInstanceName: 'instance-b',
      assignedInstanceName: 'instance-b',
    });
    const campaignA = campaign({
      id: 'campaign-a-niche',
      logicalGroupFingerprint: groupA.fingerprint,
      anchorDestinationId: groupA.id,
      nicheId: 'niche-a-only',
      niche: {
        id: 'niche-a-only',
        name: 'Casa A',
        slug: 'casa-a-only',
        active: true,
      },
    });
    const campaignB = campaign({
      id: 'campaign-b-niche',
      logicalGroupFingerprint: groupB.fingerprint,
      anchorDestinationId: groupB.id,
      nicheId: 'niche-b-only',
      niche: {
        id: 'niche-b-only',
        name: 'Eletronicos B',
        slug: 'eletronicos-b-only',
        active: true,
      },
    });
    subject.listAll.mockResolvedValue([groupA, groupB]);
    subject.campaigns.findByLogicalGroupFingerprint.mockImplementation(
      async (fingerprint: string) =>
        fingerprint === groupA.fingerprint ? campaignA : campaignB,
    );
    const candidateA = candidateRecord({
      id: 'candidate-a-niche',
      campaignId: campaignA.id,
      productId: 'product-a-only',
      snapshotId: 'snapshot-a-only',
      status: 'QUEUED',
      generatedCopyId: null,
    });
    const candidateB = candidateRecord({
      id: 'candidate-b-niche',
      campaignId: campaignB.id,
      productId: 'product-b-only',
      snapshotId: 'snapshot-b-only',
      status: 'QUEUED',
      generatedCopyId: null,
    });
    subject.candidates.listQueue.mockImplementation(
      async ({ campaignId }: { campaignId: string }) => ({
        items: [
          queueItem(campaignId === campaignA.id ? candidateA : candidateB),
        ],
        total: 1,
      }),
    );
    const makeContext = (
      candidate: CommercialPromotionCandidateRecord,
      campaignRecord: CommercialGroupCampaignRecord,
    ) => {
      const candidateContext = context({
        id: candidate.id,
        campaignId: candidate.campaignId,
        productId: candidate.productId,
        snapshotId: candidate.snapshotId,
        status: 'QUEUED',
        generatedCopyId: null,
      });
      candidateContext.campaign = campaignRecord;
      candidateContext.niche = {
        ...candidateContext.niche,
        ...campaignRecord.niche,
      };
      candidateContext.product = {
        ...candidateContext.product,
        id: candidate.productId,
      };
      candidateContext.snapshot = {
        ...candidateContext.snapshot,
        id: candidate.snapshotId,
        productId: candidate.productId,
      };
      return candidateContext;
    };
    const contextA = makeContext(candidateA, campaignA);
    const contextB = makeContext(candidateB, campaignB);
    subject.copies.loadContext.mockImplementation(async (candidateId: string) =>
      candidateId === candidateA.id ? contextA : contextB,
    );
    subject.deliveryHistory.wasProductSentToGroup.mockResolvedValue(false);
    subject.copyGeneration.preview.mockResolvedValue({
      eligible: true,
      blockers: [],
    });

    const targets = await subject.service.listTargets();
    const targetA = targets.find(({ groupId }) => groupId === groupA.id);
    const targetB = targets.find(({ groupId }) => groupId === groupB.id);
    expect(targetA).toMatchObject({
      instanceName: 'instance-a',
      nicheId: campaignA.nicheId,
    });
    expect(targetB).toMatchObject({
      instanceName: 'instance-b',
      nicheId: campaignB.nicheId,
    });
    await expect(subject.service.preflight(targetA!)).resolves.toMatchObject({
      outcome: 'READY',
      candidateId: candidateA.id,
    });
    await expect(subject.service.preflight(targetB!)).resolves.toMatchObject({
      outcome: 'READY',
      candidateId: candidateB.id,
    });
    expect(subject.copies.loadContext).toHaveBeenNthCalledWith(1, candidateA.id);
    expect(subject.copies.loadContext).toHaveBeenNthCalledWith(2, candidateB.id);
    expect(contextA.product.id).toBe(candidateA.productId);
    expect(contextA.niche.id).toBe(campaignA.nicheId);
    expect(contextB.product.id).toBe(candidateB.productId);
    expect(contextB.niche.id).toBe(campaignB.nicheId);
  });

  it('bloqueia destinos fisicos que repetem a mesma fingerprint logica', async () => {
    const subject = createSubject();
    subject.groups.list.mockResolvedValue([
      group(),
      group({ id: 'group-2', fingerprint: GROUP_FINGERPRINT }),
    ]);

    await expect(
      subject.service.prepare(selection(subject.target), preparationOptions),
    ).rejects.toMatchObject({
      code: 'COMMERCIAL_AUTOMATION_DUPLICATE_LOGICAL_GROUP',
    });
    expect(subject.campaigns.findByLogicalGroupFingerprint).not.toHaveBeenCalled();
  });

  it('bloqueia campanha inativa antes da mineracao', async () => {
    const subject = createSubject();
    subject.campaigns.findByLogicalGroupFingerprint.mockResolvedValue(
      campaign({ active: false }),
    );

    await expect(
      subject.service.prepare(selection(subject.target), preparationOptions),
    ).rejects.toMatchObject({
      code: 'CAMPAIGN_INACTIVE',
    });
    expect(subject.mining.mine).not.toHaveBeenCalled();
  });

  it('bloqueia nicho inativo antes da mineracao', async () => {
    const subject = createSubject({
      campaign: {
        niche: {
          id: 'niche-1',
          name: 'Casa',
          slug: 'casa',
          active: false,
        },
      },
    });

    await expect(
      subject.service.prepare(selection(subject.target), preparationOptions),
    ).rejects.toMatchObject({
      code: 'NICHE_INACTIVE',
    });
    expect(subject.mining.mine).not.toHaveBeenCalled();
  });

  it('classifica link afiliado ausente em QUEUED como ausencia de candidato', async () => {
    const subject = createSubject({
      candidate: { status: 'QUEUED', generatedCopyId: null },
      product: { affiliateLink: '' },
    });

    await expect(subject.service.preflight(subject.target)).resolves.toEqual({
      outcome: 'NO_CANDIDATE',
    });
    expect(subject.copyGeneration.preview).not.toHaveBeenCalled();
    expect(subject.copyGeneration.generate).not.toHaveBeenCalled();
    expect(subject.pipeline.dryRunFromPromotionCandidate).not.toHaveBeenCalled();
  });

  it('aceita somente blockers benignos no preflight de copy enfileirada', async () => {
    const subject = createSubject({
      candidate: { status: 'QUEUED', generatedCopyId: null },
    });
    subject.copyGeneration.preview.mockResolvedValue({
      eligible: false,
      blockers: ['COMMERCIAL_AI_COPY_OFFER_EXPIRED'],
    });

    await expect(subject.service.preflight(subject.target)).resolves.toEqual({
      outcome: 'NO_CANDIDATE',
    });
    expect(subject.copyGeneration.generate).not.toHaveBeenCalled();
    expect(subject.pipeline.dryRunFromPromotionCandidate).not.toHaveBeenCalled();
  });

  it('pula rejeicao terminal do rank-1 e seleciona rank-2 deterministicamente sem gerar novamente', async () => {
    const subject = createSubject({ candidate: { status: 'QUEUED', generatedCopyId: null } });
    const first = queueItem({ status: 'QUEUED', generatedCopyId: null, rankPosition: 1 });
    const second = queueItem({ id: 'candidate-2', status: 'QUEUED', generatedCopyId: null, rankPosition: 2 });
    subject.candidates.listQueue.mockResolvedValue({ items: [first, second], total: 2 });
    subject.copies.loadContext.mockImplementation(async (candidateId: string) =>
      context({ id: candidateId, status: 'QUEUED', generatedCopyId: null, rankPosition: candidateId === 'candidate-1' ? 1 : 2 }),
    );
    subject.copyGeneration.preview.mockImplementation(async (candidateId: string) =>
      candidateId === 'candidate-1'
        ? { eligible: false, blockers: ['COMMERCIAL_AI_COPY_TERMINAL_OUTPUT_REJECTED'] }
        : { eligible: true, blockers: [] },
    );

    await expect(subject.service.preflight(subject.target)).resolves.toMatchObject({ outcome: 'READY', candidateId: 'candidate-2', candidateStatus: 'QUEUED' });
    await expect(subject.service.preflight(subject.target)).resolves.toMatchObject({ outcome: 'READY', candidateId: 'candidate-2', candidateStatus: 'QUEUED' });
    expect(subject.copyGeneration.generate).not.toHaveBeenCalled();
  });

  it.each([
    'COMMERCIAL_AI_COPY_GENERATION_IN_PROGRESS',
    'COMMERCIAL_AI_COPY_RESULT_AMBIGUOUS',
    'COMMERCIAL_AI_COPY_PREVIOUSLY_FAILED',
  ])('mantem blocker %s fail-closed no rank-1', async (blocker) => {
    const subject = createSubject({ candidate: { status: 'QUEUED', generatedCopyId: null } });
    subject.copyGeneration.preview.mockResolvedValue({ eligible: false, blockers: [blocker] });
    await expect(subject.service.preflight(subject.target)).rejects.toMatchObject({ code: blocker });
    expect(subject.copyGeneration.generate).not.toHaveBeenCalled();
  });
  it('falha fechado para source invalid em vez de converter eligible=false em fallback', async () => {
    const subject = createSubject({
      candidate: { status: 'QUEUED', generatedCopyId: null },
    });
    subject.copyGeneration.preview.mockResolvedValue({
      eligible: false,
      blockers: ['COMMERCIAL_AI_COPY_SOURCE_INVALID'],
    });

    await expect(subject.service.preflight(subject.target)).rejects.toMatchObject({
      code: 'COMMERCIAL_AI_COPY_SOURCE_INVALID',
    });
    expect(subject.copyGeneration.generate).not.toHaveBeenCalled();
    expect(subject.pipeline.dryRunFromPromotionCandidate).not.toHaveBeenCalled();
  });

  it('bloqueia link de afiliado inconsistente antes do pipeline', async () => {
    const subject = createSubject({
      product: {
        affiliateLink: 'https://example.invalid/affiliate/changed',
      },
    });

    await expect(
      subject.service.prepare(selection(subject.target), preparationOptions),
    ).rejects.toMatchObject({
      code: 'COMMERCIAL_AI_COPY_AFFILIATE_LINK_DOMAIN_UNAUTHORIZED',
    });
    expect(subject.pipeline.dryRunFromPromotionCandidate).not.toHaveBeenCalled();
  });

  it('revalida copy, campanha, grupo e IMAGE antes da confirmacao', async () => {
    const subject = createSubject();
    const prepared = await subject.service.prepare(
      selection(subject.target),
      preparationOptions,
    );

    await expect(subject.service.revalidate(prepared)).resolves.toBeUndefined();
    expect(subject.copyGeneration.findCopy).toHaveBeenCalledOnce();
  });

  it('nao segue com candidato expirado ou copy invalida', async () => {
    const subject = createSubject({
      candidate: { expiresAt: new Date('2026-08-07T12:00:00.000Z') },
    });
    subject.copyGeneration.findCopy.mockRejectedValue(
      new AppError('Candidato expirado', 'COMMERCIAL_AI_COPY_OFFER_EXPIRED'),
    );

    await expect(
      subject.service.prepare(selection(subject.target), preparationOptions),
    ).rejects.toMatchObject({
      code: 'COMMERCIAL_AUTOMATION_NO_ELIGIBLE_CANDIDATE',
    });
    expect(subject.pipeline.dryRunFromPromotionCandidate).not.toHaveBeenCalled();
  });

  it('exige fingerprint da campanha correspondente ao grupo', async () => {
    const subject = createSubject({
      campaign: { logicalGroupFingerprint: 'grp_abcdef123456' },
    });
    subject.campaigns.findByLogicalGroupFingerprint.mockResolvedValue(
      campaign({ logicalGroupFingerprint: 'grp_abcdef123456' }),
    );

    await expect(
      subject.service.prepare(selection(subject.target), preparationOptions),
    ).rejects.toMatchObject({
      code: 'COMMERCIAL_GROUP_CAMPAIGN_FINGERPRINT_MISMATCH',
    });
    expect(subject.mining.mine).not.toHaveBeenCalled();
  });

  it('reserva somente o alvo selecionado antes da preparacao', async () => {
    const subject = createSubject();
    const reservedAt = new Date('2026-08-08T12:01:00.000Z');
    const leaseExpiresAt = new Date('2026-08-08T12:11:00.000Z');

    await expect(
      subject.service.reserveAttempt(subject.target, {
        executionId: 'execution-1',
        reservedAt,
        leaseExpiresAt,
      }),
    ).resolves.toMatchObject({
      kind: 'RESERVED',
      campaignId: 'campaign-1',
      executionId: 'execution-1',
      reservedAt,
      leaseExpiresAt,
    });
    expect(subject.campaigns.reserveAttempt).toHaveBeenCalledWith({
      campaignId: 'campaign-1',
      executionId: 'execution-1',
      reservedAt,
      leaseExpiresAt,
    });
  });

  it('delegates a liberacao da reserva pelo contrato tipado do candidate flow', async () => {
    const subject = createSubject();
    await expect(
      subject.service.releaseAttempt({
        campaignId: 'campaign-1',
        executionId: 'execution-1',
      }),
    ).resolves.toEqual({
      kind: 'RELEASED',
      campaignId: 'campaign-1',
      executionId: 'execution-1',
      released: true,
    });
    expect(subject.campaigns.releaseAttempt).toHaveBeenCalledWith({
      campaignId: 'campaign-1',
      executionId: 'execution-1',
    });
  });

  it('delegates a renovacao da reserva pelo contrato tipado do candidate flow', async () => {
    const subject = createSubject();
    const renewedAt = new Date('2026-08-08T12:05:00.000Z');
    const leaseExpiresAt = new Date('2026-08-08T12:07:00.000Z');

    await expect(
      subject.service.renewAttempt({
        campaignId: 'campaign-1',
        executionId: 'execution-1',
        renewedAt,
        leaseExpiresAt,
      }),
    ).resolves.toEqual({
      kind: 'RENEWED',
      campaignId: 'campaign-1',
      executionId: 'execution-1',
      leaseExpiresAt,
      renewed: true,
    });
    expect(subject.campaigns.renewAttempt).toHaveBeenCalledWith({
      campaignId: 'campaign-1',
      executionId: 'execution-1',
      renewedAt,
      leaseExpiresAt,
    });
  });

  it('nao reserva alvo ainda em backoff', async () => {
    const subject = createSubject({
      campaign: {
        nextEligibleAt: new Date('2026-08-08T12:01:00.000Z'),
      },
    });

    await expect(
      subject.service.reserveAttempt(subject.target, {
        executionId: 'execution-1',
        reservedAt: NOW,
        leaseExpiresAt: new Date('2026-08-08T12:10:00.000Z'),
      }),
    ).resolves.toEqual({ kind: 'INELIGIBLE', campaignId: 'campaign-1' });
    expect(subject.campaigns.reserveAttempt).not.toHaveBeenCalled();
  });

  it('preserva rankPosition entre QUEUED e COPY_READY sem priorizar status', async () => {
    const subject = createSubject({
      candidate: { status: 'QUEUED', generatedCopyId: null, rankPosition: 1 },
    });
    subject.candidates.listQueue.mockResolvedValue({
      items: [
        queueItem({
          id: 'candidate-ready-rank-2',
          productId: 'product-ready-rank-2',
          snapshotId: 'snapshot-ready-rank-2',
          generatedCopyId: 'copy-ready-rank-2',
          status: 'COPY_READY',
          rankPosition: 2,
        }),
        queueItem({
          id: 'candidate-1',
          status: 'QUEUED',
          generatedCopyId: null,
          rankPosition: 1,
        }),
      ],
      total: 2,
    });

    await expect(subject.service.preflight(subject.target)).resolves.toMatchObject({
      outcome: 'READY',
      candidateId: 'candidate-1',
      candidateStatus: 'QUEUED',
    });
    expect(subject.copies.loadContext).toHaveBeenCalledWith('candidate-1');
    expect(subject.copies.loadContext).not.toHaveBeenCalledWith(
      'candidate-ready-rank-2',
    );
    expect(subject.copyGeneration.findCopy).not.toHaveBeenCalled();
  });

});
