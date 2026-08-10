'use client';

import Link from 'next/link';
import { ArrowUpRight, Circle, FileText, Package, RefreshCw, Send, UsersRound } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  getAnalytics,
  getCommercialAutomationSchedulerStatus,
  getCommercialAutomationStatus,
  getHealth,
  listCommercialAutomationExecutions,
  listCommercialCampaignQueue,
  listCommercialCampaigns,
  listDispatches,
  type AnalyticsSnapshot,
  type CommercialAutomationExecution,
  type CommercialAutomationSchedulerStatus,
  type CommercialAutomationStatus,
  type CommercialQueueItem,
  type HealthResponse,
  type WhatsAppDispatch,
} from '../lib/api';
import { formatCurrency, formatDateTimeInTimezone } from '../lib/format';
import { OperationsStrip } from '../components/operations-strip';
import { CopyIdButton, OpsBadge, OpsEmpty, OpsLoading, OpsPageHeading, OpsSection, OpsState, toneForStatus } from '../components/ops-components';
import { SafeProductImage } from '../components/safe-product-image';

type OverviewData = {
  health: HealthResponse | null;
  analytics: AnalyticsSnapshot | null;
  status: CommercialAutomationStatus | null;
  scheduler: CommercialAutomationSchedulerStatus | null;
  executions: CommercialAutomationExecution[];
  dispatches: WhatsAppDispatch[];
  queue: CommercialQueueItem[];
  partialFailures: string[];
};

const dispatchSortValue = (dispatch: WhatsAppDispatch) =>
  new Date(dispatch.sentAt ?? dispatch.createdAt ?? 0).getTime();

function Timeline({ executions, dispatches }: Pick<OverviewData, 'executions' | 'dispatches'>) {
  const activity = useMemo(() => {
    const executionRows = executions.map((execution) => ({
      id: `execution-${execution.id}`,
      time: execution.startedAt,
      status: execution.status,
      title: execution.status === 'PREVIEW_READY' ? 'Preparacao comercial concluida' : execution.reasons[0] ?? execution.status,
      meta: `${execution.mode} / ${execution.commercialRunId ?? 'sem run associado'}`,
      kind: 'RUN' as const,
      deliveryMode: null,
      destination: null,
      score: null,
    }));
    const dispatchRows = dispatches.map((dispatch) => ({
      id: `dispatch-${dispatch.id}`,
      time: dispatch.sentAt ?? dispatch.createdAt ?? null,
      status: dispatch.status,
      title: dispatch.product?.nome ?? 'Produto sem nome',
      meta: `${dispatch.deliveryMode ?? 'IMAGE'} / ${dispatch.destination?.name ?? 'grupo nao informado'}`,
      kind: 'DISPATCH' as const,
      deliveryMode: dispatch.deliveryMode,
      destination: dispatch.destination?.name ?? null,
      score: dispatch.product?.score ?? null,
    }));
    return [...executionRows, ...dispatchRows]
      .sort((a, b) => new Date(b.time ?? 0).getTime() - new Date(a.time ?? 0).getTime())
      .slice(0, 8);
  }, [dispatches, executions]);

  if (activity.length === 0) {
    return <OpsEmpty title="Nenhuma atividade recente" message="Execucoes e dispatches persistidos aparecerao nesta linha do tempo." />;
  }

  return (
    <div className="ops-timeline">
      {activity.map((item) => (
        <div className="ops-timeline-row" key={item.id}>
          <span className="ops-timeline-time">{formatDateTimeInTimezone(item.time, 'America/Sao_Paulo', '—', 'short')}</span>
          <span className="ops-timeline-rail" aria-hidden="true"><span className="ops-timeline-marker" data-tone={toneForStatus(item.status)} /></span>
          <div className="min-w-0">
            <div className="ops-timeline-title"><span className="ops-timeline-kind">{item.kind}</span>{item.title}</div>
            <div className="ops-timeline-meta">{item.meta}</div>
            {item.kind === 'DISPATCH' ? (
              <div className="ops-timeline-route">
                <span className="ops-mono">{item.deliveryMode ?? 'IMAGE'}</span>
                <span aria-hidden="true">→</span>
                <span>{item.destination ?? 'grupo nao informado'}</span>
                {item.score !== null ? <span className="ops-mono">{item.score} pts</span> : null}
              </div>
            ) : null}
          </div>
          <span className="ops-timeline-status" data-tone={toneForStatus(item.status)}>{item.status}</span>
        </div>
      ))}
    </div>
  );
}

