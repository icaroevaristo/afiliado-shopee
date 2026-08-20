import { describe, expect, it, vi } from 'vitest';
import type { DatabaseClient } from '@shopee-auto-affiliate-ai/database';

import { getLocalDayRange } from '../src/commercial-automation-policy-service';
import { PrismaCommercialLifecycleRepository } from '../src/prisma-commercial-lifecycle-repository';

const now = new Date('2026-08-20T15:00:00.000Z');

const baseRun = (overrides: Record<string, unknown> = {}) => ({
  id: 'run-1',
  executionId: 'execution-1',
  mode: 'CONFIRMED',
  status: 'COMPLETED',
  productId: 'product-1',
  productName: 'Produto Lifecycle',
  productPrice: null,
  groupDestinationId: 'destination-1',
  groupName: 'Grupo Lifecycle',
  groupFingerprint: 'fingerprint-1',
  score: 88,
  candidateCount: 1,
  eligibleCount: 1,
  rejectedCount: 0,
  dispatchId: 'dispatch-1',
  jobId: 'job-1',
  confirmedAt: new Date('2026-08-20T14:00:30.000Z'),
  finalStatus: 'SENT',
  investigationRequired: false,
  failureCode: null,
  createdAt: new Date('2026-08-20T14:00:00.000Z'),
  completedAt: new Date('2026-08-20T14:01:00.000Z'),
  ...overrides,
});

const baseExecution = (overrides: Record<string, unknown> = {}) => ({
  id: 'execution-1',
  bullMqJobId: null,
  mode: 'SEND',
  status: 'QUEUED',
  externalStage: 'EXTERNAL_MAY_HAVE_STARTED',
  commercialRunId: 'run-1',
  failureCode: null,
  leaseExpiresAt: new Date('2026-08-20T16:00:00.000Z'),
  startedAt: new Date('2026-08-20T13:59:00.000Z'),
  completedAt: new Date('2026-08-20T14:01:00.000Z'),
  ...overrides,
});

const baseDispatch = (overrides: Record<string, unknown> = {}) => ({
  id: 'dispatch-1',
  destinationId: 'destination-1',
  status: 'SENT',
  attemptCount: 2,
  externalMessageId: 'external-message-1',
  errorMessage: null,
  sentAt: new Date('2026-08-20T14:01:00.000Z'),
  createdAt: new Date('2026-08-20T14:00:40.000Z'),
  updatedAt: new Date('2026-08-20T14:01:00.000Z'),
  destination: { name: 'Grupo Lifecycle', fingerprint: 'fingerprint-1' },
  generatedCopy: {
    id: 'copy-1',
    productId: 'product-1',
    snapshotId: 'snapshot-1',
    createdFromCandidateId: 'candidate-1',
    source: 'AI',
    createdAt: new Date('2026-08-20T13:55:00.000Z'),
  },
  ...overrides,
});

const baseCandidate = (overrides: Record<string, unknown> = {}) => ({
  id: 'candidate-1',
  campaignId: 'campaign-1',
  productId: 'product-1',
  status: 'DISPATCHED',
  rankPosition: 1,
  commercialScore: 88,
  scorePolicyVersion: 'official-v2',
  createdAt: new Date('2026-08-20T13:50:00.000Z'),
  updatedAt: new Date('2026-08-20T14:01:00.000Z'),
  campaign: { name: 'Campanha Lifecycle' },
  product: { nome: 'Produto Lifecycle', providerProductId: 'provider-1' },
  ...overrides,
});

const baseOutbox = (overrides: Record<string, unknown> = {}) => ({
  id: 'outbox-1',
  dispatchId: 'dispatch-1',
  jobId: 'job-1',
  status: 'PUBLISHED',
  failureCode: null,
  createdAt: new Date('2026-08-20T14:00:35.000Z'),
  publishedAt: new Date('2026-08-20T14:00:40.000Z'),
  ...overrides,
});

const baseRecovery = (overrides: Record<string, unknown> = {}) => ({
  id: 'recovery-1',
  dispatchId: 'dispatch-1',
  runId: 'run-1',
  executionId: 'execution-1',
  candidateId: 'candidate-1',
  campaignId: 'campaign-1',
  jobId: 'job-1',
  decision: 'CONFIRMED_NON_DELIVERY',
  attemptCountObserved: 2,
  authorizedAt: new Date('2026-08-20T14:05:00.000Z'),
  rearmedAt: null,
  requeuedAt: null,
  ...overrides,
});

const baseCampaign = (overrides: Record<string, unknown> = {}) => ({
  id: 'campaign-1',
  name: 'Campanha Lifecycle',
  attemptExecutionId: 'execution-1',
  attemptReservedAt: new Date('2026-08-20T13:50:00.000Z'),
  attemptLeaseExpiresAt: new Date('2026-08-20T16:00:00.000Z'),
  ...overrides,
});

