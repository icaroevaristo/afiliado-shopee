import { createHash } from 'node:crypto';
import { AppError } from '@shopee-auto-affiliate-ai/shared';
import type {
  ShopeeAffiliateOfferProvider,
  ShopeeOfferSort,
  ShopeeProductOffer,
  ShopeeProductOfferListInput,
  ShopeeProductOfferPage,
  ShopeeProductOfferRejection,
} from './shopee-affiliate-offers';

export const SHOPEE_AFFILIATE_OFFICIAL_API_URL =
  'https://open-api.affiliate.shopee.com.br/graphql';
export const SHOPEE_AFFILIATE_REAL_READ_LIMIT = 5;
export const SHOPEE_AFFILIATE_RESPONSE_LIMIT_BYTES = 1_000_000;
export const SHOPEE_AFFILIATE_HTTP_TIMEOUT_MS = 10_000;

export type OfficialShopeeAffiliateRequest = {
  query: string;
  operationName?: string;
  variables?: Record<string, unknown>;
};

export type OfficialShopeeAffiliateSignatureInput = {
  payload: string;
  timestamp: number;
};

export type OfficialShopeeAffiliateSignature = {
  timestamp: number;
  authorization: string;
};

export interface OfficialShopeeAffiliateSigner {
  sign(
    input: OfficialShopeeAffiliateSignatureInput,
  ): OfficialShopeeAffiliateSignature;
}

export interface OfficialShopeeAffiliateTransport {
  execute(request: OfficialShopeeAffiliateRequest): Promise<unknown>;
}

export type OfficialShopeeAffiliateFetch = typeof fetch;

export class ShopeeAffiliateSha256Signer implements OfficialShopeeAffiliateSigner {
  constructor(
    private readonly credentials: { appId: string; secret: string },
  ) {}

  sign({
    payload,
    timestamp,
  }: OfficialShopeeAffiliateSignatureInput): OfficialShopeeAffiliateSignature {
    const appId = this.credentials.appId.trim();
    const secret = this.credentials.secret.trim();
    if (
      !appId ||
      !secret ||
      !Number.isSafeInteger(timestamp) ||
      timestamp <= 0
    ) {
      throw new AppError(
        'Credenciais ou relogio da API Shopee invalidos',
        'SHOPEE_API_SIGNATURE_INPUT_INVALID',
      );
    }
    const signature = createHash('sha256')
      .update(`${appId}${timestamp}${payload}${secret}`, 'utf8')
      .digest('hex');
    return {
      timestamp,
      authorization: `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`,
    };
  }
}

const readLimitedBody = async (
  response: Response,
  maximumBytes: number,
  signal: AbortSignal,
) => {
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (declaredLength > maximumBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new AppError(
      'Resposta da API Shopee excedeu o limite seguro',
      'SHOPEE_API_RESPONSE_TOO_LARGE',
    );
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let rejectOnAbort: ((reason?: unknown) => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectOnAbort = reject;
  });
  const handleAbort = () =>
    rejectOnAbort?.(new DOMException('aborted', 'AbortError'));
  signal.addEventListener('abort', handleAbort, { once: true });
  try {
    if (signal.aborted) handleAbort();
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new AppError(
          'Resposta da API Shopee excedeu o limite seguro',
          'SHOPEE_API_RESPONSE_TOO_LARGE',
        );
      }
      chunks.push(value);
    }
  } catch (error) {
    if (signal.aborted) await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    signal.removeEventListener('abort', handleAbort);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
};

const isGraphqlEnvelope = (
  value: unknown,
): value is { data?: unknown; errors?: unknown[] } =>
  Boolean(value) &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  ('data' in (value as object) || 'errors' in (value as object));

const graphqlErrorCodes = (errors: unknown[]) =>
  new Set(
    errors.flatMap((error) => {
      if (!error || typeof error !== 'object' || Array.isArray(error))
        return [];
      const extensions = (error as { extensions?: unknown }).extensions;
      if (
        !extensions ||
        typeof extensions !== 'object' ||
        Array.isArray(extensions)
      ) {
        return [];
      }
      const code = (extensions as { code?: unknown }).code;
      return code === undefined || code === null ? [] : [String(code)];
    }),
  );

