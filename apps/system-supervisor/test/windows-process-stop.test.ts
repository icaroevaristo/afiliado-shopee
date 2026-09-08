import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { createSystemDependencies } from '../src/system-dependencies';
import { windowsProcessStopScript } from '../src/windows-process-stop';

it('rejects invalid process identity before constructing a command', () => {
  expect(() =>
    windowsProcessStopScript(-1, new Date().toISOString()),
  ).toThrow();
  expect(() => windowsProcessStopScript(1, "'; exit 0")).toThrow();
});

const startOwnedProcess = async (): Promise<ChildProcess> => {
  const child = spawn(
    process.execPath,
    [
      '-e',
      "/* r1d-owned-stop-proof */ process.send('ready'); setInterval(() => {}, 1000)",
    ],
    {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    },
  );
  await once(child, 'message');
  return child;
};

describe.skipIf(process.platform !== 'win32')(
  'Windows handle termination',
  () => {
    it('stops a controlled parent and descendant while preserving an unrelated process', async () => {
      const childScript =
        '/* r1d-owned-descendant */ setInterval(() => {}, 1000)';
      const parentScript = `/* r1d-owned-parent */
        const child = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(childScript)}], { windowsHide: true, stdio: 'ignore' });
        child.once('spawn', () => process.send(child.pid));
        process.on('message', () => { child.kill(); process.exit(); });
        setInterval(() => {}, 1000);
      `;
      const parent = spawn(process.execPath, ['-e', parentScript], {
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      });
      const ready = once(parent, 'message');
      const unrelated = await startOwnedProcess();
      try {
        const [descendant]: unknown[] = await ready;
        if (typeof descendant !== 'number' || !parent.pid)
          throw new Error('Missing fixture PIDs');
        const deps = createSystemDependencies();
        const identity = await deps.inspectProcessIdentity(
          parent.pid,
          'r1d-owned-parent',
        );
        const childIdentity = await deps.inspectProcessIdentity(
          descendant,
          'r1d-owned-descendant',
        );
        expect(childIdentity.markerMatches).toBe(true);
        if (!identity.startedAt) throw new Error('Missing fixture identity');
        expect(await deps.stopProcessTree(parent.pid, identity.startedAt)).toBe(
          true,
        );
        expect(
          (
            await deps.inspectProcessIdentity(
              descendant,
              'r1d-owned-descendant',
            )
          ).running,
        ).toBe(false);
        expect(unrelated.exitCode).toBeNull();
      } finally {
        if (parent.connected) parent.send('stop');
        unrelated.kill();
      }
    }, 60_000);
    it('refuses a stale start identity, then stops the same controlled process with pinned handles', async () => {
      const owned = await startOwnedProcess();
      const unrelated = await startOwnedProcess();
      try {
        if (!owned.pid) throw new Error('Missing fixture PID');
        const deps = createSystemDependencies();
        const identity = await deps.inspectProcessIdentity(
          owned.pid,
          'r1d-owned-stop-proof',
        );
        expect(identity.markerMatches).toBe(true);
        if (!identity.startedAt) throw new Error('Missing fixture identity');
        const stale = new Date(
          Date.parse(identity.startedAt) - 60_000,
        ).toISOString();
        expect(await deps.stopProcessTree(owned.pid, stale)).toBe(false);
        expect(owned.exitCode).toBeNull();
        expect(await deps.stopProcessTree(owned.pid, identity.startedAt)).toBe(
          true,
        );
        expect(unrelated.exitCode).toBeNull();
        expect(unrelated.connected).toBe(true);
      } finally {
        // These ChildProcess objects retain handles to fixtures created by this test.
        owned.kill();
        unrelated.kill();
      }
    }, 60_000);
  },
);
