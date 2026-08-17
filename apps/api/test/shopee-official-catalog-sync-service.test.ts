import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ShopeeOfficialCatalogSyncService } from '../src/shopee-official-catalog-sync-service';
import { AppError } from '@shopee-auto-affiliate-ai/shared';

import type { Mock } from 'vitest';

describe('ShopeeOfficialCatalogSyncService', () => {
  let mockProvider: Record<string, Mock>;
  let mockOffers: Record<string, Mock>;
  let mockLock: Record<string, Mock>;
  let mockLogger: Record<string, Mock>;
  let service: ShopeeOfficialCatalogSyncService;

  beforeEach(() => {
    mockProvider = {
      listProductOffers: vi.fn(),
    };
    mockOffers = {
      upsertOfficialOfferWithSnapshot: vi.fn(),
    };
    mockLock = {
      runExclusive: vi.fn().mockImplementation(async (cb) => cb()),
    };
    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new ShopeeOfficialCatalogSyncService(mockProvider as any, mockOffers as any, mockLock as any, mockLogger as any, () => new Date('2026-08-01T10:00:00Z'));
  });

  it('deve adquirir o lock e iterar pelas paginas ate o maximo ou hasNextPage falso', async () => {
    mockProvider.listProductOffers
      .mockResolvedValueOnce({
        items: [
          {
            source: 'OFFICIAL',
            providerProductId: 'prod1',
            shopId: 'shop-1',
            productName: 'Produto 1',
            shopName: 'Loja 1',
            price: '10.00',
            priceMin: '10.00',
            priceMax: '10.00',
            discountRate: 0,
            rating: 5,
            sales: 10,
            commissionRate: 10,
            imageUrl: 'http://img.com',
            productLink: 'http://prod.com',
            fetchedAt: new Date(),
          },
        ],
        page: 1,
        limit: 20,
        hasNextPage: true,
        nextCursor: 'cursor1',
        fetchedCount: 1,
        rejected: [],
      })
      .mockResolvedValueOnce({
        items: [],
        page: 2,
        limit: 20,
        hasNextPage: false,
        nextCursor: undefined,
        fetchedCount: 0,
        rejected: [],
      });

    mockOffers.upsertOfficialOfferWithSnapshot.mockResolvedValue({
      productAction: 'created',
      snapshotCreated: true,
    });

    const report = await service.sync({
      pageSize: 20,
      maxPages: 3,
      minimumIntervalMs: 0,
    });

    expect(mockLock.runExclusive).toHaveBeenCalled();
    expect(mockProvider.listProductOffers).toHaveBeenCalledTimes(2);
    if (report.status !== 'SUCCEEDED') console.log(mockLogger.error.mock.calls); expect(report.status).toBe('SUCCEEDED');
    expect(report.pagesRequested).toBe(2);
    expect(report.pagesCompleted).toBe(2);
    expect(report.fetched).toBe(1);
    expect(report.created).toBe(1);
  });

  it('deve lancar erro se falhar ao adquirir lock', async () => {
    mockLock.runExclusive.mockRejectedValueOnce(
      new AppError('Sincronizacao em andamento', 'SHOPEE_OFFICIAL_CATALOG_SYNC_IN_PROGRESS')
    );

    await expect(
      service.sync({ pageSize: 20, maxPages: 3, minimumIntervalMs: 0 }),
    ).rejects.toThrowError(
      new AppError(
        'Sincronizacao em andamento',
        'SHOPEE_OFFICIAL_CATALOG_SYNC_IN_PROGRESS',
      ),
    );
  });

  it('deve lancar erro se limites invalidos', async () => {
    await expect(
      service.sync({ pageSize: 100, maxPages: 6, minimumIntervalMs: 0 }),
    ).rejects.toThrowError(
      new AppError(
        'Limite total excede operacao segura',
        'SHOPEE_OFFICIAL_CATALOG_TOTAL_LIMIT_INVALID',
      ),
    );
  });

  it('deve reportar status PARTIAL se falhar numa pagina posterior', async () => {
    mockProvider.listProductOffers
      .mockResolvedValueOnce({
        items: [],
        page: 1,
        limit: 20,
        hasNextPage: true,
        nextCursor: 'cursor1',
        fetchedCount: 0,
        rejected: [],
      })
      .mockRejectedValueOnce(new AppError('Timeout', 'SHOPEE_API_TIMEOUT'));

    const report = await service.sync({
      pageSize: 20,
      maxPages: 3,
      minimumIntervalMs: 0,
    });

    expect(report.status).toBe('PARTIAL');
    expect(report.pagesCompleted).toBe(1);
    expect(report.failureCode).toBe('SHOPEE_API_TIMEOUT');
  });

  it('deve deduplicar itens entre paginas', async () => {
    const item = {
      source: 'OFFICIAL',
      providerProductId: 'prod1',
      shopId: 'shop-1',
      productName: 'Produto 1',
      shopName: 'Loja 1',
      price: '10.00',
      priceMin: '10.00',
      priceMax: '10.00',
      discountRate: 0,
      rating: 5,
      sales: 10,
      commissionRate: 10,
      imageUrl: 'http://img.com',
      productLink: 'http://prod.com',
      fetchedAt: new Date(),
    };

    mockProvider.listProductOffers
      .mockResolvedValueOnce({
        items: [item],
        page: 1,
        limit: 20,
        hasNextPage: true,
        nextCursor: 'cursor1',
        fetchedCount: 1,
        rejected: [],
      })
      .mockResolvedValueOnce({
        items: [item], // Duplicado
        page: 2,
        limit: 20,
        hasNextPage: false,
        nextCursor: undefined,
        fetchedCount: 1,
        rejected: [],
      });

    mockOffers.upsertOfficialOfferWithSnapshot.mockResolvedValue({
      productAction: 'created',
      snapshotCreated: true,
    });

    const report = await service.sync({
      pageSize: 20,
      maxPages: 3,
      minimumIntervalMs: 0,
    });

    expect(report.duplicatedAcrossPages).toBe(1);
    expect(report.valid).toBe(1);
    expect(mockOffers.upsertOfficialOfferWithSnapshot).toHaveBeenCalledTimes(1);
  });
  it('PAGINAÇÃO SOMENTE POR PAGE', async () => {
    mockProvider.listProductOffers
      .mockResolvedValueOnce({
        items: [{
          source: 'OFFICIAL', providerProductId: 'prod1', shopId: 'shop-1', productName: 'Produto 1',
          shopName: 'Loja 1', price: '10.00', priceMin: '10.00', priceMax: '10.00', discountRate: 0, rating: 5, sales: 10,
          commissionRate: 10, imageUrl: 'http://img.com', productLink: 'http://prod.com', fetchedAt: new Date(),
        }],
        page: 1, limit: 20, hasNextPage: true, nextCursor: undefined, fetchedCount: 1, rejected: []
      })
      .mockResolvedValueOnce({
        items: [], page: 2, limit: 20, hasNextPage: false, nextCursor: undefined, fetchedCount: 0, rejected: []
      });

    mockOffers.upsertOfficialOfferWithSnapshot.mockResolvedValue({ productAction: 'created', snapshotCreated: true });

    const report = await service.sync({ pageSize: 20, maxPages: 3, minimumIntervalMs: 0 });
    expect(report.status).toBe('SUCCEEDED');
    expect(report.pagesRequested).toBe(2);
    expect(report.pagesCompleted).toBe(2);
    expect(mockProvider.listProductOffers.mock.calls[1][0].page).toBe(2);
    expect(mockProvider.listProductOffers.mock.calls[1][0].cursor).toBeUndefined();
    expect(report.fetched).toBe(1);
    expect(report.valid).toBe(1);
    expect(report.created).toBe(1);
  });

  it('TRÊS PÁGINAS SEM CURSOR', async () => {
    mockProvider.listProductOffers
      .mockResolvedValueOnce({ items: [], page: 1, limit: 20, hasNextPage: true, nextCursor: undefined, fetchedCount: 0, rejected: [] })
      .mockResolvedValueOnce({ items: [], page: 2, limit: 20, hasNextPage: true, nextCursor: undefined, fetchedCount: 0, rejected: [] })
      .mockResolvedValueOnce({ items: [], page: 3, limit: 20, hasNextPage: false, nextCursor: undefined, fetchedCount: 0, rejected: [] });

    const report = await service.sync({ pageSize: 20, maxPages: 3, minimumIntervalMs: 0 });
    expect(report.status).toBe('SUCCEEDED');
    expect(report.pagesRequested).toBe(3);
    expect(mockProvider.listProductOffers.mock.calls[0][0].cursor).toBeUndefined();
    expect(mockProvider.listProductOffers.mock.calls[1][0].cursor).toBeUndefined();
    expect(mockProvider.listProductOffers.mock.calls[2][0].cursor).toBeUndefined();
  });

  it('TRUNCAMENTO SEM CURSOR', async () => {
    mockProvider.listProductOffers
      .mockResolvedValueOnce({ items: [], page: 1, limit: 20, hasNextPage: true, nextCursor: undefined, fetchedCount: 0, rejected: [] })
      .mockResolvedValueOnce({ items: [], page: 2, limit: 20, hasNextPage: true, nextCursor: undefined, fetchedCount: 0, rejected: [] });

    const report = await service.sync({ pageSize: 20, maxPages: 2, minimumIntervalMs: 0 });
    expect(report.status).toBe('SUCCEEDED');
    expect(report.completed).toBe(true);
    expect(report.truncated).toBe(true);
    expect(report.pagesRequested).toBe(2);
  });

  it('MODO MISTO', async () => {
    mockProvider.listProductOffers
      .mockResolvedValueOnce({ items: [], page: 1, limit: 20, hasNextPage: true, nextCursor: undefined, fetchedCount: 0, rejected: [] })
      .mockResolvedValueOnce({ items: [], page: 2, limit: 20, hasNextPage: true, nextCursor: 'cursorA', fetchedCount: 0, rejected: [] })
      .mockResolvedValueOnce({ items: [], page: 3, limit: 20, hasNextPage: false, nextCursor: undefined, fetchedCount: 0, rejected: [] });

    const report = await service.sync({ pageSize: 20, maxPages: 3, minimumIntervalMs: 0 });
    expect(report.status).toBe('SUCCEEDED');
    expect(mockProvider.listProductOffers.mock.calls[0][0].cursor).toBeUndefined();
    expect(mockProvider.listProductOffers.mock.calls[1][0].cursor).toBeUndefined();
    expect(mockProvider.listProductOffers.mock.calls[2][0].cursor).toBe('cursorA');
  });

  it('falha se cursor for repetido numa pagina intermediaria', async () => {
    mockProvider.listProductOffers
      .mockResolvedValueOnce({
        items: [], page: 1, limit: 20, hasNextPage: true, nextCursor: 'cursorA', fetchedCount: 0, rejected: []
      })
      .mockResolvedValueOnce({
        items: [], page: 2, limit: 20, hasNextPage: true, nextCursor: 'cursorA', fetchedCount: 0, rejected: []
      });

    const report = await service.sync({ pageSize: 20, maxPages: 3, minimumIntervalMs: 0 });
    expect(report.status).toBe('PARTIAL');
    expect(report.completed).toBe(false);
    expect(report.failureCode).toBe('SHOPEE_OFFICIAL_CATALOG_CURSOR_REPEATED');
    expect(mockProvider.listProductOffers).toHaveBeenCalledTimes(2);
  });

  it('falha se cursor for repetido na ultima pagina permitida', async () => {
    mockProvider.listProductOffers
      .mockResolvedValueOnce({
        items: [], page: 1, limit: 20, hasNextPage: true, nextCursor: 'cursorA', fetchedCount: 0, rejected: []
      })
      .mockResolvedValueOnce({
        items: [], page: 2, limit: 20, hasNextPage: true, nextCursor: 'cursorA', fetchedCount: 0, rejected: []
      });

    const report = await service.sync({ pageSize: 20, maxPages: 2, minimumIntervalMs: 0 });
    expect(report.status).toBe('PARTIAL');
    expect(report.completed).toBe(false);
    expect(report.failureCode).toBe('SHOPEE_OFFICIAL_CATALOG_CURSOR_REPEATED');
  });

  it('falha se cursor for igual ao cursor atual', async () => {
    mockProvider.listProductOffers
      .mockResolvedValueOnce({
        items: [], page: 1, limit: 20, hasNextPage: true, nextCursor: 'cursorA', fetchedCount: 0, rejected: []
      })
      .mockResolvedValueOnce({
        items: [], page: 2, limit: 20, hasNextPage: true, nextCursor: 'cursorA', fetchedCount: 0, rejected: []
      });

    const report = await service.sync({ pageSize: 20, maxPages: 3, minimumIntervalMs: 0 });
    expect(report.status).toBe('PARTIAL');
    expect(report.failureCode).toBe('SHOPEE_OFFICIAL_CATALOG_CURSOR_REPEATED');
  });

  it('respeita sleep somente entre requests e envia limit correto', async () => {
    let sleepCalls = 0;
    const sleepMock = async () => { sleepCalls++; };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new ShopeeOfficialCatalogSyncService(mockProvider as any, mockOffers as any, mockLock as any, mockLogger as any, () => new Date(), sleepMock);

    mockProvider.listProductOffers
      .mockResolvedValueOnce({ items: [], page: 1, limit: 20, hasNextPage: true, nextCursor: 'cursorA', fetchedCount: 0, rejected: [] })
      .mockResolvedValueOnce({ items: [], page: 2, limit: 20, hasNextPage: false, fetchedCount: 0, rejected: [] });

    await service.sync({ pageSize: 20, maxPages: 3, minimumIntervalMs: 100 });

    expect(sleepCalls).toBe(1); // Somente antes da request 2
    expect(mockProvider.listProductOffers.mock.calls[0][0].limit).toBe(20);
  });

  it('falha fechado em overlap do mesmo itemId com shopId divergente', async () => {
    const item = {
      source: 'OFFICIAL',
      providerProductId: 'prod-conflict',
      shopId: 'shop-1',
      productName: 'Produto',
      shopName: 'Loja',
      categoryIds: [],
      price: '10.00', priceMin: '10.00', priceMax: '10.00',
      discountRate: 0, rating: 5, sales: 10, commissionRate: 10,
      imageUrl: 'http://img.com', productLink: 'http://prod.com', fetchedAt: new Date(),
    };
    mockProvider.listProductOffers
      .mockResolvedValueOnce({ items: [item], page: 1, limit: 20, hasNextPage: true, nextCursor: 'cursor1', fetchedCount: 1, rejected: [] })
      .mockResolvedValueOnce({ items: [{ ...item, shopId: 'shop-2' }], page: 2, limit: 20, hasNextPage: false, fetchedCount: 1, rejected: [] });
    mockOffers.upsertOfficialOfferWithSnapshot.mockResolvedValue({ productAction: 'created', snapshotCreated: true });

    const report = await service.sync({ pageSize: 20, maxPages: 3, minimumIntervalMs: 0 });

    expect(report).toMatchObject({
      status: 'PARTIAL',
      completed: false,
      failureCode: 'PRODUCT_VARIANT_DEDUPLICATION',
      pagesCompleted: 1,
    });
    expect(mockOffers.upsertOfficialOfferWithSnapshot).toHaveBeenCalledOnce();
  });

  it('nao deduplica providerProductIds distintos com metadados iguais', async () => {
    const base = {
      source: 'OFFICIAL', shopId: 'shop-1', productName: 'Mesmo nome', shopName: 'Loja',
      categoryIds: [], price: '10.00', priceMin: '10.00', priceMax: '10.00',
      discountRate: 0, rating: 5, sales: 10, commissionRate: 10,
      imageUrl: 'http://img.com', productLink: 'http://prod.com', fetchedAt: new Date(),
    };
    mockProvider.listProductOffers
      .mockResolvedValueOnce({ items: [{ ...base, providerProductId: 'prod-a' }], page: 1, limit: 20, hasNextPage: true, nextCursor: 'cursor1', fetchedCount: 1, rejected: [] })
      .mockResolvedValueOnce({ items: [{ ...base, providerProductId: 'prod-b' }], page: 2, limit: 20, hasNextPage: false, fetchedCount: 1, rejected: [] });
    mockOffers.upsertOfficialOfferWithSnapshot.mockResolvedValue({ productAction: 'created', snapshotCreated: true });

    const report = await service.sync({ pageSize: 20, maxPages: 3, minimumIntervalMs: 0 });

    expect(report).toMatchObject({ status: 'SUCCEEDED', valid: 2, created: 2, duplicatedAcrossPages: 0 });
    expect(mockOffers.upsertOfficialOfferWithSnapshot).toHaveBeenCalledTimes(2);
  });

});
