import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { QueueEvents, type Job } from 'bullmq';
import { loadConfig, type AppEnv } from '@shopee-auto-affiliate-ai/config';
import { createPrismaClient } from '@shopee-auto-affiliate-ai/database';
import {
  createWhatsAppProvider,
  EvolutionApiGroupDirectoryProvider,
  fingerprintWhatsAppGroupId,
  isWhatsAppGroupId,
  normalizeWhatsAppGroupId,
  parseEvolutionConnectionState,
} from '@shopee-auto-affiliate-ai/providers';
import {
  createCommercialAutomationQueue,
  createProductPipelineQueue,
  createRedisConnection,
  createWhatsAppDispatchQueue,
  enqueueControlledWhatsAppDispatch,
  JOB_NAMES,
  QUEUE_NAMES,
  type WhatsAppDispatchJob,
} from '@shopee-auto-affiliate-ai/queue';
import { AppError } from '@shopee-auto-affiliate-ai/shared';

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
import {
  getOrderedAssignedInstanceNames,
  isCommercialInstanceAssigned,
} from '../../api/src/commercial-instance-stickiness';
import { WhatsAppGroupSendPolicy } from '../../api/src/whatsapp-group-send-policy';
import { createWhatsAppDispatchWorker } from './whatsapp-dispatch-worker';
import { parseLocalDotEnv } from './local-env';

export const WHATSAPP_ROUTING_CERTIFICATION_CONFIRM_FLAG =
  '--confirm-routing-send';

const ROOT_ENV_PATH = fileURLToPath(new URL('../../../.env', import.meta.url));
const DEFAULT_JOB_TIMEOUT_MS = 30_000;
const TECHNICAL_PRODUCT_NAME = 'Routing certification technical product';
const TECHNICAL_COPY_TITLE = 'Routing certification technical copy';

type RoutingCertificationMode = 'dry-run' | 'confirmed';

export type RoutingCertificationArgs = {
  mode: RoutingCertificationMode;
  groupFingerprint: string;
  memberIndex: 0 | 1;
  certificationRunId: string;
  sequenceNumber: number;
};

export type RoutingCertificationIds = {
  productId: string;
  providerProductId: string;
  copyId: string;
  dispatchId: string;
  jobId: string;
};

export type RoutingCertificationSelection = {
  groupId: string;
  groupName: string;
  groupFingerprint: string;
  externalGroupId: string;
  memberIndex: 0 | 1;
  selectedInstanceName: string;
  orderedInstanceNames: string[];
  assignmentRevision: number;
};

export type RoutingCertificationPreflight = {
  selection: RoutingCertificationSelection;
  selectedInstanceActive: true;
  selectedInstancePaused: false;
  evolutionInstanceStatus: 'open';
  groupAccessible: true;
  allowlisted: true;
};

export type RoutingCertificationDryRunOutput = {
  mode: 'dry-run';
  groupFingerprint: string;
  memberIndex: 0 | 1;
  selectedInstanceName: string;
  assignmentRevision: number;
  orderedAssignmentCount: number;
  ids: RoutingCertificationIds;
  readyForConfirmedSend: boolean;
  messageWillBeSent: false;
};

export type RoutingCertificationConfirmedOutput = {
  mode: 'confirmed';
  groupFingerprint: string;
  memberIndex: 0 | 1;
  selectedInstanceName: string;
  assignmentRevision: number;
  certificationRunId: string;
  sequenceNumber: number;
  dispatchId: string;
  jobId: string;
  jobAttempts: 1;
  retryEnabled: false;
  status: 'SENT' | 'ALREADY_SENT' | 'FAILED' | 'PROCESSING' | 'PENDING';
  attemptCount: number;
  replayed: boolean;
  investigationRequired: boolean;
  messagesSent: 0 | 1 | 'unknown';
};

export type RoutingCertificationFailureOutput = {
  code: string;
  message: string;
  groupFingerprint?: string;
  memberIndex?: number;
  investigationRequired?: boolean;
};

export type RoutingCertificationResult =
  | { exitCode: 0; output: RoutingCertificationDryRunOutput }
  | { exitCode: 0; output: RoutingCertificationConfirmedOutput }
  | { exitCode: 1; output: RoutingCertificationFailureOutput }
  | { exitCode: 1; output: RoutingCertificationConfirmedOutput };

export type RoutingCertificationLogger = {
  info(data: Record<string, unknown>, message?: string): void;
  error(data: Record<string, unknown>, message?: string): void;
};

export class RoutingCertificationError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly details: {
      groupFingerprint?: string;
      memberIndex?: number;
      investigationRequired?: boolean;
    } = {},
  ) {
    super(message);
  }
}

const consoleLogger: RoutingCertificationLogger = {
  info: (data) => console.log(JSON.stringify(data)),
  error: (data) => console.error(JSON.stringify(data)),
};

const isCiActive = (value: string | undefined) =>
  value !== undefined &&
  value.trim() !== '' &&
  value.trim().toLowerCase() !== 'false';

const invalidArguments = () =>
  new RoutingCertificationError(
    'Argumentos da certificacao de routing invalidos',
    'WHATSAPP_ROUTING_CERTIFICATION_ARGUMENTS_INVALID',
  );

const readSingleOption = (
  options: Map<string, string>,
  name: string,
  value: string,
) => {
  if (options.has(name)) throw invalidArguments();
  options.set(name, value);
};

