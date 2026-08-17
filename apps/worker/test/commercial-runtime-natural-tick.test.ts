import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BullMqCommercialAutomationScheduler,
  COMMERCIAL_AUTOMATION_JOB_OPTIONS,
  DEFAULT_COMMERCIAL_AUTOMATION_SCHEDULER_JOB_ID,
  JOB_NAMES,
  type BullMqCommercialAutomationSchedulerQueue,
} from '@shopee-auto-affiliate-ai/queue';

import type { CommercialAutomationTickResult } from '../../api/src/commercial-automation-orchestrator';
import { processCommercialAutomationJob } from '../src/commercial-automation-worker';

type SchedulerRecord = Awaited<
  ReturnType<BullMqCommercialAutomationSchedulerQueue['getJobScheduler']>
>;

const START = Date.parse('2026-08-17T12:00:00.000Z');
const DUE = START + 60_000;

const previewTickResult = (): CommercialAutomationTickResult => ({
  executionId: 'execution-phase10',
  mode: 'preview',
  status: 'preview-ready',
  reasons: [],
  commercialRunId: 'run-phase10',
  dispatchCreated: false,
  whatsappJobCreated: false,
  messageSent: false,
});

const createNaturalTickQueue = (
  executeTick: () => Promise<CommercialAutomationTickResult>,
) => {
  let record: SchedulerRecord;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const queue: BullMqCommercialAutomationSchedulerQueue = {
    upsertJobScheduler: vi.fn(async (id, repeat, template) => {
      record = {
        key: id,
        name: template.name,
        pattern: repeat.pattern,
        tz: repeat.tz,
        next: DUE,
        template: { data: template.data, opts: template.opts },
      };
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void processCommercialAutomationJob(
          {
            id: `repeat:${id}:${DUE}`,
            name: template.name,
            data: template.data,
          },
          {
            orchestrator: { executeTick },
            provider: 'mock',
            mode: 'preview',
          },
        );
      }, DUE - Date.now());
    }),
    getJobScheduler: vi.fn(async () => record),
    removeJobScheduler: vi.fn(async () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      record = undefined;
      return true;
    }),
  };
  return queue;
};

describe('Phase 10 commercial runtime natural tick', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('wakes naturally at nextRunAt and processes exactly one logical tick', async () => {
    const executeTick = vi.fn(async () => previewTickResult());
    const queue = createNaturalTickQueue(executeTick);
    const scheduler = new BullMqCommercialAutomationScheduler(queue);

    const state = await scheduler.register({
      enabled: true,
      cronExpression: '* * * * *',
      timezone: 'America/Sao_Paulo',
      mode: 'preview',
      jobId: DEFAULT_COMMERCIAL_AUTOMATION_SCHEDULER_JOB_ID,
    });

    expect(state.nextRunAt).toBe(new Date(DUE).toISOString());
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      DEFAULT_COMMERCIAL_AUTOMATION_SCHEDULER_JOB_ID,
      { pattern: '* * * * *', tz: 'America/Sao_Paulo' },
      {
        name: JOB_NAMES.commercialAutomationTick,
        data: { mode: 'preview' },
        opts: COMMERCIAL_AUTOMATION_JOB_OPTIONS,
      },
    );

    await vi.advanceTimersByTimeAsync(59_999);
    expect(executeTick).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(executeTick).toHaveBeenCalledOnce();
    expect(executeTick).toHaveBeenCalledWith({
      schedulerJobId: DEFAULT_COMMERCIAL_AUTOMATION_SCHEDULER_JOB_ID,
      bullMqJobId: `repeat:${DEFAULT_COMMERCIAL_AUTOMATION_SCHEDULER_JOB_ID}:${DUE}`,
      mode: 'preview',
      provider: 'mock',
    });
  });

  it('two scheduler owners and a restart converge on one scheduler identity and one tick', async () => {
    const executeTick = vi.fn(async () => previewTickResult());
    const queue = createNaturalTickQueue(executeTick);
    const first = new BullMqCommercialAutomationScheduler(queue);
    const second = new BullMqCommercialAutomationScheduler(queue);
    const config = {
      enabled: true,
      cronExpression: '* * * * *',
      timezone: 'America/Sao_Paulo',
      mode: 'preview' as const,
      jobId: DEFAULT_COMMERCIAL_AUTOMATION_SCHEDULER_JOB_ID,
    };

    await Promise.all([first.register(config), second.register(config)]);
    await new BullMqCommercialAutomationScheduler(queue).register(config);

    expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(2);
    expect(await queue.getJobScheduler(DEFAULT_COMMERCIAL_AUTOMATION_SCHEDULER_JOB_ID)).toMatchObject({
      key: DEFAULT_COMMERCIAL_AUTOMATION_SCHEDULER_JOB_ID,
      name: JOB_NAMES.commercialAutomationTick,
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(executeTick).toHaveBeenCalledOnce();
  });

  it('disabled scheduler removes the known identity and never wakes', async () => {
    const executeTick = vi.fn(async () => previewTickResult());
    const queue = createNaturalTickQueue(executeTick);
    const scheduler = new BullMqCommercialAutomationScheduler(queue);
    await scheduler.register({
      enabled: true,
      cronExpression: '* * * * *',
      timezone: 'America/Sao_Paulo',
      mode: 'preview',
      jobId: DEFAULT_COMMERCIAL_AUTOMATION_SCHEDULER_JOB_ID,
    });
    await scheduler.remove(DEFAULT_COMMERCIAL_AUTOMATION_SCHEDULER_JOB_ID);

    await vi.advanceTimersByTimeAsync(120_000);
    expect(executeTick).not.toHaveBeenCalled();
    expect(queue.removeJobScheduler).toHaveBeenCalledWith(
      DEFAULT_COMMERCIAL_AUTOMATION_SCHEDULER_JOB_ID,
    );
  });
});