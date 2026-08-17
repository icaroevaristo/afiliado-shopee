import { describe, expect, it, vi } from 'vitest';
import {
  OfficialShopeeAffiliateOfferProvider,
  SHOPEE_AFFILIATE_OFFICIAL_API_URL,
  ShopeeAffiliateGraphqlTransport,
  ShopeeAffiliateSha256Signer,
  type OfficialShopeeAffiliateFetch,
} from './official-shopee-affiliate-offer-provider';

const officialNode = (overrides: Record<string, unknown> = {}) => ({
  productName: 'Produto oficial de teste',
  itemId: '1234567890123',
  commissionRate: '0.0123',
  commission: '1.23',
  price: '100.00',
  sales: '900719',
  imageUrl: 'https://cf.shopee.com.br/file/image',
  shopName: 'Loja oficial de teste',
  productLink: 'https://shopee.com.br/product/1/2',
  offerLink: 'https://s.shopee.com.br/affiliate-link-exato',
  periodStartTime: '1785196800',
  periodEndTime: '1785283200000',
  priceMin: '90.00',
  priceMax: '110.00',
  productCatIds: [100, 200],
  ratingStar: '4.85',
  priceDiscountRate: 10,
  shopId: '987654321',
  shopType: [1, 3],
  sellerCommissionRate: '0.0023',
  shopeeCommissionRate: '0.01',
  ...overrides,
});

const response = (
  nodes: unknown[],
  pageInfo: Record<string, unknown> = {},
) => ({
  data: {
    productOfferV2: {
      nodes,
      pageInfo: {
        page: 1,
        limit: 5,
        hasNextPage: true,
        scrollId: 'cursor-opaco',
        ...pageInfo,
      },
    },
  },
});

describe('Shopee Affiliate official authentication', () => {
  it('reproduz a fixture oficial com timestamp e material assinado exatos', () => {
    const payload = JSON.stringify({
      query:
        '{\nbrandOffer{\n    nodes{\n        commissionRate\n        offerName\n    }\n}\n}',
    });
    const signer = new ShopeeAffiliateSha256Signer({
      appId: '123456',
      secret: 'demo',
    });
    expect(signer.sign({ payload, timestamp: 1577836800 })).toEqual({
      timestamp: 1577836800,
      authorization:
        'SHA256 Credential=123456, Timestamp=1577836800, Signature=dc88d72feea70c80c52c3399751a7d34966763f51a7f056aa070a5e9df645412',
    });
  });
});

