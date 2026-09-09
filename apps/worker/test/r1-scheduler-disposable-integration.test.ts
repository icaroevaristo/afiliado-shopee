import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '@shopee-auto-affiliate-ai/config';
import {
  COMMERCIAL_AUTOMATION_HEARTBEAT_CRON,
  COMMERCIAL_AUTOMATION_JOB_OPTIONS,
  createCommercialAutomationQueue,
  createRedisConnection,
  DEFAULT_COMMERCIAL_AUTOMATION_SCHEDULER_JOB_ID,
  JOB_NAMES,
} from '@shopee-auto-affiliate-ai/queue';

import { startCommercialAutomationWorker } from '../src/commercial-automation-worker';

const enabled = process.env.RUN_R1_SCHEDULER_DB_REDIS_TEST === 'true';

describe.skipIf(!enabled)('R1 scheduler singleton on disposable Redis', () => {
  let connection: ReturnType<typeof createRedisConnection> | undefined;
  let queue: ReturnType<typeof createCommercialAutomationQueue> | undefined;
  const runtimes: Array<{ close: () => Promise<void> }> = [];

  beforeAll(async () => {
    const redisUrl = process.env.REDIS_URL ?? '';
    const observerConnection = createRedisConnection(redisUrl);
    const observerQueue = createCommercialAutomationQueue(observerConnection);
    try {
      await observerQueue.waitUntilReady();
      connection = observerConnection;
      queue = observerQueue;
    } catch (error) {
      await observerQueue.close().catch(() => undefined);
      await observerConnection.quit().catch(() => undefined);
      throw error;
    }
  });

  afterAll(async () => {
    await Promise.allSettled(runtimes.map((runtime) => runtime.close()));
    if (queue) {
      await queue.removeJobScheduler(DEFAULT_COMMERCIAL_AUTOMATION_SCHEDULER_JOB_ID).catch(
        () => undefined,
      );
      await queue.close().catch(() => undefined);
    }
    await connection?.quit().catch(() => undefined);
  });

  it('converges bootstrap, restart and concurrent registration to one logical scheduler', async () => {
    const observerQueue = queue;
    if (!observerQueue) {
      throw new Error('R1 scheduler observer queue was not initialized');
    }

    const redisUrl = process.env.REDIS_URL ?? '';
    const databaseUrl = process.env.DATABASE_URL ?? '';
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      REDIS_URL: redisUrl,
      COMMERCIAL_AUTOMATION_MODE: 'preview',
      COMMERCIAL_AUTOMATION_ENABLED: 'false',
      COMMERCIAL_SCHEDULER_ENABLED: 'true',
      SCHEDULER_ENABLED: 'false',
      SHOPEE_AFFILIATE_PROVIDER: 'mock',
      SHOPEE_AFFILIATE_API_ENABLED: 'false',
      SHOPEE_OFFICIAL_CATALOG_SYNC_ENABLED: 'false',
      COMMERCIAL_AI_COPY_ENABLED: 'false',
      WHATSAPP_PROVIDER: 'mock',
      WHATSAPP_GROUP_SEND_ENABLED: 'false',
      EVOLUTION_SAFE_MODE: 'true',
    });
    const workerFactory = () => ({ worker: {}, close: async () => undefined });
    const options = {
      workerFactory: workerFactory as never,
      logger: { info: () => undefined, error: () => undefined },
    };
    const listAll = () => observerQueue.getJobSchedulers(0, -1, true);
    const assertSingleExpectedScheduler = (schedulers: Awaited<ReturnType<typeof listAll>>) => {
      expect(schedulers).toHaveLength(1);
      expect(schedulers[0]).toMatchObject({
        key: DEFAULT_COMMERCIAL_AUTOMATION_SCHEDULER_JOB_ID,
        name: JOB_NAMES.commercialAutomationTick,
        pattern: COMMERCIAL_AUTOMATION_HEARTBEAT_CRON,
        tz: config.COMMERCIAL_SCHEDULER_TIMEZONE,
        template: {
          data: { mode: 'preview' },
          opts: COMMERCIAL_AUTOMATION_JOB_OPTIONS,
        },
      });
    };

    const baseline = await listAll();
    expect(baseline).toHaveLength(0);
    const first = await startCommercialAutomationWorker(config, options);
    runtimes.push(first);
    const afterFirst = await listAll();
    assertSingleExpectedScheduler(afterFirst);
    await first.close();
    const second = await startCommercialAutomationWorker(config, options);
    runtimes.push(second);
    const afterRestart = await listAll();
    assertSingleExpectedScheduler(afterRestart);
    await second.close();
    const concurrent = await Promise.all([
      startCommercialAutomationWorker(config, options),
      startCommercialAutomationWorker(config, options),
    ]);
    runtimes.push(...concurrent);
    const afterConcurrent = await listAll();
    assertSingleExpectedScheduler(afterConcurrent);

    console.info(
      JSON.stringify({
        event: 'r1-scheduler-singleton-evidence',
        allSchedulersBaselineCount: baseline.length,
        allSchedulersAfterStartCount: afterFirst.length,
        allSchedulersAfterRestartCount: afterRestart.length,
        allSchedulersAfterConcurrentCount: afterConcurrent.length,
        duplicateLogicalSchedulers: Math.max(afterConcurrent.length - 1, 0),
        scheduler: afterConcurrent[0],
      }),
    );
  });
});
