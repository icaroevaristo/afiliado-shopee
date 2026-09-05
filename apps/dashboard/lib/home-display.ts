import type {
  CommercialAutomationReason,
  CommercialAutomationSchedulerStatus,
  CommercialAutomationStatus,
} from './api';

export type HomeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const reasonLabels: Record<CommercialAutomationReason, string> = {
  AUTOMATION_DISABLED: 'A automação está indisponível no ambiente.',
  AUTOMATION_PAUSED: 'A automação está desligada.',
  OUTSIDE_ALLOWED_WINDOW: 'Aguarda o próximo horário permitido.',
  GLOBAL_DAILY_LIMIT_REACHED: 'O limite diário de mensagens foi atingido.',
  GROUP_DAILY_LIMIT_REACHED: 'O limite diário do grupo foi atingido.',
  MINIMUM_INTERVAL_NOT_REACHED: 'Aguarda o intervalo mínimo entre envios.',
  NO_AUTHORIZED_GROUP: 'Nenhum grupo está pronto para receber envios.',
  MULTIPLE_AUTHORIZED_GROUPS: 'Há mais de um grupo configurado para o próximo envio.',
  AMBIGUOUS_COMMERCIAL_RUN_EXISTS: 'Existe um envio que precisa de verificação manual.',
  COMMERCIAL_EXECUTION_IN_PROGRESS: 'Há uma operação em andamento.',
  STALE_COMMERCIAL_EXECUTION_EXISTS: 'Há uma operação que precisa ser recuperada.',
  COMMERCIAL_AUTOMATION_DUPLICATE_LOGICAL_GROUP: 'Há grupos com configuração repetida.',
  COMMERCIAL_AUTOMATION_TARGET_NOT_ELIGIBLE: 'O próximo grupo não está pronto.',
  COMMERCIAL_AUTOMATION_NO_ELIGIBLE_CANDIDATE: 'Não há produto útil para o próximo slot.',
  COMMERCIAL_AUTOMATION_REPLENISHMENT_LIMIT_REACHED: 'A busca atingiu o limite seguro de páginas antes de encontrar produto útil.',
  COMMERCIAL_AUTOMATION_CATALOG_EXHAUSTED: 'O catálogo disponível terminou sem produto útil para o próximo slot.',
  COMMERCIAL_AUTOMATION_CANDIDATE_FALLBACK_EXHAUSTED: 'A substituição segura de produtos atingiu o limite.',
};

export function translateHomeReason(reason: string): string {
  return reasonLabels[reason as CommercialAutomationReason] ?? 'Há uma pendência operacional que precisa de atenção.';
}

export function homeAutomationPresentation(
  status: CommercialAutomationStatus | null,
  scheduler: CommercialAutomationSchedulerStatus | null,
): { label: string; detail: string; tone: HomeTone } {
  if (!status) {
    return { label: 'Estado indisponível', detail: 'Não foi possível consultar a automação agora.', tone: 'neutral' };
  }
  if (!status.enabled) {
    return { label: 'Automação indisponível', detail: 'A automação não está disponível neste ambiente.', tone: 'danger' };
  }
  if (status.paused) {
    return { label: 'Automação desligada', detail: 'A agenda está pausada. Nenhum novo envio deve começar.', tone: 'warning' };
  }
  if (!scheduler || scheduler.status !== 'registered') {
    return { label: 'Automação ligada', detail: 'A agenda automática ainda não está disponível.', tone: 'warning' };
  }
  if (!status.allowed && status.reasons.length === 0) {
    return { label: 'Automação aguardando', detail: 'A automação ainda não está pronta para o próximo envio.', tone: 'warning' };
  }
  if (status.reasons.length > 0) {
    const firstReason = translateHomeReason(status.reasons[0]);
    const waitingReason = new Set([
      'OUTSIDE_ALLOWED_WINDOW',
      'GLOBAL_DAILY_LIMIT_REACHED',
      'GROUP_DAILY_LIMIT_REACHED',
      'MINIMUM_INTERVAL_NOT_REACHED',
    ]).has(status.reasons[0]);
    return {
      label: 'Automação ligada',
      detail: firstReason,
      tone: waitingReason ? 'warning' : 'danger',
    };
  }
  return { label: 'Automação ligada', detail: 'A agenda está pronta para o próximo envio.', tone: 'success' };
}

export function translateHomeDispatchStatus(status: string | null | undefined): string {
  switch (status) {
    case 'SENT':
      return 'Enviado';
    case 'PROCESSING':
      return 'Aguardando confirmação';
    case 'PENDING':
      return 'Aguardando';
    case 'FAILED':
      return 'Não realizado';
    default:
      return 'Estado não reconhecido';
  }
}

export function translateHomeExecutionStatus(status: string | null | undefined): string {
  switch (status) {
    case 'PREVIEW_READY':
      return 'Oferta preparada';
    case 'STARTED':
      return 'Automação em andamento';
    case 'COMPLETED':
    case 'SENT':
      return 'Automação concluída';
    case 'BLOCKED':
      return 'Automação aguardando';
    case 'FAILED':
      return 'Automação não concluída';
    default:
      return 'Atividade da automação atualizada';
  }
}
