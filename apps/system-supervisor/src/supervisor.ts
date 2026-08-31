import { existsSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, delimiter, resolve } from 'node:path';
import { loadConfig } from '@shopee-auto-affiliate-ai/config';
import { parseEvolutionConnectionState } from '@shopee-auto-affiliate-ai/providers';

import { loadLocalSystemEnvironment } from './environment';
import {
  absoluteLogPath,
  appendSupervisorLog,
  clearState,
  inspectOperationLock,
  type OperationLockSnapshot,
  readState,
  relativeLogPath,
  rotateLogIfNeeded,
  writeState,
} from './state-store';
import type {
  AutomationMode,
  CommandSpec,
  LocalSystemState,
  PortOccupant,
  RegisteredProcess,
  ServiceName,
  SystemDependencies,
} from './types';

import {
  LocalSystemError,
  PREVIEW_STABILITY_PRISMA_VALIDATION,
  SERVICE_NAMES,
} from './types';

type ServiceSpec = {
  name: ServiceName;
  command: string;
  args: string[];
  marker: string;
  cwd?: string;
  healthUrl?: (ports: LocalSystemState['ports']) => string;
};

type ComposeServiceStatus = {
  service: string;
  state: string;
  health: string;
};

const requiredFiles = [
  '.env',
  'package.json',
  'pnpm-lock.yaml',
  'docker-compose.yml',
  'infra/evolution/docker-compose.yml',
  'apps/api/src/server.ts',
  'apps/dashboard/package.json',
  'apps/worker/src/commercial-automation-worker.ts',
  'apps/worker/src/whatsapp-dispatch-runtime.ts',
] as const;

const composeArguments = ['compose'];
const evolutionComposeArguments = [
  'compose',
  '--env-file',
  'infra/evolution/.env.local',
  '-f',
  'infra/evolution/docker-compose.yml',
];

export const parseComposeStatuses = (stdout: string): ComposeServiceStatus[] =>
  stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const item = JSON.parse(line) as {
          Service?: string;
          State?: string;
          Health?: string;
        };
        return item.Service
          ? [
              {
                service: item.Service,
                state: item.State ?? 'unknown',
                health: item.Health ?? '',
              },
            ]
          : [];
      } catch {
        return [];
      }
    });

type MainInfrastructureService = 'postgres' | 'redis';

type ExpectedMainInfrastructure = {
  service: MainInfrastructureService;
  image: string;
  targetPort: number;
  publishedPort: number;
  healthTest: string[];
  mounts: Array<{ type: string; target: string }>;
};

type DockerInspection = {
  Id?: string;
  Config?: {
    Image?: string;
    Labels?: Record<string, string>;
    Healthcheck?: { Test?: string[] };
  };
  State?: { Running?: boolean; Health?: { Status?: string } };
  NetworkSettings?: {
    Ports?: Record<string, Array<{ HostPort?: string }> | null>;
  };
  Mounts?: Array<{
    Type?: string;
    Destination?: string;
    RW?: boolean;
    Mode?: string;
    Propagation?: string;
  }>;
};

const objectRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const stringArray = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];

const arraysEqual = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

const parseExpectedMainInfrastructure = (
  stdout: string,
  ports: LocalSystemState['ports'],
): ExpectedMainInfrastructure[] | null => {
  try {
    const root = objectRecord(JSON.parse(stdout));
    const services = objectRecord(root?.services);
    if (!services) return null;
    return (['postgres', 'redis'] as const).map((service) => {
      const definition = objectRecord(services[service]);
      if (!definition || typeof definition.image !== 'string') {
        throw new Error('invalid service definition');
      }
      const expectedPublishedPort = ports[service];
      const portDefinitions = Array.isArray(definition.ports)
        ? definition.ports
        : [];
      const matchingPort = portDefinitions.map(objectRecord).find((item) => {
        if (!item) return false;
        return Number(item.published) === expectedPublishedPort;
      });
      const targetPort = Number(matchingPort?.target);
      if (!Number.isInteger(targetPort) || targetPort <= 0) {
        throw new Error('invalid service port');
      }
      const healthcheck = objectRecord(definition.healthcheck);
      const healthTest = stringArray(healthcheck?.test);
      const volumes = Array.isArray(definition.volumes)
        ? definition.volumes
        : [];
      const mounts = volumes.flatMap((value) => {
        const mount = objectRecord(value);
        return mount &&
          typeof mount.type === 'string' &&
          typeof mount.target === 'string'
          ? [{ type: mount.type, target: mount.target }]
          : [];
      });
      return {
        service,
        image: definition.image,
        targetPort,
        publishedPort: expectedPublishedPort,
        healthTest,
        mounts,
      };
    });
  } catch {
    return null;
  }
};

type DockerImageInspection = {
  Config?: { Volumes?: Record<string, unknown> | null };
};

const parseDockerImageInspection = (
  stdout: string,
): DockerImageInspection | null => {
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (!Array.isArray(parsed) || parsed.length !== 1) return null;
    const inspection = objectRecord(parsed[0]);
    const config = objectRecord(inspection?.Config);
    if (!inspection || !config) return null;
    const volumes = config.Volumes;
    if (
      volumes !== undefined &&
      volumes !== null &&
      objectRecord(volumes) === null
    ) {
      return null;
    }
    return {
      Config: {
        Volumes:
          volumes === undefined || volumes === null
            ? volumes
            : (volumes as Record<string, unknown>),
      },
    };
  } catch {
    return null;
  }
};

const declaredImageVolumeTargets = (inspection: DockerImageInspection) => {
  const volumes = inspection.Config?.Volumes;
  return volumes && typeof volumes === 'object' && !Array.isArray(volumes)
    ? Object.keys(volumes).sort((left, right) => left.localeCompare(right))
    : [];
};

const isCompatibleImplicitImageVolume = (
  mount: NonNullable<DockerInspection['Mounts']>[number],
) =>
  mount.Type === 'volume' &&
  mount.RW !== false &&
  (mount.Mode === undefined || mount.Mode === '' || mount.Mode === 'z') &&
  (mount.Propagation === undefined ||
    mount.Propagation === '' ||
    mount.Propagation === 'rprivate');

