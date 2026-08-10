'use client';

import { CalendarClock, Database, Radio, Send, Timer } from 'lucide-react';
import { Countdown } from './ops-components';
import type { CommercialAutomationSchedulerStatus, CommercialAutomationStatus, HealthResponse, WhatsAppDispatch } from '../lib/api';
import { formatDateTimeInTimezone } from '../lib/format';

export function OperationsStrip({
  status,
  scheduler,
  health,
  lastDispatch,
}: {
  status: CommercialAutomationStatus | null;
  scheduler: CommercialAutomationSchedulerStatus | null;
  health?: HealthResponse | null;
  lastDispatch: WhatsAppDispatch | null;
}) {
  const isOperating = Boolean(status?.enabled && !status.paused && status.allowed);
  const timezone = scheduler?.timezone ?? status?.timezone ?? 'America/Sao_Paulo';
  const sent = status ? `${status.globalSentToday} / ${status.dailyGlobalLimit}` : '—';
  const nextRun = scheduler?.nextRunAt
    ? formatDateTimeInTimezone(scheduler.nextRunAt, timezone, '—', 'medium')
    : 'Nao disponivel';
  const lastSent = lastDispatch?.sentAt
    ? formatDateTimeInTimezone(lastDispatch.sentAt, timezone, '—', 'medium')
    : 'Nao disponivel';

  const items = [
    {
      label: 'NEXT DROP',
      value: nextRun,
      icon: CalendarClock,
      tone: 'accent',
      subtext: scheduler?.nextRunAt ? <Countdown target={scheduler.nextRunAt} /> : 'sem endpoint',
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
      subtext: status ? `grupo ${status.groupSentToday} / ${status.dailyGroupLimit}` : 'sem endpoint',
      priority: undefined,
    },
    {
      label: 'CADENCE',
      value: scheduler?.status === 'registered' ? 'REGISTRADO' : 'N/D',
      icon: Radio,
      tone: scheduler?.status === 'registered' ? 'success' : 'warning',
      subtext: scheduler?.cron ?? 'sem endpoint',
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
        <span className="ops-strip-live-kicker"><span className="ops-status-dot" data-tone={isOperating ? 'success' : 'warning'} aria-hidden="true" /> LIVE</span>
        <strong>AUTOMATION</strong>
        <span className="ops-strip-live-mode ops-mono">{scheduler?.mode?.toUpperCase() ?? 'N/D'}</span>
        <span className="ops-strip-live-state">{isOperating ? 'operando' : status?.paused ? 'pausada' : 'bloqueada'}</span>
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
