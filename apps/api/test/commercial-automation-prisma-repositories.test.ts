import { describe, expect, it, vi } from 'vitest';

import {
  PrismaCommercialAutomationExecutionRepository,
  PrismaCommercialAutomationHistoryRepository,
  PrismaCommercialAutomationSettingsRepository,
} from '../src/prisma-repositories';

describe('commercial automation Prisma repositories', () => {
  it('inicializa o singleton pausado e persiste pausa/retomada', async () => {
    const upsert = vi
      .fn()
      .mockResolvedValueOnce({
        paused: true,
        pausedAt: new Date('2026-07-25T15:00:00.000Z'),
        resumedAt: null,
        updatedAt: new Date('2026-07-25T15:00:00.000Z'),
      })
      .mockResolvedValueOnce({
        paused: true,
        pausedAt: new Date('2026-07-25T15:00:00.000Z'),
        resumedAt: null,
        updatedAt: new Date('2026-07-25T15:00:00.000Z'),
      });
    const update = vi.fn().mockResolvedValueOnce({
      paused: false,
      pausedAt: new Date('2026-07-25T15:00:00.000Z'),
      resumedAt: new Date('2026-07-25T16:00:00.000Z'),
      updatedAt: new Date('2026-07-25T16:00:00.000Z'),
    });
    const repository = new PrismaCommercialAutomationSettingsRepository({
      commercialAutomationSettings: { upsert, update },
    } as never);

    await repository.getOrCreate(new Date('2026-07-25T15:00:00.000Z'));
    await repository.setPaused(false, new Date('2026-07-25T16:00:00.000Z'));

    expect(upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { id: 'commercial-automation' },
        create: expect.objectContaining({ paused: true }),
      }),
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ paused: false }),
      }),
    );
  });

  it('preserva os timestamps quando a pausa solicitada ja esta vigente', async () => {
    const current = {
      paused: true,
      pausedAt: new Date('2026-07-25T15:00:00.000Z'),
      resumedAt: null,
      updatedAt: new Date('2026-07-25T15:00:00.000Z'),
    };
    const update = vi.fn();
    const repository = new PrismaCommercialAutomationSettingsRepository({
      commercialAutomationSettings: {
        upsert: vi.fn().mockResolvedValue(current),
        update,
      },
    } as never);

    await expect(
      repository.setPaused(true, new Date('2026-07-25T16:00:00.000Z')),
    ).resolves.toBe(current);
    expect(update).not.toHaveBeenCalled();
  });

  it('conta somente dispatches SENT de grupos no dia e no grupo correto', async () => {
    const groupBy = vi.fn().mockResolvedValue([
      { destinationId: 'group-1', _count: { _all: 1 } },
      { destinationId: 'group-2', _count: { _all: 1 } },
    ]);
    const dispatchFindFirst = vi.fn().mockResolvedValue({
      sentAt: new Date('2026-07-25T14:30:00.000Z'),
    });
    const runFindFirst = vi.fn().mockResolvedValue(null);
    const repository = new PrismaCommercialAutomationHistoryRepository({
      whatsAppDispatch: { groupBy, findFirst: dispatchFindFirst },
      commercialPipelineRun: { findFirst: runFindFirst },
    } as never);

    const result = await repository.getSnapshot({
      groupId: 'group-1',
      dayStartsAt: new Date('2026-07-25T03:00:00.000Z'),
      dayEndsAt: new Date('2026-07-26T03:00:00.000Z'),
    });

    expect(result).toEqual({
      globalSentToday: 2,
      groupSentToday: 1,
      lastSentAt: new Date('2026-07-25T14:30:00.000Z'),
      globalLastSentAt: new Date('2026-07-25T14:30:00.000Z'),
      groupLastSentAt: new Date('2026-07-25T14:30:00.000Z'),
    });
    expect(groupBy).toHaveBeenCalledWith({
      by: ['destinationId'],
      where: {
        status: 'SENT',
        sentAt: {
          gte: new Date('2026-07-25T03:00:00.000Z'),
          lt: new Date('2026-07-26T03:00:00.000Z'),
        },
        destination: { type: 'GROUP' },
      },
      _count: { _all: true },
    });
    expect(dispatchFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'SENT',
          destination: { type: 'GROUP' },
        }),
      }),
    );
    expect(dispatchFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          destinationId: 'group-1',
          sentAt: { not: null },
        }),
      }),
    );
  });

  it('ignora dry-run e FAILED na contagem por consultar somente dispatch SENT', async () => {
    const groupBy = vi.fn().mockResolvedValue([]);
    const repository = new PrismaCommercialAutomationHistoryRepository({
      whatsAppDispatch: {
        groupBy,
        findFirst: vi.fn().mockResolvedValue(null),
      },
      commercialPipelineRun: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    } as never);

    const result = await repository.getSnapshot({
      dayStartsAt: new Date('2026-07-25T03:00:00.000Z'),
      dayEndsAt: new Date('2026-07-26T03:00:00.000Z'),
    });

    expect(result.globalSentToday).toBe(0);
    expect(result.groupSentToday).toBe(0);
    expect(groupBy).toHaveBeenCalledOnce();
    expect(groupBy.mock.calls[0]?.[0]).toMatchObject({
      where: { status: 'SENT' },
    });
  });

  it('detecta finalStatus ambiguo ou investigacao pendente', async () => {
    const runFindFirst = vi.fn().mockResolvedValue({ id: 'run-ambiguous' });
    const executionFindFirst = vi.fn().mockResolvedValue(null);
    const repository = new PrismaCommercialAutomationHistoryRepository({
      whatsAppDispatch: {},
      commercialPipelineRun: { findFirst: runFindFirst },
      commercialAutomationExecution: { findFirst: executionFindFirst },
    } as never);

    await expect(repository.hasAmbiguousCommercialExecution()).resolves.toBe(
      true,
    );
    expect(runFindFirst).toHaveBeenCalledWith({
      where: {
        OR: [{ finalStatus: 'AMBIGUOUS' }, { investigationRequired: true }],
      },
      select: { id: true },
    });
    expect(executionFindFirst).toHaveBeenCalledWith({
      where: { status: 'AMBIGUOUS' },
      select: { id: true },
    });
  });

  it('detecta run confirmado ativo, final pendente ou dispatch comercial em processamento', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 'run-active' });
    const executionFindFirst = vi.fn().mockResolvedValue(null);
    const repository = new PrismaCommercialAutomationHistoryRepository({
      whatsAppDispatch: {},
      commercialPipelineRun: { findFirst },
      commercialAutomationExecution: { findFirst: executionFindFirst },
    } as never);

    await expect(
      repository.hasActiveCommercialExecution(
        new Date('2026-07-26T15:00:00.000Z'),
      ),
    ).resolves.toBe(true);
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        OR: [
          { mode: 'CONFIRMED', status: 'STARTED' },
          { finalStatus: 'PENDING' },
          { dispatch: { status: { in: ['PENDING', 'PROCESSING'] } } },
        ],
      },
      select: { id: true },
    });
  });

  it('separa STARTED stale de uma lease ativa', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 'execution-stale' });
    const repository = new PrismaCommercialAutomationHistoryRepository({
      commercialAutomationExecution: { findFirst },
    } as never);
    const now = new Date('2026-07-26T15:00:00.000Z');

    await expect(repository.hasStaleCommercialExecution(now)).resolves.toBe(
      true,
    );
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        status: 'STARTED',
        OR: [
          { activeKey: null },
          { ownerId: null },
          { heartbeatAt: null },
          { leaseExpiresAt: null },
          { leaseExpiresAt: { lte: now } },
        ],
      },
      select: { id: true },
    });
  });

  it('usa bullMqJobId como identidade idempotente da execucao', async () => {
    const existing = {
      id: 'execution-1',
      schedulerJobId: 'scheduled-commercial-automation',
      bullMqJobId: 'job-1',
      activeKey: null,
      ownerId: 'owner-1',
      heartbeatAt: new Date('2026-07-26T15:00:00.000Z'),
      leaseExpiresAt: new Date('2026-07-26T15:02:00.000Z'),
      mode: 'PREVIEW',
      status: 'PREVIEW_READY',
      reasons: [],
      commercialRunId: 'run-1',
      failureCode: null,
      startedAt: new Date('2026-07-26T15:00:00.000Z'),
      completedAt: new Date('2026-07-26T15:00:01.000Z'),
    };
    const findUnique = vi.fn().mockResolvedValue(existing);
    const create = vi.fn().mockRejectedValue({ code: 'P2002' });
    const repository = new PrismaCommercialAutomationExecutionRepository({
      commercialAutomationExecution: { findUnique, create },
    } as never);

    await expect(
      repository.start({
        schedulerJobId: 'scheduled-commercial-automation',
        bullMqJobId: 'job-1',
        mode: 'PREVIEW',
        startedAt: new Date('2026-07-26T15:00:00.000Z'),
        ownerId: 'owner-1',
        heartbeatAt: new Date('2026-07-26T15:00:00.000Z'),
        leaseExpiresAt: new Date('2026-07-26T15:02:00.000Z'),
      }),
    ).resolves.toMatchObject({
      outcome: 'existing',
      execution: {
        id: 'execution-1',
        bullMqJobId: 'job-1',
        status: 'PREVIEW_READY',
      },
    });
    expect(create).toHaveBeenCalledOnce();
  });

  it('cria STARTED com owner, heartbeat e lease na mesma operacao', async () => {
    const record = {
      id: 'execution-1',
      schedulerJobId: 'scheduled-commercial-automation',
      bullMqJobId: 'job-1',
      activeKey: 'commercial-automation',
      ownerId: 'owner-1',
      heartbeatAt: new Date('2026-07-26T15:00:00.000Z'),
      leaseExpiresAt: new Date('2026-07-26T15:02:00.000Z'),
      mode: 'PREVIEW',
      status: 'STARTED',
      externalStage: 'NOT_REACHED',
      reasons: [],
      commercialRunId: null,
      failureCode: null,
      startedAt: new Date('2026-07-26T15:00:00.000Z'),
      completedAt: null,
    };
    const create = vi.fn().mockResolvedValue(record);
    const repository = new PrismaCommercialAutomationExecutionRepository({
      commercialAutomationExecution: { create },
    } as never);

    await expect(
      repository.start({
        schedulerJobId: record.schedulerJobId,
        bullMqJobId: record.bullMqJobId,
        mode: 'PREVIEW',
        startedAt: record.startedAt,
        ownerId: record.ownerId,
        heartbeatAt: record.heartbeatAt,
        leaseExpiresAt: record.leaseExpiresAt,
      }),
    ).resolves.toMatchObject({
      outcome: 'created',
      ownership: { executionId: record.id, ownerId: record.ownerId },
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: 'STARTED',
        externalStage: 'NOT_REACHED',
        activeKey: 'commercial-automation',
        ownerId: record.ownerId,
        heartbeatAt: record.heartbeatAt,
        leaseExpiresAt: record.leaseExpiresAt,
      }),
    });
  });

  it('heartbeat e finish usam compare-and-set de ownership e lease', async () => {
    const now = new Date('2026-07-26T15:00:30.000Z');
    const record = {
      id: 'execution-1',
      schedulerJobId: 'scheduler',
      bullMqJobId: 'job-1',
      activeKey: 'commercial-automation',
      ownerId: 'owner-1',
      heartbeatAt: now,
      leaseExpiresAt: new Date('2026-07-26T15:02:30.000Z'),
      mode: 'PREVIEW',
      status: 'STARTED',
      externalStage: 'NOT_REACHED',
      reasons: [],
      commercialRunId: null,
      failureCode: null,
      startedAt: now,
      completedAt: null,
    };
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findUnique = vi.fn().mockResolvedValue(record);
    const repository = new PrismaCommercialAutomationExecutionRepository({
      commercialAutomationExecution: { updateMany, findUnique },
    } as never);
    const ownership = { executionId: record.id, ownerId: record.ownerId };

    await repository.heartbeat(ownership, {
      heartbeatAt: now,
      leaseExpiresAt: record.leaseExpiresAt,
    });
    await repository.finish(ownership, {
      status: 'PREVIEW_READY',
      completedAt: now,
    });

    expect(updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          id: record.id,
          ownerId: record.ownerId,
          status: 'STARTED',
          leaseExpiresAt: { gt: now },
        }),
      }),
    );
    expect(updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          activeKey: null,
          status: 'PREVIEW_READY',
        }),
      }),
    );
  });


  it('marca a fronteira externa de forma idempotente e monotona sob concorrencia', async () => {
    const markedAt = new Date('2026-07-26T15:00:30.000Z');
    const record = {
      id: 'execution-1',
      schedulerJobId: 'scheduler',
      bullMqJobId: 'job-1',
      activeKey: 'commercial-automation',
      ownerId: 'owner-1',
      heartbeatAt: markedAt,
      leaseExpiresAt: new Date('2026-07-26T15:02:30.000Z'),
      mode: 'SEND',
      status: 'STARTED',
      externalStage: 'EXTERNAL_MAY_HAVE_STARTED',
      reasons: [],
      commercialRunId: null,
      failureCode: null,
      startedAt: markedAt,
      completedAt: null,
    };
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findUnique = vi.fn().mockResolvedValue(record);
    const repository = new PrismaCommercialAutomationExecutionRepository({
      commercialAutomationExecution: { updateMany, findUnique },
    } as never);
    const ownership = { executionId: record.id, ownerId: record.ownerId };

    const [first, second] = await Promise.all([
      repository.markExternalMayHaveStarted(ownership, { markedAt }),
      repository.markExternalMayHaveStarted(ownership, { markedAt }),
    ]);

    expect(first.externalStage).toBe('EXTERNAL_MAY_HAVE_STARTED');
    expect(second.externalStage).toBe('EXTERNAL_MAY_HAVE_STARTED');
    expect(updateMany).toHaveBeenCalledTimes(2);
    for (const [input] of updateMany.mock.calls) {
      expect(input).toMatchObject({
        where: {
          id: record.id,
          ownerId: record.ownerId,
          status: 'STARTED',
          leaseExpiresAt: { gt: markedAt },
        },
        data: { externalStage: 'EXTERNAL_MAY_HAVE_STARTED' },
      });
      expect(input.data.externalStage).not.toBe('NOT_REACHED');
    }
  });
  it('rejeita owner incorreto ou lease vencida sem reativar', async () => {
    const repository = new PrismaCommercialAutomationExecutionRepository({
      commercialAutomationExecution: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    } as never);

    await expect(
      repository.heartbeat(
        { executionId: 'execution-1', ownerId: 'owner-wrong' },
        {
          heartbeatAt: new Date('2026-07-26T15:03:00.000Z'),
          leaseExpiresAt: new Date('2026-07-26T15:05:00.000Z'),
        },
      ),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_EXECUTION_OWNERSHIP_LOST' });
    await expect(
      repository.finish(
        { executionId: 'execution-1', ownerId: 'owner-wrong' },
        {
          status: 'FAILED',
          completedAt: new Date('2026-07-26T15:03:00.000Z'),
        },
      ),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_EXECUTION_OWNERSHIP_LOST' });
  });

  it('recovery stale libera activeKey por compare-and-set e e idempotente', async () => {
    const terminal = {
      id: 'execution-1',
      schedulerJobId: 'scheduler',
      bullMqJobId: 'job-1',
      activeKey: null,
      ownerId: 'owner-1',
      heartbeatAt: new Date('2026-07-26T14:58:00.000Z'),
      leaseExpiresAt: new Date('2026-07-26T14:59:00.000Z'),
      mode: 'PREVIEW',
      status: 'FAILED',
      reasons: [],
      commercialRunId: null,
      failureCode: 'COMMERCIAL_EXECUTION_ABANDONED_SAFE',
      startedAt: new Date('2026-07-26T14:55:00.000Z'),
      completedAt: new Date('2026-07-26T15:00:00.000Z'),
    };
    const updateMany = vi
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const findUnique = vi.fn().mockResolvedValue(terminal);
    const repository = new PrismaCommercialAutomationExecutionRepository({
      commercialAutomationExecution: { updateMany, findUnique },
    } as never);
    const input = {
      status: 'FAILED' as const,
      failureCode: terminal.failureCode,
      completedAt: terminal.completedAt,
    };

    const results = await Promise.all([
      repository.recoverStale(terminal.id, input),
      repository.recoverStale(terminal.id, input),
    ]);

    expect(results).toHaveLength(2);
    expect(updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: terminal.id,
        status: 'STARTED',
        OR: expect.arrayContaining([
          { ownerId: null },
          { leaseExpiresAt: { lte: terminal.completedAt } },
        ]),
      }),
      data: expect.objectContaining({
        activeKey: null,
        status: 'FAILED',
      }),
    });
  });

  const createPreMarkerRecoverySubject = (overrides: {
    externalStage?: 'NOT_REACHED' | 'EXTERNAL_MAY_HAVE_STARTED';
    commercialRunId?: string | null;
    leaseExpiresAt?: Date;
    reservationLeaseExpiresAt?: Date;
    failureCount?: number;
    linkedRun?: Record<string, unknown> | null;
    reservations?: Array<Record<string, unknown>>;
    copyAttempt?: { id: string } | null;
    campaignUpdateCount?: number;
    executionUpdateCount?: number;
  } = {}) => {
    const now = new Date('2026-07-28T15:00:00.000Z');
    const staleExecution = {
      id: 'execution-1',
      schedulerJobId: 'scheduler',
      bullMqJobId: 'job-1',
      activeKey: 'commercial-automation',
      ownerId: 'owner-1',
      heartbeatAt: new Date('2026-07-28T14:57:00.000Z'),
      leaseExpiresAt:
        overrides.leaseExpiresAt ?? new Date('2026-07-28T14:59:00.000Z'),
      mode: 'SEND',
      status: 'STARTED',
      externalStage: overrides.externalStage ?? 'NOT_REACHED',
      reasons: [],
      commercialRunId: overrides.commercialRunId ?? null,
      failureCode: null,
      startedAt: new Date('2026-07-28T14:55:00.000Z'),
      completedAt: null,
    };
    const terminalExecution = {
      ...staleExecution,
      activeKey: null,
      status: 'FAILED',
      failureCode: 'COMMERCIAL_EXECUTION_PREMARKER_RESERVATION_ABANDONED',
      completedAt: now,
    };
    const reservation = {
      id: 'campaign-1',
      failureCount: overrides.failureCount ?? 2,
      attemptExecutionId: 'execution-1',
      attemptReservedAt: new Date('2026-07-28T14:50:00.000Z'),
      attemptLeaseExpiresAt:
        overrides.reservationLeaseExpiresAt ??
        new Date('2026-07-28T14:58:00.000Z'),
    };
    const executionFindUnique = vi
      .fn()
      .mockResolvedValueOnce(staleExecution)
      .mockResolvedValue(terminalExecution);
    const campaignUpdateMany = vi
      .fn()
      .mockResolvedValue({ count: overrides.campaignUpdateCount ?? 1 });
    const executionUpdateMany = vi
      .fn()
      .mockResolvedValue({ count: overrides.executionUpdateCount ?? 1 });
    const transaction = {
      commercialAutomationExecution: {
        findUnique: executionFindUnique,
        updateMany: executionUpdateMany,
      },
      commercialPipelineRun: {
        findUnique: vi.fn().mockResolvedValue(overrides.linkedRun ?? null),
      },
      commercialGroupCampaign: {
        findMany: vi
          .fn()
          .mockResolvedValue(overrides.reservations ?? [reservation]),
        updateMany: campaignUpdateMany,
      },
      commercialPromotionCandidate: {
        findMany: vi.fn().mockResolvedValue([{ id: 'candidate-1' }]),
      },
      commercialCopyGenerationAttempt: {
        findFirst: vi.fn().mockResolvedValue(overrides.copyAttempt ?? null),
      },
    };
    const prismaTransaction = vi.fn(async (callback: (tx: typeof transaction) => unknown) =>
      callback(transaction),
    );
    const repository = new PrismaCommercialAutomationExecutionRepository({
      $transaction: prismaTransaction,
      commercialAutomationExecution: {
        findUnique: vi.fn().mockResolvedValue(terminalExecution),
      },
      commercialPipelineRun: {},
      commercialGroupCampaign: {},
      commercialPromotionCandidate: {},
      commercialCopyGenerationAttempt: {},
    } as never);
    return {
      repository,
      transaction,
      prismaTransaction,
      campaignUpdateMany,
      executionUpdateMany,
      now,
      reservation,
    };
  };

  it('recovery pre-marker aplica backoff e release na mesma transacao CAS', async () => {
    const subject = createPreMarkerRecoverySubject();

    await expect(
      subject.repository.recoverStalePreMarkerReservation('execution-1', {
        completedAt: subject.now,
        minimumIntervalMinutes: 60,
        failureCode: 'COMMERCIAL_EXECUTION_PREMARKER_RESERVATION_ABANDONED',
      }),
    ).resolves.toMatchObject({
      outcome: 'RECOVERED',
      campaignId: 'campaign-1',
      failureCount: 3,
      nextEligibleAt: new Date('2026-07-28T19:00:00.000Z'),
    });

    expect(subject.prismaTransaction).toHaveBeenCalledOnce();
    expect(subject.campaignUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'campaign-1',
        attemptExecutionId: 'execution-1',
        attemptReservedAt: subject.reservation.attemptReservedAt,
        attemptLeaseExpiresAt: subject.reservation.attemptLeaseExpiresAt,
        failureCount: 2,
      },
      data: {
        failureCount: 3,
        nextEligibleAt: new Date('2026-07-28T19:00:00.000Z'),
        attemptExecutionId: null,
        attemptReservedAt: null,
        attemptLeaseExpiresAt: null,
      },
    });
    expect(subject.executionUpdateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'execution-1',
        status: 'STARTED',
        externalStage: 'NOT_REACHED',
        commercialRunId: null,
        ownerId: 'owner-1',
      }),
      data: {
        activeKey: null,
        status: 'FAILED',
        failureCode: 'COMMERCIAL_EXECUTION_PREMARKER_RESERVATION_ABANDONED',
        completedAt: subject.now,
      },
    });
    expect(subject.campaignUpdateMany.mock.calls[0][0].data).not.toHaveProperty(
      'lastSentAt',
    );
  });

  it('recovery pre-marker aplica cap de 24 horas sem tocar lastSentAt', async () => {
    const subject = createPreMarkerRecoverySubject({ failureCount: 6 });

    await expect(
      subject.repository.recoverStalePreMarkerReservation('execution-1', {
        completedAt: subject.now,
        minimumIntervalMinutes: 60,
        failureCode: 'COMMERCIAL_EXECUTION_PREMARKER_RESERVATION_ABANDONED',
      }),
    ).resolves.toMatchObject({
      outcome: 'RECOVERED',
      failureCount: 7,
      nextEligibleAt: new Date('2026-07-29T15:00:00.000Z'),
    });
    expect(subject.campaignUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          failureCount: 7,
          nextEligibleAt: new Date('2026-07-29T15:00:00.000Z'),
        }),
      }),
    );
    expect(subject.campaignUpdateMany.mock.calls[0][0].data).not.toHaveProperty(
      'lastSentAt',
    );
  });

  it.each([
    [
      'externalStage pos-marker',
      { externalStage: 'EXTERNAL_MAY_HAVE_STARTED' as const },
      'EXTERNAL_STAGE_REACHED',
    ],
    [
      'commercialRunId existente',
      { commercialRunId: 'run-1' },
      'COMMERCIAL_RUN_LINKED',
    ],
    [
      'copy attempt ambiguo',
      { copyAttempt: { id: 'attempt-1' } },
      'COPY_ATTEMPT_EVIDENCE',
    ],
    [
      'lease da execution valido',
      { leaseExpiresAt: new Date('2026-07-28T15:01:00.000Z') },
      'EXECUTION_NOT_STALE',
    ],
    [
      'lease da reserva valido',
      { reservationLeaseExpiresAt: new Date('2026-07-28T15:01:00.000Z') },
      'RESERVATION_LEASE_ACTIVE',
    ],
    [
      'owner divergente/ausente',
      { reservations: [] },
      'RESERVATION_NOT_UNIQUE',
    ],
    [
      'lookup de reserva ambiguo',
      {
        reservations: [
          {
            id: 'campaign-1',
            failureCount: 0,
            attemptExecutionId: 'execution-1',
            attemptReservedAt: new Date('2026-07-28T14:50:00.000Z'),
            attemptLeaseExpiresAt: new Date('2026-07-28T14:58:00.000Z'),
          },
          {
            id: 'campaign-2',
            failureCount: 0,
            attemptExecutionId: 'execution-1',
            attemptReservedAt: new Date('2026-07-28T14:51:00.000Z'),
            attemptLeaseExpiresAt: new Date('2026-07-28T14:58:00.000Z'),
          },
        ],
      },
      'RESERVATION_NOT_UNIQUE',
    ],
  ])('bloqueia %s sem atualizar campanha', async (_name, overrides, reason) => {
    const subject = createPreMarkerRecoverySubject(overrides);

    await expect(
      subject.repository.recoverStalePreMarkerReservation('execution-1', {
        completedAt: subject.now,
        minimumIntervalMinutes: 60,
        failureCode: 'COMMERCIAL_EXECUTION_PREMARKER_RESERVATION_ABANDONED',
      }),
    ).resolves.toMatchObject({ outcome: 'BLOCKED', reason });
    expect(subject.campaignUpdateMany).not.toHaveBeenCalled();
    expect(subject.executionUpdateMany).not.toHaveBeenCalled();
  });

  it.each([
    [
      'run',
      { id: 'run-1', dispatchId: null, jobId: null, dispatch: null, dispatchOutbox: null },
      'RUN_EVIDENCE',
    ],
    [
      'dispatch',
      {
        id: 'run-1',
        dispatchId: 'dispatch-1',
        jobId: null,
        dispatch: { id: 'dispatch-1' },
        dispatchOutbox: null,
      },
      'DISPATCH_EVIDENCE',
    ],
    [
      'outbox',
      {
        id: 'run-1',
        dispatchId: null,
        jobId: null,
        dispatch: null,
        dispatchOutbox: { id: 'outbox-1', status: 'PENDING' },
      },
      'OUTBOX_EVIDENCE',
    ],
    [
      'job',
      {
        id: 'run-1',
        dispatchId: null,
        jobId: 'job-1',
        dispatch: null,
        dispatchOutbox: null,
      },
      'JOB_EVIDENCE',
    ],
  ])('bloqueia evidencia de %s sem release/backoff', async (_name, linkedRun, reason) => {
    const subject = createPreMarkerRecoverySubject({ linkedRun });

    await expect(
      subject.repository.recoverStalePreMarkerReservation('execution-1', {
        completedAt: subject.now,
        minimumIntervalMinutes: 60,
        failureCode: 'COMMERCIAL_EXECUTION_PREMARKER_RESERVATION_ABANDONED',
      }),
    ).resolves.toMatchObject({ outcome: 'BLOCKED', reason });
    expect(subject.campaignUpdateMany).not.toHaveBeenCalled();
  });

  it('bloqueia configuracao invalida antes de abrir transacao', async () => {
    const subject = createPreMarkerRecoverySubject();

    await expect(
      subject.repository.recoverStalePreMarkerReservation('execution-1', {
        completedAt: subject.now,
        minimumIntervalMinutes: 0,
        failureCode: 'COMMERCIAL_EXECUTION_PREMARKER_RESERVATION_ABANDONED',
      }),
    ).resolves.toEqual({
      outcome: 'BLOCKED',
      reason: 'INVALID_MINIMUM_INTERVAL',
    });
    expect(subject.prismaTransaction).not.toHaveBeenCalled();
  });

  it('CAS da execution falha sem produzir commit parcial', async () => {
    const subject = createPreMarkerRecoverySubject({ executionUpdateCount: 0 });

    await expect(
      subject.repository.recoverStalePreMarkerReservation('execution-1', {
        completedAt: subject.now,
        minimumIntervalMinutes: 60,
        failureCode: 'COMMERCIAL_EXECUTION_PREMARKER_RESERVATION_ABANDONED',
      }),
    ).resolves.toMatchObject({
      outcome: 'ALREADY_RECOVERED',
    });
    expect(subject.prismaTransaction).toHaveBeenCalledOnce();
    expect(subject.campaignUpdateMany).toHaveBeenCalledOnce();
    expect(subject.executionUpdateMany).toHaveBeenCalledOnce();
  });

  it('concorrencia permite no maximo um recovery efetivo', async () => {
    const subject = createPreMarkerRecoverySubject();
    const transaction = subject.prismaTransaction;
    transaction
      .mockImplementationOnce(async (callback) => callback(subject.transaction))
      .mockRejectedValueOnce({ code: 'P2034' });

    const results = await Promise.all([
      subject.repository.recoverStalePreMarkerReservation('execution-1', {
        completedAt: subject.now,
        minimumIntervalMinutes: 60,
        failureCode: 'COMMERCIAL_EXECUTION_PREMARKER_RESERVATION_ABANDONED',
      }),
      subject.repository.recoverStalePreMarkerReservation('execution-1', {
        completedAt: subject.now,
        minimumIntervalMinutes: 60,
        failureCode: 'COMMERCIAL_EXECUTION_PREMARKER_RESERVATION_ABANDONED',
      }),
    ]);

    expect(results.map((result) => result.outcome).sort()).toEqual([
      'ALREADY_RECOVERED',
      'RECOVERED',
    ]);
    expect(subject.campaignUpdateMany).toHaveBeenCalledTimes(1);
    expect(subject.executionUpdateMany).toHaveBeenCalledTimes(1);
  });

  it('erro de lookup pre-marker retorna LOOKUP_FAILED sem mutacao', async () => {
    const subject = createPreMarkerRecoverySubject();
    subject.transaction.commercialPipelineRun.findUnique.mockRejectedValueOnce(
      new Error('run lookup failed'),
    );

    await expect(
      subject.repository.recoverStalePreMarkerReservation('execution-1', {
        completedAt: subject.now,
        minimumIntervalMinutes: 60,
        failureCode: 'COMMERCIAL_EXECUTION_PREMARKER_RESERVATION_ABANDONED',
      }),
    ).resolves.toEqual({ outcome: 'BLOCKED', reason: 'LOOKUP_FAILED' });

    expect(subject.campaignUpdateMany).not.toHaveBeenCalled();
    expect(subject.executionUpdateMany).not.toHaveBeenCalled();
  });

  it('erro de mutacao nao e reclassificado como LOOKUP_FAILED', async () => {
    const subject = createPreMarkerRecoverySubject();
    subject.campaignUpdateMany.mockRejectedValueOnce(new Error('campaign mutation failed'));

    await expect(
      subject.repository.recoverStalePreMarkerReservation('execution-1', {
        completedAt: subject.now,
        minimumIntervalMinutes: 60,
        failureCode: 'COMMERCIAL_EXECUTION_PREMARKER_RESERVATION_ABANDONED',
      }),
    ).rejects.toThrow('campaign mutation failed');

    expect(subject.executionUpdateMany).not.toHaveBeenCalled();
  });
  it('conflito Serializable permanece CAS_CONFLICT e nao vira LOOKUP_FAILED', async () => {
    const staleExecution = {
      id: 'execution-1',
      schedulerJobId: 'scheduler',
      bullMqJobId: 'job-1',
      activeKey: 'commercial-automation',
      ownerId: 'owner-1',
      heartbeatAt: new Date('2026-07-28T14:57:00.000Z'),
      leaseExpiresAt: new Date('2026-07-28T14:59:00.000Z'),
      mode: 'SEND',
      status: 'STARTED',
      externalStage: 'NOT_REACHED',
      reasons: [],
      commercialRunId: null,
      failureCode: null,
      startedAt: new Date('2026-07-28T14:55:00.000Z'),
      completedAt: null,
    };
    const repository = new PrismaCommercialAutomationExecutionRepository({
      $transaction: vi.fn().mockRejectedValue({ code: 'P2034' }),
      commercialAutomationExecution: {
        findUnique: vi.fn().mockResolvedValue(staleExecution),
      },
      commercialPipelineRun: {},
      commercialGroupCampaign: {},
      commercialPromotionCandidate: {},
      commercialCopyGenerationAttempt: {},
    } as never);

    await expect(
      repository.recoverStalePreMarkerReservation('execution-1', {
        completedAt: new Date('2026-07-28T15:00:00.000Z'),
        minimumIntervalMinutes: 60,
        failureCode: 'COMMERCIAL_EXECUTION_PREMARKER_RESERVATION_ABANDONED',
      }),
    ).resolves.toEqual({ outcome: 'BLOCKED', reason: 'CAS_CONFLICT' });
  });

  it('lookup apos tentativas de mutacao retorna LOOKUP_FAILED e rollback evita commit parcial', async () => {
    const now = new Date('2026-07-28T15:00:00.000Z');
    const persistentCampaign = {
      failureCount: 2,
      nextEligibleAt: null as Date | null,
      attemptExecutionId: 'execution-1' as string | null,
      attemptReservedAt: new Date('2026-07-28T14:50:00.000Z') as Date | null,
      attemptLeaseExpiresAt: new Date('2026-07-28T14:58:00.000Z') as Date | null,
    };
    const persistentExecution = { status: 'STARTED', failureCode: null as string | null };
    const staleExecution = {
      id: 'execution-1',
      schedulerJobId: 'scheduler',
      bullMqJobId: 'job-1',
      activeKey: 'commercial-automation',
      ownerId: 'owner-1',
      heartbeatAt: new Date('2026-07-28T14:57:00.000Z'),
      leaseExpiresAt: new Date('2026-07-28T14:59:00.000Z'),
      mode: 'SEND',
      status: 'STARTED',
      externalStage: 'NOT_REACHED',
      reasons: [],
      commercialRunId: null,
      failureCode: null,
      startedAt: new Date('2026-07-28T14:55:00.000Z'),
      completedAt: null,
    };
    let executionLookupCount = 0;
    let stagedCampaign = { ...persistentCampaign };
    let stagedExecution = { ...persistentExecution };
    const campaignUpdateMany = vi.fn(async () => {
      stagedCampaign = {
        failureCount: 3,
        nextEligibleAt: new Date('2026-07-28T19:00:00.000Z'),
        attemptExecutionId: null,
        attemptReservedAt: null,
        attemptLeaseExpiresAt: null,
      };
      return { count: 1 };
    });
    const executionUpdateMany = vi.fn(async () => {
      stagedExecution = {
        status: 'FAILED',
        failureCode: 'COMMERCIAL_EXECUTION_PREMARKER_RESERVATION_ABANDONED',
      };
      return { count: 1 };
    });
    const transaction = {
      commercialAutomationExecution: {
        findUnique: vi.fn(async () => {
          executionLookupCount += 1;
          if (executionLookupCount === 1) return staleExecution;
          throw new Error('post mutation lookup failed');
        }),
        updateMany: executionUpdateMany,
      },
      commercialPipelineRun: { findUnique: vi.fn().mockResolvedValue(null) },
      commercialGroupCampaign: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'campaign-1',
            failureCount: 2,
            attemptExecutionId: 'execution-1',
            attemptReservedAt: new Date('2026-07-28T14:50:00.000Z'),
            attemptLeaseExpiresAt: new Date('2026-07-28T14:58:00.000Z'),
          },
        ]),
        updateMany: campaignUpdateMany,
      },
      commercialPromotionCandidate: {
        findMany: vi.fn().mockResolvedValue([{ id: 'candidate-1' }]),
      },
      commercialCopyGenerationAttempt: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };
    const prismaTransaction = vi.fn(
      async (callback: (tx: typeof transaction) => Promise<unknown>) => {
        stagedCampaign = { ...persistentCampaign };
        stagedExecution = { ...persistentExecution };
        const result = await callback(transaction);
        Object.assign(persistentCampaign, stagedCampaign);
        Object.assign(persistentExecution, stagedExecution);
        return result;
      },
    );
    const repository = new PrismaCommercialAutomationExecutionRepository({
      $transaction: prismaTransaction,
      commercialAutomationExecution: { findUnique: vi.fn() },
      commercialPipelineRun: {},
      commercialGroupCampaign: {},
      commercialPromotionCandidate: {},
      commercialCopyGenerationAttempt: {},
    } as never);

    await expect(
      repository.recoverStalePreMarkerReservation('execution-1', {
        completedAt: now,
        minimumIntervalMinutes: 60,
        failureCode: 'COMMERCIAL_EXECUTION_PREMARKER_RESERVATION_ABANDONED',
      }),
    ).resolves.toEqual({ outcome: 'BLOCKED', reason: 'LOOKUP_FAILED' });

    expect(campaignUpdateMany).toHaveBeenCalledOnce();
    expect(executionUpdateMany).toHaveBeenCalledOnce();
    expect(persistentCampaign).toEqual({
      failureCount: 2,
      nextEligibleAt: null,
      attemptExecutionId: 'execution-1',
      attemptReservedAt: new Date('2026-07-28T14:50:00.000Z'),
      attemptLeaseExpiresAt: new Date('2026-07-28T14:58:00.000Z'),
    });
    expect(persistentExecution).toEqual({ status: 'STARTED', failureCode: null });
  });});
