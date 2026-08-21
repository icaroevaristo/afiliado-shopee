import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { QueueEvents, type Job } from 'bullmq';
import {
  loadConfig,
  parseDotEnv,
  type AppEnv,
} from '@shopee-auto-affiliate-ai/config';
import { createPrismaClient } from '@shopee-auto-affiliate-ai/database';
import {
  createWhatsAppProvider,
  fingerprintWhatsAppGroupId,
  maskEvolutionDestination,
  normalizeEvolutionDestination,
  normalizeWhatsAppGroupId,
  parseEvolutionConnectionState,
} from '@shopee-auto-affiliate-ai/providers';
import {
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
} from '../../api/src/application-services';
import type {
  WhatsAppDispatchDetails,
  WhatsAppDestinationRecord,
  WhatsAppDispatchRecord,
} from '../../api/src/repositories';
import { WhatsAppGroupSendPolicy } from '../../api/src/whatsapp-group-send-policy';
import { createWhatsAppDispatchWorker } from './whatsapp-dispatch-worker';
import { CommercialMessageDraftService, type CommercialMessageDraftCandidate } from '../../api/src/commercial-message-draft-service';

export const COMMERCIAL_IMAGE_DISPATCH_E2E_REAL_FLAG =
  'confirm-one-real-commercial-image-dispatch';

const EXPECTED_EVOLUTION_URL = 'http://localhost:8080';
const EXPECTED_EVOLUTION_INSTANCE = 'afiliado-shopee-local';
const DEFAULT_JOB_TIMEOUT_MS = 30_000;
const ROOT_ENV_PATH = fileURLToPath(new URL('../../../.env', import.meta.url));

type E2ELogger = {
  info(data: Record<string, unknown>): void;
  error(data: Record<string, unknown>): void;
};

export type CommercialImageDispatchE2EPreflight = {
  externalPreflightExecuted: boolean;
  evolutionAvailable?: true;
  evolutionVersion?: '2.3.7';
  instanceStatus?: 'open';
};

export type CommercialImageDispatchE2EDryRunOutput = {
  mode: 'dry-run';
  result: 'GO' | 'NO_GO';
  provider: 'evolution';
  safeMode: true;
  destination: string;
  schedulerEnabled: false;
  messageWillBeSent: false;
  draftDeliveryMode: 'IMAGE';
  warningsCount: number;
  externalPreflightExecuted: boolean;
};

