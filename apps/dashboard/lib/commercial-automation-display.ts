import type {
  CommercialAutomationReason,
  CommercialAutomationSchedulerStatus,
  CommercialAutomationStatus,
} from './api';
import { formatDateTimeInTimezone } from './format';

export const commercialAutomationReasonLabels: Record<
  CommercialAutomationReason,
  string
> = {
  AUTOMATION_DISABLED: 'Automação desabilitada pelo ambiente.',
  AUTOMATION_PAUSED: 'Automação pausada operacionalmente.',
  OUTSIDE_ALLOWED_WINDOW: 'Fora do horário permitido.',
  GLOBAL_DAILY_LIMIT_REACHED: 'Limite diário global atingido.',
  GROUP_DAILY_LIMIT_REACHED: 'Limite diário do grupo atingido.',
  MINIMUM_INTERVAL_NOT_REACHED: 'Intervalo mínimo ainda não atingido.',
  NO_AUTHORIZED_GROUP: 'Nenhum grupo autorizado e disponível.',
  MULTIPLE_AUTHORIZED_GROUPS: 'Mais de um grupo autorizado e disponível.',
  AMBIGUOUS_COMMERCIAL_RUN_EXISTS:
    'Existe uma execução comercial ambígua que exige investigação manual.',
  COMMERCIAL_EXECUTION_IN_PROGRESS:
    'Existe uma execução comercial ainda em andamento.',
  STALE_COMMERCIAL_EXECUTION_EXISTS:
    'Existe uma execução comercial expirada que exige recuperação.',
  COMMERCIAL_AUTOMATION_DUPLICATE_LOGICAL_GROUP:
    'Existem destinos físicos duplicando a mesma identidade lógica.',
  COMMERCIAL_AUTOMATION_TARGET_NOT_ELIGIBLE:
    'O grupo selecionado deixou de ser elegível para este tick.',
  COMMERCIAL_AUTOMATION_NO_ELIGIBLE_CANDIDATE:
    'Nenhum candidate útil permaneceu para esta slot.',
  COMMERCIAL_AUTOMATION_CANDIDATE_FALLBACK_EXHAUSTED:
    'O limite seguro de substituições de candidate foi atingido.',
};

export const formatCommercialAutomationDate = (
  value: string | null,
  timezone: string,
) => formatDateTimeInTimezone(value, timezone, 'Não registrado');

export type CommercialOperationalState = {
  code: 'OPERATING' | 'PAUSED' | 'DISABLED' | 'SCHEDULER_INACTIVE' | 'UNKNOWN';
  label: string;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
  detail: string;
};

export type CommercialReadinessState = {
  code: 'READY' | 'CADENCE_WAIT' | 'OUTSIDE_WINDOW' | 'DAILY_LIMIT' | 'BLOCKED' | 'UNKNOWN';
  label: string;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
  reasonCodes: string[];
};

export const getCommercialOperationalState = (
  status: CommercialAutomationStatus | null | undefined,
  scheduler: CommercialAutomationSchedulerStatus | null | undefined,
): CommercialOperationalState => {
  if (!status) {
    return {
      code: 'UNKNOWN',
      label: 'NÃO DISPONÍVEL',
      tone: 'neutral',
      detail: 'Aguardando estado operacional',
    };
  }

  if (!status.enabled) {
    return {
      code: 'DISABLED',
      label: 'DESATIVADA',
      tone: 'danger',
      detail: 'Automação desabilitada pelo ambiente',
    };
  }

  if (status.paused) {
    return {
      code: 'PAUSED',
      label: 'PAUSADA',
      tone: 'warning',
      detail: 'Pausa persistida operacionalmente',
    };
  }

  if (scheduler?.status !== 'registered') {
    return {
      code: 'SCHEDULER_INACTIVE',
      label: 'ATENÇÃO',
      tone: 'warning',
      detail: 'SCHEDULER INATIVO',
    };
  }

  return {
    code: 'OPERATING',
    label: 'OPERANDO',
    tone: 'success',
    detail: 'Scheduler registrado',
  };
};

export const getCommercialReadinessState = (
  status: CommercialAutomationStatus | null | undefined,
): CommercialReadinessState => {
  if (!status) {
    return {
      code: 'UNKNOWN',
      label: 'NÃO DISPONÍVEL',
      tone: 'neutral',
      reasonCodes: [],
    };
  }

  const reasonCodes = [...status.reasons];

  if (status.allowed) {
    return {
      code: 'READY',
      label: 'PRONTA PARA O PRÓXIMO TICK',
      tone: 'success',
      reasonCodes,
    };
  }

  if (
    reasonCodes.length === 1 &&
    reasonCodes[0] === 'MINIMUM_INTERVAL_NOT_REACHED'
  ) {
    return {
      code: 'CADENCE_WAIT',
      label: 'AGUARDANDO CADÊNCIA',
      tone: 'warning',
      reasonCodes,
    };
  }

  if (reasonCodes.includes('OUTSIDE_ALLOWED_WINDOW')) {
    return {
      code: 'OUTSIDE_WINDOW',
      label: 'FORA DA JANELA',
      tone: 'warning',
      reasonCodes,
    };
  }

  if (
    reasonCodes.includes('GLOBAL_DAILY_LIMIT_REACHED') ||
    reasonCodes.includes('GROUP_DAILY_LIMIT_REACHED')
  ) {
    return {
      code: 'DAILY_LIMIT',
      label: 'LIMITE DIÁRIO ATINGIDO',
      tone: 'warning',
      reasonCodes,
    };
  }

  return {
    code: 'BLOCKED',
    label: 'BLOQUEADA',
    tone: 'danger',
    reasonCodes,
  };
};
