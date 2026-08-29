import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig, type AppEnv } from '@shopee-auto-affiliate-ai/config';
import {
  createWhatsAppProvider,
  EvolutionApiWhatsAppProvider,
  MockShopeeProvider,
  MockWhatsAppProvider,
  type HttpClient,
  type WhatsAppProvider,
} from '@shopee-auto-affiliate-ai/providers';
import {
  DEFAULT_PIPELINE_SCHEDULER_JOB_ID,
  JOB_NAMES,
} from '@shopee-auto-affiliate-ai/queue';

import {
  processWhatsAppDispatchJob,
  startLegacyWorkerEntrypoint,
  startWorker,
} from '../src/index';

const baseEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://localhost:5432/app',
  REDIS_URL: 'redis://localhost:6379',
};

const legacyWorkerConfig = (config: AppEnv): AppEnv => ({
  ...config,
  COMMERCIAL_AUTOMATION_MODE: 'send',
});

const SAFE_TEST_DESTINATION = '0000000000000';

const logger = { info: vi.fn(), error: vi.fn() };

const createInfrastructure = () => ({
  connection: {} as never,
  scheduler: {
    register: vi.fn(),
    remove: vi.fn(async (jobId: string) => ({
      jobId,
      status: 'not-registered' as const,
      cronExpression: null,
      timezone: null,
      nextRunAt: null,
    })),
    getState: vi.fn(),
  },
  close: vi.fn(async () => undefined),
});

const createWorkerRuntime = () => ({
  productPipelineWorker: {} as never,
  whatsappDispatchWorker: {} as never,
  close: vi.fn(async () => undefined),
});

const createDispatch = (
  status = 'PENDING',
  destination = 'mock-destination-01',
) => ({
  id: 'dispatch-1',
  productId: 'product-1',
  generatedCopyId: 'copy-1',
  destinationId: 'destination-1',
  status,
  attemptCount: 0,
  generatedCopy: {
    titulo: 'Oferta',
    mensagem: 'Mensagem promocional',
    cta: 'Compre agora',
    hashtags: '#Oferta',
  },
  destination: { destination },
});

const createPrismaMock = (
  initialStatus = 'PENDING',
  destination = 'mock-destination-01',
) => {
  let dispatch = createDispatch(initialStatus, destination);
  return {
    $disconnect: vi.fn(),
    productLead: {},
    generatedCopy: {},
    whatsAppDestination: {},
    whatsAppDispatch: {
      findUnique: vi.fn(async () => dispatch),
      updateMany: vi.fn(
        async ({ where }: { where: { status?: string } }) => {
          if (where.status && dispatch.status !== where.status) {
            return { count: 0 };
          }
          dispatch = {
            ...dispatch,
            status: 'PROCESSING',
            attemptCount: dispatch.attemptCount + 1,
          };
          return { count: 1 };
        },
      ),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        dispatch = { ...dispatch, ...data } as typeof dispatch;
        return dispatch;
      }),
    },
  };
};

const createJob = () => ({
  id: 'job-dispatch-1',
  name: JOB_NAMES.whatsappDispatch,
  data: { dispatchId: 'dispatch-1' },
});

const processDispatch = (
  prisma: ReturnType<typeof createPrismaMock>,
  whatsAppProvider: WhatsAppProvider,
) =>
  processWhatsAppDispatchJob(createJob(), {
    prisma: prisma as never,
    hunterProvider: new MockShopeeProvider(),
    logger,
    whatsAppProvider,
  });

const bootstrapProvider = async (
  config: AppEnv,
  providerFactoryOptions: { httpClient?: HttpClient } = {},
) => {
  let provider: WhatsAppProvider | undefined;
  const infrastructure = createInfrastructure();
  const workerFactory = vi.fn((_redisUrl, options) => {
    provider = options.whatsAppProvider;
    return createWorkerRuntime();
  });

  await startWorker(legacyWorkerConfig(config), {
    logger,
    providerFactoryOptions,
    infrastructureFactory: () => infrastructure,
    workerFactory,
  });

  return {
    provider: provider as WhatsAppProvider,
    workerFactory,
    infrastructure,
  };
};

