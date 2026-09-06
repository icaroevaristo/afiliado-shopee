import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fingerprintWhatsAppGroupId } from '@shopee-auto-affiliate-ai/providers';

import type {
  WhatsAppDispatchDetails,
  WhatsAppGroupRecord,
} from '../../api/src/repositories';
import {
  CONTROLLED_GROUP_TEST_JOB_OPTIONS,
  runWhatsAppGroupTest,
  validateWhatsAppGroupTestArgs,
  WHATSAPP_GROUP_TEST_IDS,
  WHATSAPP_GROUP_TEST_MESSAGE,
  WHATSAPP_GROUP_TEST_REAL_FLAG,
  type WhatsAppGroupTestPreflight,
  type WhatsAppGroupTestRuntime,
} from '../src/whatsapp-group-test';

const GROUP_ID = '100000000000000000@g.us';
const FINGERPRINT = fingerprintWhatsAppGroupId(GROUP_ID);

const baseEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379',
  WHATSAPP_PROVIDER: 'evolution',
  EVOLUTION_API_URL: 'http://localhost:8080',
  EVOLUTION_API_KEY: 'test-only-key',
  EVOLUTION_INSTANCE_NAME: 'afiliado-shopee-local',
  EVOLUTION_SAFE_MODE: 'true',
  EVOLUTION_ALLOWED_DESTINATIONS: '',
  EVOLUTION_MAX_MESSAGES_PER_BOOT: '1',
  WHATSAPP_GROUP_SEND_ENABLED: 'false',
  WHATSAPP_GROUP_MAX_MESSAGES_PER_RUN: '1',
  SCHEDULER_ENABLED: 'false',
} satisfies NodeJS.ProcessEnv;

const storedGroup = (
  overrides: Partial<WhatsAppGroupRecord> = {},
): WhatsAppGroupRecord => ({
  id: 'stored-group-1',
  name: 'Grupo controlado',
  destination: GROUP_ID,
  type: 'GROUP',
  active: true,
  available: true,
  fingerprint: FINGERPRINT,
  sourceInstanceName: 'afiliado-shopee-local',
  memberCount: 2,
  ownerIsParticipant: null,
  discoveredAt: new Date('2026-07-24T12:00:00.000Z'),
  lastSyncedAt: new Date('2026-07-24T12:00:00.000Z'),
  createdAt: new Date('2026-07-24T12:00:00.000Z'),
  updatedAt: new Date('2026-07-24T12:00:00.000Z'),
  ...overrides,
});

const preflight = (
  groups: WhatsAppGroupRecord[] = [storedGroup()],
  remoteIds: string[] = [GROUP_ID],
): WhatsAppGroupTestPreflight => ({
  databaseAvailable: true,
  redisAvailable: true,
  evolutionAvailable: true,
  evolutionVersion: '2.3.7',
  instanceStatus: 'open',
  discoveredGroupCount: remoteIds.length,
  storedGroups: groups,
  remoteExternalGroupIds: new Set(remoteIds),
});

const run = (overrides: Parameters<typeof runWhatsAppGroupTest>[0] = {}) =>
  runWhatsAppGroupTest({
    args: [],
    env: baseEnv,
    readEnvFile: () => '',
    preflight: vi.fn(async () => preflight()),
    logger: { info: vi.fn(), error: vi.fn() },
    ...overrides,
  });

