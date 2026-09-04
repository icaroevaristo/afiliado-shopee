import { Queue, type JobSchedulerJson, type JobsOptions } from 'bullmq';
import IORedis from 'ioredis';
import type { ProductFilters } from '@shopee-auto-affiliate-ai/shared';
import type {
  PipelineScheduler,
  PipelineSchedulerState,
  SchedulerConfig,
} from './scheduler';
import type {
  CommercialAutomationMode,
  CommercialAutomationScheduler,
  CommercialAutomationSchedulerConfig,
  CommercialAutomationSchedulerState,
} from './commercial-scheduler';

export type { JobsOptions };
export type {
  PipelineScheduler,
  PipelineSchedulerState,
  PipelineSchedulerStatus,
  SchedulerConfig,
} from './scheduler';
export type {
  CommercialAutomationMode,
  CommercialAutomationScheduler,
  CommercialAutomationSchedulerConfig,
  CommercialAutomationSchedulerState,
  CommercialAutomationSchedulerStatus,
} from './commercial-scheduler';

export const QUEUE_NAMES = {
  productPipeline: 'product-pipeline',
  whatsappDispatch: 'whatsapp-dispatch',
  commercialAutomation: 'commercial-automation',
} as const;

export const JOB_NAMES = {
  pipelineProduct: 'pipeline-product',
  whatsappDispatch: 'whatsapp-dispatch',
  commercialAutomationTick: 'commercial-automation-tick',
  commercialAutomationTarget: 'commercial-automation-target',
} as const;

export const DEFAULT_PIPELINE_SCHEDULER_JOB_ID = 'scheduled-pipeline-product';
export const DEFAULT_COMMERCIAL_AUTOMATION_SCHEDULER_JOB_ID =
  'scheduled-commercial-automation';

export const DEFAULT_WHATSAPP_DISPATCH_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1_000 },
  removeOnComplete: { count: 1_000 },
  removeOnFail: { count: 1_000 },
};

export const CONTROLLED_E2E_WHATSAPP_DISPATCH_JOB_OPTIONS: JobsOptions = {
  attempts: 1,
  removeOnComplete: false,
  removeOnFail: false,
};

export const COMMERCIAL_AUTOMATION_JOB_OPTIONS: JobsOptions = {
  attempts: 1,
  removeOnComplete: false,
  removeOnFail: false,
};

export const createRedisConnection = (url: string) =>
  new IORedis(url, { maxRetriesPerRequest: null });

export const createProductPipelineQueue = (connection: IORedis) =>
  new Queue<PipelineProductJob>(QUEUE_NAMES.productPipeline, { connection });

export const createWhatsAppDispatchQueue = (connection: IORedis) =>
  new Queue<WhatsAppDispatchJob>(QUEUE_NAMES.whatsappDispatch, { connection });

export const createCommercialAutomationQueue = (connection: IORedis) =>
  new Queue<CommercialAutomationJob>(QUEUE_NAMES.commercialAutomation, {
    connection,
  });

export type PipelineProductJob = { filters?: ProductFilters };
export type WhatsAppDispatchJob = {
  dispatchId: string;
  instanceName?: string;
  routingCertification?: true;
};
export type CommercialAutomationTargetConstraint = {
  campaignId: string;
  groupId: string;
  logicalGroupFingerprint: string;
  instanceName: string;
  scheduledFor: string;
  slotKey: string;
  scheduleRevision: number;
  assignmentRevision?: number;
};
export type CommercialAutomationJob =
  | { mode: CommercialAutomationMode; kind?: 'planner' }
  | {
      mode: CommercialAutomationMode;
      kind: 'target';
      target: CommercialAutomationTargetConstraint;
    };

export const enqueuePipelineProduct = (
  queue: Queue<PipelineProductJob>,
  data: PipelineProductJob,
  opts?: JobsOptions,
) => queue.add(JOB_NAMES.pipelineProduct, data, opts);

export const enqueueWhatsAppDispatch = (
  queue: Queue<WhatsAppDispatchJob>,
  data: WhatsAppDispatchJob,
  opts?: JobsOptions,
) =>
  queue.add(JOB_NAMES.whatsappDispatch, data, {
    ...DEFAULT_WHATSAPP_DISPATCH_JOB_OPTIONS,
    ...opts,
  });

export const enqueueControlledWhatsAppDispatch = (
  queue: Queue<WhatsAppDispatchJob>,
  data: WhatsAppDispatchJob,
  jobId: string,
) =>
  queue.add(JOB_NAMES.whatsappDispatch, data, {
    ...CONTROLLED_E2E_WHATSAPP_DISPATCH_JOB_OPTIONS,
    jobId,
  });

export const enqueueCommercialAutomationTarget = (
  queue: Queue<CommercialAutomationJob>,
  data: Extract<CommercialAutomationJob, { kind: 'target' }>,
  jobId: string,
  delay: number,
) =>
  queue.add(JOB_NAMES.commercialAutomationTarget, data, {
    ...COMMERCIAL_AUTOMATION_JOB_OPTIONS,
    jobId,
    delay,
  });

export const enqueueControlledE2EWhatsAppDispatch =
  enqueueControlledWhatsAppDispatch;

export type BullMqPipelineSchedulerQueue = {
  upsertJobScheduler: (
    jobSchedulerId: string,
    repeatOptions: { pattern: string; tz: string },
    template: {
      name: typeof JOB_NAMES.pipelineProduct;
      data: PipelineProductJob;
    },
  ) => Promise<unknown>;
  getJobScheduler: (
    jobSchedulerId: string,
  ) => Promise<JobSchedulerJson<PipelineProductJob> | undefined>;
  removeJobScheduler: (jobSchedulerId: string) => Promise<boolean>;
};

