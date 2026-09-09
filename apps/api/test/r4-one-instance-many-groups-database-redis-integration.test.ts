import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '@shopee-auto-affiliate-ai/database';
import {
  createCommercialAutomationQueue,
  createRedisConnection,
  enqueueCommercialAutomationTarget,
} from '@shopee-auto-affiliate-ai/queue';
import { fingerprintWhatsAppGroupId } from '@shopee-auto-affiliate-ai/providers';

import { createPrismaRepositories } from '../src/application-services';
import { CommercialAutomationPolicyService } from '../src/commercial-automation-policy-service';
import { CommercialAutomationSchedulerPlanner } from '../src/commercial-automation-scheduler-planner';

const enabled = process.env.RUN_R4_DB_REDIS_TEST === 'true';
const describeIntegration = enabled ? describe.sequential : describe.skip;
const PREFIX = 'r4-one-instance-many-groups';
const INSTANCE_A = `${PREFIX}-instance-a`;
const INSTANCE_B = `${PREFIX}-instance-b`;
const NOW = new Date('2026-09-09T12:00:00.000Z');
const GROUP_NAMES = ['a', 'b', 'c'] as const;

describeIntegration('R4 one instance to many groups on disposable PostgreSQL and Redis', () => {
  let prisma: ReturnType<typeof createPrismaClient>;
  let redis: ReturnType<typeof createRedisConnection>;
  let queue: ReturnType<typeof createCommercialAutomationQueue>;

  const cleanupDatabase = async () => {
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
      where: { name: { in: [INSTANCE_A, INSTANCE_B] } },
    });
    await prisma.commercialAutomationSettings.deleteMany({
      where: { id: 'commercial-automation' },
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
    await cleanupDatabase();

    await prisma.whatsAppInstance.createMany({
      data: [
        { name: INSTANCE_A, active: true, paused: false },
        { name: INSTANCE_B, active: true, paused: false },
      ],
    });
    await prisma.commercialAutomationSettings.create({
      data: {
        id: 'commercial-automation',
        paused: false,
        pausedAt: null,
        resumedAt: NOW,
        allowedStartTime: '00:00',
        allowedEndTime: '23:59',
        timezone: 'America/Sao_Paulo',
        minimumIntervalMinutes: 15,
        staggerMinutes: 10,
        dailyGlobalLimit: 3,
        dailyGroupLimit: 1,
        dailyShopeeHttpLimit: 3,
        dailyOpenAiGenerationLimit: 3,
        scheduleRevision: 17,
      },
    });

    for (const suffix of GROUP_NAMES) {
      const externalGroupId = `12036377700000${suffix.charCodeAt(0)}@g.us`;
      const groupId = `${PREFIX}-group-${suffix}`;
      const nicheId = `${PREFIX}-niche-${suffix}`;
      const fingerprint = fingerprintWhatsAppGroupId(externalGroupId);
      await prisma.whatsAppDestination.create({
        data: {
          id: groupId,
          name: `R4 Group ${suffix.toUpperCase()}`,
          destination: externalGroupId,
          type: 'GROUP',
          active: true,
          paused: false,
          available: true,
          fingerprint,
          sourceInstanceName: INSTANCE_A,
          assignedInstanceName: INSTANCE_A,
          assignmentRevision: 4,
          discoveredAt: NOW,
          lastSyncedAt: NOW,
          instanceAssignments: {
            create: { instanceName: INSTANCE_A, position: 0 },
          },
        },
      });
      await prisma.commercialNiche.create({
        data: {
          id: nicheId,
          name: `R4 Niche ${suffix.toUpperCase()}`,
          slug: `${PREFIX}-${suffix}`,
          active: true,
        },
      });
      await prisma.commercialGroupCampaign.create({
        data: {
          id: `${PREFIX}-campaign-${suffix}`,
          name: `R4 Campaign ${suffix.toUpperCase()}`,
          logicalGroupFingerprint: fingerprint,
          anchorDestinationId: groupId,
          nicheId,
          active: true,
          cadenceMinutes: 15,
          timezone: 'America/Sao_Paulo',
          allowedStartTime: '00:00',
          allowedEndTime: '23:59',
          dailyLimit: 1,
        },
      });
    }
  });

  afterAll(async () => {
    await queue?.obliterate({ force: true }).catch(() => undefined);
    await queue?.close().catch(() => undefined);
    await redis?.quit().catch(() => undefined);
    if (prisma) {
      await cleanupDatabase().catch(() => undefined);
      await prisma.$disconnect();
    }
  });

  const createPlanner = () => {
    const repositories = createPrismaRepositories(prisma);
    const config = {
      enabled: true,
      timezone: 'America/Sao_Paulo',
      allowedStartTime: '00:00',
      allowedEndTime: '23:59',
      dailyGlobalLimit: 3,
      dailyGroupLimit: 1,
      minimumIntervalMinutes: 15,
    };
    const policy = new CommercialAutomationPolicyService({
      settings: repositories.commercialAutomationSettings,
      history: repositories.commercialAutomationHistory,
      groups: repositories.whatsappGroups,
      instances: repositories.whatsappInstances,
      instanceName: INSTANCE_A,
      config,
      clock: () => NOW,
    });
    return new CommercialAutomationSchedulerPlanner({
      settings: repositories.commercialAutomationSettings,
      campaigns: repositories.commercialGroupCampaigns,
      groups: repositories.whatsappGroups,
      instances: repositories.whatsappInstances,
      history: repositories.commercialAutomationHistory,
      policy,
      config,
      clock: () => NOW,
    });
  };

  it('persiste três grupos independentes, planeja três targets e converge jobs BullMQ', async () => {
    const persisted = await prisma.whatsAppDestination.findMany({
      where: { id: { startsWith: `${PREFIX}-group-` } },
      orderBy: { id: 'asc' },
      include: { instanceAssignments: { orderBy: { position: 'asc' } } },
    });
    expect(persisted).toHaveLength(3);
    expect(
      persisted.every(
        (group) =>
          group.assignedInstanceName === INSTANCE_A &&
          group.assignmentRevision === 4 &&
          group.instanceAssignments.length === 1 &&
          group.instanceAssignments[0]?.instanceName === INSTANCE_A &&
          group.instanceAssignments[0]?.position === 0,
      ),
    ).toBe(true);
    expect(
      await prisma.whatsAppGroupInstanceAssignment.count({
        where: { instanceName: INSTANCE_A },
      }),
    ).toBe(3);

    const first = await createPlanner().preview(NOW);
    const replan = await createPlanner().preview(NOW);
    const restart = await createPlanner().preview(NOW);
    expect(first.slots).toHaveLength(3);
    expect(first.slots.map((slot) => slot.jobId)).toEqual(
      replan.slots.map((slot) => slot.jobId),
    );
    expect(first.slots.map((slot) => slot.jobId)).toEqual(
      restart.slots.map((slot) => slot.jobId),
    );
    expect(new Set(first.slots.map((slot) => slot.jobId)).size).toBe(3);
    expect(new Set(first.slots.map((slot) => slot.target.groupId)).size).toBe(3);
    expect(new Set(first.slots.map((slot) => slot.target.campaignId)).size).toBe(3);
    expect(
      first.slots.every(
        (slot) =>
          slot.target.instanceName === INSTANCE_A &&
          slot.target.assignmentRevision === 4 &&
          slot.target.scheduleRevision === 17,
      ),
    ).toBe(true);

    for (const slot of first.slots) {
      await enqueueCommercialAutomationTarget(
        queue,
        { mode: 'send', kind: 'target', target: slot.target },
        slot.jobId,
        0,
      );
    }
    for (const slot of replan.slots) {
      await enqueueCommercialAutomationTarget(
        queue,
        { mode: 'send', kind: 'target', target: slot.target },
        slot.jobId,
        0,
      );
    }
    const jobs = await queue.getJobs([
      'waiting',
      'delayed',
      'active',
      'completed',
      'failed',
    ]);
    expect(jobs).toHaveLength(3);
    expect(new Set(jobs.map((job) => job.id)).size).toBe(3);
    expect(
      jobs.every(
        (job) =>
          job.data.kind === 'target' &&
          job.data.target.instanceName === INSTANCE_A &&
          job.data.target.assignmentRevision === 4 &&
          job.data.target.scheduleRevision === 17,
      ),
    ).toBe(true);
    expect(new Set(jobs.map((job) => job.data.kind === 'target' ? job.data.target.groupId : '')).size).toBe(3);

    console.log(
      JSON.stringify({
        event: 'R4_ONE_INSTANCE_MANY_GROUPS_CERTIFIED',
        persistedGroupCount: persisted.length,
        sharedInstanceCount: 1,
        targetCount: first.slots.length,
        uniqueJobCount: jobs.length,
        replanJobIdDrift: 0,
        restartJobIdDrift: 0,
      }),
    );
  });
});
