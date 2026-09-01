'use client';

import {
  ArrowUpRight,
  BadgeCheck,
  CheckCircle2,
  Circle,
  Clock3,
  FileText,
  HeartPulse,
  Package,
  RefreshCw,
  Send,
  Tag,
  UsersRound,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getCommercialAutomationSchedulerStatus,
  getCommercialAutomationStatus,
  getHealth,
  getOperationalAdmin,
  listCommercialAutomationExecutions,
  listDispatches,
  type CommercialAutomationExecution,
  type CommercialAutomationSchedulerStatus,
  type CommercialAutomationStatus,
  type HealthResponse,
  type OperationalAdmin,
  type WhatsAppDispatch,
} from '../lib/api';
import {
  homeAutomationPresentation,
  translateHomeDispatchStatus,
  translateHomeExecutionStatus,
  translateHomeReason,
} from '../lib/home-display';
import { formatDateTimeInTimezone, formatNumber } from '../lib/format';
import {
  OpsBadge,
  OpsEmpty,
  OpsLoading,
  OpsPageHeading,
  OpsSection,
  OpsState,
  toneForStatus,
} from '../components/ops-components';
import { SafeProductImage } from '../components/safe-product-image';

type OverviewData = {
  health: HealthResponse | null;
  status: CommercialAutomationStatus | null;
  scheduler: CommercialAutomationSchedulerStatus | null;
  admin: OperationalAdmin | null;
  executions: CommercialAutomationExecution[];
  dispatches: WhatsAppDispatch[];
  sourceAvailability: {
    executions: boolean;
    dispatches: boolean;
  };
  partialFailures: string[];
  lastUpdatedAt: string | null;
};

const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

const dispatchSortValue = (dispatch: WhatsAppDispatch) =>
  new Date(dispatch.sentAt ?? dispatch.createdAt ?? 0).getTime();

const formatHomeTime = (
  value: string | null | undefined,
  timezone: string,
  timeStyle: 'short' | 'medium' = 'short',
) => formatDateTimeInTimezone(value, timezone, 'Não disponível', timeStyle);

function HomeSystemLine({
  health,
  scheduler,
}: Pick<OverviewData, 'health' | 'scheduler'>) {
  const apiState = health
    ? health.status === 'ok'
      ? { label: 'API online', tone: 'success' as const }
      : { label: 'API requer atenção', tone: 'warning' as const }
    : { label: 'API não disponível', tone: 'neutral' as const };
  const agendaState = scheduler
    ? scheduler.status === 'registered'
      ? { label: 'Agenda pronta', tone: 'success' as const }
      : { label: 'Agenda aguardando', tone: 'warning' as const }
    : { label: 'Agenda não disponível', tone: 'neutral' as const };

  return (
    <div className="ops-home-system-line" aria-label="Estado do sistema">
      <span><HeartPulse size={15} aria-hidden="true" /> Sistema</span>
      <OpsBadge tone={apiState.tone}>{apiState.label}</OpsBadge>
      <OpsBadge tone={agendaState.tone}>{agendaState.label}</OpsBadge>
    </div>
  );
}

function AutomationCard({
  health,
  status,
  scheduler,
  admin,
}: Pick<OverviewData, 'health' | 'status' | 'scheduler' | 'admin'>) {
  const presentation = homeAutomationPresentation(status, scheduler);
  const timezone = admin?.automation.timezone ?? status?.timezone ?? scheduler?.timezone ?? DEFAULT_TIMEZONE;
  const windowStart = admin?.automation.allowedStartTime ?? status?.allowedStartTime;
  const windowEnd = admin?.automation.allowedEndTime ?? status?.allowedEndTime;
  const windowLabel = windowStart && windowEnd ? `${windowStart}–${windowEnd}` : 'Não disponível';

  return (
    <section className="ops-home-automation" aria-labelledby="home-automation-title">
      <div className="ops-home-automation-top">
        <div className="ops-home-automation-icon" aria-hidden="true"><BadgeCheck size={22} /></div>
        <div className="min-w-0">
          <p className="ops-eyebrow">Controle diário</p>
          <h2 id="home-automation-title" className="ops-home-card-title">Automação</h2>
        </div>
        <OpsBadge tone={presentation.tone}>{presentation.label}</OpsBadge>
      </div>
      <p className="ops-home-automation-detail">{presentation.detail}</p>
      <div className="ops-home-automation-meta">
        <div>
          <span>Próximo envio</span>
          <strong>{formatHomeTime(admin?.nextSendAt, timezone)}</strong>
        </div>
        <div>
          <span>Janela de envio</span>
          <strong>{windowLabel}</strong>
        </div>
        <div>
          <span>Fuso horário</span>
          <strong>{timezone}</strong>
        </div>
      </div>
      <HomeSystemLine health={health} scheduler={scheduler} />
      <Link className="ops-button ops-button--secondary" href="/automacao">
        Ver automação <ArrowUpRight size={14} aria-hidden="true" />
      </Link>
    </section>
  );
}

