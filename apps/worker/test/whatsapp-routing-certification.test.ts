import { fingerprintWhatsAppGroupId } from '@shopee-auto-affiliate-ai/providers';
import {
  CONTROLLED_E2E_WHATSAPP_DISPATCH_JOB_OPTIONS,
  JOB_NAMES,
} from '@shopee-auto-affiliate-ai/queue';
import type { WhatsAppProvider } from '@shopee-auto-affiliate-ai/providers';
import type { Job } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';

import {
  assertRoutingGroupSnapshot,
  assertNoPreviousRoutingSequence,
  buildRoutingCertificationIds,
  handleRoutingCertificationReplay,
  parseRoutingCertificationArgs,
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
const TECHNICAL_TEST_MESSAGE = 'Mensagem tecnica de teste';

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

const makeJob = (dispatchId: string, jobId: string, instanceName: string) =>
  ({
    id: jobId,
    name: JOB_NAMES.whatsappDispatch,
    data: { dispatchId, instanceName, routingCertification: true },
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

describe('whatsapp routing certification', () => {
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
      const ids = buildRoutingCertificationIds({
        certificationRunId: 'run-test-1',
        sequenceNumber: 4,
        groupFingerprint: selection.groupFingerprint,
        assignmentRevision: selection.assignmentRevision,
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
    const ids = buildRoutingCertificationIds({
      certificationRunId: 'run-test-1',
      sequenceNumber: 5,
      groupFingerprint: selection.groupFingerprint,
      assignmentRevision: selection.assignmentRevision,
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
        message: TECHNICAL_TEST_MESSAGE,
        findJob,
      }),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_ROUTING_PENDING_JOB_MISSING' });
    expect(findJob).toHaveBeenCalledOnce();
  });

  it('reutiliza job deterministico existente para PENDING sem duplicar', async () => {
    const selection = selectRoutingGroup([storedGroup()], GROUP_FINGERPRINT, 0);
    const ids = buildRoutingCertificationIds({
      certificationRunId: 'run-test-1',
      sequenceNumber: 6,
      groupFingerprint: selection.groupFingerprint,
      assignmentRevision: selection.assignmentRevision,
      selectedInstanceName: selection.selectedInstanceName,
    });
    const job = makeJob(
      ids.dispatchId,
      ids.jobId,
      selection.selectedInstanceName,
    );
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
    const ids = buildRoutingCertificationIds({
      certificationRunId: 'run-test-1',
      sequenceNumber: 7,
      groupFingerprint: selection.groupFingerprint,
      assignmentRevision: selection.assignmentRevision,
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
    const ids = buildRoutingCertificationIds({
      certificationRunId: 'run-test-1',
      sequenceNumber: 8,
      groupFingerprint: selection.groupFingerprint,
      assignmentRevision: selection.assignmentRevision + 1,
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
        'Mensagem tecnica de teste',
        ids.dispatchId,
      ),
    ).rejects.toMatchObject({
      code: 'COMMERCIAL_ROUTING_SEQUENCE_ALREADY_USED',
    });
  });

  it('deriva identidades deterministicas e separa sequencias', () => {
    const selection = selectRoutingGroup([storedGroup()], GROUP_FINGERPRINT, 1);
    const first = buildRoutingCertificationIds({
      certificationRunId: 'run-test-1',
      sequenceNumber: 1,
      groupFingerprint: selection.groupFingerprint,
      assignmentRevision: selection.assignmentRevision,
      selectedInstanceName: selection.selectedInstanceName,
    });
    const same = buildRoutingCertificationIds({
      certificationRunId: 'run-test-1',
      sequenceNumber: 1,
      groupFingerprint: selection.groupFingerprint,
      assignmentRevision: selection.assignmentRevision,
      selectedInstanceName: selection.selectedInstanceName,
    });
    const next = buildRoutingCertificationIds({
      certificationRunId: 'run-test-1',
      sequenceNumber: 2,
      groupFingerprint: selection.groupFingerprint,
      assignmentRevision: selection.assignmentRevision,
      selectedInstanceName: selection.selectedInstanceName,
    });
    expect(same).toEqual(first);
    expect(next).not.toEqual(first);
  });

  it('confirma secondary com dispatch sticky e runtime controlado', async () => {
    const selection = selectRoutingGroup([storedGroup()], GROUP_FINGERPRINT, 1);
    const ids = buildRoutingCertificationIds({
      certificationRunId: 'run-test-1',
      sequenceNumber: 1,
      groupFingerprint: selection.groupFingerprint,
      assignmentRevision: selection.assignmentRevision,
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
      enqueue: vi.fn(async (dispatchId, instanceName, jobId) =>
        makeJob(dispatchId, jobId, instanceName),
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
    );
    expect(runtime.enqueue).toHaveBeenCalledWith(
      ids.dispatchId,
      ASSIGNMENTS[1],
      ids.jobId,
    );
  });

  it('replay SENT retorna ALREADY_SENT sem enfileirar ou iniciar worker', async () => {
    const selection = selectRoutingGroup([storedGroup()], GROUP_FINGERPRINT, 0);
    const ids = buildRoutingCertificationIds({
      certificationRunId: 'run-test-1',
      sequenceNumber: 3,
      groupFingerprint: selection.groupFingerprint,
      assignmentRevision: selection.assignmentRevision,
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

  it.each([0, 1] as const)(
    'usa o worker normal e resolve provider mock pelo membro %s',
    async (memberIndex) => {
      const instanceName = ASSIGNMENTS[memberIndex];
      const dispatch = makeDispatch(
        `routing-dispatch-${memberIndex}`,
        `routing-copy-${memberIndex}`,
        instanceName,
      );
      const sendMessage = vi.fn(async () => ({
        status: 'sent' as const,
        externalMessageId: 'mock-secondary-message',
        sentAt: new Date('2026-08-01T12:01:00.000Z'),
      }));
      const provider: WhatsAppProvider = { beginRun: vi.fn(), sendMessage };
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
      } as never;

      const result = await processWhatsAppDispatchJob(
        {
          id: 'routing-job-secondary',
          name: JOB_NAMES.whatsappDispatch,
          data: {
            dispatchId: dispatch.id,
            instanceName,
            routingCertification: true,
          },
          opts: { attempts: 1 },
        },
        {
          repositories,
          whatsAppProvider: provider,
          whatsAppProviderResolver: vi.fn(async (instanceName: string) => {
            expect(instanceName).toBe(ASSIGNMENTS[memberIndex]);
            return provider;
          }),
          groupSendPolicy: new WhatsAppGroupSendPolicy({
            enabled: true,
            safeMode: true,
            instanceName,
          }),
          messageBuilder: () => TECHNICAL_TEST_MESSAGE,
          logger: { info: vi.fn(), error: vi.fn() },
        },
      );

      expect(result).toMatchObject({ status: 'SENT', attemptCount: 1 });
      expect(sendMessage).toHaveBeenCalledOnce();
      expect(sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          destination: GROUP_ID,
          destinationType: 'GROUP',
        }),
      );
      expect(CONTROLLED_E2E_WHATSAPP_DISPATCH_JOB_OPTIONS.attempts).toBe(1);
    },
  );
});
