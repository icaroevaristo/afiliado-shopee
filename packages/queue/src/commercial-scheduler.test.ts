import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BullMqCommercialAutomationScheduler,
  COMMERCIAL_AUTOMATION_JOB_OPTIONS,
  DEFAULT_COMMERCIAL_AUTOMATION_SCHEDULER_JOB_ID,
  JOB_NAMES,
  QUEUE_NAMES,
  type BullMqCommercialAutomationSchedulerQueue,
} from './index';

const createQueue = () => {
  let scheduler: Awaited<
    ReturnType<BullMqCommercialAutomationSchedulerQueue['getJobScheduler']>
  >;
  const queue: BullMqCommercialAutomationSchedulerQueue = {
    upsertJobScheduler: vi.fn(async (id, repeat, template) => {
      scheduler = {
        key: id,
        name: template.name,
        pattern: repeat.pattern,
        tz: repeat.tz,
        next: Date.parse('2026-07-27T12:00:00.000Z'),
        template: { data: template.data, opts: template.opts },
      } as never;
    }),
    getJobScheduler: vi.fn(async () => scheduler),
    removeJobScheduler: vi.fn(async () => {
      scheduler = undefined;
      return true;
    }),
  };
  return queue;
};

describe('BullMqCommercialAutomationScheduler', () => {
  let queue: ReturnType<typeof createQueue>;

  beforeEach(() => {
    queue = createQueue();
  });

  it('registra somente o job comercial com ID e opcoes estaveis', async () => {
    const scheduler = new BullMqCommercialAutomationScheduler(queue);
    const result = await scheduler.register({
      enabled: true,
      cronExpression: '0 9 * * *',
      timezone: 'America/Sao_Paulo',
      mode: 'preview',
      jobId: DEFAULT_COMMERCIAL_AUTOMATION_SCHEDULER_JOB_ID,
    });

    expect(QUEUE_NAMES.commercialAutomation).toBe('commercial-automation');
    expect(JOB_NAMES.commercialAutomationTick).toBe(
      'commercial-automation-tick',
    );
    expect(DEFAULT_COMMERCIAL_AUTOMATION_SCHEDULER_JOB_ID).toBe(
      'scheduled-commercial-automation',
    );
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'scheduled-commercial-automation',
      { pattern: '0 9 * * *', tz: 'America/Sao_Paulo' },
      {
        name: 'commercial-automation-tick',
        data: { mode: 'preview' },
        opts: COMMERCIAL_AUTOMATION_JOB_OPTIONS,
      },
    );
    expect(COMMERCIAL_AUTOMATION_JOB_OPTIONS).toEqual({
      attempts: 1,
      removeOnComplete: false,
      removeOnFail: false,
    });
    expect(COMMERCIAL_AUTOMATION_JOB_OPTIONS).not.toHaveProperty('backoff');
    expect(result).toMatchObject({
      status: 'registered',
      mode: 'preview',
    });
  });

  it('exposes deterministic nextRunAt from the registered BullMQ scheduler state', async () => {
    const scheduler = new BullMqCommercialAutomationScheduler(queue);
    await expect(
      scheduler.register({
        enabled: true,
        cronExpression: '0 9 * * *',
        timezone: 'America/Sao_Paulo',
        mode: 'preview',
        jobId: DEFAULT_COMMERCIAL_AUTOMATION_SCHEDULER_JOB_ID,
      }),
    ).resolves.toMatchObject({
      nextRunAt: '2026-07-27T12:00:00.000Z',
      cronExpression: '0 9 * * *',
      timezone: 'America/Sao_Paulo',
    });
  });

  it('keeps nextRunAt null when the commercial scheduler is disabled', async () => {
    const scheduler = new BullMqCommercialAutomationScheduler(queue);
    await expect(
      scheduler.register({
        enabled: false,
        cronExpression: '0 9 * * *',
        timezone: 'America/Sao_Paulo',
        mode: 'preview',
        jobId: DEFAULT_COMMERCIAL_AUTOMATION_SCHEDULER_JOB_ID,
      }),
    ).resolves.toMatchObject({ status: 'disabled', nextRunAt: null });
    expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
  });
  it('nao altera o Scheduler quando o contrato ja coincide', async () => {
    const scheduler = new BullMqCommercialAutomationScheduler(queue);
    const config = {
      enabled: true,
      cronExpression: '0 9 * * *',
      timezone: 'America/Sao_Paulo',
      mode: 'preview' as const,
      jobId: DEFAULT_COMMERCIAL_AUTOMATION_SCHEDULER_JOB_ID,
    };
    await scheduler.register(config);
    await scheduler.register(config);
    expect(queue.upsertJobScheduler).toHaveBeenCalledOnce();
  });

  it('remove somente o ID comercial informado', async () => {
    const scheduler = new BullMqCommercialAutomationScheduler(queue);
    await scheduler.remove(DEFAULT_COMMERCIAL_AUTOMATION_SCHEDULER_JOB_ID);
    expect(queue.removeJobScheduler).toHaveBeenCalledOnce();
    expect(queue.removeJobScheduler).toHaveBeenCalledWith(
      'scheduled-commercial-automation',
    );
    expect(queue.removeJobScheduler).not.toHaveBeenCalledWith(
      'scheduled-pipeline-product',
    );
  });
});
