import { describe, expect, it, vi } from 'vitest';
import {
  presentSendHistoryError,
  presentSendHistoryStatus,
  presentSendHistoryTimestamp,
  SEND_HISTORY_FILTERS,
} from './send-history-display';

describe('send history display contract', () => {
  it('maps persisted statuses to user-facing labels without exposing technical status', () => {
    expect(presentSendHistoryStatus('SENT')).toMatchObject({
      label: 'Enviado',
      tone: 'success',
    });
    expect(presentSendHistoryStatus('FAILED')).toMatchObject({
      label: 'Não enviado',
      tone: 'danger',
    });
    expect(presentSendHistoryStatus('PENDING')).toMatchObject({
      label: 'Aguardando confirmação',
      tone: 'warning',
    });
    expect(presentSendHistoryStatus('PROCESSING')).toMatchObject({
      label: 'Em processamento',
      tone: 'warning',
    });
    expect(presentSendHistoryStatus('SUBMITTED')).toMatchObject({
      label: 'Aguardando confirmação',
      tone: 'warning',
    });
    expect(presentSendHistoryStatus('DELIVERED')).toMatchObject({
      label: 'Entregue',
      tone: 'success',
    });
    expect(presentSendHistoryStatus('AMBIGUOUS')).toMatchObject({
      label: 'Precisa de investigação',
      tone: 'danger',
    });
    expect(presentSendHistoryStatus('UNRECOGNIZED')).toMatchObject({
      label: 'Estado não reconhecido',
      tone: 'neutral',
    });
  });

  it('keeps filters aligned with the backend status contract', () => {
    expect(SEND_HISTORY_FILTERS).toEqual([
      { value: '', label: 'Todos' },
      { value: 'SUBMITTED', label: 'Aguardando confirmação' },
      { value: 'SENT', label: 'Confirmados pelo servidor' },
      { value: 'DELIVERED', label: 'Entregues' },
      { value: 'READ', label: 'Lidos' },
      { value: 'PENDING', label: 'Aguardando' },
      { value: 'FAILED', label: 'Com problema' },
      { value: 'PROCESSING', label: 'Em processamento' },
      { value: 'AMBIGUOUS', label: 'Precisa de investigação' },
    ]);
  });

  it('uses authoritative sentAt only for a SENT dispatch', () => {
    const format = vi.fn(
      (value: string, fallback: string) => `${value}|${fallback}`,
    );

    expect(
      presentSendHistoryTimestamp(
        {
          status: 'SENT',
          sentAt: '2026-08-20T12:00:00.000Z',
          createdAt: '2026-08-20T11:59:00.000Z',
        },
        format,
      ),
    ).toEqual({
      label: 'Confirmado em',
      value: '2026-08-20T12:00:00.000Z|Data não disponível',
    });
    expect(format).toHaveBeenCalledTimes(1);

    expect(
      presentSendHistoryTimestamp(
        {
          status: 'PROCESSING',
          sentAt: '2026-08-20T12:00:00.000Z',
          createdAt: '2026-08-20T11:59:00.000Z',
        },
        format,
      ),
    ).toEqual({
      label: 'Criado em',
      value: '2026-08-20T11:59:00.000Z|Data não disponível',
    });
  });

  it('does not claim a send time when the authoritative timestamp is absent', () => {
    expect(
      presentSendHistoryTimestamp(
        { status: 'SENT', sentAt: null, createdAt: '2026-08-20T11:59:00.000Z' },
        (value) => value,
      ),
    ).toEqual({ label: 'Criado em', value: '2026-08-20T11:59:00.000Z' });
    expect(
      presentSendHistoryTimestamp(
        { status: 'PENDING', sentAt: null, createdAt: undefined },
        (value) => value,
      ),
    ).toEqual({ label: 'Data não disponível', value: '—' });
  });

  it('prioritizes delivery and read timestamps over the first server acknowledgement', () => {
    expect(
      presentSendHistoryTimestamp(
        {
          status: 'DELIVERED',
          sentAt: '2026-08-20T12:00:00.000Z',
          deliveredAt: '2026-08-20T12:01:00.000Z',
        },
        (value) => value,
      ),
    ).toEqual({ label: 'Entregue em', value: '2026-08-20T12:01:00.000Z' });
    expect(
      presentSendHistoryTimestamp(
        {
          status: 'READ',
          readAt: '2026-08-20T12:02:00.000Z',
        },
        (value) => value,
      ),
    ).toEqual({ label: 'Lido em', value: '2026-08-20T12:02:00.000Z' });
  });

  it('uses only persisted error text and a safe fallback for terminal failure', () => {
    expect(
      presentSendHistoryError('Falha registrada pelo sistema', 'FAILED'),
    ).toBe('Falha registrada pelo sistema');
    expect(presentSendHistoryError(null, 'FAILED')).toBe(
      'O envio não foi concluído.',
    );
    expect(presentSendHistoryError(null, 'PROCESSING')).toBeNull();
  });
});
