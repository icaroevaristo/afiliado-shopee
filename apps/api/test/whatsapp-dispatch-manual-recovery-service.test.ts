import { describe, expect, it, vi } from 'vitest';
import { WhatsAppDispatchManualRecoveryService } from '../src/whatsapp-dispatch-manual-recovery-service';
import {
  WHATSAPP_DISPATCH_MANUAL_RECOVERY_CONFIRMATION,
  type WhatsAppDispatchManualRecoveryRecord,
  type WhatsAppDispatchManualRecoveryRepository,
} from '../src/repositories';

const now = new Date('2026-08-18T22:00:00.000Z');
const input = {
  dispatchId: 'dispatch-1',
  expectedRunId: 'run-1',
  expectedExecutionId: 'execution-1',
  confirmation: WHATSAPP_DISPATCH_MANUAL_RECOVERY_CONFIRMATION,
};
const recovery = (
  overrides: Partial<WhatsAppDispatchManualRecoveryRecord> = {},
): WhatsAppDispatchManualRecoveryRecord => ({
  id: 'recovery-1',
  dispatchId: 'dispatch-1',
  runId: 'run-1',
  executionId: 'execution-1',
  candidateId: 'candidate-1',
  campaignId: 'campaign-1',
  jobId: 'job-1',
  decision: 'CONFIRMED_NON_DELIVERY',
  confirmation: WHATSAPP_DISPATCH_MANUAL_RECOVERY_CONFIRMATION,
  attemptCountObserved: 1,
  authorizedAt: now,
  rearmedAt: now,
  requeuedAt: null,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});
const context = (record = recovery()) => ({
  recovery: record,
  jobId: 'job-1',
  campaignId: 'campaign-1',
  candidateId: 'candidate-1',
  dispatchId: 'dispatch-1',
  runId: 'run-1',
  executionId: 'execution-1',
});
const repository = () =>
  ({
    rearmAfterConfirmedNonDelivery: vi.fn(async () => ({
      kind: 'AUTHORIZED' as const,
      recovery: recovery(),
      jobId: 'job-1',
      campaignId: 'campaign-1',
      candidateId: 'candidate-1',
    })),
    prepareManualRecoveryRequeue: vi.fn(async () => context()),
    markManualRecoveryRequeued: vi.fn(async () =>
      recovery({ requeuedAt: now }),
    ),
  }) satisfies WhatsAppDispatchManualRecoveryRepository;
const job = (state: string, attemptsMade: number, afterRetry = 'waiting') => {
  let current = state;
  const value = {
    id: 'job-1',
    attemptsMade,
    getState: vi.fn(async () => current as never),
    retry: vi.fn(async () => {
      current = afterRetry;
    }),
  };
  return value;
};

