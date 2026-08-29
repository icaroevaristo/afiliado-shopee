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
import {
  BullMqCommercialAutomationScheduler,
  DEFAULT_COMMERCIAL_AUTOMATION_SCHEDULER_JOB_ID,
  type BullMqCommercialAutomationSchedulerQueue,
} from '@shopee-auto-affiliate-ai/queue';

const now = new Date('2026-08-29T12:00:00.000Z');
const old = new Date('2026-08-29T10:00:00.000Z');

const settings = (paused: boolean): CommercialAutomationSettingsRecord => ({
  paused,
  pausedAt: null,
  resumedAt: null,
  allowedStartTime: null,
  allowedEndTime: null,
  minimumIntervalMinutes: null,
  staggerMinutes: null,
  dailyGlobalLimit: null,
  dailyGroupLimit: null,
  scheduleRevision: 3,
  updatedAt: old,
});

const staleExecution = (
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

const baseOutbox = (
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
  outbox: CommercialDispatchOutboxRecord,
  overrides: {
    run?: Partial<CommercialDispatchOutboxPublicationContext['run']>;
    dispatch?: Partial<CommercialDispatchOutboxPublicationContext['dispatch']>;
  } = {},
): CommercialDispatchOutboxPublicationContext => ({
  outbox,
  run: {
    id: outbox.commercialRunId,
    mode: 'CONFIRMED',
    status: 'STARTED',
    dispatchId: outbox.dispatchId,
    jobId: null,
    executionId: null,
    instanceName: outbox.instanceName,
    finalStatus: 'PENDING',
    investigationRequired: false,
    ...overrides.run,
  },
  dispatch: {
    id: outbox.dispatchId,
    status: 'PENDING',
    attemptCount: 0,
    instanceName: outbox.instanceName,
    externalMessageId: null,
    sentAt: null,
    ...overrides.dispatch,
  },
});

const createCoordinator = (input: {
  paused: boolean;
  executions?: CommercialAutomationExecutionRecord[];
  executionContexts?: Map<
    string,
    CommercialAutomationExecutionRecoveryContext | null
  >;
  outboxes?: CommercialDispatchOutboxRecord[];
  publicationContexts?: Map<
    string,
    CommercialDispatchOutboxPublicationContext
  >;
  jobs?: Map<string, CommercialRecoveryJob>;
  recoverExecution?: (
    executionId: string,
  ) => Promise<{ outcome: 'recovered' | 'already-terminal' | 'investigation-required' }>;
  publishOutbox?: (
    outboxId: string,
  ) => Promise<CommercialRecoveryPublishResult>;
  finalizeAfterDispatch?: (dispatchId: string) => Promise<void>;
}) => {
  const executions = input.executions ?? [];
  const executionContexts = input.executionContexts ?? new Map();
  const outboxes = input.outboxes ?? [];
  const publicationContexts = input.publicationContexts ?? new Map();
  const jobs = input.jobs ?? new Map();
  const enqueue = vi.fn(
    async (dispatchId: string, jobId: string, instanceName?: string | null) => {
      jobs.set(jobId, { id: jobId, dispatchId, instanceName });
    },
  );
  const recoverExecution =
    input.recoverExecution ??
    vi.fn(async () => ({ outcome: 'recovered' as const }));
  const publishOutbox = input.publishOutbox ?? vi.fn();
  const finalizeAfterDispatch = input.finalizeAfterDispatch ?? vi.fn();
  const coordinator = new CommercialRecoveryCoordinator({
    settings: { get: async () => settings(input.paused) },
    executions: {
      list: async () => ({ items: executions, total: executions.length }),
      findRecoveryContext: async (id) => executionContexts.get(id) ?? null,
    },
    outboxes: {
      list: async () => ({ items: outboxes, total: outboxes.length }),
      findPublicationContext: async (id) => publicationContexts.get(id) ?? null,
    },
    queue: {
      hasJob: async (jobId: string) => jobs.has(jobId),
      getJob: async (jobId: string) => jobs.get(jobId) ?? null,
      enqueue,
    },
    recoverExecution,
    publishOutbox,
    finalizeAfterDispatch,
    clock: () => now,
    logger: { info: vi.fn(), error: vi.fn() },
  });
  return {
    coordinator,
    enqueue,
    recoverExecution,
    publishOutbox,
    finalizeAfterDispatch,
    jobs,
  };
};

describe('commercial recovery crash matrix A-J', () => {
  it('A: scheduler crash before planning commit leaves no logical slot', async () => {
    const schedulerJobs = new Set<string>();
    let registered: Awaited<
      ReturnType<BullMqCommercialAutomationSchedulerQueue['getJobScheduler']>
    >;
    const queue: BullMqCommercialAutomationSchedulerQueue = {
      upsertJobScheduler: vi.fn(async (id, repeat, template) => {
        schedulerJobs.add(id);
        registered = {
          key: id,
          name: template.name,
          pattern: repeat.pattern,
          tz: repeat.tz,
          next: Date.parse('2026-08-29T13:00:00.000Z'),
          template: { data: template.data, opts: template.opts },
        };
      }),
      getJobScheduler: vi.fn(async () => registered),
      removeJobScheduler: vi.fn(async () => true),
    };
    const scheduler = new BullMqCommercialAutomationScheduler(queue);
    const config = {
      enabled: true,
      cronExpression: '0 9 * * *',
      timezone: 'America/Sao_Paulo',
      mode: 'preview' as const,
      jobId: DEFAULT_COMMERCIAL_AUTOMATION_SCHEDULER_JOB_ID,
    };
    const results = await Promise.all([
      scheduler.register(config),
      new BullMqCommercialAutomationScheduler(queue).register(config),
    ]);

    expect(results.every((result) => result.status === 'registered')).toBe(true);
    expect(schedulerJobs.size).toBe(1);
    expect(registered?.key).toBe(DEFAULT_COMMERCIAL_AUTOMATION_SCHEDULER_JOB_ID);
  });

  it('B: planning antes do enqueue recupera o outbox seguro com a mesma identidade', async () => {
    const pending = baseOutbox();
    const context = publicationContext(pending);
    const harness = createCoordinator({
      paused: false,
      outboxes: [pending],
      publicationContexts: new Map([[pending.id, context]]),
      publishOutbox: vi.fn(async () => ({
        outbox: baseOutbox({ status: 'PUBLISHED', publishedAt: now }),
        jobCreated: true,
      })),
    });

    await expect(harness.coordinator.run()).resolves.toMatchObject({
      safeQueueRecovered: 1,
      jobsCreated: 1,
      humanRequired: 0,
    });
    expect(harness.publishOutbox).toHaveBeenCalledWith(pending.id);
    expect(harness.enqueue).not.toHaveBeenCalled();
  });

  it('C: restart with an existing deterministic job does not create another logical job', async () => {
    const pending = baseOutbox();
    const context = publicationContext(pending);
    const jobs = new Map<string, CommercialRecoveryJob>([
      [pending.jobId, {
        id: pending.jobId,
        dispatchId: pending.dispatchId,
        instanceName: pending.instanceName,
      }],
    ]);
    const harness = createCoordinator({
      paused: false,
      outboxes: [pending],
      publicationContexts: new Map([[pending.id, context]]),
      jobs,
      publishOutbox: vi.fn(async () => ({
        outbox: baseOutbox({ status: 'PUBLISHED', publishedAt: now }),
        jobReused: true,
      })),
    });

    await harness.coordinator.run();

    expect(harness.enqueue).not.toHaveBeenCalled();
    expect(harness.jobs.size).toBe(1);
  });

  it('D: worker crash before provider recovers only the stale pre-marker database state', async () => {
    const execution = staleExecution();
    const recoverExecution = vi.fn(async () => ({ outcome: 'recovered' as const }));
    const harness = createCoordinator({
      paused: true,
      executions: [execution],
      executionContexts: new Map([[execution.id, {
        execution,
        run: null,
      }]]),
      recoverExecution,
    });

    await expect(harness.coordinator.run()).resolves.toMatchObject({
      safeDbRecovered: 1,
      humanRequired: 0,
    });
    expect(recoverExecution).toHaveBeenCalledOnce();
  });

  it('E: crash after external marker stays human-required without provider recovery', async () => {
    const execution = staleExecution({ externalStage: 'EXTERNAL_MAY_HAVE_STARTED' });
    const recoverExecution = vi.fn(async () => ({ outcome: 'recovered' as const }));
    const harness = createCoordinator({
      paused: true,
      executions: [execution],
      executionContexts: new Map([[execution.id, {
        execution,
        run: null,
      }]]),
      recoverExecution,
    });

    await expect(harness.coordinator.run()).resolves.toMatchObject({
      humanRequired: 1,
      ambiguitiesPreserved: 1,
      safeDbRecovered: 0,
    });
    expect(recoverExecution).not.toHaveBeenCalled();
  });

  it('F: provider success sem SENT persistido permanece ambiguo e sem retry', async () => {
    const pending = baseOutbox();
    const context = publicationContext(pending, {
      dispatch: { status: 'PROCESSING', attemptCount: 1 },
    });
    const publishOutbox = vi.fn();
    const harness = createCoordinator({
      paused: true,
      outboxes: [pending],
      publicationContexts: new Map([[pending.id, context]]),
      publishOutbox,
    });

    await expect(harness.coordinator.run()).resolves.toMatchObject({
      humanRequired: 1,
      ambiguitiesPreserved: 1,
      safeQueueRecovered: 0,
    });
    expect(publishOutbox).not.toHaveBeenCalled();
  });

  it('G: dispatch SENT antes do finalizer repete somente o finalizer', async () => {
    const sent = baseOutbox({ status: 'PUBLISHED', publishedAt: now });
    const context = publicationContext(sent, {
      run: {
        status: 'STARTED',
        finalStatus: 'PENDING',
        jobId: sent.jobId,
      },
      dispatch: {
        status: 'SENT',
        attemptCount: 1,
        externalMessageId: 'external-id',
        sentAt: now,
      },
    });
    const finalizeAfterDispatch = vi.fn(async () => undefined);
    const harness = createCoordinator({
      paused: true,
      outboxes: [sent],
      publicationContexts: new Map([[sent.id, context]]),
      finalizeAfterDispatch,
    });

    await harness.coordinator.run();

    expect(finalizeAfterDispatch).toHaveBeenCalledWith(sent.dispatchId);
    expect(finalizeAfterDispatch).toHaveBeenCalledOnce();
    expect(harness.enqueue).not.toHaveBeenCalled();
  });

  it('H: commit do outbox antes do enqueue usa um job deterministico uma vez', async () => {
    const pending = baseOutbox();
    const context = publicationContext(pending);
    const jobs = new Map<string, CommercialRecoveryJob>();
    const enqueue = vi.fn(
      async (dispatchId: string, jobId: string, instanceName?: string | null) => {
        jobs.set(jobId, { id: jobId, dispatchId, instanceName });
      },
    );
    const publishOutbox = vi.fn(async () => {
      await enqueue(
        pending.dispatchId,
        pending.jobId,
        pending.instanceName,
      );
      return {
        outbox: baseOutbox({ status: 'PUBLISHED', publishedAt: now }),
        jobCreated: true,
      };
    });
    const coordinator = createCoordinator({
      paused: false,
      outboxes: [pending],
      publicationContexts: new Map([[pending.id, context]]),
      jobs,
      publishOutbox,
    });

    await coordinator.coordinator.run();

    expect(enqueue).toHaveBeenCalledOnce();
    expect(coordinator.jobs.has(pending.jobId)).toBe(true);
  });

  it('I: job existente e marcador PENDING convergem sem segundo enqueue', async () => {
    const pending = baseOutbox();
    const context = publicationContext(pending);
    const jobs = new Map<string, CommercialRecoveryJob>([
      [pending.jobId, {
        id: pending.jobId,
        dispatchId: pending.dispatchId,
        instanceName: pending.instanceName,
      }],
    ]);
    const publishOutbox = vi.fn(async () => ({
      outbox: baseOutbox({ status: 'PUBLISHED', publishedAt: now }),
      jobReused: true,
    }));
    const harness = createCoordinator({
      paused: false,
      outboxes: [pending],
      publicationContexts: new Map([[pending.id, context]]),
      jobs,
      publishOutbox,
    });

    await harness.coordinator.run();

    expect(publishOutbox).toHaveBeenCalledOnce();
    expect(harness.enqueue).not.toHaveBeenCalled();
    expect(harness.jobs.size).toBe(1);
  });

  it('J: lease stale sem evidence externa recupera, mas marker externo exige humano', async () => {
    const safe = staleExecution({ id: 'execution-safe' });
    const ambiguous = staleExecution({
      id: 'execution-ambiguous',
      externalStage: 'EXTERNAL_MAY_HAVE_STARTED',
    });
    const recoverExecution = vi.fn(async () => ({ outcome: 'recovered' as const }));
    const harness = createCoordinator({
      paused: true,
      executions: [safe, ambiguous],
      executionContexts: new Map([
        [safe.id, { execution: safe, run: null }],
        [ambiguous.id, { execution: ambiguous, run: null }],
      ]),
      recoverExecution,
    });

    await expect(harness.coordinator.run()).resolves.toMatchObject({
      scanned: 2,
      safeDbRecovered: 1,
      humanRequired: 1,
      ambiguitiesPreserved: 1,
    });
    expect(recoverExecution).toHaveBeenCalledWith(safe.id);
    expect(recoverExecution).toHaveBeenCalledOnce();
  });
});
