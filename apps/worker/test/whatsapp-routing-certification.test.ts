import { fingerprintWhatsAppGroupId } from '@shopee-auto-affiliate-ai/providers';
import {
  CONTROLLED_E2E_WHATSAPP_DISPATCH_JOB_OPTIONS,
  JOB_NAMES,
  type RoutingCertificationJobMetadata,
} from '@shopee-auto-affiliate-ai/queue';
import type { WhatsAppProvider } from '@shopee-auto-affiliate-ai/providers';
import type { Job } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';

import {
  assertRoutingGroupSnapshot,
  assertNoPreviousRoutingSequence,
  buildRoutingCertificationIds,
  buildRoutingCertificationMessage,
  createRoutingCertificationGroupDirectoryProvider,
  handleRoutingCertificationReplay,
  parseRoutingCertificationArgs,
  ROUTING_CERTIFICATION_GROUP_DIRECTORY_TIMEOUT_MS,
  runRoutingCertification,
  selectRoutingGroup,
  RoutingCertificationError,
  type RoutingCertificationJob,
  type RoutingCertificationRuntime,
} from '../src/whatsapp-routing-certification';
import { processWhatsAppDispatchJob } from '../src/whatsapp-dispatch-worker';
import { WhatsAppGroupSendPolicy } from '../../api/src/whatsapp-group-send-policy';
import type {
  WhatsAppDispatchDetails,
  WhatsAppGroupRecord,
} from '../../api/src/repositories';

const GROUP_ID = '120363000000000001@g.us';
const GROUP_FINGERPRINT = fingerprintWhatsAppGroupId(GROUP_ID);
const ASSIGNMENTS = ['afiliado-shopee-local', 'afiliado-shopee-secondary'];
const TECHNICAL_TEST_MESSAGE = buildRoutingCertificationMessage(
  'run-test-1',
  1,
);

const metadataFor = (
  memberIndex: 0 | 1,
  sequenceNumber = 1,
  assignmentRevision = 7,
): RoutingCertificationJobMetadata => ({
  version: 'v1',
  certificationRunId: 'run-test-1',
  sequenceNumber,
  memberIndex,
  groupFingerprint: GROUP_FINGERPRINT,
  assignmentRevision,
});

const storedGroup = (
  overrides: Partial<WhatsAppGroupRecord> = {},
): WhatsAppGroupRecord => ({
  id: 'routing-group-1',
  name: 'Grupo de certificacao',
  destination: GROUP_ID,
  type: 'GROUP',
  active: true,
  available: true,
  fingerprint: GROUP_FINGERPRINT,
  sourceInstanceName: ASSIGNMENTS[0],
  assignedInstanceName: ASSIGNMENTS[0],
  assignedInstanceNames: [...ASSIGNMENTS],
  assignmentRevision: 7,
  discoveredAt: new Date('2026-08-01T12:00:00.000Z'),
  lastSyncedAt: new Date('2026-08-01T12:00:00.000Z'),
  createdAt: new Date('2026-08-01T12:00:00.000Z'),
  updatedAt: new Date('2026-08-01T12:00:00.000Z'),
  ...overrides,
});

const baseEnv = {
  NODE_ENV: 'test',
  CI: 'false',
  DATABASE_URL: 'postgresql://localhost:5432/routing-cert-test',
  REDIS_URL: 'redis://localhost:6379/15',
  COMMERCIAL_AUTOMATION_MODE: 'preview',
  COMMERCIAL_AI_COPY_ENABLED: 'false',
  SHOPEE_AFFILIATE_PROVIDER: 'official',
  SHOPEE_AFFILIATE_API_ENABLED: 'true',
  SHOPEE_AFFILIATE_API_URL: 'https://partner.shopeemobile.com',
  SHOPEE_AFFILIATE_APP_ID: 'test-app-id',
  SHOPEE_AFFILIATE_SECRET: 'test-secret',
  WHATSAPP_PROVIDER: 'evolution',
  EVOLUTION_API_URL: 'http://localhost:8080',
  EVOLUTION_API_KEY: 'test-only-key',
  EVOLUTION_INSTANCE_NAME: ASSIGNMENTS[0],
  EVOLUTION_SAFE_MODE: 'true',
  EVOLUTION_ALLOWED_DESTINATIONS: GROUP_ID,
  WHATSAPP_GROUP_SEND_ENABLED: 'true',
  WHATSAPP_GROUP_MAX_MESSAGES_PER_RUN: '1',
  COMMERCIAL_SCHEDULER_ENABLED: 'false',
  SCHEDULER_ENABLED: 'false',
} satisfies NodeJS.ProcessEnv;

