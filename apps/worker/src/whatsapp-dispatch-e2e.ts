import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { QueueEvents, type Job } from 'bullmq';
import {
  loadConfig,
  parseDotEnv,
  type AppEnv,
} from '@shopee-auto-affiliate-ai/config';
import { createPrismaClient } from '@shopee-auto-affiliate-ai/database';
import {
  createWhatsAppProvider,
  maskEvolutionDestination,
  normalizeEvolutionDestination,
  parseEvolutionConnectionState,
} from '@shopee-auto-affiliate-ai/providers';
import {
  CONTROLLED_E2E_WHATSAPP_DISPATCH_JOB_OPTIONS,
  createProductPipelineQueue,
  createRedisConnection,
  createWhatsAppDispatchQueue,
  enqueueControlledE2EWhatsAppDispatch,
  QUEUE_NAMES,
  type WhatsAppDispatchJob,
} from '@shopee-auto-affiliate-ai/queue';
import { buildApp } from '../../api/src/app';
import {
  createPrismaRepositories,
  type ApplicationRepositories,
} from '../../api/src/application-services';
import type {
  GeneratedCopyRecord,
  ProductLeadRecord,
  WhatsAppDestinationRecord,
  WhatsAppDispatchDetails,
} from '../../api/src/repositories';
import { createWhatsAppDispatchWorker } from './whatsapp-dispatch-worker';

export const WHATSAPP_DISPATCH_E2E_REAL_FLAG = '--confirm-one-real-dispatch';
export const WHATSAPP_DISPATCH_E2E_MESSAGE =
  'Teste E2E controlado do sistema Afiliado Shopee. Nenhuma ação é necessária.';
export const WHATSAPP_DISPATCH_E2E_IDS = {
  providerProductId: 'controlled-whatsapp-dispatch-e2e-v1',
  copyId: 'controlled-whatsapp-dispatch-e2e-v1-copy',
  destinationId: 'controlled-whatsapp-dispatch-e2e-v1-destination',
  dispatchId: 'controlled-whatsapp-dispatch-e2e-v1-dispatch',
  jobId: 'controlled-whatsapp-dispatch-e2e-v1-job',
} as const;

const E2E_PRODUCT_NAME = 'E2E TEST — Produto controlado';
const E2E_COPY_TITLE = 'Teste E2E controlado';
const E2E_DESTINATION_NAME = 'E2E TEST — Destino controlado';
const EXPECTED_EVOLUTION_URL = 'http://localhost:8080';
const EXPECTED_EVOLUTION_INSTANCE = 'afiliado-shopee-local';
const DEFAULT_JOB_TIMEOUT_MS = 30_000;
const ROOT_ENV_PATH = fileURLToPath(new URL('../../../.env', import.meta.url));

type E2ELogger = {
  info(data: Record<string, unknown>): void;
  error(data: Record<string, unknown>): void;
};

export type WhatsAppDispatchE2EPreflight = {
  databaseAvailable: true;
  redisAvailable: true;
  evolutionAvailable: true;
  evolutionVersion: '2.3.7';
  instanceStatus: 'open';
};

export type WhatsAppDispatchE2EDryRunOutput = {
  mode: 'dry-run';
  provider: 'evolution';
  safeMode: true;
  destination: string;
  schedulerEnabled: false;
  databaseAvailable: true;
  redisAvailable: true;
  evolutionAvailable: true;
  evolutionVersion: '2.3.7';
  instanceStatus: 'open';
  messageWillBeSent: false;
};

export type WhatsAppDispatchE2EConfirmedOutput = {
  mode: 'confirmed';
  dispatchId: string;
  jobId: string;
  jobAttempts: 1;
  retryEnabled: false;
  status: string;
  attemptCount: number;
  externalMessageIdPresent: boolean;
  sentAtPresent: boolean;
  apiQueryValidated: boolean;
  destination: string;
  investigationRequired: boolean;
  messagesSent: 0 | 1 | 'unknown';
};

