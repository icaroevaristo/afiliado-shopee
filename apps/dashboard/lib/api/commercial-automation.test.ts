import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getCommercialAutomationSchedulerStatus,
  getCommercialAutomationScheduleSettings,
  getCommercialAutomationSchedulePreview,
  listCommercialAutomationExecutions,
  listCommercialDispatchOutbox,
  getCommercialAutomationStatus,
  pauseCommercialAutomation,
  resumeCommercialAutomation,
  updateCommercialAutomationScheduleSettings,
} from './commercial-automation';

const response = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockImplementation(() => Promise.resolve(response({ allowed: false }))),
  );
});

describe('commercial automation API', () => {
  it('consulta o status operacional', async () => {
    await getCommercialAutomationStatus();

    expect(fetch).toHaveBeenCalledWith(
      '/api/commercial-automation/status',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('envia somente paused ao pausar', async () => {
    await pauseCommercialAutomation();

    expect(fetch).toHaveBeenCalledWith(
      '/api/commercial-automation/settings',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ paused: true }),
      }),
    );
  });

  it('envia confirmacao explicita ao retomar', async () => {
    await resumeCommercialAutomation(
      'RETOMAR_AUTOMACAO_COMERCIAL',
      '2026-07-25T15:00:00.000Z',
    );

    expect(fetch).toHaveBeenCalledWith(
      '/api/commercial-automation/settings',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          paused: false,
          confirmation: 'RETOMAR_AUTOMACAO_COMERCIAL',
          expectedUpdatedAt: '2026-07-25T15:00:00.000Z',
        }),
      }),
    );
  });

  it('consulta scheduler, executions e outbox sem alterar dados', async () => {
    await getCommercialAutomationSchedulerStatus();
    await listCommercialAutomationExecutions(2, 10);
    await listCommercialDispatchOutbox(1, 5);

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      '/api/commercial-automation/scheduler',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/api/commercial-automation/executions?page=2&limit=10',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      '/api/commercial-automation/outbox?page=1&limit=5',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('consulta e atualiza agenda sem misturar com pause/resume', async () => {
    await getCommercialAutomationScheduleSettings();
    await updateCommercialAutomationScheduleSettings({
      minimumIntervalMinutes: 14,
      staggerMinutes: 5,
      expectedRevision: 0,
    });

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      '/api/commercial-automation/settings',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/api/commercial-automation/settings/schedule',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          minimumIntervalMinutes: 14,
          staggerMinutes: 5,
          expectedRevision: 0,
        }),
      }),
    );
  });

  it('consulta a proxima agenda sem criar jobs', async () => {
    await getCommercialAutomationSchedulePreview();
    expect(fetch).toHaveBeenCalledWith(
      '/api/commercial-automation/schedule/preview',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});
