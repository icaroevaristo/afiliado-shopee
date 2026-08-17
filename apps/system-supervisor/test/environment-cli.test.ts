import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseDotEnv } from '@shopee-auto-affiliate-ai/config';

import { loadLocalSystemEnvironment } from '../src/environment';
import { installOperationSignalCleanup, parseSystemArgs } from '../src/cli';
import { readState, runtimeDirectory, statePath } from '../src/state-store';

const directories: string[] = [];
const temporaryDirectory = () => {
  const directory = mkdtempSync(join(tmpdir(), 'local-system-env-'));
  directories.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('local system environment', () => {
  it('loads the ignored root env and lets process variables override it', () => {
    const root = temporaryDirectory();
    writeFileSync(
      join(root, '.env'),
      'COMMERCIAL_AUTOMATION_MODE=send\nPORT=3334\nSECRET_VALUE=file-only\n',
    );

    const loaded = loadLocalSystemEnvironment(root, {
      COMMERCIAL_AUTOMATION_MODE: 'preview',
      PORT: '4444',
    });

    expect(loaded.mode).toBe('preview');
    expect(loaded.ports.api).toBe(4444);
    expect(loaded.env.SECRET_VALUE).toBe('file-only');
  });

  it('loads runtime.env between .env and process variables', () => {
    const root = temporaryDirectory();
    writeFileSync(
      join(root, '.env'),
      'COMMERCIAL_AUTOMATION_MODE=send\nPORT=3334\nSOURCE_LAYER=env\n',
    );
    writeFileSync(
      join(root, 'runtime.env'),
      'COMMERCIAL_AUTOMATION_MODE=preview\nPORT=4444\nSOURCE_LAYER=runtime\n',
    );

    const runtimeOnly = loadLocalSystemEnvironment(root, {});
    expect(runtimeOnly.mode).toBe('preview');
    expect(runtimeOnly.ports.api).toBe(4444);
    expect(runtimeOnly.env.SOURCE_LAYER).toBe('runtime');

    const processOverride = loadLocalSystemEnvironment(root, {
      PORT: '5555',
      SOURCE_LAYER: 'process',
    });
    expect(processOverride.ports.api).toBe(5555);
    expect(processOverride.env.SOURCE_LAYER).toBe('process');
  });

  it('keeps runtime.env optional and rejects an invalid effective mode deterministically', () => {
    const root = temporaryDirectory();
    writeFileSync(join(root, '.env'), 'COMMERCIAL_AUTOMATION_MODE=preview\n');
    expect(loadLocalSystemEnvironment(root, {}).mode).toBe('preview');

    writeFileSync(join(root, 'runtime.env'), 'COMMERCIAL_AUTOMATION_MODE=invalid\n');
    expect(() => loadLocalSystemEnvironment(root, {})).toThrowError(
      expect.objectContaining({ code: 'SYSTEM_INVALID_AUTOMATION_MODE' }),
    );
  });
  it('parses quoted values and strips only unquoted comments', () => {
    expect(
      parseDotEnv('A="value # kept"\nB=value # ignored\nexport C=ok\n'),
    ).toEqual({ A: 'value # kept', B: 'value', C: 'ok' });
  });
});

describe('local system CLI arguments', () => {
  it('accepts only the documented status and log options', () => {
    expect(parseSystemArgs(['status', '--', '--json'])).toEqual({
      command: 'status',
      json: true,
    });
    expect(
      parseSystemArgs(['logs', '--', '--service=supervisor', '--lines=50']),
    ).toEqual({ command: 'logs', service: 'supervisor', lines: 50 });
  });

  it.each([
    ['logs', '--service=../../.env'],
    ['logs', '--lines=0'],
    ['logs', '--lines=1001'],
    ['logs', '--path=.env'],
    ['status', '--verbose'],
    ['start', '--send'],
  ])('rejects unsafe or undocumented arguments: %s', (...args) => {
    expect(() => parseSystemArgs(args)).toThrow();
  });
});

describe('local system controlled signals', () => {
  it.each([
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ] as const)('releases the lock before controlled %s exit', (signal, code) => {
    const handlers = new Map<string, () => void>();
    const release = vi.fn();
    const exit = vi.fn();
    const runtime = {
      once: vi.fn((event: string, handler: () => void) => {
        handlers.set(event, handler);
        return runtime;
      }),
      off: vi.fn((event: string) => {
        handlers.delete(event);
        return runtime;
      }),
      exit,
    };
    const remove = installOperationSignalCleanup(release, runtime as never);

    handlers.get(signal)?.();

    expect(release).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(code);
    remove();
  });
});

describe('local system state validation', () => {
  it('rejects PIDs, paths and extra fields outside the sanitized schema', () => {
    const root = temporaryDirectory();
    mkdirSync(runtimeDirectory(root), { recursive: true });
    writeFileSync(
      statePath(root),
      JSON.stringify({
        version: 1,
        startedAt: '2026-07-25T12:00:00.000Z',
        mode: 'preview',
        ports: {
          api: 3333,
          dashboard: 3000,
          postgres: 5432,
          redis: 6379,
          evolution: 8080,
        },
        processes: {
          api: {
            pid: '1; Stop-Process -Name node',
            startedAt: 'invalid',
            log: '../../.env',
          },
        },
        secret: 'must-not-be-accepted',
      }),
    );
    expect(() => readState(root)).toThrowError(
      expect.objectContaining({ code: 'SYSTEM_STATE_INVALID' }),
    );
  });
});