export class ShopeeAffiliateGraphqlTransport implements OfficialShopeeAffiliateTransport {
  constructor(
    private readonly options: {
      apiUrl: string;
      signer: OfficialShopeeAffiliateSigner;
      fetch?: OfficialShopeeAffiliateFetch;
      clock?: () => Date;
      timeoutMs?: number;
      maximumResponseBytes?: number;
    },
  ) {}

  async execute(request: OfficialShopeeAffiliateRequest): Promise<unknown> {
    if (this.options.apiUrl !== SHOPEE_AFFILIATE_OFFICIAL_API_URL) {
      throw new AppError(
        'URL da API Shopee nao autorizada',
        'SHOPEE_API_URL_NOT_ALLOWED',
      );
    }
    const payload = JSON.stringify({
      query: request.query,
      ...(request.operationName
        ? { operationName: request.operationName }
        : {}),
      ...(request.variables ? { variables: request.variables } : {}),
    });
    const current = this.options.clock?.() ?? new Date();
    const timestamp = Math.floor(current.getTime() / 1_000);
    if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
      throw new AppError(
        'Relogio local invalido para API Shopee',
        'SHOPEE_API_CLOCK_INVALID',
      );
    }
    const signed = this.options.signer.sign({ payload, timestamp });
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ?? SHOPEE_AFFILIATE_HTTP_TIMEOUT_MS,
    );
    try {
      const response = await (this.options.fetch ?? fetch)(
        this.options.apiUrl,
        {
          method: 'POST',
          headers: {
            Authorization: signed.authorization,
            'Content-Type': 'application/json',
          },
          body: payload,
          signal: controller.signal,
        },
      );
      const cancelResponseBody = () =>
        response.body?.cancel().catch(() => undefined);
      if (response.status === 429) {
        await cancelResponseBody();
        throw new AppError(
          'Limite da API Shopee atingido',
          'SHOPEE_API_RATE_LIMITED',
        );
      }
      if (!response.ok) {
        await cancelResponseBody();
        throw new AppError(
          'Resposta HTTP invalida da API Shopee',
          'SHOPEE_API_HTTP_ERROR',
        );
      }
      const contentType = response.headers.get('content-type')?.toLowerCase();
      if (!contentType?.includes('application/json')) {
        await cancelResponseBody();
        throw new AppError(
          'Resposta da API Shopee nao e JSON',
          'SHOPEE_API_JSON_REQUIRED',
        );
      }
      const body = await readLimitedBody(
        response,
        this.options.maximumResponseBytes ??
          SHOPEE_AFFILIATE_RESPONSE_LIMIT_BYTES,
        controller.signal,
      );
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        throw new AppError(
          'JSON invalido retornado pela API Shopee',
          'SHOPEE_API_JSON_INVALID',
        );
      }
      if (!isGraphqlEnvelope(parsed)) {
        throw new AppError(
          'Resposta GraphQL invalida da API Shopee',
          'SHOPEE_API_RESPONSE_INVALID',
        );
      }
      if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
        const errorCodes = graphqlErrorCodes(parsed.errors);
        if (errorCodes.has('10030')) {
          throw new AppError(
            'Limite da API Shopee atingido',
            'SHOPEE_API_RATE_LIMITED',
          );
        }
        if (errorCodes.has('10020')) {
          throw new AppError(
            'Autenticacao da API Shopee rejeitada',
            'SHOPEE_API_AUTHENTICATION_FAILED',
          );
        }
        if (errorCodes.has('10010')) {
          throw new AppError(
            'Consulta GraphQL da API Shopee rejeitada',
            'SHOPEE_API_QUERY_INVALID',
          );
        }
        throw new AppError(
          'A API Shopee retornou erro GraphQL',
          'SHOPEE_API_GRAPHQL_ERROR',
        );
      }
      return parsed;
    } catch (error) {
      if (controller.signal.aborted) {
        throw new AppError(
          'Tempo limite da API Shopee excedido',
          'SHOPEE_API_TIMEOUT',
        );
      }
      if (error instanceof AppError) throw error;
      void error;
      throw new AppError(
        'Falha segura no transporte da API Shopee',
        'SHOPEE_API_TRANSPORT_ERROR',
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

export type OfficialShopeeAffiliateOfferProviderOptions = {
  maximumOffersPerPage?: number;
  apiEnabled?: boolean;
  apiUrl?: string;
  appId?: string;
  secret?: string;
  transport?: OfficialShopeeAffiliateTransport;
  signer?: OfficialShopeeAffiliateSigner;
  fetch?: OfficialShopeeAffiliateFetch;
  clock?: () => Date;
  timeoutMs?: number;
  maximumResponseBytes?: number;
  onObservedContract?: (contract: OfficialShopeeObservedContract) => void;
};

export type OfficialShopeeObservedContract = {
  itemCount: number;
  fieldTypes: Record<string, string[]>;
  timestampUnits: {
    periodStartTime:
      'seconds' | 'milliseconds' | 'absent' | 'unknown' | 'mixed';
    periodEndTime: 'seconds' | 'milliseconds' | 'absent' | 'unknown' | 'mixed';
  };
  pageInfoTypes: Record<string, string>;
  affiliateLinkPresentCount: number;
};

const productOfferV2Query = (withScrollId: boolean) => {
  const scrollVariable = withScrollId ? '  $scrollId: String\n' : '';
  const scrollArgument = withScrollId ? '    scrollId: $scrollId\n' : '';
  return `query ProductOfferV2(
  $page: Int!
  $limit: Int!
${scrollVariable}  $keyword: String
  $sortType: Int
  $productCatId: Int
) {
  productOfferV2(
    page: $page
    limit: $limit
${scrollArgument}    keyword: $keyword
    sortType: $sortType
    productCatId: $productCatId
  ) {
    nodes {
      productName
      itemId
      commissionRate
      commission
      price
      sales
      imageUrl
      shopName
      productLink
      offerLink
      periodStartTime
      periodEndTime
      priceMin
      priceMax
      productCatIds
      ratingStar
      priceDiscountRate
      shopId
      shopType
      sellerCommissionRate
      shopeeCommissionRate
    }
    pageInfo {
      page
      limit
      hasNextPage
      scrollId
    }
  }
}`;
};

const SORT_TYPES: Record<ShopeeOfferSort, number> = {
  relevance: 1,
  sales_desc: 2,
  price_desc: 3,
  price_asc: 4,
  commission_desc: 5,
};

const asRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('OBJECT_REQUIRED');
  }
  return value as Record<string, unknown>;
};

