import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  operationLockPath,
  statePath,
  SUPERVISOR_PROCESS_MARKER,
} from '../src/state-store';
import {
  composeProjectRuntimeRoot,
  evolutionComposeArguments,
} from '../src/runtime-identity';
import { LocalSystemSupervisor } from '../src/supervisor';
import type {
  CommandSpec,
  LocalSystemState,
  PortOccupant,
  ServiceName,
  SystemDependencies,
} from '../src/types';
import { PREVIEW_STABILITY_PRISMA_VALIDATION } from '../src/types';

const directories: string[] = [];
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
];

const createRoot = () => {
  const root = mkdtempSync(join(tmpdir(), 'local-system-supervisor-'));
  directories.push(root);
  for (const file of requiredFiles) {
    const target = join(root, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, '{}');
  }
  return root;
};

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const specs = (
  [
    ['api', 'api-entry', 'http://api/health'],
    ['dashboard', 'dashboard-entry', 'http://dashboard'],
    ['commercial-worker', 'commercial-entry'],
    ['whatsapp-dispatch-worker', 'dispatch-entry'],
  ] as const
).map(([name, marker, healthUrl]) => ({
  name,
  command: 'node',
  args: [marker],
  marker,
  ...(name === 'dashboard' ? { cwd: 'dashboard-root' } : {}),
  ...(healthUrl ? { healthUrl: () => healthUrl } : {}),
}));

const composeLines = (evolution: boolean) =>
  (evolution
    ? ['evolution-api', 'evolution-postgres', 'evolution-redis']
    : ['postgres', 'redis']
  )
    .map((service) =>
      JSON.stringify({ Service: service, State: 'running', Health: 'healthy' }),
    )
    .join('\n');

const mainComposeConfig = (projectName = 'afiliado-shopee') =>
  JSON.stringify({
    name: projectName,
    services: {
      postgres: {
        image: 'postgres:16-alpine',
        ports: [{ target: 5432, published: '5432', protocol: 'tcp' }],
        healthcheck: { test: ['CMD-SHELL', 'pg_isready'] },
        volumes: [
          {
            type: 'volume',
            source: 'postgres_data',
            target: '/var/lib/postgresql/data',
          },
        ],
      },
      redis: {
        image: 'redis:7-alpine',
        ports: [{ target: 6379, published: '6379', protocol: 'tcp' }],
        healthcheck: { test: ['CMD', 'redis-cli', 'ping'] },
        volumes: [],
      },
    },
    volumes: { postgres_data: {} },
  });

type DockerInspectionFixture = {
  Id: string;
  Config: {
    Image: string;
    Labels: Record<string, string>;
    Healthcheck: { Test: string[] };
  };
  State: { Running: boolean; Health: { Status: string } };
  NetworkSettings: {
    Ports: Record<string, Array<{ HostPort: string }>>;
  };
  Mounts: Array<{
    Type: string;
    Name?: string;
    Destination: string;
    RW?: boolean;
    Mode?: string;
    Propagation?: string;
  }>;
};

const dockerInspection = (
  service: 'postgres' | 'redis',
  health: 'healthy' | 'starting' | 'unhealthy' = 'healthy',
  projectName = 'afiliado-shopee',
): DockerInspectionFixture => {
  const postgres = service === 'postgres';
  return {
    Id: postgres ? 'aaaaaaaaaaaa' : 'bbbbbbbbbbbb',
    Config: {
      Image: postgres ? 'postgres:16-alpine' : 'redis:7-alpine',
      Labels: {
        'com.docker.compose.service': service,
        'com.docker.compose.project': projectName,
        'com.docker.compose.project.config_files': 'docker-compose.yml',
        'com.docker.compose.project.working_dir': 'canonical-workdir',
      },
      Healthcheck: {
        Test: postgres
          ? ['CMD-SHELL', 'pg_isready']
          : ['CMD', 'redis-cli', 'ping'],
      },
    },
    State: { Running: true, Health: { Status: health } },
    NetworkSettings: {
      Ports: {
        [`${postgres ? 5432 : 6379}/tcp`]: [
          { HostPort: postgres ? '5432' : '6379' },
        ],
      },
    },
    Mounts: postgres
      ? [
          {
            Type: 'volume',
            Name: `${projectName}_postgres_data`,
            Destination: '/var/lib/postgresql/data',
          },
        ]
      : [],
  };
};

type DockerDiscoveryFixture = {
  config?: { code: number; stdout: string };
  list?: { code: number; stdout: string };
  inspect?: { code: number; stdout: string };
  imageInspect?: Record<string, { code: number; stdout: string }>;
};

const imageInspection = (volumeTargets: readonly string[] = []) =>
  JSON.stringify([
    {
      Config: {
        Volumes: Object.fromEntries(
          volumeTargets.map((target) => [target, {}]),
        ),
      },
    },
  ]);

