import { createServer } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { readPortOccupant } from '../src/port-inspection';
import { createSystemDependencies } from '../src/system-dependencies';
import type { CommandSpec } from '../src/types';

describe('port inspection fail closed', () => {
  it.each([
    ['win32', 1, '', ''],
    ['win32', 3, '', ''],
    ['win32', 0, '', ''],
    ['win32', 0, '{"Occupied":false}', 'query failed'],
    ['win32', 0, '{}', ''],
    ['linux', 2, '', ''],
    ['linux', 1, '', 'permission denied'],
    ['linux', 1, '', ''],
  ] as const)(
    'rejects unavailable %s query exit=%s',
    async (platform, code, stdout, stderr) => {
      await expect(
        readPortOccupant(5432, platform, async () => ({
          code,
          stdout,
          stderr,
        })),
      ).rejects.toMatchObject({ code: 'SYSTEM_PORT_INSPECTION_UNAVAILABLE' });
    },
  );
  it.each(['win32', 'linux'] as const)(
    'does not swallow %s spawn failures',
    async (platform) => {
      await expect(
        readPortOccupant(5432, platform, async () => {
          throw new Error('tool unavailable');
        }),
      ).rejects.toThrow('tool unavailable');
    },
  );
  it('distinguishes native Windows empty inventory from command failure', async () => {
    const run = vi.fn(async (command: CommandSpec) => {
      expect(command.command).toBe('powershell.exe');
      return {
        code: 0,
        stdout: '{"Occupied":false}',
        stderr: '',
      };
    });
    await expect(readPortOccupant(5432, 'win32', run)).resolves.toBeNull();
    expect(run.mock.calls[0][0].args.join(' ')).toContain(
      'GetActiveTcpListeners',
    );
    expect(run.mock.calls[0][0].args.join(' ')).not.toContain(
      'SilentlyContinue',
    );
  });
  it('accepts documented lsof no-match and parses occupied ports', async () => {
    await expect(
      readPortOccupant(5432, 'linux', async () => ({
        code: 0,
        stdout: '',
        stderr: '',
      })),
    ).resolves.toBeNull();
    await expect(
      readPortOccupant(5432, 'linux', async () => ({
        code: 0,
        stdout: 'p12\ncpostgres\n',
        stderr: '',
      })),
    ).resolves.toEqual({ pid: 12, processName: 'postgres' });
  });
  it.skipIf(process.platform !== 'win32')(
    'reads a real owned Windows listener and its released ephemeral port',
    async () => {
      const server = createServer();
      await new Promise<void>((done, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', done);
      });
      const address = server.address();
      if (!address || typeof address === 'string')
        throw new Error('No fixture port');
      const deps = createSystemDependencies();
      try {
        expect((await deps.getPortOccupant(address.port))?.pid).toBe(
          process.pid,
        );
      } finally {
        await new Promise<void>((done, reject) =>
          server.close((error) => (error ? reject(error) : done())),
        );
      }
      expect(await deps.getPortOccupant(address.port)).toBeNull();
    },
    15_000,
  );
});
