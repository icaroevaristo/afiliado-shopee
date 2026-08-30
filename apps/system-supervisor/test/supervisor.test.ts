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
import { LocalSystemSupervisor } from '../src/supervisor';
import type {
  CommandSpec,
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

const mainComposeConfig = () =>
  JSON.stringify({
    services: {
      postgres: {
        image: 'postgres:16-alpine',
        ports: [{ target: 5432, published: '5432', protocol: 'tcp' }],
        healthcheck: { test: ['CMD-SHELL', 'pg_isready'] },
        volumes: [{ type: 'volume', target: '/var/lib/postgresql/data' }],
      },
      redis: {
        image: 'redis:7-alpine',
        ports: [{ target: 6379, published: '6379', protocol: 'tcp' }],
        healthcheck: { test: ['CMD', 'redis-cli', 'ping'] },
        volumes: [],
      },
    },
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
    Destination: string;
    RW?: boolean;
    Mode?: string;
    Propagation?: string;
  }>;
};

const dockerInspection = (
  service: 'postgres' | 'redis',
  health: 'healthy' | 'starting' | 'unhealthy' = 'healthy',
): DockerInspectionFixture => {
  const postgres = service === 'postgres';
  return {
    Id: postgres ? 'aaaaaaaaaaaa' : 'bbbbbbbbbbbb',
    Config: {
      Image: postgres ? 'postgres:16-alpine' : 'redis:7-alpine',
      Labels: {
        'com.docker.compose.service': service,
        'com.docker.compose.project': 'equivalent-project',
        'com.docker.compose.project.config_files': 'equivalent-compose.yml',
        'com.docker.compose.project.working_dir': 'equivalent-workdir',
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
      ? [{ Type: 'volume', Destination: '/var/lib/postgresql/data' }]
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
): DockerDiscoveryFixture => ({
  config: { code: 0, stdout: mainComposeConfig() },
  list: { code: 0, stdout: 'aaaaaaaaaaaa\nbbbbbbbbbbbb\n' },
  inspect: {
    code: 0,
    stdout: JSON.stringify([
      dockerInspection('postgres', health),
      dockerInspection('redis', health),
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
    healthFails?: boolean;
    dieAfterInitialInspection?: ServiceName;
    portOccupants?: Record<number, PortOccupant>;
    managedDescendants?: Record<number, number[]>;
    dockerDiscovery?: DockerDiscoveryFixture;
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
  const spawnedCwds = new Map<ServiceName, string>();
  const inspectionCounts = new Map<number, number>();
  const run = vi.fn(async (spec: CommandSpec) => {
    commands.push(spec);
    if (spec.args.includes('config') && spec.args.includes('--format')) {
      if (options.dockerDiscoveryThrowsAt === 'config')
        throw new Error('timeout');
      const fixture = options.dockerDiscovery?.config;
      return {
        code: fixture?.code ?? 0,
        stdout: fixture?.stdout ?? '',
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
        stdout: fixture?.stdout ?? '',
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
        code: fixture?.code ?? 1,
        stdout: fixture?.stdout ?? '',
        stderr: '',
      };
    }
    if (spec.command === 'docker' && spec.args[0] === 'inspect') {
      if (options.dockerDiscoveryThrowsAt === 'inspect')
        throw new Error('timeout');
      const fixture = options.dockerDiscovery?.inspect;
      return {
        code: fixture?.code ?? 0,
        stdout: fixture?.stdout ?? '',
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

describe('LocalSystemSupervisor', () => {
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
    for (const [, options] of protectedCalls) {
      expect(options).toEqual({
        headers: { authorization: `Bearer ${localApiAuthToken}` },
      });
    }
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
  it('recognizes equivalent healthy Compose infrastructure from another project', async () => {
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
