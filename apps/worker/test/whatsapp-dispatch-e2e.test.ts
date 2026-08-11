import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../api/src/app';
import {
  enqueueControlledE2EWhatsAppDispatch,
  JOB_NAMES,
} from '@shopee-auto-affiliate-ai/queue';
import {
  maskEvolutionDestination,
  type WhatsAppProvider,
} from '@shopee-auto-affiliate-ai/providers';
import {
  CONTROLLED_E2E_JOB_OPTIONS,
  executeControlledWhatsAppDispatchE2E,
  parseDotEnv,
  prepareControlledE2ERecords,
  runWhatsAppDispatchE2E,
  WHATSAPP_DISPATCH_E2E_IDS,
  WHATSAPP_DISPATCH_E2E_MESSAGE,
  WHATSAPP_DISPATCH_E2E_REAL_FLAG,
  type WhatsAppDispatchE2ERuntime,
} from '../src/whatsapp-dispatch-e2e';
import { processWhatsAppDispatchJob } from '../src/whatsapp-dispatch-worker';

const DESTINATION = '0000000000000';
const API_KEY = 'unit-test-api-key-never-real';
const LOCAL_API_AUTH_TOKEN = 'unit-test-local-api-auth-token';
const baseEnv: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379',
  WHATSAPP_PROVIDER: 'evolution',
  EVOLUTION_API_URL: 'http://localhost:8080',
  EVOLUTION_API_KEY: API_KEY,
  EVOLUTION_INSTANCE_NAME: 'afiliado-shopee-local',
  EVOLUTION_SAFE_MODE: 'true',
  EVOLUTION_ALLOWED_DESTINATIONS: DESTINATION,
  EVOLUTION_MAX_MESSAGES_PER_BOOT: '1',
  SCHEDULER_ENABLED: 'false',
};

const preflight = vi.fn(async () => ({
  databaseAvailable: true as const,
  redisAvailable: true as const,
  evolutionAvailable: true as const,
  evolutionVersion: '2.3.7' as const,
  instanceStatus: 'open' as const,
}));

const createLogger = () => ({ info: vi.fn(), error: vi.fn() });

type RuntimeState = {
  product?: Record<string, unknown>;
  copy?: Record<string, unknown>;
  destination?: Record<string, unknown>;
  dispatch?: Record<string, unknown>;
};

