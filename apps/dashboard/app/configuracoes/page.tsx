'use client';

import { CalendarClock, Info, RefreshCw, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { CommercialAutomationControl } from '../../components/commercial-automation-control';
import { ErrorState } from '../../components/error-state';
import { LoadingState } from '../../components/loading-state';
import { PageHeader } from '../../components/page-header';
import { StatusBadge } from '../../components/status-badge';
import {
  getApiBaseUrl,
  getHealth,
  getSchedulerStatus,
  type SchedulerStatus,
} from '../../lib/api';
import {
  formatSchedulerDate,
  schedulerStatusDisplay,
  SCHEDULER_DATE_FALLBACK,
} from '../../lib/scheduler-display';

function SettingsDetail({
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

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scheduler, setScheduler] = useState<SchedulerStatus | null>(null);
  const [schedulerLoading, setSchedulerLoading] = useState(true);
  const [schedulerError, setSchedulerError] = useState<string | null>(null);
  const [apiBaseUrl, setApiBaseUrl] = useState('/api');
  const schedulerRequestInFlight = useRef(false);

  const check = async () => {
    setLoading(true);
    setError(null);
    try {
      const health = await getHealth();
      setOnline(health.status === 'ok');
    } catch (err) {
      setOnline(false);
      setError(err instanceof Error ? err.message : 'Erro inesperado.');
    } finally {
      setLoading(false);
    }
  };

  const loadScheduler = async () => {
    if (schedulerRequestInFlight.current) return;
    schedulerRequestInFlight.current = true;
    setSchedulerLoading(true);
    setSchedulerError(null);
    try {
      setScheduler(await getSchedulerStatus());
    } catch (err) {
      setSchedulerError(
        err instanceof Error ? err.message : 'Erro inesperado.',
      );
    } finally {
      schedulerRequestInFlight.current = false;
      setSchedulerLoading(false);
    }
  };

  useEffect(() => {
    setApiBaseUrl(getApiBaseUrl());
    void check();
    void loadScheduler();
  }, []);

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Configurações"
        description="Informações seguras de operação do dashboard. Credenciais nunca devem ser inseridas no navegador."
      />

      {loading ? <LoadingState label="Verificando API" /> : null}
      {error ? <ErrorState message={error} onRetry={check} /> : null}

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-950">API usada</h2>
            <p className="mt-1 break-all text-sm text-slate-600">
              {apiBaseUrl}
            </p>
          </div>
          <StatusBadge tone={online ? 'ok' : 'error'}>
            {online ? 'online' : 'offline'}
          </StatusBadge>
        </div>
      </section>

      <CommercialAutomationControl />

      <section
        className="rounded-lg border border-slate-200 bg-white p-5"
        aria-labelledby="scheduler-settings-heading"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex gap-3">
            <CalendarClock
              className="mt-0.5 h-5 w-5 shrink-0 text-slate-500"
              aria-hidden="true"
            />
            <div>
              <h2
                id="scheduler-settings-heading"
                className="font-semibold text-slate-950"
              >
                Scheduler do pipeline
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Estado retornado pela API para o agendamento conhecido.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void loadScheduler()}
            disabled={schedulerLoading}
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw
              className={`h-4 w-4 ${schedulerLoading ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            Atualizar status
          </button>
        </div>

        <div className="mt-4 flex gap-3 border-l-4 border-sky-400 bg-sky-50 p-3 text-sm text-sky-900">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            O Scheduler é configurado no ambiente do worker. Esta tela é somente
            leitura.
          </p>
        </div>

        <div className="mt-4">
          {schedulerLoading ? (
            <LoadingState label="Consultando status do Scheduler" />
          ) : null}
          {schedulerError ? (
            <ErrorState
              title="Status do Scheduler indisponível"
              message={schedulerError}
              onRetry={loadScheduler}
            />
          ) : null}
          {scheduler && !schedulerLoading ? (
            <dl className="grid gap-x-8 sm:grid-cols-2">
              <SettingsDetail label="Habilitado">
                {scheduler.enabled ? 'Sim' : 'Não'}
              </SettingsDetail>
              <SettingsDetail label="Status">
                <StatusBadge
                  tone={schedulerStatusDisplay[scheduler.status].tone}
                >
                  {schedulerStatusDisplay[scheduler.status].label}
                </StatusBadge>
              </SettingsDetail>
              <SettingsDetail label="Job ID">{scheduler.jobId}</SettingsDetail>
              <SettingsDetail label="Fila">{scheduler.queue}</SettingsDetail>
              <SettingsDetail label="Nome do job">
                {scheduler.jobName}
              </SettingsDetail>
              <SettingsDetail label="Expressão cron">
                {scheduler.cronExpression ?? SCHEDULER_DATE_FALLBACK}
              </SettingsDetail>
              <SettingsDetail label="Timezone">
                {scheduler.timezone ?? SCHEDULER_DATE_FALLBACK}
              </SettingsDetail>
              <SettingsDetail label="Próxima execução">
                {formatSchedulerDate(scheduler.nextRunAt, scheduler.timezone)}
              </SettingsDetail>
            </dl>
          ) : null}
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex gap-3">
          <ShieldCheck
            className="mt-1 h-5 w-5 shrink-0 text-emerald-600"
            aria-hidden="true"
          />
          <div>
            <h2 className="font-semibold text-slate-950">
              Credenciais e provider WhatsApp
            </h2>
            <div className="mt-3 grid gap-3 text-sm leading-6 text-slate-700">
              <p>
                O frontend conhece apenas configurações públicas, como
                NEXT_PUBLIC_API_URL. Chaves da Evolution API ficam no .env local
                do worker.
              </p>
              <p>
                WHATSAPP_PROVIDER=mock é o modo seguro padrão e não envia
                mensagens reais. WHATSAPP_PROVIDER=evolution exige configuração
                explícita no ambiente do worker.
              </p>
              <p>
                O dashboard não salva segredos em localStorage e não possui
                campo para EVOLUTION_API_KEY.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-950">Limitações atuais</h2>
        <ul className="mt-3 grid gap-2 text-sm leading-6 text-slate-700">
          <li>Não há endpoint público de listagem completa de produtos.</li>
          <li>
            Não há endpoint agregado para indicadores de score e aprovação.
          </li>
          <li>Não há endpoint de histórico/listagem de copies geradas.</li>
          <li>Não há endpoint de reprocessamento manual de dispatches.</li>
        </ul>
      </section>
    </div>
  );
}