export type WhatsAppDispatchE2EFailureOutput = {
  code: string;
  message: string;
  dispatchId?: string;
  status?: string;
  destination?: string;
  investigationRequired?: boolean;
};

export type WhatsAppDispatchE2ERunResult =
  | { exitCode: 0; output: WhatsAppDispatchE2EDryRunOutput }
  | { exitCode: 0; output: WhatsAppDispatchE2EConfirmedOutput }
  | { exitCode: 1; output: WhatsAppDispatchE2EFailureOutput }
  | { exitCode: 1; output: WhatsAppDispatchE2EConfirmedOutput };

type E2EExecutionMode = 'dry-run' | 'confirmed';

type E2EJob = Pick<Job<WhatsAppDispatchJob>, 'id' | 'waitUntilFinished'>;

export type WhatsAppDispatchE2ERuntime = {
  repositories: ApplicationRepositories;
  assertNoCompetingWork(): Promise<void>;
  findJob(jobId: string): Promise<unknown | null>;
  enqueue(dispatchId: string, jobId: string): Promise<E2EJob>;
  startWorker(): Promise<void>;
  waitForJob(job: E2EJob, timeoutMs: number): Promise<void>;
  queryDispatchApi(dispatchId: string): Promise<WhatsAppDispatchDetails>;
  close(force?: boolean): Promise<void>;
};

type WhatsAppDispatchE2EOptions = {
  args?: readonly string[];
  env?: NodeJS.ProcessEnv;
  envPath?: string;
  readEnvFile?: (path: string) => string;
  logger?: E2ELogger;
  preflight?: (config: AppEnv) => Promise<WhatsAppDispatchE2EPreflight>;
  runtimeFactory?: (
    config: AppEnv,
    logger: E2ELogger,
  ) => Promise<WhatsAppDispatchE2ERuntime>;
  jobTimeoutMs?: number;
};

const consoleLogger: E2ELogger = {
  info: (data) => console.log(JSON.stringify(data)),
  error: (data) => console.error(JSON.stringify(data)),
};

class WhatsAppDispatchE2EError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly details: {
      dispatchId?: string;
      status?: string;
      destination?: string;
      investigationRequired?: boolean;
    } = {},
  ) {
    super(message);
  }
}

const isCiActive = (value: string | undefined) =>
  value !== undefined &&
  value.trim() !== '' &&
  value.trim().toLowerCase() !== 'false';

export { parseDotEnv };

const loadLocalEnvironment = ({
  env,
  envPath,
  readEnvFile,
}: Pick<WhatsAppDispatchE2EOptions, 'env' | 'envPath' | 'readEnvFile'>) => {
  const path = envPath ?? ROOT_ENV_PATH;
  const reader =
    readEnvFile ?? ((target: string) => readFileSync(target, 'utf8'));
  if (!readEnvFile && !existsSync(path)) {
    throw new WhatsAppDispatchE2EError(
      'O arquivo .env da raiz e obrigatorio para o teste E2E',
      'WHATSAPP_E2E_ENV_FILE_MISSING',
    );
  }
  const fileEnv = parseDotEnv(reader(path));
  return { ...fileEnv, ...(env ?? process.env) };
};

const validateExecutionMode = (args: readonly string[]): E2EExecutionMode => {
  if (args.length === 0) return 'dry-run';
  const direct =
    args.length === 1 && args[0] === WHATSAPP_DISPATCH_E2E_REAL_FLAG;
  const pnpmForwarded =
    args.length === 2 &&
    args[0] === '--' &&
    args[1] === WHATSAPP_DISPATCH_E2E_REAL_FLAG;
  if (direct || pnpmForwarded) return 'confirmed';
  throw new WhatsAppDispatchE2EError(
    'Flag invalida para o teste E2E controlado',
    'WHATSAPP_E2E_FLAG_INVALID',
  );
};

