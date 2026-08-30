'use client';

import { Pause, Play, Save, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  DashboardApiError,
  getCommercialAutomationSchedulerStatus,
  getCommercialAutomationScheduleSettings,
  getCommercialAutomationSchedulePreview,
  getCommercialAutomationStatus,
  getOperationalAdmin,
  pauseCommercialAutomation,
  resumeCommercialAutomation,
  updateCommercialAutomationScheduleSettings,
  updateOperationalAutomation,
  type CommercialAutomationScheduleSettings,
  type CommercialAutomationSchedulePreview,
  type CommercialAutomationSchedulerStatus,
  type CommercialAutomationStatus,
  type OperationalAdmin,
} from '../../lib/api';
import {
  getCommercialOperationalState,
  getCommercialReadinessState,
} from '../../lib/commercial-automation-display';
import {
  Countdown,
  OpsBadge,
  OpsLoading,
  OpsPageHeading,
  OpsSection,
  OpsState,
  RefreshButton,
} from '../../components/ops-components';
import { formatDateTimeInTimezone } from '../../lib/format';
import { OperationalStatusSummary } from '../../components/operational-status-summary';

const RESUME_CONFIRMATION = 'RETOMAR_AUTOMACAO_COMERCIAL';

const automationErrorMessage = (cause: unknown, fallback: string) => {
  if (!(cause instanceof DashboardApiError)) {
    return cause instanceof Error ? cause.message : fallback;
  }
  if (cause.code === 'OPERATIONAL_CAS_CONFLICT') {
    return 'Conflito de concorrência: a agenda mudou antes de salvar. Atualize o estado e tente novamente.';
  }
  if (cause.code?.includes('BLOCKED')) {
    return `Alteração bloqueada: ${cause.message}`;
  }
  if (cause.code?.includes('INVALID') || cause.code?.includes('CONFIRMATION')) {
    return `Validação: ${cause.message}`;
  }
  return cause.message || fallback;
};