export const parseRoutingCertificationArgs = (
  args: readonly string[],
): RoutingCertificationArgs => {
  const separatorCount = args.filter((argument) => argument === '--').length;
  if (separatorCount > 1) throw invalidArguments();

  const normalized = args.filter((argument) => argument !== '--');
  const options = new Map<string, string>();
  let confirmed = false;
  for (const argument of normalized) {
    if (argument === WHATSAPP_ROUTING_CERTIFICATION_CONFIRM_FLAG) {
      if (confirmed) throw invalidArguments();
      confirmed = true;
      continue;
    }
    const match =
      /^(--(?:group-fingerprint|member-index|certification-run-id|sequence-number))=(.*)$/u.exec(
        argument,
      );
    if (!match || match[2] === '') throw invalidArguments();
    readSingleOption(options, match[1], match[2]);
  }

  const groupFingerprint = options.get('--group-fingerprint');
  const memberIndex = options.get('--member-index');
  const certificationRunId = options.get('--certification-run-id');
  const sequenceNumber = options.get('--sequence-number');
  if (
    !groupFingerprint ||
    !memberIndex ||
    !certificationRunId ||
    !sequenceNumber ||
    !/^grp_[a-f0-9]{12}$/u.test(groupFingerprint) ||
    !/^[01]$/u.test(memberIndex) ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(certificationRunId) ||
    !/^[1-9]\d{0,5}$/u.test(sequenceNumber)
  ) {
    throw invalidArguments();
  }

  const parsedSequence = Number(sequenceNumber);
  if (!Number.isSafeInteger(parsedSequence) || parsedSequence <= 0) {
    throw invalidArguments();
  }

  return {
    mode: confirmed ? 'confirmed' : 'dry-run',
    groupFingerprint,
    memberIndex: Number(memberIndex) as 0 | 1,
    certificationRunId,
    sequenceNumber: parsedSequence,
  };
};

const selectionError = (
  message: string,
  code = 'COMMERCIAL_INSTANCE_ASSIGNMENT_INVALID',
) => new RoutingCertificationError(message, code);

export const selectRoutingGroup = (
  groups: readonly WhatsAppGroupRecord[],
  groupFingerprint: string,
  memberIndex: 0 | 1,
): RoutingCertificationSelection => {
  if (!/^grp_[a-f0-9]{12}$/u.test(groupFingerprint)) {
    throw selectionError('Fingerprint do grupo invalido');
  }
  const matches = groups.filter(
    (group) => group.type === 'GROUP' && group.fingerprint === groupFingerprint,
  );
  if (matches.length !== 1) {
    throw new RoutingCertificationError(
      'A certificacao exige exatamente um grupo logico correspondente',
      matches.length === 0
        ? 'COMMERCIAL_ROUTING_GROUP_NOT_FOUND'
        : 'COMMERCIAL_ROUTING_GROUP_AMBIGUOUS',
      { groupFingerprint },
    );
  }
  const group = matches[0];
  if (!group || !group.active || !group.available || group.paused === true) {
    throw new RoutingCertificationError(
      'Grupo nao esta ativo e disponivel para certificacao',
      'COMMERCIAL_ROUTING_GROUP_NOT_ELIGIBLE',
      { groupFingerprint },
    );
  }

  let externalGroupId: string;
  let orderedInstanceNames: string[];
  try {
    externalGroupId = normalizeWhatsAppGroupId(group.destination);
    if (group.fingerprint !== fingerprintWhatsAppGroupId(externalGroupId)) {
      throw new Error('fingerprint');
    }
    orderedInstanceNames = getOrderedAssignedInstanceNames(group);
  } catch {
    throw selectionError(
      'Identidade ou assignment ordenado do grupo e invalido',
    );
  }
  if (orderedInstanceNames.length < 2) {
    throw selectionError(
      'A certificacao de routing exige pelo menos duas instancias atribuidas',
    );
  }
  if (
    typeof group.assignmentRevision !== 'number' ||
    !Number.isSafeInteger(group.assignmentRevision) ||
    group.assignmentRevision < 0
  ) {
    throw selectionError('Revision do assignment do grupo esta ausente');
  }
  const selectedInstanceName = orderedInstanceNames[memberIndex];
  if (!selectedInstanceName) {
    throw selectionError('Indice de membro fora do assignment ordenado');
  }
  return {
    groupId: group.id,
    groupName: group.name,
    groupFingerprint,
    externalGroupId,
    memberIndex,
    selectedInstanceName,
    orderedInstanceNames,
    assignmentRevision: group.assignmentRevision,
  };
};

export const assertRoutingGroupSnapshot = (
  expected: RoutingCertificationSelection,
  current: WhatsAppGroupRecord | null,
) => {
  if (!current) {
    throw new RoutingCertificationError(
      'Grupo desapareceu durante a preparacao',
      'COMMERCIAL_ROUTING_GROUP_CHANGED',
      {
        groupFingerprint: expected.groupFingerprint,
        memberIndex: expected.memberIndex,
      },
    );
  }
  let currentExternalGroupId: string;
  let currentAssignments: string[];
  try {
    currentExternalGroupId = normalizeWhatsAppGroupId(current.destination);
    currentAssignments = getOrderedAssignedInstanceNames(current);
  } catch {
    throw selectionError(
      'Identidade ou assignment do grupo mudou durante a preparacao',
      'COMMERCIAL_INSTANCE_ASSIGNMENT_INVALID',
    );
  }
  if (
    current.type !== 'GROUP' ||
    !current.active ||
    !current.available ||
    current.paused === true ||
    current.id !== expected.groupId ||
    currentExternalGroupId !== expected.externalGroupId ||
    current.fingerprint !== expected.groupFingerprint ||
    current.assignmentRevision !== expected.assignmentRevision ||
    currentAssignments.length !== expected.orderedInstanceNames.length ||
    currentAssignments.some(
      (name, index) => name !== expected.orderedInstanceNames[index],
    ) ||
    !isCommercialInstanceAssigned(current, expected.selectedInstanceName)
  ) {
    throw new RoutingCertificationError(
      'Assignment do grupo mudou durante a preparacao',
      'COMMERCIAL_INSTANCE_ASSIGNMENT_CHANGED',
      {
        groupFingerprint: expected.groupFingerprint,
        memberIndex: expected.memberIndex,
        investigationRequired: true,
      },
    );
  }
};

