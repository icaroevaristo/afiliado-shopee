import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  acquireLock,
  ensureRuntimeDirectory,
  inspectOperationLock,
  operationLockPath,
  SUPERVISOR_PROCESS_MARKER,
  type OperationLockRecord,
} from '../src/state-store';
import { createSystemDependencies } from '../src/system-dependencies';
import type { ProcessIdentityInspection } from '../src/types';

const STARTED_AT = '2026-07-28T12:00:00.000Z';
const ACQUIRED_AT = '2026-07-28T12:00:01.000Z';
const TOKENS = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
] as const;
const directories: string[] = [];

const createRoot = () => {
  const root = mkdtempSync(join(tmpdir(), 'supervisor-operation-lock-'));
  directories.push(root);
  ensureRuntimeDirectory(root);
  return root;
};

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const record = (
  overrides: Partial<OperationLockRecord> = {},
): OperationLockRecord => ({
  version: 1,
  pid: 10,
  ownerToken: TOKENS[0],
  acquiredAt: ACQUIRED_AT,
  processStartedAt: STARTED_AT,
  processMarker: SUPERVISOR_PROCESS_MARKER,
  operation: 'start',
  ...overrides,
});

const writeLock = (root: string, value: unknown) =>
  writeFileSync(operationLockPath(root), JSON.stringify(value));

const runContender = (root: string) =>
  new Promise<string>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        join(import.meta.dirname, 'fixtures', 'operation-lock-contender.ts'),
        root,
        SUPERVISOR_PROCESS_MARKER,
      ],
      { cwd: join(import.meta.dirname, '..'), windowsHide: true },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => (stdout += chunk));
    child.stderr.on('data', (chunk: string) => (stderr += chunk));
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr || `Contender exited with ${code}`));
    });
  });

const dependencies = (
  identities: Map<number, ProcessIdentityInspection>,
  failures = new Set<number>(),
) => ({
  inspectProcessIdentity: vi.fn(async (pid: number) => {
    if (failures.has(pid)) throw new Error('inspection unavailable');
    return identities.get(pid) ?? { running: false, markerMatches: false };
  }),
  now: () => new Date(ACQUIRED_AT),
});

const activeIdentity = (startedAt = STARTED_AT): ProcessIdentityInspection => ({
  running: true,
  markerMatches: true,
  startedAt,
});

