import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DASHBOARD_PROXY_CONTRACTS,
  DASHBOARD_UI_CALLOUTS,
  isDashboardProxyPathAllowed,
} from './proxy-allowlist';

const contractKey = (method: string, pattern: readonly string[]) =>
  `${method} /${pattern.join('/')}`;

const sourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(join(directory, entry.name))
      : entry.name.endsWith('.tsx') ? [join(directory, entry.name)] : [],
  );

const importedApiCalls = (source: string) => {
  const imports = source.matchAll(
    /import\s*{([^}]*)}\s*from\s*['"][^'"]*lib\/api['"]/g,
  );
  const names = new Set<string>();
  for (const match of imports) {
    for (const raw of match[1].split(',')) {
      const name = raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0];
      if (name === 'getApiBaseUrl') continue;
      if (name && new RegExp(`\\b${name}\\s*\\(`).test(source)) names.add(name);
    }
  }
  return names;
};

describe('dashboard proxy callout inventory', () => {
  it('binds every allowlisted route to an invoked dashboard API helper', () => {
    const proxyKeys = new Set(
      DASHBOARD_PROXY_CONTRACTS.map(({ method, pattern }) => contractKey(method, pattern)),
    );
    const calloutKeys = new Set(
      DASHBOARD_UI_CALLOUTS.map(({ method, pattern }) => contractKey(method, pattern)),
    );

    expect([...proxyKeys].sort()).toEqual([...calloutKeys].sort());

    for (const callout of DASHBOARD_UI_CALLOUTS) {
      for (const callsite of callout.callsites) {
        const source = readFileSync(resolve(process.cwd(), callsite), 'utf8');
        for (const fn of callout.functions) {
          if (!source.includes(fn)) continue;
          expect(source.match(new RegExp(`\\b${fn}\\s*\\(`))?.length ?? 0).toBeGreaterThan(0);
        }
      }
    }

    const inventoryFunctions = new Set(
      DASHBOARD_UI_CALLOUTS.flatMap((callout) => callout.functions),
    );
    for (const directory of ['app', 'components']) {
      for (const file of sourceFiles(resolve(process.cwd(), directory))) {
        const source = readFileSync(file, 'utf8');
        for (const fn of importedApiCalls(source)) {
          expect(inventoryFunctions.has(fn), `${file} imports ${fn} without a proxy contract`).toBe(true);
        }
      }
    }
  });

  it('permits only the declared method and exact path shape', () => {
    for (const { method, pattern } of DASHBOARD_PROXY_CONTRACTS) {
      const representative = pattern.map((segment, index) => segment === '*' ? `value-${index}` : segment);
      expect(isDashboardProxyPathAllowed(method, representative)).toBe(true);
      expect(isDashboardProxyPathAllowed('PUT', representative)).toBe(false);
      expect(isDashboardProxyPathAllowed('DELETE', representative)).toBe(false);
    }
  });

  it('rejects a path with a required segment omitted', () => {
    expect(isDashboardProxyPathAllowed('POST', ['commercial', 'campaigns', 'activate'])).toBe(false);
    expect(isDashboardProxyPathAllowed('POST', ['shopee', 'offers', 'copy-preview'])).toBe(false);
    expect(isDashboardProxyPathAllowed('PATCH', ['whatsapp', 'groups', 'admin'])).toBe(false);
  });

  it('rejects encoded traversal and malformed path segments', () => {
    expect(isDashboardProxyPathAllowed('GET', ['shopee', 'offers', '..'])).toBe(false);
    expect(isDashboardProxyPathAllowed('GET', ['shopee', 'offers', 'a\\b'])).toBe(false);
    expect(isDashboardProxyPathAllowed('GET', ['shopee', 'offers', ''])).toBe(false);
  });
});
