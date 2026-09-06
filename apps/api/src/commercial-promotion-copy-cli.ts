import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  loadConfig,
  parseDotEnv,
  type AppEnv,
} from '@shopee-auto-affiliate-ai/config';
import { createPrismaClient } from '@shopee-auto-affiliate-ai/database';
import { AppError } from '@shopee-auto-affiliate-ai/shared';

import { countLocalDispatchWorkers } from './commercial-offer-snapshot-backfill';
import { OpenAiCommercialAiCopyProvider } from './commercial-ai-copy-provider';
import {
  CommercialPromotionCopyGenerationService,
  type CommercialAiCopyConfig,
} from './commercial-promotion-copy-generation-service';
import {
  PrismaCommercialAutomationSettingsRepository,
  PrismaCommercialPromotionCopyRepository,
} from './prisma-repositories';

const ROOT_ENV_PATH = fileURLToPath(new URL('../../../.env', import.meta.url));
const GENERATE_CONFIRMATION = '--confirm-one-ai-copy';

export type CommercialPromotionCopyCliMode =
  'preflight' | 'preview' | 'generate';

const cliError = (message: string, code: string): never => {
  throw new AppError(message, code);
};

const normalizeArgs = (args: readonly string[]) =>
  args[0] === '--' ? args.slice(1) : [...args];

const parseCandidateId = (value: string | undefined): string => {
  const id = value?.trim();
  if (!id || id.length > 100 || /\s|@|\/|:|https?/iu.test(id)) {
    throw new AppError(
      'candidate-id deve ser um ID interno valido',
      'COMMERCIAL_AI_COPY_CANDIDATE_ID_INVALID',
    );
  }
  return id;
};

export const parseCommercialPromotionCopyCliArgs = (
  mode: CommercialPromotionCopyCliMode,
  rawArgs: readonly string[],
) => {
  const args = normalizeArgs(rawArgs);
  if (mode === 'preflight') {
    if (args.length !== 0) {
      cliError(
        'Preflight nao aceita argumentos',
        'COMMERCIAL_AI_COPY_CLI_ARGUMENTS_INVALID',
      );
    }
    return { mode } as const;
  }
  const candidates = args.filter((argument) =>
    argument.startsWith('--candidate-id='),
  );
  const confirmations = args.filter(
    (argument) => argument === GENERATE_CONFIRMATION,
  );
  if (
    candidates.length !== 1 ||
    confirmations.length !== (mode === 'generate' ? 1 : 0) ||
    args.length !== (mode === 'generate' ? 2 : 1) ||
    args.some(
      (argument) =>
        !argument.startsWith('--candidate-id=') &&
        argument !== GENERATE_CONFIRMATION,
    )
  ) {
    cliError(
      'Argumentos da copy comercial invalidos',
      'COMMERCIAL_AI_COPY_CLI_ARGUMENTS_INVALID',
    );
  }
  return {
    mode,
    candidateId: parseCandidateId(candidates[0]?.slice(15)),
  } as const;
};

export type CommercialPromotionCopyGenerateEnvironment = {
  ci: boolean;
  databaseUrl: string;
  fallbackAvailable: boolean;
  automationMode: AppEnv['COMMERCIAL_AUTOMATION_MODE'];
  automationEnabled: boolean;
  automationPaused: boolean;
  schedulerEnabled: boolean;
  commercialSchedulerEnabled: boolean;
  groupSendEnabled: boolean;
  dispatchWorkers: number;
};

const isLocalDatabase = (databaseUrl: string) => {
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(
      new URL(databaseUrl).hostname.toLowerCase(),
    );
  } catch {
    return false;
  }
};

export const assertCommercialPromotionCopyGenerateEnvironment = (
  environment: CommercialPromotionCopyGenerateEnvironment,
) => {
  if (environment.ci || !isLocalDatabase(environment.databaseUrl)) {
    cliError(
      'Geracao permitida somente localmente fora de CI',
      'COMMERCIAL_AI_COPY_LOCAL_ENVIRONMENT_REQUIRED',
    );
  }
  if (!environment.fallbackAvailable) {
    cliError(
      'Fallback deterministico indisponivel',
      'COMMERCIAL_AI_COPY_FALLBACK_UNAVAILABLE',
    );
  }
  if (
    environment.automationMode !== 'preview' ||
    environment.automationEnabled ||
    !environment.automationPaused ||
    environment.schedulerEnabled ||
    environment.commercialSchedulerEnabled ||
    environment.groupSendEnabled
  ) {
    cliError(
      'Ambiente comercial inseguro',
      'COMMERCIAL_AI_COPY_UNSAFE_ENVIRONMENT',
    );
  }
  if (environment.dispatchWorkers !== 0) {
    cliError(
      'Worker de dispatch ativo',
      'COMMERCIAL_AI_COPY_DISPATCH_WORKER_ACTIVE',
    );
  }
};

type CliService = Pick<
  CommercialPromotionCopyGenerationService,
  'preflight' | 'preview' | 'generate'
>;

export const executeCommercialPromotionCopyCli = async ({
  mode,
  args,
  service,
  environment,
}: {
  mode: CommercialPromotionCopyCliMode;
  args: readonly string[];
  service: CliService;
  environment?: CommercialPromotionCopyGenerateEnvironment;
}) => {
  const parsed = parseCommercialPromotionCopyCliArgs(mode, args);
  if (parsed.mode === 'preflight') return service.preflight();
  if (parsed.mode === 'preview') return service.preview(parsed.candidateId);
  if (!environment) {
    throw new AppError(
      'Ambiente nao validado',
      'COMMERCIAL_AI_COPY_UNSAFE_ENVIRONMENT',
    );
  }
  assertCommercialPromotionCopyGenerateEnvironment(environment);
  return service.generate(parsed.candidateId, 'GERAR_COPY_COM_IA');
};