const createRuntime = ({
  previousStatus,
  waitFailure = false,
  ambiguousTimeout = false,
}: {
  previousStatus?: 'PENDING' | 'SENT' | 'FAILED';
  waitFailure?: boolean;
  ambiguousTimeout?: boolean;
} = {}) => {
  const state: RuntimeState = {};
  if (previousStatus) {
    state.dispatch = {
      id: WHATSAPP_DISPATCH_E2E_IDS.dispatchId,
      productId: 'existing-product',
      generatedCopyId: WHATSAPP_DISPATCH_E2E_IDS.copyId,
      destinationId: WHATSAPP_DISPATCH_E2E_IDS.destinationId,
      status: previousStatus,
      attemptCount: previousStatus === 'PENDING' ? 0 : 1,
      externalMessageId:
        previousStatus === 'SENT' ? 'external-message-present' : null,
      sentAt: previousStatus === 'SENT' ? new Date() : null,
      errorMessage: previousStatus === 'FAILED' ? 'safe failure' : null,
    };
  }

  const details = (masked = false) => {
    if (!state.dispatch) return null;
    return {
      ...state.dispatch,
      generatedCopy: {
        titulo: 'Teste E2E controlado',
        mensagem: WHATSAPP_DISPATCH_E2E_MESSAGE,
        cta: '',
        hashtags: '',
      },
      destination: {
        destination: masked
          ? maskEvolutionDestination(DESTINATION)
          : DESTINATION,
      },
      product: { comissao: 0 },
    };
  };

  const repositories = {
    analytics: {},
    products: {
      findByProviderProductId: vi.fn(async () =>
        state.product ? { id: String(state.product.id) } : null,
      ),
      findById: vi.fn(async () => state.product ?? null),
      create: vi.fn(async (data) => {
        state.product = { ...data, id: 'e2e-product-id' };
        return state.product;
      }),
      updateByProviderProductId: vi.fn(),
      listForScoring: vi.fn(),
      updateScore: vi.fn(),
      listApproved: vi.fn(),
    },
    generatedCopies: {
      findById: vi.fn(async () => state.copy ?? null),
      create: vi.fn(async (data) => {
        state.copy = { ...data };
        return state.copy;
      }),
    },
    whatsappDestinations: {
      findById: vi.fn(async () => state.destination ?? null),
      create: vi.fn(async (data) => {
        state.destination = { ...data };
        return state.destination;
      }),
      listActive: vi.fn(),
      list: vi.fn(),
      update: vi.fn(),
    },
    whatsappDispatches: {
      findByIdWithDetails: vi.fn(async () => details()),
      findByIdForSending: vi.fn(async () => details()),
      list: vi.fn(async () => (state.dispatch ? [details()] : [])),
      createPending: vi.fn(
        async (data): Promise<Record<string, unknown> | null> => {
          state.dispatch = {
            ...data,
            status: 'PENDING',
            attemptCount: 0,
            externalMessageId: null,
            sentAt: null,
            errorMessage: null,
          };
          return state.dispatch ?? null;
        },
      ),
      markAttemptPending: vi.fn(),
      markSent: vi.fn(),
      markFailed: vi.fn(),
    },
  };

  const job = {
    id: WHATSAPP_DISPATCH_E2E_IDS.jobId,
    waitUntilFinished: vi.fn(),
  };
  const runtime: WhatsAppDispatchE2ERuntime = {
    repositories: repositories as never,
    assertNoCompetingWork: vi.fn(async () => undefined),
    findJob: vi.fn(async () => null),
    enqueue: vi.fn(async () => job as never),
    startWorker: vi.fn(async () => undefined),
    waitForJob: vi.fn(async () => {
      if (ambiguousTimeout) throw new Error('timeout');
      if (!state.dispatch) throw new Error('missing dispatch');
      if (waitFailure) {
        state.dispatch = {
          ...state.dispatch,
          status: 'FAILED',
          attemptCount: 1,
          errorMessage: 'Falha segura no provider',
        };
        throw new Error('job failed');
      }
      state.dispatch = {
        ...state.dispatch,
        status: 'SENT',
        attemptCount: 1,
        externalMessageId: 'external-message-present',
        sentAt: new Date(),
        errorMessage: null,
      };
    }),
    queryDispatchApi: vi.fn(async () => details(true) as never),
    close: vi.fn(async () => undefined),
  };

  return { runtime, repositories, state };
};

const run = (overrides: Parameters<typeof runWhatsAppDispatchE2E>[0] = {}) =>
  runWhatsAppDispatchE2E({
    env: baseEnv,
    readEnvFile: () => '',
    preflight,
    logger: createLogger(),
    ...overrides,
  });