const mountsMatchExpected = (
  inspection: DockerInspection,
  expected: ExpectedMainInfrastructure,
  imageVolumeTargets: readonly string[],
) => {
  const explicitMounts = new Map(
    expected.mounts.map((mount) => [mount.target, mount.type]),
  );
  const implicitTargets = new Set(
    imageVolumeTargets.filter((target) => !explicitMounts.has(target)),
  );
  const candidateMounts = inspection.Mounts ?? [];
  const seenTargets = new Set<string>();

  for (const mount of candidateMounts) {
    if (
      typeof mount.Destination !== 'string' ||
      typeof mount.Type !== 'string'
    ) {
      return false;
    }
    if (seenTargets.has(mount.Destination)) return false;
    seenTargets.add(mount.Destination);

    const explicitType = explicitMounts.get(mount.Destination);
    if (explicitType !== undefined) {
      if (mount.Type !== explicitType) return false;
      continue;
    }
    if (
      !implicitTargets.has(mount.Destination) ||
      !isCompatibleImplicitImageVolume(mount)
    ) {
      return false;
    }
  }

  return [...explicitMounts.keys()].every((target) => seenTargets.has(target));
};
const parseDockerInspections = (stdout: string): DockerInspection[] | null => {
  try {
    const parsed: unknown = JSON.parse(stdout);
    return Array.isArray(parsed) ? (parsed as DockerInspection[]) : null;
  } catch {
    return null;
  }
};

const inspectionMatchesExpected = (
  inspection: DockerInspection,
  expected: ExpectedMainInfrastructure,
  imageVolumeTargets: readonly string[],
) => {
  const labels = inspection.Config?.Labels;
  if (
    !labels ||
    labels['com.docker.compose.service'] !== expected.service ||
    !labels['com.docker.compose.project'] ||
    !labels['com.docker.compose.project.config_files'] ||
    !labels['com.docker.compose.project.working_dir'] ||
    inspection.Config?.Image !== expected.image ||
    inspection.State?.Running !== true
  ) {
    return false;
  }
  if (
    expected.healthTest.length > 0 &&
    !arraysEqual(
      inspection.Config?.Healthcheck?.Test ?? [],
      expected.healthTest,
    )
  ) {
    return false;
  }
  const bindings =
    inspection.NetworkSettings?.Ports?.[`${expected.targetPort}/tcp`] ?? [];
  if (
    !bindings.some(
      (binding) => Number(binding.HostPort) === expected.publishedPort,
    )
  ) {
    return false;
  }
  return mountsMatchExpected(inspection, expected, imageVolumeTargets);
};

export type ResolvedMainInfrastructureContainer = {
  id: string;
  service: 'postgres' | 'redis';
  health: 'healthy' | 'starting' | 'unhealthy' | 'unavailable' | 'unknown';
};

const normalizedInfrastructureHealth = (value: string | undefined) =>
  value === 'healthy' || value === 'starting' || value === 'unhealthy'
    ? value
    : value
      ? 'unknown'
      : 'unavailable';

type MainInfrastructureContainerDiscovery =
  | { status: 'resolved'; containers: ResolvedMainInfrastructureContainer[] }
  | { status: 'unproven' }
  | { status: 'ambiguous' };