const equivalentDockerDiscovery = (
  health: 'healthy' | 'starting' | 'unhealthy' = 'healthy',
  projectName = 'afiliado-shopee',
): DockerDiscoveryFixture => ({
  config: { code: 0, stdout: mainComposeConfig(projectName) },
  list: { code: 0, stdout: 'aaaaaaaaaaaa\nbbbbbbbbbbbb\n' },
  inspect: {
    code: 0,
    stdout: JSON.stringify([
      dockerInspection('postgres', health, projectName),
      dockerInspection('redis', health, projectName),
    ]),
  },
  imageInspect: {
    'postgres:16-alpine': { code: 0, stdout: imageInspection() },
    'redis:7-alpine': { code: 0, stdout: imageInspection() },
  },
});
const harness = (
  options: {
    dockerAvailable?: boolean;
    mainComposeStartFails?: boolean;
    infrastructureHealthFails?: boolean;
    migrationFails?: boolean;
    dashboardBuildFails?: boolean;
    healthFails?: boolean;
    dieAfterInitialInspection?: ServiceName;
    portOccupants?: Record<number, PortOccupant>;
    managedDescendants?: Record<number, number[]>;
    dockerDiscovery?: DockerDiscoveryFixture;
    volumeProjectName?: string;
    volumeNames?: string[];
    volumeLabels?: Record<string, string> | null;
    dockerDiscoveryThrowsAt?: 'config' | 'list' | 'inspect' | 'imageInspect';
    requiredAuthToken?: string;
  } = {},
) => {
  let nextPid = 100;
  let mainRunning = false;
  let evolutionRunning = false;
  const processes = new Map<
    number,
    { running: boolean; marker: string; startedAt: string; matches: boolean }
  >();
  const commands: CommandSpec[] = [];
  const stopped: number[] = [];
  const spawned: ServiceName[] = [];
  const spawnCommandIndexes: number[] = [];
  const spawnedCwds = new Map<ServiceName, string>();
  const inspectionCounts = new Map<number, number>();
  const run = vi.fn(async (spec: CommandSpec) => {
    commands.push(spec);
    if (spec.command === 'git' && spec.args[0] === 'rev-parse') {
      return { code: 0, stdout: `${'a'.repeat(40)}\n`, stderr: '' };
    }
    if (spec.command === 'git' && spec.args[0] === 'status') {
      return { code: 0, stdout: '', stderr: '' };
    }
    if (
      spec.args.includes('@shopee-auto-affiliate-ai/dashboard') &&
      spec.args.includes('build')
    ) {
      if (options.dashboardBuildFails) {
        return { code: 1, stdout: '', stderr: 'dashboard build failed' };
      }
      const buildDirectory = join(spec.cwd, 'apps', 'dashboard', '.next');
      mkdirSync(buildDirectory, { recursive: true });
      writeFileSync(join(buildDirectory, 'BUILD_ID'), 'test-build-id\n');
      return { code: 0, stdout: '', stderr: '' };
    }
    if (spec.args.includes('config') && spec.args.includes('--format')) {
      if (options.dockerDiscoveryThrowsAt === 'config')
        throw new Error('timeout');
      const fixture = options.dockerDiscovery?.config;
      return {
        code: fixture?.code ?? 0,
        stdout: fixture?.stdout ?? mainComposeConfig(),
        stderr: '',
      };
    }
    if (
      spec.command === 'docker' &&
      spec.args[0] === 'ps' &&
      spec.args.includes('{{.ID}}')
    ) {
      if (options.dockerDiscoveryThrowsAt === 'list')
        throw new Error('timeout');
      const fixture = options.dockerDiscovery?.list;
      return {
        code: fixture?.code ?? 0,
        stdout:
          fixture?.stdout ??
          (mainRunning ? 'aaaaaaaaaaaa\nbbbbbbbbbbbb\n' : ''),
        stderr: '',
      };
    }
    if (
      spec.command === 'docker' &&
      spec.args[0] === 'image' &&
      spec.args[1] === 'inspect'
    ) {
      if (options.dockerDiscoveryThrowsAt === 'imageInspect') {
        throw new Error('timeout');
      }
      const fixture =
        options.dockerDiscovery?.imageInspect?.[spec.args[2] ?? ''];
      return {
        code: fixture?.code ?? (mainRunning ? 0 : 1),
        stdout: fixture?.stdout ?? (mainRunning ? imageInspection() : ''),
        stderr: '',
      };
    }
    if (spec.command === 'docker' && spec.args[0] === 'inspect') {
      if (options.dockerDiscoveryThrowsAt === 'inspect')
        throw new Error('timeout');
      const fixture = options.dockerDiscovery?.inspect;
      return {
        code: fixture?.code ?? (mainRunning ? 0 : 1),
        stdout:
          fixture?.stdout ??
          (mainRunning
            ? JSON.stringify([
                dockerInspection(
                  'postgres',
                  'healthy',
                  options.volumeProjectName,
                ),
                dockerInspection('redis', 'healthy', options.volumeProjectName),
              ])
            : ''),
        stderr: '',
      };
    }
    if (spec.args.length === 1 && spec.args[0] === 'info') {
      return {
        code: options.dockerAvailable === false ? 1 : 0,
        stdout: '',
        stderr: '',
      };
    }
    if (spec.command === 'docker' && spec.args[0] === 'volume') {
      if (spec.args[1] === 'ls') {
        const volumeProject = options.volumeProjectName ?? 'afiliado-shopee';
        return {
          code: 0,
          stdout: `${(
            options.volumeNames ?? [`${volumeProject}_postgres_data`]
          ).join('\n')}\n`,
          stderr: '',
        };
      }
      if (spec.args[1] === 'inspect') {
        const volumeProject = options.volumeProjectName ?? 'afiliado-shopee';
        return {
          code: 0,
          stdout: JSON.stringify([
            {
              Name: `${volumeProject}_postgres_data`,
              Labels:
                options.volumeLabels === undefined
                  ? {
                      'com.docker.compose.project': volumeProject,
                      'com.docker.compose.volume': 'postgres_data',
                    }
                  : options.volumeLabels,
            },
          ]),
          stderr: '',
        };
      }
    }
    const evolution = spec.args.includes('infra/evolution/docker-compose.yml');
    if (spec.args.includes('up') || spec.args.includes('evolution:up')) {
      if (spec.args.includes('evolution:up')) evolutionRunning = true;
      else if (options.mainComposeStartFails) {
        return { code: 1, stdout: '', stderr: 'compose start failed' };
      } else mainRunning = true;
    }
    if (spec.args.includes('stop')) {
      if (evolution) evolutionRunning = false;
      else mainRunning = false;
    }
    if (spec.args.includes('ps')) {
      const running = evolution ? evolutionRunning : mainRunning;
      return {
        code: 0,
        stdout:
          running && !options.infrastructureHealthFails
            ? composeLines(evolution)
            : '',
        stderr: '',
      };
    }
    if (spec.args.includes('db:deploy') && options.migrationFails) {
      return { code: 1, stdout: '', stderr: 'migration failed' };
    }
    return { code: 0, stdout: '', stderr: '' };
  });
  const deps: SystemDependencies = {
    run,
    spawn: vi.fn(async (spec) => {
      spawnCommandIndexes.push(commands.length);
      const pid = nextPid++;
      const startedAt = `2026-07-25T12:00:${String(pid - 100).padStart(2, '0')}.000Z`;
      const marker = spec.args[0];
      processes.set(pid, { running: true, marker, startedAt, matches: true });
      const name = specs.find((item) => item.marker === marker)
        ?.name as ServiceName;
      spawned.push(name);
      spawnedCwds.set(name, spec.cwd);
      return { pid, startedAt };
    }),
    inspectProcess: vi.fn(async (pid, marker) => {
      const item = processes.get(pid);
      const inspectionCount = (inspectionCounts.get(pid) ?? 0) + 1;
      inspectionCounts.set(pid, inspectionCount);
      const name = specs.find((spec) => spec.marker === marker)?.name;
      if (
        name === options.dieAfterInitialInspection &&
        inspectionCount > 1 &&
        item
      ) {
        item.running = false;
      }
      return {
        running: item?.running ?? false,
        identityMatches: Boolean(item?.matches && item.marker === marker),
        startedAt: item?.startedAt,
      };
    }),
    inspectProcessIdentity: vi.fn(async (pid, marker) => {
      const item = processes.get(pid);
      return {
        running: item?.running ?? false,
        markerMatches: Boolean(item?.matches && item.marker === marker),
        startedAt: item?.startedAt,
      };
    }),
    stopProcessTree: vi.fn(async (pid) => {
      stopped.push(pid);
      const item = processes.get(pid);
      if (item) item.running = false;
      return true;
    }),
    getPortOccupant: vi.fn(
      async (port) => options.portOccupants?.[port] ?? null,
    ),
    isProcessInTree: vi.fn(
      async (rootPid, candidatePid) =>
        rootPid === candidatePid ||
        Boolean(options.managedDescendants?.[rootPid]?.includes(candidatePid)),
    ),
    request: vi.fn(async (url, requestOptions) => {
      if (
        options.healthFails &&
        (url === 'http://api/health' || url === 'http://dashboard')
      ) {
        return { ok: false, status: 503 };
      }
      if (url.endsWith('/scheduler')) {
        return {
          ok: true,
          status: 200,
          body: { status: 'disabled', enabled: false },
        };
      }
      if (url.endsWith('/commercial-automation/status')) {
        if (
          options.requiredAuthToken &&
          requestOptions?.headers?.authorization !==
            `Bearer ${options.requiredAuthToken}`
        ) {
          return { ok: false, status: 401 };
        }
        return {
          ok: true,
          status: 200,
          body: {
            enabled: false,
            paused: true,
            allowed: false,
            reasons: ['AUTOMATION_DISABLED'],
            nextAllowedAt: null,
          },
        };
      }
      return { ok: true, status: 200, body: { status: 'ok' } };
    }),
    sleep: vi.fn(async () => undefined),
    now: () => new Date('2026-07-25T12:00:00.000Z'),
  };
  return {
    deps,
    commands,
    processes,
    spawned,
    spawnCommandIndexes,
    spawnedCwds,
    stopped,
    setInfrastructure: (running: boolean) => {
      mainRunning = running;
      evolutionRunning = running;
    },
  };
};

const environment = (mode: 'preview' | 'send' = 'preview') => ({
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379',
  COMMERCIAL_AUTOMATION_MODE: mode,
  ...(mode === 'send'
    ? {
        SHOPEE_AFFILIATE_PROVIDER: 'official',
        SHOPEE_AFFILIATE_API_ENABLED: 'true',
        SHOPEE_AFFILIATE_API_URL: 'https://example.test',
        SHOPEE_AFFILIATE_APP_ID: 'private',
        SHOPEE_AFFILIATE_SECRET: 'private',
        WHATSAPP_PROVIDER: 'evolution',
        EVOLUTION_API_URL: 'http://localhost:8080',
        EVOLUTION_API_KEY: 'private',
        EVOLUTION_INSTANCE_NAME: 'private',
        WHATSAPP_GROUP_SEND_ENABLED: 'true',
      }
    : {}),
});

const createSupervisor = (root: string, deps: SystemDependencies) =>
  new LocalSystemSupervisor(root, deps, specs, { validateRoot: () => true });

const explicitSafePreviewEnvironment = () => ({
  ...environment('preview'),
  WHATSAPP_PROVIDER: 'mock',
  WHATSAPP_GROUP_SEND_ENABLED: 'false',
});

const dailySendReadyEnvironment = (token?: string) => ({
  ...environment('send'),
  COMMERCIAL_AUTOMATION_ENABLED: 'true',
  COMMERCIAL_SCHEDULER_ENABLED: 'true',
  SCHEDULER_ENABLED: 'false',
  ...(token ? { LOCAL_API_AUTH_TOKEN: token } : {}),
});

const writeStateFixture = (
  root: string,
  mode: 'preview' | 'send',
  processes: LocalSystemState['processes'] = {},
) => {
  mkdirSync(dirname(statePath(root)), { recursive: true });
  writeFileSync(
    statePath(root),
    JSON.stringify({
      version: 1,
      composeProjectName: 'afiliado-shopee',
      startedAt: '2026-07-25T12:00:00.000Z',
      mode,
      ports: {
        api: 3433,
        dashboard: 3000,
        postgres: 5432,
        redis: 6379,
        evolution: 8080,
      },
      processes,
    }),
  );
};

const registeredProcessFixture = (name: ServiceName, pid: number) => ({
  pid,
  startedAt: '2026-07-25T12:00:00.000Z',
  log: `.runtime/local-system/${name}.log`,
});

