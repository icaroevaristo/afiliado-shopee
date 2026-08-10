import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getCommercialAutomationSchedulerStatus,
  listCommercialAutomationExecutions,
  listCommercialDispatchOutbox,
  getCommercialAutomationStatus,
  pauseCommercialAutomation,
  resumeCommercialAutomation,
} from './commercial-automation';

const response = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(() => Promise.resolve(response({ allowed: false }))),
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
    await resumeCommercialAutomation('RETOMAR_AUTOMACAO_COMERCIAL');

    expect(fetch).toHaveBeenCalledWith(
      '/api/commercial-automation/settings',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          paused: false,
          confirmation: 'RETOMAR_AUTOMACAO_COMERCIAL',
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
});
