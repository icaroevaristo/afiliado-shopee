import { describe, expect, it, vi } from 'vitest';

import {
  PrismaCommercialAutomationExecutionRepository,
  PrismaCommercialAutomationHistoryRepository,
  PrismaCommercialAutomationSettingsRepository,
} from '../src/prisma-repositories';

describe('commercial automation Prisma repositories', () => {
  it('atualiza agenda com CAS de revision e incremento atomico', async () => {
    const update = vi.fn().mockResolvedValue({
      paused: true,
      pausedAt: null,
      resumedAt: null,
      allowedStartTime: '08:00',
      allowedEndTime: '23:00',
      minimumIntervalMinutes: 14,
      staggerMinutes: 5,
      scheduleRevision: 1,
      updatedAt: new Date('2026-08-24T12:00:00.000Z'),
    });
    const repository = new PrismaCommercialAutomationSettingsRepository({
      commercialAutomationSettings: { update },
    } as never);

    await repository.updateSchedule(
      {
        minimumIntervalMinutes: 14,
        staggerMinutes: 5,
        expectedRevision: 0,
      },
      new Date('2026-08-24T12:00:00.000Z'),
    );

    expect(update).toHaveBeenCalledWith({
      where: { id: 'commercial-automation', scheduleRevision: 0 },
      data: {
        minimumIntervalMinutes: 14,
        staggerMinutes: 5,
        scheduleRevision: { increment: 1 },
        updatedAt: new Date('2026-08-24T12:00:00.000Z'),
      },
    });
  });

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
    const updateMany = vi.fn().mockResolvedValueOnce({ count: 1 });
    const findUnique = vi.fn().mockResolvedValueOnce({
      paused: false,
      pausedAt: new Date('2026-07-25T15:00:00.000Z'),
      resumedAt: new Date('2026-07-25T16:00:00.000Z'),
      updatedAt: new Date('2026-07-25T16:00:00.000Z'),
    });
    const repository = new PrismaCommercialAutomationSettingsRepository({
      commercialAutomationSettings: { upsert, updateMany, findUnique },
    } as never);

    await repository.getOrCreate(new Date('2026-07-25T15:00:00.000Z'));
    await repository.setPaused(
      false,
      new Date('2026-07-25T16:00:00.000Z'),
      new Date('2026-07-25T15:00:00.000Z'),
    );

    expect(upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { id: 'commercial-automation' },
        create: expect.objectContaining({ paused: true }),
      }),
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'commercial-automation',
        paused: true,
        updatedAt: new Date('2026-07-25T15:00:00.000Z'),
      },
      data: {
        paused: false,
        resumedAt: new Date('2026-07-25T16:00:00.000Z'),
      },
    });
  });

  it('rejeita retomada obsoleta e preserva pausa persistida', async () => {
    const current = {
      paused: true,
      pausedAt: new Date('2026-07-25T15:00:00.000Z'),
      resumedAt: null,
      updatedAt: new Date('2026-07-25T17:00:00.000Z'),
    };
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const repository = new PrismaCommercialAutomationSettingsRepository({
      commercialAutomationSettings: {
        upsert: vi.fn().mockResolvedValue(current),
        updateMany,
      },
    } as never);

    await expect(
      repository.setPaused(
        false,
        new Date('2026-07-25T18:00:00.000Z'),
        new Date('2026-07-25T15:00:00.000Z'),
      ),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_AUTOMATION_RESUME_CONFLICT' });
    expect(updateMany).toHaveBeenCalledOnce();
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
      instanceName: 'instance-b',
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
      lastSentInstanceName: 'instance-b',
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

  it('recupera a execution manual pela identidade logica sem inventar bullMqJobId', async () => {
    const record = {
      id: 'manual-execution-1',
      schedulerJobId: 'manual-publication:request-1:target-1',
      bullMqJobId: null,
      activeKey: null,
      ownerId: null,
      heartbeatAt: null,
      leaseExpiresAt: null,
      mode: 'SEND',
      status: 'QUEUED',
      externalStage: 'NOT_REACHED',
      reasons: [],
      commercialRunId: 'run-1',
      failureCode: null,
      startedAt: new Date('2026-08-26T12:00:00.000Z'),
      completedAt: new Date('2026-08-26T12:00:01.000Z'),
    };
    const findFirst = vi.fn().mockResolvedValue(record);
    const repository = new PrismaCommercialAutomationExecutionRepository({
      commercialAutomationExecution: { findFirst },
    } as never);

    await expect(
      repository.findBySchedulerJobId(record.schedulerJobId),
    ).resolves.toMatchObject({
      id: record.id,
      bullMqJobId: null,
      commercialRunId: record.commercialRunId,
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: { schedulerJobId: record.schedulerJobId, bullMqJobId: null },
      orderBy: { startedAt: 'asc' },
    });
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

  it('serializa lookup e create da execution manual na mesma transacao', async () => {
    const record = {
      id: 'manual-execution-1',
      schedulerJobId: 'manual-publication:request-1:target-1',
      bullMqJobId: null,
      activeKey: 'commercial-automation',
      ownerId: 'owner-1',
      heartbeatAt: new Date('2026-08-26T15:00:00.000Z'),
      leaseExpiresAt: new Date('2026-08-26T15:02:00.000Z'),
      mode: 'SEND',
      status: 'STARTED',
      externalStage: 'NOT_REACHED',
      reasons: [],
      commercialRunId: null,
      failureCode: null,
      startedAt: new Date('2026-08-26T15:00:00.000Z'),
      completedAt: null,
    };
    const findFirst = vi.fn().mockResolvedValue(null);
    const create = vi.fn().mockResolvedValue(record);
    const transaction = {
      commercialAutomationExecution: { findFirst, create },
    };
    const transactionRunner = vi.fn(
      async (callback: (client: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    );
    const rootCreate = vi.fn();
    const repository = new PrismaCommercialAutomationExecutionRepository({
      $transaction: transactionRunner,
      commercialAutomationExecution: { create: rootCreate },
    } as never);

    await expect(
      repository.start({
        schedulerJobId: record.schedulerJobId,
        mode: 'SEND',
        startedAt: record.startedAt,
        ownerId: record.ownerId,
        heartbeatAt: record.heartbeatAt,
        leaseExpiresAt: record.leaseExpiresAt,
      }),
    ).resolves.toMatchObject({
      outcome: 'created',
      execution: { id: record.id, bullMqJobId: null },
    });
    expect(transactionRunner).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        schedulerJobId: record.schedulerJobId,
        bullMqJobId: null,
      },
      orderBy: { startedAt: 'asc' },
    });
    expect(create).toHaveBeenCalledOnce();
    expect(rootCreate).not.toHaveBeenCalled();
  });

  it('converte conflito Serializable da execution manual em concorrencia sem retry', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const findUnique = vi.fn().mockResolvedValue(null);
    const transactionRunner = vi.fn().mockRejectedValue({ code: 'P2034' });
    const repository = new PrismaCommercialAutomationExecutionRepository({
      $transaction: transactionRunner,
      commercialAutomationExecution: { findFirst, findUnique },
    } as never);

    await expect(
      repository.start({
        schedulerJobId: 'manual-publication:request-2:target-1',
        mode: 'SEND',
        startedAt: new Date('2026-08-26T15:00:00.000Z'),
        ownerId: 'owner-2',
        heartbeatAt: new Date('2026-08-26T15:00:00.000Z'),
        leaseExpiresAt: new Date('2026-08-26T15:02:00.000Z'),
      }),
    ).resolves.toMatchObject({ outcome: 'concurrent', stale: false });
    expect(transactionRunner).toHaveBeenCalledOnce();
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        schedulerJobId: 'manual-publication:request-2:target-1',
        bullMqJobId: null,
      },
      orderBy: { startedAt: 'asc' },
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: { activeKey: 'commercial-automation' },
    });
  });

  it('fecha a race precheck 5 -> PATCH 6 -> start atomico esperado 5', async () => {
    let persistedScheduleRevision = 5;
    const precheck = vi.fn(() => persistedScheduleRevision);
    const settingsFindUnique = vi.fn(async () => ({
      scheduleRevision: persistedScheduleRevision,
    }));
    const transactionCreate = vi.fn();
    const rootCreate = vi.fn();
    const transaction = {
      commercialAutomationSettings: { findUnique: settingsFindUnique },
      commercialAutomationExecution: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: transactionCreate,
      },
    };
    const transactionRunner = vi.fn(
      async (callback: (client: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    );
    const repository = new PrismaCommercialAutomationExecutionRepository({
      $transaction: transactionRunner,
      commercialAutomationSettings: { findUnique: settingsFindUnique },
      commercialAutomationExecution: { create: rootCreate },
    } as never);

    expect(precheck()).toBe(5);
    persistedScheduleRevision = 6;

    await expect(
      repository.start({
        schedulerJobId: 'scheduled-commercial-automation',
        bullMqJobId: 'job-race',
        mode: 'PREVIEW',
        startedAt: new Date('2026-08-24T15:00:00.000Z'),
        ownerId: 'owner-race',
        heartbeatAt: new Date('2026-08-24T15:00:00.000Z'),
        leaseExpiresAt: new Date('2026-08-24T15:02:00.000Z'),
        expectedScheduleRevision: 5,
      }),
    ).rejects.toMatchObject({ code: 'SCHEDULE_REVISION_STALE' });

    expect(transactionRunner).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
    expect(settingsFindUnique).toHaveBeenCalledWith({
      where: { id: 'commercial-automation' },
      select: { scheduleRevision: true },
    });
    expect(transactionCreate).not.toHaveBeenCalled();
    expect(rootCreate).not.toHaveBeenCalled();
  });

  it('trata settings ausente como revision zero na aceitacao atomica', async () => {
    const record = {
      id: 'execution-zero-revision',
      schedulerJobId: 'scheduled-commercial-automation',
      bullMqJobId: 'job-zero-revision',
      activeKey: 'commercial-automation',
      ownerId: 'owner-zero-revision',
      heartbeatAt: new Date('2026-08-24T15:00:00.000Z'),
      leaseExpiresAt: new Date('2026-08-24T15:02:00.000Z'),
      mode: 'PREVIEW',
      status: 'STARTED',
      externalStage: 'NOT_REACHED',
      reasons: [],
      commercialRunId: null,
      failureCode: null,
      startedAt: new Date('2026-08-24T15:00:00.000Z'),
      completedAt: null,
    };
    const settingsFindUnique = vi.fn().mockResolvedValue(null);
    const create = vi.fn().mockResolvedValue(record);
    const transaction = {
      commercialAutomationSettings: { findUnique: settingsFindUnique },
      commercialAutomationExecution: {
        findUnique: vi.fn().mockResolvedValue(null),
        create,
      },
    };
    const transactionRunner = vi.fn(
      async (callback: (client: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    );
    const repository = new PrismaCommercialAutomationExecutionRepository({
      $transaction: transactionRunner,
      commercialAutomationSettings: { findUnique: settingsFindUnique },
      commercialAutomationExecution: { create: vi.fn() },
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
        expectedScheduleRevision: 0,
      }),
    ).resolves.toMatchObject({ outcome: 'created' });
    expect(create).toHaveBeenCalledOnce();
  });

  it('preserva redelivery idempotente depois que a revision avancou', async () => {
    const existing = {
      id: 'execution-frozen',
      schedulerJobId: 'scheduled-commercial-automation',
      bullMqJobId: 'job-frozen',
      activeKey: null,
      ownerId: 'owner-frozen',
      heartbeatAt: new Date('2026-08-24T15:00:00.000Z'),
      leaseExpiresAt: new Date('2026-08-24T15:02:00.000Z'),
      mode: 'PREVIEW',
      status: 'PREVIEW_READY',
      externalStage: 'NOT_REACHED',
      reasons: [],
      commercialRunId: 'run-frozen',
      failureCode: null,
      startedAt: new Date('2026-08-24T15:00:00.000Z'),
      completedAt: new Date('2026-08-24T15:01:00.000Z'),
    };
    const findUnique = vi.fn().mockResolvedValue(existing);
    const settingsFindUnique = vi.fn();
    const create = vi.fn();
    const transaction = {
      commercialAutomationExecution: { findUnique, create },
      commercialAutomationSettings: { findUnique: settingsFindUnique },
    };
    const transactionRunner = vi.fn(
      async (callback: (client: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    );
    const repository = new PrismaCommercialAutomationExecutionRepository({
      $transaction: transactionRunner,
      commercialAutomationExecution: { findUnique: vi.fn(), create },
      commercialAutomationSettings: { findUnique: settingsFindUnique },
    } as never);

    await expect(
      repository.start({
        schedulerJobId: existing.schedulerJobId,
        bullMqJobId: existing.bullMqJobId,
        mode: 'PREVIEW',
        startedAt: existing.startedAt,
        ownerId: 'new-owner',
        heartbeatAt: existing.heartbeatAt,
        leaseExpiresAt: existing.leaseExpiresAt,
        expectedScheduleRevision: 5,
      }),
    ).resolves.toMatchObject({
      outcome: 'existing',
      execution: { id: existing.id },
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: { bullMqJobId: existing.bullMqJobId },
    });
    expect(settingsFindUnique).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
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

  it('marca uma execution QUEUED como AMBIGUOUS por CAS do run vinculado', async () => {
    const record = {
      id: 'execution-queued',
      schedulerJobId: 'manual-publication:request-1:target-1',
      bullMqJobId: null,
      activeKey: null,
      ownerId: null,
      heartbeatAt: null,
      leaseExpiresAt: null,
      mode: 'SEND',
      status: 'QUEUED',
      externalStage: 'NOT_REACHED',
      reasons: [],
      commercialRunId: 'run-1',
      failureCode: null,
      startedAt: new Date('2026-08-26T15:00:00.000Z'),
      completedAt: new Date('2026-08-26T15:00:01.000Z'),
    };
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findUnique = vi.fn().mockResolvedValue({
      ...record,
      status: 'AMBIGUOUS',
      failureCode: 'COMMERCIAL_OUTBOX_PUBLICATION_UNCERTAIN',
    });
    const repository = new PrismaCommercialAutomationExecutionRepository({
      commercialAutomationExecution: { updateMany, findUnique },
    } as never);

    await expect(
      repository.markQueuedAmbiguous(record.id, {
        commercialRunId: record.commercialRunId,
        failureCode: 'COMMERCIAL_OUTBOX_PUBLICATION_UNCERTAIN',
        completedAt: new Date('2026-08-26T15:00:02.000Z'),
      }),
    ).resolves.toMatchObject({
      id: record.id,
      status: 'AMBIGUOUS',
      commercialRunId: record.commercialRunId,
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: record.id,
        status: 'QUEUED',
        commercialRunId: record.commercialRunId,
      },
      data: {
        activeKey: null,
        status: 'AMBIGUOUS',
        failureCode: 'COMMERCIAL_OUTBOX_PUBLICATION_UNCERTAIN',
        completedAt: new Date('2026-08-26T15:00:02.000Z'),
      },
    });
  });

  it('preserva a identidade da instancia no contexto de recovery sticky', async () => {
    const execution = {
      id: 'execution-1',
      schedulerJobId: 'scheduler',
      bullMqJobId: 'job-1',
      activeKey: null,
      ownerId: 'owner-1',
      heartbeatAt: new Date('2026-07-26T15:00:00.000Z'),
      leaseExpiresAt: new Date('2026-07-26T14:59:00.000Z'),
      mode: 'SEND',
      status: 'FAILED',
      externalStage: 'EXTERNAL_MAY_HAVE_STARTED',
      reasons: [],
      commercialRunId: 'run-1',
      failureCode: 'COMMERCIAL_EXECUTION_RECOVERY_AMBIGUOUS',
      startedAt: new Date('2026-07-26T14:55:00.000Z'),
      completedAt: new Date('2026-07-26T15:00:00.000Z'),
    };
    const run = {
      id: 'run-1',
      mode: 'CONFIRMED',
      dispatchId: 'dispatch-1',
      jobId: 'job-1',
      instanceName: 'instance-a',
      finalStatus: 'AMBIGUOUS',
      investigationRequired: true,
      dispatch: {
        id: 'dispatch-1',
        status: 'PROCESSING',
        attemptCount: 1,
        instanceName: 'instance-a',
        destinationId: 'destination-1',
        destination: {
          type: 'GROUP',
          assignedInstanceName: 'instance-a',
        },
      },
      dispatchOutbox: {
        id: 'outbox-1',
        commercialRunId: 'run-1',
        dispatchId: 'dispatch-1',
        jobId: 'job-1',
        status: 'AMBIGUOUS',
        instanceName: 'instance-a',
      },
    };
    const findExecution = vi.fn().mockResolvedValue(execution);
    const findRun = vi.fn().mockResolvedValue(run);
    const repository = new PrismaCommercialAutomationExecutionRepository({
      commercialAutomationExecution: { findUnique: findExecution },
      commercialPipelineRun: { findUnique: findRun },
    } as never);

    await expect(
      repository.findRecoveryContext('execution-1'),
    ).resolves.toMatchObject({
      execution: { commercialRunId: 'run-1' },
      run: {
        id: 'run-1',
        instanceName: 'instance-a',
        dispatch: { instanceName: 'instance-a' },
        outbox: { instanceName: 'instance-a' },
      },
    });
    expect(findRun).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      include: {
        dispatch: {
          include: {
            destination: {
              include: {
                instanceAssignments: {
                  select: { instanceName: true, position: true },
                  orderBy: { position: 'asc' },
                },
              },
            },
          },
        },
        dispatchOutbox: true,
      },
    });
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

  const createPreMarkerRecoverySubject = (
    overrides: {
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
    } = {},
  ) => {
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
    const prismaTransaction = vi.fn(
      async (callback: (tx: typeof transaction) => unknown) =>
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

  const createPreConfirmationRecoverySubject = (
    overrides: {
      reservation?: Record<string, unknown> | null;
      campaignUpdateCount?: number;
      executionUpdateCount?: number;
      outerExecution?: Record<string, unknown>;
    } = {},
  ) => {
    const now = new Date('2026-07-28T15:00:00.000Z');
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
      externalStage: 'EXTERNAL_MAY_HAVE_STARTED',
      reasons: [],
      commercialRunId: 'run-1',
      failureCode: null,
      startedAt: new Date('2026-07-28T14:55:00.000Z'),
      completedAt: null,
    };
    const terminalExecution = {
      ...staleExecution,
      activeKey: null,
      status: 'FAILED',
      failureCode: 'COMMERCIAL_EXECUTION_ABANDONED_SAFE',
      completedAt: now,
    };
    const reservation =
      overrides.reservation === undefined
        ? {
            id: 'campaign-1',
            attemptExecutionId: 'execution-1',
            attemptReservedAt: new Date('2026-07-28T14:50:00.000Z'),
            attemptLeaseExpiresAt: new Date('2026-07-28T14:58:00.000Z'),
          }
        : overrides.reservation;
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
      commercialGroupCampaign: {
        findMany: vi.fn().mockResolvedValue(reservation ? [reservation] : []),
        updateMany: campaignUpdateMany,
      },
      commercialPipelineRun: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'run-1',
          executionId: 'execution-1',
          mode: 'DRY_RUN',
          dispatchId: null,
          jobId: null,
          dispatch: null,
          dispatchOutbox: null,
        }),
      },
    };
    const prismaTransaction = vi.fn(
      async (callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
    );
    const repository = new PrismaCommercialAutomationExecutionRepository({
      $transaction: prismaTransaction,
      commercialAutomationExecution: {
        findUnique: vi
          .fn()
          .mockResolvedValue(overrides.outerExecution ?? staleExecution),
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

  it('recovery pre-confirmacao libera reservation e execution na mesma transacao', async () => {
    const subject = createPreConfirmationRecoverySubject();

    await expect(
      subject.repository.recoverStalePreConfirmationReservation('execution-1', {
        completedAt: subject.now,
        failureCode: 'COMMERCIAL_EXECUTION_ABANDONED_SAFE',
      }),
    ).resolves.toMatchObject({
      outcome: 'RECOVERED',
      execution: { status: 'FAILED' },
    });

    expect(subject.prismaTransaction).toHaveBeenCalledOnce();
    expect(subject.campaignUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'campaign-1',
        attemptExecutionId: 'execution-1',
        attemptReservedAt: subject.reservation?.attemptReservedAt,
        attemptLeaseExpiresAt: subject.reservation?.attemptLeaseExpiresAt,
      },
      data: {
        attemptExecutionId: null,
        attemptReservedAt: null,
        attemptLeaseExpiresAt: null,
      },
    });
    expect(subject.executionUpdateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'execution-1',
        status: 'STARTED',
        externalStage: 'EXTERNAL_MAY_HAVE_STARTED',
        commercialRunId: 'run-1',
        ownerId: 'owner-1',
      }),
      data: {
        activeKey: null,
        status: 'FAILED',
        failureCode: 'COMMERCIAL_EXECUTION_ABANDONED_SAFE',
        completedAt: subject.now,
      },
    });
    expect(subject.campaignUpdateMany.mock.calls[0][0].data).not.toHaveProperty(
      'failureCount',
    );
  });

  it('recovery pre-confirmacao sem reservation ainda finaliza a execution sem criar ownership', async () => {
    const subject = createPreConfirmationRecoverySubject({ reservation: null });

    await expect(
      subject.repository.recoverStalePreConfirmationReservation('execution-1', {
        completedAt: subject.now,
        failureCode: 'COMMERCIAL_EXECUTION_ABANDONED_SAFE',
      }),
    ).resolves.toMatchObject({ outcome: 'RECOVERED' });

    expect(subject.campaignUpdateMany).not.toHaveBeenCalled();
    expect(subject.executionUpdateMany).toHaveBeenCalledOnce();
  });

  it('conflito na liberacao pre-confirmacao permanece fail-closed', async () => {
    const subject = createPreConfirmationRecoverySubject({
      campaignUpdateCount: 0,
      outerExecution: {
        id: 'execution-1',
        status: 'STARTED',
      },
    });

    await expect(
      subject.repository.recoverStalePreConfirmationReservation('execution-1', {
        completedAt: subject.now,
        failureCode: 'COMMERCIAL_EXECUTION_ABANDONED_SAFE',
      }),
    ).resolves.toEqual({ outcome: 'BLOCKED', reason: 'CAS_CONFLICT' });

    expect(subject.executionUpdateMany).not.toHaveBeenCalled();
  });

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
      {
        id: 'run-1',
        dispatchId: null,
        jobId: null,
        dispatch: null,
        dispatchOutbox: null,
      },
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
  ])(
    'bloqueia evidencia de %s sem release/backoff',
    async (_name, linkedRun, reason) => {
      const subject = createPreMarkerRecoverySubject({ linkedRun });

      await expect(
        subject.repository.recoverStalePreMarkerReservation('execution-1', {
          completedAt: subject.now,
          minimumIntervalMinutes: 60,
          failureCode: 'COMMERCIAL_EXECUTION_PREMARKER_RESERVATION_ABANDONED',
        }),
      ).resolves.toMatchObject({ outcome: 'BLOCKED', reason });
      expect(subject.campaignUpdateMany).not.toHaveBeenCalled();
    },
  );

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
    subject.campaignUpdateMany.mockRejectedValueOnce(
      new Error('campaign mutation failed'),
    );

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
      attemptLeaseExpiresAt: new Date(
        '2026-07-28T14:58:00.000Z',
      ) as Date | null,
    };
    const persistentExecution = {
      status: 'STARTED',
      failureCode: null as string | null,
    };
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
    expect(persistentExecution).toEqual({
      status: 'STARTED',
      failureCode: null,
    });
  });
});