function DispatchRail({ dispatch }: { dispatch: WhatsAppDispatch | null }) {
  if (!dispatch) return null;

  const candidateId = dispatch.generatedCopy?.createdFromCandidateId ?? null;
  const failed = dispatch.status === 'FAILED';
  const stateFor = (available: boolean, complete: boolean) => {
    if (!available) return 'missing';
    if (complete) return 'complete';
    return failed ? 'blocked' : 'current';
  };
  const stages = [
    { label: 'PRODUTO', value: dispatch.product?.nome ?? 'Nao informado', available: Boolean(dispatch.product), complete: Boolean(dispatch.product), Icon: Package },
    { label: 'CANDIDATO', value: candidateId ? `${candidateId.slice(0, 10)}…` : 'Sem vinculo persistido', available: Boolean(candidateId), complete: Boolean(candidateId), Icon: Circle },
    { label: 'COPY', value: dispatch.generatedCopyId ? `${dispatch.generatedCopyId.slice(0, 10)}…` : 'Nao disponivel', available: Boolean(dispatch.generatedCopyId), complete: Boolean(dispatch.generatedCopyId), Icon: FileText },
    { label: 'DISPATCH', value: `${dispatch.status} · tentativa ${dispatch.attemptCount}`, available: true, complete: true, Icon: Send },
    { label: 'GRUPO', value: dispatch.destination?.name ?? 'Nao informado', available: Boolean(dispatch.destination), complete: Boolean(dispatch.destination), Icon: UsersRound },
    { label: 'SENT', value: dispatch.status === 'SENT' ? 'Confirmado' : dispatch.status, available: true, complete: dispatch.status === 'SENT', Icon: Send },
  ] as const;

  return (
    <section className="ops-dispatch-rail" aria-label="Rastro do ultimo dispatch">
      <div className="ops-dispatch-rail-header">
        <div>
          <span className="ops-eyebrow">Dispatch rail</span>
          <strong>Produto → Candidato → Copy → Dispatch → Grupo → Sent</strong>
        </div>
        <span className="ops-mono">{dispatch.id.slice(0, 14)}…</span>
      </div>
      <div className="ops-dispatch-stages">
        {stages.map(({ label, value, available, complete, Icon }) => {
          const state = stateFor(available, complete);
          return (
            <div className="ops-dispatch-stage" data-state={state} key={label}>
              <span className="ops-dispatch-stage-icon"><Icon size={14} aria-hidden="true" /></span>
              <span className="ops-dispatch-stage-label">{label}</span>
              <span className="ops-dispatch-stage-value" title={value}>{value}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function LatestDispatch({ dispatch }: { dispatch: WhatsAppDispatch | null }) {
  if (!dispatch) {
    return <OpsEmpty title="Nenhum envio localizado" message="O ultimo envio aparecera aqui quando houver um dispatch persistido." />;
  }
  const product = dispatch.product;
  const copyPreview = dispatch.generatedCopy?.mensagem?.trim() ?? '';
  const candidateId = dispatch.generatedCopy?.createdFromCandidateId ?? null;
  return (
    <div className="ops-dispatch-receipt">
      <div className="ops-receipt-header">
        <div>
          <span className="ops-eyebrow">Dispatch receipt</span>
          <div className="ops-receipt-status"><OpsBadge tone={toneForStatus(dispatch.status)}>{dispatch.status}</OpsBadge><span className="ops-mono">{formatDateTimeInTimezone(dispatch.sentAt ?? dispatch.createdAt, 'America/Sao_Paulo', '—', 'short')}</span></div>
        </div>
        <CopyIdButton value={dispatch.id} />
      </div>
      <div className="ops-receipt-product">
        <SafeProductImage className="ops-product-image" src={product?.urlImagem} />
        <div className="min-w-0">
          <div className="ops-product-name">{product?.nome ?? 'Produto nao informado'}</div>
          <div className="ops-product-price">{formatCurrency(typeof product?.preco === 'number' ? product.preco : null)}</div>
          <div className="ops-receipt-route"><span className="ops-mono">{dispatch.deliveryMode ?? 'IMAGE'}</span><span aria-hidden="true">→</span><span>{dispatch.destination?.name ?? 'Grupo nao disponivel'}</span></div>
        </div>
      </div>
      <div className="ops-receipt-copy">
        <span className="ops-detail-label">COPY</span>
        <p>{copyPreview ? `“${copyPreview.slice(0, 190)}${copyPreview.length > 190 ? '…' : ''}”` : 'Copy nao disponivel na resposta da API.'}</p>
      </div>
      <div className="ops-receipt-ledger">
        <div><span className="ops-detail-label">Provider</span><strong>{dispatch.provider ?? 'Nao disponivel'}</strong></div>
        <div><span className="ops-detail-label">Tentativa</span><strong className="ops-mono">{dispatch.attemptCount}</strong></div>
        <div><span className="ops-detail-label">Enviado em</span><strong className="ops-mono">{formatDateTimeInTimezone(dispatch.sentAt, 'America/Sao_Paulo', '—', 'medium')}</strong></div>
        <div><span className="ops-detail-label">Mensagem externa</span><strong>{dispatch.externalMessageId ? 'presente' : '—'}</strong></div>
      </div>
      <div className="ops-receipt-trace">
        <div><span className="ops-detail-label">Candidate ID</span><CopyIdButton value={candidateId} /></div>
        <div><span className="ops-detail-label">Generated copy</span><CopyIdButton value={dispatch.generatedCopyId} /></div>
        {dispatch.externalMessageId ? <div><span className="ops-detail-label">External ID</span><CopyIdButton value={dispatch.externalMessageId} /></div> : null}
      </div>
      <div className="ops-receipt-footer"><span>Dispatch confirmado · attempt {dispatch.attemptCount}</span><Link className="ops-button" href="/envios">Ver dispatch <ArrowUpRight size={14} aria-hidden="true" /></Link></div>
    </div>
  );
}

function QueuePreview({ items }: { items: CommercialQueueItem[] }) {
  if (items.length === 0) return <OpsEmpty title="Fila sem candidatos" message="A fila pronta depende de uma campanha ativa com candidatos elegiveis." />;
  return (
    <div className="ops-queue-preview">
      {items.slice(0, 6).map((item, index) => {
        const commercialMeta = [
          formatCurrency(Number(item.price)),
          item.discountRate > 0 ? `${item.discountRate}% desconto` : null,
          item.priceDropPercent ? `queda ${item.priceDropPercent}%` : null,
        ].filter(Boolean).join(' · ');
        return (
        <div className="ops-queue-row" key={item.id}>
          <span className="ops-queue-rank">#{String(item.rankPosition ?? index + 1).padStart(2, '0')}</span>
          <div className="ops-queue-product">
            <strong>{item.productName}</strong>
            <span>{commercialMeta} · rev. {item.snapshotRevision}</span>
            <small>{item.promotionSignals.length ? item.promotionSignals.join(' · ') : 'sem sinal comercial adicional'}</small>
          </div>
          <div className="ops-queue-score"><strong>{item.commercialScore}</strong><span>score</span></div>
          <span className="ops-queue-status" data-tone={toneForStatus(item.status)}>{item.status.replace('_', ' ')}</span>
        </div>
        );
      })}
    </div>
  );
}

export default function OverviewPage() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (initial = false) => {
    if (initial) setLoading(true); else setRefreshing(true);
    setError(null);
    try {
      const results = await Promise.allSettled([
        getHealth(),
        getAnalytics(),
        getCommercialAutomationStatus(),
        getCommercialAutomationSchedulerStatus(),
        listCommercialAutomationExecutions(1, 20),
        listDispatches(),
        listCommercialCampaigns(1, 20),
      ]);
      const labels = ['health', 'analytics', 'status', 'scheduler', 'executions', 'dispatches', 'campaigns'];
      const partialFailures = results.flatMap((result, index) => result.status === 'rejected' ? [labels[index]] : []);
      const health = results[0].status === 'fulfilled' ? results[0].value : null;
      const analytics = results[1].status === 'fulfilled' ? results[1].value : null;
      const status = results[2].status === 'fulfilled' ? results[2].value : null;
      const scheduler = results[3].status === 'fulfilled' ? results[3].value : null;
      const executions = results[4].status === 'fulfilled' ? results[4].value.items : [];
      const dispatches = results[5].status === 'fulfilled' ? results[5].value : [];
      const campaigns = results[6].status === 'fulfilled' ? results[6].value.items : [];
      let queue: CommercialQueueItem[] = [];
      if (campaigns.length > 0) {
        const campaign = campaigns.find((item) => item.active) ?? campaigns[0];
        try {
          queue = (await listCommercialCampaignQueue(campaign.id, { limit: 8 })).items;
        } catch {
          partialFailures.push('queue');
        }
      }
      setData({ health, analytics, status, scheduler, executions, dispatches, queue, partialFailures });
      if (partialFailures.length > 0) {
        setError(`Atualizacao parcial: ${partialFailures.join(', ')} indisponivel(is).`);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load(true);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const latestDispatch = useMemo(() => [...(data?.dispatches ?? [])].sort((a, b) => dispatchSortValue(b) - dispatchSortValue(a))[0] ?? null, [data?.dispatches]);

  return (
    <>
      <OpsPageHeading
        eyebrow="Shopee operations console"
        title="Visao geral"
        description="Produto, fila, copy e dispatch em uma mesma leitura operacional."
        actions={<button type="button" className="ops-button" onClick={() => void load()} disabled={refreshing}><RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" /> Atualizar agora</button>}
      />
      <OperationsStrip health={data?.health ?? null} status={data?.status ?? null} scheduler={data?.scheduler ?? null} lastDispatch={latestDispatch} />
      <DispatchRail dispatch={latestDispatch} />
      {loading ? <OpsLoading label="Consultando o control plane" /> : null}
      {error ? <OpsState title="Estado parcial" message={error} tone="warning" action={<button className="ops-button" type="button" onClick={() => void load()}>Tentar novamente</button>} /> : null}
      {data ? (
        <>
          <div className="ops-overview-grid">
            <OpsSection title="Atividade da automacao" meta="Execucoes comerciais e dispatches mais recentes.">
              <Timeline executions={data.executions} dispatches={data.dispatches} />
            </OpsSection>
            <OpsSection title="Ultimo envio" meta={latestDispatch?.id ?? 'Nenhum dispatch carregado'}>
              <LatestDispatch dispatch={latestDispatch} />
            </OpsSection>
          </div>
          <div className="ops-overview-lower">
            <OpsSection className="ops-section--quiet" title="Fila pronta" meta={data.queue.length ? `${data.queue.length} candidatos retornados pela campanha ativa.` : 'Sem endpoint global de candidatos.'} actions={<Link href="/fila" className="ops-button">Abrir fila <ArrowUpRight size={14} aria-hidden="true" /></Link>}>
              <QueuePreview items={data.queue} />
            </OpsSection>
            <OpsSection className="ops-section--quiet" title="Saude operacional" meta="Somente sinais expostos pela API atual.">
              <div className="ops-health-list">
                <div className="ops-health-row"><span className="ops-health-name">API Fastify</span><OpsBadge tone={data.health?.status === 'ok' ? 'success' : 'danger'}>{data.health?.status === 'ok' ? 'OK' : 'N/D'}</OpsBadge></div>
                <div className="ops-health-row"><span className="ops-health-name">Scheduler comercial</span><OpsBadge tone={data.scheduler?.status === 'registered' ? 'success' : 'warning'}>{data.scheduler?.status ?? 'N/D'}</OpsBadge></div>
                <div className="ops-health-row"><span className="ops-health-name">Grupo autorizado</span><span className="ops-mono">{data.status?.authorizedGroupCount ?? 'N/D'}</span></div>
                <div className="ops-health-row"><span className="ops-health-name">Postgres</span><span className="ops-mono">N/D · sem endpoint</span></div>
                <div className="ops-health-row"><span className="ops-health-name">Redis / workers</span><span className="ops-mono">N/D · sem endpoint</span></div>
              </div>
            </OpsSection>
          </div>
          <div className="ops-metric-line" aria-label="Resumo comercial persistido">
            {[
              ['Produtos', data.analytics?.totalProducts],
              ['Aprovados', data.analytics?.totalApprovedProducts],
              ['Copies', data.analytics?.totalGeneratedCopies],
              ['Falhas', data.analytics?.totalFailedDispatches],
            ].map(([label, value]) => <div className="ops-metric-cell" key={label}><span>{label}</span><strong className="ops-mono">{value ?? '—'}</strong></div>)}
          </div>
        </>
      ) : null}
    </>
  );
}
