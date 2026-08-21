import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { QueueEvents, type Job } from 'bullmq';
import { loadConfig, type AppEnv } from '@shopee-auto-affiliate-ai/config';
import { createPrismaClient } from '@shopee-auto-affiliate-ai/database';
import {
  createWhatsAppProvider,
  EvolutionApiGroupDirectoryProvider,
  fingerprintWhatsAppGroupId,
  normalizeWhatsAppGroupId,
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
  WhatsAppDispatchDetails,
  WhatsAppGroupRecord,
} from '../../api/src/repositories';
import { WhatsAppGroupSendPolicy } from '../../api/src/whatsapp-group-send-policy';
import { createWhatsAppDispatchWorker } from './whatsapp-dispatch-worker';
import { parseLocalDotEnv } from './local-env';

export { parseLocalDotEnv as parseGroupTestDotEnv } from './local-env';

export const WHATSAPP_GROUP_TEST_REAL_FLAG = '--confirm-one-real-group-message';
export const WHATSAPP_GROUP_TEST_MESSAGE =
  'Teste controlado do sistema Afiliado Shopee no grupo autorizado. Nenhuma ação é necessária.';
export const WHATSAPP_GROUP_TEST_IDS = {
  providerProductId: 'controlled-whatsapp-group-test-v1',
  copyId: 'controlled-whatsapp-group-test-v1-copy',
  dispatchId: 'controlled-whatsapp-group-test-v1-dispatch',
  jobId: 'controlled-whatsapp-group-test-v1-job',
} as const;

const TEST_PRODUCT_NAME = 'GROUP TEST — Produto controlado';
const TEST_COPY_TITLE = 'Teste controlado de grupo';
const EXPECTED_EVOLUTION_URL = 'http://localhost:8080';
const EXPECTED_EVOLUTION_INSTANCE = 'afiliado-shopee-local';
const ROOT_ENV_PATH = fileURLToPath(new URL('../../../.env', import.meta.url));
const DEFAULT_JOB_TIMEOUT_MS = 30_000;

type GroupTestLogger = {
  info(data: Record<string, unknown>): void;
  error(data: Record<string, unknown>): void;
};

type GroupTestMode = 'dry-run' | 'confirmed';

type SelectedGroup = {
  id: string;
  name: string;
  fingerprint: string;
  externalGroupId: string;
};

export type WhatsAppGroupTestPreflight = {
  databaseAvailable: true;
  redisAvailable: true;
  evolutionAvailable: true;
  evolutionVersion: '2.3.7';
  instanceStatus: 'open';
  discoveredGroupCount: number;
  storedGroups: WhatsAppGroupRecord[];
  remoteExternalGroupIds: ReadonlySet<string>;
};

export type WhatsAppGroupTestDryRunOutput = {
  mode: 'dry-run';
  safeMode: boolean;
  masterSwitchEnabled: boolean;
  maxMessagesPerRun: number;
  schedulerEnabled: boolean;
  databaseAvailable: true;
  redisAvailable: true;
  evolutionAvailable: true;
  evolutionVersion: '2.3.7';
  instanceStatus: 'open';
  discoveredGroupCount: number;
  activeAvailableGroupCount: number;
  group?: { name: string; fingerprint: string };
  readyForRealSend: boolean;
  messageWillBeSent: false;
};

export type WhatsAppGroupTestConfirmedOutput = {
  mode: 'confirmed';
  fingerprint: string;
  dispatchId: string;
  jobId: string;
  jobAttempts: 1;
  retryEnabled: false;
  status: string;
  attemptCount: number;
  apiQueryValidated: boolean;
  investigationRequired: boolean;
  messagesSent: 0 | 1 | 'unknown';
};

export type WhatsAppGroupTestFailureOutput = {
  code: string;
  message: string;
  fingerprint?: string;
  investigationRequired?: boolean;
};

