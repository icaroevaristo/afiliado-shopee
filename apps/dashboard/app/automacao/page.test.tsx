import React, { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '../../test/render';
import AutomationPage from './page';

const getStatusMock = vi.fn();
const getSchedulerMock = vi.fn();
const getScheduleMock = vi.fn();
const getPreviewMock = vi.fn();
const getOperationalAdminMock = vi.fn();
const pauseMock = vi.fn();
const resumeMock = vi.fn();

vi.mock('../../lib/api', () => ({
  getCommercialAutomationStatus: (...args: unknown[]) => getStatusMock(...args),
  getCommercialAutomationSchedulerStatus: (...args: unknown[]) =>
    getSchedulerMock(...args),
  getCommercialAutomationScheduleSettings: (...args: unknown[]) =>
    getScheduleMock(...args),
  getCommercialAutomationSchedulePreview: (...args: unknown[]) =>
    getPreviewMock(...args),
  getOperationalAdmin: (...args: unknown[]) => getOperationalAdminMock(...args),
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

const schedule = {
  timezone: 'America/Sao_Paulo',
  allowedStartTime: '08:00',
  allowedEndTime: '23:00',
  minimumIntervalMinutes: 14,
  staggerMinutes: 5,
  scheduleRevision: 0,
};

beforeEach(() => {
  getStatusMock.mockReset().mockResolvedValue(status);
  getSchedulerMock.mockReset().mockResolvedValue(scheduler);
  getScheduleMock.mockReset().mockResolvedValue(schedule);
  getPreviewMock.mockReset().mockResolvedValue({
    scheduleRevision: 0,
    plannedSlots: 1,
    skippedTargets: [],
    nextSlot: {
      slotKey: 'slot-1',
      jobId: 'commercial-target-slot-1',
      scheduledFor: '2026-08-10T12:15:00.000Z',
      campaignId: 'campaign-1',
      groupId: 'group-1',
      logicalGroupFingerprint: 'fingerprint-1',
      instanceName: 'affiliate-bot',
    },
  });
  getOperationalAdminMock.mockReset().mockResolvedValue({
    generatedAt: '2026-08-10T12:00:00.000Z',
    automation: {
      paused: false,
      allowedStartTime: '08:00',
      allowedEndTime: '23:00',
      timezone: 'America/Sao_Paulo',
      minimumIntervalMinutes: 14,
      staggerMinutes: 5,
      dailyGlobalLimit: 60,
      dailyGroupLimit: 60,
      dailyGlobalLimitOverride: 60,
      dailyGroupLimitOverride: 60,
      hardCaps: {
        dailyGlobalLimit: 60,
        dailyGroupLimit: 60,
        maxMessagesPerRun: 1,
      },
      scheduleRevision: 0,
      updatedAt: '2026-08-10T12:00:00.000Z',
    },
    nextSendAt: '2026-08-10T12:15:00.000Z',
    lastSendAt: '2026-08-10T12:00:00.000Z',
    blockers: [],
    queues: {
      productPipeline: { waiting: 0, active: 0, delayed: 0, prioritized: 0 },
      whatsappDispatch: { waiting: 0, active: 0, delayed: 0, prioritized: 0 },
      commercialAutomation: {
        waiting: 0,
        active: 0,
        delayed: 0,
        prioritized: 0,
      },
    },
    activeExecutions: 0,
    activeReservations: 0,
    ambiguity: 0,
    investigationRequired: 0,
    pendingDispatches: 0,
    pendingOutboxes: 0,
    scheduler,
    instances: [],
    groups: [],
  });
  pauseMock.mockReset();
  resumeMock.mockReset();
});

describe('AutomationPage', () => {
  it('separa estado operacional de readiness entre ticks', async () => {
    const screen = await render(<AutomationPage />);
    await act(async () => undefined);

    expect(screen.container.textContent).toContain('Status operacional');
    expect(screen.container.textContent).toContain('AUTOMAÇÃO LIGADA');
    expect(screen.container.textContent).toContain('Desligar automação');
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

  it('mostra automação desligada quando a pausa persistida está ativa', async () => {
    getStatusMock.mockResolvedValueOnce({ ...status, paused: true });

    const screen = await render(<AutomationPage />);
    await act(async () => undefined);

    expect(screen.container.textContent).toContain('AUTOMAÇÃO DESLIGADA');
    expect(screen.container.textContent).toContain('Ligar automação');
    await screen.unmount();
  });
});
