import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '@shopee-auto-affiliate-ai/database';
import {
  createCommercialAutomationQueue,
  createRedisConnection,
  enqueueCommercialAutomationTarget,
} from '@shopee-auto-affiliate-ai/queue';
import { fingerprintWhatsAppGroupId } from '@shopee-auto-affiliate-ai/providers';

import { createPrismaRepositories } from '../src/application-services';
import {
  planCommercialTargetSlots,
  type CommercialAutomationPlannerTarget,
} from '../src/commercial-automation-scheduler-planner';
import type { CommercialAutomationEffectiveSchedule } from '../src/commercial-automation-policy-service';

const enabled = process.env.RUN_R5_DB_REDIS_TEST === 'true';
const describeIntegration = enabled ? describe.sequential : describe.skip;
const PREFIX = 'r5-deterministic-rotation';
const NOW = new Date('2026-09-09T12:00:00.000Z');
const INSTANCE_NAMES = ['a', 'b', 'c', 'd'].map(
  (suffix) => `${PREFIX}-instance-${suffix}`,
);
const [INSTANCE_A, INSTANCE_B, INSTANCE_C, INSTANCE_D] = INSTANCE_NAMES;

const schedule: CommercialAutomationEffectiveSchedule = {
  timezone: 'UTC',
  allowedStartTime: '00:00',
  allowedEndTime: '23:59',
  dailyGlobalLimit: 20,
  dailyGroupLimit: 20,
  dailyShopeeHttpLimit: 20,
  dailyOpenAiGenerationLimit: 20,
  minimumIntervalMinutes: 15,
  staggerMinutes: 0,
  scheduleRevision: 23,
};