function ConfirmationModal({
  action,
  busy,
  onCancel,
  onConfirm,
}: {
  action: 'pause' | 'resume';
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const isResume = action === 'resume';
  return (
    <div
      className="ops-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="automation-confirm-title"
    >
      <div className="ops-modal">
        <p className="ops-eyebrow">Controle protegido</p>
        <h2 id="automation-confirm-title" className="ops-section-title">
          {isResume ? 'Ligar automação?' : 'Desligar automação?'}
        </h2>
        <p className="ops-section-meta mt-3">
          {isResume
            ? 'A pausa persistida será removida. O scheduler poderá avaliar candidatos nos próximos ticks naturais.'
            : 'A pausa persistida impedirá novos ticks comerciais enquanto permanecer ativa.'}
        </p>
        <div className="ops-modal-actions">
          <button
            type="button"
            className="ops-button"
            onClick={onCancel}
            disabled={busy}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="ops-button"
            data-variant={isResume ? 'primary' : 'danger'}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy
              ? 'Aplicando...'
              : isResume
                ? 'Confirmar ligação'
                : 'Confirmar desligamento'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AutomationPage() {
  const [status, setStatus] = useState<CommercialAutomationStatus | null>(null);
  const [scheduler, setScheduler] =
    useState<CommercialAutomationSchedulerStatus | null>(null);
  const [schedule, setSchedule] =
    useState<CommercialAutomationScheduleSettings | null>(null);
  const [schedulePreview, setSchedulePreview] =
    useState<CommercialAutomationSchedulePreview | null>(null);
  const [scheduleDraft, setScheduleDraft] = useState({
    start: '',
    end: '',
    minimum: '',
    stagger: '',
    globalLimit: '',
    groupLimit: '',
    shopeeLimit: '',
    openAiLimit: '',
  });
  const [operational, setOperational] = useState<OperationalAdmin | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [action, setAction] = useState<'pause' | 'resume' | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [scheduleBusy, setScheduleBusy] = useState(false);

  const load = async (initial = false) => {
    if (initial) setLoading(true);
    else setRefreshing(true);
    setError(null);
    setSuccess(null);
    try {
      const operationalRequest =
        typeof getOperationalAdmin === 'function'
          ? getOperationalAdmin()
          : Promise.resolve(null);
      const [
        nextStatus,
        nextScheduler,
        nextSchedule,
        nextPreview,
        nextOperational,
      ] = await Promise.all([
        getCommercialAutomationStatus(),
        getCommercialAutomationSchedulerStatus(),
        getCommercialAutomationScheduleSettings(),
        getCommercialAutomationSchedulePreview(),
        operationalRequest,
      ]);
      setStatus(nextStatus);
      setScheduler(nextScheduler);
      setSchedule(nextSchedule);
      setSchedulePreview(nextPreview);
      setOperational(nextOperational);
      setScheduleDraft({
        start: nextSchedule.allowedStartTime,
        end: nextSchedule.allowedEndTime,
        minimum: String(nextSchedule.minimumIntervalMinutes),
        stagger: String(nextSchedule.staggerMinutes),
        globalLimit: nextOperational
          ? String(
              nextOperational.automation.dailyGlobalLimitOverride ??
                nextOperational.automation.dailyGlobalLimit,
            )
          : '',
        groupLimit: nextOperational
          ? String(
              nextOperational.automation.dailyGroupLimitOverride ??
                nextOperational.automation.dailyGroupLimit,
            )
          : '',
        shopeeLimit: nextOperational
          ? String(
              nextOperational.automation.dailyShopeeHttpLimit ??
                nextOperational.automation.dailyGlobalLimit,
            )
          : '',
        openAiLimit: nextOperational
          ? String(
              nextOperational.automation.dailyOpenAiGenerationLimit ??
                nextOperational.automation.dailyGlobalLimit,
            )
          : '',
      });
    } catch (cause) {
      setError(
        automationErrorMessage(
          cause,
          'Nao foi possivel consultar a automacao.',
        ),
      );
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

  const operationalState = getCommercialOperationalState(status, scheduler);
  const readinessState = getCommercialReadinessState(status);
  const automationIsOn = Boolean(status?.enabled && !status?.paused);
  const readinessDetails =
    readinessState.reasonCodes.length > 0
      ? `Reasons: ${readinessState.reasonCodes.join(' · ')}`
      : 'Nenhum bloqueio de readiness';

  const applyAction = async () => {
    if (!action) return;
    setActionBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const next =
        action === 'pause'
          ? await pauseCommercialAutomation()
          : await resumeCommercialAutomation(
              RESUME_CONFIRMATION,
              status?.updatedAt ?? '',
            );
      setStatus(next);
      setAction(null);
      setSuccess(
        action === 'pause'
          ? 'Automação pausada.'
          : 'Automação retomada com a configuração persistida.',
      );
    } catch (cause) {
      setError(automationErrorMessage(cause, 'A alteracao nao foi aplicada.'));
    } finally {
      setActionBusy(false);
    }
  };

  const applySchedule = async () => {
    if (!schedule) return;
    setScheduleBusy(true);
    setError(null);
    setSuccess(null);
    try {
      if (
        operational &&
        typeof updateOperationalAutomation === 'function' &&
        !window.confirm('Confirmar alteração da configuração operacional?')
      )
        return;
      const next =
        operational && typeof updateOperationalAutomation === 'function'
          ? await updateOperationalAutomation({
              allowedStartTime: scheduleDraft.start,
              allowedEndTime: scheduleDraft.end,
              minimumIntervalMinutes: Number(scheduleDraft.minimum),
              staggerMinutes: Number(scheduleDraft.stagger),
              dailyGlobalLimit: Number(scheduleDraft.globalLimit),
              dailyGroupLimit: Number(scheduleDraft.groupLimit),
              dailyShopeeHttpLimit: Number(scheduleDraft.shopeeLimit),
              dailyOpenAiGenerationLimit: Number(scheduleDraft.openAiLimit),
              expectedRevision: schedule.scheduleRevision,
              confirmation: 'CONFIRMAR_ALTERACAO_OPERACIONAL',
            })
          : await updateCommercialAutomationScheduleSettings({
              allowedStartTime: scheduleDraft.start,
              allowedEndTime: scheduleDraft.end,
              minimumIntervalMinutes: Number(scheduleDraft.minimum),
              staggerMinutes: Number(scheduleDraft.stagger),
              expectedRevision: schedule.scheduleRevision,
            });
      setSchedule(next);
      setScheduleDraft((current) => ({
        ...current,
        start: next.allowedStartTime,
        end: next.allowedEndTime,
        minimum: String(next.minimumIntervalMinutes),
        stagger: String(next.staggerMinutes),
      }));
      if (operational) await load();
      setSuccess('Agenda operacional atualizada.');
    } catch (cause) {
      setError(automationErrorMessage(cause, 'A agenda nao foi atualizada.'));
    } finally {
      setScheduleBusy(false);
    }
  };

  return (
    <>
      <OpsPageHeading
        eyebrow="Control plane"
        title="Automacao"
        description="Status, policy e scheduler em uma unica superficie. O painel nao edita .env, cron, hard caps ou retries."
        actions={
          <RefreshButton onClick={() => void load()} busy={refreshing} />
        }
      />
      {loading ? <OpsLoading label="Avaliando readiness e scheduler" /> : null}
      {error ? (
        <OpsState
          title="Controle indisponivel"
          message={error}
          tone="danger"
          action={
            <button
              type="button"
              className="ops-button"
              onClick={() => void load()}
            >
              Tentar novamente
            </button>
          }
        />
      ) : null}
      {success ? (
        <OpsState
          title="Alteração concluída"
          message={success}
          tone="success"
        />
      ) : null}
      {status ? (
        <section
          className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between"
          aria-live="polite"
          aria-label="Estado da automação"
        >
          <div>
            <p className="ops-eyebrow">Controle diário</p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">
              {automationIsOn ? 'AUTOMAÇÃO LIGADA' : 'AUTOMAÇÃO DESLIGADA'}
            </h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              {status.paused
                ? 'A pausa persistida impede novos trabalhos até você ligar a automação.'
                : status.enabled
                  ? 'A automação está disponível para operar conforme agenda, limites e readiness.'
                  : 'O ambiente desabilitou a automação; nenhum trabalho será iniciado.'}
            </p>
          </div>
          <OpsBadge tone={automationIsOn ? 'success' : 'warning'}>
            {automationIsOn ? 'LIGADA' : 'DESLIGADA'}
          </OpsBadge>
        </section>
      ) : null}
      <OperationalStatusSummary />
      {status && scheduler ? (
        <>
          <div className="ops-control-grid mb-4">
            <div className="ops-control">
              <div className="ops-control-label">Status operacional</div>
              <div className="ops-control-value flex items-center gap-2">
                <span
                  className="ops-status-dot"
                  data-tone={
                    operationalState.tone === 'neutral'
                      ? 'warning'
                      : operationalState.tone
                  }
                />
                {operationalState.label}
              </div>
              <div className="ops-control-sub">{operationalState.detail}</div>
            </div>
            <div className="ops-control">
              <div className="ops-control-label">Readiness para envio</div>
              <div className="ops-control-value">
                <OpsBadge tone={readinessState.tone}>
                  {readinessState.label}
                </OpsBadge>
              </div>
              <div className="ops-control-sub ops-mono">{readinessDetails}</div>
            </div>
            <div className="ops-control">
              <div className="ops-control-label">Proximo tick</div>
              <div className="ops-control-value">
                <Countdown target={scheduler.nextRunAt} />
              </div>
              <div className="ops-control-sub">
                {scheduler.nextRunAt
                  ? formatDateTimeInTimezone(
                      scheduler.nextRunAt,
                      scheduler.timezone,
                      '—',
                      'medium',
                    )
                  : 'Nao disponivel'}
              </div>
            </div>
            <div className="ops-control">
              <div className="ops-control-label">Envios hoje</div>
              <div className="ops-control-value">
                {status.globalSentToday} / {status.dailyGlobalLimit}
              </div>
              <div className="ops-control-sub">
                {status.groupSentToday === null
                  ? 'grupo —'
                  : `grupo ${status.groupSentToday} / ${status.dailyGroupLimit}`}
              </div>
            </div>
            <div className="ops-control">
              <div className="ops-control-label">Modo</div>
              <div className="ops-control-value">
                {scheduler.mode.toUpperCase()}
              </div>
              <div className="ops-control-sub">
                janela {status.allowedStartTime}–{status.allowedEndTime} ·{' '}
                {status.timezone}
              </div>
            </div>
            <div className="ops-control">
              <div className="ops-control-label">Shopee hoje</div>
              <div className="ops-control-value">
                {operational?.automation.providerUsage?.shopee.used ?? 0} /{' '}
                {operational?.automation.providerUsage?.shopee.limit ?? '—'}
              </div>
              <div className="ops-control-sub">Tentativas HTTP oficiais</div>
            </div>
            <div className="ops-control">
              <div className="ops-control-label">OpenAI hoje</div>
              <div className="ops-control-value">
                {operational?.automation.providerUsage?.openAi.used ?? 0} /{' '}
                {operational?.automation.providerUsage?.openAi.limit ?? '—'}
              </div>
              <div className="ops-control-sub">Gerações externas</div>
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <OpsSection
              title="Scheduler comercial"
              meta="Registro somente leitura do job oficial."
            >
              <div className="ops-detail-grid">
                <div>
                  <div className="ops-detail-label">Status</div>
                  <div className="ops-detail-value">
                    <OpsBadge
                      tone={
                        scheduler.status === 'registered'
                          ? 'success'
                          : 'warning'
                      }
                    >
                      {scheduler.status}
                    </OpsBadge>
                  </div>
                </div>
                <div>
                  <div className="ops-detail-label">Job ID</div>
                  <div className="ops-detail-value ops-mono">
                    {scheduler.jobId}
                  </div>
                </div>
                <div>
                  <div className="ops-detail-label">Cron</div>
                  <div className="ops-detail-value ops-mono">
                    {scheduler.cron}
                  </div>
                </div>
                <div>
                  <div className="ops-detail-label">Timezone</div>
                  <div className="ops-detail-value">{scheduler.timezone}</div>
                </div>
                <div>
                  <div className="ops-detail-label">Fila</div>
                  <div className="ops-detail-value ops-mono">
                    {scheduler.queue}
                  </div>
                </div>
                <div>
                  <div className="ops-detail-label">Proxima execucao</div>
                  <div className="ops-detail-value">
                    {formatDateTimeInTimezone(
                      scheduler.nextRunAt,
                      scheduler.timezone,
                      '—',
                      'medium',
                    )}
                  </div>
                </div>
              </div>
            </OpsSection>
            <OpsSection
              title="Guardrails"
              meta="Valores lidos do status oficial."
            >
              <div className="ops-health-list">
                <div className="ops-health-row">
                  <span className="ops-health-name">
                    <ShieldCheck
                      size={14}
                      className="mr-2 inline"
                      aria-hidden="true"
                    />
                    Pausa persistida
                  </span>
                  <OpsBadge tone={status.paused ? 'warning' : 'success'}>
                    {status.paused ? 'ATIVA' : 'NAO PAUSADA'}
                  </OpsBadge>
                </div>
                <div className="ops-health-row">
                  <span className="ops-health-name">Grupo autorizado</span>
                  <span className="ops-mono">
                    {status.authorizedGroupCount}
                  </span>
                </div>
                <div className="ops-health-row">
                  <span className="ops-health-name">
                    Limite global restante
                  </span>
                  <span className="ops-mono">
                    {status.globalRemainingToday}
                  </span>
                </div>
                <div className="ops-health-row">
                  <span className="ops-health-name">
                    Limite do grupo restante
                  </span>
                  <span className="ops-mono">
                    {status.groupRemainingToday ?? '—'}
                  </span>
                </div>
                <div className="ops-health-row">
                  <span className="ops-health-name">Ultimo envio</span>
                  <span className="ops-mono">
                    {formatDateTimeInTimezone(
                      status.lastSentAt,
                      status.timezone,
                      '—',
                      'medium',
                    )}
                  </span>
                </div>
              </div>
            </OpsSection>
          </div>
          {schedule ? (
            <OpsSection
              title="Agenda comercial"
              meta={`Overrides persistidos · revisao ${schedule.scheduleRevision} · ${schedule.timezone}`}
            >
              <div className="ops-health-list mb-4">
                <div className="ops-health-row">
                  <span className="ops-health-name">Proximo slot</span>
                  <span className="ops-mono">
                    {schedulePreview?.nextSlot
                      ? `${formatDateTimeInTimezone(schedulePreview.nextSlot.scheduledFor, schedule.timezone, '—', 'medium')} · ${schedulePreview.nextSlot.instanceName} · ${schedulePreview.nextSlot.campaignId}/${schedulePreview.nextSlot.groupId}`
                      : 'Nenhum slot elegivel'}
                  </span>
                </div>
                <div className="ops-health-row">
                  <span className="ops-health-name">Slots planejados</span>
                  <span className="ops-mono">
                    {schedulePreview?.plannedSlots ?? '—'}
                  </span>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-4">
                <label className="ops-control">
                  <span className="ops-control-label">Inicio da janela</span>
                  <input
                    className="ops-input"
                    type="time"
                    value={scheduleDraft.start}
                    onChange={(event) =>
                      setScheduleDraft((current) => ({
                        ...current,
                        start: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="ops-control">
                  <span className="ops-control-label">Fim da janela</span>
                  <input
                    className="ops-input"
                    type="time"
                    value={scheduleDraft.end}
                    onChange={(event) =>
                      setScheduleDraft((current) => ({
                        ...current,
                        end: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="ops-control">
                  <span className="ops-control-label">
                    Intervalo mínimo (min)
                  </span>
                  <input
                    className="ops-input"
                    type="number"
                    min="1"
                    max="1440"
                    value={scheduleDraft.minimum}
                    onChange={(event) =>
                      setScheduleDraft((current) => ({
                        ...current,
                        minimum: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="ops-control">
                  <span className="ops-control-label">
                    Stagger entre grupos (min)
                  </span>
                  <input
                    className="ops-input"
                    type="number"
                    min="0"
                    max="1440"
                    value={scheduleDraft.stagger}
                    onChange={(event) =>
                      setScheduleDraft((current) => ({
                        ...current,
                        stagger: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="ops-control">
                  <span className="ops-control-label">Limite global</span>
                  <input
                    className="ops-input"
                    type="number"
                    min="1"
                    value={scheduleDraft.globalLimit}
                    onChange={(event) =>
                      setScheduleDraft((current) => ({
                        ...current,
                        globalLimit: event.target.value,
                      }))
                    }
                  />
                  <span className="ops-control-sub">
                    Teto efetivo:{' '}
                    {operational?.automation.hardCaps.dailyGlobalLimit ??
                      status.dailyGlobalLimit}
                  </span>
                </label>
                <label className="ops-control">
                  <span className="ops-control-label">Limite por grupo</span>
                  <input
                    className="ops-input"
                    type="number"
                    min="1"
                    value={scheduleDraft.groupLimit}
                    onChange={(event) =>
                      setScheduleDraft((current) => ({
                        ...current,
                        groupLimit: event.target.value,
                      }))
                    }
                  />
                  <span className="ops-control-sub">
                    Teto efetivo:{' '}
                    {operational?.automation.hardCaps.dailyGroupLimit ??
                      status.dailyGroupLimit}
                  </span>
                </label>
                <label className="ops-control">
                  <span className="ops-control-label">
                    Limite diário Shopee
                  </span>
                  <input
                    className="ops-input"
                    type="number"
                    min="1"
                    value={scheduleDraft.shopeeLimit}
                    onChange={(event) =>
                      setScheduleDraft((current) => ({
                        ...current,
                        shopeeLimit: event.target.value,
                      }))
                    }
                  />
                  <span className="ops-control-sub">
                    Tentativas HTTP, inclusive falhas.
                  </span>
                </label>
                <label className="ops-control">
                  <span className="ops-control-label">
                    Limite diário OpenAI
                  </span>
                  <input
                    className="ops-input"
                    type="number"
                    min="1"
                    value={scheduleDraft.openAiLimit}
                    onChange={(event) =>
                      setScheduleDraft((current) => ({
                        ...current,
                        openAiLimit: event.target.value,
                      }))
                    }
                  />
                  <span className="ops-control-sub">
                    Gerações, inclusive saídas inválidas.
                  </span>
                </label>
              </div>
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  className="ops-button"
                  data-variant="primary"
                  onClick={() => void applySchedule()}
                  disabled={scheduleBusy}
                >
                  <Save size={14} aria-hidden="true" />{' '}
                  {scheduleBusy ? 'Salvando...' : 'Salvar agenda'}
                </button>
              </div>
            </OpsSection>
          ) : null}
          <OpsSection
            title="Acoes de controle"
            meta="Ligar, desligar e atualizar a agenda persistida; sem edição de .env ou cron."
          >
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="ops-button"
                data-variant="danger"
                onClick={() => setAction('pause')}
                disabled={status.paused}
              >
                <Pause size={14} aria-hidden="true" /> Desligar automação
              </button>
              <button
                type="button"
                className="ops-button"
                data-variant="primary"
                onClick={() => setAction('resume')}
                disabled={!status.paused}
              >
                <Play size={14} aria-hidden="true" /> Ligar automação
              </button>
            </div>
          </OpsSection>
        </>
      ) : null}
      {action ? (
        <ConfirmationModal
          action={action}
          busy={actionBusy}
          onCancel={() => setAction(null)}
          onConfirm={() => void applyAction()}
        />
      ) : null}
    </>
  );
}
