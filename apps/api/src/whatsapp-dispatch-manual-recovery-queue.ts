import type { createWhatsAppDispatchQueue } from '@shopee-auto-affiliate-ai/queue';
import type { ManualRecoveryQueue } from './whatsapp-dispatch-manual-recovery-service';

export const createWhatsAppDispatchManualRecoveryQueue = (
  queue: ReturnType<typeof createWhatsAppDispatchQueue>,
): ManualRecoveryQueue => ({
  async findEquivalentJobIds(dispatchId) {
    const jobs = await queue.getJobs([
      'waiting',
      'active',
      'delayed',
      'failed',
      'completed',
      'paused',
    ]);
    return jobs
      .filter((job) => job.data.dispatchId === dispatchId)
      .map((job) => String(job.id));
  },
  async getJob(jobId) {
    const job = await queue.getJob(jobId);
    if (!job) return null;
    return {
      id: String(job.id),
      instanceName: job.data.instanceName ?? null,
      get attemptsMade() {
        return job.attemptsMade;
      },
      async getState() {
        const state = await job.getState();
        // BullMQ getState reads Redis but leaves the Job object's counters stale.
        // Read the counter after the state so a completed retry is not paired
        // with the first attempt's cached count. Missing/changed identity closes.
        const current = await queue.getJob(jobId);
        if (
          !current ||
          current.id !== job.id ||
          current.data.instanceName !== job.data.instanceName
        ) {
          return 'unknown';
        }
        job.attemptsMade = current.attemptsMade;
        switch (state) {
          case 'failed':
          case 'waiting':
          case 'active':
          case 'delayed':
          case 'completed':
            return state;
          default:
            return 'unknown';
        }
      },
      async retry() {
        await job.retry();
      },
    };
  },
});
