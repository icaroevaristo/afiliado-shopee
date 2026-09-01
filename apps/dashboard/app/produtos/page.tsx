'use client';

import Link from 'next/link';
import { ExternalLink, Link2, Search } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { OffersContextNav } from '../../components/offers-context-nav';
import {
  OpsBadge,
  OpsEmpty,
  OpsLoading,
  OpsPageHeading,
  OpsSection,
  OpsState,
  RefreshButton,
  type OpsTone,
} from '../../components/ops-components';
import { SafeProductImage } from '../../components/safe-product-image';
import {
  listShopeeCategories,
  listShopeeOffers,
  type ShopeeCategory,
  type ShopeeOffer,
  type ShopeeOfferDeliveryStatus,
  type ShopeeOfferFilters,
  type ShopeeOfferPage,
  type ShopeeOfferSort,
  type ShopeeOfferStatus,
} from '../../lib/api';
import {
  formatCurrency,
  formatDateTime,
  formatNumber,
  formatPercent,
} from '../../lib/format';

type QuickFilter = 'all' | 'sales' | 'discount' | 'commission';

const createInitialFilters = (): ShopeeOfferFilters => ({
  keyword: '',
  source: '',
  availability: '',
  affiliateLink: '',
  deliveryStatus: 'any',
  sort: 'recent',
  page: 1,
  limit: 12,
});

const statusLabel: Record<ShopeeOfferStatus, string> = {
  ACTIVE: 'Ativa',
  EXPIRED: 'Expirada',
  UNAVAILABLE: 'Indisponível',
};

const quickFilters: Array<{
  key: QuickFilter;
  label: string;
  sort: ShopeeOfferSort;
}> = [
  { key: 'all', label: 'Todas', sort: 'recent' },
  { key: 'sales', label: 'Mais vendidas', sort: 'sales_desc' },
  { key: 'discount', label: 'Maior desconto', sort: 'discount_desc' },
  { key: 'commission', label: 'Maior comissão', sort: 'commission_desc' },
];

const sourceFromValue = (value: string): ShopeeOfferFilters['source'] =>
  value === 'MOCK' || value === 'MANUAL' || value === 'OFFICIAL' ? value : '';

const statusFromValue = (value: string): ShopeeOfferStatus | '' =>
  value === 'ACTIVE' || value === 'EXPIRED' || value === 'UNAVAILABLE'
    ? value
    : '';

const deliveryFromValue = (value: string): ShopeeOfferDeliveryStatus =>
  value === 'sent' || value === 'not_sent' ? value : 'any';

const sortFromValue = (value: string): ShopeeOfferSort => {
  switch (value) {
    case 'sales_desc':
    case 'score_desc':
    case 'discount_desc':
    case 'commission_desc':
    case 'price_asc':
    case 'price_desc':
    case 'recent':
      return value;
    default:
      return 'recent';
  }
};

