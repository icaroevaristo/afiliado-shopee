import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app';
import { buildAuthenticatedTestApp } from './authenticated-test-app';

const token = 'local-api-test-token';
const apps: Array<Awaited<ReturnType<typeof buildApp>>> = [];
const analyticsSnapshot = {
  totalProducts: 0,
  totalApprovedProducts: 0,
  totalGeneratedCopies: 0,
  totalQueuedDispatches: 0,
  totalSentDispatches: 0,
  totalFailedDispatches: 0,
  totalActiveDestinations: 0,
};

const setup = async () => {
  const analytics = vi.fn().mockResolvedValue(analyticsSnapshot);
  const confirm = vi.fn().mockResolvedValue({ status: 'queued' });
  const app = await buildApp({
    logger: false,
    localApiAuthToken: token,
    analyticsService: { getSnapshot: analytics },
    commercialPipelineConfirmationService: { confirm },
  });
  apps.push(app);
  return { app, analytics, confirm };
};

const authorization = `Bearer ${token}`;

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('local API authentication and CORS', () => {
  it('keeps GET /health public and minimal', async () => {
    const { app } = await setup();

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', service: 'api' });
  });

  it('fails closed when the API token is unavailable', async () => {
    const app = await buildApp({
      logger: false,
      analyticsService: {
        getSnapshot: vi.fn().mockResolvedValue(analyticsSnapshot),
      },
    });
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/analytics' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      error: 'LOCAL_API_AUTH_NOT_CONFIGURED',
    });
  });

  it('rejects an absent token explicitly', async () => {
    const { app, analytics } = await setup();

    const response = await app.inject({ method: 'GET', url: '/analytics' });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: 'LOCAL_API_AUTH_REQUIRED',
    });
    expect(analytics).not.toHaveBeenCalled();
  });

  it('rejects invalid and malformed Bearer credentials', async () => {
    const { app, analytics } = await setup();

    for (const authorizationHeader of [
      'Bearer wrong-token',
      `bearer ${token}`,
      `Bearer  ${token}`,
      `Bearer ${token} extra`,
    ]) {
      const response = await app.inject({
        method: 'GET',
        url: '/analytics',
        headers: { authorization: authorizationHeader },
      });
      expect(response.statusCode).toBe(401);
    }

    expect(analytics).not.toHaveBeenCalled();
  });

  it('uses the authenticated test fixture through the same Bearer guard', async () => {
    const analytics = vi.fn().mockResolvedValue(analyticsSnapshot);
    const app = await buildAuthenticatedTestApp({
      logger: false,
      analyticsService: { getSnapshot: analytics },
    });
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/analytics' });

    expect(response.statusCode).toBe(200);
    expect(analytics).toHaveBeenCalledOnce();
  });

  it('allows a valid token without an Origin header', async () => {
    const { app, analytics } = await setup();

    const response = await app.inject({
      method: 'GET',
      url: '/analytics',
      headers: { authorization },
    });

    expect(response.statusCode).toBe(200);
    expect(analytics).toHaveBeenCalledOnce();
  });

  it('rejects a commercial confirmation phrase without authentication', async () => {
    const { app, confirm } = await setup();

    const response = await app.inject({
      method: 'POST',
      url: '/commercial-pipeline/runs/run-1/confirm',
      payload: { confirmation: 'CONFIRMAR_ENVIO_COMERCIAL' },
    });

    expect(response.statusCode).toBe(401);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('allows the fixed dashboard origin with a valid token', async () => {
    const { app, analytics } = await setup();

    const response = await app.inject({
      method: 'GET',
      url: '/analytics',
      headers: {
        authorization,
        origin: 'http://127.0.0.1:3000',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe(
      'http://127.0.0.1:3000',
    );
    expect(analytics).toHaveBeenCalledOnce();
  });

  it('rejects arbitrary origins before protected handlers', async () => {
    const { app, analytics } = await setup();

    const response = await app.inject({
      method: 'GET',
      url: '/analytics',
      headers: {
        authorization,
        origin: 'https://example.invalid',
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(analytics).not.toHaveBeenCalled();
  });

  it('answers preflight only for the fixed dashboard origin', async () => {
    const { app, analytics } = await setup();

    const allowed = await app.inject({
      method: 'OPTIONS',
      url: '/analytics',
      headers: {
        origin: 'http://127.0.0.1:3000',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization',
      },
    });
    const blocked = await app.inject({
      method: 'OPTIONS',
      url: '/analytics',
      headers: {
        origin: 'https://example.invalid',
        'access-control-request-method': 'GET',
      },
    });

    expect(allowed.statusCode).toBe(204);
    expect(allowed.headers['access-control-allow-origin']).toBe(
      'http://127.0.0.1:3000',
    );
    expect(allowed.headers['access-control-allow-headers']).toBe(
      'authorization, content-type',
    );
    expect(blocked.statusCode).toBe(403);
    expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
    expect(analytics).not.toHaveBeenCalled();
  });
});
