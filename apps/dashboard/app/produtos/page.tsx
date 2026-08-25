'use client';

import Link from 'next/link';
import { ExternalLink, Link2, Search } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { EmptyState } from '../../components/empty-state';
import { ErrorState } from '../../components/error-state';
import { LoadingState } from '../../components/loading-state';
import { PageHeader } from '../../components/page-header';
import { SafeProductImage } from '../../components/safe-product-image';
import { StatusBadge } from '../../components/status-badge';
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

const initialFilters: ShopeeOfferFilters = {
  keyword: '',
  source: '',
  availability: '',
  affiliateLink: '',
  deliveryStatus: 'any',
  sort: 'recent',
  page: 1,
  limit: 12,
};

const sourceLabel = { MOCK: 'Mock', MANUAL: 'Manual', OFFICIAL: 'Oficial' };
const providerLabel = { mock: 'Mock', manual: 'Manual', official: 'Oficial' };
const statusLabel = {
  ACTIVE: 'Ativa',
  EXPIRED: 'Expirada',
  UNAVAILABLE: 'Indisponível',
};

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

const optionalNumber = (value: string) =>
  value.trim() === '' ? undefined : Number(value);

export default function ProductsPage() {
  const [result, setResult] = useState<ShopeeOfferPage | null>(null);
  const [categories, setCategories] = useState<ShopeeCategory[]>([]);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [filters, setFilters] = useState<ShopeeOfferFilters>(initialFilters);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async (nextFilters = filters) => {
    setLoading(true);
    setError(null);
    try {
      setResult(await listShopeeOffers(nextFilters));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(initialFilters);
    void listShopeeCategories()
      .then((response) => {
        setCategories(response.items);
        setCategoryError(null);
      })
      .catch((err: unknown) => {
        setCategoryError(
          err instanceof Error ? err.message : 'Categorias indisponíveis.',
        );
      });
  }, []);

  const submitFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = { ...filters, page: 1 };
    setFilters(next);
    void load(next);
  };

  const clearFilters = () => {
    setFilters(initialFilters);
    void load(initialFilters);
  };

  const changePage = (page: number) => {
    const next = { ...filters, page };
    setFilters(next);
    void load(next);
  };

  const setNumberFilter = (
    field:
      | 'minDiscount'
      | 'minScore'
      | 'minPrice'
      | 'maxPrice'
      | 'minCommission',
    value: string,
  ) => {
    setFilters((current) => ({ ...current, [field]: optionalNumber(value) }));
  };

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Produtos e ofertas"
        description="Catálogo operacional local da Shopee Affiliate em modo somente leitura."
      />

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <span className="text-sm text-slate-600">Provider atual</span>
        <StatusBadge tone={result?.provider === 'official' ? 'warning' : 'ok'}>
          {result?.provider ? providerLabel[result.provider] : 'carregando'}
        </StatusBadge>
        <p className="text-sm text-slate-600">
          A atualização acontece pelo fluxo operacional oficial; este console não
          sincroniza, gera copy nem envia mensagens.
        </p>
      </div>

      <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        Ofertas Relâmpago: não suportado pelo contrato atual do provider.
      </p>

      {error ? <ErrorState message={error} onRetry={() => load()} /> : null}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <form
          onSubmit={submitFilters}
          className="grid gap-3 md:grid-cols-3 xl:grid-cols-5"
        >
          <label className="md:col-span-2">
            <span className="text-sm font-medium text-slate-700">Busca</span>
            <div className="mt-1 flex items-center gap-2 rounded-md border border-slate-300 px-3 focus-within:ring-2 focus-within:ring-orange-500">
              <Search className="h-4 w-4 text-slate-400" aria-hidden="true" />
              <input
                value={filters.keyword}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    keyword: event.target.value,
                  }))
                }
                className="w-full border-0 bg-transparent py-2 text-sm outline-none"
                placeholder="Nome ou loja"
              />
            </div>
          </label>
          <FilterSelect
            label="Categoria"
            value={filters.categoryId ?? ''}
            onChange={(value) =>
              setFilters((current) => ({
                ...current,
                categoryId: value || undefined,
              }))
            }
            options={categories.map(({ id, displayLabel }) => [id, displayLabel])}
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
              setFilters((current) => ({ ...current, sort: sortFromValue(value) }))
            }
            options={[
              ['recent', 'Mais recentes'],
              ['sales_desc', 'Mais vendidos'],
              ['score_desc', 'Maior score'],
              ['discount_desc', 'Maior desconto'],
              ['commission_desc', 'Maior comissão'],
              ['price_asc', 'Menor preço'],
              ['price_desc', 'Maior preço'],
            ]}
          />
          <NumberFilter label="Desconto mínimo (%)" value={filters.minDiscount} onChange={(value) => setNumberFilter('minDiscount', value)} />
          <NumberFilter label="Score mínimo" value={filters.minScore} onChange={(value) => setNumberFilter('minScore', value)} />
          <NumberFilter label="Preço mínimo" value={filters.minPrice} onChange={(value) => setNumberFilter('minPrice', value)} />
          <NumberFilter label="Preço máximo" value={filters.maxPrice} onChange={(value) => setNumberFilter('maxPrice', value)} />
          <NumberFilter label="Comissão mínima (%)" value={filters.minCommission} onChange={(value) => setNumberFilter('minCommission', value)} />
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
              ['any', 'Todos'],
              ['not_sent', 'Ainda não enviados'],
              ['sent', 'Já enviados'],
            ]}
          />
          <DateFilter label="Capturado de" value={filters.capturedFrom} onChange={(value) => setFilters((current) => ({ ...current, capturedFrom: value || undefined }))} />
          <DateFilter label="Capturado até" value={filters.capturedTo} onChange={(value) => setFilters((current) => ({ ...current, capturedTo: value || undefined }))} />
          <FilterSelect
            label="Origem"
            value={filters.source ?? ''}
            onChange={(value) =>
              setFilters((current) => ({ ...current, source: sourceFromValue(value) }))
            }
            options={[
              ['MOCK', 'Mock'],
              ['MANUAL', 'Manual'],
              ['OFFICIAL', 'Oficial'],
            ]}
          />
          <div className="flex items-end gap-2">
            <button type="submit" className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Filtrar</button>
            <button type="button" onClick={clearFilters} className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">Limpar</button>
          </div>
        </form>
        {categoryError ? (
          <p className="mt-3 text-sm text-amber-700">
            Categorias indisponíveis: {categoryError}
          </p>
        ) : null}
      </section>

      {loading ? <LoadingState label="Carregando ofertas" /> : null}
      {!loading && !error && result?.items.length === 0 ? (
        <EmptyState title="Nenhuma oferta encontrada" description="Nenhuma oferta persistida corresponde aos filtros atuais." />
      ) : null}

      {result?.items.length ? (
        <>
          <div className="hidden overflow-x-auto rounded-lg border border-slate-200 bg-white lg:block">
            <table className="min-w-[1550px] divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Produto</th><th className="px-4 py-3">Categorias</th><th className="px-4 py-3">Preço</th><th className="px-4 py-3">Score</th><th className="px-4 py-3">Vendas</th><th className="px-4 py-3">Avaliação</th><th className="px-4 py-3">Comissão</th><th className="px-4 py-3">Provider</th><th className="px-4 py-3">Disponibilidade</th><th className="px-4 py-3">Comercial</th><th className="px-4 py-3">Envio</th><th className="px-4 py-3">Snapshot</th><th className="px-4 py-3">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {result.items.map((offer) => (
                  <tr key={offer.id} className="align-top">
                    <td className="max-w-sm px-4 py-3"><OfferIdentity offer={offer} /></td>
                    <td className="max-w-48 px-4 py-3 text-xs text-slate-600">{offer.categoryIds.join(', ') || '—'}</td>
                    <td className="px-4 py-3"><p>{formatCurrency(Number(offer.price))}</p><p className="mt-1 text-xs text-slate-500">Referência: não informada pelo provider</p><p className="text-xs text-emerald-700">{formatPercent(offer.discountRate)} off</p></td>
                    <td className="px-4 py-3">{formatNumber(offer.bestCurrentCommercialScore)}</td>
                    <td className="px-4 py-3">{formatNumber(offer.sales)}</td>
                    <td className="px-4 py-3">{formatNumber(offer.rating)}</td>
                    <td className="px-4 py-3">{formatPercent(offer.commissionRate)}</td>
                    <td className="px-4 py-3">{sourceLabel[offer.source]}</td>
                    <td className="px-4 py-3"><StatusBadge tone={offer.status === 'ACTIVE' ? 'ok' : 'warning'}>{statusLabel[offer.status]}</StatusBadge></td>
                    <td className="px-4 py-3"><CommercialSummary offer={offer} /></td>
                    <td className="px-4 py-3"><DeliverySummary offer={offer} /></td>
                    <td className="px-4 py-3">r{offer.commercialSnapshotRevision || '—'}</td>
                    <td className="px-4 py-3"><OfferActions offer={offer} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:hidden">
            {result.items.map((offer) => (
              <article key={offer.id} className="rounded-lg border border-slate-200 bg-white p-4">
                <OfferIdentity offer={offer} />
                <p className="mt-3 text-xs text-slate-600">Categorias: {offer.categoryIds.join(', ') || '—'}</p>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <Metric label="Preço" value={formatCurrency(Number(offer.price))} />
                  <Metric label="Score atual" value={formatNumber(offer.bestCurrentCommercialScore)} />
                  <Metric label="Vendas" value={formatNumber(offer.sales)} />
                  <Metric label="Avaliação" value={formatNumber(offer.rating)} />
                  <Metric label="Comissão" value={formatPercent(offer.commissionRate)} />
                  <Metric label="Provider" value={sourceLabel[offer.source]} />
                  <Metric label="Disponibilidade" value={statusLabel[offer.status]} />
                  <Metric label="Envio" value={offer.everSent ? 'Enviado' : 'Não enviado'} />
                  <Metric label="Snapshot" value={offer.commercialSnapshotRevision ? `r${offer.commercialSnapshotRevision}` : '—'} />
                  <Metric label="Último envio" value={formatDateTime(offer.lastSentAt)} />
                </dl>
                <div className="mt-4 rounded-md bg-slate-50 p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Resumo comercial</p>
                  <CommercialSummary offer={offer} />
                </div>
                <div className="mt-4"><OfferActions offer={offer} /></div>
              </article>
            ))}
          </div>

          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-slate-600">Página {result.page} de {result.totalPages} · {result.total} oferta(s)</p>
            <div className="flex gap-2"><PageButton disabled={!result.hasPreviousPage} onClick={() => changePage(result.page - 1)}>Anterior</PageButton><PageButton disabled={!result.hasNextPage} onClick={() => changePage(result.page + 1)}>Próxima</PageButton></div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange(value: string): void }) {
  return <label className="block w-full"><span className="text-sm font-medium text-slate-700">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"><option value="">Todos</option>{options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select></label>;
}