describe('LocalSystemSupervisor', () => {
  it('pins Evolution package commands to the canonical Compose project', () => {
    const packageJson = JSON.parse(
      readFileSync(
        join(import.meta.dirname, '../../..', 'package.json'),
        'utf8',
      ),
    ) as { scripts: Record<string, string> };
    for (const script of [
      'evolution:config',
      'evolution:pull',
      'evolution:up',
      'evolution:down',
      'evolution:status',
      'evolution:logs',
      'evolution:restart',
    ]) {
      expect(packageJson.scripts[script]).toContain(
        '--project-name shopee-evolution-local',
      );
    }
  });

  it('builds Evolution Compose arguments with an explicit project identity', () => {
    expect(evolutionComposeArguments(['ps'])).toEqual([
      'compose',
      '--project-name',
      'shopee-evolution-local',
      '--env-file',
      'infra/evolution/.env.local',
      '-f',
      'infra/evolution/docker-compose.yml',
      'ps',
    ]);
  });

  it('prepares the production dashboard before infrastructure or child spawn', async () => {
    const root = createRoot();
    const state = harness();

    await createSupervisor(root, state.deps).start(environment());

    const buildIndex = state.commands.findIndex(
      (command) =>
        command.args.includes('@shopee-auto-affiliate-ai/dashboard') &&
        command.args.includes('build'),
    );
    const dockerIndex = state.commands.findIndex(
      (command) => command.command === 'docker',
    );
    expect(buildIndex).toBeGreaterThanOrEqual(0);
    expect(buildIndex).toBeLessThan(dockerIndex);
    expect(buildIndex).toBeLessThan(state.spawnCommandIndexes[0]);
    expect(state.commands[buildIndex].env?.NODE_ENV).toBe('production');
  });

  it('does not spawn any service when the production dashboard build fails', async () => {
    const root = createRoot();
    const state = harness({ dashboardBuildFails: true });

    await expect(
      createSupervisor(root, state.deps).start(environment()),
    ).rejects.toMatchObject({ code: 'DASHBOARD_BUILD_FAILED' });

    expect(state.spawned).toEqual([]);
    expect(state.commands.some((command) => command.command === 'docker')).toBe(
      false,
    );
  });

  it('starts the safe preview topology in order without legacy worker, tick or send', async () => {
    const root = createRoot();
    const state = harness();
    const status = await createSupervisor(root, state.deps).start(
      environment(),
    );

    expect(status.overall).toBe('running');
    expect(state.spawned).toEqual(['api', 'dashboard', 'commercial-worker']);
    expect(state.spawnedCwds.get('dashboard')).toBe('dashboard-root');
    expect(state.commands.some((item) => item.args.includes('dev'))).toBe(
      false,
    );
    expect(
      state.commands.some((item) =>
        item.args.some((arg) => /tick|confirm|send/i.test(arg)),
      ),
    ).toBe(false);
    expect(
      state.commands.some((command) => command.args.includes('db:generate')),
    ).toBe(true);
    const persisted = readFileSync(statePath(root), 'utf8');
    expect(persisted).not.toContain('private');
    expect(persisted).not.toContain('DATABASE_URL');
  });

  it('authenticates protected local API status reads without exposing the token', async () => {
    const root = createRoot();
    const state = harness();
    const localApiAuthToken = 'local-api-private-test-token';

    const status = await createSupervisor(root, state.deps).start({
      ...explicitSafePreviewEnvironment(),
      LOCAL_API_AUTH_TOKEN: localApiAuthToken,
      SCHEDULER_ENABLED: 'false',
    });

    const protectedPaths = [
      '/scheduler',
      '/commercial-automation/scheduler',
      '/commercial-automation/status',
    ];
    const protectedCalls = vi
      .mocked(state.deps.request)
      .mock.calls.filter(([url]) =>
        protectedPaths.some((path) => String(url).endsWith(path)),
      );
    expect(protectedCalls).toHaveLength(3);
    expect(
      protectedCalls.map(([, options]) => {
        const headers = new Headers(options?.headers);
        return {
          authorizationPresent: headers.has('authorization'),
          authorizationMatches:
            headers.get('authorization') === `Bearer ${localApiAuthToken}`,
        };
      }),
    ).toEqual([
      { authorizationPresent: true, authorizationMatches: true },
      { authorizationPresent: true, authorizationMatches: true },
      { authorizationPresent: true, authorizationMatches: true },
    ]);
    const healthCall = vi
      .mocked(state.deps.request)
      .mock.calls.find(([url]) => String(url).endsWith('/health'));
    expect(healthCall?.[1]).toMatchObject({ timeoutMs: 1000 });
    expect(healthCall?.[1]?.headers).toBeUndefined();
    expect(status.schedulers.legacy).toMatchObject({
      enabled: false,
      status: 'disabled',
    });
    expect(JSON.stringify(status)).not.toContain(localApiAuthToken);
    expect(readFileSync(statePath(root), 'utf8')).not.toContain(
      localApiAuthToken,
    );
  });

  it('can isolate status environment loading from repository files', async () => {
    const root = createRoot();
    const marker = 'TEST_SECRET_MUST_NEVER_APPEAR';
    writeFileSync(
      join(root, '.env'),
      `COMMERCIAL_AUTOMATION_MODE=send\nLOCAL_API_AUTH_TOKEN=${marker}\n`,
    );
    const state = harness();

    const status = await new LocalSystemSupervisor(root, state.deps, specs, {
      validateRoot: () => true,
      loadEnvironmentFiles: false,
    }).status(explicitSafePreviewEnvironment());

    expect(status.mode).toBe('preview');
    expect(status.controlPlane.configured).toBe(false);
    const serializedCommandEnvironments = state.commands
      .map((command) => JSON.stringify(command.env ?? {}))
      .join('\n');
    expect(serializedCommandEnvironments.includes(marker)).toBe(false);
  });

  it('fails closed before startup when the daily SEND-ready token is absent', async () => {
    const root = createRoot();
    const state = harness();

    await expect(
      createSupervisor(root, state.deps).start(dailySendReadyEnvironment()),
    ).rejects.toMatchObject({ code: 'LOCAL_API_AUTH_TOKEN_REQUIRED' });
    expect(state.spawned).toEqual([]);
  });

  it('keeps health-only green daily topology NOT_READY when auth is wrong', async () => {
    const root = createRoot();
    const state = harness({ requiredAuthToken: 'correct-token' });

    await expect(
      createSupervisor(root, state.deps).start(
        dailySendReadyEnvironment('wrong-token'),
      ),
    ).rejects.toMatchObject({ code: 'SYSTEM_START_INCOMPLETE' });
    expect(state.spawned).toEqual([
      'api',
      'dashboard',
      'commercial-worker',
      'whatsapp-dispatch-worker',
    ]);
    expect(state.stopped).toHaveLength(4);
  });

  it('reports authenticated daily control plane without exposing its token', async () => {
    const root = createRoot();
    const token = 'correct-token';
    const state = harness({ requiredAuthToken: token });

    const status = await createSupervisor(root, state.deps).start(
      dailySendReadyEnvironment(token),
    );

    expect(status.overall).toBe('running');
    expect(status.controlPlane).toEqual({
      required: true,
      configured: true,
      authenticated: true,
    });
    expect(JSON.stringify(status)).not.toContain(token);
  });

  it('uses direct pnpm without Corepack and preserves command context', async () => {
    const root = createRoot();
    const state = harness();
    const env = environment();

    await createSupervisor(root, state.deps).start(env);

    const versionCommand = state.commands.find(
      (command) =>
        command.args.includes('--version') &&
        (command.command === 'pnpm' || command.command === process.execPath),
    );
    expect(versionCommand).toBeDefined();
    if (!versionCommand)
      throw new Error('pnpm version command was not captured');

    const pnpmArgs =
      process.platform === 'win32'
        ? versionCommand.args.slice(1)
        : versionCommand.args;
    expect(pnpmArgs).toEqual(['--version']);
    expect(versionCommand.cwd).toBe(root);
    expect(versionCommand.env?.DATABASE_URL).toBe(env.DATABASE_URL);
    expect(versionCommand.shell).not.toBe(true);

    if (process.platform === 'win32') {
      expect(versionCommand.command).toBe(process.execPath);
      expect(versionCommand.args[0]).toMatch(
        /node_modules[\\/]pnpm[\\/]bin[\\/]pnpm\.cjs$/,
      );
    } else {
      expect(versionCommand.command).toBe('pnpm');
    }

    const deployCommand = state.commands.find((command) =>
      command.args.includes('db:deploy'),
    );
    expect(deployCommand).toBeDefined();
    if (!deployCommand)
      throw new Error('pnpm db:deploy command was not captured');
    const deployArgs =
      process.platform === 'win32'
        ? deployCommand.args.slice(1)
        : deployCommand.args;
    expect(deployArgs).toEqual([
      '--filter',
      '@shopee-auto-affiliate-ai/database',
      'db:deploy',
    ]);
    expect(deployCommand.cwd).toBe(root);
    expect(deployCommand.env?.REDIS_URL).toBe(env.REDIS_URL);
    expect(deployCommand.shell).not.toBe(true);

    expect(
      state.commands.some(
        (command) =>
          command.command.toLowerCase().includes('corepack') ||
          command.args.some((arg) => arg.toLowerCase().includes('corepack')),
      ),
    ).toBe(false);
  });

  it('fails closed when direct pnpm cannot be resolved without Corepack fallback', async () => {
    const root = createRoot();
    const state = harness();

    await expect(
      createSupervisor(root, state.deps).start({
        ...environment(),
        Path: '',
        PATH: '',
      }),
    ).rejects.toMatchObject({
      code: 'PNPM_UNAVAILABLE',
      message: 'pnpm nao esta disponivel no PATH',
    });

    expect(state.commands).toEqual([]);
  });
  it('accepts an implicit image-declared Docker volume without an explicit Compose mount', async () => {
    const root = createRoot();
    const dockerDiscovery = equivalentDockerDiscovery();
    const implicitTarget = '/image-declared-volume';
    const candidate = dockerInspection('redis');
    candidate.Mounts = [
      {
        Type: 'volume',
        Destination: implicitTarget,
        RW: true,
        Mode: '',
        Propagation: '',
      },
    ];
    dockerDiscovery.inspect = {
      code: 0,
      stdout: JSON.stringify([dockerInspection('postgres'), candidate]),
    };
    dockerDiscovery.imageInspect = {
      ...dockerDiscovery.imageInspect,
      'redis:7-alpine': { code: 0, stdout: imageInspection([implicitTarget]) },
    };
    const state = harness({
      dockerDiscovery,
      portOccupants: {
        5432: { pid: 5001, processName: 'docker-backend' },
        6379: { pid: 5002, processName: 'docker-backend' },
      },
    });

    const status = await createSupervisor(root, state.deps).status(
      explicitSafePreviewEnvironment(),
    );

    expect(status.externalPortOccupants).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ port: 6379 })]),
    );
    expect(state.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: 'docker',
          args: ['image', 'inspect', 'redis:7-alpine'],
        }),
      ]),
    );
  });

  it.each([
    [
      'extra destination',
      { Type: 'volume', Destination: '/outside-contract', RW: true },
    ],
    [
      'bind type',
      { Type: 'bind', Destination: '/image-declared-volume', RW: true },
    ],
    [
      'tmpfs type',
      { Type: 'tmpfs', Destination: '/image-declared-volume', RW: true },
    ],
    [
      'read-only',
      { Type: 'volume', Destination: '/image-declared-volume', RW: false },
    ],
    [
      'incompatible mode',
      {
        Type: 'volume',
        Destination: '/image-declared-volume',
        RW: true,
        Mode: 'ro',
      },
    ],
    [
      'incompatible propagation',
      {
        Type: 'volume',
        Destination: '/image-declared-volume',
        RW: true,
        Propagation: 'shared',
      },
    ],
  ] satisfies Array<[string, DockerInspectionFixture['Mounts'][number]]>)(
    'rejects an implicit image volume with %s',
    async (_caseName, mount) => {
      const root = createRoot();
      const dockerDiscovery = equivalentDockerDiscovery();
      const candidate = dockerInspection('redis');
      candidate.Mounts = [mount];
      dockerDiscovery.inspect = {
        code: 0,
        stdout: JSON.stringify([dockerInspection('postgres'), candidate]),
      };
      dockerDiscovery.imageInspect = {
        ...dockerDiscovery.imageInspect,
        'redis:7-alpine': {
          code: 0,
          stdout: imageInspection(['/image-declared-volume']),
        },
      };
      const state = harness({
        dockerDiscovery,
        portOccupants: {
          5432: { pid: 5001, processName: 'external-postgres' },
          6379: { pid: 5002, processName: 'external-redis' },
        },
      });

      const status = await createSupervisor(root, state.deps).status(
        explicitSafePreviewEnvironment(),
      );

      expect(status.externalPortOccupants).toEqual(
        expect.arrayContaining([expect.objectContaining({ port: 6379 })]),
      );
    },
  );
  it.each([
    ['missing image metadata', { code: 1, stdout: '' }],
    ['invalid image metadata JSON', { code: 0, stdout: '{invalid' }],
    [
      'ambiguous image metadata',
      { code: 0, stdout: JSON.stringify([{ Config: {} }, { Config: {} }]) },
    ],
    ['missing image Config', { code: 0, stdout: JSON.stringify([{}]) }],
    [
      'invalid image Volumes shape',
      { code: 0, stdout: JSON.stringify([{ Config: { Volumes: [] } }]) },
    ],
  ])('fails closed for %s', async (_caseName, imageMetadata) => {
    const root = createRoot();
    const dockerDiscovery = equivalentDockerDiscovery();
    const candidate = dockerInspection('redis');
    candidate.Mounts = [
      {
        Type: 'volume',
        Destination: '/image-declared-volume',
        RW: true,
      },
    ];
    dockerDiscovery.inspect = {
      code: 0,
      stdout: JSON.stringify([dockerInspection('postgres'), candidate]),
    };
    dockerDiscovery.imageInspect = {
      ...dockerDiscovery.imageInspect,
      'redis:7-alpine': imageMetadata,
    };
    const state = harness({
      dockerDiscovery,
      portOccupants: {
        5432: { pid: 5001, processName: 'external-postgres' },
        6379: { pid: 5002, processName: 'external-redis' },
      },
    });

    const status = await createSupervisor(root, state.deps).status(
      explicitSafePreviewEnvironment(),
    );

    expect(status.externalPortOccupants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ port: 5432 }),
        expect.objectContaining({ port: 6379 }),
      ]),
    );
  });

  it('keeps an explicit Compose mount mandatory even when the image declares it', async () => {
    const root = createRoot();
    const dockerDiscovery = equivalentDockerDiscovery();
    const candidate = dockerInspection('postgres');
    candidate.Mounts = [];
    dockerDiscovery.inspect = {
      code: 0,
      stdout: JSON.stringify([candidate, dockerInspection('redis')]),
    };
    dockerDiscovery.imageInspect = {
      ...dockerDiscovery.imageInspect,
      'postgres:16-alpine': {
        code: 0,
        stdout: imageInspection(['/var/lib/postgresql/data']),
      },
    };
    const state = harness({
      dockerDiscovery,
      portOccupants: {
        5432: { pid: 5001, processName: 'external-postgres' },
        6379: { pid: 5002, processName: 'external-redis' },
      },
    });

    const status = await createSupervisor(root, state.deps).status(
      explicitSafePreviewEnvironment(),
    );

    expect(status.externalPortOccupants).toEqual(
      expect.arrayContaining([expect.objectContaining({ port: 5432 })]),
    );
  });

  it('rejects an additional mount beside the required explicit Compose mount', async () => {
    const root = createRoot();
    const dockerDiscovery = equivalentDockerDiscovery();
    const candidate = dockerInspection('postgres');
    candidate.Mounts = [
      ...candidate.Mounts,
      { Type: 'volume', Destination: '/unexpected-extra-volume', RW: true },
    ];
    dockerDiscovery.inspect = {
      code: 0,
      stdout: JSON.stringify([candidate, dockerInspection('redis')]),
    };
    const state = harness({
      dockerDiscovery,
      portOccupants: {
        5432: { pid: 5001, processName: 'external-postgres' },
        6379: { pid: 5002, processName: 'external-redis' },
      },
    });

    const status = await createSupervisor(root, state.deps).status(
      explicitSafePreviewEnvironment(),
    );

    expect(status.externalPortOccupants).toEqual(
      expect.arrayContaining([expect.objectContaining({ port: 5432 })]),
    );
  });
  it('recognizes healthy canonical Compose infrastructure independent of cwd', async () => {
    const root = createRoot();
    const state = harness({
      dockerDiscovery: equivalentDockerDiscovery(),
      portOccupants: {
        5432: { pid: 5001, processName: 'docker-backend' },
        6379: { pid: 5002, processName: 'docker-backend' },
      },
    });
    const supervisor = createSupervisor(root, state.deps);

    const beforeStart = await supervisor.status(
      explicitSafePreviewEnvironment(),
    );
    expect(beforeStart.externalPortOccupants).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ port: 5432 }),
        expect.objectContaining({ port: 6379 }),
      ]),
    );
    expect(beforeStart.docker.services).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ service: 'postgres', health: 'healthy' }),
        expect.objectContaining({ service: 'redis', health: 'healthy' }),
      ]),
    );

    await expect(
      supervisor.start(explicitSafePreviewEnvironment()),
    ).resolves.toMatchObject({ overall: 'running' });
    expect(
      state.commands.some(
        (command) =>
          command.command === 'docker' &&
          command.args[0] === 'compose' &&
          command.args.includes('up') &&
          command.args.includes('-d'),
      ),
    ).toBe(false);
    expect(
      state.commands.some(
        (command) =>
          command.command === 'docker' && command.args[0] === 'inspect',
      ),
    ).toBe(true);
  });

  it('does not reuse healthy infrastructure belonging to a foreign Compose project', async () => {
    const root = createRoot();
    const foreignPostgres = dockerInspection('postgres');
    const foreignRedis = dockerInspection('redis');
    foreignPostgres.Config.Labels['com.docker.compose.project'] =
      'foreign-project';
    foreignRedis.Config.Labels['com.docker.compose.project'] =
      'foreign-project';
    foreignPostgres.Mounts[0]!.Name = 'foreign-project_postgres_data';
    const foreignConfig = mainComposeConfig().replace(
      '"name":"afiliado-shopee"',
      '"name":"foreign-project"',
    );
    const state = harness({
      dockerDiscovery: {
        ...equivalentDockerDiscovery(),
        config: { code: 0, stdout: foreignConfig },
        inspect: {
          code: 0,
          stdout: JSON.stringify([foreignPostgres, foreignRedis]),
        },
      },
      portOccupants: {
        5432: { pid: 5001, processName: 'docker-backend' },
        6379: { pid: 5002, processName: 'docker-backend' },
      },
    });

    await expect(
      createSupervisor(root, state.deps).start(
        explicitSafePreviewEnvironment(),
      ),
    ).rejects.toMatchObject({ code: 'SYSTEM_PORT_OCCUPIED' });
    expect(
      state.commands.some(
        (command) =>
          command.command === 'docker' &&
          command.args[0] === 'compose' &&
          command.args.includes('up'),
      ),
    ).toBe(false);
  });

  it('uses one canonical Compose project across worktrees while keeping explicit isolated names separate', async () => {
    const rootA = createRoot();
    const rootB = createRoot();
    const stateA = harness();
    const stateB = harness();

    await createSupervisor(rootA, stateA.deps).status(
      explicitSafePreviewEnvironment(),
    );
    await createSupervisor(rootB, stateB.deps).status(
      explicitSafePreviewEnvironment(),
    );

    const composeA = stateA.commands.find(
      (command) =>
        command.command === 'docker' && command.args[0] === 'compose',
    );
    const composeB = stateB.commands.find(
      (command) =>
        command.command === 'docker' && command.args[0] === 'compose',
    );
    expect(composeA?.args.slice(0, 3)).toEqual([
      'compose',
      '--project-name',
      'afiliado-shopee',
    ]);
    expect(composeB?.args.slice(0, 3)).toEqual(composeA?.args.slice(0, 3));
    expect(composeA?.cwd).toBe(rootA);
    expect(composeB?.cwd).toBe(rootB);

    const isolatedA = new LocalSystemSupervisor(rootA, stateA.deps, specs, {
      validateRoot: () => true,
      composeProjectName: 'isolated-a',
    });
    const isolatedB = new LocalSystemSupervisor(rootB, stateB.deps, specs, {
      validateRoot: () => true,
      composeProjectName: 'isolated-b',
    });
    await isolatedA.status(explicitSafePreviewEnvironment());
    await isolatedB.status(explicitSafePreviewEnvironment());
    const isolatedCommands = [...stateA.commands, ...stateB.commands].filter(
      (command) =>
        command.command === 'docker' && command.args[0] === 'compose',
    );
    expect(
      isolatedCommands.some(
        (command) =>
          command.args[1] === '--project-name' &&
          command.args[2] === 'isolated-a',
      ),
    ).toBe(true);
    expect(
      isolatedCommands.some(
        (command) =>
          command.args[1] === '--project-name' &&
          command.args[2] === 'isolated-b',
      ),
    ).toBe(true);
  });

  it('keeps an explicitly isolated start on its own project volume', async () => {
    const root = createRoot();
    const state = harness({
      dockerDiscovery: equivalentDockerDiscovery('healthy', 'isolated-a'),
      volumeProjectName: 'isolated-a',
    });
    const supervisor = new LocalSystemSupervisor(root, state.deps, specs, {
      validateRoot: () => true,
      composeProjectName: 'isolated-a',
    });

    const status = await supervisor.start(explicitSafePreviewEnvironment());

    expect(status.runtime).toMatchObject({
      composeProjectName: 'isolated-a',
      expectedPostgresVolume: 'isolated-a_postgres_data',
      mountedPostgresVolume: 'isolated-a_postgres_data',
      volumeStatus: 'canonical',
    });
    expect(
      state.commands.some(
        (command) =>
          command.command === 'docker' &&
          command.args[0] === 'compose' &&
          command.args.slice(0, 3).join(' ') ===
            'compose --project-name isolated-a',
      ),
    ).toBe(true);
  });

  it('persists the Compose identity with managed process state', async () => {
    const root = createRoot();
    const state = harness();

    await createSupervisor(root, state.deps).start(
      explicitSafePreviewEnvironment(),
    );

    expect(JSON.parse(readFileSync(statePath(root), 'utf8'))).toMatchObject({
      version: 1,
      composeProjectName: 'afiliado-shopee',
    });
  });

  it('rejects a state owned by another Compose project before start or stop', async () => {
    const root = createRoot();
    const state = harness();
    const supervisor = createSupervisor(root, state.deps);
    await supervisor.start(explicitSafePreviewEnvironment());

    const persisted = JSON.parse(readFileSync(statePath(root), 'utf8')) as {
      composeProjectName: string;
    };
    persisted.composeProjectName = 'isolated-a';
    writeFileSync(statePath(root), JSON.stringify(persisted));
    const commandCount = state.commands.length;

    await expect(
      supervisor.start(explicitSafePreviewEnvironment()),
    ).rejects.toMatchObject({ code: 'SYSTEM_COMPOSE_PROJECT_MISMATCH' });
    await expect(
      supervisor.status(explicitSafePreviewEnvironment()),
    ).rejects.toMatchObject({ code: 'SYSTEM_COMPOSE_PROJECT_MISMATCH' });
    await expect(
      supervisor.stop(explicitSafePreviewEnvironment()),
    ).resolves.toEqual({
      stopped: false,
      manualIntervention: [expect.stringContaining('outro projeto Compose')],
    });
    expect(state.commands).toHaveLength(commandCount);
    expect(state.stopped).toEqual([]);
  });

  it('refuses to create the operational PostgreSQL volume when it is absent', async () => {
    const root = createRoot();
    const state = harness({ volumeNames: [] });

    await expect(
      createSupervisor(root, state.deps).start(
        explicitSafePreviewEnvironment(),
      ),
    ).rejects.toMatchObject({
      code: 'SYSTEM_DATABASE_VOLUME_IDENTITY_UNAVAILABLE',
    });
    expect(
      state.commands.some(
        (command) =>
          command.command === 'docker' && command.args.includes('up'),
      ),
    ).toBe(false);
  });

  it('reports the canonical runtime identity and mounted PostgreSQL volume without secrets', async () => {
    const root = createRoot();
    const state = harness({
      dockerDiscovery: equivalentDockerDiscovery(),
    });

    const snapshot = await createSupervisor(root, state.deps).status(
      explicitSafePreviewEnvironment(),
    );

    expect(snapshot.runtime).toEqual({
      composeProjectName: 'afiliado-shopee',
      expectedPostgresVolume: 'afiliado-shopee_postgres_data',
      mountedPostgresVolume: 'afiliado-shopee_postgres_data',
      mountedRedisVolumes: [],
      volumeStatus: 'canonical',
    });
    expect(JSON.stringify(snapshot)).not.toMatch(
      /postgres:postgres|private|password|token/i,
    );
  });

  it('fails closed when a canonical Compose project mounts a non-canonical PostgreSQL volume', async () => {
    const root = createRoot();
    const dockerDiscovery = equivalentDockerDiscovery();
    const postgres = dockerInspection('postgres');
    postgres.Mounts[0]!.Name = 'phase17-gap-audit_postgres_data';
    dockerDiscovery.inspect = {
      code: 0,
      stdout: JSON.stringify([postgres, dockerInspection('redis')]),
    };
    const state = harness({ dockerDiscovery });

    const snapshot = await createSupervisor(root, state.deps).status(
      explicitSafePreviewEnvironment(),
    );
    expect(snapshot.runtime.volumeStatus).toBe('mismatch');
    expect(snapshot.runtime.mountedPostgresVolume).toBe(
      'phase17-gap-audit_postgres_data',
    );

    await expect(
      createSupervisor(root, state.deps).start(
        explicitSafePreviewEnvironment(),
      ),
    ).rejects.toMatchObject({
      code: 'SYSTEM_DATABASE_VOLUME_IDENTITY_MISMATCH',
    });
  });

  it.each([
    null,
    {},
    { 'com.docker.compose.project': 'afiliado-shopee' },
  ] as Array<Record<string, string> | null>)(
    'fails closed when canonical volume provenance is incomplete: %s',
    async (volumeLabels) => {
      const root = createRoot();
      const state = harness({ volumeLabels });

      const snapshot = await createSupervisor(root, state.deps).status(
        explicitSafePreviewEnvironment(),
      );
      expect(snapshot.runtime.volumeStatus).toBe('mismatch');

      await expect(
        createSupervisor(root, state.deps).start(
          explicitSafePreviewEnvironment(),
        ),
      ).rejects.toMatchObject({
        code: 'SYSTEM_DATABASE_VOLUME_IDENTITY_MISMATCH',
      });
    },
  );

  it('refuses to stop infrastructure without local process ownership', async () => {
    const root = createRoot();
    const state = harness();
    state.setInfrastructure(true);

    const result = await createSupervisor(root, state.deps).stop(
      explicitSafePreviewEnvironment(),
    );

    expect(result).toEqual({
      stopped: false,
      manualIntervention: [
        'infraestrutura em execucao sem estado local pertencente a esta worktree',
      ],
    });
    expect(
      state.commands.some(
        (command) =>
          command.command === 'docker' && command.args.includes('stop'),
      ),
    ).toBe(false);
  });

  it.each([
    [
      'image mismatch',
      (() => {
        const postgres = dockerInspection('postgres');
        postgres.Config.Image = 'postgres:15-alpine';
        return [postgres, dockerInspection('redis')];
      })(),
    ],
    [
      'service mismatch',
      (() => {
        const postgres = dockerInspection('postgres');
        postgres.Config.Labels['com.docker.compose.service'] = 'other';
        return [postgres, dockerInspection('redis')];
      })(),
    ],
    [
      'published port mismatch',
      (() => {
        const postgres = dockerInspection('postgres');
        postgres.NetworkSettings.Ports['5432/tcp'] = [{ HostPort: '15432' }];
        return [postgres, dockerInspection('redis')];
      })(),
    ],
    [
      'not running candidate',
      (() => {
        const postgres = dockerInspection('postgres');
        postgres.State.Running = false;
        return [postgres, dockerInspection('redis')];
      })(),
    ],
    [
      'missing Compose metadata',
      (() => {
        const postgres = dockerInspection('postgres');
        postgres.Config.Labels = {};
        return [postgres, dockerInspection('redis')];
      })(),
    ],
    [
      'topology mismatch',
      (() => {
        const postgres = dockerInspection('postgres');
        postgres.Mounts = [{ Type: 'volume', Destination: '/unexpected' }];
        return [postgres, dockerInspection('redis')];
      })(),
    ],
    [
      'ambiguous candidates',
      [
        dockerInspection('postgres'),
        dockerInspection('postgres'),
        dockerInspection('redis'),
      ],
    ],
  ] satisfies Array<[string, DockerInspectionFixture[]]>)(
    'fails closed for %s',
    async (_caseName, inspections) => {
      const root = createRoot();
      const state = harness({
        dockerDiscovery: {
          ...equivalentDockerDiscovery(),
          inspect: { code: 0, stdout: JSON.stringify(inspections) },
        },
        portOccupants: {
          5432: { pid: 5001, processName: 'external-postgres' },
          6379: { pid: 5002, processName: 'external-redis' },
        },
      });

      const status = await createSupervisor(root, state.deps).status(
        explicitSafePreviewEnvironment(),
      );

      expect(status.externalPortOccupants).toEqual(
        expect.arrayContaining([expect.objectContaining({ port: 5432 })]),
      );
    },
  );

  it.each([
    ['compose config error', { config: { code: 1, stdout: '' } }],
    [
      'invalid compose config JSON',
      { config: { code: 0, stdout: '{invalid' } },
    ],
    [
      'Docker list error',
      {
        config: { code: 0, stdout: mainComposeConfig() },
        list: { code: 1, stdout: '' },
      },
    ],
    [
      'invalid Docker list output',
      {
        config: { code: 0, stdout: mainComposeConfig() },
        list: { code: 0, stdout: 'not-a-container-id' },
      },
    ],
    [
      'Docker inspect error',
      {
        config: { code: 0, stdout: mainComposeConfig() },
        list: { code: 0, stdout: 'aaaaaaaaaaaa' },
        inspect: { code: 1, stdout: '' },
      },
    ],
    [
      'invalid Docker inspect JSON',
      {
        config: { code: 0, stdout: mainComposeConfig() },
        list: { code: 0, stdout: 'aaaaaaaaaaaa' },
        inspect: { code: 0, stdout: '{invalid' },
      },
    ],
  ] satisfies Array<[string, DockerDiscoveryFixture]>)(
    'fails closed when Docker ownership discovery has %s',
    async (_caseName, dockerDiscovery) => {
      const root = createRoot();
      const state = harness({
        dockerDiscovery,
        portOccupants: {
          5432: { pid: 5001, processName: 'external-postgres' },
          6379: { pid: 5002, processName: 'external-redis' },
        },
      });

      const status = await createSupervisor(root, state.deps).status(
        explicitSafePreviewEnvironment(),
      );

      expect(status.externalPortOccupants).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ port: 5432 }),
          expect.objectContaining({ port: 6379 }),
        ]),
      );
    },
  );
  it.each(['config', 'list', 'inspect', 'imageInspect'] as const)(
    'fails closed when Docker ownership discovery throws at %s',
    async (dockerDiscoveryThrowsAt) => {
      const root = createRoot();
      const state = harness({
        dockerDiscovery: equivalentDockerDiscovery(),
        dockerDiscoveryThrowsAt,
        portOccupants: {
          5432: { pid: 5001, processName: 'external-postgres' },
          6379: { pid: 5002, processName: 'external-redis' },
        },
      });

      const status = await createSupervisor(root, state.deps).status(
        explicitSafePreviewEnvironment(),
      );

      expect(status.externalPortOccupants).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ port: 5432 }),
          expect.objectContaining({ port: 6379 }),
        ]),
      );
    },
  );
  it('reuses equivalent infrastructure while health transitions from starting to healthy', async () => {
    const root = createRoot();
    const dockerDiscovery = equivalentDockerDiscovery('starting');
    const state = harness({
      dockerDiscovery,
      portOccupants: {
        5432: { pid: 5001, processName: 'docker-backend' },
        6379: { pid: 5002, processName: 'docker-backend' },
      },
    });
    vi.mocked(state.deps.sleep).mockImplementation(async () => {
      dockerDiscovery.inspect = equivalentDockerDiscovery('healthy').inspect;
    });

    await expect(
      createSupervisor(root, state.deps).start(
        explicitSafePreviewEnvironment(),
      ),
    ).resolves.toMatchObject({ overall: 'running' });

    expect(state.deps.sleep).toHaveBeenCalled();
    expect(
      state.commands.some(
        (command) =>
          command.command === 'docker' &&
          command.args[0] === 'compose' &&
          command.args.includes('up') &&
          command.args.includes('-d'),
      ),
    ).toBe(false);
  });

  it('fails closed when equivalent infrastructure remains unhealthy without falling back to compose up', async () => {
    const root = createRoot();
    const state = harness({
      dockerDiscovery: equivalentDockerDiscovery('unhealthy'),
      portOccupants: {
        5432: { pid: 5001, processName: 'docker-backend' },
        6379: { pid: 5002, processName: 'docker-backend' },
      },
    });

    await expect(
      createSupervisor(root, state.deps).start(
        explicitSafePreviewEnvironment(),
      ),
    ).rejects.toMatchObject({ code: 'MAIN_COMPOSE_UNHEALTHY' });

    expect(
      state.commands.some(
        (command) =>
          command.command === 'docker' &&
          command.args[0] === 'compose' &&
          command.args.includes('up') &&
          command.args.includes('-d'),
      ),
    ).toBe(false);
  });

  it('excludes the Evolution port from external-port scanning in explicit safe preview', async () => {
    const root = createRoot();
    const state = harness({
      portOccupants: {
        8080: { pid: 808, processName: 'existing-evolution' },
      },
    });

    const status = await createSupervisor(root, state.deps).status(
      explicitSafePreviewEnvironment(),
    );

    const scannedPorts = vi
      .mocked(state.deps.getPortOccupant)
      .mock.calls.map(([port]) => port);
    expect(scannedPorts).not.toContain(8080);
    expect(status.externalPortOccupants).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ port: 8080 })]),
    );
  });

  it('keeps API, dashboard, PostgreSQL and Redis ports protected in explicit safe preview', async () => {
    for (const port of [3333, 3000, 5432, 6379]) {
      const root = createRoot();
      const state = harness({
        portOccupants: {
          [port]: { pid: port, processName: `external-${port}` },
        },
      });

      const status = await createSupervisor(root, state.deps).status(
        explicitSafePreviewEnvironment(),
      );

      expect(state.deps.getPortOccupant).toHaveBeenCalledWith(port);
      expect(status.externalPortOccupants).toEqual(
        expect.arrayContaining([expect.objectContaining({ port })]),
      );
    }
  });

  it('publishes the configured API port and ignores an unrelated occupant on the legacy port', async () => {
    const root = createRoot();
    const state = harness({
      portOccupants: {
        3333: { pid: 3333, processName: 'chatgpt-devbridge' },
      },
    });

    const status = await createSupervisor(root, state.deps).status({
      ...explicitSafePreviewEnvironment(),
      PORT: '3433',
    });

    expect(status.ports).toEqual({ api: 3433, dashboard: 3000 });
    expect(state.deps.getPortOccupant).toHaveBeenCalledWith(3433);
    expect(state.deps.getPortOccupant).not.toHaveBeenCalledWith(3333);
    expect(status.externalPortOccupants).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ port: 3333 })]),
    );
  });

  it('starts on the isolated API port while the legacy port is occupied', async () => {
    const root = createRoot();
    const state = harness({
      portOccupants: {
        3333: { pid: 3333, processName: 'chatgpt-devbridge' },
      },
    });

    const status = await createSupervisor(root, state.deps).start({
      ...explicitSafePreviewEnvironment(),
      PORT: '3433',
    });

    expect(status.overall).toBe('running');
    expect(status.ports.api).toBe(3433);
    expect(state.deps.getPortOccupant).not.toHaveBeenCalledWith(3333);
  });

  it('fails closed when the configured API port is occupied', async () => {
    const root = createRoot();
    const state = harness({
      portOccupants: {
        3433: { pid: 3433, processName: 'external-api' },
      },
    });

    await expect(
      createSupervisor(root, state.deps).start({
        ...explicitSafePreviewEnvironment(),
        PORT: '3433',
      }),
    ).rejects.toMatchObject({ code: 'SYSTEM_PORT_OCCUPIED' });
    expect(state.spawned).toEqual([]);
  });

  it('keeps the Evolution port in external-port scanning outside safe preview', async () => {
    const root = createRoot();
    const state = harness({
      portOccupants: {
        8080: { pid: 808, processName: 'external-evolution' },
      },
    });

    const status = await createSupervisor(root, state.deps).status(
      environment('send'),
    );

    expect(state.deps.getPortOccupant).toHaveBeenCalledWith(8080);
    expect(status.externalPortOccupants).toEqual(
      expect.arrayContaining([expect.objectContaining({ port: 8080 })]),
    );
  });
  it('isolates explicit safe preview from Evolution across start, status and stop', async () => {
    const root = createRoot();
    const state = harness();
    const supervisor = createSupervisor(root, state.deps);
    const safeEnvironment = explicitSafePreviewEnvironment();

    const started = await supervisor.start(safeEnvironment);
    expect(started.overall).toBe('running');
    expect(started.evolution).toEqual({
      api: 'unavailable',
      services: [],
      whatsappConnection: 'not-configured',
    });
    expect(
      state.commands.some((command) => command.args.includes('evolution:up')),
    ).toBe(false);
    expect(
      state.commands.some((command) =>
        command.args.includes('infra/evolution/docker-compose.yml'),
      ),
    ).toBe(false);
    expect(
      vi
        .mocked(state.deps.request)
        .mock.calls.some(([url]) => String(url).includes('8080')),
    ).toBe(false);

    await supervisor.status(safeEnvironment);
    expect(
      state.commands.some((command) =>
        command.args.includes('infra/evolution/docker-compose.yml'),
      ),
    ).toBe(false);

    await expect(supervisor.stop(safeEnvironment)).resolves.toEqual({
      stopped: true,
      manualIntervention: [],
    });
    expect(
      state.commands.some((command) =>
        command.args.includes('infra/evolution/docker-compose.yml'),
      ),
    ).toBe(false);
  });

  it('refuses to let an isolated project manage the shared Evolution stack', async () => {
    const root = createRoot();
    const state = harness();
    const isolated = new LocalSystemSupervisor(root, state.deps, specs, {
      validateRoot: () => true,
      composeProjectName: 'isolated-a',
    });

    await expect(isolated.start(environment('send'))).rejects.toMatchObject({
      code: 'SYSTEM_ISOLATED_EVOLUTION_IDENTITY_UNAVAILABLE',
    });
    await expect(isolated.status(environment('send'))).rejects.toMatchObject({
      code: 'SYSTEM_ISOLATED_EVOLUTION_IDENTITY_UNAVAILABLE',
    });
    await expect(isolated.stop(environment('send'))).resolves.toEqual({
      stopped: false,
      manualIntervention: [
        expect.stringContaining('identidade Evolution dedicada'),
      ],
    });
    expect(state.commands).toEqual([]);
  });

  it('refuses to stop a running project when infrastructure ownership is not proven', async () => {
    const root = createRoot();
    const dockerDiscovery = equivalentDockerDiscovery();
    const state = harness({ dockerDiscovery });
    const supervisor = createSupervisor(root, state.deps);
    const safeEnvironment = explicitSafePreviewEnvironment();

    await supervisor.start(safeEnvironment);
    state.setInfrastructure(true);
    const postgres = dockerInspection('postgres');
    postgres.Mounts[0]!.Name = 'phase17-gap-audit_postgres_data';
    dockerDiscovery.inspect = {
      code: 0,
      stdout: JSON.stringify([postgres, dockerInspection('redis')]),
    };
    const commandCount = state.commands.length;

    await expect(supervisor.stop(safeEnvironment)).resolves.toEqual({
      stopped: false,
      manualIntervention: [
        'nao foi possivel confirmar a identidade da infraestrutura principal antes do stop',
      ],
    });
    expect(
      state.commands
        .slice(commandCount)
        .some(
          (command) =>
            command.command === 'docker' && command.args.includes('stop'),
        ),
    ).toBe(false);
    expect(state.stopped).toEqual([]);
  });

  it('fails closed before infrastructure when preview WhatsApp provider is ambiguous', async () => {
    const root = createRoot();
    const state = harness();

    await expect(
      createSupervisor(root, state.deps).start({
        ...environment('preview'),
        WHATSAPP_PROVIDER: '',
        WHATSAPP_GROUP_SEND_ENABLED: 'false',
      }),
    ).rejects.toMatchObject({ code: 'SYSTEM_CONFIG_INVALID' });

    expect(state.commands).toEqual([]);
    expect(state.spawned).toEqual([]);
  });
  it('does not assume safe preview when WhatsApp provider is absent', async () => {
    const root = createRoot();
    const state = harness();

    await createSupervisor(root, state.deps).start(environment('preview'));

    expect(
      state.commands.some((command) => command.args.includes('evolution:up')),
    ).toBe(true);
  });
  it('adds only the isolated dispatch worker in send mode', async () => {
    const root = createRoot();
    const state = harness();
    await createSupervisor(root, state.deps).start(environment('send'));
    expect(state.spawned).toEqual([
      'api',
      'dashboard',
      'commercial-worker',
      'whatsapp-dispatch-worker',
    ]);
    expect(
      state.commands.some((command) => command.args.includes('evolution:up')),
    ).toBe(true);
  });

  it('reuses a Prisma client validated by the safe preview preflight', async () => {
    const root = createRoot();
    const state = harness();
    await createSupervisor(root, state.deps).start({
      ...environment(),
      [PREVIEW_STABILITY_PRISMA_VALIDATION]: 'true',
      SCHEDULER_ENABLED: 'false',
      WHATSAPP_GROUP_SEND_ENABLED: 'false',
      SHOPEE_AFFILIATE_PROVIDER: 'mock',
    });
    expect(
      state.commands.some((command) => command.args.includes('db:generate')),
    ).toBe(false);
  });

  it('preserves ownership and rejects a dispatch worker registered in preview', async () => {
    const root = createRoot();
    const state = harness();
    const supervisor = createSupervisor(root, state.deps);
    await supervisor.start(environment('send'));
    const persisted = JSON.parse(readFileSync(statePath(root), 'utf8')) as {
      mode: string;
    };
    persisted.mode = 'preview';
    writeFileSync(statePath(root), JSON.stringify(persisted));

    await expect(
      supervisor.start(environment('preview')),
    ).rejects.toMatchObject({ code: 'SYSTEM_UNEXPECTED_REGISTERED_PROCESS' });
    expect(readFileSync(statePath(root), 'utf8')).toContain(
      'whatsapp-dispatch-worker',
    );
  });

  it('is idempotent and does not duplicate healthy children', async () => {
    const root = createRoot();
    const state = harness();
    const supervisor = createSupervisor(root, state.deps);
    await supervisor.start(environment());
    await supervisor.start(environment());
    expect(state.spawned).toEqual(['api', 'dashboard', 'commercial-worker']);
  });

  it('does not rebuild the dashboard while its registered process is alive', async () => {
    const root = createRoot();
    const state = harness();
    const supervisor = createSupervisor(root, state.deps);
    await supervisor.start(environment());
    rmSync(join(root, 'apps', 'dashboard', '.next', 'BUILD_ID'), {
      force: true,
    });

    await supervisor.start(environment());

    expect(
      state.commands.filter((command) => command.args.includes('build')),
    ).toHaveLength(1);
    expect(state.spawned).toEqual(['api', 'dashboard', 'commercial-worker']);
  });

  it('rejects a persisted dashboard port change before rewriting state', async () => {
    const root = createRoot();
    const state = harness();
    const supervisor = createSupervisor(root, state.deps);
    await supervisor.start(environment());
    const persisted = JSON.parse(readFileSync(statePath(root), 'utf8')) as {
      ports: { dashboard: number };
    };
    persisted.ports.dashboard = 3011;
    writeFileSync(statePath(root), JSON.stringify(persisted));

    await expect(supervisor.start(environment())).rejects.toMatchObject({
      code: 'SYSTEM_PORT_CONFIGURATION_CHANGED',
    });
    expect(
      JSON.parse(readFileSync(statePath(root), 'utf8')).ports.dashboard,
    ).toBe(3011);
    expect(
      state.commands.filter((command) => command.args.includes('build')),
    ).toHaveLength(1);
    await expect(supervisor.stop(environment())).resolves.toMatchObject({
      stopped: true,
    });
  });

  it('accepts a listening descendant of a validated managed process', async () => {
    const root = createRoot();
    const portOccupants: Record<number, PortOccupant> = {};
    const state = harness({
      portOccupants,
      managedDescendants: { 100: [900], 101: [901] },
    });
    const supervisor = createSupervisor(root, state.deps);
    await supervisor.start(environment());
    const worker = [...state.processes.values()].find(
      (process) => process.marker === 'commercial-entry',
    );
    expect(worker).toBeDefined();
    worker!.running = false;
    portOccupants[3333] = { pid: 900, processName: 'node' };
    portOccupants[3000] = { pid: 901, processName: 'node' };

    await supervisor.start(environment());

    expect(
      state.spawned.filter((name) => name === 'commercial-worker'),
    ).toHaveLength(2);
    expect(state.stopped).toEqual([]);
  });

  it('restarts a missing API without regenerating Prisma beside live workers', async () => {
    const root = createRoot();
    const state = harness();
    const supervisor = createSupervisor(root, state.deps);
    await supervisor.start(environment());
    const api = [...state.processes.values()].find(
      (process) => process.marker === 'api-entry',
    );
    expect(api).toBeDefined();
    api!.running = false;

    await supervisor.start(environment());

    expect(state.spawned.filter((name) => name === 'api')).toHaveLength(2);
    expect(
      state.commands.filter((command) => command.args.includes('db:generate')),
    ).toHaveLength(1);
  });

  it('recovers stale registrations without killing a reused PID', async () => {
    const root = createRoot();
    const state = harness();
    const supervisor = createSupervisor(root, state.deps);
    await supervisor.start(environment());
    const oldApi = [...state.processes.entries()][0];
    oldApi[1].matches = false;

    await supervisor.start(environment());

    expect(state.spawned.filter((name) => name === 'api')).toHaveLength(2);
    expect(state.stopped).not.toContain(oldApi[0]);
  });

  it('fails safely when Docker is unavailable or an external port is occupied', async () => {
    const dockerRoot = createRoot();
    const docker = harness({ dockerAvailable: false });
    await expect(
      createSupervisor(dockerRoot, docker.deps).start(environment()),
    ).rejects.toMatchObject({ code: 'DOCKER_DAEMON_UNAVAILABLE' });
    expect(docker.spawned).toEqual([]);

    const portRoot = createRoot();
    const port = harness({
      portOccupants: { 3333: { pid: 55, processName: 'external-api' } },
    });
    await expect(
      createSupervisor(portRoot, port.deps).start(environment()),
    ).rejects.toMatchObject({ code: 'SYSTEM_PORT_OCCUPIED' });
    expect(port.stopped).toEqual([]);
  });

  it('requires the ignored root env before starting anything', async () => {
    const root = createRoot();
    rmSync(join(root, '.env'));
    const state = harness();

    await expect(
      createSupervisor(root, state.deps).start(environment()),
    ).rejects.toMatchObject({ code: 'SYSTEM_REQUIRED_FILE_MISSING' });
    expect(state.commands).toEqual([]);
    expect(state.spawned).toEqual([]);
  });

  it('preserves MAIN_COMPOSE_START_FAILED when local Compose start is genuinely required and fails', async () => {
    const root = createRoot();
    const state = harness({ mainComposeStartFails: true });

    await expect(
      createSupervisor(root, state.deps).start(
        explicitSafePreviewEnvironment(),
      ),
    ).rejects.toMatchObject({ code: 'MAIN_COMPOSE_START_FAILED' });

    expect(state.spawned).toEqual([]);
  });

  it('fails before spawning children when infrastructure stays unhealthy', async () => {
    const root = createRoot();
    const state = harness({ infrastructureHealthFails: true });

    await expect(
      createSupervisor(root, state.deps).start(environment()),
    ).rejects.toMatchObject({ code: 'MAIN_COMPOSE_UNHEALTHY' });
    expect(state.spawned).toEqual([]);
  });

  it('fails before spawning children when migrate deploy fails', async () => {
    const root = createRoot();
    const state = harness({ migrationFails: true });

    await expect(
      createSupervisor(root, state.deps).start(environment()),
    ).rejects.toMatchObject({ code: 'PRISMA_MIGRATE_DEPLOY_FAILED' });
    expect(state.spawned).toEqual([]);
  });

  it('rolls back only children started by a failed attempt', async () => {
    const root = createRoot();
    const state = harness({ healthFails: true });
    await expect(
      createSupervisor(root, state.deps).start(environment()),
    ).rejects.toMatchObject({ code: 'API_UNHEALTHY' });
    expect(state.spawned).toEqual(['api']);
    expect(state.stopped).toEqual([100]);
    expect(() => readFileSync(statePath(root), 'utf8')).toThrow();
  });

  it('rolls back when a child dies after its initial readiness check', async () => {
    const root = createRoot();
    const state = harness({
      dieAfterInitialInspection: 'commercial-worker',
    });

    await expect(
      createSupervisor(root, state.deps).start(environment()),
    ).rejects.toMatchObject({ code: 'SYSTEM_START_INCOMPLETE' });
    expect(state.spawned).toEqual(['api', 'dashboard', 'commercial-worker']);
    expect(state.stopped).toEqual([101, 100]);
    expect(() => readFileSync(statePath(root), 'utf8')).toThrow();
  });

  it('reports partial status without throwing', async () => {
    const root = createRoot();
    const state = harness();
    state.setInfrastructure(true);
    const status = await createSupervisor(root, state.deps).status(
      environment(),
    );
    expect(status.overall).toBe('partial');
    expect(status.operationLock).toBe('unlocked');
    expect(status.processes.api).toBe('stopped');
    expect(status.processes['whatsapp-dispatch-worker']).toBe('not-required');
    expect(status.schedulers.legacy).toEqual({
      enabled: null,
      status: 'unavailable',
      cronExpression: null,
      timezone: null,
      nextRunAt: null,
    });
  });

  it('uses the loaded mode when persisted state has only stopped processes', async () => {
    const root = createRoot();
    const state = harness();
    state.processes.set(76, {
      running: false,
      marker: 'api-entry',
      startedAt: '2026-07-25T12:00:00.000Z',
      matches: true,
    });
    writeStateFixture(root, 'preview', {
      api: registeredProcessFixture('api', 76),
    });

    const status = await createSupervisor(root, state.deps).status(
      dailySendReadyEnvironment(),
    );

    expect(status.mode).toBe('send');
    expect(status.controlPlane.required).toBe(true);
    expect(status.processes['whatsapp-dispatch-worker']).toBe('stopped');
  });

  it('uses the loaded preview mode when persisted state has only stopped processes', async () => {
    const root = createRoot();
    const state = harness();
    state.processes.set(75, {
      running: false,
      marker: 'api-entry',
      startedAt: '2026-07-25T12:00:00.000Z',
      matches: true,
    });
    writeStateFixture(root, 'send', {
      api: registeredProcessFixture('api', 75),
    });

    const status = await createSupervisor(root, state.deps).status(
      explicitSafePreviewEnvironment(),
    );

    expect(status.mode).toBe('preview');
    expect(status.processes['whatsapp-dispatch-worker']).toBe('not-required');
    expect(status.controlPlane.required).toBe(false);
  });

  it('keeps persisted mode authoritative while a registered process is running', async () => {
    const root = createRoot();
    const state = harness();
    state.processes.set(77, {
      running: true,
      marker: 'api-entry',
      startedAt: '2026-07-25T12:00:00.000Z',
      matches: true,
    });
    writeStateFixture(root, 'preview', {
      api: registeredProcessFixture('api', 77),
    });

    const status = await createSupervisor(root, state.deps).status(
      dailySendReadyEnvironment(),
    );

    expect(status.mode).toBe('preview');
    expect(status.processes.api).toBe('running');
    expect(status.processes['whatsapp-dispatch-worker']).toBe('not-required');
    expect(status.controlPlane.required).toBe(false);
  });

  it('keeps persisted mode authoritative and degraded on identity mismatch', async () => {
    const root = createRoot();
    const state = harness();
    state.processes.set(78, {
      running: true,
      marker: 'api-entry',
      startedAt: '2026-07-25T12:00:00.000Z',
      matches: false,
    });
    writeStateFixture(root, 'preview', {
      api: registeredProcessFixture('api', 78),
    });

    const status = await createSupervisor(root, state.deps).status(
      dailySendReadyEnvironment(),
    );

    expect(status.mode).toBe('preview');
    expect(status.overall).toBe('partial');
    expect(status.processes.api).toBe('identity-mismatch');
    expect(status.controlPlane.required).toBe(false);
  });

  it('never reports running when an optional preview worker has identity mismatch', async () => {
    const root = createRoot();
    const state = harness();
    state.setInfrastructure(true);
    const processFixtures = [
      ['api', 77, 'api-entry', true],
      ['dashboard', 78, 'dashboard-entry', true],
      ['commercial-worker', 79, 'commercial-entry', true],
      ['whatsapp-dispatch-worker', 80, 'dispatch-entry', false],
    ] as const;
    for (const [, pid, marker, matches] of processFixtures) {
      state.processes.set(pid, {
        running: true,
        marker,
        startedAt: '2026-07-25T12:00:00.000Z',
        matches,
      });
    }
    writeStateFixture(
      root,
      'preview',
      Object.fromEntries(
        processFixtures.map(([name, pid]) => [
          name,
          registeredProcessFixture(name, pid),
        ]),
      ) as LocalSystemState['processes'],
    );

    const status = await createSupervisor(root, state.deps).status(
      dailySendReadyEnvironment(),
    );

    expect(status.processes['whatsapp-dispatch-worker']).toBe(
      'identity-mismatch',
    );
    expect(status.overall).toBe('partial');
  });

  it('uses the loaded mode when persisted state is absent', async () => {
    const root = createRoot();
    const state = harness();

    const status = await createSupervisor(root, state.deps).status(
      dailySendReadyEnvironment(),
    );

    expect(status.mode).toBe('send');
    expect(status.controlPlane.required).toBe(true);
  });

  it('includes sanitized active operation lock evidence in status', async () => {
    const root = createRoot();
    const state = harness();
    state.processes.set(77, {
      running: true,
      marker: SUPERVISOR_PROCESS_MARKER,
      startedAt: '2026-07-25T12:00:00.000Z',
      matches: true,
    });
    mkdirSync(dirname(operationLockPath(root)), { recursive: true });
    writeFileSync(
      operationLockPath(root),
      JSON.stringify({
        version: 1,
        pid: 77,
        ownerToken: '00000000-0000-4000-8000-000000000001',
        acquiredAt: '2026-07-25T12:00:01.000Z',
        processStartedAt: '2026-07-25T12:00:00.000Z',
        processMarker: SUPERVISOR_PROCESS_MARKER,
        operation: 'start',
      }),
    );

    const status = await createSupervisor(root, state.deps).status(
      environment(),
    );

    expect(status).toMatchObject({
      operationLock: 'active',
      operation: 'start',
      pid: 77,
      acquiredAt: '2026-07-25T12:00:01.000Z',
    });
    expect(JSON.stringify(status)).not.toContain('00000000-0000-4000');
  });

  it('uses one operation-lock root for the same Compose project across worktrees', async () => {
    const rootA = createRoot();
    const rootB = createRoot();
    const projectName = 'shared-runtime-test';
    const sharedLockRoot = composeProjectRuntimeRoot(projectName);
    directories.push(sharedLockRoot);
    const state = harness();
    state.processes.set(77, {
      running: true,
      marker: SUPERVISOR_PROCESS_MARKER,
      startedAt: '2026-07-25T12:00:00.000Z',
      matches: true,
    });
    mkdirSync(dirname(operationLockPath(sharedLockRoot)), { recursive: true });
    writeFileSync(
      operationLockPath(sharedLockRoot),
      JSON.stringify({
        version: 1,
        pid: 77,
        ownerToken: '00000000-0000-4000-8000-000000000002',
        acquiredAt: '2026-07-25T12:00:01.000Z',
        processStartedAt: '2026-07-25T12:00:00.000Z',
        processMarker: SUPERVISOR_PROCESS_MARKER,
        operation: 'start',
      }),
    );

    const snapshot = await new LocalSystemSupervisor(rootB, state.deps, specs, {
      validateRoot: () => true,
      composeProjectName: projectName,
      operationLockRoot: sharedLockRoot,
    }).status(explicitSafePreviewEnvironment());

    expect(composeProjectRuntimeRoot(projectName)).toBe(sharedLockRoot);
    expect(composeProjectRuntimeRoot('isolated-runtime-test')).not.toBe(
      sharedLockRoot,
    );
    expect(snapshot.operationLock).toBe('active');
    expect(rootA).not.toBe(rootB);
  });

  it('stops only validated registered processes and preserves state on PID mismatch', async () => {
    const root = createRoot();
    const state = harness();
    const supervisor = createSupervisor(root, state.deps);
    await supervisor.start(environment());
    const api = [...state.processes.entries()][0];
    api[1].matches = false;

    const result = await supervisor.stop(environment());

    expect(result.stopped).toBe(false);
    expect(result.manualIntervention).toContain(
      'api: PID reutilizado ou divergente',
    );
    expect(state.stopped).not.toContain(api[0]);
    expect(readFileSync(statePath(root), 'utf8')).toContain('"api"');
  });

  it('stops idempotently, preserves Docker data and clears confirmed state', async () => {
    const root = createRoot();
    const state = harness();
    const supervisor = createSupervisor(root, state.deps);
    await supervisor.start(environment());
    await expect(supervisor.stop(environment())).resolves.toEqual({
      stopped: true,
      manualIntervention: [],
    });
    await expect(supervisor.stop(environment())).resolves.toEqual({
      stopped: true,
      manualIntervention: [],
    });
    expect(state.commands.some((item) => item.args.includes('-v'))).toBe(false);
    expect(() => readFileSync(statePath(root), 'utf8')).toThrow();
  });
});
