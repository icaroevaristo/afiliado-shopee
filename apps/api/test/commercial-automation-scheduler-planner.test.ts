import { describe, expect, it } from 'vitest';

import {
  CommercialAutomationSchedulerPlanner,
  planCommercialTargetSlots,
  type CommercialAutomationPlannerTarget,
} from '../src/commercial-automation-scheduler-planner';
import type { CommercialAutomationEffectiveSchedule } from '../src/commercial-automation-policy-service';

const now = new Date('2026-08-24T12:00:00.000Z');

const schedule: CommercialAutomationEffectiveSchedule = {
  timezone: 'America/Sao_Paulo',
  allowedStartTime: '08:00',
  allowedEndTime: '23:00',
  dailyGlobalLimit: 10,
  dailyGroupLimit: 10,
  dailyShopeeHttpLimit: 10,
  dailyOpenAiGenerationLimit: 10,
  minimumIntervalMinutes: 15,
  staggerMinutes: 10,
  scheduleRevision: 3,
};

const target = (
  suffix: string,
  overrides: Partial<CommercialAutomationPlannerTarget> = {},
): CommercialAutomationPlannerTarget => ({
  groupId: `group-${suffix}`,
  groupName: `Group ${suffix}`,
  instanceName: `instance-${suffix}`,
  logicalGroupFingerprint: `fingerprint-${suffix}`,
  campaignId: `campaign-${suffix}`,
  nicheId: `niche-${suffix}`,
  dailyLimit: 10,
  cadenceMinutes: 30,
  timezone: 'America/Sao_Paulo',
  allowedStartTime: '08:00',
  allowedEndTime: '23:00',
  active: true,
  available: true,
  instanceActive: true,
  lastSentAt: null,
  groupSentToday: 0,
  ...overrides,
});

