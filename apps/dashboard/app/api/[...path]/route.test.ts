import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DELETE,
  GET,
  PATCH,
  POST,
  PUT,
} from './route';
import {
  DASHBOARD_PROXY_CONTRACTS,
  isDashboardProxyPathAllowed,
} from './proxy-allowlist';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('dashboard API proxy', () => {
  it('mantém um contrato exato para todas as ações atualmente usadas pela UI', () => {
    for (const { method, pattern } of DASHBOARD_PROXY_CONTRACTS) {
      const path = pattern.map((segment, index) => segment === '*' ? `value-${index}` : segment);
      expect(isDashboardProxyPathAllowed(method, path)).toBe(true);
    }
  });

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
      new Request('http://dashboard.local/api/health?limit=1'),
      { params: Promise.resolve({ path: ['health'] }) },
    );

    expect(response.status).toBe(200);
    expect(await response.clone().json()).toEqual({ status: 'ok' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3334/health?limit=1',
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

  it('allowlista o fluxo de nichos e de campanhas pelo proxy autenticado', async () => {
    vi.stubEnv('DASHBOARD_API_URL', 'http://127.0.0.1:3334');
    vi.stubEnv('LOCAL_API_AUTH_TOKEN', 'proxy-test-token');
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ status: 'ok', service: 'api' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const requests = [
      GET(
        new Request('http://dashboard.local/api/commercial/niches'),
        { params: Promise.resolve({ path: ['commercial', 'niches'] }) },
      ),
      POST(
        new Request('http://dashboard.local/api/commercial/niches', {
          method: 'POST',
          body: '{}',
        }),
        { params: Promise.resolve({ path: ['commercial', 'niches'] }) },
      ),
      POST(
        new Request('http://dashboard.local/api/commercial/niches/preview', {
          method: 'POST',
          body: '{}',
        }),
        {
          params: Promise.resolve({
            path: ['commercial', 'niches', 'preview'],
          }),
        },
      ),
      PATCH(
        new Request('http://dashboard.local/api/commercial/niches/niche-1', {
          method: 'PATCH',
          body: '{}',
        }),
        {
          params: Promise.resolve({
            path: ['commercial', 'niches', 'niche-1'],
          }),
        },
      ),
      POST(
        new Request('http://dashboard.local/api/commercial/campaigns', {
          method: 'POST',
          body: '{}',
        }),
        { params: Promise.resolve({ path: ['commercial', 'campaigns'] }) },
      ),
      POST(
        new Request(
          'http://dashboard.local/api/commercial/campaigns/campaign-1/activate',
          { method: 'POST', body: '{}' },
        ),
        {
          params: Promise.resolve({
            path: ['commercial', 'campaigns', 'campaign-1', 'activate'],
          }),
        },
      ),
      POST(
        new Request(
          'http://dashboard.local/api/commercial/campaigns/campaign-1/deactivate',
          { method: 'POST', body: '{}' },
        ),
        {
          params: Promise.resolve({
            path: ['commercial', 'campaigns', 'campaign-1', 'deactivate'],
          }),
        },
      ),
    ];
    const responses = await Promise.all(requests);

    expect(responses.every((response) => response.status === 200)).toBe(true);
    const upstreamUrls = (fetchMock.mock.calls as unknown[][]).map((call) =>
      String(call[0]),
    );
    expect(upstreamUrls).toEqual(
      expect.arrayContaining([
        'http://127.0.0.1:3334/commercial/niches',
        'http://127.0.0.1:3334/commercial/niches/preview',
        'http://127.0.0.1:3334/commercial/niches/niche-1',
        'http://127.0.0.1:3334/commercial/campaigns',
        'http://127.0.0.1:3334/commercial/campaigns/campaign-1/activate',
        'http://127.0.0.1:3334/commercial/campaigns/campaign-1/deactivate',
      ]),
    );
  });

  it('permite somente os caminhos de automacao explicitamente autorizados', async () => {
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
      new Request('http://dashboard.local/api/commercial-automation/settings/admin', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ staggerMinutes: 5 }),
      }),
      { params: Promise.resolve({ path: ['commercial-automation', 'settings', 'admin'] }) },
    );

    expect(response.status).toBe(200);
    expect(fetchMock.mock.calls[3][0]).toBe(
      'http://127.0.0.1:3334/commercial-automation/settings/admin',
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
      new Request('http://dashboard.local/api/health', { method: 'PUT' }),
      { params: Promise.resolve({ path: ['health'] }) },
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

  it.each([
    ['segmento extra', 'GET', ['commercial', 'campaigns', 'campaign-1', 'mine']],
    ['segmento ausente', 'GET', ['commercial', 'campaigns', 'campaign-1', 'queue', 'extra']],
    ['traversal pontual', 'PATCH', ['commercial', 'campaigns', '..']],
    ['traversal com barra invertida', 'PATCH', ['commercial', 'campaigns', '..\\settings']],
  ] as const)('bloqueia %s sem chamar o upstream', async (_label, method, path) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const handler = method === 'GET' ? GET : PATCH;
    const response = await handler(
      new Request(`http://dashboard.local/api/${path.join('/')}`, {
        method,
        body: method === 'PATCH' ? '{}' : undefined,
      }),
      { params: Promise.resolve({ path: [...path] }) },
    );

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserva a codificação de um identificador permitido sem aceitar traversal', async () => {
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
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await PATCH(
      new Request('http://dashboard.local/api/whatsapp/instances/worker%2Fone', {
        method: 'PATCH',
        body: '{}',
      }),
      {
        params: Promise.resolve({
          path: ['whatsapp', 'instances', 'worker/one'],
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(fetchMock.mock.calls[1][0]).toBe(
      'http://127.0.0.1:3334/whatsapp/instances/worker%2Fone',
    );
  });

  it('descarta credenciais do browser e encaminha somente os headers necessários', async () => {
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
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(
      new Request('http://dashboard.local/api/commercial-automation/status', {
        headers: {
          accept: 'application/json',
          authorization: 'Bearer browser-token',
          cookie: 'dashboard-session=browser-controlled',
          'x-untrusted-header': 'discard-me',
        },
      }),
      { params: Promise.resolve({ path: ['commercial-automation', 'status'] }) },
    );

    expect(response.status).toBe(200);
    const headers = fetchMock.mock.calls[1][1].headers;
    expect(headers.get('authorization')).toBe('Bearer proxy-test-token');
    expect(headers.get('cookie')).toBeNull();
    expect(headers.get('x-untrusted-header')).toBeNull();
    expect(await response.text()).not.toContain('proxy-test-token');
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
      new Request('http://dashboard.local/api/health'),
      { params: Promise.resolve({ path: ['health'] }) },
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
      new Request('http://dashboard.local/api/health'),
      { params: Promise.resolve({ path: ['health'] }) },
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: 'DASHBOARD_API_TARGET_INVALID',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    'ftp://127.0.0.1:3334',
    'http://api.example.invalid',
    'http://proxy-user:proxy-password@127.0.0.1:3334',
  ])('rejeita destinos upstream inválidos sem chamar o upstream: %s', async (target) => {
    vi.stubEnv('DASHBOARD_API_URL', target);
    vi.stubEnv('LOCAL_API_AUTH_TOKEN', 'proxy-test-token');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(
      new Request('http://dashboard.local/api/health'),
      { params: Promise.resolve({ path: ['health'] }) },
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
      new Request('http://dashboard.local/api/health'),
      { params: Promise.resolve({ path: ['health'] }) },
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

  it('falha fechada sem reenviar mutações quando o upstream fica indisponível', async () => {
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
      .mockRejectedValueOnce(new TypeError('connection refused'));
    vi.stubGlobal('fetch', fetchMock);

    const response = await PATCH(
      new Request('http://dashboard.local/api/commercial-automation/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ paused: true }),
      }),
      { params: Promise.resolve({ path: ['commercial-automation', 'settings'] }) },
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: 'DASHBOARD_API_UPSTREAM_UNAVAILABLE',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
