import { afterEach, describe, expect, it, vi } from 'vitest';
import { DELETE, GET, PATCH, POST, PUT } from './route';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('dashboard API proxy', () => {
  it('encaminha leitura para o servidor privado sem expor credencial ao browser', async () => {
    vi.stubEnv('DASHBOARD_API_URL', 'http://127.0.0.1:3334');
    vi.stubEnv('LOCAL_API_AUTH_TOKEN', 'proxy-test-token');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'ok', service: 'api' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
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
    expect(await response.clone().json()).toEqual({ status: 'ok' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3334/analytics?limit=1',
      expect.objectContaining({ method: 'GET', cache: 'no-store' }),
    );
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty(
      'authorization',
    );
    expect(fetchMock.mock.calls[1][1].headers.get('authorization')).toBe(
      'Bearer proxy-test-token',
    );
    expect(await response.text()).not.toContain('proxy-test-token');
  });

  it('encaminha detalhe de oferta e preview de copy pela allowlist autenticada', async () => {
    vi.stubEnv('DASHBOARD_API_URL', 'http://127.0.0.1:3334');
    vi.stubEnv('LOCAL_API_AUTH_TOKEN', 'proxy-test-token');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'ok', service: 'api' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'offer-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'ok', service: 'api' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ title: 'preview' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const detail = await GET(
      new Request('http://dashboard.local/api/shopee/offers/offer-1?dispatchPage=1'),
      { params: Promise.resolve({ path: ['shopee', 'offers', 'offer-1'] }) },
    );
    const preview = await POST(
      new Request('http://dashboard.local/api/shopee/offers/offer-1/copy-preview', {
        method: 'POST',
      }),
      {
        params: Promise.resolve({
          path: ['shopee', 'offers', 'offer-1', 'copy-preview'],
        }),
      },
    );

    expect(detail.status).toBe(200);
    expect(preview.status).toBe(200);
    expect(fetchMock.mock.calls[1][0]).toBe(
      'http://127.0.0.1:3334/shopee/offers/offer-1?dispatchPage=1',
    );
    expect(fetchMock.mock.calls[3][0]).toBe(
      'http://127.0.0.1:3334/shopee/offers/offer-1/copy-preview',
    );
    expect(fetchMock.mock.calls[1][1].headers.get('authorization')).toBe(
      'Bearer proxy-test-token',
    );
    expect(fetchMock.mock.calls[3][1].headers.get('authorization')).toBe(
      'Bearer proxy-test-token',
    );
  });

  it('preserva PATCH oficial para pause/resume sem executar o controle', async () => {
    vi.stubEnv('DASHBOARD_API_URL', 'http://127.0.0.1:3334');
    vi.stubEnv('LOCAL_API_AUTH_TOKEN', 'proxy-test-token');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'ok', service: 'api' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
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
    expect(fetchMock.mock.calls[1][1].headers.get('authorization')).toBe(
      'Bearer proxy-test-token',
    );
  });

  it('encaminha a leitura paginada do outbox comercial pela allowlist autenticada', async () => {
    vi.stubEnv('DASHBOARD_API_URL', 'http://127.0.0.1:3334');
    vi.stubEnv('LOCAL_API_AUTH_TOKEN', 'proxy-test-token');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'ok', service: 'api' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [], page: 1, limit: 20 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(
      new Request(
        'http://dashboard.local/api/commercial-automation/outbox?page=1&limit=20',
      ),
      {
        params: Promise.resolve({
          path: ['commercial-automation', 'outbox'],
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(fetchMock.mock.calls[1][0]).toBe(
      'http://127.0.0.1:3334/commercial-automation/outbox?page=1&limit=20',
    );
    expect(fetchMock.mock.calls[1][1].headers.get('authorization')).toBe(
      'Bearer proxy-test-token',
    );
  });

  it('permite somente os caminhos de agenda explicitamente autorizados', async () => {
    vi.stubEnv('DASHBOARD_API_URL', 'http://127.0.0.1:3334');
    vi.stubEnv('LOCAL_API_AUTH_TOKEN', 'proxy-test-token');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'ok', service: 'api' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'ok', service: 'api' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await GET(
      new Request('http://dashboard.local/api/commercial-automation/settings'),
      { params: Promise.resolve({ path: ['commercial-automation', 'settings'] }) },
    );
    const response = await PATCH(
      new Request('http://dashboard.local/api/commercial-automation/settings/schedule', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ staggerMinutes: 5 }),
      }),
      { params: Promise.resolve({ path: ['commercial-automation', 'settings', 'schedule'] }) },
    );

    expect(response.status).toBe(200);
    expect(fetchMock.mock.calls[3][0]).toBe(
      'http://127.0.0.1:3334/commercial-automation/settings/schedule',
    );
  });

  it('bloqueia POST sem chamar o upstream', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(
      new Request('http://dashboard.local/api/pipeline/run', { method: 'POST' }),
      { params: Promise.resolve({ path: ['pipeline', 'run'] }) },
    );

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('encaminha somente o POST de publicacao manual autorizado', async () => {
    vi.stubEnv('DASHBOARD_API_URL', 'http://127.0.0.1:3334');
    vi.stubEnv('LOCAL_API_AUTH_TOKEN', 'proxy-test-token');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'ok', service: 'api' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'COMPLETED' }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(
      new Request('http://dashboard.local/api/commercial-publications/manual', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ productId: 'offer-1' }),
      }),
      { params: Promise.resolve({ path: ['commercial-publications', 'manual'] }) },
    );

    expect(response.status).toBe(201);
    expect(fetchMock.mock.calls[1][0]).toBe(
      'http://127.0.0.1:3334/commercial-publications/manual',
    );
    expect(fetchMock.mock.calls[1][1].headers.get('authorization')).toBe(
      'Bearer proxy-test-token',
    );
  });

  it('bloqueia PUT sem chamar o upstream', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await PUT(
      new Request('http://dashboard.local/api/analytics', { method: 'PUT' }),
      { params: Promise.resolve({ path: ['analytics'] }) },
    );

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('bloqueia DELETE sem chamar o upstream', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await DELETE(
      new Request('http://dashboard.local/api/coupons/coupon-1', {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ path: ['coupons', 'coupon-1'] }) },
    );

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('bloqueia GET desconhecido sem chamar o upstream', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(
      new Request('http://dashboard.local/api/not-allowed'),
      { params: Promise.resolve({ path: ['not-allowed'] }) },
    );

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('bloqueia PATCH fora de settings sem chamar o upstream', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await PATCH(
      new Request('http://dashboard.local/api/whatsapp/groups/group-1', {
        method: 'PATCH',
        body: JSON.stringify({ active: true }),
      }),
      { params: Promise.resolve({ path: ['whatsapp', 'groups', 'group-1'] }) },
    );

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falha fechada sem token local e nao chama o upstream', async () => {
    vi.stubEnv('DASHBOARD_API_URL', 'http://127.0.0.1:3334');
    vi.stubEnv('LOCAL_API_AUTH_TOKEN', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(
      new Request('http://dashboard.local/api/analytics'),
      { params: Promise.resolve({ path: ['analytics'] }) },
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: 'DASHBOARD_API_AUTH_NOT_CONFIGURED',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falha de forma clara quando o destino configurado nao e local', async () => {
    vi.stubEnv('DASHBOARD_API_URL', 'https://api.example.invalid');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(
      new Request('http://dashboard.local/api/analytics'),
      { params: Promise.resolve({ path: ['analytics'] }) },
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: 'DASHBOARD_API_TARGET_INVALID',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falha de forma segura quando um servico local nao e a API operacional', async () => {
    vi.stubEnv('DASHBOARD_API_URL', 'http://127.0.0.1:3333');
    vi.stubEnv('LOCAL_API_AUTH_TOKEN', 'proxy-test-token');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('<html>DevBridge</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(
      new Request('http://dashboard.local/api/analytics'),
      { params: Promise.resolve({ path: ['analytics'] }) },
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: 'DASHBOARD_API_TARGET_INCOMPATIBLE',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3333/health',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });
});