describe('WhatsAppDispatchManualRecoveryService', () => {
  it('requires the literal human confirmation', async () => {
    const repo = repository();
    const service = new WhatsAppDispatchManualRecoveryService(
      repo,
      { getJob: vi.fn(), findEquivalentJobIds: vi.fn(async () => ['job-1']) },
      { clock: () => now },
    );
    await expect(
      service.authorizeAndRearm({ ...input, confirmation: 'sim' as never }),
    ).rejects.toMatchObject({
      code: 'WHATSAPP_DISPATCH_MANUAL_RECOVERY_CONFIRMATION_REQUIRED',
    });
    expect(repo.rearmAfterConfirmedNonDelivery).not.toHaveBeenCalled();
  });

  it('authorizes and rearms through the repository only', async () => {
    const repo = repository();
    const service = new WhatsAppDispatchManualRecoveryService(
      repo,
      { getJob: vi.fn(), findEquivalentJobIds: vi.fn(async () => ['job-1']) },
      { clock: () => now },
    );
    const result = await service.authorizeAndRearm(input);
    expect(result.kind).toBe('AUTHORIZED');
    expect(repo.rearmAfterConfirmedNonDelivery).toHaveBeenCalledWith({
      ...input,
      authorizedAt: now,
    });
  });

  it('fails closed when the deterministic BullMQ job is missing', async () => {
    const repo = repository();
    const service = new WhatsAppDispatchManualRecoveryService(
      repo,
      {
        getJob: vi.fn(async () => null),
        findEquivalentJobIds: vi.fn(async () => ['job-1']),
      },
      { clock: () => now },
    );
    await expect(service.requeueAuthorizedRetry(input)).rejects.toMatchObject({
      code: 'WHATSAPP_DISPATCH_MANUAL_RECOVERY_JOB_MISSING',
    });
  });

  it('blocks a foreign equivalent BullMQ job before retry', async () => {
    const repo = repository();
    const queueJob = job('failed', 1);
    const service = new WhatsAppDispatchManualRecoveryService(
      repo,
      {
        getJob: vi.fn(async () => queueJob),
        findEquivalentJobIds: vi.fn(async () => ['job-1', 'job-shadow']),
      },
      { clock: () => now },
    );
    await expect(service.requeueAuthorizedRetry(input)).rejects.toMatchObject({
      code: 'WHATSAPP_DISPATCH_MANUAL_RECOVERY_EQUIVALENT_JOB_CONFLICT',
    });
    expect(queueJob.retry).not.toHaveBeenCalled();
  });

  it('retries a failed first-attempt job exactly once', async () => {
    const repo = repository();
    const queueJob = job('failed', 1);
    const service = new WhatsAppDispatchManualRecoveryService(
      repo,
      {
        getJob: vi.fn(async () => queueJob),
        findEquivalentJobIds: vi.fn(async () => ['job-1']),
      },
      { clock: () => now },
    );
    const result = await service.requeueAuthorizedRetry(input);
    expect(result.kind).toBe('REQUEUED');
    expect(queueJob.retry).toHaveBeenCalledTimes(1);
    expect(repo.markManualRecoveryRequeued).toHaveBeenCalledTimes(1);
  });

  it.each(['waiting', 'active', 'delayed', 'completed'])(
    'converges after restart when job is already %s without retrying again',
    async (state) => {
      const repo = repository();
      const queueJob = job(state, 1);
      const service = new WhatsAppDispatchManualRecoveryService(
        repo,
        {
          getJob: vi.fn(async () => queueJob),
          findEquivalentJobIds: vi.fn(async () => ['job-1']),
        },
        { clock: () => now },
      );
      const result = await service.requeueAuthorizedRetry(input);
      expect(result.kind).toBe('CONVERGED_AFTER_RESTART');
      expect(queueJob.retry).not.toHaveBeenCalled();
      expect(repo.markManualRecoveryRequeued).toHaveBeenCalledTimes(1);
    },
  );

  it('does not retry again when requeuedAt is already persisted and retry evidence exists', async () => {
    const repo = repository();
    repo.prepareManualRecoveryRequeue.mockResolvedValue(
      context(recovery({ requeuedAt: now })),
    );
    const queueJob = job('failed', 2);
    const service = new WhatsAppDispatchManualRecoveryService(
      repo,
      {
        getJob: vi.fn(async () => queueJob),
        findEquivalentJobIds: vi.fn(async () => ['job-1']),
      },
      { clock: () => now },
    );
    const result = await service.requeueAuthorizedRetry(input);
    expect(result.kind).toBe('ALREADY_REQUEUED');
    expect(queueJob.retry).not.toHaveBeenCalled();
    expect(repo.markManualRecoveryRequeued).not.toHaveBeenCalled();
  });

  it('fails closed when requeuedAt exists but BullMQ still looks like the first failed attempt', async () => {
    const repo = repository();
    repo.prepareManualRecoveryRequeue.mockResolvedValue(
      context(recovery({ requeuedAt: now })),
    );
    const queueJob = job('failed', 1);
    const service = new WhatsAppDispatchManualRecoveryService(
      repo,
      {
        getJob: vi.fn(async () => queueJob),
        findEquivalentJobIds: vi.fn(async () => ['job-1']),
      },
      { clock: () => now },
    );
    await expect(service.requeueAuthorizedRetry(input)).rejects.toMatchObject({
      code: 'WHATSAPP_DISPATCH_MANUAL_RECOVERY_QUEUE_STATE_CONFLICT',
    });
    expect(queueJob.retry).not.toHaveBeenCalled();
  });

  it.each([
    ['failed', 0],
    ['paused', 1],
    ['unknown', 1],
  ])(
    'fails closed for non-retryable job state %s attempts=%s',
    async (state, attemptsMade) => {
      const repo = repository();
      const queueJob = job(state as string, attemptsMade as number);
      const service = new WhatsAppDispatchManualRecoveryService(
        repo,
        {
          getJob: vi.fn(async () => queueJob),
          findEquivalentJobIds: vi.fn(async () => ['job-1']),
        },
        { clock: () => now },
      );
      await expect(service.requeueAuthorizedRetry(input)).rejects.toMatchObject(
        { code: 'WHATSAPP_DISPATCH_MANUAL_RECOVERY_JOB_NOT_RETRYABLE' },
      );
      expect(queueJob.retry).not.toHaveBeenCalled();
    },
  );

  it('converges when job.retry throws after BullMQ already accepted the retry', async () => {
    const repo = repository();
    let state = 'failed';
    const queueJob = {
      id: 'job-1',
      attemptsMade: 1,
      getState: vi.fn(async () => state as never),
      retry: vi.fn(async () => {
        state = 'waiting';
        throw new Error('connection closed after retry');
      }),
    };
    const service = new WhatsAppDispatchManualRecoveryService(
      repo,
      {
        getJob: vi.fn(async () => queueJob),
        findEquivalentJobIds: vi.fn(async () => ['job-1']),
      },
      { clock: () => now },
    );
    const result = await service.requeueAuthorizedRetry(input);
    expect(result.kind).toBe('REQUEUED');
    expect(queueJob.retry).toHaveBeenCalledTimes(1);
    expect(repo.markManualRecoveryRequeued).toHaveBeenCalledTimes(1);
  });

  it('propagates retry failure when no retry side effect is observable', async () => {
    const repo = repository();
    const queueJob = {
      id: 'job-1',
      attemptsMade: 1,
      getState: vi.fn(async () => 'failed' as const),
      retry: vi.fn(async () => {
        throw new Error('redis unavailable');
      }),
    };
    const service = new WhatsAppDispatchManualRecoveryService(
      repo,
      {
        getJob: vi.fn(async () => queueJob),
        findEquivalentJobIds: vi.fn(async () => ['job-1']),
      },
      { clock: () => now },
    );
    await expect(service.requeueAuthorizedRetry(input)).rejects.toThrow(
      'redis unavailable',
    );
    expect(repo.markManualRecoveryRequeued).not.toHaveBeenCalled();
  });
});
