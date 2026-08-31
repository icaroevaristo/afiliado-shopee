import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  PREVIEW_STABILITY_CONFIRMATION,
  PREVIEW_STABILITY_ENVIRONMENT,
  assertEvidenceInvariants,
  assertNoBootstrapTick,
  assertPausedStartupEvidence,
  assertSafePreflightEvidence,
  diagnoseRunningTopology,
  installPreviewStabilitySignalCleanup,
  isSafePreviewStabilityFinalState,
  parsePreviewStabilityArgs,
  runPreviewStabilityValidation,
  sanitizePreviewStabilityReport,
  type PreviewStabilityDependencies,
  type PreviewStabilityEvidence,
  type PreviewStabilityReport,
} from '../src/preview-stability';
import { loadLocalSystemEnvironment } from '../src/environment';
import {
  createPreviewStabilityDependencies,
  parseDatabaseHelperFailureDiagnostic,
  stopValidatedManagedProcess,
} from '../src/preview-stability-runtime';
import type { SystemStatusSnapshot } from '../src/supervisor';
import {
  LocalSystemError,
  type LocalSystemState,
  type SystemDependencies,
} from '../src/types';

const ROOT = resolve(import.meta.dirname, '../../..');

const createIsolatedPreviewStabilityDependencies = (
  dependencies: SystemDependencies,
) =>
  createPreviewStabilityDependencies(ROOT, dependencies, {
    loadEnvironmentFiles: false,
  });

const POSTGRES_CONTAINER_ID = 'aaaaaaaaaaaa';
const REDIS_CONTAINER_ID = 'bbbbbbbbbbbb';
const EXTRA_CONTAINER_ID = 'cccccccccccc';

const mainInfrastructureComposeConfig = () =>
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

