import { z } from 'zod';

export const parseDotEnv = (contents: string): NodeJS.ProcessEnv => {
  const parsed: NodeJS.ProcessEnv = {};
  for (const rawLine of contents.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(
      line,
    );
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    parsed[match[1]] = value;
  }
  return parsed;
};

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  if (value.toLowerCase() === 'true') return true;
  if (value.toLowerCase() === 'false') return false;
  return value;
}, z.boolean());

const positiveIntegerFromEnv = z.preprocess(
  (value) => (typeof value === 'string' ? Number(value) : value),
  z.number().int().positive(),
);

const nonNegativeIntegerFromEnv = z.preprocess(
  (value) => (typeof value === 'string' ? Number(value) : value),
  z.number().int().nonnegative(),
);

const timeOfDayFromEnv = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const optionalTrimmedString = z.preprocess(
  (value) =>
    typeof value === 'string' && value.trim() === '' ? undefined : value,
  z.string().trim().optional(),
);

const optionalUrlFromEnv = z.preprocess(
  (value) =>
    typeof value === 'string' && value.trim() === '' ? undefined : value,
  z
    .string()
    .url()
    .transform((value) => value.replace(/\/+$/, ''))
    .optional(),
);

export const COMMERCIAL_AI_COPY_REASONING_EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

export type CommercialAiCopyReasoningEffort =
  (typeof COMMERCIAL_AI_COPY_REASONING_EFFORTS)[number];

export const COMMERCIAL_AI_COPY_DEFAULT_REASONING_EFFORT: CommercialAiCopyReasoningEffort =
  'minimal';

const destinationListFromEnv = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((destination) => destination.trim())
      .filter(Boolean),
  );

const cronRanges = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
] as const;

const isCronNumberInRange = (
  value: string,
  [minimum, maximum]: readonly [number, number],
) => {
  if (!/^\d+$/.test(value)) return false;
  const number = Number(value);
  return number >= minimum && number <= maximum;
};

const isValidCronField = (field: string, range: readonly [number, number]) =>
  field.split(',').every((segment) => {
    const [base, step, extra] = segment.split('/');
    if (extra !== undefined || !base) return false;
    if (step !== undefined && (!/^\d+$/.test(step) || Number(step) < 1)) {
      return false;
    }
    if (base === '*') return true;

    const [start, end, extraRange] = base.split('-');
    if (extraRange !== undefined || !start) return false;
    if (end === undefined) return isCronNumberInRange(start, range);
    return (
      isCronNumberInRange(start, range) &&
      isCronNumberInRange(end, range) &&
      Number(start) <= Number(end)
    );
  });

const isValidCronExpression = (value: string) => {
  const fields = value.trim().split(/\s+/);
  return (
    fields.length === cronRanges.length &&
    fields.every((field, index) => isValidCronField(field, cronRanges[index]))
  );
};

const isValidTimezone = (value: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
};

export const COMMERCIAL_AUTOMATION_DEFAULTS = {
  enabled: false,
  timezone: 'America/Sao_Paulo',
  allowedStartTime: '08:00',
  allowedEndTime: '20:00',
  dailyGlobalLimit: 1,
  dailyGroupLimit: 1,
  minimumIntervalMinutes: 60,
} as const;

export const COMMERCIAL_SCHEDULER_DEFAULTS = {
  enabled: false,
  cronExpression: '0 9 * * *',
  timezone: 'America/Sao_Paulo',
  mode: 'preview',
} as const;

export const COMMERCIAL_EXECUTION_LEASE_DEFAULTS = {
  leaseSeconds: 120,
  heartbeatSeconds: 30,
} as const;

