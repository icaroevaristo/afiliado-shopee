import { describe, expect, it, vi } from 'vitest';

import {
  CommercialRecoveryCoordinator,
  type CommercialRecoveryJob,
  type CommercialRecoveryPublishResult,
} from '../src/commercial-recovery-coordinator';
import type {
  CommercialAutomationExecutionRecord,
  CommercialAutomationExecutionRecoveryContext,
  CommercialAutomationSettingsRecord,
  CommercialDispatchOutboxPublicationContext,
  CommercialDispatchOutboxRecord,
} from '../src/repositories';

const now = new Date('2026-08-29T12:00:00.000Z');
const old = new Date('2026-08-29T10:00:00.000Z');

const settingsRecord = (
  paused: boolean,
): CommercialAutomationSettingsRecord => ({
  paused,
  pausedAt: null,
  resumedAt: null,
  allowedStartTime: null,
  allowedEndTime: null,
  minimumIntervalMinutes: null,
  staggerMinutes: null,
  dailyGlobalLimit: null,
  dailyGroupLimit: null,
  scheduleRevision: 1,
  updatedAt: old,
});

const execution = (
  overrides: Partial<CommercialAutomationExecutionRecord> = {},
): CommercialAutomationExecutionRecord => ({
  id: 'execution-1',
  schedulerJobId: 'scheduled-commercial-automation',
  bullMqJobId: null,
  activeKey: 'commercial-automation',
  ownerId: 'owner-1',
  heartbeatAt: old,
  leaseExpiresAt: old,
  mode: 'SEND',
  status: 'STARTED',
  externalStage: 'NOT_REACHED',
  reasons: [],
  commercialRunId: null,
  failureCode: null,
  startedAt: old,
  completedAt: null,
  ...overrides,
});

const outbox = (
  overrides: Partial<CommercialDispatchOutboxRecord> = {},
): CommercialDispatchOutboxRecord => ({
  id: 'outbox-1',
  commercialRunId: 'run-1',
  dispatchId: 'dispatch-1',
  jobId: 'commercial-target-slot-1',
  instanceName: 'instance-a',
  status: 'PENDING',
  failureCode: null,
  createdAt: old,
  publishedAt: null,
  ...overrides,
});

const publicationContext = (
  overrides: {
    outbox?: Partial<CommercialDispatchOutboxRecord>;
    run?: Partial<CommercialDispatchOutboxPublicationContext['run']>;
    dispatch?: Partial<CommercialDispatchOutboxPublicationContext['dispatch']>;
  } = {},
): CommercialDispatchOutboxPublicationContext => {
  const currentOutbox = outbox(overrides.outbox);
  return {
    outbox: currentOutbox,
    run: {
      id: currentOutbox.commercialRunId,
      mode: 'CONFIRMED',
      status: 'STARTED',
      dispatchId: currentOutbox.dispatchId,
      jobId: null,
      executionId: null,
      instanceName: currentOutbox.instanceName,
      finalStatus: 'PENDING',
      investigationRequired: false,
      ...overrides.run,
    },
    dispatch: {
      id: currentOutbox.dispatchId,
      status: 'PENDING',
      attemptCount: 0,
      instanceName: currentOutbox.instanceName,
      externalMessageId: null,
      sentAt: null,
      ...overrides.dispatch,
    },
  };
};

