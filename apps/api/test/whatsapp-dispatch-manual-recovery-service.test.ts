import { describe, expect, it, vi } from 'vitest';
import { WhatsAppDispatchManualRecoveryService } from '../src/whatsapp-dispatch-manual-recovery-service';
import {
  WHATSAPP_DISPATCH_MANUAL_RECOVERY_CONFIRMATION,
  type WhatsAppDispatchManualRecoveryInspection,
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
  id: 'recovery-1', dispatchId: 'dispatch-1', runId: 'run-1', executionId: 'execution-1',
  candidateId: 'candidate-1', campaignId: 'campaign-1', jobId: 'job-1', decision: 'CONFIRMED_NON_DELIVERY',
  confirmation: WHATSAPP_DISPATCH_MANUAL_RECOVERY_CONFIRMATION, attemptCountObserved: 1, authorizedAt: now,
  rearmedAt: null, requeuedAt: null, createdAt: now, updatedAt: now, ...overrides,
});
const inspection = (
  overrides: Partial<WhatsAppDispatchManualRecoveryInspection> = {},
): WhatsAppDispatchManualRecoveryInspection => ({
  recovery: recovery(), jobId: 'job-1', campaignId: 'campaign-1', candidateId: 'candidate-1',
  dispatchId: 'dispatch-1', runId: 'run-1', executionId: 'execution-1', dispatchStatus: 'PROCESSING',
  attemptCount: 1, externalMessageId: null, sentAt: null, runStatus: 'FAILED', runFinalStatus: 'AMBIGUOUS',
  investigationRequired: true, instanceName: 'instance-a',
  target: { groupId: 'destination-1', groupName: 'Group 1', logicalGroupFingerprint: 'group-fp-1', campaignId: 'campaign-1', nicheId: 'niche-1', dailyLimit: 10, failureCount: 0, nextEligibleAt: null },
  ...overrides,
});
const repository = (initial = inspection()) => {
  let current = initial;
  return {
    authorizeConfirmedNonDelivery: vi.fn(async () => ({
      kind: 'AUTHORIZED' as const, recovery: current.recovery, jobId: 'job-1', campaignId: 'campaign-1', candidateId: 'candidate-1',
    })),
    inspectAuthorizedRecovery: vi.fn(async () => current),
    rearmAuthorizedRetry: vi.fn(async () => {
      current = inspection({ recovery: recovery({ rearmedAt: now }), dispatchStatus: 'PENDING' });
      return current;
    }),
    markManualRecoveryRequeued: vi.fn(async () => {
      current = { ...current, recovery: { ...current.recovery, requeuedAt: now } };
      return current.recovery;
    }),
    setInspection(value: WhatsAppDispatchManualRecoveryInspection) { current = value; },
  } satisfies WhatsAppDispatchManualRecoveryRepository & { setInspection(value: WhatsAppDispatchManualRecoveryInspection): void };
};
const queueJob = (
  state: string,
  attemptsMade: number,
  afterRetry = 'waiting',
  instanceName: string | null = 'instance-a',
) => {
  let current = state;
  return {
    id: 'job-1', attemptsMade, instanceName,
    data: { dispatchId: 'dispatch-1', ...(instanceName ? { instanceName } : {}) },
    getState: vi.fn(async () => current as never),
    retry: vi.fn(async () => { current = afterRetry; }),
  };
};
const queue = (job: ReturnType<typeof queueJob> | null, equivalents = ['job-1']) => ({
  getJob: vi.fn(async () => job),
  findEquivalentJobIds: vi.fn(async () => equivalents),
});
const policy = (allowed = true, reasons: string[] = []) => ({
  evaluateAutomationReadiness: vi.fn(async () => ({ allowed, reasons })),
});


