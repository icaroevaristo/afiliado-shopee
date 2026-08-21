import { describe, expect, it, vi } from 'vitest';
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

const baseCopyAttempt = (overrides: Record<string, unknown> = {}) => ({
  id: 'attempt-1',
  status: 'SUCCEEDED',
  failureCode: null,
  requestMayHaveStarted: true,
  startedAt: new Date('2026-08-20T13:54:00.000Z'),
  completedAt: new Date('2026-08-20T13:55:00.000Z'),
  createdAt: new Date('2026-08-20T13:54:00.000Z'),
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
  runs?: Array<ReturnType<typeof baseRun>>;
  executions?: Array<ReturnType<typeof baseExecution>>;
  execution?: unknown | null;
  dispatch?: unknown | null;
  candidate?: unknown | null;
  copyAttempts?: Array<ReturnType<typeof baseCopyAttempt>>;
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
  const runFindMany = vi
    .fn()
    .mockImplementation((input: { take?: number } = {}) =>
      Promise.resolve(runs.slice(0, input.take ?? runs.length)),
    );
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
  const executions = options.executions ?? [];
  const executionFindMany = vi
    .fn()
    .mockImplementation(
      (
        input: {
          take?: number;
          where?: { id?: { notIn?: string[] } };
        } = {},
      ) => {
        const excludedIds = input.where?.id?.notIn ?? [];
        const matchingExecutions = executions.filter(
          (execution) => !excludedIds.includes(execution.id),
        );
        return Promise.resolve(
          matchingExecutions.slice(0, input.take ?? matchingExecutions.length),
        );
      },
    );
  const executionFindUnique = vi
    .fn()
    .mockResolvedValue(options.execution ?? baseExecution());
  const executionCount = vi
    .fn()
    .mockImplementation(
      (
        input: {
          where?: {
            completedAt?: null;
            id?: { notIn?: string[] };
          };
        } = {},
      ) => {
        if (input.where?.completedAt === null) {
          return Promise.resolve(options.activeExecutions ?? 0);
        }
        const excludedIds = input.where?.id?.notIn ?? [];
        return Promise.resolve(
          executions.filter((execution) => !excludedIds.includes(execution.id))
            .length,
        );
      },
    );
  const dispatchFindUnique = vi
    .fn()
    .mockResolvedValue(options.dispatch ?? baseDispatch());
  const candidateFindUnique = vi
    .fn()
    .mockResolvedValue(options.candidate ?? baseCandidate());
  const copyAttemptFindMany = vi
    .fn()
    .mockResolvedValue(options.copyAttempts ?? []);
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
    commercialCopyGenerationAttempt: { findMany: copyAttemptFindMany },
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
    prisma: prisma as never,
    spies: {
      executionCount,
      whatsAppDispatchCount,
      campaignFindMany,
      copyAttemptFindMany,
      runFindMany,
      executionFindMany,
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

  it('busca dados suficientes para paginas profundas sem cap silencioso', async () => {
    const runs = Array.from({ length: 250 }, (_, index) =>
      baseRun({
        id: `run-${String(index + 1).padStart(3, '0')}`,
        executionId: null,
        createdAt: new Date(
          Date.parse('2026-08-20T00:00:00.000Z') +
            (250 - index) * 60_000,
        ),
        dispatchId: null,
        jobId: null,
      }),
    );
    const { prisma } = createPrismaDouble({ runs, runTotal: 250 });
    const repository = new PrismaCommercialLifecycleRepository(prisma);

    const result = await repository.list(listInput({ page: 11, limit: 20 }));

    expect(result.total).toBe(250);
    expect(result.items).toHaveLength(20);
    expect(result.items[0]?.run?.id).toBe('run-201');
    expect(result.items.at(-1)?.run?.id).toBe('run-220');
  });

  it('mescla runs e executions sem run pela ordenacao global', async () => {
    const runs = [
      baseRun({
        id: 'run-late',
        executionId: null,
        createdAt: new Date('2026-08-20T14:03:00.000Z'),
        dispatchId: null,
        jobId: null,
      }),
      baseRun({
        id: 'run-early',
        executionId: null,
        createdAt: new Date('2026-08-20T14:01:00.000Z'),
        dispatchId: null,
        jobId: null,
      }),
    ];
    const executions = [
      baseExecution({
        id: 'execution-middle',
        commercialRunId: null,
        startedAt: new Date('2026-08-20T14:02:00.000Z'),
      }),
    ];
    const { prisma } = createPrismaDouble({
      runs,
      executions,
      campaigns: [],
      runTotal: 2,
    });
    const repository = new PrismaCommercialLifecycleRepository(prisma);

    const result = await repository.list(listInput({ page: 1, limit: 3 }));

    expect(result.total).toBe(3);
    expect(result.items.map((item) => item.lifecycleId)).toEqual([
      'run-late',
      'execution-middle',
      'run-early',
    ]);
  });

  it('prefere a raiz run quando a execution ainda nao recebeu commercialRunId', async () => {
    const runs = [
      baseRun({
        id: 'run-recent',
        executionId: null,
        createdAt: new Date('2026-08-20T14:04:00.000Z'),
        dispatchId: null,
        jobId: null,
      }),
      baseRun({
        id: 'run-linked-outside-take',
        executionId: 'execution-linked',
        createdAt: new Date('2026-08-20T14:01:00.000Z'),
        dispatchId: null,
        jobId: null,
      }),
    ];
    const executions = [
      baseExecution({
        id: 'execution-linked',
        commercialRunId: null,
        startedAt: new Date('2026-08-20T14:05:00.000Z'),
      }),
      baseExecution({
        id: 'execution-unlinked',
        commercialRunId: null,
        startedAt: new Date('2026-08-20T14:03:00.000Z'),
      }),
    ];
    const { prisma, spies } = createPrismaDouble({ runs, executions });
    const repository = new PrismaCommercialLifecycleRepository(prisma);

    const firstPage = await repository.list(listInput({ page: 1, limit: 1 }));
    const secondPage = await repository.list(listInput({ page: 2, limit: 1 }));

    expect(firstPage.total).toBe(3);
    expect(firstPage.items.map((item) => item.lifecycleId)).toEqual([
      'run-recent',
    ]);
    expect(secondPage.items.map((item) => item.lifecycleId)).toEqual([
      'execution-unlinked',
    ]);
    expect(spies.runFindMany).toHaveBeenCalledWith({
      where: { executionId: { not: null } },
      select: { executionId: true },
    });
    expect(spies.executionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          commercialRunId: null,
          id: { notIn: ['execution-linked'] },
        },
      }),
    );
  });

  it('usa somente a tentativa vinculada exatamente a GeneratedCopy', async () => {
    const { prisma, spies } = createPrismaDouble({
      copyAttempts: [baseCopyAttempt({ id: 'attempt-copy-1' })],
    });
    const repository = new PrismaCommercialLifecycleRepository(prisma);

    const result = await repository.list(listInput());

    expect(result.items[0]?.copyAttempt?.id).toBe('attempt-copy-1');
    expect(result.items[0]?.copyAttemptState).toBe('PRESENT');
    expect(spies.copyAttemptFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { generatedCopyId: 'copy-1' },
        take: 2,
      }),
    );
  });

  it('nao atribui tentativa posterior do candidato quando nao aponta para a copy', async () => {
    const { prisma, spies } = createPrismaDouble({ copyAttempts: [] });
    const repository = new PrismaCommercialLifecycleRepository(prisma);

    const result = await repository.list(listInput());

    expect(result.items[0]?.copyAttempt).toBeNull();
    expect(result.items[0]?.copyAttemptState).toBe('ABSENT');
    expect(spies.copyAttemptFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { generatedCopyId: 'copy-1' } }),
    );
  });

  it('marca como ausente quando o dispatch nao tem GeneratedCopy', async () => {
    const { prisma } = createPrismaDouble({
      dispatch: { ...baseDispatch(), generatedCopy: null },
    });
    const repository = new PrismaCommercialLifecycleRepository(prisma);

    const result = await repository.list(listInput());

    expect(result.items[0]?.copy).toBeNull();
    expect(result.items[0]?.copyAttempt).toBeNull();
    expect(result.items[0]?.copyAttemptState).toBe('ABSENT');
  });

  it('representa vinculos multiplos de tentativa como desconhecidos', async () => {
    const { prisma } = createPrismaDouble({
      copyAttempts: [
        baseCopyAttempt({ id: 'attempt-new' }),
        baseCopyAttempt({ id: 'attempt-old' }),
      ],
    });
    const repository = new PrismaCommercialLifecycleRepository(prisma);

    const result = await repository.list(listInput());

    expect(result.items[0]?.copyAttempt).toBeNull();
    expect(result.items[0]?.copyAttemptState).toBe('UNKNOWN');
  });

  it('desempata timestamp por tipo e id de modo repetivel entre paginas', async () => {
    const timestamp = new Date('2026-08-20T14:00:00.000Z');
    const { prisma, spies } = createPrismaDouble({
      runs: [
        baseRun({ id: 'run-a', createdAt: timestamp, executionId: null }),
        baseRun({ id: 'run-b', createdAt: timestamp, executionId: null }),
      ],
      executions: [
        baseExecution({
          id: 'execution-z',
          commercialRunId: null,
          startedAt: timestamp,
        }),
      ],
      runTotal: 2,
    });
    const repository = new PrismaCommercialLifecycleRepository(prisma);

    const firstPage = await repository.list(listInput({ page: 1, limit: 2 }));
    const secondPage = await repository.list(listInput({ page: 2, limit: 2 }));

    expect(firstPage.items.map((item) => item.lifecycleId)).toEqual([
      'run-b',
      'run-a',
    ]);
    expect(secondPage.items.map((item) => item.lifecycleId)).toEqual([
      'execution-z',
    ]);
    expect(spies.runFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
    expect(spies.executionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      }),
    );
  });

  it('retorna pagina parcial e pagina vazia alem do total', async () => {
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

    const partial = await repository.list(listInput({ page: 2, limit: 2 }));
    const beyondTotal = await repository.list(
      listInput({ page: 3, limit: 2 }),
    );

    expect(partial.total).toBe(3);
    expect(partial.items).toHaveLength(1);
    expect(partial.items[0]?.run?.id).toBe('run-1');
    expect(beyondTotal.total).toBe(3);
    expect(beyondTotal.items).toEqual([]);
  });
});
