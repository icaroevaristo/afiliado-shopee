import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { createPrismaClient } from '@shopee-auto-affiliate-ai/database';
import { LocalSystemSupervisor } from '../src/supervisor';
import { parseSystemArgs } from '../src/cli';
import { acquireLock, relativeLogPath, writeState } from '../src/state-store';
import { readMaintenanceDatabase } from '../src/maintenance-database';
import type { CommandSpec, SystemDependencies } from '../src/types';

const enabled = process.env.RUN_SUPERVISOR_MAINTENANCE_DB_TEST === 'true';
it.skipIf(!enabled).each([false, true])(
  'R1D real PostgreSQL: pre-existing session refused; late external session counterexample=%s',
  async (lateExternalSession) => {
    const source = resolve(import.meta.dirname, '../../..');
    const root = mkdtempSync(join(tmpdir(), 'r1d-maintenance-'));
    const project = 'r1d-maintenance-proof';
    const volume = `${project}_postgres_data`;
    const url =
      'postgresql://postgres@127.0.0.1:55474/shopee_auto_affiliate_ai?schema=public';
    const docker = process.env.R1D_DOCKER_PATH ?? 'docker';
    const env: NodeJS.ProcessEnv = {
      SystemRoot: process.env.SystemRoot,
      WINDIR: process.env.WINDIR,
      COMSPEC: process.env.COMSPEC,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      PATHEXT: process.env.PATHEXT,
      PATH: process.env.PATH ?? process.env.Path,
      DATABASE_URL: url,
      REDIS_URL: 'redis://127.0.0.1:55475',
      POSTGRES_HOST_PORT: '55474',
      PORT: '56333',
      NODE_ENV: 'test',
      COMMERCIAL_AUTOMATION_MODE: 'preview',
      WHATSAPP_PROVIDER: 'mock',
      SHOPEE_AFFILIATE_PROVIDER: 'mock',
      WHATSAPP_GROUP_SEND_ENABLED: 'false',
      SCHEDULER_ENABLED: 'false',
      CHECKPOINT_DISABLE: '1',
    };
    const commands: Array<{ args: string[]; code: number }> = [];
    const run = (command: string, args: string[]) => {
      const r = spawnSync(command, args, {
        cwd: root,
        env,
        encoding: 'utf8',
        windowsHide: true,
        timeout: 120_000,
      });
      commands.push({
        args: args.map((a) => a.replace(url, '[DISPOSABLE_URL]')),
        code: r.status ?? 1,
      });
      if (r.status !== 0)
        throw new Error(
          'Fixture command failed: ' +
            args.slice(0, 3).join(' ') +
            ' exit ' +
            r.status,
        );
      return { code: 0, stdout: r.stdout, stderr: '' };
    };
    const compose = (args: string[]) =>
      run(docker, ['compose', '--project-name', project, ...args]);
    const prismaPath = join(
      source,
      'packages/database/node_modules/prisma/build/index.js',
    );
    const schema = join(root, 'packages/database/prisma/schema.prisma');
    const prisma = (args: string[]) =>
      run(process.execPath, [prismaPath, ...args]);
    const database = createPrismaClient(url);
    const concurrent = createPrismaClient(url);
    let writer: ChildProcess | undefined;
    let alive = false,
      startedAt = '';
    let deployCount = 0,
      restarts = 0,
      requests = 0;
    let lateSessionsAtDeploy = 0;
    let infrastructureCreated = false;
    const startWriter = async () => {
      writer = spawn(process.execPath, [join(root, 'writer.cjs')], {
        cwd: root,
        env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      startedAt = new Date().toISOString();
      alive = true;
      writer.once('exit', () => {
        alive = false;
      });
      await new Promise<void>((done, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Writer startup timeout')),
          15_000,
        );
        writer?.once('error', reject);
        writer?.stdout?.once('data', () => {
          clearTimeout(timer);
          done();
        });
      });
      if (!writer.pid) throw new Error('No writer PID');
      writeState(root, {
        version: 1,
        composeProjectName: project,
        startedAt,
        mode: 'preview',
        ports: {
          api: 56333,
          dashboard: 3000,
          postgres: 55474,
          redis: 6379,
          evolution: 8080,
        },
        processes: {
          api: { pid: writer.pid, startedAt, log: relativeLogPath('api') },
        },
      });
    };
    try {
      const collision = spawnSync(
        docker,
        [
          'ps',
          '-aq',
          '--filter',
          `label=com.docker.compose.project=${project}`,
        ],
        { encoding: 'utf8', windowsHide: true },
      );
      expect(collision.status).toBe(0);
      expect(collision.stdout.trim()).toBe('');
      const existingVolume = spawnSync(docker, ['volume', 'inspect', volume], {
        encoding: 'utf8',
        windowsHide: true,
      });
      expect(existingVolume.status).not.toBe(0);
      mkdirSync(join(root, 'packages/database/prisma/migrations'), {
        recursive: true,
      });
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({ private: true, packageManager: 'pnpm@9.12.3' }),
      );
      writeFileSync(
        join(root, 'pnpm-workspace.yaml'),
        'packages:\n  - packages/*\n',
      );
      writeFileSync(
        join(root, 'packages/database/package.json'),
        JSON.stringify({
          name: '@shopee-auto-affiliate-ai/database',
          scripts: { 'db:deploy': 'prisma migrate deploy' },
        }),
      );
      symlinkSync(
        join(source, 'node_modules'),
        join(root, 'node_modules'),
        'junction',
      );
      symlinkSync(
        join(source, 'packages/database/node_modules'),
        join(root, 'packages/database/node_modules'),
        'junction',
      );
      cpSync(join(source, 'packages/database/prisma/schema.prisma'), schema);
      const migrations = join(source, 'packages/database/prisma/migrations');
      const names = readdirSync(migrations, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort();
      expect(names).toHaveLength(38);
      cpSync(
        join(migrations, 'migration_lock.toml'),
        join(root, 'packages/database/prisma/migrations/migration_lock.toml'),
      );
      for (const name of names.slice(0, -4))
        cpSync(
          join(migrations, name),
          join(root, 'packages/database/prisma/migrations', name),
          { recursive: true },
        );
      writeFileSync(
        join(root, 'docker-compose.yml'),
        `services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: shopee_auto_affiliate_ai
      POSTGRES_HOST_AUTH_METHOD: trust
    ports: ['127.0.0.1:55474:5432']
    volumes: ['postgres_data:/var/lib/postgresql/data']
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U postgres -d shopee_auto_affiliate_ai']
      interval: 1s
      timeout: 3s
      retries: 30
  redis:
    image: redis:7-alpine
    ports: ['127.0.0.1:6379:6379']
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
volumes:
  postgres_data:
`,
      );
      infrastructureCreated = true;
      compose(['up', '-d', '--pull', 'never', '--wait', 'postgres']);
      prisma(['migrate', 'deploy', '--schema', schema]);
      for (const name of names.slice(-4))
        cpSync(
          join(migrations, name),
          join(root, 'packages/database/prisma/migrations', name),
          { recursive: true },
        );
      // The historical migration already creates the paused singleton.
      const before = await readMaintenanceDatabase(root, url);
      expect(before.pending).toEqual(names.slice(-4));
      const dispatchesBefore = await database.whatsAppDispatch.count();
      await database.$disconnect();
      const clientModule = JSON.stringify(
        join(source, 'packages/database/node_modules/@prisma/client'),
      );
      writeFileSync(
        join(root, 'writer.cjs'),
        `const {PrismaClient}=require(${clientModule});
const p=new PrismaClient({datasources:{db:{url:process.env.DATABASE_URL}}});
(async()=>{await p.$executeRawUnsafe('UPDATE public."CommercialAutomationSettings" SET paused=true WHERE id=\\'commercial-automation\\'');process.stdout.write('ready');setInterval(()=>p.$executeRawUnsafe('UPDATE public."CommercialAutomationSettings" SET paused=true WHERE id=\\'commercial-automation\\'').catch(()=>{}),50);})().catch(()=>process.exit(1));
`,
      );
      await startWriter();
      const deps: SystemDependencies = {
        run: async (spec: CommandSpec) => {
          if (spec.args.includes('db:deploy')) {
            deployCount++;
            if (!lateExternalSession) return run(spec.command, spec.args);
            // Deliberate counterexample: an unmanaged writer arrives AFTER the
            // supervisor's last activity snapshot and remains connected through DDL.
            // This is evidence of an OPEN safety gap, not continuous quiescence proof.
            await concurrent.$executeRaw`UPDATE public."CommercialAutomationSettings" SET paused=true WHERE id='commercial-automation'`;
            lateSessionsAtDeploy = (await readMaintenanceDatabase(root, url))
              .otherSessions;
            try {
              return run(spec.command, spec.args);
            } finally {
              await concurrent.$disconnect();
            }
          }
          if (spec.command !== 'docker') throw new Error('Unexpected command');
          // Limit volume inventory to this fixture; no operational-volume inventory.
          if (spec.args[0] === 'volume' && spec.args[1] === 'ls')
            return { code: 0, stdout: volume, stderr: '' };
          return run(docker, spec.args);
        },
        spawn: async () => {
          restarts++;
          throw new Error('Application spawn prohibited');
        },
        inspectProcess: async (pid) => ({
          running: pid === writer?.pid && alive,
          identityMatches: pid === writer?.pid,
          startedAt,
        }),
        inspectProcessIdentity: async () => ({
          running: true,
          markerMatches: true,
          startedAt,
        }),
        stopProcessTree: async (pid) => {
          if (!writer || writer.pid !== pid) throw new Error('Foreign PID');
          const child = writer;
          await new Promise<void>((done) => {
            child.once('exit', () => done());
            child.kill();
          });
          return !alive;
        },
        // Recording port boundary: this fixture writer exposes no HTTP listener.
        getPortOccupant: async () => null,
        request: async () => {
          requests++;
          throw new Error('Provider/HTTP prohibited');
        },
        sleep: async (ms) => {
          await new Promise((done) => setTimeout(done, ms));
        },
        now: () => new Date(),
      };
      const supervisor = new LocalSystemSupervisor(
        root,
        deps,
        [
          {
            name: 'api',
            command: process.execPath,
            args: [join(root, 'writer.cjs')],
            marker: 'writer.cjs',
          },
        ],
        {
          composeProjectName: project,
          operationLockRoot: root,
          validateRoot: () => true,
          loadEnvironmentFiles: false,
        },
      );
      const execute = async () => {
        const parsed = parseSystemArgs([
          'migrate',
          '--confirm-operational-migrations',
          `--compose-project-name=${project}`,
        ]);
        if (parsed.command !== 'migrate') throw new Error('Unexpected parse');
        const release = await acquireLock(root, parsed.command, deps);
        try {
          return await supervisor.migrate(parsed.confirmed, env);
        } finally {
          release();
        }
      };
      expect(
        (await readMaintenanceDatabase(root, url)).otherSessions,
      ).toBeGreaterThan(0);
      await concurrent.$queryRaw`SELECT 1`;
      await expect(execute()).rejects.toMatchObject({
        code: 'SYSTEM_MAINTENANCE_DATABASE_BUSY',
      });
      expect(deployCount).toBe(0);
      await concurrent.$disconnect();
      await startWriter();
      const result = await execute();
      expect(result).toMatchObject({
        pendingBefore: 4,
        pendingAfter: 0,
        applicationProcessesBefore: 1,
        applicationProcessesAfterQuiesce: 0,
      });
      expect(deployCount).toBe(1);
      expect(restarts).toBe(0);
      expect(requests).toBe(0);
      expect(lateSessionsAtDeploy).toBe(lateExternalSession ? 1 : 0);
      expect(alive).toBe(false);
      const after = await readMaintenanceDatabase(root, url);
      expect(after.pending).toHaveLength(0);
      expect(after.paused).toBe(true);
      expect(after.otherSessions).toBe(0);
      prisma([
        'migrate',
        'diff',
        '--from-schema-datasource',
        schema,
        '--to-schema-datamodel',
        schema,
        '--exit-code',
      ]);
      expect(await database.whatsAppDispatch.count()).toBe(dispatchesBefore);
      await database.$disconnect();
      expect((await supervisor.stop(env)).stopped).toBe(true);
      const evidence = {
        status: lateExternalSession
          ? 'COUNTEREXAMPLE_REPRODUCED_OPEN_P1'
          : 'PASS',
        continuousQuiescence: lateExternalSession
          ? 'NOT_ENFORCED'
          : 'NOT_PROVEN_BY_SNAPSHOTS',
        lateSessionsAtDeploy,
        officialStopAfterMaintenance: 'PASS_POSTGRES_ONLY',
        applicationProcessesBefore: 1,
        applicationProcessesAfterQuiesce: 0,
        concurrentSessionTest: 'PASS_REFUSED',
        pendingBefore: 4,
        pendingAfter: 0,
        migrationExecutionCount: deployCount,
        migrationRetryCount: 0,
        applicationProcessRestarts: restarts,
        providerCalls: requests,
        newDispatches: 0,
        jobRetries: 0,
        prismaDiff: 'EMPTY_EXIT_0',
        processBoundary:
          'Controlled real writer subprocess with recording ownership/port adapters; production OS identity covered by supervisor tests',
        commands,
      };
      if (process.env.R1D_EVIDENCE_PATH)
        writeFileSync(
          lateExternalSession
            ? process.env.R1D_EVIDENCE_PATH.replace(
                /\.json$/,
                '-late-session.json',
              )
            : process.env.R1D_EVIDENCE_PATH,
          JSON.stringify(evidence, null, 2),
        );
    } finally {
      if (writer && alive) writer.kill();
      await database.$disconnect();
      await concurrent.$disconnect();
      if (infrastructureCreated) compose(['down', '--volumes']);
      // root is exclusively this mkdtemp fixture, never a workspace or operational directory.
      rmSync(root, { recursive: true, force: true });
    }
  },
  180_000,
);