type DoubleOptions = {
  runs?: unknown[];
  executions?: unknown[];
  execution?: unknown | null;
  dispatch?: unknown | null;
  candidate?: unknown | null;
  copyAttempt?: unknown | null;
  outbox?: unknown | null;
  recovery?: unknown | null;
  campaigns?: unknown[];
  runTotal?: number;
  activeExecutions?: number;
  sentToday?: number;
  failed?: number;
  ambiguous?: number;
  investigationRequired?: number;
  activeReservations?: number;
  pendingDispatches?: number;
  pendingOutboxes?: number;
  manualRecoveries?: number;
};

const createPrismaDouble = (options: DoubleOptions = {}) => {
  const runs = options.runs ?? [baseRun()];
  const runFindMany = vi.fn().mockResolvedValue(runs);
  const runCount = vi
    .fn()
    .mockImplementation((input: { where?: Record<string, unknown> } = {}) => {
      if (input.where?.finalStatus === 'FAILED') {
        return Promise.resolve(options.failed ?? 0);
      }
      if (input.where?.finalStatus === 'AMBIGUOUS') {
        return Promise.resolve(options.ambiguous ?? 0);
      }
      if (input.where?.investigationRequired === true) {
        return Promise.resolve(options.investigationRequired ?? 0);
      }
      return Promise.resolve(options.runTotal ?? runs.length);
    });
  const executionFindMany = vi.fn().mockResolvedValue(options.executions ?? []);
  const executionFindUnique = vi
    .fn()
    .mockResolvedValue(options.execution ?? baseExecution());
  const executionCount = vi
    .fn()
    .mockImplementation((input: { where?: Record<string, unknown> } = {}) =>
      input.where?.completedAt === null
        ? Promise.resolve(options.activeExecutions ?? 0)
        : Promise.resolve(options.executions?.length ?? 0),
    );
  const dispatchFindUnique = vi
    .fn()
    .mockResolvedValue(options.dispatch ?? baseDispatch());
  const candidateFindUnique = vi
    .fn()
    .mockResolvedValue(options.candidate ?? baseCandidate());
  const copyAttemptFindFirst = vi
    .fn()
    .mockResolvedValue(options.copyAttempt ?? null);
  const outboxFindUnique = vi
    .fn()
    .mockResolvedValue(options.outbox ?? baseOutbox());
  const recoveryFindUnique = vi
    .fn()
    .mockResolvedValue(options.recovery ?? null);
  const campaignFindMany = vi
    .fn()
    .mockResolvedValue(options.campaigns ?? [baseCampaign()]);
  const whatsAppDispatchCount = vi
    .fn()
    .mockResolvedValue(options.sentToday ?? 0);
  const groupCampaignCount = vi
    .fn()
    .mockResolvedValue(options.activeReservations ?? 0);
  const outboxCount = vi.fn().mockResolvedValue(options.pendingOutboxes ?? 0);
  const recoveryCount = vi
    .fn()
    .mockResolvedValue(options.manualRecoveries ?? 0);

  const prisma = {
    commercialPipelineRun: { findMany: runFindMany, count: runCount },
    commercialAutomationExecution: {
      findMany: executionFindMany,
      findUnique: executionFindUnique,
      count: executionCount,
    },
    commercialPromotionCandidate: { findUnique: candidateFindUnique },
    commercialCopyGenerationAttempt: { findFirst: copyAttemptFindFirst },
    whatsAppDispatch: {
      findUnique: dispatchFindUnique,
      count: whatsAppDispatchCount,
    },
    commercialDispatchOutbox: {
      findUnique: outboxFindUnique,
      count: outboxCount,
    },
    commercialGroupCampaign: {
      findMany: campaignFindMany,
      count: groupCampaignCount,
    },
    whatsAppDispatchManualRecovery: {
      findUnique: recoveryFindUnique,
      count: recoveryCount,
    },
  };

  return {
    prisma: prisma as unknown as DatabaseClient,
    spies: {
      executionCount,
      whatsAppDispatchCount,
      campaignFindMany,
    },
  };
};

const listInput = (overrides: Record<string, unknown> = {}) => ({
  page: 1,
  limit: 20,
  now,
  todayStart: new Date('2026-08-20T03:00:00.000Z'),
  ...overrides,
});