export const buildRoutingCertificationIds = (
  input: Pick<
    RoutingCertificationArgs,
    'certificationRunId' | 'sequenceNumber'
  > &
    Pick<
      RoutingCertificationSelection,
      'groupFingerprint' | 'assignmentRevision' | 'selectedInstanceName'
    >,
): RoutingCertificationIds => {
  const digest = createHash('sha256')
    .update(
      JSON.stringify([
        input.certificationRunId,
        input.sequenceNumber,
        input.groupFingerprint,
        input.assignmentRevision,
        input.selectedInstanceName,
      ]),
    )
    .digest('hex');
  return {
    productId: `routing-cert-product-${digest}`,
    providerProductId: `routing-certification-${digest}`,
    copyId: `routing-cert-copy-${digest}`,
    dispatchId: `routing-cert-dispatch-${digest}`,
    jobId: `routing-cert-job-${digest}`,
  };
};

export const buildRoutingCertificationMessage = (
  certificationRunId: string,
  sequenceNumber: number,
) =>
  `Teste controlado de roteamento Afiliado Shopee. Certificacao ${certificationRunId} / passo ${sequenceNumber}. Nenhuma acao e necessaria.`;

const loadLocalEnvironment = (options: RoutingCertificationOptions) => {
  const path = options.envPath ?? ROOT_ENV_PATH;
  const reader =
    options.readEnvFile ?? ((target: string) => readFileSync(target, 'utf8'));
  if (!options.readEnvFile && !existsSync(path)) {
    throw new RoutingCertificationError(
      'O arquivo .env da raiz e obrigatorio para a certificacao de routing',
      'WHATSAPP_ROUTING_CERTIFICATION_ENV_MISSING',
    );
  }
  return {
    ...parseLocalDotEnv(reader(path)),
    ...(options.env ?? process.env),
  };
};

export const validateRoutingCertificationConfig = (
  config: AppEnv,
  mode: RoutingCertificationMode,
) => {
  if (config.WHATSAPP_PROVIDER !== 'evolution') {
    throw new RoutingCertificationError(
      'A certificacao de routing exige WHATSAPP_PROVIDER=evolution',
      'WHATSAPP_ROUTING_CERTIFICATION_PROVIDER_REQUIRED',
    );
  }
  if (!config.EVOLUTION_SAFE_MODE) {
    throw new RoutingCertificationError(
      'Safe mode e obrigatorio na certificacao de routing',
      'WHATSAPP_ROUTING_CERTIFICATION_SAFE_MODE_REQUIRED',
    );
  }
  if (!config.WHATSAPP_GROUP_SEND_ENABLED) {
    throw new RoutingCertificationError(
      'Envio para grupos deve estar habilitado na certificacao',
      'WHATSAPP_ROUTING_CERTIFICATION_GROUP_SEND_REQUIRED',
    );
  }
  if (config.WHATSAPP_GROUP_MAX_MESSAGES_PER_RUN !== 1) {
    throw new RoutingCertificationError(
      'O limite por run deve ser exatamente um',
      'WHATSAPP_ROUTING_CERTIFICATION_LIMIT_INVALID',
    );
  }
  if (config.SCHEDULER_ENABLED || config.COMMERCIAL_SCHEDULER_ENABLED) {
    throw new RoutingCertificationError(
      'Schedulers devem permanecer desligados na certificacao controlada',
      'WHATSAPP_ROUTING_CERTIFICATION_SCHEDULER_BLOCKED',
    );
  }
  if (mode === 'confirmed' && config.COMMERCIAL_AUTOMATION_MODE !== 'send') {
    throw new RoutingCertificationError(
      'Envio controlado exige COMMERCIAL_AUTOMATION_MODE=send',
      'WHATSAPP_ROUTING_CERTIFICATION_SEND_MODE_REQUIRED',
    );
  }
};

