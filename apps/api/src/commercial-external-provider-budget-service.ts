import type { ShopeeAffiliateOfferProvider } from '@shopee-auto-affiliate-ai/providers';
import { AppError } from '@shopee-auto-affiliate-ai/shared';

import {
  CommercialAiCopyProviderError,
  type CommercialAiCopyProvider,
} from './commercial-ai-copy-provider';
import { getCommercialDayKey } from './commercial-automation-policy-service';
import type {
  CommercialAutomationSettingsRepository,
  CommercialExternalProvider,
  CommercialExternalProviderUsageRepository,
} from './repositories';

export const COMMERCIAL_SHOPEE_DAILY_BUDGET_REACHED =
  'COMMERCIAL_SHOPEE_DAILY_BUDGET_REACHED';
export const COMMERCIAL_OPENAI_DAILY_BUDGET_REACHED =
  'COMMERCIAL_OPENAI_DAILY_BUDGET_REACHED';

const codeFor = (provider: CommercialExternalProvider) =>
  provider === 'SHOPEE'
    ? COMMERCIAL_SHOPEE_DAILY_BUDGET_REACHED
    : COMMERCIAL_OPENAI_DAILY_BUDGET_REACHED;

export type CommercialExternalProviderBudgetSnapshot = {
  shopee: { used: number; limit: number; reached: boolean };
  openAi: { used: number; limit: number; reached: boolean };
  dayKey: string;
};

export class CommercialExternalProviderBudgetService {
  constructor(
    private readonly dependencies: {
      settings: CommercialAutomationSettingsRepository;
      usage: CommercialExternalProviderUsageRepository;
      timezone: string;
      fallbackDailyGlobalLimit: number;
      clock?: () => Date;
    },
  ) {}

  private async limits() {
    const now = this.dependencies.clock?.() ?? new Date();
    const settings = await this.dependencies.settings.getOrCreate(now);
    const messageLimit = Math.min(
      this.dependencies.fallbackDailyGlobalLimit,
      settings.dailyGlobalLimit ?? this.dependencies.fallbackDailyGlobalLimit,
    );
    const shopee = settings.dailyShopeeHttpLimit ?? messageLimit;
    const openAi = settings.dailyOpenAiGenerationLimit ?? messageLimit;
    for (const [name, value] of [
      ['dailyShopeeHttpLimit', shopee],
      ['dailyOpenAiGenerationLimit', openAi],
    ] as const) {
      if (!Number.isSafeInteger(value) || value < 1) {
        throw new AppError(
          `${name} invalido`,
          'COMMERCIAL_EXTERNAL_PROVIDER_BUDGET_INVALID',
        );
      }
    }
    return {
      now,
      dayKey: getCommercialDayKey(now, this.dependencies.timezone),
      shopee,
      openAi,
    };
  }

  async claim(provider: CommercialExternalProvider) {
    const limits = await this.limits();
    const limit = provider === 'SHOPEE' ? limits.shopee : limits.openAi;
    const claimed = await this.dependencies.usage.claim({
      provider,
      dayKey: limits.dayKey,
      limit,
      now: limits.now,
    });
    if (!claimed) {
      throw new AppError(
        'O limite diario do provider externo foi atingido',
        codeFor(provider),
      );
    }
    return claimed;
  }

  async snapshot(): Promise<CommercialExternalProviderBudgetSnapshot> {
    const limits = await this.limits();
    const [shopee, openAi] = await Promise.all([
      this.dependencies.usage.getUsage('SHOPEE', limits.dayKey),
      this.dependencies.usage.getUsage('OPENAI', limits.dayKey),
    ]);
    const shopeeUsed = shopee?.usedCount ?? 0;
    const openAiUsed = openAi?.usedCount ?? 0;
    return {
      dayKey: limits.dayKey,
      shopee: {
        used: shopeeUsed,
        limit: limits.shopee,
        reached: shopeeUsed >= limits.shopee,
      },
      openAi: {
        used: openAiUsed,
        limit: limits.openAi,
        reached: openAiUsed >= limits.openAi,
      },
    };
  }
}

export const withShopeeDailyBudget = (
  provider: ShopeeAffiliateOfferProvider,
  budget: CommercialExternalProviderBudgetService,
): ShopeeAffiliateOfferProvider => ({
  source: provider.source,
  async listProductOffers(input) {
    await budget.claim('SHOPEE');
    return provider.listProductOffers(input);
  },
});

export const withOpenAiDailyBudget = (
  provider: CommercialAiCopyProvider,
  budget: CommercialExternalProviderBudgetService,
): CommercialAiCopyProvider => ({
  async generate(input) {
    try {
      await budget.claim('OPENAI');
    } catch (error) {
      if (
        error instanceof AppError &&
        error.code === COMMERCIAL_OPENAI_DAILY_BUDGET_REACHED
      ) {
        throw new CommercialAiCopyProviderError(
          'NOT_STARTED',
          COMMERCIAL_OPENAI_DAILY_BUDGET_REACHED,
          {},
          undefined,
          false,
        );
      }
      throw error;
    }
    return provider.generate(input);
  },
});