describe('PrismaCommercialLifecycleRepository', () => {
  it('carrega run, execution, dispatch, outbox e recovery pelo vínculo persistido', async () => {
    const { prisma } = createPrismaDouble({
      recovery: baseRecovery(),
      activeReservations: 1,
      sentToday: 1,
    });
    const repository = new PrismaCommercialLifecycleRepository(prisma);

    const result = await repository.list(listInput());
    const item = result.items[0]!;

    expect(item.run?.id).toBe('run-1');
    expect(item.execution?.id).toBe('execution-1');
    expect(item.dispatch?.id).toBe('dispatch-1');
    expect(item.outbox).toMatchObject({
      dispatchId: 'dispatch-1',
      jobId: 'job-1',
    });
    expect(item.recovery).toMatchObject({ dispatchId: 'dispatch-1' });
  });

  it('mantem a reservation quando o owner e a execution do lifecycle', async () => {
    const { prisma } = createPrismaDouble();
    const repository = new PrismaCommercialLifecycleRepository(prisma);

    const result = await repository.list(listInput());

    expect(result.items[0]?.reservation).toMatchObject({
      attemptExecutionId: 'execution-1',
      attemptReservedAt: new Date('2026-08-20T13:50:00.000Z'),
      state: 'ACTIVE',
    });
  });

  it('oculta reservation de outra execution e nao copia timestamps estrangeiros', async () => {
    const { prisma } = createPrismaDouble({
      campaigns: [
        baseCampaign({
          attemptExecutionId: 'execution-2',
          attemptReservedAt: new Date('2026-08-20T14:50:00.000Z'),
          attemptLeaseExpiresAt: new Date('2026-08-20T18:00:00.000Z'),
        }),
      ],
    });
    const repository = new PrismaCommercialLifecycleRepository(prisma);

    const result = await repository.list(listInput());
    const reservation = result.items[0]?.reservation;

    expect(reservation).toMatchObject({
      state: 'UNKNOWN',
      attemptExecutionId: null,
      attemptReservedAt: null,
      attemptLeaseExpiresAt: null,
    });
  });

  it('representa reservation liberada como ausente sem inventar historico', async () => {
    const { prisma } = createPrismaDouble({
      campaigns: [
        baseCampaign({
          attemptExecutionId: null,
          attemptReservedAt: null,
          attemptLeaseExpiresAt: null,
        }),
      ],
    });
    const repository = new PrismaCommercialLifecycleRepository(prisma);

    const result = await repository.list(listInput());

    expect(result.items[0]?.reservation).toMatchObject({
      state: 'ABSENT',
      attemptReservedAt: null,
      attemptLeaseExpiresAt: null,
    });
  });

  it('exclui executions completadas da contagem de ativas', async () => {
    const { prisma, spies } = createPrismaDouble({
      executions: [baseExecution({ completedAt: now })],
      activeExecutions: 0,
    });
    const repository = new PrismaCommercialLifecycleRepository(prisma);

    const result = await repository.list(listInput());

    expect(result.summary.activeExecutions).toBe(0);
    expect(spies.executionCount).toHaveBeenCalledWith({
      where: {
        status: 'STARTED',
        activeKey: { not: null },
        ownerId: { not: null },
        heartbeatAt: { not: null },
        leaseExpiresAt: { gt: now },
        completedAt: null,
      },
    });
  });

  it('conta somente execution STARTED com ownership e lease validos', async () => {
    const { prisma } = createPrismaDouble({ activeExecutions: 1 });
    const repository = new PrismaCommercialLifecycleRepository(prisma);

    const result = await repository.list(listInput());

    expect(result.summary.activeExecutions).toBe(1);
  });

  it('usa o inicio do dia local recebido para SENT hoje', async () => {
    const { prisma, spies } = createPrismaDouble({ sentToday: 1 });
    const repository = new PrismaCommercialLifecycleRepository(prisma);
    const dayStart = getLocalDayRange(
      new Date('2026-08-20T02:59:59.999Z'),
      'America/Sao_Paulo',
    ).dayStartsAt;

    const result = await repository.list(listInput({ todayStart: dayStart }));

    expect(result.summary.sentToday).toBe(1);
    expect(spies.whatsAppDispatchCount).toHaveBeenCalledWith({
      where: { status: 'SENT', sentAt: { gte: dayStart } },
    });
  });

  it('preserva a paginacao sobre a uniao de runs recentes', async () => {
    const runs = [
      baseRun({
        id: 'run-3',
        executionId: null,
        createdAt: new Date('2026-08-20T14:03:00.000Z'),
        dispatchId: null,
        jobId: null,
      }),
      baseRun({
        id: 'run-2',
        executionId: null,
        createdAt: new Date('2026-08-20T14:02:00.000Z'),
        dispatchId: null,
        jobId: null,
      }),
      baseRun({
        id: 'run-1',
        executionId: null,
        createdAt: new Date('2026-08-20T14:01:00.000Z'),
        dispatchId: null,
        jobId: null,
      }),
    ];
    const { prisma } = createPrismaDouble({ runs, runTotal: 3 });
    const repository = new PrismaCommercialLifecycleRepository(prisma);

    const result = await repository.list(listInput({ page: 2, limit: 2 }));

    expect(result.total).toBe(3);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.run?.id).toBe('run-1');
  });
});
