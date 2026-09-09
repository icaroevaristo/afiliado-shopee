import { afterEach, describe, expect, it } from 'vitest';

import { DASHBOARD_PROXY_CONTRACTS } from '../../dashboard/app/api/[...path]/proxy-allowlist';
import { buildApp } from '../src/app';

const apps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

const apiRouteForPattern = (pattern: readonly string[]) =>
  `/${pattern.map((segment, index) => segment === '*' ? `:segment${index}` : segment).join('/')}`;

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('dashboard proxy API route contract', () => {
  it('registers the API route represented by every dashboard proxy contract', async () => {
    const app = await buildApp({
      logger: false,
      localApiAuthToken: 'dashboard-proxy-route-contract-token',
    });
    apps.push(app);

    for (const { method, pattern } of DASHBOARD_PROXY_CONTRACTS) {
      expect(app.hasRoute({ method, url: apiRouteForPattern(pattern) })).toBe(true);
    }
  });
});