const validateControlledConfig = (config: AppEnv) => {
  if (config.WHATSAPP_PROVIDER !== 'evolution') {
    throw new WhatsAppDispatchE2EError(
      'O teste E2E exige WHATSAPP_PROVIDER=evolution',
      'WHATSAPP_E2E_PROVIDER_REQUIRED',
    );
  }
  if (config.EVOLUTION_API_URL !== EXPECTED_EVOLUTION_URL) {
    throw new WhatsAppDispatchE2EError(
      'O teste E2E exige a Evolution API local esperada',
      'WHATSAPP_E2E_EVOLUTION_URL_INVALID',
    );
  }
  if (config.EVOLUTION_INSTANCE_NAME !== EXPECTED_EVOLUTION_INSTANCE) {
    throw new WhatsAppDispatchE2EError(
      'O teste E2E exige a instancia local controlada',
      'WHATSAPP_E2E_INSTANCE_INVALID',
    );
  }
  if (!config.EVOLUTION_SAFE_MODE) {
    throw new WhatsAppDispatchE2EError(
      'O teste E2E exige EVOLUTION_SAFE_MODE=true',
      'WHATSAPP_E2E_SAFE_MODE_REQUIRED',
    );
  }
  if (config.SCHEDULER_ENABLED) {
    throw new WhatsAppDispatchE2EError(
      'O teste E2E exige SCHEDULER_ENABLED=false',
      'WHATSAPP_E2E_SCHEDULER_MUST_BE_DISABLED',
    );
  }
  if (config.EVOLUTION_ALLOWED_DESTINATIONS.length !== 1) {
    throw new WhatsAppDispatchE2EError(
      'O teste E2E exige exatamente um destino permitido',
      'WHATSAPP_E2E_SINGLE_DESTINATION_REQUIRED',
    );
  }
  if (config.EVOLUTION_MAX_MESSAGES_PER_BOOT !== 1) {
    throw new WhatsAppDispatchE2EError(
      'O teste E2E exige EVOLUTION_MAX_MESSAGES_PER_BOOT=1',
      'WHATSAPP_E2E_LIMIT_MUST_BE_ONE',
    );
  }

  const destination = normalizeEvolutionDestination(
    config.EVOLUTION_ALLOWED_DESTINATIONS[0],
  );
  return {
    destination,
    maskedDestination: maskEvolutionDestination(destination),
  };
};