export type WhatsAppGroupTestResult =
  | { exitCode: 0; output: WhatsAppGroupTestDryRunOutput }
  | { exitCode: 0; output: WhatsAppGroupTestConfirmedOutput }
  | { exitCode: 1; output: WhatsAppGroupTestFailureOutput }
  | { exitCode: 1; output: WhatsAppGroupTestConfirmedOutput };

type GroupTestJob = Pick<Job<WhatsAppDispatchJob>, 'id' | 'waitUntilFinished'>;

export type WhatsAppGroupTestRuntime = {
  assertNoCompetingWork(): Promise<void>;
  findJob(jobId: string): Promise<unknown | null>;
  prepare(group: SelectedGroup): Promise<{ dispatchId: string }>;
  enqueue(dispatchId: string, jobId: string): Promise<GroupTestJob>;
  startWorker(): Promise<void>;
  waitForJob(job: GroupTestJob, timeoutMs: number): Promise<void>;
  readDispatch(dispatchId: string): Promise<WhatsAppDispatchDetails | null>;
  queryDispatchApi(dispatchId: string): Promise<WhatsAppDispatchDetails>;
  close(force?: boolean): Promise<void>;
};

type WhatsAppGroupTestOptions = {
  args?: readonly string[];
  env?: NodeJS.ProcessEnv;
  envPath?: string;
  readEnvFile?: (path: string) => string;
  logger?: GroupTestLogger;
  preflight?: (config: AppEnv) => Promise<WhatsAppGroupTestPreflight>;
  runtimeFactory?: (
    config: AppEnv,
    logger: GroupTestLogger,
  ) => Promise<WhatsAppGroupTestRuntime>;
  jobTimeoutMs?: number;
};

const consoleLogger: GroupTestLogger = {
  info: (data) => console.log(JSON.stringify(data)),
  error: (data) => console.error(JSON.stringify(data)),
};

class WhatsAppGroupTestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly details: {
      fingerprint?: string;
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

const loadLocalEnvironment = (options: WhatsAppGroupTestOptions) => {
  const path = options.envPath ?? ROOT_ENV_PATH;
  const reader =
    options.readEnvFile ?? ((target: string) => readFileSync(target, 'utf8'));
  if (!options.readEnvFile && !existsSync(path)) {
    throw new WhatsAppGroupTestError(
      'O arquivo .env da raiz e obrigatorio para o teste de grupos',
      'WHATSAPP_GROUP_TEST_ENV_MISSING',
    );
  }
  return {
    ...parseLocalDotEnv(reader(path)),
    ...(options.env ?? process.env),
  };
};

export const validateWhatsAppGroupTestArgs = (
  args: readonly string[],
): GroupTestMode => {
  if (args.length === 0) return 'dry-run';
  if (args.length === 1 && args[0] === WHATSAPP_GROUP_TEST_REAL_FLAG) {
    return 'confirmed';
  }
  if (
    args.length === 2 &&
    args[0] === '--' &&
    args[1] === WHATSAPP_GROUP_TEST_REAL_FLAG
  ) {
    return 'confirmed';
  }
  throw new WhatsAppGroupTestError(
    'Flag ou argumento invalido para o teste controlado de grupos',
    'WHATSAPP_GROUP_TEST_FLAG_INVALID',
  );
};

const validateBaseConfig = (config: AppEnv) => {
  if (config.WHATSAPP_PROVIDER !== 'evolution') {
    throw new WhatsAppGroupTestError(
      'O teste de grupos exige WHATSAPP_PROVIDER=evolution',
      'WHATSAPP_GROUP_TEST_PROVIDER_REQUIRED',
    );
  }
  if (config.EVOLUTION_API_URL !== EXPECTED_EVOLUTION_URL) {
    throw new WhatsAppGroupTestError(
      'O teste de grupos exige a Evolution API local esperada',
      'WHATSAPP_GROUP_TEST_URL_INVALID',
    );
  }
  if (config.EVOLUTION_INSTANCE_NAME !== EXPECTED_EVOLUTION_INSTANCE) {
    throw new WhatsAppGroupTestError(
      'O teste de grupos exige a instancia local controlada',
      'WHATSAPP_GROUP_TEST_INSTANCE_INVALID',
    );
  }
  if (!config.EVOLUTION_SAFE_MODE) {
    throw new WhatsAppGroupTestError(
      'Safe mode e obrigatorio no teste de grupos',
      'WHATSAPP_GROUP_TEST_SAFE_MODE_REQUIRED',
    );
  }
  if (config.SCHEDULER_ENABLED) {
    throw new WhatsAppGroupTestError(
      'Scheduler deve permanecer desativado no teste de grupos',
      'WHATSAPP_GROUP_TEST_SCHEDULER_BLOCKED',
    );
  }
  if (config.WHATSAPP_GROUP_MAX_MESSAGES_PER_RUN !== 1) {
    throw new WhatsAppGroupTestError(
      'O limite do teste de grupos deve ser exatamente um',
      'WHATSAPP_GROUP_TEST_LIMIT_INVALID',
    );
  }
};

export const runWhatsAppGroupTestPreflight = async (
  config: AppEnv,
): Promise<WhatsAppGroupTestPreflight> => {
  const prisma = createPrismaClient();
  const redis = createRedisConnection(config.REDIS_URL);
  try {
    const rootResponse = await fetch(`${config.EVOLUTION_API_URL}/`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!rootResponse.ok) {
      throw new WhatsAppGroupTestError(
        'Evolution API indisponivel',
        'WHATSAPP_GROUP_TEST_EVOLUTION_UNAVAILABLE',
      );
    }
    const root = (await rootResponse.json()) as { version?: unknown };
    if (root.version !== '2.3.7') {
      throw new WhatsAppGroupTestError(
        'Versao inesperada da Evolution API',
        'WHATSAPP_GROUP_TEST_VERSION_INVALID',
      );
    }

    const instanceResponse = await fetch(
      `${config.EVOLUTION_API_URL}/instance/connectionState/${encodeURIComponent(config.EVOLUTION_INSTANCE_NAME as string)}`,
      {
        headers: { apikey: config.EVOLUTION_API_KEY as string },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (
      !instanceResponse.ok ||
      parseEvolutionConnectionState(await instanceResponse.json()) !== 'open'
    ) {
      throw new WhatsAppGroupTestError(
        'A instancia controlada nao esta conectada',
        'WHATSAPP_GROUP_TEST_INSTANCE_NOT_OPEN',
      );
    }

    const provider = new EvolutionApiGroupDirectoryProvider({
      baseUrl: config.EVOLUTION_API_URL as string,
      apiKey: config.EVOLUTION_API_KEY as string,
      instanceName: config.EVOLUTION_INSTANCE_NAME as string,
    });
    const remoteGroups = await provider.listGroups();
    const repositories = createPrismaRepositories(prisma);
    const storedGroups = await repositories.whatsappGroups.listByInstance(
      config.EVOLUTION_INSTANCE_NAME as string,
    );
    await prisma.productLead.count();
    if ((await redis.ping()) !== 'PONG') {
      throw new WhatsAppGroupTestError(
        'Redis principal indisponivel',
        'WHATSAPP_GROUP_TEST_REDIS_UNAVAILABLE',
      );
    }
    return {
      databaseAvailable: true,
      redisAvailable: true,
      evolutionAvailable: true,
      evolutionVersion: '2.3.7',
      instanceStatus: 'open',
      discoveredGroupCount: remoteGroups.length,
      storedGroups,
      remoteExternalGroupIds: new Set(
        remoteGroups.map((group) => group.externalGroupId),
      ),
    };
  } finally {
    await Promise.allSettled([
      prisma.$disconnect(),
      redis.quit().then(() => undefined),
    ]);
  }
};

const selectAuthorizedGroup = (
  config: AppEnv,
  preflight: WhatsAppGroupTestPreflight,
) => {
  const activeAvailable = preflight.storedGroups.filter(
    (group) =>
      group.active &&
      group.available &&
      group.sourceInstanceName === config.EVOLUTION_INSTANCE_NAME &&
      preflight.remoteExternalGroupIds.has(group.destination),
  );
  if (activeAvailable.length !== 1) {
    return { activeAvailableCount: activeAvailable.length } as const;
  }
  const group = activeAvailable[0];
  const externalGroupId = normalizeWhatsAppGroupId(group.destination);
  const fingerprint = fingerprintWhatsAppGroupId(externalGroupId);
  if (group.fingerprint !== fingerprint) {
    throw new WhatsAppGroupTestError(
      'Identidade do grupo autorizado e inconsistente',
      'WHATSAPP_GROUP_TEST_IDENTITY_MISMATCH',
    );
  }
  return {
    activeAvailableCount: 1,
    selected: {
      id: group.id,
      name: group.name,
      fingerprint,
      externalGroupId,
    } satisfies SelectedGroup,
  } as const;
};

const assertProduct = (product: ProductLeadRecord) => {
  if (
    product.providerProductId !== WHATSAPP_GROUP_TEST_IDS.providerProductId ||
    product.nome !== TEST_PRODUCT_NAME
  ) {
    throw new WhatsAppGroupTestError(
      'Produto tecnico do teste de grupos e ambiguo',
      'WHATSAPP_GROUP_TEST_PRODUCT_AMBIGUOUS',
      { investigationRequired: true },
    );
  }
  return product;
};

const ensureProduct = async (repositories: ApplicationRepositories) => {
  const existing = await repositories.products.findByProviderProductId(
    WHATSAPP_GROUP_TEST_IDS.providerProductId,
  );
  if (existing) {
    const product = await repositories.products.findById(existing.id);
    if (!product)
      throw new WhatsAppGroupTestError(
        'Produto tecnico inconsistente',
        'WHATSAPP_GROUP_TEST_PRODUCT_INCONSISTENT',
      );
    return assertProduct(product);
  }
  return repositories.products.create({
    providerProductId: WHATSAPP_GROUP_TEST_IDS.providerProductId,
    nome: TEST_PRODUCT_NAME,
    categoria: 'GROUP TEST',
    preco: 0,
    desconto: 0,
    nota: 0,
    vendidos: 0,
    comissao: 0,
    loja: 'GROUP TEST',
    urlImagem: 'https://example.invalid/group-test-product.png',
    url: null,
    title: TEST_PRODUCT_NAME,
  });
};

const assertCopy = (copy: GeneratedCopyRecord, productId: string) => {
  if (
    copy.id !== WHATSAPP_GROUP_TEST_IDS.copyId ||
    copy.productId !== productId ||
    copy.titulo !== TEST_COPY_TITLE ||
    copy.mensagem !== WHATSAPP_GROUP_TEST_MESSAGE ||
    copy.cta !== '' ||
    copy.hashtags !== ''
  ) {
    throw new WhatsAppGroupTestError(
      'Copy tecnica do teste de grupos e ambigua',
      'WHATSAPP_GROUP_TEST_COPY_AMBIGUOUS',
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
    WHATSAPP_GROUP_TEST_IDS.copyId,
  );
  if (existing) return assertCopy(existing, productId);
  return repositories.generatedCopies.create({
    id: WHATSAPP_GROUP_TEST_IDS.copyId,
    productId,
    titulo: TEST_COPY_TITLE,
    mensagem: WHATSAPP_GROUP_TEST_MESSAGE,
    cta: '',
    hashtags: '',
  });
};

const previousExecution = () =>
  new WhatsAppGroupTestError(
    'Ja existe uma execucao anterior do teste de grupos',
    'WHATSAPP_GROUP_TEST_PREVIOUS_EXECUTION_BLOCKED',
    { investigationRequired: true },
  );

const safeWorkerLog = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object')
    return { event: 'whatsapp.group-test.worker' };
  const data = value as Record<string, unknown>;
  return {
    event:
      typeof data.event === 'string'
        ? data.event
        : 'whatsapp.group-test.worker',
    ...(typeof data.dispatchId === 'string'
      ? { dispatchId: data.dispatchId }
      : {}),
    ...(typeof data.code === 'string' ? { code: data.code } : {}),
    ...(typeof data.fingerprint === 'string'
      ? { fingerprint: data.fingerprint }
      : {}),
  };
};

export const createRealWhatsAppGroupTestRuntime = async (
  config: AppEnv,
  logger: GroupTestLogger,
): Promise<WhatsAppGroupTestRuntime> => {
  const prisma = createPrismaClient();
  const redis = createRedisConnection(config.REDIS_URL);
  const eventsRedis = createRedisConnection(config.REDIS_URL);
  const whatsappQueue = createWhatsAppDispatchQueue(redis);
  const pipelineQueue = createProductPipelineQueue(redis);
  const queueEvents = new QueueEvents(QUEUE_NAMES.whatsappDispatch, {
    connection: eventsRedis,
  });
  const workerLogger = {
    info: (data: unknown) => logger.info(safeWorkerLog(data)),
    error: (data: unknown) => logger.error(safeWorkerLog(data)),
  };
  const provider = createWhatsAppProvider(config, { logger: workerLogger });
  const groupSendPolicy = new WhatsAppGroupSendPolicy({
    enabled: config.WHATSAPP_GROUP_SEND_ENABLED,
    safeMode: config.EVOLUTION_SAFE_MODE,
    instanceName: config.EVOLUTION_INSTANCE_NAME,
  });
  const repositories = createPrismaRepositories(prisma);
  let worker: ReturnType<typeof createWhatsAppDispatchWorker> | undefined;
  let closePromise: Promise<void> | undefined;

  return {
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
        throw new WhatsAppGroupTestError(
          'Ha worker ou pipeline ativo; teste de grupos bloqueado',
          'WHATSAPP_GROUP_TEST_COMPETING_WORK',
        );
      }
    },
    findJob: (jobId) => whatsappQueue.getJob(jobId),
    async prepare(group) {
      if (
        await repositories.whatsappDispatches.findByIdWithDetails(
          WHATSAPP_GROUP_TEST_IDS.dispatchId,
        )
      ) {
        throw previousExecution();
      }
      const persisted = await repositories.whatsappGroups.findById(group.id);
      if (
        !persisted ||
        !persisted.active ||
        !persisted.available ||
        persisted.sourceInstanceName !== config.EVOLUTION_INSTANCE_NAME ||
        persisted.destination !== group.externalGroupId ||
        persisted.fingerprint !== group.fingerprint
      ) {
        throw new WhatsAppGroupTestError(
          'Autorizacao do grupo mudou durante a preparacao',
          'WHATSAPP_GROUP_TEST_AUTHORIZATION_CHANGED',
        );
      }
      const product = await ensureProduct(repositories);
      if (
        (await repositories.whatsappDispatches.list({ productId: product.id }))
          .length > 0
      ) {
        throw previousExecution();
      }
      const copy = await ensureCopy(repositories, product.id);
      const dispatch = await repositories.whatsappDispatches.createPending({
        id: WHATSAPP_GROUP_TEST_IDS.dispatchId,
        productId: product.id,
        generatedCopyId: copy.id,
        destinationId: persisted.id,
      });
      if (!dispatch) throw previousExecution();
      return { dispatchId: dispatch.id };
    },
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
        throw new WhatsAppGroupTestError(
          'Worker controlado ja iniciado',
          'WHATSAPP_GROUP_TEST_WORKER_ALREADY_STARTED',
        );
      }
      worker = createWhatsAppDispatchWorker(config.REDIS_URL, {
        connection: redis,
        prisma,
        logger: workerLogger,
        whatsAppProvider: provider,
        groupSendPolicy,
        messageBuilder: () => WHATSAPP_GROUP_TEST_MESSAGE,
        reservationLeaseMilliseconds:
          config.COMMERCIAL_EXECUTION_LEASE_SECONDS * 1000,
      });
      await worker.whatsappDispatchWorker.waitUntilReady();
    },
    waitForJob: (job, timeoutMs) =>
      job.waitUntilFinished(queueEvents, timeoutMs).then(() => undefined),
    readDispatch: (dispatchId) =>
      repositories.whatsappDispatches.findByIdWithDetails(dispatchId),
    async queryDispatchApi(dispatchId) {
      const app = await buildApp({
        logger: false,
        prisma,
        pipelineQueue: {
          add: async () => {
            throw new Error('Pipeline indisponivel no teste de grupos');
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
          throw new WhatsAppGroupTestError(
            'Falha ao consultar dispatch controlado',
            'WHATSAPP_GROUP_TEST_API_QUERY_FAILED',
            { investigationRequired: true },
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
          eventsRedis.quit().then(() => undefined),
          redis.quit().then(() => undefined),
          prisma.$disconnect(),
        ]);
      })();
      return closePromise;
    },
  };
};