const discoverEquivalentMainInfrastructureContainers = async (
  root: string,
  deps: SystemDependencies,
  env: NodeJS.ProcessEnv,
  ports: LocalSystemState['ports'],
): Promise<MainInfrastructureContainerDiscovery> => {
  try {
    const configResult = await deps.run(
      composeSpec(
        root,
        [...composeArguments, 'config', '--format', 'json'],
        env,
      ),
    );
    if (configResult.code !== 0) return { status: 'unproven' };
    const expected = parseExpectedMainInfrastructure(
      configResult.stdout,
      ports,
    );
    if (!expected) return { status: 'unproven' };
    const listResult = await deps.run({
      command: 'docker',
      args: ['ps', '--format', '{{.ID}}'],
      cwd: root,
      env,
    });
    if (listResult.code !== 0) return { status: 'unproven' };
    const ids = [
      ...new Set(
        listResult.stdout
          .split(/\r?\n/)
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ];
    if (ids.length === 0 || ids.some((id) => !/^[a-f0-9]{12,64}$/i.test(id))) {
      return { status: 'unproven' };
    }
    const inspectResult = await deps.run({
      command: 'docker',
      args: ['inspect', ...ids],
      cwd: root,
      env,
    });
    if (inspectResult.code !== 0) return { status: 'unproven' };
    const inspections = parseDockerInspections(inspectResult.stdout);
    if (!inspections) return { status: 'unproven' };
    const containers: ResolvedMainInfrastructureContainer[] = [];
    for (const service of expected) {
      const imageInspectResult = await deps.run({
        command: 'docker',
        args: ['image', 'inspect', service.image],
        cwd: root,
        env,
      });
      if (imageInspectResult.code !== 0) return { status: 'unproven' };
      const imageInspection = parseDockerImageInspection(
        imageInspectResult.stdout,
      );
      if (!imageInspection) return { status: 'unproven' };
      const imageVolumeTargets = declaredImageVolumeTargets(imageInspection);
      const candidates = inspections.filter((inspection) =>
        inspectionMatchesExpected(inspection, service, imageVolumeTargets),
      );
      if (candidates.length > 1) return { status: 'ambiguous' };
      if (candidates.length === 0) return { status: 'unproven' };
      const candidate = candidates[0];
      if (!candidate?.Id || !/^[a-f0-9]{12,64}$/i.test(candidate.Id)) {
        return { status: 'unproven' };
      }
      containers.push({
        id: candidate.Id,
        service: service.service,
        health: normalizedInfrastructureHealth(candidate.State?.Health?.Status),
      });
    }
    return { status: 'resolved', containers };
  } catch {
    return { status: 'unproven' };
  }
};

export type MainInfrastructureServiceResolution =
  | { status: 'resolved'; container: ResolvedMainInfrastructureContainer }
  | { status: 'unproven' }
  | { status: 'ambiguous' };

export const resolveEquivalentMainServiceContainer = async (
  root: string,
  deps: SystemDependencies,
  env: NodeJS.ProcessEnv,
  ports: LocalSystemState['ports'],
  service: 'postgres' | 'redis',
): Promise<MainInfrastructureServiceResolution> => {
  const discovery = await discoverEquivalentMainInfrastructureContainers(
    root,
    deps,
    env,
    ports,
  );
  if (discovery.status !== 'resolved') return discovery;
  const matches = discovery.containers.filter(
    (candidate) => candidate.service === service,
  );
  if (matches.length > 1) return { status: 'ambiguous' };
  if (matches.length === 0) return { status: 'unproven' };
  return { status: 'resolved', container: matches[0]! };
};

const discoverEquivalentMainInfrastructure = async (
  root: string,
  deps: SystemDependencies,
  env: NodeJS.ProcessEnv,
  ports: LocalSystemState['ports'],
): Promise<ComposeServiceStatus[]> => {
  const discovery = await discoverEquivalentMainInfrastructureContainers(
    root,
    deps,
    env,
    ports,
  );
  return discovery.status === 'resolved'
    ? discovery.containers.map(({ service, health }) => ({
        service,
        state: 'running',
        health,
      }))
    : [];
};

const hasHealthyMainInfrastructure = (statuses: ComposeServiceStatus[]) =>
  (['postgres', 'redis'] as const).every((service) =>
    statuses.some(
      (item) =>
        item.service === service &&
        item.state === 'running' &&
        (item.health === 'healthy' || item.health === ''),
    ),
  );

const hasCompleteMainInfrastructure = (statuses: ComposeServiceStatus[]) =>
  (['postgres', 'redis'] as const).every((service) =>
    statuses.some(
      (item) => item.service === service && item.state === 'running',
    ),
  );

const mergeMainInfrastructureStatuses = (
  primary: ComposeServiceStatus[],
  equivalent: ComposeServiceStatus[],
) => [
  ...primary,
  ...equivalent.filter(
    (candidate) => !primary.some((item) => item.service === candidate.service),
  ),
];
const processMarker = (path: string) => basename(path).toLowerCase();

export const createServiceSpecs = (root: string): ServiceSpec[] => {
  const rootRequire = createRequire(resolve(root, 'package.json'));
  const dashboardRequire = createRequire(
    resolve(root, 'apps/dashboard/package.json'),
  );
  const tsx = rootRequire.resolve('tsx/cli');
  const next = dashboardRequire.resolve('next/dist/bin/next');
  const runtimeTsconfig = resolve(root, 'tsconfig.runtime.json');
  const api = resolve(root, 'apps/api/src/server.ts');
  const commercialWorker = resolve(
    root,
    'apps/worker/src/commercial-automation-worker.ts',
  );
  const dispatchWorker = resolve(
    root,
    'apps/worker/src/whatsapp-dispatch-runtime.ts',
  );
  return [
    {
      name: 'api',
      command: process.execPath,
      args: [tsx, '--tsconfig', runtimeTsconfig, api],
      marker: processMarker(api),
      healthUrl: (ports) => `http://127.0.0.1:${ports.api}/health`,
    },
    {
      name: 'dashboard',
      command: process.execPath,
      args: [next, 'dev', '-p', '3000', '-H', '127.0.0.1'],
      marker: processMarker(next),
      cwd: resolve(root, 'apps/dashboard'),
      healthUrl: (ports) => `http://127.0.0.1:${ports.dashboard}`,
    },
    {
      name: 'commercial-worker',
      command: process.execPath,
      args: [tsx, '--tsconfig', runtimeTsconfig, commercialWorker],
      marker: processMarker(commercialWorker),
    },
    {
      name: 'whatsapp-dispatch-worker',
      command: process.execPath,
      args: [tsx, '--tsconfig', runtimeTsconfig, dispatchWorker],
      marker: processMarker(dispatchWorker),
    },
  ];
};

const composeSpec = (
  root: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
): CommandSpec => ({ command: 'docker', args, cwd: root, env });

const resolveWindowsPnpmEntrypoint = (env: NodeJS.ProcessEnv) => {
  const pathValue =
    env.Path ?? env.PATH ?? process.env.Path ?? process.env.PATH ?? '';
  for (const pathEntry of pathValue.split(delimiter)) {
    if (!pathEntry) continue;
    const pnpmCommand = resolve(pathEntry, 'pnpm.cmd');
    const pnpmEntrypoint = resolve(pathEntry, 'node_modules/pnpm/bin/pnpm.cjs');
    if (existsSync(pnpmCommand) && existsSync(pnpmEntrypoint)) {
      return pnpmEntrypoint;
    }
  }
  throw new LocalSystemError(
    'pnpm nao esta disponivel no PATH',
    'PNPM_UNAVAILABLE',
  );
};

const pnpmSpec = (
  root: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): CommandSpec =>
  process.platform === 'win32'
    ? {
        command: process.execPath,
        args: [resolveWindowsPnpmEntrypoint(env), ...args],
        cwd: root,
        env,
      }
    : { command: 'pnpm', args, cwd: root, env };

const shouldSkipEvolutionForExplicitSafePreview = (env: NodeJS.ProcessEnv) =>
  env.COMMERCIAL_AUTOMATION_MODE === 'preview' &&
  env.WHATSAPP_PROVIDER === 'mock' &&
  env.WHATSAPP_GROUP_SEND_ENABLED === 'false';

const isDailySendReadyProfile = (
  mode: AutomationMode,
  env: NodeJS.ProcessEnv,
) =>
  mode === 'send' &&
  env.COMMERCIAL_AUTOMATION_ENABLED === 'true' &&
  env.COMMERCIAL_SCHEDULER_ENABLED === 'true' &&
  env.SCHEDULER_ENABLED === 'false' &&
  env.SHOPEE_AFFILIATE_PROVIDER === 'official' &&
  env.WHATSAPP_PROVIDER === 'evolution' &&
  env.WHATSAPP_GROUP_SEND_ENABLED === 'true';
const expectedServices = (mode: AutomationMode) =>
  SERVICE_NAMES.filter(
    (name) => name !== 'whatsapp-dispatch-worker' || mode === 'send',
  );

const waitFor = async (
  operation: () => Promise<boolean>,
  deps: SystemDependencies,
  code: string,
  message: string,
  attempts = 60,
) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await operation().catch(() => false)) return;
    if (attempt + 1 < attempts) await deps.sleep(1_000);
  }
  throw new LocalSystemError(message, code);
};

const runRequired = async (
  deps: SystemDependencies,
  spec: CommandSpec,
  code: string,
  message: string,
  root: string,
) => {
  const result = await deps
    .run(spec)
    .catch(() => ({ code: 1, stdout: '', stderr: '' }));
  if (result.code !== 0) {
    appendSupervisorLog(root, code);
    throw new LocalSystemError(message, code);
  }
  return result;
};