describe('Shopee Affiliate official HTTP transport', () => {
  const request = {
    query: 'query Test { productOfferV2 { pageInfo { page } } }',
    operationName: 'Test',
    variables: { limit: 5 },
  };

  const createTransport = (
    fetchMock: OfficialShopeeAffiliateFetch,
    overrides: Record<string, unknown> = {},
  ) =>
    new ShopeeAffiliateGraphqlTransport({
      apiUrl: SHOPEE_AFFILIATE_OFFICIAL_API_URL,
      signer: new ShopeeAffiliateSha256Signer({
        appId: 'test-app-id',
        secret: 'test-secret-value',
      }),
      fetch: fetchMock,
      clock: () => new Date('2026-07-28T12:00:00.000Z'),
      ...overrides,
    });

  it('envia POST JSON com payload exato e headers oficiais', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { productOfferV2: {} } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await createTransport(fetchMock).execute(request);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(SHOPEE_AFFILIATE_OFFICIAL_API_URL);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Authorization: expect.stringMatching(
        /^SHA256 Credential=test-app-id, Timestamp=\d+, Signature=[0-9a-f]{64}$/,
      ),
      'Content-Type': 'application/json',
    });
    expect(init.body).toBe(JSON.stringify(request));
  });

  it('aborta no timeout sem retry', async () => {
    const fetchMock = vi.fn(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    await expect(
      createTransport(fetchMock as OfficialShopeeAffiliateFetch, {
        timeoutMs: 5,
      }).execute(request),
    ).rejects.toMatchObject({ code: 'SHOPEE_API_TIMEOUT' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('mantem o timeout ativo durante a leitura do corpo', async () => {
    let delayedWrite: ReturnType<typeof setTimeout> | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        delayedWrite = setTimeout(() => {
          controller.enqueue(new TextEncoder().encode('{"data":{}}'));
          controller.close();
        }, 50);
      },
      cancel() {
        if (delayedWrite) clearTimeout(delayedWrite);
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await expect(
      createTransport(fetchMock, { timeoutMs: 5 }).execute(request),
    ).rejects.toMatchObject({ code: 'SHOPEE_API_TIMEOUT' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    [429, 'SHOPEE_API_RATE_LIMITED'],
    [500, 'SHOPEE_API_HTTP_ERROR'],
  ])('sanitiza HTTP %s', async (status, code) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status }));
    await expect(
      createTransport(fetchMock).execute(request),
    ).rejects.toMatchObject({ code });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('trata erros GraphQL mesmo com HTTP 200', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          errors: [{ message: 'secret leaked by upstream' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    await expect(
      createTransport(fetchMock).execute(request),
    ).rejects.toMatchObject({
      code: 'SHOPEE_API_GRAPHQL_ERROR',
      message: 'A API Shopee retornou erro GraphQL',
    });
  });

  it('encerra em erro seguro para limite GraphQL explicito', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          errors: [{ extensions: { code: 10030, detail: 'nao expor' } }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    await expect(
      createTransport(fetchMock).execute(request),
    ).rejects.toMatchObject({ code: 'SHOPEE_API_RATE_LIMITED' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    [10020, 'SHOPEE_API_AUTHENTICATION_FAILED'],
    [10010, 'SHOPEE_API_QUERY_INVALID'],
  ])(
    'classifica o erro GraphQL %s sem expor detalhes',
    async (errorCode, code) => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            errors: [
              {
                message: 'detalhe confidencial do upstream',
                extensions: { code: errorCode, detail: 'nao expor' },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
      const result = createTransport(fetchMock)
        .execute(request)
        .catch((error) => error);
      await expect(result).resolves.toMatchObject({ code });
      await expect(result).resolves.not.toHaveProperty(
        'message',
        'detalhe confidencial do upstream',
      );
    },
  );

  it('rejeita JSON invalido', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{invalid', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await expect(
      createTransport(fetchMock).execute(request),
    ).rejects.toMatchObject({ code: 'SHOPEE_API_JSON_INVALID' });
  });

  it('rejeita resposta acima do limite antes de materializa-la', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{}', {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'content-length': '101',
        },
      }),
    );
    await expect(
      createTransport(fetchMock, { maximumResponseBytes: 100 }).execute(
        request,
      ),
    ).rejects.toMatchObject({ code: 'SHOPEE_API_RESPONSE_TOO_LARGE' });
  });

  it('nunca propaga segredo vindo de erro de rede', async () => {
    const secret = 'never-print-this-secret';
    const fetchMock = vi.fn().mockRejectedValue(new Error(secret));
    const result = createTransport(fetchMock)
      .execute(request)
      .catch((error) => error);
    await expect(result).resolves.not.toHaveProperty('message', secret);
    await expect(result).resolves.toMatchObject({
      code: 'SHOPEE_API_TRANSPORT_ERROR',
    });
  });
});

describe('OfficialShopeeAffiliateOfferProvider', () => {
  const createProvider = (
    nodes: unknown[],
    pageInfo?: Record<string, unknown>,
    onObservedContract?: (contract: unknown) => void,
  ) => {
    const transport = {
      execute: vi.fn().mockResolvedValue(response(nodes, pageInfo)),
    };
    return {
      transport,
      provider: new OfficialShopeeAffiliateOfferProvider({
        apiEnabled: true,
        apiUrl: SHOPEE_AFFILIATE_OFFICIAL_API_URL,
        appId: 'test-app-id',
        secret: 'test-secret',
        transport,
        clock: () => new Date('2026-07-28T12:00:00.000Z'),
        onObservedContract,
      }),
    };
  };

  it('mapeia dinheiro, taxas, timestamps e preserva offerLink exatamente', async () => {
    const { provider } = createProvider([officialNode()]);
    const page = await provider.listProductOffers({ limit: 5 });
    expect(page.items[0]).toMatchObject({
      source: 'OFFICIAL',
      providerProductId: '1234567890123',
      price: '100.00',
      priceMin: '90.00',
      priceMax: '110.00',
      commissionAmount: '1.23',
      commissionRate: 1.23,
      sellerCommissionRate: 0.23,
      shopeeCommissionRate: 1,
      affiliateLink: 'https://s.shopee.com.br/affiliate-link-exato',
      categoryIds: ['100', '200'],
      shopType: [1, 3],
    });
    expect(page.items[0].offerStartsAt?.toISOString()).toBe(
      '2026-07-28T00:00:00.000Z',
    );
    expect(page.items[0].offerEndsAt?.toISOString()).toBe(
      '2026-07-29T00:00:00.000Z',
    );
    expect(page).toMatchObject({
      fetchedCount: 1,
      rejected: [],
      hasNextPage: true,
      nextCursor: 'cursor-opaco',
    });
  });

  it('converte ratios decimais em percentuais canonicos sem ruido binario', async () => {
    const { provider } = createProvider([
      officialNode({
        commissionRate: '0.14',
        sellerCommissionRate: '0.00125',
        shopeeCommissionRate: '0.14125',
      }),
    ]);
    const page = await provider.listProductOffers({ limit: 1 });
    expect(page.rejected).toEqual([]);
    expect(page.items[0]).toMatchObject({
      commissionRate: 14,
      sellerCommissionRate: 0.125,
      shopeeCommissionRate: 14.125,
    });
    expect(page.items[0]?.commissionRate).not.toBe(Number('0.14') * 100);
  });
  it.each([
    ['seconds observado', 1_785_196_800, '2026-07-28T00:00:00.000Z'],
    ['seconds far-future', 32_503_651_199, '2999-12-31T15:59:59.000Z'],
    ['milliseconds atual', 1_785_196_800_000, '2026-07-28T00:00:00.000Z'],
  ])(
    'reconhece %s sem heuristica de 2100',
    async (_label, periodEndTime, expected) => {
      const { provider } = createProvider([officialNode({ periodEndTime })]);
      const page = await provider.listProductOffers({ limit: 1 });
      expect(page.rejected).toEqual([]);
      expect(page.items[0].offerEndsAt?.toISOString()).toBe(expected);
    },
  );

  it.each([
    ['sem unidade deterministica', 500_000_000_000],
    ['overflow', Number.MAX_SAFE_INTEGER],
    ['anterior a 2000', 915_148_800],
  ])('rejeita timestamp %s', async (_label, periodEndTime) => {
    const { provider } = createProvider([officialNode({ periodEndTime })]);
    const page = await provider.listProductOffers({ limit: 1 });
    expect(page.items).toEqual([]);
    expect(page.rejected).toEqual([
      { index: 0, code: 'SHOPEE_OFFICIAL_PERIOD_END_INVALID' },
    ]);
  });

  it('preserva periodEndTime far-future como Date no item completo', async () => {
    const { provider } = createProvider([
      officialNode({ periodEndTime: 32_503_651_199 }),
    ]);
    const page = await provider.listProductOffers({ limit: 1 });
    expect(page.rejected).toEqual([]);
    expect(page.items[0].offerEndsAt?.toISOString()).toBe(
      '2999-12-31T15:59:59.000Z',
    );
  });

  it('preserva IDs Int64 textuais sem perda de precisao', async () => {
    const itemId = '9223372036854775807';
    const shopId = '9223372036854775806';
    const { provider } = createProvider([officialNode({ itemId, shopId })]);
    const page = await provider.listProductOffers();
    expect(page.items[0]).toMatchObject({
      providerProductId: itemId,
      shopId,
    });
  });

  it('rejeita shopType fora do intervalo Int32 persistivel', async () => {
    const { provider } = createProvider([
      officialNode({ shopType: [2_147_483_648] }),
    ]);
    const page = await provider.listProductOffers();
    expect(page.items).toEqual([]);
    expect(page.rejected).toEqual([
      { index: 0, code: 'SHOPEE_OFFICIAL_SHOP_TYPE_INVALID' },
    ]);
  });

  it('emite somente tipos e unidades sanitizadas da resposta observada', async () => {
    const observe = vi.fn();
    const { provider } = createProvider([officialNode()], undefined, observe);
    await provider.listProductOffers();
    expect(observe).toHaveBeenCalledWith({
      itemCount: 1,
      fieldTypes: expect.objectContaining({
        itemId: ['string'],
        price: ['string'],
        offerLink: ['string'],
      }),
      timestampUnits: {
        periodStartTime: 'seconds',
        periodEndTime: 'milliseconds',
      },
      pageInfoTypes: {
        page: 'number',
        limit: 'number',
        hasNextPage: 'boolean',
        scrollId: 'string',
      },
      affiliateLinkPresentCount: 1,
    });
    expect(JSON.stringify(observe.mock.calls)).not.toContain(
      'affiliate-link-exato',
    );
  });

  it('aceita campos opcionais ausentes', async () => {
    const { provider } = createProvider([
      officialNode({
        sellerCommissionRate: undefined,
        shopeeCommissionRate: undefined,
        shopType: undefined,
        periodStartTime: undefined,
        periodEndTime: undefined,
      }),
    ]);
    const page = await provider.listProductOffers();
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      sellerCommissionRate: undefined,
      shopeeCommissionRate: undefined,
      shopType: undefined,
      offerStartsAt: undefined,
      offerEndsAt: undefined,
    });
  });

  it('isola item invalido sem derrubar item valido da mesma pagina', async () => {
    const { provider } = createProvider([
      officialNode({ offerLink: '' }),
      officialNode({ itemId: '1234567890124' }),
    ]);
    const page = await provider.listProductOffers();
    expect(page.items).toHaveLength(1);
    expect(page.items[0].providerProductId).toBe('1234567890124');
    expect(page.rejected).toEqual([
      { index: 0, code: 'SHOPEE_OFFICIAL_OFFER_LINK_INVALID' },
    ]);
  });

  it('rejeita faixa monetaria invalida de forma estruturada', async () => {
    const { provider } = createProvider([
      officialNode({ priceMin: '120.00', priceMax: '110.00' }),
    ]);
    const page = await provider.listProductOffers();
    expect(page.items).toEqual([]);
    expect(page.rejected).toEqual([
      { index: 0, code: 'SHOPEE_OFFICIAL_PRICE_RANGE_INVALID' },
    ]);
  });

  it('sanitiza envelope e paginacao estruturalmente invalidos', async () => {
    const invalidEnvelope = new OfficialShopeeAffiliateOfferProvider({
      apiEnabled: true,
      apiUrl: SHOPEE_AFFILIATE_OFFICIAL_API_URL,
      appId: 'test-app-id',
      secret: 'test-secret',
      transport: { execute: vi.fn().mockResolvedValue({ data: null }) },
    });
    await expect(invalidEnvelope.listProductOffers()).rejects.toMatchObject({
      code: 'SHOPEE_API_RESPONSE_INVALID',
    });

    const { provider } = createProvider([officialNode()], { limit: 0 });
    await expect(provider.listProductOffers()).rejects.toMatchObject({
      code: 'SHOPEE_API_PAGE_INFO_INVALID',
    });
  });

  it('limita a leitura oficial a cinco e mapeia paginacao', async () => {
    const { provider, transport } = createProvider(
      Array.from({ length: 8 }, (_, index) =>
        officialNode({ itemId: String(1234567890123 + index) }),
      ),
      { hasNextPage: false, scrollId: '' },
    );
    const page = await provider.listProductOffers({ limit: 100, page: 1 });
    expect(page.items).toHaveLength(5);
    expect(page.limit).toBe(5);
    expect(page.hasNextPage).toBe(false);
    expect(page.nextCursor).toBeUndefined();
    expect(transport.execute).toHaveBeenCalledOnce();
    expect(transport.execute.mock.calls[0][0]).toMatchObject({
      operationName: 'ProductOfferV2',
      variables: { page: 1, limit: 5 },
    });
    expect(transport.execute.mock.calls[0][0].query).toContain('$page: Int!');
    expect(transport.execute.mock.calls[0][0].query).toContain('$limit: Int!');
    expect(transport.execute.mock.calls[0][0].query).not.toContain('$scrollId');
  });

  it('inclui scrollId somente na consulta de continuacao', async () => {
    const { provider, transport } = createProvider([officialNode()]);
    await provider.listProductOffers({ cursor: 'cursor-opaco' });
    expect(transport.execute.mock.calls[0][0]).toMatchObject({
      variables: { page: 1, limit: 5, scrollId: 'cursor-opaco' },
    });
    expect(transport.execute.mock.calls[0][0].query).toContain(
      '$scrollId: String',
    );
    expect(transport.execute.mock.calls[0][0].query).toContain(
      'scrollId: $scrollId',
    );
  });
  it('aplica limit=10 com maximumOffersPerPage=20', async () => {
    const { transport } = createProvider(
      Array.from({ length: 30 }, (_, index) =>
        officialNode({ itemId: String(1234567890123 + index) }),
      ),
      { hasNextPage: false, scrollId: '', limit: 5 }
    );
    const providerWith20 = new OfficialShopeeAffiliateOfferProvider({
      apiEnabled: true,
      apiUrl: SHOPEE_AFFILIATE_OFFICIAL_API_URL,
      appId: 'test-app-id',
      secret: 'test-secret',
      maximumOffersPerPage: 20,
      transport,
    });
    const page = await providerWith20.listProductOffers({ limit: 10, page: 1 });
    expect(page.items).toHaveLength(10);
    expect(page.limit).toBeLessThanOrEqual(10);
    expect(page.fetchedCount).toBe(10);
    expect(transport.execute).toHaveBeenCalledOnce();
    expect(transport.execute.mock.calls[0][0].variables.limit).toBe(10);
  });

  it('rejeita limit acima de 50', async () => {
    const providerWith51 = new OfficialShopeeAffiliateOfferProvider({
      apiEnabled: true,
      apiUrl: SHOPEE_AFFILIATE_OFFICIAL_API_URL,
      appId: 'test-app-id',
      secret: 'test-secret',
      maximumOffersPerPage: 51,
      transport: { execute: vi.fn() },
    });
    await expect(providerWith51.listProductOffers()).rejects.toMatchObject({
      code: 'SHOPEE_API_INVALID_LIMIT',
    });
  });

  it('rejeita limite decimal invalido', async () => {
    const providerDecimal = new OfficialShopeeAffiliateOfferProvider({
      apiEnabled: true,
      apiUrl: SHOPEE_AFFILIATE_OFFICIAL_API_URL,
      appId: 'test-app-id',
      secret: 'test-secret',
      maximumOffersPerPage: 20.5,
      transport: { execute: vi.fn() },
    });
    await expect(providerDecimal.listProductOffers()).rejects.toMatchObject({
      code: 'SHOPEE_API_INVALID_LIMIT',
    });
  });

  it('inclui productCatId e rejeita filtros nao suportados', async () => {
    const { provider, transport } = createProvider([officialNode()]);
    await provider.listProductOffers({ categoryId: '100' });
    expect(transport.execute.mock.calls[0][0].variables.productCatId).toBe(100);
    expect(transport.execute.mock.calls[0][0].query).not.toContain('listType');
    expect(transport.execute.mock.calls[0][0].query).not.toContain('minPrice');
    expect(transport.execute.mock.calls[0][0].query).not.toContain('minRating');
  });
});