export const executeConfirmedWhatsAppGroupTest = async ({
  runtime,
  group,
  timeoutMs = DEFAULT_JOB_TIMEOUT_MS,
}: {
  runtime: WhatsAppGroupTestRuntime;
  group: SelectedGroup;
  timeoutMs?: number;
}): Promise<
  | { exitCode: 0; output: WhatsAppGroupTestConfirmedOutput }
  | { exitCode: 1; output: WhatsAppGroupTestConfirmedOutput }
> => {
  let forceClose = false;
  try {
    await runtime.assertNoCompetingWork();
    if (await runtime.findJob(WHATSAPP_GROUP_TEST_IDS.jobId)) {
      throw previousExecution();
    }
    const prepared = await runtime.prepare(group);
    const job = await runtime.enqueue(
      prepared.dispatchId,
      WHATSAPP_GROUP_TEST_IDS.jobId,
    );
    await runtime.startWorker();
    try {
      await runtime.waitForJob(job, timeoutMs);
    } catch {
      forceClose = true;
    }
    const dispatch = await runtime.readDispatch(prepared.dispatchId);
    if (!dispatch) {
      throw new WhatsAppGroupTestError(
        'Dispatch controlado nao encontrado',
        'WHATSAPP_GROUP_TEST_RESULT_MISSING',
        { fingerprint: group.fingerprint, investigationRequired: true },
      );
    }
    const apiDispatch = await runtime.queryDispatchApi(dispatch.id);
    const validApi =
      apiDispatch.id === dispatch.id &&
      apiDispatch.status === dispatch.status &&
      apiDispatch.attemptCount === dispatch.attemptCount &&
      apiDispatch.destination.destination === group.fingerprint;
    if (!validApi) {
      throw new WhatsAppGroupTestError(
        'Resultado do dispatch controlado e ambiguo',
        'WHATSAPP_GROUP_TEST_RESULT_AMBIGUOUS',
        { fingerprint: group.fingerprint, investigationRequired: true },
      );
    }
    const success =
      dispatch.status === 'SENT' &&
      dispatch.attemptCount === 1 &&
      Boolean(dispatch.externalMessageId) &&
      Boolean(dispatch.sentAt) &&
      !dispatch.errorMessage;
    const failedSafely =
      dispatch.status === 'FAILED' && dispatch.attemptCount === 1;
    if (!success && !failedSafely) forceClose = true;
    const output: WhatsAppGroupTestConfirmedOutput = {
      mode: 'confirmed',
      fingerprint: group.fingerprint,
      dispatchId: dispatch.id,
      jobId: String(job.id ?? WHATSAPP_GROUP_TEST_IDS.jobId),
      jobAttempts: 1,
      retryEnabled: false,
      status: String(dispatch.status),
      attemptCount: dispatch.attemptCount,
      apiQueryValidated: true,
      investigationRequired: !success,
      messagesSent: success ? 1 : 'unknown',
    };
    return { exitCode: success ? 0 : 1, output };
  } finally {
    await runtime.close(forceClose);
  }
};

