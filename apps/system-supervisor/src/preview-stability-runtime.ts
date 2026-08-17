import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { loadConfig } from '@shopee-auto-affiliate-ai/config';
import {
  DEFAULT_COMMERCIAL_AUTOMATION_SCHEDULER_JOB_ID,
  createCommercialAutomationQueue,
  createProductPipelineQueue,
  createRedisConnection,
  createWhatsAppDispatchQueue,
} from '@shopee-auto-affiliate-ai/queue';

import { loadLocalSystemEnvironment } from './environment';
import {
  fingerprintValues,
  PreviewStabilityMainInfrastructureError,
  type PreviewStabilityDependencies,
  type PreviewStabilityEvidence,
  type PreviewStabilityInfrastructure,
  type PreviewStabilityReport,
} from './preview-stability';
import { readState, runtimeDirectory } from './state-store';
import { createSystemDependencies } from './system-dependencies';
import {
  createServiceSpecs,
  LocalSystemSupervisor,
  parseComposeStatuses,
  resolveEquivalentMainServiceContainer,
} from './supervisor';
import { LocalSystemError, type SystemDependencies } from './types';

const QUEUE_JOB_TYPES = [
  'wait',
  'active',
  'completed',
  'failed',
  'delayed',
  'paused',
  'prioritized',
  'waiting-children',
] as const;

const commandSucceeded = (
  result: { code: number },
  code: string,
  message: string,
) => {
  if (result.code !== 0) throw new LocalSystemError(message, code);
};

const systemCommandSucceeded = (
  result: { code: number; stderr: string },
  fallbackCode: string,
  message: string,
) => {
  if (result.code === 0) return;
  const reportedCode = /^([A-Z][A-Z0-9_]+):/m.exec(result.stderr)?.[1];
  throw new LocalSystemError(message, reportedCode ?? fallbackCode);
};

const DATABASE_HELPER_CAPTURE_STAGES = [
  'migrations', 'settings', 'executions', 'runs-total', 'runs-dry-run',
  'runs-ambiguous', 'runs-investigation', 'dispatch-total',
  'dispatch-processing', 'outbox-total', 'outbox-pending',
  'outbox-ambiguous', 'table-counts',
] as const;

type DatabaseHelperFailureDiagnostic = {
  code: 'PREVIEW_STABILITY_DATABASE_HELPER_FAILED';
  operation: 'capture' | 'executions' | 'group-instance' | 'force-pause' | 'unknown';
  captureStage?: (typeof DATABASE_HELPER_CAPTURE_STAGES)[number];
  captureSubstage?: 'inspect' | 'diff';
  errorKind: 'PRISMA' | 'PRISMA_VALIDATION' | 'PRISMA_UNKNOWN' |
    'PRISMA_INITIALIZATION' | 'DATABASE_BASELINE' | 'SYSTEM' | 'UNKNOWN';
  errorCode?: string;
  failed: true;
};

const SAFE_DATABASE_HELPER_SYSTEM_CODES = new Set(['ENOENT','EACCES','ETIMEDOUT','ECONNREFUSED','EPIPE']);
const SAFE_DATABASE_BASELINE_ERROR_CODES = new Set([
  'DATABASE_BASELINE_ADOPTION_BLOCKED',
  'DATABASE_BASELINE_ARGUMENTS_INVALID',
  'DATABASE_BASELINE_DRIFT_CHECK_FAILED',
  'DATABASE_BASELINE_POSTCHECK_FAILED',
  'DATABASE_BASELINE_RESOLVE_FAILED',
]);

