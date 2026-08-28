'use client';

import { useEffect, useState } from 'react';
import { getOperationalAdmin, type OperationalAdmin } from '../lib/api';
import { formatDateTime } from '../lib/format';

export function OperationalStatusSummary() {
  const [overview, setOverview] = useState<OperationalAdmin | null>(null);

  useEffect(() => {
    let active = true;
    if (typeof getOperationalAdmin !== 'function')
      return () => {
        active = false;
      };
    void getOperationalAdmin()
      .then((value) => {
        if (active) setOverview(value);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  if (!overview) return null;
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
      <div className="ops-health-list mt-4">
        <div className="ops-health-row">
          <span className="ops-health-name">Filas</span>
          <span className="ops-mono">
            pipeline {overview.queues.productPipeline.waiting} · dispatch{' '}
            {overview.queues.whatsappDispatch.waiting} · automação{' '}
            {overview.queues.commercialAutomation.waiting}
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
