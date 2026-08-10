'use client';

import { Pause, Play, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  getCommercialAutomationSchedulerStatus,
  getCommercialAutomationStatus,
  pauseCommercialAutomation,
  resumeCommercialAutomation,
  type CommercialAutomationSchedulerStatus,
  type CommercialAutomationStatus,
} from '../../lib/api';
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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<'pause' | 'resume' | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const load = async (initial = false) => {
    if (initial) setLoading(true); else setRefreshing(true);
    setError(null);
    try {
      const [nextStatus, nextScheduler] = await Promise.all([getCommercialAutomationStatus(), getCommercialAutomationSchedulerStatus()]);
      setStatus(nextStatus);
      setScheduler(nextScheduler);
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

  return (
    <>
      <OpsPageHeading eyebrow="Control plane" title="Automacao" description="Status, policy e scheduler em uma unica superficie. O painel nao edita .env, cron, limites ou retries." actions={<RefreshButton onClick={() => void load()} busy={refreshing} />} />
      {loading ? <OpsLoading label="Avaliando readiness e scheduler" /> : null}
      {error ? <OpsState title="Controle indisponivel" message={error} tone="danger" action={<button type="button" className="ops-button" onClick={() => void load()}>Tentar novamente</button>} /> : null}
      {status && scheduler ? <>
        <div className="ops-control-grid mb-4">
          <div className="ops-control"><div className="ops-control-label">Status operacional</div><div className="ops-control-value flex items-center gap-2"><span className="ops-status-dot" data-tone={status.paused ? 'warning' : status.allowed ? 'success' : 'warning'} />{status.paused ? 'PAUSADA' : status.allowed ? 'ATIVA' : 'BLOQUEADA'}</div><div className="ops-control-sub">{status.reasons.length ? status.reasons.join(' · ') : 'readiness sem bloqueios'}</div></div>
          <div className="ops-control"><div className="ops-control-label">Proximo tick</div><div className="ops-control-value"><Countdown target={scheduler.nextRunAt} /></div><div className="ops-control-sub">{scheduler.nextRunAt ? formatDateTimeInTimezone(scheduler.nextRunAt, scheduler.timezone, '—', 'medium') : 'Nao disponivel'}</div></div>
          <div className="ops-control"><div className="ops-control-label">Envios hoje</div><div className="ops-control-value">{status.globalSentToday} / {status.dailyGlobalLimit}</div><div className="ops-control-sub">grupo {status.groupSentToday} / {status.dailyGroupLimit}</div></div>
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
              <div className="ops-health-row"><span className="ops-health-name">Limite do grupo restante</span><span className="ops-mono">{status.groupRemainingToday}</span></div>
              <div className="ops-health-row"><span className="ops-health-name">Ultimo envio</span><span className="ops-mono">{formatDateTimeInTimezone(status.lastSentAt, status.timezone, '—', 'medium')}</span></div>
            </div>
          </OpsSection>
        </div>
        <OpsSection title="Acoes de controle" meta="Pausar e retomar sao as unicas escritas permitidas pelo console.">
          <div className="flex flex-wrap gap-2"><button type="button" className="ops-button" data-variant="danger" onClick={() => setAction('pause')} disabled={status.paused}><Pause size={14} aria-hidden="true" /> Pausar automacao</button><button type="button" className="ops-button" data-variant="primary" onClick={() => setAction('resume')} disabled={!status.paused}><Play size={14} aria-hidden="true" /> Retomar automacao</button></div>
        </OpsSection>
      </> : null}
      {action ? <ConfirmationModal action={action} busy={actionBusy} onCancel={() => setAction(null)} onConfirm={() => void applyAction()} /> : null}
    </>
  );
}
