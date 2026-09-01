'use client';

import {
  Activity,
  ArrowUpRight,
  Globe2,
  History,
  MessagesSquare,
  ShieldCheck,
  UsersRound,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  OpsBadge,
  OpsLoading,
  OpsPageHeading,
  OpsSection,
  RefreshButton,
  type OpsTone,
} from '../../components/ops-components';
import {
  getCommercialAutomationStatus,
  getHealth,
  type CommercialAutomationStatus,
  type HealthResponse,
} from '../../lib/api';

const HEALTH_ERROR_MESSAGE = 'Não foi possível consultar a API.';
const TIMEZONE_ERROR_MESSAGE = 'Fuso horário indisponível.';

function timezoneLabel(timezone: string | null) {
  if (timezone === 'America/Sao_Paulo') return 'Horário de Brasília';
  return timezone ?? 'Não disponível';
}

function QuickLinkCard({
  description,
  href,
  icon: Icon,
  label,
  title,
}: {
  description: string;
  href: string;
  icon: typeof UsersRound;
  label: string;
  title: string;
}) {
  return (
    <Link
      href={href}
      className="group flex min-h-[132px] min-w-0 flex-col justify-between rounded-md border border-slate-200 bg-white p-4 text-slate-900 transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2"
    >
      <span className="flex items-start justify-between gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-orange-50 text-orange-700">
          <Icon size={18} aria-hidden="true" />
        </span>
        <ArrowUpRight
          size={17}
          className="text-slate-400 transition group-hover:text-slate-700"
          aria-hidden="true"
        />
      </span>
      <span className="mt-5 min-w-0">
        <span className="block text-sm font-semibold text-slate-950">
          {title}
        </span>
        <span className="mt-1 block text-sm leading-6 text-slate-600">
          {description}
        </span>
        <span className="mt-3 block text-sm font-semibold text-orange-800">
          {label}
        </span>
      </span>
    </Link>
  );
}

function HealthPanel({
  health,
  loading,
  readError,
}: {
  health: HealthResponse | null;
  loading: boolean;
  readError: boolean;
}) {
  const online = health?.status === 'ok';
  const tone: OpsTone = loading ? 'neutral' : online ? 'success' : 'danger';
  const statusLabel = loading
    ? 'Consultando…'
    : online
      ? 'Online'
      : 'Indisponível';

  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <div className="flex min-w-0 items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-slate-100 text-slate-700">
            <Activity size={18} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-950">API</h3>
            <p
              className="mt-1 text-sm text-slate-600"
              aria-live="polite"
              role="status"
            >
              {statusLabel}
            </p>
          </div>
        </div>
        <OpsBadge tone={tone}>{statusLabel}</OpsBadge>
      </div>

      {loading ? <OpsLoading label="Consultando saúde da API" /> : null}
      {readError ? (
        <p className="mt-4 text-sm leading-6 text-rose-800" role="alert">
          {HEALTH_ERROR_MESSAGE}
          {health ? ' Última leitura disponível.' : ''}
        </p>
      ) : null}
    </div>
  );
}

function TimezonePanel({
  loading,
  readError,
  timezone,
}: {
  loading: boolean;
  readError: boolean;
  timezone: string | null;
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-slate-100 text-slate-700">
          <Globe2 size={18} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-950">Fuso horário</h3>
          <p className="mt-1 text-base font-semibold text-slate-950">
            {loading ? 'Consultando…' : timezoneLabel(timezone)}
          </p>
          {timezone ? (
            <p className="mt-1 break-words text-xs text-slate-500">
              {timezone}
            </p>
          ) : null}
        </div>
      </div>
      {loading ? <OpsLoading label="Consultando fuso horário" /> : null}
      {readError ? (
        <p className="mt-4 text-sm leading-6 text-amber-800" role="alert">
          {TIMEZONE_ERROR_MESSAGE}
          {timezone ? ' Última leitura disponível.' : ''}
        </p>
      ) : null}
    </div>
  );
}

export default function SettingsPage() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [timezone, setTimezone] = useState<string | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [timezoneLoading, setTimezoneLoading] = useState(true);
  const [healthReadError, setHealthReadError] = useState(false);
  const [timezoneReadError, setTimezoneReadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const requestInFlight = useRef(false);

  const load = useCallback(async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setRefreshing(true);
    setHealthLoading(true);
    setTimezoneLoading(true);

    const healthRequest = getHealth()
      .then((nextHealth) => {
        setHealth(nextHealth);
        setHealthReadError(false);
      })
      .catch(() => {
        setHealthReadError(true);
      })
      .finally(() => {
        setHealthLoading(false);
      });

    const timezoneRequest = getCommercialAutomationStatus()
      .then((status: CommercialAutomationStatus) => {
        setTimezone(status.timezone || null);
        setTimezoneReadError(false);
      })
      .catch(() => {
        setTimezoneReadError(true);
      })
      .finally(() => {
        setTimezoneLoading(false);
      });

    await Promise.all([healthRequest, timezoneRequest]);
    requestInFlight.current = false;
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="grid gap-6">
      <OpsPageHeading
        eyebrow="Preferências"
        title="Configurações"
        description="Acesse preferências e informações gerais do sistema."
        actions={
          <RefreshButton onClick={() => void load()} busy={refreshing} />
        }
      />

      <OpsSection title="Sistema" meta="Informações locais disponíveis agora.">
        <div className="grid gap-4 sm:grid-cols-2">
          <HealthPanel
            health={health}
            loading={healthLoading}
            readError={healthReadError}
          />
          <TimezonePanel
            loading={timezoneLoading}
            readError={timezoneReadError}
            timezone={timezone}
          />
        </div>
      </OpsSection>

      <OpsSection
        title="Acessos rápidos"
        meta="Abra a área certa para cada operação do dia."
      >
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <QuickLinkCard
            description="Configure quando e com que frequência a automação pode operar."
            href="/automacao"
            icon={Activity}
            label="Configurar automação"
            title="Automação"
          />
          <QuickLinkCard
            description="Gerencie os grupos que recebem ofertas e o WhatsApp responsável."
            href="/whatsapp"
            icon={UsersRound}
            label="Gerenciar grupos"
            title="Grupos"
          />
          <QuickLinkCard
            description="Acompanhe as instâncias usadas nos envios."
            href="/whatsapp?view=whatsapps"
            icon={MessagesSquare}
            label="Gerenciar WhatsApps"
            title="WhatsApps"
          />
          <QuickLinkCard
            description="Consulte os envios e resultados registrados."
            href="/envios"
            icon={History}
            label="Ver histórico"
            title="Histórico"
          />
        </div>
      </OpsSection>

      <OpsSection title="Segurança">
        <div className="flex items-start gap-3">
          <ShieldCheck
            className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700"
            aria-hidden="true"
          />
          <p className="text-sm leading-6 text-slate-700">
            Credenciais são mantidas fora do navegador.
          </p>
        </div>
      </OpsSection>

      <OpsSection title="Diagnóstico avançado" className="ops-section--quiet">
        <p className="text-sm leading-6 text-slate-600">
          Diagnóstico avançado será consolidado na próxima etapa.
        </p>
      </OpsSection>
    </div>
  );
}
