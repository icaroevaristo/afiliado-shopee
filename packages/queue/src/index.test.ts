import { describe, expect, it, vi } from 'vitest';

import {
  COMMERCIAL_AUTOMATION_JOB_OPTIONS,
  enqueueCommercialAutomationTarget,
  enqueueCommercialInventoryRefill,
  JOB_NAMES,
} from './index';

describe('commercial target queue contract', () => {
  it('usa jobId, delay e payload target determinísticos', async () => {
    const data = {
      mode: 'send' as const,
      kind: 'target' as const,
      target: {
        campaignId: 'campaign-1',
        groupId: 'group-1',
        logicalGroupFingerprint: 'fingerprint-1',
        instanceName: 'instance-1',
        scheduledFor: '2026-08-24T12:00:00.000Z',
        slotKey: 'slot-1',
        scheduleRevision: 1,
      },
    };
    const localJob = {
      id: 'commercial-target-slot-1',
      name: JOB_NAMES.commercialAutomationTarget,
      data,
    };
    const persistedJob = { ...localJob };
    const calls: string[] = [];
    const add = vi.fn().mockImplementation(async () => {
      calls.push('add');
      return localJob;
    });
    const getJob = vi.fn().mockImplementation(async () => {
      calls.push('getJob');
      return persistedJob;
    });

    const result = await enqueueCommercialAutomationTarget(
      { add, getJob } as never,
      data,
      'commercial-target-slot-1',
      30_000,
    );

    expect(add).toHaveBeenCalledWith(
      JOB_NAMES.commercialAutomationTarget,
      data,
      expect.objectContaining({
        ...COMMERCIAL_AUTOMATION_JOB_OPTIONS,
        jobId: 'commercial-target-slot-1',
        delay: 30_000,
      }),
    );
    expect(result).toBe(persistedJob);
    expect(getJob).toHaveBeenCalledWith('commercial-target-slot-1');
    expect(calls).toEqual(['add', 'getJob']);
  });

  it('reutiliza o compromisso lógico já pendente sem criar outro job', async () => {
    const data = {
      mode: 'send' as const,
      kind: 'target' as const,
      target: {
        campaignId: 'campaign-1',
        groupId: 'group-1',
        logicalGroupFingerprint: 'fingerprint-1',
        instanceName: 'instance-1',
        scheduledFor: '2026-08-24T12:00:00.000Z',
        slotKey: 'slot-1',
        scheduleRevision: 1,
        assignmentRevision: 2,
      },
    };
    const localJob = {
      id: 'commercial-target-slot-1',
      name: JOB_NAMES.commercialAutomationTarget,
      data,
    };
    const persistedJob = { ...localJob };
    const add = vi.fn().mockResolvedValue(localJob);
    const getJob = vi.fn().mockResolvedValue(persistedJob);

    const result = await enqueueCommercialAutomationTarget(
      { add, getJob } as never,
      data,
      'commercial-target-slot-1',
      30_000,
    );

    expect(result).toBe(persistedJob);
    expect(add).toHaveBeenCalledTimes(1);
    expect(getJob).toHaveBeenCalledTimes(1);
  });

  it('falha fechado quando o job persistido vencedor diverge do payload do chamador', async () => {
    const callerData = {
      mode: 'send' as const,
      kind: 'target' as const,
      target: {
        campaignId: 'campaign-caller',
        groupId: 'group-1',
        logicalGroupFingerprint: 'fingerprint-1',
        instanceName: 'instance-1',
        scheduledFor: '2026-08-24T12:00:00.000Z',
        slotKey: 'slot-1',
        scheduleRevision: 1,
      },
    };
    const winnerData = {
      ...callerData,
      target: { ...callerData.target, campaignId: 'campaign-winner' },
    };
    const localJob = {
      id: 'commercial-target-slot-1',
      name: JOB_NAMES.commercialAutomationTarget,
      data: callerData,
    };
    const persistedWinner = {
      id: 'commercial-target-slot-1',
      name: JOB_NAMES.commercialAutomationTarget,
      data: winnerData,
    };
    const calls: string[] = [];
    const add = vi.fn().mockImplementation(async () => {
      calls.push('add');
      return localJob;
    });
    const getJob = vi.fn().mockImplementation(async () => {
      calls.push('getJob');
      return persistedWinner;
    });

    await expect(
      enqueueCommercialAutomationTarget(
        { add, getJob } as never,
        callerData,
        'commercial-target-slot-1',
        30_000,
      ),
    ).rejects.toMatchObject({
        code: 'COMMERCIAL_AUTOMATION_TARGET_JOB_ID_PAYLOAD_CONFLICT',
    });
    expect(add).toHaveBeenCalledTimes(1);
    expect(getJob).toHaveBeenCalledWith('commercial-target-slot-1');
    expect(calls).toEqual(['add', 'getJob']);
  });

  it('mantém o vencedor concorrente e rejeita o payload divergente com o mesmo jobId', async () => {
    const winningData = {
      mode: 'send' as const,
      kind: 'target' as const,
      target: {
        campaignId: 'campaign-winner',
        groupId: 'group-1',
        logicalGroupFingerprint: 'fingerprint-1',
        instanceName: 'instance-1',
        scheduledFor: '2026-08-24T12:00:00.000Z',
        slotKey: 'slot-1',
        scheduleRevision: 1,
      },
    };
    const losingData = {
      ...winningData,
      target: { ...winningData.target, campaignId: 'campaign-loser' },
    };
    const winner = {
      id: 'commercial-target-slot-1',
      name: JOB_NAMES.commercialAutomationTarget,
      data: winningData,
    };
    const calls: string[] = [];
    const add = vi.fn().mockImplementation(
      async (
        _name: string,
        data: typeof winningData | typeof losingData,
      ) => {
        calls.push(`add:${data.target.campaignId}`);
        return {
          id: 'commercial-target-slot-1',
          name: JOB_NAMES.commercialAutomationTarget,
          data,
        };
      },
    );
    const getJob = vi.fn().mockImplementation(async () => {
      calls.push('getJob');
      return winner;
    });
    const queue = { add, getJob } as never;

    const results = await Promise.allSettled([
      enqueueCommercialAutomationTarget(
        queue,
        winningData,
        'commercial-target-slot-1',
        30_000,
      ),
      enqueueCommercialAutomationTarget(
        queue,
        losingData,
        'commercial-target-slot-1',
        30_000,
      ),
    ]);

    expect(results[0]).toMatchObject({ status: 'fulfilled', value: winner });
    expect(results[1]).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({
        code: 'COMMERCIAL_AUTOMATION_TARGET_JOB_ID_PAYLOAD_CONFLICT',
      }),
    });
    expect(add).toHaveBeenCalledTimes(2);
    expect(getJob).toHaveBeenCalledTimes(2);
    expect(calls.slice(0, 2)).toEqual([
      'add:campaign-winner',
      'add:campaign-loser',
    ]);
  });

  it('valida payload e identidade do refill persistido', async () => {
    const data = { mode: 'send' as const, provider: 'official' as const };
    const persistedJob = {
      id: 'commercial-inventory-refill-tick-1',
      name: JOB_NAMES.commercialInventoryRefill,
      data,
    };
    const add = vi.fn().mockResolvedValue(persistedJob);
    const getJob = vi.fn().mockResolvedValue(persistedJob);

    await expect(
      enqueueCommercialInventoryRefill(
        { add, getJob } as never,
        data,
        persistedJob.id,
      ),
    ).resolves.toBe(persistedJob);
    expect(add).toHaveBeenCalledWith(
      JOB_NAMES.commercialInventoryRefill,
      data,
      expect.objectContaining({ jobId: persistedJob.id }),
    );
  });

  it('rejeita payload divergente do refill que venceu pelo mesmo jobId', async () => {
    const data = { mode: 'send' as const, provider: 'official' as const };
    const persistedJob = {
      id: 'commercial-inventory-refill-tick-1',
      name: JOB_NAMES.commercialInventoryRefill,
      data: { mode: 'preview' as const, provider: 'official' as const },
    };

    await expect(
      enqueueCommercialInventoryRefill(
        {
          add: vi.fn().mockResolvedValue(persistedJob),
          getJob: vi.fn().mockResolvedValue(persistedJob),
        } as never,
        data,
        persistedJob.id,
      ),
    ).rejects.toMatchObject({
      code: 'COMMERCIAL_INVENTORY_REFILL_JOB_PAYLOAD_CONFLICT',
    });
  });
});
