import type { WhatsAppDispatch, WhatsAppDispatchStatus } from './api';

export type SendHistoryTone =
  'success' | 'warning' | 'danger' | 'info' | 'neutral';

export type SendHistoryStatusPresentation = {
  label: string;
  description: string;
  tone: SendHistoryTone;
};

export type SendHistoryTimestamp = {
  label: string;
  value: string;
};

export type SendHistoryFilter = WhatsAppDispatchStatus | '';

export const SEND_HISTORY_FILTERS: Array<{
  value: SendHistoryFilter;
  label: string;
}> = [
  { value: '', label: 'Todos' },
  { value: 'SENT', label: 'Enviados' },
  { value: 'PENDING', label: 'Aguardando' },
  { value: 'FAILED', label: 'Com problema' },
  { value: 'PROCESSING', label: 'Confirmação pendente' },
];

export function presentSendHistoryStatus(
  status: string | null | undefined,
): SendHistoryStatusPresentation {
  switch (status?.toUpperCase()) {
    case 'SENT':
      return {
        label: 'Enviado',
        description: 'O envio foi registrado como concluído.',
        tone: 'success',
      };
    case 'FAILED':
      return {
        label: 'Não enviado',
        description: 'O envio terminou sem confirmação de publicação.',
        tone: 'danger',
      };
    case 'PENDING':
      return {
        label: 'Aguardando envio',
        description: 'O envio está aguardando processamento.',
        tone: 'warning',
      };
    case 'PROCESSING':
      return {
        label: 'Resultado pendente',
        description:
          'Não foi possível confirmar com segurança o resultado deste envio.',
        tone: 'warning',
      };
    default:
      return {
        label: 'Estado não reconhecido',
        description:
          'O sistema registrou um estado que precisa de verificação técnica.',
        tone: 'neutral',
      };
  }
}

export function presentSendHistoryTimestamp(
  dispatch: Pick<WhatsAppDispatch, 'status' | 'sentAt' | 'createdAt'>,
  format: (value: string, fallback: string) => string,
): SendHistoryTimestamp {
  if (dispatch.status === 'SENT' && dispatch.sentAt) {
    return {
      label: 'Enviado em',
      value: format(dispatch.sentAt, 'Data não disponível'),
    };
  }

  if (dispatch.createdAt) {
    return {
      label: dispatch.status === 'SENT' ? 'Registrado em' : 'Criado em',
      value: format(dispatch.createdAt, 'Data não disponível'),
    };
  }

  return { label: 'Data não disponível', value: '—' };
}

export function presentSendHistoryError(
  errorMessage: string | null | undefined,
  status: string | null | undefined,
): string | null {
  if (errorMessage?.trim()) return errorMessage;
  if (status?.toUpperCase() === 'FAILED') {
    return 'O envio não foi concluído.';
  }
  return null;
}