describe('controlled WhatsApp dispatch E2E command', () => {
  beforeEach(() => vi.clearAllMocks());

  it('carrega .env com precedencia das variaveis de processo', async () => {
    const parsed = parseDotEnv(
      'WHATSAPP_PROVIDER=mock\nEVOLUTION_SAFE_MODE="true"\n',
    );
    expect(parsed).toEqual({
      WHATSAPP_PROVIDER: 'mock',
      EVOLUTION_SAFE_MODE: 'true',
    });

    const result = await runWhatsAppDispatchE2E({
      args: [],
      env: baseEnv,
      readEnvFile: () => 'WHATSAPP_PROVIDER=mock',
      preflight,
      logger: createLogger(),
    });
    expect(result.exitCode).toBe(0);
  });

  it('executa dry-run por padrao sem gravar, enfileirar ou iniciar worker', async () => {
    const runtimeFactory = vi.fn();
    const logger = createLogger();
    const result = await run({ args: [], runtimeFactory, logger });

    expect(result).toMatchObject({
      exitCode: 0,
      output: {
        mode: 'dry-run',
        destination: maskEvolutionDestination(DESTINATION),
        databaseAvailable: true,
        redisAvailable: true,
        evolutionAvailable: true,
        instanceStatus: 'open',
        messageWillBeSent: false,
      },
    });
    expect(runtimeFactory).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledTimes(1);
  });

  it('exige a flag exata e rejeita flags parecidas ou argumentos adicionais', async () => {
    const { runtime } = createRuntime();
    const runtimeFactory = vi.fn(async () => runtime);
    await expect(
      run({ args: [WHATSAPP_DISPATCH_E2E_REAL_FLAG], runtimeFactory }),
    ).resolves.toMatchObject({ exitCode: 0 });
    expect(runtimeFactory).toHaveBeenCalledTimes(1);

    for (const args of [
      ['--confirm-real-dispatch'],
      [WHATSAPP_DISPATCH_E2E_REAL_FLAG, '--destination=invalid'],
      [WHATSAPP_DISPATCH_E2E_REAL_FLAG, '--message=invalid'],
    ]) {
      await expect(run({ args })).resolves.toMatchObject({
        exitCode: 1,
        output: { code: 'WHATSAPP_E2E_FLAG_INVALID' },
      });
    }
  });

  it.each([
    ['CI', { CI: 'true' }, 'WHATSAPP_E2E_CI_BLOCKED'],
    [
      'provider mock',
      { WHATSAPP_PROVIDER: 'mock' },
      'WHATSAPP_E2E_PROVIDER_REQUIRED',
    ],
    [
      'safe mode false',
      { EVOLUTION_SAFE_MODE: 'false' },
      'WHATSAPP_E2E_SAFE_MODE_REQUIRED',
    ],
    [
      'Scheduler ativo',
      {
        SCHEDULER_ENABLED: 'true',
        SCHEDULER_CRON: '0 8 * * *',
        SCHEDULER_TIMEZONE: 'America/Sao_Paulo',
      },
      'WHATSAPP_E2E_SCHEDULER_MUST_BE_DISABLED',
    ],
    [
      'allowlist vazia',
      { EVOLUTION_ALLOWED_DESTINATIONS: '' },
      'WHATSAPP_E2E_SINGLE_DESTINATION_REQUIRED',
    ],
    [
      'mais de um destino',
      { EVOLUTION_ALLOWED_DESTINATIONS: `${DESTINATION},${DESTINATION}` },
      'WHATSAPP_E2E_SINGLE_DESTINATION_REQUIRED',
    ],
    [
      'limite diferente de um',
      { EVOLUTION_MAX_MESSAGES_PER_BOOT: '2' },
      'WHATSAPP_E2E_LIMIT_MUST_BE_ONE',
    ],
  ])('bloqueia %s antes do preflight', async (_name, override, code) => {
    const result = await run({ env: { ...baseEnv, ...override } });
    expect(result).toMatchObject({ exitCode: 1, output: { code } });
    expect(preflight).not.toHaveBeenCalled();
  });

  it('falha claramente quando o .env da raiz nao existe', async () => {
    const result = await runWhatsAppDispatchE2E({
      args: [],
      env: baseEnv,
      envPath: 'Z:\\arquivo-inexistente\\.env',
      logger: createLogger(),
    });
    expect(result).toMatchObject({
      exitCode: 1,
      output: { code: 'WHATSAPP_E2E_ENV_FILE_MISSING' },
    });
  });

  it('usa somente destino da allowlist e mensagem publica fixa', async () => {
    const { runtime, repositories } = createRuntime();
    const result = await run({
      args: [WHATSAPP_DISPATCH_E2E_REAL_FLAG],
      runtimeFactory: async () => runtime,
    });

    expect(result.exitCode).toBe(0);
    expect(repositories.whatsappDestinations.create).toHaveBeenCalledWith({
      id: WHATSAPP_DISPATCH_E2E_IDS.destinationId,
      name: 'E2E TEST — Destino controlado',
      destination: DESTINATION,
      active: false,
    });
    expect(repositories.generatedCopies.create).toHaveBeenCalledWith(
      expect.objectContaining({
        titulo: 'Teste E2E controlado',
        mensagem: WHATSAPP_DISPATCH_E2E_MESSAGE,
        cta: '',
        hashtags: '',
      }),
    );
  });

  it('cria registros deterministas, um dispatch e um unico job controlado', async () => {
    const { runtime, repositories } = createRuntime();
    const result = await executeControlledWhatsAppDispatchE2E({
      runtime,
      destination: DESTINATION,
      maskedDestination: maskEvolutionDestination(DESTINATION),
    });

    expect(result.exitCode).toBe(0);
    expect(repositories.products.create).toHaveBeenCalledTimes(1);
    expect(repositories.generatedCopies.create).toHaveBeenCalledTimes(1);
    expect(repositories.whatsappDestinations.create).toHaveBeenCalledTimes(1);
    expect(repositories.whatsappDispatches.createPending).toHaveBeenCalledTimes(
      1,
    );
    expect(runtime.enqueue).toHaveBeenCalledOnce();
    expect(runtime.enqueue).toHaveBeenCalledWith(
      WHATSAPP_DISPATCH_E2E_IDS.dispatchId,
      WHATSAPP_DISPATCH_E2E_IDS.jobId,
    );
    expect(runtime.startWorker).toHaveBeenCalledOnce();
  });

  it.each(['SENT', 'FAILED', 'PENDING'] as const)(
    'bloqueia permanentemente dispatch anterior %s',
    async (status) => {
      const { runtime, repositories } = createRuntime({
        previousStatus: status,
      });
      const result = await run({
        args: [WHATSAPP_DISPATCH_E2E_REAL_FLAG],
        runtimeFactory: async () => runtime,
      });

      expect(result).toMatchObject({
        exitCode: 1,
        output: {
          code: 'WHATSAPP_E2E_PREVIOUS_DISPATCH_BLOCKED',
          status,
          dispatchId: WHATSAPP_DISPATCH_E2E_IDS.dispatchId,
        },
      });
      expect(
        repositories.whatsappDispatches.createPending,
      ).not.toHaveBeenCalled();
      expect(runtime.enqueue).not.toHaveBeenCalled();
    },
  );

  it('preserva SENT, externalMessageId, sentAt e attemptCount igual a um', async () => {
    const { runtime } = createRuntime();
    const result = await executeControlledWhatsAppDispatchE2E({
      runtime,
      destination: DESTINATION,
      maskedDestination: maskEvolutionDestination(DESTINATION),
    });
    expect(result).toMatchObject({
      exitCode: 0,
      output: {
        status: 'SENT',
        attemptCount: 1,
        externalMessageIdPresent: true,
        sentAtPresent: true,
        apiQueryValidated: true,
        retryEnabled: false,
        messagesSent: 1,
      },
    });
    expect(runtime.waitForJob).toHaveBeenCalledTimes(1);
  });

  it('em falha nao reenfileira nem tenta novamente', async () => {
    const { runtime } = createRuntime({ waitFailure: true });
    const result = await executeControlledWhatsAppDispatchE2E({
      runtime,
      destination: DESTINATION,
      maskedDestination: maskEvolutionDestination(DESTINATION),
    });
    expect(result).toMatchObject({
      exitCode: 1,
      output: {
        status: 'FAILED',
        attemptCount: 1,
        retryEnabled: false,
        investigationRequired: true,
      },
    });
    expect(runtime.enqueue).toHaveBeenCalledTimes(1);
    expect(runtime.waitForJob).toHaveBeenCalledTimes(1);
  });

  it('em timeout ambiguo nao repete e exige investigacao manual', async () => {
    const { runtime } = createRuntime({ ambiguousTimeout: true });
    const result = await executeControlledWhatsAppDispatchE2E({
      runtime,
      destination: DESTINATION,
      maskedDestination: maskEvolutionDestination(DESTINATION),
      timeoutMs: 10,
    });
    expect(result).toMatchObject({
      exitCode: 1,
      output: {
        status: 'PENDING',
        investigationRequired: true,
        retryEnabled: false,
      },
    });
    expect(runtime.enqueue).toHaveBeenCalledTimes(1);
    expect(runtime.waitForJob).toHaveBeenCalledTimes(1);
    expect(runtime.close).toHaveBeenCalledWith(true);
  });

  it('nao registra numero completo nem API key', async () => {
    const { runtime } = createRuntime();
    const logger = createLogger();
    await run({
      args: [WHATSAPP_DISPATCH_E2E_REAL_FLAG],
      runtimeFactory: async () => runtime,
      logger,
    });
    const logs = JSON.stringify([
      ...logger.info.mock.calls,
      ...logger.error.mock.calls,
    ]);
    expect(logs).not.toContain(DESTINATION);
    expect(logs).not.toContain(API_KEY);
    expect(logs).toContain(maskEvolutionDestination(DESTINATION));
  });

  it('testes automatizados nunca chamam internet nem provider real', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { runtime } = createRuntime();
    await run({
      args: [WHATSAPP_DISPATCH_E2E_REAL_FLAG],
      runtimeFactory: async () => runtime,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('controlled BullMQ job and isolated worker', () => {
  it('enfileira somente whatsapp-dispatch com attempts 1 e sem backoff', async () => {
    const add = vi.fn(
      async (
        _name: string,
        _data: { dispatchId: string },
        _options: Record<string, unknown>,
      ) => ({ id: WHATSAPP_DISPATCH_E2E_IDS.jobId }),
    );
    await enqueueControlledE2EWhatsAppDispatch(
      { add } as never,
      { dispatchId: WHATSAPP_DISPATCH_E2E_IDS.dispatchId },
      WHATSAPP_DISPATCH_E2E_IDS.jobId,
    );
    expect(add).toHaveBeenCalledWith(
      JOB_NAMES.whatsappDispatch,
      { dispatchId: WHATSAPP_DISPATCH_E2E_IDS.dispatchId },
      {
        attempts: 1,
        removeOnComplete: false,
        removeOnFail: false,
        jobId: WHATSAPP_DISPATCH_E2E_IDS.jobId,
      },
    );
    const options = add.mock.calls[0][2] as Record<string, unknown>;
    expect(options).not.toHaveProperty('backoff');
    expect(CONTROLLED_E2E_JOB_OPTIONS).not.toHaveProperty('backoff');
    expect(add.mock.calls[0][0]).not.toBe(JOB_NAMES.pipelineProduct);
  });

  it('consumer real isolado chama SenderService uma vez e persiste SENT', async () => {
    let dispatch = {
      id: WHATSAPP_DISPATCH_E2E_IDS.dispatchId,
      productId: 'product-id',
      generatedCopyId: WHATSAPP_DISPATCH_E2E_IDS.copyId,
      destinationId: WHATSAPP_DISPATCH_E2E_IDS.destinationId,
      status: 'PENDING',
      attemptCount: 0,
      externalMessageId: null as string | null,
      sentAt: null as Date | null,
      errorMessage: null as string | null,
      generatedCopy: {
        titulo: 'Teste E2E controlado',
        mensagem: WHATSAPP_DISPATCH_E2E_MESSAGE,
        cta: '',
        hashtags: '',
      },
      destination: { destination: DESTINATION },
      product: { comissao: 0 },
    };
    const update = vi.fn(
      async ({ data }: { data: Record<string, unknown> }) => {
        const attemptCount =
          typeof data.attemptCount === 'object'
            ? dispatch.attemptCount + 1
            : dispatch.attemptCount;
        dispatch = { ...dispatch, ...data, attemptCount } as typeof dispatch;
        return dispatch;
      },
    );
    const provider: WhatsAppProvider = {
      sendMessage: vi.fn(async () => ({
        status: 'sent' as const,
        externalMessageId: 'external-message-present',
        sentAt: new Date(),
      })),
    };

    const result = await processWhatsAppDispatchJob(
      {
        id: WHATSAPP_DISPATCH_E2E_IDS.jobId,
        name: JOB_NAMES.whatsappDispatch,
        data: { dispatchId: WHATSAPP_DISPATCH_E2E_IDS.dispatchId },
      },
      {
        prisma: {
          whatsAppDispatch: {
            findUnique: vi.fn(async () => dispatch),
            updateMany: vi.fn(async () => {
              dispatch = {
                ...dispatch,
                status: 'PROCESSING',
                attemptCount: dispatch.attemptCount + 1,
              };
              return { count: 1 };
            }),
            update,
          },
          productLead: {},
          generatedCopy: {},
          whatsAppDestination: {},
        } as never,
        logger: { info: vi.fn(), error: vi.fn() },
        whatsAppProvider: provider,
        messageBuilder: () => WHATSAPP_DISPATCH_E2E_MESSAGE,
      },
    );

    expect(provider.sendMessage).toHaveBeenCalledTimes(1);
    expect(provider.sendMessage).toHaveBeenCalledWith({
      destination: DESTINATION,
      message: WHATSAPP_DISPATCH_E2E_MESSAGE,
    });
    expect(result).toMatchObject({
      status: 'SENT',
      attemptCount: 1,
      externalMessageId: 'external-message-present',
    });
  });
});

describe('dispatch API lookup', () => {
  it('retorna status, tentativa, produto, copy e destino mascarado', async () => {
    const dispatch = {
      id: WHATSAPP_DISPATCH_E2E_IDS.dispatchId,
      productId: 'product-id',
      generatedCopyId: WHATSAPP_DISPATCH_E2E_IDS.copyId,
      destinationId: WHATSAPP_DISPATCH_E2E_IDS.destinationId,
      status: 'SENT',
      attemptCount: 1,
      externalMessageId: 'external-message-present',
      sentAt: new Date(),
      errorMessage: null,
      generatedCopy: {
        titulo: 'Teste E2E controlado',
        mensagem: WHATSAPP_DISPATCH_E2E_MESSAGE,
        cta: '',
        hashtags: '',
      },
      destination: { destination: DESTINATION },
      product: { nome: 'E2E TEST — Produto controlado', comissao: 0 },
    };
    const app = await buildApp({
      logger: false,
      localApiAuthToken: LOCAL_API_AUTH_TOKEN,
      prisma: {
        $disconnect: vi.fn(),
        productLead: {},
        generatedCopy: {},
        whatsAppDestination: {},
        whatsAppDispatch: { findUnique: vi.fn(async () => dispatch) },
      } as never,
      pipelineQueue: {
        add: vi.fn(),
        close: vi.fn(async () => undefined),
      },
    });
    const response = await app.inject({
      method: 'GET',
      url: `/whatsapp/dispatches/${WHATSAPP_DISPATCH_E2E_IDS.dispatchId}`,
      headers: { authorization: `Bearer ${LOCAL_API_AUTH_TOKEN}` },
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'SENT',
      attemptCount: 1,
      sentAt: expect.any(String),
      externalMessageId: 'external-message-present',
      product: { nome: 'E2E TEST — Produto controlado' },
      generatedCopy: { titulo: 'Teste E2E controlado' },
      destination: { destination: maskEvolutionDestination(DESTINATION) },
    });
    expect(response.body).not.toContain(DESTINATION);
  });
});

describe('record preparation safety', () => {
  it('nao recria copy ou destino tecnico ja existente', async () => {
    const { runtime, repositories } = createRuntime();
    await prepareControlledE2ERecords(runtime.repositories, DESTINATION);
    repositories.whatsappDispatches.findByIdWithDetails
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    repositories.whatsappDispatches.list.mockResolvedValueOnce([]);
    repositories.whatsappDispatches.createPending.mockResolvedValueOnce(null);

    await expect(
      prepareControlledE2ERecords(runtime.repositories, DESTINATION),
    ).rejects.toMatchObject({ code: 'WHATSAPP_E2E_DISPATCH_CREATE_AMBIGUOUS' });
    expect(repositories.generatedCopies.create).toHaveBeenCalledTimes(1);
    expect(repositories.whatsappDestinations.create).toHaveBeenCalledTimes(1);
  });
});
