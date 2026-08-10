import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET, PATCH } from './route';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('dashboard API proxy', () => {
  it('encaminha leitura para o servidor privado sem expor credencial ao browser', async () => {
    vi.stubEnv('DASHBOARD_API_URL', 'http://127.0.0.1:3334');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(
      new Request('http://dashboard.local/api/analytics?limit=1'),
      { params: Promise.resolve({ path: ['analytics'] }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3334/analytics?limit=1',
      expect.objectContaining({ method: 'GET', cache: 'no-store' }),
    );
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty(
      'authorization',
    );
  });

  it('preserva PATCH oficial para pause/resume sem executar o controle', async () => {
    vi.stubEnv('DASHBOARD_API_URL', 'http://127.0.0.1:3334');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ paused: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await PATCH(
      new Request('http://dashboard.local/api/commercial-automation/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ paused: false }),
      }),
      { params: Promise.resolve({ path: ['commercial-automation', 'settings'] }) },
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3334/commercial-automation/settings',
      expect.objectContaining({ method: 'PATCH', body: expect.any(ArrayBuffer) }),
    );
  });
});