export const parseDatabaseHelperFailureDiagnostic = (
  stderr: string,
): DatabaseHelperFailureDiagnostic | null => {
  const lines = stderr.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).reverse();
  for (const line of lines) {
    let value: unknown;
    try { value = JSON.parse(line); } catch { continue; }
    if (typeof value !== 'object' || value === null) continue;
    const code = Reflect.get(value, 'code');
    const operation = Reflect.get(value, 'operation');
    const captureStage = Reflect.get(value, 'captureStage');
    const captureSubstage = Reflect.get(value, 'captureSubstage');
    const errorKind = Reflect.get(value, 'errorKind');
    const errorCode = Reflect.get(value, 'errorCode');
    const failed = Reflect.get(value, 'failed');
    if (
      code !== 'PREVIEW_STABILITY_DATABASE_HELPER_FAILED' ||
      !['capture','executions','group-instance','force-pause','unknown'].includes(typeof operation === 'string' ? operation : '') ||
      !['PRISMA','PRISMA_VALIDATION','PRISMA_UNKNOWN','PRISMA_INITIALIZATION','DATABASE_BASELINE','SYSTEM','UNKNOWN'].includes(typeof errorKind === 'string' ? errorKind : '') ||
      failed !== true
    ) continue;
    const validStage = typeof captureStage === 'string' && DATABASE_HELPER_CAPTURE_STAGES.includes(captureStage as (typeof DATABASE_HELPER_CAPTURE_STAGES)[number]);
    if (operation === 'capture' && !validStage) continue;
    if (operation !== 'capture' && captureStage !== undefined) continue;
    const validSubstage = captureSubstage === 'inspect' || captureSubstage === 'diff';
    if (operation === 'capture' && captureStage === 'migrations' && !validSubstage) continue;
    if ((operation !== 'capture' || captureStage !== 'migrations') && captureSubstage !== undefined) continue;
    const safeCode =
      (errorKind === 'PRISMA' || errorKind === 'PRISMA_INITIALIZATION') && typeof errorCode === 'string' && /^P\d{4}$/.test(errorCode)
        ? errorCode
        : errorKind === 'DATABASE_BASELINE' && typeof errorCode === 'string' && SAFE_DATABASE_BASELINE_ERROR_CODES.has(errorCode)
          ? errorCode
          : errorKind === 'SYSTEM' && typeof errorCode === 'string' && SAFE_DATABASE_HELPER_SYSTEM_CODES.has(errorCode)
            ? errorCode
            : undefined;
    if (errorKind === 'PRISMA' && !safeCode) continue;
    if (errorKind === 'SYSTEM' && !safeCode) continue;
    if (['PRISMA_VALIDATION','PRISMA_UNKNOWN','UNKNOWN'].includes(String(errorKind)) && errorCode !== undefined) continue;
    if (['PRISMA_INITIALIZATION','DATABASE_BASELINE'].includes(String(errorKind)) && errorCode !== undefined && !safeCode) continue;
    return {
      code,
      operation: operation as DatabaseHelperFailureDiagnostic['operation'],
      ...(operation === 'capture' ? { captureStage: captureStage as DatabaseHelperFailureDiagnostic['captureStage'] } : {}),
      ...(operation === 'capture' && captureStage === 'migrations'
        ? { captureSubstage: captureSubstage as 'inspect' | 'diff' }
        : {}),
      errorKind: errorKind as DatabaseHelperFailureDiagnostic['errorKind'],
      ...(safeCode ? { errorCode: safeCode } : {}),
      failed: true,
    };
  }
  return null;
};
const asJobIds = (jobs: Array<{ id?: string }>) =>
  jobs.flatMap((job) => (job.id ? [job.id] : [])).sort();

const collectPages = async <T>(
  readPage: (start: number, end: number) => Promise<T[]>,
) => {
  const values: T[] = [];
  const pageSize = 500;
  for (let start = 0; ; start += pageSize) {
    const page = await readPage(start, start + pageSize - 1);
    values.push(...page);
    if (page.length < pageSize) return values;
  }
};