describe('WhatsApp provider worker bootstrap', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('bloqueia o entrypoint legado direto antes de construir qualquer topologia em preview perigoso', async () => {
    const config = loadConfig({
      ...baseEnv,
      COMMERCIAL_AUTOMATION_MODE: 'preview',
      COMMERCIAL_AI_COPY_ENABLED: 'true',
      OPENAI_API_KEY: 'preview-only-key',
      COMMERCIAL_AI_COPY_MODEL: 'preview-only-model',
      SHOPEE_AFFILIATE_PROVIDER: 'official',
      SHOPEE_AFFILIATE_API_ENABLED: 'true',
      SHOPEE_AFFILIATE_API_URL: 'https://example.invalid/shopee',
      SHOPEE_AFFILIATE_APP_ID: 'preview-only-app',
      SHOPEE_AFFILIATE_SECRET: 'preview-only-secret',
      WHATSAPP_PROVIDER: 'evolution',
      EVOLUTION_API_URL: 'http://localhost:8080',
      EVOLUTION_API_KEY: 'preview-only-key',
      EVOLUTION_INSTANCE_NAME: 'preview-only-instance',
      WHATSAPP_GROUP_SEND_ENABLED: 'true',
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await expect(startLegacyWorkerEntrypoint(config)).rejects.toMatchObject({
      code: 'LEGACY_WORKER_PREVIEW_MODE_FORBIDDEN',
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejeita preview perigoso antes de chamar factories de infraestrutura, provider ou worker', async () => {
    const config = loadConfig({
      ...baseEnv,
      COMMERCIAL_AUTOMATION_MODE: 'preview',
      SHOPEE_AFFILIATE_PROVIDER: 'official',
      SHOPEE_AFFILIATE_API_ENABLED: 'true',
      SHOPEE_AFFILIATE_API_URL: 'https://example.invalid/shopee',
      SHOPEE_AFFILIATE_APP_ID: 'preview-only-app',
      SHOPEE_AFFILIATE_SECRET: 'preview-only-secret',
      WHATSAPP_PROVIDER: 'evolution',
      EVOLUTION_API_URL: 'http://localhost:8080',
      EVOLUTION_API_KEY: 'preview-only-key',
      EVOLUTION_INSTANCE_NAME: 'preview-only-instance',
      WHATSAPP_GROUP_SEND_ENABLED: 'true',
    });
    const providerFactory = vi.fn();
    const infrastructureFactory = vi.fn();
    const workerFactory = vi.fn();

    await expect(
      startWorker(config, {
        providerFactory: providerFactory as never,
        infrastructureFactory: infrastructureFactory as never,
        workerFactory: workerFactory as never,
      }),
    ).rejects.toMatchObject({
      code: 'LEGACY_WORKER_PREVIEW_MODE_FORBIDDEN',
    });

    expect(providerFactory).not.toHaveBeenCalled();
    expect(infrastructureFactory).not.toHaveBeenCalled();
    expect(workerFactory).not.toHaveBeenCalled();
  });

  it('inicia em mock por padrao e registra a fila sem chamar HTTP', async () => {
    const httpClient = vi.fn();
    const config = loadConfig(baseEnv);
    const { provider, workerFactory, infrastructure } = await bootstrapProvider(
      config,
      {
        httpClient,
      },
    );

    expect(provider).toBeInstanceOf(MockWhatsAppProvider);
    expect(workerFactory).toHaveBeenCalledTimes(1);
    expect(infrastructure.scheduler.remove).toHaveBeenCalledWith(
      DEFAULT_PIPELINE_SCHEDULER_JOB_ID,
    );
    expect(httpClient).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      {
        event: 'worker.whatsapp-provider.selected',
        provider: 'mock',
        queue: 'whatsapp-dispatch',
      },
      'WhatsApp provider selected',
    );
  });

  it('inicia em mock com protecoes Evolution explicitas sem chamar HTTP real', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const config = loadConfig({
      ...baseEnv,
      WHATSAPP_PROVIDER: 'mock',
      EVOLUTION_SAFE_MODE: 'true',
      EVOLUTION_ALLOWED_DESTINATIONS: '',
      EVOLUTION_MAX_MESSAGES_PER_BOOT: '1',
    });
    const { provider, workerFactory } = await bootstrapProvider(config);

    await expect(
      processDispatch(createPrismaMock(), provider),
    ).resolves.toMatchObject({ status: 'SENT' });
    expect(provider).toBeInstanceOf(MockWhatsAppProvider);
    expect(workerFactory).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('seleciona mock somente por WHATSAPP_PROVIDER mesmo com dados Evolution', async () => {
    const config = loadConfig({
      ...baseEnv,
      WHATSAPP_PROVIDER: 'mock',
      EVOLUTION_API_URL: 'http://localhost:8080',
      EVOLUTION_API_KEY: 'test-only-api-key',
      EVOLUTION_INSTANCE_NAME: 'affiliate-bot',
    });

    expect((await bootstrapProvider(config)).provider).toBeInstanceOf(
      MockWhatsAppProvider,
    );
  });

  it('registra configuracao Evolution sem API key ou credenciais da URL', async () => {
    const apiKey = 'test-only-api-key';
    const config = loadConfig({
      ...baseEnv,
      WHATSAPP_PROVIDER: 'evolution',
      EVOLUTION_API_URL: 'http://test-user:test-password@localhost:8080',
      EVOLUTION_API_KEY: apiKey,
      EVOLUTION_INSTANCE_NAME: 'affiliate-bot',
    });

    await bootstrapProvider(config, { httpClient: vi.fn() });

    expect(logger.info).toHaveBeenCalledWith(
      {
        event: 'worker.whatsapp-provider.selected',
        provider: 'evolution',
        queue: 'whatsapp-dispatch',
        instanceName: 'affiliate-bot',
        baseUrl: 'http://localhost:8080',
      },
      'WhatsApp provider selected',
    );
    const logs = JSON.stringify(vi.mocked(logger.info).mock.calls);
    expect(logs).not.toContain(apiKey);
    expect(logs).not.toContain('test-user');
    expect(logs).not.toContain('test-password');
  });

  it('falha antes de criar workers quando a configuracao Evolution esta incompleta', () => {
    const workerFactory = vi.fn();
    const secret = 'test-only-api-key';
    let caught: unknown;

    try {
      const config = loadConfig({
        ...baseEnv,
        WHATSAPP_PROVIDER: 'evolution',
        EVOLUTION_API_KEY: secret,
      });
      startWorker(legacyWorkerConfig(config), {
        workerFactory: workerFactory as never,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeDefined();
    expect(String(caught)).not.toContain(secret);
    expect(workerFactory).not.toHaveBeenCalled();
  });

  it('cria o provider uma vez no bootstrap e nao por job', async () => {
    const providerFactory = vi.fn(createWhatsAppProvider);
    const config = loadConfig(baseEnv);
    let provider: WhatsAppProvider | undefined;

    const infrastructure = createInfrastructure();
    await startWorker(legacyWorkerConfig(config), {
      logger,
      providerFactory,
      infrastructureFactory: () => infrastructure,
      workerFactory: (_redisUrl, options) => {
        provider = options.whatsAppProvider;
        return createWorkerRuntime();
      },
    });

    await processDispatch(createPrismaMock(), provider as WhatsAppProvider);
    await processDispatch(createPrismaMock(), provider as WhatsAppProvider);

    expect(providerFactory).toHaveBeenCalledTimes(1);
  });
});

describe('whatsapp-dispatch worker provider integration', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('processa dispatch em modo mock sem chamar fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { provider } = await bootstrapProvider(loadConfig(baseEnv));

    await expect(
      processDispatch(createPrismaMock(), provider),
    ).resolves.toMatchObject({
      status: 'SENT',
      externalMessageId: 'mock-whatsapp-1',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('usa Evolution injetado com HTTP mockado', async () => {
    const httpClient = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ key: { id: 'evolution-message-1' } }), {
        status: 200,
      }),
    );
    const config = loadConfig({
      ...baseEnv,
      WHATSAPP_PROVIDER: 'evolution',
      EVOLUTION_API_URL: 'http://localhost:8080',
      EVOLUTION_API_KEY: 'test-only-api-key',
      EVOLUTION_INSTANCE_NAME: 'affiliate-bot',
      EVOLUTION_ALLOWED_DESTINATIONS: SAFE_TEST_DESTINATION,
    });
    const { provider } = await bootstrapProvider(config, { httpClient });

    expect(provider).toBeInstanceOf(EvolutionApiWhatsAppProvider);
    await expect(
      processDispatch(
        createPrismaMock('PENDING', SAFE_TEST_DESTINATION),
        provider,
      ),
    ).resolves.toMatchObject({
      status: 'SENT',
      externalMessageId: 'evolution-message-1',
    });
    expect(httpClient).toHaveBeenCalledTimes(1);
  });

  it('bloqueia Evolution com allowlist vazia sem chamar HTTP', async () => {
    const httpClient = vi.fn();
    const config = loadConfig({
      ...baseEnv,
      WHATSAPP_PROVIDER: 'evolution',
      EVOLUTION_API_URL: 'http://localhost:8080',
      EVOLUTION_API_KEY: 'test-only-api-key',
      EVOLUTION_INSTANCE_NAME: 'affiliate-bot',
    });
    const { provider } = await bootstrapProvider(config, { httpClient });

    await expect(
      processDispatch(
        createPrismaMock('PENDING', SAFE_TEST_DESTINATION),
        provider,
      ),
    ).rejects.toMatchObject({ code: 'EVOLUTION_SAFE_DESTINATION_BLOCKED' });
    expect(httpClient).not.toHaveBeenCalled();
  });

  it('preserva o limite do guard entre jobs do mesmo bootstrap', async () => {
    const httpClient = vi.fn().mockImplementation(
      async () =>
        new Response(JSON.stringify({ key: { id: 'evolution-message-1' } }), {
          status: 200,
        }),
    );
    const config = loadConfig({
      ...baseEnv,
      WHATSAPP_PROVIDER: 'evolution',
      EVOLUTION_API_URL: 'http://localhost:8080',
      EVOLUTION_API_KEY: 'test-only-api-key',
      EVOLUTION_INSTANCE_NAME: 'affiliate-bot',
      EVOLUTION_ALLOWED_DESTINATIONS: SAFE_TEST_DESTINATION,
      EVOLUTION_MAX_MESSAGES_PER_BOOT: '1',
    });
    const { provider } = await bootstrapProvider(config, { httpClient });

    await expect(
      processDispatch(
        createPrismaMock('PENDING', SAFE_TEST_DESTINATION),
        provider,
      ),
    ).resolves.toMatchObject({ status: 'SENT' });
    await expect(
      processDispatch(
        createPrismaMock('PENDING', SAFE_TEST_DESTINATION),
        provider,
      ),
    ).rejects.toMatchObject({ code: 'EVOLUTION_SAFE_LIMIT_REACHED' });
    expect(httpClient).toHaveBeenCalledTimes(1);
  });

  it('marca erro Evolution como ambiguo e bloqueia retry sem novo HTTP', async () => {
    const httpClient = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: 'unavailable' }), { status: 500 }),
      );
    const config = loadConfig({
      ...baseEnv,
      WHATSAPP_PROVIDER: 'evolution',
      EVOLUTION_API_URL: 'http://localhost:8080',
      EVOLUTION_API_KEY: 'test-only-api-key',
      EVOLUTION_INSTANCE_NAME: 'affiliate-bot',
      EVOLUTION_ALLOWED_DESTINATIONS: SAFE_TEST_DESTINATION,
    });
    const { provider } = await bootstrapProvider(config, { httpClient });

    const prisma = createPrismaMock('PENDING', SAFE_TEST_DESTINATION);
    await expect(processDispatch(prisma, provider)).rejects.toMatchObject({
      code: 'WHATSAPP_DISPATCH_DELIVERY_AMBIGUOUS',
    });
    await expect(processDispatch(prisma, provider)).rejects.toMatchObject({
      code: 'WHATSAPP_DISPATCH_DELIVERY_AMBIGUOUS',
    });
    expect(httpClient).toHaveBeenCalledTimes(1);
  });

  it('bloqueia retry automatico de dispatch FAILED', async () => {
    const provider = new MockWhatsAppProvider();
    const prisma = createPrismaMock('FAILED');

    await expect(processDispatch(prisma, provider)).rejects.toMatchObject({
      code: 'WHATSAPP_DISPATCH_RETRY_REQUIRES_MANUAL_REVIEW',
    });
    expect(provider.sentMessages).toHaveLength(0);
  });

  it('nao reenvia dispatch SENT', async () => {
    const provider = new MockWhatsAppProvider();
    const prisma = createPrismaMock('SENT');

    await expect(processDispatch(prisma, provider)).resolves.toMatchObject({
      status: 'SENT',
    });
    expect(provider.sentMessages).toHaveLength(0);
    expect(prisma.whatsAppDispatch.update).not.toHaveBeenCalled();
  });
});
