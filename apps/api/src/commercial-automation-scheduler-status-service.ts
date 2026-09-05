import {
  DEFAULT_COMMERCIAL_AUTOMATION_SCHEDULER_JOB_ID,
  COMMERCIAL_AUTOMATION_HEARTBEAT_CRON,
  JOB_NAMES,
  QUEUE_NAMES,
  type CommercialAutomationMode,
  type CommercialAutomationScheduler,
  type CommercialAutomationSchedulerStatus,
} from '@shopee-auto-affiliate-ai/queue';

export type CommercialAutomationSchedulerStatusSnapshot = {
  enabled: boolean;
  status: CommercialAutomationSchedulerStatus;
  jobId: typeof DEFAULT_COMMERCIAL_AUTOMATION_SCHEDULER_JOB_ID;
  queue: typeof QUEUE_NAMES.commercialAutomation;
  jobName: typeof JOB_NAMES.commercialAutomationTick;
  cron: string;
  timezone: string;
  nextRunAt: string | null;
  mode: CommercialAutomationMode;
};

export class CommercialAutomationSchedulerStatusService {
  constructor(
    private readonly scheduler: Pick<CommercialAutomationScheduler, 'getState'>,
    private readonly config: {
      enabled: boolean;
      cron: string;
      timezone: string;
      mode: CommercialAutomationMode;
    },
  ) {}

  async getStatus(): Promise<CommercialAutomationSchedulerStatusSnapshot> {
    const state = await this.scheduler.getState(
      DEFAULT_COMMERCIAL_AUTOMATION_SCHEDULER_JOB_ID,
      this.config.mode,
    );
    const registered = this.config.enabled && state.status === 'registered';
    return {
      enabled: this.config.enabled,
      status: this.config.enabled ? state.status : 'disabled',
      jobId: DEFAULT_COMMERCIAL_AUTOMATION_SCHEDULER_JOB_ID,
      queue: QUEUE_NAMES.commercialAutomation,
      jobName: JOB_NAMES.commercialAutomationTick,
      cron: COMMERCIAL_AUTOMATION_HEARTBEAT_CRON,
      timezone: registered
        ? (state.timezone ?? this.config.timezone)
        : this.config.timezone,
      nextRunAt: this.config.enabled ? state.nextRunAt : null,
      mode: registered ? state.mode : this.config.mode,
    };
  }
}