const createSubject = (input: {
  paused?: boolean;
  executions?: CommercialAutomationExecutionRecord[];
  executionContexts?: Map<
    string,
    CommercialAutomationExecutionRecoveryContext | null
  >;
  outboxes?: CommercialDispatchOutboxRecord[];
  publicationContexts?: Map<string, CommercialDispatchOutboxPublicationContext>;
  queueJobs?: Map<string, CommercialRecoveryJob>;
  queueAvailable?: boolean;
  recoverExecution?: (executionId: string) => Promise<{
    outcome: 'recovered' | 'already-terminal' | 'investigation-required';
  }>;
  publishOutbox?: (
    outboxId: string,
  ) => Promise<CommercialRecoveryPublishResult>;
  finalizeAfterDispatch?: (dispatchId: string) => Promise<unknown>;
}) => {
  const executions = input.executions ?? [];
  const outboxes = input.outboxes ?? [];
  const executionContexts = input.executionContexts ?? new Map();
  const publicationContexts = input.publicationContexts ?? new Map();
  const queueJobs = input.queueJobs ?? new Map();
  const hasJob = vi.fn(async (jobId: string) => queueJobs.has(jobId));
  const getJob = vi.fn(async (jobId: string) => queueJobs.get(jobId) ?? null);
  const enqueue = vi.fn(async () => undefined);
  const recoverExecution =
    input.recoverExecution ??
    vi.fn(async () => ({ outcome: 'recovered' as const }));
  const publishOutbox = input.publishOutbox ?? vi.fn();
  const finalizeAfterDispatch = input.finalizeAfterDispatch ?? vi.fn();
  const logger = { info: vi.fn(), error: vi.fn() };

  const subject = new CommercialRecoveryCoordinator({
    settings: {
      get: async () => settingsRecord(input.paused ?? true),
    },
    executions: {
      list: async () => ({ items: executions, total: executions.length }),
      findRecoveryContext: async (id) => executionContexts.get(id) ?? null,
    },
    outboxes: {
      list: async () => ({ items: outboxes, total: outboxes.length }),
      findPublicationContext: async (id) => publicationContexts.get(id) ?? null,
    },
    queue:
      input.queueAvailable === false ? undefined : { hasJob, getJob, enqueue },
    recoverExecution,
    publishOutbox,
    finalizeAfterDispatch,
    clock: () => now,
    logger,
    pageSize: 10,
  });

  return {
    subject,
    hasJob,
    getJob,
    enqueue,
    recoverExecution,
    publishOutbox,
    finalizeAfterDispatch,
  };
};