describe('WhatsAppDispatchManualRecoveryService review boundaries', () => {
  it('authorize requires literal confirmation and does not require a queue', async () => {
    const repo = repository();
    const service = new WhatsAppDispatchManualRecoveryService(repo, undefined, { clock: () => now });
    await expect(service.authorize({ ...input, confirmation: 'sim' as never })).rejects.toMatchObject({
      code: 'WHATSAPP_DISPATCH_MANUAL_RECOVERY_CONFIRMATION_REQUIRED',
    });
    const result = await service.authorize(input);
    expect(result.kind).toBe('AUTHORIZED');
    expect(repo.authorizeConfirmedNonDelivery).toHaveBeenCalledTimes(1);
    expect(repo.rearmAuthorizedRetry).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', null, ['job-1'], 'WHATSAPP_DISPATCH_MANUAL_RECOVERY_JOB_MISSING'],
    ['invalid-state', queueJob('paused', 1), ['job-1'], 'WHATSAPP_DISPATCH_MANUAL_RECOVERY_JOB_NOT_RETRYABLE'],
    ['equivalent', queueJob('failed', 1), ['job-1', 'job-shadow'], 'WHATSAPP_DISPATCH_MANUAL_RECOVERY_EQUIVALENT_JOB_CONFLICT'],
  ])('keeps dispatch unrearmed when BullMQ is %s', async (_name, job, equivalents, code) => {
    const repo = repository();
    const service = new WhatsAppDispatchManualRecoveryService(repo, queue(job, equivalents), { clock: () => now }, policy());
    await expect(service.requeueAuthorizedRetry(input)).rejects.toMatchObject({ code });
    expect(repo.rearmAuthorizedRetry).not.toHaveBeenCalled();
  });

  it('valid requeue checks BullMQ before rearm and retries only after PENDING/1', async () => {
    const repo = repository();
    const job = queueJob('failed', 1);
    const q = queue(job);
    const service = new WhatsAppDispatchManualRecoveryService(repo, q, { clock: () => now }, policy());

    const result = await service.requeueAuthorizedRetry(input);

    expect(result.kind).toBe('REQUEUED');
    expect(q.getJob).toHaveBeenCalledWith('job-1');
    expect(q.findEquivalentJobIds).toHaveBeenCalledWith('dispatch-1');
    expect(job.getState.mock.invocationCallOrder[0]).toBeLessThan(
      repo.rearmAuthorizedRetry.mock.invocationCallOrder[0]!,
    );
    expect(repo.rearmAuthorizedRetry.mock.invocationCallOrder[0]).toBeLessThan(
      job.retry.mock.invocationCallOrder[0]!,
    );
    expect(job.retry).toHaveBeenCalledTimes(1);
    expect(repo.markManualRecoveryRequeued).toHaveBeenCalledTimes(1);
    expect(job.data).toEqual({ dispatchId: 'dispatch-1', instanceName: 'instance-a' });
  });

  it('keeps a full-null legacy recovery readable without inventing sticky identity', async () => {
    const repo = repository(inspection({ instanceName: null }));
    const job = queueJob('failed', 1, 'waiting', null);
    const service = new WhatsAppDispatchManualRecoveryService(
      repo,
      queue(job),
      { clock: () => now },
      policy(),
    );

    const result = await service.requeueAuthorizedRetry(input);

    expect(result.kind).toBe('REQUEUED');
    expect(job.retry).toHaveBeenCalledTimes(1);
  });

  it('restart after retry accepted with waiting PENDING/1 converges without another retry', async () => {
    const repo = repository(
      inspection({ recovery: recovery({ rearmedAt: now }), dispatchStatus: 'PENDING' }),
    );
    const job = queueJob('waiting', 1);
    const service = new WhatsAppDispatchManualRecoveryService(repo, queue(job), { clock: () => now }, policy());

    const result = await service.requeueAuthorizedRetry(input);

    expect(result.kind).toBe('CONVERGED_AFTER_RESTART');
    expect(job.retry).not.toHaveBeenCalled();
    expect(repo.markManualRecoveryRequeued).toHaveBeenCalledTimes(1);
  });

  it('restart with active PROCESSING/2 converges without another retry', async () => {
    const repo = repository(
      inspection({
        recovery: recovery({ rearmedAt: now }),
        dispatchStatus: 'PROCESSING',
        attemptCount: 2,
      }),
    );
    const job = queueJob('active', 2);
    const service = new WhatsAppDispatchManualRecoveryService(repo, queue(job), { clock: () => now }, policy());

    const result = await service.requeueAuthorizedRetry(input);

    expect(result.kind).toBe('CONVERGED_AFTER_RESTART');
    expect(job.retry).not.toHaveBeenCalled();
  });

  it('restart with completed SENT/2 converges without another retry', async () => {
    const repo = repository(
      inspection({
        recovery: recovery({ rearmedAt: now }),
        dispatchStatus: 'SENT',
        attemptCount: 2,
        externalMessageId: 'message-2',
        sentAt: now,
        runStatus: 'COMPLETED',
        runFinalStatus: 'SENT',
        investigationRequired: false,
      }),
    );
    const job = queueJob('completed', 2);
    const service = new WhatsAppDispatchManualRecoveryService(repo, queue(job), { clock: () => now }, policy());

    const result = await service.requeueAuthorizedRetry(input);

    expect(result.kind).toBe('CONVERGED_AFTER_RESTART');
    expect(job.retry).not.toHaveBeenCalled();
  });

  it('restart with failed second ambiguous attempt converges without a third retry', async () => {
    const repo = repository(
      inspection({
        recovery: recovery({ rearmedAt: now }),
        dispatchStatus: 'PROCESSING',
        attemptCount: 2,
      }),
    );
    const job = queueJob('failed', 2);
    const service = new WhatsAppDispatchManualRecoveryService(repo, queue(job), { clock: () => now }, policy());

    const result = await service.requeueAuthorizedRetry(input);

    expect(result.kind).toBe('CONVERGED_AFTER_RESTART');
    expect(job.retry).not.toHaveBeenCalled();
    expect(repo.rearmAuthorizedRetry).not.toHaveBeenCalled();
  });

  it('fails closed when failed attempt 2 does not match a terminal or ambiguous lifecycle', async () => {
    const repo = repository(
      inspection({
        recovery: recovery({ rearmedAt: now }),
        dispatchStatus: 'PENDING',
        attemptCount: 1,
      }),
    );
    const job = queueJob('failed', 2);
    const service = new WhatsAppDispatchManualRecoveryService(repo, queue(job), { clock: () => now }, policy());

    await expect(service.requeueAuthorizedRetry(input)).rejects.toMatchObject({
      code: 'WHATSAPP_DISPATCH_MANUAL_RECOVERY_JOB_NOT_RETRYABLE',
    });
    expect(job.retry).not.toHaveBeenCalled();
  });

  it('authorize at 22:30 remains audit-only and does not require queue or policy', async () => {
    const repo = repository();
    const at2230 = new Date('2026-08-18T22:30:00-03:00');
    const service = new WhatsAppDispatchManualRecoveryService(repo, undefined, {
      clock: () => at2230,
    });

    const result = await service.authorize(input);

    expect(result.kind).toBe('AUTHORIZED');
    expect(repo.rearmAuthorizedRetry).not.toHaveBeenCalled();
    expect(repo.inspectAuthorizedRecovery).not.toHaveBeenCalled();
  });

  it.each([
    'OUTSIDE_ALLOWED_WINDOW',
    'AUTOMATION_PAUSED',
    'GLOBAL_DAILY_LIMIT_REACHED',
    'GROUP_DAILY_LIMIT_REACHED',
    'MINIMUM_INTERVAL_NOT_REACHED',
    'COMMERCIAL_AUTOMATION_TARGET_NOT_ELIGIBLE',
  ])('policy reason %s blocks before rearm and retry', async (reason) => {
    const repo = repository();
    const job = queueJob('failed', 1);
    const deniedPolicy = policy(false, [reason]);
    const service = new WhatsAppDispatchManualRecoveryService(
      repo,
      queue(job),
      { clock: () => now },
      deniedPolicy,
    );

    await expect(service.requeueAuthorizedRetry(input)).rejects.toMatchObject({
      code: 'WHATSAPP_DISPATCH_MANUAL_RECOVERY_POLICY_BLOCKED',
    });

    expect(repo.rearmAuthorizedRetry).not.toHaveBeenCalled();
    expect(job.retry).not.toHaveBeenCalled();
    expect(deniedPolicy.evaluateAutomationReadiness).toHaveBeenCalledWith({
      excludedExecutionId: 'execution-1',
      excludedAmbiguousRunId: 'run-1',
      target: inspection().target,
    });
  });

  it('revalidates policy after rearm and does not retry if window closes', async () => {
    const repo = repository();
    const job = queueJob('failed', 1);
    const gate = {
      evaluateAutomationReadiness: vi
        .fn()
        .mockResolvedValueOnce({ allowed: true, reasons: [] })
        .mockResolvedValueOnce({ allowed: false, reasons: ['OUTSIDE_ALLOWED_WINDOW'] }),
    };
    const service = new WhatsAppDispatchManualRecoveryService(
      repo,
      queue(job),
      { clock: () => now },
      gate,
    );

    await expect(service.requeueAuthorizedRetry(input)).rejects.toMatchObject({
      code: 'WHATSAPP_DISPATCH_MANUAL_RECOVERY_POLICY_BLOCKED',
    });

    expect(repo.rearmAuthorizedRetry).toHaveBeenCalledTimes(1);
    expect(job.retry).not.toHaveBeenCalled();
    const afterRace = await repo.inspectAuthorizedRecovery();
    expect(afterRace).toMatchObject({ dispatchStatus: 'PENDING', attemptCount: 1 });
    expect(afterRace.recovery.rearmedAt).not.toBeNull();
    expect(afterRace.recovery.requeuedAt).toBeNull();
  });

  it('resumes a PENDING/1 rearmed recovery when policy allows again', async () => {
    const repo = repository(
      inspection({ recovery: recovery({ rearmedAt: now }), dispatchStatus: 'PENDING' }),
    );
    const job = queueJob('failed', 1);
    const allowed = policy();
    const service = new WhatsAppDispatchManualRecoveryService(
      repo,
      queue(job),
      { clock: () => now },
      allowed,
    );

    const result = await service.requeueAuthorizedRetry(input);

    expect(result.kind).toBe('REQUEUED');
    expect(repo.rearmAuthorizedRetry).not.toHaveBeenCalled();
    expect(job.retry).toHaveBeenCalledTimes(1);
    expect(allowed.evaluateAutomationReadiness).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['PROCESSING', 'active', false],
    ['SENT', 'completed', true],
  ] as const)(
    'reconciles already-started %s/2 after window closes without policy recheck',
    async (dispatchStatus, jobState, sent) => {
      const repo = repository(
        inspection({
          recovery: recovery({ rearmedAt: now }),
          dispatchStatus,
          attemptCount: 2,
          externalMessageId: sent ? 'message-2' : null,
          sentAt: sent ? now : null,
          runStatus: sent ? 'COMPLETED' : 'FAILED',
          runFinalStatus: sent ? 'SENT' : 'AMBIGUOUS',
          investigationRequired: !sent,
        }),
      );
      const job = queueJob(jobState, 2);
      const closedPolicy = policy(false, ['OUTSIDE_ALLOWED_WINDOW']);
      const service = new WhatsAppDispatchManualRecoveryService(
        repo,
        queue(job),
        { clock: () => new Date('2026-08-18T22:05:00-03:00') },
        closedPolicy,
      );

      const result = await service.requeueAuthorizedRetry(input);

      expect(result.kind).toBe('CONVERGED_AFTER_RESTART');
      expect(job.retry).not.toHaveBeenCalled();
      expect(closedPolicy.evaluateAutomationReadiness).not.toHaveBeenCalled();
    },
  );

});
