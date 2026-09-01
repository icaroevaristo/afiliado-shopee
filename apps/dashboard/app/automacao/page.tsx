'use client';

import { Pause, Play, Save, X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import {
  DashboardApiError,
  getCommercialAutomationSchedulePreview,
  getCommercialAutomationScheduleSettings,
  getCommercialAutomationSchedulerStatus,
  getCommercialAutomationStatus,
  getOperationalAdmin,
  pauseCommercialAutomation,
  resumeCommercialAutomation,
  updateOperationalAutomation,
  type CommercialAutomationSchedulePreview,
  type CommercialAutomationScheduleSettings,
  type CommercialAutomationSchedulerStatus,
  type CommercialAutomationStatus,
  type OperationalAdmin,
} from '../../lib/api';
import { commercialAutomationReasonLabels } from '../../lib/commercial-automation-display';
import {
  OpsBadge,
  OpsLoading,
  OpsPageHeading,
  OpsSection,
  OpsState,
  RefreshButton,
} from '../../components/ops-components';
import { formatDateTimeInTimezone } from '../../lib/format';

const RESUME_CONFIRMATION = 'RETOMAR_AUTOMACAO_COMERCIAL';
const SAVE_CONFIRMATION = 'CONFIRMAR_ALTERACAO_OPERACIONAL';
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MAX_MINUTES = 1_440;
const MAX_LIMIT = 1_000_000;

type AutomationAction = 'pause' | 'resume' | 'save';

type ScheduleDraft = {
  start: string;
  end: string;
  minimum: string;
  stagger: string;
  globalLimit: string;
  groupLimit: string;
  shopeeLimit: string;
  openAiLimit: string;
};

type SaveIntent = {
  allowedStartTime: string;
  allowedEndTime: string;
  minimumIntervalMinutes: number;
  staggerMinutes: number;
  dailyGlobalLimit: number;
  dailyGroupLimit: number;
  dailyShopeeHttpLimit: number;
  dailyOpenAiGenerationLimit: number;
  expectedRevision: number;
  confirmation: string;
};

type ReadErrors = {
  status: boolean;
  scheduler: boolean;
  schedule: boolean;
  preview: boolean;
  operational: boolean;
};

type LoadResult = {
  coreDataAvailable: boolean;
  allReadsSucceeded: boolean;
};

const EMPTY_READ_ERRORS: ReadErrors = {
  status: false,
  scheduler: false,
  schedule: false,
  preview: false,
  operational: false,
};

const emptyDraft = (): ScheduleDraft => ({
  start: '',
  end: '',
  minimum: '',
  stagger: '',
  globalLimit: '',
  groupLimit: '',
  shopeeLimit: '',
  openAiLimit: '',
});

const isDashboardApiError = (cause: unknown): cause is DashboardApiError =>
  typeof DashboardApiError === 'function' && cause instanceof DashboardApiError;

const automationErrorMessage = (
  cause: unknown,
  context: 'toggle' | 'resume' | 'save' | 'load',
) => {
  if (isDashboardApiError(cause)) {
    if (
      cause.status === 409 ||
      cause.code === 'OPERATIONAL_CAS_CONFLICT' ||
      cause.code === 'COMMERCIAL_AUTOMATION_SCHEDULE_REVISION_CONFLICT'
    ) {
      return context === 'resume'
        ? 'A configuração mudou em outro lugar. Atualize os dados antes de ligar a automação.'
        : context === 'save'
          ? 'A configuração mudou em outro lugar. Atualize os dados antes de salvar novamente.'
          : 'A configuração mudou em outro lugar. Atualize os dados antes de tentar novamente.';
    }
    if (cause.code?.includes('CONFIRMATION')) {
      return 'Confirme a ação para continuar.';
    }
    if (cause.code?.includes('INVALID')) {
      return 'Confira os valores informados e tente novamente.';
    }
  }

  return context === 'load'
    ? 'Não foi possível consultar a automação. Atualize os dados e tente novamente.'
    : context === 'resume'
      ? 'Não foi possível ligar a automação. Atualize os dados e tente novamente.'
      : context === 'save'
        ? 'Não foi possível salvar a configuração. Confira os valores e tente novamente.'
        : 'Não foi possível alterar o estado da automação. Tente novamente.';
};

const formatUsage = (
  usage: { used: number; limit: number } | null | undefined,
) => {
  if (!usage || !Number.isFinite(usage.used) || !Number.isFinite(usage.limit)) {
    return 'Não disponível';
  }
  return `${usage.used} de ${usage.limit}`;
};

const friendlyReason = (code: string) =>
  commercialAutomationReasonLabels[
    code as keyof typeof commercialAutomationReasonLabels
  ] ?? 'Há uma ocorrência que precisa de investigação.';

const readBlockerMessages = (
  status: CommercialAutomationStatus | null,
  operational: OperationalAdmin | null,
) => {
  const codes = [
    ...(status?.reasons ?? []),
    ...(operational?.blockers ?? []).map((blocker) => blocker.code),
  ].filter((code) => code !== 'AUTOMATION_PAUSED');

  return [...new Set(codes)].map((code) => ({
    code,
    message: friendlyReason(code),
  }));
};

const buildDraft = (
  schedule: CommercialAutomationScheduleSettings,
  operational: OperationalAdmin | null,
): ScheduleDraft => ({
  start: schedule.allowedStartTime,
  end: schedule.allowedEndTime,
  minimum: String(schedule.minimumIntervalMinutes),
  stagger: String(schedule.staggerMinutes),
  globalLimit: operational
    ? String(
        operational.automation.dailyGlobalLimitOverride ??
          operational.automation.dailyGlobalLimit,
      )
    : '',
  groupLimit: operational
    ? String(
        operational.automation.dailyGroupLimitOverride ??
          operational.automation.dailyGroupLimit,
      )
    : '',
  shopeeLimit: operational
    ? String(
        operational.automation.dailyShopeeHttpLimitOverride ??
          operational.automation.dailyShopeeHttpLimit,
      )
    : '',
  openAiLimit: operational
    ? String(
        operational.automation.dailyOpenAiGenerationLimitOverride ??
          operational.automation.dailyOpenAiGenerationLimit,
      )
    : '',
});

const parseDraftInteger = (value: string) => {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
};

const validateDraft = (draft: ScheduleDraft) => {
  if (!TIME_PATTERN.test(draft.start) || !TIME_PATTERN.test(draft.end)) {
    return 'Informe horários válidos para o início e o fim da janela.';
  }
  if (draft.start === draft.end) {
    return 'O início e o fim da janela precisam ser diferentes.';
  }

  const minimum = parseDraftInteger(draft.minimum);
  if (minimum === null || minimum < 1 || minimum > MAX_MINUTES) {
    return 'O intervalo entre envios deve estar entre 1 e 1.440 minutos.';
  }

  const stagger = parseDraftInteger(draft.stagger);
  if (stagger === null || stagger < 0 || stagger > MAX_MINUTES) {
    return 'O intervalo entre grupos deve estar entre 0 e 1.440 minutos.';
  }

  const limits = [
    ['diário total', parseDraftInteger(draft.globalLimit)],
    ['diário por grupo', parseDraftInteger(draft.groupLimit)],
    ['de consultas Shopee', parseDraftInteger(draft.shopeeLimit)],
    ['de gerações OpenAI', parseDraftInteger(draft.openAiLimit)],
  ] as const;
  for (const [label, value] of limits) {
    if (value === null || value < 1 || value > MAX_LIMIT) {
      return `O limite ${label} deve estar entre 1 e 1.000.000.`;
    }
  }

  return null;
};

const actionCopy: Record<
  AutomationAction,
  { title: string; description: string; confirm: string; variant?: 'danger' }
> = {
  pause: {
    title: 'Desligar a automação?',
    description:
      'Novos envios automáticos não serão iniciados enquanto ela estiver desligada.',
    confirm: 'Desligar automação',
    variant: 'danger',
  },
  resume: {
    title: 'Ligar a automação?',
    description:
      'Novos envios poderão ocorrer conforme horários, limites e demais regras.',
    confirm: 'Ligar automação',
  },
  save: {
    title: 'Salvar esta configuração?',
    description:
      'As novas regras de horário, intervalo e limites serão usadas pela automação.',
    confirm: 'Salvar alterações',
  },
};

function ConfirmationModal({
  action,
  busy,
  onCancel,
  onConfirm,
}: {
  action: AutomationAction;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const copy = actionCopy[action];
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const busyRef = useRef(busy);
  const onCancelRef = useRef(onCancel);
  busyRef.current = busy;
  onCancelRef.current = onCancel;

  useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    cancelRef.current?.focus();
    return () => {
      previousFocusRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    if (busy) dialogRef.current?.focus();
  }, [busy]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && !busyRef.current) {
      event.preventDefault();
      onCancelRef.current();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable || focusable.length === 0) {
      event.preventDefault();
      dialogRef.current?.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="ops-modal-backdrop" role="presentation">
      <div
        ref={dialogRef}
        className="ops-modal"
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby="automation-confirm-title"
        aria-describedby="automation-confirm-description"
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="ops-eyebrow">Confirmação</p>
            <h2 id="automation-confirm-title" className="ops-section-title">
              {copy.title}
            </h2>
          </div>
          <button
            type="button"
            className="ops-icon-button"
            aria-label="Fechar confirmação"
            onClick={onCancel}
            disabled={busy}
          >
            <X size={17} aria-hidden="true" />
          </button>
        </div>
        <p
          id="automation-confirm-description"
          className="ops-section-meta mt-3"
        >
          {copy.description}
        </p>
        <div className="ops-modal-actions">
          <button
            ref={cancelRef}
            type="button"
            className="ops-button min-h-11"
            onClick={onCancel}
            disabled={busy}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="ops-button min-h-11"
            data-variant={copy.variant ?? 'primary'}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Salvando...' : copy.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}

function UsageCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="ops-control">
      <div className="ops-control-label">{label}</div>
      <div className="ops-control-value">{value}</div>
      <div className="ops-control-sub">{detail}</div>
    </div>
  );
}

function FieldHelp({ id, children }: { id: string; children: string }) {
  return (
    <span id={id} className="ops-control-sub block">
      {children}
    </span>
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
  const [operational, setOperational] = useState<OperationalAdmin | null>(null);
  const [scheduleDraft, setScheduleDraft] = useState<ScheduleDraft>(emptyDraft);
  const [draftDirty, setDraftDirty] = useState(false);
  const [readErrors, setReadErrors] = useState<ReadErrors>(EMPTY_READ_ERRORS);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [action, setAction] = useState<AutomationAction | null>(null);
  const [writeBusy, setWriteBusy] = useState(false);
  const actionRef = useRef<AutomationAction | null>(null);
  const writeInFlight = useRef(false);
  const toggleIntentRef = useRef<{
    action: 'pause' | 'resume';
    expectedUpdatedAt: string;
  } | null>(null);
  const saveIntentRef = useRef<SaveIntent | null>(null);
  const requestInFlight = useRef(false);
  const statusRef = useRef<CommercialAutomationStatus | null>(null);
  const scheduleRef = useRef<CommercialAutomationScheduleSettings | null>(null);
  const operationalRef = useRef<OperationalAdmin | null>(null);
  const draftDirtyRef = useRef(false);
  const draftBaseRevisionRef = useRef<number | null>(null);
  actionRef.current = action;

  const load = useCallback(
    async ({
      initial = false,
      preserveFeedback = false,
    }: {
      initial?: boolean;
      preserveFeedback?: boolean;
    } = {}): Promise<LoadResult> => {
      if (requestInFlight.current) {
        return {
          coreDataAvailable: Boolean(
            statusRef.current || scheduleRef.current || operationalRef.current,
          ),
          allReadsSucceeded: false,
        };
      }

      requestInFlight.current = true;
      if (initial) setLoading(true);
      else setRefreshing(true);
      if (!preserveFeedback) {
        setPageError(null);
        setSuccess(null);
        setFormError(null);
      }

      const results = await Promise.allSettled([
        getCommercialAutomationStatus(),
        getCommercialAutomationSchedulerStatus(),
        getCommercialAutomationScheduleSettings(),
        getCommercialAutomationSchedulePreview(),
        getOperationalAdmin(),
      ]);

      const [
        statusResult,
        schedulerResult,
        scheduleResult,
        previewResult,
        operationalResult,
      ] = results;

      const nextErrors: ReadErrors = {
        status: statusResult.status === 'rejected',
        scheduler: schedulerResult.status === 'rejected',
        schedule: scheduleResult.status === 'rejected',
        preview: previewResult.status === 'rejected',
        operational: operationalResult.status === 'rejected',
      };
      setReadErrors(nextErrors);

      if (statusResult.status === 'fulfilled') {
        statusRef.current = statusResult.value;
        setStatus(statusResult.value);
      } else {
        statusRef.current = null;
        setStatus(null);
        if (actionRef.current === 'pause' || actionRef.current === 'resume') {
          toggleIntentRef.current = null;
          setAction(null);
        }
      }
      if (schedulerResult.status === 'fulfilled') {
        setScheduler(schedulerResult.value);
      }
      if (scheduleResult.status === 'fulfilled') {
        scheduleRef.current = scheduleResult.value;
        setSchedule(scheduleResult.value);
      }
      if (previewResult.status === 'fulfilled') {
        setSchedulePreview(previewResult.value);
      } else {
        setSchedulePreview(null);
      }
      if (operationalResult.status === 'fulfilled') {
        operationalRef.current = operationalResult.value;
        setOperational(operationalResult.value);
      }

      const currentSchedule =
        scheduleResult.status === 'fulfilled'
          ? scheduleResult.value
          : scheduleRef.current;
      const currentOperational =
        operationalResult.status === 'fulfilled'
          ? operationalResult.value
          : operationalRef.current;
      if (
        scheduleResult.status === 'fulfilled' ||
        operationalResult.status === 'fulfilled'
      ) {
        const revisionsMatch = Boolean(
          currentSchedule &&
          currentOperational &&
          currentSchedule.scheduleRevision ===
            currentOperational.automation.scheduleRevision,
        );
        if (
          revisionsMatch &&
          currentSchedule &&
          !draftDirtyRef.current &&
          actionRef.current !== 'save'
        ) {
          setScheduleDraft(buildDraft(currentSchedule, currentOperational));
        } else if (
          !revisionsMatch &&
          !draftDirtyRef.current &&
          actionRef.current !== 'save'
        ) {
          setScheduleDraft(emptyDraft());
        }
      }

      const coreDataAvailable = Boolean(
        statusRef.current || scheduleRef.current || operationalRef.current,
      );
      const allReadsSucceeded = Object.values(nextErrors).every(
        (failed) => !failed,
      );

      if (!coreDataAvailable) {
        if (preserveFeedback) {
          setSuccess(
            'Alteração salva, mas não foi possível atualizar os dados exibidos.',
          );
        } else {
          setPageError(automationErrorMessage(new Error(), 'load'));
        }
      } else {
        setPageError(null);
      }

      requestInFlight.current = false;
      setLoading(false);
      setRefreshing(false);
      return { coreDataAvailable, allReadsSucceeded };
    },
    [],
  );

  useEffect(() => {
    void load({ initial: true });

    let timer: number | undefined;
    const clearTimer = () => {
      if (timer !== undefined) {
        window.clearInterval(timer);
        timer = undefined;
      }
    };
    const startPolling = () => {
      clearTimer();
      if (document.visibilityState !== 'visible') return;
      timer = window.setInterval(() => {
        if (document.visibilityState === 'visible') void load();
      }, 30_000);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        startPolling();
        void load();
      } else {
        clearTimer();
      }
    };

    startPolling();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      clearTimer();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [load]);

  const automationIsOn = status ? status.enabled && !status.paused : null;
  const timezone =
    operational?.automation.timezone ?? schedule?.timezone ?? status?.timezone;
  const currentSchedulePreview =
    schedule &&
    schedulePreview &&
    schedulePreview.scheduleRevision === schedule.scheduleRevision
      ? schedulePreview
      : null;
  const nextSendAt =
    operational?.nextSendAt ??
    currentSchedulePreview?.nextSlot?.scheduledFor ??
    null;
  const blockerMessages = readBlockerMessages(status, operational);
  const blockerCodes = [
    ...(status?.reasons ?? []),
    ...(operational?.blockers ?? []).map((blocker) => blocker.code),
  ].filter((code, index, codes) => codes.indexOf(code) === index);
  const hasPartialReadFailure = Object.values(readErrors).some(Boolean);
  const configurationReadMismatch = Boolean(
    schedule &&
    operational &&
    schedule.scheduleRevision !== operational.automation.scheduleRevision,
  );
  const draftRevisionConflict = Boolean(
    draftDirty &&
    draftBaseRevisionRef.current !== null &&
    schedule &&
    schedule.scheduleRevision !== draftBaseRevisionRef.current,
  );
  const draftNeedsReconciliation =
    draftRevisionConflict || configurationReadMismatch;
  const canSave = Boolean(
    schedule &&
    operational &&
    !writeBusy &&
    !action &&
    !configurationReadMismatch &&
    !draftRevisionConflict &&
    !readErrors.schedule &&
    !readErrors.operational,
  );

  const requestToggle = () => {
    if (!status || !status.enabled) return;
    setPageError(null);
    setSuccess(null);
    const nextAction = status.paused ? 'resume' : 'pause';
    toggleIntentRef.current = {
      action: nextAction,
      expectedUpdatedAt: status.updatedAt,
    };
    setAction(nextAction);
  };

  const applyToggle = async () => {
    const intent = toggleIntentRef.current;
    if (
      writeInFlight.current ||
      writeBusy ||
      !action ||
      action === 'save' ||
      !intent ||
      intent.action !== action
    )
      return;
    const currentAction = intent.action;
    writeInFlight.current = true;
    setWriteBusy(true);
    setPageError(null);
    setSuccess(null);
    try {
      const next =
        currentAction === 'pause'
          ? await pauseCommercialAutomation()
          : await resumeCommercialAutomation(
              RESUME_CONFIRMATION,
              intent.expectedUpdatedAt,
            );
      statusRef.current = next;
      setStatus(next);
      setOperational((current) =>
        current
          ? {
              ...current,
              automation: { ...current.automation, paused: next.paused },
            }
          : current,
      );
      operationalRef.current = operationalRef.current
        ? {
            ...operationalRef.current,
            automation: {
              ...operationalRef.current.automation,
              paused: next.paused,
            },
          }
        : null;
      toggleIntentRef.current = null;
      setAction(null);
      setSuccess(
        currentAction === 'pause'
          ? 'Automação desligada.'
          : 'Automação ligada. Os próximos envios seguirão as regras configuradas.',
      );
    } catch (cause) {
      toggleIntentRef.current = null;
      setAction(null);
      setPageError(
        automationErrorMessage(
          cause,
          currentAction === 'resume' ? 'resume' : 'toggle',
        ),
      );
    } finally {
      writeInFlight.current = false;
      setWriteBusy(false);
    }
  };

  const requestSave = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (draftRevisionConflict) {
      setFormError(
        'A configuração mudou desde que você começou a editar. Descarte as alterações locais e confirme novamente.',
      );
      return;
    }
    if (!canSave || !schedule) {
      setFormError('Atualize os dados antes de salvar esta configuração.');
      return;
    }
    const currentSchedule = schedule;
    const validationError = validateDraft(scheduleDraft);
    if (validationError) {
      setFormError(validationError);
      return;
    }
    setFormError(null);
    setPageError(null);
    setSuccess(null);
    saveIntentRef.current = {
      allowedStartTime: scheduleDraft.start,
      allowedEndTime: scheduleDraft.end,
      minimumIntervalMinutes: Number(scheduleDraft.minimum),
      staggerMinutes: Number(scheduleDraft.stagger),
      dailyGlobalLimit: Number(scheduleDraft.globalLimit),
      dailyGroupLimit: Number(scheduleDraft.groupLimit),
      dailyShopeeHttpLimit: Number(scheduleDraft.shopeeLimit),
      dailyOpenAiGenerationLimit: Number(scheduleDraft.openAiLimit),
      expectedRevision:
        draftBaseRevisionRef.current ?? currentSchedule.scheduleRevision,
      confirmation: SAVE_CONFIRMATION,
    };
    setAction('save');
  };

  const applySave = async () => {
    const intent = saveIntentRef.current;
    if (writeInFlight.current || writeBusy || action !== 'save' || !intent)
      return;
    writeInFlight.current = true;
    setWriteBusy(true);
    setPageError(null);
    setSuccess(null);
    try {
      const next = await updateOperationalAutomation(intent);
      const nextOperational = operationalRef.current
        ? {
            ...operationalRef.current,
            automation: {
              ...operationalRef.current.automation,
              allowedStartTime: intent.allowedStartTime,
              allowedEndTime: intent.allowedEndTime,
              minimumIntervalMinutes: intent.minimumIntervalMinutes,
              staggerMinutes: intent.staggerMinutes,
              dailyGlobalLimit: intent.dailyGlobalLimit,
              dailyGroupLimit: intent.dailyGroupLimit,
              dailyGlobalLimitOverride: intent.dailyGlobalLimit,
              dailyGroupLimitOverride: intent.dailyGroupLimit,
              dailyShopeeHttpLimit: intent.dailyShopeeHttpLimit,
              dailyOpenAiGenerationLimit: intent.dailyOpenAiGenerationLimit,
              dailyShopeeHttpLimitOverride: intent.dailyShopeeHttpLimit,
              dailyOpenAiGenerationLimitOverride:
                intent.dailyOpenAiGenerationLimit,
              providerUsage: {
                ...operationalRef.current.automation.providerUsage,
                shopee: {
                  ...operationalRef.current.automation.providerUsage.shopee,
                  limit: intent.dailyShopeeHttpLimit,
                  reached:
                    operationalRef.current.automation.providerUsage.shopee
                      .used >= intent.dailyShopeeHttpLimit,
                },
                openAi: {
                  ...operationalRef.current.automation.providerUsage.openAi,
                  limit: intent.dailyOpenAiGenerationLimit,
                  reached:
                    operationalRef.current.automation.providerUsage.openAi
                      .used >= intent.dailyOpenAiGenerationLimit,
                },
              },
              scheduleRevision: next.scheduleRevision,
              updatedAt: new Date().toISOString(),
            },
          }
        : null;
      scheduleRef.current = next;
      setSchedule(next);
      draftDirtyRef.current = false;
      draftBaseRevisionRef.current = null;
      setDraftDirty(false);
      if (nextOperational) {
        operationalRef.current = nextOperational;
        setOperational(nextOperational);
      }
      setScheduleDraft(buildDraft(next, nextOperational));
      saveIntentRef.current = null;
      setAction(null);
      const refreshed = await load({ preserveFeedback: true });
      setSuccess(
        refreshed.allReadsSucceeded
          ? 'Alterações salvas.'
          : 'Alteração salva, mas não foi possível atualizar os dados exibidos.',
      );
    } catch (cause) {
      saveIntentRef.current = null;
      setAction(null);
      setPageError(automationErrorMessage(cause, 'save'));
    } finally {
      writeInFlight.current = false;
      setWriteBusy(false);
    }
  };

  const applyAction = () => {
    if (action === 'save') void applySave();
    else void applyToggle();
  };

  const updateDraft = (field: keyof ScheduleDraft, value: string) => {
    setFormError(null);
    if (!draftDirtyRef.current) {
      draftBaseRevisionRef.current =
        scheduleRef.current?.scheduleRevision ??
        schedule?.scheduleRevision ??
        null;
    }
    draftDirtyRef.current = true;
    setDraftDirty(true);
    setScheduleDraft((current) => ({ ...current, [field]: value }));
  };

  const discardDraft = () => {
    if (writeBusy) return;
    const currentSchedule = scheduleRef.current;
    const currentOperational = operationalRef.current;
    if (!currentSchedule || !currentOperational) return;
    draftDirtyRef.current = false;
    draftBaseRevisionRef.current = null;
    setDraftDirty(false);
    setFormError(null);
    if (
      currentSchedule.scheduleRevision !==
      currentOperational.automation.scheduleRevision
    ) {
      setScheduleDraft(emptyDraft());
      setFormError(
        'Atualize os dados para confirmar uma única versão da configuração.',
      );
      return;
    }
    setScheduleDraft(buildDraft(currentSchedule, currentOperational));
  };

  const dismissAction = () => {
    if (writeBusy || writeInFlight.current) return;
    toggleIntentRef.current = null;
    saveIntentRef.current = null;
    setAction(null);
  };

  return (
    <>
      <OpsPageHeading
        eyebrow="Operação diária"
        title="Automação"
        description="Configure quando e com que frequência as ofertas serão enviadas."
        actions={
          <RefreshButton onClick={() => void load()} busy={refreshing} />
        }
      />

      {loading ? <OpsLoading label="Carregando a automação" /> : null}

      {pageError ? (
        <OpsState
          title="Automação indisponível"
          message={pageError}
          tone="danger"
          action={
            <button
              type="button"
              className="ops-button min-h-11"
              onClick={() => void load()}
              disabled={refreshing}
            >
              Atualizar dados
            </button>
          }
        />
      ) : null}

      {success ? (
        <div aria-live="polite">
          <OpsState
            title="Atualização concluída"
            message={success}
            tone="success"
          />
        </div>
      ) : null}

      {hasPartialReadFailure && !pageError ? (
        <OpsState
          title="Alguns dados estão indisponíveis"
          message="A última leitura não trouxe todas as informações. Os dados disponíveis continuam sinalizados; atualize quando quiser tentar novamente."
          tone="warning"
        />
      ) : null}

      <section
        className="mb-5 flex min-w-0 flex-col gap-5 rounded-lg border border-slate-300 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-6"
        aria-live="polite"
        aria-label="Estado da automação"
      >
        <div className="min-w-0">
          <p className="ops-eyebrow">Automação</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">
            {automationIsOn === null
              ? 'ESTADO INDISPONÍVEL'
              : automationIsOn
                ? 'AUTOMAÇÃO LIGADA'
                : 'AUTOMAÇÃO DESLIGADA'}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            {status === null
              ? 'Atualize os dados para consultar o estado atual e as ações disponíveis.'
              : !status.enabled
                ? 'A automação está desativada pelo ambiente e não iniciará novos trabalhos.'
                : status.paused
                  ? 'Novos envios automáticos permanecem parados até você ligar a automação.'
                  : 'A automação pode trabalhar conforme o horário, os limites e as demais regras configuradas.'}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-3 sm:items-end">
          <OpsBadge
            tone={
              automationIsOn === null
                ? 'neutral'
                : automationIsOn
                  ? 'success'
                  : 'warning'
            }
          >
            {automationIsOn === null
              ? 'INDISPONÍVEL'
              : automationIsOn
                ? 'LIGADA'
                : 'DESLIGADA'}
          </OpsBadge>
          {status?.enabled ? (
            <button
              type="button"
              className="ops-button min-h-11"
              data-variant={status.paused ? 'primary' : 'danger'}
              onClick={requestToggle}
              disabled={writeBusy}
            >
              {status.paused ? (
                <Play size={15} aria-hidden="true" />
              ) : (
                <Pause size={15} aria-hidden="true" />
              )}
              {status.paused ? 'Ligar automação' : 'Desligar automação'}
            </button>
          ) : null}
        </div>
      </section>

      <div className="mb-5 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <OpsSection title="Resumo de hoje" meta="O que está acontecendo agora.">
          <div className="ops-control-grid">
            <UsageCard
              label="Envios hoje"
              value={
                status
                  ? `${status.globalSentToday} de ${status.dailyGlobalLimit}`
                  : 'Não disponível'
              }
              detail={
                status
                  ? `${status.globalRemainingToday} restante(s)`
                  : 'A leitura da automação não está disponível.'
              }
            />
            <UsageCard
              label="Próximo envio"
              value={
                nextSendAt && timezone
                  ? formatDateTimeInTimezone(
                      nextSendAt,
                      timezone,
                      'Não disponível',
                      'medium',
                    )
                  : 'Não disponível'
              }
              detail={
                timezone === 'America/Sao_Paulo'
                  ? 'Horário de Brasília'
                  : timezone
                    ? `Fuso horário: ${timezone}`
                    : 'O horário ainda não foi informado.'
              }
            />
            <UsageCard
              label="Limite por grupo"
              value={
                status && status.groupSentToday !== null
                  ? `${status.groupSentToday} de ${status.dailyGroupLimit}`
                  : 'Não disponível'
              }
              detail={
                status?.groupRemainingToday !== null &&
                status?.groupRemainingToday !== undefined
                  ? `${status.groupRemainingToday} restante(s)`
                  : 'Nenhum grupo foi selecionado para esta leitura.'
              }
            />
            <UsageCard
              label="Último envio"
              value={
                status && timezone
                  ? formatDateTimeInTimezone(
                      status.lastSentAt,
                      timezone,
                      'Não disponível',
                      'medium',
                    )
                  : 'Não disponível'
              }
              detail="Registro mais recente retornado pelo sistema."
            />
          </div>
        </OpsSection>

        <OpsSection
          title="Uso de serviços hoje"
          meta="Esses limites protegem seus custos."
        >
          <div className="ops-control-grid">
            <UsageCard
              label="Shopee"
              value={formatUsage(operational?.automation.providerUsage?.shopee)}
              detail="Consultas Shopee por dia"
            />
            <UsageCard
              label="OpenAI"
              value={formatUsage(operational?.automation.providerUsage?.openAi)}
              detail="Gerações OpenAI por dia"
            />
          </div>
        </OpsSection>
      </div>

      <OpsSection
        title="Configuração de envio"
        meta="Horários, intervalos e limites usados pela automação."
        className="mb-5"
      >
        {schedule ? (
          <form onSubmit={requestSave} aria-busy={writeBusy}>
            {draftDirty ? (
              <div
                className="mb-4 flex flex-col gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between"
                role="status"
              >
                <p>
                  {draftNeedsReconciliation
                    ? 'A configuração mudou enquanto você editava. Descarte as alterações locais para continuar com os dados atuais.'
                    : 'Há alterações locais ainda não salvas nesta configuração.'}
                </p>
                {draftNeedsReconciliation ? (
                  <button
                    type="button"
                    className="ops-button min-h-11 shrink-0"
                    onClick={discardDraft}
                    disabled={writeBusy}
                  >
                    Descartar alterações
                  </button>
                ) : null}
              </div>
            ) : null}
            {!operational ? (
              <OpsState
                title="Limites temporariamente indisponíveis"
                message="Atualize os dados antes de salvar alterações nesta seção."
                tone="warning"
              />
            ) : null}
            {readErrors.schedule || readErrors.operational ? (
              <p className="mb-4 text-sm text-amber-800" role="status">
                Estes dados podem estar desatualizados. O salvamento fica
                bloqueado até uma leitura completa.
              </p>
            ) : null}
            {configurationReadMismatch ? (
              <p className="mb-4 text-sm text-amber-800" role="status">
                As regras retornaram versões diferentes. Atualize os dados antes
                de salvar para evitar substituir uma alteração recente.
              </p>
            ) : null}

            <fieldset className="grid gap-4 border-0 p-0">
              <legend className="text-base font-semibold text-slate-950">
                Horários de funcionamento
              </legend>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="ops-control">
                  <span className="ops-control-label">Começa às</span>
                  <input
                    id="automation-start-time"
                    className="ops-input mt-2 w-full"
                    type="time"
                    value={scheduleDraft.start}
                    onChange={(event) =>
                      updateDraft('start', event.target.value)
                    }
                    disabled={!canSave}
                    aria-describedby="automation-window-help"
                  />
                  <FieldHelp id="automation-window-help">
                    Início da janela em que a automação pode trabalhar.
                  </FieldHelp>
                </label>
                <label className="ops-control">
                  <span className="ops-control-label">Termina às</span>
                  <input
                    id="automation-end-time"
                    className="ops-input mt-2 w-full"
                    type="time"
                    value={scheduleDraft.end}
                    onChange={(event) => updateDraft('end', event.target.value)}
                    disabled={!canSave}
                    aria-describedby="automation-window-end-help"
                  />
                  <span
                    id="automation-window-end-help"
                    className="ops-control-sub block"
                  >
                    {timezone === 'America/Sao_Paulo'
                      ? 'Horário de Brasília.'
                      : timezone
                        ? `Fuso horário: ${timezone}.`
                        : 'Fuso horário não disponível.'}
                  </span>
                </label>
              </div>
            </fieldset>

            <fieldset className="mt-6 grid gap-4 border-0 p-0">
              <legend className="text-base font-semibold text-slate-950">
                Intervalos
              </legend>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="ops-control">
                  <span className="ops-control-label">
                    Intervalo entre envios
                  </span>
                  <input
                    id="automation-minimum-interval"
                    className="ops-input mt-2 w-full"
                    type="number"
                    min="1"
                    max={MAX_MINUTES}
                    value={scheduleDraft.minimum}
                    onChange={(event) =>
                      updateDraft('minimum', event.target.value)
                    }
                    disabled={!canSave}
                    aria-describedby="automation-minimum-help"
                  />
                  <FieldHelp id="automation-minimum-help">
                    Tempo mínimo antes de um novo envio automático, em minutos.
                  </FieldHelp>
                </label>
                <label className="ops-control">
                  <span className="ops-control-label">
                    Intervalo entre grupos
                  </span>
                  <input
                    id="automation-stagger"
                    className="ops-input mt-2 w-full"
                    type="number"
                    min="0"
                    max={MAX_MINUTES}
                    value={scheduleDraft.stagger}
                    onChange={(event) =>
                      updateDraft('stagger', event.target.value)
                    }
                    disabled={!canSave}
                    aria-describedby="automation-stagger-help"
                  />
                  <FieldHelp id="automation-stagger-help">
                    Espaçamento adicional para evitar mensagens ao mesmo tempo.
                  </FieldHelp>
                </label>
              </div>
            </fieldset>

            <fieldset className="mt-6 grid gap-4 border-0 p-0">
              <legend className="text-base font-semibold text-slate-950">
                Limites de envio
              </legend>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="ops-control">
                  <span className="ops-control-label">Limite diário total</span>
                  <input
                    id="automation-global-limit"
                    className="ops-input mt-2 w-full"
                    type="number"
                    min="1"
                    max={MAX_LIMIT}
                    value={scheduleDraft.globalLimit}
                    onChange={(event) =>
                      updateDraft('globalLimit', event.target.value)
                    }
                    disabled={!canSave}
                    aria-describedby="automation-message-limit-help"
                  />
                  <FieldHelp id="automation-message-limit-help">
                    Quantidade máxima de mensagens automáticas no dia.
                  </FieldHelp>
                </label>
                <label className="ops-control">
                  <span className="ops-control-label">
                    Limite diário por grupo
                  </span>
                  <input
                    id="automation-group-limit"
                    className="ops-input mt-2 w-full"
                    type="number"
                    min="1"
                    max={MAX_LIMIT}
                    value={scheduleDraft.groupLimit}
                    onChange={(event) =>
                      updateDraft('groupLimit', event.target.value)
                    }
                    disabled={!canSave}
                    aria-describedby="automation-group-limit-help"
                  />
                  <span
                    id="automation-group-limit-help"
                    className="ops-control-sub block"
                  >
                    Quantidade máxima para cada grupo no dia.
                  </span>
                </label>
              </div>
            </fieldset>

            <fieldset className="mt-6 grid gap-4 border-0 p-0">
              <legend className="text-base font-semibold text-slate-950">
                Uso de serviços
              </legend>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="ops-control">
                  <span className="ops-control-label">
                    Limite de consultas Shopee por dia
                  </span>
                  <input
                    id="automation-shopee-limit"
                    className="ops-input mt-2 w-full"
                    type="number"
                    min="1"
                    max={MAX_LIMIT}
                    value={scheduleDraft.shopeeLimit}
                    onChange={(event) =>
                      updateDraft('shopeeLimit', event.target.value)
                    }
                    disabled={!canSave}
                    aria-describedby="automation-shopee-help"
                  />
                  <FieldHelp id="automation-shopee-help">
                    Tentativas de consulta contam mesmo quando retornam erro.
                  </FieldHelp>
                </label>
                <label className="ops-control">
                  <span className="ops-control-label">
                    Limite de gerações OpenAI por dia
                  </span>
                  <input
                    id="automation-openai-limit"
                    className="ops-input mt-2 w-full"
                    type="number"
                    min="1"
                    max={MAX_LIMIT}
                    value={scheduleDraft.openAiLimit}
                    onChange={(event) =>
                      updateDraft('openAiLimit', event.target.value)
                    }
                    disabled={!canSave}
                    aria-describedby="automation-openai-help"
                  />
                  <FieldHelp id="automation-openai-help">
                    Gerações contam inclusive quando o texto é rejeitado.
                  </FieldHelp>
                </label>
              </div>
            </fieldset>

            {formError ? (
              <p className="mt-5 text-sm font-medium text-red-700" role="alert">
                {formError}
              </p>
            ) : null}
            <div className="mt-6 flex flex-col gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-slate-600">
                As alterações só entram depois da confirmação.
              </p>
              <button
                type="submit"
                className="ops-button min-h-11"
                data-variant="primary"
                disabled={!canSave}
              >
                <Save size={15} aria-hidden="true" />
                {writeBusy ? 'Salvando...' : 'Salvar alterações'}
              </button>
            </div>
          </form>
        ) : (
          <OpsState
            title="Configuração indisponível"
            message="Não foi possível carregar os horários e limites agora. Atualize os dados para tentar novamente."
            tone="warning"
          />
        )}
      </OpsSection>

      <div className="mb-5 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <OpsSection
          title="Próximos horários previstos"
          meta="Somente horários retornados pela configuração atual."
        >
          <div className="ops-control-grid">
            <UsageCard
              label="Próximo envio"
              value={
                currentSchedulePreview?.nextSlot && timezone
                  ? formatDateTimeInTimezone(
                      currentSchedulePreview.nextSlot.scheduledFor,
                      timezone,
                      'Não disponível',
                      'medium',
                    )
                  : 'Não disponível'
              }
              detail={
                currentSchedulePreview?.nextSlot
                  ? 'Horário previsto pela agenda atual.'
                  : readErrors.preview || schedulePreview
                    ? 'A previsão não está disponível.'
                    : 'Nenhum horário foi retornado.'
              }
            />
            <UsageCard
              label="Horários nesta consulta"
              value={
                typeof currentSchedulePreview?.plannedSlots === 'number'
                  ? String(currentSchedulePreview.plannedSlots)
                  : 'Não disponível'
              }
              detail={
                schedulePreview && !currentSchedulePreview
                  ? 'A previsão anterior não corresponde às regras atuais.'
                  : 'A quantidade não cria novos envios por si só.'
              }
            />
          </div>
        </OpsSection>

        <OpsSection
          title="Precisa da sua atenção"
          meta="Pendências que podem impedir um novo envio."
        >
          {status === null && operational === null ? (
            <p className="text-sm text-slate-600">Não disponível.</p>
          ) : blockerMessages.length > 0 ? (
            <ul className="grid gap-2" aria-label="Pendências da automação">
              {blockerMessages.map(({ code, message }) => (
                <li
                  key={code}
                  className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-950"
                >
                  {message}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-emerald-700">
              Nenhuma pendência informada no momento.
            </p>
          )}
        </OpsSection>
      </div>

      <details className="ops-section mb-5">
        <summary className="cursor-pointer list-none px-[18px] py-[17px] text-sm font-semibold text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ops-accent)]">
          Informações avançadas
        </summary>
        <div className="border-t border-[var(--ops-border)] p-[18px]">
          <p className="ops-section-meta">
            Dados técnicos para conferência. Eles não alteram a automação nesta
            tela.
          </p>
          <div className="ops-detail-grid">
            <div>
              <div className="ops-detail-label">Schedule revision</div>
              <div className="ops-detail-value ops-mono">
                {schedule?.scheduleRevision ?? 'Não disponível'}
              </div>
            </div>
            <div>
              <div className="ops-detail-label">Scheduler status</div>
              <div className="ops-detail-value">
                {scheduler?.status ?? 'Não disponível'}
              </div>
            </div>
            <div>
              <div className="ops-detail-label">Mode</div>
              <div className="ops-detail-value ops-mono">
                {scheduler?.mode ?? 'Não disponível'}
              </div>
            </div>
            <div>
              <div className="ops-detail-label">Cron</div>
              <div className="ops-detail-value ops-mono">
                {scheduler?.cron ?? 'Não disponível'}
              </div>
            </div>
            <div>
              <div className="ops-detail-label">Next run</div>
              <div className="ops-detail-value">
                {scheduler?.nextRunAt && timezone
                  ? formatDateTimeInTimezone(
                      scheduler.nextRunAt,
                      timezone,
                      'Não disponível',
                      'medium',
                    )
                  : 'Não disponível'}
              </div>
            </div>
            <div>
              <div className="ops-detail-label">Timezone técnico</div>
              <div className="ops-detail-value ops-mono">
                {timezone ?? 'Não disponível'}
              </div>
            </div>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div>
              <div className="ops-detail-label">Reason codes</div>
              <div className="ops-detail-value ops-mono break-words">
                {blockerCodes.length ? blockerCodes.join(' · ') : 'Nenhum'}
              </div>
            </div>
            <div>
              <div className="ops-detail-label">Hard caps</div>
              <div className="ops-detail-value ops-mono">
                {operational?.automation.hardCaps
                  ? `global=${operational.automation.hardCaps.dailyGlobalLimit} · grupo=${operational.automation.hardCaps.dailyGroupLimit} · run=${operational.automation.hardCaps.maxMessagesPerRun}`
                  : 'Não disponível'}
              </div>
            </div>
          </div>
        </div>
      </details>

      {action ? (
        <ConfirmationModal
          action={action}
          busy={writeBusy}
          onCancel={dismissAction}
          onConfirm={applyAction}
        />
      ) : null}
    </>
  );
}
