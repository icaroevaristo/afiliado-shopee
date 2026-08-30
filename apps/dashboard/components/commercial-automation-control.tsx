'use client';

import {
  PauseCircle,
  PlayCircle,
  RefreshCw,
  ShieldAlert,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import {
  getCommercialAutomationStatus,
  pauseCommercialAutomation,
  resumeCommercialAutomation,
  type CommercialAutomationStatus,
} from '../lib/api';
import {
  commercialAutomationReasonLabels,
  formatCommercialAutomationDate,
} from '../lib/commercial-automation-display';
import { ErrorState } from './error-state';
import { LoadingState } from './loading-state';
import { StatusBadge } from './status-badge';

const RESUME_CONFIRMATION = 'RETOMAR_AUTOMACAO_COMERCIAL';

function AutomationDetail({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 border-b border-slate-100 py-3 last:border-b-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 break-words text-sm font-medium text-slate-900">
        {children}
      </dd>
    </div>
  );
}

export function CommercialAutomationControl() {
  const [automation, setAutomation] =
    useState<CommercialAutomationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [resumeModalOpen, setResumeModalOpen] = useState(false);
  const [resumeConfirmation, setResumeConfirmation] = useState('');
  const requestInFlight = useRef(false);
  const confirmationInputRef = useRef<HTMLInputElement>(null);

  const loadAutomation = async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      setAutomation(await getCommercialAutomationStatus());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado.');
    } finally {
      requestInFlight.current = false;
      setLoading(false);
    }
  };

  const pauseAutomation = async () => {
    setUpdating(true);
    setError(null);
    try {
      setAutomation(await pauseCommercialAutomation());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado.');
    } finally {
      setUpdating(false);
    }
  };

  const resumeAutomation = async () => {
    if (resumeConfirmation !== RESUME_CONFIRMATION || !automation) return;
    setUpdating(true);
    setError(null);
    try {
      setAutomation(
        await resumeCommercialAutomation(
          resumeConfirmation,
          automation.updatedAt,
        ),
      );
      setResumeModalOpen(false);
      setResumeConfirmation('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado.');
    } finally {
      setUpdating(false);
    }
  };

  useEffect(() => {
    void loadAutomation();
  }, []);

  useEffect(() => {
    if (resumeModalOpen) confirmationInputRef.current?.focus();
  }, [resumeModalOpen]);

  return (
    <>
      <section
        className="rounded-lg border border-slate-200 bg-white p-5"
        aria-labelledby="commercial-automation-heading"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 gap-3">
            <ShieldAlert
              className="mt-0.5 h-5 w-5 shrink-0 text-orange-600"
              aria-hidden="true"
            />
            <div>
              <h2
                id="commercial-automation-heading"
                className="font-semibold text-slate-950"
              >
                Controle da automação
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Decide se uma futura execução comercial estaria permitida.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void loadAutomation()}
            disabled={loading || updating}
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw
              className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            Atualizar controle
          </button>
        </div>

        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-950">
          <p className="font-medium">
            Este controle altera somente a pausa persistida.
          </p>
          <p>
            Ligar ou desligar não envia mensagem nem altera o processo do
            sistema. A agenda segue os limites, a janela e os blockers exibidos.
          </p>
        </div>

        <div className="mt-4">
          {loading ? (
            <LoadingState label="Consultando controle da automação" />
          ) : null}
          {error ? (
            <ErrorState
              title="Controle da automação indisponível"
              message={error}
              onRetry={loadAutomation}
            />
          ) : null}
          {automation && !loading ? (
            <div className="grid gap-5">
              <div
                className="flex flex-wrap gap-2"
                aria-label="Estados da automação"
              >
                <StatusBadge tone={automation.enabled ? 'ok' : 'neutral'}>
                  Ambiente: {automation.enabled ? 'habilitada' : 'desabilitada'}
                </StatusBadge>
                <StatusBadge tone={automation.paused ? 'warning' : 'ok'}>
                  Operação: {automation.paused ? 'pausada' : 'ativa'}
                </StatusBadge>
                <StatusBadge tone={automation.allowed ? 'ok' : 'error'}>
                  Decisão: {automation.allowed ? 'permitida' : 'bloqueada'}
                </StatusBadge>
              </div>

              <dl className="grid gap-x-8 sm:grid-cols-2 xl:grid-cols-3">
                <AutomationDetail label="Horário permitido">
                  {automation.allowedStartTime}–{automation.allowedEndTime}
                </AutomationDetail>
                <AutomationDetail label="Timezone">
                  {automation.timezone}
                </AutomationDetail>
                <AutomationDetail label="Limite global hoje">
                  {automation.globalSentToday}/{automation.dailyGlobalLimit} ·{' '}
                  {automation.globalRemainingToday} restante(s)
                </AutomationDetail>
                <AutomationDetail label="Limite do grupo hoje">
                  {automation.groupSentToday === null
                    ? '—'
                    : `${automation.groupSentToday}/${automation.dailyGroupLimit} · ${automation.groupRemainingToday} restante(s)`}
                </AutomationDetail>
                <AutomationDetail label="Último envio">
                  {formatCommercialAutomationDate(
                    automation.lastSentAt,
                    automation.timezone,
                  )}
                </AutomationDetail>
                <AutomationDetail label="Próxima permissão">
                  {formatCommercialAutomationDate(
                    automation.nextAllowedAt,
                    automation.timezone,
                  )}
                </AutomationDetail>
                <AutomationDetail label="Intervalo mínimo">
                  {automation.minimumIntervalMinutes} minuto(s)
                </AutomationDetail>
                <AutomationDetail label="Grupos autorizados">
                  {automation.authorizedGroupCount}
                </AutomationDetail>
              </dl>

              <div>
                <h3 className="text-sm font-semibold text-slate-950">
                  Motivos de bloqueio
                </h3>
                {automation.reasons.length > 0 ? (
                  <ul
                    className="mt-2 grid gap-2"
                    aria-label="Motivos de bloqueio"
                  >
                    {automation.reasons.map((reason) => (
                      <li
                        key={reason}
                        className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900"
                      >
                        {commercialAutomationReasonLabels[reason]}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-emerald-700">
                    Nenhum bloqueio operacional no momento.
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-slate-500">
                  A configuração do ambiente não é alterada pelo dashboard.
                </p>
                {automation.paused ? (
                  <button
                    type="button"
                    onClick={() => setResumeModalOpen(true)}
                    disabled={updating}
                    className="inline-flex items-center justify-center gap-2 rounded-md bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <PlayCircle className="h-4 w-4" aria-hidden="true" />
                    Ligar automação
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void pauseAutomation()}
                    disabled={updating}
                    className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <PauseCircle className="h-4 w-4" aria-hidden="true" />
                    Desligar automação
                  </button>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {resumeModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
          role="presentation"
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !updating) setResumeModalOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="resume-automation-title"
            aria-describedby="resume-automation-description"
            className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2
                  id="resume-automation-title"
                  className="text-lg font-semibold text-slate-950"
                >
                  Ligar automação comercial
                </h2>
                <p
                  id="resume-automation-description"
                  className="mt-2 text-sm leading-6 text-slate-600"
                >
                  Ligar remove apenas a pausa persistida. Não envia mensagem
                  diretamente nem altera o processo do sistema.
                </p>
              </div>
              <button
                type="button"
                aria-label="Fechar confirmação"
                onClick={() => setResumeModalOpen(false)}
                disabled={updating}
                className="rounded-md p-1 text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:opacity-60"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <label
              htmlFor="resume-automation-confirmation"
              className="mt-5 block text-sm font-medium text-slate-800"
            >
              Digite exatamente {RESUME_CONFIRMATION}
            </label>
            <input
              ref={confirmationInputRef}
              id="resume-automation-confirmation"
              value={resumeConfirmation}
              onChange={(event) => setResumeConfirmation(event.target.value)}
              autoComplete="off"
              className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-950 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200"
            />

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setResumeModalOpen(false)}
                disabled={updating}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void resumeAutomation()}
                disabled={
                  updating || resumeConfirmation !== RESUME_CONFIRMATION
                }
                className="rounded-md bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {updating ? 'Retomando…' : 'Confirmar retomada'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