function SummaryMetric({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Clock3;
}) {
  return (
    <div className="ops-home-summary-item">
      <div className="ops-home-summary-label"><Icon size={15} aria-hidden="true" />{label}</div>
      <strong className="ops-home-summary-value">{value}</strong>
      <span className="ops-home-summary-detail">{detail}</span>
    </div>
  );
}

function TodaySummary({ admin, status }: Pick<OverviewData, 'admin' | 'status'>) {
  const activeGroups = admin
    ? admin.groups.filter((group) => group.active && !group.paused).length
    : null;
  const activeInstances = admin ? admin.instances.filter((instance) => instance.active).length : null;
  const timezone = admin?.automation.timezone ?? status?.timezone ?? DEFAULT_TIMEZONE;

  return (
    <OpsSection title="Hoje" meta="Um resumo simples do que está acontecendo agora." className="ops-home-summary">
      <div className="ops-home-summary-grid">
        <SummaryMetric
          icon={Send}
          label="Envios hoje"
          value={status ? `${formatNumber(status.globalSentToday)} de ${formatNumber(status.dailyGlobalLimit)}` : 'Não disponível'}
          detail={status ? 'mensagens realizadas' : 'A API não informou'}
        />
        <SummaryMetric
          icon={Clock3}
          label="Próximo envio"
          value={formatHomeTime(admin?.nextSendAt, timezone)}
          detail={admin?.nextSendAt ? timezone : 'Sem agenda informada'}
        />
        <SummaryMetric
          icon={UsersRound}
          label="Grupos em operação"
          value={activeGroups === null ? 'Não disponível' : formatNumber(activeGroups)}
          detail={activeGroups === null ? 'A API não informou' : 'ativos e sem pausa'}
        />
        <SummaryMetric
          icon={HeartPulse}
          label="Instâncias ativas"
          value={activeInstances === null ? 'Não disponível' : formatNumber(activeInstances)}
          detail={activeInstances === null ? 'A API não informou' : 'estado ativo informado'}
        />
      </div>
    </OpsSection>
  );
}