const optionalNumber = (value: string) => {
  if (value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const toFiniteNumber = (value: string | number | null | undefined) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const safeCurrency = (value: string | number | null | undefined) =>
  formatCurrency(toFiniteNumber(value));

const safeNumber = (value: string | number | null | undefined) =>
  formatNumber(toFiniteNumber(value));

const safePercent = (value: string | number | null | undefined) =>
  formatPercent(toFiniteNumber(value));

const priceRangeLabel = (
  min: string | number | null | undefined,
  max: string | number | null | undefined,
) => {
  const minValue = toFiniteNumber(min);
  const maxValue = toFiniteNumber(max);
  if (minValue === null && maxValue === null) return null;
  if (minValue !== null && maxValue !== null && minValue === maxValue) {
    return null;
  }
  if (minValue !== null && maxValue !== null) {
    return `${formatCurrency(minValue)} – ${formatCurrency(maxValue)}`;
  }
  return minValue !== null
    ? `A partir de ${formatCurrency(minValue)}`
    : `Até ${formatCurrency(maxValue)}`;
};

const safeCategoryLabel = (category: ShopeeCategory) => {
  const name = category.name?.trim();
  if (name) return name;
  const displayLabel = category.displayLabel?.trim();
  if (!displayLabel || displayLabel.includes(category.id)) {
    return 'Categoria não disponível';
  }
  return displayLabel;
};

const isSafeHttpUrl = (value: string | undefined) => {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

export default function ProductsPage() {
  const [result, setResult] = useState<ShopeeOfferPage | null>(null);
  const [categories, setCategories] = useState<ShopeeCategory[]>([]);
  const [categoryError, setCategoryError] = useState(false);
  const [filters, setFilters] = useState<ShopeeOfferFilters>(
    createInitialFilters(),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const load = useCallback(async (nextFilters: ShopeeOfferFilters) => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError(null);
    try {
      const nextResult = await listShopeeOffers(nextFilters);
      if (sequence === requestSequence.current) setResult(nextResult);
    } catch (err) {
      if (sequence === requestSequence.current) {
        setError(err instanceof Error ? err.message : 'Erro inesperado.');
      }
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialFilters = createInitialFilters();
    void load(initialFilters);
    void listShopeeCategories()
      .then((response) => {
        setCategories(response.items);
        setCategoryError(false);
      })
      .catch(() => {
        setCategoryError(true);
      });
  }, [load]);

  const categoryMap = useMemo(
    () =>
      new Map(
        categories.map((category) => [
          category.id,
          safeCategoryLabel(category),
        ]),
      ),
    [categories],
  );

  const submitFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = { ...filters, page: 1 };
    setFilters(next);
    void load(next);
  };

  const clearFilters = () => {
    const next = createInitialFilters();
    setFilters(next);
    void load(next);
  };

  const changePage = (page: number) => {
    const next = { ...filters, page };
    setFilters(next);
    void load(next);
  };

  const applyQuickFilter = (quickFilter: (typeof quickFilters)[number]) => {
    const next = { ...filters, sort: quickFilter.sort, page: 1 };
    setFilters(next);
    void load(next);
  };

  const setNumberFilter = (
    field:
      | 'minDiscount'
      | 'maxDiscount'
      | 'minScore'
      | 'maxScore'
      | 'minPrice'
      | 'maxPrice'
      | 'minCommission'
      | 'maxCommission',
    value: string,
  ) => {
    setFilters((current) => ({ ...current, [field]: optionalNumber(value) }));
  };

  const selectedQuickFilter = quickFilters.find(
    (quickFilter) => quickFilter.sort === filters.sort,
  )?.key;

  return (
    <div className="offers-page">
      <OpsPageHeading
        eyebrow="Catálogo"
        title="Ofertas"
        description="Encontre e acompanhe as melhores oportunidades da Shopee."
        actions={
          <Link href="/cupons" className="ops-button">
            Ver cupons
          </Link>
        }
      />

      <OffersContextNav active="offers" />

      <OpsSection
        title="Encontre uma oportunidade"
        meta="Use a busca e os atalhos para começar. Os filtros avançados ficam disponíveis quando você precisar refinar a seleção."
        className="offers-toolbar-section"
      >
        <form onSubmit={submitFilters} className="offers-toolbar-form">
          <label className="offers-search-field">
            <span>Buscar oferta</span>
            <div className="offers-search-control">
              <Search size={17} aria-hidden="true" />
              <input
                value={filters.keyword ?? ''}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    keyword: event.target.value,
                  }))
                }
                placeholder="Nome do produto ou loja"
                aria-label="Buscar por produto ou loja"
              />
            </div>
          </label>
          <button type="submit" className="ops-button offers-search-button">
            Buscar
          </button>

          <div className="offers-quick-filter-row" aria-label="Filtros rápidos">
            <span className="offers-filter-label">Ver por</span>
            <div className="offers-quick-filters">
              {quickFilters.map((quickFilter) => (
                <button
                  type="button"
                  key={quickFilter.key}
                  className={`offers-quick-filter ${selectedQuickFilter === quickFilter.key ? 'is-active' : ''}`}
                  aria-pressed={selectedQuickFilter === quickFilter.key}
                  onClick={() => applyQuickFilter(quickFilter)}
                >
                  {quickFilter.label}
                </button>
              ))}
            </div>
          </div>

          <details className="offers-advanced-filters">
            <summary>Refinar busca</summary>
            <div className="offers-filter-grid">
              <FilterSelect
                label="Categoria"
                value={filters.categoryId ?? ''}
                onChange={(value) =>
                  setFilters((current) => ({
                    ...current,
                    categoryId: value || undefined,
                  }))
                }
                options={categories.map((category) => [
                  category.id,
                  safeCategoryLabel(category),
                ])}
              />
              <FilterSelect
                label="Disponibilidade"
                value={filters.availability ?? ''}
                onChange={(value) =>
                  setFilters((current) => ({
                    ...current,
                    availability: statusFromValue(value),
                  }))
                }
                options={[
                  ['ACTIVE', 'Ativa'],
                  ['EXPIRED', 'Expirada'],
                  ['UNAVAILABLE', 'Indisponível'],
                ]}
              />
              <FilterSelect
                label="Ordenação"
                value={filters.sort ?? 'recent'}
                onChange={(value) =>
                  setFilters((current) => ({
                    ...current,
                    sort: sortFromValue(value),
                  }))
                }
                options={[
                  ['recent', 'Mais recentes'],
                  ['sales_desc', 'Mais vendidas'],
                  ['score_desc', 'Maior score'],
                  ['discount_desc', 'Maior desconto'],
                  ['commission_desc', 'Maior comissão'],
                  ['price_asc', 'Menor preço'],
                  ['price_desc', 'Maior preço'],
                ]}
              />
              <FilterSelect
                label="Link afiliado"
                value={filters.affiliateLink ?? ''}
                onChange={(value) =>
                  setFilters((current) => ({
                    ...current,
                    affiliateLink:
                      value === 'present' || value === 'missing' ? value : '',
                  }))
                }
                options={[
                  ['present', 'Disponível'],
                  ['missing', 'Ausente'],
                ]}
              />
              <FilterSelect
                label="Envio"
                value={filters.deliveryStatus ?? 'any'}
                onChange={(value) =>
                  setFilters((current) => ({
                    ...current,
                    deliveryStatus: deliveryFromValue(value),
                  }))
                }
                options={[
                  ['any', 'Todas'],
                  ['not_sent', 'Ainda não enviadas'],
                  ['sent', 'Já enviadas'],
                ]}
              />
              <NumberFilter
                label="Desconto mínimo (%)"
                value={filters.minDiscount}
                onChange={(value) => setNumberFilter('minDiscount', value)}
              />
              <NumberFilter
                label="Desconto máximo (%)"
                value={filters.maxDiscount}
                onChange={(value) => setNumberFilter('maxDiscount', value)}
              />
              <NumberFilter
                label="Score mínimo"
                value={filters.minScore}
                onChange={(value) => setNumberFilter('minScore', value)}
              />
              <NumberFilter
                label="Score máximo"
                value={filters.maxScore}
                onChange={(value) => setNumberFilter('maxScore', value)}
              />
              <NumberFilter
                label="Preço mínimo"
                value={filters.minPrice}
                onChange={(value) => setNumberFilter('minPrice', value)}
              />
              <NumberFilter
                label="Preço máximo"
                value={filters.maxPrice}
                onChange={(value) => setNumberFilter('maxPrice', value)}
              />
              <NumberFilter
                label="Comissão mínima (%)"
                value={filters.minCommission}
                onChange={(value) => setNumberFilter('minCommission', value)}
              />
              <NumberFilter
                label="Comissão máxima (%)"
                value={filters.maxCommission}
                onChange={(value) => setNumberFilter('maxCommission', value)}
              />
              <DateFilter
                label="Capturada de"
                value={filters.capturedFrom}
                onChange={(value) =>
                  setFilters((current) => ({
                    ...current,
                    capturedFrom: value || undefined,
                  }))
                }
              />
              <DateFilter
                label="Capturada até"
                value={filters.capturedTo}
                onChange={(value) =>
                  setFilters((current) => ({
                    ...current,
                    capturedTo: value || undefined,
                  }))
                }
              />
              <FilterSelect
                label="Origem do catálogo"
                value={filters.source ?? ''}
                onChange={(value) =>
                  setFilters((current) => ({
                    ...current,
                    source: sourceFromValue(value),
                  }))
                }
                options={[
                  ['MOCK', 'Demonstração'],
                  ['MANUAL', 'Importada'],
                  ['OFFICIAL', 'Oficial'],
                ]}
              />
            </div>
            <div className="offers-filter-actions">
              <button type="submit" className="ops-button">
                Aplicar filtros
              </button>
              <button
                type="button"
                className="ops-button is-quiet"
                onClick={clearFilters}
              >
                Limpar
              </button>
            </div>
          </details>
        </form>
      </OpsSection>

      <OpsState
        tone="info"
        title="Ofertas relâmpago"
        message="Esse tipo de sinal não está disponível no contrato atual. As ofertas abaixo usam somente dados comerciais persistidos."
      />

      {categoryError ? (
        <OpsState
          tone="warning"
          title="Categorias indisponíveis"
          message="A busca continua funcionando; alguns produtos podem aparecer sem o nome da categoria."
        />
      ) : null}

      {error ? (
        <OpsState
          tone="danger"
          title="Não foi possível carregar as ofertas"
          message={error}
          action={
            <RefreshButton onClick={() => void load(filters)} busy={loading} />
          }
        />
      ) : null}

      {loading && !result ? <OpsLoading label="Carregando ofertas" /> : null}
      {loading && result ? <OpsLoading label="Atualizando ofertas" /> : null}

      {!loading && !error && result?.items.length === 0 ? (
        <OpsEmpty
          title="Nenhuma oferta encontrada"
          message="Nenhuma oportunidade persistida corresponde aos filtros atuais."
        />
      ) : null}

      {result?.items.length ? (
        <>
          <div className="offers-table-wrap">
            <table className="offers-table">
              <thead>
                <tr>
                  <th scope="col">Oferta</th>
                  <th scope="col">Categoria</th>
                  <th scope="col">Preço atual</th>
                  <th scope="col">Desconto</th>
                  <th scope="col">Score</th>
                  <th scope="col">Vendas</th>
                  <th scope="col">Avaliação</th>
                  <th scope="col">Comissão</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Envio</th>
                  <th scope="col">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((offer) => (
                  <tr key={offer.id}>
                    <td>
                      <OfferIdentity offer={offer} />
                    </td>
                    <td>
                      <CategoryList
                        offer={offer}
                        categoryMap={categoryMap}
                        categoryError={categoryError}
                      />
                    </td>
                    <td>
                      <OfferPrice offer={offer} />
                    </td>
                    <td>{safePercent(offer.discountRate)}</td>
                    <td>{safeNumber(offer.bestCurrentCommercialScore)}</td>
                    <td>{safeNumber(offer.sales)}</td>
                    <td>{safeNumber(offer.rating)}</td>
                    <td>{safePercent(offer.commissionRate)}</td>
                    <td>
                      <div className="offers-status-stack">
                        <OfferStatus status={offer.status} />
                        <span className="offers-commercial-status">
                          {commercialLabel(offer)}
                        </span>
                      </div>
                    </td>
                    <td>
                      <DeliverySummary offer={offer} />
                    </td>
                    <td>
                      <OfferActions offer={offer} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="offers-mobile-list">
            {result.items.map((offer) => (
              <article key={offer.id} className="offers-card">
                <div className="offers-card-header">
                  <OfferIdentity offer={offer} />
                  <OfferStatus status={offer.status} />
                </div>
                <div className="offers-card-category">
                  <CategoryList
                    offer={offer}
                    categoryMap={categoryMap}
                    categoryError={categoryError}
                  />
                </div>
                <div className="offers-card-summary">
                  <OfferPrice offer={offer} />
                  <div className="offers-card-discount">
                    <span>Desconto</span>
                    <strong>{safePercent(offer.discountRate)}</strong>
                  </div>
                </div>
                <dl className="offers-card-metrics">
                  <Metric label="Vendas" value={safeNumber(offer.sales)} />
                  <Metric
                    label="Score"
                    value={safeNumber(offer.bestCurrentCommercialScore)}
                  />
                  <Metric label="Avaliação" value={safeNumber(offer.rating)} />
                  <Metric
                    label="Comissão"
                    value={safePercent(offer.commissionRate)}
                  />
                  <Metric label="Situação" value={commercialLabel(offer)} />
                </dl>
                <div className="offers-card-footer">
                  <DeliverySummary offer={offer} />
                  <OfferActions offer={offer} />
                </div>
              </article>
            ))}
          </div>

          <div className="offers-pagination">
            <p>
              Página {result.page} de {result.totalPages} · {result.total}{' '}
              {result.total === 1 ? 'oferta' : 'ofertas'}
            </p>
            <div className="offers-pagination-actions">
              <PageButton
                disabled={!result.hasPreviousPage}
                onClick={() => changePage(result.page - 1)}
              >
                Anterior
              </PageButton>
              <PageButton
                disabled={!result.hasNextPage}
                onClick={() => changePage(result.page + 1)}
              >
                Próxima
              </PageButton>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange(value: string): void;
}) {
  return (
    <label className="offers-filter-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Todas</option>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

function NumberFilter({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | undefined;
  onChange(value: string): void;
}) {
  return (
    <label className="offers-filter-field">
      <span>{label}</span>
      <input
        type="number"
        min="0"
        step="0.01"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function DateFilter({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | undefined;
  onChange(value: string): void;
}) {
  return (
    <label className="offers-filter-field">
      <span>{label}</span>
      <input
        type="date"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function OfferIdentity({ offer }: { offer: ShopeeOffer }) {
  return (
    <div className="offers-identity">
      <SafeProductImage src={offer.imageUrl} className="offers-image" />
      <div className="offers-identity-copy">
        <p className="offers-product-name" title={offer.productName}>
          {offer.productName}
        </p>
        <p className="offers-shop-name">{offer.shopName}</p>
      </div>
    </div>
  );
}

function CategoryList({
  offer,
  categoryMap,
  categoryError,
}: {
  offer: ShopeeOffer;
  categoryMap: Map<string, string>;
  categoryError: boolean;
}) {
  if (offer.categoryIds.length === 0) {
    return <span className="offers-muted">Sem categoria</span>;
  }

  return (
    <span className="offers-category-list">
      {offer.categoryIds
        .map((categoryId) => categoryMap.get(categoryId))
        .map((label, index) => (
          <span key={`${label ?? 'categoria'}-${index}`}>
            {label ??
              (categoryError
                ? 'Categoria indisponível'
                : 'Categoria não disponível')}
          </span>
        ))}
    </span>
  );
}

function OfferPrice({ offer }: { offer: ShopeeOffer }) {
  const range = priceRangeLabel(offer.priceMin, offer.priceMax);
  return (
    <div className="offers-price-block">
      <span>Preço atual</span>
      <strong>{safeCurrency(offer.price)}</strong>
      {range ? <small>Faixa observada: {range}</small> : null}
    </div>
  );
}

function OfferStatus({ status }: { status: ShopeeOfferStatus }) {
  return <OpsBadge tone={statusTone(status)}>{statusLabel[status]}</OpsBadge>;
}

function statusTone(status: ShopeeOfferStatus): OpsTone {
  if (status === 'ACTIVE') return 'success';
  if (status === 'EXPIRED') return 'danger';
  return 'warning';
}

function commercialLabel(offer: ShopeeOffer) {
  const summary = offer.commercialStateSummary;
  if (offer.status === 'EXPIRED') return 'Oferta expirada';
  if (offer.status === 'UNAVAILABLE') return 'Oferta indisponível';
  if (summary.blocked > 0) return 'Bloqueada no fluxo';
  if (summary.expired > 0) return 'Candidatos expirados';
  if (summary.copyReady > 0) return 'Texto pronto';
  if (summary.reserved > 0) return 'Em reserva';
  if (summary.queued > 0) return 'Em preparação';
  if (summary.dispatched > 0 || offer.everSent) return 'Já enviada';
  return 'Aguardando seleção';
}

function DeliverySummary({ offer }: { offer: ShopeeOffer }) {
  return (
    <div className="offers-delivery-summary">
      <span className={offer.everSent ? 'is-sent' : undefined}>
        {offer.everSent ? 'Enviado' : 'Ainda não enviado'}
      </span>
      <small>
        {offer.sentDestinationCount > 0
          ? `${offer.sentDestinationCount} destino${offer.sentDestinationCount === 1 ? '' : 's'} · `
          : ''}
        {formatDateTime(offer.lastSentAt)}
      </small>
    </div>
  );
}

function OfferActions({ offer }: { offer: ShopeeOffer }) {
  return (
    <div className="offers-actions">
      <Link
        href={`/produtos/${encodeURIComponent(offer.id)}`}
        className="ops-button is-small"
      >
        Ver detalhes
      </Link>
      {isSafeHttpUrl(offer.productLink) ? (
        <a
          href={offer.productLink}
          target="_blank"
          rel="noreferrer"
          className="offers-icon-action"
          aria-label="Abrir oferta em nova aba"
          title="Abrir oferta em nova aba"
        >
          <ExternalLink size={15} aria-hidden="true" />
        </a>
      ) : null}
      <span
        className={`offers-affiliate-indicator ${offer.affiliateLinkPresent ? 'is-ready' : ''}`}
        aria-label={
          offer.affiliateLinkPresent
            ? 'Link afiliado disponível'
            : 'Link afiliado ausente'
        }
        title={
          offer.affiliateLinkPresent
            ? 'Link afiliado disponível'
            : 'Link afiliado ausente'
        }
      >
        <Link2 size={15} aria-hidden="true" />
      </span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function PageButton({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  disabled: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="ops-button is-small"
    >
      {children}
    </button>
  );
}
