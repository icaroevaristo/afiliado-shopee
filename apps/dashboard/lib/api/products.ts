import { apiRequest } from './client';
import type {
  CopyPreview,
  DashboardProduct,
  ManualOfferValidation,
  ShopeeCategoryPage,
  ShopeeOfferDetail,
  ShopeeOfferFilters,
  ShopeeOfferPage,
  ShopeeOfferSyncReport,
} from './types';

const filtersToQuery = (filters: ShopeeOfferFilters = {}) => {
  const params = new URLSearchParams();
  if (filters.keyword) params.set('keyword', filters.keyword);
  if (filters.source) params.set('source', filters.source);
  if (filters.status) params.set('status', filters.status);
  if (filters.affiliateLink) params.set('affiliateLink', filters.affiliateLink);
  if (filters.categoryId) params.set('categoryId', filters.categoryId);
  if (filters.minDiscount !== undefined)
    params.set('minDiscount', String(filters.minDiscount));
  if (filters.maxDiscount !== undefined)
    params.set('maxDiscount', String(filters.maxDiscount));
  if (filters.minScore !== undefined)
    params.set('minScore', String(filters.minScore));
  if (filters.maxScore !== undefined)
    params.set('maxScore', String(filters.maxScore));
  if (filters.minPrice !== undefined)
    params.set('minPrice', String(filters.minPrice));
  if (filters.maxPrice !== undefined)
    params.set('maxPrice', String(filters.maxPrice));
  if (filters.minCommission !== undefined)
    params.set('minCommission', String(filters.minCommission));
  if (filters.maxCommission !== undefined)
    params.set('maxCommission', String(filters.maxCommission));
  if (filters.deliveryStatus && filters.deliveryStatus !== 'any')
    params.set('deliveryStatus', filters.deliveryStatus);
  if (filters.destinationId) params.set('destinationId', filters.destinationId);
  if (filters.availability) params.set('availability', filters.availability);
  if (filters.capturedFrom) params.set('capturedFrom', filters.capturedFrom);
  if (filters.capturedTo) params.set('capturedTo', filters.capturedTo);
  if (filters.sort) params.set('sort', filters.sort);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.limit) params.set('limit', String(filters.limit));
  const query = params.toString();
  return query ? `?${query}` : '';
};

export const listShopeeOffers = (filters: ShopeeOfferFilters = {}) =>
  apiRequest<ShopeeOfferPage>(`/shopee/offers${filtersToQuery(filters)}`);

export const listShopeeCategories = () =>
  apiRequest<ShopeeCategoryPage>('/shopee/offers/categories');

export const getShopeeOffer = (
  id: string,
  options: {
    dispatchPage?: number;
    dispatchLimit?: number;
    snapshotPage?: number;
    snapshotLimit?: number;
  } = {},
) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const query = params.toString();
  return apiRequest<ShopeeOfferDetail>(
    `/shopee/offers/${encodeURIComponent(id)}${query ? `?${query}` : ''}`,
  );
};

export const syncShopeeOffers = () =>
  apiRequest<ShopeeOfferSyncReport>('/shopee/offers/sync', { method: 'POST' });

export const validateManualShopeeOffers = (records: unknown[]) =>
  apiRequest<ManualOfferValidation>('/shopee/offers/import/validate', {
    method: 'POST',
    body: { records },
  });

export const importManualShopeeOffers = (records: unknown[]) =>
  apiRequest<ShopeeOfferSyncReport>('/shopee/offers/import', {
    method: 'POST',
    body: { records, confirm: 'CONFIRMAR_IMPORTACAO' },
  });

export const previewShopeeOfferCopy = (id: string) =>
  apiRequest<CopyPreview>(
    `/shopee/offers/${encodeURIComponent(id)}/copy-preview`,
    { method: 'POST' },
  );

export const listProductsFromDispatches = async (): Promise<
  DashboardProduct[]
> => {
  const page = await listShopeeOffers({ page: 1, limit: 100 });
  return page.items.map((offer) => ({
    id: offer.id,
    providerProductId: offer.providerProductId,
    nome: offer.productName,
    categoria: offer.categoryIds[0] ?? 'Sem categoria',
    preco: Number(offer.price),
    desconto: offer.discountRate,
    nota: offer.rating,
    vendidos: offer.sales,
    comissao: offer.commissionRate,
    loja: offer.shopName,
    urlImagem: offer.imageUrl,
    url: offer.productLink,
    score: offer.score,
    scoreUpdatedAt: offer.scoreUpdatedAt,
    createdAt: offer.createdAt,
    updatedAt: offer.updatedAt,
  }));
};