export const runRoutingCertificationPreflight = async (
  config: AppEnv,
  requested: RoutingCertificationArgs,
): Promise<RoutingCertificationPreflight> => {
  const prisma = createPrismaClient(config.DATABASE_URL);
  try {
    const repositories = createPrismaRepositories(prisma);
    const groups = await repositories.whatsappGroups.listAll?.({
      active: true,
      available: true,
    });
    if (!groups) {
      throw new RoutingCertificationError(
        'Repositorio de grupos nao suporta selecao global segura',
        'COMMERCIAL_ROUTING_GROUP_REPOSITORY_UNAVAILABLE',
      );
    }
    const selection = selectRoutingGroup(
      groups,
      requested.groupFingerprint,
      requested.memberIndex,
    );
    const instance = await repositories.whatsappInstances.findByName(
      selection.selectedInstanceName,
    );
    if (!instance || !instance.active || instance.paused === true) {
      throw new RoutingCertificationError(
        'Instancia selecionada esta ausente ou inativa',
        'COMMERCIAL_INSTANCE_INACTIVE',
        {
          groupFingerprint: selection.groupFingerprint,
          memberIndex: selection.memberIndex,
        },
      );
    }

    const apiUrl = config.EVOLUTION_API_URL as string;
    const apiKey = config.EVOLUTION_API_KEY as string;
    const connectionResponse = await fetch(
      `${apiUrl}/instance/connectionState/${encodeURIComponent(selection.selectedInstanceName)}`,
      {
        headers: { apikey: apiKey },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (
      !connectionResponse.ok ||
      parseEvolutionConnectionState(await connectionResponse.json()) !== 'open'
    ) {
      throw new RoutingCertificationError(
        'Instancia selecionada nao esta OPEN na Evolution',
        'COMMERCIAL_INSTANCE_NOT_OPEN',
        {
          groupFingerprint: selection.groupFingerprint,
          memberIndex: selection.memberIndex,
        },
      );
    }

    const directory = new EvolutionApiGroupDirectoryProvider({
      baseUrl: apiUrl,
      apiKey,
      instanceName: selection.selectedInstanceName,
    });
    const remoteGroups = await directory.listGroups();
    if (
      !remoteGroups.some(
        (group) => group.externalGroupId === selection.externalGroupId,
      )
    ) {
      throw new RoutingCertificationError(
        'Grupo selecionado nao esta acessivel pela instancia escolhida',
        'COMMERCIAL_ROUTING_GROUP_NOT_ACCESSIBLE',
        {
          groupFingerprint: selection.groupFingerprint,
          memberIndex: selection.memberIndex,
        },
      );
    }
    const allowlisted = config.EVOLUTION_ALLOWED_DESTINATIONS.some((value) => {
      if (!isWhatsAppGroupId(value)) return false;
      return normalizeWhatsAppGroupId(value) === selection.externalGroupId;
    });
    if (!allowlisted) {
      throw new RoutingCertificationError(
        'Grupo selecionado nao esta na allowlist da Evolution',
        'COMMERCIAL_ROUTING_GROUP_NOT_ALLOWLISTED',
        {
          groupFingerprint: selection.groupFingerprint,
          memberIndex: selection.memberIndex,
        },
      );
    }
    return {
      selection,
      selectedInstanceActive: true,
      selectedInstancePaused: false,
      evolutionInstanceStatus: 'open',
      groupAccessible: true,
      allowlisted: true,
    };
  } finally {
    await prisma.$disconnect();
  }
};

export type RoutingCertificationJob = Pick<
  Job<WhatsAppDispatchJob>,
  'id' | 'opts' | 'waitUntilFinished'
> & { data: WhatsAppDispatchJob; name: string };

type RoutingCertificationPrepareResult = {
  dispatchId: string;
  outcome: 'READY' | 'ALREADY_SENT';
  job?: RoutingCertificationJob;
  replayed: boolean;
};

export type RoutingCertificationRuntime = {
  assertNoCompetingWork(): Promise<void>;
  prepare(
    selection: RoutingCertificationSelection,
    ids: RoutingCertificationIds,
    message: string,
  ): Promise<RoutingCertificationPrepareResult>;
  enqueue(
    dispatchId: string,
    instanceName: string,
    jobId: string,
  ): Promise<RoutingCertificationJob>;
  startWorker(
    selection: RoutingCertificationSelection,
    message: string,
  ): Promise<void>;
  waitForJob(job: RoutingCertificationJob, timeoutMs: number): Promise<void>;
  readDispatch(dispatchId: string): Promise<WhatsAppDispatchDetails | null>;
  close(force?: boolean): Promise<void>;
};

type RoutingCertificationRuntimeFactory = (
  config: AppEnv,
  logger: RoutingCertificationLogger,
) => Promise<RoutingCertificationRuntime>;

export type RoutingCertificationOptions = {
  args?: readonly string[];
  env?: NodeJS.ProcessEnv;
  envPath?: string;
  readEnvFile?: (path: string) => string;
  logger?: RoutingCertificationLogger;
  preflight?: (
    config: AppEnv,
    requested: RoutingCertificationArgs,
  ) => Promise<RoutingCertificationPreflight>;
  runtimeFactory?: RoutingCertificationRuntimeFactory;
  jobTimeoutMs?: number;
};

const assertControlledJob = (
  job: RoutingCertificationJob,
  ids: RoutingCertificationIds,
  instanceName: string,
) => {
  if (
    job.name !== JOB_NAMES.whatsappDispatch ||
    String(job.id) !== ids.jobId ||
    job.opts.attempts !== 1 ||
    job.data.dispatchId !== ids.dispatchId ||
    job.data.instanceName !== instanceName ||
    job.data.routingCertification !== true
  ) {
    throw new RoutingCertificationError(
      'Job existente nao corresponde ao contrato controlado',
      'COMMERCIAL_ROUTING_JOB_CONTRACT_MISMATCH',
      { investigationRequired: true },
    );
  }
};

const assertTechnicalProduct = (
  product: ProductLeadRecord,
  ids: RoutingCertificationIds,
) => {
  if (
    product.providerProductId !== ids.providerProductId ||
    product.nome !== TECHNICAL_PRODUCT_NAME
  ) {
    throw new RoutingCertificationError(
      'Produto tecnico do routing esta ambiguo',
      'COMMERCIAL_ROUTING_PRODUCT_AMBIGUOUS',
      { investigationRequired: true },
    );
  }
  return product;
};

const ensureTechnicalProduct = async (
  repositories: ApplicationRepositories,
  ids: RoutingCertificationIds,
) => {
  const existing = await repositories.products.findByProviderProductId(
    ids.providerProductId,
  );
  if (existing) {
    const product = await repositories.products.findById(existing.id);
    if (!product) {
      throw new RoutingCertificationError(
        'Produto tecnico do routing nao encontrado',
        'COMMERCIAL_ROUTING_PRODUCT_INCONSISTENT',
        { investigationRequired: true },
      );
    }
    return assertTechnicalProduct(product, ids);
  }
  const created = await repositories.products.create({
    providerProductId: ids.providerProductId,
    nome: TECHNICAL_PRODUCT_NAME,
    categoria: 'ROUTING CERTIFICATION',
    preco: 0,
    desconto: 0,
    nota: 0,
    vendidos: 0,
    comissao: 0,
    loja: 'ROUTING CERTIFICATION',
    urlImagem: 'https://example.invalid/routing-certification-product.png',
    url: null,
    title: TECHNICAL_PRODUCT_NAME,
  });
  return assertTechnicalProduct(created, ids);
};

const assertTechnicalCopy = (
  copy: GeneratedCopyRecord,
  expectedCopyId: string,
  productId: string,
  message: string,
) => {
  if (
    copy.id !== expectedCopyId ||
    copy.productId !== productId ||
    copy.titulo !== TECHNICAL_COPY_TITLE ||
    copy.mensagem !== message ||
    copy.cta !== '' ||
    copy.hashtags !== '' ||
    copy.createdFromCandidateId !== null
  ) {
    throw new RoutingCertificationError(
      'Copy tecnica do routing esta ambigua',
      'COMMERCIAL_ROUTING_COPY_AMBIGUOUS',
      { investigationRequired: true },
    );
  }
  return copy;
};

const ensureTechnicalCopy = async (
  repositories: ApplicationRepositories,
  ids: RoutingCertificationIds,
  productId: string,
  message: string,
) => {
  const existing = await repositories.generatedCopies.findById(ids.copyId);
  if (existing)
    return assertTechnicalCopy(existing, ids.copyId, productId, message);
  const created = await repositories.generatedCopies.create({
    id: ids.copyId,
    productId,
    titulo: TECHNICAL_COPY_TITLE,
    mensagem: message,
    cta: '',
    hashtags: '',
    createdFromCandidateId: null,
  });
  return assertTechnicalCopy(created, ids.copyId, productId, message);
};

export const assertNoPreviousRoutingSequence = async (
  repositories: Pick<ApplicationRepositories, 'whatsappDispatches'>,
  message: string,
  currentDispatchId: string,
) => {
  const previous = await repositories.whatsappDispatches.list({});
  if (
    previous.some(
      (dispatch) =>
        dispatch.id !== currentDispatchId &&
        dispatch.generatedCopy.titulo === TECHNICAL_COPY_TITLE &&
        dispatch.generatedCopy.mensagem === message &&
        dispatch.generatedCopy.createdFromCandidateId === null,
    )
  ) {
    throw new RoutingCertificationError(
      'A sequencia de certificacao ja foi utilizada em outro contrato',
      'COMMERCIAL_ROUTING_SEQUENCE_ALREADY_USED',
      { investigationRequired: true },
    );
  }
};

const assertTechnicalDispatch = (
  dispatch: WhatsAppDispatchDetails,
  selection: RoutingCertificationSelection,
  ids: RoutingCertificationIds,
  message: string,
) => {
  if (
    dispatch.id !== ids.dispatchId ||
    dispatch.productId !== dispatch.generatedCopy.productId ||
    dispatch.generatedCopy.id !== ids.copyId ||
    dispatch.generatedCopyId !== ids.copyId ||
    dispatch.destinationId !== selection.groupId ||
    (dispatch.destination.id !== undefined &&
      dispatch.destination.id !== selection.groupId) ||
    dispatch.destination.type !== 'GROUP' ||
    !dispatch.destination.active ||
    !dispatch.destination.available ||
    dispatch.destination.paused === true ||
    dispatch.destination.destination !== selection.externalGroupId ||
    dispatch.instanceName !== selection.selectedInstanceName ||
    dispatch.destination.fingerprint !== selection.groupFingerprint ||
    dispatch.destination.assignmentRevision !== selection.assignmentRevision ||
    dispatch.generatedCopy.titulo !== TECHNICAL_COPY_TITLE ||
    dispatch.generatedCopy.mensagem !== message ||
    dispatch.generatedCopy.cta !== '' ||
    dispatch.generatedCopy.hashtags !== '' ||
    dispatch.generatedCopy.createdFromCandidateId !== null ||
    !isCommercialInstanceAssigned(
      dispatch.destination,
      selection.selectedInstanceName,
    )
  ) {
    throw new RoutingCertificationError(
      'Dispatch tecnico do routing esta inconsistente',
      'COMMERCIAL_ROUTING_DISPATCH_AMBIGUOUS',
      {
        groupFingerprint: selection.groupFingerprint,
        memberIndex: selection.memberIndex,
        investigationRequired: true,
      },
    );
  }
};

export const handleRoutingCertificationReplay = async (input: {
  dispatch: WhatsAppDispatchDetails;
  selection: RoutingCertificationSelection;
  ids: RoutingCertificationIds;
  message: string;
  findJob(jobId: string): Promise<RoutingCertificationJob | null>;
}): Promise<RoutingCertificationPrepareResult> => {
  assertTechnicalDispatch(
    input.dispatch,
    input.selection,
    input.ids,
    input.message,
  );
  if (input.dispatch.status === 'SENT') {
    if (
      input.dispatch.attemptCount !== 1 ||
      !input.dispatch.externalMessageId ||
      !input.dispatch.sentAt ||
      input.dispatch.errorMessage
    ) {
      throw new RoutingCertificationError(
        'Dispatch SENT possui estado terminal incoerente',
        'COMMERCIAL_ROUTING_REPLAY_RESULT_AMBIGUOUS',
        {
          groupFingerprint: input.selection.groupFingerprint,
          investigationRequired: true,
        },
      );
    }
    return {
      dispatchId: input.dispatch.id,
      outcome: 'ALREADY_SENT',
      replayed: true,
    };
  }
  if (input.dispatch.status === 'PROCESSING') {
    throw new RoutingCertificationError(
      'Dispatch tecnico esta PROCESSING e exige revisao manual',
      'COMMERCIAL_ROUTING_REPLAY_PROCESSING',
      {
        groupFingerprint: input.selection.groupFingerprint,
        investigationRequired: true,
      },
    );
  }
  if (input.dispatch.status === 'FAILED') {
    throw new RoutingCertificationError(
      'Dispatch tecnico FAILED nao pode ser reenviado',
      'COMMERCIAL_ROUTING_REPLAY_FAILED',
      {
        groupFingerprint: input.selection.groupFingerprint,
        investigationRequired: true,
      },
    );
  }
  if (input.dispatch.status !== 'PENDING') {
    throw new RoutingCertificationError(
      'Dispatch tecnico possui estado desconhecido e exige revisao manual',
      'COMMERCIAL_ROUTING_REPLAY_STATE_INVALID',
      {
        groupFingerprint: input.selection.groupFingerprint,
        investigationRequired: true,
      },
    );
  }
  if (input.dispatch.attemptCount !== 0) {
    throw new RoutingCertificationError(
      'Dispatch PENDING possui tentativas inesperadas',
      'COMMERCIAL_ROUTING_REPLAY_STATE_INVALID',
      {
        groupFingerprint: input.selection.groupFingerprint,
        investigationRequired: true,
      },
    );
  }
  const job = await input.findJob(input.ids.jobId);
  if (!job) {
    throw new RoutingCertificationError(
      'Dispatch PENDING esta sem job deterministico; reenvio bloqueado',
      'COMMERCIAL_ROUTING_PENDING_JOB_MISSING',
      {
        groupFingerprint: input.selection.groupFingerprint,
        investigationRequired: true,
      },
    );
  }
  assertControlledJob(job, input.ids, input.selection.selectedInstanceName);
  return {
    dispatchId: input.dispatch.id,
    outcome: 'READY',
    job,
    replayed: true,
  };
};

const createRealRoutingCertificationRuntime = async (
  config: AppEnv,
  logger: RoutingCertificationLogger,
): Promise<RoutingCertificationRuntime> => {
  const prisma = createPrismaClient(config.DATABASE_URL);
  const redis = createRedisConnection(config.REDIS_URL);
  const eventsRedis = createRedisConnection(config.REDIS_URL);
  const whatsappQueue = createWhatsAppDispatchQueue(redis);
  const pipelineQueue = createProductPipelineQueue(redis);
  const commercialQueue = createCommercialAutomationQueue(redis);
  const queueEvents = new QueueEvents(QUEUE_NAMES.whatsappDispatch, {
    connection: eventsRedis,
  });
  const repositories = createPrismaRepositories(prisma);
  const workerLogger = {
    info: (data: unknown) => logger.info(sanitizeWorkerLog(data)),
    error: (data: unknown) => logger.error(sanitizeWorkerLog(data)),
  };
  let worker: ReturnType<typeof createWhatsAppDispatchWorker> | undefined;
  let closePromise: Promise<void> | undefined;

  const findJob = (jobId: string) =>
    whatsappQueue.getJob(jobId) as Promise<RoutingCertificationJob | null>;

  return {
    async assertNoCompetingWork() {
      const [
        whatsappWorkers,
        pipelineWorkers,
        commercialWorkers,
        whatsappCounts,
        pipelineCounts,
        commercialCounts,
      ] = await Promise.all([
        whatsappQueue.getWorkers(),
        pipelineQueue.getWorkers(),
        commercialQueue.getWorkers(),
        whatsappQueue.getJobCounts(),
        pipelineQueue.getJobCounts(),
        commercialQueue.getJobCounts(),
      ]);
      if (
        whatsappWorkers.length > 0 ||
        pipelineWorkers.length > 0 ||
        commercialWorkers.length > 0 ||
        hasActionableQueueJobs(whatsappCounts) ||
        hasActionableQueueJobs(pipelineCounts) ||
        hasActionableQueueJobs(commercialCounts)
      ) {
        throw new RoutingCertificationError(
          'Existe worker ou job concorrente; routing certification bloqueada',
          'COMMERCIAL_ROUTING_COMPETING_WORK',
        );
      }
    },
    async prepare(selection, ids, message) {
      const current = await repositories.whatsappGroups.findById(
        selection.groupId,
      );
      assertRoutingGroupSnapshot(selection, current);

      const existingDispatch =
        await repositories.whatsappDispatches.findByIdWithDetails(
          ids.dispatchId,
        );
      if (existingDispatch) {
        return handleRoutingCertificationReplay({
          dispatch: existingDispatch,
          selection,
          ids,
          message,
          findJob,
        });
      }

      await assertNoPreviousRoutingSequence(
        repositories,
        message,
        ids.dispatchId,
      );

      const product = await ensureTechnicalProduct(repositories, ids);
      const copy = await ensureTechnicalCopy(
        repositories,
        ids,
        product.id,
        message,
      );
      const beforeDispatch = await repositories.whatsappGroups.findById(
        selection.groupId,
      );
      assertRoutingGroupSnapshot(selection, beforeDispatch);
      const dispatch = await repositories.whatsappDispatches.createPending({
        id: ids.dispatchId,
        productId: product.id,
        generatedCopyId: copy.id,
        destinationId: selection.groupId,
        instanceName: selection.selectedInstanceName,
      });
      if (!dispatch) {
        const racedDispatch =
          await repositories.whatsappDispatches.findByIdWithDetails(
            ids.dispatchId,
          );
        if (!racedDispatch) {
          throw new RoutingCertificationError(
            'Dispatch tecnico nao pode ser reconciliado apos conflito',
            'COMMERCIAL_ROUTING_DISPATCH_CREATE_CONFLICT',
            { investigationRequired: true },
          );
        }
        return handleRoutingCertificationReplay({
          dispatch: racedDispatch,
          selection,
          ids,
          message,
          findJob,
        });
      }
      return {
        dispatchId: dispatch.id,
        outcome: 'READY' as const,
        replayed: false,
      };
    },
    async enqueue(dispatchId, instanceName, jobId) {
      await queueEvents.waitUntilReady();
      const job = (await enqueueControlledWhatsAppDispatch(
        whatsappQueue,
        { dispatchId, instanceName, routingCertification: true },
        jobId,
      )) as RoutingCertificationJob;
      if (job.opts.attempts !== 1) {
        throw new RoutingCertificationError(
          'Job controlado foi criado com politica de tentativas invalida',
          'COMMERCIAL_ROUTING_ATTEMPTS_INVALID',
          { investigationRequired: true },
        );
      }
      return job;
    },
    async startWorker(selection, message) {
      if (worker) {
        throw new RoutingCertificationError(
          'Worker de routing ja foi iniciado',
          'COMMERCIAL_ROUTING_WORKER_ALREADY_STARTED',
        );
      }
      const providerForInstance = (instanceName: string) =>
        createWhatsAppProvider(
          { ...config, EVOLUTION_INSTANCE_NAME: instanceName },
          { logger: workerLogger },
        );
      const provider = providerForInstance(selection.selectedInstanceName);
      worker = createWhatsAppDispatchWorker(config.REDIS_URL, {
        connection: redis,
        prisma,
        logger: workerLogger,
        whatsAppProvider: provider,
        whatsAppProviderResolver: providerForInstance,
        groupSendPolicy: new WhatsAppGroupSendPolicy({
          enabled: config.WHATSAPP_GROUP_SEND_ENABLED,
          safeMode: config.EVOLUTION_SAFE_MODE,
          instanceName: selection.selectedInstanceName,
        }),
        messageBuilder: () => message,
        reservationLeaseMilliseconds:
          config.COMMERCIAL_EXECUTION_LEASE_SECONDS * 1000,
      });
      await worker.whatsappDispatchWorker.waitUntilReady();
    },
    waitForJob: (job, timeoutMs) =>
      job.waitUntilFinished(queueEvents, timeoutMs).then(() => undefined),
    readDispatch: (dispatchId) =>
      repositories.whatsappDispatches.findByIdWithDetails(dispatchId),
    close(force = false) {
      closePromise ??= (async () => {
        await Promise.allSettled([
          worker?.close(force) ?? Promise.resolve(),
          queueEvents.close(),
          whatsappQueue.close(),
          pipelineQueue.close(),
          commercialQueue.close(),
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

const sanitizeWorkerLog = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object') {
    return { event: 'whatsapp.routing-certification.worker' };
  }
  const data = value as Record<string, unknown>;
  return {
    event:
      typeof data.event === 'string'
        ? data.event
        : 'whatsapp.routing-certification.worker',
    ...(typeof data.dispatchId === 'string'
      ? { dispatchId: data.dispatchId }
      : {}),
    ...(typeof data.code === 'string' ? { code: data.code } : {}),
  };
};

const hasActionableQueueJobs = (counts: Record<string, number>) =>
  [
    'waiting',
    'active',
    'delayed',
    'prioritized',
    'waiting-children',
    'paused',
  ].some((state) => (counts[state] ?? 0) > 0);

const executeConfirmedRoutingCertification = async (input: {
  runtime: RoutingCertificationRuntime;
  selection: RoutingCertificationSelection;
  args: RoutingCertificationArgs;
  ids: RoutingCertificationIds;
  message: string;
  timeoutMs: number;
}): Promise<
  | { exitCode: 0; output: RoutingCertificationConfirmedOutput }
  | { exitCode: 1; output: RoutingCertificationConfirmedOutput }
> => {
  let forceClose = false;
  const prepared = await input.runtime.prepare(
    input.selection,
    input.ids,
    input.message,
  );
  if (prepared.outcome === 'ALREADY_SENT') {
    const existing = await input.runtime.readDispatch(prepared.dispatchId);
    if (!existing) {
      throw new RoutingCertificationError(
        'Dispatch SENT nao pode ser reconciliado',
        'COMMERCIAL_ROUTING_REPLAY_RESULT_MISSING',
        { investigationRequired: true },
      );
    }
    return {
      exitCode: 0,
      output: {
        mode: 'confirmed',
        groupFingerprint: input.selection.groupFingerprint,
        memberIndex: input.selection.memberIndex,
        selectedInstanceName: input.selection.selectedInstanceName,
        assignmentRevision: input.selection.assignmentRevision,
        certificationRunId: input.args.certificationRunId,
        sequenceNumber: input.args.sequenceNumber,
        dispatchId: existing.id,
        jobId: input.ids.jobId,
        jobAttempts: 1,
        retryEnabled: false,
        status: 'ALREADY_SENT',
        attemptCount: existing.attemptCount,
        replayed: true,
        investigationRequired: false,
        messagesSent: 0,
      },
    };
  }

  const job =
    prepared.job ??
    (await input.runtime.enqueue(
      prepared.dispatchId,
      input.selection.selectedInstanceName,
      input.ids.jobId,
    ));
  assertControlledJob(job, input.ids, input.selection.selectedInstanceName);
  await input.runtime.startWorker(input.selection, input.message);
  try {
    await input.runtime.waitForJob(job, input.timeoutMs);
  } catch {
    forceClose = true;
  }

  const dispatch = await input.runtime.readDispatch(prepared.dispatchId);
  if (!dispatch) {
    forceClose = true;
    await input.runtime.close(true);
    throw new RoutingCertificationError(
      'Resultado do dispatch tecnico nao encontrado',
      'COMMERCIAL_ROUTING_RESULT_MISSING',
      {
        groupFingerprint: input.selection.groupFingerprint,
        investigationRequired: true,
      },
    );
  }
  const success =
    dispatch.status === 'SENT' &&
    dispatch.attemptCount === 1 &&
    Boolean(dispatch.externalMessageId) &&
    Boolean(dispatch.sentAt) &&
    !dispatch.errorMessage;
  const terminalFailure =
    dispatch.status === 'FAILED' && dispatch.attemptCount === 1;
  const output: RoutingCertificationConfirmedOutput = {
    mode: 'confirmed',
    groupFingerprint: input.selection.groupFingerprint,
    memberIndex: input.selection.memberIndex,
    selectedInstanceName: input.selection.selectedInstanceName,
    assignmentRevision: input.selection.assignmentRevision,
    certificationRunId: input.args.certificationRunId,
    sequenceNumber: input.args.sequenceNumber,
    dispatchId: dispatch.id,
    jobId: input.ids.jobId,
    jobAttempts: 1,
    retryEnabled: false,
    status: dispatch.status,
    attemptCount: dispatch.attemptCount,
    replayed: prepared.replayed,
    investigationRequired: !success,
    messagesSent: success ? 1 : terminalFailure ? 0 : 'unknown',
  };
  if (!success && !terminalFailure) forceClose = true;
  if (forceClose) await input.runtime.close(true);
  return { exitCode: success ? 0 : 1, output };
};

export const runRoutingCertification = async (
  options: RoutingCertificationOptions = {},
): Promise<RoutingCertificationResult> => {
  const logger = options.logger ?? consoleLogger;
  try {
    const requested = parseRoutingCertificationArgs(
      options.args ?? process.argv.slice(2),
    );
    const environment = loadLocalEnvironment(options);
    if (isCiActive(environment.CI) && requested.mode === 'confirmed') {
      throw new RoutingCertificationError(
        'A certificacao de routing real e bloqueada em CI',
        'WHATSAPP_ROUTING_CERTIFICATION_CI_BLOCKED',
      );
    }
    const config = loadConfig(environment);
    validateRoutingCertificationConfig(config, requested.mode);
    const preflight = await (
      options.preflight ?? runRoutingCertificationPreflight
    )(config, requested);
    const selection = preflight.selection;
    if (
      selection.groupFingerprint !== requested.groupFingerprint ||
      selection.memberIndex !== requested.memberIndex
    ) {
      throw new RoutingCertificationError(
        'Preflight retornou selecao diferente do pedido',
        'COMMERCIAL_ROUTING_PREFLIGHT_SELECTION_MISMATCH',
        { investigationRequired: true },
      );
    }
    if (
      requested.mode === 'confirmed' &&
      (!preflight.selectedInstanceActive ||
        preflight.selectedInstancePaused ||
        preflight.evolutionInstanceStatus !== 'open' ||
        !preflight.groupAccessible ||
        !preflight.allowlisted)
    ) {
      throw new RoutingCertificationError(
        'Preflight de routing nao esta pronto para envio',
        'COMMERCIAL_ROUTING_PREFLIGHT_NOT_READY',
        {
          groupFingerprint: selection.groupFingerprint,
          memberIndex: selection.memberIndex,
        },
      );
    }
    const ids = buildRoutingCertificationIds({
      ...requested,
      groupFingerprint: selection.groupFingerprint,
      assignmentRevision: selection.assignmentRevision,
      selectedInstanceName: selection.selectedInstanceName,
    });
    const message = buildRoutingCertificationMessage(
      requested.certificationRunId,
      requested.sequenceNumber,
    );

    if (requested.mode === 'dry-run') {
      const output: RoutingCertificationDryRunOutput = {
        mode: 'dry-run',
        groupFingerprint: selection.groupFingerprint,
        memberIndex: selection.memberIndex,
        selectedInstanceName: selection.selectedInstanceName,
        assignmentRevision: selection.assignmentRevision,
        orderedAssignmentCount: selection.orderedInstanceNames.length,
        ids,
        readyForConfirmedSend:
          preflight.selectedInstanceActive &&
          !preflight.selectedInstancePaused &&
          preflight.evolutionInstanceStatus === 'open' &&
          preflight.groupAccessible &&
          preflight.allowlisted &&
          config.WHATSAPP_GROUP_SEND_ENABLED,
        messageWillBeSent: false,
      };
      logger.info(output);
      return { exitCode: 0, output };
    }

    const runtime = await (
      options.runtimeFactory ?? createRealRoutingCertificationRuntime
    )(config, logger);
    try {
      await runtime.assertNoCompetingWork();
      const result = await executeConfirmedRoutingCertification({
        runtime,
        selection,
        args: requested,
        ids,
        message,
        timeoutMs: options.jobTimeoutMs ?? DEFAULT_JOB_TIMEOUT_MS,
      });
      (result.exitCode === 0 ? logger.info : logger.error)(result.output);
      return result;
    } finally {
      await runtime.close(false);
    }
  } catch (error) {
    const output = safeFailure(error);
    logger.error(output);
    return { exitCode: 1, output };
  }
};

const safeFailure = (error: unknown): RoutingCertificationFailureOutput => {
  if (error instanceof RoutingCertificationError) {
    return {
      code: error.code,
      message: error.message,
      ...error.details,
    };
  }
  if (error instanceof AppError) {
    return {
      code: error.code,
      message:
        'Certificacao de routing bloqueada por configuracao ou estado inseguro',
    };
  }
  return {
    code: 'WHATSAPP_ROUTING_CERTIFICATION_BLOCKED',
    message:
      'Certificacao de routing bloqueada por configuracao ou estado inseguro',
    investigationRequired: true,
  };
};

const isDirectExecution =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  const result = await runRoutingCertification();
  process.exitCode = result.exitCode;
}