export type CommercialImageDispatchE2EConfirmedOutput = {
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

export type CommercialImageDispatchE2EFailureOutput = {
  code: string;
  message: string;
  dispatchId?: string;
  status?: string;
  destination?: string;
  investigationRequired?: boolean;
};

export type CommercialImageDispatchE2ERunResult =
  | { exitCode: 0; output: CommercialImageDispatchE2EDryRunOutput }
  | { exitCode: 0; output: CommercialImageDispatchE2EConfirmedOutput }
  | { exitCode: 1; output: CommercialImageDispatchE2EFailureOutput }
  | { exitCode: 1; output: CommercialImageDispatchE2EConfirmedOutput };


type E2EJob = Pick<Job<WhatsAppDispatchJob>, 'id' | 'waitUntilFinished'>;

export type CommercialImageDispatchReadRepositories = {
  whatsappDestinations: {
    findById(id: string): Promise<WhatsAppDestinationRecord | null>;
  };
  whatsappDispatches: {
    list(query: { productId: string }): Promise<WhatsAppDispatchRecord[]>;
  };
};

export type CommercialImageDispatchWriteRepositories = CommercialImageDispatchReadRepositories & {
  whatsappDispatches: CommercialImageDispatchReadRepositories['whatsappDispatches'] & {
    findByIdWithDetails(id: string): Promise<WhatsAppDispatchDetails | null>;
    createPending(data: {
      id: string;
      productId: string;
      generatedCopyId: string;
      destinationId: string;
    }): Promise<WhatsAppDispatchRecord | null>;
  };
};

export type CommercialImageDispatchDestinationReader = {
  whatsAppDestination: {
    findUnique(args: { where: { id: string } }): Promise<WhatsAppDestinationRecord | null>;
  };
};

export type CommercialImageDispatchCandidateReader = {
  commercialPromotionCandidate: {
    findUnique(args: {
      where: { id: string };
      include: {
        product: true;
        snapshot: true;
        generatedCopy: true;
      };
    }): Promise<CommercialMessageDraftCandidate | null>;
  };
};

export type CommercialImageDispatchDispatchReader = {
  whatsAppDispatch: {
    findUnique(args: { where: { id: string } }): Promise<WhatsAppDispatchRecord | null>;
  };
};

export type CommercialImageDispatchDispatchWriter = CommercialImageDispatchDispatchReader & {};

export type CommercialImageDispatchE2EReadOnlyRuntime = {
  repositories: CommercialImageDispatchReadRepositories;
  draftService: Pick<CommercialMessageDraftService, 'createDraft'>;
  prisma: CommercialImageDispatchCandidateReader & CommercialImageDispatchDestinationReader;
  close(force?: boolean): Promise<void>;
};

export type CommercialImageDispatchE2ERuntime = Omit<CommercialImageDispatchE2EReadOnlyRuntime, 'repositories' | 'prisma'> & {
  repositories: CommercialImageDispatchWriteRepositories;
  prisma: CommercialImageDispatchCandidateReader & CommercialImageDispatchDestinationReader & CommercialImageDispatchDispatchWriter;
  assertNoCompetingWork(): Promise<void>;
  findJob(jobId: string): Promise<unknown | null>;
  enqueue(dispatchId: string, jobId: string): Promise<E2EJob>;
  startWorker(): Promise<void>;
  waitForJob(job: E2EJob, timeoutMs: number): Promise<void>;
  queryDispatchApi(dispatchId: string): Promise<WhatsAppDispatchDetails>;
};

type CommercialImageDispatchE2EOptions = {
  args?: readonly string[];
  env?: NodeJS.ProcessEnv;
  envPath?: string;
  readEnvFile?: (path: string) => string;
  logger?: E2ELogger;
  preflight?: (config: AppEnv) => Promise<CommercialImageDispatchE2EPreflight>;
  readOnlyRuntimeFactory?: (
    config: AppEnv,
    logger: E2ELogger,
  ) => Promise<CommercialImageDispatchE2EReadOnlyRuntime>;
  runtimeFactory?: (
    config: AppEnv,
    logger: E2ELogger,
  ) => Promise<CommercialImageDispatchE2ERuntime>;
  jobTimeoutMs?: number;
};

const consoleLogger: E2ELogger = {
  info: (data) => console.log(JSON.stringify(data)),
  error: (data) => console.error(JSON.stringify(data)),
};

class CommercialImageDispatchE2EError extends Error {
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
    this.name = 'CommercialImageDispatchE2EError';
  }
}

const isCiActive = (value: string | undefined) =>
  value !== undefined &&
  value.trim() !== '' &&
  value.trim().toLowerCase() !== 'false';

const loadLocalEnvironment = ({
  env,
  envPath,
  readEnvFile,
}: Pick<
  CommercialImageDispatchE2EOptions,
  'env' | 'envPath' | 'readEnvFile'
>) => {
  const path = envPath ?? ROOT_ENV_PATH;
  const reader =
    readEnvFile ?? ((target: string) => readFileSync(target, 'utf8'));
  if (!readEnvFile && !existsSync(path)) {
    throw new CommercialImageDispatchE2EError(
      'O arquivo .env da raiz e obrigatorio para o teste E2E',
      'COMMERCIAL_E2E_ENV_FILE_MISSING',
    );
  }
  const fileEnv = parseDotEnv(reader(path));
  return { ...fileEnv, ...(env ?? process.env) };
};

