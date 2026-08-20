import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildAuthenticatedTestApp } from './authenticated-test-app';

const apps: Array<Awaited<ReturnType<typeof buildAuthenticatedTestApp>>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('commercial lifecycle route', () => {
  it('consulta lifecycle agregado por GET e nao cria superficie de escrita', async () => {
    const list = vi.fn().mockResolvedValue({
      items: [],
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 1,
      summary: {
        activeExecutions: 0,
        sentToday: 0,
        failed: 0,
        ambiguous: 0,
        investigationRequired: 0,
        activeReservations: 0,
        pendingDispatches: 0,
        pendingOutboxes: 0,
        manualRecoveries: 0,
        jobs: null,
      },
    });
    const app = await buildAuthenticatedTestApp({
      logger: false,
      prisma: {} as never,
      commercialLifecycleService: { list },
    });
    apps.push(app);

    const response = await app.inject({
      method: 'GET',
      url: '/commercial-automation/lifecycles?page=1&limit=20',
    });

    expect(response.statusCode).toBe(200);
    expect(list).toHaveBeenCalledWith({ page: 1, limit: 20 });
    expect(JSON.stringify(response.json())).not.toMatch(
      /secret|authorization|apikey/iu,
    );

    const writeResponse = await app.inject({
      method: 'POST',
      url: '/commercial-automation/lifecycles',
      payload: {},
    });
    expect(writeResponse.statusCode).toBe(404);
    expect(list).toHaveBeenCalledOnce();
  });
});