const argsFor = (memberIndex: 0 | 1, sequenceNumber = 1, confirmed = false) => [
  `--group-fingerprint=${GROUP_FINGERPRINT}`,
  `--member-index=${memberIndex}`,
  `--certification-run-id=run-test-1`,
  `--sequence-number=${sequenceNumber}`,
  ...(confirmed ? ['--confirm-routing-send'] : []),
];

const preflightFor = vi.fn(async (_config, requested) => ({
  selection: selectRoutingGroup(
    [storedGroup()],
    requested.groupFingerprint,
    requested.memberIndex,
  ),
  selectedInstanceActive: true as const,
  selectedInstancePaused: false as const,
  evolutionInstanceStatus: 'open' as const,
  groupAccessible: true as const,
  allowlisted: true as const,
}));

const readEnvFile = () => '';

const makeJob = (
  dispatchId: string,
  jobId: string,
  routingCertification: RoutingCertificationJobMetadata,
) =>
  ({
    id: jobId,
    name: JOB_NAMES.whatsappDispatch,
    data: { dispatchId, routingCertification },
    opts: { attempts: 1 },
    waitUntilFinished: vi.fn(async () => undefined),
  }) as unknown as RoutingCertificationJob;

const makeDispatch = (
  dispatchId: string,
  copyId: string,
  instanceName: string,
  status: WhatsAppDispatchDetails['status'] = 'PENDING',
): WhatsAppDispatchDetails => ({
  id: dispatchId,
  productId: 'routing-product-db-id',
  generatedCopyId: copyId,
  destinationId: 'routing-group-1',
  instanceName,
  status,
  attemptCount: status === 'SENT' ? 1 : 0,
  externalMessageId: status === 'SENT' ? 'mock-external-id' : null,
  sentAt: status === 'SENT' ? new Date('2026-08-01T12:01:00.000Z') : null,
  errorMessage: null,
  createdAt: new Date('2026-08-01T12:00:00.000Z'),
  updatedAt: new Date('2026-08-01T12:01:00.000Z'),
  destination: {
    id: 'routing-group-1',
    destination: GROUP_ID,
    type: 'GROUP',
    active: true,
    paused: false,
    available: true,
    fingerprint: GROUP_FINGERPRINT,
    sourceInstanceName: ASSIGNMENTS[0],
    assignedInstanceName: ASSIGNMENTS[0],
    assignedInstanceNames: [...ASSIGNMENTS],
    assignmentRevision: 7,
  },
  generatedCopy: {
    id: copyId,
    productId: 'routing-product-db-id',
    snapshotId: null,
    titulo: 'Routing certification technical copy',
    mensagem: TECHNICAL_TEST_MESSAGE,
    cta: '',
    hashtags: '',
    createdFromCandidateId: null,
    source: 'LEGACY_TEMPLATE',
    promptVersion: null,
    validationVersion: null,
  },
});

type RoutingWorkerFixture = {
  metadata: RoutingCertificationJobMetadata;
  ids: ReturnType<typeof buildRoutingCertificationIds>;
  dispatch: WhatsAppDispatchDetails;
  job: {
    id: string;
    name: string;
    data: Record<string, unknown>;
    opts: Record<string, unknown>;
  };
  provider: WhatsAppProvider;
  sendMessage: ReturnType<typeof vi.fn>;
  providerResolver: ReturnType<typeof vi.fn>;
  repositories: Record<string, unknown>;
};

