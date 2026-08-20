import { describe, expect, it, vi } from 'vitest';

import type {
  CommercialLifecycleRecord,
  CommercialLifecycleRepository,
} from '../src/commercial-lifecycle-repository';
import { CommercialLifecycleService } from '../src/commercial-lifecycle-service';

const now = new Date('2026-08-20T15:00:00.000Z');

const baseRecord = (
  overrides: Partial<CommercialLifecycleRecord> = {},
): CommercialLifecycleRecord => ({
  lifecycleId: 'run-sent',
  createdAt: new Date('2026-08-20T14:00:00.000Z'),
  execution: {
    id: 'execution-sent',
    bullMqJobId: null,
    mode: 'SEND',
    status: 'QUEUED',
    externalStage: 'EXTERNAL_MAY_HAVE_STARTED',
    commercialRunId: 'run-sent',
    failureCode: null,
    leaseExpiresAt: new Date('2026-08-20T16:00:00.000Z'),
    startedAt: new Date('2026-08-20T13:59:00.000Z'),
    completedAt: new Date('2026-08-20T14:01:00.000Z'),
  },
  run: {
    id: 'run-sent',
    executionId: 'execution-sent',
    mode: 'CONFIRMED',
    status: 'COMPLETED',
    productId: 'product-1',
    productName: 'Produto real persistido',
    productPrice: '39.90',
    groupDestinationId: 'destination-1',
    groupName: 'Grupo autorizado',
    groupFingerprint: 'fingerprint-1',
    score: 88,
    candidateCount: 4,
    eligibleCount: 1,
    rejectedCount: 3,
    dispatchId: 'dispatch-1',
    jobId: 'job-1',
    confirmedAt: new Date('2026-08-20T14:00:30.000Z'),
    finalStatus: 'SENT',
    investigationRequired: false,
    failureCode: null,
    createdAt: new Date('2026-08-20T14:00:00.000Z'),
    completedAt: new Date('2026-08-20T14:01:00.000Z'),
  },
  candidate: {
    id: 'candidate-1',
    campaignId: 'campaign-1',
    campaignName: 'Casa e cozinha',
    productId: 'product-1',
    productName: 'Produto real persistido',
    providerProductId: 'provider-1',
    status: 'DISPATCHED',
    rankPosition: 1,
    score: 88,
    scorePolicyVersion: 'official-v2',
    createdAt: new Date('2026-08-20T13:50:00.000Z'),
    updatedAt: new Date('2026-08-20T14:01:00.000Z'),
  },
  copy: {
    id: 'copy-1',
    productId: 'product-1',
    snapshotId: 'snapshot-1',
    createdFromCandidateId: 'candidate-1',
    source: 'AI',
    createdAt: new Date('2026-08-20T13:55:00.000Z'),
  },
  copyAttempt: {
    id: 'attempt-1',
    status: 'SUCCEEDED',
    failureCode: null,
    requestMayHaveStarted: true,
    startedAt: new Date('2026-08-20T13:54:00.000Z'),
    completedAt: new Date('2026-08-20T13:55:00.000Z'),
  },
  dispatch: {
    id: 'dispatch-1',
    destinationId: 'destination-1',
    destinationName: 'Grupo autorizado',
    destinationFingerprint: 'fingerprint-1',
    status: 'SENT',
    attemptCount: 2,
    externalMessageId: 'external-message-1',
    errorMessage: null,
    sentAt: new Date('2026-08-20T14:01:00.000Z'),
    createdAt: new Date('2026-08-20T14:00:40.000Z'),
    updatedAt: new Date('2026-08-20T14:01:00.000Z'),
  },
  outbox: {
    id: 'outbox-1',
    dispatchId: 'dispatch-1',
    jobId: 'job-1',
    status: 'PUBLISHED',
    failureCode: null,
    createdAt: new Date('2026-08-20T14:00:35.000Z'),
    publishedAt: new Date('2026-08-20T14:00:40.000Z'),
  },
  reservation: {
    campaignId: 'campaign-1',
    campaignName: 'Casa e cozinha',
    attemptExecutionId: 'execution-sent',
    attemptReservedAt: new Date('2026-08-20T13:50:00.000Z'),
    attemptLeaseExpiresAt: new Date('2026-08-20T16:00:00.000Z'),
    state: 'ACTIVE',
  },
  recovery: null,
  ...overrides,
});

