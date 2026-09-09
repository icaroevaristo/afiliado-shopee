import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app';

const apps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

type DashboardProxyContract = {
  method: string;
  pattern: readonly string[];
};

const isDashboardProxyContract = (value: unknown): value is DashboardProxyContract =>
  typeof value === 'object' &&
  value !== null &&
  'method' in value &&
  'pattern' in value &&
  typeof value.method === 'string' &&
  Array.isArray(value.pattern) &&
  value.pattern.every((segment) => typeof segment === 'string');

const loadDashboardProxyContracts = async () => {
  const moduleUrl = pathToFileURL(
    resolve(process.cwd(), '../../packages/shared/dist/index.js'),
  ).href;
  const loaded: unknown = await import(moduleUrl);
  if (
    typeof loaded !== 'object' ||
    loaded === null ||
    !('DASHBOARD_PROXY_CONTRACTS' in loaded) ||
    !Array.isArray(loaded.DASHBOARD_PROXY_CONTRACTS) ||
    !loaded.DASHBOARD_PROXY_CONTRACTS.every(isDashboardProxyContract)
  ) {
    throw new Error('DASHBOARD_PROXY_CONTRACTS is unavailable from the shared build');
  }
  return loaded.DASHBOARD_PROXY_CONTRACTS;
};

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

    for (const { method, pattern } of await loadDashboardProxyContracts()) {
      expect(app.hasRoute({ method, url: apiRouteForPattern(pattern) })).toBe(true);
    }
  });
});
