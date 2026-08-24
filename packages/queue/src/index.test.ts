import { describe, expect, it, vi } from 'vitest';

import {
  COMMERCIAL_AUTOMATION_JOB_OPTIONS,
  enqueueCommercialAutomationTarget,
  JOB_NAMES,
} from './index';

describe('commercial target queue contract', () => {
  it('usa jobId, delay e payload target determinísticos', async () => {
    const add = vi.fn().mockResolvedValue({ id: 'commercial-target-slot-1' });
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

    await enqueueCommercialAutomationTarget(
      { add } as never,
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
  });
});