const captureQueueEvidence = async (environment: NodeJS.ProcessEnv) => {
  const config = loadConfig(environment);
  const connection = createRedisConnection(config.REDIS_URL);
  const commercial = createCommercialAutomationQueue(connection);
  const whatsapp = createWhatsAppDispatchQueue(connection);
  const product = createProductPipelineQueue(connection);
  try {
    const [
      commercialJobs,
      whatsappJobs,
      productJobs,
      commercialSchedulers,
      legacySchedulers,
    ] = await Promise.all([
      collectPages((start, end) =>
        commercial.getJobs([...QUEUE_JOB_TYPES], start, end, true),
      ),
      collectPages((start, end) =>
        whatsapp.getJobs([...QUEUE_JOB_TYPES], start, end, true),
      ),
      collectPages((start, end) =>
        product.getJobs([...QUEUE_JOB_TYPES], start, end, true),
      ),
      collectPages((start, end) =>
        commercial.getJobSchedulers(start, end, true),
      ),
      collectPages((start, end) => product.getJobSchedulers(start, end, true)),
    ]);
    return {
      commercialJobIds: asJobIds(commercialJobs),
      whatsappJobIds: asJobIds(whatsappJobs),
      productJobIds: asJobIds(productJobs),
      commercialSchedulerIds: commercialSchedulers
        .map((scheduler) => scheduler.key)
        .sort(),
      legacySchedulerIds: legacySchedulers
        .map((scheduler) => scheduler.key)
        .sort(),
    };
  } finally {
    await Promise.allSettled([
      commercial.close(),
      whatsapp.close(),
      product.close(),
    ]);
    await connection.quit().catch(() => connection.disconnect());
  }
};

const createSystemCommand = (
  root: string,
  command: 'start' | 'stop',
  environment: NodeJS.ProcessEnv,
) => {
  const rootRequire = createRequire(resolve(root, 'package.json'));
  return {
    command: process.execPath,
    args: [
      rootRequire.resolve('tsx/cli'),
      '--tsconfig',
      resolve(root, 'tsconfig.runtime.json'),
      resolve(root, 'apps/system-supervisor/src/cli.ts'),
      command,
    ],
    cwd: root,
    env: environment,
  };
};

const createDatabaseHelperCommand = (
  root: string,
  command: 'capture' | 'executions' | 'force-pause' | 'group-instance',
  environment: NodeJS.ProcessEnv,
) => {
  const rootRequire = createRequire(resolve(root, 'package.json'));
  return {
    command: process.execPath,
    args: [
      rootRequire.resolve('tsx/cli'),
      '--tsconfig',
      resolve(root, 'tsconfig.runtime.json'),
      resolve(
        root,
        'apps/system-supervisor/src/preview-stability-database-helper.ts',
      ),
      command,
    ],
    cwd: root,
    env: environment,
  };
};

const waitForComposeService = async (
  root: string,
  dependencies: SystemDependencies,
  service: 'postgres' | 'redis',
  environment: NodeJS.ProcessEnv,
) => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = await dependencies.run({
      command: 'docker',
      args: ['compose', 'ps', '--format', 'json'],
      cwd: root,
      env: environment,
    });
    const current = parseComposeStatuses(result.stdout).find(
      (item) => item.service === service,
    );
    if (
      result.code === 0 &&
      current?.state === 'running' &&
      current.health === 'healthy'
    ) {
      return;
    }
    await dependencies.sleep(1_000);
  }
  throw new LocalSystemError(
    `${service} nao ficou saudavel`,
    `PREVIEW_STABILITY_${service.toUpperCase()}_UNHEALTHY`,
  );
};