type CommercialImageDispatchDestinationConfig = {
  type: 'INDIVIDUAL' | 'GROUP';
  destination: string;
  maskedDestination: string;
};

const validateControlledConfig = (config: AppEnv) => {
  if (config.WHATSAPP_PROVIDER !== 'evolution') {
    throw new CommercialImageDispatchE2EError(
      'O teste E2E exige WHATSAPP_PROVIDER=evolution',
      'COMMERCIAL_E2E_PROVIDER_REQUIRED',
    );
  }
  if (config.EVOLUTION_API_URL !== EXPECTED_EVOLUTION_URL) {
    throw new CommercialImageDispatchE2EError(
      'O teste E2E exige a Evolution API local esperada',
      'COMMERCIAL_E2E_EVOLUTION_URL_INVALID',
    );
  }
  if (config.EVOLUTION_INSTANCE_NAME !== EXPECTED_EVOLUTION_INSTANCE) {
    throw new CommercialImageDispatchE2EError(
      'O teste E2E exige a instancia local controlada',
      'COMMERCIAL_E2E_INSTANCE_INVALID',
    );
  }
  if (!config.EVOLUTION_SAFE_MODE) {
    throw new CommercialImageDispatchE2EError(
      'O teste E2E exige EVOLUTION_SAFE_MODE=true',
      'COMMERCIAL_E2E_SAFE_MODE_REQUIRED',
    );
  }
  if (config.SCHEDULER_ENABLED) {
    throw new CommercialImageDispatchE2EError(
      'O teste E2E exige SCHEDULER_ENABLED=false',
      'COMMERCIAL_E2E_SCHEDULER_MUST_BE_DISABLED',
    );
  }
};

const validateIndividualDestinationConfig = (
  config: AppEnv,
  dest: WhatsAppDestinationRecord,
): CommercialImageDispatchDestinationConfig => {
  if (config.EVOLUTION_ALLOWED_DESTINATIONS.length !== 1) {
    throw new CommercialImageDispatchE2EError(
      'O teste E2E exige exatamente um destino permitido',
      'COMMERCIAL_E2E_SINGLE_DESTINATION_REQUIRED',
    );
  }
  if (config.EVOLUTION_MAX_MESSAGES_PER_BOOT !== 1) {
    throw new CommercialImageDispatchE2EError(
      'O teste E2E exige EVOLUTION_MAX_MESSAGES_PER_BOOT=1',
      'COMMERCIAL_E2E_LIMIT_MUST_BE_ONE',
    );
  }
  const destination = normalizeEvolutionDestination(
    config.EVOLUTION_ALLOWED_DESTINATIONS[0],
  );
  if (normalizeEvolutionDestination(dest.destination) !== destination) {
    throw new CommercialImageDispatchE2EError(
      'Destino informado nao e o unico permitido na allowlist',
      'COMMERCIAL_E2E_DESTINATION_NOT_ALLOWED',
    );
  }
  if (!dest.active || !dest.available) {
    throw new CommercialImageDispatchE2EError(
      'Destino inativo ou indisponivel',
      'COMMERCIAL_E2E_DESTINATION_UNAVAILABLE',
    );
  }
  return {
    type: 'INDIVIDUAL',
    destination,
    maskedDestination: maskEvolutionDestination(destination),
  };
};