describe('commercial automation scheduler planner', () => {
  it('produz slots determinísticos para duas instâncias e aplica stagger', () => {
    const first = planCommercialTargetSlots({
      now,
      schedule,
      targets: [target('b'), target('a')],
      globalSentToday: 0,
      horizonMinutes: 180,
    });
    const second = planCommercialTargetSlots({
      now,
      schedule,
      targets: [target('a'), target('b')],
      globalSentToday: 0,
      horizonMinutes: 180,
    });

    expect(first.slots.map((slot) => slot.jobId)).toEqual(
      second.slots.map((slot) => slot.jobId),
    );
    expect(first.slots[0].scheduledFor.toISOString()).toBe(
      '2026-08-24T12:00:00.000Z',
    );
    expect(first.slots[1].scheduledFor.toISOString()).toBe(
      '2026-08-24T12:10:00.000Z',
    );
    expect(first.slots[0].target.scheduleRevision).toBe(3);
  });

  it('mantém B elegível quando A está em cooldown', () => {
    const result = planCommercialTargetSlots({
      now,
      schedule: { ...schedule, staggerMinutes: 0 },
      targets: [
        target('a', { lastSentAt: new Date('2026-08-24T11:55:00.000Z') }),
        target('b'),
      ],
      globalSentToday: 0,
      horizonMinutes: 60,
    });

    expect(result.slots[0].target.campaignId).toBe('campaign-b');
    expect(
      result.slots.some((slot) => slot.target.campaignId === 'campaign-a'),
    ).toBe(true);
  });

  it('aplica quota global e quota por grupo sem rerotear', () => {
    const result = planCommercialTargetSlots({
      now,
      schedule: { ...schedule, dailyGlobalLimit: 1 },
      targets: [target('a', { groupSentToday: 10 }), target('b')],
      globalSentToday: 0,
    });

    expect(result.slots).toHaveLength(1);
    expect(result.slots[0].target.campaignId).toBe('campaign-b');
    expect(result.skippedTargets).toContain('campaign-a');
  });

  it('bloqueia instance inativa sem reroute e revision nova muda o job', () => {
    const inactive = planCommercialTargetSlots({
      now,
      schedule,
      targets: [target('a', { instanceActive: false }), target('b')],
      globalSentToday: 0,
      horizonMinutes: 60,
    });
    const revised = planCommercialTargetSlots({
      now,
      schedule: { ...schedule, scheduleRevision: 4 },
      targets: [target('b')],
      globalSentToday: 0,
      horizonMinutes: 60,
    });

    expect(
      inactive.slots.every((slot) => slot.target.campaignId !== 'campaign-a'),
    ).toBe(true);
    expect(revised.slots[0].jobId).not.toBe(inactive.slots[0].jobId);
  });

  it('respeita campaign cadence e janelas diferentes', () => {
    const result = planCommercialTargetSlots({
      now,
      schedule,
      targets: [
        target('a', {
          cadenceMinutes: 60,
          allowedStartTime: '10:00',
          allowedEndTime: '11:30',
        }),
      ],
      globalSentToday: 0,
      horizonMinutes: 180,
    });

    expect(result.slots[0].scheduledFor.toISOString()).toBe(
      '2026-08-24T13:00:00.000Z',
    );
    expect(result.slots[0].target.scheduledFor).toBe(
      result.slots[0].scheduledFor.toISOString(),
    );
    expect(result.slots[1].scheduledFor.toISOString()).toBe(
      '2026-08-24T14:00:00.000Z',
    );
  });

  it('mantem quota global esgotada sem criar slots', () => {
    const result = planCommercialTargetSlots({
      now,
      schedule: { ...schedule, dailyGlobalLimit: 2 },
      targets: [target('a'), target('b')],
      globalSentToday: 2,
    });

    expect(result.slots).toEqual([]);
  });

  it('calcula o primeiro slot no inicio da janela e respeita nextEligibleAt', () => {
    const result = planCommercialTargetSlots({
      now: new Date('2026-08-24T10:00:00.000Z'),
      schedule: { ...schedule, staggerMinutes: 0 },
      targets: [
        target('a', {
          nextEligibleAt: new Date('2026-08-24T12:30:00.000Z'),
        }),
      ],
      globalSentToday: 0,
      horizonMinutes: 360,
    });

    expect(result.slots[0].scheduledFor.toISOString()).toBe(
      '2026-08-24T12:30:00.000Z',
    );
  });

  it('usa a maior entre cadencia e intervalo minimo para o primeiro slot apos envio', () => {
    const result = planCommercialTargetSlots({
      now,
      schedule: { ...schedule, staggerMinutes: 0 },
      targets: [
        target('a', {
          cadenceMinutes: 60,
          lastSentAt: new Date('2026-08-24T12:00:00.000Z'),
        }),
      ],
      globalSentToday: 0,
      horizonMinutes: 180,
    });

    expect(result.slots[0].scheduledFor.toISOString()).toBe(
      '2026-08-24T13:00:00.000Z',
    );
  });

  it('converge IDs de slots sobrepostos entre ticks do planner', () => {
    const targets = [
      target('a', {
        cadenceMinutes: 15,
        lastSentAt: new Date('2026-08-24T11:45:00.000Z'),
      }),
    ];
    const firstTick = planCommercialTargetSlots({
      now,
      schedule: { ...schedule, staggerMinutes: 0 },
      targets,
      globalSentToday: 0,
      horizonMinutes: 60,
    });
    const secondTick = planCommercialTargetSlots({
      now: new Date('2026-08-24T12:15:00.000Z'),
      schedule: { ...schedule, staggerMinutes: 0 },
      targets,
      globalSentToday: 0,
      horizonMinutes: 60,
    });
    const firstByScheduledFor = new Map(
      firstTick.slots.map((slot) => [
        slot.scheduledFor.toISOString(),
        slot.jobId,
      ]),
    );
    const overlaps = secondTick.slots.filter((slot) =>
      firstByScheduledFor.has(slot.scheduledFor.toISOString()),
    );

    expect(overlaps).not.toEqual([]);
    expect(
      overlaps.every(
        (slot) =>
          firstByScheduledFor.get(slot.scheduledFor.toISOString()) ===
          slot.jobId,
      ),
    ).toBe(true);
  });

  it('mantem grupos da mesma instancia em ordem canonica com stagger zero', () => {
    const result = planCommercialTargetSlots({
      now,
      schedule: { ...schedule, staggerMinutes: 0 },
      targets: [
        target('b', { instanceName: 'instance-a' }),
        target('a', { instanceName: 'instance-a' }),
      ],
      globalSentToday: 0,
      horizonMinutes: 20,
    });

    expect(result.slots.map((slot) => slot.target.campaignId)).toEqual([
      'campaign-a',
      'campaign-b',
    ]);
    expect(new Set(result.slots.map((slot) => slot.jobId)).size).toBe(
      result.slots.length,
    );
  });

  it('mantem o espaçamento de stagger entre slots de cadencias diferentes', () => {
    const result = planCommercialTargetSlots({
      now,
      schedule: { ...schedule, staggerMinutes: 10 },
      targets: [
        target('a', { cadenceMinutes: 10 }),
        target('b', { cadenceMinutes: 30 }),
      ],
      globalSentToday: 0,
      horizonMinutes: 60,
    });

    const timestamps = result.slots.map((slot) => slot.scheduledFor.getTime());
    expect(timestamps).toEqual(
      [...timestamps].sort((left, right) => left - right),
    );
    expect(
      timestamps
        .slice(1)
        .every(
          (timestamp, index) => timestamp - timestamps[index] >= 10 * 60_000,
        ),
    ).toBe(true);
  });

  it('executa um soak offline deterministico com restart e mudanca de revisao', () => {
    const soakSchedule = {
      ...schedule,
      dailyGlobalLimit: 8,
      dailyGroupLimit: 2,
      staggerMinutes: 10,
      scheduleRevision: 7,
    };
    const soakTargets = [
      target('a1', { instanceName: 'afiliado-shopee-local' }),
      target('a2', { instanceName: 'afiliado-shopee-local' }),
      target('b1', { instanceName: 'afiliado-shopee-secondary' }),
      target('b2', { instanceName: 'afiliado-shopee-secondary' }),
    ];
    const firstPlan = planCommercialTargetSlots({
      now,
      schedule: soakSchedule,
      targets: soakTargets,
      globalSentToday: 0,
      horizonMinutes: 180,
    });
    const restartPlan = planCommercialTargetSlots({
      now,
      schedule: soakSchedule,
      targets: [...soakTargets].reverse(),
      globalSentToday: 0,
      horizonMinutes: 180,
    });
    const changedRevisionPlan = planCommercialTargetSlots({
      now,
      schedule: { ...soakSchedule, scheduleRevision: 8 },
      targets: soakTargets,
      globalSentToday: 0,
      horizonMinutes: 180,
    });
    const firstJobIds = firstPlan.slots.map((slot) => slot.jobId);
    const restartJobIds = restartPlan.slots.map((slot) => slot.jobId);
    const changedJobIds = changedRevisionPlan.slots.map((slot) => slot.jobId);
    const firstTimes = firstPlan.slots.map((slot) =>
      slot.scheduledFor.getTime(),
    );

    expect(firstPlan.slots).toHaveLength(8);
    expect(new Set(firstJobIds).size).toBe(firstJobIds.length);
    expect(restartJobIds).toEqual(firstJobIds);
    expect(changedJobIds.every((jobId) => !firstJobIds.includes(jobId))).toBe(
      true,
    );
    expect(
      changedRevisionPlan.slots.every(
        (slot) => slot.target.scheduleRevision === 8,
      ),
    ).toBe(true);
    expect(
      new Set(firstPlan.slots.map((slot) => slot.target.instanceName)),
    ).toEqual(new Set(['afiliado-shopee-local', 'afiliado-shopee-secondary']));
    expect(
      new Set(firstPlan.slots.map((slot) => slot.target.groupId)).size,
    ).toBe(4);
    expect(
      firstTimes
        .slice(1)
        .every(
          (timestamp, index) =>
            timestamp - firstTimes[index] >=
            soakSchedule.staggerMinutes * 60_000,
        ),
    ).toBe(true);
    expect(
      firstPlan.slots.every((slot) => slot.target.instanceName !== undefined),
    ).toBe(true);
  });

  it('preserva identidade e cooldown em tres ciclos logicos com restart', () => {
    const cycleSchedule = {
      ...schedule,
      dailyGlobalLimit: 10,
      dailyGroupLimit: 10,
      staggerMinutes: 0,
      scheduleRevision: 7,
    };
    const cycleTarget = (lastSentAt: Date | null, sentToday: number) =>
      target('cycle', {
        cadenceMinutes: 30,
        dailyLimit: 10,
        lastSentAt,
        groupSentToday: sentToday,
      });
    const planCycle = (
      cycleNow: Date,
      lastSentAt: Date | null,
      sentToday: number,
    ) =>
      planCommercialTargetSlots({
        now: cycleNow,
        schedule: cycleSchedule,
        targets: [cycleTarget(lastSentAt, sentToday)],
        globalSentToday: sentToday,
        horizonMinutes: 180,
      });
    const firstCycle = planCycle(now, null, 0);
    const secondCycle = planCycle(
      new Date('2026-08-24T12:01:00.000Z'),
      firstCycle.slots[0].scheduledFor,
      1,
    );
    const thirdCycle = planCycle(
      new Date('2026-08-24T12:31:00.000Z'),
      secondCycle.slots[0].scheduledFor,
      2,
    );
    const cycles = [
      {
        plan: firstCycle,
        now,
        target: cycleTarget(null, 0),
        sentToday: 0,
      },
      {
        plan: secondCycle,
        now: new Date('2026-08-24T12:01:00.000Z'),
        target: cycleTarget(firstCycle.slots[0].scheduledFor, 1),
        sentToday: 1,
      },
      {
        plan: thirdCycle,
        now: new Date('2026-08-24T12:31:00.000Z'),
        target: cycleTarget(secondCycle.slots[0].scheduledFor, 2),
        sentToday: 2,
      },
    ];
    const firstSlots = cycles.map((cycle) => cycle.plan.slots[0]);
    const firstJobIds = firstSlots.map((slot) => slot.jobId);
    const firstTimes = firstSlots.map((slot) => slot.scheduledFor.getTime());

    expect(firstSlots).toHaveLength(3);
    expect(new Set(firstJobIds).size).toBe(3);
    expect(firstTimes).toEqual([
      firstTimes[0],
      firstTimes[0] + 30 * 60_000,
      firstTimes[0] + 60 * 60_000,
    ]);
    expect(firstSlots.every((slot) => slot.target.scheduleRevision === 7)).toBe(
      true,
    );

    for (const cycle of cycles) {
      const replay = planCommercialTargetSlots({
        now: cycle.now,
        schedule: cycleSchedule,
        targets: [cycle.target],
        globalSentToday: cycle.sentToday,
        horizonMinutes: 180,
      });
      expect(replay.slots[0].jobId).toBe(cycle.plan.slots[0].jobId);
    }
  });

  it('consulta a policy antes de planejar um target pausado', async () => {
    const planner = new CommercialAutomationSchedulerPlanner({
      settings: {
        getOrCreate: async () => ({
          id: 'commercial-automation',
          paused: true,
          pausedAt: now,
          resumedAt: null,
          allowedStartTime: null,
          allowedEndTime: null,
          minimumIntervalMinutes: null,
          staggerMinutes: 0,
          scheduleRevision: 1,
          updatedAt: now,
        }),
      },
      campaigns: {
        list: async () => ({
          items: [
            {
              id: 'campaign-a',
              name: 'Campanha A',
              logicalGroupFingerprint: 'fingerprint-a',
              anchorDestinationId: 'group-a',
              nicheId: 'niche-a',
              active: true,
              cadenceMinutes: 30,
              timezone: 'America/Sao_Paulo',
              allowedStartTime: '08:00',
              allowedEndTime: '23:00',
              dailyLimit: 10,
              failureCount: 0,
              nextEligibleAt: null,
              niche: { active: true },
            },
          ],
          total: 1,
        }),
      },
      groups: {
        listAll: async () => [
          {
            id: 'group-a',
            name: 'Grupo A',
            fingerprint: 'fingerprint-a',
            active: true,
            available: true,
            assignedInstanceName: 'instance-a',
          },
        ],
      },
      instances: {
        list: async () => [{ name: 'instance-a', active: true }],
      },
      history: {
        getSnapshot: async () => ({
          globalSentToday: 0,
          groupSentToday: 0,
          lastSentAt: null,
          groupLastSentAt: null,
        }),
      },
      policy: {
        evaluateAutomationReadiness: async () => ({
          allowed: false,
          reasons: ['AUTOMATION_PAUSED'],
        }),
      },
      config: {
        enabled: true,
        timezone: 'America/Sao_Paulo',
        allowedStartTime: '08:00',
        allowedEndTime: '23:00',
        dailyGlobalLimit: 10,
        dailyGroupLimit: 10,
        minimumIntervalMinutes: 15,
      },
      clock: () => now,
    } as never);

    await expect(planner.preview(now)).resolves.toEqual({
      slots: [],
      skippedTargets: [],
    });
  });
});
