import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@shopee-auto-affiliate-ai/shared';

import { buildAuthenticatedTestApp } from './authenticated-test-app';

const apps: Array<Awaited<ReturnType<typeof buildAuthenticatedTestApp>>> = [];

afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

const setup = async () => {
  const preview = vi.fn(async () => ({
    campaignId: 'campaign-1',
    preview: true,
    projectedCandidates: [
      {
        productId: 'product-1',
        productName: 'Produto',
        price: '10',
        discountRate: 10,
        commercialScore: 70,
        promotionSignals: ['CURRENT_DISCOUNT'],
        priceDropPercent: null,
        projectedRank: 1,
        snapshotRevision: 1,
      },
    ],
  }));
  const mine = vi.fn(async () => ({
    campaignId: 'campaign-1',
    preview: false,
    queuedCreated: 1,
  }));
  const listQueue = vi.fn(async (_id, filters) => ({
    items: [],
    ...filters,
    total: 0,
    totalPages: 1,
  }));
  const dispatchAdd = vi.fn();
  const app = await buildAuthenticatedTestApp({
    logger: false,
    prisma: {} as never,
    commercialPromotionMiningService: {
      preview,
      mine,
      listQueue,
    } as never,
    whatsappDispatchQueue: { add: dispatchAdd, getJob: vi.fn() },
  });
  apps.push(app);
  return { app, preview, mine, listQueue, dispatchAdd };
};

describe('commercial promotion mining routes', () => {
  it('aceita preview sem body ou com objeto vazio e nunca enfileira', async () => {
    const subject = await setup();
    const absent = await subject.app.inject({
      method: 'POST',
      url: '/commercial/campaigns/campaign-1/mining-preview',
    });
    const empty = await subject.app.inject({
      method: 'POST',
      url: '/commercial/campaigns/campaign-1/mining-preview',
      payload: {},
    });
    expect(absent.statusCode).toBe(200);
    expect(empty.statusCode).toBe(200);
    expect(subject.preview).toHaveBeenNthCalledWith(1, 'campaign-1', undefined);
    expect(subject.preview).toHaveBeenNthCalledWith(2, 'campaign-1', {});
    expect(subject.dispatchAdd).not.toHaveBeenCalled();
  });

  it('rejeita campos extras no preview pelo contrato do servico', async () => {
    const subject = await setup();
    subject.preview.mockRejectedValueOnce(
      new AppError(
        'Preview de mineracao nao aceita campos',
        'COMMERCIAL_PROMOTION_PREVIEW_INVALID',
      ),
    );
    const response = await subject.app.inject({
      method: 'POST',
      url: '/commercial/campaigns/campaign-1/mining-preview',
      payload: { extra: true },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: 'COMMERCIAL_PROMOTION_PREVIEW_INVALID',
    });
  });

  it('delega somente a confirmacao exata do mine', async () => {
    const subject = await setup();
    const response = await subject.app.inject({
      method: 'POST',
      url: '/commercial/campaigns/campaign-1/mine',
      payload: { confirm: 'MINERAR_PROMOCOES' },
    });
    expect(response.statusCode).toBe(200);
    expect(subject.mine).toHaveBeenCalledWith('campaign-1', {
      confirm: 'MINERAR_PROMOCOES',
    });
  });

  it.each([
    ['CAMPAIGN_INACTIVE', 409],
    ['NICHE_INACTIVE', 409],
    ['COMMERCIAL_PROMOTION_CATALOG_CHANGED', 409],
    ['COMMERCIAL_PROMOTION_CONFIGURATION_CHANGED', 409],
    ['COMMERCIAL_PROMOTION_EVALUATION_TRUNCATED', 409],
    ['COMMERCIAL_PROMOTION_MINING_CONFLICT', 409],
    ['GROUP_UNAVAILABLE', 503],
    ['COMMERCIAL_GROUP_CAMPAIGN_NOT_FOUND', 404],
  ])('mapeia %s para HTTP %i', async (code, expectedStatus) => {
    const subject = await setup();
    subject.mine.mockRejectedValueOnce(new AppError('Falha segura', code));
    const response = await subject.app.inject({
      method: 'POST',
      url: '/commercial/campaigns/campaign-1/mine',
      payload: { confirm: 'MINERAR_PROMOCOES' },
    });
    expect(response.statusCode).toBe(expectedStatus);
    expect(response.json()).toMatchObject({ error: code });
  });

  it('valida paginacao, status e query extra da fila', async () => {
    const subject = await setup();
    const valid = await subject.app.inject({
      method: 'GET',
      url: '/commercial/campaigns/campaign-1/queue?page=2&limit=10&status=QUEUED',
    });
    expect(valid.statusCode).toBe(200);
    expect(subject.listQueue).toHaveBeenCalledWith('campaign-1', {
      page: 2,
      limit: 10,
      status: 'QUEUED',
    });
    for (const query of ['page=0', 'limit=101', 'status=UNKNOWN', 'extra=1']) {
      expect(
        (
          await subject.app.inject({
            method: 'GET',
            url: `/commercial/campaigns/campaign-1/queue?${query}`,
          })
        ).statusCode,
      ).toBe(400);
    }
  });

  it('nao expoe links, IDs externos ou erros inesperados', async () => {
    const subject = await setup();
    const preview = await subject.app.inject({
      method: 'POST',
      url: '/commercial/campaigns/campaign-1/mining-preview',
      payload: {},
    });
    expect(JSON.stringify(preview.json())).not.toMatch(
      /affiliateLink|productLink|providerProductId|shopId|sourceInstanceName|@g\.us/i,
    );
    subject.mine.mockRejectedValueOnce(new Error('raw prisma secret'));
    const failure = await subject.app.inject({
      method: 'POST',
      url: '/commercial/campaigns/campaign-1/mine',
      payload: { confirm: 'MINERAR_PROMOCOES' },
    });
    expect(failure.statusCode).toBe(500);
    expect(JSON.stringify(failure.json())).toBe(
      JSON.stringify({ error: 'INTERNAL_SERVER_ERROR' }),
    );
  });
});
