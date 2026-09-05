import { describe, expect, it, vi } from 'vitest';

import { CommercialAutomationSchedulerStatusService } from '../src/commercial-automation-scheduler-status-service';

describe('CommercialAutomationSchedulerStatusService', () => {
  it('expoe a agenda registrada quando ela diverge da configuracao atual', async () => {
    const getState = vi.fn(async () => ({
      jobId: 'scheduled-commercial-automation',
      status: 'registered' as const,
      cronExpression: '30 10 * * *',
      timezone: 'UTC',
      mode: 'send' as const,
      nextRunAt: '2026-07-27T10:30:00.000Z',
    }));
    const service = new CommercialAutomationSchedulerStatusService(
      { getState },
      {
        enabled: true,
        cron: '0 9 * * *',
        timezone: 'America/Sao_Paulo',
        mode: 'preview',
      },
    );

    await expect(service.getStatus()).resolves.toMatchObject({
      status: 'registered',
      cron: '* * * * *',
      timezone: 'UTC',
      mode: 'send',
    });
  });
});
