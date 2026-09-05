import { describe, expect, it } from 'vitest';

import {
  CommercialAutomationSchedulerPlanner,
  planCommercialTargetSlots,
  type CommercialAutomationPlannerTarget,
} from '../src/commercial-automation-scheduler-planner';
import type { CommercialAutomationEffectiveSchedule } from '../src/commercial-automation-policy-service';

const now = new Date('2026-08-24T12:00:00.000Z');
const MINUTE_MS = 60_000;

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
      '2026-08-24T12:30:00.000Z',
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

  it('arredonda nextEligibleAt para o proximo ponto da grade', () => {
    const result = planCommercialTargetSlots({
      now,
      schedule: { ...schedule, minimumIntervalMinutes: 15, staggerMinutes: 0 },
      targets: [
        target('next-eligible-grid', {
          orderedInstanceNames: [
            'afiliado-shopee-local',
            'afiliado-shopee-secondary',
          ],
          instanceActiveByName: {
            'afiliado-shopee-local': true,
            'afiliado-shopee-secondary': true,
          },
          cadenceMinutes: 15,
          nextEligibleAt: new Date('2026-08-24T12:05:00.000Z'),
        }),
      ],
      globalSentToday: 0,
      horizonMinutes: 60,
    });

    expect(result.slots[0]!.scheduledFor.toISOString()).toBe(
      '2026-08-24T12:15:00.000Z',
    );
    expect(result.slots[0]!.target.instanceName).toBe(
      'afiliado-shopee-secondary',
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

  it('aplica intervalo minimo nos slots subsequentes', () => {
    const result = planCommercialTargetSlots({
      now,
      schedule: {
        ...schedule,
        minimumIntervalMinutes: 180,
        staggerMinutes: 0,
        dailyGlobalLimit: 2,
        dailyGroupLimit: 2,
      },
      targets: [target('minimum-interval', { cadenceMinutes: 30 })],
      globalSentToday: 0,
      horizonMinutes: 360,
    });

    expect(result.slots).toHaveLength(2);
    expect(
      result.slots[1]!.scheduledFor.getTime() -
        result.slots[0]!.scheduledFor.getTime(),
    ).toBeGreaterThanOrEqual(180 * MINUTE_MS);
  });

  it('preserva cadence quando ela e maior que o intervalo minimo', () => {
    const result = planCommercialTargetSlots({
      now,
      schedule: {
        ...schedule,
        minimumIntervalMinutes: 30,
        staggerMinutes: 0,
        dailyGlobalLimit: 2,
        dailyGroupLimit: 2,
      },
      targets: [target('cadence-dominant', { cadenceMinutes: 180 })],
      globalSentToday: 0,
      horizonMinutes: 360,
    });

    expect(result.slots).toHaveLength(2);
    expect(
      result.slots[1]!.scheduledFor.getTime() -
        result.slots[0]!.scheduledFor.getTime(),
    ).toBeGreaterThanOrEqual(180 * MINUTE_MS);
  });

  it('mantem a rotacao de duas instancias a cada quinze minutos', () => {
    const result = planCommercialTargetSlots({
      now,
      schedule: {
        ...schedule,
        minimumIntervalMinutes: 15,
        staggerMinutes: 0,
        dailyGlobalLimit: 4,
        dailyGroupLimit: 4,
      },
      targets: [
        target('operational-rotation', {
          instanceName: 'afiliado-shopee-local',
          orderedInstanceNames: [
            'afiliado-shopee-local',
            'afiliado-shopee-secondary',
          ],
          assignmentRevision: 2,
          instanceActiveByName: {
            'afiliado-shopee-local': true,
            'afiliado-shopee-secondary': true,
          },
          cadenceMinutes: 15,
        }),
      ],
      globalSentToday: 0,
      horizonMinutes: 60,
    });

    expect(result.slots.map((slot) => slot.target.instanceName)).toEqual([
      'afiliado-shopee-local',
      'afiliado-shopee-secondary',
      'afiliado-shopee-local',
      'afiliado-shopee-secondary',
    ]);
    expect(
      result.slots
        .slice(1)
        .every(
          (slot, index) =>
            slot.scheduledFor.getTime() -
              result.slots[index]!.scheduledFor.getTime() ===
            15 * MINUTE_MS,
        ),
    ).toBe(true);
  });

  it('permite os sessenta slots teoricos dentro da janela end-exclusive', () => {
    const result = planCommercialTargetSlots({
      now: new Date('2026-08-24T11:00:00.000Z'),
      schedule: {
        ...schedule,
        minimumIntervalMinutes: 15,
        staggerMinutes: 0,
        dailyGlobalLimit: 60,
        dailyGroupLimit: 60,
      },
      targets: [
        target('daily-theoretical-cap', {
          dailyLimit: 60,
          cadenceMinutes: 15,
          instanceName: 'afiliado-shopee-local',
          orderedInstanceNames: [
            'afiliado-shopee-local',
            'afiliado-shopee-secondary',
          ],
          instanceActiveByName: {
            'afiliado-shopee-local': true,
            'afiliado-shopee-secondary': true,
          },
        }),
      ],
      globalSentToday: 0,
      horizonMinutes: 24 * 60,
    });

    expect(result.slots).toHaveLength(60);
    expect(result.slots[0]!.scheduledFor.toISOString()).toBe(
      '2026-08-24T11:00:00.000Z',
    );
    expect(result.slots.at(-1)!.scheduledFor.toISOString()).toBe(
      '2026-08-25T01:45:00.000Z',
    );
    expect(
      result.slots.every(
        (slot) =>
          slot.scheduledFor.getTime() < Date.parse('2026-08-25T02:00:00.000Z'),
      ),
    ).toBe(true);
    expect(
      result.slots.filter(
        (slot) => slot.target.instanceName === 'afiliado-shopee-local',
      ),
    ).toHaveLength(30);
    expect(
      result.slots.filter(
        (slot) => slot.target.instanceName === 'afiliado-shopee-secondary',
      ),
    ).toHaveLength(30);
  });

  it('mantem o intervalo dominante em tres slots do mesmo grupo', () => {
    const result = planCommercialTargetSlots({
      now,
      schedule: {
        ...schedule,
        minimumIntervalMinutes: 180,
        staggerMinutes: 0,
        dailyGlobalLimit: 3,
        dailyGroupLimit: 3,
      },
      targets: [target('three-slots', { cadenceMinutes: 30 })],
      globalSentToday: 0,
      horizonMinutes: 540,
    });

    expect(result.slots).toHaveLength(3);
    expect(
      result.slots
        .slice(1)
        .every(
          (slot, index) =>
            slot.scheduledFor.getTime() -
              result.slots[index]!.scheduledFor.getTime() >=
            180 * MINUTE_MS,
        ),
    ).toBe(true);
  });

  it('permanece deterministico em replan com a mesma revisao', () => {
    const input = {
      now,
      schedule: {
        ...schedule,
        minimumIntervalMinutes: 180,
        staggerMinutes: 0,
        dailyGlobalLimit: 3,
        dailyGroupLimit: 3,
        scheduleRevision: 9,
      },
      targets: [
        target('replan', {
          cadenceMinutes: 30,
          orderedInstanceNames: [
            'afiliado-shopee-local',
            'afiliado-shopee-secondary',
          ],
          instanceActiveByName: {
            'afiliado-shopee-local': true,
            'afiliado-shopee-secondary': true,
          },
          assignmentRevision: 3,
        }),
      ],
      globalSentToday: 0,
      horizonMinutes: 360,
    };
    const first = planCommercialTargetSlots(input);
    const afterRestart = planCommercialTargetSlots({
      ...input,
      targets: [...input.targets].reverse(),
    });

    expect(
      afterRestart.slots.map((slot) => slot.scheduledFor.toISOString()),
    ).toEqual(first.slots.map((slot) => slot.scheduledFor.toISOString()));
    expect(afterRestart.slots.map((slot) => slot.target.instanceName)).toEqual(
      first.slots.map((slot) => slot.target.instanceName),
    );
    expect(afterRestart.slots.map((slot) => slot.slotKey)).toEqual(
      first.slots.map((slot) => slot.slotKey),
    );
    expect(afterRestart.slots.map((slot) => slot.jobId)).toEqual(
      first.slots.map((slot) => slot.jobId),
    );
  });

  it('aplica intervalo minimo por grupo sem transformar em limite global', () => {
    const result = planCommercialTargetSlots({
      now,
      schedule: {
        ...schedule,
        minimumIntervalMinutes: 180,
        staggerMinutes: 0,
        dailyGlobalLimit: 4,
        dailyGroupLimit: 4,
      },
      targets: [
        target('group-a', { cadenceMinutes: 30 }),
        target('group-b', { cadenceMinutes: 30 }),
      ],
      globalSentToday: 0,
      horizonMinutes: 360,
    });
    const groupA = result.slots.filter(
      (slot) => slot.target.groupId === 'group-group-a',
    );
    const groupB = result.slots.filter(
      (slot) => slot.target.groupId === 'group-group-b',
    );

    expect(groupA).toHaveLength(2);
    expect(groupB).toHaveLength(2);
    expect(
      groupA[1]!.scheduledFor.getTime() - groupA[0]!.scheduledFor.getTime(),
    ).toBeGreaterThanOrEqual(180 * MINUTE_MS);
    expect(
      groupB[1]!.scheduledFor.getTime() - groupB[0]!.scheduledFor.getTime(),
    ).toBeGreaterThanOrEqual(180 * MINUTE_MS);
    expect(groupA[0]!.scheduledFor).toEqual(groupB[0]!.scheduledFor);
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
      horizonMinutes: 240,
    });
    const restartPlan = planCommercialTargetSlots({
      now,
      schedule: soakSchedule,
      targets: [...soakTargets].reverse(),
      globalSentToday: 0,
      horizonMinutes: 240,
    });
    const changedRevisionPlan = planCommercialTargetSlots({
      now,
      schedule: { ...soakSchedule, scheduleRevision: 8 },
      targets: soakTargets,
      globalSentToday: 0,
      horizonMinutes: 240,
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

  it('reinicia a grade na nova fronteira do dia local', () => {
    const boundarySchedule = {
      ...schedule,
      allowedStartTime: '00:00',
      allowedEndTime: '23:59',
      minimumIntervalMinutes: 15,
      staggerMinutes: 0,
      dailyGlobalLimit: 1,
      dailyGroupLimit: 1,
    };
    const boundaryTarget = target('day-boundary', {
      orderedInstanceNames: [
        'afiliado-shopee-local',
        'afiliado-shopee-secondary',
      ],
      instanceActiveByName: {
        'afiliado-shopee-local': true,
        'afiliado-shopee-secondary': true,
      },
      assignmentRevision: 2,
      dailyLimit: 1,
      cadenceMinutes: 15,
      allowedStartTime: '00:00',
      allowedEndTime: '23:59',
    });
    const firstDay = planCommercialTargetSlots({
      now: new Date('2026-08-24T03:00:00.000Z'),
      schedule: boundarySchedule,
      targets: [boundaryTarget],
      globalSentToday: 0,
      horizonMinutes: 15,
    });
    const nextDay = planCommercialTargetSlots({
      now: new Date('2026-08-25T03:00:00.000Z'),
      schedule: boundarySchedule,
      targets: [boundaryTarget],
      globalSentToday: 0,
      horizonMinutes: 15,
    });

    expect(firstDay.slots[0]!.scheduledFor.toISOString()).toBe(
      '2026-08-24T03:00:00.000Z',
    );
    expect(nextDay.slots[0]!.scheduledFor.toISOString()).toBe(
      '2026-08-25T03:00:00.000Z',
    );
    expect(firstDay.slots[0]!.target.instanceName).toBe(
      'afiliado-shopee-local',
    );
    expect(nextDay.slots[0]!.target.instanceName).toBe(
      'afiliado-shopee-local',
    );
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

  it('vincula cada slot a uma instancia ordenada em round-robin', () => {
    const rotatingTarget = target('rotating', {
      instanceName: 'instance-a',
      orderedInstanceNames: ['instance-a', 'instance-b'],
      assignmentRevision: 4,
      cadenceMinutes: 1,
      instanceActive: true,
      instanceActiveByName: { 'instance-a': true, 'instance-b': true },
    });
    const result = planCommercialTargetSlots({
      now,
      schedule: {
        ...schedule,
        minimumIntervalMinutes: 1,
        staggerMinutes: 0,
        dailyGlobalLimit: 3,
        dailyGroupLimit: 3,
      },
      targets: [rotatingTarget],
      globalSentToday: 0,
      horizonMinutes: 10,
    });

    expect(result.slots.map((slot) => slot.target.instanceName)).toEqual([
      'instance-a',
      'instance-b',
      'instance-a',
    ]);
    expect(result.slots.every((slot) => slot.target.assignmentRevision === 4)).toBe(
      true,
    );
  });

  it('mantem a mesma rotação após restart/replan', () => {
    const rotatingTarget = target('restart-rotation', {
      orderedInstanceNames: ['instance-a', 'instance-b', 'instance-c'],
      instanceActiveByName: {
        'instance-a': true,
        'instance-b': true,
        'instance-c': true,
      },
      cadenceMinutes: 1,
    });
    const input = {
      now,
      schedule: { ...schedule, minimumIntervalMinutes: 1, staggerMinutes: 0 },
      targets: [rotatingTarget],
      globalSentToday: 0,
      horizonMinutes: 10,
    };
    const first = planCommercialTargetSlots(input);
    const afterRestart = planCommercialTargetSlots({
      ...input,
      targets: [...input.targets],
    });

    expect(afterRestart.slots.map((slot) => slot.jobId)).toEqual(
      first.slots.map((slot) => slot.jobId),
    );
    expect(afterRestart.slots.map((slot) => slot.target.instanceName)).toEqual([
      'instance-a',
      'instance-b',
      'instance-c',
      'instance-a',
      'instance-b',
      'instance-c',
      'instance-a',
      'instance-b',
      'instance-c',
      'instance-a',
    ]);
  });

  it('mantem os mesmos jobs no plan entre replans com offset', async () => {
    const settings = {
      id: 'commercial-automation',
      paused: false,
      pausedAt: null,
      resumedAt: now,
      allowedStartTime: '08:00',
      allowedEndTime: '23:00',
      minimumIntervalMinutes: 15,
      staggerMinutes: 0,
      dailyGlobalLimit: 4,
      dailyGroupLimit: 4,
      scheduleRevision: 11,
      updatedAt: now,
    };
    const planner = new CommercialAutomationSchedulerPlanner({
      settings: { get: async () => settings },
      campaigns: {
        list: async () => ({
          items: [
            {
              id: 'campaign-grid',
              name: 'Campaign Grid',
              logicalGroupFingerprint: 'fingerprint-grid',
              anchorDestinationId: 'group-grid',
              nicheId: 'niche-grid',
              active: true,
              cadenceMinutes: 15,
              timezone: 'America/Sao_Paulo',
              allowedStartTime: '08:00',
              allowedEndTime: '23:00',
              dailyLimit: 4,
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
            id: 'group-grid',
            name: 'Group Grid',
            fingerprint: 'fingerprint-grid',
            active: true,
            available: true,
            paused: false,
            assignedInstanceName: 'instance-a',
            assignedInstanceNames: ['instance-a', 'instance-b'],
            assignmentRevision: 2,
          },
        ],
      },
      instances: {
        list: async () => [
          { name: 'instance-a', active: true, paused: false },
          { name: 'instance-b', active: true, paused: false },
        ],
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
          allowed: true,
          reasons: [],
        }),
      },
      config: {
        enabled: true,
        timezone: 'America/Sao_Paulo',
        allowedStartTime: '08:00',
        allowedEndTime: '23:00',
        dailyGlobalLimit: 4,
        dailyGroupLimit: 4,
        minimumIntervalMinutes: 15,
      },
      clock: () => now,
    } as never);
    const run = async (runNow: Date) => {
      const enqueued: Array<{ at: string; jobId: string }> = [];
      await planner.plan({
        now: runNow,
        mode: 'send',
        enqueue: async (data, jobId) => {
          enqueued.push({ at: data.target.scheduledFor, jobId });
        },
      });
      return enqueued;
    };

    const first = await run(now);
    const offset = await run(new Date(now.getTime() + 5 * MINUTE_MS));
    const firstByTime = new Map(first.map((slot) => [slot.at, slot.jobId]));
    const overlapping = offset.filter((slot) => firstByTime.has(slot.at));

    expect(first.map((slot) => slot.at)).toEqual([
      '2026-08-24T12:00:00.000Z',
    ]);
    expect(overlapping.map((slot) => slot.jobId)).toEqual([]);
  });

  it('preserva a fase round-robin entre ticks sobrepostos e após envio', () => {
    const rotatingTarget = target('replan-rotation', {
      orderedInstanceNames: [
        'afiliado-shopee-local',
        'afiliado-shopee-secondary',
      ],
      instanceActiveByName: {
        'afiliado-shopee-local': true,
        'afiliado-shopee-secondary': true,
      },
      cadenceMinutes: 15,
      assignmentRevision: 2,
    });
    const planningSchedule = {
      ...schedule,
      minimumIntervalMinutes: 15,
      staggerMinutes: 0,
      dailyGlobalLimit: 4,
      dailyGroupLimit: 4,
      scheduleRevision: 11,
    };
    const first = planCommercialTargetSlots({
      now,
      schedule: planningSchedule,
      targets: [rotatingTarget],
      globalSentToday: 0,
      horizonMinutes: 60,
    });
    const beforeFirstIsSent = planCommercialTargetSlots({
      now: new Date(now.getTime() + 15 * MINUTE_MS),
      schedule: planningSchedule,
      targets: [rotatingTarget],
      globalSentToday: 0,
      horizonMinutes: 60,
    });
    const afterFirstIsSent = planCommercialTargetSlots({
      now: new Date(now.getTime() + 15 * MINUTE_MS),
      schedule: planningSchedule,
      targets: [
        {
          ...rotatingTarget,
          lastSentAt: first.slots[0]!.scheduledFor,
          groupSentToday: 1,
        },
      ],
      globalSentToday: 1,
      horizonMinutes: 60,
    });

    expect(first.slots.map((slot) => slot.target.instanceName)).toEqual([
      'afiliado-shopee-local',
      'afiliado-shopee-secondary',
      'afiliado-shopee-local',
      'afiliado-shopee-secondary',
    ]);
    expect(beforeFirstIsSent.slots[0]!.target.instanceName).toBe(
      'afiliado-shopee-secondary',
    );
    expect(beforeFirstIsSent.slots[0]!.jobId).toBe(first.slots[1]!.jobId);
    expect(afterFirstIsSent.slots[0]!.target.instanceName).toBe(
      'afiliado-shopee-secondary',
    );
    expect(afterFirstIsSent.slots[0]!.jobId).toBe(first.slots[1]!.jobId);
  });

  it('converge replans em offsets arbitrarios para a mesma grade temporal', () => {
    const rotatingTarget = target('arbitrary-offset-grid', {
      orderedInstanceNames: [
        'afiliado-shopee-local',
        'afiliado-shopee-secondary',
      ],
      instanceActiveByName: {
        'afiliado-shopee-local': true,
        'afiliado-shopee-secondary': true,
      },
      cadenceMinutes: 15,
      assignmentRevision: 2,
    });
    const planningSchedule = {
      ...schedule,
      minimumIntervalMinutes: 15,
      staggerMinutes: 0,
      dailyGlobalLimit: 4,
      dailyGroupLimit: 4,
      scheduleRevision: 12,
    };
    const first = planCommercialTargetSlots({
      now,
      schedule: planningSchedule,
      targets: [rotatingTarget],
      globalSentToday: 0,
      horizonMinutes: 60,
    });
    const firstByTime = new Map(
      first.slots.map((slot) => [slot.scheduledFor.getTime(), slot]),
    );
    const gridOrigin = first.slots[0]!.scheduledFor.getTime();

    expect(first.slots.map((slot) => slot.scheduledFor.toISOString())).toEqual([
      '2026-08-24T12:00:00.000Z',
      '2026-08-24T12:15:00.000Z',
      '2026-08-24T12:30:00.000Z',
      '2026-08-24T12:45:00.000Z',
    ]);

    for (const offsetMinutes of [1, 5, 14, 15, 16]) {
      const replanNow = new Date(now.getTime() + offsetMinutes * MINUTE_MS);
      const replan = planCommercialTargetSlots({
        now: replanNow,
        schedule: planningSchedule,
        targets: [rotatingTarget],
        globalSentToday: 0,
        horizonMinutes: 60,
      });
      const overlappingSlots = replan.slots.filter((slot) =>
        firstByTime.has(slot.scheduledFor.getTime()),
      );
      const expectedOverlaps = first.slots.filter(
        (slot) => slot.scheduledFor.getTime() >= replanNow.getTime(),
      );

      expect(overlappingSlots.map((slot) => slot.scheduledFor.getTime())).toEqual(
        expectedOverlaps.map((slot) => slot.scheduledFor.getTime()),
      );
      expect(overlappingSlots.map((slot) => slot.target.instanceName)).toEqual(
        expectedOverlaps.map((slot) => slot.target.instanceName),
      );
      expect(overlappingSlots.map((slot) => slot.slotKey)).toEqual(
        expectedOverlaps.map((slot) => firstByTime.get(slot.scheduledFor.getTime())!.slotKey),
      );
      expect(overlappingSlots.map((slot) => slot.jobId)).toEqual(
        expectedOverlaps.map((slot) => firstByTime.get(slot.scheduledFor.getTime())!.jobId),
      );
      expect(
        replan.slots.every(
          (slot) =>
            (slot.scheduledFor.getTime() - gridOrigin) % (15 * MINUTE_MS) === 0,
        ),
      ).toBe(true);
    }
  });

  it('bloqueia o slot da instancia indisponivel sem fallback silencioso', () => {
    const result = planCommercialTargetSlots({
      now,
      schedule: { ...schedule, minimumIntervalMinutes: 1, staggerMinutes: 0 },
      targets: [
        target('unavailable-member', {
          orderedInstanceNames: ['instance-a', 'instance-b'],
          instanceActiveByName: { 'instance-a': true, 'instance-b': false },
          cadenceMinutes: 1,
          dailyLimit: 3,
        }),
      ],
      globalSentToday: 0,
      horizonMinutes: 10,
    });

    expect(result.slots.map((slot) => slot.target.instanceName)).toEqual([
      'instance-a',
      'instance-a',
    ]);
    expect(result.slots[1]?.scheduledFor.getTime()).toBe(
      result.slots[0]!.scheduledFor.getTime() + 2 * MINUTE_MS,
    );
  });

  it('preserva a fase quando o primeiro membro esta indisponivel', () => {
    const result = planCommercialTargetSlots({
      now,
      schedule: { ...schedule, minimumIntervalMinutes: 1, staggerMinutes: 0 },
      targets: [
        target('unavailable-first-member', {
          orderedInstanceNames: ['instance-a', 'instance-b'],
          instanceActiveByName: { 'instance-a': false, 'instance-b': true },
          cadenceMinutes: 1,
          dailyLimit: 4,
        }),
      ],
      globalSentToday: 0,
      horizonMinutes: 10,
    });

    expect(result.slots.map((slot) => slot.target.instanceName)).toEqual([
      'instance-b',
      'instance-b',
    ]);
    expect(result.slots[1]?.scheduledFor.getTime()).toBe(
      result.slots[0]!.scheduledFor.getTime() + 2 * MINUTE_MS,
    );
  });

  it('muda a identidade do job quando assignmentRevision muda', () => {
    const base = target('assignment-revision', {
      orderedInstanceNames: ['instance-a', 'instance-b'],
      assignmentRevision: 1,
      instanceActiveByName: { 'instance-a': true, 'instance-b': true },
      cadenceMinutes: 1,
    });
    const first = planCommercialTargetSlots({
      now,
      schedule: { ...schedule, minimumIntervalMinutes: 1, staggerMinutes: 0 },
      targets: [base],
      globalSentToday: 0,
      horizonMinutes: 2,
    });
    const revised = planCommercialTargetSlots({
      now,
      schedule: { ...schedule, minimumIntervalMinutes: 1, staggerMinutes: 0 },
      targets: [{ ...base, assignmentRevision: 2 }],
      globalSentToday: 0,
      horizonMinutes: 2,
    });

    expect(revised.slots[0]!.jobId).not.toBe(first.slots[0]!.jobId);
  });

  it('avanca a rotacao somente depois de um SENT confirmado e mantem B apos falha de B', () => {
    const base = target('sent-rotation', {
      orderedInstanceNames: ['instance-a', 'instance-b'],
      instanceActiveByName: { 'instance-a': true, 'instance-b': true },
      lastSentInstanceName: 'instance-a',
      dailyLimit: 3,
      cadenceMinutes: 1,
    });
    const input = {
      now,
      schedule: { ...schedule, minimumIntervalMinutes: 1, staggerMinutes: 0 },
      globalSentToday: 0,
      horizonMinutes: 10,
      enforceConfirmedSentRotation: true,
    } as const;

    const first = planCommercialTargetSlots({ ...input, targets: [base] });
    const afterBlockedAttempt = planCommercialTargetSlots({
      ...input,
      targets: [base],
    });
    const afterSent = planCommercialTargetSlots({
      ...input,
      targets: [{ ...base, lastSentInstanceName: 'instance-b' }],
    });

    expect(first.slots).toHaveLength(1);
    expect(first.slots[0]?.target.instanceName).toBe('instance-b');
    expect(afterBlockedAttempt.slots[0]?.target.instanceName).toBe('instance-b');
    expect(afterBlockedAttempt.slots[0]?.jobId).toBe(first.slots[0]?.jobId);
    expect(afterSent.slots[0]?.target.instanceName).toBe('instance-a');
  });

  it('planeja somente a proxima slot pendente por target no modo operacional', () => {
    const result = planCommercialTargetSlots({
      now,
      schedule: { ...schedule, minimumIntervalMinutes: 1, staggerMinutes: 0 },
      targets: [
        target('single-pending-slot', {
          orderedInstanceNames: ['instance-a', 'instance-b'],
          instanceActiveByName: { 'instance-a': true, 'instance-b': true },
          dailyLimit: 4,
          cadenceMinutes: 1,
        }),
      ],
      globalSentToday: 0,
      horizonMinutes: 10,
      enforceConfirmedSentRotation: true,
    });

    expect(result.slots).toHaveLength(1);
    expect(result.slots[0]?.target.instanceName).toBe('instance-a');
  });
});