function NumberFilter({ label, value, onChange }: { label: string; value: number | undefined; onChange(value: string): void }) {
  return <label><span className="text-sm font-medium text-slate-700">{label}</span><input type="number" min="0" step="0.01" value={value ?? ''} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" /></label>;
}

function DateFilter({ label, value, onChange }: { label: string; value: string | undefined; onChange(value: string): void }) {
  return <label><span className="text-sm font-medium text-slate-700">{label}</span><input type="date" value={value ?? ''} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" /></label>;
}

function OfferIdentity({ offer }: { offer: ShopeeOffer }) {
  return <div className="flex gap-3"><SafeProductImage src={offer.imageUrl} className="h-12 w-12 shrink-0 rounded-md border border-slate-200 object-cover" /><div><p className="font-medium text-slate-950">{offer.productName}</p><p className="mt-1 text-xs text-slate-500">{offer.shopName} · {sourceLabel[offer.source]}</p></div></div>;
}

function CommercialSummary({ offer }: { offer: ShopeeOffer }) {
  const summary = offer.commercialStateSummary;
  return <div className="text-xs text-slate-600"><p>{summary.currentCandidateCount} candidate(s)</p><p>{summary.queued} fila · {summary.copyReady} copy pronta</p></div>;
}

function DeliverySummary({ offer }: { offer: ShopeeOffer }) {
  return <div className="text-xs text-slate-600"><p className={offer.everSent ? 'text-emerald-700' : ''}>{offer.everSent ? 'Enviado' : 'Não enviado'}</p><p>{offer.sentDestinationCount} destino(s)</p><p>{formatDateTime(offer.lastSentAt)}</p></div>;
}

function OfferActions({ offer }: { offer: ShopeeOffer }) {
  return <div className="flex flex-wrap gap-2"><Link href={`/produtos/${encodeURIComponent(offer.id)}`} className="rounded-md border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">Detalhes</Link><a href={offer.productLink} target="_blank" rel="noreferrer" className="rounded-md border border-slate-300 p-2 text-slate-600 hover:bg-slate-50" aria-label="Abrir produto"><ExternalLink className="h-4 w-4" /></a><span className={`rounded-md border p-2 ${offer.affiliateLinkPresent ? 'border-emerald-200 text-emerald-700' : 'border-slate-200 text-slate-400'}`} title={offer.affiliateLinkPresent ? 'Link afiliado disponível' : 'Link afiliado ausente'}><Link2 className="h-4 w-4" /></span></div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-slate-500">{label}</dt><dd className="font-medium text-slate-900">{value}</dd></div>;
}

function PageButton({ children, disabled, onClick }: { children: React.ReactNode; disabled: boolean; onClick(): void }) {
  return <button type="button" onClick={onClick} disabled={disabled} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50">{children}</button>;
}
