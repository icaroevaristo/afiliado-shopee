import { Worker } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createCommercialAutomationQueue,
  createCommercialInventoryRefillQueue,
  createRedisConnection,
  enqueueCommercialAutomationTarget,
  enqueueCommercialInventoryRefill,
  JOB_NAMES,
  QUEUE_NAMES,
  type CommercialAutomationJob,
  type CommercialInventoryRefillJob,
  type CommercialAutomationTargetConstraint,
} from '@shopee-auto-affiliate-ai/queue';

import type { CommercialAutomationOrchestrator } from '../../api/src/commercial-automation-orchestrator';
import { planCommercialTargetSlots } from '../../api/src/commercial-automation-scheduler-planner';
import {
  processCommercialAutomationJob,
  processCommercialInventoryRefillJob,
} from '../src/commercial-automation-worker';

const enabled = process.env.RUN_COMMERCIAL_AUTOMATION_REDIS_TEST === 'true';
const describeRedis = enabled ? describe : describe.skip;
const REDIS_URL = process.env.REDIS_URL;
const INTEGRATED_CAMPAIGN_ID = 'commercial-healthy-100-integrated-campaign';

type TickInput = Parameters<CommercialAutomationOrchestrator['executeTick']>[0];
type TickResult = Awaited<
  ReturnType<CommercialAutomationOrchestrator['executeTick']>
>;

