import { spawn, spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createConnection, createServer } from 'node:net';
import { randomUUID, createHash } from 'node:crypto';
import { createRedisConnection, createCommercialAutomationQueue, createCommercialInventoryRefillQueue, createWhatsAppDispatchQueue, JOB_NAMES, DEFAULT_COMMERCIAL_AUTOMATION_SCHEDULER_JOB_ID } from '@shopee-auto-affiliate-ai/queue';
import { expect, it } from 'vitest';
import { createPrismaClient } from '@shopee-auto-affiliate-ai/database';
import { LocalSystemSupervisor } from '../src/supervisor';
import { acquireLock, writeState } from '../src/state-store';
import { readMaintenanceDatabase } from '../src/maintenance-database';
import type { CommandSpec, SystemDependencies } from '../src/types';
import { startHostOrphan } from './maintenance-host-orphan';
const enabled = process.env.RUN_SUPERVISOR_MAINTENANCE_DB_TEST === 'true';
type Counters = {
  attempts: number;
  connections: number;
  writes: number;
  completed?: number;
};
type ProbeSample = { at: string; network: Counters; host: Counters | null };
const listening = (port: number) =>
  new Promise<boolean>((done) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const finish = (result: boolean) => {
      socket.destroy();
      done(result);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(1000, () => finish(false));
  });

const availablePort = () =>
  new Promise<number>((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Unable to allocate a disposable port'));
        return;
      }
      server.close((error) => (error ? reject(error) : resolvePort(address.port)));
    });
  });