const validateGroupDestinationConfig = (
  config: AppEnv,
  dest: WhatsAppDestinationRecord,
): CommercialImageDispatchDestinationConfig => {
  if (dest.type !== 'GROUP') {
    throw new CommercialImageDispatchE2EError(
      'O destino de grupo deve possuir type=GROUP',
      'COMMERCIAL_E2E_GROUP_TYPE_REQUIRED',
    );
  }
  if (!config.WHATSAPP_GROUP_SEND_ENABLED) {
    throw new CommercialImageDispatchE2EError(
      'O teste E2E para grupo exige WHATSAPP_GROUP_SEND_ENABLED=true',
      'COMMERCIAL_E2E_GROUP_SEND_REQUIRED',
    );
  }
  if (config.WHATSAPP_GROUP_MAX_MESSAGES_PER_RUN !== 1) {
    throw new CommercialImageDispatchE2EError(
      'O teste E2E para grupo exige WHATSAPP_GROUP_MAX_MESSAGES_PER_RUN=1',
      'COMMERCIAL_E2E_GROUP_LIMIT_MUST_BE_ONE',
    );
  }
  if (!dest.active || !dest.available) {
    throw new CommercialImageDispatchE2EError(
      'Destino inativo ou indisponivel',
      'COMMERCIAL_E2E_DESTINATION_UNAVAILABLE',
    );
  }
  if (dest.sourceInstanceName !== config.EVOLUTION_INSTANCE_NAME) {
    throw new CommercialImageDispatchE2EError(
      'Grupo nao pertence a instancia Evolution atual',
      'COMMERCIAL_E2E_GROUP_INSTANCE_MISMATCH',
    );
  }
  const destination = normalizeWhatsAppGroupId(dest.destination);
  const fingerprint = fingerprintWhatsAppGroupId(destination);
  if (dest.fingerprint !== fingerprint) {
    throw new CommercialImageDispatchE2EError(
      'Identidade do grupo nao corresponde ao cadastro',
      'COMMERCIAL_E2E_GROUP_IDENTITY_MISMATCH',
    );
  }
  return {
    type: 'GROUP',
    destination,
    maskedDestination: fingerprint,
  };
};

const validateDestinationConfig = (
  config: AppEnv,
  dest: WhatsAppDestinationRecord,
): CommercialImageDispatchDestinationConfig =>
  dest.type === 'GROUP'
    ? validateGroupDestinationConfig(config, dest)
    : validateIndividualDestinationConfig(config, dest);

