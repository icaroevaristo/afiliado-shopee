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
  { value: 'SUBMITTED', label: 'Aguardando confirmação' },
  { value: 'SENT', label: 'Confirmados pelo servidor' },
  { value: 'DELIVERED', label: 'Entregues' },
  { value: 'READ', label: 'Lidos' },
  { value: 'PENDING', label: 'Enfileirados' },
  { value: 'FAILED', label: 'Com problema' },
  { value: 'PROCESSING', label: 'Em processamento' },
  { value: 'AMBIGUOUS', label: 'Precisa de investigação' },
];

export function presentSendHistoryStatus(
  status: string | null | undefined,
): SendHistoryStatusPresentation {
  switch (status?.toUpperCase()) {
    case 'SENT':
      return {
        label: 'Enviado',
        description: 'O provedor confirmou que aceitou a mensagem.',
        tone: 'success',
      };
    case 'DELIVERED':
      return {
        label: 'Entregue',
        description: 'O provedor confirmou a entrega no destino.',
        tone: 'success',
      };
    case 'READ':
      return {
        label: 'Lido',
        description: 'O provedor confirmou a leitura no destino.',
        tone: 'success',
      };
    case 'SUBMITTED':
      return {
        label: 'Aguardando confirmação',
        description: 'O pedido foi aceito localmente e aguarda confirmação do provedor.',
        tone: 'warning',
      };
    case 'FAILED':
      return {
        label: 'Não enviado',
        description: 'O envio terminou sem confirmação de publicação.',
        tone: 'danger',
      };
    case 'PENDING':
      return {
        label: 'Enfileirado',
        description: 'O envio aguarda processamento controlado.',
        tone: 'warning',
      };
    case 'PROCESSING':
      return {
        label: 'Em processamento',
        description:
          'O envio ainda está sendo preparado de forma controlada.',
        tone: 'warning',
      };
    case 'AMBIGUOUS':
      return {
        label: 'Precisa de investigação',
        description:
          'A confirmação não chegou no prazo. Nenhuma nova tentativa é automática.',
        tone: 'danger',
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
  dispatch: Pick<
    WhatsAppDispatch,
    'status' | 'submittedAt' | 'sentAt' | 'deliveredAt' | 'readAt' | 'createdAt'
  >,
  format: (value: string, fallback: string) => string,
): SendHistoryTimestamp {
  if (dispatch.status === 'READ' && dispatch.readAt) {
    return {
      label: 'Lido em',
      value: format(dispatch.readAt, 'Data não disponível'),
    };
  }

  if (dispatch.status === 'DELIVERED' && dispatch.deliveredAt) {
    return {
      label: 'Entregue em',
      value: format(dispatch.deliveredAt, 'Data não disponível'),
    };
  }

  if (dispatch.status === 'SENT' && dispatch.sentAt) {
    return {
      label: 'Confirmado em',
      value: format(dispatch.sentAt, 'Data não disponível'),
    };
  }

  if (dispatch.status === 'SUBMITTED' && dispatch.submittedAt) {
    return {
      label: 'Enviado para confirmação em',
      value: format(dispatch.submittedAt, 'Data não disponível'),
    };
  }

  if (dispatch.createdAt) {
    return {
      label: 'Criado em',
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
  if (status?.toUpperCase() === 'AMBIGUOUS') {
    return 'A confirmação não chegou no prazo e exige verificação técnica.';
  }
  return null;
}