describeRedis('commercial automation disposable Redis integration', () => {
  let automationQueue: ReturnType<typeof createCommercialAutomationQueue>;
  let refillQueue: ReturnType<typeof createCommercialInventoryRefillQueue>;
  let connection: ReturnType<typeof createRedisConnection>;

  beforeAll(async () => {
    if (!REDIS_URL) throw new Error('disposable Redis URL missing');
    connection = createRedisConnection(REDIS_URL);
    automationQueue = createCommercialAutomationQueue(connection);
    refillQueue = createCommercialInventoryRefillQueue(connection);
    await automationQueue.waitUntilReady();
    await refillQueue.waitUntilReady();
    await automationQueue.obliterate({ force: true });
    await refillQueue.obliterate({ force: true });
  });

  afterAll(async () => {
    await automationQueue?.obliterate({ force: true }).catch(() => undefined);
    await refillQueue?.obliterate({ force: true }).catch(() => undefined);
    await automationQueue?.close();
    await refillQueue?.close();
    await connection?.quit();
  });

  it('mantem target e planner disponiveis enquanto o refill real permanece bloqueado', async () => {
    let releaseRefill!: () => void;
    const refillGate = new Promise<void>((resolve) => {
      releaseRefill = resolve;
    });
    let refillStarted!: () => void;
    const refillStartedSignal = new Promise<void>((resolve) => {
      refillStarted = resolve;
    });
    let refillFinished!: () => void;
    const refillFinishedSignal = new Promise<void>((resolve) => {
      refillFinished = resolve;
    });
    const refillSupervisor = {
      run: vi.fn(async () => {
        refillStarted();
        await refillGate;
        refillFinished();
        return { preparedMessages: 0 };
      }),
    };
    const targetProvider = vi.fn();
    const plan = vi.fn(async () => ({ slots: [] }));
    const executeTick = async (input: TickInput): Promise<TickResult> => {
      if (input.targetConstraint) {
        targetProvider(input.targetConstraint.instanceName);
      }
      return {
        executionId: `redis-integration-${input.bullMqJobId ?? 'unknown'}`,
        mode: input.mode,
        status: 'queued',
        reasons: [],
        commercialRunId: null,
        dispatchCreated: false,
        whatsappJobCreated: false,
        messageSent: false,
      };
    };
    const enqueueTarget = async (
      data: Extract<CommercialAutomationJob, { kind: 'target' }>,
      jobId: string,
      delayMs: number,
    ) => {
      await enqueueCommercialAutomationTarget(
        automationQueue,
        data,
        jobId,
        delayMs,
      );
    };
    const enqueueRefill = async (
      data: CommercialInventoryRefillJob,
      jobId: string,
    ) => {
      await enqueueCommercialInventoryRefill(refillQueue, data, jobId);
    };
    const automationWorker = new Worker<CommercialAutomationJob>(
      QUEUE_NAMES.commercialAutomation,
      (job) =>
        processCommercialAutomationJob(job, {
          orchestrator: { executeTick },
          planner: { plan },
          enqueueTarget,
          enqueueInventoryRefill: enqueueRefill,
          provider: 'official',
          mode: 'send',
        }),
      { connection, concurrency: 1 },
    );
    const refillWorker = new Worker<CommercialInventoryRefillJob>(
      QUEUE_NAMES.commercialInventoryRefill,
      (job) =>
        processCommercialInventoryRefillJob(job, {
          inventorySupervisor: refillSupervisor,
          mode: 'send',
        }),
      { connection, concurrency: 1 },
    );

    try {
      await automationQueue.add(
        JOB_NAMES.commercialAutomationTick,
        { mode: 'send', kind: 'planner' },
        { jobId: 'commercial-redis-integration-planner', attempts: 1 },
      );
      await vi.waitFor(() => expect(plan).toHaveBeenCalledOnce(), {
        timeout: 5_000,
        interval: 25,
      });
      await refillStartedSignal;

      const target: CommercialAutomationTargetConstraint = {
        campaignId: 'commercial-redis-ready-campaign',
        groupId: 'commercial-redis-ready-group',
        logicalGroupFingerprint: 'commercial-redis-ready-fingerprint',
        instanceName: 'commercial-redis-ready-instance',
        scheduledFor: '2026-09-07T12:00:00.000Z',
        slotKey: 'commercial-redis-ready-slot',
        scheduleRevision: 1,
      };
      await enqueueTarget(
        { mode: 'send', kind: 'target', target },
        'commercial-target-commercial-redis-ready-slot',
        0,
      );
      await vi.waitFor(() => expect(targetProvider).toHaveBeenCalledOnce(), {
        timeout: 5_000,
        interval: 25,
      });
      expect(refillSupervisor.run).toHaveBeenCalledOnce();
      releaseRefill();
      await refillFinishedSignal;
    } finally {
      releaseRefill();
      await Promise.all([automationWorker.close(), refillWorker.close()]);
    }
  });

  it('executa 100 slots saudaveis no BullMQ real com rotacao A-B', async () => {
    const healthyCalls: Array<{
      slotKey: string;
      instanceName: string;
    }> = [];
    const executeTick = async (input: TickInput): Promise<TickResult> => {
      const target = input.targetConstraint;
      if (target?.campaignId === INTEGRATED_CAMPAIGN_ID) {
        healthyCalls.push({
          slotKey: target.slotKey,
          instanceName: target.instanceName,
        });
      }
      return {
        executionId: `redis-healthy-${input.bullMqJobId ?? 'unknown'}`,
        mode: input.mode,
        status: 'queued',
        reasons: [],
        commercialRunId: null,
        dispatchCreated: false,
        whatsappJobCreated: false,
        messageSent: false,
      };
    };
    const automationWorker = new Worker<CommercialAutomationJob>(
      QUEUE_NAMES.commercialAutomation,
      (job) =>
        processCommercialAutomationJob(job, {
          orchestrator: { executeTick },
          provider: 'official',
          mode: 'send',
        }),
      { connection, concurrency: 1 },
    );
    const orderedInstances = [
      'commercial-healthy-instance-a',
      'commercial-healthy-instance-b',
    ];
    const schedule = {
      timezone: 'America/Sao_Paulo',
      allowedStartTime: '08:00',
      allowedEndTime: '23:00',
      dailyGlobalLimit: 100,
      dailyGroupLimit: 100,
      dailyShopeeHttpLimit: 100,
      dailyOpenAiGenerationLimit: 100,
      minimumIntervalMinutes: 5,
      staggerMinutes: 0,
      scheduleRevision: 1,
    } as const;
    let lastSentInstanceName: string | null = null;

    try {
      for (let sentToday = 0; sentToday < 100; sentToday += 1) {
        const now = new Date(
          Date.parse('2026-08-24T11:00:00.000Z') + sentToday * 5 * 60_000,
        );
        const planned = planCommercialTargetSlots({
          now,
          schedule,
          targets: [
            {
              groupId: 'commercial-healthy-group',
              groupName: 'Commercial healthy group',
              instanceName: orderedInstances[0],
              orderedInstanceNames: orderedInstances,
              logicalGroupFingerprint: 'commercial-healthy-fingerprint',
              campaignId: INTEGRATED_CAMPAIGN_ID,
              nicheId: 'commercial-healthy-niche',
              dailyLimit: 100,
              cadenceMinutes: 5,
              timezone: 'America/Sao_Paulo',
              allowedStartTime: '08:00',
              allowedEndTime: '23:00',
              active: true,
              available: true,
              instanceActive: true,
              instanceActiveByName: {
                [orderedInstances[0]]: true,
                [orderedInstances[1]]: true,
              },
              lastSentAt:
                sentToday === 0
                  ? null
                  : new Date(
                      Date.parse('2026-08-24T11:00:00.000Z') +
                        (sentToday - 1) * 5 * 60_000,
                    ),
              lastSentInstanceName,
              groupSentToday: sentToday,
            },
          ],
          globalSentToday: sentToday,
          horizonMinutes: 5,
          maxSlotsPerTarget: 1,
        });
        expect(planned.slots).toHaveLength(1);
        const slot = planned.slots[0];
        await enqueueCommercialAutomationTarget(
          automationQueue,
          { mode: 'send', kind: 'target', target: slot.target },
          slot.jobId,
          slot.delayMs,
        );
        lastSentInstanceName = slot.target.instanceName;
      }

      await vi.waitFor(() => expect(healthyCalls).toHaveLength(100), {
        timeout: 20_000,
        interval: 50,
      });
      expect(new Set(healthyCalls.map(({ slotKey }) => slotKey)).size).toBe(100);
      expect(
        healthyCalls.filter(
          ({ instanceName }) => instanceName === orderedInstances[0],
        ),
      ).toHaveLength(50);
      expect(
        healthyCalls.filter(
          ({ instanceName }) => instanceName === orderedInstances[1],
        ),
      ).toHaveLength(50);
    } finally {
      await automationWorker.close();
    }
  });
});
