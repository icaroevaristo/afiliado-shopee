import { loadConfig } from '@shopee-auto-affiliate-ai/config';
import {
  EvolutionApiGroupDirectoryProvider,
  ManualShopeeAffiliateOfferProvider,
  MockShopeeAffiliateOfferProvider,
  OfficialShopeeAffiliateOfferProvider,
} from '@shopee-auto-affiliate-ai/providers';
import { buildApp } from './app';
import { OpenAiCommercialAiCopyProvider } from './commercial-ai-copy-provider';

const start = async () => {
  const config = loadConfig();
  const groupDirectoryProvider =
    config.WHATSAPP_PROVIDER === 'evolution'
      ? new EvolutionApiGroupDirectoryProvider({
          baseUrl: config.EVOLUTION_API_URL as string,
          apiKey: config.EVOLUTION_API_KEY as string,
          instanceName: config.EVOLUTION_INSTANCE_NAME as string,
        })
      : undefined;
  const shopeeOfferProvider =
    config.SHOPEE_AFFILIATE_PROVIDER === 'official'
      ? new OfficialShopeeAffiliateOfferProvider({
          apiEnabled: config.SHOPEE_AFFILIATE_API_ENABLED,
          apiUrl: config.SHOPEE_AFFILIATE_API_URL,
          appId: config.SHOPEE_AFFILIATE_APP_ID,
          secret: config.SHOPEE_AFFILIATE_SECRET,
        })
      : config.SHOPEE_AFFILIATE_PROVIDER === 'manual'
        ? new ManualShopeeAffiliateOfferProvider()
        : new MockShopeeAffiliateOfferProvider();
  const app = await buildApp({
    localApiAuthToken: config.LOCAL_API_AUTH_TOKEN,
    redisUrl: config.REDIS_URL,
    schedulerEnabled: config.SCHEDULER_ENABLED,
    groupDirectoryProvider,
    groupInstanceName: config.EVOLUTION_INSTANCE_NAME,
    shopeeOfferProvider,
    shopeeMaxOffersPerSync: config.SHOPEE_AFFILIATE_SYNC_LIMIT,
    shopeeSubIdPrefix: config.SHOPEE_AFFILIATE_SUB_ID_PREFIX,
    commercialCopyMaxLength: config.COMMERCIAL_COPY_MAX_LENGTH,
    commercialAiCopyProvider:
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
        : undefined,
    commercialAiCopyConfig: {
      enabled: config.COMMERCIAL_AI_COPY_ENABLED,
      provider: config.COMMERCIAL_AI_COPY_PROVIDER,
      model: config.COMMERCIAL_AI_COPY_MODEL ?? null,
      apiKeyConfigured: Boolean(config.OPENAI_API_KEY?.trim()),
      timeoutMs: config.COMMERCIAL_AI_COPY_TIMEOUT_MS,
      maxOutputTokens: config.COMMERCIAL_AI_COPY_MAX_OUTPUT_TOKENS,
      reasoningEffort: config.COMMERCIAL_AI_COPY_REASONING_EFFORT,
      maximumCopyLength: config.COMMERCIAL_COPY_MAX_LENGTH,
    },
    commercialExternalBudgetConfig: {
      timezone: config.COMMERCIAL_TIMEZONE,
      fallbackDailyGlobalLimit: config.COMMERCIAL_DAILY_GLOBAL_LIMIT,
    },
    commercialConfirmationEnvironment: {
      groupSendEnabled: config.WHATSAPP_GROUP_SEND_ENABLED,
      safeMode: config.EVOLUTION_SAFE_MODE,
      schedulerEnabled: config.SCHEDULER_ENABLED,
      maximumMessagesPerRun: config.WHATSAPP_GROUP_MAX_MESSAGES_PER_RUN,
    },
    commercialAutomationConfig: {
      enabled: config.COMMERCIAL_AUTOMATION_ENABLED,
      timezone: config.COMMERCIAL_TIMEZONE,
      allowedStartTime: config.COMMERCIAL_ALLOWED_START_TIME,
      allowedEndTime: config.COMMERCIAL_ALLOWED_END_TIME,
      dailyGlobalLimit: config.COMMERCIAL_DAILY_GLOBAL_LIMIT,
      dailyGroupLimit: config.COMMERCIAL_DAILY_GROUP_LIMIT,
      minimumIntervalMinutes: config.COMMERCIAL_MIN_INTERVAL_MINUTES,
    },
    commercialSchedulerConfig: {
      enabled: config.COMMERCIAL_SCHEDULER_ENABLED,
      cron: config.COMMERCIAL_SCHEDULER_CRON,
      timezone: config.COMMERCIAL_SCHEDULER_TIMEZONE,
      mode: config.COMMERCIAL_AUTOMATION_MODE,
    },
  });
  await app.listen({ host: config.HOST, port: config.PORT });
};
void start();
