'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getOperationalAdmin, type OperationalAdmin } from '../lib/api';
import { formatDateTime } from '../lib/format';

type SnapshotState = 'loading' | 'available' | 'stale' | 'unavailable';

const queueWaiting = (queue: OperationalAdmin['queues']['productPipeline']) =>
  queue.status === 'READY' && queue.counts
    ? String(queue.counts.waiting)
    : `${queue.status ?? 'UNKNOWN'} (não medido)`;

export function OperationalStatusSummary() {
  const [overview, setOverview] = useState<OperationalAdmin | null>(null);
  const [state, setState] = useState<SnapshotState>('loading');
  const hasSnapshot = useRef(false);

  const load = useCallback(async () => {
    setState('loading');
    try {
      setOverview(await getOperationalAdmin());
      hasSnapshot.current = true;
      setState('available');
    } catch {
      setState(hasSnapshot.current ? 'stale' : 'unavailable');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!overview) {
    return (
      <section
        className="ops-section"
        aria-labelledby="operational-summary-heading"
      >
        <h2 id="operational-summary-heading" className="ops-section-title">
          Estado operacional centralizado
        </h2>
        <button
          className="ops-button mt-3"
          type="button"
          onClick={() => void load()}
        >
          Atualizar status
        </button>
        {state === 'loading' ? (
          <p className="ops-section-meta">Carregando snapshot operacional.</p>
        ) : (
          <div
            className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
            role="alert"
          >
            <p>
              O snapshot operacional está indisponível. Nenhum estado foi
              presumido.
            </p>
          </div>
        )}
      </section>
    );
  }
  const campaigns = overview.campaigns ?? [];
  return (
    <section
      className="ops-section"
      aria-labelledby="operational-summary-heading"
    >
      <div className="ops-section-header">
        <div>
          <h2 id="operational-summary-heading" className="ops-section-title">
            Estado operacional centralizado
          </h2>
          <p className="ops-section-meta">
            Valores efetivos derivados do planner, dispatches, lifecycle,
            reservations e filas.
          </p>
        </div>
        <button
          className="ops-button"
          type="button"
          onClick={() => void load()}
        >
          Atualizar status
        </button>
      </div>
      <div className="ops-control-grid">
        <div className="ops-control">
          <div className="ops-control-label">Próximo envio global</div>
          <div className="ops-control-value">
            {formatDateTime(overview.nextSendAt)}
          </div>
        </div>
        <div className="ops-control">
          <div className="ops-control-label">Último envio global</div>
          <div className="ops-control-value">
            {formatDateTime(overview.lastSendAt)}
          </div>
        </div>
        <div className="ops-control">
          <div className="ops-control-label">Execuções / reservas</div>
          <div className="ops-control-value">
            {overview.activeExecutions} / {overview.activeReservations}
          </div>
        </div>
        <div className="ops-control">
          <div className="ops-control-label">Dispatch / outbox pendente</div>
          <div className="ops-control-value">
            {overview.pendingDispatches} / {overview.pendingOutboxes}
          </div>
        </div>
      </div>
      {state === 'stale' ? (
        <div
          className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
          role="alert"
        >
          <p>
            O último snapshot permanece visível, mas a atualização atual falhou.
          </p>
        </div>
      ) : null}
      <div className="ops-health-list mt-4">
        <div className="ops-health-row">
          <span className="ops-health-name">Filas</span>
          <span className="ops-mono">
            pipeline {queueWaiting(overview.queues.productPipeline)} · dispatch{' '}
            {queueWaiting(overview.queues.whatsappDispatch)} · automação{' '}
            {queueWaiting(overview.queues.commercialAutomation)}
          </span>
        </div>
        <div className="ops-health-row">
          <span className="ops-health-name">Ambiguidade / investigação</span>
          <span className="ops-mono">
            {overview.ambiguity} / {overview.investigationRequired}
          </span>
        </div>
        <div className="ops-health-row">
          <span className="ops-health-name">Blockers</span>
          <span className="ops-mono">
            {overview.blockers.length === 0
              ? 'nenhum'
              : overview.blockers.map((blocker) => blocker.code).join(' · ')}
          </span>
        </div>
        {overview.readiness ? (
          <div className="ops-health-row">
            <span className="ops-health-name">Readiness</span>
            <span className="ops-mono">
              control {overview.readiness.controlPlane.status} · comercial{' '}
              {overview.readiness.commercial.status} · send{' '}
              {overview.readiness.send.status} · provider{' '}
              {overview.readiness.providerConfiguration.status}
            </span>
          </div>
        ) : null}
      </div>
      {campaigns.length > 0 ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {campaigns.map((campaign) => (
            <article
              key={campaign.id}
              className="rounded-md border border-slate-200 p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-medium text-slate-950">
                    {campaign.name}
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    {campaign.groupName ?? 'Grupo não vinculado'} ·{' '}
                    {campaign.instanceName ?? 'Sem instância'} ·{' '}
                    {campaign.active ? 'ativa' : 'inativa'}
                  </p>
                </div>
                <span className="ops-mono text-xs">{campaign.niche.name}</span>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-slate-500">Próximo envio</dt>
                  <dd className="mt-1 text-slate-950">
                    {formatDateTime(campaign.nextSendAt)}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Último envio</dt>
                  <dd className="mt-1 text-slate-950">
                    {formatDateTime(campaign.lastSendAt)}
                  </dd>
                </div>
              </dl>
              <p className="mt-3 text-xs text-amber-800">
                {campaign.blockers.length === 0
                  ? 'Sem blocker acionável'
                  : campaign.blockers
                      .map((blocker) => blocker.code)
                      .join(' · ')}
              </p>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
