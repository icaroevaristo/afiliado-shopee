'use client';

import {
  ExternalLink,
  FileCheck2,
  Link2,
  RefreshCw,
  Search,
  Sparkles,
  Upload,
} from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { EmptyState } from '../../components/empty-state';
import { ErrorState } from '../../components/error-state';
import { LoadingState } from '../../components/loading-state';
import { PageHeader } from '../../components/page-header';
import { SafeProductImage } from '../../components/safe-product-image';
import { StatusBadge } from '../../components/status-badge';
import {
  importManualShopeeOffers,
  listShopeeOffers,
  previewShopeeOfferCopy,
  syncShopeeOffers,
  validateManualShopeeOffers,
  type CopyPreview,
  type ManualOfferValidation,
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
const statusLabel = {
  ACTIVE: 'Ativa',
  EXPIRED: 'Expirada',
  UNAVAILABLE: 'Indisponivel',
};

export default function ProductsPage() {
  const [result, setResult] = useState<ShopeeOfferPage | null>(null);
  const [filters, setFilters] = useState<ShopeeOfferFilters>(initialFilters);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [manualJson, setManualJson] = useState('');
  const [manualRecords, setManualRecords] = useState<unknown[] | null>(null);
  const [validation, setValidation] = useState<ManualOfferValidation | null>(
    null,
  );
  const [validating, setValidating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<CopyPreview | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);

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

  const sync = async () => {
    if (syncing) return;
    setSyncing(true);
    setError(null);
    setSuccess(null);
    try {
      const report = await syncShopeeOffers();
      setSuccess(
        `Sincronizacao segura: ${report.created} criada(s), ${report.updated} atualizada(s), ${report.expired} expirada(s) ignorada(s).`,
      );
      await load({ ...filters, page: 1 });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado.');
    } finally {
      setSyncing(false);
    }
  };

  const validateImport = async () => {
    setValidating(true);
    setError(null);
    setSuccess(null);
    setValidation(null);
    setManualRecords(null);
    try {
      const parsed = JSON.parse(manualJson) as unknown;
      const records = Array.isArray(parsed) ? parsed : [parsed];
      const response = await validateManualShopeeOffers(records);
      setManualRecords(records);
      setValidation(response);
    } catch (err) {
      setError(
        err instanceof SyntaxError
          ? 'JSON invalido. Revise o formato antes de validar.'
          : err instanceof Error
            ? err.message
            : 'Erro inesperado.',
      );
    } finally {
      setValidating(false);
    }
  };

  const confirmImport = async () => {
    if (!manualRecords || !validation?.valid || importing) return;
    setImporting(true);
    setError(null);
    try {
      const report = await importManualShopeeOffers(manualRecords);
      setSuccess(
        `Importacao confirmada: ${report.created} criada(s) e ${report.updated} atualizada(s).`,
      );
      setManualJson('');
      setManualRecords(null);
      setValidation(null);
      await load({ ...filters, page: 1 });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado.');
    } finally {
      setImporting(false);
    }
  };

  const openPreview = async (offer: ShopeeOffer) => {
    setPreviewingId(offer.id);
    setError(null);
    try {
      setPreview(await previewShopeeOfferCopy(offer.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado.');
    } finally {
      setPreviewingId(null);
    }
  };

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Produtos e ofertas"
        description="Catalogo local da Shopee Affiliate, sem scraping e sem envio automatico ao WhatsApp."
        actions={
          <button
            type="button"
            onClick={sync}
            disabled={syncing}
            className="inline-flex items-center gap-2 rounded-md bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Sincronizando' : 'Sincronizar ofertas'}
          </button>
        }
      />

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <span className="text-sm text-slate-600">Provider atual</span>
        <StatusBadge tone={result?.provider === 'official' ? 'warning' : 'ok'}>
          {result?.provider ?? 'carregando'}
        </StatusBadge>
        <p className="text-sm text-slate-600">
          A sincronizacao somente persiste ofertas; nao gera copy, dispatch ou
          job.
        </p>
      </div>

      {result?.provider === 'official' ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
          <strong>Aguardando credenciais da Shopee.</strong> Autenticacao e
          transporte real aguardam credenciais e documentacao liberada para a
          conta.
        </div>
      ) : null}

      {error ? <ErrorState message={error} onRetry={() => load()} /> : null}
      {success ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800">
          {success}
        </div>
      ) : null}

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
          description="Sincronize o provider mock ou valide uma importacao manual ficticia."
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
                      <OfferActions
                        offer={offer}
                        previewing={previewingId === offer.id}
                        onPreview={() => void openPreview(offer)}
                      />
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
                  <OfferActions
                    offer={offer}
                    previewing={previewingId === offer.id}
                    onPreview={() => void openPreview(offer)}
                  />
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

      {preview ? (
        <section className="rounded-lg border-2 border-dashed border-orange-300 bg-orange-50 p-5">
          <div className="flex items-center gap-2 text-sm font-bold text-orange-800">
            <Sparkles className="h-4 w-4" /> {preview.label}
          </div>
          <h2 className="mt-3 text-lg font-semibold text-slate-950">
            {preview.titulo}
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-700">
            {preview.mensagem}
          </p>
          <p className="mt-2 text-sm font-medium text-slate-900">
            {preview.cta}
          </p>
          <a
            href={preview.affiliateLink}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-orange-700 hover:underline"
          >
            Abrir link afiliado <ExternalLink className="h-4 w-4" />
          </a>
        </section>
      ) : null}

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex items-start gap-3">
          <Upload className="mt-0.5 h-5 w-5 text-orange-600" />
          <div>
            <h2 className="font-semibold text-slate-950">
              Importacao manual temporaria
            </h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              Cole JSON exportado ou preenchido localmente. A validacao nao
              grava e nunca consulta a pagina do produto.
            </p>
          </div>
        </div>
        <label className="mt-4 block">
          <span className="text-sm font-medium text-slate-700">
            Ofertas em JSON
          </span>
          <textarea
            value={manualJson}
            onChange={(event) => {
              setManualJson(event.target.value);
              setValidation(null);
              setManualRecords(null);
            }}
            rows={8}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-orange-500"
            placeholder='[{"providerProductId":"manual-001", ...}]'
          />
        </label>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void validateImport()}
            disabled={!manualJson.trim() || validating}
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
          >
            <FileCheck2 className="h-4 w-4" />{' '}
            {validating ? 'Validando' : 'Validar e visualizar'}
          </button>
          <button
            type="button"
            onClick={() => void confirmImport()}
            disabled={!validation?.valid || importing}
            className="rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {importing ? 'Importando' : 'Confirmar importacao'}
          </button>
        </div>
        {validation ? (
          <div
            className={`mt-4 rounded-md border p-4 text-sm ${validation.valid ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}
          >
            <p className="font-semibold">
              {validation.valid
                ? `${validation.count} oferta(s) valida(s). Revise o preview antes de confirmar.`
                : 'A importacao possui erros.'}
            </p>
            {validation.errors.map((item) => (
              <p key={`${item.index}-${item.message}`} className="mt-1">
                Registro {item.index + 1}: {item.message}
              </p>
            ))}
            {validation.valid ? (
              <pre className="mt-3 max-h-64 overflow-auto rounded bg-white/70 p-3 text-xs text-slate-700">
                {JSON.stringify(validation.preview, null, 2)}
              </pre>
            ) : null}
          </div>
        ) : null}
      </section>
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
  previewing,
  onPreview,
}: {
  offer: ShopeeOffer;
  previewing: boolean;
  onPreview(): void;
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
      <button
        type="button"
        onClick={onPreview}
        disabled={
          previewing || offer.status !== 'ACTIVE' || !offer.affiliateLink
        }
        className="rounded-md border border-orange-200 px-3 py-2 text-xs font-semibold text-orange-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {previewing ? 'Gerando' : 'Preview'}
      </button>
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