function AttentionPanel({ data }: { data: OverviewData }) {
  const attention = useMemo(() => {
    const messages: string[] = [];
    const add = (message: string) => {
      if (!messages.includes(message)) messages.push(message);
    };

    if (data.partialFailures.length > 0) {
      add('Algumas informações estão desatualizadas. Tente atualizar novamente.');
    }
    if (data.status?.paused) add('A automação está desligada.');
    for (const reason of data.status?.reasons ?? []) add(translateHomeReason(reason));
    if (data.status && !data.status.allowed && data.status.reasons.length === 0) {
      add('A automação ainda não está pronta para o próximo envio.');
    }
    for (const blocker of data.admin?.blockers ?? []) add(translateHomeReason(blocker.code));
    if ((data.admin?.ambiguity ?? 0) > 0) add('Existe um envio que precisa de verificação manual.');
    if ((data.admin?.investigationRequired ?? 0) > 0) add('Existe uma pendência que precisa de verificação manual.');
    if (data.dispatches.some((dispatch) => dispatch.status === 'PROCESSING')) add('Há um envio aguardando confirmação.');
    if (data.dispatches.some((dispatch) => dispatch.status === 'FAILED')) add('Há um envio que não foi realizado.');
    if (data.health && data.health.status !== 'ok') add('A API informou que precisa de atenção.');
    if (!data.scheduler || data.scheduler.status !== 'registered') add('A agenda automática não está disponível neste momento.');

    return messages;
  }, [data]);

  return (
    <OpsSection
      title="Precisa da sua atenção"
      meta={attention.length > 0 ? 'Veja o próximo passo antes de continuar.' : 'Nenhuma pendência identificada na última leitura.'}
      className="ops-home-attention"
    >
      {attention.length === 0 ? (
        <div className="ops-home-attention-clear"><CheckCircle2 size={18} aria-hidden="true" /><span>Tudo certo por aqui.</span></div>
      ) : (
        <ul className="ops-home-attention-list">
          {attention.map((message) => (
            <li key={message}>
              <Circle className="ops-home-attention-marker" size={10} aria-hidden="true" />
              <span>{message}</span>
              {message.includes('automação') ? <Link className="ops-home-attention-link" href="/automacao">Abrir automação <ArrowUpRight size={13} aria-hidden="true" /></Link> : null}
            </li>
          ))}
        </ul>
      )}
    </OpsSection>
  );
}

function LatestSend({ dispatch, timezone, available }: { dispatch: WhatsAppDispatch | null; timezone: string; available: boolean }) {
  if (!available) {
    return <OpsEmpty title="Envios indisponíveis" message="Não foi possível consultar o histórico de envios agora." />;
  }
  if (!dispatch) {
    return <OpsEmpty title="Nenhum envio registrado" message="O histórico aparecerá aqui quando houver um envio." />;
  }

  return (
    <div className="ops-home-latest-card">
      <div className="ops-home-latest-product">
        <SafeProductImage className="ops-product-image" src={dispatch.product?.urlImagem} />
        <div className="min-w-0">
          <strong>{dispatch.product?.nome ?? 'Produto não informado'}</strong>
          <span>{dispatch.destination?.name ?? 'Grupo não informado'}</span>
        </div>
      </div>
      <div className="ops-home-latest-meta">
        <OpsBadge tone={toneForStatus(dispatch.status)}>{translateHomeDispatchStatus(dispatch.status)}</OpsBadge>
        <span>{formatHomeTime(dispatch.sentAt ?? dispatch.createdAt, timezone, 'medium')}</span>
      </div>
      <Link className="ops-button ops-button--secondary" href="/envios">
        Ver histórico <ArrowUpRight size={14} aria-hidden="true" />
      </Link>
    </div>
  );
}

function DeliveryJourney({ dispatch, available }: { dispatch: WhatsAppDispatch | null; available: boolean }) {
  if (!available) {
    return <OpsEmpty title="Jornada indisponível" message="Não foi possível consultar as etapas do último envio agora." />;
  }
  if (!dispatch) {
    return <OpsEmpty title="Sem dados para mostrar" message="A jornada ficará disponível junto com o próximo envio registrado." />;
  }

  const candidateReady = Boolean(dispatch.generatedCopy?.createdFromCandidateId);
  const copyReady = Boolean(dispatch.generatedCopy);
  const isFailed = dispatch.status === 'FAILED';
  const stateFor = (available: boolean, complete: boolean) => {
    if (!available) return 'missing';
    if (complete) return 'complete';
    return isFailed ? 'blocked' : 'current';
  };
  const stages = [
    { label: 'Produto', value: dispatch.product?.nome ?? 'Não disponível', available: Boolean(dispatch.product), complete: Boolean(dispatch.product), Icon: Package },
    { label: 'Oferta selecionada', value: candidateReady ? 'Selecionada' : 'Não disponível', available: candidateReady, complete: candidateReady, Icon: Tag },
    { label: 'Texto preparado', value: copyReady ? 'Pronto para o envio' : 'Não disponível', available: copyReady, complete: copyReady, Icon: FileText },
    { label: 'Envio', value: translateHomeDispatchStatus(dispatch.status), available: true, complete: dispatch.status === 'SENT', Icon: Send },
    { label: 'Grupo', value: dispatch.destination?.name ?? 'Não disponível', available: Boolean(dispatch.destination), complete: Boolean(dispatch.destination), Icon: UsersRound },
    { label: 'Enviado', value: translateHomeDispatchStatus(dispatch.status), available: true, complete: dispatch.status === 'SENT', Icon: CheckCircle2 },
  ] as const;

  return (
    <ol className="ops-home-journey-list" aria-label="Jornada do envio: produto, oferta, texto, envio, grupo e enviado">
      {stages.map(({ label, value, available, complete, Icon }) => {
        const state = stateFor(available, complete);
        return (
          <li className="ops-home-journey-stage" data-state={state} key={label}>
            <span className="ops-home-journey-icon"><Icon size={15} aria-hidden="true" /></span>
            <span className="ops-home-journey-label">{label}</span>
            <span className="ops-home-journey-value">{value}</span>
          </li>
        );
      })}
    </ol>
  );
}

