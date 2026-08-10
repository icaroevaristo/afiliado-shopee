'use client';

import {
  ExternalLink,
  Link2,
  Search,
} from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { EmptyState } from '../../components/empty-state';
import { ErrorState } from '../../components/error-state';
import { LoadingState } from '../../components/loading-state';
import { PageHeader } from '../../components/page-header';
import { SafeProductImage } from '../../components/safe-product-image';
import { StatusBadge } from '../../components/status-badge';
import {
  listShopeeOffers,
  type ShopeeOffer,
  type ShopeeOfferFilters,
  type ShopeeOfferPage,
} from '../../lib/api';
import { formatCurrency, formatDateTime, formatNumber } from '../../lib/format';

const initialFilters: ShopeeOfferFilters = {
  keyword: '',
  source: '',
  status: '',
  affiliateLink: '',
  page: 1,
  limit: 12,
};

const sourceLabel = { MOCK: 'Mock', MANUAL: 'Manual', OFFICIAL: 'Oficial' };
const providerLabel = { mock: 'Mock', manual: 'Manual', official: 'Oficial' };
const statusLabel = {
  ACTIVE: 'Ativa',
  EXPIRED: 'Expirada',
  UNAVAILABLE: 'Indisponivel',
};

export default function ProductsPage() {
  const [result, setResult] = useState<ShopeeOfferPage | null>(null);
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
  }, []);

  const submitFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = { ...filters, page: 1 };
    setFilters(next);
    void load(next);
  };

  const changePage = (page: number) => {
    const next = { ...filters, page };
    setFilters(next);
    void load(next);
  };

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Produtos e ofertas"
        description="Catalogo local da Shopee Affiliate em modo somente leitura."
      />

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <span className="text-sm text-slate-600">Provider atual</span>
        <StatusBadge tone={result?.provider === 'official' ? 'warning' : 'ok'}>
          {result?.provider ? providerLabel[result.provider] : 'carregando'}
        </StatusBadge>
        <p className="text-sm text-slate-600">
          A atualizacao do catalogo acontece pelo fluxo operacional oficial; o
          console nao inicia sincronizacao, importacao ou geracao de copy.
        </p>
      </div>

      {error ? <ErrorState message={error} onRetry={() => load()} /> : null}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <form onSubmit={submitFilters} className="grid gap-3 md:grid-cols-5">
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
            label="Origem"
            value={filters.source ?? ''}
            onChange={(value) =>
              setFilters((current) => ({
                ...current,
                source: value as ShopeeOfferFilters['source'],
              }))
            }
            options={[
              ['MOCK', 'Mock'],
              ['MANUAL', 'Manual'],
              ['OFFICIAL', 'Oficial'],
            ]}
          />
          <FilterSelect
            label="Status"
            value={filters.status ?? ''}
            onChange={(value) =>
              setFilters((current) => ({
                ...current,
                status: value as ShopeeOfferFilters['status'],
              }))
            }
            options={[
              ['ACTIVE', 'Ativa'],
              ['EXPIRED', 'Expirada'],
              ['UNAVAILABLE', 'Indisponivel'],
            ]}
          />
          <div className="flex items-end gap-2">
            <FilterSelect
              label="Link afiliado"
              value={filters.affiliateLink ?? ''}
              onChange={(value) =>
                setFilters((current) => ({
                  ...current,
                  affiliateLink: value as ShopeeOfferFilters['affiliateLink'],
                }))
              }
              options={[
                ['present', 'Disponivel'],
                ['missing', 'Ausente'],
              ]}
            />
            <button
              type="submit"
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Filtrar
            </button>
          </div>
        </form>
      </section>

      {loading ? <LoadingState label="Carregando ofertas" /> : null}
      {!loading && !error && result?.items.length === 0 ? (
        <EmptyState
          title="Nenhuma oferta encontrada"
          description="Nenhuma oferta persistida corresponde aos filtros atuais."
        />
      ) : null}

      {result?.items.length ? (
        <>
          <div className="hidden overflow-x-auto rounded-lg border border-slate-200 bg-white lg:block">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Produto</th>
                  <th className="px-4 py-3">Preco</th>
                  <th className="px-4 py-3">Desconto</th>
                  <th className="px-4 py-3">Avaliacao</th>
                  <th className="px-4 py-3">Vendas</th>
                  <th className="px-4 py-3">Comissao</th>
                  <th className="px-4 py-3">Origem</th>
                  <th className="px-4 py-3">Oferta</th>
                  <th className="px-4 py-3">Atualizacao</th>
                  <th className="px-4 py-3">Acoes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {result.items.map((offer) => (
                  <tr key={offer.id} className="align-top">
                    <td className="max-w-sm px-4 py-3">
                      <div className="flex gap-3">
                        <SafeProductImage
                          src={offer.imageUrl}
                          className="h-12 w-12 rounded-md border border-slate-200 object-cover"
                        />
                        <div>
                          <p className="font-medium text-slate-950">
                            {offer.productName}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {offer.shopName}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {formatCurrency(Number(offer.price))}
                    </td>
                    <td className="px-4 py-3">{offer.discountRate}%</td>
                    <td className="px-4 py-3">{offer.rating}</td>
                    <td className="px-4 py-3">{formatNumber(offer.sales)}</td>
                    <td className="px-4 py-3">{offer.commissionRate}%</td>
                    <td className="px-4 py-3">
                      <StatusBadge tone="neutral">
                        {sourceLabel[offer.source]}
                      </StatusBadge>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge
                        tone={offer.status === 'ACTIVE' ? 'ok' : 'warning'}
                      >
                        {statusLabel[offer.status]}
                      </StatusBadge>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {formatDateTime(offer.lastSeenAt)}
                    </td>
                    <td className="px-4 py-3">
                      <OfferActions offer={offer} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:hidden">
            {result.items.map((offer) => (
              <article
                key={offer.id}
                className="rounded-lg border border-slate-200 bg-white p-4"
              >
                <div className="flex gap-3">
                  <SafeProductImage
                    src={offer.imageUrl}
                    className="h-16 w-16 rounded-md border object-cover"
                  />
                  <div>
                    <h2 className="font-semibold text-slate-950">
                      {offer.productName}
                    </h2>
                    <p className="mt-1 text-sm text-slate-600">
                      {offer.shopName}
                    </p>
                  </div>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <Metric
                    label="Preco"
                    value={formatCurrency(Number(offer.price))}
                  />
                  <Metric label="Desconto" value={`${offer.discountRate}%`} />
                  <Metric label="Avaliacao" value={String(offer.rating)} />
                  <Metric label="Vendas" value={formatNumber(offer.sales)} />
                  <Metric label="Comissao" value={`${offer.commissionRate}%`} />
                  <Metric label="Origem" value={sourceLabel[offer.source]} />
                </dl>
                <div className="mt-4">
                  <OfferActions offer={offer} />
                </div>
              </article>
            ))}
          </div>

          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-600">
              Pagina {result.page} de {result.totalPages} · {result.total}{' '}
              oferta(s)
            </p>
            <div className="flex gap-2">
              <PageButton
                disabled={result.page <= 1}
                onClick={() => changePage(result.page - 1)}
              >
                Anterior
              </PageButton>
              <PageButton
                disabled={result.page >= result.totalPages}
                onClick={() => changePage(result.page + 1)}
              >
                Proxima
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
    <label className="block w-full">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
      >
        <option value="">Todos</option>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

function OfferActions({
  offer,
}: {
  offer: ShopeeOffer;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <a
        href={offer.productLink}
        target="_blank"
        rel="noreferrer"
        className="rounded-md border border-slate-300 p-2 text-slate-600 hover:bg-slate-50"
        aria-label="Abrir produto"
      >
        <ExternalLink className="h-4 w-4" />
      </a>
      <span
        className={`rounded-md border p-2 ${offer.affiliateLink ? 'border-emerald-200 text-emerald-700' : 'border-slate-200 text-slate-400'}`}
        title={
          offer.affiliateLink
            ? 'Link afiliado disponivel'
            : 'Link afiliado ausente'
        }
      >
        <Link2 className="h-4 w-4" />
      </span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900">{value}</dd>
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
      className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}
