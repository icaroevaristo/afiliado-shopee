import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app';

const apps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

const dashboardProxyRoutes = [
  ['GET', '/health'],
  ['GET', '/analytics'],
  ['GET', '/scheduler'],
  ['GET', '/commercial-automation/status'],
  ['GET', '/commercial-automation/scheduler'],
  ['GET', '/commercial-automation/settings'],
  ['GET', '/commercial-automation/schedule/preview'],
  ['GET', '/commercial-automation/executions'],
  ['GET', '/commercial-automation/outbox'],
  ['GET', '/commercial/campaigns'],
  ['GET', '/commercial/campaigns/:id/queue'],
  ['GET', '/commercial/niches'],
  ['GET', '/commercial-pipeline/runs'],
  ['GET', '/coupons'],
  ['GET', '/pipeline/jobs/:id'],
  ['GET', '/shopee/offers'],
  ['GET', '/shopee/offers/categories'],
  ['GET', '/shopee/offers/:id'],
  ['GET', '/whatsapp/destinations'],
  ['GET', '/whatsapp/dispatches'],
  ['GET', '/whatsapp/dispatches/:id'],
  ['GET', '/whatsapp/groups'],
  ['GET', '/whatsapp/instances'],
  ['GET', '/operational-admin'],
  ['GET', '/commercial-publications/manual/options'],
  ['GET', '/commercial-publications/manual/:id'],
  ['PATCH', '/commercial-automation/settings'],
  ['PATCH', '/commercial-automation/settings/schedule'],
  ['PATCH', '/commercial-automation/settings/admin'],
  ['PATCH', '/commercial/campaigns/:id'],
  ['PATCH', '/commercial/niches/:id'],
  ['PATCH', '/whatsapp/groups/:id/admin'],
  ['PATCH', '/whatsapp/instances/:name'],
  ['POST', '/commercial-publications/manual'],
  ['POST', '/shopee/offers/:id/copy-preview'],
  ['POST', '/whatsapp/instances'],
  ['POST', '/commercial/campaigns'],
  ['POST', '/commercial/campaigns/:id/activate'],
  ['POST', '/commercial/campaigns/:id/deactivate'],
  ['POST', '/commercial/niches'],
  ['POST', '/commercial/niches/preview'],
] as const;

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('dashboard proxy API route contract', () => {
  it('registers every method and path used by the dashboard allowlist', async () => {
    const app = await buildApp({
      logger: false,
      localApiAuthToken: 'dashboard-proxy-route-contract-token',
    });
    apps.push(app);

    for (const [method, url] of dashboardProxyRoutes) {
      expect(app.hasRoute({ method, url })).toBe(true);
    }
  });
});
