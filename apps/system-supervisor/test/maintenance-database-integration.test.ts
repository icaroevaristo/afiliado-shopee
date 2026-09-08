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
import { createConnection } from 'node:net';
import { randomUUID } from 'node:crypto';
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
