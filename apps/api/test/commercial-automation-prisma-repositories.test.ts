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
});
