import React, { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '../../test/render';
import AutomationPage from './page';

const getStatusMock = vi.fn();
const getSchedulerMock = vi.fn();
const pauseMock = vi.fn();
const resumeMock = vi.fn();

vi.mock('../../lib/api', () => ({
  getCommercialAutomationStatus: (...args: unknown[]) => getStatusMock(...args),
  getCommercialAutomationSchedulerStatus: (...args: unknown[]) =>
    getSchedulerMock(...args),
  pauseCommercialAutomation: (...args: unknown[]) => pauseMock(...args),
  resumeCommercialAutomation: (...args: unknown[]) => resumeMock(...args),
}));

const status = {
  enabled: true,
  allowed: false,
  reasons: ['MINIMUM_INTERVAL_NOT_REACHED'],
  nextAllowedAt: '2026-08-10T12:15:00.000Z',
  globalSentToday: 1,
  globalRemainingToday: 59,
  groupSentToday: 1,
  groupRemainingToday: 59,
  lastSentAt: '2026-08-10T12:00:00.000Z',
  paused: false,
  pausedAt: null,
  resumedAt: null,
  updatedAt: '2026-08-10T12:00:00.000Z',
  allowedStartTime: '08:00',
  allowedEndTime: '23:00',
  timezone: 'America/Sao_Paulo',
  dailyGlobalLimit: 60,
  dailyGroupLimit: 60,
  minimumIntervalMinutes: 14,
  authorizedGroupCount: 1,
};

const scheduler = {
  enabled: true,
  status: 'registered',
  jobId: 'scheduled-commercial-automation',
  queue: 'commercial-automation',
  jobName: 'commercial-automation-tick',
  cron: '*/15 8-22 * * *',
  timezone: 'America/Sao_Paulo',
  nextRunAt: '2026-08-10T12:15:00.000Z',
  mode: 'send',
};

beforeEach(() => {
  getStatusMock.mockReset().mockResolvedValue(status);
  getSchedulerMock.mockReset().mockResolvedValue(scheduler);
  pauseMock.mockReset();
  resumeMock.mockReset();
});

describe('AutomationPage', () => {
  it('separa estado operacional de readiness entre ticks', async () => {
    const screen = await render(<AutomationPage />);
    await act(async () => undefined);

    expect(screen.container.textContent).toContain('Status operacional');
    expect(screen.container.textContent).toContain('OPERANDO');
    expect(screen.container.textContent).toContain('Readiness para envio');
    expect(screen.container.textContent).toContain('AGUARDANDO CADÊNCIA');
    expect(screen.container.textContent).toContain(
      'MINIMUM_INTERVAL_NOT_REACHED',
    );
    expect(screen.container.textContent).not.toContain('BLOQUEADA');
    expect(pauseMock).not.toHaveBeenCalled();
    expect(resumeMock).not.toHaveBeenCalled();
    await screen.unmount();
  });
});