const asResponseRecord = (value: unknown) => {
  try {
    return asRecord(value);
  } catch {
    throw new AppError(
      'Resposta GraphQL invalida da API Shopee',
      'SHOPEE_API_RESPONSE_INVALID',
    );
  }
};

const requiredString = (value: unknown, code: string) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(code);
  }
  return value;
};

const decimalString = (value: unknown, code: string) => {
  const result = requiredString(value, code);
  if (!/^\d+(?:\.\d+)?$/.test(result)) throw new Error(code);
  return result;
};

const moneyString = (value: unknown, code: string) => {
  const result = requiredString(value, code);
  if (!/^\d{1,10}(?:\.\d{1,4})?$/.test(result)) throw new Error(code);
  return result;
};

const finiteNumber = (value: unknown, code: string) => {
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) {
    throw new Error(code);
  }
  return parsed;
};

const safeInteger = (value: unknown, code: string) => {
  const parsed = finiteNumber(value, code);
  if (!Number.isSafeInteger(parsed)) throw new Error(code);
  return parsed;
};

const integerInRange = (
  value: unknown,
  minimum: number,
  maximum: number,
  code: string,
) => {
  const parsed = safeInteger(value, code);
  if (parsed < minimum || parsed > maximum) throw new Error(code);
  return parsed;
};

const integerString = (value: unknown, code: string) => {
  if (typeof value === 'string' && /^\d+$/.test(value)) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  throw new Error(code);
};

const decimalRatioToPercent = (ratio: string) => {
  const [integerPart, fractionPart = ''] = ratio.split('.');
  const digits = `${integerPart}${fractionPart}`.replace(/^0+(?=\d)/, '');
  const decimalPlaces = Math.max(fractionPart.length - 2, 0);
  if (decimalPlaces === 0) {
    return Number(`${digits}${'0'.repeat(Math.max(2 - fractionPart.length, 0))}`);
  }
  const padded = digits.padStart(decimalPlaces + 1, '0');
  const splitAt = padded.length - decimalPlaces;
  return Number(`${padded.slice(0, splitAt)}.${padded.slice(splitAt)}`);
};