function RecentActivity({
  executions,
  dispatches,
  timezone,
  available,
}: Pick<OverviewData, 'executions' | 'dispatches'> & { timezone: string; available: boolean }) {
  const activity = useMemo(() => {
    const executionRows = executions.map((execution) => ({
      id: `execution-${execution.id}`,
      time: execution.completedAt ?? execution.startedAt,
      title: translateHomeExecutionStatus(execution.status),
      detail: execution.status === 'BLOCKED' ? translateHomeReason(execution.reasons[0] ?? '') : 'A automação registrou uma nova atividade.',
      status: execution.status,
    }));
    const dispatchRows = dispatches.map((dispatch) => ({
      id: `dispatch-${dispatch.id}`,
      time: dispatch.sentAt ?? dispatch.createdAt ?? null,
      title: translateHomeDispatchStatus(dispatch.status),
      detail: `${dispatch.product?.nome ?? 'Produto não informado'} · ${dispatch.destination?.name ?? 'Grupo não informado'}`,
      status: dispatch.status,
    }));
    return [...executionRows, ...dispatchRows]
      .sort((a, b) => new Date(b.time ?? 0).getTime() - new Date(a.time ?? 0).getTime())
      .slice(0, 5);
  }, [dispatches, executions]);

  if (!available) {
    return <OpsEmpty title="Atividade indisponível" message="Não foi possível consultar a atividade recente agora." />;
  }
  if (activity.length === 0) {
    return <OpsEmpty title="Nenhuma atividade recente" message="A atividade da automação aparecerá aqui." />;
  }

  return (
    <ol className="ops-home-activity-list" aria-label="Atividade recente">
      {activity.map((item) => (
        <li className="ops-home-activity-row" key={item.id}>
          <span className="ops-home-activity-icon" data-tone={toneForStatus(item.status)} aria-hidden="true"><Clock3 size={15} /></span>
          <div className="min-w-0">
            <strong>{item.title}</strong>
            <span>{item.detail}</span>
          </div>
          <div className="ops-home-activity-time">
            <OpsBadge tone={toneForStatus(item.status)}>{item.title}</OpsBadge>
            <time dateTime={item.time ?? undefined}>{formatHomeTime(item.time, timezone)}</time>
          </div>
        </li>
      ))}
    </ol>
  );
}