export const runCommercialImageDispatchE2EExternalPreflight = async (
  config: AppEnv,
): Promise<CommercialImageDispatchE2EPreflight> => {
  try {
    const rootResponse = await fetch(`${config.EVOLUTION_API_URL}/`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!rootResponse.ok) {
      throw new CommercialImageDispatchE2EError(
        'Evolution API indisponivel',
        'COMMERCIAL_E2E_EVOLUTION_UNAVAILABLE',
      );
    }
    const rootBody = (await rootResponse.json()) as { version?: unknown };
    if (rootBody.version !== '2.3.7') {
      throw new CommercialImageDispatchE2EError(
        'Versao inesperada da Evolution API',
        'COMMERCIAL_E2E_EVOLUTION_VERSION_INVALID',
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
      throw new CommercialImageDispatchE2EError(
        'Nao foi possivel validar a instancia controlada',
        'COMMERCIAL_E2E_INSTANCE_UNAVAILABLE',
      );
    }
    const instanceState = parseEvolutionConnectionState(
      await instanceResponse.json(),
    );
    if (instanceState !== 'open') {
      throw new CommercialImageDispatchE2EError(
        'A instancia controlada nao esta conectada',
        'COMMERCIAL_E2E_INSTANCE_NOT_OPEN',
      );
    }

    return {
      externalPreflightExecuted: true,
      evolutionAvailable: true,
      evolutionVersion: '2.3.7',
      instanceStatus: 'open',
    };
  } catch (error) {
    if (error instanceof CommercialImageDispatchE2EError) throw error;
    throw new CommercialImageDispatchE2EError(
      'Falha inesperada no preflight externo',
      'COMMERCIAL_E2E_EXTERNAL_PREFLIGHT_FAILED'
    );
  }
};

const validateEntities = async (
  repositories: CommercialImageDispatchReadRepositories,
  draftService: Pick<CommercialMessageDraftService, 'createDraft'>,
  candidateId: string,
  copyId: string,
  destinationId: string,
  config: AppEnv,
  prisma: CommercialImageDispatchCandidateReader & CommercialImageDispatchDestinationReader
) => {
  const candidate = await prisma.commercialPromotionCandidate.findUnique({
    where: { id: candidateId },
    include: {
      product: true,
      snapshot: true,
      generatedCopy: true,
    }
  });
  if (!candidate) {
    throw new CommercialImageDispatchE2EError(
      'Candidato nao encontrado',
      'COMMERCIAL_E2E_CANDIDATE_NOT_FOUND',
    );
  }

  const { product, snapshot, generatedCopy: copy } = candidate;

  if (!product) {
    throw new CommercialImageDispatchE2EError(
      'Produto nao encontrado',
      'COMMERCIAL_E2E_PRODUCT_NOT_FOUND',
    );
  }

  if (!copy || copy.id !== copyId) {
    throw new CommercialImageDispatchE2EError(
      'Copy nao encontrada ou divergente',
      'COMMERCIAL_E2E_COPY_NOT_FOUND',
    );
  }

  if (copy.createdFromCandidateId !== candidateId || copy.productId !== candidate.productId || copy.snapshotId !== candidate.snapshotId) {
    throw new CommercialImageDispatchE2EError(
      'Relacao candidato-copy inconsistente',
      'COMMERCIAL_E2E_RELATION_MISMATCH',
    );
  }

  if (!snapshot) {
    throw new CommercialImageDispatchE2EError(
      'Snapshot nao encontrado',
      'COMMERCIAL_E2E_SNAPSHOT_NOT_FOUND',
    );
  }

  const dest = await prisma.whatsAppDestination.findUnique({ where: { id: destinationId } });
  if (!dest) {
    throw new CommercialImageDispatchE2EError(
      'Destino nao encontrado',
      'COMMERCIAL_E2E_DESTINATION_NOT_FOUND',
    );
  }

  const destinationConfig = validateDestinationConfig(config, dest);

  let draft;
  try {
    draft = draftService.createDraft(candidate);
  } catch {
    throw new CommercialImageDispatchE2EError(
      'Falha ao gerar rascunho',
      'COMMERCIAL_E2E_DRAFT_FAILED',
    );
  }

  if (draft.deliveryMode !== 'IMAGE' || !draft.imageUrl || !draft.imageUrl.startsWith('http')) {
    throw new CommercialImageDispatchE2EError(
      'Rascunho nao e de imagem ou URL invalida',
      'COMMERCIAL_E2E_NOT_IMAGE_DRAFT',
    );
  }

  if (!product.affiliateLink) {
    throw new CommercialImageDispatchE2EError(
      'Produto nao possui link de afiliado',
      'COMMERCIAL_E2E_PRODUCT_NO_LINK',
    );
  }
  const occurrences = draft.caption.split(product.affiliateLink.trim()).length - 1;
  if (occurrences !== 1) {
    throw new CommercialImageDispatchE2EError(
      'A copy deve conter exatamente um link de afiliado',
      'COMMERCIAL_E2E_LINK_COUNT_INVALID',
    );
  }

  const prevDispatches = await repositories.whatsappDispatches.list({
    productId: candidate.productId,
  });
  if (prevDispatches.some(d => d.generatedCopyId === copy.id && d.destinationId === destinationId)) {
    throw new CommercialImageDispatchE2EError(
      'Ja existe um dispatch para essa combinacao',
      'COMMERCIAL_E2E_PREVIOUS_DISPATCH_BLOCKED',
    );
  }

  return { candidate, copy, dest, draft, destinationConfig };
};

export const createReadOnlyCommercialImageDispatchE2ERuntime = async (
  config: AppEnv,
): Promise<CommercialImageDispatchE2EReadOnlyRuntime> => {
  const prisma = createPrismaClient(config.DATABASE_URL);
  const repositories = createPrismaRepositories(prisma);
  const draftService = new CommercialMessageDraftService();
  return {
    repositories,
    draftService,
    prisma,
    close: async () => {
      await prisma.$disconnect();
    },
  };
};

export const createRealCommercialImageDispatchE2ERuntime = async (
  config: AppEnv,
  logger: E2ELogger,
): Promise<CommercialImageDispatchE2ERuntime> => {
  const prisma = createPrismaClient(config.DATABASE_URL);
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
  const groupSendPolicy = new WhatsAppGroupSendPolicy({
    enabled: config.WHATSAPP_GROUP_SEND_ENABLED,
    safeMode: config.EVOLUTION_SAFE_MODE,
    instanceName: config.EVOLUTION_INSTANCE_NAME,
  });
  const repositories = createPrismaRepositories(prisma);
  const draftService = new CommercialMessageDraftService();
  let worker: ReturnType<typeof createWhatsAppDispatchWorker> | undefined;
  let closePromise: Promise<void> | undefined;

  return {
    repositories,
    draftService,
    prisma,
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
        throw new CommercialImageDispatchE2EError(
          'Ha worker ou pipeline ativo; execucao E2E bloqueada',
          'COMMERCIAL_E2E_COMPETING_WORK_BLOCKED',
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
        throw new CommercialImageDispatchE2EError(
          'O worker E2E ja foi iniciado',
          'COMMERCIAL_E2E_WORKER_ALREADY_STARTED',
        );
      }
      worker = createWhatsAppDispatchWorker(config.REDIS_URL, {
        connection: redis,
        prisma,
        logger: workerLogger,
        whatsAppProvider: provider,
        groupSendPolicy,
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
          throw new CommercialImageDispatchE2EError(
            'Falha ao consultar o dispatch pela API',
            'COMMERCIAL_E2E_API_QUERY_FAILED',
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

const safeWorkerLog = (data: unknown): Record<string, unknown> => {
  if (!data || typeof data !== 'object')
    return { event: 'commercial.image.e2e.worker' };
  const source = data as Record<string, unknown>;
  return {
    event:
      typeof source.event === 'string'
        ? source.event
        : 'commercial.image.e2e.worker',
    ...(typeof source.dispatchId === 'string'
      ? { dispatchId: source.dispatchId }
      : {}),
    ...(typeof source.code === 'string' ? { code: source.code } : {}),
  };
};


const safeFailure = (
  error: unknown,
  maskedDestination?: string,
): CommercialImageDispatchE2EFailureOutput => {
  if (
    error instanceof CommercialImageDispatchE2EError ||
    (error instanceof Error && error.name === 'CommercialImageDispatchE2EError')
  ) {
    const e2eError = error as CommercialImageDispatchE2EError;
    return {
      code: e2eError.code,
      message: e2eError.message,
      ...(e2eError.details?.dispatchId ? { dispatchId: e2eError.details.dispatchId } : {}),
      ...(e2eError.details?.status ? { status: e2eError.details.status } : {}),
      ...(e2eError.details?.investigationRequired !== undefined ? { investigationRequired: e2eError.details.investigationRequired } : {}),
      ...(e2eError.details?.destination ? { destination: e2eError.details.destination } : (maskedDestination ? { destination: maskedDestination } : {})),
    };
  }
  return {
    code: 'COMMERCIAL_E2E_BLOCKED',
    message: 'Teste E2E bloqueado por estado inesperado',
    ...(maskedDestination ? { destination: maskedDestination } : {}),
  };
};

export const executeCommercialImageDispatchE2E = async ({
  runtime,
  config,
  candidateId,
  copyId,
  destinationId,
  timeoutMs = DEFAULT_JOB_TIMEOUT_MS,
}: {
  runtime: CommercialImageDispatchE2ERuntime;
  config: AppEnv;
  candidateId: string;
  copyId: string;
  destinationId: string;
  timeoutMs?: number;
}): Promise<
  | { exitCode: 0; output: CommercialImageDispatchE2EConfirmedOutput }
  | { exitCode: 1; output: CommercialImageDispatchE2EConfirmedOutput }
> => {
  let forceClose = false;
  try {
    await runtime.assertNoCompetingWork();
    const jobId = `commercial-image-e2e-${candidateId}-${copyId}-${destinationId}`;

    if (await runtime.findJob(jobId)) {
      throw new CommercialImageDispatchE2EError(
        'Ja existe um job E2E anterior; novo envio bloqueado',
        'COMMERCIAL_E2E_PREVIOUS_JOB_BLOCKED',
        { investigationRequired: true },
      );
    }

    const { candidate, copy, dest, destinationConfig } = await validateEntities(
      runtime.repositories,
      runtime.draftService,
      candidateId,
      copyId,
      destinationId,
      config,
      runtime.prisma
    );

    const dispatchId = `dispatch-e2e-${candidate.id}-${copy.id}-${dest.id}`;
    const existingDispatch = await runtime.prisma.whatsAppDispatch.findUnique({
      where: { id: dispatchId }
    });
    if (existingDispatch) {
      throw new CommercialImageDispatchE2EError(
        'Dispatch anterior encontrado para esse ID fixo',
        'COMMERCIAL_E2E_PREVIOUS_DISPATCH_BLOCKED',
        { investigationRequired: true }
      );
    }

    const dispatch = await runtime.repositories.whatsappDispatches.createPending({
      id: dispatchId,
      productId: candidate.productId,
      generatedCopyId: copy.id,
      destinationId: dest.id,
    });
    if (!dispatch) {
      throw new CommercialImageDispatchE2EError(
        'Estado ambiguo ao criar o dispatch',
        'COMMERCIAL_E2E_DISPATCH_CREATE_AMBIGUOUS',
        { investigationRequired: true },
      );
    }

    const job = await runtime.enqueue(dispatch.id, jobId);
    await runtime.startWorker();

    try {
      await runtime.waitForJob(job, timeoutMs);
    } catch {
      forceClose = true;
    }

    const finalDispatch =
      await runtime.repositories.whatsappDispatches.findByIdWithDetails(
        dispatch.id,
      );
    if (!finalDispatch) {
      throw new CommercialImageDispatchE2EError(
        'Dispatch E2E nao encontrado apos o job',
        'COMMERCIAL_E2E_RESULT_MISSING',
        { dispatchId: dispatch.id, investigationRequired: true },
      );
    }
    const apiDispatch = await runtime.queryDispatchApi(dispatch.id);

    if (
      finalDispatch.id !== dispatchId ||
      apiDispatch.id !== finalDispatch.id ||
      apiDispatch.status !== finalDispatch.status ||
      apiDispatch.attemptCount !== finalDispatch.attemptCount ||
      apiDispatch.destination.destination !==
        destinationConfig.maskedDestination
    ) {
      throw new CommercialImageDispatchE2EError(
        'Resultado do dispatch E2E e ambiguo',
        'COMMERCIAL_E2E_RESULT_AMBIGUOUS',
        {
          dispatchId: finalDispatch.id,
          status: String(finalDispatch.status),
          investigationRequired: true,
        },
      );
    }

    const success =
      finalDispatch.status === 'SENT' &&
      finalDispatch.attemptCount === 1 &&
      Boolean(finalDispatch.externalMessageId) &&
      Boolean(finalDispatch.sentAt) &&
      !finalDispatch.errorMessage;
    const failedSafely =
      finalDispatch.status === 'FAILED' && finalDispatch.attemptCount === 1;
    if (!success && !failedSafely) forceClose = true;

    const output: CommercialImageDispatchE2EConfirmedOutput = {
      mode: 'confirmed',
      dispatchId: finalDispatch.id,
      jobId: String(job.id ?? jobId),
      jobAttempts: 1,
      retryEnabled: false,
      status: String(finalDispatch.status),
      attemptCount: finalDispatch.attemptCount,
      externalMessageIdPresent: Boolean(finalDispatch.externalMessageId),
      sentAtPresent: Boolean(finalDispatch.sentAt),
      apiQueryValidated: true,
      destination: destinationConfig.maskedDestination,
      investigationRequired: !success,
      messagesSent: success ? 1 : 'unknown',
    };
    return { exitCode: success ? 0 : 1, output };
  } finally {
    await runtime.close(forceClose);
  }
};

export const runCommercialImageDispatchE2E = async (
  options: CommercialImageDispatchE2EOptions = {},
): Promise<CommercialImageDispatchE2ERunResult> => {
  const logger = options.logger ?? consoleLogger;
  let maskedDestination: string | undefined;

  try {
    const rawArgs = (options.args ?? process.argv.slice(2)).filter(
      (arg) => arg !== '--',
    );
    const { values } = parseArgs({
      args: rawArgs,
      options: {
        'candidate-id': { type: 'string' },
        'copy-id': { type: 'string' },
        'destination-id': { type: 'string' },
        [COMMERCIAL_IMAGE_DISPATCH_E2E_REAL_FLAG]: { type: 'boolean' },
      },
      strict: true,
    });

    const candidateId = values['candidate-id'];
    const copyId = values['copy-id'];
    const destinationId = values['destination-id'];
    const isReal = values[COMMERCIAL_IMAGE_DISPATCH_E2E_REAL_FLAG];

    if (!candidateId || !copyId || !destinationId) {
      throw new CommercialImageDispatchE2EError(
        'IDs obrigatorios ausentes',
        'COMMERCIAL_E2E_MISSING_IDS',
      );
    }

    const mode = isReal ? 'confirmed' : 'dry-run';
    const env = loadLocalEnvironment(options);
    if (isCiActive(env.CI)) {
      throw new CommercialImageDispatchE2EError(
        'O teste E2E nao pode executar em CI',
        'COMMERCIAL_E2E_CI_BLOCKED',
      );
    }
    const config = loadConfig(env);
    validateControlledConfig(config);
    const readOnlyRuntime = await (
      options.readOnlyRuntimeFactory ?? createReadOnlyCommercialImageDispatchE2ERuntime
    )(config, logger);

    let validationOutput;
    try {
      validationOutput = await validateEntities(
        readOnlyRuntime.repositories,
        readOnlyRuntime.draftService,
        candidateId,
        copyId,
        destinationId,
        config,
        readOnlyRuntime.prisma
      );
    } finally {
      await readOnlyRuntime.close(false);
    }
    maskedDestination = validationOutput.destinationConfig.maskedDestination;

    if (mode === 'dry-run') {
      const output: CommercialImageDispatchE2EDryRunOutput = {
        mode: 'dry-run',
        result: 'GO',
        provider: 'evolution',
        safeMode: true,
        destination: maskedDestination,
        schedulerEnabled: false,
        externalPreflightExecuted: false,
        messageWillBeSent: false,
        draftDeliveryMode: validationOutput.draft.deliveryMode as 'IMAGE',
        warningsCount: validationOutput.draft.warnings?.length || 0,
      };
      logger.info(output);
      return { exitCode: 0, output };
    }

    await (
      options.preflight ?? runCommercialImageDispatchE2EExternalPreflight
    )(config);

    const runtime = await (
      options.runtimeFactory ?? createRealCommercialImageDispatchE2ERuntime
    )(config, logger);

    const result = await executeCommercialImageDispatchE2E({
      runtime,
      config,
      candidateId,
      copyId,
      destinationId,
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

const isDirectExecution =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  const result = await runCommercialImageDispatchE2E();
  process.exitCode = result.exitCode;
}
