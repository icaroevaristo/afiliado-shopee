import { describe, expect, it, vi } from 'vitest';
import { AppError } from '@shopee-auto-affiliate-ai/shared';

import {
  COMMERCIAL_OPENAI_DAILY_BUDGET_REACHED,
  COMMERCIAL_SHOPEE_DAILY_BUDGET_REACHED,
  CommercialExternalProviderBudgetService,
  withOpenAiDailyBudget,
  withShopeeDailyBudget,
} from '../src/commercial-external-provider-budget-service';
import type {
  CommercialAutomationSettingsRecord,
  CommercialExternalProvider,
  CommercialExternalProviderUsageRepository,
} from '../src/repositories';

const NOW = new Date('2026-08-30T14:00:00.000Z');

const settings = (
  overrides: Partial<CommercialAutomationSettingsRecord> = {},
): CommercialAutomationSettingsRecord => ({
  paused: true,
  pausedAt: NOW,
  resumedAt: null,
  allowedStartTime: null,
  allowedEndTime: null,
  minimumIntervalMinutes: null,
  staggerMinutes: null,
  dailyGlobalLimit: 3,
  dailyGroupLimit: null,
  dailyShopeeHttpLimit: 2,
  dailyOpenAiGenerationLimit: 2,
  scheduleRevision: 0,
  updatedAt: NOW,
  ...overrides,
});

class MemoryUsage implements CommercialExternalProviderUsageRepository {
  readonly counts = new Map<string, number>();

  async claim(input: {
    provider: CommercialExternalProvider;
    dayKey: string;
    limit: number;
    now: Date;
  }) {
    const key = `${input.provider}:${input.dayKey}`;
    const current = this.counts.get(key) ?? 0;
    if (current >= input.limit) return null;
    const usedCount = current + 1;
    this.counts.set(key, usedCount);
    return {
      provider: input.provider,
      dayKey: input.dayKey,
      usedCount,
      updatedAt: input.now,
    };
  }

  async getUsage(provider: CommercialExternalProvider, dayKey: string) {
    const usedCount = this.counts.get(`${provider}:${dayKey}`);
    return usedCount === undefined
      ? null
      : { provider, dayKey, usedCount, updatedAt: NOW };
  }
}

const setup = (
  overrides: Partial<CommercialAutomationSettingsRecord> = {},
  usage = new MemoryUsage(),
  clock = () => NOW,
) => ({
  usage,
  budget: new CommercialExternalProviderBudgetService({
    settings: {
      get: vi.fn(async () => settings(overrides)),
      getOrCreate: vi.fn(async () => settings(overrides)),
      setPaused: vi.fn(),
      updateSchedule: vi.fn(),
    },
    usage,
    timezone: 'America/Sao_Paulo',
    fallbackDailyGlobalLimit: 5,
    clock,
  }),
});

describe('CommercialExternalProviderBudgetService', () => {
  it.each([
    [
      'success',
      async () => ({ items: [], page: 1, limit: 20, hasNextPage: false }),
    ],
    [
      'failure',
      async () => {
        throw new Error('provider failed');
      },
    ],
    [
      'timeout',
      async () => {
        throw new Error('timeout');
      },
    ],
  ])('conta tentativa Shopee em %s', async (_name, implementation) => {
    const { budget } = setup({ dailyShopeeHttpLimit: 3 });
    const provider = {
      source: 'OFFICIAL' as const,
      listProductOffers: vi.fn(implementation),
    };
    const wrapped = withShopeeDailyBudget(provider, budget);
    await wrapped.listProductOffers().catch(() => undefined);
    expect((await budget.snapshot()).shopee.used).toBe(1);
    expect(provider.listProductOffers).toHaveBeenCalledTimes(1);
  });

  it('bloqueia Shopee no cap sem chamar provider', async () => {
    const { budget } = setup({ dailyShopeeHttpLimit: 1 });
    const provider = {
      source: 'OFFICIAL' as const,
      listProductOffers: vi.fn(async () => ({
        items: [],
        page: 1,
        limit: 20,
        hasNextPage: false,
      })),
    };
    const wrapped = withShopeeDailyBudget(provider, budget);
    await wrapped.listProductOffers();
    await expect(wrapped.listProductOffers()).rejects.toMatchObject({
      code: COMMERCIAL_SHOPEE_DAILY_BUDGET_REACHED,
    });
    expect(provider.listProductOffers).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'valid',
      async () => ({
        output: { headline: 'Oferta', body: 'Texto' },
        provider: 'openai' as const,
        model: 'test',
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
          reasoningTokens: 0,
        },
      }),
    ],
    [
      'invalid output',
      async () => {
        throw new AppError('invalid', 'COMMERCIAL_AI_COPY_OUTPUT_INVALID');
      },
    ],
    [
      'provider failure',
      async () => {
        throw new Error('provider failed');
      },
    ],
  ])('conta geração OpenAI em %s', async (_name, implementation) => {
    const { budget } = setup({ dailyOpenAiGenerationLimit: 3 });
    const provider = { generate: vi.fn(implementation) };
    const wrapped = withOpenAiDailyBudget(provider, budget);
    await wrapped.generate({} as never).catch(() => undefined);
    expect((await budget.snapshot()).openAi.used).toBe(1);
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });

  it('bloqueia OpenAI no cap sem chamar provider', async () => {
    const { budget } = setup({ dailyOpenAiGenerationLimit: 1 });
    const provider = {
      generate: vi.fn(async () => ({
        output: { headline: 'Oferta', body: 'Texto' },
        provider: 'openai' as const,
        model: 'test',
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
          reasoningTokens: 0,
        },
      })),
    };
    const wrapped = withOpenAiDailyBudget(provider, budget);
    await wrapped.generate({} as never);
    await expect(wrapped.generate({} as never)).rejects.toMatchObject({
      kind: 'NOT_STARTED',
      publicCode: COMMERCIAL_OPENAI_DAILY_BUDGET_REACHED,
      requestMayHaveStarted: false,
    });
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });

  it('cache hit não consome geração porque não alcança o provider', async () => {
    const { budget } = setup();
    const provider = { generate: vi.fn() };
    void withOpenAiDailyBudget(provider, budget);
    expect((await budget.snapshot()).openAi.used).toBe(0);
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it('preserva usage entre instâncias e abre novo budget no próximo dayKey', async () => {
    const usage = new MemoryUsage();
    const first = setup({ dailyShopeeHttpLimit: 1 }, usage).budget;
    await first.claim('SHOPEE');
    const restarted = setup({ dailyShopeeHttpLimit: 1 }, usage).budget;
    await expect(restarted.claim('SHOPEE')).rejects.toMatchObject({
      code: COMMERCIAL_SHOPEE_DAILY_BUDGET_REACHED,
    });
    const tomorrow = setup(
      { dailyShopeeHttpLimit: 1 },
      usage,
      () => new Date('2026-08-31T14:00:00.000Z'),
    ).budget;
    await expect(tomorrow.claim('SHOPEE')).resolves.toMatchObject({
      usedCount: 1,
    });
  });

  it('fallback legado é conservador e usa o limite global efetivo', async () => {
    const { budget } = setup({
      dailyGlobalLimit: 3,
      dailyShopeeHttpLimit: null,
      dailyOpenAiGenerationLimit: null,
    });
    const snapshot = await budget.snapshot();
    expect(snapshot.shopee.limit).toBe(3);
    expect(snapshot.openAi.limit).toBe(3);
  });
});
