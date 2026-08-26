import { describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app';
import {
  MANUAL_PUBLICATION_RECONCILIATION_CONFIRMATION,
  MANUAL_PUBLICATION_RECONCILIATION_RESOLUTION,
  ManualPublicationService,
} from '../src/manual-publication-service';
import { PrismaManualPublicationRequestRepository } from '../src/prisma-repositories';

const NOW = new Date('2026-08-26T20:00:00.000Z');
const HISTORIC_COMPLETED_AT = new Date('2026-08-26T19:38:08.412Z');
const REQUEST_ID = 'manual-publication-request-1';
const TARGET_ID = 'manual-publication-target-1';
const EXECUTION_ID = 'commercial-execution-1';
const CAMPAIGN_ID = 'campaign-1';
const CANDIDATE_ID = 'candidate-1';
const PRODUCT_ID = 'product-1';
const SNAPSHOT_ID = 'snapshot-1';

type RecoveryStage = 'campaign' | 'execution' | 'target' | 'request';

type TestTarget = {
  id: string;
  requestId: string;
  destinationId: string;
  campaignId: string;
  logicalGroupFingerprint: string;
  assignedInstanceName: string;
  candidateId: string | null;
  runId: string | null;
  dispatchId: string | null;
  outboxId: string | null;
  status: 'ACCEPTED' | 'AMBIGUOUS' | 'BLOCKED';
  blockedReason: string | null;
  investigationRequired: boolean;
  createdAt: Date;
  updatedAt: Date;
  destination: null;
  campaign: null;
  candidate: null;
  run: null;
  dispatch: null;
  outbox: null;
};

type TestRequest = {
  id: string;
  idempotencyKey: string;
  payloadHash: string;
  mode: 'SEND';
  productId: string;
  requestedSnapshotId: string;
  requestedSnapshotRevision: number;
  requestedSnapshotFingerprint: string;
  status: 'AMBIGUOUS' | 'PROCESSING' | 'BLOCKED';
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  processingOwnerId: string | null;
  processingLeaseExpiresAt: Date | null;
  targets: TestTarget[];
};

type TestExecution = {
  id: string;
  schedulerJobId: string;
  bullMqJobId: null;
  activeKey: null;
  ownerId: string;
  heartbeatAt: Date;
  leaseExpiresAt: Date;
  mode: 'SEND';
  status: 'AMBIGUOUS' | 'BLOCKED';
  externalStage: 'EXTERNAL_MAY_HAVE_STARTED';
  reasons: string[];
  commercialRunId: string | null;
  failureCode: string;
  startedAt: Date;
  completedAt: Date;
};

type TestCampaign = {
  id: string;
  attemptExecutionId: string | null;
  attemptReservedAt: Date | null;
  attemptLeaseExpiresAt: Date | null;
};

type TestCandidate = {
  id: string;
  campaignId: string;
  productId: string;
  snapshotId: string;
  generatedCopyId: string | null;
  status: 'QUEUED' | 'COPY_READY';
};

type TestState = {
  request: TestRequest;
  execution: TestExecution;
  campaign: TestCampaign;
  candidate: TestCandidate | null;
  downstream: {
    run: { id: string } | null;
    dispatch: { id: string } | null;
    outbox: { id: string } | null;
    copyAttempt: { id: string } | null;
    generatedCopy: { id: string } | null;
  };
};

type TestSubject = {
  repository: PrismaManualPublicationRequestRepository;
  readState: () => TestState;
  writeCounts: Record<'campaign' | 'execution' | 'target' | 'request', number>;
  transactionRunner: ReturnType<typeof vi.fn>;
  initialState: TestState;
};

const clone = <T>(value: T): T => structuredClone(value);

const createState = (options: {
  campaignOwner?: string | null;
  executionCommercialRunId?: string | null;
  targetCandidateId?: string | null;
  candidateStatus?: 'QUEUED' | 'COPY_READY';
  secondTargetStatus?: 'ACCEPTED' | 'AMBIGUOUS' | 'BLOCKED';
  downstream?: Partial<TestState['downstream']>;
} = {}): TestState => {
  const targetA: TestTarget = {
    id: TARGET_ID,
    requestId: REQUEST_ID,
    destinationId: 'destination-1',
    campaignId: CAMPAIGN_ID,
    logicalGroupFingerprint: 'group-fingerprint-1',
    assignedInstanceName: 'instance-1',
    candidateId: options.targetCandidateId ?? null,
    runId: null,
    dispatchId: null,
    outboxId: null,
    status: 'AMBIGUOUS',
    blockedReason: 'HISTORICAL_FAILURE',
    investigationRequired: true,
    createdAt: HISTORIC_COMPLETED_AT,
    updatedAt: HISTORIC_COMPLETED_AT,
    destination: null,
    campaign: null,
    candidate: null,
    run: null,
    dispatch: null,
    outbox: null,
  };
  const targets = [targetA];
  if (options.secondTargetStatus) {
    targets.push({
      ...targetA,
      id: 'manual-publication-target-2',
      destinationId: 'destination-2',
      campaignId: 'campaign-2',
      logicalGroupFingerprint: 'group-fingerprint-2',
      status: options.secondTargetStatus,
      blockedReason: null,
      investigationRequired: false,
    });
  }
  return {
    request: {
      id: REQUEST_ID,
      idempotencyKey: 'manual-idempotency-1',
      payloadHash: 'payload-hash-1',
      mode: 'SEND',
      productId: PRODUCT_ID,
      requestedSnapshotId: SNAPSHOT_ID,
      requestedSnapshotRevision: 1,
      requestedSnapshotFingerprint: 'snapshot-fingerprint-1',
      status: 'AMBIGUOUS',
      createdAt: HISTORIC_COMPLETED_AT,
      updatedAt: HISTORIC_COMPLETED_AT,
      completedAt: HISTORIC_COMPLETED_AT,
      processingOwnerId: null,
      processingLeaseExpiresAt: null,
      targets,
    },
    execution: {
      id: EXECUTION_ID,
      schedulerJobId: `manual-publication:${REQUEST_ID}:${TARGET_ID}`,
      bullMqJobId: null,
      activeKey: null,
      ownerId: 'historical-owner-1',
      heartbeatAt: new Date('2026-08-26T19:38:08.381Z'),
      leaseExpiresAt: new Date('2026-08-26T19:40:08.381Z'),
      mode: 'SEND',
      status: 'AMBIGUOUS',
      externalStage: 'EXTERNAL_MAY_HAVE_STARTED',
      reasons: [],
      commercialRunId: options.executionCommercialRunId ?? null,
      failureCode: 'HISTORICAL_FAILURE',
      startedAt: new Date('2026-08-26T19:38:08.283Z'),
      completedAt: HISTORIC_COMPLETED_AT,
    },
    campaign: {
      id: CAMPAIGN_ID,
      attemptExecutionId:
        options.campaignOwner === undefined
          ? EXECUTION_ID
          : options.campaignOwner,
      attemptReservedAt: new Date('2026-08-26T19:38:08.283Z'),
      attemptLeaseExpiresAt: new Date('2026-08-26T19:40:08.283Z'),
    },
    candidate: {
      id: CANDIDATE_ID,
      campaignId: CAMPAIGN_ID,
      productId: PRODUCT_ID,
      snapshotId: SNAPSHOT_ID,
      generatedCopyId: null,
      status: options.candidateStatus ?? 'QUEUED',
    },
    downstream: {
      run: null,
      dispatch: null,
      outbox: null,
      copyAttempt: null,
      generatedCopy: null,
      ...options.downstream,
    },
  };
};

const createSubject = (options: {
  failStage?: RecoveryStage;
  campaignOwner?: string | null;
  executionCommercialRunId?: string | null;
  targetCandidateId?: string | null;
  candidateStatus?: 'QUEUED' | 'COPY_READY';
  secondTargetStatus?: 'ACCEPTED' | 'AMBIGUOUS' | 'BLOCKED';
  downstream?: Partial<TestState['downstream']>;
} = {}): TestSubject => {
  let state = createState(options);
  const writeCounts = {
    campaign: 0,
    execution: 0,
    target: 0,
    request: 0,
  };
  const requestUpdateMany = vi.fn(
    async (input: { data: { status: TestRequest['status']; completedAt: Date | null } }) => {
      if (options.failStage === 'request') return { count: 0 };
      if (state.request.status !== 'AMBIGUOUS') return { count: 0 };
      state.request.status = input.data.status;
      state.request.completedAt = input.data.completedAt;
      writeCounts.request += 1;
      return { count: 1 };
    },
  );
  const transaction = {
    manualPublicationRequest: {
      findUnique: vi.fn(async () => state.request),
      updateMany: requestUpdateMany,
    },
    manualPublicationTarget: {
      updateMany: vi.fn(async () => {
        if (options.failStage === 'target') return { count: 0 };
        const target = state.request.targets.find(({ id }) => id === TARGET_ID);
        if (!target || target.status !== 'AMBIGUOUS' || !target.investigationRequired) {
          return { count: 0 };
        }
        target.status = 'BLOCKED';
        target.investigationRequired = false;
        writeCounts.target += 1;
        return { count: 1 };
      }),
    },
    commercialAutomationExecution: {
      findUnique: vi.fn(async () => state.execution),
      updateMany: vi.fn(async () => {
        if (options.failStage === 'execution') return { count: 0 };
        if (state.execution.status !== 'AMBIGUOUS') return { count: 0 };
        state.execution.status = 'BLOCKED';
        writeCounts.execution += 1;
        return { count: 1 };
      }),
    },
    commercialGroupCampaign: {
      findUnique: vi.fn(async () => state.campaign),
      findMany: vi.fn(async () =>
        state.campaign.attemptExecutionId === EXECUTION_ID
          ? [state.campaign]
          : [],
      ),
      updateMany: vi.fn(async () => {
        if (options.failStage === 'campaign') return { count: 0 };
        if (state.campaign.attemptExecutionId !== EXECUTION_ID) {
          return { count: 0 };
        }
        state.campaign.attemptExecutionId = null;
        state.campaign.attemptReservedAt = null;
        state.campaign.attemptLeaseExpiresAt = null;
        writeCounts.campaign += 1;
        return { count: 1 };
      }),
    },
    commercialPromotionCandidate: {
      findUnique: vi.fn(async () => state.candidate),
    },
    commercialPipelineRun: {
      findUnique: vi.fn(async () => state.downstream.run),
    },
    whatsAppDispatch: {
      findFirst: vi.fn(async () => state.downstream.dispatch),
    },
    commercialDispatchOutbox: {
      findFirst: vi.fn(async () => state.downstream.outbox),
    },
    commercialCopyGenerationAttempt: {
      findFirst: vi.fn(async () => state.downstream.copyAttempt),
    },
    generatedCopy: {
      findFirst: vi.fn(async () => state.downstream.generatedCopy),
    },
  };
  let transactionQueue: Promise<void> = Promise.resolve();
  const transactionRunner = vi.fn(
    (
      callback: (client: typeof transaction) => Promise<unknown>,
    ) => {
      const run = transactionQueue.then(async () => {
        const before = clone(state);
        try {
          return await callback(transaction);
        } catch (error) {
          state = before;
          throw error;
        }
      });
      transactionQueue = run.then(() => undefined, () => undefined);
      return run;
    },
  );
  const repository = new PrismaManualPublicationRequestRepository({
    ...transaction,
    $transaction: transactionRunner,
  } as never);
  return {
    repository,
    readState: () => state,
    writeCounts,
    transactionRunner,
    initialState: clone(state),
  };
};

const reconciliationInput = {
  requestId: REQUEST_ID,
  targetId: TARGET_ID,
  executionId: EXECUTION_ID,
  now: NOW,
};

describe('safe pre-provider manual publication reconciliation', () => {
  it('reconciles the certified historical lifecycle with exactly four logical writes', async () => {
    const subject = createSubject();

    const result = await subject.repository.reconcileSafePreProviderAmbiguity(
      reconciliationInput,
    );

    expect(result).toMatchObject({
      outcome: 'RECONCILED',
      writes: 4,
      request: {
        id: REQUEST_ID,
        status: 'BLOCKED',
        completedAt: HISTORIC_COMPLETED_AT,
        targets: [
          {
            id: TARGET_ID,
            status: 'BLOCKED',
            investigationRequired: false,
            blockedReason: 'HISTORICAL_FAILURE',
          },
        ],
      },
    });
    expect(subject.writeCounts).toEqual({
      campaign: 1,
      execution: 1,
      target: 1,
      request: 1,
    });
    expect(subject.readState().campaign).toMatchObject({
      attemptExecutionId: null,
      attemptReservedAt: null,
      attemptLeaseExpiresAt: null,
    });
    expect(subject.readState().execution).toMatchObject({
      status: 'BLOCKED',
      externalStage: 'EXTERNAL_MAY_HAVE_STARTED',
      failureCode: 'HISTORICAL_FAILURE',
      completedAt: HISTORIC_COMPLETED_AT,
    });
    expect(subject.readState().candidate).toEqual(subject.initialState.candidate);
    expect(subject.transactionRunner).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });

  it.each(['campaign', 'execution', 'target', 'request'] as RecoveryStage[])(
    'rolls back every mutation when the %s CAS fails',
    async (failStage) => {
      const subject = createSubject({ failStage });

      await expect(
        subject.repository.reconcileSafePreProviderAmbiguity(
          reconciliationInput,
        ),
      ).rejects.toMatchObject({ code: 'RECOVERY_CAS_CONFLICT' });

      expect(subject.readState()).toEqual(subject.initialState);
    },
  );

  it('rejects a campaign reservation owned by another execution without writes', async () => {
    const subject = createSubject({ campaignOwner: 'other-execution' });

    await expect(
      subject.repository.reconcileSafePreProviderAmbiguity(reconciliationInput),
    ).rejects.toMatchObject({
      code: 'RECOVERY_RESERVATION_OWNERSHIP_MISMATCH',
    });
    expect(subject.writeCounts).toEqual({
      campaign: 0,
      execution: 0,
      target: 0,
      request: 0,
    });
  });

  it.each([
    ['run', { run: { id: 'run-1' } }],
    ['dispatch', { dispatch: { id: 'dispatch-1' } }],
    ['outbox', { outbox: { id: 'outbox-1' } }],
    ['copy attempt', { copyAttempt: { id: 'copy-attempt-1' } }],
    ['generated copy', { generatedCopy: { id: 'copy-1' } }],
  ] as const)('rejects downstream %s evidence without writes', async (_label, downstream) => {
    const subject = createSubject({ downstream });

    await expect(
      subject.repository.reconcileSafePreProviderAmbiguity(reconciliationInput),
    ).rejects.toMatchObject({ code: 'RECOVERY_NOT_SAFE' });
    expect(subject.writeCounts).toEqual({
      campaign: 0,
      execution: 0,
      target: 0,
      request: 0,
    });
  });

  it('rejects an execution already linked to a commercial run without writes', async () => {
    const subject = createSubject({ executionCommercialRunId: 'run-1' });

    await expect(
      subject.repository.reconcileSafePreProviderAmbiguity(reconciliationInput),
    ).rejects.toMatchObject({ code: 'RECOVERY_NOT_SAFE' });
    expect(subject.writeCounts).toEqual({
      campaign: 0,
      execution: 0,
      target: 0,
      request: 0,
    });
  });

  it('rejects a lifecycle whose historical target reason does not match the execution', async () => {
    const subject = createSubject();
    subject.readState().request.targets[0].blockedReason = 'ARBITRARY_BLOCK';

    await expect(
      subject.repository.reconcileSafePreProviderAmbiguity(reconciliationInput),
    ).rejects.toMatchObject({ code: 'RECOVERY_NOT_SAFE' });
    expect(subject.writeCounts).toEqual({
      campaign: 0,
      execution: 0,
      target: 0,
      request: 0,
    });
  });

  it('returns a zero-write idempotent replay after a successful reconciliation', async () => {
    const subject = createSubject();

    const first = await subject.repository.reconcileSafePreProviderAmbiguity(
      reconciliationInput,
    );
    const second = await subject.repository.reconcileSafePreProviderAmbiguity(
      reconciliationInput,
    );

    expect(first.outcome).toBe('RECONCILED');
    expect(second).toMatchObject({ outcome: 'ALREADY_RECONCILED', writes: 0 });
    expect(subject.writeCounts).toEqual({
      campaign: 1,
      execution: 1,
      target: 1,
      request: 1,
    });
  });

  it('does not classify an incomplete terminal request as a replay', async () => {
    const subject = createSubject();

    await subject.repository.reconcileSafePreProviderAmbiguity(
      reconciliationInput,
    );
    subject.readState().request.completedAt = null;

    await expect(
      subject.repository.reconcileSafePreProviderAmbiguity(reconciliationInput),
    ).rejects.toMatchObject({ code: 'RECOVERY_NOT_SAFE' });
    expect(subject.writeCounts).toEqual({
      campaign: 1,
      execution: 1,
      target: 1,
      request: 1,
    });
  });

  it('serializes concurrent calls into one recovery and one safe replay', async () => {
    const subject = createSubject();

    const results = await Promise.all([
      subject.repository.reconcileSafePreProviderAmbiguity(reconciliationInput),
      subject.repository.reconcileSafePreProviderAmbiguity(reconciliationInput),
    ]);

    expect(results.map(({ outcome }) => outcome).sort()).toEqual([
      'ALREADY_RECONCILED',
      'RECONCILED',
    ]);
    expect(subject.writeCounts).toEqual({
      campaign: 1,
      execution: 1,
      target: 1,
      request: 1,
    });
    expect(subject.readState().request.targets[0]).toMatchObject({
      status: 'BLOCKED',
      investigationRequired: false,
    });
  });

  it('isolates a recovered target from an independent sibling in aggregate semantics', async () => {
    const subject = createSubject({ secondTargetStatus: 'ACCEPTED' });

    const result = await subject.repository.reconcileSafePreProviderAmbiguity(
      reconciliationInput,
    );

    expect(result.request.status).toBe('PROCESSING');
    expect(result.request.targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: TARGET_ID,
          status: 'BLOCKED',
          investigationRequired: false,
        }),
        expect.objectContaining({
          id: 'manual-publication-target-2',
          status: 'ACCEPTED',
          investigationRequired: false,
        }),
      ]),
    );
    expect(subject.writeCounts).toEqual({
      campaign: 1,
      execution: 1,
      target: 1,
      request: 1,
    });
  });
});