it.skipIf(!enabled)(
  'R1F safe certification uses process environment only with disposable PostgreSQL and Redis',
  async () => {
    const source = resolve(import.meta.dirname, '../../..');
    const root = mkdtempSync(join(tmpdir(), 'r1f-safe-certification-'));
    const project = `r1f-${randomUUID().slice(0, 8)}`;
    const postgresPort = await availablePort();
    const redisPort = await availablePort();
    const apiPort = await availablePort();
    const dashboardPort = await availablePort();
    const docker = process.env.R1F_DOCKER_PATH ?? 'docker';
    const databaseUrl = `postgresql://postgres@127.0.0.1:${postgresPort}/shopee_auto_affiliate_ai?schema=public`;
    const redisUrl = `redis://127.0.0.1:${redisPort}`;
    const commands: CommandSpec[] = [];
    const spawned: string[] = [];
    const processes = new Map<
      number,
      { marker: string; startedAt: string; running: boolean }
    >();
    let nextPid = 700;
    const apiChildren = new Map<number, ReturnType<typeof spawn>>();
    let apiErrors = '';
    const requestedUrls: string[] = [];
    const childEnvironments: NodeJS.ProcessEnv[] = [];
    let connection: ReturnType<typeof createRedisConnection> | undefined;
    const queues: Array<{ close(): Promise<void> }> = [];
    let infrastructure = false;
    let client: ReturnType<typeof createPrismaClient> | undefined;
    const command = (
      executable: string,
      args: string[],
      cwd = root,
      overrides: NodeJS.ProcessEnv = {},
    ) => {
      const result = spawnSync(executable, args, {
        cwd,
        env: {
          SystemRoot: process.env.SystemRoot,
          WINDIR: process.env.WINDIR,
          COMSPEC: process.env.COMSPEC,
          TEMP: process.env.TEMP,
          TMP: process.env.TMP,
          PATHEXT: process.env.PATHEXT,
          PATH: process.env.PATH ?? process.env.Path,
          ...overrides,
        },
        encoding: 'utf8',
        windowsHide: true,
        timeout: 120_000,
      });
      return {
        code: result.status ?? 1,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
      };
    };
    try {
      mkdirSync(join(root, 'packages/database/prisma'), { recursive: true });
      for (const file of [
        'package.json',
        'pnpm-lock.yaml',
        'infra/evolution/docker-compose.yml',
        'apps/api/src/server.ts',
        'apps/dashboard/package.json',
        'apps/worker/src/commercial-automation-worker.ts',
        'apps/worker/src/whatsapp-dispatch-runtime.ts',
      ]) {
        const target = join(root, file);
        mkdirSync(resolve(target, '..'), { recursive: true });
        writeFileSync(target, '{}');
      }
      writeFileSync(
        join(root, 'docker-compose.yml'),
        `services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: shopee_auto_affiliate_ai
      POSTGRES_HOST_AUTH_METHOD: trust
    ports: ['127.0.0.1:${postgresPort}:5432']
    volumes: ['postgres_data:/var/lib/postgresql/data']
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U postgres -d shopee_auto_affiliate_ai']
      interval: 1s
      timeout: 3s
      retries: 30
  redis:
    image: redis:7-alpine
    ports: ['127.0.0.1:${redisPort}:6379']
    tmpfs: ['/data']
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 1s
      timeout: 3s
      retries: 30
volumes:
  postgres_data:
`,
      );
      cpSync(
        join(source, 'packages/database/prisma/schema.prisma'),
        join(root, 'packages/database/prisma/schema.prisma'),
      );
      cpSync(
        join(source, 'packages/database/prisma/migrations'),
        join(root, 'packages/database/prisma/migrations'),
        { recursive: true },
      );
      symlinkSync(join(source, 'node_modules'), join(root, 'node_modules'), 'junction');
      symlinkSync(
        join(source, 'packages/database/node_modules'),
        join(root, 'packages/database/node_modules'),
        'junction',
      );
      expect(command(docker, ['volume', 'inspect', `${project}_postgres_data`]).code).not.toBe(0);
      infrastructure = true;
      const composeUp = command(docker, [
        'compose',
        '--project-name',
        project,
        'up',
        '-d',
        '--pull',
        'never',
        '--wait',
      ]);
      if (composeUp.code !== 0)
        throw new Error(`Disposable compose failed: ${composeUp.stderr.slice(-1000)}`);
      infrastructure = true;
      const prismaPath = join(source, 'packages/database/node_modules/prisma/build/index.js');
      const migrationDeploy = command(process.execPath, [
        prismaPath,
        'migrate',
        'deploy',
        '--schema',
        join(root, 'packages/database/prisma/schema.prisma'),
      ], root, { DATABASE_URL: databaseUrl });
      if (migrationDeploy.code !== 0)
        throw new Error(`Disposable migration failed: ${migrationDeploy.stderr.slice(-1600)}`);
      expect(command(docker, ['compose', '--project-name', project, 'exec', '-T', 'redis', 'redis-cli', 'ping']).stdout.trim()).toBe('PONG');

      client = createPrismaClient(databaseUrl);
      await client.commercialAutomationSettings.upsert({
        where: { id: 'commercial-automation' },
        update: { paused: true },
        create: { id: 'commercial-automation', paused: true },
      });
      const id = 'r1f-recovery-sensitive';
      await client.whatsAppInstance.create({ data: { name: 'fixture', active: false, paused: true } });
      await client.productLead.create({ data: {
        id, providerProductId: id, nome: 'fixture', categoria: 'fixture',
        preco: '10', desconto: 0, nota: 5, vendidos: 1, comissao: 1,
        loja: 'fixture', urlImagem: 'https://example.invalid/image', title: 'fixture',
      } });
      await client.generatedCopy.create({ data: {
        id, productId: id, titulo: 'fixture', mensagem: 'fixture', cta: 'fixture', hashtags: '',
      } });
      await client.whatsAppDestination.create({ data: {
        id, name: 'fixture', destination: 'fixture.invalid', active: false,
      } });
      await client.whatsAppDispatch.create({ data: {
        id, productId: id, generatedCopyId: id, destinationId: id,
        status: 'PROCESSING', attemptCount: 1, instanceName: 'fixture',
      } });
      await client.commercialAutomationExecution.create({ data: {
        id, schedulerJobId: id, bullMqJobId: id, mode: 'SEND',
        status: 'STARTED', externalStage: 'EXTERNAL_MAY_HAVE_STARTED',
        reasons: [], startedAt: new Date('2020-01-01'), leaseExpiresAt: new Date('2020-01-01'),
        heartbeatAt: new Date('2020-01-01'), ownerId: 'stale-owner',
      } });
      await client.commercialPipelineRun.create({ data: {
        id, executionId: id, instanceName: 'fixture', mode: 'CONFIRMED',
        status: 'FAILED', finalStatus: 'AMBIGUOUS', investigationRequired: true,
        dispatchId: id, jobId: id, productId: id, groupDestinationId: id,
        groupFingerprint: 'a'.repeat(64), rejectionSummary: {}, selectionReasons: [], plannedSubIds: [],
      } });
      await client.commercialDispatchOutbox.create({ data: {
        id, commercialRunId: id, dispatchId: id, jobId: id, instanceName: 'fixture',
        status: 'PUBLISHED', publishedAt: new Date('2020-01-01'),
      } });
      const databaseFingerprint = async () => {
        if (!client) throw new Error('Fixture DB unavailable');
        return client.$transaction(async (tx) => {
          await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
          const tables = await tx.$queryRawUnsafe<Array<{ name: string }>>(
            "SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
          const hashes: string[] = [];
          for (const { name } of tables) {
            const identifier = '"' + name.replaceAll('"', '""') + '"';
            const rows = await tx.$queryRawUnsafe<Array<{ row: string }>>(
              'SELECT row_to_json(t)::text AS row FROM public.' + identifier + ' t ORDER BY row_to_json(t)::text',
            );
            hashes.push(name, JSON.stringify(rows));
          }
          return createHash('sha256').update(hashes.join('\n')).digest('hex');
        });
      };
      connection = createRedisConnection(redisUrl);
      const automation = createCommercialAutomationQueue(connection);
      const inventory = createCommercialInventoryRefillQueue(connection);
      const whatsapp = createWhatsAppDispatchQueue(connection);
      queues.push(automation, inventory, whatsapp);
      await Promise.all([automation.waitUntilReady(), inventory.waitUntilReady(), whatsapp.waitUntilReady()]);
      await automation.upsertJobScheduler(DEFAULT_COMMERCIAL_AUTOMATION_SCHEDULER_JOB_ID,
        { pattern: '0 0 1 1 *', tz: 'UTC' },
        { name: JOB_NAMES.commercialAutomationTick, data: { mode: 'send' } });
      await automation.add(JOB_NAMES.commercialAutomationTick, { mode: 'send' }, { jobId: 'existing-send' });
      await inventory.add(JOB_NAMES.commercialInventoryRefill, { mode: 'send', provider: 'official' }, { jobId: 'existing-refill-send' });
      await whatsapp.add(JOB_NAMES.whatsappDispatch, { dispatchId: id }, { jobId: 'existing-whatsapp' });
      const redisFingerprint = async () => {
        if (!connection) throw new Error('Fixture Redis unavailable');
        const keys = (await connection.keys('bull:*')).sort();
        const hash = createHash('sha256');
        for (const key of keys) {
          hash.update(key);
          const dump = await connection.dumpBuffer(key);
          if (!dump) throw new Error('Fixture key disappeared');
          hash.update(dump);
        }
        return hash.digest('hex');
      };
      const redisBefore = await redisFingerprint();
      const postgresBefore = await databaseFingerprint();
      const schedulerBefore = await automation.getJobScheduler(DEFAULT_COMMERCIAL_AUTOMATION_SCHEDULER_JOB_ID);
      const safeSnapshot = await readMaintenanceDatabase(root, databaseUrl);
      expect(safeSnapshot.paused).toBe(true);
      expect(safeSnapshot.pending).toEqual([]);

      const deps: SystemDependencies = {
        run: async (spec) => {
          commands.push(spec);
          if (spec.args.includes('db:deploy'))
            return { code: 1, stdout: '', stderr: 'safe profile must not deploy' };
          if (
            spec.args.includes('--version') ||
            spec.args.includes('@shopee-auto-affiliate-ai/dashboard')
          ) {
            if (spec.args.includes('@shopee-auto-affiliate-ai/dashboard')) {
              mkdirSync(join(root, 'apps/dashboard/.next'), { recursive: true });
              writeFileSync(join(root, 'apps/dashboard/.next/BUILD_ID'), 'r1f\n');
            }
            return { code: 0, stdout: '', stderr: '' };
          }
          if (spec.command === 'git')
            return {
              code: 0,
              stdout: spec.args[0] === 'status' ? '' : `${'a'.repeat(40)}\n`,
              stderr: '',
            };
          if (spec.args.includes('--from-schema-datasource')) {
            expect(spec.env?.PGOPTIONS).toBe('-c default_transaction_read_only=on');
            return command(spec.command, spec.args, spec.cwd, spec.env);
          }
          if (spec.command === 'docker') {
            if (spec.args[0] === 'compose') expect(spec.args).toContain(project);
            expect(spec.args.join(' ')).not.toContain('evolution');
            return command(docker, spec.args, spec.cwd);
          }
          return { code: 0, stdout: '', stderr: '' };
        },
        spawn: async (spec) => {
          const startedAt = new Date().toISOString();
          let pid = nextPid++;
          childEnvironments.push(spec.env ?? {});
          if (spec.args[0] === 'r1f-api') {
            const child = spawn(process.execPath, [
              '--import', pathToFileURL(join(source, 'node_modules/tsx/dist/loader.mjs')).href,
              join(source, 'apps/api/src/server.ts'),
            ], {
              cwd: root, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
              env: { ...spec.env, TSX_TSCONFIG_PATH: join(source, 'tsconfig.runtime.json'), HOST: '127.0.0.1' },
            });
            child.stderr?.on('data', (chunk: Buffer) => { apiErrors += chunk.toString(); });
            if (!child.pid) throw new Error('API fixture spawn failed');
            pid = child.pid;
            apiChildren.set(pid, child);
          }
          processes.set(pid, { marker: spec.args[0], startedAt, running: true });
          spawned.push(spec.args[0]);
          return { pid, startedAt };
        },
        inspectProcess: async (pid, marker) => {
          const process = processes.get(pid);
          return {
            running: process?.running ?? false,
            identityMatches: process?.marker === marker,
            startedAt: process?.startedAt,
          };
        },
        inspectProcessIdentity: async (pid, marker) => {
          const process = processes.get(pid);
          return { running: process?.running ?? false, markerMatches: process?.marker === marker, startedAt: process?.startedAt };
        },
        stopProcessTree: async (pid) => {
          const process = processes.get(pid);
          const child = apiChildren.get(pid);
          if (child && child.exitCode === null && child.signalCode === null) {
            await new Promise<void>((done) => { child.once('exit', () => done()); child.kill(); });
          }
          if (process) process.running = false;
          return true;
        },
        getPortOccupant: async () => null,
        request: async (url) => {
          requestedUrls.push(url);
          if (url === 'http://r1f/dashboard' || url === 'http://127.0.0.1:3000')
            return { ok: true, status: 200, body: { status: 'ok' } };
          if (url !== 'http://127.0.0.1:' + apiPort + '/health')
            throw new Error('Unexpected control-plane or provider request');
          const response = await fetch(url);
          return { ok: response.ok, status: response.status, body: await response.json() };
        },
        sleep: async (ms) => new Promise((done) => setTimeout(done, ms)),
        now: () => new Date(),
      };
      const specs = [
        { name: 'api' as const, command: 'node', args: ['r1f-api'], marker: 'r1f-api', healthUrl: () => 'http://127.0.0.1:' + apiPort + '/health' },
        { name: 'dashboard' as const, command: 'node', args: ['r1f-dashboard'], marker: 'r1f-dashboard', healthUrl: () => 'http://r1f/dashboard' },
        { name: 'commercial-worker' as const, command: 'node', args: ['r1f-commercial'], marker: 'r1f-commercial' },
        { name: 'whatsapp-dispatch-worker' as const, command: 'node', args: ['r1f-dispatch'], marker: 'r1f-dispatch' },
      ];
      const supervisor = new LocalSystemSupervisor(root, deps, specs, {
        validateRoot: () => true,
        loadEnvironmentFiles: false,
        composeProjectName: project,
        maintenanceDatabase: readMaintenanceDatabase,
      });
      const dangerousEnv = {
        DATABASE_URL: databaseUrl,
        REDIS_URL: redisUrl,
        POSTGRES_HOST_PORT: String(postgresPort),
        REDIS_HOST_PORT: String(redisPort),
        PORT: String(apiPort),
        DASHBOARD_PORT: String(dashboardPort),
        COMMERCIAL_AUTOMATION_MODE: 'send',
        COMMERCIAL_AUTOMATION_ENABLED: 'true',
        COMMERCIAL_SCHEDULER_ENABLED: 'true',
        SHOPEE_AFFILIATE_PROVIDER: 'official',
        SHOPEE_AFFILIATE_API_ENABLED: 'true',
        SHOPEE_AFFILIATE_APP_ID: 'must-not-reach-safe-runtime',
        SHOPEE_AFFILIATE_SECRET: 'must-not-reach-safe-runtime',
        COMMERCIAL_AI_COPY_ENABLED: 'true',
        OPENAI_API_KEY: 'must-not-reach-safe-runtime',
        WHATSAPP_PROVIDER: 'evolution',
        WHATSAPP_GROUP_SEND_ENABLED: 'true',
        EVOLUTION_API_URL: 'http://must-not-be-contacted.invalid',
        EVOLUTION_API_KEY: 'must-not-reach-safe-runtime',
        EVOLUTION_INSTANCE_NAME: 'must-not-reach-safe-runtime',
        SCHEDULER_ENABLED: 'false',
        LOCAL_API_AUTH_TOKEN: 'local-test-token',
      };

      await supervisor.start(dangerousEnv, 'safe-certification');
      expect(spawned).toEqual(['r1f-api', 'r1f-dashboard']);
      expect(commands.some((spec) => spec.args.includes('db:deploy'))).toBe(false);
      expect(commands.some((spec) => spec.args.includes('evolution:up'))).toBe(false);
      expect(readFileSync(join(root, '.runtime/local-system/state.json'), 'utf8')).toContain('safe-certification');
      expect((await supervisor.status(dangerousEnv)).runtimeProfile).toBe('safe-certification');
      await supervisor.stop(dangerousEnv);
      expect(commands.some((spec) => spec.args.includes('evolution:down'))).toBe(false);
      await supervisor.start(dangerousEnv, 'safe-certification');
      await supervisor.stop(dangerousEnv);
      expect(spawned).toEqual(['r1f-api', 'r1f-dashboard', 'r1f-api', 'r1f-dashboard']);
      expect(await automation.getJobScheduler(DEFAULT_COMMERCIAL_AUTOMATION_SCHEDULER_JOB_ID)).toEqual(schedulerBefore);
      const redisAfter = await redisFingerprint();
      const postgresAfter = await databaseFingerprint();
      expect(redisAfter).toBe(redisBefore);
      expect(postgresAfter).toBe(postgresBefore);
      expect(requestedUrls.some((url) => /scheduler|commercial-automation|evolution/.test(url))).toBe(false);
      for (const env of childEnvironments) {
        expect(env.COMMERCIAL_AUTOMATION_ENABLED).toBe('false');
        expect(env.COMMERCIAL_SCHEDULER_ENABLED).toBe('false');
        expect(env.OPENAI_API_KEY).toBeUndefined();
        expect(env.SHOPEE_AFFILIATE_SECRET).toBeUndefined();
        expect(env.EVOLUTION_API_KEY).toBeUndefined();
      }
      console.log(JSON.stringify({ project, postgresPort, redisPort, redisBefore, redisAfter, postgresBefore, postgresAfter, api: 'real', dashboard: 'test-double' }));

      const beforeDriftSpawn = spawned.length;
      await client.$executeRawUnsafe('ALTER TABLE public."ProductLead" ADD COLUMN r1f_drift_probe TEXT');
      await expect(supervisor.start(dangerousEnv, 'safe-certification')).rejects.toMatchObject({ code: 'SAFE_CERTIFICATION_SCHEMA_DRIFT' });
      expect(spawned).toHaveLength(beforeDriftSpawn);
      await client.$executeRawUnsafe('ALTER TABLE public."ProductLead" DROP COLUMN r1f_drift_probe');

      const pending = join(root, 'packages/database/prisma/migrations/99999999999999_r1f_pending');
      mkdirSync(pending);
      writeFileSync(join(pending, 'migration.sql'), 'SELECT 1;');
      await expect(supervisor.start(dangerousEnv, 'safe-certification')).rejects.toMatchObject({ code: 'SAFE_CERTIFICATION_PRESTART_REQUIRED' });
      expect(spawned).toHaveLength(beforeDriftSpawn);
      rmSync(pending, { recursive: true });


      await client.commercialAutomationSettings.update({
        where: { id: 'commercial-automation' },
        data: { paused: false },
      });
      await supervisor.stop(dangerousEnv);
      const beforeBlockedSpawn = spawned.length;
      await expect(supervisor.start(dangerousEnv, 'safe-certification')).rejects.toMatchObject({ code: 'SAFE_CERTIFICATION_PRESTART_REQUIRED' });
      expect(spawned).toHaveLength(beforeBlockedSpawn);
      await client.commercialAutomationSettings.delete({ where: { id: 'commercial-automation' } });
      await expect(supervisor.start(dangerousEnv, 'safe-certification')).rejects.toMatchObject({ code: 'SAFE_CERTIFICATION_PRESTART_REQUIRED' });
      expect(spawned).toHaveLength(beforeBlockedSpawn);
      expect(commands.some((spec) => spec.args.some((arg) => ['db:deploy', 'deploy', 'generate', 'resolve', 'push'].includes(arg)))).toBe(false);
    } finally {
      if (apiErrors) console.log(apiErrors.replace(/postgres(?:ql)?:\/\/\S+/g, '[DISPOSABLE_URL]').slice(-2200));
      for (const child of apiChildren.values()) {
        if (child.exitCode === null && child.signalCode === null) {
          await new Promise<void>((done) => { child.once('exit', () => done()); child.kill(); });
        }
      }
      await Promise.all(queues.map((queue) => queue.close()));
      await connection?.quit();
      await client?.$disconnect();
      if (infrastructure) {
        expect(command(docker, ['compose', '--project-name', project, 'down', '--volumes', '--remove-orphans']).code).toBe(0);
      }
      rmSync(root, { recursive: true, force: true });
    }
  },
  240_000,
);
it.skipIf(!enabled).each(['healthy', 'orphan', 'failure', 'mount'] as const)(
  'R1D2 isolated real PostgreSQL: %s',
  async (scenario) => {
    const source = resolve(import.meta.dirname, '../../..'),
      root = mkdtempSync(join(tmpdir(), 'r1d2-'));
    const project = `r1d2-${randomUUID().slice(0, 8)}`,
      volume = `${project}_postgres_data`,
      probe = `${project}-orphan`,
      blocker = `${project}-rw`;
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
      REDIS_HOST_PORT: '55475',
      PORT: '56333',
      NODE_ENV: 'test',
      COMMERCIAL_AUTOMATION_MODE: 'preview',
      WHATSAPP_PROVIDER: 'mock',
      SHOPEE_AFFILIATE_PROVIDER: 'mock',
      WHATSAPP_GROUP_SEND_ENABLED: 'false',
      SCHEDULER_ENABLED: 'false',
      CHECKPOINT_DISABLE: '1',
    };
    const commands: Array<{ args: string[]; code: number; failure?: string }> =
      [];
    const command = (
      executable: string,
      args: string[],
      commandEnv = env,
      cwd = root,
    ) => {
      const result = spawnSync(executable, args, {
        cwd,
        env: commandEnv,
        encoding: 'utf8',
        windowsHide: true,
        timeout: 120_000,
      });
      commands.push({
        args: args.map((arg) =>
          arg.replace(/postgres(?:ql)?:\/\/\S+/g, '[DISPOSABLE_URL]'),
        ),
        code: result.status ?? 1,
        ...(result.status !== 0
          ? {
              failure: `${result.stdout ?? ''}\n${result.stderr ?? ''}`
                .replace(/postgres(?:ql)?:\/\/\S+/g, '[DISPOSABLE_URL]')
                .slice(-1800),
            }
          : {}),
      });
      return {
        code: result.status ?? 1,
        stdout: result.stdout ?? '',
        stderr: '',
      };
    };
    const checked = (executable: string, args: string[], commandEnv = env) => {
      const result = command(executable, args, commandEnv);
      if (result.code !== 0)
        throw new Error(
          `Fixture command failed: ${args.slice(0, 3).join(' ')} exit ${result.code}`,
        );
      return result.stdout;
    };
    const compose = (args: string[]) =>
      checked(docker, ['compose', '--project-name', project, ...args]);
    const prismaPath = join(
        source,
        'packages/database/node_modules/prisma/build/index.js',
      ),
      schema = join(root, 'packages/database/prisma/schema.prisma');
    let infrastructure = false,
      probeCreated = false,
      blockerCreated = false;
    let deploys = 0,
      restarts = 0,
      requests = 0,
      temporaryPort = 0,
      tries = 0,
      connections = 0,
      writes = 0,
      orphanAlive = false;
    let pendingAfter: number | null = null,
      otherSessions: number | null = null,
      diff = 'NOT_RUN',
      preserved: boolean | null = null;
    const client = createPrismaClient(url);
    const deploymentWindow: {
      before: ProbeSample | null;
      startedAt: string | null;
      samples: Array<ProbeSample & { deployProcessAlive: true }>;
      completedAt: string | null;
    } = { before: null, startedAt: null, samples: [], completedAt: null };
    let failureDiagnostics: {
      successful: number;
      failed: number;
      schemaObjects: number;
    } | null = null;
    let hostOrphan: Awaited<ReturnType<typeof startHostOrphan>> | undefined;
    let hostEvidence: {
      attempts: number;
      connections: number;
      writes: number;
    } | null = null;
    try {
      expect(await listening(55474)).toBe(false);
      expect(await listening(55475)).toBe(false);
      expect(command(docker, ['volume', 'inspect', volume]).code).not.toBe(0);
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
    ports: ['127.0.0.1:55475:6379']
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 1s
      timeout: 3s
      retries: 30
    tmpfs: ['/data']
volumes:
  postgres_data:
`,
      );
      infrastructure = true;
      compose(['up', '-d', '--pull', 'never', '--wait']);
      checked(process.execPath, [
        prismaPath,
        'migrate',
        'deploy',
        '--schema',
        schema,
      ]);
      for (const name of names.slice(-4))
        cpSync(
          join(migrations, name),
          join(root, 'packages/database/prisma/migrations', name),
          { recursive: true },
        );
      if (scenario === 'orphan') {
        // The real deploy must outlast two host connection timeouts. Extend only
        // this disposable SQL copy; keep the live-attempt assertions unchanged.
        const fixtureMigration = join(root, 'packages/database/prisma/migrations', names[names.length - 1], 'migration.sql');
        writeFileSync(fixtureMigration, readFileSync(fixtureMigration, 'utf8') + '\nSELECT pg_sleep(5);\n');
      }
      const product = await client.productLead.create({
        data: {
          providerProductId: 'fixture',
          nome: 'fixture',
          categoria: 'fixture',
          preco: '10',
          desconto: 0,
          nota: 5,
          vendidos: 1,
          comissao: 1,
          loja: 'fixture',
          urlImagem: 'https://example.invalid/image',
          title: 'fixture',
        },
      });
      const copy = await client.generatedCopy.create({
        data: {
          productId: product.id,
          titulo: 'fixture',
          mensagem: 'fixture',
          cta: 'fixture',
          hashtags: '',
        },
      });
      const destination = await client.whatsAppDestination.create({
        data: {
          name: 'fixture',
          destination: 'fixture.invalid',
          active: false,
        },
      });
      await client.whatsAppDispatch.create({
        data: {
          productId: product.id,
          generatedCopyId: copy.id,
          destinationId: destination.id,
          status: 'PROCESSING',
          attemptCount: 1,
        },
      });
      await client.$disconnect();
      const before = await readMaintenanceDatabase(root, url);
      expect(before.pending).toEqual(names.slice(-4));
      writeState(root, {
        version: 1,
        composeProjectName: project,
        maintenance: true,
        startedAt: new Date().toISOString(),
        mode: 'preview',
        ports: {
          api: 56333,
          dashboard: 3000,
          postgres: 55474,
          redis: 55475,
          evolution: 8080,
        },
        processes: {},
      });
      // This live orphan knows only postgres:5432 in the disposable project network.
      // No Docker socket, runtime DSN or maintenance port is available to it.
      const canonicalId = compose(['ps', '-q', 'postgres']).trim();
      const canonicalIp = checked(docker, [
        'inspect',
        '--format',
        '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',
        canonicalId,
      ]).trim();
      const script = `mkdir /tmp/events; t=0; while [ ! -f /tmp/finish ]; do if [ -f /tmp/ddl ]; then t=$((t+1)); touch /tmp/events/s$t; (if psql -X -qt -p 5432 -U postgres -d shopee_auto_affiliate_ai -c 'SELECT 1' >/dev/null 2>&1; then touch /tmp/events/c$t; if psql -X -qt -p 5432 -U postgres -d shopee_auto_affiliate_ai -c 'UPDATE public."CommercialAutomationSettings" SET paused=true' >/dev/null 2>&1; then touch /tmp/events/w$t; fi; fi; touch /tmp/events/d$t)& fi; sleep 0.05; done; wait; touch /tmp/complete; while true; do sleep 1; done`;
      checked(docker, [
        'run',
        '-d',
        '--name',
        probe,
        '--network',
        `${project}_default`,
        '-e',
        'PGCONNECT_TIMEOUT=1',
        '-e',
        `PGHOST=${canonicalIp}`,
        '--tmpfs',
        '/var/lib/postgresql/data',
        '--entrypoint',
        'sh',
        'postgres:16-alpine',
        '-c',
        script,
      ]);
      probeCreated = true;
      // Positive control proves the same orphan can reach the original before shutdown.
      expect(
        checked(docker, [
          'exec',
          probe,
          'psql',
          '-X',
          '-qt',
          '-h',
          canonicalIp,
          '-p',
          '5432',
          '-U',
          'postgres',
          '-d',
          'shopee_auto_affiliate_ai',
          '-c',
          'SELECT 1',
        ]).trim(),
      ).toBe('1');
      if (scenario === 'orphan')
        hostOrphan = await startHostOrphan(root, url, env);
      const networkSnapshot = (): Counters => {
        const counts = checked(docker, [
          'exec',
          probe,
          'sh',
          '-c',
          'for p in s c w d; do find /tmp/events -name "$p*" | wc -l; done',
        ])
          .trim()
          .split(/\s+/)
          .map(Number);
        if (
          counts.length !== 4 ||
          counts.some((value) => !Number.isInteger(value) || value < 0)
        )
          throw new Error('Invalid probe counters');
        return {
          attempts: counts[0],
          connections: counts[1],
          writes: counts[2],
          completed: counts[3],
        };
      };
      const sample = async (): Promise<ProbeSample> => ({
        at: new Date().toISOString(),
        network: networkSnapshot(),
        host: hostOrphan ? await hostOrphan.snapshot() : null,
      });
      const liveDeploy = async (spec: CommandSpec) => {
        deploymentWindow.before = await sample();
        let exited = false,
          stdout = '',
          stderr = '';
        deploymentWindow.startedAt = new Date().toISOString();
        const child = spawn(spec.command, spec.args, {
          cwd: spec.cwd,
          env: spec.env,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
          stdout += chunk;
        });
        child.stderr.on('data', (chunk: string) => {
          stderr += chunk;
        });
        const completion = new Promise<number>((done) => {
          child.once('error', () => {
            exited = true;
            done(1);
          });
          child.once('close', (code) => {
            exited = true;
            done(code ?? 1);
          });
        });
        // Enable attempts only after the actual deployment process has been spawned.
        checked(docker, ['exec', probe, 'touch', '/tmp/ddl']);
        hostOrphan?.begin();
        while (!exited) {
          await new Promise((done) => setTimeout(done, 50));
          if (exited) break;
          const observation = await sample();
          // Let queued exit events run; also check the exact owned PID in the OS.
          await new Promise<void>((done) => setImmediate(done));
          if (!exited && child.pid) {
            try {
              process.kill(child.pid, 0);
              deploymentWindow.samples.push({
                ...observation,
                deployProcessAlive: true,
              });
            } catch {
              /* exited during sample */
            }
          }
        }
        const code = await completion;
        deploymentWindow.completedAt = new Date().toISOString();
        commands.push({
          args: spec.args,
          code,
          ...(code !== 0
            ? {
                failure: (stdout + '\n' + stderr)
                  .replace(/postgres(?:ql)?:\/\/\S+/g, '[DISPOSABLE_URL]')
                  .slice(-1800),
              }
            : {}),
        });
        const baseline = deploymentWindow.before;
        expect(deploymentWindow.samples.length).toBeGreaterThanOrEqual(2);
        const first = deploymentWindow.samples[0];
        const last =
          deploymentWindow.samples[deploymentWindow.samples.length - 1];
        // A dormant loop with historical nonzero counters cannot satisfy this gate.
        expect(last.network.attempts).toBeGreaterThan(first.network.attempts);
        if (hostOrphan)
          expect(last.host?.attempts).toBeGreaterThan(
            first.host?.attempts ?? Infinity,
          );
        expect(
          deploymentWindow.samples.some(
            (s) => s.network.attempts > baseline.network.attempts,
          ),
        ).toBe(true);
        if (hostOrphan)
          expect(
            deploymentWindow.samples.some(
              (s) =>
                s.host &&
                baseline.host &&
                s.host.attempts > baseline.host.attempts,
            ),
          ).toBe(true);
        for (const s of deploymentWindow.samples) {
          expect(s.network.connections).toBe(0);
          expect(s.network.writes).toBe(0);
          if (s.host) {
            expect(s.host.connections).toBe(0);
            expect(s.host.writes).toBe(0);
          }
        }
        checked(docker, ['exec', probe, 'touch', '/tmp/finish']);
        for (let poll = 0; poll < 60; poll++) {
          const counts = networkSnapshot();
          if (counts.completed === counts.attempts) break;
          await new Promise((done) => setTimeout(done, 100));
        }
        const final = networkSnapshot();
        expect(final.completed).toBe(final.attempts);
        return { code, stdout, stderr: '' };
      };
      const boundaryFailures: unknown[] = [];
      const runFixtureCommand = async (spec: CommandSpec) => {
        if (spec.command === 'docker') {
          if (spec.args[0] === 'volume' && spec.args[1] === 'ls')
            return command(docker, [
              'volume',
              'ls',
              '--filter',
              `label=com.docker.compose.project=${project}`,
              '--format',
              '{{.Name}}',
            ]);
          return command(docker, spec.args, spec.env, spec.cwd);
        }
        const tempUrl = spec.env?.DATABASE_URL;
        if (!tempUrl) throw new Error('Missing fixture datasource');
        temporaryPort = Number(new URL(tempUrl).port);
        expect(temporaryPort).not.toBe(5432);
        expect(temporaryPort).not.toBe(55474);
        if (spec.args.includes('db:deploy')) {
          deploys++;
          expect(await listening(55474)).toBe(false);
          otherSessions = (await readMaintenanceDatabase(root, tempUrl))
            .otherSessions;
          expect(otherSessions).toBe(0);
          orphanAlive =
            checked(docker, [
              'inspect',
              '--format',
              '{{.State.Running}}',
              probe,
            ]).trim() === 'true';
          expect(orphanAlive).toBe(true);
          if (hostOrphan) expect(hostOrphan.alive()).toBe(true);
          if (scenario === 'failure') {
            const failure = join(
              root,
              'packages/database/prisma/migrations/99999999999999_fixture_failure',
            );
            mkdirSync(failure);
            writeFileSync(
              join(failure, 'migration.sql'),
              'SELECT r1d2_intentionally_missing_function();',
            );
          }
        }
        const result = spec.args.includes('db:deploy')
          ? await liveDeploy(spec)
          : command(spec.command, spec.args, spec.env, spec.cwd);
        if (spec.args.includes('db:deploy')) {
          expect(deploys).toBe(1);
          expect(await listening(55474)).toBe(false);
          const counts = networkSnapshot();
          tries = counts.attempts;
          connections = counts.connections;
          writes = counts.writes;
          expect(tries).toBeGreaterThan(0);
          expect(connections).toBe(0);
          expect(writes).toBe(0);
          if (hostOrphan) {
            expect(hostOrphan.alive()).toBe(true);
            hostEvidence = await hostOrphan.snapshot();
            expect(hostEvidence.attempts).toBeGreaterThan(0);
            expect(hostEvidence.connections).toBe(0);
            expect(hostEvidence.writes).toBe(0);
          }
          expect(
            checked(docker, [
              'inspect',
              '--format',
              '{{.State.Running}}',
              probe,
            ]).trim(),
          ).toBe('true');
          if (scenario !== 'failure') {
            const after = await readMaintenanceDatabase(root, tempUrl);
            pendingAfter = after.pending.length;
            preserved =
              after.dispatchFingerprint === before.dispatchFingerprint;
            expect(preserved).toBe(true);
            expect(after.systemIdentifier).toBe(before.systemIdentifier);
            expect(after.paused).toBe(true);
          } else {
            const failedClient = createPrismaClient(tempUrl);
            try {
              const fingerprints = await failedClient.$queryRaw<
                Array<{ fingerprint: string }>
              >`SELECT md5(COALESCE(string_agg(md5(row_to_json(d)::text), '' ORDER BY d.id), '')) AS fingerprint FROM public."WhatsAppDispatch" d`;
              preserved =
                fingerprints[0]?.fingerprint === before.dispatchFingerprint;
              expect(preserved).toBe(true);
            } finally {
              await failedClient.$disconnect();
            }
          }
        }
        if (spec.args.includes('diff') && result.code === 0)
          diff = 'EMPTY_EXIT_0';
        return result;
      };
      const deps: SystemDependencies = {
        run: async (spec) => {
          try {
            return await runFixtureCommand(spec);
          } catch (error) {
            // The supervisor maps command rejection to a deploy failure. Keep
            // fixture assertions observable outside that expected-error boundary.
            boundaryFailures.push(error);
            throw error;
          }
        },
        spawn: async () => {
          restarts++;
          throw new Error('Spawn prohibited');
        },
        inspectProcess: async () => ({
          running: false,
          identityMatches: false,
        }),
        inspectProcessIdentity: async (pid) => ({
          running: pid === process.pid,
          markerMatches: pid === process.pid,
          startedAt: new Date().toISOString(),
        }),
        stopProcessTree: async () => {
          throw new Error('No registered OS process');
        },
        // Namespace adapter: original 5432 maps to fixture host 55474; operational 5432 is NEVER probed.
        getPortOccupant: async (port) =>
          (await listening(port === 5432 ? 55474 : port))
            ? { processName: 'fixture' }
            : null,
        request: async () => {
          requests++;
          throw new Error('HTTP prohibited');
        },
        sleep: async (ms) => {
          await new Promise((done) => setTimeout(done, ms));
        },
        now: () => new Date(),
      };
      if (scenario === 'mount') {
        checked(docker, [
          'create',
          '--name',
          blocker,
          '--mount',
          `type=volume,src=${volume},dst=/var/lib/postgresql/data`,
          'postgres:16-alpine',
        ]);
        blockerCreated = true;
      }
      const supervisor = new LocalSystemSupervisor(root, deps, [], {
        composeProjectName: project,
        operationLockRoot: root,
        validateRoot: () => true,
        loadEnvironmentFiles: false,
      });
      const release = await acquireLock(root, 'migrate', deps);
      try {
        if (scenario === 'failure' || scenario === 'mount')
          await expect(supervisor.migrate(true, env)).rejects.toMatchObject({
            code:
              scenario === 'failure'
                ? 'SYSTEM_MAINTENANCE_DEPLOY_FAILED'
                : 'SYSTEM_MAINTENANCE_VOLUME_CONCURRENT_MOUNT',
          });
        else {
          await expect(supervisor.migrate(true, env)).resolves.toMatchObject({
            pendingBefore: 4,
            pendingAfter: 0,
            migrationExecutionCount: 1,
            ddlSafetyDependsOnCompleteTreeAdoption: false,
          });
          expect(diff).toBe('EMPTY_EXIT_0');
        }
      } finally {
        release();
      }
      expect(boundaryFailures).toEqual([]);
      if (scenario !== 'mount') {
        expect(preserved).toBe(true);
        expect(deploymentWindow.samples.length).toBeGreaterThanOrEqual(2);
        const first = deploymentWindow.samples[0];
        const last =
          deploymentWindow.samples[deploymentWindow.samples.length - 1];
        expect(last.network.attempts).toBeGreaterThan(first.network.attempts);
        if (hostOrphan)
          expect(last.host?.attempts).toBeGreaterThan(
            first.host?.attempts ?? Infinity,
          );
        expect(connections).toBe(0);
        expect(writes).toBe(0);
      }
      expect(deploys).toBe(scenario === 'mount' ? 0 : 1);
      if (scenario === 'failure') {
        const log = readFileSync(
          join(root, '.runtime/local-system/supervisor.log'),
          'utf8',
        );
        const diagnostics: unknown = JSON.parse(
          /sanitizedReadback=(\{[^\n]+\}); no retry/.exec(log)?.[1] ?? 'null',
        );
        if (
          diagnostics === null ||
          typeof diagnostics !== 'object' ||
          !('failed' in diagnostics) ||
          typeof diagnostics.failed !== 'number' ||
          !('successful' in diagnostics) ||
          typeof diagnostics.successful !== 'number' ||
          !('schemaObjects' in diagnostics) ||
          typeof diagnostics.schemaObjects !== 'number'
        )
          throw new Error('Failure diagnostics missing');
        failureDiagnostics = {
          failed: diagnostics.failed,
          successful: diagnostics.successful,
          schemaObjects: diagnostics.schemaObjects,
        };
        expect(failureDiagnostics.failed).toBe(1);
        expect(failureDiagnostics.successful).toBe(38);
        expect(failureDiagnostics.schemaObjects).toBeGreaterThan(0);
      }
      expect(restarts).toBe(0);
      expect(requests).toBe(0);
      expect(
        checked(docker, [
          'ps',
          '-aq',
          '--filter',
          `label=shopee.r1d.project=${project}`,
        ]).trim(),
      ).toBe('');
      expect(await listening(55474)).toBe(false);
      expect(compose(['ps', '--status', 'running', '-q']).trim()).toBe('');
      expect(
        checked(docker, [
          'volume',
          'ls',
          '--filter',
          `label=com.docker.compose.project=${project}`,
          '--format',
          '{{.Name}}',
        ]).trim(),
      ).toBe(volume);
      if (process.env.R1D_EVIDENCE_PATH)
        writeFileSync(
          process.env.R1D_EVIDENCE_PATH.replace(/\.json$/, `-${scenario}.json`),
          JSON.stringify(
            {
              scenario,
              hostEvidence,
              deploymentWindow,
              failureDiagnostics,
              status: 'PASS',
              project,
              originalFixtureHostPort: 55474,
              originalOrphanNetworkPort: 5432,
              originalHost5432: 'NOT_PROBED_OPERATIONAL',
              boundary:
                'Real Docker network postgres:5432 with host-port adapter 55474; not an operational-host-port test',
              orphanAliveDuringDeploy: orphanAlive,
              orphanTries: tries,
              orphanConnections: connections,
              orphanWrites: writes,
              temporaryPort,
              otherSessions,
              migrationExecutionCount: deploys,
              migrationRetryCount: 0,
              pendingBefore: 4,
              pendingAfter,
              diff,
              dispatchPreserved: preserved,
              tempContainerRemoved: true,
              canonicalFixtureVolumePreserved: true,
              applicationRestarts: restarts,
              requests,
              commands,
            },
            null,
            2,
          ),
        );
    } finally {
      await hostOrphan?.stop();
      if (process.env.R1D_EVIDENCE_PATH)
        writeFileSync(
          process.env.R1D_EVIDENCE_PATH.replace(
            /\.json$/,
            `-${scenario}-commands.json`,
          ),
          JSON.stringify({ scenario, commands, deploymentWindow }, null, 2),
        );
      await client.$disconnect();
      if (probeCreated) checked(docker, ['rm', '-f', probe]);
      if (blockerCreated) checked(docker, ['rm', blocker]);
      for (const id of checked(docker, [
        'ps',
        '-aq',
        '--filter',
        `label=shopee.r1d.project=${project}`,
      ])
        .trim()
        .split(/\s+/)
        .filter(Boolean))
        checked(docker, ['rm', '-f', id]);
      if (infrastructure) compose(['down', '--volumes']);
      // This directory was returned by mkdtemp for this test only.
      rmSync(root, { recursive: true, force: true });
    }
  },
  240_000,
);
