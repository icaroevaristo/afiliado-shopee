import { describe, expect, it, vi } from 'vitest';
import { PrismaWhatsAppDispatchManualRecoveryRepository } from '../src/prisma-whatsapp-dispatch-manual-recovery-repository';
import { WhatsAppDispatchManualRecoveryService } from '../src/whatsapp-dispatch-manual-recovery-service';
import { WHATSAPP_DISPATCH_MANUAL_RECOVERY_CONFIRMATION } from '../src/repositories';

type RecoveryRow = {
  id: string;
  dispatchId: string;
  runId: string;
  executionId: string;
  candidateId: string;
  campaignId: string;
  jobId: string;
  decision: string;
  confirmation: string;
  attemptCountObserved: number;
  authorizedAt: Date;
  rearmedAt: Date | null;
  requeuedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
type DbArgs = { where: Record<string, unknown>; data: Record<string, unknown> };
type State = ReturnType<typeof makeState>;
const now = new Date('2026-08-18T22:00:00.000Z');
const input = {
  dispatchId: 'dispatch-1',
  expectedRunId: 'run-1',
  expectedExecutionId: 'execution-1',
  confirmation: WHATSAPP_DISPATCH_MANUAL_RECOVERY_CONFIRMATION,
};
const makeState = () => ({
  dispatch: {
    id: 'dispatch-1',
    status: 'PROCESSING',
    attemptCount: 1,
    externalMessageId: null as string | null,
    sentAt: null as Date | null,
    generatedCopyId: 'copy-1',
    productId: 'product-1',
    destinationId: 'destination-1',
  },
  run: {
    id: 'run-1',
    executionId: 'execution-1',
    mode: 'CONFIRMED',
    status: 'FAILED',
    finalStatus: 'AMBIGUOUS',
    investigationRequired: true,
    jobId: 'job-1',
    dispatchId: 'dispatch-1',
  },
  outbox: {
    id: 'outbox-1',
    commercialRunId: 'run-1',
    dispatchId: 'dispatch-1',
    jobId: 'job-1',
    status: 'PUBLISHED',
  },
  copy: {
    id: 'copy-1',
    productId: 'product-1',
    createdFromCandidateId: 'candidate-1',
  },
  candidate: {
    id: 'candidate-1',
    campaignId: 'campaign-1',
    productId: 'product-1',
    generatedCopyId: 'copy-1',
    status: 'RESERVED',
  },
  execution: {
    id: 'execution-1',
    status: 'QUEUED',
    commercialRunId: 'run-1',
    completedAt: now,
  },
  campaign: {
    id: 'campaign-1',
    logicalGroupFingerprint: 'group-fp-1',
    nicheId: 'niche-1',
    dailyLimit: 10,
    active: true,
    niche: { active: true },
    failureCount: 0,
    nextEligibleAt: null as Date | null,
    anchorDestinationId: 'destination-1',
    anchorDestination: {
      id: 'destination-1',
      name: 'Group 1',
      fingerprint: 'group-fp-1',
      active: true,
      available: true,
    },
    attemptExecutionId: 'execution-1',
    attemptReservedAt: new Date(now.getTime() - 60_000),
    attemptLeaseExpiresAt: new Date(now.getTime() - 1_000),
  },
  recovery: null as RecoveryRow | null,
  recoveryCreates: 0,
  dispatchRearms: 0,
});
const fakeDb = (s: State) => {
  const db: Record<string, unknown> = {};
  db.whatsAppDispatch = {
    findUnique: async ({ where }: Pick<DbArgs, 'where'>) =>
      where.id === s.dispatch.id ? { ...s.dispatch } : null,
    updateMany: async ({ where, data }: DbArgs) => {
      const ok =
        where.id === s.dispatch.id &&
        s.dispatch.status === where.status &&
        s.dispatch.attemptCount === where.attemptCount &&
        s.dispatch.externalMessageId === where.externalMessageId &&
        s.dispatch.sentAt === where.sentAt;
      if (!ok) return { count: 0 };
      Object.assign(s.dispatch, data);
      s.dispatchRearms++;
      return { count: 1 };
    },
  };
  db.whatsAppDispatchManualRecovery = {
    findUnique: async ({ where }: Pick<DbArgs, 'where'>) =>
      where.dispatchId === s.dispatch.id ? s.recovery : null,
    create: async ({ data }: Pick<DbArgs, 'data'>) => {
      if (s.recovery) {
        const e = Object.assign(new Error('unique'), { code: 'P2002' });
        throw e;
      }
      s.recovery = {
        id: 'recovery-1',
        ...(data as Omit<
          RecoveryRow,
          'id' | 'rearmedAt' | 'requeuedAt' | 'createdAt' | 'updatedAt'
        >),
        rearmedAt: null,
        requeuedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      s.recoveryCreates++;
      return s.recovery;
    },
    update: async ({ data }: Pick<DbArgs, 'data'>) => {
      if (!s.recovery) throw new Error('recovery missing');
      Object.assign(s.recovery, data, { updatedAt: now });
      return s.recovery;
    },
    updateMany: async ({ where, data }: DbArgs) => {
      if (!s.recovery || s.recovery.dispatchId !== where.dispatchId)
        return { count: 0 };
      if (where.requeuedAt === null && s.recovery.requeuedAt !== null)
        return { count: 0 };
      Object.assign(s.recovery, data, { updatedAt: now });
      return { count: 1 };
    },
  };
  db.commercialPipelineRun = { findMany: async () => [{ ...s.run }] };
  db.commercialDispatchOutbox = {
    findMany: async () => (s.outbox ? [{ ...s.outbox }] : []),
  };
  db.generatedCopy = {
    findUnique: async () => (s.copy ? { ...s.copy } : null),
  };
  db.commercialPromotionCandidate = {
    findMany: async () => (s.candidate ? [{ ...s.candidate }] : []),
  };
  db.commercialAutomationExecution = {
    findUnique: async () => (s.execution ? { ...s.execution } : null),
  };
  db.commercialGroupCampaign = {
    findUnique: async () => (s.campaign ? { ...s.campaign } : null),
    updateMany: async ({ where, data }: DbArgs) => {
      if (
        !s.campaign ||
        s.campaign.id !== where.id ||
        s.campaign.attemptExecutionId !== where.attemptExecutionId
      )
        return { count: 0 };
      Object.assign(s.campaign, data);
      return { count: 1 };
    },
  };
  db.$transaction = async (fn: (tx: unknown) => unknown) => fn(db);
  return db;
};
const repoFor = (s: State) =>
  new PrismaWhatsAppDispatchManualRecoveryRepository(fakeDb(s) as never);
const allowedPolicy = () => ({
  evaluateAutomationReadiness: vi.fn(async () => ({ allowed: true, reasons: [] as string[] })),
});

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'NO_ERROR';
  } catch (e: unknown) {
    return (e as { code?: string }).code ?? 'UNKNOWN';
  }
};