describe('whatsapp:group-test argumentos e dry-run', () => {
  it('aceita apenas dry-run ou a flag exata direta/encaminhada', () => {
    expect(validateWhatsAppGroupTestArgs([])).toBe('dry-run');
    expect(validateWhatsAppGroupTestArgs([WHATSAPP_GROUP_TEST_REAL_FLAG])).toBe(
      'confirmed',
    );
    expect(
      validateWhatsAppGroupTestArgs(['--', WHATSAPP_GROUP_TEST_REAL_FLAG]),
    ).toBe('confirmed');
  });

  it.each([
    ['--confirm-one-real-group'],
    ['--confirm-one-real-group-message-extra'],
    ['--group-id', GROUP_ID],
    ['--group-name', 'Grupo'],
    ['--message', 'custom'],
    ['--', '--', WHATSAPP_GROUP_TEST_REAL_FLAG],
  ])('bloqueia flag similar ou argumento customizado: %s', (...args) => {
    expect(() => validateWhatsAppGroupTestArgs(args)).toThrow();
  });

  it('dry-run nao cria runtime, fila, worker, dispatch ou envio', async () => {
    const runtimeFactory = vi.fn();
    const result = await run({ runtimeFactory });
    expect(result.exitCode).toBe(0);
    expect(result.output).toMatchObject({
      mode: 'dry-run',
      masterSwitchEnabled: false,
      activeAvailableGroupCount: 1,
      readyForRealSend: false,
      messageWillBeSent: false,
      group: { name: 'Grupo controlado', fingerprint: FINGERPRINT },
    });
    expect(runtimeFactory).not.toHaveBeenCalled();
  });

  it.each([
    [[], [GROUP_ID], 0],
    [[storedGroup({ available: false })], [GROUP_ID], 0],
    [
      [
        storedGroup(),
        storedGroup({
          id: 'stored-group-2',
          destination: '200000000000000000@g.us',
          fingerprint: fingerprintWhatsAppGroupId('200000000000000000@g.us'),
        }),
      ],
      [GROUP_ID, '200000000000000000@g.us'],
      2,
    ],
    [[storedGroup()], [], 0],
  ] as const)(
    'reporta estado nao pronto sem enviar',
    async (groups, remoteIds, count) => {
      const result = await run({
        preflight: vi.fn(async () => preflight([...groups], [...remoteIds])),
      });
      expect(result.output).toMatchObject({
        mode: 'dry-run',
        activeAvailableGroupCount: count,
        readyForRealSend: false,
        messageWillBeSent: false,
      });
    },
  );

  it('bloqueia CI antes do preflight', async () => {
    const preflightMock = vi.fn();
    const result = await run({
      env: { ...baseEnv, CI: 'true' },
      preflight: preflightMock,
    });
    expect(result).toMatchObject({
      exitCode: 1,
      output: { code: 'WHATSAPP_GROUP_TEST_CI_BLOCKED' },
    });
    expect(preflightMock).not.toHaveBeenCalled();
  });

  it.each([
    [{ WHATSAPP_PROVIDER: 'mock' }, 'WHATSAPP_GROUP_TEST_PROVIDER_REQUIRED'],
    [
      { EVOLUTION_SAFE_MODE: 'false' },
      'WHATSAPP_GROUP_TEST_SAFE_MODE_REQUIRED',
    ],
    [
      {
        SCHEDULER_ENABLED: 'true',
        SCHEDULER_CRON: '0 8 * * *',
        SCHEDULER_TIMEZONE: 'America/Sao_Paulo',
      },
      'WHATSAPP_GROUP_TEST_SCHEDULER_BLOCKED',
    ],
    [
      { WHATSAPP_GROUP_MAX_MESSAGES_PER_RUN: '2' },
      'WHATSAPP_GROUP_TEST_LIMIT_INVALID',
    ],
  ])('bloqueia configuracao insegura sem preflight', async (env, code) => {
    const preflightMock = vi.fn();
    const result = await run({
      env: { ...baseEnv, ...env },
      preflight: preflightMock,
    });
    expect(result).toMatchObject({ exitCode: 1, output: { code } });
    expect(preflightMock).not.toHaveBeenCalled();
  });
});

const successfulDispatch = (): WhatsAppDispatchDetails => ({
  id: WHATSAPP_GROUP_TEST_IDS.dispatchId,
  productId: 'product-test',
  generatedCopyId: WHATSAPP_GROUP_TEST_IDS.copyId,
  destinationId: 'stored-group-1',
  status: 'SENT',
  attemptCount: 1,
  externalMessageId: 'message-test-id',
  sentAt: new Date('2026-07-24T12:01:00.000Z'),
  errorMessage: null,
  generatedCopy: {
    id: 'copy-1',
    productId: 'product-1',
    snapshotId: null,
    createdFromCandidateId: null,
    titulo: 'Teste controlado de grupo',
    mensagem: WHATSAPP_GROUP_TEST_MESSAGE,
    cta: '',
    hashtags: '',
  },
  destination: {
    name: 'Grupo controlado',
    destination: GROUP_ID,
    type: 'GROUP',
    active: true,
    available: true,
    fingerprint: FINGERPRINT,
    sourceInstanceName: 'afiliado-shopee-local',
  },
});

const runtimeHarness = () => {
  const dispatch = successfulDispatch();
  const runtime: WhatsAppGroupTestRuntime = {
    assertNoCompetingWork: vi.fn(async () => undefined),
    findJob: vi.fn(async () => null),
    prepare: vi.fn(async () => ({ dispatchId: dispatch.id })),
    enqueue: vi.fn(async () => ({
      id: WHATSAPP_GROUP_TEST_IDS.jobId,
      waitUntilFinished: vi.fn(),
    })),
    startWorker: vi.fn(async () => undefined),
    waitForJob: vi.fn(async () => undefined),
    readDispatch: vi.fn(async () => dispatch),
    queryDispatchApi: vi.fn(async () => ({
      ...dispatch,
      destination: { ...dispatch.destination, destination: FINGERPRINT },
    })),
    close: vi.fn(async () => undefined),
  };
  return runtime;
};

