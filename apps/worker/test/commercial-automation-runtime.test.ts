import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '@shopee-auto-affiliate-ai/config';
import {
  OfficialShopeeAffiliateOfferProvider,
} from '@shopee-auto-affiliate-ai/providers';
import { OpenAiCommercialAiCopyProvider } from '../../api/src/commercial-ai-copy-provider';

import {
  createCommercialAutomationOrchestratorRuntime,
} from '../src/commercial-automation-runtime';

const baseEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://localhost:5432/app',
  REDIS_URL: 'redis://localhost:6379',
};

const dangerousPreviewConfig = loadConfig({
  ...baseEnv,
  COMMERCIAL_AUTOMATION_MODE: 'preview',
  COMMERCIAL_AI_COPY_ENABLED: 'true',
  OPENAI_API_KEY: 'preview-only-openai-key',
  COMMERCIAL_AI_COPY_MODEL: 'preview-only-model',
  SHOPEE_AFFILIATE_PROVIDER: 'official',
  SHOPEE_AFFILIATE_API_ENABLED: 'true',
  SHOPEE_AFFILIATE_API_URL: 'https://example.invalid/shopee',
  SHOPEE_AFFILIATE_APP_ID: 'preview-only-app',
  SHOPEE_AFFILIATE_SECRET: 'preview-only-secret',
  WHATSAPP_PROVIDER: 'evolution',
  EVOLUTION_API_URL: 'http://localhost:8080',
  EVOLUTION_API_KEY: 'preview-only-evolution-key',
  EVOLUTION_INSTANCE_NAME: 'preview-only-instance',
  WHATSAPP_GROUP_SEND_ENABLED: 'true',
});

describe('commercial automation runtime provider boundaries', () => {
  it('nao constroi Shopee oficial nem OpenAI em preview mesmo com config perigosa', () => {
    const officialShopeeProviderFactory = vi.fn(() => {
      throw new Error('official Shopee provider must not be constructed');
    });
    const openAiCommercialAiCopyProviderFactory = vi.fn(() => {
      throw new Error('OpenAI provider must not be constructed');
    });

    const runtime = createCommercialAutomationOrchestratorRuntime(
      dangerousPreviewConfig,
      {
        prisma: {} as never,
        officialShopeeProviderFactory,
        openAiCommercialAiCopyProviderFactory,
      },
    );

    expect(officialShopeeProviderFactory).not.toHaveBeenCalled();
    expect(openAiCommercialAiCopyProviderFactory).not.toHaveBeenCalled();
    expect(runtime.ownsPrisma).toBe(false);
  });

  it('preserva a construcao dos providers no modo send', () => {
    const config = loadConfig({
      ...baseEnv,
      COMMERCIAL_AUTOMATION_MODE: 'send',
      COMMERCIAL_AI_COPY_ENABLED: 'true',
      OPENAI_API_KEY: 'send-only-openai-key',
      COMMERCIAL_AI_COPY_MODEL: 'send-only-model',
      SHOPEE_AFFILIATE_PROVIDER: 'official',
      SHOPEE_AFFILIATE_API_ENABLED: 'true',
      SHOPEE_AFFILIATE_API_URL: 'https://example.invalid/shopee',
      SHOPEE_AFFILIATE_APP_ID: 'send-only-app',
      SHOPEE_AFFILIATE_SECRET: 'send-only-secret',
      WHATSAPP_PROVIDER: 'evolution',
      EVOLUTION_API_URL: 'http://localhost:8080',
      EVOLUTION_API_KEY: 'send-only-evolution-key',
      EVOLUTION_INSTANCE_NAME: 'send-only-instance',
      WHATSAPP_GROUP_SEND_ENABLED: 'true',
    });
    const officialShopeeProviderFactory = vi.fn(
      (options: ConstructorParameters<
        typeof OfficialShopeeAffiliateOfferProvider
      >[0]) => new OfficialShopeeAffiliateOfferProvider(options),
    );
    const openAiCommercialAiCopyProviderFactory = vi.fn(
      (options: ConstructorParameters<typeof OpenAiCommercialAiCopyProvider>[0]) =>
        new OpenAiCommercialAiCopyProvider(options),
    );

    expect(
      createCommercialAutomationOrchestratorRuntime(config, {
        prisma: {} as never,
        officialShopeeProviderFactory,
        openAiCommercialAiCopyProviderFactory,
      }),
    ).toBeDefined();
    expect(officialShopeeProviderFactory).toHaveBeenCalledOnce();
    expect(openAiCommercialAiCopyProviderFactory).toHaveBeenCalledOnce();
  });
});
