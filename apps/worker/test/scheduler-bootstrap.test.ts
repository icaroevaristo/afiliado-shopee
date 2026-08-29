import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '@shopee-auto-affiliate-ai/config';
import { MockWhatsAppProvider } from '@shopee-auto-affiliate-ai/providers';
import {
  DEFAULT_PIPELINE_SCHEDULER_JOB_ID,
  type PipelineSchedulerState,
} from '@shopee-auto-affiliate-ai/queue';
import { processPipelineProductJob, startWorker } from '../src/index';

const baseEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://localhost:5432/app',
  REDIS_URL: 'redis://localhost:6379',
};

const legacyWorkerConfig = (env: NodeJS.ProcessEnv = baseEnv): ReturnType<
  typeof loadConfig
> => ({
  ...loadConfig(env),
  COMMERCIAL_AUTOMATION_MODE: 'send',
});

const schedulerState = (
  status: PipelineSchedulerState['status'],
): PipelineSchedulerState => ({
  jobId: DEFAULT_PIPELINE_SCHEDULER_JOB_ID,
  status,
  cronExpression: status === 'registered' ? '0 9 * * *' : null,
  timezone: status === 'registered' ? 'America/Sao_Paulo' : null,
  nextRunAt: null,
});

const createHarness = () => {
  const logger = { info: vi.fn(), error: vi.fn() };
  const scheduler = {
    register: vi.fn(async () => schedulerState('registered')),
    remove: vi.fn(async () => schedulerState('not-registered')),
    getState: vi.fn(),
  };
  const infrastructure = {
    connection: {} as never,
    scheduler,
    close: vi.fn(async () => undefined),
  };
  const workers = {
    productPipelineWorker: {} as never,
    whatsappDispatchWorker: {} as never,
    close: vi.fn(async () => undefined),
  };
  const infrastructureFactory = vi.fn(() => infrastructure);
  const workerFactory = vi.fn(() => workers);

  return {
    logger,
    scheduler,
    infrastructure,
    workers,
    infrastructureFactory,
    workerFactory,
  };
};

