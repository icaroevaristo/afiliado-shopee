import { describe, expect, it } from 'vitest';
import {
  homeAutomationPresentation,
  translateHomeDispatchStatus,
  translateHomeExecutionStatus,
  translateHomeReason,
} from './home-display';

const status = {
  enabled: true,
  allowed: true,
  reasons: [],
  nextAllowedAt: null,
  globalSentToday: 0,
  globalRemainingToday: 10,
  groupSentToday: 0,
  groupRemainingToday: 10,
  lastSentAt: null,
  paused: false,
  pausedAt: null,
  resumedAt: null,
  updatedAt: '2026-08-09T18:30:00.000Z',
  allowedStartTime: '08:00',
  allowedEndTime: '22:00',
  timezone: 'America/Sao_Paulo',
  dailyGlobalLimit: 10,
  dailyGroupLimit: 10,
  minimumIntervalMinutes: 10,
  authorizedGroupCount: 1,
};

const scheduler = {
  enabled: true,
  status: 'registered' as const,
  jobId: 'scheduler',
  queue: 'commercial-automation',
  jobName: 'commercial-automation-tick',
  cron: '*/10 * * * *',
  timezone: 'America/Sao_Paulo',
  nextRunAt: null,
  mode: 'send' as const,
};

describe('home-display', () => {
  it('mantém a distinção entre automação ligada e espera de política', () => {
    expect(homeAutomationPresentation(status, scheduler)).toMatchObject({ label: 'Automação ligada', tone: 'success' });
    expect(homeAutomationPresentation({ ...status, allowed: false, reasons: ['MINIMUM_INTERVAL_NOT_REACHED'] }, scheduler)).toMatchObject({
      label: 'Automação ligada',
      detail: 'Aguarda o intervalo mínimo entre envios.',
      tone: 'warning',
    });
  });

  it('traduz desconhecidos para linguagem segura e não técnica', () => {
    expect(translateHomeReason('NEW_INTERNAL_REASON')).toBe('Há uma pendência operacional que precisa de atenção.');
    expect(translateHomeDispatchStatus('PROCESSING')).toBe('Aguardando confirmação');
    expect(translateHomeDispatchStatus('UNKNOWN')).toBe('Estado não reconhecido');
    expect(translateHomeExecutionStatus('UNKNOWN')).toBe('Atividade da automação atualizada');
  });

  it('distingue limite seguro de paginas de catalogo esgotado', () => {
    expect(
      translateHomeReason('COMMERCIAL_AUTOMATION_REPLENISHMENT_LIMIT_REACHED'),
    ).toBe('A busca atingiu o limite seguro de páginas antes de encontrar produto útil.');
    expect(translateHomeReason('COMMERCIAL_AUTOMATION_CATALOG_EXHAUSTED')).toBe(
      'O catálogo disponível terminou sem produto útil para o próximo slot.',
    );
  });

  it('representa pausa como estado desligado', () => {
    expect(homeAutomationPresentation({ ...status, paused: true }, scheduler)).toMatchObject({
      label: 'Automação desligada',
      detail: 'A agenda está pausada. Nenhum novo envio deve começar.',
      tone: 'warning',
    });
  });

  it('não apresenta uma automação não autorizada como pronta quando falta o motivo', () => {
    expect(homeAutomationPresentation({ ...status, allowed: false }, scheduler)).toMatchObject({
      label: 'Automação aguardando',
      tone: 'warning',
    });
  });
});
