'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { EmptyState } from '../../../components/empty-state';
import { ErrorState } from '../../../components/error-state';
import { LoadingState } from '../../../components/loading-state';
import { PageHeader } from '../../../components/page-header';
import { SafeProductImage } from '../../../components/safe-product-image';
import {
  createManualPublication,
  getManualPublication,
  getManualPublicationOptions,
  getShopeeOffer,
  listShopeeCategories,
  type ManualPublicationOptions,
  type ManualPublicationRequest,
  type ShopeeCategory,
  type ShopeeOfferDetail,
} from '../../../lib/api';
import {
  formatCurrency,
  formatDateTime,
  formatNumber,
  formatPercent,
} from '../../../lib/format';

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<ShopeeOfferDetail | null>(null);
  const [categories, setCategories] = useState<ShopeeCategory[]>([]);
  const [dispatchPage, setDispatchPage] = useState(1);
  const [snapshotPage, setSnapshotPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setDetail(
        await getShopeeOffer(id, {
          dispatchPage,
          snapshotPage,
          dispatchLimit: 10,
          snapshotLimit: 10,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (id) void load();
  }, [id, dispatchPage, snapshotPage]);

  useEffect(() => {
    let active = true;

    void listShopeeCategories()
      .then((response) => {
        if (active) setCategories(response.items);
      })
      .catch(() => {
        // The category registry augments the detail, but its read failure must not hide the offer.
      });

    return () => {
      active = false;
    };
  }, []);

  if (loading) return <LoadingState label="Carregando detalhe da oferta" />;
  if (error) return <ErrorState message={error} onRetry={() => load()} />;
  if (!detail) {
    return <EmptyState title="Oferta não encontrada" description="O produto não está disponível no catálogo local." />;
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Detalhe da oferta"
        description="Consulta local somente leitura de snapshot, score e histórico de publicação."
        actions={<Link href="/produtos" className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Voltar ao catálogo</Link>}
      />
      <article className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-5 sm:flex-row">
          <SafeProductImage src={detail.imageUrl} className="h-28 w-28 rounded-lg border border-slate-200 object-cover" />
          <div className="min-w-0">
            <h2 className="text-xl font-semibold text-slate-950">{detail.productName}</h2>
            <p className="mt-1 text-sm text-slate-600">{detail.shopName} · {detail.source}</p>
            <p className="mt-2 text-sm text-slate-600">
              Categorias: {categoryLabels(detail.categoryIds, categories).join(', ') || '—'}
            </p>
            <p className="mt-2 text-sm text-slate-600">Ofertas Relâmpago: não suportado pelo contrato atual do provider.</p>
          </div>
        </div>
        <dl className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Preço atual" value={formatCurrency(Number(detail.price))} />
          <Metric label="Preço de referência" value="Não informado pelo provider" />
          <Metric label="Link afiliado" value={detail.affiliateLinkPresent ? 'Disponível' : 'Ausente'} />
          <Metric label="Desconto" value={formatPercent(detail.discountRate)} />
          <Metric label="Comissão" value={formatPercent(detail.commissionRate)} />
          <Metric label="Score comercial atual" value={formatNumber(detail.bestCurrentCommercialScore)} />
          <Metric label="Candidates atuais" value={formatNumber(detail.commercialStateSummary.currentCandidateCount)} />
          <Metric label="Na fila" value={formatNumber(detail.commercialStateSummary.queued)} />
          <Metric label="Copy pronta" value={formatNumber(detail.commercialStateSummary.copyReady)} />
          <Metric label="Vendas" value={formatNumber(detail.sales)} />
          <Metric label="Avaliação" value={String(detail.rating)} />
          <Metric label="Disponibilidade" value={detail.status} />
          <Metric label="Enviado" value={detail.everSent ? 'Sim' : 'Não'} />
          <Metric label="Destinos enviados" value={formatNumber(detail.sentDestinationCount)} />
          <Metric label="Último envio" value={formatDateTime(detail.lastSentAt)} />
          <Metric label="Capturado" value={formatDateTime(detail.capturedAt)} />
        </dl>
      </article>

      {detail.source === 'OFFICIAL' ? <ManualPublicationPanel productId={detail.id} /> : null}

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-slate-950">Estado comercial atual</h2>
        <p className="mt-1 text-sm text-slate-600">Somente candidates coerentes com o snapshot comercial atual entram no score.</p>
        {detail.commercialScores.length === 0 ? <p className="mt-4 text-sm text-slate-500">Nenhum candidate atual coerente.</p> : <ul className="mt-4 grid gap-2 md:grid-cols-2">{detail.commercialScores.map((score) => <li key={score.candidateId} className="rounded border border-slate-200 p-3 text-sm"><p className="font-medium text-slate-900">{score.campaignName}</p><p className="text-slate-600">Score {score.score} · {score.candidateStatus} · nicho {score.nicheId}</p></li>)}</ul>}
      </section>

      <HistorySection
        title="Histórico de publicação"
        empty="Nenhum dispatch registrado para este produto."
        page={detail.dispatchHistory.page}
        hasPreviousPage={detail.dispatchHistory.hasPreviousPage}
        hasNextPage={detail.dispatchHistory.hasNextPage}
        onPrevious={() => setDispatchPage((page) => Math.max(1, page - 1))}
        onNext={() => setDispatchPage((page) => page + 1)}
      >
        {detail.dispatchHistory.items.map((dispatch) => (
          <li key={dispatch.dispatchId} className="rounded border border-slate-200 p-3 text-sm">
            <p className="font-medium text-slate-900">{dispatch.destination.name} · {dispatch.status}</p>
            <p className="text-slate-600">{dispatch.destination.type} · instância {dispatch.instanceName ?? 'legada/não registrada'} · {formatDateTime(dispatch.sentAt)}</p>
            <p className="text-slate-600">Tentativas: {dispatch.attemptCount}{dispatch.run ? ` · final ${dispatch.run.finalStatus ?? '—'}` : ''}</p>
          </li>
        ))}
      </HistorySection>

      <HistorySection
        title="Histórico de snapshots"
        empty="Nenhum snapshot comercial registrado para este produto."
        page={detail.snapshotHistory.page}
        hasPreviousPage={detail.snapshotHistory.hasPreviousPage}
        hasNextPage={detail.snapshotHistory.hasNextPage}
        onPrevious={() => setSnapshotPage((page) => Math.max(1, page - 1))}
        onNext={() => setSnapshotPage((page) => page + 1)}
      >
        {detail.snapshotHistory.items.map((snapshot) => (
          <li key={snapshot.id} className="rounded border border-slate-200 p-3 text-sm">
            <p className="font-medium text-slate-900">Revisão {snapshot.revision} · {formatCurrency(Number(snapshot.price))}</p>
            <p className="text-slate-600">Desconto {formatPercent(snapshot.discountRate)} · comissão {formatPercent(snapshot.commissionRate)} · capturado {formatDateTime(snapshot.capturedAt)}</p>
            <p className="mt-1 break-all font-mono text-xs text-slate-500">Fingerprint: {snapshot.fingerprint}</p>
          </li>
        ))}
      </HistorySection>
    </div>
  );
}

function ManualPublicationPanel({ productId }: { productId: string }) {
  const [options, setOptions] = useState<ManualPublicationOptions | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [confirmation, setConfirmation] = useState('');
  const [request, setRequest] = useState<ManualPublicationRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitInFlight = useRef(false);

  const loadOptions = async () => {
    setLoading(true);
    setError(null);
    try {
      setOptions(await getManualPublicationOptions(productId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nao foi possivel carregar as opcoes manuais.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadOptions();
  }, [productId]);

  const toggleGroup = (destinationId: string) => {
    setSelectedIds((current) =>
      current.includes(destinationId)
        ? current.filter((id) => id !== destinationId)
        : current.length >= 5
          ? current
          : [...current, destinationId],
    );
  };

  const submit = async () => {
    if (
      submitInFlight.current ||
      selectedIds.length < 1 ||
      confirmation !== 'ENVIAR_PUBLICACAO_MANUAL'
    ) return;
    submitInFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const canonicalSelection = [...selectedIds].sort().join(',');
      const storageKey = `manual-publication:${productId}:${canonicalSelection}`;
      let idempotencyKey = window.sessionStorage.getItem(storageKey);
      if (!idempotencyKey) {
        idempotencyKey = globalThis.crypto.randomUUID();
        window.sessionStorage.setItem(storageKey, idempotencyKey);
      }
      setRequest(await createManualPublication({
        idempotencyKey,
        productId,
        destinationIds: selectedIds,
        confirm: 'ENVIAR_PUBLICACAO_MANUAL',
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nao foi possivel criar a publicacao manual.');
    } finally {
      submitInFlight.current = false;
      setSubmitting(false);
    }
  };

  const refresh = async () => {
    if (!request) return;
    setError(null);
    try {
      setRequest(await getManualPublication(request.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nao foi possivel atualizar o status.');
    }
  };

  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50/40 p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Publicacao manual segura</h2>
          <p className="mt-1 text-sm text-slate-700">
            Selecione de 1 a 5 grupos. A mesma copy e o mesmo pipeline comercial serao usados.
          </p>
        </div>
        <span className="rounded-full border border-amber-300 px-2.5 py-1 text-xs font-medium text-amber-900">
          Somente OFFICIAL
        </span>
      </div>

      {loading ? <p className="mt-4 text-sm text-slate-600">Carregando grupos elegiveis...</p> : null}
      {error ? <p className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
      {options ? (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Metric label="Snapshot atual" value={options.product.snapshot ? `Revisão ${options.product.snapshot.revision} · ${options.product.snapshot.fingerprint.slice(0, 12)}...` : 'Ausente'} />
            <Metric label="Produto elegivel" value={options.product.available ? 'Sim' : 'Nao'} />
            <Metric label="Grupos selecionados" value={`${selectedIds.length}/5`} />
          </div>

          <div className="mt-5 rounded border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-slate-900">Revisão antes da confirmação</h3>
            <p className="mt-1 text-sm text-slate-600">
              Confira o produto, o snapshot atual e cada grupo. A copy não é editável aqui e seguirá o mesmo pipeline comercial.
            </p>
            {selectedIds.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">Selecione pelo menos um grupo para revisar a intenção.</p>
            ) : (
              <ul className="mt-3 grid gap-3">
                {selectedIds.map((destinationId) => {
                  const group = options.groups.find((item) => item.destinationId === destinationId);
                  if (!group) return null;
                  return (
                    <li key={destinationId} className="rounded border border-slate-200 p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium text-slate-900">{group.displayName}</span>
                        <span className="text-slate-600">{group.eligible ? 'Elegível' : 'Bloqueado'}</span>
                      </div>
                      {group.draftPreview ? (
                        <details className="mt-2">
                          <summary className="cursor-pointer font-medium text-slate-700">Ver prévia da copy pronta</summary>
                          <div className="mt-2 grid gap-1 rounded bg-slate-50 p-3 text-slate-700">
                            <p className="font-medium">{group.draftPreview.title}</p>
                            <p className="whitespace-pre-wrap">{group.draftPreview.message}</p>
                            <p>{group.draftPreview.cta}</p>
                            <p>{group.draftPreview.hashtags}</p>
                            <p className="text-xs text-slate-500">Entrega: {group.draftPreview.deliveryMode === 'IMAGE' ? 'imagem + texto' : 'texto'}{group.draftPreview.imageUrl ? ' · imagem disponível' : ''}</p>
                          </div>
                        </details>
                      ) : (
                        <p className="mt-2 text-xs text-slate-600">Copy ainda não pronta; será preparada pelo mesmo pipeline após a confirmação.</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="mt-5 grid gap-2">
            <h3 className="text-sm font-semibold text-slate-900">Destinos autorizados</h3>
            {options.groups.length === 0 ? <p className="text-sm text-slate-600">Nenhum grupo disponivel para selecao.</p> : null}
            {options.groups.map((group) => {
              const selected = selectedIds.includes(group.destinationId);
              return (
                <label key={group.destinationId} className={`flex cursor-pointer items-start gap-3 rounded border p-3 ${selected ? 'border-amber-400 bg-white' : 'border-slate-200 bg-white'} ${group.eligible ? '' : 'cursor-not-allowed opacity-70'}`}>
                  <input type="checkbox" checked={selected} disabled={!group.eligible || submitting} onChange={() => toggleGroup(group.destinationId)} className="mt-1" />
                  <span className="min-w-0 text-sm">
                    <span className="block font-medium text-slate-900">{group.displayName}</span>
                    <span className="block text-slate-600">{group.eligible ? `Copy ${copyStatusLabel(group.copyStatus)}` : group.blockers.map(blockerLabel).join(', ')}</span>
                  </span>
                </label>
              );
            })}
          </div>

          {!request ? (
            <div className="mt-5 grid gap-3 rounded border border-slate-200 bg-white p-4">
              <label className="grid gap-1 text-sm font-medium text-slate-900">
                Confirmacao exata
                <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="ENVIAR_PUBLICACAO_MANUAL" className="rounded border border-slate-300 px-3 py-2 font-mono text-sm" />
              </label>
              <button type="button" disabled={submitting || !options.product.available || selectedIds.length < 1 || confirmation !== 'ENVIAR_PUBLICACAO_MANUAL'} onClick={() => void submit()} className="w-fit rounded-md bg-amber-700 px-4 py-2 text-sm font-medium text-white hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-50">
                {submitting ? 'Registrando...' : 'Enviar publicacao manual'}
              </button>
              <p className="text-xs text-slate-600">A acao fica vinculada a uma chave de idempotencia desta sessao e nao cria retry automatico.</p>
            </div>
          ) : (
            <div className="mt-5 rounded border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Request: {manualRequestStatusLabel(request.status)}</p>
                  <p className="mt-1 text-xs text-slate-600">{request.targets.filter((target) => target.status === 'SENT').length} de {request.targets.length} destinos enviados.</p>
                </div>
                <button type="button" onClick={() => void refresh()} className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">Atualizar status</button>
              </div>
              <ul className="mt-3 grid gap-2 text-sm">
                {request.targets.map((target) => <li key={target.id} className="flex flex-wrap justify-between gap-2 rounded border border-slate-200 p-2"><span>{target.destination?.name ?? target.destinationId}</span><span className="font-medium text-slate-700">{manualTargetStatusLabel(target.status)}{target.blockedReason ? ` · ${blockerLabel(target.blockedReason)}` : ''}{target.investigationRequired ? ' · investigação manual obrigatória; não repita' : ''}</span></li>)}
              </ul>
              {request.status === 'AMBIGUOUS' ? <p className="mt-3 rounded border border-red-200 bg-red-50 p-3 text-xs text-red-800">Há um resultado ambíguo. Não tente reenviar; faça a investigação manual indicada pelo histórico.</p> : null}
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}

function copyStatusLabel(status: 'AVAILABLE' | 'READY' | 'BLOCKED' | 'UNKNOWN') {
  return {
    AVAILABLE: 'disponível',
    READY: 'pronta',
    BLOCKED: 'bloqueada',
    UNKNOWN: 'não verificada',
  }[status];
}

function manualRequestStatusLabel(status: ManualPublicationRequest['status']) {
  return {
    ACCEPTED: 'aceita',
    PROCESSING: 'em processamento',
    COMPLETED: 'concluída',
    PARTIAL: 'parcial: alguns enviados; outros bloqueados ou falharam',
    BLOCKED: 'bloqueada',
    FAILED: 'falhou de forma terminal',
    AMBIGUOUS: 'ambígua: investigação obrigatória',
  }[status];
}

function manualTargetStatusLabel(status: ManualPublicationRequest['targets'][number]['status']) {
  return {
    ACCEPTED: 'aceito',
    PROCESSING: 'preparando',
    QUEUED: 'na fila segura',
    SENT: 'enviado',
    BLOCKED: 'bloqueado',
    FAILED: 'falhou de forma terminal',
    AMBIGUOUS: 'ambíguo',
  }[status];
}

function blockerLabel(code: string) {
  const labels: Record<string, string> = {
    DESTINATION_INACTIVE: 'grupo inativo',
    DESTINATION_UNAVAILABLE: 'grupo indisponível',
    CAMPAIGN_INACTIVE: 'campanha inativa',
    NICHE_INACTIVE: 'nicho inativo',
    GROUP_DAILY_LIMIT_REACHED: 'limite diário do grupo atingido',
    MINIMUM_INTERVAL_NOT_REACHED: 'aguarde o intervalo mínimo',
    GROUP_SEND_DISABLED: 'envio para grupos desativado',
    COMMERCIAL_SAFE_MODE_REQUIRED: 'safe mode obrigatório',
  };
  return labels[code] ?? code.replaceAll('_', ' ').toLocaleLowerCase('pt-BR');
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-sm text-slate-500">{label}</dt><dd className="mt-1 font-medium text-slate-900">{value}</dd></div>;
}

function categoryLabels(categoryIds: string[], categories: ShopeeCategory[]) {
  const labels = new Map(categories.map((category) => [category.id, category.displayLabel]));
  return categoryIds.map((categoryId) => labels.get(categoryId) ?? `Categoria ${categoryId}`);
}

function HistorySection({ title, empty, page, hasPreviousPage, hasNextPage, onPrevious, onNext, children }: { title: string; empty: string; page: number; hasPreviousPage: boolean; hasNextPage: boolean; onPrevious(): void; onNext(): void; children: React.ReactNode }) {
  const entries = Array.isArray(children) ? children : [children];
  return <section className="rounded-lg border border-slate-200 bg-white p-5"><div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold text-slate-950">{title}</h2><div className="flex gap-2"><button type="button" disabled={!hasPreviousPage} onClick={onPrevious} className="rounded border border-slate-300 px-3 py-1 text-sm disabled:opacity-50">Anterior</button><button type="button" disabled={!hasNextPage} onClick={onNext} className="rounded border border-slate-300 px-3 py-1 text-sm disabled:opacity-50">Próxima</button></div></div>{entries.length === 0 ? <p className="mt-4 text-sm text-slate-500">{empty}</p> : <ul className="mt-4 grid gap-2">{children}</ul>}<p className="mt-3 text-xs text-slate-500">Página {page}</p></section>;
}
