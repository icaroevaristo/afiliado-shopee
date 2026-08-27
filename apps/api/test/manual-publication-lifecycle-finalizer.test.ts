import { describe, expect, it } from 'vitest';

import { ManualPublicationLifecycleFinalizer } from '../src/manual-publication-lifecycle-finalizer';
import { PrismaManualPublicationRequestRepository } from '../src/prisma-repositories';
import type {
  CommercialDispatchOutboxStatus,
  CommercialPipelineFinalStatus,
  CommercialPipelineRunStatus,
  ManualPublicationRequestRecord,
  ManualPublicationTargetRecord,
  ManualPublicationTargetStatus,
  WhatsAppDispatchStatus,
} from '../src/repositories';

const NOW = new Date('2026-08-27T12:00:00.000Z');
const REQUEST_ID = 'manual-request-1';
const TARGET_A_ID = 'manual-request-1-target-a';
const TARGET_B_ID = 'manual-request-1-target-b';
const RUN_A_ID = 'run-a';
const DISPATCH_A_ID = 'dispatch-a';
const OUTBOX_A_ID = 'outbox-a';

type RawTarget = Pick<
  ManualPublicationTargetRecord,
  | 'id'
  | 'requestId'
  | 'candidateId'
  | 'runId'
  | 'dispatchId'
  | 'outboxId'
  | 'status'
  | 'blockedReason'
  | 'investigationRequired'
  | 'createdAt'
  | 'updatedAt'
>;

type RawRequest = Pick<
  ManualPublicationRequestRecord,
  | 'id'
  | 'idempotencyKey'
  | 'payloadHash'
  | 'mode'
  | 'productId'
  | 'requestedSnapshotId'
  | 'requestedSnapshotRevision'
  | 'requestedSnapshotFingerprint'
  | 'status'
  | 'createdAt'
  | 'updatedAt'
  | 'completedAt'
  | 'processingOwnerId'
  | 'processingLeaseExpiresAt'
> & { targets: RawTarget[] };

type RawDispatch = {
  id: string;
  status: WhatsAppDispatchStatus;
  attemptCount: number;
  externalMessageId: string | null;
  sentAt: Date | null;
};

type RawRun = {
  id: string;
  dispatchId: string;
  status: CommercialPipelineRunStatus;
  finalStatus: CommercialPipelineFinalStatus | null;
  investigationRequired: boolean;
};

type RawOutbox = {
  id: string;
  commercialRunId: string;
  dispatchId: string;
  status: CommercialDispatchOutboxStatus;
};

type LifecycleState = {
  request: RawRequest;
  dispatches: RawDispatch[];
  runs: RawRun[];
  outboxes: RawOutbox[];
};