const percentFromRatio = (value: unknown, code: string) => {
  const ratioText = decimalString(value, code);
  const ratio = Number(ratioText);
  if (ratio < 0 || ratio > 1) throw new Error(code);
  return decimalRatioToPercent(ratioText);
};

const httpUrl = (value: unknown, code: string) => {
  const result = requiredString(value, code);
  const protocol = new URL(result).protocol;
  if (protocol !== 'http:' && protocol !== 'https:') throw new Error(code);
  return result;
};

type TimestampUnit = 'seconds' | 'milliseconds';

type TimestampCandidate = { unit: TimestampUnit; date: Date };

const EARLIEST_SUPPORTED_TIMESTAMP_MS = Date.UTC(2000, 0, 1);
const LATEST_SUPPORTED_TIMESTAMP_MS = Date.UTC(
  9999,
  11,
  31,
  23,
  59,
  59,
  999,
);

const selectSingleEpochTimestampCandidate = (
  candidates: readonly TimestampCandidate[],
  code: string,
) => {
  if (candidates.length !== 1) throw new Error(code);
  return candidates[0];
};

const parseEpochTimestamp = (value: unknown, code: string) => {
  const raw = safeInteger(value, code);
  const toCandidate = (
    unit: TimestampUnit,
    milliseconds: number,
  ): TimestampCandidate | undefined => {
    if (
      !Number.isSafeInteger(milliseconds) ||
      milliseconds < EARLIEST_SUPPORTED_TIMESTAMP_MS ||
      milliseconds > LATEST_SUPPORTED_TIMESTAMP_MS
    ) {
      return undefined;
    }
    const date = new Date(milliseconds);
    return date.getTime() === milliseconds ? { unit, date } : undefined;
  };
  const candidates = [
    toCandidate('seconds', raw * 1_000),
    toCandidate('milliseconds', raw),
  ].filter((candidate): candidate is TimestampCandidate => Boolean(candidate));
  return selectSingleEpochTimestampCandidate(candidates, code);
};

const optionalEpochTimestamp = (value: unknown, code: string) => {
  if (value === undefined || value === null || value === '') return undefined;
  return parseEpochTimestamp(value, code).date;
};

const valueType = (value: unknown) =>
  value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;

const observedTypes = (
  nodes: Record<string, unknown>[],
  fields: readonly string[],
) =>
  Object.fromEntries(
    fields.map((field) => [
      field,
      [...new Set(nodes.map((node) => valueType(node[field])))].sort(),
    ]),
  );

const observedTimestampUnit = (
  nodes: Record<string, unknown>[],
  field: string,
): OfficialShopeeObservedContract['timestampUnits']['periodStartTime'] => {
  const values = nodes
    .map((node) => node[field])
    .filter((value) => value !== undefined && value !== null && value !== '');
  if (values.length === 0) return 'absent';
  const units = new Set<TimestampUnit | 'unknown'>();
  for (const value of values) {
    try {
      units.add(parseEpochTimestamp(value, 'TIMESTAMP').unit);
    } catch {
      units.add('unknown');
    }
  }
  return units.size === 1 ? ([...units][0] ?? 'unknown') : 'mixed';
};

const OBSERVED_OFFER_FIELDS = [
  'productName',
  'itemId',
  'commissionRate',
  'commission',
  'price',
  'sales',
  'imageUrl',
  'shopName',
  'productLink',
  'offerLink',
  'periodStartTime',
  'periodEndTime',
  'priceMin',
  'priceMax',
  'productCatIds',
  'ratingStar',
  'priceDiscountRate',
  'shopId',
  'shopType',
  'sellerCommissionRate',
  'shopeeCommissionRate',
] as const;