export default function OverviewPage() {
  const [data, setData] = useState<OverviewData | null>(null);
  const dataRef = useRef<OverviewData | null>(null);
  const inFlightRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<'partial' | 'unavailable' | null>(null);

  const load = useCallback(async (initial = false) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    if (initial) setLoading(true); else setRefreshing(true);

    const results = await Promise.allSettled([
      getHealth(),
      getCommercialAutomationStatus(),
      getCommercialAutomationSchedulerStatus(),
      getOperationalAdmin(),
      listCommercialAutomationExecutions(1, 10),
      listDispatches(),
    ]);
    const labels = ['health', 'status', 'scheduler', 'admin', 'executions', 'dispatches'];
    const partialFailures = results.flatMap((result, index) => result.status === 'rejected' ? [labels[index]] : []);
    const successfulReads = results.some((result) => result.status === 'fulfilled');
    const previous = dataRef.current;
    const next: OverviewData = {
      health: results[0].status === 'fulfilled' ? results[0].value : previous?.health ?? null,
      status: results[1].status === 'fulfilled' ? results[1].value : previous?.status ?? null,
      scheduler: results[2].status === 'fulfilled' ? results[2].value : previous?.scheduler ?? null,
      admin: results[3].status === 'fulfilled' ? results[3].value : previous?.admin ?? null,
      executions: results[4].status === 'fulfilled' ? results[4].value.items : previous?.executions ?? [],
      dispatches: results[5].status === 'fulfilled' ? results[5].value : previous?.dispatches ?? [],
      sourceAvailability: {
        executions: results[4].status === 'fulfilled' || Boolean(previous?.sourceAvailability.executions),
        dispatches: results[5].status === 'fulfilled' || Boolean(previous?.sourceAvailability.dispatches),
      },
      partialFailures,
      lastUpdatedAt: successfulReads ? new Date().toISOString() : previous?.lastUpdatedAt ?? null,
    };
    dataRef.current = next;
    setData(next);
    setError(partialFailures.length === results.length ? 'unavailable' : partialFailures.length > 0 ? 'partial' : null);
    setLoading(false);
    setRefreshing(false);
    inFlightRef.current = false;
  }, []);

  useEffect(() => {
    void load(true);
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') void load();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const latestDispatch = useMemo(
    () => [...(data?.dispatches ?? [])].sort((a, b) => dispatchSortValue(b) - dispatchSortValue(a))[0] ?? null,
    [data?.dispatches],
  );
  const timezone = data?.admin?.automation.timezone ?? data?.status?.timezone ?? data?.scheduler?.timezone ?? DEFAULT_TIMEZONE;

  return (
    <>
      <OpsPageHeading
        eyebrow="Operação diária"
        title="Início"
        description="Acompanhe a automação, os envios e o que precisa da sua atenção."
        actions={
          <div className="ops-home-heading-actions">
            <button type="button" className="ops-button" onClick={() => void load()} disabled={refreshing}>
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" /> Atualizar
            </button>
            {data?.lastUpdatedAt ? <span>Última atualização: {formatHomeTime(data.lastUpdatedAt, timezone)}</span> : null}
          </div>
        }
      />
      {loading ? <OpsLoading label="Carregando sua visão diária" /> : null}
      {error ? (
        <OpsState
          title={error === 'unavailable' ? 'Não foi possível atualizar a visão diária' : 'Algumas informações estão desatualizadas'}
          message="Os dados disponíveis continuam visíveis. Tente atualizar novamente quando a API estiver disponível."
          tone="warning"
          action={<button className="ops-button" type="button" onClick={() => void load()} disabled={refreshing}>Tentar novamente</button>}
        />
      ) : null}
      {data ? (
        <div className="ops-home-layout">
          <AutomationCard health={data.health} status={data.status} scheduler={data.scheduler} admin={data.admin} />
          <TodaySummary admin={data.admin} status={data.status} />
          <AttentionPanel data={data} />
          <div className="ops-home-lower">
            <OpsSection title="Último envio" meta={latestDispatch ? 'A atividade mais recente registrada.' : data.sourceAvailability.dispatches ? 'Ainda não há envios registrados.' : 'Histórico indisponível no momento.'}>
              <LatestSend dispatch={latestDispatch} timezone={timezone} available={data.sourceAvailability.dispatches} />
            </OpsSection>
            <OpsSection title="Como o envio acontece" meta="Acompanhe cada etapa em linguagem simples.">
              <DeliveryJourney dispatch={latestDispatch} available={data.sourceAvailability.dispatches} />
            </OpsSection>
          </div>
          <OpsSection title="Atividade recente" meta="Os cinco registros mais recentes." actions={<Link className="ops-button ops-button--secondary" href="/envios">Ver histórico <ArrowUpRight size={14} aria-hidden="true" /></Link>}>
            <RecentActivity executions={data.executions} dispatches={data.dispatches} timezone={timezone} available={data.sourceAvailability.executions && data.sourceAvailability.dispatches} />
          </OpsSection>
        </div>
      ) : null}
    </>
  );
}