describe('manual reconciliation service and route contract', () => {
  it.each([undefined, 'SEND_FAILED_CONFIRMED'])(
    'rejects resolution %s before repository access',
    async (resolution) => {
      const reconcile = vi.fn();
      const service = new ManualPublicationService({
        requests: { reconcileSafePreProviderAmbiguity: reconcile },
      } as never);

      await expect(
        service.reconcileSafePreProviderAmbiguity(REQUEST_ID, {
          targetId: TARGET_ID,
          executionId: EXECUTION_ID,
          resolution: resolution as string,
          confirmation: MANUAL_PUBLICATION_RECONCILIATION_CONFIRMATION,
        }),
      ).rejects.toMatchObject({
        code: 'MANUAL_PUBLICATION_RECOVERY_RESOLUTION_INVALID',
      });
      expect(reconcile).not.toHaveBeenCalled();
    },
  );

  it('keeps the reconciliation endpoint behind the existing Bearer auth guard', async () => {
    const reconcile = vi.fn();
    const app = await buildApp({
      logger: false,
      localApiAuthToken: 'local-api-test-token',
      prisma: {} as never,
      manualPublicationService: {
        getOptions: vi.fn(),
        create: vi.fn(),
        preview: vi.fn(),
        find: vi.fn(),
        reconcileSafePreProviderAmbiguity: reconcile,
      },
    });

    const [missing, invalid] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/commercial-publications/manual/${REQUEST_ID}/reconcile`,
        payload: {
          targetId: TARGET_ID,
          executionId: EXECUTION_ID,
          resolution: MANUAL_PUBLICATION_RECONCILIATION_RESOLUTION,
          confirmation: MANUAL_PUBLICATION_RECONCILIATION_CONFIRMATION,
        },
      }),
      app.inject({
        method: 'POST',
        url: `/commercial-publications/manual/${REQUEST_ID}/reconcile`,
        headers: { authorization: 'Bearer wrong-token' },
        payload: {
          targetId: TARGET_ID,
          executionId: EXECUTION_ID,
          resolution: MANUAL_PUBLICATION_RECONCILIATION_RESOLUTION,
          confirmation: MANUAL_PUBLICATION_RECONCILIATION_CONFIRMATION,
        },
      }),
    ]);

    await app.close();
    expect(missing.statusCode).toBe(401);
    expect(invalid.statusCode).toBe(401);
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('binds the repository receiver for a valid service reconciliation', async () => {
    const subject = createSubject();
    const service = new ManualPublicationService({
      requests: subject.repository,
      offers: {
        findOfferById: vi.fn().mockResolvedValue({
          productName: 'Produto de teste',
          source: 'OFFICIAL',
        }),
      },
    } as never);

    const result = await service.reconcileSafePreProviderAmbiguity(REQUEST_ID, {
      targetId: TARGET_ID,
      executionId: EXECUTION_ID,
      resolution: MANUAL_PUBLICATION_RECONCILIATION_RESOLUTION,
      confirmation: MANUAL_PUBLICATION_RECONCILIATION_CONFIRMATION,
    });

    expect(result).toMatchObject({
      alreadyReconciled: false,
      request: { id: REQUEST_ID, status: 'BLOCKED' },
    });
    expect(subject.writeCounts).toEqual({
      campaign: 1,
      execution: 1,
      target: 1,
      request: 1,
    });
  });

  it('accepts only the strict authenticated reconciliation payload', async () => {
    const reconcile = vi.fn().mockResolvedValue({
      request: { status: 'BLOCKED' },
      alreadyReconciled: false,
    });
    const app = await buildApp({
      logger: false,
      localApiAuthToken: 'local-api-test-token',
      prisma: {} as never,
      manualPublicationService: {
        getOptions: vi.fn(),
        create: vi.fn(),
        preview: vi.fn(),
        find: vi.fn(),
        reconcileSafePreProviderAmbiguity: reconcile,
      },
    });

    const payload = {
      targetId: TARGET_ID,
      executionId: EXECUTION_ID,
      resolution: MANUAL_PUBLICATION_RECONCILIATION_RESOLUTION,
      confirmation: MANUAL_PUBLICATION_RECONCILIATION_CONFIRMATION,
    };
    const invalid = await app.inject({
      method: 'POST',
      url: `/commercial-publications/manual/${REQUEST_ID}/reconcile`,
      headers: { authorization: 'Bearer local-api-test-token' },
      payload: { ...payload, force: true },
    });
    const valid = await app.inject({
      method: 'POST',
      url: `/commercial-publications/manual/${REQUEST_ID}/reconcile`,
      headers: { authorization: 'Bearer local-api-test-token' },
      payload,
    });

    await app.close();
    expect(invalid.statusCode).toBe(400);
    expect(valid.statusCode).toBe(200);
    expect(reconcile).toHaveBeenCalledOnce();
    expect(reconcile).toHaveBeenCalledWith(REQUEST_ID, payload);
  });

  it('maps invalid confirmation to a zero-mutation client error', async () => {
    const reconcile = vi.fn();
    const service = new ManualPublicationService({
      requests: { reconcileSafePreProviderAmbiguity: reconcile },
    } as never);

    await expect(
      service.reconcileSafePreProviderAmbiguity(REQUEST_ID, {
        targetId: TARGET_ID,
        executionId: EXECUTION_ID,
        resolution: MANUAL_PUBLICATION_RECONCILIATION_RESOLUTION,
        confirmation: 'WRONG_CONFIRMATION',
      }),
    ).rejects.toMatchObject({
      code: 'MANUAL_PUBLICATION_RECOVERY_CONFIRMATION_INVALID',
    });
    expect(reconcile).not.toHaveBeenCalled();
  });
});
