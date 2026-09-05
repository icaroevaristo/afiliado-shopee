import { describe, expect, it } from 'vitest';
import type {
  CommercialAutomationSchedulerStatus,
  CommercialAutomationStatus,
} from './api';
import {
  commercialAutomationReasonLabels,
  getCommercialOperationalState,
  getCommercialReadinessState,
} from './commercial-automation-display';

const status = (overrides: Partial<CommercialAutomationStatus> = {}) => ({
  enabled: true,
  allowed: true,
  reasons: [],
  nextAllowedAt: null,
  globalSentToday: 1,
  globalRemainingToday: 59,
  groupSentToday: 1,
  groupRemainingToday: 59,
  lastSentAt: null,
  paused: false,
  pausedAt: null,
  resumedAt: null,
  updatedAt: '2026-08-10T12:00:00.000Z',
  allowedStartTime: '08:00',
  allowedEndTime: '23:00',
  timezone: 'America/Sao_Paulo',
  dailyGlobalLimit: 60,
  dailyGroupLimit: 60,
  minimumIntervalMinutes: 14,
  authorizedGroupCount: 1,
  ...overrides,
}) satisfies CommercialAutomationStatus;

const registeredScheduler = {
  enabled: true,
  status: 'registered',
  jobId: 'scheduled-commercial-automation',
  queue: 'commercial-automation',
  jobName: 'commercial-automation-tick',
  cron: '*/15 8-22 * * *',
  timezone: 'America/Sao_Paulo',
  nextRunAt: '2026-08-10T12:15:00.000Z',
  mode: 'send',
} satisfies CommercialAutomationSchedulerStatus;

describe('commercial automation display state', () => {
  it('separa operacao ativa de readiness pronta', () => {
    const current = status();

    expect(getCommercialOperationalState(current, registeredScheduler)).toMatchObject({
      code: 'OPERATING',
      label: 'OPERANDO',
    });
    expect(getCommercialReadinessState(current)).toMatchObject({
      code: 'READY',
      label: 'PRONTA PARA O PRÓXIMO TICK',
    });
  });

  it('mantem OPERANDO enquanto aguarda o intervalo minimo', () => {
    const current = status({
      allowed: false,
      reasons: ['MINIMUM_INTERVAL_NOT_REACHED'],
    });

    expect(getCommercialOperationalState(current, registeredScheduler).label).toBe(
      'OPERANDO',
    );
    expect(getCommercialReadinessState(current)).toMatchObject({
      code: 'CADENCE_WAIT',
      label: 'AGUARDANDO CADÊNCIA',
      reasonCodes: ['MINIMUM_INTERVAL_NOT_REACHED'],
    });
  });

  it('classifica fora da janela sem alterar o estado operacional', () => {
    const current = status({
      allowed: false,
      reasons: ['OUTSIDE_ALLOWED_WINDOW'],
    });

    expect(getCommercialOperationalState(current, registeredScheduler).code).toBe(
      'OPERATING',
    );
    expect(getCommercialReadinessState(current).label).toBe('FORA DA JANELA');
  });

  it('classifica limite diario atingido', () => {
    const current = status({
      allowed: false,
      reasons: ['GLOBAL_DAILY_LIMIT_REACHED'],
    });

    expect(getCommercialReadinessState(current)).toMatchObject({
      code: 'DAILY_LIMIT',
      label: 'LIMITE DIÁRIO ATINGIDO',
    });
  });

  it('classifica automacao pausada', () => {
    expect(
      getCommercialOperationalState(
        status({ paused: true }),
        registeredScheduler,
      ),
    ).toMatchObject({ code: 'PAUSED', label: 'PAUSADA' });
  });

  it('classifica automacao desativada', () => {
    expect(
      getCommercialOperationalState(
        status({ enabled: false }),
        registeredScheduler,
      ),
    ).toMatchObject({ code: 'DISABLED', label: 'DESATIVADA' });
  });

  it('sinaliza scheduler ausente sem declarar OPERANDO', () => {
    const state = getCommercialOperationalState(status(), {
      ...registeredScheduler,
      status: 'not-registered',
    });

    expect(state).toMatchObject({
      code: 'SCHEDULER_INACTIVE',
      label: 'ATENÇÃO',
      detail: 'SCHEDULER INATIVO',
    });
  });

  it('distingue limite seguro de reposicao de catalogo esgotado', () => {
    expect(
      commercialAutomationReasonLabels.COMMERCIAL_AUTOMATION_REPLENISHMENT_LIMIT_REACHED,
    ).toBe(
      'O limite seguro de páginas da Shopee foi atingido antes de preencher a slot.',
    );
    expect(
      commercialAutomationReasonLabels.COMMERCIAL_AUTOMATION_CATALOG_EXHAUSTED,
    ).toBe(
      'O catálogo disponível foi esgotado sem encontrar candidate útil para esta slot.',
    );
  });
});