const makeRoutingWorkerFixture = (
  input: {
    memberIndex?: 0 | 1;
    sequenceNumber?: number;
    assignmentRevision?: number;
    jobAttempts?: number | 'missing';
    jobId?: string;
    jobData?: Record<string, unknown>;
    mutateDispatch?: (dispatch: WhatsAppDispatchDetails) => void;
  } = {},
): RoutingWorkerFixture => {
  const memberIndex = input.memberIndex ?? 0;
  const metadata = metadataFor(
    memberIndex,
    input.sequenceNumber ?? 1,
    input.assignmentRevision ?? 7,
  );
  const instanceName = ASSIGNMENTS[memberIndex];
  const ids = buildRoutingCertificationIds({
    ...metadata,
    selectedInstanceName: instanceName,
  });
  const dispatch = makeDispatch(ids.dispatchId, ids.copyId, instanceName);
  input.mutateDispatch?.(dispatch);
  const sendMessage = vi.fn(async () => ({
    status: 'sent' as const,
    externalMessageId: 'routing-worker-message',
    sentAt: new Date('2026-08-01T12:01:00.000Z'),
  }));
  const provider: WhatsAppProvider = { beginRun: vi.fn(), sendMessage };
  const providerResolver = vi.fn(async (resolvedInstanceName: string) => {
    if (resolvedInstanceName !== instanceName) {
      throw new Error(`unexpected instance ${resolvedInstanceName}`);
    }
    return provider;
  });
  const dispatches = {
    findByIdWithDetails: vi.fn(async () => dispatch),
    findByIdForSending: vi.fn(async () => dispatch),
    claimPendingForSending: vi.fn(async () => ({
      kind: 'CLAIMED' as const,
    })),
    markSent: vi.fn(async () => ({
      ...dispatch,
      status: 'SENT' as const,
      attemptCount: 1,
    })),
    markFailed: vi.fn(),
    markAttemptPending: vi.fn(),
    createPending: vi.fn(),
    list: vi.fn(),
  };
  const repositories = {
    whatsappDispatches: dispatches,
    commercialRuns: {
      findByDispatchId: vi.fn(async () => null),
      finalizeByDispatchId: vi.fn(async () => null),
    },
    whatsappInstances: {
      findByName: vi.fn(async (name: string) => ({
        name,
        active: true,
        paused: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    },
    products: {
      findById: vi.fn(async () => ({
        providerProductId: ids.providerProductId,
        nome: 'Routing certification technical product',
        title: 'Routing certification technical product',
        categoria: 'ROUTING CERTIFICATION',
        loja: 'ROUTING CERTIFICATION',
      })),
    },
  };
  const jobData = {
    dispatchId: dispatch.id,
    routingCertification: metadata,
    ...input.jobData,
  };
  const job = {
    id: input.jobId ?? ids.jobId,
    name: JOB_NAMES.whatsappDispatch,
    data: jobData,
    opts:
      input.jobAttempts === 'missing'
        ? {}
        : { attempts: input.jobAttempts ?? 1 },
  };
  return {
    metadata,
    ids,
    dispatch,
    job,
    provider,
    sendMessage,
    providerResolver,
    repositories,
  };
};

const processRoutingWorkerFixture = (fixture: RoutingWorkerFixture) =>
  processWhatsAppDispatchJob(fixture.job as never, {
    repositories: fixture.repositories as never,
    whatsAppProvider: fixture.provider,
    whatsAppProviderResolver: fixture.providerResolver,
    groupSendPolicy: new WhatsAppGroupSendPolicy({
      enabled: true,
      safeMode: true,
      instanceName: ASSIGNMENTS[fixture.metadata.memberIndex],
    }),
    messageBuilder: () => TECHNICAL_TEST_MESSAGE,
    logger: { info: vi.fn(), error: vi.fn() },
  });

describe('whatsapp routing certification', () => {
  it('usa timeout de diretório limitado e aceita resposta válida dentro dele', async () => {
    expect(ROUTING_CERTIFICATION_GROUP_DIRECTORY_TIMEOUT_MS).toBe(45_000);
    expect(
      ROUTING_CERTIFICATION_GROUP_DIRECTORY_TIMEOUT_MS,
    ).toBeLessThanOrEqual(45_000);

    const httpClient = vi.fn(
      async () =>
        new Response(
          JSON.stringify([
            { id: GROUP_ID, subject: 'Grupo de certificacao', size: 2 },
          ]),
          { status: 200 },
        ),
    );
    const provider = createRoutingCertificationGroupDirectoryProvider(
      {
        EVOLUTION_API_URL: 'http://localhost:8080',
        EVOLUTION_API_KEY: 'test-only-key',
      },
      ASSIGNMENTS[1],
      { httpClient },
    );

    await expect(provider.listGroups()).resolves.toEqual([
      {
        externalGroupId: GROUP_ID,
        name: 'Grupo de certificacao',
        memberCount: 2,
      },
    ]);
    expect(httpClient).toHaveBeenCalledTimes(1);
  });

  it('continua falhando fechado quando o diretório excede o timeout configurado', async () => {
    vi.useFakeTimers();
    try {
      const httpClient = vi.fn(
        (_input: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new Error('aborted')),
            );
          }),
      );
      const provider = createRoutingCertificationGroupDirectoryProvider(
        {
          EVOLUTION_API_URL: 'http://localhost:8080',
          EVOLUTION_API_KEY: 'test-only-key',
        },
        ASSIGNMENTS[1],
        { httpClient },
      );
      const pending = provider.listGroups();
      const timedOut = expect(pending).rejects.toMatchObject({
        code: 'EVOLUTION_GROUPS_TIMEOUT',
      });

      await vi.advanceTimersByTimeAsync(
        ROUTING_CERTIFICATION_GROUP_DIRECTORY_TIMEOUT_MS - 1,
      );
      await vi.advanceTimersByTimeAsync(1);

      await timedOut;
    } finally {
      vi.useRealTimers();
    }
  });

  it('exige fingerprint, indice, run id e sequencia seguros', () => {
    expect(parseRoutingCertificationArgs(argsFor(0))).toMatchObject({
      mode: 'dry-run',
      memberIndex: 0,
      sequenceNumber: 1,
    });
    expect(
      parseRoutingCertificationArgs(['--', ...argsFor(1, 2, true)]),
    ).toMatchObject({ mode: 'confirmed', memberIndex: 1, sequenceNumber: 2 });
    expect(() =>
      parseRoutingCertificationArgs([...argsFor(0), '--member-index=2']),
    ).toThrowError(
      expect.objectContaining({
        code: 'WHATSAPP_ROUTING_CERTIFICATION_ARGUMENTS_INVALID',
      }),
    );
    expect(() =>
      parseRoutingCertificationArgs([
        ...argsFor(0),
        '--instance-name=afiliado-shopee-secondary',
      ]),
    ).toThrowError(
      expect.objectContaining({
        code: 'WHATSAPP_ROUTING_CERTIFICATION_ARGUMENTS_INVALID',
      }),
    );
  });

  it.each([
    [0, ASSIGNMENTS[0]],
    [1, ASSIGNMENTS[1]],
  ] as const)(
    'resolve dry-run member index %s pela lista ordenada',
    async (memberIndex, instanceName) => {
      const result = await runRoutingCertification({
        args: argsFor(memberIndex),
        env: baseEnv,
        readEnvFile,
        preflight: preflightFor,
        logger: { info: vi.fn(), error: vi.fn() },
      });

      expect(result.exitCode).toBe(0);
      expect(result.output).toMatchObject({
        mode: 'dry-run',
        memberIndex,
        selectedInstanceName: instanceName,
        assignmentRevision: 7,
        messageWillBeSent: false,
      });
    },
  );

  it('bloqueia grupo ausente, assignment unassigned e revision alterada', () => {
    expect(() => selectRoutingGroup([], GROUP_FINGERPRINT, 0)).toThrowError(
      expect.objectContaining({ code: 'COMMERCIAL_ROUTING_GROUP_NOT_FOUND' }),
    );
    expect(() =>
      selectRoutingGroup(
        [storedGroup({ assignedInstanceNames: ['afiliado-shopee-local'] })],
        GROUP_FINGERPRINT,
        0,
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'COMMERCIAL_INSTANCE_ASSIGNMENT_INVALID',
      }),
    );

    const selection = selectRoutingGroup([storedGroup()], GROUP_FINGERPRINT, 1);
    expect(() =>
      assertRoutingGroupSnapshot(
        selection,
        storedGroup({ assignmentRevision: selection.assignmentRevision + 1 }),
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'COMMERCIAL_INSTANCE_ASSIGNMENT_CHANGED',
      }),
    );
  });

  it('mantem a alternancia pela ordem persistida dos assignments', () => {
    const selectedInstances = ([0, 1, 0, 1, 0, 1] as const).map(
      (memberIndex) =>
        selectRoutingGroup([storedGroup()], GROUP_FINGERPRINT, memberIndex)
          .selectedInstanceName,
    );

    expect(selectedInstances).toEqual([
      ASSIGNMENTS[0],
      ASSIGNMENTS[1],
      ASSIGNMENTS[0],
      ASSIGNMENTS[1],
      ASSIGNMENTS[0],
      ASSIGNMENTS[1],
    ]);
  });

  it.each([
    [
      'COMMERCIAL_INSTANCE_NOT_OPEN',
      'Instancia selecionada nao esta OPEN na Evolution',
    ],
    [
      'COMMERCIAL_ROUTING_GROUP_NOT_ACCESSIBLE',
      'Grupo selecionado nao esta acessivel pela instancia escolhida',
    ],
  ] as const)(
    'bloqueia preflight inseguro antes de criar runtime: %s',
    async (code, message) => {
      const runtimeFactory = vi.fn();
      const selection = selectRoutingGroup(
        [storedGroup()],
        GROUP_FINGERPRINT,
        1,
      );
      const result = await runRoutingCertification({
        args: argsFor(1, 6, true),
        env: { ...baseEnv, COMMERCIAL_AUTOMATION_MODE: 'send' },
        readEnvFile,
        preflight: async () => {
          throw new RoutingCertificationError(message, code, {
            groupFingerprint: GROUP_FINGERPRINT,
            memberIndex: 1,
          });
        },
        runtimeFactory,
        logger: { info: vi.fn(), error: vi.fn() },
      });

      expect(result.exitCode).toBe(1);
      expect(result.output).toMatchObject({ code });
      expect(runtimeFactory).not.toHaveBeenCalled();
      expect(selection.selectedInstanceName).toBe(ASSIGNMENTS[1]);
    },
  );

  it.each(['PROCESSING', 'FAILED'] as const)(
    'bloqueia replay %s sem consultar job ou provider',
    async (status) => {
      const selection = selectRoutingGroup(
        [storedGroup()],
        GROUP_FINGERPRINT,
        0,
      );
      const routingCertification = metadataFor(0, 4);
      const ids = buildRoutingCertificationIds({
        ...routingCertification,
        selectedInstanceName: selection.selectedInstanceName,
      });
      const findJob = vi.fn();

      await expect(
        handleRoutingCertificationReplay({
          dispatch: makeDispatch(
            ids.dispatchId,
            ids.copyId,
            selection.selectedInstanceName,
            status,
          ),
          selection,
          ids,
          routingCertification,
          message: TECHNICAL_TEST_MESSAGE,
          findJob,
        }),
      ).rejects.toMatchObject({
        code:
          status === 'PROCESSING'
            ? 'COMMERCIAL_ROUTING_REPLAY_PROCESSING'
            : 'COMMERCIAL_ROUTING_REPLAY_FAILED',
      });
      expect(findJob).not.toHaveBeenCalled();
    },
  );

  it('bloqueia PENDING sem job deterministico em vez de reenfileirar', async () => {
    const selection = selectRoutingGroup([storedGroup()], GROUP_FINGERPRINT, 0);
    const routingCertification = metadataFor(0, 5);
    const ids = buildRoutingCertificationIds({
      ...routingCertification,
      selectedInstanceName: selection.selectedInstanceName,
    });
    const findJob = vi.fn(async () => null);

    await expect(
      handleRoutingCertificationReplay({
        dispatch: makeDispatch(
          ids.dispatchId,
          ids.copyId,
          selection.selectedInstanceName,
          'PENDING',
        ),
        selection,
        ids,
        routingCertification,
        message: TECHNICAL_TEST_MESSAGE,
        findJob,
      }),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_ROUTING_PENDING_JOB_MISSING' });
    expect(findJob).toHaveBeenCalledOnce();
  });

  it('reutiliza job deterministico existente para PENDING sem duplicar', async () => {
    const selection = selectRoutingGroup([storedGroup()], GROUP_FINGERPRINT, 0);
    const routingCertification = metadataFor(0, 6);
    const ids = buildRoutingCertificationIds({
      ...routingCertification,
      selectedInstanceName: selection.selectedInstanceName,
    });
    const job = makeJob(ids.dispatchId, ids.jobId, routingCertification);
    const findJob = vi.fn(async () => job);

    const replay = await handleRoutingCertificationReplay({
      dispatch: makeDispatch(
        ids.dispatchId,
        ids.copyId,
        selection.selectedInstanceName,
        'PENDING',
      ),
      selection,
      ids,
      routingCertification,
      message: TECHNICAL_TEST_MESSAGE,
      findJob,
    });

    expect(replay).toMatchObject({
      outcome: 'READY',
      replayed: true,
      job,
    });
    expect(findJob).toHaveBeenCalledOnce();
  });

  it('bloqueia replay de estado ambiguo desconhecido sem consultar job', async () => {
    const selection = selectRoutingGroup([storedGroup()], GROUP_FINGERPRINT, 0);
    const routingCertification = metadataFor(0, 7);
    const ids = buildRoutingCertificationIds({
      ...routingCertification,
      selectedInstanceName: selection.selectedInstanceName,
    });
    const findJob = vi.fn();
    const ambiguous = makeDispatch(
      ids.dispatchId,
      ids.copyId,
      selection.selectedInstanceName,
      'PENDING',
    );
    ambiguous.status = 'AMBIGUOUS' as WhatsAppDispatchDetails['status'];

    await expect(
      handleRoutingCertificationReplay({
        dispatch: ambiguous,
        selection,
        ids,
        routingCertification,
        message: TECHNICAL_TEST_MESSAGE,
        findJob,
      }),
    ).rejects.toMatchObject({
      code: 'COMMERCIAL_ROUTING_REPLAY_STATE_INVALID',
    });
    expect(findJob).not.toHaveBeenCalled();
  });

  it('nao reutiliza a mesma sequencia quando a revision muda', async () => {
    const selection = selectRoutingGroup([storedGroup()], GROUP_FINGERPRINT, 0);
    const routingCertification = metadataFor(
      0,
      8,
      selection.assignmentRevision + 1,
    );
    const ids = buildRoutingCertificationIds({
      ...routingCertification,
      selectedInstanceName: selection.selectedInstanceName,
    });

    await expect(
      assertNoPreviousRoutingSequence(
        {
          whatsappDispatches: {
            list: vi.fn(async () => [
              makeDispatch(
                'previous-contract-dispatch',
                'previous-contract-copy',
                selection.selectedInstanceName,
                'SENT',
              ),
            ]),
          },
        } as never,
        TECHNICAL_TEST_MESSAGE,
        ids.dispatchId,
      ),
    ).rejects.toMatchObject({
      code: 'COMMERCIAL_ROUTING_SEQUENCE_ALREADY_USED',
    });
  });

  it('deriva identidades deterministicas e separa sequencias', () => {
    const selection = selectRoutingGroup([storedGroup()], GROUP_FINGERPRINT, 1);
    const firstMetadata = metadataFor(1, 1);
    const first = buildRoutingCertificationIds({
      ...firstMetadata,
      selectedInstanceName: selection.selectedInstanceName,
    });
    const same = buildRoutingCertificationIds({
      ...firstMetadata,
      selectedInstanceName: selection.selectedInstanceName,
    });
    const nextMetadata = metadataFor(1, 2);
    const next = buildRoutingCertificationIds({
      ...nextMetadata,
      selectedInstanceName: selection.selectedInstanceName,
    });
    expect(same).toEqual(first);
    expect(next).not.toEqual(first);
  });

  it('confirma secondary com dispatch sticky e runtime controlado', async () => {
    const selection = selectRoutingGroup([storedGroup()], GROUP_FINGERPRINT, 1);
    const routingCertification = metadataFor(1, 1);
    const ids = buildRoutingCertificationIds({
      ...routingCertification,
      selectedInstanceName: selection.selectedInstanceName,
    });
    const dispatch = makeDispatch(
      ids.dispatchId,
      ids.copyId,
      selection.selectedInstanceName,
      'SENT',
    );
    const runtime: RoutingCertificationRuntime = {
      assertNoCompetingWork: vi.fn(async () => undefined),
      prepare: vi.fn(async () => ({
        dispatchId: ids.dispatchId,
        outcome: 'READY' as const,
        replayed: false,
      })),
      enqueue: vi.fn(async (dispatchId, metadata, jobId) =>
        makeJob(dispatchId, jobId, metadata),
      ),
      startWorker: vi.fn(async () => undefined),
      waitForJob: vi.fn(async () => undefined),
      readDispatch: vi.fn(async () => dispatch),
      close: vi.fn(async () => undefined),
    };
    const result = await runRoutingCertification({
      args: argsFor(1, 1, true),
      env: { ...baseEnv, COMMERCIAL_AUTOMATION_MODE: 'send' },
      readEnvFile,
      preflight: async () => ({
        selection,
        selectedInstanceActive: true,
        selectedInstancePaused: false,
        evolutionInstanceStatus: 'open',
        groupAccessible: true,
        allowlisted: true,
      }),
      runtimeFactory: async () => runtime,
      logger: { info: vi.fn(), error: vi.fn() },
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toMatchObject({
      status: 'SENT',
      selectedInstanceName: ASSIGNMENTS[1],
      attemptCount: 1,
      messagesSent: 1,
    });
    expect(runtime.prepare).toHaveBeenCalledWith(
      expect.objectContaining({ selectedInstanceName: ASSIGNMENTS[1] }),
      expect.objectContaining({ dispatchId: ids.dispatchId }),
      expect.any(String),
      routingCertification,
    );
    expect(runtime.enqueue).toHaveBeenCalledWith(
      ids.dispatchId,
      routingCertification,
      ids.jobId,
    );
  });

  it('replay SENT retorna ALREADY_SENT sem enfileirar ou iniciar worker', async () => {
    const selection = selectRoutingGroup([storedGroup()], GROUP_FINGERPRINT, 0);
    const routingCertification = metadataFor(0, 3);
    const ids = buildRoutingCertificationIds({
      ...routingCertification,
      selectedInstanceName: selection.selectedInstanceName,
    });
    const runtime: RoutingCertificationRuntime = {
      assertNoCompetingWork: vi.fn(async () => undefined),
      prepare: vi.fn(async () => ({
        dispatchId: ids.dispatchId,
        outcome: 'ALREADY_SENT' as const,
        replayed: true,
      })),
      enqueue: vi.fn(),
      startWorker: vi.fn(),
      waitForJob: vi.fn(),
      readDispatch: vi.fn(async () =>
        makeDispatch(
          ids.dispatchId,
          ids.copyId,
          selection.selectedInstanceName,
          'SENT',
        ),
      ),
      close: vi.fn(async () => undefined),
    };
    const result = await runRoutingCertification({
      args: argsFor(0, 3, true),
      env: { ...baseEnv, COMMERCIAL_AUTOMATION_MODE: 'send' },
      readEnvFile,
      preflight: async () => ({
        selection,
        selectedInstanceActive: true,
        selectedInstancePaused: false,
        evolutionInstanceStatus: 'open',
        groupAccessible: true,
        allowlisted: true,
      }),
      runtimeFactory: async () => runtime,
      logger: { info: vi.fn(), error: vi.fn() },
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toMatchObject({
      status: 'ALREADY_SENT',
      replayed: true,
    });
    expect(runtime.enqueue).not.toHaveBeenCalled();
    expect(runtime.startWorker).not.toHaveBeenCalled();
  });

  it.each([
    ['attempts=3', 3],
    ['attempts ausente', 'missing'],
  ] as const)(
    'bloqueia routing certification com politica BullMQ invalida: %s',
    async (_label, jobAttempts) => {
      const fixture = makeRoutingWorkerFixture({ jobAttempts });

      await expect(processRoutingWorkerFixture(fixture)).rejects.toMatchObject({
        code: 'COMMERCIAL_ROUTING_ATTEMPTS_INVALID',
      });
      expect(fixture.providerResolver).not.toHaveBeenCalled();
      expect(fixture.sendMessage).not.toHaveBeenCalled();
    },
  );

  it('bloqueia metadata incompleta antes de consultar o provider', async () => {
    const fixture = makeRoutingWorkerFixture({
      jobData: { routingCertification: { version: 'v1' } },
    });

    await expect(processRoutingWorkerFixture(fixture)).rejects.toMatchObject({
      code: 'COMMERCIAL_ROUTING_JOB_CONTRACT_INVALID',
    });
    expect(fixture.providerResolver).not.toHaveBeenCalled();
    expect(fixture.sendMessage).not.toHaveBeenCalled();
  });

  it('nao aceita booleano ou instanceName como fronteira de routing', async () => {
    const fixture = makeRoutingWorkerFixture({
      jobData: {
        instanceName: ASSIGNMENTS[1],
        routingCertification: true,
      },
    });

    await expect(processRoutingWorkerFixture(fixture)).rejects.toMatchObject({
      code: 'COMMERCIAL_ROUTING_JOB_CONTRACT_INVALID',
    });
    expect(fixture.providerResolver).not.toHaveBeenCalled();
    expect(fixture.sendMessage).not.toHaveBeenCalled();
  });

  it('nao confia em instanceName adicional quando a metadata parece valida', async () => {
    const fixture = makeRoutingWorkerFixture();
    fixture.job.data.instanceName = ASSIGNMENTS[1];

    await expect(processRoutingWorkerFixture(fixture)).rejects.toMatchObject({
      code: 'COMMERCIAL_ROUTING_JOB_CONTRACT_INVALID',
    });
    expect(fixture.providerResolver).not.toHaveBeenCalled();
    expect(fixture.sendMessage).not.toHaveBeenCalled();
  });

  it.each([
    [
      'job id divergente',
      (fixture: RoutingWorkerFixture) => {
        fixture.job.id = 'forged-routing-job';
      },
    ],
    [
      'dispatch id divergente',
      (fixture: RoutingWorkerFixture) => {
        fixture.job.data.dispatchId = 'forged-routing-dispatch';
      },
    ],
  ] as const)(
    'bloqueia identidade deterministica divergente: %s',
    async (_label, mutate) => {
      const fixture = makeRoutingWorkerFixture();
      mutate(fixture);

      await expect(processRoutingWorkerFixture(fixture)).rejects.toMatchObject({
        code: 'COMMERCIAL_ROUTING_CONTRACT_MISMATCH',
      });
      expect(fixture.providerResolver).not.toHaveBeenCalled();
      expect(fixture.sendMessage).not.toHaveBeenCalled();
    },
  );

  it('bloqueia assignmentRevision alterada mesmo mantendo os dois membros', async () => {
    const fixture = makeRoutingWorkerFixture({
      mutateDispatch: (dispatch) => {
        dispatch.destination.assignmentRevision = 8;
      },
    });

    await expect(processRoutingWorkerFixture(fixture)).rejects.toMatchObject({
      code: 'COMMERCIAL_ROUTING_CONTRACT_MISMATCH',
    });
    expect(fixture.providerResolver).not.toHaveBeenCalled();
    expect(fixture.sendMessage).not.toHaveBeenCalled();
  });

  it('bloqueia membro divergente do assignment derivado', async () => {
    const fixture = makeRoutingWorkerFixture({
      memberIndex: 0,
      mutateDispatch: (dispatch) => {
        dispatch.instanceName = ASSIGNMENTS[1];
      },
    });

    await expect(processRoutingWorkerFixture(fixture)).rejects.toMatchObject({
      code: 'COMMERCIAL_ROUTING_CONTRACT_MISMATCH',
    });
    expect(fixture.providerResolver).not.toHaveBeenCalled();
    expect(fixture.sendMessage).not.toHaveBeenCalled();
  });

  it('bloqueia copy comercial com candidate de origem', async () => {
    const fixture = makeRoutingWorkerFixture({
      mutateDispatch: (dispatch) => {
        dispatch.generatedCopy.createdFromCandidateId = 'commercial-candidate';
      },
    });

    await expect(processRoutingWorkerFixture(fixture)).rejects.toMatchObject({
      code: 'COMMERCIAL_ROUTING_CONTRACT_MISMATCH',
    });
    expect(fixture.providerResolver).not.toHaveBeenCalled();
    expect(fixture.sendMessage).not.toHaveBeenCalled();
  });

  it('bloqueia copy tecnica adulterada antes do provider', async () => {
    const fixture = makeRoutingWorkerFixture({
      mutateDispatch: (dispatch) => {
        dispatch.generatedCopy.titulo = 'Commercial copy';
      },
    });

    await expect(processRoutingWorkerFixture(fixture)).rejects.toMatchObject({
      code: 'COMMERCIAL_ROUTING_CONTRACT_MISMATCH',
    });
    expect(fixture.providerResolver).not.toHaveBeenCalled();
    expect(fixture.sendMessage).not.toHaveBeenCalled();
  });

  it.each([0, 1] as const)(
    'usa o worker normal e resolve provider mock pelo membro %s',
    async (memberIndex) => {
      const fixture = makeRoutingWorkerFixture({ memberIndex });

      const result = await processWhatsAppDispatchJob(fixture.job as never, {
        repositories: fixture.repositories as never,
        whatsAppProvider: fixture.provider,
        whatsAppProviderResolver: fixture.providerResolver,
        groupSendPolicy: new WhatsAppGroupSendPolicy({
          enabled: true,
          safeMode: true,
          instanceName: ASSIGNMENTS[memberIndex],
        }),
        messageBuilder: () => TECHNICAL_TEST_MESSAGE,
        logger: { info: vi.fn(), error: vi.fn() },
      });

      expect(result).toMatchObject({ status: 'SENT', attemptCount: 1 });
      expect(fixture.sendMessage).toHaveBeenCalledOnce();
      expect(fixture.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          destination: GROUP_ID,
          destinationType: 'GROUP',
        }),
      );
      expect(CONTROLLED_E2E_WHATSAPP_DISPATCH_JOB_OPTIONS.attempts).toBe(1);
    },
  );
});
