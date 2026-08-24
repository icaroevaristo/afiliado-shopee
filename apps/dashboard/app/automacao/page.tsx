'use client';

import { Pause, Play, Save, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  getCommercialAutomationSchedulerStatus,
  getCommercialAutomationScheduleSettings,
  getCommercialAutomationSchedulePreview,
  getCommercialAutomationStatus,
  pauseCommercialAutomation,
  resumeCommercialAutomation,
  updateCommercialAutomationScheduleSettings,
  type CommercialAutomationScheduleSettings,
  type CommercialAutomationSchedulePreview,
  type CommercialAutomationSchedulerStatus,
  type CommercialAutomationStatus,
} from '../../lib/api';
import {
  getCommercialOperationalState,
  getCommercialReadinessState,
} from '../../lib/commercial-automation-display';
import { Countdown, OpsBadge, OpsLoading, OpsPageHeading, OpsSection, OpsState, RefreshButton } from '../../components/ops-components';
import { formatDateTimeInTimezone } from '../../lib/format';

const RESUME_CONFIRMATION = 'RETOMAR_AUTOMACAO_COMERCIAL';

function ConfirmationModal({ action, busy, onCancel, onConfirm }: { action: 'pause' | 'resume'; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const isResume = action === 'resume';
  return <div className="ops-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="automation-confirm-title"><div className="ops-modal"><p className="ops-eyebrow">Controle protegido</p><h2 id="automation-confirm-title" className="ops-section-title">{isResume ? 'Retomar automacao?' : 'Pausar automacao?'}</h2><p className="ops-section-meta mt-3">{isResume ? 'O scheduler podera voltar a avaliar candidatos nos proximos ticks naturais.' : 'Nenhum novo tick comercial devera ser autorizado enquanto a pausa persistir.'}</p><div className="ops-modal-actions"><button type="button" className="ops-button" onClick={onCancel} disabled={busy}>Cancelar</button><button type="button" className="ops-button" data-variant={isResume ? 'primary' : 'danger'} onClick={onConfirm} disabled={busy}>{busy ? 'Aplicando...' : isResume ? 'Confirmar retomada' : 'Confirmar pausa'}</button></div></div></div>;
}

export default function AutomationPage() {
  const [status, setStatus] = useState<CommercialAutomationStatus | null>(null);
  const [scheduler, setScheduler] = useState<CommercialAutomationSchedulerStatus | null>(null);
  const [schedule, setSchedule] = useState<CommercialAutomationScheduleSettings | null>(null);
  const [schedulePreview, setSchedulePreview] = useState<CommercialAutomationSchedulePreview | null>(null);
  const [scheduleDraft, setScheduleDraft] = useState({ start: '', end: '', minimum: '', stagger: '' });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<'pause' | 'resume' | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [scheduleBusy, setScheduleBusy] = useState(false);

  const load = async (initial = false) => {
    if (initial) setLoading(true); else setRefreshing(true);
    setError(null);
    try {
      const [nextStatus, nextScheduler, nextSchedule, nextPreview] = await Promise.all([getCommercialAutomationStatus(), getCommercialAutomationSchedulerStatus(), getCommercialAutomationScheduleSettings(), getCommercialAutomationSchedulePreview()]);
      setStatus(nextStatus);
      setScheduler(nextScheduler);
      setSchedule(nextSchedule);
      setSchedulePreview(nextPreview);
      setScheduleDraft({ start: nextSchedule.allowedStartTime, end: nextSchedule.allowedEndTime, minimum: String(nextSchedule.minimumIntervalMinutes), stagger: String(nextSchedule.staggerMinutes) });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Nao foi possivel consultar a automacao.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load(true);
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const operationalState = getCommercialOperationalState(status, scheduler);
  const readinessState = getCommercialReadinessState(status);
  const readinessDetails = readinessState.reasonCodes.length > 0
    ? `Reasons: ${readinessState.reasonCodes.join(' · ')}`
    : 'Nenhum bloqueio de readiness';

  const applyAction = async () => {
    if (!action) return;
    setActionBusy(true);
    setError(null);
    try {
      const next = action === 'pause' ? await pauseCommercialAutomation() : await resumeCommercialAutomation(RESUME_CONFIRMATION);
      setStatus(next);
      setAction(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'A alteracao nao foi aplicada.');
    } finally {
      setActionBusy(false);
    }
  };

  const applySchedule = async () => {
    if (!schedule) return;
    setScheduleBusy(true);
    setError(null);
    try {
      const next = await updateCommercialAutomationScheduleSettings({
        allowedStartTime: scheduleDraft.start,
        allowedEndTime: scheduleDraft.end,
        minimumIntervalMinutes: Number(scheduleDraft.minimum),
        staggerMinutes: Number(scheduleDraft.stagger),
        expectedRevision: schedule.scheduleRevision,
      });
      setSchedule(next);
      setScheduleDraft({ start: next.allowedStartTime, end: next.allowedEndTime, minimum: String(next.minimumIntervalMinutes), stagger: String(next.staggerMinutes) });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'A agenda nao foi atualizada.');
    } finally {
      setScheduleBusy(false);
    }
  };

  return (
    <>
      <OpsPageHeading eyebrow="Control plane" title="Automacao" description="Status, policy e scheduler em uma unica superficie. O painel nao edita .env, cron, limites ou retries." actions={<RefreshButton onClick={() => void load()} busy={refreshing} />} />
      {loading ? <OpsLoading label="Avaliando readiness e scheduler" /> : null}
      {error ? <OpsState title="Controle indisponivel" message={error} tone="danger" action={<button type="button" className="ops-button" onClick={() => void load()}>Tentar novamente</button>} /> : null}
      {status && scheduler ? <>
        <div className="ops-control-grid mb-4">
          <div className="ops-control"><div className="ops-control-label">Status operacional</div><div className="ops-control-value flex items-center gap-2"><span className="ops-status-dot" data-tone={operationalState.tone === 'neutral' ? 'warning' : operationalState.tone} />{operationalState.label}</div><div className="ops-control-sub">{operationalState.detail}</div></div>
          <div className="ops-control"><div className="ops-control-label">Readiness para envio</div><div className="ops-control-value"><OpsBadge tone={readinessState.tone}>{readinessState.label}</OpsBadge></div><div className="ops-control-sub ops-mono">{readinessDetails}</div></div>
          <div className="ops-control"><div className="ops-control-label">Proximo tick</div><div className="ops-control-value"><Countdown target={scheduler.nextRunAt} /></div><div className="ops-control-sub">{scheduler.nextRunAt ? formatDateTimeInTimezone(scheduler.nextRunAt, scheduler.timezone, '—', 'medium') : 'Nao disponivel'}</div></div>
          <div className="ops-control"><div className="ops-control-label">Envios hoje</div><div className="ops-control-value">{status.globalSentToday} / {status.dailyGlobalLimit}</div><div className="ops-control-sub">{status.groupSentToday === null ? 'grupo —' : `grupo ${status.groupSentToday} / ${status.dailyGroupLimit}`}</div></div>
          <div className="ops-control"><div className="ops-control-label">Modo</div><div className="ops-control-value">{scheduler.mode.toUpperCase()}</div><div className="ops-control-sub">janela {status.allowedStartTime}–{status.allowedEndTime} · {status.timezone}</div></div>
        </div>
        <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <OpsSection title="Scheduler comercial" meta="Registro somente leitura do job oficial.">
            <div className="ops-detail-grid">
              <div><div className="ops-detail-label">Status</div><div className="ops-detail-value"><OpsBadge tone={scheduler.status === 'registered' ? 'success' : 'warning'}>{scheduler.status}</OpsBadge></div></div>
              <div><div className="ops-detail-label">Job ID</div><div className="ops-detail-value ops-mono">{scheduler.jobId}</div></div>
              <div><div className="ops-detail-label">Cron</div><div className="ops-detail-value ops-mono">{scheduler.cron}</div></div>
              <div><div className="ops-detail-label">Timezone</div><div className="ops-detail-value">{scheduler.timezone}</div></div>
              <div><div className="ops-detail-label">Fila</div><div className="ops-detail-value ops-mono">{scheduler.queue}</div></div>
              <div><div className="ops-detail-label">Proxima execucao</div><div className="ops-detail-value">{formatDateTimeInTimezone(scheduler.nextRunAt, scheduler.timezone, '—', 'medium')}</div></div>
            </div>
          </OpsSection>
          <OpsSection title="Guardrails" meta="Valores lidos do status oficial.">
            <div className="ops-health-list">
              <div className="ops-health-row"><span className="ops-health-name"><ShieldCheck size={14} className="mr-2 inline" aria-hidden="true" />Pausa persistida</span><OpsBadge tone={status.paused ? 'warning' : 'success'}>{status.paused ? 'ATIVA' : 'NAO PAUSADA'}</OpsBadge></div>
              <div className="ops-health-row"><span className="ops-health-name">Grupo autorizado</span><span className="ops-mono">{status.authorizedGroupCount}</span></div>
              <div className="ops-health-row"><span className="ops-health-name">Limite global restante</span><span className="ops-mono">{status.globalRemainingToday}</span></div>
              <div className="ops-health-row"><span className="ops-health-name">Limite do grupo restante</span><span className="ops-mono">{status.groupRemainingToday ?? '—'}</span></div>
              <div className="ops-health-row"><span className="ops-health-name">Ultimo envio</span><span className="ops-mono">{formatDateTimeInTimezone(status.lastSentAt, status.timezone, '—', 'medium')}</span></div>
            </div>
          </OpsSection>
        </div>
        {schedule ? <OpsSection title="Agenda comercial" meta={`Overrides persistidos · revisao ${schedule.scheduleRevision} · ${schedule.timezone}`}>
          <div className="ops-health-list mb-4"><div className="ops-health-row"><span className="ops-health-name">Proximo slot</span><span className="ops-mono">{schedulePreview?.nextSlot ? `${formatDateTimeInTimezone(schedulePreview.nextSlot.scheduledFor, schedule.timezone, '—', 'medium')} · ${schedulePreview.nextSlot.instanceName} · ${schedulePreview.nextSlot.campaignId}/${schedulePreview.nextSlot.groupId}` : 'Nenhum slot elegivel'}</span></div><div className="ops-health-row"><span className="ops-health-name">Slots planejados</span><span className="ops-mono">{schedulePreview?.plannedSlots ?? '—'}</span></div></div>
          <div className="grid gap-4 md:grid-cols-4">
            <label className="ops-control"><span className="ops-control-label">Inicio da janela</span><input className="ops-input" type="time" value={scheduleDraft.start} onChange={(event) => setScheduleDraft((current) => ({ ...current, start: event.target.value }))} /></label>
            <label className="ops-control"><span className="ops-control-label">Fim da janela</span><input className="ops-input" type="time" value={scheduleDraft.end} onChange={(event) => setScheduleDraft((current) => ({ ...current, end: event.target.value }))} /></label>
            <label className="ops-control"><span className="ops-control-label">Minimum interval (min)</span><input className="ops-input" type="number" min="1" max="1440" value={scheduleDraft.minimum} onChange={(event) => setScheduleDraft((current) => ({ ...current, minimum: event.target.value }))} /></label>
            <label className="ops-control"><span className="ops-control-label">Stagger (min)</span><input className="ops-input" type="number" min="0" max="1440" value={scheduleDraft.stagger} onChange={(event) => setScheduleDraft((current) => ({ ...current, stagger: event.target.value }))} /></label>
          </div>
          <div className="mt-4 flex justify-end"><button type="button" className="ops-button" data-variant="primary" onClick={() => void applySchedule()} disabled={scheduleBusy}><Save size={14} aria-hidden="true" /> {scheduleBusy ? 'Salvando...' : 'Salvar agenda'}</button></div>
        </OpsSection> : null}
        <OpsSection title="Acoes de controle" meta="Pausar, retomar e atualizar a agenda persistida; sem edicao de .env ou cron.">
          <div className="flex flex-wrap gap-2"><button type="button" className="ops-button" data-variant="danger" onClick={() => setAction('pause')} disabled={status.paused}><Pause size={14} aria-hidden="true" /> Pausar automacao</button><button type="button" className="ops-button" data-variant="primary" onClick={() => setAction('resume')} disabled={!status.paused}><Play size={14} aria-hidden="true" /> Retomar automacao</button></div>
        </OpsSection>
      </> : null}
      {action ? <ConfirmationModal action={action} busy={actionBusy} onCancel={() => setAction(null)} onConfirm={() => void applyAction()} /> : null}
    </>
  );
}