const mainInfrastructureInspection = (
  service: 'postgres' | 'redis',
  health: 'healthy' | 'starting' | 'unhealthy',
  id = service === 'postgres' ? POSTGRES_CONTAINER_ID : REDIS_CONTAINER_ID,
) => {
  const postgres = service === 'postgres';
  return {
    Id: id,
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

const mainInfrastructureImageInspection = () =>
  JSON.stringify([{ Config: { Volumes: {} } }]);

const status = (
  overall: SystemStatusSnapshot['overall'] = 'stopped',
  operationLock: SystemStatusSnapshot['operationLock'] = 'unlocked',
): SystemStatusSnapshot => ({
  overall,
  operationLock,
  mode: 'preview',
  ports: { api: 3333, dashboard: 3000 },
  docker: { daemon: 'available', services: [] },
  evolution: {
    api: 'unavailable',
    services: [],
    whatsappConnection: 'not-configured',
  },
  processes: {
    api: overall === 'running' ? 'running' : 'stopped',
    dashboard: overall === 'running' ? 'running' : 'stopped',
    'commercial-worker': overall === 'running' ? 'running' : 'stopped',
    'whatsapp-dispatch-worker': 'not-required',
  },
  endpoints: {
    api: overall === 'running' ? 'available' : 'unavailable',
    dashboard: overall === 'running' ? 'available' : 'unavailable',
  },
  controlPlane: {
    required: false,
    configured: false,
    authenticated: false,
  },
  schedulers: {
    legacy: {
      enabled: false,
      status: 'disabled',
      cronExpression: null,
      timezone: null,
      nextRunAt: null,
    },
    commercial: {
      enabled: overall === 'running',
      status: overall === 'running' ? 'registered' : 'unavailable',
      cron: overall === 'running' ? '*/1 * * * *' : null,
      timezone: overall === 'running' ? 'America/Sao_Paulo' : null,
      nextRunAt: null,
      mode: 'preview',
    },
  },
  automation: {
    enabled: overall === 'running',
    allowed: false,
    paused: true,
    reasons: [],
    nextAllowedAt: null,
  },
  externalPortOccupants: [],
});

const partialTopologyStatus = (): SystemStatusSnapshot => {
  const snapshot = status('partial');
  snapshot.docker.services = [
    { service: 'postgres', state: 'running', health: 'healthy' },
    { service: 'redis', state: 'running', health: 'healthy' },
  ];
  snapshot.processes.api = 'running';
  snapshot.processes.dashboard = 'running';
  snapshot.processes['commercial-worker'] = 'running';
  snapshot.processes['whatsapp-dispatch-worker'] = 'not-required';
  snapshot.endpoints.api = 'available';
  snapshot.endpoints.dashboard = 'available';
  snapshot.schedulers.legacy.enabled = false;
  snapshot.schedulers.legacy.status = 'disabled';
  snapshot.schedulers.commercial.enabled = true;
  snapshot.schedulers.commercial.status = 'registered';
  return snapshot;
};

const reusableInfrastructurePartialStatus = (): SystemStatusSnapshot => {
  const snapshot = status('partial');
  snapshot.docker.services = [
    { service: 'postgres', state: 'running', health: 'healthy' },
    { service: 'redis', state: 'running', health: 'healthy' },
  ];
  return snapshot;
};

const safeFinalStoppedStatus = (): SystemStatusSnapshot => {
  const snapshot = reusableInfrastructurePartialStatus();
  snapshot.overall = 'stopped';
  return snapshot;
};

const finalStateSafetyInput = (
  snapshot: SystemStatusSnapshot,
  overrides: Partial<
    Parameters<typeof isSafePreviewStabilityFinalState>[0]
  > = {},
): Parameters<typeof isSafePreviewStabilityFinalState>[0] => ({
  status: snapshot,
  automationPaused: true,
  legacySchedulerIds: 0,
  commercialSchedulerIds: 0,
  managedProcessesActive: 0,
  volumesPreserved: true,
  ...overrides,
});
const evidence = (
  overrides: Partial<PreviewStabilityEvidence> = {},
): PreviewStabilityEvidence => ({
  migrations: {
    applied: 11,
    failed: 0,
    pending: 0,
    unexpected: 0,
    baselineRegistered: true,
    schemaMatchesCurrent: true,
  },
  settings: { present: true, paused: true },
  executions: [],
  runs: { total: 2, dryRun: 2, ambiguous: 0, investigationRequired: 0 },
  dispatches: { total: 1, processing: 0 },
  outboxes: { total: 0, pending: 0, ambiguous: 0 },
  queues: {
    commercialJobIds: [],
    whatsappJobIds: ['historical-whatsapp-job'],
    productJobIds: [],
    commercialSchedulerIds: [],
    legacySchedulerIds: [],
  },
  tableCounts: {
    CommercialAutomationExecution: 0,
    CommercialPipelineRun: 2,
    WhatsAppDispatch: 1,
    CommercialDispatchOutbox: 0,
  },
  ...overrides,
});

const createFakeDependencies = (
  options: {
    initialStatus?: SystemStatusSnapshot;
    unsafeInitialEvidence?: PreviewStabilityEvidence;
    failStartAt?: number;
    startStatus?: SystemStatusSnapshot;
    finalStopStatus?: SystemStatusSnapshot;
    startupBlocked?: boolean;
  } = {},
) => {
  let clock = new Date('2026-07-28T12:00:00.000Z');
  let systemStatus = options.initialStatus ?? status();
  let paused = true;
  let schedulerEnabled = false;
  let tickCount = 0;
  let captureCount = 0;
  let startCount = 0;
  let startupBlocked = false;
  const startupJobId = 'repeat:scheduled-commercial-automation:startup';
  const reports: PreviewStabilityReport[] = [];
  const calls: string[] = [];
  const startEnvironments: Array<{
    COMMERCIAL_AUTOMATION_MODE?: string;
    COMMERCIAL_SCHEDULER_ENABLED?: string;
  }> = [];
  const prepareReuseDecisions: boolean[] = [];
  const snapshot = () =>
    evidence({
      settings: { present: true, paused },
      executions: [
        ...(startupBlocked
          ? [
              {
                id: 'startup-blocked-execution',
                bullMqJobId: startupJobId,
                status: 'BLOCKED' as const,
                stale: false,
              },
            ]
          : []),
        ...Array.from({ length: tickCount }, (_, index) => ({
          id: `execution-${index + 1}`,
          bullMqJobId: `job-${index + 1}`,
          status: 'PREVIEW_READY' as const,
          stale: false,
        })),
      ],
      runs: {
        total: 2 + tickCount,
        dryRun: 2 + tickCount,
        ambiguous: 0,
        investigationRequired: 0,
      },
      queues: {
        commercialJobIds: [
          ...(startupBlocked ? [startupJobId] : []),
          ...Array.from(
            { length: tickCount },
            (_, index) => `job-${index + 1}`,
          ),
        ],
        whatsappJobIds: ['historical-whatsapp-job'],
        productJobIds: [],
        commercialSchedulerIds: schedulerEnabled
          ? ['scheduled-commercial-automation']
          : [],
        legacySchedulerIds: [],
      },
    });
  const dependencies: PreviewStabilityDependencies = {
    now: () => clock,
    sleep: async (milliseconds) => {
      clock = new Date(clock.getTime() + milliseconds);
      if (systemStatus.overall === 'running' && schedulerEnabled && !paused) {
        tickCount += 1;
      }
    },
    status: async () => systemStatus,
    prepareMainInfrastructure: async (
      _environment,
      reuseManagedInfrastructure,
    ) => {
      prepareReuseDecisions.push(reuseManagedInfrastructure);
      calls.push('prepare-infrastructure');
    },
    stopMainInfrastructure: async () => {
      calls.push('stop-infrastructure');
    },
    startSystem: async (environment) => {
      calls.push('start-system');
      startEnvironments.push({
        COMMERCIAL_AUTOMATION_MODE: environment.COMMERCIAL_AUTOMATION_MODE,
        COMMERCIAL_SCHEDULER_ENABLED: environment.COMMERCIAL_SCHEDULER_ENABLED,
      });
      startCount += 1;
      if (startCount === options.failStartAt) {
        systemStatus = status('partial');
        throw new LocalSystemError(
          'Falha parcial simulada',
          'SIMULATED_PARTIAL_START_FAILURE',
        );
      }
      schedulerEnabled = environment.COMMERCIAL_SCHEDULER_ENABLED === 'true';
      if (schedulerEnabled && options.startupBlocked) startupBlocked = true;
      systemStatus = options.startStatus ?? status('running');
      if (!schedulerEnabled) {
        systemStatus.schedulers.commercial.status = 'disabled';
      }
      return systemStatus;
    },
    stopSystem: async () => {
      calls.push('stop-system');
      systemStatus = options.finalStopStatus ?? safeFinalStoppedStatus();
    },
    setAutomationPaused: async (value) => {
      calls.push(value ? 'pause' : 'resume');
      paused = value;
    },
    forceAutomationPaused: async () => {
      calls.push('force-pause');
      paused = true;
    },
    resolvePreviewGroupInstance: async () => 'persisted-preview-instance',
    captureEvidence: async () => {
      captureCount += 1;
      if (captureCount === 1 && options.unsafeInitialEvidence) {
        return options.unsafeInitialEvidence;
      }
      return snapshot();
    },
    captureExecutions: async () => snapshot().executions,
    captureInfrastructure: async () => ({
      volumeCount: 2,
      volumeFingerprint: 'volume-fingerprint',
      containers: { postgres: systemStatus.overall },
      envFingerprint: 'env-fingerprint',
    }),
    killManagedProcess: async (service) => {
      calls.push(`kill-${service}`);
      systemStatus = status('partial');
    },
    restartMainService: async (service) => {
      calls.push(`restart-${service}`);
      return { unavailableMs: 5_000 };
    },
    waitForSafeTickGap: async () => {
      calls.push('safe-gap');
      return clock.getTime() + 60_000;
    },
    writeReport: async (report) => {
      reports.push(report);
    },
  };
  return {
    dependencies,
    calls,
    reports,
    prepareReuseDecisions,
    startEnvironments,
  };
};

const createInfrastructureRuntimeDependencies = (
  run: SystemDependencies['run'],
): SystemDependencies => ({
  run,
  spawn: async () => {
    throw new Error('unexpected spawn');
  },
  inspectProcess: async () => {
    throw new Error('unexpected process inspection');
  },
  inspectProcessIdentity: async () => {
    throw new Error('unexpected process identity inspection');
  },
  stopProcessTree: async () => false,
  getPortOccupant: async () => null,
  request: async () => {
    throw new Error('unexpected request');
  },
  sleep: async () => undefined,
  now: () => new Date('2026-08-15T12:00:00.000-03:00'),
});

const mainInfrastructureCapture = JSON.stringify({
  Service: 'postgres',
  State: 'running',
  Health: 'healthy',
});

const evolutionInfrastructureCapture = JSON.stringify({
  Service: 'evolution-api',
  State: 'running',
  Health: 'healthy',
});

const TEST_SENSITIVE_ENV_KEYS = [
  'LOCAL_API_AUTH_TOKEN',
  'OPENAI_API_KEY',
  'SHOPEE_AFFILIATE_SECRET',
  'EVOLUTION_API_KEY',
  'DATABASE_URL',
  'REDIS_URL',
] as const;

const createSanitizedTestEnvironment = (
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv => {
  const environment: NodeJS.ProcessEnv = {
    COMMERCIAL_AUTOMATION_MODE: 'preview',
    WHATSAPP_PROVIDER: 'mock',
    WHATSAPP_GROUP_SEND_ENABLED: 'false',
    ...overrides,
  };
  for (const key of TEST_SENSITIVE_ENV_KEYS) {
    if (!(key in overrides)) delete environment[key];
  }
  return environment;
};

const safePreviewEvolutionIsolationEnvironment = () =>
  createSanitizedTestEnvironment();
describe('preview operational stability', () => {
  it('pins the stability harness to the mock WhatsApp provider', () => {
    expect(PREVIEW_STABILITY_ENVIRONMENT).toMatchObject({
      COMMERCIAL_AUTOMATION_MODE: 'preview',
      SHOPEE_AFFILIATE_PROVIDER: 'mock',
      WHATSAPP_PROVIDER: 'mock',
      WHATSAPP_GROUP_SEND_ENABLED: 'false',
    });
  });
  it('accepts only the exact local confirmation', () => {
    expect(() =>
      parsePreviewStabilityArgs([PREVIEW_STABILITY_CONFIRMATION]),
    ).not.toThrow();
    expect(() =>
      parsePreviewStabilityArgs(['--', PREVIEW_STABILITY_CONFIRMATION]),
    ).not.toThrow();
    for (const args of [
      [],
      ['--confirm'],
      [PREVIEW_STABILITY_CONFIRMATION, '--extra'],
      ['--', '--', PREVIEW_STABILITY_CONFIRMATION],
    ]) {
      expect(() => parsePreviewStabilityArgs(args)).toThrow(LocalSystemError);
    }
  });

  it('accepts a safe preflight and rejects unsafe commercial state', () => {
    expect(() => assertSafePreflightEvidence(evidence())).not.toThrow();
    expect(() =>
      assertSafePreflightEvidence(
        evidence({
          executions: [
            {
              id: 'historical-manual-execution',
              bullMqJobId: null,
              status: 'PREVIEW_READY',
              stale: false,
            },
          ],
        }),
      ),
    ).not.toThrow();
    expect(() =>
      assertSafePreflightEvidence(
        evidence({ outboxes: { total: 1, pending: 1, ambiguous: 0 } }),
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'PREVIEW_STABILITY_COMMERCIAL_STATE_UNSAFE',
      }),
    );
    expect(() =>
      assertSafePreflightEvidence(
        evidence({
          queues: {
            commercialJobIds: [],
            whatsappJobIds: [],
            productJobIds: [],
            commercialSchedulerIds: ['scheduled-commercial-automation'],
            legacySchedulerIds: [],
          },
        }),
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'PREVIEW_STABILITY_COMMERCIAL_SCHEDULER_PRESENT',
      }),
    );
    expect(() =>
      assertSafePreflightEvidence(
        evidence({
          migrations: {
            applied: 11,
            failed: 0,
            pending: 0,
            unexpected: 0,
            baselineRegistered: true,
            schemaMatchesCurrent: false,
          },
        }),
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'PREVIEW_STABILITY_MIGRATIONS_UNSAFE',
      }),
    );
  });

  it.each([
    [
      'active system',
      status('running'),
      'PREVIEW_STABILITY_SYSTEM_ALREADY_ACTIVE',
    ],
    [
      'busy lock',
      status('stopped', 'active'),
      'PREVIEW_STABILITY_OPERATION_LOCKED',
    ],
  ])(
    'blocks %s without mutating the existing state',
    async (_label, initial, code) => {
      const fake = createFakeDependencies({ initialStatus: initial });
      await expect(
        runPreviewStabilityValidation({
          args: [PREVIEW_STABILITY_CONFIRMATION],
          processEnvironment: {},
          dependencies: fake.dependencies,
        }),
      ).rejects.toMatchObject({ code });
      expect(fake.calls).toEqual([]);
      expect(fake.reports.at(-1)).toMatchObject({
        status: 'failed',
        finalState: {
          system: initial.overall,
          operationLock: initial.operationLock,
        },
      });
    },
  );

  it('accepts reusable managed PostgreSQL and Redis as the only partial state', async () => {
    const initial = reusableInfrastructurePartialStatus();
    const fake = createFakeDependencies({ initialStatus: initial });

    await expect(
      runPreviewStabilityValidation({
        args: [PREVIEW_STABILITY_CONFIRMATION],
        processEnvironment: {},
        dependencies: fake.dependencies,
      }),
    ).resolves.toBeUndefined();

    expect(fake.calls).toContain('prepare-infrastructure');
    expect(fake.reports.at(-1)?.status).toBe('completed');
    expect(fake.prepareReuseDecisions).toEqual([true]);
  });

  describe('final preview state safety', () => {
    it('accepts stopped and partial aggregate states only when PostgreSQL/Redis are uniquely healthy and Shopee runtimes are stopped', () => {
      expect(
        isSafePreviewStabilityFinalState(
          finalStateSafetyInput(safeFinalStoppedStatus()),
        ),
      ).toBe(true);
      expect(
        isSafePreviewStabilityFinalState(
          finalStateSafetyInput(reusableInfrastructurePartialStatus()),
        ),
      ).toBe(true);
    });

    it('allows the harness to complete with a final partial caused only by preserved managed PostgreSQL/Redis', async () => {
      const finalPartial = reusableInfrastructurePartialStatus();
      const fake = createFakeDependencies({ finalStopStatus: finalPartial });

      await expect(
        runPreviewStabilityValidation({
          args: [PREVIEW_STABILITY_CONFIRMATION],
          processEnvironment: {},
          dependencies: fake.dependencies,
        }),
      ).resolves.toBeUndefined();

      const report = fake.reports.at(-1);
      expect(report).toMatchObject({
        status: 'completed',
        finalState: {
          system: 'partial',
          operationLock: 'unlocked',
          automationPaused: true,
          managedProcessesActive: 0,
          volumesPreserved: true,
        },
      });
      expect(report?.failureCode).toBeUndefined();
      expect(report?.bugs).toEqual(
        expect.arrayContaining([
          {
            severity: 'P1',
            code: 'SYSTEM_PARTIAL_RESTART_PRISMA_GENERATE_CONFLICT',
          },
          {
            severity: 'P1',
            code: 'SYSTEM_MANAGED_CHILD_PORT_OWNERSHIP_FALSE_POSITIVE',
          },
        ]),
      );
    });

    it('keeps PREVIEW_STABILITY_FINAL_STATE_UNSAFE for a partial with an active API', async () => {
      const unsafeFinal = reusableInfrastructurePartialStatus();
      unsafeFinal.processes.api = 'running';
      unsafeFinal.endpoints.api = 'available';
      const fake = createFakeDependencies({ finalStopStatus: unsafeFinal });

      await expect(
        runPreviewStabilityValidation({
          args: [PREVIEW_STABILITY_CONFIRMATION],
          processEnvironment: {},
          dependencies: fake.dependencies,
        }),
      ).rejects.toMatchObject({ code: 'PREVIEW_STABILITY_FINAL_STATE_UNSAFE' });

      expect(fake.reports.at(-1)).toMatchObject({
        status: 'failed',
        failureCode: 'PREVIEW_STABILITY_FINAL_STATE_UNSAFE',
        finalState: { system: 'partial' },
      });
    });

    it.each([
      [
        'API active',
        (snapshot: SystemStatusSnapshot) => {
          snapshot.processes.api = 'running';
          snapshot.endpoints.api = 'available';
        },
      ],
      [
        'dashboard active',
        (snapshot: SystemStatusSnapshot) => {
          snapshot.processes.dashboard = 'running';
          snapshot.endpoints.dashboard = 'available';
        },
      ],
      [
        'commercial worker active',
        (snapshot: SystemStatusSnapshot) => {
          snapshot.processes['commercial-worker'] = 'running';
        },
      ],
      [
        'residual dispatch worker',
        (snapshot: SystemStatusSnapshot) => {
          snapshot.processes['whatsapp-dispatch-worker'] = 'running';
        },
      ],
      [
        'commercial scheduler active',
        (snapshot: SystemStatusSnapshot) => {
          snapshot.schedulers.commercial.enabled = true;
          snapshot.schedulers.commercial.status = 'registered';
        },
      ],
      [
        'legacy scheduler active',
        (snapshot: SystemStatusSnapshot) => {
          snapshot.schedulers.legacy.enabled = true;
          snapshot.schedulers.legacy.status = 'registered';
        },
      ],
      [
        'commercial scheduler not explicitly disabled/unavailable',
        (snapshot: SystemStatusSnapshot) => {
          snapshot.schedulers.commercial.status = 'not-registered';
        },
      ],
      [
        'busy operation lock',
        (snapshot: SystemStatusSnapshot) => {
          snapshot.operationLock = 'active';
        },
      ],
      [
        'PostgreSQL unhealthy',
        (snapshot: SystemStatusSnapshot) => {
          const postgres = snapshot.docker.services.find(
            (service) => service.service === 'postgres',
          );
          if (postgres) postgres.health = 'unhealthy';
        },
      ],
      [
        'Redis unhealthy',
        (snapshot: SystemStatusSnapshot) => {
          const redis = snapshot.docker.services.find(
            (service) => service.service === 'redis',
          );
          if (redis) redis.health = 'unhealthy';
        },
      ],
      [
        'ownership absent',
        (snapshot: SystemStatusSnapshot) => {
          snapshot.docker.services = snapshot.docker.services.filter(
            (service) => service.service !== 'postgres',
          );
        },
      ],
      [
        'ownership ambiguous',
        (snapshot: SystemStatusSnapshot) => {
          snapshot.docker.services.push({
            service: 'postgres',
            state: 'running',
            health: 'healthy',
          });
        },
      ],
      [
        'additional main infrastructure entry',
        (snapshot: SystemStatusSnapshot) => {
          snapshot.docker.services.push({
            service: 'unexpected-main-service',
            state: 'running',
            health: 'healthy',
          });
        },
      ],
      [
        'external port occupant',
        (snapshot: SystemStatusSnapshot) => {
          snapshot.externalPortOccupants.push({
            port: 3334,
            processName: 'external-process',
            pid: 999,
          });
        },
      ],
      [
        'Evolution runtime observed',
        (snapshot: SystemStatusSnapshot) => {
          snapshot.evolution.services.push({
            service: 'evolution-api',
            state: 'running',
            health: 'healthy',
          });
        },
      ],
      [
        'Evolution API observed',
        (snapshot: SystemStatusSnapshot) => {
          snapshot.evolution.api = 'available';
        },
      ],
      [
        'Docker unavailable',
        (snapshot: SystemStatusSnapshot) => {
          snapshot.docker.daemon = 'unavailable';
        },
      ],
      [
        'aggregate running',
        (snapshot: SystemStatusSnapshot) => {
          snapshot.overall = 'running';
        },
      ],
    ])('rejects final state when %s', (_label, mutate) => {
      const snapshot = reusableInfrastructurePartialStatus();
      mutate(snapshot);
      expect(
        isSafePreviewStabilityFinalState(finalStateSafetyInput(snapshot)),
      ).toBe(false);
    });

    it.each([
      ['automation is not paused', { automationPaused: false }],
      ['legacy scheduler evidence remains', { legacySchedulerIds: 1 }],
      ['commercial scheduler evidence remains', { commercialSchedulerIds: 1 }],
      ['managed process count is non-zero', { managedProcessesActive: 1 }],
      ['volumes are not preserved', { volumesPreserved: false }],
    ] as const)('rejects final state when %s', (_label, overrides) => {
      expect(
        isSafePreviewStabilityFinalState(
          finalStateSafetyInput(
            reusableInfrastructurePartialStatus(),
            overrides,
          ),
        ),
      ).toBe(false);
    });
  });

  it.each([
    [
      'API process active',
      (snapshot: SystemStatusSnapshot) => {
        snapshot.processes.api = 'running';
        snapshot.endpoints.api = 'available';
      },
    ],
    [
      'dashboard active',
      (snapshot: SystemStatusSnapshot) => {
        snapshot.processes.dashboard = 'running';
        snapshot.endpoints.dashboard = 'available';
      },
    ],
    [
      'commercial worker active',
      (snapshot: SystemStatusSnapshot) => {
        snapshot.processes['commercial-worker'] = 'running';
      },
    ],
    [
      'commercial scheduler active',
      (snapshot: SystemStatusSnapshot) => {
        snapshot.schedulers.commercial.enabled = true;
        snapshot.schedulers.commercial.status = 'registered';
      },
    ],
    [
      'legacy scheduler active',
      (snapshot: SystemStatusSnapshot) => {
        snapshot.schedulers.legacy.enabled = true;
        snapshot.schedulers.legacy.status = 'registered';
      },
    ],
    [
      'PostgreSQL unhealthy',
      (snapshot: SystemStatusSnapshot) => {
        snapshot.docker.services[0]!.health = 'unhealthy';
      },
    ],
    [
      'Redis offline',
      (snapshot: SystemStatusSnapshot) => {
        snapshot.docker.services[1]!.state = 'exited';
      },
    ],
    [
      'PostgreSQL ownership missing',
      (snapshot: SystemStatusSnapshot) => {
        snapshot.docker.services = snapshot.docker.services.filter(
          (service) => service.service !== 'postgres',
        );
      },
    ],
    [
      'ambiguous managed infrastructure',
      (snapshot: SystemStatusSnapshot) => {
        snapshot.docker.services.push({
          service: 'postgres',
          state: 'running',
          health: 'healthy',
        });
      },
    ],
    [
      'non-preview mode',
      (snapshot: SystemStatusSnapshot) => {
        snapshot.mode = 'send';
      },
    ],
  ] satisfies Array<[string, (snapshot: SystemStatusSnapshot) => void]>)(
    'keeps reusable-infrastructure partial blocked when %s',
    async (_label, mutate) => {
      const initial = reusableInfrastructurePartialStatus();
      mutate(initial);
      const fake = createFakeDependencies({ initialStatus: initial });

      await expect(
        runPreviewStabilityValidation({
          args: [PREVIEW_STABILITY_CONFIRMATION],
          processEnvironment: {},
          dependencies: fake.dependencies,
        }),
      ).rejects.toMatchObject({
        code: 'PREVIEW_STABILITY_SYSTEM_ALREADY_ACTIVE',
      });
      expect(fake.calls).toEqual([]);
    },
  );

  it('accepts a completely healthy running topology', () => {
    expect(diagnoseRunningTopology(status('running'))).toBeNull();
  });

  it.each([
    [
      'api',
      (snapshot: SystemStatusSnapshot) => {
        snapshot.processes.api = 'stopped';
      },
      { component: 'api', observedState: 'stopped', expectedState: 'running' },
    ],
    [
      'dashboard',
      (snapshot: SystemStatusSnapshot) => {
        snapshot.processes.dashboard = 'stopped';
      },
      {
        component: 'dashboard',
        observedState: 'stopped',
        expectedState: 'running',
      },
    ],
    [
      'commercial-worker',
      (snapshot: SystemStatusSnapshot) => {
        snapshot.processes['commercial-worker'] = 'stopped';
      },
      {
        component: 'commercial-worker',
        observedState: 'stopped',
        expectedState: 'running',
      },
    ],
    [
      'commercial-scheduler',
      (snapshot: SystemStatusSnapshot) => {
        snapshot.schedulers.commercial.enabled = false;
        snapshot.schedulers.commercial.status = 'unavailable';
      },
      {
        component: 'commercial-scheduler',
        observedState: 'unavailable',
        expectedState: 'running',
      },
    ],
  ] as const)(
    'identifies missing %s in an unhealthy running topology',
    (_label, mutate, expected) => {
      const snapshot = partialTopologyStatus();
      mutate(snapshot);
      expect(diagnoseRunningTopology(snapshot)).toMatchObject({
        topologyStage: 'requireRunning',
        ...expected,
      });
    },
  );

  it('prioritizes API health over derived legacy scheduler unavailability', () => {
    const snapshot = partialTopologyStatus();
    snapshot.endpoints.api = 'unavailable';
    snapshot.schedulers.legacy.enabled = null;
    snapshot.schedulers.legacy.status = 'unavailable';

    expect(diagnoseRunningTopology(snapshot)).toEqual({
      topologyStage: 'requireRunning',
      component: 'api',
      observedState: 'unhealthy',
      expectedState: 'running',
    });
  });

  it('reports legacy scheduler unavailable only after the primary topology is healthy', () => {
    const snapshot = status('running');
    snapshot.schedulers.legacy.enabled = null;
    snapshot.schedulers.legacy.status = 'unavailable';

    expect(diagnoseRunningTopology(snapshot)).toEqual({
      topologyStage: 'requireRunning',
      component: 'legacy-scheduler',
      observedState: 'unavailable',
      expectedState: 'not-required',
    });
  });

  it('keeps legacy scheduler disabled and safe-preview Evolution out of the diagnosis', () => {
    const snapshot = partialTopologyStatus();
    snapshot.evolution = {
      api: 'available',
      services: [
        { service: 'evolution-api', state: 'running', health: 'healthy' },
      ],
      whatsappConnection: 'open',
    };
    expect(snapshot.schedulers.legacy.status).toBe('disabled');
    expect(diagnoseRunningTopology(snapshot)).toMatchObject({
      component: 'unknown',
      expectedState: 'running',
    });
  });

  it('accepts managed healthy PostgreSQL and Redis when decomposing topology', () => {
    const snapshot = partialTopologyStatus();
    expect(diagnoseRunningTopology(snapshot)?.component).not.toBe('docker');
  });

  it('preserves topology failure code, writes only allowlisted diagnosis, restores, and does not retry', async () => {
    const started = partialTopologyStatus();
    started.processes.api = 'stopped';
    const fake = createFakeDependencies({ startStatus: started });

    await expect(
      runPreviewStabilityValidation({
        args: [PREVIEW_STABILITY_CONFIRMATION],
        processEnvironment: {},
        dependencies: fake.dependencies,
      }),
    ).rejects.toMatchObject({
      code: 'PREVIEW_STABILITY_TOPOLOGY_UNHEALTHY',
    });

    expect(fake.startEnvironments).toEqual([
      {
        COMMERCIAL_AUTOMATION_MODE: 'preview',
        COMMERCIAL_SCHEDULER_ENABLED: 'true',
      },
      {
        COMMERCIAL_AUTOMATION_MODE: 'preview',
        COMMERCIAL_SCHEDULER_ENABLED: 'false',
      },
    ]);
    expect(fake.calls.filter((call) => call === 'start-system')).toHaveLength(
      2,
    );
    expect(
      fake.reports[0]?.scenarios.filter(
        (scenario) => scenario.name === 'scheduled-preview',
      ),
    ).toHaveLength(1);
    expect(fake.calls).toContain('stop-system');
    expect(fake.calls).toContain('pause');
    expect(fake.calls).not.toContain('force-pause');
    expect(fake.reports).toHaveLength(1);
    expect(fake.reports[0]).toMatchObject({
      failureCode: 'PREVIEW_STABILITY_TOPOLOGY_UNHEALTHY',
      topologyDiagnostic: {
        topologyStage: 'requireRunning',
        component: 'api',
        observedState: 'stopped',
        expectedState: 'running',
      },
    });
    expect(JSON.stringify(fake.reports[0]?.topologyDiagnostic)).not.toMatch(
      /postgresql:\/\/|redis:\/\/|password|token|secret|stderr|stack/i,
    );
    expect(fake.reports[0]?.scenarios).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'scheduled-preview',
          status: 'failed',
        }),
        expect.objectContaining({
          name: 'mandatory-restoration',
          status: 'completed',
        }),
      ]),
    );
  });

  it('preserves the external-port conflict error for reusable infrastructure partial', async () => {
    const initial = reusableInfrastructurePartialStatus();
    initial.externalPortOccupants = [
      { port: 3334, processName: 'unexpected-process', pid: 999 },
    ];
    const fake = createFakeDependencies({ initialStatus: initial });

    await expect(
      runPreviewStabilityValidation({
        args: [PREVIEW_STABILITY_CONFIRMATION],
        processEnvironment: {},
        dependencies: fake.dependencies,
      }),
    ).rejects.toMatchObject({
      code: 'PREVIEW_STABILITY_EXTERNAL_PORT_OCCUPIED',
    });
    expect(fake.calls).toEqual([]);
  });

  it('does not let isolated Evolution state reopen the safe preview preflight', async () => {
    const initial = reusableInfrastructurePartialStatus();
    initial.evolution = {
      api: 'available',
      services: [
        { service: 'evolution-api', state: 'running', health: 'healthy' },
      ],
      whatsappConnection: 'open',
    };
    const fake = createFakeDependencies({ initialStatus: initial });

    await expect(
      runPreviewStabilityValidation({
        args: [PREVIEW_STABILITY_CONFIRMATION],
        processEnvironment: {},
        dependencies: fake.dependencies,
      }),
    ).resolves.toBeUndefined();
  });

  it('keeps a fully stopped preflight accepted', async () => {
    const fake = createFakeDependencies({ initialStatus: status('stopped') });

    await expect(
      runPreviewStabilityValidation({
        args: [PREVIEW_STABILITY_CONFIRMATION],
        processEnvironment: {},
        dependencies: fake.dependencies,
      }),
    ).resolves.toBeUndefined();
  });
  it('cleans up after unsafe evidence without attempting recovery', async () => {
    const fake = createFakeDependencies({
      unsafeInitialEvidence: evidence({
        executions: [
          {
            id: 'ambiguous',
            bullMqJobId: 'ambiguous-job',
            status: 'AMBIGUOUS',
            stale: false,
          },
        ],
      }),
    });
    await expect(
      runPreviewStabilityValidation({
        args: [PREVIEW_STABILITY_CONFIRMATION],
        processEnvironment: {},
        dependencies: fake.dependencies,
      }),
    ).rejects.toMatchObject({
      code: 'PREVIEW_STABILITY_COMMERCIAL_STATE_UNSAFE',
    });
    expect(fake.calls).not.toContain('resume');
    expect(fake.calls).toContain('force-pause');
    expect(fake.calls).toContain('stop-system');
  });

  it('stops partially started infrastructure when restoration start fails', async () => {
    const fake = createFakeDependencies({
      failStartAt: 1,
      unsafeInitialEvidence: evidence({
        outboxes: { total: 1, pending: 1, ambiguous: 0 },
      }),
    });
    await expect(
      runPreviewStabilityValidation({
        args: [PREVIEW_STABILITY_CONFIRMATION],
        processEnvironment: {},
        dependencies: fake.dependencies,
      }),
    ).rejects.toMatchObject({
      code: 'PREVIEW_STABILITY_COMMERCIAL_STATE_UNSAFE',
    });
    expect(fake.calls.filter((call) => call === 'stop-system')).toHaveLength(1);
    expect(fake.reports.at(-1)).toMatchObject({
      status: 'failed',
      finalState: { system: 'stopped', managedProcessesActive: 0 },
    });
  });

  it('executes every scenario, observes five previews and removes schedulers', async () => {
    const fake = createFakeDependencies();
    await runPreviewStabilityValidation({
      args: [PREVIEW_STABILITY_CONFIRMATION],
      processEnvironment: {
        DATABASE_URL:
          'postgresql://sensitive-user:sensitive-password@localhost/app',
      },
      dependencies: fake.dependencies,
    });
    const report = fake.reports.at(-1)!;
    expect(report.status).toBe('completed');
    expect(report.scenarios).toHaveLength(8);
    expect(report.ticksObserved).toBeGreaterThanOrEqual(5);
    expect(report.failuresInjected).toEqual([
      'commercial-worker-stopped',
      'api-stopped',
      'redis-temporarily-stopped',
      'postgres-temporarily-stopped',
    ]);
    expect(report.invariants).toMatchObject({
      noDispatchCreated: true,
      noOutboxCreated: true,
      noWhatsappJobCreated: true,
      noProductJobCreated: true,
      noDuplicateBullMqJobId: true,
      commercialSchedulerRemoved: true,
      volumesPreserved: true,
    });
    expect(fake.calls.filter((call) => call.startsWith('kill-'))).toEqual([
      'kill-commercial-worker',
      'kill-api',
    ]);
    expect(fake.calls.filter((call) => call.startsWith('restart-'))).toEqual([
      'restart-redis',
      'restart-postgres',
    ]);
    expect(JSON.stringify(report)).not.toMatch(
      /sensitive-user|sensitive-password|postgresql:\/\//,
    );
    const sanitized = sanitizePreviewStabilityReport({
      ...report,
      mainInfrastructureDiagnostic: {
        mainInfraStage: 'start',
        service: 'postgres',
        operation: 'restart',
        commandKind: 'container',
        errorCode: 'COMMAND_FAILED',
        observedHealth: 'unavailable',
        expectedHealth: 'healthy',
      },
      databaseUrl: 'postgresql://sensitive-user:sensitive-password@host/db',
      stderr: 'sensitive-start-detail',
    } as PreviewStabilityReport & { databaseUrl: string; stderr: string });
    expect(sanitized).not.toHaveProperty('databaseUrl');
    expect(sanitized).not.toHaveProperty('stderr');
    expect(sanitized).toMatchObject({
      mainInfrastructureDiagnostic: {
        mainInfraStage: 'start',
        service: 'postgres',
        operation: 'restart',
        commandKind: 'container',
        errorCode: 'COMMAND_FAILED',
        observedHealth: 'unavailable',
        expectedHealth: 'healthy',
      },
    });
    expect(JSON.stringify(sanitized)).not.toMatch(
      /sensitive-user|sensitive-password|sensitive-start-detail|postgresql:\/\//,
    );
  });

  it('detects forbidden deltas and duplicate BullMQ identities', () => {
    const before = evidence();
    expect(() =>
      assertEvidenceInvariants(
        before,
        evidence({ dispatches: { total: 2, processing: 0 } }),
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'PREVIEW_STABILITY_INVARIANT_VIOLATION',
      }),
    );
    expect(() =>
      assertEvidenceInvariants(
        before,
        evidence({
          executions: [
            {
              id: 'one',
              bullMqJobId: 'same-job',
              status: 'PREVIEW_READY',
              stale: false,
            },
            {
              id: 'two',
              bullMqJobId: 'same-job',
              status: 'PREVIEW_READY',
              stale: false,
            },
          ],
        }),
      ),
    ).toThrow(LocalSystemError);
  });

  it('allows at most one blocked startup execution while automation remains paused', () => {
    const before = evidence();
    const startupJobId = 'repeat:scheduled-commercial-automation:startup';
    const after = evidence({
      settings: { present: true, paused: true },
      executions: [
        {
          id: 'startup-blocked-execution',
          bullMqJobId: startupJobId,
          status: 'BLOCKED',
          stale: false,
        },
      ],
      queues: {
        commercialJobIds: [startupJobId],
        whatsappJobIds: before.queues.whatsappJobIds,
        productJobIds: [],
        commercialSchedulerIds: ['scheduled-commercial-automation'],
        legacySchedulerIds: [],
      },
    });

    expect(() => assertPausedStartupEvidence(before, after)).not.toThrow();
    expect(() =>
      assertPausedStartupEvidence(before, {
        ...after,
        settings: { present: true, paused: false },
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'PREVIEW_STABILITY_PAUSED_STARTUP_UNSAFE',
      }),
    );
    expect(() =>
      assertPausedStartupEvidence(before, {
        ...after,
        executions: [
          ...after.executions,
          {
            id: 'unexpected-preview',
            bullMqJobId: 'unexpected-job',
            status: 'PREVIEW_READY',
            stale: false,
          },
        ],
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'PREVIEW_STABILITY_PAUSED_STARTUP_UNSAFE',
      }),
    );
  });

  it('keeps a paused startup execution visible in deltas without counting it as a tick', async () => {
    const fake = createFakeDependencies({ startupBlocked: true });
    await runPreviewStabilityValidation({
      args: [PREVIEW_STABILITY_CONFIRMATION],
      processEnvironment: {},
      dependencies: fake.dependencies,
    });
    const report = fake.reports.at(-1)!;
    expect(report.status).toBe('completed');
    expect(report.ticksObserved).toBeGreaterThanOrEqual(5);
    expect(report.deltas.executions).toBe(report.ticksObserved + 1);
    expect(report.deltas.commercialJobs).toBe(report.ticksObserved + 1);
    expect(
      report.scenarios.filter(
        (scenario) => scenario.name === 'scheduled-preview',
      ),
    ).toHaveLength(1);
  });

  it('distinguishes a due scheduled tick from an immediate bootstrap tick', () => {
    const before = evidence();
    const scheduledAt = Date.parse('2026-07-28T12:01:00.000Z');
    const execution = (bullMqJobId: string) =>
      evidence({
        executions: [
          {
            id: 'new-execution',
            bullMqJobId,
            status: 'PREVIEW_READY',
            stale: false,
          },
        ],
      });
    expect(() =>
      assertNoBootstrapTick(
        before,
        execution(`repeat:scheduled-commercial-automation:${scheduledAt}`),
        scheduledAt,
      ),
    ).not.toThrow();
    expect(() =>
      assertNoBootstrapTick(
        before,
        execution('immediate-bootstrap-job'),
        scheduledAt,
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'PREVIEW_STABILITY_BOOTSTRAP_TICK_DETECTED',
      }),
    );
  });

  it('turns SIGINT and SIGTERM into serialized interruption requests', () => {
    const handlers = new Map<string, () => void>();
    const requestInterruption = vi.fn();
    const runtime = {
      once: vi.fn((signal: string, handler: () => void) => {
        handlers.set(signal, handler);
        return runtime;
      }),
      off: vi.fn(() => runtime),
    };
    const remove = installPreviewStabilitySignalCleanup(
      requestInterruption,
      runtime,
    );
    handlers.get('SIGINT')?.();
    handlers.get('SIGTERM')?.();
    expect(requestInterruption).toHaveBeenNthCalledWith(1, 130);
    expect(requestInterruption).toHaveBeenNthCalledWith(2, 143);
    remove();
    expect(runtime.off).toHaveBeenCalledTimes(2);
  });

  it('restores the topology and writes a failed report after a signal', async () => {
    const fake = createFakeDependencies();
    const handlers = new Map<string, () => void>();
    const signalRuntime = {
      once: vi.fn((signal: string, handler: () => void) => {
        handlers.set(signal, handler);
        return signalRuntime;
      }),
      off: vi.fn(() => signalRuntime),
    };
    const originalSleep = fake.dependencies.sleep;
    fake.dependencies.sleep = async (milliseconds) => {
      await originalSleep(milliseconds);
      handlers.get('SIGINT')?.();
    };

    await expect(
      runPreviewStabilityValidation({
        args: [PREVIEW_STABILITY_CONFIRMATION],
        processEnvironment: {},
        dependencies: fake.dependencies,
        signalRuntime,
      }),
    ).rejects.toMatchObject({
      code: 'PREVIEW_STABILITY_INTERRUPTED_SIGINT',
    });
    expect(fake.calls).toContain('pause');
    expect(fake.calls.filter((call) => call === 'stop-system')).toHaveLength(2);
    expect(fake.reports.at(-1)).toMatchObject({
      status: 'failed',
      failureCode: 'PREVIEW_STABILITY_INTERRUPTED_SIGINT',
      finalState: { system: 'stopped', automationPaused: true },
    });
  });

  it('never stops a registered PID when its identity diverges', async () => {
    const stopProcessTree = vi.fn(async () => true);
    const dependencies = {
      inspectProcess: vi.fn(async () => ({
        running: true,
        identityMatches: false,
      })),
      stopProcessTree,
    } as unknown as SystemDependencies;
    const state: LocalSystemState = {
      version: 1,
      startedAt: '2026-07-28T12:00:00.000Z',
      mode: 'preview',
      ports: {
        api: 3333,
        dashboard: 3000,
        postgres: 5432,
        redis: 6379,
        evolution: 8080,
      },
      processes: {
        api: {
          pid: 999,
          startedAt: '2026-07-28T12:00:00.000Z',
          log: '.runtime/local-system/api.log',
        },
      },
    };
    await expect(
      stopValidatedManagedProcess({
        service: 'api',
        state,
        specs: [
          {
            name: 'api',
            command: 'node',
            args: [],
            marker: 'server.ts',
          },
        ],
        dependencies,
      }),
    ).rejects.toMatchObject({
      code: 'PREVIEW_STABILITY_MANAGED_PROCESS_IDENTITY_MISMATCH',
    });
    expect(stopProcessTree).not.toHaveBeenCalled();
  });

  it.each(['redis', 'postgres'] as const)(
    'restarts only the fingerprinted %s container and never uses compose stop/start',
    async (service) => {
      let now = new Date('2026-07-28T12:00:00.000Z');
      let started = false;
      let targetHealth: 'healthy' | 'starting' = 'healthy';
      const commands: string[][] = [];
      const targetId =
        service === 'postgres' ? POSTGRES_CONTAINER_ID : REDIS_CONTAINER_ID;
      const dependencies = {
        run: vi.fn(async (spec: { args: string[] }) => {
          commands.push(spec.args);
          if (spec.args.includes('config')) {
            return {
              code: 0,
              stdout: mainInfrastructureComposeConfig(),
              stderr: '',
            };
          }
          if (spec.args[0] === 'ps') {
            return {
              code: 0,
              stdout: `${POSTGRES_CONTAINER_ID}\n${REDIS_CONTAINER_ID}\n`,
              stderr: '',
            };
          }
          if (spec.args[0] === 'inspect') {
            return {
              code: 0,
              stdout: JSON.stringify([
                mainInfrastructureInspection(
                  'postgres',
                  service === 'postgres' ? targetHealth : 'healthy',
                ),
                mainInfrastructureInspection(
                  'redis',
                  service === 'redis' ? targetHealth : 'healthy',
                ),
              ]),
              stderr: '',
            };
          }
          if (spec.args[0] === 'image' && spec.args[1] === 'inspect') {
            return {
              code: 0,
              stdout: mainInfrastructureImageInspection(),
              stderr: '',
            };
          }
          if (spec.args[0] === 'stop') {
            expect(spec.args).toEqual(['stop', targetId]);
            return { code: 0, stdout: '', stderr: '' };
          }
          if (spec.args[0] === 'start') {
            expect(spec.args).toEqual(['start', targetId]);
            started = true;
            targetHealth = 'starting';
            return { code: 0, stdout: '', stderr: '' };
          }
          return { code: 0, stdout: '', stderr: '' };
        }),
        sleep: vi.fn(async (milliseconds: number) => {
          now = new Date(now.getTime() + milliseconds);
          if (started && milliseconds === 1_000) targetHealth = 'healthy';
        }),
        now: () => now,
      } as unknown as SystemDependencies;
      const runtime = createIsolatedPreviewStabilityDependencies(dependencies);

      await expect(
        runtime.restartMainService(
          service,
          safePreviewEvolutionIsolationEnvironment(),
        ),
      ).resolves.toEqual({ unavailableMs: 5_000 });

      expect(commands).toContainEqual(['stop', targetId]);
      expect(commands).toContainEqual(['start', targetId]);
      expect(
        commands.some(
          (args) =>
            args[0] === 'compose' &&
            (args.includes('stop') ||
              args.includes('start') ||
              args.includes('up')),
        ),
      ).toBe(false);
      expect(commands.flat()).not.toContain('down');
      expect(commands.flat()).not.toContain('-v');
    },
  );

  it('fails closed before stop when infrastructure ownership is unproven', async () => {
    const commands: string[][] = [];
    const dependencies = {
      run: vi.fn(async (spec: { args: string[] }) => {
        commands.push(spec.args);
        if (spec.args.includes('config')) {
          return {
            code: 0,
            stdout: mainInfrastructureComposeConfig(),
            stderr: '',
          };
        }
        if (spec.args[0] === 'ps') return { code: 0, stdout: '', stderr: '' };
        return { code: 0, stdout: '', stderr: '' };
      }),
      sleep: vi.fn(),
      now: () => new Date('2026-07-28T12:00:00.000Z'),
    } as unknown as SystemDependencies;
    const runtime = createIsolatedPreviewStabilityDependencies(dependencies);

    await expect(
      runtime.restartMainService(
        'postgres',
        safePreviewEvolutionIsolationEnvironment(),
      ),
    ).rejects.toMatchObject({
      code: 'PREVIEW_STABILITY_POSTGRES_START_FAILED',
      diagnostic: {
        mainInfraStage: 'resolve',
        service: 'postgres',
        commandKind: 'discovery',
        errorCode: 'OWNERSHIP_UNPROVEN',
      },
    });
    expect(
      commands.some((args) => args[0] === 'stop' || args[0] === 'start'),
    ).toBe(false);
  });

  it('rejects ambiguous PostgreSQL ownership before any stop/start', async () => {
    const commands: string[][] = [];
    const dependencies = {
      run: vi.fn(async (spec: { args: string[] }) => {
        commands.push(spec.args);
        if (spec.args.includes('config')) {
          return {
            code: 0,
            stdout: mainInfrastructureComposeConfig(),
            stderr: '',
          };
        }
        if (spec.args[0] === 'ps') {
          return {
            code: 0,
            stdout: `${POSTGRES_CONTAINER_ID}\n${EXTRA_CONTAINER_ID}\n${REDIS_CONTAINER_ID}\n`,
            stderr: '',
          };
        }
        if (spec.args[0] === 'inspect') {
          return {
            code: 0,
            stdout: JSON.stringify([
              mainInfrastructureInspection('postgres', 'healthy'),
              mainInfrastructureInspection(
                'postgres',
                'healthy',
                EXTRA_CONTAINER_ID,
              ),
              mainInfrastructureInspection('redis', 'healthy'),
            ]),
            stderr: '',
          };
        }
        if (spec.args[0] === 'image' && spec.args[1] === 'inspect') {
          return {
            code: 0,
            stdout: mainInfrastructureImageInspection(),
            stderr: '',
          };
        }
        return { code: 0, stdout: '', stderr: '' };
      }),
      sleep: vi.fn(),
      now: () => new Date('2026-07-28T12:00:00.000Z'),
    } as unknown as SystemDependencies;
    const runtime = createIsolatedPreviewStabilityDependencies(dependencies);

    await expect(
      runtime.restartMainService(
        'postgres',
        safePreviewEvolutionIsolationEnvironment(),
      ),
    ).rejects.toMatchObject({
      diagnostic: {
        mainInfraStage: 'resolve',
        errorCode: 'AMBIGUOUS_OWNERSHIP',
      },
    });
    expect(
      commands.some((args) => args[0] === 'stop' || args[0] === 'start'),
    ).toBe(false);
  });

  it('preserves MAIN_COMPOSE_START_FAILED when the proven PostgreSQL container cannot start', async () => {
    const commands: string[][] = [];
    const dependencies = {
      run: vi.fn(async (spec: { args: string[] }) => {
        commands.push(spec.args);
        if (spec.args.includes('config')) {
          return {
            code: 0,
            stdout: mainInfrastructureComposeConfig(),
            stderr: '',
          };
        }
        if (spec.args[0] === 'ps') {
          return {
            code: 0,
            stdout: `${POSTGRES_CONTAINER_ID}\n${REDIS_CONTAINER_ID}\n`,
            stderr: '',
          };
        }
        if (spec.args[0] === 'inspect') {
          return {
            code: 0,
            stdout: JSON.stringify([
              mainInfrastructureInspection('postgres', 'healthy'),
              mainInfrastructureInspection('redis', 'healthy'),
            ]),
            stderr: '',
          };
        }
        if (spec.args[0] === 'image' && spec.args[1] === 'inspect') {
          return {
            code: 0,
            stdout: mainInfrastructureImageInspection(),
            stderr: '',
          };
        }
        if (spec.args[0] === 'stop') return { code: 0, stdout: '', stderr: '' };
        if (spec.args[0] === 'start') {
          return { code: 1, stdout: '', stderr: 'sensitive-start-detail' };
        }
        return { code: 0, stdout: '', stderr: '' };
      }),
      sleep: vi.fn(),
      now: () => new Date('2026-07-28T12:00:00.000Z'),
    } as unknown as SystemDependencies;
    const runtime = createIsolatedPreviewStabilityDependencies(dependencies);

    const error = await runtime
      .restartMainService(
        'postgres',
        safePreviewEvolutionIsolationEnvironment(),
      )
      .catch((value: unknown) => value);
    expect(error).toMatchObject({
      code: 'MAIN_COMPOSE_START_FAILED',
      diagnostic: {
        mainInfraStage: 'start',
        service: 'postgres',
        operation: 'restart',
        commandKind: 'container',
        errorCode: 'COMMAND_FAILED',
        expectedHealth: 'healthy',
      },
    });
    expect(JSON.stringify(error)).not.toContain('sensitive-start-detail');
    expect(commands).not.toContainEqual(['compose', 'start', 'postgres']);
  });

  it('fails closed when the proven PostgreSQL container never becomes healthy', async () => {
    const commands: string[][] = [];
    const dependencies = {
      run: vi.fn(async (spec: { args: string[] }) => {
        commands.push(spec.args);
        if (spec.args.includes('config')) {
          return {
            code: 0,
            stdout: mainInfrastructureComposeConfig(),
            stderr: '',
          };
        }
        if (spec.args[0] === 'ps') {
          return {
            code: 0,
            stdout: `${POSTGRES_CONTAINER_ID}\n${REDIS_CONTAINER_ID}\n`,
            stderr: '',
          };
        }
        if (spec.args[0] === 'inspect') {
          return {
            code: 0,
            stdout: JSON.stringify([
              mainInfrastructureInspection('postgres', 'unhealthy'),
              mainInfrastructureInspection('redis', 'healthy'),
            ]),
            stderr: '',
          };
        }
        if (spec.args[0] === 'image' && spec.args[1] === 'inspect') {
          return {
            code: 0,
            stdout: mainInfrastructureImageInspection(),
            stderr: '',
          };
        }
        if (spec.args[0] === 'stop' || spec.args[0] === 'start') {
          return { code: 0, stdout: '', stderr: '' };
        }
        return { code: 0, stdout: '', stderr: '' };
      }),
      sleep: vi.fn(),
      now: () => new Date('2026-07-28T12:00:00.000Z'),
    } as unknown as SystemDependencies;
    const runtime = createIsolatedPreviewStabilityDependencies(dependencies);

    await expect(
      runtime.restartMainService(
        'postgres',
        safePreviewEvolutionIsolationEnvironment(),
      ),
    ).rejects.toMatchObject({
      code: 'PREVIEW_STABILITY_POSTGRES_UNHEALTHY',
      diagnostic: {
        mainInfraStage: 'health',
        service: 'postgres',
        operation: 'restart',
        commandKind: 'discovery',
        errorCode: 'HEALTH_TIMEOUT',
        observedHealth: 'unhealthy',
        expectedHealth: 'healthy',
      },
    });
    expect(
      commands.some((args) => args[0] === 'compose' && args.includes('up')),
    ).toBe(false);
  });

  it('accepts allowlisted captureStage and rejects an invalid one', () => {
    expect(
      parseDatabaseHelperFailureDiagnostic(
        JSON.stringify({
          code: 'PREVIEW_STABILITY_DATABASE_HELPER_FAILED',
          operation: 'capture',
          captureStage: 'migrations',
          captureSubstage: 'diff',
          errorKind: 'DATABASE_BASELINE',
          errorCode: 'DATABASE_BASELINE_DRIFT_CHECK_FAILED',
          failed: true,
        }),
      ),
    ).toEqual({
      code: 'PREVIEW_STABILITY_DATABASE_HELPER_FAILED',
      operation: 'capture',
      captureStage: 'migrations',
      captureSubstage: 'diff',
      errorKind: 'DATABASE_BASELINE',
      errorCode: 'DATABASE_BASELINE_DRIFT_CHECK_FAILED',
      failed: true,
    });
    expect(
      parseDatabaseHelperFailureDiagnostic(
        JSON.stringify({
          code: 'PREVIEW_STABILITY_DATABASE_HELPER_FAILED',
          operation: 'capture',
          captureStage: 'not-allowlisted',
          errorKind: 'UNKNOWN',
          failed: true,
        }),
      ),
    ).toBeNull();
    for (const captureSubstage of [undefined, 'invalid']) {
      expect(
        parseDatabaseHelperFailureDiagnostic(
          JSON.stringify({
            code: 'PREVIEW_STABILITY_DATABASE_HELPER_FAILED',
            operation: 'capture',
            captureStage: 'migrations',
            ...(captureSubstage === undefined ? {} : { captureSubstage }),
            errorKind: 'UNKNOWN',
            failed: true,
          }),
        ),
      ).toBeNull();
    }
    expect(
      parseDatabaseHelperFailureDiagnostic(
        JSON.stringify({
          code: 'PREVIEW_STABILITY_DATABASE_HELPER_FAILED',
          operation: 'capture',
          captureStage: 'settings',
          captureSubstage: 'inspect',
          errorKind: 'UNKNOWN',
          failed: true,
        }),
      ),
    ).toBeNull();
  });

  it('ignores sensitive stderr before a valid capture diagnostic', () => {
    const parsed = parseDatabaseHelperFailureDiagnostic(
      [
        'postgresql://sensitive-user:sensitive-password@host/db Bearer token-secret',
        JSON.stringify({
          code: 'PREVIEW_STABILITY_DATABASE_HELPER_FAILED',
          operation: 'capture',
          captureStage: 'executions',
          errorKind: 'PRISMA_VALIDATION',
          failed: true,
        }),
      ].join('\n'),
    );
    expect(parsed).toEqual({
      code: 'PREVIEW_STABILITY_DATABASE_HELPER_FAILED',
      operation: 'capture',
      captureStage: 'executions',
      errorKind: 'PRISMA_VALIDATION',
      failed: true,
    });
    expect(JSON.stringify(parsed)).not.toMatch(
      /postgresql:\/\/|sensitive|password|Bearer|token-secret/i,
    );
  });
  it.each([
    [true, { paused: true }],
    [
      false,
      {
        paused: false,
        confirmation: 'RETOMAR_AUTOMACAO_COMERCIAL',
      },
    ],
  ] as const)(
    'updates automation paused=%s with local Bearer auth and exact payload',
    async (paused, expectedPayload) => {
      const token = 'local-preview-auth-test-token';
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ paused }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
      const runtime = createIsolatedPreviewStabilityDependencies(
        createInfrastructureRuntimeDependencies(vi.fn()),
      );
      try {
        await expect(
          runtime.setAutomationPaused(paused, {
            ...safePreviewEvolutionIsolationEnvironment(),
            LOCAL_API_AUTH_TOKEN: token,
          }),
        ).resolves.toBeUndefined();
        expect(fetchSpy).toHaveBeenCalledOnce();
        const [url, options] = fetchSpy.mock.calls[0]!;
        expect(String(url)).toMatch(/\/commercial-automation\/settings$/);
        const headers = new Headers(options?.headers);
        expect({
          method: options?.method,
          contentType: headers.get('content-type'),
          authorizationMatches:
            headers.get('authorization') === `Bearer ${token}`,
          body: options?.body,
        }).toEqual({
          method: 'PATCH',
          contentType: 'application/json',
          authorizationMatches: true,
          body: JSON.stringify(expectedPayload),
        });
        expect(String(options?.body)).not.toMatch(
          /postgresql:\/\/|redis:\/\//i,
        );
      } finally {
        fetchSpy.mockRestore();
      }
    },
  );

  it('isolates test environment files and keeps auth failures out of test output', async () => {
    const marker = 'TEST_SECRET_MUST_NEVER_APPEAR';
    const root = mkdtempSync(join(tmpdir(), 'preview-stability-secret-'));
    writeFileSync(join(root, '.env'), `LOCAL_API_AUTH_TOKEN=${marker}\n`);
    const isolatedEnvironment = loadLocalSystemEnvironment(
      root,
      {},
      {
        loadFiles: false,
      },
    );
    expect('LOCAL_API_AUTH_TOKEN' in isolatedEnvironment.env).toBe(false);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error(marker));
    const stdout = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const stderr = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      const runtime = createPreviewStabilityDependencies(
        ROOT,
        createInfrastructureRuntimeDependencies(vi.fn()),
        { loadEnvironmentFiles: false },
      );
      const missingTokenError = await runtime
        .setAutomationPaused(false, safePreviewEvolutionIsolationEnvironment())
        .catch((error: unknown) => error);
      expect(missingTokenError).toMatchObject({
        code: 'PREVIEW_STABILITY_PAUSE_UPDATE_FAILED',
      });
      expect(fetchSpy).not.toHaveBeenCalled();

      const providerError = await runtime
        .setAutomationPaused(false, {
          ...safePreviewEvolutionIsolationEnvironment(),
          LOCAL_API_AUTH_TOKEN: 'local-preview-auth-test-token',
        })
        .catch((error: unknown) => error);
      const observedOutput = [
        JSON.stringify(providerError),
        ...stdout.mock.calls.map(([value]) => String(value)),
        ...stderr.mock.calls.map(([value]) => String(value)),
      ].join('\n');
      expect(observedOutput.includes(marker)).toBe(false);
      expect(providerError).toMatchObject({
        code: 'PREVIEW_STABILITY_PAUSE_UPDATE_FAILED',
      });
      expect(fetchSpy).toHaveBeenCalledOnce();
    } finally {
      fetchSpy.mockRestore();
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails closed without a local API token before issuing the pause request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const runtime = createIsolatedPreviewStabilityDependencies(
      createInfrastructureRuntimeDependencies(vi.fn()),
    );
    try {
      await expect(
        runtime.setAutomationPaused(
          false,
          safePreviewEvolutionIsolationEnvironment(),
        ),
      ).rejects.toMatchObject({
        code: 'PREVIEW_STABILITY_PAUSE_UPDATE_FAILED',
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it.each([401, 403, 404, 409, 500])(
    'keeps pause update fail-closed on HTTP %s without exposing the response',
    async (statusCode) => {
      const token = 'local-preview-auth-test-token';
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(
          new Response('sensitive response body', { status: statusCode }),
        );
      const runtime = createIsolatedPreviewStabilityDependencies(
        createInfrastructureRuntimeDependencies(vi.fn()),
      );
      try {
        const error = await runtime
          .setAutomationPaused(false, {
            ...safePreviewEvolutionIsolationEnvironment(),
            LOCAL_API_AUTH_TOKEN: token,
          })
          .catch((value: unknown) => value);
        expect(error).toMatchObject({
          code: 'PREVIEW_STABILITY_PAUSE_UPDATE_FAILED',
        });
        expect(JSON.stringify(error)).not.toMatch(
          /sensitive response|local-preview-auth-test-token/i,
        );
      } finally {
        fetchSpy.mockRestore();
      }
    },
  );

  it('sanitizes network errors and invalid successful pause responses', async () => {
    const token = 'local-preview-auth-test-token';
    const environment = {
      ...safePreviewEvolutionIsolationEnvironment(),
      LOCAL_API_AUTH_TOKEN: token,
    };
    const runtime = createIsolatedPreviewStabilityDependencies(
      createInfrastructureRuntimeDependencies(vi.fn()),
    );
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(
        new Error(
          'Bearer local-preview-auth-test-token https://sensitive.invalid',
        ),
      )
      .mockResolvedValueOnce(new Response('not-json', { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ paused: true }), { status: 200 }),
      );
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const error = await runtime
          .setAutomationPaused(false, environment)
          .catch((value: unknown) => value);
        expect(error).toMatchObject({
          code: 'PREVIEW_STABILITY_PAUSE_UPDATE_FAILED',
        });
        expect(JSON.stringify(error)).not.toMatch(
          /Bearer|local-preview-auth-test-token|sensitive\.invalid|not-json/i,
        );
      }
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('transports only a validated database-helper diagnostic and preserves the failure code', async () => {
    const diagnostic = JSON.stringify({
      code: 'PREVIEW_STABILITY_DATABASE_HELPER_FAILED',
      operation: 'force-pause',
      errorKind: 'PRISMA',
      errorCode: 'P1001',
      failed: true,
    });
    const run = vi.fn(async () => ({
      code: 1,
      stdout: '',
      stderr: [
        'postgresql://sensitive-user:sensitive-password@host/db Bearer secret-token',
        diagnostic,
      ].join('\n'),
    }));
    const dependencies = createInfrastructureRuntimeDependencies(run);
    const runtime = createIsolatedPreviewStabilityDependencies(dependencies);
    const errorLog = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    try {
      await expect(
        runtime.forceAutomationPaused(
          safePreviewEvolutionIsolationEnvironment(),
        ),
      ).rejects.toMatchObject({
        code: 'PREVIEW_STABILITY_DATABASE_HELPER_FAILED',
      });
      expect(run).toHaveBeenCalledTimes(1);
      expect(errorLog).toHaveBeenCalledTimes(1);
      const logged = String(errorLog.mock.calls[0]![0]);
      expect(JSON.parse(logged)).toEqual({
        event: 'preview-stability.database-helper.failed',
        code: 'PREVIEW_STABILITY_DATABASE_HELPER_FAILED',
        operation: 'force-pause',
        errorKind: 'PRISMA',
        errorCode: 'P1001',
        failed: true,
      });
      expect(logged).not.toMatch(
        /postgresql:\/\/|sensitive|password|Bearer|secret-token/i,
      );
    } finally {
      errorLog.mockRestore();
    }
  });

  it('reuses preflight-proven healthy main infrastructure without Docker commands', async () => {
    const run = vi.fn(async () => {
      throw new Error(
        'Docker must not run when preflight already proved reuse',
      );
    });
    const dependencies = createInfrastructureRuntimeDependencies(run);
    const runtime = createIsolatedPreviewStabilityDependencies(dependencies);

    await expect(
      runtime.prepareMainInfrastructure(
        safePreviewEvolutionIsolationEnvironment(),
        true,
      ),
    ).resolves.toBeUndefined();

    expect(run).not.toHaveBeenCalled();
  });

  it('preserves compose start and health polling when reuse was not proven', async () => {
    const commands: string[][] = [];
    const dependencies = createInfrastructureRuntimeDependencies(
      vi.fn(async (spec: Parameters<SystemDependencies['run']>[0]) => {
        commands.push(spec.args);
        if (spec.args[0] === 'info') {
          return { code: 0, stdout: '', stderr: '' };
        }
        if (spec.args[0] === 'compose' && spec.args[1] === 'up') {
          return { code: 0, stdout: '', stderr: '' };
        }
        if (spec.args[0] === 'compose' && spec.args[1] === 'ps') {
          return {
            code: 0,
            stdout: [
              JSON.stringify({
                Service: 'postgres',
                State: 'running',
                Health: 'healthy',
              }),
              JSON.stringify({
                Service: 'redis',
                State: 'running',
                Health: 'healthy',
              }),
            ].join('\n'),
            stderr: '',
          };
        }
        throw new Error(`unexpected command: ${spec.args.join(' ')}`);
      }),
    );
    const runtime = createIsolatedPreviewStabilityDependencies(dependencies);

    await runtime.prepareMainInfrastructure(
      safePreviewEvolutionIsolationEnvironment(),
      false,
    );

    expect(commands).toContainEqual(['info']);
    expect(commands).toContainEqual([
      'compose',
      'up',
      '-d',
      'postgres',
      'redis',
    ]);
    expect(
      commands.filter((args) => args[0] === 'compose' && args[1] === 'ps'),
    ).toHaveLength(2);
  });

  it.each([
    [
      'PostgreSQL unhealthy',
      (snapshot: SystemStatusSnapshot) => {
        snapshot.docker.services[0]!.health = 'unhealthy';
      },
    ],
    [
      'Redis unhealthy',
      (snapshot: SystemStatusSnapshot) => {
        snapshot.docker.services[1]!.health = 'unhealthy';
      },
    ],
    [
      'ambiguous ownership',
      (snapshot: SystemStatusSnapshot) => {
        snapshot.docker.services.push({
          service: 'postgres',
          state: 'running',
          health: 'healthy',
        });
      },
    ],
  ] satisfies Array<[string, (snapshot: SystemStatusSnapshot) => void]>)(
    'does not mark main infrastructure reusable when %s',
    async (_label, mutate) => {
      const initial = reusableInfrastructurePartialStatus();
      mutate(initial);
      const fake = createFakeDependencies({ initialStatus: initial });

      await expect(
        runPreviewStabilityValidation({
          args: [PREVIEW_STABILITY_CONFIRMATION],
          processEnvironment: {},
          dependencies: fake.dependencies,
        }),
      ).rejects.toMatchObject({
        code: 'PREVIEW_STABILITY_SYSTEM_ALREADY_ACTIVE',
      });
      expect(fake.prepareReuseDecisions).toEqual([]);
    },
  );

  it('keeps external ports blocked before infrastructure preparation', async () => {
    const initial = reusableInfrastructurePartialStatus();
    initial.externalPortOccupants = [
      { port: 3334, processName: 'unexpected-process', pid: 999 },
    ];
    const fake = createFakeDependencies({ initialStatus: initial });

    await expect(
      runPreviewStabilityValidation({
        args: [PREVIEW_STABILITY_CONFIRMATION],
        processEnvironment: {},
        dependencies: fake.dependencies,
      }),
    ).rejects.toMatchObject({
      code: 'PREVIEW_STABILITY_EXTERNAL_PORT_OCCUPIED',
    });
    expect(fake.prepareReuseDecisions).toEqual([]);
  });

  it('captures main infrastructure while explicitly skipping Evolution in safe preview', async () => {
    const commands: string[][] = [];
    const dependencies = createInfrastructureRuntimeDependencies(
      vi.fn(async (spec: Parameters<SystemDependencies['run']>[0]) => {
        commands.push(spec.args);
        if (spec.args.includes('infra/evolution/docker-compose.yml')) {
          throw new Error('Evolution command must not run in safe preview');
        }
        if (spec.args[0] === 'compose') {
          return { code: 0, stdout: mainInfrastructureCapture, stderr: '' };
        }
        if (spec.args[0] === 'volume') {
          return {
            code: 0,
            stdout:
              'afiliado-shopee-main-volume\nshopee-evolution-private-volume\n',
            stderr: '',
          };
        }
        throw new Error(`unexpected command: ${spec.args.join(' ')}`);
      }),
    );
    const runtime = createIsolatedPreviewStabilityDependencies(dependencies);

    const infrastructure = await runtime.captureInfrastructure(
      safePreviewEvolutionIsolationEnvironment(),
    );

    expect(commands).toHaveLength(2);
    expect(commands).toContainEqual([
      'compose',
      'ps',
      '-a',
      '--format',
      'json',
    ]);
    expect(commands).toContainEqual(['volume', 'ls', '--format', '{{.Name}}']);
    expect(commands.flat()).not.toContain('infra/evolution/docker-compose.yml');
    expect(commands.flat()).not.toContain('inspect');
    expect(infrastructure.containers).toMatchObject({
      postgres: 'running',
      evolution: 'not-required',
    });
    expect(infrastructure.volumeCount).toBe(1);
  });

  it.each([
    [
      'missing WhatsApp provider',
      {
        COMMERCIAL_AUTOMATION_MODE: 'preview',
        WHATSAPP_GROUP_SEND_ENABLED: 'false',
      },
    ],
    [
      'non-mock WhatsApp provider',
      {
        COMMERCIAL_AUTOMATION_MODE: 'preview',
        WHATSAPP_PROVIDER: 'evolution',
        WHATSAPP_GROUP_SEND_ENABLED: 'false',
      },
    ],
    [
      'group send enabled',
      {
        COMMERCIAL_AUTOMATION_MODE: 'preview',
        WHATSAPP_PROVIDER: 'mock',
        WHATSAPP_GROUP_SEND_ENABLED: 'true',
      },
    ],
    [
      'non-preview mode',
      {
        COMMERCIAL_AUTOMATION_MODE: 'send',
        WHATSAPP_PROVIDER: 'mock',
        WHATSAPP_GROUP_SEND_ENABLED: 'false',
      },
    ],
  ] satisfies Array<[string, NodeJS.ProcessEnv]>)(
    'does not bypass Evolution capture for %s',
    async (_label, environment) => {
      const commands: string[][] = [];
      const dependencies = createInfrastructureRuntimeDependencies(
        vi.fn(async (spec: Parameters<SystemDependencies['run']>[0]) => {
          commands.push(spec.args);
          if (spec.args.includes('infra/evolution/docker-compose.yml')) {
            return { code: 1, stdout: '', stderr: 'capture failed' };
          }
          if (spec.args[0] === 'compose') {
            return { code: 0, stdout: mainInfrastructureCapture, stderr: '' };
          }
          if (spec.args[0] === 'volume') {
            return {
              code: 0,
              stdout: 'afiliado-shopee-main-volume\n',
              stderr: '',
            };
          }
          throw new Error(`unexpected command: ${spec.args.join(' ')}`);
        }),
      );
      const runtime = createIsolatedPreviewStabilityDependencies(dependencies);

      await expect(
        runtime.captureInfrastructure(environment),
      ).rejects.toMatchObject({
        code: 'PREVIEW_STABILITY_EVOLUTION_CONTAINER_CAPTURE_FAILED',
      });
      expect(
        commands.some((args) =>
          args.includes('infra/evolution/docker-compose.yml'),
        ),
      ).toBe(true);
    },
  );

  it('preserves successful Evolution capture outside isolated preview', async () => {
    const commands: string[][] = [];
    const dependencies = createInfrastructureRuntimeDependencies(
      vi.fn(async (spec: Parameters<SystemDependencies['run']>[0]) => {
        commands.push(spec.args);
        if (spec.args.includes('infra/evolution/docker-compose.yml')) {
          return {
            code: 0,
            stdout: evolutionInfrastructureCapture,
            stderr: '',
          };
        }
        if (spec.args[0] === 'compose') {
          return { code: 0, stdout: mainInfrastructureCapture, stderr: '' };
        }
        if (spec.args[0] === 'volume') {
          return {
            code: 0,
            stdout: 'afiliado-shopee-main-volume\nshopee-evolution-volume\n',
            stderr: '',
          };
        }
        throw new Error(`unexpected command: ${spec.args.join(' ')}`);
      }),
    );
    const runtime = createIsolatedPreviewStabilityDependencies(dependencies);

    const infrastructure = await runtime.captureInfrastructure({
      COMMERCIAL_AUTOMATION_MODE: 'send',
      WHATSAPP_PROVIDER: 'evolution',
      WHATSAPP_GROUP_SEND_ENABLED: 'true',
    });

    expect(
      commands.some((args) =>
        args.includes('infra/evolution/docker-compose.yml'),
      ),
    ).toBe(true);
    expect(infrastructure.containers).toMatchObject({
      postgres: 'running',
      'evolution-api': 'running',
    });
    expect(infrastructure.containers).not.toHaveProperty(
      'evolution',
      'not-required',
    );
    expect(infrastructure.volumeCount).toBe(2);
  });

  it('still fails closed when the main infrastructure capture fails in safe preview', async () => {
    const dependencies = createInfrastructureRuntimeDependencies(
      vi.fn(async (spec: Parameters<SystemDependencies['run']>[0]) => {
        if (spec.args[0] === 'compose') {
          return { code: 1, stdout: '', stderr: 'main failed' };
        }
        if (spec.args[0] === 'volume') {
          return { code: 0, stdout: '', stderr: '' };
        }
        throw new Error(`unexpected command: ${spec.args.join(' ')}`);
      }),
    );
    const runtime = createIsolatedPreviewStabilityDependencies(dependencies);

    await expect(
      runtime.captureInfrastructure(safePreviewEvolutionIsolationEnvironment()),
    ).rejects.toMatchObject({
      code: 'PREVIEW_STABILITY_MAIN_CONTAINER_CAPTURE_FAILED',
    });
  });
  it('rejects infrastructure fingerprints when a Docker capture fails', async () => {
    const dependencies = {
      run: vi.fn(async () => ({ code: 1, stdout: '', stderr: 'sensitive' })),
    } as unknown as SystemDependencies;
    const runtime = createIsolatedPreviewStabilityDependencies(dependencies);
    await expect(runtime.captureInfrastructure({})).rejects.toMatchObject({
      code: 'PREVIEW_STABILITY_MAIN_CONTAINER_CAPTURE_FAILED',
    });
  });
});