const configForService = (config: AppEnv): CommercialAiCopyConfig => ({
  enabled: config.COMMERCIAL_AI_COPY_ENABLED,
  provider: config.COMMERCIAL_AI_COPY_PROVIDER,
  model: config.COMMERCIAL_AI_COPY_MODEL ?? null,
  apiKeyConfigured: Boolean(config.OPENAI_API_KEY?.trim()),
  timeoutMs: config.COMMERCIAL_AI_COPY_TIMEOUT_MS,
  maxOutputTokens: config.COMMERCIAL_AI_COPY_MAX_OUTPUT_TOKENS,
  reasoningEffort: config.COMMERCIAL_AI_COPY_REASONING_EFFORT,
  maximumCopyLength: config.COMMERCIAL_COPY_MAX_LENGTH,
});

export const runCommercialPromotionCopyCli = async (
  rawArgs: readonly string[] = process.argv.slice(2),
) => {
  const [modeValue, ...args] = rawArgs;
  if (!['preflight', 'preview', 'generate'].includes(modeValue ?? '')) {
    cliError(
      'Comando de copy comercial invalido',
      'COMMERCIAL_AI_COPY_CLI_ARGUMENTS_INVALID',
    );
  }
  const mode = modeValue as CommercialPromotionCopyCliMode;
  parseCommercialPromotionCopyCliArgs(mode, args);
  const fileEnv = existsSync(ROOT_ENV_PATH)
    ? parseDotEnv(readFileSync(ROOT_ENV_PATH, 'utf8'))
    : {};
  const config = loadConfig({ ...fileEnv, ...process.env });
  const serviceConfig = configForService(config);
  if (mode === 'preflight') {
    const service = new CommercialPromotionCopyGenerationService({
      repository: {} as PrismaCommercialPromotionCopyRepository,
      config: serviceConfig,
    });
    return service.preflight();
  }
  const dispatchWorkers = countLocalDispatchWorkers();
  if (mode === 'generate') {
    assertCommercialPromotionCopyGenerateEnvironment({
      ci: Boolean(process.env.CI),
      databaseUrl: config.DATABASE_URL,
      fallbackAvailable: true,
      automationMode: config.COMMERCIAL_AUTOMATION_MODE,
      automationEnabled: config.COMMERCIAL_AUTOMATION_ENABLED,
      automationPaused: true,
      schedulerEnabled: config.SCHEDULER_ENABLED,
      commercialSchedulerEnabled: config.COMMERCIAL_SCHEDULER_ENABLED,
      groupSendEnabled: config.WHATSAPP_GROUP_SEND_ENABLED,
      dispatchWorkers,
    });
  }
  process.env.DATABASE_URL ??= config.DATABASE_URL;
  const prisma = createPrismaClient();
  try {
    const provider =
      config.COMMERCIAL_AI_COPY_ENABLED &&
      config.OPENAI_API_KEY &&
      config.COMMERCIAL_AI_COPY_MODEL
        ? new OpenAiCommercialAiCopyProvider({
            apiKey: config.OPENAI_API_KEY,
            model: config.COMMERCIAL_AI_COPY_MODEL,
            timeoutMs: config.COMMERCIAL_AI_COPY_TIMEOUT_MS,
            maxOutputTokens: config.COMMERCIAL_AI_COPY_MAX_OUTPUT_TOKENS,
            reasoningEffort: config.COMMERCIAL_AI_COPY_REASONING_EFFORT,
          })
        : undefined;
    const service = new CommercialPromotionCopyGenerationService({
      repository: new PrismaCommercialPromotionCopyRepository(prisma),
      provider,
      config: serviceConfig,
    });
    if (mode === 'preview') {
      return executeCommercialPromotionCopyCli({ mode, args, service });
    }
    const settings = await new PrismaCommercialAutomationSettingsRepository(
      prisma,
    ).get();
    return executeCommercialPromotionCopyCli({
      mode,
      args,
      service,
      environment: {
        ci: Boolean(process.env.CI),
        databaseUrl: config.DATABASE_URL,
        fallbackAvailable: true,
        automationMode: config.COMMERCIAL_AUTOMATION_MODE,
        automationEnabled: config.COMMERCIAL_AUTOMATION_ENABLED,
        automationPaused: settings?.paused === true,
        schedulerEnabled: config.SCHEDULER_ENABLED,
        commercialSchedulerEnabled: config.COMMERCIAL_SCHEDULER_ENABLED,
        groupSendEnabled: config.WHATSAPP_GROUP_SEND_ENABLED,
        dispatchWorkers,
      },
    });
  } finally {
    await prisma.$disconnect();
  }
};

const isDirectExecution =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isDirectExecution) {
  runCommercialPromotionCopyCli()
    .then((report) => console.log(JSON.stringify(report)))
    .catch((error) => {
      console.error(
        JSON.stringify({
          completed: false,
          code:
            error instanceof AppError
              ? error.code
              : 'COMMERCIAL_AI_COPY_CLI_FAILED',
        }),
      );
      process.exitCode = 1;
    });
}