const waitForComposeHealth = async (
  root: string,
  deps: SystemDependencies,
  args: string[],
  required: string[],
  code: string,
  env?: NodeJS.ProcessEnv,
) =>
  waitFor(
    async () => {
      const result = await deps.run(
        composeSpec(root, [...args, 'ps', '--format', 'json'], env),
      );
      if (result.code !== 0) return false;
      const statuses = parseComposeStatuses(result.stdout);
      return required.every((service) => {
        const status = statuses.find((item) => item.service === service);
        return status?.state === 'running' && status.health === 'healthy';
      });
    },
    deps,
    code,
    `Servicos Docker nao ficaram saudaveis: ${required.join(', ')}`,
    90,
  );

const waitForEquivalentMainInfrastructureHealth = async (
  root: string,
  deps: SystemDependencies,
  env: NodeJS.ProcessEnv,
  ports: LocalSystemState['ports'],
) =>
  waitFor(
    async () =>
      hasHealthyMainInfrastructure(
        await discoverEquivalentMainInfrastructure(root, deps, env, ports),
      ),
    deps,
    'MAIN_COMPOSE_UNHEALTHY',
    'Infraestrutura principal equivalente nao ficou saudavel',
    90,
  );

const waitForHttp = (
  deps: SystemDependencies,
  url: string,
  code: string,
  message: string,
) =>
  waitFor(
    async () => (await deps.request(url, { timeoutMs: 1_000 })).ok,
    deps,
    code,
    message,
    30,
  );

const inspectRegisteredProcesses = async (
  state: LocalSystemState | null,
  specs: ServiceSpec[],
  deps: SystemDependencies,
) => {
  const valid: LocalSystemState['processes'] = {};
  const reused: ServiceName[] = [];
  if (!state) return { valid, reused };
  for (const spec of specs) {
    const registered = state.processes[spec.name];
    if (!registered) continue;
    const inspection = await deps.inspectProcess(
      registered.pid,
      spec.marker,
      registered.startedAt,
    );
    if (inspection.running && inspection.identityMatches) {
      valid[spec.name] = registered;
    } else if (inspection.running) {
      reused.push(spec.name);
    }
  }
  return { valid, reused };
};

const assertPortAvailable = async (
  port: number,
  ownedPid: number | undefined,
  deps: SystemDependencies,
) => {
  const occupant = await deps.getPortOccupant(port);
  if (!occupant || (ownedPid !== undefined && occupant.pid === ownedPid))
    return;
  if (
    ownedPid !== undefined &&
    occupant.pid !== undefined &&
    deps.isProcessInTree &&
    (await deps.isProcessInTree(ownedPid, occupant.pid))
  ) {
    return;
  }
  throw new LocalSystemError(
    `A porta ${port} esta ocupada por ${occupant.processName}; nenhum processo sera encerrado`,
    'SYSTEM_PORT_OCCUPIED',
  );
};

export type SystemStatusSnapshot = OperationLockSnapshot & {
  overall: 'running' | 'partial' | 'stopped';
  mode: AutomationMode;
  ports: {
    api: number;
    dashboard: number;
  };
  docker: {
    daemon: 'available' | 'unavailable';
    services: ComposeServiceStatus[];
  };
  evolution: {
    api: 'available' | 'unavailable';
    services: ComposeServiceStatus[];
    whatsappConnection:
      | 'open'
      | 'close'
      | 'connecting'
      | 'unknown'
      | 'unavailable'
      | 'not-configured';
  };
  processes: Record<
    ServiceName,
    'running' | 'stopped' | 'identity-mismatch' | 'not-required'
  >;
  endpoints: {
    api: 'available' | 'unavailable';
    dashboard: 'available' | 'unavailable';
  };
  controlPlane: {
    required: boolean;
    configured: boolean;
    authenticated: boolean;
  };
  schedulers: {
    legacy: {
      enabled: boolean | null;
      status: 'disabled' | 'registered' | 'not-registered' | 'unavailable';
      cronExpression: string | null;
      timezone: string | null;
      nextRunAt: string | null;
    };
    commercial: {
      enabled: boolean | null;
      status: 'disabled' | 'registered' | 'not-registered' | 'unavailable';
      cron: string | null;
      timezone: string | null;
      nextRunAt: string | null;
      mode: AutomationMode | null;
    };
  };
  automation: {
    enabled: boolean | null;
    allowed: boolean | null;
    paused: boolean | null;
    reasons: string[];
    nextAllowedAt: string | null;
  };
  externalPortOccupants: Array<{
    port: number;
    processName: string;
    pid?: number;
  }>;
};

const localApiAuthHeaders = (
  environment: NodeJS.ProcessEnv,
): Record<string, string> | undefined => {
  const token = environment.LOCAL_API_AUTH_TOKEN?.trim();
  return token ? { authorization: `Bearer ${token}` } : undefined;
};

const safeRequestBody = async (
  deps: SystemDependencies,
  url: string,
  headers?: Record<string, string>,
) => {
  try {
    const response = await deps.request(url, { headers });
    return response.ok ? response.body : { status: 'unavailable' };
  } catch {
    return { status: 'unavailable' };
  }
};

const recordBody = (body: unknown): Record<string, unknown> =>
  body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
const nullableString = (value: unknown) =>
  typeof value === 'string' ? value : null;
const nullableBoolean = (value: unknown) =>
  typeof value === 'boolean' ? value : null;
const schedulerStatus = (
  value: unknown,
): 'disabled' | 'registered' | 'not-registered' | 'unavailable' =>
  value === 'disabled' || value === 'registered' || value === 'not-registered'
    ? value
    : 'unavailable';

const parseLegacyScheduler = (
  body: unknown,
): SystemStatusSnapshot['schedulers']['legacy'] => {
  const value = recordBody(body);
  return {
    enabled: nullableBoolean(value.enabled),
    status: schedulerStatus(value.status),
    cronExpression: nullableString(value.cronExpression),
    timezone: nullableString(value.timezone),
    nextRunAt: nullableString(value.nextRunAt),
  };
};

const parseCommercialScheduler = (
  body: unknown,
): SystemStatusSnapshot['schedulers']['commercial'] => {
  const value = recordBody(body);
  return {
    enabled: nullableBoolean(value.enabled),
    status: schedulerStatus(value.status),
    cron: nullableString(value.cron),
    timezone: nullableString(value.timezone),
    nextRunAt: nullableString(value.nextRunAt),
    mode: value.mode === 'preview' || value.mode === 'send' ? value.mode : null,
  };
};