const safeFailure = (error: unknown): WhatsAppGroupTestFailureOutput => {
  if (error instanceof WhatsAppGroupTestError) {
    return { code: error.code, message: error.message, ...error.details };
  }
  return {
    code: 'WHATSAPP_GROUP_TEST_BLOCKED',
    message: 'Teste de grupos bloqueado por configuracao ou estado inseguro',
  };
};

export const runWhatsAppGroupTest = async (
  options: WhatsAppGroupTestOptions = {},
): Promise<WhatsAppGroupTestResult> => {
  const logger = options.logger ?? consoleLogger;
  try {
    const mode = validateWhatsAppGroupTestArgs(
      options.args ?? process.argv.slice(2),
    );
    const env = loadLocalEnvironment(options);
    if (isCiActive(env.CI)) {
      throw new WhatsAppGroupTestError(
        'O teste de grupos nao pode executar em CI',
        'WHATSAPP_GROUP_TEST_CI_BLOCKED',
      );
    }
    const config = loadConfig(env);
    validateBaseConfig(config);
    const preflight = await (
      options.preflight ?? runWhatsAppGroupTestPreflight
    )(config);
    const selection = selectAuthorizedGroup(config, preflight);

    if (mode === 'dry-run') {
      const readyForRealSend =
        Boolean(selection.selected) && config.WHATSAPP_GROUP_SEND_ENABLED;
      const output: WhatsAppGroupTestDryRunOutput = {
        mode: 'dry-run',
        safeMode: config.EVOLUTION_SAFE_MODE,
        masterSwitchEnabled: config.WHATSAPP_GROUP_SEND_ENABLED,
        maxMessagesPerRun: config.WHATSAPP_GROUP_MAX_MESSAGES_PER_RUN,
        schedulerEnabled: config.SCHEDULER_ENABLED,
        databaseAvailable: preflight.databaseAvailable,
        redisAvailable: preflight.redisAvailable,
        evolutionAvailable: preflight.evolutionAvailable,
        evolutionVersion: preflight.evolutionVersion,
        instanceStatus: preflight.instanceStatus,
        discoveredGroupCount: preflight.discoveredGroupCount,
        activeAvailableGroupCount: selection.activeAvailableCount,
        ...(selection.selected
          ? {
              group: {
                name: selection.selected.name,
                fingerprint: selection.selected.fingerprint,
              },
            }
          : {}),
        readyForRealSend,
        messageWillBeSent: false,
      };
      logger.info(output);
      return { exitCode: 0, output };
    }

    if (!config.WHATSAPP_GROUP_SEND_ENABLED) {
      throw new WhatsAppGroupTestError(
        'Master switch de grupos esta desativado',
        'WHATSAPP_GROUP_TEST_MASTER_SWITCH_REQUIRED',
      );
    }
    if (!selection.selected || selection.activeAvailableCount !== 1) {
      throw new WhatsAppGroupTestError(
        'O teste exige exatamente um grupo ativo e disponivel',
        'WHATSAPP_GROUP_TEST_SINGLE_GROUP_REQUIRED',
      );
    }
    const runtime = await (
      options.runtimeFactory ?? createRealWhatsAppGroupTestRuntime
    )(config, logger);
    const result = await executeConfirmedWhatsAppGroupTest({
      runtime,
      group: selection.selected,
      timeoutMs: options.jobTimeoutMs,
    });
    (result.exitCode === 0 ? logger.info : logger.error)(result.output);
    return result;
  } catch (error) {
    const output = safeFailure(error);
    logger.error(output);
    return { exitCode: 1, output };
  }
};

export const CONTROLLED_GROUP_TEST_JOB_OPTIONS =
  CONTROLLED_E2E_WHATSAPP_DISPATCH_JOB_OPTIONS;

const isDirectExecution =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  const result = await runWhatsAppGroupTest();
  process.exitCode = result.exitCode;
}
