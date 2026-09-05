'use client';

import { CalendarClock, Database, Radio, Send, Timer } from 'lucide-react';
import { Countdown } from './ops-components';
import type { CommercialAutomationSchedulerStatus, CommercialAutomationStatus, HealthResponse, WhatsAppDispatch } from '../lib/api';
import { getCommercialOperationalState, getCommercialReadinessState } from '../lib/commercial-automation-display';
import { formatDateTimeInTimezone } from '../lib/format';

export function OperationsStrip({
  status,
  scheduler,
  health,
  lastDispatch,
  nextSendAt,
}: {
  status: CommercialAutomationStatus | null;
  scheduler: CommercialAutomationSchedulerStatus | null;
  health?: HealthResponse | null;
  lastDispatch: WhatsAppDispatch | null;
  nextSendAt?: string | null;
}) {
  const operationalState = getCommercialOperationalState(status, scheduler);
  const readinessState = getCommercialReadinessState(status);
  const timezone = status?.timezone ?? scheduler?.timezone ?? 'America/Sao_Paulo';
  const sent = status ? `${status.globalSentToday} / ${status.dailyGlobalLimit}` : '—';
  const nextSend = nextSendAt
    ? formatDateTimeInTimezone(nextSendAt, timezone, '—', 'medium')
    : 'Nao disponivel';
  const lastSent = lastDispatch?.sentAt
    ? formatDateTimeInTimezone(lastDispatch.sentAt, timezone, '—', 'medium')
    : 'Nao disponivel';

  const items = [
    {
      label: 'NEXT SEND',
      value: nextSend,
      icon: CalendarClock,
      tone: 'accent',
      subtext: nextSendAt ? <Countdown target={nextSendAt} /> : 'sem agenda elegível',
      priority: 'primary',
    },
    {
      label: 'LAST DISPATCH',
      value: lastSent,
      icon: Send,
      tone: 'neutral',
      subtext: lastDispatch?.status ?? 'sem registro',
      priority: undefined,
    },
    {
      label: 'TODAY',
      value: sent,
      icon: Timer,
      tone: 'neutral',
      subtext:
        status?.groupSentToday === null || status?.groupSentToday === undefined
          ? 'grupo —'
          : `grupo ${status.groupSentToday} / ${status.dailyGroupLimit}`,
      priority: undefined,
    },
    {
      label: 'CADENCE',
      value: scheduler?.status === 'registered' ? 'REGISTRADO' : 'N/D',
      icon: Radio,
      tone: scheduler?.status === 'registered' ? 'success' : 'warning',
      subtext: scheduler?.status === 'registered' ? 'verificação técnica · a cada 1 minuto' : 'scheduler técnico indisponível',
      priority: undefined,
    },
    {
      label: 'API',
      value: health?.status === 'ok' ? 'OK' : 'N/D',
      icon: Database,
      tone: health?.status === 'ok' ? 'success' : 'warning',
      subtext: health?.service ?? 'sem endpoint de saude',
      priority: undefined,
    },
  ] as const;

  return (
    <section className="ops-strip" aria-label="Telemetria da automacao">
      <div className="ops-strip-live">
        <span className="ops-strip-live-kicker"><span className="ops-status-dot" data-tone={operationalState.tone === 'neutral' ? 'warning' : operationalState.tone} aria-hidden="true" /> LIVE</span>
        <strong>AUTOMATION</strong>
        <span className="ops-strip-live-mode ops-mono">{scheduler?.mode?.toUpperCase() ?? 'N/D'}</span>
        <span className="ops-strip-live-state">{operationalState.label}</span>
        <span className="ops-strip-live-state">READINESS · {readinessState.label}</span>
        {readinessState.reasonCodes.length > 0 ? (
          <span className="ops-strip-live-state ops-mono">
            {readinessState.reasonCodes.join(' · ')}
          </span>
        ) : null}
      </div>
      {items.map(({ label, value, icon: Icon, tone, subtext, priority }) => (
        <div className="ops-strip-item" data-priority={priority} key={label}>
          <span className="ops-strip-label">{label}</span>
          <span className="ops-strip-value" data-tone={tone}>
            <Icon size={14} aria-hidden="true" />
            {value}
          </span>
          <span className="ops-strip-subtext">{subtext}</span>
        </div>
      ))}
    </section>
  );
}
