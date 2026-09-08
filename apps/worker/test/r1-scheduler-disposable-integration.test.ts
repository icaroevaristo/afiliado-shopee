import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '@shopee-auto-affiliate-ai/config';
import {
  createCommercialAutomationQueue,
  createRedisConnection,
  DEFAULT_COMMERCIAL_AUTOMATION_SCHEDULER_JOB_ID,
} from '@shopee-auto-affiliate-ai/queue';

import { startCommercialAutomationWorker } from '../src/commercial-automation-worker';

const enabled = process.env.RUN_R1_SCHEDULER_DB_REDIS_TEST === 'true';

describe.skipIf(!enabled)('R1 scheduler singleton on disposable Redis', () => {
  const redisUrl = process.env.REDIS_URL ?? '';
  const databaseUrl = process.env.DATABASE_URL ?? '';
  const connection = createRedisConnection(redisUrl);
  const queue = createCommercialAutomationQueue(connection);

  afterEach(async () => {
    await queue.removeJobScheduler(DEFAULT_COMMERCIAL_AUTOMATION_SCHEDULER_JOB_ID);
  });

  it('converges bootstrap, restart and concurrent registration to one logical scheduler', async () => {
    await queue.waitUntilReady();
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
    const list = async () =>
      (await queue.getJobSchedulers(0, -1, true)).filter(
        (scheduler) => scheduler.key === DEFAULT_COMMERCIAL_AUTOMATION_SCHEDULER_JOB_ID,
      );

    expect(await list()).toHaveLength(0);
    const first = await startCommercialAutomationWorker(config, options);
    const afterFirst = await list();
    await first.close();
    const second = await startCommercialAutomationWorker(config, options);
    const afterRestart = await list();
    await second.close();
    const concurrent = await Promise.all([
      startCommercialAutomationWorker(config, options),
      startCommercialAutomationWorker(config, options),
    ]);
    const afterConcurrent = await list();
    await Promise.all(concurrent.map((runtime) => runtime.close()));

    expect(afterFirst).toHaveLength(1);
    expect(afterRestart).toHaveLength(1);
    expect(afterConcurrent).toHaveLength(1);
    expect(afterRestart[0]).toMatchObject({
      key: DEFAULT_COMMERCIAL_AUTOMATION_SCHEDULER_JOB_ID,
      name: afterFirst[0]?.name,
      pattern: afterFirst[0]?.pattern,
      tz: afterFirst[0]?.tz,
      template: { data: { mode: 'preview' } },
    });
  });
});