describe('commercial recovery coordinator', () => {
  it('reuses the existing safe execution recovery contract for a stale pre-marker execution', async () => {
    const stale = execution();
    const harness = createSubject({
      executions: [stale],
      executionContexts: new Map([[stale.id, { execution: stale, run: null }]]),
    });

    await expect(harness.subject.run()).resolves.toMatchObject({
      scanned: 1,
      safeDbRecovered: 1,
      humanRequired: 0,
    });
    expect(harness.recoverExecution).toHaveBeenCalledWith(stale.id);
    expect(harness.enqueue).not.toHaveBeenCalled();
  });

  it('nao classifica como NO_ACTION uma execucao confirmada sem run verificavel', async () => {
    const stale = execution({ commercialRunId: 'missing-run' });
    const harness = createSubject({
      executions: [stale],
      executionContexts: new Map([[stale.id, { execution: stale, run: null }]]),
    });

    await expect(harness.subject.run()).resolves.toMatchObject({
      humanRequired: 1,
      noAction: 0,
      safeDbRecovered: 0,
    });
    expect(harness.recoverExecution).not.toHaveBeenCalled();
  });

  it('does not requeue a safe pending outbox while automation is paused', async () => {
    const currentOutbox = outbox();
    const context = publicationContext();
    const harness = createSubject({
      outboxes: [currentOutbox],
      publicationContexts: new Map([[currentOutbox.id, context]]),
    });

    await expect(harness.subject.run()).resolves.toMatchObject({
      scanned: 1,
      noAction: 1,
      safeQueueRecovered: 0,
    });
    expect(harness.publishOutbox).not.toHaveBeenCalled();
    expect(harness.enqueue).not.toHaveBeenCalled();
  });

  it('preserves a pending dispatch when persisted external evidence exists', async () => {
    const currentOutbox = outbox();
    const context = publicationContext({
      outbox: currentOutbox,
      dispatch: { externalMessageId: 'external-id' },
    });
    const publishOutbox = vi.fn();
    const harness = createSubject({
      paused: false,
      outboxes: [currentOutbox],
      publicationContexts: new Map([[currentOutbox.id, context]]),
      publishOutbox,
    });

    await expect(harness.subject.run()).resolves.toMatchObject({
      humanRequired: 1,
      ambiguitiesPreserved: 1,
      safeQueueRecovered: 0,
    });
    expect(publishOutbox).not.toHaveBeenCalled();
    expect(harness.enqueue).not.toHaveBeenCalled();
  });

  it('fails closed when the execution relationship is unavailable', async () => {
    const currentOutbox = outbox();
    const context = publicationContext({
      outbox: currentOutbox,
      run: { executionId: undefined },
    });
    const publishOutbox = vi.fn();
    const harness = createSubject({
      paused: false,
      outboxes: [currentOutbox],
      publicationContexts: new Map([[currentOutbox.id, context]]),
      publishOutbox,
    });

    await expect(harness.subject.run()).resolves.toMatchObject({
      humanRequired: 1,
      ambiguitiesPreserved: 1,
      safeQueueRecovered: 0,
    });
    expect(publishOutbox).not.toHaveBeenCalled();
    expect(harness.enqueue).not.toHaveBeenCalled();
  });

  it('publishes a provably pre-provider pending outbox with the original job identity when unpaused', async () => {
    const currentOutbox = outbox();
    const context = publicationContext();
    const published: CommercialRecoveryPublishResult = {
      outbox: outbox({ status: 'PUBLISHED', publishedAt: now }),
      jobCreated: true,
    };
    const publishOutbox = vi.fn(async () => published);
    const harness = createSubject({
      paused: false,
      outboxes: [currentOutbox],
      publicationContexts: new Map([[currentOutbox.id, context]]),
      publishOutbox,
    });

    await expect(harness.subject.run()).resolves.toMatchObject({
      scanned: 1,
      safeQueueRecovered: 1,
      jobsCreated: 1,
      jobsReused: 0,
      humanRequired: 0,
    });
    expect(publishOutbox).toHaveBeenCalledWith(currentOutbox.id);
  });

  it('requires the linked execution to prove the same pre-provider lifecycle', async () => {
    const currentOutbox = outbox();
    const linkedExecution = execution({
      id: 'execution-linked',
      status: 'QUEUED',
      commercialRunId: currentOutbox.commercialRunId,
      leaseExpiresAt: new Date(now.getTime() + 60_000),
    });
    const context = publicationContext({
      outbox: currentOutbox,
      run: { executionId: linkedExecution.id },
    });
    const publishOutbox = vi.fn(async () => ({
      outbox: outbox({ status: 'PUBLISHED', publishedAt: now }),
      jobCreated: true,
    }));
    const harness = createSubject({
      paused: false,
      executionContexts: new Map([
        [
          linkedExecution.id,
          {
            execution: linkedExecution,
            run: {
              id: currentOutbox.commercialRunId,
              mode: 'CONFIRMED',
              dispatchId: currentOutbox.dispatchId,
              jobId: null,
              instanceName: currentOutbox.instanceName,
              finalStatus: 'PENDING',
              investigationRequired: false,
              dispatch: {
                id: currentOutbox.dispatchId,
                status: 'PENDING',
                attemptCount: 0,
                instanceName: currentOutbox.instanceName,
                externalMessageId: null,
                sentAt: null,
              },
              outbox: currentOutbox,
            },
          },
        ],
      ]),
      outboxes: [currentOutbox],
      publicationContexts: new Map([[currentOutbox.id, context]]),
      publishOutbox,
    });

    await expect(harness.subject.run()).resolves.toMatchObject({
      safeQueueRecovered: 1,
      jobsCreated: 1,
      humanRequired: 0,
    });
    expect(publishOutbox).toHaveBeenCalledWith(currentOutbox.id);
  });

  it('preserves a pending outbox when its linked execution has an external marker', async () => {
    const currentOutbox = outbox();
    const linkedExecution = execution({
      commercialRunId: currentOutbox.commercialRunId,
      externalStage: 'EXTERNAL_MAY_HAVE_STARTED',
    });
    const context = publicationContext({
      outbox: currentOutbox,
      run: { executionId: linkedExecution.id },
    });
    const harness = createSubject({
      paused: false,
      executions: [],
      executionContexts: new Map([
        [
          linkedExecution.id,
          {
            execution: linkedExecution,
            run: null,
          },
        ],
      ]),
      outboxes: [currentOutbox],
      publicationContexts: new Map([[currentOutbox.id, context]]),
    });

    await expect(harness.subject.run()).resolves.toMatchObject({
      humanRequired: 1,
      ambiguitiesPreserved: 1,
      noAction: 0,
      safeQueueRecovered: 0,
    });
    expect(harness.publishOutbox).not.toHaveBeenCalled();
    expect(harness.enqueue).not.toHaveBeenCalled();
  });

  it('fails closed when a published outbox has no job and the dispatch is not SENT', async () => {
    const currentOutbox = outbox({ status: 'PUBLISHED', publishedAt: now });
    const context = publicationContext({
      outbox: currentOutbox,
      run: { jobId: currentOutbox.jobId },
    });
    const publishOutbox = vi.fn();
    const harness = createSubject({
      outboxes: [currentOutbox],
      publicationContexts: new Map([[currentOutbox.id, context]]),
      publishOutbox,
    });

    await expect(harness.subject.run()).resolves.toMatchObject({
      humanRequired: 1,
      ambiguitiesPreserved: 0,
    });
    expect(publishOutbox).not.toHaveBeenCalled();
    expect(harness.enqueue).not.toHaveBeenCalled();
  });

  it('preserves processing or unknown provider evidence as human-required even when published', async () => {
    const currentOutbox = outbox({ status: 'PUBLISHED', publishedAt: now });
    const context = publicationContext({
      outbox: currentOutbox,
      run: { jobId: currentOutbox.jobId },
      dispatch: { status: 'PROCESSING', attemptCount: 1 },
    });
    const harness = createSubject({
      paused: false,
      outboxes: [currentOutbox],
      publicationContexts: new Map([[currentOutbox.id, context]]),
      queueJobs: new Map([
        [
          currentOutbox.jobId,
          {
            id: currentOutbox.jobId,
            dispatchId: currentOutbox.dispatchId,
            instanceName: currentOutbox.instanceName,
          },
        ],
      ]),
    });

    await expect(harness.subject.run()).resolves.toMatchObject({
      humanRequired: 1,
      ambiguitiesPreserved: 1,
      noAction: 0,
    });
    expect(harness.finalizeAfterDispatch).not.toHaveBeenCalled();

    const unknownContext = publicationContext({
      outbox: currentOutbox,
      run: { jobId: currentOutbox.jobId },
      dispatch: {
        status: 'FAILED',
        attemptCount: 1,
        externalMessageId: undefined,
        sentAt: undefined,
      },
    });
    const unknownHarness = createSubject({
      paused: false,
      outboxes: [currentOutbox],
      publicationContexts: new Map([[currentOutbox.id, unknownContext]]),
      queueJobs: new Map([
        [
          currentOutbox.jobId,
          {
            id: currentOutbox.jobId,
            dispatchId: currentOutbox.dispatchId,
            instanceName: currentOutbox.instanceName,
          },
        ],
      ]),
    });

    await expect(unknownHarness.subject.run()).resolves.toMatchObject({
      humanRequired: 1,
      ambiguitiesPreserved: 1,
      noAction: 0,
    });
  });

  it('ignores terminal SENT history with an external marker and attemptCount greater than one', async () => {
    const currentOutbox = outbox({ status: 'PUBLISHED', publishedAt: now });
    const context = publicationContext({
      outbox: currentOutbox,
      run: {
        status: 'COMPLETED',
        finalStatus: 'SENT',
        jobId: currentOutbox.jobId,
      },
      dispatch: {
        status: 'SENT',
        attemptCount: 2,
        externalMessageId: 'external-id',
        sentAt: now,
      },
    });
    const finalizeAfterDispatch = vi.fn(async () => undefined);
    const harness = createSubject({
      outboxes: [currentOutbox],
      publicationContexts: new Map([[currentOutbox.id, context]]),
      finalizeAfterDispatch,
    });

    const report = await harness.subject.run();

    expect(report).toMatchObject({
      scanned: 1,
      historicalIgnored: 1,
      safeDbRecovered: 0,
      safeQueueRecovered: 0,
      noAction: 0,
      humanRequired: 0,
      finalizersReplayed: 0,
      ambiguitiesPreserved: 0,
    });
    expect(finalizeAfterDispatch).not.toHaveBeenCalled();
  });

  it('ignores a completed QUEUED execution when its downstream SENT history is terminal', async () => {
    const currentOutbox = outbox({ status: 'PUBLISHED', publishedAt: now });
    const terminalExecution = execution({
      id: 'execution-terminal-history',
      status: 'QUEUED',
      activeKey: null,
      completedAt: now,
      commercialRunId: currentOutbox.commercialRunId,
      externalStage: 'EXTERNAL_MAY_HAVE_STARTED',
    });
    const context = publicationContext({
      outbox: currentOutbox,
      run: {
        executionId: terminalExecution.id,
        status: 'COMPLETED',
        finalStatus: 'SENT',
        jobId: currentOutbox.jobId,
      },
      dispatch: {
        status: 'SENT',
        attemptCount: 1,
        externalMessageId: 'external-id',
        sentAt: now,
      },
    });
    const harness = createSubject({
      executions: [terminalExecution],
      outboxes: [currentOutbox],
      publicationContexts: new Map([[currentOutbox.id, context]]),
    });

    const report = await harness.subject.run();

    expect(report).toMatchObject({
      scanned: 1,
      historicalIgnored: 1,
      safeDbRecovered: 0,
      humanRequired: 0,
      ambiguitiesPreserved: 0,
      finalizersReplayed: 0,
    });
    expect(harness.recoverExecution).not.toHaveBeenCalled();
    expect(terminalExecution.externalStage).toBe('EXTERNAL_MAY_HAVE_STARTED');
  });

  it('keeps a non-terminal SENT dispatch with attemptCount greater than one human-required', async () => {
    const currentOutbox = outbox({ status: 'PUBLISHED', publishedAt: now });
    const context = publicationContext({
      outbox: currentOutbox,
      run: {
        status: 'STARTED',
        finalStatus: 'PENDING',
        jobId: currentOutbox.jobId,
      },
      dispatch: {
        status: 'SENT',
        attemptCount: 2,
        externalMessageId: 'external-id',
        sentAt: now,
      },
    });
    const finalizeAfterDispatch = vi.fn(async () => undefined);
    const harness = createSubject({
      outboxes: [currentOutbox],
      publicationContexts: new Map([[currentOutbox.id, context]]),
      finalizeAfterDispatch,
    });

    const report = await harness.subject.run();

    expect(report).toMatchObject({
      scanned: 1,
      historicalIgnored: 0,
      humanRequired: 1,
      ambiguitiesPreserved: 1,
      safeDbRecovered: 0,
      finalizersReplayed: 0,
    });
    expect(finalizeAfterDispatch).not.toHaveBeenCalled();
  });

  it('keeps non-terminal attempt overflow human-required even when a job exists', async () => {
    const currentOutbox = outbox({ status: 'PUBLISHED', publishedAt: now });
    const context = publicationContext({
      outbox: currentOutbox,
      run: {
        status: 'STARTED',
        finalStatus: 'PENDING',
        jobId: currentOutbox.jobId,
      },
      dispatch: {
        status: 'FAILED',
        attemptCount: 2,
      },
    });
    const harness = createSubject({
      paused: false,
      outboxes: [currentOutbox],
      publicationContexts: new Map([[currentOutbox.id, context]]),
      queueJobs: new Map([
        [
          currentOutbox.jobId,
          {
            id: currentOutbox.jobId,
            dispatchId: currentOutbox.dispatchId,
            instanceName: currentOutbox.instanceName,
          },
        ],
      ]),
    });

    await expect(harness.subject.run()).resolves.toMatchObject({
      humanRequired: 1,
      ambiguitiesPreserved: 1,
      noAction: 0,
      safeQueueRecovered: 0,
    });
    expect(harness.enqueue).not.toHaveBeenCalled();
    expect(harness.publishOutbox).not.toHaveBeenCalled();
  });

  it('does not ignore terminal-shaped history with invalid identity or SENT evidence', async () => {
    const mismatchedOutbox = outbox({
      id: 'outbox-mismatched',
      status: 'PUBLISHED',
      publishedAt: now,
    });
    const mismatchedContext = publicationContext({
      outbox: mismatchedOutbox,
      run: {
        id: 'different-run',
        status: 'COMPLETED',
        finalStatus: 'SENT',
        jobId: mismatchedOutbox.jobId,
      },
      dispatch: {
        status: 'SENT',
        attemptCount: 2,
        externalMessageId: 'external-id',
        sentAt: now,
      },
    });
    const invalidEvidenceOutbox = outbox({
      id: 'outbox-invalid-evidence',
      status: 'PUBLISHED',
      publishedAt: now,
    });
    const invalidEvidenceContext = publicationContext({
      outbox: invalidEvidenceOutbox,
      run: {
        status: 'COMPLETED',
        finalStatus: 'SENT',
        jobId: invalidEvidenceOutbox.jobId,
      },
      dispatch: {
        status: 'SENT',
        attemptCount: 1,
        externalMessageId: '   ',
        sentAt: new Date('invalid'),
      },
    });
    const harness = createSubject({
      outboxes: [mismatchedOutbox, invalidEvidenceOutbox],
      publicationContexts: new Map([
        [mismatchedOutbox.id, mismatchedContext],
        [invalidEvidenceOutbox.id, invalidEvidenceContext],
      ]),
    });

    await expect(harness.subject.run()).resolves.toMatchObject({
      scanned: 2,
      historicalIgnored: 0,
      humanRequired: 2,
      ambiguitiesPreserved: 2,
      finalizersReplayed: 0,
    });
    expect(harness.finalizeAfterDispatch).not.toHaveBeenCalled();
  });

  it('replays a SENT finalizer once when the same coordinator is concurrently started twice', async () => {
    const currentOutbox = outbox({ status: 'PUBLISHED', publishedAt: now });
    const context = publicationContext({
      outbox: currentOutbox,
      run: {
        status: 'STARTED',
        finalStatus: 'PENDING',
        jobId: currentOutbox.jobId,
      },
      dispatch: {
        status: 'SENT',
        attemptCount: 1,
        externalMessageId: 'external-id',
        sentAt: now,
      },
    });
    const finalizeAfterDispatch = vi.fn(async () => undefined);
    const harness = createSubject({
      outboxes: [currentOutbox],
      publicationContexts: new Map([[currentOutbox.id, context]]),
      queueJobs: new Map([
        [
          currentOutbox.jobId,
          {
            id: currentOutbox.jobId,
            dispatchId: currentOutbox.dispatchId,
            instanceName: currentOutbox.instanceName,
          },
        ],
      ]),
      finalizeAfterDispatch,
    });

    const [first, second] = await Promise.all([
      harness.subject.run(),
      harness.subject.run(),
    ]);

    expect(finalizeAfterDispatch).toHaveBeenCalledTimes(1);
    expect(first.finalizersReplayed).toBe(1);
    expect(first.historicalIgnored).toBe(0);
    expect(second).toEqual(first);
    expect(first.safeDbRecovered).toBe(1);
  });

  it('ignores the complete historical outbox shape without replay or human-required noise', async () => {
    const historicalExecutionIds = Array.from(
      { length: 17 },
      (_, index) => `execution-history-${index + 1}`,
    );
    const historicalOutboxes = Array.from({ length: 19 }, (_, index) => {
      const suffix = index + 1;
      const currentOutbox = outbox({
        id: `outbox-history-${suffix}`,
        commercialRunId: `run-history-${suffix}`,
        dispatchId: `dispatch-history-${suffix}`,
        jobId: `job-history-${suffix}`,
        status: 'PUBLISHED',
        publishedAt: now,
      });
      const context = publicationContext({
        outbox: currentOutbox,
        run: {
          executionId: historicalExecutionIds[index] ?? null,
          status: 'COMPLETED',
          finalStatus: 'SENT',
          jobId: currentOutbox.jobId,
        },
        dispatch: {
          status: 'SENT',
          attemptCount: index === 9 ? 2 : 1,
          externalMessageId: `external-history-${suffix}`,
          sentAt: now,
        },
      });
      return { outbox: currentOutbox, context };
    });
    const executions = historicalOutboxes
      .slice(0, 17)
      .map(({ outbox: currentOutbox }, index) =>
        execution({
          id: historicalExecutionIds[index],
          status: 'QUEUED',
          activeKey: null,
          completedAt: now,
          commercialRunId: currentOutbox.commercialRunId,
          externalStage:
            index === 9 ? 'NOT_REACHED' : 'EXTERNAL_MAY_HAVE_STARTED',
        }),
      );
    const harness = createSubject({
      executions,
      outboxes: historicalOutboxes.map(
        ({ outbox: currentOutbox }) => currentOutbox,
      ),
      publicationContexts: new Map(
        historicalOutboxes.map(({ outbox: currentOutbox, context }) => [
          currentOutbox.id,
          context,
        ]),
      ),
    });

    const report = await harness.subject.run();

    expect(report).toEqual({
      scanned: 19,
      safeDbRecovered: 0,
      safeQueueRecovered: 0,
      noAction: 0,
      historicalIgnored: 19,
      humanRequired: 0,
      jobsReused: 0,
      jobsCreated: 0,
      reservationsReleased: 0,
      finalizersReplayed: 0,
      ambiguitiesPreserved: 0,
    });
    expect(harness.recoverExecution).not.toHaveBeenCalled();
    expect(harness.finalizeAfterDispatch).not.toHaveBeenCalled();
    expect(harness.enqueue).not.toHaveBeenCalled();
  });

  it('duas instancias concorrentes convergem para um unico job deterministico', async () => {
    const currentOutbox = outbox();
    const context = publicationContext({ outbox: currentOutbox });
    const jobs = new Map<string, CommercialRecoveryJob>();
    const enqueue = vi.fn(
      async (
        dispatchId: string,
        jobId: string,
        instanceName?: string | null,
      ) => {
        if (!jobs.has(jobId)) {
          jobs.set(jobId, {
            id: jobId,
            dispatchId,
            instanceName,
          });
        }
      },
    );
    const publishOutbox = vi.fn(async () => {
      const jobCreated = !jobs.has(currentOutbox.jobId);
      if (jobCreated) {
        await enqueue(
          currentOutbox.dispatchId,
          currentOutbox.jobId,
          currentOutbox.instanceName,
        );
      }
      currentOutbox.status = 'PUBLISHED';
      currentOutbox.publishedAt = now;
      context.run.jobId = currentOutbox.jobId;
      return {
        outbox: currentOutbox,
        jobCreated,
        jobReused: !jobCreated,
      };
    });
    const logger = { info: vi.fn(), error: vi.fn() };
    const createCoordinator = () =>
      new CommercialRecoveryCoordinator({
        settings: { get: async () => settingsRecord(false) },
        executions: {
          list: async () => ({ items: [], total: 0 }),
          findRecoveryContext: async () => null,
        },
        outboxes: {
          list: async () => ({ items: [currentOutbox], total: 1 }),
          findPublicationContext: async () => context,
        },
        queue: {
          hasJob: async (jobId: string) => jobs.has(jobId),
          getJob: async (jobId: string) => jobs.get(jobId) ?? null,
          enqueue,
        },
        publishOutbox,
        logger,
        clock: () => now,
      });

    const [first, second] = await Promise.all([
      createCoordinator().run(),
      createCoordinator().run(),
    ]);

    expect(jobs.size).toBe(1);
    expect(enqueue).toHaveBeenCalledOnce();
    expect(publishOutbox).toHaveBeenCalledTimes(2);
    expect(first.safeQueueRecovered + second.safeQueueRecovered).toBe(2);
    expect(first.jobsCreated + second.jobsCreated).toBe(1);
    expect(first.jobsReused + second.jobsReused).toBe(1);
  });

  it('preserves ambiguity without finalizer, queue, or provider recovery', async () => {
    const currentOutbox = outbox({ status: 'AMBIGUOUS' });
    const context = publicationContext({
      outbox: currentOutbox,
      run: { finalStatus: 'AMBIGUOUS', investigationRequired: true },
      dispatch: { status: 'PROCESSING', attemptCount: 1 },
    });
    const harness = createSubject({
      outboxes: [currentOutbox],
      publicationContexts: new Map([[currentOutbox.id, context]]),
    });

    await expect(harness.subject.run()).resolves.toMatchObject({
      humanRequired: 1,
      ambiguitiesPreserved: 1,
      safeDbRecovered: 0,
      safeQueueRecovered: 0,
    });
    expect(harness.finalizeAfterDispatch).not.toHaveBeenCalled();
    expect(harness.enqueue).not.toHaveBeenCalled();
  });
});