const filtersAreEqual = (left?: ProductFilters, right?: ProductFilters) => {
  const leftEntries = Object.entries(left ?? {});
  const rightEntries = Object.entries(right ?? {});
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(
      ([key, value]) => right?.[key as keyof ProductFilters] === value,
    )
  );
};

const toSchedulerState = (
  jobId: string,
  scheduler?: JobSchedulerJson<PipelineProductJob>,
): PipelineSchedulerState => {
  if (!scheduler) {
    return {
      jobId,
      status: 'not-registered',
      cronExpression: null,
      timezone: null,
      nextRunAt: null,
    };
  }

  return {
    jobId,
    status: 'registered',
    cronExpression: scheduler.pattern ?? null,
    timezone: scheduler.tz ?? null,
    filters: scheduler.template?.data?.filters,
    nextRunAt: scheduler.next ? new Date(scheduler.next).toISOString() : null,
  };
};

export class BullMqPipelineScheduler implements PipelineScheduler {
  constructor(private readonly queue: BullMqPipelineSchedulerQueue) {}

  async register(config: SchedulerConfig): Promise<PipelineSchedulerState> {
    if (!config.enabled) {
      return {
        jobId: config.jobId,
        status: 'disabled',
        cronExpression: config.cronExpression ?? null,
        timezone: config.timezone ?? null,
        filters: config.filters,
        nextRunAt: null,
      };
    }

    const existing = await this.queue.getJobScheduler(config.jobId);
    const alreadyRegistered =
      existing?.name === JOB_NAMES.pipelineProduct &&
      existing.pattern === config.cronExpression &&
      existing.tz === config.timezone &&
      filtersAreEqual(existing.template?.data?.filters, config.filters);

    if (!alreadyRegistered) {
      await this.queue.upsertJobScheduler(
        config.jobId,
        { pattern: config.cronExpression, tz: config.timezone },
        {
          name: JOB_NAMES.pipelineProduct,
          data: { filters: config.filters },
        },
      );
    }

    return this.getState(config.jobId);
  }

  async remove(jobId: string): Promise<PipelineSchedulerState> {
    await this.queue.removeJobScheduler(jobId);
    return this.getState(jobId);
  }

  async getState(jobId: string): Promise<PipelineSchedulerState> {
    return toSchedulerState(jobId, await this.queue.getJobScheduler(jobId));
  }
}

export const createBullMqPipelineScheduler = (
  queue: Queue<PipelineProductJob>,
) => new BullMqPipelineScheduler(queue);

type CommercialJobSchedulerJson = JobSchedulerJson<CommercialAutomationJob> & {
  template?: {
    data?: CommercialAutomationJob;
    opts?: JobsOptions;
  };
};

export type BullMqCommercialAutomationSchedulerQueue = {
  upsertJobScheduler: (
    jobSchedulerId: string,
    repeatOptions: { pattern: string; tz: string },
    template: {
      name: typeof JOB_NAMES.commercialAutomationTick;
      data: CommercialAutomationJob;
      opts: JobsOptions;
    },
  ) => Promise<unknown>;
  getJobScheduler: (
    jobSchedulerId: string,
  ) => Promise<CommercialJobSchedulerJson | undefined>;
  removeJobScheduler: (jobSchedulerId: string) => Promise<boolean>;
};

const toCommercialSchedulerState = (
  jobId: string,
  mode: CommercialAutomationMode,
  scheduler?: CommercialJobSchedulerJson,
): CommercialAutomationSchedulerState => ({
  jobId,
  status: scheduler ? 'registered' : 'not-registered',
  cronExpression: scheduler?.pattern ?? null,
  timezone: scheduler?.tz ?? null,
  mode: scheduler?.template?.data?.mode ?? mode,
  nextRunAt: scheduler?.next ? new Date(scheduler.next).toISOString() : null,
});

export class BullMqCommercialAutomationScheduler implements CommercialAutomationScheduler {
  constructor(
    private readonly queue: BullMqCommercialAutomationSchedulerQueue,
  ) {}

  async register(
    config: CommercialAutomationSchedulerConfig,
  ): Promise<CommercialAutomationSchedulerState> {
    if (!config.enabled) {
      return {
        jobId: config.jobId,
        status: 'disabled',
        cronExpression: config.cronExpression,
        timezone: config.timezone,
        mode: config.mode,
        nextRunAt: null,
      };
    }
    const existing = await this.queue.getJobScheduler(config.jobId);
    if (
      existing?.name !== JOB_NAMES.commercialAutomationTick ||
      existing.pattern !== config.cronExpression ||
      existing.tz !== config.timezone ||
      existing.template?.data?.mode !== config.mode ||
      existing.template?.opts?.attempts !== 1 ||
      existing.template?.opts?.removeOnComplete !== false ||
      existing.template?.opts?.removeOnFail !== false
    ) {
      await this.queue.upsertJobScheduler(
        config.jobId,
        { pattern: config.cronExpression, tz: config.timezone },
        {
          name: JOB_NAMES.commercialAutomationTick,
          data: { mode: config.mode },
          opts: COMMERCIAL_AUTOMATION_JOB_OPTIONS,
        },
      );
    }
    return this.getState(config.jobId, config.mode);
  }

  async remove(jobId: string) {
    await this.queue.removeJobScheduler(jobId);
    return this.getState(jobId, 'preview');
  }

  async getState(jobId: string, mode: CommercialAutomationMode) {
    return toCommercialSchedulerState(
      jobId,
      mode,
      await this.queue.getJobScheduler(jobId),
    );
  }
}

export const createBullMqCommercialAutomationScheduler = (
  queue: Queue<CommercialAutomationJob>,
) => new BullMqCommercialAutomationScheduler(queue);