const mapOfficialOffer = (
  node: unknown,
  fetchedAt: Date,
): ShopeeProductOffer => {
  const value = asRecord(node);
  const categoryIds = Array.isArray(value.productCatIds)
    ? value.productCatIds.map((entry) => String(safeInteger(entry, 'CATEGORY')))
    : [];
  const shopType = Array.isArray(value.shopType)
    ? value.shopType.map((entry) =>
        integerInRange(entry, -2_147_483_648, 2_147_483_647, 'SHOP_TYPE'),
      )
    : undefined;
  const price = moneyString(value.price, 'PRICE');
  const priceMin = moneyString(value.priceMin ?? price, 'PRICE_MIN');
  const priceMax = moneyString(value.priceMax ?? price, 'PRICE_MAX');
  if (Number(priceMin) > Number(priceMax)) throw new Error('PRICE_RANGE');
  return {
    source: 'OFFICIAL',
    providerProductId: integerString(value.itemId, 'ITEM_ID'),
    productName: requiredString(value.productName, 'PRODUCT_NAME'),
    shopId: integerString(value.shopId, 'SHOP_ID'),
    shopName: requiredString(value.shopName, 'SHOP_NAME'),
    categoryIds,
    price,
    priceMin,
    priceMax,
    discountRate: integerInRange(
      value.priceDiscountRate,
      0,
      100,
      'DISCOUNT_RATE',
    ),
    rating: (() => {
      const rating = Number(decimalString(value.ratingStar, 'RATING'));
      if (rating < 0 || rating > 5) throw new Error('RATING');
      return rating;
    })(),
    sales: integerInRange(value.sales, 0, 2_147_483_647, 'SALES'),
    commissionRate: percentFromRatio(value.commissionRate, 'COMMISSION_RATE'),
    commissionAmount: moneyString(value.commission, 'COMMISSION'),
    sellerCommissionRate:
      value.sellerCommissionRate === undefined
        ? undefined
        : percentFromRatio(
            value.sellerCommissionRate,
            'SELLER_COMMISSION_RATE',
          ),
    shopeeCommissionRate:
      value.shopeeCommissionRate === undefined
        ? undefined
        : percentFromRatio(
            value.shopeeCommissionRate,
            'SHOPEE_COMMISSION_RATE',
          ),
    imageUrl: httpUrl(value.imageUrl, 'IMAGE_URL'),
    productLink: httpUrl(value.productLink, 'PRODUCT_LINK'),
    affiliateLink: httpUrl(value.offerLink, 'OFFER_LINK'),
    offerStartsAt: optionalEpochTimestamp(
      value.periodStartTime,
      'PERIOD_START',
    ),
    offerEndsAt: optionalEpochTimestamp(value.periodEndTime, 'PERIOD_END'),
    shopType,
    fetchedAt,
  };
};

const rejectionCode = (error: unknown) =>
  error instanceof Error && /^[A-Z_]+$/.test(error.message)
    ? `SHOPEE_OFFICIAL_${error.message}_INVALID`
    : 'SHOPEE_OFFICIAL_ITEM_INVALID';

const validateUnsupportedFilters = (input: ShopeeProductOfferListInput) => {
  if (
    input.minPrice !== undefined ||
    input.maxPrice !== undefined ||
    input.minCommissionRate !== undefined ||
    input.minDiscountRate !== undefined ||
    input.minRating !== undefined ||
    (input.subIds?.length ?? 0) > 0
  ) {
    throw new AppError(
      'Filtro nao confirmado para productOfferV2',
      'SHOPEE_API_FILTER_UNSUPPORTED',
    );
  }
};

export class OfficialShopeeAffiliateOfferProvider implements ShopeeAffiliateOfferProvider {
  readonly source = 'OFFICIAL' as const;

  constructor(
    private readonly options: OfficialShopeeAffiliateOfferProviderOptions = {},
  ) {}

  private transport() {
    if (this.options.transport) return this.options.transport;
    const signer =
      this.options.signer ??
      new ShopeeAffiliateSha256Signer({
        appId: this.options.appId as string,
        secret: this.options.secret as string,
      });
    return new ShopeeAffiliateGraphqlTransport({
      apiUrl: this.options.apiUrl as string,
      signer,
      fetch: this.options.fetch,
      clock: this.options.clock,
      timeoutMs: this.options.timeoutMs,
      maximumResponseBytes: this.options.maximumResponseBytes,
    });
  }