describe('PrismaWhatsAppDispatchManualRecoveryRepository', () => {
  it('authorize audits without rearming the dispatch', async () => {
    const s = makeState();
    const r = await repoFor(s).authorizeConfirmedNonDelivery({
      ...input,
      authorizedAt: now,
    });
    expect(r.kind).toBe('AUTHORIZED');
    expect(s.dispatch).toMatchObject({
      id: 'dispatch-1',
      status: 'PROCESSING',
      attemptCount: 1,
      externalMessageId: null,
      sentAt: null,
    });
    expect(s.recovery).toMatchObject({
      dispatchId: 'dispatch-1',
      runId: 'run-1',
      executionId: 'execution-1',
      attemptCountObserved: 1,
      confirmation: WHATSAPP_DISPATCH_MANUAL_RECOVERY_CONFIRMATION,
    });
    expect(s.recoveryCreates).toBe(1);
  });
  it('authorize is idempotent and creates no second recovery', async () => {
    const s = makeState(),
      repo = repoFor(s);
    await repo.authorizeConfirmedNonDelivery({ ...input, authorizedAt: now });
    const r = await repo.authorizeConfirmedNonDelivery({
      ...input,
      authorizedAt: new Date(now.getTime() + 1),
    });
    expect(r.kind).toBe('ALREADY_AUTHORIZED');
    expect(s.recoveryCreates).toBe(1);
    expect(s.dispatchRearms).toBe(0);
  });
  it('blocks externalMessageId evidence', async () => {
    const s = makeState();
    s.dispatch.externalMessageId = 'msg-1';
    expect(
      await codeOf(
        repoFor(s).authorizeConfirmedNonDelivery({
          ...input,
          authorizedAt: now,
        }),
      ),
    ).toBe('WHATSAPP_DISPATCH_MANUAL_RECOVERY_DELIVERY_EVIDENCE_PRESENT');
  });
  it('blocks sentAt evidence', async () => {
    const s = makeState();
    s.dispatch.sentAt = now;
    expect(
      await codeOf(
        repoFor(s).authorizeConfirmedNonDelivery({
          ...input,
          authorizedAt: now,
        }),
      ),
    ).toBe('WHATSAPP_DISPATCH_MANUAL_RECOVERY_DELIVERY_EVIDENCE_PRESENT');
  });
  it('blocks attemptCount different from one', async () => {
    const s = makeState();
    s.dispatch.attemptCount = 0;
    expect(
      await codeOf(
        repoFor(s).authorizeConfirmedNonDelivery({
          ...input,
          authorizedAt: now,
        }),
      ),
    ).toBe('WHATSAPP_DISPATCH_MANUAL_RECOVERY_ATTEMPT_COUNT_INVALID');
  });
  it('blocks status different from PROCESSING', async () => {
    const s = makeState();
    s.dispatch.status = 'FAILED';
    expect(
      await codeOf(
        repoFor(s).authorizeConfirmedNonDelivery({
          ...input,
          authorizedAt: now,
        }),
      ),
    ).toBe('WHATSAPP_DISPATCH_MANUAL_RECOVERY_DISPATCH_STATE_MISMATCH');
  });
  it('blocks non-ambiguous run', async () => {
    const s = makeState();
    s.run.finalStatus = 'FAILED';
    expect(
      await codeOf(
        repoFor(s).authorizeConfirmedNonDelivery({
          ...input,
          authorizedAt: now,
        }),
      ),
    ).toBe('WHATSAPP_DISPATCH_MANUAL_RECOVERY_RUN_NOT_AMBIGUOUS');
  });
  it('blocks investigationRequired=false', async () => {
    const s = makeState();
    s.run.investigationRequired = false;
    expect(
      await codeOf(
        repoFor(s).authorizeConfirmedNonDelivery({
          ...input,
          authorizedAt: now,
        }),
      ),
    ).toBe('WHATSAPP_DISPATCH_MANUAL_RECOVERY_RUN_NOT_AMBIGUOUS');
  });
  it('blocks run/execution mismatch', async () => {
    const s = makeState();
    expect(
      await codeOf(
        repoFor(s).authorizeConfirmedNonDelivery({
          ...input,
          expectedExecutionId: 'other',
          authorizedAt: now,
        }),
      ),
    ).toBe('WHATSAPP_DISPATCH_MANUAL_RECOVERY_RUN_EXECUTION_MISMATCH');
  });
  it('blocks missing or mismatched outbox/job', async () => {
    const s = makeState();
    s.outbox.jobId = 'other';
    expect(
      await codeOf(
        repoFor(s).authorizeConfirmedNonDelivery({
          ...input,
          authorizedAt: now,
        }),
      ),
    ).toBe('WHATSAPP_DISPATCH_MANUAL_RECOVERY_OUTBOX_INVALID');
  });
  it('blocks ambiguous candidate/copy relation', async () => {
    const s = makeState();
    s.copy.createdFromCandidateId = 'other';
    expect(
      await codeOf(
        repoFor(s).authorizeConfirmedNonDelivery({
          ...input,
          authorizedAt: now,
        }),
      ),
    ).toBe('WHATSAPP_DISPATCH_MANUAL_RECOVERY_CANDIDATE_LINK_INVALID');
  });
  it('blocks target persisted with destination/fingerprint mismatch', async () => {
    const s = makeState();
    s.campaign.anchorDestinationId = 'other-destination';
    expect(
      await codeOf(
        repoFor(s).authorizeConfirmedNonDelivery({ ...input, authorizedAt: now }),
      ),
    ).toBe('WHATSAPP_DISPATCH_MANUAL_RECOVERY_TARGET_MISMATCH');
    expect(s.dispatchRearms).toBe(0);
  });

  it('blocks reservation owner mismatch', async () => {
    const s = makeState();
    s.campaign.attemptExecutionId = 'other';
    expect(
      await codeOf(
        repoFor(s).authorizeConfirmedNonDelivery({
          ...input,
          authorizedAt: now,
        }),
      ),
    ).toBe('WHATSAPP_DISPATCH_MANUAL_RECOVERY_RESERVATION_INVALID');
  });
  it('renews only the same execution ownership before requeue', async () => {
    const s = makeState(),
      repo = repoFor(s);
    await repo.authorizeConfirmedNonDelivery({ ...input, authorizedAt: now });
    const expiry = new Date(now.getTime() + 120000);
    const r = await repo.rearmAuthorizedRetry({
      ...input,
      checkedAt: now,
      leaseExpiresAt: expiry,
    });
    expect(r.executionId).toBe('execution-1');
    expect(s.campaign.attemptExecutionId).toBe('execution-1');
    expect(s.campaign.attemptLeaseExpiresAt).toEqual(expiry);
  });
  it('persistently blocks a third recovery after second attempt begins', async () => {
    const s = makeState(),
      repo = repoFor(s);
    await repo.authorizeConfirmedNonDelivery({ ...input, authorizedAt: now });
    s.dispatch.status = 'PROCESSING';
    s.dispatch.attemptCount = 2;
    expect(
      await codeOf(
        repo.authorizeConfirmedNonDelivery({
          ...input,
          authorizedAt: new Date(now.getTime() + 1000),
        }),
      ),
    ).toBe('WHATSAPP_DISPATCH_MANUAL_RECOVERY_THIRD_RETRY_FORBIDDEN');
  });
  it('keeps exactly one audit row under concurrent authorization attempts', async () => {
    const s = makeState(),
      repo = repoFor(s);
    const results = await Promise.allSettled([
      repo.authorizeConfirmedNonDelivery({ ...input, authorizedAt: now }),
      repo.authorizeConfirmedNonDelivery({ ...input, authorizedAt: now }),
    ]);
    expect(s.recoveryCreates).toBe(1);
    expect(s.dispatchRearms).toBe(0);
    expect(
      results.filter((x) => x.status === 'fulfilled').length,
    ).toBeGreaterThanOrEqual(1);
  });
  it('does not create any new lifecycle objects', async () => {
    const s = makeState(),
      before = {
        run: { ...s.run },
        outbox: { ...s.outbox },
        copy: { ...s.copy },
        candidate: { ...s.candidate },
        execution: { ...s.execution },
      };
    await repoFor(s).authorizeConfirmedNonDelivery({
      ...input,
      authorizedAt: now,
    });
    expect({
      run: s.run,
      outbox: s.outbox,
      copy: s.copy,
      candidate: s.candidate,
      execution: s.execution,
    }).toEqual(before);
  });
  const prepareIntegratedRecovery = async () => {
    const state = makeState();
    const repo = repoFor(state);
    await repo.authorizeConfirmedNonDelivery({ ...input, authorizedAt: now });
    await repo.rearmAuthorizedRetry({
      ...input,
      checkedAt: now,
      leaseExpiresAt: new Date(now.getTime() + 120_000),
    });
    return { state, repo };
  };

  const integratedQueue = (state: string, attemptsMade: number) => {
    const job = {
      id: 'job-1',
      attemptsMade,
      getState: vi.fn(async () => state as never),
      retry: vi.fn(async () => undefined),
    };
    return {
      job,
      queue: {
        getJob: vi.fn(async () => job),
        findEquivalentJobIds: vi.fn(async () => ['job-1']),
      },
    };
  };

  it('integrates repository + service restart from waiting without another retry', async () => {
    const { state, repo } = await prepareIntegratedRecovery();
    const { job, queue } = integratedQueue('waiting', 1);
    const service = new WhatsAppDispatchManualRecoveryService(repo, queue, {
      clock: () => new Date(now.getTime() + 1_000),
    }, allowedPolicy());

    const result = await service.requeueAuthorizedRetry(input);

    expect(result.kind).toBe('CONVERGED_AFTER_RESTART');
    expect(state.dispatch).toMatchObject({ status: 'PENDING', attemptCount: 1 });
    expect(job.retry).not.toHaveBeenCalled();
    expect(state.recovery?.requeuedAt).not.toBeNull();
  });

  it('integrates repository + service restart from active PROCESSING/2', async () => {
    const { state, repo } = await prepareIntegratedRecovery();
    state.dispatch.status = 'PROCESSING';
    state.dispatch.attemptCount = 2;
    const { job, queue } = integratedQueue('active', 2);
    const service = new WhatsAppDispatchManualRecoveryService(repo, queue, {
      clock: () => new Date(now.getTime() + 1_000),
    }, allowedPolicy());

    const result = await service.requeueAuthorizedRetry(input);

    expect(result.kind).toBe('CONVERGED_AFTER_RESTART');
    expect(job.retry).not.toHaveBeenCalled();
    expect(state.recovery?.requeuedAt).not.toBeNull();
  });

  it('integrates repository + service restart from completed SENT/2', async () => {
    const { state, repo } = await prepareIntegratedRecovery();
    state.dispatch.status = 'SENT';
    state.dispatch.attemptCount = 2;
    state.dispatch.externalMessageId = 'message-2';
    state.dispatch.sentAt = now;
    state.run.status = 'COMPLETED';
    state.run.finalStatus = 'SENT';
    state.run.investigationRequired = false;
    const { job, queue } = integratedQueue('completed', 2);
    const service = new WhatsAppDispatchManualRecoveryService(repo, queue, {
      clock: () => new Date(now.getTime() + 1_000),
    }, allowedPolicy());

    const result = await service.requeueAuthorizedRetry(input);

    expect(result.kind).toBe('CONVERGED_AFTER_RESTART');
    expect(job.retry).not.toHaveBeenCalled();
    expect(state.recovery?.requeuedAt).not.toBeNull();
  });

  it('integrates repository + service restart from failed attempt 2 without third retry', async () => {
    const { state, repo } = await prepareIntegratedRecovery();
    state.dispatch.status = 'PROCESSING';
    state.dispatch.attemptCount = 2;
    const { job, queue } = integratedQueue('failed', 2);
    const service = new WhatsAppDispatchManualRecoveryService(repo, queue, {
      clock: () => new Date(now.getTime() + 1_000),
    }, allowedPolicy());

    const result = await service.requeueAuthorizedRetry(input);

    expect(result.kind).toBe('CONVERGED_AFTER_RESTART');
    expect(job.retry).not.toHaveBeenCalled();
    expect(state.recovery?.requeuedAt).not.toBeNull();
  });
  it('integrates BullMQ validation before repository rearm and retry after PENDING/1', async () => {
    const state = makeState();
    const repo = repoFor(state);
    await repo.authorizeConfirmedNonDelivery({ ...input, authorizedAt: now });
    let jobState = 'failed';
    const job = {
      id: 'job-1',
      attemptsMade: 1,
      getState: vi.fn(async () => {
        if (jobState === 'failed') {
          expect(state.dispatch).toMatchObject({ status: 'PROCESSING', attemptCount: 1 });
          expect(state.recovery?.rearmedAt).toBeNull();
        }
        return jobState as never;
      }),
      retry: vi.fn(async () => {
        expect(state.dispatch).toMatchObject({ status: 'PENDING', attemptCount: 1 });
        expect(state.recovery?.rearmedAt).not.toBeNull();
        jobState = 'waiting';
      }),
    };
    const service = new WhatsAppDispatchManualRecoveryService(
      repo,
      {
        getJob: vi.fn(async () => job),
        findEquivalentJobIds: vi.fn(async () => ['job-1']),
      },
      { clock: () => new Date(now.getTime() + 1_000) },
      allowedPolicy(),
    );

    const result = await service.requeueAuthorizedRetry(input);

    expect(result.kind).toBe('REQUEUED');
    expect(state.dispatch).toMatchObject({ status: 'PENDING', attemptCount: 1 });
    expect(state.dispatchRearms).toBe(1);
    expect(job.retry).toHaveBeenCalledTimes(1);
    expect(state.recovery?.requeuedAt).not.toBeNull();
  });

  it.each([
    ['missing', null, ['job-1']],
    ['invalid-state', 'paused', ['job-1']],
    ['equivalent', 'failed', ['job-1', 'job-shadow']],
  ])('integrated %s BullMQ gate leaves PROCESSING/1 unrearmed', async (_name, jobState, equivalents) => {
    const state = makeState();
    const repo = repoFor(state);
    await repo.authorizeConfirmedNonDelivery({ ...input, authorizedAt: now });
    const job = jobState
      ? {
          id: 'job-1',
          attemptsMade: 1,
          getState: vi.fn(async () => jobState as never),
          retry: vi.fn(async () => undefined),
        }
      : null;
    const service = new WhatsAppDispatchManualRecoveryService(
      repo,
      {
        getJob: vi.fn(async () => job),
        findEquivalentJobIds: vi.fn(async () => equivalents),
      },
      { clock: () => new Date(now.getTime() + 1_000) },
      allowedPolicy(),
    );

    await expect(service.requeueAuthorizedRetry(input)).rejects.toBeDefined();

    expect(state.dispatch).toMatchObject({ status: 'PROCESSING', attemptCount: 1 });
    expect(state.recovery?.rearmedAt).toBeNull();
    expect(state.dispatchRearms).toBe(0);
    if (job) expect(job.retry).not.toHaveBeenCalled();
  });
});