describe('worker scheduler bootstrap', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('mantem o scheduler desativado por padrao e remove somente o ID conhecido', async () => {
    const harness = createHarness();
    const config = legacyWorkerConfig();

    await expect(
      startWorker(config, {
        logger: harness.logger,
        infrastructureFactory: harness.infrastructureFactory,
        workerFactory: harness.workerFactory,
      }),
    ).resolves.toBeDefined();

    expect(config.SCHEDULER_ENABLED).toBe(false);
    expect(harness.scheduler.register).not.toHaveBeenCalled();
    expect(harness.scheduler.remove).toHaveBeenCalledTimes(1);
    expect(harness.scheduler.remove).toHaveBeenCalledWith(
      DEFAULT_PIPELINE_SCHEDULER_JOB_ID,
    );
    expect(harness.workerFactory).toHaveBeenCalledTimes(1);
  });

  it('tolera scheduler inexistente e registra o estado desativado', async () => {
    const harness = createHarness();

    await startWorker(legacyWorkerConfig(), {
      logger: harness.logger,
      infrastructureFactory: harness.infrastructureFactory,
      workerFactory: harness.workerFactory,
    });

    expect(harness.logger.info).toHaveBeenCalledWith(
      {
        event: 'worker.scheduler.disabled',
        status: 'disabled',
        schedulerState: 'not-registered',
        jobId: DEFAULT_PIPELINE_SCHEDULER_JOB_ID,
        queue: 'product-pipeline',
      },
      'Pipeline scheduler disabled',
    );
  });

  it('registra uma vez com cron, timezone e jobId estavel quando habilitado', async () => {
    const harness = createHarness();
    const config = legacyWorkerConfig({
      ...baseEnv,
      SCHEDULER_ENABLED: 'true',
      SCHEDULER_CRON: '0 9 * * *',
      SCHEDULER_TIMEZONE: 'America/Sao_Paulo',
    });

    await startWorker(config, {
      logger: harness.logger,
      infrastructureFactory: harness.infrastructureFactory,
      workerFactory: harness.workerFactory,
    });

    expect(harness.infrastructureFactory).toHaveBeenCalledTimes(1);
    expect(harness.scheduler.remove).not.toHaveBeenCalled();
    expect(harness.scheduler.register).toHaveBeenCalledTimes(1);
    expect(harness.scheduler.register).toHaveBeenCalledWith({
      enabled: true,
      cronExpression: '0 9 * * *',
      timezone: 'America/Sao_Paulo',
      jobId: DEFAULT_PIPELINE_SCHEDULER_JOB_ID,
    });
    expect(harness.logger.info).toHaveBeenCalledWith(
      {
        event: 'worker.scheduler.registered',
        status: 'registered',
        cron: '0 9 * * *',
        timezone: 'America/Sao_Paulo',
        jobId: DEFAULT_PIPELINE_SCHEDULER_JOB_ID,
        queue: 'product-pipeline',
      },
      'Pipeline scheduler registered',
    );
  });

  it('nao executa pipeline nem recria scheduler durante o bootstrap ou por job ignorado', async () => {
    const harness = createHarness();
    const hunterProvider = { buscarProdutos: vi.fn() };
    const config = legacyWorkerConfig({
      ...baseEnv,
      SCHEDULER_ENABLED: 'true',
      SCHEDULER_CRON: '0 9 * * *',
      SCHEDULER_TIMEZONE: 'America/Sao_Paulo',
    });

    await startWorker(config, {
      logger: harness.logger,
      hunterProvider,
      infrastructureFactory: harness.infrastructureFactory,
      workerFactory: harness.workerFactory,
    });
    const ignoredJob = {
      id: 'ignored-job',
      name: 'other-job',
      data: {},
      updateProgress: vi.fn(),
    };
    const processorOptions = {
      prisma: {} as never,
      hunterProvider,
      logger: harness.logger,
      whatsAppProvider: new MockWhatsAppProvider(),
    };
    await processPipelineProductJob(ignoredJob as never, processorOptions);
    await processPipelineProductJob(ignoredJob as never, processorOptions);

    expect(hunterProvider.buscarProdutos).not.toHaveBeenCalled();
    expect(harness.infrastructureFactory).toHaveBeenCalledTimes(1);
    expect(harness.scheduler.register).toHaveBeenCalledTimes(1);
  });

  it('falha cedo e fecha a infraestrutura quando o registro falha', async () => {
    const harness = createHarness();
    harness.scheduler.register.mockRejectedValueOnce(
      new Error('redis://user:scheduler-secret@localhost:6379 unavailable'),
    );
    const config = legacyWorkerConfig({
      ...baseEnv,
      SCHEDULER_ENABLED: 'true',
      SCHEDULER_CRON: '0 9 * * *',
      SCHEDULER_TIMEZONE: 'America/Sao_Paulo',
    });

    await expect(
      startWorker(config, {
        logger: harness.logger,
        infrastructureFactory: harness.infrastructureFactory,
        workerFactory: harness.workerFactory,
      }),
    ).rejects.toThrow('unavailable');

    expect(harness.workerFactory).not.toHaveBeenCalled();
    expect(harness.infrastructure.close).toHaveBeenCalledTimes(1);
    expect(harness.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'worker.scheduler.configuration-failed',
        operation: 'register',
        errorType: 'Error',
      }),
      'Pipeline scheduler configuration failed',
    );
    expect(JSON.stringify(harness.logger.error.mock.calls)).not.toContain(
      'scheduler-secret',
    );
  });

  it('falha cedo quando nao consegue remover o scheduler desativado', async () => {
    const harness = createHarness();
    harness.scheduler.remove.mockRejectedValueOnce(
      new Error('redis unavailable'),
    );

    await expect(
      startWorker(legacyWorkerConfig(), {
        logger: harness.logger,
        infrastructureFactory: harness.infrastructureFactory,
        workerFactory: harness.workerFactory,
      }),
    ).rejects.toThrow('redis unavailable');

    expect(harness.workerFactory).not.toHaveBeenCalled();
    expect(harness.infrastructure.close).toHaveBeenCalledTimes(1);
    expect(harness.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'remove' }),
      'Pipeline scheduler configuration failed',
    );
  });

  it('fecha workers e infraestrutura sem remover o agendamento no shutdown', async () => {
    const harness = createHarness();
    const runtime = await startWorker(
      legacyWorkerConfig({
        ...baseEnv,
        SCHEDULER_ENABLED: 'true',
        SCHEDULER_CRON: '0 9 * * *',
        SCHEDULER_TIMEZONE: 'America/Sao_Paulo',
      }),
      {
        logger: harness.logger,
        infrastructureFactory: harness.infrastructureFactory,
        workerFactory: harness.workerFactory,
      },
    );

    await runtime.close();
    await runtime.close();

    expect(harness.workers.close).toHaveBeenCalledTimes(1);
    expect(harness.infrastructure.close).toHaveBeenCalledTimes(1);
    expect(harness.scheduler.remove).not.toHaveBeenCalled();
  });

  it('mantem o modo mock sem requests HTTP reais no bootstrap', async () => {
    const harness = createHarness();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await startWorker(legacyWorkerConfig(), {
      logger: harness.logger,
      infrastructureFactory: harness.infrastructureFactory,
      workerFactory: harness.workerFactory,
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(harness.workerFactory).toHaveBeenCalledWith(
      baseEnv.REDIS_URL,
      expect.objectContaining({
        whatsAppProvider: expect.any(MockWhatsAppProvider),
      }),
    );
  });

  it('executa recovery antes do scheduler e dos consumidores no entrypoint legado', async () => {
    const harness = createHarness();
    const order: string[] = [];
    harness.scheduler.remove.mockImplementation(async () => {
      order.push('scheduler');
      return schedulerState('not-registered');
    });
    harness.workerFactory.mockImplementation(() => {
      order.push('workers');
      return harness.workers;
    });

    await startWorker(legacyWorkerConfig(), {
      recoveryCoordinator: {
        run: vi.fn(async () => {
          order.push('recovery');
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
            ambiguitiesPreserved: 0,
          };
        }),
      },
      logger: harness.logger,
      infrastructureFactory: harness.infrastructureFactory,
      workerFactory: harness.workerFactory,
    });

    expect(order).toEqual(['recovery', 'scheduler', 'workers']);
  });
});
