import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '@shopee-auto-affiliate-ai/config';
import { AppError } from '@shopee-auto-affiliate-ai/shared';
import {
  DEFAULT_COMMERCIAL_AUTOMATION_SCHEDULER_JOB_ID,
  JOB_NAMES,
} from '@shopee-auto-affiliate-ai/queue';

import {
  COMMERCIAL_AUTOMATION_WORKER_CONCURRENCY,
  processCommercialAutomationJob,
  startCommercialAutomationWorker,
} from '../src/commercial-automation-worker';

const baseEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379',
};

const createInfrastructure = () => {
  const scheduler = {
    register: vi.fn(async () => ({ status: 'registered' })),
    remove: vi.fn(async () => ({ status: 'not-registered' })),
    getState: vi.fn(),
  };
  return {
    scheduler,
    infrastructure: {
      connection: {},
      scheduler,
      confirmationQueue: {
        hasJob: vi.fn(async () => false),
        enqueue: vi.fn(async () => undefined),
      },
      close: vi.fn(async () => undefined),
    },
  };
};

describe('commercial automation worker bootstrap', () => {
  it('executa o coordenador de recovery antes do Scheduler e do consumer', async () => {
    const { scheduler, infrastructure } = createInfrastructure();
    const events: string[] = [];
    scheduler.register.mockImplementation(async () => {
      events.push('scheduler');
      return { status: 'registered' };
    });
    const recoveryCoordinator = {
      run: vi.fn(async () => {
        events.push('recovery');
        return {
          scanned: 0,
          safeDbRecovered: 0,
          safeQueueRecovered: 0,
          noAction: 0,
          humanRequired: 0,
          jobsReused: 0,
          jobsCreated: 0,
          reservationsReleased: 0,
          finalizersReplayed: 0,
          historicalIgnored: 0,
          ambiguitiesPreserved: 0,
        };
      }),
    };
    const workerFactory = vi.fn(() => {
      events.push('worker');
      return {
        worker: { name: 'commercial-worker' },
        close: vi.fn(async () => undefined),
      };
    });

    const runtime = await startCommercialAutomationWorker(
      loadConfig({
        ...baseEnv,
        COMMERCIAL_SCHEDULER_ENABLED: 'true',
      }),
      {
        infrastructureFactory: () => infrastructure as never,
        workerFactory: workerFactory as never,
        recoveryCoordinator,
        logger: { info: vi.fn(), error: vi.fn() },
      },
    );

    expect(recoveryCoordinator.run).toHaveBeenCalledOnce();
    expect(events).toEqual(['recovery', 'scheduler', 'worker']);
    await runtime.close();
  });

  it('registra apenas o Scheduler comercial sem executar tick no bootstrap', async () => {
    const { scheduler, infrastructure } = createInfrastructure();
    const workerFactory = vi.fn(() => ({
      worker: { name: 'commercial-worker' },
      close: vi.fn(async () => undefined),
    }));
    const config = loadConfig({
      ...baseEnv,
      COMMERCIAL_SCHEDULER_ENABLED: 'true',
    });

    const runtime = await startCommercialAutomationWorker(config, {
      infrastructureFactory: () => infrastructure as never,
      workerFactory: workerFactory as never,
      logger: { info: vi.fn(), error: vi.fn() },
    });

    expect(scheduler.register).toHaveBeenCalledOnce();
    expect(scheduler.register).toHaveBeenCalledWith({
      enabled: true,
      cronExpression: '0 9 * * *',
      timezone: 'America/Sao_Paulo',
      mode: 'preview',
      jobId: 'scheduled-commercial-automation',
    });
    expect(scheduler.register).not.toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'scheduled-pipeline-product' }),
    );
    expect(workerFactory).toHaveBeenCalledOnce();
    await runtime.close();
  });

  it('desabilitado remove somente o Scheduler comercial conhecido', async () => {
    const { scheduler, infrastructure } = createInfrastructure();
    const workerFactory = vi.fn(() => ({
      worker: {},
      close: vi.fn(async () => undefined),
    }));

    const runtime = await startCommercialAutomationWorker(loadConfig(baseEnv), {
      infrastructureFactory: () => infrastructure as never,
      workerFactory: workerFactory as never,
      logger: { info: vi.fn(), error: vi.fn() },
    });

    expect(scheduler.remove).toHaveBeenCalledOnce();
    expect(scheduler.remove).toHaveBeenCalledWith(
      DEFAULT_COMMERCIAL_AUTOMATION_SCHEDULER_JOB_ID,
    );
    expect(scheduler.remove).not.toHaveBeenCalledWith(
      'scheduled-pipeline-product',
    );
    await runtime.close();
  });

  it('usa concorrencia 1', () => {
    expect(COMMERCIAL_AUTOMATION_WORKER_CONCURRENCY).toBe(1);
  });
});