const target = (id: string, overrides: Partial<RawTarget> = {}): RawTarget => ({
  id,
  requestId: REQUEST_ID,
  candidateId: `${id}-candidate`,
  runId: null,
  dispatchId: null,
  outboxId: null,
  status: 'QUEUED',
  blockedReason: null,
  investigationRequired: false,
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

const createState = (
  input: {
    targetStatus?: ManualPublicationTargetStatus;
    dispatchStatus?: WhatsAppDispatchStatus;
    runStatus?: CommercialPipelineRunStatus;
    finalStatus?: CommercialPipelineFinalStatus;
    runInvestigationRequired?: boolean;
    outboxStatus?: CommercialDispatchOutboxStatus;
    includeTargetB?: boolean;
  } = {},
): LifecycleState => {
  const targetA = target(TARGET_A_ID, {
    status: input.targetStatus ?? 'QUEUED',
    runId: RUN_A_ID,
    dispatchId: DISPATCH_A_ID,
    outboxId: OUTBOX_A_ID,
  });
  const request: RawRequest = {
    id: REQUEST_ID,
    idempotencyKey: 'manual-key-1',
    payloadHash: 'payload-hash-1',
    mode: 'SEND',
    productId: 'product-1',
    requestedSnapshotId: 'snapshot-1',
    requestedSnapshotRevision: 1,
    requestedSnapshotFingerprint: 'snapshot-fingerprint-1',
    status: 'PROCESSING',
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null,
    processingOwnerId: 'owner-1',
    processingLeaseExpiresAt: new Date(NOW.getTime() + 60_000),
    targets: [targetA],
  };
  if (input.includeTargetB) request.targets.push(target(TARGET_B_ID));

  return {
    request,
    dispatches: [
      {
        id: DISPATCH_A_ID,
        status: input.dispatchStatus ?? 'SENT',
        attemptCount: 1,
        externalMessageId: 'external-a',
        sentAt: NOW,
      },
    ],
    runs: [
      {
        id: RUN_A_ID,
        dispatchId: DISPATCH_A_ID,
        status: input.runStatus ?? 'COMPLETED',
        finalStatus: input.finalStatus ?? 'SENT',
        investigationRequired: input.runInvestigationRequired ?? false,
      },
    ],
    outboxes: [
      {
        id: OUTBOX_A_ID,
        commercialRunId: RUN_A_ID,
        dispatchId: DISPATCH_A_ID,
        status: input.outboxStatus ?? 'PUBLISHED',
      },
    ],
  };
};

const sameValue = (actual: unknown, expected: unknown) =>
  actual instanceof Date && expected instanceof Date
    ? actual.getTime() === expected.getTime()
    : actual === expected;

const createSubject = (
  state: LifecycleState,
  options: { failRequestUpdate?: boolean } = {},
) => {
  let failRequestUpdate = options.failRequestUpdate ?? false;
  const targetUpdateMany = async (args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }) => {
    const item = state.request.targets.find((candidate) =>
      Object.entries(args.where).every(([key, expected]) =>
        sameValue(candidate[key as keyof RawTarget], expected),
      ),
    );
    if (!item) return { count: 0 };
    Object.assign(item, args.data);
    return { count: 1 };
  };
  const requestUpdateMany = async (args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }) => {
    if (failRequestUpdate) return { count: 0 };
    const requestMatches = Object.entries(args.where).every(([key, expected]) =>
      sameValue(state.request[key as keyof RawRequest], expected),
    );
    if (!requestMatches) return { count: 0 };
    Object.assign(state.request, args.data);
    return { count: 1 };
  };
  const transaction = {
    commercialPipelineRun: {
      findUnique: async (args: { where: { dispatchId: string } }) =>
        state.runs.find((run) => run.dispatchId === args.where.dispatchId) ??
        null,
    },
    whatsAppDispatch: {
      findUnique: async (args: { where: { id: string } }) =>
        state.dispatches.find((dispatch) => dispatch.id === args.where.id) ??
        null,
    },
    commercialDispatchOutbox: {
      findUnique: async (args: { where: { dispatchId: string } }) =>
        state.outboxes.find(
          (outbox) => outbox.dispatchId === args.where.dispatchId,
        ) ?? null,
    },
    manualPublicationTarget: {
      findMany: async (args: {
        where: { OR: Array<Record<string, string>> };
      }) =>
        state.request.targets.filter((candidate) =>
          args.where.OR.some((condition) =>
            Object.entries(condition).every(([key, expected]) =>
              sameValue(candidate[key as keyof RawTarget], expected),
            ),
          ),
        ),
      updateMany: targetUpdateMany,
    },
    manualPublicationRequest: {
      findUnique: async (args: { where: { id: string } }) =>
        args.where.id === state.request.id ? state.request : null,
      updateMany: requestUpdateMany,
    },
  };
  const prisma = {
    $transaction: async <T>(
      callback: (value: typeof transaction) => Promise<T>,
    ) => {
      const snapshot = structuredClone(state);
      try {
        return await callback(transaction);
      } catch (error) {
        state.request = snapshot.request;
        state.dispatches = snapshot.dispatches;
        state.runs = snapshot.runs;
        state.outboxes = snapshot.outboxes;
        throw error;
      }
    },
  };
  return {
    state,
    setFailRequestUpdate(value: boolean) {
      failRequestUpdate = value;
    },
    repository: new PrismaManualPublicationRequestRepository(prisma as never),
  };
};

const createFinalizer = (subject: ReturnType<typeof createSubject>) =>
  new ManualPublicationLifecycleFinalizer(subject.repository, {
    clock: () => NOW,
    logger: { info: () => undefined, error: () => undefined },
  });