export const runWhatsAppDispatchE2EPreflight = async (
  config: AppEnv,
): Promise<WhatsAppDispatchE2EPreflight> => {
  const prisma = createPrismaClient();
  const redis = createRedisConnection(config.REDIS_URL);
  try {
    const rootResponse = await fetch(`${config.EVOLUTION_API_URL}/`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!rootResponse.ok) {
      throw new WhatsAppDispatchE2EError(
        'Evolution API indisponivel',
        'WHATSAPP_E2E_EVOLUTION_UNAVAILABLE',
      );
    }
    const rootBody = (await rootResponse.json()) as { version?: unknown };
    if (rootBody.version !== '2.3.7') {
      throw new WhatsAppDispatchE2EError(
        'Versao inesperada da Evolution API',
        'WHATSAPP_E2E_EVOLUTION_VERSION_INVALID',
      );
    }

    const instanceResponse = await fetch(
      `${config.EVOLUTION_API_URL}/instance/connectionState/${encodeURIComponent(config.EVOLUTION_INSTANCE_NAME as string)}`,
      {
        headers: { apikey: config.EVOLUTION_API_KEY as string },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!instanceResponse.ok) {
      throw new WhatsAppDispatchE2EError(
        'Nao foi possivel validar a instancia controlada',
        'WHATSAPP_E2E_INSTANCE_UNAVAILABLE',
      );
    }
    const instanceState = parseEvolutionConnectionState(
      await instanceResponse.json(),
    );
    if (instanceState !== 'open') {
      throw new WhatsAppDispatchE2EError(
        'A instancia controlada nao esta conectada',
        'WHATSAPP_E2E_INSTANCE_NOT_OPEN',
      );
    }

    await prisma.productLead.count();
    if ((await redis.ping()) !== 'PONG') {
      throw new WhatsAppDispatchE2EError(
        'Redis principal indisponivel',
        'WHATSAPP_E2E_REDIS_UNAVAILABLE',
      );
    }

    return {
      databaseAvailable: true,
      redisAvailable: true,
      evolutionAvailable: true,
      evolutionVersion: '2.3.7',
      instanceStatus: 'open',
    };
  } finally {
    await Promise.allSettled([
      prisma.$disconnect(),
      redis.quit().then(() => undefined),
    ]);
  }
};

const assertProduct = (product: ProductLeadRecord) => {
  if (
    product.providerProductId !== WHATSAPP_DISPATCH_E2E_IDS.providerProductId ||
    product.nome !== E2E_PRODUCT_NAME
  ) {
    throw new WhatsAppDispatchE2EError(
      'Registro E2E de produto ambiguo; investigacao manual obrigatoria',
      'WHATSAPP_E2E_PRODUCT_AMBIGUOUS',
      { investigationRequired: true },
    );
  }
  return product;
};

const ensureProduct = async (repositories: ApplicationRepositories) => {
  const existing = await repositories.products.findByProviderProductId(
    WHATSAPP_DISPATCH_E2E_IDS.providerProductId,
  );
  if (existing) {
    const product = await repositories.products.findById(existing.id);
    if (!product) {
      throw new WhatsAppDispatchE2EError(
        'Registro E2E de produto inconsistente',
        'WHATSAPP_E2E_PRODUCT_INCONSISTENT',
        { investigationRequired: true },
      );
    }
    return assertProduct(product);
  }

  try {
    return await repositories.products.create({
      providerProductId: WHATSAPP_DISPATCH_E2E_IDS.providerProductId,
      nome: E2E_PRODUCT_NAME,
      categoria: 'E2E TEST',
      preco: 0,
      desconto: 0,
      nota: 0,
      vendidos: 0,
      comissao: 0,
      loja: 'E2E TEST',
      urlImagem: 'https://example.invalid/e2e-controlled-product.png',
      url: null,
      title: E2E_PRODUCT_NAME,
    });
  } catch {
    const concurrent = await repositories.products.findByProviderProductId(
      WHATSAPP_DISPATCH_E2E_IDS.providerProductId,
    );
    const product = concurrent
      ? await repositories.products.findById(concurrent.id)
      : null;
    if (!product)
      throw new WhatsAppDispatchE2EError(
        'Falha segura ao criar o produto E2E',
        'WHATSAPP_E2E_PRODUCT_CREATE_FAILED',
        { investigationRequired: true },
      );
    return assertProduct(product);
  }
};

const assertCopy = (copy: GeneratedCopyRecord, productId: string) => {
  if (
    copy.id !== WHATSAPP_DISPATCH_E2E_IDS.copyId ||
    copy.productId !== productId ||
    copy.titulo !== E2E_COPY_TITLE ||
    copy.mensagem !== WHATSAPP_DISPATCH_E2E_MESSAGE ||
    copy.cta !== '' ||
    copy.hashtags !== ''
  ) {
    throw new WhatsAppDispatchE2EError(
      'Registro E2E de copy ambiguo; investigacao manual obrigatoria',
      'WHATSAPP_E2E_COPY_AMBIGUOUS',
      { investigationRequired: true },
    );
  }
  return copy;
};

const ensureCopy = async (
  repositories: ApplicationRepositories,
  productId: string,
) => {
  const existing = await repositories.generatedCopies.findById(
    WHATSAPP_DISPATCH_E2E_IDS.copyId,
  );
  if (existing) return assertCopy(existing, productId);

  try {
    return await repositories.generatedCopies.create({
      id: WHATSAPP_DISPATCH_E2E_IDS.copyId,
      productId,
      titulo: E2E_COPY_TITLE,
      mensagem: WHATSAPP_DISPATCH_E2E_MESSAGE,
      cta: '',
      hashtags: '',
    });
  } catch {
    const concurrent = await repositories.generatedCopies.findById(
      WHATSAPP_DISPATCH_E2E_IDS.copyId,
    );
    if (!concurrent) {
      throw new WhatsAppDispatchE2EError(
        'Falha segura ao criar a copy E2E',
        'WHATSAPP_E2E_COPY_CREATE_FAILED',
        { investigationRequired: true },
      );
    }
    return assertCopy(concurrent, productId);
  }
};

const assertDestination = (
  record: WhatsAppDestinationRecord,
  destination: string,
) => {
  if (
    record.id !== WHATSAPP_DISPATCH_E2E_IDS.destinationId ||
    record.name !== E2E_DESTINATION_NAME ||
    normalizeEvolutionDestination(record.destination) !== destination ||
    record.active !== false
  ) {
    throw new WhatsAppDispatchE2EError(
      'Registro E2E de destino ambiguo; investigacao manual obrigatoria',
      'WHATSAPP_E2E_DESTINATION_AMBIGUOUS',
      { investigationRequired: true },
    );
  }
  return record;
};

const ensureDestination = async (
  repositories: ApplicationRepositories,
  destination: string,
) => {
  const existing = await repositories.whatsappDestinations.findById(
    WHATSAPP_DISPATCH_E2E_IDS.destinationId,
  );
  if (existing) return assertDestination(existing, destination);

  try {
    return await repositories.whatsappDestinations.create({
      id: WHATSAPP_DISPATCH_E2E_IDS.destinationId,
      name: E2E_DESTINATION_NAME,
      destination,
      active: false,
    });
  } catch {
    const concurrent = await repositories.whatsappDestinations.findById(
      WHATSAPP_DISPATCH_E2E_IDS.destinationId,
    );
    if (!concurrent) {
      throw new WhatsAppDispatchE2EError(
        'Falha segura ao criar o destino E2E',
        'WHATSAPP_E2E_DESTINATION_CREATE_FAILED',
        { investigationRequired: true },
      );
    }
    return assertDestination(concurrent, destination);
  }
};

const previousDispatchError = (dispatch: WhatsAppDispatchDetails) =>
  new WhatsAppDispatchE2EError(
    'Ja existe uma execucao E2E anterior; novo envio bloqueado',
    'WHATSAPP_E2E_PREVIOUS_DISPATCH_BLOCKED',
    {
      dispatchId: dispatch.id,
      status: String(dispatch.status),
      investigationRequired: dispatch.status !== 'SENT',
    },
  );

export const prepareControlledE2ERecords = async (
  repositories: ApplicationRepositories,
  destination: string,
) => {
  const fixedDispatch =
    await repositories.whatsappDispatches.findByIdWithDetails(
      WHATSAPP_DISPATCH_E2E_IDS.dispatchId,
    );
  if (fixedDispatch) throw previousDispatchError(fixedDispatch);

  const product = await ensureProduct(repositories);
  const previousForProduct = await repositories.whatsappDispatches.list({
    productId: product.id,
  });
  if (previousForProduct.length > 0) {
    throw previousDispatchError(previousForProduct[0]);
  }

  const copy = await ensureCopy(repositories, product.id);
  const controlledDestination = await ensureDestination(
    repositories,
    destination,
  );
  const dispatch = await repositories.whatsappDispatches.createPending({
    id: WHATSAPP_DISPATCH_E2E_IDS.dispatchId,
    productId: product.id,
    generatedCopyId: copy.id,
    destinationId: controlledDestination.id,
  });
  if (!dispatch) {
    const concurrent =
      await repositories.whatsappDispatches.findByIdWithDetails(
        WHATSAPP_DISPATCH_E2E_IDS.dispatchId,
      );
    if (concurrent) throw previousDispatchError(concurrent);
    throw new WhatsAppDispatchE2EError(
      'Estado ambiguo ao criar o dispatch E2E',
      'WHATSAPP_E2E_DISPATCH_CREATE_AMBIGUOUS',
      { investigationRequired: true },
    );
  }

  return { product, copy, destination: controlledDestination, dispatch };
};

const safeWorkerLog = (data: unknown): Record<string, unknown> => {
  if (!data || typeof data !== 'object')
    return { event: 'whatsapp.e2e.worker' };
  const source = data as Record<string, unknown>;
  return {
    event:
      typeof source.event === 'string' ? source.event : 'whatsapp.e2e.worker',
    ...(typeof source.dispatchId === 'string'
      ? { dispatchId: source.dispatchId }
      : {}),
    ...(typeof source.code === 'string' ? { code: source.code } : {}),
  };
};

export const createRealWhatsAppDispatchE2ERuntime = async (
  config: AppEnv,
  logger: E2ELogger,
): Promise<WhatsAppDispatchE2ERuntime> => {
  const prisma = createPrismaClient();
  const redis = createRedisConnection(config.REDIS_URL);
  const queueEventsRedis = createRedisConnection(config.REDIS_URL);
  const whatsappQueue = createWhatsAppDispatchQueue(redis);
  const pipelineQueue = createProductPipelineQueue(redis);
  const queueEvents = new QueueEvents(QUEUE_NAMES.whatsappDispatch, {
    connection: queueEventsRedis,
  });
  const workerLogger = {
    info: (data: unknown) => logger.info(safeWorkerLog(data)),
    error: (data: unknown) => logger.error(safeWorkerLog(data)),
  };
  const provider = createWhatsAppProvider(config, { logger: workerLogger });
  const repositories = createPrismaRepositories(prisma);
  let worker: ReturnType<typeof createWhatsAppDispatchWorker> | undefined;
  let closePromise: Promise<void> | undefined;

  return {
    repositories,
    async assertNoCompetingWork() {
      const [whatsappWorkers, pipelineWorkers, whatsappActive, pipelineActive] =
        await Promise.all([
          whatsappQueue.getWorkers(),
          pipelineQueue.getWorkers(),
          whatsappQueue.getActiveCount(),
          pipelineQueue.getActiveCount(),
        ]);
      if (
        whatsappWorkers.length > 0 ||
        pipelineWorkers.length > 0 ||
        whatsappActive > 0 ||
        pipelineActive > 0
      ) {
        throw new WhatsAppDispatchE2EError(
          'Ha worker ou pipeline ativo; execucao E2E bloqueada',
          'WHATSAPP_E2E_COMPETING_WORK_BLOCKED',
        );
      }
    },
    findJob: (jobId) => whatsappQueue.getJob(jobId),
    async enqueue(dispatchId, jobId) {
      await queueEvents.waitUntilReady();
      return enqueueControlledE2EWhatsAppDispatch(
        whatsappQueue,
        { dispatchId },
        jobId,
      );
    },
    async startWorker() {
      if (worker) {
        throw new WhatsAppDispatchE2EError(
          'O worker E2E ja foi iniciado',
          'WHATSAPP_E2E_WORKER_ALREADY_STARTED',
        );
      }
      worker = createWhatsAppDispatchWorker(config.REDIS_URL, {
        connection: redis,
        prisma,
        logger: workerLogger,
        whatsAppProvider: provider,
        messageBuilder: () => WHATSAPP_DISPATCH_E2E_MESSAGE,
        reservationLeaseMilliseconds:
          config.COMMERCIAL_EXECUTION_LEASE_SECONDS * 1000,
      });
      await worker.whatsappDispatchWorker.waitUntilReady();
    },
    waitForJob: (job, timeoutMs) =>
      job.waitUntilFinished(queueEvents, timeoutMs).then(() => undefined),
    async queryDispatchApi(dispatchId) {
      const app = await buildApp({
        logger: false,
        prisma,
        pipelineQueue: {
          add: async () => {
            throw new Error('Pipeline indisponivel no teste E2E');
          },
          close: async () => undefined,
        },
      });
      try {
        const response = await app.inject({
          method: 'GET',
          url: `/whatsapp/dispatches/${encodeURIComponent(dispatchId)}`,
        });
        if (response.statusCode !== 200) {
          throw new WhatsAppDispatchE2EError(
            'Falha ao consultar o dispatch pela API',
            'WHATSAPP_E2E_API_QUERY_FAILED',
            { dispatchId, investigationRequired: true },
          );
        }
        return response.json() as WhatsAppDispatchDetails;
      } finally {
        await app.close();
      }
    },
    close(force = false) {
      closePromise ??= (async () => {
        await Promise.allSettled([
          worker?.close(force) ?? Promise.resolve(),
          queueEvents.close(),
          whatsappQueue.close(),
          pipelineQueue.close(),
        ]);
        await Promise.allSettled([
          queueEventsRedis.quit().then(() => undefined),
          redis.quit().then(() => undefined),
          prisma.$disconnect(),
        ]);
      })();
      return closePromise;
    },
  };
};

const validateFinalDispatch = (
  dispatch: WhatsAppDispatchDetails,
  apiDispatch: WhatsAppDispatchDetails,
  destination: string,
) => {
  if (
    dispatch.id !== WHATSAPP_DISPATCH_E2E_IDS.dispatchId ||
    apiDispatch.id !== dispatch.id ||
    apiDispatch.status !== dispatch.status ||
    apiDispatch.attemptCount !== dispatch.attemptCount ||
    apiDispatch.destination.destination !==
      maskEvolutionDestination(destination) ||
    apiDispatch.generatedCopy.titulo !== E2E_COPY_TITLE ||
    apiDispatch.generatedCopy.mensagem !== WHATSAPP_DISPATCH_E2E_MESSAGE
  ) {
    throw new WhatsAppDispatchE2EError(
      'Resultado do dispatch E2E e ambiguo',
      'WHATSAPP_E2E_RESULT_AMBIGUOUS',
      {
        dispatchId: dispatch.id,
        status: String(dispatch.status),
        investigationRequired: true,
      },
    );
  }
};

export const executeControlledWhatsAppDispatchE2E = async ({
  runtime,
  destination,
  maskedDestination,
  timeoutMs = DEFAULT_JOB_TIMEOUT_MS,
}: {
  runtime: WhatsAppDispatchE2ERuntime;
  destination: string;
  maskedDestination: string;
  timeoutMs?: number;
}): Promise<
  | { exitCode: 0; output: WhatsAppDispatchE2EConfirmedOutput }
  | { exitCode: 1; output: WhatsAppDispatchE2EConfirmedOutput }
> => {
  let forceClose = false;
  try {
    await runtime.assertNoCompetingWork();
    if (await runtime.findJob(WHATSAPP_DISPATCH_E2E_IDS.jobId)) {
      throw new WhatsAppDispatchE2EError(
        'Ja existe um job E2E anterior; novo envio bloqueado',
        'WHATSAPP_E2E_PREVIOUS_JOB_BLOCKED',
        { investigationRequired: true },
      );
    }

    const records = await prepareControlledE2ERecords(
      runtime.repositories,
      destination,
    );
    const job = await runtime.enqueue(
      records.dispatch.id,
      WHATSAPP_DISPATCH_E2E_IDS.jobId,
    );
    await runtime.startWorker();

    try {
      await runtime.waitForJob(job, timeoutMs);
    } catch {
      forceClose = true;
    }

    const dispatch =
      await runtime.repositories.whatsappDispatches.findByIdWithDetails(
        records.dispatch.id,
      );
    if (!dispatch) {
      throw new WhatsAppDispatchE2EError(
        'Dispatch E2E nao encontrado apos o job',
        'WHATSAPP_E2E_RESULT_MISSING',
        { dispatchId: records.dispatch.id, investigationRequired: true },
      );
    }
    const apiDispatch = await runtime.queryDispatchApi(dispatch.id);
    validateFinalDispatch(dispatch, apiDispatch, destination);

    const success =
      dispatch.status === 'SENT' &&
      dispatch.attemptCount === 1 &&
      Boolean(dispatch.externalMessageId) &&
      Boolean(dispatch.sentAt) &&
      !dispatch.errorMessage;
    const failedSafely =
      dispatch.status === 'FAILED' && dispatch.attemptCount === 1;
    if (!success && !failedSafely) forceClose = true;

    const output: WhatsAppDispatchE2EConfirmedOutput = {
      mode: 'confirmed',
      dispatchId: dispatch.id,
      jobId: String(job.id ?? WHATSAPP_DISPATCH_E2E_IDS.jobId),
      jobAttempts: 1,
      retryEnabled: false,
      status: String(dispatch.status),
      attemptCount: dispatch.attemptCount,
      externalMessageIdPresent: Boolean(dispatch.externalMessageId),
      sentAtPresent: Boolean(dispatch.sentAt),
      apiQueryValidated: true,
      destination: maskedDestination,
      investigationRequired: !success,
      messagesSent: success ? 1 : 'unknown',
    };
    return { exitCode: success ? 0 : 1, output };
  } finally {
    await runtime.close(forceClose);
  }
};

const safeFailure = (
  error: unknown,
  maskedDestination?: string,
): WhatsAppDispatchE2EFailureOutput => {
  if (error instanceof WhatsAppDispatchE2EError) {
    return {
      code: error.code,
      message: error.message,
      ...error.details,
      ...(maskedDestination && !error.details.destination
        ? { destination: maskedDestination }
        : {}),
    };
  }
  return {
    code: 'WHATSAPP_E2E_BLOCKED',
    message: 'Teste E2E bloqueado por configuracao ou estado inseguro',
    ...(maskedDestination ? { destination: maskedDestination } : {}),
  };
};

export const runWhatsAppDispatchE2E = async (
  options: WhatsAppDispatchE2EOptions = {},
): Promise<WhatsAppDispatchE2ERunResult> => {
  const logger = options.logger ?? consoleLogger;
  let maskedDestination: string | undefined;

  try {
    const mode = validateExecutionMode(options.args ?? process.argv.slice(2));
    const env = loadLocalEnvironment(options);
    if (isCiActive(env.CI)) {
      throw new WhatsAppDispatchE2EError(
        'O teste E2E nao pode executar em CI',
        'WHATSAPP_E2E_CI_BLOCKED',
      );
    }
    const config = loadConfig(env);
    const destinationConfig = validateControlledConfig(config);
    maskedDestination = destinationConfig.maskedDestination;
    const preflight = await (
      options.preflight ?? runWhatsAppDispatchE2EPreflight
    )(config);

    if (mode === 'dry-run') {
      const output: WhatsAppDispatchE2EDryRunOutput = {
        mode: 'dry-run',
        provider: 'evolution',
        safeMode: true,
        destination: maskedDestination,
        schedulerEnabled: false,
        ...preflight,
        messageWillBeSent: false,
      };
      logger.info(output);
      return { exitCode: 0, output };
    }

    const runtime = await (
      options.runtimeFactory ?? createRealWhatsAppDispatchE2ERuntime
    )(config, logger);
    const result = await executeControlledWhatsAppDispatchE2E({
      runtime,
      destination: destinationConfig.destination,
      maskedDestination,
      timeoutMs: options.jobTimeoutMs,
    });
    (result.exitCode === 0 ? logger.info : logger.error)(result.output);
    return result;
  } catch (error) {
    const output = safeFailure(error, maskedDestination);
    logger.error(output);
    return { exitCode: 1, output };
  }
};

export const CONTROLLED_E2E_JOB_OPTIONS =
  CONTROLLED_E2E_WHATSAPP_DISPATCH_JOB_OPTIONS;

const isDirectExecution =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  const result = await runWhatsAppDispatchE2E();
  process.exitCode = result.exitCode;
}