const waitForResolvedMainServiceHealth = async (
  root: string,
  dependencies: SystemDependencies,
  service: 'postgres' | 'redis',
  containerId: string,
  environment: NodeJS.ProcessEnv,
  ports: ReturnType<typeof loadLocalSystemEnvironment>['ports'],
) => {
  let observedHealth:
    | 'healthy'
    | 'starting'
    | 'unhealthy'
    | 'unavailable'
    | 'unknown' = 'unknown';
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const resolution = await resolveEquivalentMainServiceContainer(
      root,
      dependencies,
      environment,
      ports,
      service,
    );
    if (resolution.status === 'ambiguous') {
      throw new PreviewStabilityMainInfrastructureError(
        `PREVIEW_STABILITY_${service.toUpperCase()}_UNHEALTHY`,
        {
          mainInfraStage: 'health',
          service,
          operation: 'restart',
          commandKind: 'discovery',
          errorCode: 'AMBIGUOUS_OWNERSHIP',
          observedHealth: 'unknown',
          expectedHealth: 'healthy',
        },
      );
    }
    if (
      resolution.status === 'resolved' &&
      resolution.container.id === containerId
    ) {
      observedHealth = resolution.container.health;
      if (resolution.container.health === 'healthy') return;
    } else {
      observedHealth = 'unavailable';
    }
    await dependencies.sleep(1_000);
  }
  throw new PreviewStabilityMainInfrastructureError(
    `PREVIEW_STABILITY_${service.toUpperCase()}_UNHEALTHY`,
    {
      mainInfraStage: 'health',
      service,
      operation: 'restart',
      commandKind: 'discovery',
      errorCode: 'HEALTH_TIMEOUT',
      observedHealth,
      expectedHealth: 'healthy',
    },
  );
};

const isExplicitSafePreviewEvolutionIsolation = (environment: NodeJS.ProcessEnv) =>
  environment.COMMERCIAL_AUTOMATION_MODE === 'preview' &&
  environment.WHATSAPP_PROVIDER === 'mock' &&
  environment.WHATSAPP_GROUP_SEND_ENABLED === 'false';

const managedVolumes = (stdout: string, includeEvolution: boolean) =>
  stdout
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter((value) =>
      includeEvolution
        ? /^(afiliado-shopee|shopee-evolution)/i.test(value)
        : /^afiliado-shopee/i.test(value),
    );

export const stopValidatedManagedProcess = async ({
  service,
  state,
  specs,
  dependencies,
}: {
  service: 'api' | 'commercial-worker';
  state: ReturnType<typeof readState>;
  specs: ReturnType<typeof createServiceSpecs>;
  dependencies: SystemDependencies;
}) => {
  const registered = state?.processes[service];
  const spec = specs.find((item) => item.name === service);
  if (!registered || !spec) {
    throw new LocalSystemError(
      'Processo gerenciado nao encontrado',
      'PREVIEW_STABILITY_MANAGED_PROCESS_NOT_FOUND',
    );
  }
  const inspection = await dependencies.inspectProcess(
    registered.pid,
    spec.marker,
    registered.startedAt,
  );
  if (!inspection.running || !inspection.identityMatches) {
    throw new LocalSystemError(
      'Identidade do processo gerenciado divergiu',
      'PREVIEW_STABILITY_MANAGED_PROCESS_IDENTITY_MISMATCH',
    );
  }
  if (!(await dependencies.stopProcessTree(registered.pid))) {
    throw new LocalSystemError(
      'Processo gerenciado nao encerrou',
      'PREVIEW_STABILITY_MANAGED_PROCESS_STOP_FAILED',
    );
  }
};

