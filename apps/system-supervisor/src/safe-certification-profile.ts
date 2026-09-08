import type { RuntimeProfile } from './types';

/**
 * The only source of external-effect restrictions shared by the certification
 * runtime and preview-stability.  It deliberately wins over .env/runtime.env.
 */
export const SAFE_CERTIFICATION_ENVIRONMENT = {
  COMMERCIAL_AUTOMATION_MODE: 'preview',
  COMMERCIAL_AUTOMATION_ENABLED: 'true',
  COMMERCIAL_SCHEDULER_ENABLED: 'true',
  COMMERCIAL_SCHEDULER_CRON: '*/1 * * * *',
  COMMERCIAL_SCHEDULER_TIMEZONE: 'America/Sao_Paulo',
  SCHEDULER_ENABLED: 'false',
  SHOPEE_AFFILIATE_PROVIDER: 'mock',
  SHOPEE_AFFILIATE_API_ENABLED: 'false',
  SHOPEE_OFFICIAL_CATALOG_SYNC_ENABLED: 'false',
  COMMERCIAL_AI_COPY_ENABLED: 'false',
  WHATSAPP_PROVIDER: 'mock',
  WHATSAPP_GROUP_SEND_ENABLED: 'false',
  EVOLUTION_SAFE_MODE: 'true',
} as const;

const EXTERNAL_CREDENTIAL_KEYS = [
  'OPENAI_API_KEY',
  'SHOPEE_AFFILIATE_APP_ID',
  'SHOPEE_AFFILIATE_SECRET',
  'SHOPEE_PARTNER_ID',
  'SHOPEE_PARTNER_KEY',
  'EVOLUTION_API_URL',
  'EVOLUTION_API_KEY',
  'EVOLUTION_INSTANCE_NAME',
  'WHATSAPP_DELIVERY_WEBHOOK_TOKEN',
] as const;

export const applyRuntimeProfile = (
  environment: NodeJS.ProcessEnv,
  runtimeProfile: RuntimeProfile,
): NodeJS.ProcessEnv => {
  if (runtimeProfile === 'default') return environment;
  const safeEnvironment: NodeJS.ProcessEnv = {
    ...environment,
    ...SAFE_CERTIFICATION_ENVIRONMENT,
  };
  for (const key of EXTERNAL_CREDENTIAL_KEYS) delete safeEnvironment[key];
  return safeEnvironment;
};

export const runtimeProfileFromState = (
  runtimeProfile: 'safe-certification' | undefined,
): RuntimeProfile => runtimeProfile ?? 'default';

export const isSafeCertificationProfile = (profile: RuntimeProfile) =>
  profile === 'safe-certification';