describe('supervisor operation lock', () => {
  it(
    'normalizes the real process start time to canonical ISO',
    async () => {
      const inspection =
        await createSystemDependencies().inspectProcessIdentity(
          process.pid,
          'node',
        );

      expect(inspection).toMatchObject({
        running: true,
        markerMatches: true,
      });
      expect(inspection.startedAt).toBe(
        new Date(inspection.startedAt ?? '').toISOString(),
      );
    },
    15_000,
  );

  it('persists only the strict owner identity with restrictive permissions', async () => {
    const root = createRoot();
    const deps = dependencies(new Map([[10, activeIdentity()]]));
    const release = await acquireLock(root, 'start', deps, {
      pid: 10,
      ownerTokenFactory: () => TOKENS[0],
    });

    const serialized = readFileSync(operationLockPath(root), 'utf8');
    expect(JSON.parse(serialized)).toEqual(record());
    expect(Object.keys(JSON.parse(serialized))).toEqual([
      'version',
      'pid',
      'ownerToken',
      'acquiredAt',
      'processStartedAt',
      'processMarker',
      'operation',
    ]);
    expect(serialized).not.toMatch(/command|argument|environment|secret|path/i);
    if (process.platform !== 'win32') {
      expect(statSync(operationLockPath(root)).mode & 0o777).toBe(0o600);
    }
    release();
  });

  it('rejects a second operation while the recorded identity is active', async () => {
    const root = createRoot();
    const deps = dependencies(new Map([[10, activeIdentity()]]));
    const release = await acquireLock(root, 'start', deps, {
      pid: 10,
      ownerTokenFactory: () => TOKENS[0],
    });

    await expect(
      acquireLock(root, 'stop', deps, {
        pid: 10,
        ownerTokenFactory: () => TOKENS[1],
      }),
    ).rejects.toMatchObject({ code: 'SYSTEM_OPERATION_IN_PROGRESS' });
    release();
  });

  it('recovers a dead owner and an old release cannot remove the successor', async () => {
    const root = createRoot();
    const identities = new Map<number, ProcessIdentityInspection>([
      [10, activeIdentity()],
      [20, activeIdentity('2026-07-28T12:00:02.000Z')],
    ]);
    const deps = dependencies(identities);
    const oldRelease = await acquireLock(root, 'start', deps, {
      pid: 10,
      ownerTokenFactory: () => TOKENS[0],
    });
    identities.set(10, { running: false, markerMatches: false });

    const successorRelease = await acquireLock(root, 'stop', deps, {
      pid: 20,
      ownerTokenFactory: () => TOKENS[1],
    });
    oldRelease();

    expect(
      JSON.parse(readFileSync(operationLockPath(root), 'utf8')),
    ).toMatchObject({ pid: 20, ownerToken: TOKENS[1], operation: 'stop' });
    successorRelease();
  });

  it.each([
    ['marker', { running: true, markerMatches: false, startedAt: STARTED_AT }],
    [
      'start time',
      {
        running: true,
        markerMatches: true,
        startedAt: '2026-07-28T11:00:00.000Z',
      },
    ],
  ])(
    'treats a reused PID with different %s as stale',
    async (_label, reused) => {
      const root = createRoot();
      writeLock(root, record());
      const deps = dependencies(
        new Map([
          [10, reused],
          [20, activeIdentity('2026-07-28T12:00:02.000Z')],
        ]),
      );

      const release = await acquireLock(root, 'stop', deps, {
        pid: 20,
        ownerTokenFactory: () => TOKENS[1],
      });

      expect(
        JSON.parse(readFileSync(operationLockPath(root), 'utf8')).pid,
      ).toBe(20);
      release();
    },
  );

  it('preserves the lock when process identity inspection is unavailable', async () => {
    const root = createRoot();
    writeLock(root, record());
    const before = readFileSync(operationLockPath(root), 'utf8');
    const deps = dependencies(
      new Map([[20, activeIdentity('2026-07-28T12:00:02.000Z')]]),
      new Set([10]),
    );

    await expect(
      acquireLock(root, 'stop', deps, {
        pid: 20,
        ownerTokenFactory: () => TOKENS[1],
      }),
    ).rejects.toMatchObject({ code: 'SYSTEM_LOCK_IDENTITY_UNAVAILABLE' });
    expect(readFileSync(operationLockPath(root), 'utf8')).toBe(before);
  });

  it.each([
    ['empty', ''],
    ['corrupted', '{'],
    ['legacy', '99999999'],
    ['extra field', JSON.stringify({ ...record(), secret: 'forbidden' })],
  ])(
    'preserves an invalid %s lock for investigation',
    async (_label, value) => {
      const root = createRoot();
      writeFileSync(operationLockPath(root), value);
      const deps = dependencies(new Map([[20, activeIdentity()]]));

      await expect(
        acquireLock(root, 'start', deps, {
          pid: 20,
          ownerTokenFactory: () => TOKENS[1],
        }),
      ).rejects.toMatchObject({ code: 'SYSTEM_LOCK_INVALID' });
      expect(readFileSync(operationLockPath(root), 'utf8')).toBe(value);
    },
  );

  it('allows exactly one of two contenders for an absent lock', async () => {
    const root = createRoot();
    const deps = dependencies(
      new Map([
        [10, activeIdentity()],
        [20, activeIdentity('2026-07-28T12:00:02.000Z')],
      ]),
    );

    const results = await Promise.allSettled([
      acquireLock(root, 'start', deps, {
        pid: 10,
        ownerTokenFactory: () => TOKENS[0],
      }),
      acquireLock(root, 'stop', deps, {
        pid: 20,
        ownerTokenFactory: () => TOKENS[1],
      }),
    ]);

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    for (const result of results) {
      if (result.status === 'fulfilled') result.value();
    }
  });

  it('allows exactly one of two contenders recovering the same stale lock', async () => {
    const root = createRoot();
    writeLock(root, record({ pid: 99, ownerToken: TOKENS[2] }));
    const deps = dependencies(
      new Map([
        [10, activeIdentity()],
        [20, activeIdentity('2026-07-28T12:00:02.000Z')],
        [99, { running: false, markerMatches: false }],
      ]),
    );

    const results = await Promise.allSettled([
      acquireLock(root, 'start', deps, {
        pid: 10,
        ownerTokenFactory: () => TOKENS[0],
      }),
      acquireLock(root, 'stop', deps, {
        pid: 20,
        ownerTokenFactory: () => TOKENS[1],
      }),
    ]);

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    for (const result of results) {
      if (result.status === 'fulfilled') result.value();
    }
  });

  it(
    'allows exactly one of two OS processes recovering the same stale lock',
    async () => {
      const root = createRoot();
      writeLock(root, record({ pid: 999_999, ownerToken: TOKENS[2] }));

      const results = await Promise.all([
        runContender(root),
        runContender(root),
      ]);

      expect(results.sort()).toEqual([
        'SYSTEM_OPERATION_IN_PROGRESS',
        'acquired',
      ]);
      expect(existsSync(operationLockPath(root))).toBe(false);
    },
    25_000,
  );

  it('does not remove a lock whose owner token changed before release', async () => {
    const root = createRoot();
    const deps = dependencies(new Map([[10, activeIdentity()]]));
    const release = await acquireLock(root, 'start', deps, {
      pid: 10,
      ownerTokenFactory: () => TOKENS[0],
    });
    writeLock(root, record({ ownerToken: TOKENS[1], operation: 'stop' }));

    release();
    release();

    expect(
      JSON.parse(readFileSync(operationLockPath(root), 'utf8')),
    ).toMatchObject({ ownerToken: TOKENS[1], operation: 'stop' });
    const log = readFileSync(
      join(root, '.runtime', 'local-system', 'supervisor.log'),
      'utf8',
    );
    expect(log).toContain('SYSTEM_LOCK_RELEASE_SKIPPED');
    expect(log).not.toContain(TOKENS[0]);
    expect(log).not.toContain(TOKENS[1]);
  });

  it.each([
    ['pid', { pid: 99 }],
    ['process start', { processStartedAt: '2026-07-28T12:00:05.000Z' }],
  ])(
    'does not release a lock whose %s no longer matches',
    async (_label, change) => {
      const root = createRoot();
      const deps = dependencies(new Map([[10, activeIdentity()]]));
      const release = await acquireLock(root, 'start', deps, {
        pid: 10,
        ownerTokenFactory: () => TOKENS[0],
      });
      writeLock(root, record(change));

      release();

      expect(
        JSON.parse(readFileSync(operationLockPath(root), 'utf8')),
      ).toMatchObject(change);
    },
  );

  it('releases idempotently without touching any later filesystem state', async () => {
    const root = createRoot();
    const deps = dependencies(new Map([[10, activeIdentity()]]));
    const release = await acquireLock(root, 'start', deps, {
      pid: 10,
      ownerTokenFactory: () => TOKENS[0],
    });

    release();
    expect(() => release()).not.toThrow();
    expect(() => readFileSync(operationLockPath(root), 'utf8')).toThrow();
  });

  it.each([
    ['unlocked', undefined, 'unlocked'],
    ['active', record(), 'active'],
    [
      'stale',
      record({ processStartedAt: '2026-07-28T11:00:00.000Z' }),
      'stale',
    ],
    ['invalid', { pid: 10 }, 'invalid'],
  ] as const)(
    'reports %s without modifying the lock',
    async (_label, value, expected) => {
      const root = createRoot();
      if (value !== undefined) writeLock(root, value);
      const before =
        value === undefined
          ? undefined
          : readFileSync(operationLockPath(root), 'utf8');
      const deps = dependencies(new Map([[10, activeIdentity()]]));

      const snapshot = await inspectOperationLock(root, deps);

      expect(snapshot.operationLock).toBe(expected);
      if (before !== undefined) {
        expect(readFileSync(operationLockPath(root), 'utf8')).toBe(before);
      }
    },
  );

  it('reports unavailable without exposing the token', async () => {
    const root = createRoot();
    writeLock(root, record());
    const snapshot = await inspectOperationLock(
      root,
      dependencies(new Map(), new Set([10])),
    );

    expect(snapshot).toEqual({
      operationLock: 'unavailable',
      operation: 'start',
      pid: 10,
      acquiredAt: ACQUIRED_AT,
    });
    expect(JSON.stringify(snapshot)).not.toContain(TOKENS[0]);
  });
});