describe('processCommercialAutomationJob', () => {
  it('ignora job desconhecido', async () => {
    const executeTick = vi.fn();
    await expect(
      processCommercialAutomationJob(
        { id: 'job-1', name: 'pipeline-product', data: { mode: 'preview' } },
        {
          orchestrator: { executeTick } as never,
          provider: 'mock',
          mode: 'preview',
        },
      ),
    ).resolves.toEqual({ skipped: true });
    expect(executeTick).not.toHaveBeenCalled();
  });

  it('processa somente commercial-automation-tick com identidade BullMQ', async () => {
    const executeTick = vi.fn(async () => ({ status: 'preview-ready' }));
    await processCommercialAutomationJob(
      {
        id: 'job-1',
        name: JOB_NAMES.commercialAutomationTick,
        data: { mode: 'preview' },
      },
      {
        orchestrator: { executeTick } as never,
        provider: 'mock',
        mode: 'preview',
      },
    );
    expect(executeTick).toHaveBeenCalledOnce();
    expect(executeTick).toHaveBeenCalledWith({
      schedulerJobId: 'scheduled-commercial-automation',
      bullMqJobId: 'job-1',
      mode: 'preview',
      provider: 'mock',
    });
  });

  it('falha fechado quando o job comercial nao possui identidade BullMQ', async () => {
    const executeTick = vi.fn();
    await expect(
      processCommercialAutomationJob(
        {
          id: undefined,
          name: JOB_NAMES.commercialAutomationTick,
          data: { mode: 'preview' },
        },
        {
          orchestrator: { executeTick } as never,
          provider: 'mock',
          mode: 'preview',
        },
      ),
    ).rejects.toMatchObject({
      code: 'COMMERCIAL_AUTOMATION_JOB_ID_REQUIRED',
    });
    expect(executeTick).not.toHaveBeenCalled();
  });

  it('bloqueia job cujo modo diverge da configuracao carregada', async () => {
    const executeTick = vi.fn();
    await expect(
      processCommercialAutomationJob(
        {
          id: 'job-stale-send',
          name: JOB_NAMES.commercialAutomationTick,
          data: { mode: 'send' },
        },
        {
          orchestrator: { executeTick } as never,
          provider: 'mock',
          mode: 'preview',
        },
      ),
    ).rejects.toMatchObject({
      code: 'COMMERCIAL_AUTOMATION_JOB_MODE_MISMATCH',
    });
    expect(executeTick).not.toHaveBeenCalled();
  });

  it('usa o planner no tick global quando ele esta composto', async () => {
    const executeTick = vi.fn();
    const plan = vi.fn(async () => ({ slots: [] }));
    const enqueue = vi.fn(async () => undefined);
    await processCommercialAutomationJob(
      {
        id: 'planner-tick-1',
        name: JOB_NAMES.commercialAutomationTick,
        data: { mode: 'send' },
      },
      {
        orchestrator: { executeTick } as never,
        planner: { plan },
        enqueueTarget: enqueue,
        provider: 'official',
        mode: 'send',
      },
    );

    expect(plan).toHaveBeenCalledOnce();
    expect(plan).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'send', enqueue }),
    );
    expect(executeTick).not.toHaveBeenCalled();
  });

  it('bloqueia job target stale antes do orchestrator', async () => {
    const executeTick = vi.fn();
    const target = {
      campaignId: 'campaign-a',
      groupId: 'group-a',
      logicalGroupFingerprint: 'fingerprint-a',
      instanceName: 'instance-a',
      scheduledFor: '2026-08-24T12:00:00.000Z',
      slotKey: 'slot-a',
      scheduleRevision: 2,
    };
    await expect(
      processCommercialAutomationJob(
        {
          id: 'commercial-target-slot-a',
          name: JOB_NAMES.commercialAutomationTarget,
          data: { mode: 'send', kind: 'target', target },
        },
        {
          orchestrator: { executeTick } as never,
          provider: 'official',
          mode: 'send',
          getScheduleRevision: vi.fn(async () => 3),
        },
      ),
    ).resolves.toEqual({ skipped: true, reason: 'SCHEDULE_REVISION_STALE' });
    expect(executeTick).not.toHaveBeenCalled();
  });

  it('mantem o precheck como fast-path e fecha a race na aceitacao atomica', async () => {
    const revision = { value: 5 };
    let createdExecutions = 0;
    const getScheduleRevision = vi.fn(async () => revision.value);
    const atomicStart = vi.fn(async (expectedScheduleRevision: number) => {
      if (expectedScheduleRevision !== revision.value) {
        throw new AppError(
          'A agenda comercial mudou antes da aceitacao da execucao',
          'SCHEDULE_REVISION_STALE',
        );
      }
      createdExecutions += 1;
    });
    const executeTick = vi.fn(
      async (input: { targetConstraint?: { scheduleRevision: number } }) => {
        revision.value = 6;
        await atomicStart(input.targetConstraint!.scheduleRevision);
        return { status: 'preview-ready' };
      },
    );
    const target = {
      campaignId: 'campaign-a',
      groupId: 'group-a',
      logicalGroupFingerprint: 'fingerprint-a',
      instanceName: 'instance-a',
      scheduledFor: '2026-08-24T12:00:00.000Z',
      slotKey: 'slot-race',
      scheduleRevision: 5,
    };

    await expect(
      processCommercialAutomationJob(
        {
          id: 'commercial-target-slot-race',
          name: JOB_NAMES.commercialAutomationTarget,
          data: { mode: 'preview', kind: 'target', target },
        },
        {
          orchestrator: { executeTick } as never,
          provider: 'mock',
          mode: 'preview',
          getScheduleRevision,
        },
      ),
    ).rejects.toMatchObject({ code: 'SCHEDULE_REVISION_STALE' });

    expect(getScheduleRevision).toHaveBeenCalledOnce();
    expect(executeTick).toHaveBeenCalledWith(
      expect.objectContaining({
        targetConstraint: expect.objectContaining({ scheduleRevision: 5 }),
      }),
    );
    expect(atomicStart).toHaveBeenCalledWith(5);
    expect(createdExecutions).toBe(0);
  });

  it('transporta target constraint no job target atual', async () => {
    const executeTick = vi.fn(async () => ({ status: 'preview-ready' }));
    const target = {
      campaignId: 'campaign-a',
      groupId: 'group-a',
      logicalGroupFingerprint: 'fingerprint-a',
      instanceName: 'instance-a',
      scheduledFor: '2026-08-24T00:00:00.000Z',
      slotKey: 'slot-a',
      scheduleRevision: 2,
    };
    await processCommercialAutomationJob(
      {
        id: 'commercial-target-slot-a',
        name: JOB_NAMES.commercialAutomationTarget,
        data: { mode: 'send', kind: 'target', target },
      },
      {
        orchestrator: { executeTick } as never,
        provider: 'official',
        mode: 'send',
        getScheduleRevision: vi.fn(async () => 2),
      },
    );
    expect(executeTick).toHaveBeenCalledWith(
      expect.objectContaining({ targetConstraint: target }),
    );
  });

  it('rejeita payload target incompleto antes do orchestrator', async () => {
    const executeTick = vi.fn();
    await expect(
      processCommercialAutomationJob(
        {
          id: 'commercial-target-invalid',
          name: JOB_NAMES.commercialAutomationTarget,
          data: {
            mode: 'send',
            kind: 'target',
            target: {
              campaignId: '',
              groupId: 'group-a',
              logicalGroupFingerprint: 'fingerprint-a',
              instanceName: 'instance-a',
              scheduledFor: '2026-08-24T12:00:00.000Z',
              slotKey: 'slot-invalid',
              scheduleRevision: 2,
            },
          },
        },
        {
          orchestrator: { executeTick } as never,
          provider: 'official',
          mode: 'send',
        },
      ),
    ).rejects.toMatchObject({
      code: 'COMMERCIAL_AUTOMATION_TARGET_CONSTRAINT_INVALID',
    });
    expect(executeTick).not.toHaveBeenCalled();
  });
});