export const createPreviewStabilityDependencies = (
  root: string,
  dependencies: SystemDependencies = createSystemDependencies(),
): PreviewStabilityDependencies => {
  const supervisor = new LocalSystemSupervisor(root, dependencies);
  const environmentCache = new WeakMap<NodeJS.ProcessEnv, NodeJS.ProcessEnv>();
  const loadedEnvironment = (environment: NodeJS.ProcessEnv) => {
    const cached = environmentCache.get(environment);
    if (cached) return cached;
    const loaded = loadLocalSystemEnvironment(root, environment).env;
    environmentCache.set(environment, loaded);
    return loaded;
  };
  const runDatabaseHelper = async <T>(
    command: 'capture' | 'executions' | 'force-pause' | 'group-instance',
    environment: NodeJS.ProcessEnv,
  ) => {
    const result = await dependencies.run(
      createDatabaseHelperCommand(root, command, environment),
    );
    if (result.code !== 0) {
      const diagnostic = parseDatabaseHelperFailureDiagnostic(result.stderr);
      if (diagnostic) {
        console.error(
          JSON.stringify({
            event: 'preview-stability.database-helper.failed',
            ...diagnostic,
          }),
        );
      }
      throw new LocalSystemError(
        'Falha na captura isolada de evidencia do banco',
        'PREVIEW_STABILITY_DATABASE_HELPER_FAILED',
      );
    }
    try {
      return JSON.parse(result.stdout) as T;
    } catch {
      throw new LocalSystemError(
        'Evidencia do banco retornou formato invalido',
        'PREVIEW_STABILITY_DATABASE_HELPER_INVALID',
      );
    }
  };
  return {
    now: () => dependencies.now(),
    sleep: (milliseconds) => dependencies.sleep(milliseconds),
    status: (environment) => supervisor.status(loadedEnvironment(environment)),
    async prepareMainInfrastructure(environment, reuseManagedInfrastructure) {
      if (reuseManagedInfrastructure) return;
      const env = loadedEnvironment(environment);
      const dockerInfo = await dependencies.run({
        command: 'docker',
        args: ['info'],
        cwd: root,
        env,
      });
      commandSucceeded(
        dockerInfo,
        'DOCKER_DAEMON_UNAVAILABLE',
        'Docker daemon indisponivel',
      );
      const started = await dependencies.run({
        command: 'docker',
        args: ['compose', 'up', '-d', 'postgres', 'redis'],
        cwd: root,
        env,
      });
      commandSucceeded(
        started,
        'PREVIEW_STABILITY_MAIN_INFRA_START_FAILED',
        'Falha ao iniciar infraestrutura principal para o preflight',
      );
      await Promise.all([
        waitForComposeService(root, dependencies, 'postgres', env),
        waitForComposeService(root, dependencies, 'redis', env),
      ]);
    },
    async stopMainInfrastructure(environment) {
      const result = await dependencies.run({
        command: 'docker',
        args: ['compose', 'stop', 'postgres', 'redis'],
        cwd: root,
        env: loadedEnvironment(environment),
      });
      commandSucceeded(
        result,
        'PREVIEW_STABILITY_MAIN_INFRA_STOP_FAILED',
        'Falha ao parar infraestrutura principal',
      );
    },
    async startSystem(environment) {
      const env = loadedEnvironment(environment);
      const result = await dependencies.run(
        createSystemCommand(root, 'start', env),
      );
      systemCommandSucceeded(
        result,
        'PREVIEW_STABILITY_SYSTEM_START_FAILED',
        'system:start falhou durante a validacao',
      );
      return supervisor.status(env);
    },
    async stopSystem(environment) {
      const env = loadedEnvironment(environment);
      const result = await dependencies.run(
        createSystemCommand(root, 'stop', env),
      );
      systemCommandSucceeded(
        result,
        'PREVIEW_STABILITY_SYSTEM_STOP_FAILED',
        'system:stop falhou durante a validacao',
      );
    },
    async setAutomationPaused(paused, environment) {
      const loaded = loadLocalSystemEnvironment(root, environment);
      const token = loaded.env.LOCAL_API_AUTH_TOKEN?.trim();
      if (!token) {
        throw new LocalSystemError(
          'Autenticacao local indisponivel para alterar a pausa',
          'PREVIEW_STABILITY_PAUSE_UPDATE_FAILED',
        );
      }
      let response: Response;
      try {
        response = await fetch(
          `http://127.0.0.1:${loaded.ports.api}/commercial-automation/settings`,
          {
            method: 'PATCH',
            headers: {
              authorization: `Bearer ${token}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify(
              paused
                ? { paused: true }
                : {
                    paused: false,
                    confirmation: 'RETOMAR_AUTOMACAO_COMERCIAL',
                  },
            ),
            signal: AbortSignal.timeout(5_000),
          },
        );
      } catch {
        throw new LocalSystemError(
          'Falha na alteracao temporaria da pausa',
          'PREVIEW_STABILITY_PAUSE_UPDATE_FAILED',
        );
      }
      if (!response.ok) {
        throw new LocalSystemError(
          'API recusou a alteracao temporaria da pausa',
          'PREVIEW_STABILITY_PAUSE_UPDATE_FAILED',
        );
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new LocalSystemError(
          'API retornou estado invalido apos alterar a pausa',
          'PREVIEW_STABILITY_PAUSE_UPDATE_FAILED',
        );
      }
      if (
        typeof body !== 'object' ||
        body === null ||
        Reflect.get(body, 'paused') !== paused
      ) {
        throw new LocalSystemError(
          'API retornou estado invalido apos alterar a pausa',
          'PREVIEW_STABILITY_PAUSE_UPDATE_FAILED',
        );
      }
    },
    async forceAutomationPaused(environment) {
      await runDatabaseHelper<{ paused: true }>(
        'force-pause',
        loadedEnvironment(environment),
      );
    },
    async resolvePreviewGroupInstance(environment) {
      const result = await runDatabaseHelper<{ instanceName: string }>(
        'group-instance',
        loadedEnvironment(environment),
      );
      if (!result.instanceName) {
        throw new LocalSystemError(
          'Instancia do grupo preview nao foi resolvida',
          'PREVIEW_STABILITY_GROUP_INSTANCE_INVALID',
        );
      }
      return result.instanceName;
    },
    async captureEvidence(environment) {
      const env = loadedEnvironment(environment);
      const [database, queues] = await Promise.all([
        runDatabaseHelper<Omit<PreviewStabilityEvidence, 'queues'>>(
          'capture',
          env,
        ),
        captureQueueEvidence(env),
      ]);
      return { ...database, queues };
    },
    async captureExecutions(environment) {
      const env = loadedEnvironment(environment);
      return runDatabaseHelper<PreviewStabilityEvidence['executions']>(
        'executions',
        env,
      );
    },
    async captureInfrastructure(environment) {
      const env = loadedEnvironment(environment);
      const skipEvolution = isExplicitSafePreviewEvolutionIsolation(env);
      const [main, volumes] = await Promise.all([
        dependencies.run({
          command: 'docker',
          args: ['compose', 'ps', '-a', '--format', 'json'],
          cwd: root,
          env,
        }),
        dependencies.run({
          command: 'docker',
          args: ['volume', 'ls', '--format', '{{.Name}}'],
          cwd: root,
          env,
        }),
      ]);
      commandSucceeded(
        main,
        'PREVIEW_STABILITY_MAIN_CONTAINER_CAPTURE_FAILED',
        'Falha ao capturar containers principais',
      );
      commandSucceeded(
        volumes,
        'PREVIEW_STABILITY_VOLUME_CAPTURE_FAILED',
        'Falha ao capturar volumes gerenciados',
      );
      const evolutionServices = skipEvolution
        ? []
        : await (async () => {
            const evolution = await dependencies.run({
              command: 'docker',
              args: [
                'compose',
                '--env-file',
                'infra/evolution/.env.local',
                '-f',
                'infra/evolution/docker-compose.yml',
                'ps',
                '-a',
                '--format',
                'json',
              ],
              cwd: root,
              env,
            });
            commandSucceeded(
              evolution,
              'PREVIEW_STABILITY_EVOLUTION_CONTAINER_CAPTURE_FAILED',
              'Falha ao capturar containers Evolution',
            );
            return parseComposeStatuses(evolution.stdout);
          })();
      const volumeNames = managedVolumes(volumes.stdout, !skipEvolution);
      const services = [
        ...parseComposeStatuses(main.stdout),
        ...evolutionServices,
      ];
      const envPath = resolve(root, '.env');
      const envFingerprint = existsSync(envPath)
        ? createHash('sha256').update(readFileSync(envPath)).digest('hex')
        : 'absent';
      return {
        volumeCount: volumeNames.length,
        volumeFingerprint: fingerprintValues(volumeNames),
        containers: {
          ...Object.fromEntries(
            services.map((service) => [service.service, service.state]),
          ),
          ...(skipEvolution ? { evolution: 'not-required' } : {}),
        },
        envFingerprint,
      } satisfies PreviewStabilityInfrastructure;
    },
    async killManagedProcess(service) {
      await stopValidatedManagedProcess({
        service,
        state: readState(root),
        specs: createServiceSpecs(root),
        dependencies,
      });
    },
    async restartMainService(service, environment) {
      const loaded = loadLocalSystemEnvironment(root, environment);
      const env = loaded.env;
      const resolution = await resolveEquivalentMainServiceContainer(
        root,
        dependencies,
        env,
        loaded.ports,
        service,
      );
      if (resolution.status !== 'resolved') {
        throw new PreviewStabilityMainInfrastructureError(
          `PREVIEW_STABILITY_${service.toUpperCase()}_START_FAILED`,
          {
            mainInfraStage: 'resolve',
            service,
            operation: 'restart',
            commandKind: 'discovery',
            errorCode:
              resolution.status === 'ambiguous'
                ? 'AMBIGUOUS_OWNERSHIP'
                : 'OWNERSHIP_UNPROVEN',
            observedHealth: 'unknown',
            expectedHealth: 'healthy',
          },
        );
      }
      const target = resolution.container;
      const stopped = await dependencies.run({
        command: 'docker',
        args: ['stop', target.id],
        cwd: root,
        env,
      });
      if (stopped.code !== 0) {
        throw new PreviewStabilityMainInfrastructureError(
          `PREVIEW_STABILITY_${service.toUpperCase()}_STOP_FAILED`,
          {
            mainInfraStage: 'stop',
            service,
            operation: 'restart',
            commandKind: 'container',
            errorCode: 'COMMAND_FAILED',
            observedHealth: target.health,
            expectedHealth: 'healthy',
          },
        );
      }
      const unavailableAt = dependencies.now().getTime();
      await dependencies.sleep(5_000);
      const started = await dependencies.run({
        command: 'docker',
        args: ['start', target.id],
        cwd: root,
        env,
      });
      const unavailableMs = dependencies.now().getTime() - unavailableAt;
      if (started.code !== 0) {
        throw new PreviewStabilityMainInfrastructureError(
          'MAIN_COMPOSE_START_FAILED',
          {
            mainInfraStage: 'start',
            service,
            operation: 'restart',
            commandKind: 'container',
            errorCode: 'COMMAND_FAILED',
            observedHealth: 'unavailable',
            expectedHealth: 'healthy',
          },
        );
      }
      await waitForResolvedMainServiceHealth(
        root,
        dependencies,
        service,
        target.id,
        env,
        loaded.ports,
      );
      return { unavailableMs };
    },
    async waitForSafeTickGap(minimumMilliseconds, environment) {
      const config = loadConfig(loadedEnvironment(environment));
      const connection = createRedisConnection(config.REDIS_URL);
      const queue = createCommercialAutomationQueue(connection);
      try {
        const deadline = dependencies.now().getTime() + 90_000;
        while (dependencies.now().getTime() < deadline) {
          const scheduler = await queue.getJobScheduler(
            DEFAULT_COMMERCIAL_AUTOMATION_SCHEDULER_JOB_ID,
          );
          const next = scheduler?.next ?? 0;
          if (next - dependencies.now().getTime() >= minimumMilliseconds) {
            return next;
          }
          await dependencies.sleep(1_000);
        }
      } finally {
        await Promise.allSettled([queue.close()]);
        await connection.quit().catch(() => connection.disconnect());
      }
      throw new LocalSystemError(
        'Nao foi possivel obter intervalo seguro entre ticks',
        'PREVIEW_STABILITY_SAFE_TICK_GAP_UNAVAILABLE',
      );
    },
    async writeReport(report: PreviewStabilityReport) {
      const directory = runtimeDirectory(root);
      mkdirSync(directory, { recursive: true });
      writeFileSync(
        resolve(directory, 'preview-stability-report.json'),
        `${JSON.stringify(report, null, 2)}\n`,
        { encoding: 'utf8', mode: 0o600 },
      );
    },
  };
};