export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    HOST: z.string().trim().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().default(3333),
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),
    LOCAL_API_AUTH_TOKEN: optionalTrimmedString,
    OPENAI_API_KEY: z.string().optional(),
    COMMERCIAL_AI_COPY_ENABLED: booleanFromEnv.default(false),
    COMMERCIAL_AI_COPY_PROVIDER: z.enum(['openai']).default('openai'),
    COMMERCIAL_AI_COPY_MODEL: optionalTrimmedString,
    COMMERCIAL_AI_COPY_TIMEOUT_MS: positiveIntegerFromEnv
      .pipe(z.number().min(1000).max(120000))
      .default(30000),
    COMMERCIAL_AI_COPY_MAX_OUTPUT_TOKENS: positiveIntegerFromEnv
      .pipe(z.number().min(100).max(4000))
      .default(1000),
    COMMERCIAL_AI_COPY_REASONING_EFFORT: z
      .enum(COMMERCIAL_AI_COPY_REASONING_EFFORTS)
      .default(COMMERCIAL_AI_COPY_DEFAULT_REASONING_EFFORT),
    SHOPEE_PARTNER_ID: z.string().optional(),
    SHOPEE_PARTNER_KEY: z.string().optional(),
    SHOPEE_AFFILIATE_PROVIDER: z
      .enum(['mock', 'manual', 'official'])
      .default('mock'),
    SHOPEE_AFFILIATE_API_ENABLED: booleanFromEnv.default(false),
    SHOPEE_AFFILIATE_APP_ID: optionalTrimmedString,
    SHOPEE_AFFILIATE_SECRET: optionalTrimmedString,
    SHOPEE_AFFILIATE_API_URL: optionalUrlFromEnv,
    SHOPEE_AFFILIATE_SUB_ID_PREFIX: z.string().trim().default('whatsapp'),
    SHOPEE_AFFILIATE_SYNC_LIMIT: positiveIntegerFromEnv.default(20),
    SHOPEE_OFFICIAL_CATALOG_SYNC_ENABLED: booleanFromEnv.default(false),
    SHOPEE_OFFICIAL_CATALOG_PAGE_SIZE: positiveIntegerFromEnv
      .pipe(z.number().min(1).max(50))
      .default(20),
    SHOPEE_OFFICIAL_CATALOG_MAX_PAGES: positiveIntegerFromEnv
      .pipe(z.number().min(1).max(20))
      .default(3),
    SHOPEE_OFFICIAL_CATALOG_MAX_PRODUCTS: positiveIntegerFromEnv
      .pipe(z.number().min(1).max(500))
      .default(500),
    SHOPEE_OFFICIAL_CATALOG_MIN_INTERVAL_MS: nonNegativeIntegerFromEnv
      .pipe(z.number().min(0).max(60000))
      .default(1000),
    COMMERCIAL_COPY_MAX_LENGTH: positiveIntegerFromEnv.default(1000),
    COMMERCIAL_AUTOMATION_ENABLED: booleanFromEnv.default(
      COMMERCIAL_AUTOMATION_DEFAULTS.enabled,
    ),
    COMMERCIAL_TIMEZONE: z
      .string()
      .trim()
      .default(COMMERCIAL_AUTOMATION_DEFAULTS.timezone),
    COMMERCIAL_ALLOWED_START_TIME: timeOfDayFromEnv.default(
      COMMERCIAL_AUTOMATION_DEFAULTS.allowedStartTime,
    ),
    COMMERCIAL_ALLOWED_END_TIME: timeOfDayFromEnv.default(
      COMMERCIAL_AUTOMATION_DEFAULTS.allowedEndTime,
    ),
    COMMERCIAL_DAILY_GLOBAL_LIMIT: positiveIntegerFromEnv.default(
      COMMERCIAL_AUTOMATION_DEFAULTS.dailyGlobalLimit,
    ),
    COMMERCIAL_DAILY_GROUP_LIMIT: positiveIntegerFromEnv.default(
      COMMERCIAL_AUTOMATION_DEFAULTS.dailyGroupLimit,
    ),
    COMMERCIAL_MIN_INTERVAL_MINUTES: positiveIntegerFromEnv.default(
      COMMERCIAL_AUTOMATION_DEFAULTS.minimumIntervalMinutes,
    ),
    COMMERCIAL_SCHEDULER_ENABLED: booleanFromEnv.default(
      COMMERCIAL_SCHEDULER_DEFAULTS.enabled,
    ),
    COMMERCIAL_SCHEDULER_CRON: z
      .string()
      .trim()
      .default(COMMERCIAL_SCHEDULER_DEFAULTS.cronExpression),
    COMMERCIAL_SCHEDULER_TIMEZONE: z
      .string()
      .trim()
      .default(COMMERCIAL_SCHEDULER_DEFAULTS.timezone),
    COMMERCIAL_AUTOMATION_MODE: z
      .enum(['preview', 'send'])
      .default(COMMERCIAL_SCHEDULER_DEFAULTS.mode),
    COMMERCIAL_EXECUTION_LEASE_SECONDS: positiveIntegerFromEnv.default(
      COMMERCIAL_EXECUTION_LEASE_DEFAULTS.leaseSeconds,
    ),
    COMMERCIAL_EXECUTION_HEARTBEAT_SECONDS: positiveIntegerFromEnv.default(
      COMMERCIAL_EXECUTION_LEASE_DEFAULTS.heartbeatSeconds,
    ),
    WHATSAPP_PROVIDER: z.enum(['mock', 'evolution']).default('mock'),
    EVOLUTION_API_URL: z
      .string()
      .url()
      .transform((value) => value.replace(/\/+$/, ''))
      .optional(),
    EVOLUTION_API_KEY: z.string().trim().optional(),
    EVOLUTION_INSTANCE_NAME: z.string().trim().optional(),
    EVOLUTION_SAFE_MODE: booleanFromEnv.default(true),
    EVOLUTION_ALLOWED_DESTINATIONS: destinationListFromEnv,
    EVOLUTION_MAX_MESSAGES_PER_BOOT: positiveIntegerFromEnv.default(1),
    WHATSAPP_GROUP_SEND_ENABLED: booleanFromEnv.default(false),
    WHATSAPP_GROUP_MAX_MESSAGES_PER_RUN: positiveIntegerFromEnv.default(1),
    SCHEDULER_ENABLED: booleanFromEnv.default(false),
    SCHEDULER_CRON: z.string().trim().optional(),
    SCHEDULER_TIMEZONE: z.string().trim().optional(),
  })
  .superRefine((env, context) => {
    if (env.SHOPEE_OFFICIAL_CATALOG_PAGE_SIZE * env.SHOPEE_OFFICIAL_CATALOG_MAX_PAGES > 500) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SHOPEE_OFFICIAL_CATALOG_MAX_PAGES'],
        message: 'SHOPEE_OFFICIAL_CATALOG_TOTAL_LIMIT_INVALID',
      });
    }
    if (env.COMMERCIAL_AI_COPY_ENABLED) {
      if (!env.OPENAI_API_KEY?.trim()) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['OPENAI_API_KEY'],
          message: 'COMMERCIAL_AI_COPY_PROVIDER_NOT_CONFIGURED',
        });
      }
      if (!env.COMMERCIAL_AI_COPY_MODEL) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['COMMERCIAL_AI_COPY_MODEL'],
          message: 'COMMERCIAL_AI_COPY_PROVIDER_NOT_CONFIGURED',
        });
      }
    }
    if (!isValidTimezone(env.COMMERCIAL_TIMEZONE)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['COMMERCIAL_TIMEZONE'],
        message: 'COMMERCIAL_TIMEZONE deve ser um timezone IANA valido',
      });
    }
    if (env.COMMERCIAL_ALLOWED_START_TIME === env.COMMERCIAL_ALLOWED_END_TIME) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['COMMERCIAL_ALLOWED_END_TIME'],
        message: 'A janela comercial deve ter inicio e fim diferentes',
      });
    }
    if (!isValidCronExpression(env.COMMERCIAL_SCHEDULER_CRON)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['COMMERCIAL_SCHEDULER_CRON'],
        message:
          'COMMERCIAL_SCHEDULER_CRON deve ser uma expressao cron valida com cinco campos',
      });
    }
    if (!isValidTimezone(env.COMMERCIAL_SCHEDULER_TIMEZONE)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['COMMERCIAL_SCHEDULER_TIMEZONE'],
        message:
          'COMMERCIAL_SCHEDULER_TIMEZONE deve ser um timezone IANA valido',
      });
    }
    if (
      env.COMMERCIAL_EXECUTION_HEARTBEAT_SECONDS * 2 >=
      env.COMMERCIAL_EXECUTION_LEASE_SECONDS
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['COMMERCIAL_EXECUTION_HEARTBEAT_SECONDS'],
        message:
          'COMMERCIAL_EXECUTION_HEARTBEAT_SECONDS deve ser menor que metade de COMMERCIAL_EXECUTION_LEASE_SECONDS',
      });
    }
    if (env.COMMERCIAL_AUTOMATION_MODE === 'send') {
      if (env.SHOPEE_AFFILIATE_PROVIDER !== 'official') {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SHOPEE_AFFILIATE_PROVIDER'],
          message: 'COMMERCIAL_AUTOMATION_OFFICIAL_PROVIDER_REQUIRED',
        });
      }
      if (env.WHATSAPP_PROVIDER !== 'evolution') {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['WHATSAPP_PROVIDER'],
          message: 'COMMERCIAL_AUTOMATION_EVOLUTION_REQUIRED',
        });
      }
      if (!env.EVOLUTION_SAFE_MODE) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['EVOLUTION_SAFE_MODE'],
          message: 'COMMERCIAL_AUTOMATION_SAFE_MODE_REQUIRED',
        });
      }
      if (!env.WHATSAPP_GROUP_SEND_ENABLED) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['WHATSAPP_GROUP_SEND_ENABLED'],
          message: 'COMMERCIAL_AUTOMATION_GROUP_SEND_REQUIRED',
        });
      }
    }
    if (
      env.SCHEDULER_ENABLED &&
      (env.COMMERCIAL_AUTOMATION_MODE === 'send' ||
        env.COMMERCIAL_SCHEDULER_ENABLED)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SCHEDULER_ENABLED'],
        message: 'LEGACY_SCHEDULER_MUST_REMAIN_DISABLED',
      });
    }
    if (env.SHOPEE_AFFILIATE_PROVIDER === 'official') {
      if (!env.SHOPEE_AFFILIATE_API_ENABLED) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SHOPEE_AFFILIATE_API_ENABLED'],
          message:
            'SHOPEE_AFFILIATE_API_ENABLED deve ser true quando o provider e official',
        });
      }
      for (const field of [
        'SHOPEE_AFFILIATE_API_URL',
        'SHOPEE_AFFILIATE_APP_ID',
        'SHOPEE_AFFILIATE_SECRET',
      ] as const) {
        if (!env[field]) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: `${field} e obrigatoria quando SHOPEE_AFFILIATE_PROVIDER=official`,
          });
        }
      }
    }

    if (
      env.SHOPEE_OFFICIAL_CATALOG_PAGE_SIZE *
        env.SHOPEE_OFFICIAL_CATALOG_MAX_PAGES >
      500
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SHOPEE_OFFICIAL_CATALOG_MAX_PAGES'],
        message: 'SHOPEE_OFFICIAL_CATALOG_TOTAL_LIMIT_INVALID',
      });
    }

    if (env.WHATSAPP_PROVIDER === 'evolution') {
      for (const field of [
        'EVOLUTION_API_URL',
        'EVOLUTION_API_KEY',
        'EVOLUTION_INSTANCE_NAME',
      ] as const) {
        if (!env[field]) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: `${field} e obrigatoria quando WHATSAPP_PROVIDER=evolution`,
          });
        }
      }
    }

    if (env.SCHEDULER_ENABLED) {
      if (!env.SCHEDULER_CRON || !isValidCronExpression(env.SCHEDULER_CRON)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SCHEDULER_CRON'],
          message:
            'SCHEDULER_CRON deve ser uma expressao cron valida com cinco campos',
        });
      }
      if (!env.SCHEDULER_TIMEZONE || !isValidTimezone(env.SCHEDULER_TIMEZONE)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SCHEDULER_TIMEZONE'],
          message: 'SCHEDULER_TIMEZONE deve ser um timezone IANA valido',
        });
      }
    }
  });

export type AppEnv = z.infer<typeof envSchema>;
export const loadConfig = (env: NodeJS.ProcessEnv = process.env): AppEnv =>
  envSchema.parse(env);
