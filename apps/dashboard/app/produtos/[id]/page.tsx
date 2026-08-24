'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { EmptyState } from '../../../components/empty-state';
import { ErrorState } from '../../../components/error-state';
import { LoadingState } from '../../../components/loading-state';
import { PageHeader } from '../../../components/page-header';
import { SafeProductImage } from '../../../components/safe-product-image';
import {
  getShopeeOffer,
  listShopeeCategories,
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