const parseAutomationStatus = (
  body: unknown,
): SystemStatusSnapshot['automation'] => {
  const value = recordBody(body);
  return {
    enabled: nullableBoolean(value.enabled),
    allowed: nullableBoolean(value.allowed),
    paused: nullableBoolean(value.paused),
    reasons: Array.isArray(value.reasons)
      ? value.reasons.filter(
          (reason): reason is string => typeof reason === 'string',
        )
      : [],
    nextAllowedAt: nullableString(value.nextAllowedAt),
  };
};

export class LocalSystemSupervisor {
  private readonly specs: ServiceSpec[];
  private readonly validateRoot: () => boolean;

  constructor(
    private readonly root: string,
    private readonly deps: SystemDependencies,
    specs?: ServiceSpec[],
    options: { validateRoot?: () => boolean } = {},
  ) {
    this.specs = specs ?? createServiceSpecs(root);
    this.validateRoot =
      options.validateRoot ??
      (() => realpathSync(process.cwd()) === realpathSync(this.root));
  }

  async start(processEnv: NodeJS.ProcessEnv = process.env) {
    if (!this.validateRoot()) {
      throw new LocalSystemError(
        'Execute o comando a partir da raiz do repositorio',
        'SYSTEM_ROOT_REQUIRED',
      );
    }
    for (const file of requiredFiles) {
      if (!existsSync(resolve(this.root, file))) {
        throw new LocalSystemError(
          `Arquivo obrigatorio ausente: ${file}`,
          'SYSTEM_REQUIRED_FILE_MISSING',
        );
      }
    }
    const major = Number(process.versions.node.split('.')[0]);
    const minor = Number(process.versions.node.split('.')[1]);
    if (major < 20 || (major === 20 && minor < 6)) {
      throw new LocalSystemError(
        'Node.js 20.6 ou superior e obrigatorio',
        'SYSTEM_NODE_VERSION_UNSUPPORTED',
      );
    }

    const loaded = loadLocalSystemEnvironment(this.root, processEnv);
    const runtimeEnv = loaded.env;
    const skipEvolution = shouldSkipEvolutionForExplicitSafePreview(runtimeEnv);
    if (
      isDailySendReadyProfile(loaded.mode, runtimeEnv) &&
      !runtimeEnv.LOCAL_API_AUTH_TOKEN?.trim()
    ) {
      throw new LocalSystemError(
        'O token local do painel e obrigatorio no perfil diario SEND-ready',
        'LOCAL_API_AUTH_TOKEN_REQUIRED',
      );
    }
    try {
      loadConfig(runtimeEnv);
    } catch {
      throw new LocalSystemError(
        'Configuracao local invalida; revise o .env sem expor seus valores',
        'SYSTEM_CONFIG_INVALID',
      );
    }
    const previous = readState(this.root);
    const inspected = await inspectRegisteredProcesses(
      previous,
      this.specs,
      this.deps,
    );
    if (
      previous &&
      previous.mode !== loaded.mode &&
      Object.keys(inspected.valid).length > 0
    ) {
      throw new LocalSystemError(
        'Pare o sistema antes de alterar COMMERCIAL_AUTOMATION_MODE',
        'SYSTEM_MODE_CONFLICT',
      );
    }
    const unexpectedProcesses = Object.keys(inspected.valid).filter(
      (name) => !expectedServices(loaded.mode).includes(name as ServiceName),
    );
    if (unexpectedProcesses.length > 0) {
      throw new LocalSystemError(
        `Processos registrados nao pertencem ao modo ${loaded.mode}: ${unexpectedProcesses.join(', ')}`,
        'SYSTEM_UNEXPECTED_REGISTERED_PROCESS',
      );
    }
    if (inspected.reused.length > 0) {
      appendSupervisorLog(
        this.root,
        `PIDs reutilizados ignorados: ${inspected.reused.join(', ')}`,
      );
    }
    await runRequired(
      this.deps,
      pnpmSpec(this.root, ['--version'], runtimeEnv),
      'PNPM_UNAVAILABLE',
      'pnpm nao esta disponivel',
      this.root,
    );
    await runRequired(
      this.deps,
      composeSpec(this.root, ['--version'], runtimeEnv),
      'DOCKER_CLI_UNAVAILABLE',
      'Docker CLI nao esta disponivel',
      this.root,
    );
    const dockerInfo = await this.deps
      .run(composeSpec(this.root, ['info'], runtimeEnv))
      .catch(() => ({ code: 1, stdout: '', stderr: '' }));
    if (dockerInfo.code !== 0) {
      throw new LocalSystemError(
        'Docker daemon indisponivel. Inicie o Docker Desktop manualmente e tente novamente',
        'DOCKER_DAEMON_UNAVAILABLE',
      );
    }
    await assertPortAvailable(
      loaded.ports.api,
      inspected.valid.api?.pid,
      this.deps,
    );
    await assertPortAvailable(
      loaded.ports.dashboard,
      inspected.valid.dashboard?.pid,
      this.deps,
    );
    const mainBeforeStart = await this.deps.run(
      composeSpec(
        this.root,
        [...composeArguments, 'ps', '--format', 'json'],
        runtimeEnv,
      ),
    );
    const evolutionBeforeStart = skipEvolution
      ? { code: 0, stdout: '', stderr: '' }
      : await this.deps.run(
          composeSpec(
            this.root,
            [...evolutionComposeArguments, 'ps', '--format', 'json'],
            runtimeEnv,
          ),
        );
    const currentMainServices = parseComposeStatuses(mainBeforeStart.stdout);
    const currentMainHealthy =
      hasHealthyMainInfrastructure(currentMainServices);
    const equivalentMainServices = currentMainHealthy
      ? []
      : await discoverEquivalentMainInfrastructure(
          this.root,
          this.deps,
          runtimeEnv,
          loaded.ports,
        );
    const equivalentMainComplete = hasCompleteMainInfrastructure(
      equivalentMainServices,
    );
    const reuseEquivalentMain = !currentMainHealthy && equivalentMainComplete;
    const mainServices = mergeMainInfrastructureStatuses(
      currentMainServices,
      equivalentMainServices,
    );
    const evolutionServices = parseComposeStatuses(evolutionBeforeStart.stdout);
    const managedPortChecks: Array<
      readonly [number, string, ComposeServiceStatus[]]
    > = [
      [loaded.ports.postgres, 'postgres', mainServices],
      [loaded.ports.redis, 'redis', mainServices],
      ...(skipEvolution
        ? []
        : [
            [
              loaded.ports.evolution,
              'evolution-api',
              evolutionServices,
            ] as const,
          ]),
    ];
    for (const [port, expectedService, statuses] of managedPortChecks) {
      const managed = statuses.some(
        (item) => item.service === expectedService && item.state === 'running',
      );
      if (!managed) await assertPortAvailable(port, undefined, this.deps);
    }

    if (!reuseEquivalentMain) {
      await runRequired(
        this.deps,
        composeSpec(this.root, [...composeArguments, 'up', '-d'], runtimeEnv),
        'MAIN_COMPOSE_START_FAILED',
        'Falha ao iniciar PostgreSQL e Redis principais',
        this.root,
      );
    }
    if (!skipEvolution) {
      await runRequired(
        this.deps,
        pnpmSpec(this.root, ['evolution:up'], runtimeEnv),
        'EVOLUTION_COMPOSE_START_FAILED',
        'Falha ao iniciar a stack Evolution',
        this.root,
      );
    }
    await Promise.all([
      ...(reuseEquivalentMain
        ? [
            waitForEquivalentMainInfrastructureHealth(
              this.root,
              this.deps,
              runtimeEnv,
              loaded.ports,
            ),
          ]
        : [
            waitForComposeHealth(
              this.root,
              this.deps,
              composeArguments,
              ['postgres', 'redis'],
              'MAIN_COMPOSE_UNHEALTHY',
              runtimeEnv,
            ),
          ]),
      ...(skipEvolution
        ? []
        : [
            waitForComposeHealth(
              this.root,
              this.deps,
              evolutionComposeArguments,
              ['evolution-api', 'evolution-postgres', 'evolution-redis'],
              'EVOLUTION_COMPOSE_UNHEALTHY',
              runtimeEnv,
            ),
          ]),
    ]);
    const validatedPreviewClient =
      runtimeEnv[PREVIEW_STABILITY_PRISMA_VALIDATION] === 'true' &&
      loaded.mode === 'preview' &&
      runtimeEnv.SCHEDULER_ENABLED === 'false' &&
      runtimeEnv.WHATSAPP_GROUP_SEND_ENABLED === 'false' &&
      runtimeEnv.SHOPEE_AFFILIATE_PROVIDER === 'mock';
    if (
      !validatedPreviewClient &&
      !inspected.valid.api &&
      Object.keys(inspected.valid).length === 0
    ) {
      await runRequired(
        this.deps,
        pnpmSpec(
          this.root,
          ['--filter', '@shopee-auto-affiliate-ai/database', 'db:generate'],
          runtimeEnv,
        ),
        'PRISMA_GENERATE_FAILED',
        'Falha no Prisma generate',
        this.root,
      );
    }
    await runRequired(
      this.deps,
      pnpmSpec(
        this.root,
        ['--filter', '@shopee-auto-affiliate-ai/database', 'db:deploy'],
        runtimeEnv,
      ),
      'PRISMA_MIGRATE_DEPLOY_FAILED',
      'Falha no Prisma migrate deploy',
      this.root,
    );

    const state: LocalSystemState = {
      version: 1,
      startedAt:
        Object.keys(inspected.valid).length > 0 && previous
          ? previous.startedAt
          : this.deps.now().toISOString(),
      mode: loaded.mode,
      ports: loaded.ports,
      processes: { ...inspected.valid },
    };
    const startedThisAttempt: ServiceName[] = [];
    try {
      for (const name of expectedServices(loaded.mode)) {
        const spec = this.specs.find((item) => item.name === name);
        if (!spec) throw new Error(`Service spec ausente: ${name}`);
        if (!state.processes[name]) {
          const logPath = absoluteLogPath(this.root, name);
          rotateLogIfNeeded(logPath);
          const started = await this.deps.spawn({
            command: spec.command,
            args: spec.args,
            cwd: spec.cwd ?? this.root,
            env: runtimeEnv,
            logPath,
          });
          state.processes[name] = {
            ...started,
            log: relativeLogPath(name),
          };
          startedThisAttempt.push(name);
          writeState(this.root, state);
        }
        if (spec.healthUrl) {
          await waitForHttp(
            this.deps,
            spec.healthUrl(state.ports),
            `${name.toUpperCase().replaceAll('-', '_')}_UNHEALTHY`,
            `${name} nao ficou disponivel`,
          );
        } else {
          await this.deps.sleep(500);
          const registered = state.processes[name] as RegisteredProcess;
          const inspection = await this.deps
            .inspectProcess(registered.pid, spec.marker, registered.startedAt)
            .catch(() => ({ running: true, identityMatches: false }));
          if (!inspection.running || !inspection.identityMatches) {
            throw new LocalSystemError(
              `${name} encerrou durante a inicializacao`,
              'SYSTEM_CHILD_START_FAILED',
            );
          }
        }
      }
      writeState(this.root, state);
      const status = await this.status(processEnv);
      if (status.overall !== 'running') {
        throw new LocalSystemError(
          'Sistema ficou parcial durante a inicializacao',
          'SYSTEM_START_INCOMPLETE',
        );
      }
      appendSupervisorLog(
        this.root,
        `Sistema iniciado em modo ${loaded.mode}; nenhum tick ou envio foi disparado`,
      );
      return status;
    } catch (error) {
      const rollbackFailures: ServiceName[] = [];
      for (const name of [...startedThisAttempt].reverse()) {
        const registered = state.processes[name];
        const spec = this.specs.find((item) => item.name === name);
        if (!registered || !spec) continue;
        const inspection = await this.deps
          .inspectProcess(registered.pid, spec.marker, registered.startedAt)
          .catch(() => ({ running: true, identityMatches: false }));
        if (!inspection.running) {
          delete state.processes[name];
          continue;
        }
        if (
          !inspection.identityMatches ||
          !(await this.deps.stopProcessTree(registered.pid))
        ) {
          rollbackFailures.push(name);
          continue;
        }
        delete state.processes[name];
      }
      if (Object.keys(state.processes).length > 0) writeState(this.root, state);
      else clearState(this.root);
      if (rollbackFailures.length > 0) {
        appendSupervisorLog(
          this.root,
          `Rollback incompleto: ${rollbackFailures.join(', ')}`,
        );
        throw new LocalSystemError(
          `Rollback incompleto; intervencao manual: ${rollbackFailures.join(', ')}`,
          'SYSTEM_ROLLBACK_INCOMPLETE',
        );
      }
      throw error;
    }
  }