describeIntegration('R5 deterministic rotation on disposable PostgreSQL and Redis', () => {
  let prisma: ReturnType<typeof createPrismaClient>;
  let redis: ReturnType<typeof createRedisConnection>;
  let queue: ReturnType<typeof createCommercialAutomationQueue>;

  const cleanup = async () => {
    await prisma.commercialGroupCampaign.deleteMany({
      where: { id: { startsWith: PREFIX } },
    });
    await prisma.commercialNiche.deleteMany({
      where: { id: { startsWith: PREFIX } },
    });
    await prisma.whatsAppDestination.deleteMany({
      where: { id: { startsWith: PREFIX } },
    });
    await prisma.whatsAppInstance.deleteMany({
      where: { name: { in: INSTANCE_NAMES } },
    });
  };

  const createGroup = async (suffix: string, assignments: string[]) => {
    const externalGroupId = `120363905${Array.from(suffix)
      .map((character) => character.charCodeAt(0))
      .join('')}@g.us`;
    return prisma.whatsAppDestination.create({
      data: {
        id: `${PREFIX}-group-${suffix}`,
        name: `R5 Group ${suffix.toUpperCase()}`,
        destination: externalGroupId,
        type: 'GROUP',
        active: true,
        paused: false,
        available: true,
        fingerprint: fingerprintWhatsAppGroupId(externalGroupId),
        sourceInstanceName: INSTANCE_A,
        assignedInstanceName: assignments[0],
        assignmentRevision: 7,
        discoveredAt: NOW,
        lastSyncedAt: NOW,
        instanceAssignments: {
          create: assignments.map((instanceName, position) => ({
            instanceName,
            position,
          })),
        },
      },
      include: { instanceAssignments: { orderBy: { position: 'asc' } } },
    });
  };

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    const redisUrl = process.env.REDIS_URL;
    if (!databaseUrl || !redisUrl) {
      throw new Error('Disposable DATABASE_URL and REDIS_URL are required');
    }
    prisma = createPrismaClient(databaseUrl);
    redis = createRedisConnection(redisUrl);
    queue = createCommercialAutomationQueue(redis);
    await queue.waitUntilReady();
    await queue.obliterate({ force: true });
    await cleanup();
    await prisma.whatsAppInstance.createMany({
      data: INSTANCE_NAMES.map((name) => ({
        name,
        active: true,
        paused: false,
      })),
    });
  });

  afterAll(async () => {
    await queue?.obliterate({ force: true }).catch(() => undefined);
    await queue?.close().catch(() => undefined);
    await redis?.quit().catch(() => undefined);
    if (prisma) {
      await cleanup().catch(() => undefined);
      await prisma.$disconnect();
    }
  });

  it('persiste N=1..4 e faz reorder/CAS atomicamente', async () => {
    const assignmentSets = [
      [INSTANCE_A],
      [INSTANCE_A, INSTANCE_B],
      [INSTANCE_A, INSTANCE_B, INSTANCE_C],
      [INSTANCE_A, INSTANCE_B, INSTANCE_C, INSTANCE_D],
    ];
    const groups = [];
    for (const [index, assignments] of assignmentSets.entries()) {
      groups.push(await createGroup(`n${index + 1}`, assignments));
    }

    for (const [index, group] of groups.entries()) {
      const expected = assignmentSets[index];
      expect(group.assignedInstanceName).toBe(expected[0]);
      expect(group.assignmentRevision).toBe(7);
      expect(group.instanceAssignments).toEqual(
        expected.map((instanceName, position) =>
          expect.objectContaining({ instanceName, position }),
        ),
      );
      expect(new Set(group.instanceAssignments.map(({ instanceName }) => instanceName)).size)
        .toBe(expected.length);
      expect(new Set(group.instanceAssignments.map(({ position }) => position)).size)
        .toBe(expected.length);
    }

    const repositories = createPrismaRepositories(prisma);
    const original = groups[2];
    const reordered = await repositories.whatsappGroups.updateAdministrativeWithLifecycleGuard?.(
      original.id,
      {
        assignedInstanceNames: [INSTANCE_C, INSTANCE_A, INSTANCE_B],
        expectedUpdatedAt: original.updatedAt,
        now: NOW,
      },
    );
    expect(reordered).toMatchObject({
      kind: 'UPDATED',
      group: {
        assignedInstanceName: INSTANCE_C,
        assignedInstanceNames: [INSTANCE_C, INSTANCE_A, INSTANCE_B],
        assignmentRevision: 8,
      },
    });

    const persisted = await prisma.whatsAppDestination.findUniqueOrThrow({
      where: { id: original.id },
      include: { instanceAssignments: { orderBy: { position: 'asc' } } },
    });
    expect(persisted.assignedInstanceName).toBe(INSTANCE_C);
    expect(persisted.assignmentRevision).toBe(8);
    expect(persisted.instanceAssignments.map(({ instanceName }) => instanceName)).toEqual([
      INSTANCE_C,
      INSTANCE_A,
      INSTANCE_B,
    ]);

    const noOp = await repositories.whatsappGroups.updateAdministrativeWithLifecycleGuard?.(
      original.id,
      {
        assignedInstanceNames: [INSTANCE_C, INSTANCE_A, INSTANCE_B],
        expectedUpdatedAt: persisted.updatedAt,
        now: NOW,
      },
    );
    expect(noOp).toMatchObject({ kind: 'UPDATED', group: { assignmentRevision: 8 } });

    const afterNoOp = await prisma.whatsAppDestination.findUniqueOrThrow({
      where: { id: original.id },
      include: { instanceAssignments: { orderBy: { position: 'asc' } } },
    });
    const beforeStale = JSON.stringify({
      primary: afterNoOp.assignedInstanceName,
      revision: afterNoOp.assignmentRevision,
      assignments: afterNoOp.instanceAssignments.map(({ instanceName, position }) => ({
        instanceName,
        position,
      })),
    });
    await expect(
      repositories.whatsappGroups.updateAdministrativeWithLifecycleGuard?.(
        original.id,
        {
          assignedInstanceNames: [INSTANCE_B, INSTANCE_C, INSTANCE_A],
          expectedUpdatedAt: original.updatedAt,
          now: NOW,
        },
      ),
    ).resolves.toEqual({ kind: 'CAS_CONFLICT' });
    const afterStale = await prisma.whatsAppDestination.findUniqueOrThrow({
      where: { id: original.id },
      include: { instanceAssignments: { orderBy: { position: 'asc' } } },
    });
    expect(JSON.stringify({
      primary: afterStale.assignedInstanceName,
      revision: afterStale.assignmentRevision,
      assignments: afterStale.instanceAssignments.map(({ instanceName, position }) => ({
        instanceName,
        position,
      })),
    })).toBe(beforeStale);

    await expect(
      repositories.whatsappGroups.updateAdministrativeWithLifecycleGuard?.(
        groups[1].id,
        {
          assignedInstanceNames: [INSTANCE_A, INSTANCE_A],
          expectedUpdatedAt: groups[1].updatedAt,
          now: NOW,
        },
      ),
    ).rejects.toMatchObject({ code: 'WHATSAPP_GROUP_ASSIGNMENT_INVALID' });

    console.log(JSON.stringify({
      event: 'R5_ORDERED_ASSIGNMENTS_CERTIFIED',
      cardinalities: assignmentSets.map((assignments) => assignments.length),
      primaryOrderedDivergence: 0,
      duplicateAssignmentName: 0,
      duplicateAssignmentPosition: 0,
      reorderRevision: [7, 8],
      noOpRevision: 8,
      staleCasPreserved: true,
    }));
  });

  it('persiste binding temporal deterministico e converge concorrencia BullMQ', async () => {
    const target = (revision: number, orderedInstanceNames: string[]): CommercialAutomationPlannerTarget => ({
      groupId: `${PREFIX}-group-binding`,
      groupName: 'R5 Binding Group',
      instanceName: orderedInstanceNames[0],
      orderedInstanceNames,
      assignmentRevision: revision,
      logicalGroupFingerprint: `${PREFIX}-fingerprint-binding`,
      campaignId: `${PREFIX}-campaign-binding`,
      nicheId: `${PREFIX}-niche-binding`,
      dailyLimit: 20,
      cadenceMinutes: 15,
      timezone: 'UTC',
      allowedStartTime: '00:00',
      allowedEndTime: '23:59',
      active: true,
      available: true,
      instanceActive: true,
      instanceActiveByName: Object.fromEntries(
        orderedInstanceNames.map((name) => [name, true]),
      ),
      lastSentAt: null,
      lastSentInstanceName: null,
      groupSentToday: 0,
    });
    const input = {
      now: NOW,
      schedule,
      targets: [target(7, [INSTANCE_A, INSTANCE_B, INSTANCE_C])],
      globalSentToday: 0,
      horizonMinutes: 60,
    };
    const first = planCommercialTargetSlots(input);
    const restart = planCommercialTargetSlots(input);
    const replan = planCommercialTargetSlots(input);
    expect(first.slots.map(({ target: slotTarget }) => slotTarget.instanceName)).toEqual([
      INSTANCE_A,
      INSTANCE_B,
      INSTANCE_C,
      INSTANCE_A,
      INSTANCE_B,
    ]);
    expect(restart.slots.map(({ jobId }) => jobId)).toEqual(first.slots.map(({ jobId }) => jobId));
    expect(replan.slots.map(({ slotKey }) => slotKey)).toEqual(first.slots.map(({ slotKey }) => slotKey));

    const firstJob = first.slots[0];
    const firstPayload = { mode: 'send' as const, kind: 'target' as const, target: firstJob.target };
    const concurrent = await Promise.all([
      enqueueCommercialAutomationTarget(queue, firstPayload, firstJob.jobId, 0),
      enqueueCommercialAutomationTarget(queue, firstPayload, firstJob.jobId, 0),
    ]);
    expect(concurrent.map((job) => job.id)).toEqual([firstJob.jobId, firstJob.jobId]);

    for (const slot of first.slots.slice(1)) {
      await enqueueCommercialAutomationTarget(
        queue,
        { mode: 'send', kind: 'target', target: slot.target },
        slot.jobId,
        0,
      );
    }
    const jobs = await queue.getJobs(['waiting', 'delayed', 'active', 'completed', 'failed']);
    expect(jobs).toHaveLength(first.slots.length);
    expect(jobs.every((job) =>
      job.data.kind === 'target' &&
      job.data.target.instanceName !== undefined &&
      job.data.target.assignmentRevision === 7 &&
      job.data.target.scheduleRevision === 23 &&
      job.data.target.slotKey.length > 0
    )).toBe(true);

    const secondJob = first.slots[1];
    const persistedSecond = await queue.getJob(secondJob.jobId);
    expect(persistedSecond?.data.kind === 'target' ? persistedSecond.data.target.instanceName : null)
      .toBe(INSTANCE_B);

    await expect(
      enqueueCommercialAutomationTarget(
        queue,
        {
          mode: 'send',
          kind: 'target',
          target: { ...firstJob.target, instanceName: INSTANCE_C },
        },
        firstJob.jobId,
        0,
      ),
    ).rejects.toMatchObject({
      code: 'COMMERCIAL_AUTOMATION_TARGET_JOB_ID_PAYLOAD_CONFLICT',
    });

    const revised = planCommercialTargetSlots({
      ...input,
      targets: [target(8, [INSTANCE_C, INSTANCE_A, INSTANCE_B])],
    });
    expect(revised.slots[0].jobId).not.toBe(first.slots[0].jobId);
    expect(revised.slots[0].target.instanceName).toBe(INSTANCE_C);
    expect((await queue.getJob(secondJob.jobId))?.data).toEqual(persistedSecond?.data);

    console.log(JSON.stringify({
      event: 'R5_REDIS_BINDING_CERTIFIED',
      sequence: first.slots.map((slot) => slot.target.instanceName),
      restartRotationDrift: 0,
      replanRotationDrift: 0,
      concurrentPlanDuplicateJob: 0,
      jobIdPayloadConflictAccepted: 0,
      staleRevisionJobReinterpreted: 0,
      persistedJobCount: jobs.length,
    }));
  });
});
