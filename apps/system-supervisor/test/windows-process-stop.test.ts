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
    it('contains a descendant born during the shutdown grace period', async () => {
      const childScript =
        '/* r1d-late-descendant */ setInterval(() => {}, 1000)';
      const parentScript = `/* r1d-late-parent */
        let child;
        process.send('ready');
        process.on('message', command => {
          if(command !== 'spawn') { if(child) child.kill(); process.exit(); }
          child = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(childScript)}], { windowsHide: true, stdio: 'ignore' });
          child.once('spawn', () => process.send(child.pid));
        });
        setInterval(() => {}, 1000);
      `;
      const parent = spawn(process.execPath, ['-e', parentScript], {
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      });
      const deps = createSystemDependencies();
      let descendant: number | undefined;
      let stopper: ChildProcess | undefined;
      try {
        await once(parent, 'message');
        const lateBirth = once(parent, 'message');
        if (!parent.pid) throw new Error('Missing fixture PID');
        const identity = await deps.inspectProcessIdentity(
          parent.pid,
          'r1d-late-parent',
        );
        if (!identity.startedAt) throw new Error('Missing fixture identity');
        // Execute the exact production script; its sanitized containment marker
        // releases the fixture only AFTER inventory/adoption, without timer guesses.
        stopper = spawn(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            windowsProcessStopScript(parent.pid, identity.startedAt),
          ],
          { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
        );
        const stopped = once(stopper, 'exit');
        stopper.stdout?.setEncoding('utf8');
        stopper.stdout?.on('data', (chunk: string) => {
          if (chunk.includes('SUPERVISOR_TREE_CONTAINED')) parent.send('spawn');
        });
        const [value]: unknown[] = await Promise.race([
          lateBirth,
          stopped.then(() => {
            throw new Error('Stop exited before late birth');
          }),
        ]);
        if (typeof value !== 'number')
          throw new Error('Missing descendant PID');
        descendant = value;
        const [exitCode]: unknown[] = await stopped;
        expect(exitCode).toBe(0);
        expect(
          (await deps.inspectProcessIdentity(descendant, 'r1d-late-descendant'))
            .running,
        ).toBe(false);
      } finally {
        stopper?.kill();
        if (parent.connected) parent.send('stop');
        if (descendant) {
          const remaining = await deps.inspectProcessIdentity(
            descendant,
            'r1d-late-descendant',
          );
          if (
            remaining.running &&
            remaining.markerMatches &&
            remaining.startedAt
          )
            await deps.stopProcessTree(descendant, remaining.startedAt);
        }
      }
    }, 60_000);
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
    it('stops a detached descendant through its pinned process handle', async () => {
      const childScript =
        '/* r2-detached-descendant */ setInterval(() => {}, 1000)';
      const parentScript = `/* r2-detached-parent */
        const child = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(childScript)}], { detached: true, windowsHide: true, stdio: 'ignore' });
        child.once('spawn', () => process.send(child.pid));
        setInterval(() => {}, 1000);
      `;
      const parent = spawn(process.execPath, ['-e', parentScript], {
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      });
      let descendant: number | undefined;
      try {
        const [value]: unknown[] = await once(parent, 'message');
        if (typeof value !== 'number' || !parent.pid)
          throw new Error('Missing fixture PIDs');
        descendant = value;
        const deps = createSystemDependencies();
        const identity = await deps.inspectProcessIdentity(
          parent.pid,
          'r2-detached-parent',
        );
        if (!identity.startedAt) throw new Error('Missing fixture identity');
        expect(await deps.stopProcessTree(parent.pid, identity.startedAt)).toBe(
          true,
        );
        expect(
          (
            await deps.inspectProcessIdentity(
              descendant,
              'r2-detached-descendant',
            )
          ).running,
        ).toBe(false);
      } finally {
        parent.kill();
        if (descendant) {
          const remaining = await createSystemDependencies().inspectProcessIdentity(
            descendant,
            'r2-detached-descendant',
          );
          if (
            remaining.running &&
            remaining.markerMatches &&
            remaining.startedAt
          )
            await createSystemDependencies().stopProcessTree(
              descendant,
              remaining.startedAt,
            );
        }
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
