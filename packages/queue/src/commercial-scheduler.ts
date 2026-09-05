export type CommercialAutomationMode = 'preview' | 'send';

/**
 * The BullMQ scheduler is only a technical wake-up mechanism. Business
 * windows, cadence and quotas belong to the persisted planner settings.
 */
export const COMMERCIAL_AUTOMATION_HEARTBEAT_CRON = '* * * * *';

export type CommercialAutomationSchedulerConfig = {
  enabled: boolean;
  cronExpression: string;
  timezone: string;
  mode: CommercialAutomationMode;
  jobId: string;
};

export type CommercialAutomationSchedulerStatus =
  'disabled' | 'registered' | 'not-registered';

export type CommercialAutomationSchedulerState = {
  jobId: string;
  status: CommercialAutomationSchedulerStatus;
  cronExpression: string | null;
  timezone: string | null;
  mode: CommercialAutomationMode;
  nextRunAt: string | null;
};

export interface CommercialAutomationScheduler {
  register(
    config: CommercialAutomationSchedulerConfig,
  ): Promise<CommercialAutomationSchedulerState>;
  remove(jobId: string): Promise<CommercialAutomationSchedulerState>;
  getState(
    jobId: string,
    mode: CommercialAutomationMode,
  ): Promise<CommercialAutomationSchedulerState>;
}