describe('whatsapp:group-test caminho confirmado mockado', () => {
  beforeEach(() => vi.clearAllMocks());

  it('nao entra no runtime com master switch desligado', async () => {
    const runtimeFactory = vi.fn();
    const result = await run({
      args: [WHATSAPP_GROUP_TEST_REAL_FLAG],
      runtimeFactory,
    });
    expect(result).toMatchObject({
      exitCode: 1,
      output: { code: 'WHATSAPP_GROUP_TEST_MASTER_SWITCH_REQUIRED' },
    });
    expect(runtimeFactory).not.toHaveBeenCalled();
  });

  it('exige exatamente um grupo ativo e disponivel', async () => {
    const runtimeFactory = vi.fn();
    const result = await run({
      args: [WHATSAPP_GROUP_TEST_REAL_FLAG],
      env: { ...baseEnv, WHATSAPP_GROUP_SEND_ENABLED: 'true' },
      preflight: vi.fn(async () => preflight([])),
      runtimeFactory,
    });
    expect(result).toMatchObject({
      exitCode: 1,
      output: { code: 'WHATSAPP_GROUP_TEST_SINGLE_GROUP_REQUIRED' },
    });
    expect(runtimeFactory).not.toHaveBeenCalled();
  });

  it('usa IDs, job e mensagem fixos em uma unica execucao isolada', async () => {
    const runtime = runtimeHarness();
    const result = await run({
      args: ['--', WHATSAPP_GROUP_TEST_REAL_FLAG],
      env: { ...baseEnv, WHATSAPP_GROUP_SEND_ENABLED: 'true' },
      runtimeFactory: vi.fn(async () => runtime),
    });
    expect(result).toMatchObject({
      exitCode: 0,
      output: {
        mode: 'confirmed',
        fingerprint: FINGERPRINT,
        dispatchId: WHATSAPP_GROUP_TEST_IDS.dispatchId,
        jobId: WHATSAPP_GROUP_TEST_IDS.jobId,
        jobAttempts: 1,
        retryEnabled: false,
        status: 'SENT',
        attemptCount: 1,
        apiQueryValidated: true,
        messagesSent: 1,
      },
    });
    expect(runtime.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'stored-group-1',
        fingerprint: FINGERPRINT,
        externalGroupId: GROUP_ID,
      }),
    );
    expect(runtime.enqueue).toHaveBeenCalledWith(
      WHATSAPP_GROUP_TEST_IDS.dispatchId,
      WHATSAPP_GROUP_TEST_IDS.jobId,
    );
    expect(runtime.startWorker).toHaveBeenCalledOnce();
    expect(runtime.close).toHaveBeenCalledOnce();
    expect(WHATSAPP_GROUP_TEST_MESSAGE).toBe(
      'Teste controlado do sistema Afiliado Shopee no grupo autorizado. Nenhuma ação é necessária.',
    );
  });

  it('bloqueia permanentemente job anterior sem preparar dispatch', async () => {
    const runtime = runtimeHarness();
    vi.mocked(runtime.findJob).mockResolvedValueOnce({ previous: true });
    const result = await run({
      args: [WHATSAPP_GROUP_TEST_REAL_FLAG],
      env: { ...baseEnv, WHATSAPP_GROUP_SEND_ENABLED: 'true' },
      runtimeFactory: vi.fn(async () => runtime),
    });
    expect(result).toMatchObject({
      exitCode: 1,
      output: {
        code: 'WHATSAPP_GROUP_TEST_PREVIOUS_EXECUTION_BLOCKED',
        investigationRequired: true,
      },
    });
    expect(runtime.prepare).not.toHaveBeenCalled();
    expect(runtime.startWorker).not.toHaveBeenCalled();
    expect(runtime.close).toHaveBeenCalledOnce();
  });

  it('preserva job sem retry, backoff ou remocao', () => {
    expect(CONTROLLED_GROUP_TEST_JOB_OPTIONS).toMatchObject({
      attempts: 1,
      removeOnComplete: false,
      removeOnFail: false,
    });
    expect(CONTROLLED_GROUP_TEST_JOB_OPTIONS).not.toHaveProperty('backoff');
  });
});