  async status(
    processEnv: NodeJS.ProcessEnv = process.env,
  ): Promise<SystemStatusSnapshot> {
    const loaded = loadLocalSystemEnvironment(this.root, processEnv);
    const skipEvolution = shouldSkipEvolutionForExplicitSafePreview(loaded.env);
    const state = readState(this.root);
    const operationLockPromise = inspectOperationLock(this.root, this.deps);
    const ports = state?.ports ?? loaded.ports;
    const processStatuses = Object.fromEntries(
      await Promise.all(
        this.specs.map(async (spec) => {
          const registered = state?.processes[spec.name];
          if (!registered) return [spec.name, 'stopped'] as const;
          const inspection = await this.deps.inspectProcess(
            registered.pid,
            spec.marker,
            registered.startedAt,
          );
          return [
            spec.name,
            !inspection.running
              ? 'stopped'
              : inspection.identityMatches
                ? 'running'
                : 'identity-mismatch',
          ] as const;
        }),
      ),
    ) as SystemStatusSnapshot['processes'];
    if ((state?.mode ?? loaded.mode) === 'preview') {
      processStatuses['whatsapp-dispatch-worker'] = 'not-required';
    }

    const [dockerResult, evolutionResult] = await Promise.all([
      this.deps
        .run(
          composeSpec(
            this.root,
            [...composeArguments, 'ps', '--format', 'json'],
            loaded.env,
          ),
        )
        .catch(() => ({ code: 1, stdout: '', stderr: '' })),
      skipEvolution
        ? Promise.resolve({ code: 0, stdout: '', stderr: '' })
        : this.deps
            .run(
              composeSpec(
                this.root,
                [...evolutionComposeArguments, 'ps', '--format', 'json'],
                loaded.env,
              ),
            )
            .catch(() => ({ code: 1, stdout: '', stderr: '' })),
    ]);
    const currentDockerServices =
      dockerResult.code === 0 ? parseComposeStatuses(dockerResult.stdout) : [];
    const equivalentMainServices = hasHealthyMainInfrastructure(
      currentDockerServices,
    )
      ? []
      : await discoverEquivalentMainInfrastructure(
          this.root,
          this.deps,
          loaded.env,
          ports,
        );
    const dockerServices = mergeMainInfrastructureStatuses(
      currentDockerServices,
      equivalentMainServices,
    );
    const evolutionServices =
      evolutionResult.code === 0
        ? parseComposeStatuses(evolutionResult.stdout)
        : [];
    const apiBase = `http://127.0.0.1:${ports.api}`;
    const dashboardBase = `http://127.0.0.1:${ports.dashboard}`;
    const [apiHealth, dashboardHealth] = await Promise.all([
      this.deps
        .request(`${apiBase}/health`)
        .catch(() => ({ ok: false, status: 0 })),
      this.deps.request(dashboardBase).catch(() => ({ ok: false, status: 0 })),
    ]);
    const apiAvailable = processStatuses.api === 'running' && apiHealth.ok;
    const apiAuthHeaders = localApiAuthHeaders(loaded.env);
    const [legacyBody, commercialBody, automationBody] = apiAvailable
      ? await Promise.all([
          safeRequestBody(this.deps, `${apiBase}/scheduler`, apiAuthHeaders),
          safeRequestBody(
            this.deps,
            `${apiBase}/commercial-automation/scheduler`,
            apiAuthHeaders,
          ),
          safeRequestBody(
            this.deps,
            `${apiBase}/commercial-automation/status`,
            apiAuthHeaders,
          ),
        ])
      : [
          { status: 'unavailable' },
          { status: 'unavailable' },
          { status: 'unavailable' },
        ];
    const legacy = parseLegacyScheduler(legacyBody);
    const commercial = parseCommercialScheduler(commercialBody);
    const automation = parseAutomationStatus(automationBody);
    const controlPlaneRequired = isDailySendReadyProfile(
      state?.mode ?? loaded.mode,
      loaded.env,
    );
    const controlPlaneConfigured = Boolean(
      loaded.env.LOCAL_API_AUTH_TOKEN?.trim(),
    );
    const controlPlaneAuthenticated =
      apiAvailable &&
      controlPlaneConfigured &&
      automation.enabled !== null &&
      automation.paused !== null;
    const evolutionBase = (
      loaded.env.EVOLUTION_API_URL ?? `http://127.0.0.1:${ports.evolution}`
    ).replace(/\/+$/, '');
    const [evolutionHealth, connectionBody] = skipEvolution
      ? [undefined, undefined]
      : await Promise.all([
          safeRequestBody(this.deps, evolutionBase),
          loaded.env.EVOLUTION_API_KEY && loaded.env.EVOLUTION_INSTANCE_NAME
            ? safeRequestBody(
                this.deps,
                `${evolutionBase}/instance/connectionState/${encodeURIComponent(loaded.env.EVOLUTION_INSTANCE_NAME)}`,
                { apikey: loaded.env.EVOLUTION_API_KEY },
              )
            : Promise.resolve(undefined),
        ]);
    const rawConnectionState = connectionBody
      ? parseEvolutionConnectionState(connectionBody)
      : undefined;
    const whatsappConnection: SystemStatusSnapshot['evolution']['whatsappConnection'] =
      !connectionBody
        ? 'not-configured'
        : rawConnectionState === 'open' ||
            rawConnectionState === 'close' ||
            rawConnectionState === 'connecting'
          ? rawConnectionState
          : rawConnectionState
            ? 'unknown'
            : 'unavailable';

    const managedPids = new Set(
      Object.values(state?.processes ?? {}).map((item) => item.pid),
    );
    const externalPortOccupants: SystemStatusSnapshot['externalPortOccupants'] =
      [];
    const expectedManagedPorts = new Set<number>();
    if (
      dockerServices.some(
        (item) => item.service === 'postgres' && item.state === 'running',
      )
    ) {
      expectedManagedPorts.add(ports.postgres);
    }
    if (
      dockerServices.some(
        (item) => item.service === 'redis' && item.state === 'running',
      )
    ) {
      expectedManagedPorts.add(ports.redis);
    }
    if (
      evolutionServices.some(
        (item) => item.service === 'evolution-api' && item.state === 'running',
      )
    ) {
      expectedManagedPorts.add(ports.evolution);
    }
    if (processStatuses.api === 'running' && apiHealth.ok) {
      expectedManagedPorts.add(ports.api);
    }
    if (processStatuses.dashboard === 'running' && dashboardHealth.ok) {
      expectedManagedPorts.add(ports.dashboard);
    }
    const uniquePorts = [
      ...new Set(
        Object.entries(ports)
          .filter(([name]) => !skipEvolution || name !== 'evolution')
          .map(([, port]) => port),
      ),
    ];
    const occupants = await Promise.all(
      uniquePorts.map(async (port) => ({
        port,
        occupant: await this.deps.getPortOccupant(port).catch(() => null),
      })),
    );
    for (const { port, occupant } of occupants) {
      if (
        occupant &&
        !expectedManagedPorts.has(port) &&
        (!occupant.pid || !managedPids.has(occupant.pid))
      ) {
        externalPortOccupants.push({ port, ...occupant });
      }
    }
    const required = expectedServices(state?.mode ?? loaded.mode);
    const runningCount = required.filter(
      (name) => processStatuses[name] === 'running',
    ).length;
    const infrastructureRunning =
      dockerServices.some((item) => item.state === 'running') ||
      evolutionServices.some((item) => item.state === 'running');
    const mainHealthy = ['postgres', 'redis'].every((service) =>
      dockerServices.some(
        (item) =>
          item.service === service &&
          item.state === 'running' &&
          item.health === 'healthy',
      ),
    );
    const evolutionHealthy =
      skipEvolution ||
      ['evolution-api', 'evolution-postgres', 'evolution-redis'].every(
        (service) =>
          evolutionServices.some(
            (item) =>
              item.service === service &&
              item.state === 'running' &&
              item.health === 'healthy',
          ),
      );
    const overall =
      runningCount === required.length &&
      mainHealthy &&
      evolutionHealthy &&
      apiAvailable &&
      dashboardHealth.ok &&
      (!controlPlaneRequired || controlPlaneAuthenticated)
        ? 'running'
        : runningCount === 0 && !infrastructureRunning
          ? 'stopped'
          : 'partial';
    const operationLock = await operationLockPromise;
    return {
      ...operationLock,
      overall,
      mode: state?.mode ?? loaded.mode,
      ports: {
        api: ports.api,
        dashboard: ports.dashboard,
      },
      docker: {
        daemon: dockerResult.code === 0 ? 'available' : 'unavailable',
        services: dockerServices,
      },
      evolution: {
        api: skipEvolution
          ? 'unavailable'
          : evolutionHealth &&
              typeof evolutionHealth === 'object' &&
              'status' in evolutionHealth &&
              evolutionHealth.status === 'unavailable'
            ? 'unavailable'
            : 'available',
        services: evolutionServices,
        whatsappConnection,
      },
      processes: processStatuses,
      endpoints: {
        api: apiAvailable ? 'available' : 'unavailable',
        dashboard:
          processStatuses.dashboard === 'running' && dashboardHealth.ok
            ? 'available'
            : 'unavailable',
      },
      controlPlane: {
        required: controlPlaneRequired,
        configured: controlPlaneConfigured,
        authenticated: controlPlaneAuthenticated,
      },
      schedulers: { legacy, commercial },
      automation,
      externalPortOccupants,
    };
  }

