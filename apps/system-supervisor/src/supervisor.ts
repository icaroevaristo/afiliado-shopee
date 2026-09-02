import { existsSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, delimiter, resolve } from 'node:path';
import { loadConfig } from '@shopee-auto-affiliate-ai/config';
import { parseEvolutionConnectionState } from '@shopee-auto-affiliate-ai/providers';

import { loadLocalSystemEnvironment } from './environment';
import { ensureDashboardProductionBuild } from './dashboard-build';
import {
  evolutionComposeArguments,
  isValidComposeProjectName,
  mainComposeArguments,
  MAIN_POSTGRES_VOLUME_KEY,
  OPERATIONAL_COMPOSE_PROJECT_NAME,
  postgresVolumeName,
} from './runtime-identity';

export {
  composeProjectRuntimeRoot,
  evolutionComposeArguments,
  mainComposeArguments,
  OPERATIONAL_COMPOSE_PROJECT_NAME,
} from './runtime-identity';
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
  ProcessInspection,
  RegisteredProcess,
  ServiceName,
  SystemDependencies,
} from './types';

import {
  LocalSystemError,
  PREVIEW_STABILITY_PRISMA_VALIDATION,
  SERVICE_NAMES,
} from './types';

export type ServiceSpec = {
  name: ServiceName;
  command: string;
  args: string[] | ((ports: LocalSystemState['ports']) => string[]);
  marker: string;
  cwd?: string;
  env?: (runtimeEnv: NodeJS.ProcessEnv) => NodeJS.ProcessEnv;
  identity?: (
    inspection: ProcessInspection,
    ports: LocalSystemState['ports'],
  ) => boolean;
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
  projectName: string;
  service: MainInfrastructureService;
  image: string;
  targetPort: number;
  publishedPort: number;
  healthTest: string[];
  mounts: Array<{ type: string; target: string; source?: string }>;
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
    Name?: string;
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
  projectName: string,
): ExpectedMainInfrastructure[] | null => {
  try {
    const root = objectRecord(JSON.parse(stdout));
    const services = objectRecord(root?.services);
    if (!services) return null;
    if (root?.name !== projectName) return null;
    const volumeDefinitions = objectRecord(root?.volumes);
    const resolveVolumeName = (source: string) => {
      const definition = objectRecord(volumeDefinitions?.[source]);
      return typeof definition?.name === 'string'
        ? definition.name
        : `${projectName}_${source}`;
    };
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
      const serviceVolumes = Array.isArray(definition.volumes)
        ? definition.volumes
        : [];
      const mounts = serviceVolumes.flatMap((value) => {
        const mount = objectRecord(value);
        return mount &&
          typeof mount.type === 'string' &&
          typeof mount.target === 'string'
          ? [
              {
                type: mount.type,
                target: mount.target,
                ...(typeof mount.source === 'string'
                  ? { source: resolveVolumeName(mount.source) }
                  : {}),
              },
            ]
          : [];
      });
      return {
        projectName,
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
      const expectedMount = expected.mounts.find(
        (candidate) => candidate.target === mount.Destination,
      );
      if (
        expectedMount?.source !== undefined &&
        mount.Name !== expectedMount.source
      ) {
        return false;
      }
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
  checkMounts = true,
) => {
  const labels = inspection.Config?.Labels;
  if (
    !labels ||
    labels['com.docker.compose.service'] !== expected.service ||
    labels['com.docker.compose.project'] !== expected.projectName ||
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
  return (
    !checkMounts ||
    mountsMatchExpected(inspection, expected, imageVolumeTargets)
  );
};

export type ResolvedMainInfrastructureContainer = {
  id: string;
  service: 'postgres' | 'redis';
  health: 'healthy' | 'starting' | 'unhealthy' | 'unavailable' | 'unknown';
  volumeNames: string[];
};

const normalizedInfrastructureHealth = (value: string | undefined) =>
  value === 'healthy' || value === 'starting' || value === 'unhealthy'
    ? value
    : value
      ? 'unknown'
      : 'unavailable';

type MainInfrastructureContainerDiscovery =
  | { status: 'resolved'; containers: ResolvedMainInfrastructureContainer[] }
  | { status: 'mismatch'; containers: ResolvedMainInfrastructureContainer[] }
  | { status: 'unproven' }
  | { status: 'ambiguous' };

type MainInfrastructureRuntimeIdentity = {
  composeProjectName: string;
  expectedPostgresVolume: string;
  mountedPostgresVolume: string | null;
  mountedRedisVolumes: string[];
  volumeStatus:
    'canonical' | 'stopped' | 'unavailable' | 'mismatch' | 'ambiguous';
};

const discoverMainInfrastructureContainers = async (
  root: string,
  deps: SystemDependencies,
  env: NodeJS.ProcessEnv,
  ports: LocalSystemState['ports'],
  projectName: string,
): Promise<MainInfrastructureContainerDiscovery> => {
  try {
    const configResult = await deps.run(
      composeSpec(
        root,
        mainComposeArguments(projectName, ['config', '--format', 'json']),
        env,
      ),
    );
    if (configResult.code !== 0) return { status: 'unproven' };
    const expected = parseExpectedMainInfrastructure(
      configResult.stdout,
      ports,
      projectName,
    );
    if (!expected) return { status: 'unproven' };
    const listResult = await deps.run({
      command: 'docker',
      args: [
        'ps',
        '--filter',
        `label=com.docker.compose.project=${projectName}`,
        '--format',
        '{{.ID}}',
      ],
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
    let topologyMismatch = false;
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
      let candidate = candidates[0];
      if (!candidate) {
        const identityCandidates = inspections.filter((inspection) =>
          inspectionMatchesExpected(
            inspection,
            service,
            imageVolumeTargets,
            false,
          ),
        );
        if (identityCandidates.length > 1) return { status: 'ambiguous' };
        candidate = identityCandidates[0];
        if (!candidate) return { status: 'unproven' };
        topologyMismatch = true;
      }
      if (!candidate?.Id || !/^[a-f0-9]{12,64}$/i.test(candidate.Id)) {
        return { status: 'unproven' };
      }
      containers.push({
        id: candidate.Id,
        service: service.service,
        health: normalizedInfrastructureHealth(candidate.State?.Health?.Status),
        volumeNames: (candidate.Mounts ?? [])
          .filter(
            (mount): mount is typeof mount & { Name: string } =>
              mount.Type === 'volume' && typeof mount.Name === 'string',
          )
          .map((mount) => mount.Name),
      });
    }
    return {
      status: topologyMismatch ? 'mismatch' : 'resolved',
      containers,
    };
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
  projectName = OPERATIONAL_COMPOSE_PROJECT_NAME,
): Promise<MainInfrastructureServiceResolution> => {
  const discovery = await discoverMainInfrastructureContainers(
    root,
    deps,
    env,
    ports,
    projectName,
  );
  if (discovery.status === 'ambiguous') return discovery;
  if (discovery.status !== 'resolved') return { status: 'unproven' };
  const matches = discovery.containers.filter(
    (candidate) => candidate.service === service,
  );
  if (matches.length > 1) return { status: 'ambiguous' };
  if (matches.length === 0) return { status: 'unproven' };
  return { status: 'resolved', container: matches[0]! };
};

const discoverMainInfrastructure = async (
  root: string,
  deps: SystemDependencies,
  env: NodeJS.ProcessEnv,
  ports: LocalSystemState['ports'],
  projectName: string,
): Promise<ComposeServiceStatus[]> => {
  const discovery = await discoverMainInfrastructureContainers(
    root,
    deps,
    env,
    ports,
    projectName,
  );
  return discovery.status === 'resolved'
    ? discovery.containers.map(({ service, health }) => ({
        service,
        state: 'running',
        health,
      }))
    : [];
};

const runtimeIdentityFromDiscovery = (
  projectName: string,
  discovery: MainInfrastructureContainerDiscovery,
  composeServices: ComposeServiceStatus[],
): MainInfrastructureRuntimeIdentity => {
  const expectedPostgresVolume = postgresVolumeName(projectName);
  if (discovery.status === 'ambiguous') {
    return {
      composeProjectName: projectName,
      expectedPostgresVolume,
      mountedPostgresVolume: null,
      mountedRedisVolumes: [],
      volumeStatus: 'ambiguous',
    };
  }
  if (discovery.status === 'unproven') {
    return {
      composeProjectName: projectName,
      expectedPostgresVolume,
      mountedPostgresVolume: null,
      mountedRedisVolumes: [],
      volumeStatus: composeServices.some((item) => item.state === 'running')
        ? 'unavailable'
        : 'stopped',
    };
  }
  const postgres = discovery.containers.find(
    (container) => container.service === 'postgres',
  );
  const redis = discovery.containers.find(
    (container) => container.service === 'redis',
  );
  const mountedPostgresVolume = postgres?.volumeNames[0] ?? null;
  const mountedRedisVolumes = redis?.volumeNames ?? [];
  return {
    composeProjectName: projectName,
    expectedPostgresVolume,
    mountedPostgresVolume,
    mountedRedisVolumes,
    volumeStatus:
      discovery.status === 'resolved' &&
      postgres?.volumeNames.length === 1 &&
      mountedPostgresVolume === expectedPostgresVolume
        ? 'canonical'
        : 'mismatch',
  };
};

const runtimeVolumeStatus = (
  discovered: MainInfrastructureRuntimeIdentity,
  volume: PostgresVolumeIdentity,
): MainInfrastructureRuntimeIdentity['volumeStatus'] => {
  if (volume.status === 'ambiguous') return 'ambiguous';
  if (volume.status === 'mismatch') return 'mismatch';
  if (volume.status === 'unavailable') return 'unavailable';
  if (volume.status === 'absent' && discovered.volumeStatus === 'canonical') {
    return 'mismatch';
  }
  return discovered.volumeStatus;
};

type PostgresVolumeIdentityStatus =
  'canonical' | 'absent' | 'ambiguous' | 'mismatch' | 'unavailable';

export type PostgresVolumeIdentity = {
  expectedVolume: string;
  status: PostgresVolumeIdentityStatus;
};

export const inspectCanonicalPostgresVolume = async (
  root: string,
  deps: SystemDependencies,
  env: NodeJS.ProcessEnv,
  projectName: string,
): Promise<PostgresVolumeIdentity> => {
  const expectedVolume = postgresVolumeName(projectName);
  const listed = await deps
    .run({
      command: 'docker',
      args: ['volume', 'ls', '--format', '{{.Name}}'],
      cwd: root,
      env,
    })
    .catch(() => ({ code: 1, stdout: '', stderr: '' }));
  if (listed.code !== 0) {
    return { expectedVolume, status: 'unavailable' };
  }
  const volumeNames = [
    ...new Set(
      listed.stdout
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
  if (!volumeNames.includes(expectedVolume)) {
    const alternatives = volumeNames.filter((name) =>
      /(?:^|_)postgres_data$/i.test(name),
    );
    if (
      projectName === OPERATIONAL_COMPOSE_PROJECT_NAME &&
      alternatives.length > 0
    ) {
      return { expectedVolume, status: 'ambiguous' };
    }
    return { expectedVolume, status: 'absent' };
  }

  const inspected = await deps
    .run({
      command: 'docker',
      args: ['volume', 'inspect', expectedVolume],
      cwd: root,
      env,
    })
    .catch(() => ({ code: 1, stdout: '', stderr: '' }));
  if (inspected.code !== 0) {
    return { expectedVolume, status: 'unavailable' };
  }
  try {
    const parsed: unknown = JSON.parse(inspected.stdout);
    if (!Array.isArray(parsed) || parsed.length !== 1) throw new Error();
    const volume = objectRecord(parsed[0]);
    if (!volume || volume.Name !== expectedVolume) throw new Error();
    const labels = objectRecord(volume.Labels);
    if (
      !labels ||
      labels['com.docker.compose.project'] !== projectName ||
      labels['com.docker.compose.volume'] !== MAIN_POSTGRES_VOLUME_KEY
    ) {
      throw new Error();
    }
    return { expectedVolume, status: 'canonical' };
  } catch {
    return { expectedVolume, status: 'mismatch' };
  }
};

const postgresVolumeIdentityError = (status: PostgresVolumeIdentityStatus) =>
  new LocalSystemError(
    status === 'ambiguous'
      ? 'Ha mais de uma identidade possivel para o banco operacional; nenhuma sera escolhida automaticamente'
      : status === 'unavailable' || status === 'absent'
        ? 'Nao foi possivel verificar a identidade do volume PostgreSQL'
        : 'O volume PostgreSQL canonico nao corresponde ao projeto esperado',
    status === 'ambiguous'
      ? 'SYSTEM_DATABASE_VOLUME_AMBIGUOUS'
      : status === 'unavailable' || status === 'absent'
        ? 'SYSTEM_DATABASE_VOLUME_IDENTITY_UNAVAILABLE'
        : 'SYSTEM_DATABASE_VOLUME_IDENTITY_MISMATCH',
  );

export const assertCanonicalPostgresVolume = async (
  root: string,
  deps: SystemDependencies,
  env: NodeJS.ProcessEnv,
  projectName: string,
  options: { requireExisting?: boolean } = {},
) => {
  const identity = await inspectCanonicalPostgresVolume(
    root,
    deps,
    env,
    projectName,
  );
  if (
    identity.status === 'canonical' ||
    (identity.status === 'absent' && !options.requireExisting)
  ) {
    return identity;
  }
  throw postgresVolumeIdentityError(identity.status);
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

const processArguments = (command: string) =>
  command
    .match(/"[^"]*"|'[^']*'|\S+/g)
    ?.map((argument) => argument.replace(/^['"]|['"]$/g, '')) ?? [];

const normalizedPath = (value: string) =>
  value
    .replaceAll('\\', '/')
    .replace(/^\/\/\?\//, '/')
    .toLowerCase();

const dashboardProcessIdentity = (
  inspection: ProcessInspection,
  dashboardPort: number,
  nodePath: string,
  nextPath: string,
  dashboardDirectory: string,
) => {
  const command = inspection.command?.replaceAll('\\', '/');
  if (!command) return false;
  const args = processArguments(command);
  const expected = [
    nodePath,
    nextPath,
    'start',
    dashboardDirectory,
    '-p',
    String(dashboardPort),
    '-H',
    '127.0.0.1',
  ];
  return (
    args.length === expected.length &&
    args.every((argument, index) => {
      const expectedArgument = expected[index];
      if (index === 0 || index === 1 || index === 3) {
        return normalizedPath(argument) === normalizedPath(expectedArgument);
      }
      return argument.toLowerCase() === expectedArgument.toLowerCase();
    })
  );
};

const serviceIdentityMatches = (
  spec: ServiceSpec,
  inspection: ProcessInspection,
  ports: LocalSystemState['ports'],
) =>
  inspection.running &&
  inspection.identityMatches &&
  (spec.identity ? spec.identity(inspection, ports) : true);

export const resolveServiceArgs = (
  spec: ServiceSpec,
  ports: LocalSystemState['ports'],
) => (typeof spec.args === 'function' ? spec.args(ports) : spec.args);

export const resolveServiceEnv = (
  spec: ServiceSpec,
  runtimeEnv: NodeJS.ProcessEnv,
) => (spec.env ? spec.env(runtimeEnv) : runtimeEnv);

export const createServiceSpecs = (root: string): ServiceSpec[] => {
  const rootRequire = createRequire(resolve(root, 'package.json'));
  const dashboardRequire = createRequire(
    resolve(root, 'apps/dashboard/package.json'),
  );
  const tsx = rootRequire.resolve('tsx/cli');
  const next = dashboardRequire.resolve('next/dist/bin/next');
  const dashboardDirectory = resolve(root, 'apps/dashboard');
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
      args: (ports) => [
        next,
        'start',
        dashboardDirectory,
        '-p',
        String(ports.dashboard),
        '-H',
        '127.0.0.1',
      ],
      marker: processMarker(next),
      cwd: dashboardDirectory,
      env: (runtimeEnv) => ({ ...runtimeEnv, NODE_ENV: 'production' }),
      identity: (inspection, ports) =>
        dashboardProcessIdentity(
          inspection,
          ports.dashboard,
          process.execPath,
          next,
          dashboardDirectory,
        ),
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

const isolatedEvolutionError = () =>
  new LocalSystemError(
    'Ambiente Compose isolado exige uma identidade Evolution dedicada; a stack operacional compartilhada nao sera alterada',
    'SYSTEM_ISOLATED_EVOLUTION_IDENTITY_UNAVAILABLE',
  );

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

const waitForMainInfrastructureHealth = async (
  root: string,
  deps: SystemDependencies,
  env: NodeJS.ProcessEnv,
  ports: LocalSystemState['ports'],
  projectName: string,
) =>
  waitFor(
    async () =>
      hasHealthyMainInfrastructure(
        await discoverMainInfrastructure(root, deps, env, ports, projectName),
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
    if (serviceIdentityMatches(spec, inspection, state.ports)) {
      valid[spec.name] = registered;
    } else if (inspection.running) {
      reused.push(spec.name);
    }
  }
  return { valid, reused };
};

const composeProjectMismatchError = (requested: string) =>
  new LocalSystemError(
    `O estado local pertence a outro projeto Compose; confirme explicitamente ${requested}`,
    'SYSTEM_COMPOSE_PROJECT_MISMATCH',
  );

const legacyComposeProjectIdentityError = () =>
  new LocalSystemError(
    'O estado local ativo nao informa a identidade Compose; nenhuma infraestrutura sera alterada',
    'SYSTEM_COMPOSE_PROJECT_IDENTITY_UNAVAILABLE',
  );

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

const assertRegisteredServicePortsUnchanged = (
  previous: LocalSystemState | null,
  processes: LocalSystemState['processes'],
  ports: LocalSystemState['ports'],
) => {
  if (!previous) return;
  for (const service of ['api', 'dashboard'] as const) {
    if (processes[service] && previous.ports[service] !== ports[service]) {
      throw new LocalSystemError(
        `A porta do servico ${service} mudou enquanto o processo estava ativo; pare o sistema antes de alterar a configuracao`,
        'SYSTEM_PORT_CONFIGURATION_CHANGED',
      );
    }
  }
};

export type SystemStatusSnapshot = OperationLockSnapshot & {
  overall: 'running' | 'partial' | 'stopped';
  mode: AutomationMode;
  ports: {
    api: number;
    dashboard: number;
  };
  runtime: MainInfrastructureRuntimeIdentity;
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
  private readonly loadEnvironmentFiles: boolean;
  private readonly composeProjectName: string;
  private readonly operationLockRoot: string;

  constructor(
    private readonly root: string,
    private readonly deps: SystemDependencies,
    specs?: ServiceSpec[],
    options: {
      validateRoot?: () => boolean;
      loadEnvironmentFiles?: boolean;
      composeProjectName?: string;
      operationLockRoot?: string;
    } = {},
  ) {
    this.specs = specs ?? createServiceSpecs(root);
    this.validateRoot =
      options.validateRoot ??
      (() => realpathSync(process.cwd()) === realpathSync(this.root));
    this.loadEnvironmentFiles = options.loadEnvironmentFiles ?? true;
    const composeProjectName =
      options.composeProjectName ?? OPERATIONAL_COMPOSE_PROJECT_NAME;
    if (!isValidComposeProjectName(composeProjectName)) {
      throw new LocalSystemError(
        'Identidade Docker do sistema invalida',
        'SYSTEM_INVALID_COMPOSE_PROJECT',
      );
    }
    this.composeProjectName = composeProjectName;
    this.operationLockRoot = options.operationLockRoot ?? this.root;
  }

  private loadEnvironment(processEnv: NodeJS.ProcessEnv) {
    return loadLocalSystemEnvironment(this.root, processEnv, {
      loadFiles: this.loadEnvironmentFiles,
    });
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

    const loaded = this.loadEnvironment(processEnv);
    const runtimeEnv = loaded.env;
    const skipEvolution = shouldSkipEvolutionForExplicitSafePreview(runtimeEnv);
    if (
      this.composeProjectName !== OPERATIONAL_COMPOSE_PROJECT_NAME &&
      !skipEvolution
    ) {
      throw isolatedEvolutionError();
    }
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
    if (
      previous?.composeProjectName !== undefined &&
      previous.composeProjectName !== this.composeProjectName
    ) {
      throw composeProjectMismatchError(this.composeProjectName);
    }
    const inspected = await inspectRegisteredProcesses(
      previous,
      this.specs,
      this.deps,
    );
    if (
      previous &&
      previous.composeProjectName === undefined &&
      Object.keys(inspected.valid).length > 0
    ) {
      throw legacyComposeProjectIdentityError();
    }
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
    assertRegisteredServicePortsUnchanged(
      previous,
      inspected.valid,
      loaded.ports,
    );
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
    if (!inspected.valid.dashboard) {
      await ensureDashboardProductionBuild({
        root: this.root,
        deps: this.deps,
        runtimeEnv,
        buildCommand: pnpmSpec(
          this.root,
          ['--filter', '@shopee-auto-affiliate-ai/dashboard', 'build'],
          { ...runtimeEnv, NODE_ENV: 'production' },
        ),
      });
    }
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
    await assertCanonicalPostgresVolume(
      this.root,
      this.deps,
      runtimeEnv,
      this.composeProjectName,
      {
        requireExisting:
          this.composeProjectName === OPERATIONAL_COMPOSE_PROJECT_NAME,
      },
    );
    const mainBeforeStart = await this.deps.run(
      composeSpec(
        this.root,
        mainComposeArguments(this.composeProjectName, [
          'ps',
          '--format',
          'json',
        ]),
        runtimeEnv,
      ),
    );
    const evolutionBeforeStart = skipEvolution
      ? { code: 0, stdout: '', stderr: '' }
      : await this.deps.run(
          composeSpec(
            this.root,
            evolutionComposeArguments(['ps', '--format', 'json']),
            runtimeEnv,
          ),
        );
    const currentMainServices = parseComposeStatuses(mainBeforeStart.stdout);
    const currentMainHealthy =
      hasHealthyMainInfrastructure(currentMainServices);
    const mainDiscovery = await discoverMainInfrastructureContainers(
      this.root,
      this.deps,
      runtimeEnv,
      loaded.ports,
      this.composeProjectName,
    );
    const mainRuntime = runtimeIdentityFromDiscovery(
      this.composeProjectName,
      mainDiscovery,
      currentMainServices,
    );
    if (
      mainDiscovery.status === 'ambiguous' ||
      mainDiscovery.status === 'mismatch' ||
      (mainDiscovery.status === 'resolved' &&
        mainRuntime.volumeStatus !== 'canonical') ||
      (currentMainServices.some((item) => item.state === 'running') &&
        mainRuntime.volumeStatus !== 'canonical')
    ) {
      throw new LocalSystemError(
        'A identidade da infraestrutura PostgreSQL principal nao pode ser confirmada com seguranca',
        mainRuntime.volumeStatus === 'ambiguous'
          ? 'SYSTEM_DATABASE_VOLUME_AMBIGUOUS'
          : mainRuntime.volumeStatus === 'mismatch'
            ? 'SYSTEM_DATABASE_VOLUME_IDENTITY_MISMATCH'
            : 'SYSTEM_DATABASE_VOLUME_IDENTITY_UNAVAILABLE',
      );
    }
    const discoveredMainServices =
      mainDiscovery.status === 'resolved'
        ? mainDiscovery.containers.map(({ service, health }) => ({
            service,
            state: 'running',
            health,
          }))
        : [];
    const discoveredMainComplete = hasCompleteMainInfrastructure(
      discoveredMainServices,
    );
    const reuseMainInfrastructure =
      !currentMainHealthy && discoveredMainComplete;
    const mainServices = mergeMainInfrastructureStatuses(
      currentMainServices,
      discoveredMainServices,
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

    if (!reuseMainInfrastructure) {
      await runRequired(
        this.deps,
        composeSpec(
          this.root,
          mainComposeArguments(this.composeProjectName, ['up', '-d']),
          runtimeEnv,
        ),
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
      ...(reuseMainInfrastructure
        ? [
            waitForMainInfrastructureHealth(
              this.root,
              this.deps,
              runtimeEnv,
              loaded.ports,
              this.composeProjectName,
            ),
          ]
        : [
            waitForComposeHealth(
              this.root,
              this.deps,
              mainComposeArguments(this.composeProjectName),
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
              evolutionComposeArguments(),
              ['evolution-api', 'evolution-postgres', 'evolution-redis'],
              'EVOLUTION_COMPOSE_UNHEALTHY',
              runtimeEnv,
            ),
          ]),
    ]);
    const verifiedMainDiscovery = await discoverMainInfrastructureContainers(
      this.root,
      this.deps,
      runtimeEnv,
      loaded.ports,
      this.composeProjectName,
    );
    const verifiedMainRuntime = runtimeIdentityFromDiscovery(
      this.composeProjectName,
      verifiedMainDiscovery,
      mainServices,
    );
    if (
      verifiedMainDiscovery.status !== 'resolved' ||
      verifiedMainRuntime.volumeStatus !== 'canonical'
    ) {
      throw new LocalSystemError(
        'A infraestrutura PostgreSQL principal nao corresponde ao volume canonico esperado',
        verifiedMainRuntime.volumeStatus === 'ambiguous'
          ? 'SYSTEM_DATABASE_VOLUME_AMBIGUOUS'
          : verifiedMainRuntime.volumeStatus === 'unavailable'
            ? 'SYSTEM_DATABASE_VOLUME_IDENTITY_UNAVAILABLE'
            : 'SYSTEM_DATABASE_VOLUME_IDENTITY_MISMATCH',
      );
    }
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
      composeProjectName: this.composeProjectName,
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
            args: resolveServiceArgs(spec, state.ports),
            cwd: spec.cwd ?? this.root,
            env: resolveServiceEnv(spec, runtimeEnv),
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
          if (!serviceIdentityMatches(spec, inspection, state.ports)) {
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
          !serviceIdentityMatches(spec, inspection, state.ports) ||
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
    const loaded = this.loadEnvironment(processEnv);
    const skipEvolution = shouldSkipEvolutionForExplicitSafePreview(loaded.env);
    if (
      this.composeProjectName !== OPERATIONAL_COMPOSE_PROJECT_NAME &&
      !skipEvolution
    ) {
      throw isolatedEvolutionError();
    }
    const state = readState(this.root);
    if (
      state?.composeProjectName !== undefined &&
      state.composeProjectName !== this.composeProjectName
    ) {
      throw composeProjectMismatchError(this.composeProjectName);
    }
    const operationLockPromise = inspectOperationLock(
      this.operationLockRoot,
      this.deps,
    );
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
              : serviceIdentityMatches(spec, inspection, ports)
                ? 'running'
                : 'identity-mismatch',
          ] as const;
        }),
      ),
    ) as SystemStatusSnapshot['processes'];
    if ((state?.mode ?? loaded.mode) === 'preview') {
      processStatuses['whatsapp-dispatch-worker'] = 'not-required';
    }
    if (
      state &&
      state.composeProjectName === undefined &&
      Object.values(processStatuses).some((value) => value === 'running')
    ) {
      throw legacyComposeProjectIdentityError();
    }

    const [dockerResult, evolutionResult] = await Promise.all([
      this.deps
        .run(
          composeSpec(
            this.root,
            mainComposeArguments(this.composeProjectName, [
              'ps',
              '--format',
              'json',
            ]),
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
                evolutionComposeArguments(['ps', '--format', 'json']),
                loaded.env,
              ),
            )
            .catch(() => ({ code: 1, stdout: '', stderr: '' })),
    ]);
    const currentDockerServices =
      dockerResult.code === 0 ? parseComposeStatuses(dockerResult.stdout) : [];
    const mainDiscovery = await discoverMainInfrastructureContainers(
      this.root,
      this.deps,
      loaded.env,
      ports,
      this.composeProjectName,
    );
    const discoveredRuntime = runtimeIdentityFromDiscovery(
      this.composeProjectName,
      mainDiscovery,
      currentDockerServices,
    );
    const volumeIdentity = await inspectCanonicalPostgresVolume(
      this.root,
      this.deps,
      loaded.env,
      this.composeProjectName,
    );
    const runtime = {
      ...discoveredRuntime,
      volumeStatus: runtimeVolumeStatus(discoveredRuntime, volumeIdentity),
    } satisfies MainInfrastructureRuntimeIdentity;
    const discoveredMainServices =
      mainDiscovery.status === 'resolved'
        ? mainDiscovery.containers.map(({ service, health }) => ({
            service,
            state: 'running',
            health,
          }))
        : [];
    const equivalentMainServices = hasHealthyMainInfrastructure(
      currentDockerServices,
    )
      ? []
      : discoveredMainServices;
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
    const mainHealthy =
      runtime.volumeStatus === 'canonical' &&
      ['postgres', 'redis'].every((service) =>
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
      runtime,
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
    const loaded = this.loadEnvironment(processEnv);
    const skipEvolution = shouldSkipEvolutionForExplicitSafePreview(loaded.env);
    if (
      this.composeProjectName !== OPERATIONAL_COMPOSE_PROJECT_NAME &&
      !skipEvolution
    ) {
      return {
        stopped: false,
        manualIntervention: [isolatedEvolutionError().message],
      };
    }
    const state = readState(this.root);
    const manualIntervention: string[] = [];
    if (
      state?.composeProjectName !== undefined &&
      state.composeProjectName !== this.composeProjectName
    ) {
      return {
        stopped: false,
        manualIntervention: [
          composeProjectMismatchError(this.composeProjectName).message,
        ],
      };
    }
    if (state && state.composeProjectName === undefined) {
      const legacyInspection = await inspectRegisteredProcesses(
        state,
        this.specs,
        this.deps,
      );
      if (Object.keys(legacyInspection.valid).length > 0) {
        return {
          stopped: false,
          manualIntervention: [legacyComposeProjectIdentityError().message],
        };
      }
    }
    const mainBeforeStop = await this.deps
      .run(
        composeSpec(
          this.root,
          mainComposeArguments(this.composeProjectName, [
            'ps',
            '--format',
            'json',
          ]),
          loaded.env,
        ),
      )
      .catch(() => ({ code: 1, stdout: '', stderr: '' }));
    const evolutionBeforeStop = skipEvolution
      ? { code: 0, stdout: '', stderr: '' }
      : await this.deps
          .run(
            composeSpec(
              this.root,
              evolutionComposeArguments(['ps', '--format', 'json']),
              loaded.env,
            ),
          )
          .catch(() => ({ code: 1, stdout: '', stderr: '' }));
    if (mainBeforeStop.code !== 0 || evolutionBeforeStop.code !== 0) {
      return {
        stopped: false,
        manualIntervention: [
          'nao foi possivel confirmar a propriedade da infraestrutura antes do stop',
        ],
      };
    }

    const validatedProcesses: Array<{
      spec: ServiceSpec;
      registered: RegisteredProcess;
    }> = [];
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
        if (!serviceIdentityMatches(spec, inspection, state.ports)) {
          manualIntervention.push(
            `${spec.name}: PID reutilizado ou divergente`,
          );
          continue;
        }
        validatedProcesses.push({ spec, registered });
      }
    }
    const mainRunning = parseComposeStatuses(mainBeforeStop.stdout).some(
      (item) => item.state === 'running',
    );
    const evolutionRunning = parseComposeStatuses(
      evolutionBeforeStop.stdout,
    ).some((item) => item.state === 'running');
    if (mainRunning) {
      const mainDiscovery = await discoverMainInfrastructureContainers(
        this.root,
        this.deps,
        loaded.env,
        loaded.ports,
        this.composeProjectName,
      );
      const mainRuntime = runtimeIdentityFromDiscovery(
        this.composeProjectName,
        mainDiscovery,
        parseComposeStatuses(mainBeforeStop.stdout),
      );
      const mainVolumeIdentity = await inspectCanonicalPostgresVolume(
        this.root,
        this.deps,
        loaded.env,
        this.composeProjectName,
      );
      const verifiedMainRuntime = {
        ...mainRuntime,
        volumeStatus: runtimeVolumeStatus(mainRuntime, mainVolumeIdentity),
      } satisfies MainInfrastructureRuntimeIdentity;
      const discoveredMainServices =
        mainDiscovery.status === 'resolved'
          ? mainDiscovery.containers.map(({ service, health }) => ({
              service,
              state: 'running',
              health,
            }))
          : [];
      if (
        mainDiscovery.status !== 'resolved' ||
        !hasCompleteMainInfrastructure(discoveredMainServices) ||
        verifiedMainRuntime.volumeStatus !== 'canonical'
      ) {
        return {
          stopped: false,
          manualIntervention: [
            'nao foi possivel confirmar a identidade da infraestrutura principal antes do stop',
          ],
        };
      }
    }
    const validatedPids = new Set(
      validatedProcesses.map(({ registered }) => registered.pid),
    );
    const applicationPortOccupants = await Promise.all(
      [loaded.ports.api, loaded.ports.dashboard].map(async (port) => {
        try {
          return {
            port,
            occupant: await this.deps.getPortOccupant(port),
            unavailable: false,
          };
        } catch {
          return { port, occupant: null, unavailable: true as const };
        }
      }),
    );
    if (applicationPortOccupants.some((item) => item.unavailable)) {
      return {
        stopped: false,
        manualIntervention: [
          ...manualIntervention,
          'nao foi possivel confirmar a propriedade das portas da aplicacao',
        ],
      };
    }
    const unownedApplicationProcess = applicationPortOccupants.some(
      ({ occupant }) =>
        occupant !== null &&
        (!occupant.pid || !validatedPids.has(occupant.pid)),
    );
    if ((mainRunning || evolutionRunning) && validatedProcesses.length === 0) {
      return {
        stopped: false,
        manualIntervention: [
          ...manualIntervention,
          'infraestrutura em execucao sem estado local pertencente a esta worktree',
        ],
      };
    }
    if (unownedApplicationProcess) {
      return {
        stopped: false,
        manualIntervention: [
          ...manualIntervention,
          'processo de aplicacao em execucao sem estado local pertencente a esta worktree',
        ],
      };
    }
    for (const { spec, registered } of validatedProcesses) {
      if (!(await this.deps.stopProcessTree(registered.pid))) {
        manualIntervention.push(`${spec.name}: processo nao encerrou`);
      }
    }
    const mainStop = await this.deps.run(
      composeSpec(
        this.root,
        mainComposeArguments(this.composeProjectName, ['stop']),
        loaded.env,
      ),
    );
    const evolutionStop = skipEvolution
      ? { code: 0, stdout: '', stderr: '' }
      : await this.deps.run(
          composeSpec(
            this.root,
            evolutionComposeArguments(['stop']),
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
          mainComposeArguments(this.composeProjectName, [
            'ps',
            '--format',
            'json',
          ]),
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
          evolutionComposeArguments(['ps', '--format', 'json']),
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