describe('ManualPublicationLifecycleFinalizer', () => {
  it('finaliza target e request depois de SENT, limpando a lease', async () => {
    const subject = createSubject(createState());

    const result =
      await createFinalizer(subject).finalizeAfterDispatch(DISPATCH_A_ID);

    expect(result).toMatchObject({
      outcome: 'FINALIZED',
      requestId: REQUEST_ID,
      targetId: TARGET_A_ID,
      targetStatus: 'SENT',
      requestStatus: 'COMPLETED',
      writes: 2,
    });
    expect(subject.state.request.targets[0]).toMatchObject({
      status: 'SENT',
      investigationRequired: false,
    });
    expect(subject.state.request).toMatchObject({
      status: 'COMPLETED',
      completedAt: NOW,
      processingOwnerId: null,
      processingLeaseExpiresAt: null,
    });
  });

  it('é idempotente no replay e não cria lifecycle duplicado', async () => {
    const subject = createSubject(createState());
    const finalizer = createFinalizer(subject);

    await finalizer.finalizeAfterDispatch(DISPATCH_A_ID);
    const replay = await finalizer.finalizeAfterDispatch(DISPATCH_A_ID);

    expect(replay).toMatchObject({
      outcome: 'ALREADY_FINALIZED',
      writes: 0,
      targetStatus: 'SENT',
      requestStatus: 'COMPLETED',
    });
  });

  it('preserva target irmão ativo e mantém request PROCESSING no primeiro envio', async () => {
    const subject = createSubject(createState({ includeTargetB: true }));

    await createFinalizer(subject).finalizeAfterDispatch(DISPATCH_A_ID);

    expect(subject.state.request.targets).toMatchObject([
      { id: TARGET_A_ID, status: 'SENT' },
      { id: TARGET_B_ID, status: 'QUEUED' },
    ]);
    expect(subject.state.request).toMatchObject({
      status: 'PROCESSING',
      completedAt: null,
      processingOwnerId: 'owner-1',
    });

    const runBId = 'run-b';
    const dispatchBId = 'dispatch-b';
    const outboxBId = 'outbox-b';
    subject.state.request.targets[1] = target(TARGET_B_ID, {
      runId: runBId,
      dispatchId: dispatchBId,
      outboxId: outboxBId,
    });
    subject.state.runs.push({
      id: runBId,
      dispatchId: dispatchBId,
      status: 'COMPLETED',
      finalStatus: 'SENT',
      investigationRequired: false,
    });
    subject.state.dispatches.push({
      id: dispatchBId,
      status: 'SENT',
      attemptCount: 1,
      externalMessageId: 'external-b',
      sentAt: NOW,
    });
    subject.state.outboxes.push({
      id: outboxBId,
      commercialRunId: runBId,
      dispatchId: dispatchBId,
      status: 'PUBLISHED',
    });

    await createFinalizer(subject).finalizeAfterDispatch(dispatchBId);

    expect(subject.state.request.targets).toMatchObject([
      { id: TARGET_A_ID, status: 'SENT' },
      { id: TARGET_B_ID, status: 'SENT' },
    ]);
    expect(subject.state.request).toMatchObject({
      status: 'COMPLETED',
      processingOwnerId: null,
      processingLeaseExpiresAt: null,
    });
  });

  it('projeta FAILED somente pelo estado terminal persistido', async () => {
    const subject = createSubject(
      createState({
        dispatchStatus: 'FAILED',
        runStatus: 'FAILED',
        finalStatus: 'FAILED',
        targetStatus: 'QUEUED',
      }),
    );

    const result =
      await createFinalizer(subject).finalizeAfterDispatch(DISPATCH_A_ID);

    expect(result).toMatchObject({
      targetStatus: 'FAILED',
      requestStatus: 'FAILED',
    });
    expect(subject.state.request.targets[0].investigationRequired).toBe(false);
    expect(subject.state.request.processingOwnerId).toBeNull();
  });

  it('projeta AMBIGUOUS e conserva o fail-closed quando há investigação', async () => {
    const subject = createSubject(
      createState({
        dispatchStatus: 'PROCESSING',
        runStatus: 'FAILED',
        finalStatus: 'AMBIGUOUS',
        runInvestigationRequired: true,
        outboxStatus: 'AMBIGUOUS',
      }),
    );

    const result =
      await createFinalizer(subject).finalizeAfterDispatch(DISPATCH_A_ID);

    expect(result).toMatchObject({
      targetStatus: 'AMBIGUOUS',
      requestStatus: 'AMBIGUOUS',
    });
    expect(subject.state.request.targets[0]).toMatchObject({
      status: 'AMBIGUOUS',
      investigationRequired: true,
    });
  });

  it('não infere terminalidade de job quando run/dispatch ainda estão pendentes', async () => {
    const subject = createSubject(
      createState({
        dispatchStatus: 'PENDING',
        runStatus: 'STARTED',
        finalStatus: 'PENDING',
        targetStatus: 'QUEUED',
      }),
    );

    const result =
      await createFinalizer(subject).finalizeAfterDispatch(DISPATCH_A_ID);

    expect(result).toEqual({ outcome: 'NOT_TERMINAL', writes: 0 });
    expect(subject.state.request.targets[0].status).toBe('QUEUED');
    expect(subject.state.request.status).toBe('PROCESSING');
  });

  it('faz rollback atômico quando request falha e converge em replay sem provider', async () => {
    const subject = createSubject(createState(), { failRequestUpdate: true });
    const finalizer = createFinalizer(subject);

    await expect(
      finalizer.finalizeAfterDispatch(DISPATCH_A_ID),
    ).rejects.toMatchObject({
      code: 'MANUAL_PUBLICATION_LIFECYCLE_CAS_CONFLICT',
    });
    expect(subject.state.request.targets[0].status).toBe('QUEUED');
    expect(subject.state.request.status).toBe('PROCESSING');

    subject.setFailRequestUpdate(false);
    await expect(
      finalizer.finalizeAfterDispatch(DISPATCH_A_ID),
    ).resolves.toMatchObject({
      outcome: 'FINALIZED',
      targetStatus: 'SENT',
      requestStatus: 'COMPLETED',
    });
  });
});