  async stop(processEnv: NodeJS.ProcessEnv = process.env) {
    const loaded = loadLocalSystemEnvironment(this.root, processEnv);
    const skipEvolution = shouldSkipEvolutionForExplicitSafePreview(loaded.env);
    const state = readState(this.root);
    const manualIntervention: string[] = [];
    if (state) {
      for (const spec of [...this.specs].reverse()) {
        const registered = state.processes[spec.name];
        if (!registered) continue;
        const inspection = await this.deps.inspectProcess(
          registered.pid,
          spec.marker,
          registered.startedAt,
        );
        if (!inspection.running) continue;
        if (!inspection.identityMatches) {
          manualIntervention.push(
            `${spec.name}: PID reutilizado ou divergente`,
          );
          continue;
        }
        if (!(await this.deps.stopProcessTree(registered.pid))) {
          manualIntervention.push(`${spec.name}: processo nao encerrou`);
        }
      }
    }
    const mainStop = await this.deps.run(
      composeSpec(this.root, [...composeArguments, 'stop'], loaded.env),
    );
    const evolutionStop = skipEvolution
      ? { code: 0, stdout: '', stderr: '' }
      : await this.deps.run(
          composeSpec(
            this.root,
            [...evolutionComposeArguments, 'stop'],
            loaded.env,
          ),
        );
    if (mainStop.code !== 0) manualIntervention.push('compose principal');
    if (!skipEvolution && evolutionStop.code !== 0) {
      manualIntervention.push('compose Evolution');
    }
    if (mainStop.code === 0) {
      const status = await this.deps.run(
        composeSpec(
          this.root,
          [...composeArguments, 'ps', '--format', 'json'],
          loaded.env,
        ),
      );
      if (
        status.code !== 0 ||
        parseComposeStatuses(status.stdout).some(
          (item) => item.state === 'running',
        )
      ) {
        manualIntervention.push('confirmacao do compose principal');
      }
    }
    if (!skipEvolution && evolutionStop.code === 0) {
      const status = await this.deps.run(
        composeSpec(
          this.root,
          [...evolutionComposeArguments, 'ps', '--format', 'json'],
          loaded.env,
        ),
      );
      if (
        status.code !== 0 ||
        parseComposeStatuses(status.stdout).some(
          (item) => item.state === 'running',
        )
      ) {
        manualIntervention.push('confirmacao do compose Evolution');
      }
    }

    if (manualIntervention.length === 0) {
      clearState(this.root);
      appendSupervisorLog(
        this.root,
        'Sistema parado sem remover containers, volumes, dados ou agendamentos',
      );
    }
    return { stopped: manualIntervention.length === 0, manualIntervention };
  }
}

export const describePortOccupant = (occupant: PortOccupant | null) =>
  occupant
    ? `${occupant.processName}${occupant.pid ? ` (PID ${occupant.pid})` : ''}`
    : 'livre';