  async listProductOffers(
    input: ShopeeProductOfferListInput = {},
  ): Promise<ShopeeProductOfferPage> {
    const configured =
      this.options.apiEnabled === true &&
      this.options.apiUrl === SHOPEE_AFFILIATE_OFFICIAL_API_URL &&
      Boolean(this.options.appId?.trim()) &&
      Boolean(this.options.secret?.trim());
    if (!configured) {
      throw new AppError(
        'API oficial da Shopee ainda nao configurada',
        'SHOPEE_API_NOT_CONFIGURED',
      );
    }

    const maximumOffersPerPage =
      this.options.maximumOffersPerPage ?? SHOPEE_AFFILIATE_REAL_READ_LIMIT;

    if (
      !Number.isSafeInteger(maximumOffersPerPage) ||
      maximumOffersPerPage < 1 ||
      maximumOffersPerPage > 50
    ) {
      throw new AppError(
        'Limite de ofertas invalido',
        'SHOPEE_API_INVALID_LIMIT',
      );
    }
    const requestedLimit = input.limit ?? maximumOffersPerPage;
    if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) {
      throw new AppError(
        'Limite solicitado invalido',
        'SHOPEE_API_INVALID_LIMIT',
      );
    }

    const limit = Math.min(requestedLimit, maximumOffersPerPage);

    validateUnsupportedFilters(input);

    const sortType = input.sort ? SORT_TYPES[input.sort] : undefined;
    const productCatId =
      input.categoryId === undefined
        ? undefined
        : safeInteger(input.categoryId, 'CATEGORY_ID');

    const response = asResponseRecord(
      await this.transport().execute({
        operationName: 'ProductOfferV2',
        query: productOfferV2Query(Boolean(input.cursor)),
        variables: {
          limit,
          page: input.page ?? 1,
          ...(input.cursor ? { scrollId: input.cursor } : {}),
          keyword: input.keyword ?? undefined,
          productCatId,
          sortType,
        },
      }),
    );
    const data = asResponseRecord(response.data);
    const productOffer = asResponseRecord(data.productOfferV2);
    const rawNodes = Array.isArray(productOffer.nodes)
      ? productOffer.nodes
      : [];
    const observedNodes = rawNodes.slice(0, limit).flatMap((node) => {
      try {
        return [asRecord(node)];
      } catch {
        return [];
      }
    });
    const fetchedAt = this.options.clock?.() ?? new Date();
    const items: ShopeeProductOffer[] = [];
    const rejected: ShopeeProductOfferRejection[] = [];
    rawNodes.slice(0, limit).forEach((node, index) => {
      try {
        items.push(mapOfficialOffer(node, fetchedAt));
      } catch (error) {
        rejected.push({ index, code: rejectionCode(error) });
      }
    });
    const pageInfo = asResponseRecord(productOffer.pageInfo);
    this.options.onObservedContract?.({
      itemCount: Math.min(rawNodes.length, limit),
      fieldTypes: observedTypes(observedNodes, OBSERVED_OFFER_FIELDS),
      timestampUnits: {
        periodStartTime: observedTimestampUnit(
          observedNodes,
          'periodStartTime',
        ),
        periodEndTime: observedTimestampUnit(observedNodes, 'periodEndTime'),
      },
      pageInfoTypes: Object.fromEntries(
        ['page', 'limit', 'hasNextPage', 'scrollId'].map((field) => [
          field,
          valueType(pageInfo[field]),
        ]),
      ),
      affiliateLinkPresentCount: observedNodes.filter(
        (node) =>
          typeof node.offerLink === 'string' && node.offerLink.length > 0,
      ).length,
    });
    let page: number;
    let pageLimit: number;
    try {
      page = integerInRange(
        pageInfo.page ?? input.page ?? 1,
        1,
        Number.MAX_SAFE_INTEGER,
        'PAGE',
      );
      pageLimit = integerInRange(pageInfo.limit ?? limit, 1, 500, 'LIMIT');
    } catch {
      throw new AppError(
        'Paginacao invalida retornada pela API Shopee',
        'SHOPEE_API_PAGE_INFO_INVALID',
      );
    }
    if (typeof pageInfo.hasNextPage !== 'boolean') {
      throw new AppError(
        'Paginacao invalida retornada pela API Shopee',
        'SHOPEE_API_PAGE_INFO_INVALID',
      );
    }
    const nextCursor =
      typeof pageInfo.scrollId === 'string' && pageInfo.scrollId.length > 0
        ? pageInfo.scrollId
        : undefined;
    return {
      items,
      page,
      limit: Math.min(pageLimit, limit),
      hasNextPage: pageInfo.hasNextPage,
      nextCursor,
      fetchedCount: Math.min(rawNodes.length, limit),
      rejected,
    };
  }
}