const createQueue = () => {
  const getJob = vi.fn().mockResolvedValue({
    attemptsMade: 2,
    processedOn: new Date('2026-08-20T14:00:45.000Z').getTime(),
    finishedOn: new Date('2026-08-20T14:01:00.000Z').getTime(),
    getState: vi.fn().mockResolvedValue('completed'),
  });
  const getJobCounts = vi
    .fn()
    .mockResolvedValue({ waiting: 1, active: 0, failed: 2 });
  return { getJob, getJobCounts };
};

describe('CommercialLifecycleService', () => {
  it('calcula SENT hoje pelo dia civil de America/Sao_Paulo', async () => {
    const repository: CommercialLifecycleRepository = {
      list: vi.fn().mockResolvedValue({
        items: [],
        total: 0,
        summary: {
          activeExecutions: 0,
          sentToday: 0,
          failed: 0,
          ambiguous: 0,
          investigationRequired: 0,
          activeReservations: 0,
          pendingDispatches: 0,
          pendingOutboxes: 0,
          manualRecoveries: 0,
        },
      }),
    };
    const queues = createQueue();
    const serviceBeforeMidnight = new CommercialLifecycleService(
      repository,
      queues,
      () => new Date('2026-08-20T02:59:59.999Z'),
      'America/Sao_Paulo',
    );
    await serviceBeforeMidnight.list({ page: 1, limit: 20 });
    expect(repository.list).toHaveBeenLastCalledWith(
      expect.objectContaining({
        todayStart: new Date('2026-08-19T03:00:00.000Z'),
      }),
    );

    const serviceAtMidnight = new CommercialLifecycleService(
      repository,
      queues,
      () => new Date('2026-08-20T03:00:00.000Z'),
      'America/Sao_Paulo',
    );
    await serviceAtMidnight.list({ page: 1, limit: 20 });
    expect(repository.list).toHaveBeenLastCalledWith(
      expect.objectContaining({
        todayStart: new Date('2026-08-20T03:00:00.000Z'),
      }),
    );
  });

  it('nao cria evento quando a reservation tem estado desconhecido', async () => {
    const repository: CommercialLifecycleRepository = {
      list: vi.fn().mockResolvedValue({
        items: [
          baseRecord({
            reservation: {
              campaignId: 'campaign-1',
              campaignName: 'Casa e cozinha',
              attemptExecutionId: null,
              attemptReservedAt: null,
              attemptLeaseExpiresAt: null,
              state: 'UNKNOWN',
            },
          }),
        ],
        total: 1,
        summary: {
          activeExecutions: 0,
          sentToday: 0,
          failed: 0,
          ambiguous: 0,
          investigationRequired: 0,
          activeReservations: 0,
          pendingDispatches: 0,
          pendingOutboxes: 0,
          manualRecoveries: 0,
        },
      }),
    };
    const service = new CommercialLifecycleService(
      repository,
      createQueue(),
      () => now,
    );

    const response = await service.list({ page: 1, limit: 20 });

    expect(response.items[0]?.reservation?.state).toBe('UNKNOWN');
    expect(response.items[0]?.timeline).not.toContainEqual(
      expect.objectContaining({ type: 'RESERVATION_RECORDED' }),
    );
  });

  it('serializa o lifecycle SENT completo e resolve o job da fila', async () => {
    const repository: CommercialLifecycleRepository = {
      list: vi.fn().mockResolvedValue({
        items: [baseRecord()],
        total: 1,
        summary: {
          activeExecutions: 1,
          sentToday: 1,
          failed: 0,
          ambiguous: 0,
          investigationRequired: 0,
          activeReservations: 1,
          pendingDispatches: 0,
          pendingOutboxes: 0,
          manualRecoveries: 0,
        },
      }),
    };
    const queues = createQueue();
    const service = new CommercialLifecycleService(
      repository,
      queues,
      () => now,
    );

    const response = await service.list({ page: 1, limit: 20 });
    const item = response.items[0]!;

    expect(item.dispatch).toMatchObject({ status: 'SENT', attemptCount: 2 });
    expect(item.outbox).toMatchObject({ status: 'PUBLISHED', jobId: 'job-1' });
    expect(item.bullmq).toMatchObject({
      queue: 'whatsapp-dispatch',
      state: 'completed',
      attemptsMade: 2,
    });
    expect(item.reservation?.attemptExecutionId).toBe('execution-sent');
    expect(item.timeline.map((event) => event.type)).toContain('FINALIZED');
    expect(queues.getJob).toHaveBeenCalledWith('whatsapp-dispatch', 'job-1');
    expect(response.summary.jobs).toEqual({ waiting: 1, active: 0, failed: 2 });
  });

  it('preserva falha, ambiguidade, recovery e dados ausentes sem inventar vinculos', async () => {
    const ambiguous = baseRecord({
      lifecycleId: 'run-ambiguous',
      execution: null,
      run: {
        ...baseRecord().run!,
        id: 'run-ambiguous',
        executionId: null,
        finalStatus: 'AMBIGUOUS',
        investigationRequired: true,
        dispatchId: null,
        jobId: null,
      },
      candidate: null,
      copy: null,
      copyAttempt: null,
      dispatch: {
        ...baseRecord().dispatch!,
        id: 'dispatch-ambiguous',
        status: 'PROCESSING',
        attemptCount: 2,
        externalMessageId: null,
      },
      outbox: {
        ...baseRecord().outbox!,
        id: 'outbox-ambiguous',
        dispatchId: 'dispatch-ambiguous',
        status: 'AMBIGUOUS',
      },
      reservation: null,
      recovery: {
        id: 'recovery-1',
        dispatchId: 'dispatch-ambiguous',
        runId: 'run-ambiguous',
        executionId: 'execution-ambiguous',
        candidateId: 'candidate-ambiguous',
        campaignId: 'campaign-ambiguous',
        jobId: 'job-ambiguous',
        decision: 'CONFIRMED_NON_DELIVERY',
        attemptCountObserved: 2,
        authorizedAt: new Date('2026-08-20T14:05:00.000Z'),
        rearmedAt: null,
        requeuedAt: null,
      },
    });
    const repository: CommercialLifecycleRepository = {
      list: vi.fn().mockResolvedValue({
        items: [ambiguous],
        total: 1,
        summary: {
          activeExecutions: 0,
          sentToday: 0,
          failed: 1,
          ambiguous: 1,
          investigationRequired: 1,
          activeReservations: 0,
          pendingDispatches: 1,
          pendingOutboxes: 0,
          manualRecoveries: 1,
        },
      }),
    };
    const queues = createQueue();
    queues.getJob.mockResolvedValueOnce(null);
    const service = new CommercialLifecycleService(
      repository,
      queues,
      () => now,
    );

    const response = await service.list({ page: 1, limit: 20 });
    const item = response.items[0]!;

    expect(item.run?.investigationRequired).toBe(true);
    expect(item.dispatch?.status).toBe('PROCESSING');
    expect(item.recovery?.rearmedAt).toBeNull();
    expect(item.bullmq).toBeNull();
    expect(item.candidate).toBeNull();
    expect(item.reservation).toBeNull();
  });

  it('resolve execution sem run na fila comercial sem executar escrita', async () => {
    const executionOnly = baseRecord({
      lifecycleId: 'execution-only',
      run: null,
      execution: {
        ...baseRecord().execution!,
        id: 'execution-only',
        commercialRunId: null,
        bullMqJobId: 'automation-job-1',
      },
      candidate: null,
      copy: null,
      copyAttempt: null,
      dispatch: null,
      outbox: null,
      reservation: null,
    });
    const repository: CommercialLifecycleRepository = {
      list: vi.fn().mockResolvedValue({
        items: [executionOnly],
        total: 1,
        summary: {
          activeExecutions: 1,
          sentToday: 0,
          failed: 0,
          ambiguous: 0,
          investigationRequired: 0,
          activeReservations: 0,
          pendingDispatches: 0,
          pendingOutboxes: 0,
          manualRecoveries: 0,
        },
      }),
    };
    const queues = createQueue();
    const service = new CommercialLifecycleService(
      repository,
      queues,
      () => now,
    );

    const response = await service.list({ page: 1, limit: 20 });

    expect(response.items[0]?.bullmq?.queue).toBe('commercial-automation');
    expect(queues.getJob).toHaveBeenCalledWith(
      'commercial-automation',
      'automation-job-1',
    );
  });
});
