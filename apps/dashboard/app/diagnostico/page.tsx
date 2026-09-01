'use client';

import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Clock3,
  Code2,
  Database,
  FileClock,
  Layers3,
  ListChecks,
  MessageSquareText,
  Network,
  Server,
  ShieldCheck,
  TimerReset,
} from 'lucide-react';
import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  CopyIdButton,
  OpsBadge,
  OpsEmpty,
  OpsLoading,
  OpsPageHeading,
  OpsSection,
  OpsState,
  RefreshButton,
  toneForStatus,
} from '../../components/ops-components';
import {
  getCommercialAutomationSchedulerStatus,
  getCommercialAutomationStatus,
  getHealth,
  getOperationalAdmin,
  listCommercialAutomationExecutions,
  listCommercialDispatchOutbox,
  listDispatches,
  type CommercialAutomationExecution,
  type CommercialAutomationSchedulerStatus,
  type CommercialAutomationStatus,
  type CommercialDispatchOutbox,
  type HealthResponse,
  type OperationalAdmin,
  type OperationalAdminBlocker,
  type OperationalAdminGroup,
  type OperationalAdminInstance,
  type WhatsAppDispatch,
} from '../../lib/api';
import { formatDateTime, formatNumber } from '../../lib/format';

const DIAGNOSTIC_PAGE_SIZE = 20;

type ReadState<T> = {
  value: T | null;
  loading: boolean;
  error: boolean;
  stale: boolean;
};

type DiagnosticSnapshot = {
  health: ReadState<HealthResponse>;
  automation: ReadState<CommercialAutomationStatus>;
  scheduler: ReadState<CommercialAutomationSchedulerStatus>;
  operational: ReadState<OperationalAdmin>;
  executions: ReadState<
    Awaited<ReturnType<typeof listCommercialAutomationExecutions>>
  >;
  outbox: ReadState<Awaited<ReturnType<typeof listCommercialDispatchOutbox>>>;
  dispatches: ReadState<WhatsAppDispatch[]>;
};

type ReadResult<T> = { ok: true; value: T } | { ok: false };

const initialReadState = <T,>(): ReadState<T> => ({
  value: null,
  loading: true,
  error: false,
  stale: false,
});

const initialSnapshot: DiagnosticSnapshot = {
  health: initialReadState(),
  automation: initialReadState(),
  scheduler: initialReadState(),
  operational: initialReadState(),
  executions: initialReadState(),
  outbox: initialReadState(),
  dispatches: initialReadState(),
};

const read = async <T,>(request: Promise<T>): Promise<ReadResult<T>> => {
  try {
    return { ok: true, value: await request };
  } catch {
    return { ok: false };
  }
};

const resolveRead = <T,>(
  previous: ReadState<T>,
  result: ReadResult<T>,
): ReadState<T> =>
  result.ok
    ? { value: result.value, loading: false, error: false, stale: false }
    : {
        ...previous,
        loading: false,
        error: true,
        stale: previous.value !== null,
      };

const markLoading = <T,>(state: ReadState<T>): ReadState<T> => ({
  ...state,
  loading: true,
  error: false,
});

function displayValue(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined || value === '') {
    return 'Não disponível';
  }
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  return String(value);
}

function dateValue(value: string | null | undefined) {
  return value ? formatDateTime(value) : 'Não disponível';
}

function TechnicalField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string | number | boolean | null | undefined;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="ops-detail-label">{label}</dt>
      <dd
        className={
          mono ? 'ops-detail-value ops-mono break-words' : 'ops-detail-value'
        }
      >
        {displayValue(value)}
      </dd>
    </div>
  );
}

function TechnicalId({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="min-w-0">
      <dt className="ops-detail-label">{label}</dt>
      <dd className="ops-detail-value">
        <CopyIdButton value={value} />
      </dd>
    </div>
  );
}

function ReadResource<T>({
  state,
  loadingLabel,
  errorTitle,
  errorMessage,
  emptyTitle,
  emptyMessage,
  children,
}: {
  state: ReadState<T>;
  loadingLabel: string;
  errorTitle: string;
  errorMessage: string;
  emptyTitle?: string;
  emptyMessage?: string;
  children: (value: T) => ReactNode;
}) {
  if (state.value === null && state.loading) {
    return <OpsLoading label={loadingLabel} />;
  }

  if (state.value === null && state.error) {
    return <OpsState title={errorTitle} message={errorMessage} tone="danger" />;
  }

  if (state.value === null) {
    return (
      <OpsEmpty
        title={emptyTitle ?? 'Dados não disponíveis'}
        message={emptyMessage ?? 'A API não retornou dados para esta leitura.'}
      />
    );
  }

  return (
    <>
      {state.loading ? (
        <p className="mb-4 text-xs text-slate-500" role="status">
          Atualizando esta leitura…
        </p>
      ) : null}
      {state.error ? (
        <p className="mb-4 text-sm leading-6 text-amber-800" role="alert">
          A atualização falhou. Abaixo está a última leitura disponível.
        </p>
      ) : null}
      {children(state.value)}
    </>
  );
}

function StatusCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
}) {
  return (
    <div className="min-w-0 rounded-md border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-slate-100 text-slate-700">
          <Icon size={17} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-xs text-slate-500">{label}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <OpsBadge tone={tone}>{value}</OpsBadge>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReasonCodes({ reasons }: { reasons: string[] }) {
  return (
    <div className="mt-4 border-t border-slate-100 pt-4">
      <p className="ops-detail-label">Códigos técnicos</p>
      {reasons.length === 0 ? (
        <p className="mt-1 text-sm text-slate-600">
          Nenhum código de bloqueio retornado.
        </p>
      ) : (
        <ul
          className="mt-2 grid gap-2"
          aria-label="Códigos técnicos da automação"
        >
          {reasons.map((reason) => (
            <li
              key={reason}
              className="ops-mono break-words text-xs text-slate-700"
            >
              {reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BlockerList({ blockers }: { blockers: OperationalAdminBlocker[] }) {
  if (blockers.length === 0) {
    return (
      <p className="text-sm text-slate-600">Nenhuma pendência registrada.</p>
    );
  }

  return (
    <ul className="grid gap-2" aria-label="Pendências técnicas">
      {blockers.map((blocker, index) => (
        <li
          key={`${blocker.scope}-${blocker.code}-${blocker.entityId ?? 'global'}-${index}`}
          className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"
        >
          <span className="ops-mono break-words">{blocker.code}</span>
          <span className="ml-2 text-xs text-amber-800">{blocker.scope}</span>
          {blocker.entityId ? (
            <span className="ml-2 ops-mono break-all text-xs text-amber-800">
              {blocker.entityId}
            </span>
          ) : null}
          {blocker.nextEligibleAt ? (
            <span className="mt-1 block text-xs text-amber-800">
              Próximo momento: {dateValue(blocker.nextEligibleAt)}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function QueueCard({
  label,
  counts,
}: {
  label: string;
  counts: OperationalAdmin['queues']['productPipeline'];
}) {
  return (
    <div className="min-w-0 rounded-md border border-slate-200 bg-slate-50 p-4">
      <h3 className="text-sm font-semibold text-slate-950">{label}</h3>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <TechnicalField label="Aguardando" value={counts.waiting} />
        <TechnicalField label="Ativos" value={counts.active} />
        <TechnicalField label="Atrasados" value={counts.delayed} />
        <TechnicalField label="Prioridade" value={counts.prioritized} />
      </dl>
    </div>
  );
}

function ExecutionCard({
  execution,
}: {
  execution: CommercialAutomationExecution;
}) {
  const uncertain = ['PROCESSING', 'AMBIGUOUS'].includes(
    execution.status.toUpperCase(),
  );
  return (
    <article className="min-w-0 rounded-md border border-slate-200 bg-white p-4">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <OpsBadge tone={toneForStatus(execution.status)}>
          {execution.status}
        </OpsBadge>
        <OpsBadge tone="neutral">{execution.mode}</OpsBadge>
        {execution.stale ? <OpsBadge tone="warning">stale</OpsBadge> : null}
      </div>
      <dl className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <TechnicalId label="Execution ID" value={execution.id} />
        <TechnicalId
          label="Scheduler job ID"
          value={execution.schedulerJobId}
        />
        <TechnicalId label="BullMQ job ID" value={execution.bullMqJobId} />
        <TechnicalId label="Run comercial" value={execution.commercialRunId} />
        <TechnicalField label="Início" value={dateValue(execution.startedAt)} />
        <TechnicalField
          label="Conclusão"
          value={dateValue(execution.completedAt)}
        />
        <TechnicalField
          label="Heartbeat"
          value={dateValue(execution.heartbeatAt)}
        />
        <TechnicalField
          label="Expiração do lease"
          value={dateValue(execution.leaseExpiresAt)}
        />
        <TechnicalField label="Stale" value={execution.stale} />
      </dl>
      {execution.failureCode ? (
        <p className="mt-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
          Código de falha:{' '}
          <span className="ops-mono break-words">{execution.failureCode}</span>
        </p>
      ) : null}
      <ReasonCodes reasons={execution.reasons} />
      {uncertain ? (
        <p className="mt-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-950">
          <AlertTriangle
            size={16}
            className="mt-0.5 shrink-0"
            aria-hidden="true"
          />
          <span>
            Resultado potencialmente incerto. Exige investigação manual.
          </span>
        </p>
      ) : null}
    </article>
  );
}

function OutboxCard({ outbox }: { outbox: CommercialDispatchOutbox }) {
  const uncertain = outbox.status.toUpperCase() === 'AMBIGUOUS';
  return (
    <article className="min-w-0 rounded-md border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <OpsBadge tone={toneForStatus(outbox.status)}>
          {outbox.status.toUpperCase()}
        </OpsBadge>
        {uncertain ? <OpsBadge tone="warning">investigação</OpsBadge> : null}
      </div>
      <dl className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <TechnicalId label="Outbox ID" value={outbox.id} />
        <TechnicalId label="Run comercial" value={outbox.commercialRunId} />
        <TechnicalId label="Dispatch ID" value={outbox.dispatchId} />
        <TechnicalId label="Job ID" value={outbox.jobId} />
        <TechnicalField label="Criado em" value={dateValue(outbox.createdAt)} />
        <TechnicalField
          label="Publicado em"
          value={dateValue(outbox.publishedAt)}
        />
        <TechnicalField
          label="Código de falha"
          value={outbox.failureCode}
          mono
        />
      </dl>
      {uncertain ? (
        <p className="mt-4 text-sm leading-6 text-amber-900">
          Este registro não comprova o resultado externo. Exige investigação
          manual.
        </p>
      ) : null}
    </article>
  );
}

function DispatchCard({ dispatch }: { dispatch: WhatsAppDispatch }) {
  const uncertain = dispatch.status === 'PROCESSING';
  return (
    <article className="min-w-0 rounded-md border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <OpsBadge tone={toneForStatus(dispatch.status)}>
          {dispatch.status}
        </OpsBadge>
        {dispatch.provider ? (
          <OpsBadge tone="neutral">{dispatch.provider}</OpsBadge>
        ) : null}
      </div>
      <dl className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <TechnicalId label="Dispatch ID" value={dispatch.id} />
        <TechnicalId label="Produto" value={dispatch.productId} />
        <TechnicalId
          label="Texto registrado"
          value={dispatch.generatedCopyId}
        />
        <TechnicalId
          label="Grupo/destino"
          value={dispatch.destination?.id ?? dispatch.destinationId}
        />
        <TechnicalId
          label="Candidate"
          value={dispatch.generatedCopy?.createdFromCandidateId}
        />
        <TechnicalId label="ID externo" value={dispatch.externalMessageId} />
        <TechnicalField
          label="Nome do grupo"
          value={dispatch.destination?.name}
        />
        <TechnicalField label="Modo de entrega" value={dispatch.deliveryMode} />
        <TechnicalField label="Tentativas" value={dispatch.attemptCount} />
        <TechnicalField
          label="Criado em"
          value={dateValue(dispatch.createdAt)}
        />
        <TechnicalField label="Enviado em" value={dateValue(dispatch.sentAt)} />
        <TechnicalField
          label="Erro registrado"
          value={dispatch.errorMessage ? 'Sim' : 'Não'}
        />
      </dl>
      {uncertain ? (
        <p className="mt-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-950">
          <AlertTriangle
            size={16}
            className="mt-0.5 shrink-0"
            aria-hidden="true"
          />
          <span>
            PROCESSING permanece potencialmente incerto e exige investigação
            manual.
          </span>
        </p>
      ) : null}
    </article>
  );
}

function InstanceCard({ instance }: { instance: OperationalAdminInstance }) {
  return (
    <article className="min-w-0 rounded-md border border-slate-200 bg-white p-4">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Server size={16} className="text-slate-500" aria-hidden="true" />
        <h3 className="min-w-0 break-words text-sm font-semibold text-slate-950">
          {instance.name}
        </h3>
        <OpsBadge tone={instance.active ? 'success' : 'neutral'}>
          {instance.active ? 'ATIVA' : 'INATIVA'}
        </OpsBadge>
        <OpsBadge tone={instance.paused ? 'warning' : 'success'}>
          {instance.paused ? 'PAUSADA' : 'OPERANDO'}
        </OpsBadge>
      </div>
      <dl className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2">
        <TechnicalField label="Health retornado" value={instance.health} mono />
        <TechnicalField
          label="Grupos atribuídos"
          value={instance.assignedGroupCount}
        />
        <TechnicalField
          label="Último envio"
          value={dateValue(instance.lastSendAt)}
        />
        <TechnicalField
          label="Próximo envio"
          value={dateValue(instance.nextSendAt)}
        />
        <TechnicalField
          label="Atualizado em"
          value={dateValue(instance.updatedAt)}
        />
      </dl>
      <div className="mt-4 border-t border-slate-100 pt-4">
        <p className="ops-detail-label">Pendências</p>
        <div className="mt-2">
          <BlockerList blockers={instance.blockers} />
        </div>
      </div>
    </article>
  );
}

function GroupCard({ group }: { group: OperationalAdminGroup }) {
  return (
    <article className="min-w-0 rounded-md border border-slate-200 bg-white p-4">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Network size={16} className="text-slate-500" aria-hidden="true" />
        <h3 className="min-w-0 break-words text-sm font-semibold text-slate-950">
          {group.name}
        </h3>
        <OpsBadge tone={group.active ? 'success' : 'neutral'}>
          {group.active ? 'ATIVO' : 'INATIVO'}
        </OpsBadge>
        <OpsBadge tone={group.available ? 'success' : 'warning'}>
          {group.available ? 'DISPONÍVEL' : 'INDISPONÍVEL'}
        </OpsBadge>
      </div>
      <dl className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2">
        <TechnicalId label="Group ID" value={group.id} />
        <TechnicalField label="Fingerprint" value={group.fingerprint} mono />
        <TechnicalField
          label="Número responsável"
          value={group.assignedInstanceName}
        />
        <TechnicalField
          label="Instância de origem"
          value={group.sourceInstanceName}
        />
        <TechnicalField label="Campanha" value={group.campaign?.name} />
        <TechnicalField label="Nicho" value={group.niche?.name} />
        <TechnicalField
          label="Último envio"
          value={dateValue(group.lastSendAt)}
        />
        <TechnicalField
          label="Próximo envio"
          value={dateValue(group.nextSendAt)}
        />
        <TechnicalField
          label="Atualizado em"
          value={dateValue(group.updatedAt)}
        />
      </dl>
      <div className="mt-4 border-t border-slate-100 pt-4">
        <p className="ops-detail-label">Pendências</p>
        <div className="mt-2">
          <BlockerList blockers={group.blockers} />
        </div>
      </div>
    </article>
  );
}

const legacyLinks = [
  {
    href: '/pipeline',
    title: 'Pipeline legado',
    description: 'Consulta técnica de jobs existentes.',
  },
  {
    href: '/pipeline-comercial',
    title: 'Pipeline comercial',
    description: 'Histórico técnico de runs comerciais.',
  },
  {
    href: '/fila',
    title: 'Fila de ofertas',
    description: 'Consulta o ranking persistido da campanha.',
  },
  {
    href: '/copies',
    title: 'Textos registrados',
    description: 'Consulta técnica de textos já persistidos.',
  },
  {
    href: '/campanhas',
    title: 'Campanhas',
    description: 'Consulta a configuração das campanhas.',
  },
];

export default function DiagnosticsPage() {
  const [snapshot, setSnapshot] = useState<DiagnosticSnapshot>(initialSnapshot);
  const [refreshing, setRefreshing] = useState(false);
  const requestInFlight = useRef(false);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setRefreshing(true);
    setSnapshot((previous) => ({
      health: markLoading(previous.health),
      automation: markLoading(previous.automation),
      scheduler: markLoading(previous.scheduler),
      operational: markLoading(previous.operational),
      executions: markLoading(previous.executions),
      outbox: markLoading(previous.outbox),
      dispatches: markLoading(previous.dispatches),
    }));

    const [
      health,
      automation,
      scheduler,
      operational,
      executions,
      outbox,
      dispatches,
    ] = await Promise.all([
      read(getHealth()),
      read(getCommercialAutomationStatus()),
      read(getCommercialAutomationSchedulerStatus()),
      read(getOperationalAdmin()),
      read(listCommercialAutomationExecutions(1, DIAGNOSTIC_PAGE_SIZE)),
      read(listCommercialDispatchOutbox(1, DIAGNOSTIC_PAGE_SIZE)),
      read(listDispatches()),
    ]);

    if (mounted.current) {
      setSnapshot((previous) => ({
        health: resolveRead(previous.health, health),
        automation: resolveRead(previous.automation, automation),
        scheduler: resolveRead(previous.scheduler, scheduler),
        operational: resolveRead(previous.operational, operational),
        executions: resolveRead(previous.executions, executions),
        outbox: resolveRead(previous.outbox, outbox),
        dispatches: resolveRead(previous.dispatches, dispatches),
      }));
      setRefreshing(false);
    }
    requestInFlight.current = false;
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  const operational = snapshot.operational.value;

  return (
    <div className="grid gap-6">
      <OpsPageHeading
        eyebrow="Ferramentas técnicas"
        title="Diagnóstico avançado"
        description="Informações técnicas para investigação e manutenção do sistema."
        actions={
          <RefreshButton onClick={() => void load()} busy={refreshing} />
        }
      />

      <div
        className="flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700"
        role="note"
      >
        <ShieldCheck
          size={18}
          className="mt-0.5 shrink-0 text-slate-600"
          aria-hidden="true"
        />
        <p>
          Esta área é somente leitura. Ela não oferece ações de envio,
          recuperação ou alteração.
        </p>
      </div>
      <p className="sr-only" aria-live="polite">
        {refreshing ? 'Atualizando diagnóstico.' : 'Diagnóstico atualizado.'}
      </p>

      <OpsSection
        title="Visão técnica"
        meta="Leituras disponíveis nas APIs operacionais existentes."
      >
        <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <ReadResource
            state={snapshot.health}
            loadingLabel="Consultando saúde da API"
            errorTitle="Saúde da API indisponível"
            errorMessage="Não foi possível carregar a saúde da API."
          >
            {(health) => (
              <StatusCard
                icon={Activity}
                label="API"
                value={health.status === 'ok' ? 'Online' : 'Indisponível'}
                tone={health.status === 'ok' ? 'success' : 'danger'}
              />
            )}
          </ReadResource>
          <ReadResource
            state={snapshot.automation}
            loadingLabel="Consultando estado da automação"
            errorTitle="Automação indisponível"
            errorMessage="Não foi possível carregar o estado da automação."
          >
            {(status) => (
              <StatusCard
                icon={TimerReset}
                label="Automação"
                value={
                  status.paused
                    ? 'Pausada'
                    : status.allowed
                      ? 'Permitida'
                      : 'Bloqueada'
                }
                tone={
                  status.paused
                    ? 'warning'
                    : status.allowed
                      ? 'success'
                      : 'info'
                }
              />
            )}
          </ReadResource>
          <ReadResource
            state={snapshot.scheduler}
            loadingLabel="Consultando agenda automática"
            errorTitle="Agenda automática indisponível"
            errorMessage="Não foi possível carregar o estado da agenda."
          >
            {(scheduler) => (
              <StatusCard
                icon={Clock3}
                label="Agenda automática"
                value={scheduler.status}
                tone={scheduler.status === 'registered' ? 'success' : 'warning'}
              />
            )}
          </ReadResource>
          <ReadResource
            state={snapshot.operational}
            loadingLabel="Consultando atualização operacional"
            errorTitle="Leitura operacional indisponível"
            errorMessage="Não foi possível carregar os dados operacionais."
          >
            {(admin) => (
              <StatusCard
                icon={Database}
                label="Atualização"
                value={dateValue(admin.generatedAt)}
                tone="neutral"
              />
            )}
          </ReadResource>
        </div>
      </OpsSection>

      <OpsSection
        title="Automação"
        meta="Estado técnico, agenda e uso retornados pelo backend. Somente leitura."
      >
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <ReadResource
            state={snapshot.automation}
            loadingLabel="Consultando estado técnico da automação"
            errorTitle="Status da automação indisponível"
            errorMessage="Não foi possível carregar esta leitura."
          >
            {(status) => (
              <div className="min-w-0 rounded-md border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <OpsBadge
                    tone={
                      status.paused
                        ? 'warning'
                        : status.allowed
                          ? 'success'
                          : 'info'
                    }
                  >
                    {status.paused
                      ? 'PAUSED'
                      : status.allowed
                        ? 'ALLOWED'
                        : 'BLOCKED'}
                  </OpsBadge>
                  <span className="text-xs text-slate-500">
                    status da política
                  </span>
                </div>
                <dl className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2">
                  <TechnicalField label="Enabled" value={status.enabled} mono />
                  <TechnicalField label="Paused" value={status.paused} mono />
                  <TechnicalField label="Allowed" value={status.allowed} mono />
                  <TechnicalField
                    label="Próximo momento permitido"
                    value={dateValue(status.nextAllowedAt)}
                  />
                  <TechnicalField
                    label="Envios globais hoje"
                    value={status.globalSentToday}
                  />
                  <TechnicalField
                    label="Saldo global hoje"
                    value={status.globalRemainingToday}
                  />
                  <TechnicalField
                    label="Envios do grupo hoje"
                    value={status.groupSentToday}
                  />
                  <TechnicalField
                    label="Saldo do grupo hoje"
                    value={status.groupRemainingToday}
                  />
                  <TechnicalField
                    label="Último envio"
                    value={dateValue(status.lastSentAt)}
                  />
                  <TechnicalField
                    label="Atualizado em"
                    value={dateValue(status.updatedAt)}
                  />
                </dl>
                <ReasonCodes reasons={status.reasons} />
              </div>
            )}
          </ReadResource>
          <ReadResource
            state={snapshot.scheduler}
            loadingLabel="Consultando scheduler comercial"
            errorTitle="Scheduler comercial indisponível"
            errorMessage="Não foi possível carregar esta leitura."
          >
            {(scheduler) => (
              <div className="min-w-0 rounded-md border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <OpsBadge tone={toneForStatus(scheduler.status)}>
                    {scheduler.status}
                  </OpsBadge>
                  <OpsBadge tone="neutral">{scheduler.mode}</OpsBadge>
                </div>
                <dl className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2">
                  <TechnicalField
                    label="Enabled"
                    value={scheduler.enabled}
                    mono
                  />
                  <TechnicalField label="Fila" value={scheduler.queue} mono />
                  <TechnicalField
                    label="Nome do job"
                    value={scheduler.jobName}
                    mono
                  />
                  <TechnicalField label="Cron" value={scheduler.cron} mono />
                  <TechnicalField
                    label="Timezone"
                    value={scheduler.timezone}
                    mono
                  />
                  <TechnicalField
                    label="Próxima execução"
                    value={dateValue(scheduler.nextRunAt)}
                  />
                </dl>
                <div className="mt-4 border-t border-slate-100 pt-4">
                  <TechnicalId
                    label="Scheduler job ID"
                    value={scheduler.jobId}
                  />
                </div>
              </div>
            )}
          </ReadResource>
          <ReadResource
            state={snapshot.operational}
            loadingLabel="Consultando agenda persistida e budgets"
            errorTitle="Configuração técnica indisponível"
            errorMessage="Não foi possível carregar a configuração técnica."
          >
            {(admin) => (
              <div className="min-w-0 rounded-md border border-slate-200 bg-white p-4 lg:col-span-2">
                <div className="flex items-center gap-2">
                  <Layers3
                    size={17}
                    className="text-slate-500"
                    aria-hidden="true"
                  />
                  <h3 className="text-sm font-semibold text-slate-950">
                    Agenda persistida e uso de serviços
                  </h3>
                </div>
                <dl className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <TechnicalField
                    label="Versão da agenda"
                    value={admin.automation.scheduleRevision}
                    mono
                  />
                  <TechnicalField
                    label="Início da janela"
                    value={admin.automation.allowedStartTime}
                    mono
                  />
                  <TechnicalField
                    label="Fim da janela"
                    value={admin.automation.allowedEndTime}
                    mono
                  />
                  <TechnicalField
                    label="Timezone"
                    value={admin.automation.timezone}
                    mono
                  />
                  <TechnicalField
                    label="Intervalo mínimo"
                    value={`${admin.automation.minimumIntervalMinutes} min`}
                  />
                  <TechnicalField
                    label="Stagger"
                    value={`${admin.automation.staggerMinutes} min`}
                  />
                  <TechnicalField
                    label="Mensagens globais"
                    value={admin.automation.dailyGlobalLimit}
                  />
                  <TechnicalField
                    label="Mensagens por grupo"
                    value={admin.automation.dailyGroupLimit}
                  />
                  <TechnicalField
                    label="Shopee hoje"
                    value={`${admin.automation.providerUsage.shopee.used} / ${admin.automation.providerUsage.shopee.limit}`}
                  />
                  <TechnicalField
                    label="OpenAI hoje"
                    value={`${admin.automation.providerUsage.openAi.used} / ${admin.automation.providerUsage.openAi.limit}`}
                  />
                  <TechnicalField
                    label="Uso Shopee atingido"
                    value={admin.automation.providerUsage.shopee.reached}
                    mono
                  />
                  <TechnicalField
                    label="Uso OpenAI atingido"
                    value={admin.automation.providerUsage.openAi.reached}
                    mono
                  />
                </dl>
              </div>
            )}
          </ReadResource>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
          <Link href="/automacao" className="ops-button ops-button--secondary">
            Abrir Automação
            <ArrowUpRight size={15} aria-hidden="true" />
          </Link>
          <span className="text-xs text-slate-500">
            Os controles ficam na área operacional própria.
          </span>
        </div>
      </OpsSection>

      <OpsSection
        title="Execuções"
        meta="Até 20 registros da API paginada de automação comercial."
      >
        <ReadResource
          state={snapshot.executions}
          loadingLabel="Carregando execuções comerciais"
          errorTitle="Execuções indisponíveis"
          errorMessage="Não foi possível carregar execuções."
          emptyTitle="Nenhuma execução encontrada"
          emptyMessage="A API não retornou execuções comerciais para a página consultada."
        >
          {(page) => (
            <>
              {page.items.length === 0 ? (
                <OpsEmpty
                  title="Nenhuma execução encontrada"
                  message="A API não retornou execuções comerciais para a página consultada."
                />
              ) : (
                <div className="grid min-w-0 gap-3">
                  {page.items.map((execution) => (
                    <ExecutionCard execution={execution} key={execution.id} />
                  ))}
                </div>
              )}
              <p className="mt-4 text-xs text-slate-500">
                Página {page.page} de {page.totalPages} · total informado:{' '}
                {formatNumber(page.total)}
              </p>
            </>
          )}
        </ReadResource>
      </OpsSection>

      <OpsSection
        title="Fila e outbox"
        meta="A fila vem de operational-admin; ausência de dados não é tratada como zero."
      >
        <div className="grid min-w-0 gap-6 lg:grid-cols-2">
          <ReadResource
            state={snapshot.operational}
            loadingLabel="Carregando contagens de fila"
            errorTitle="Dados de fila indisponíveis"
            errorMessage="Não foi possível carregar as contagens authoritative da fila."
          >
            {(admin) => (
              <div className="grid min-w-0 gap-3">
                <QueueCard
                  label="Pipeline de ofertas"
                  counts={admin.queues.productPipeline}
                />
                <QueueCard
                  label="Automação comercial"
                  counts={admin.queues.commercialAutomation}
                />
                <QueueCard
                  label="Envios WhatsApp"
                  counts={admin.queues.whatsappDispatch}
                />
              </div>
            )}
          </ReadResource>
          <ReadResource
            state={snapshot.outbox}
            loadingLabel="Carregando outbox comercial"
            errorTitle="Outbox indisponível"
            errorMessage="Não foi possível carregar o outbox comercial."
            emptyTitle="Nenhum registro de outbox"
            emptyMessage="A API não retornou registros de outbox para a página consultada."
          >
            {(page) => (
              <>
                {page.items.length === 0 ? (
                  <OpsEmpty
                    title="Nenhum registro de outbox"
                    message="A API não retornou registros de outbox para a página consultada."
                  />
                ) : (
                  <div className="grid min-w-0 gap-3">
                    {page.items.map((outbox) => (
                      <OutboxCard outbox={outbox} key={outbox.id} />
                    ))}
                  </div>
                )}
                <p className="mt-4 text-xs text-slate-500">
                  Página {page.page} de {page.totalPages} · limite consultado:{' '}
                  {page.limit}
                </p>
              </>
            )}
          </ReadResource>
        </div>
      </OpsSection>

      <OpsSection
        title="Envios técnicos"
        meta="Detalhes persistidos do dispatch, sem texto comercial em massa nem ações de reenvio."
      >
        <ReadResource
          state={snapshot.dispatches}
          loadingLabel="Carregando dispatches"
          errorTitle="Dispatches indisponíveis"
          errorMessage="Não foi possível carregar os envios técnicos."
          emptyTitle="Nenhum envio técnico"
          emptyMessage="A API não retornou dispatches para esta leitura."
        >
          {(dispatches) => {
            const visibleDispatches = dispatches.slice(0, DIAGNOSTIC_PAGE_SIZE);
            return (
              <>
                {visibleDispatches.length === 0 ? (
                  <OpsEmpty
                    title="Nenhum envio técnico"
                    message="A API não retornou dispatches para esta leitura."
                  />
                ) : (
                  <div className="grid min-w-0 gap-3">
                    {visibleDispatches.map((dispatch) => (
                      <DispatchCard dispatch={dispatch} key={dispatch.id} />
                    ))}
                  </div>
                )}
                {dispatches.length > DIAGNOSTIC_PAGE_SIZE ? (
                  <p className="mt-4 text-xs text-slate-500">
                    A API de dispatch não oferece paginação neste contrato;
                    exibindo os primeiros {DIAGNOSTIC_PAGE_SIZE} registros
                    retornados.
                  </p>
                ) : null}
              </>
            );
          }}
        </ReadResource>
      </OpsSection>

      <OpsSection
        title="WhatsApp"
        meta="Instâncias, grupos, assignments e fingerprints retornados pelo estado operacional."
      >
        <ReadResource
          state={snapshot.operational}
          loadingLabel="Carregando instâncias e grupos"
          errorTitle="WhatsApp indisponível"
          errorMessage="Não foi possível carregar instâncias e grupos."
        >
          {(admin) => (
            <div className="grid min-w-0 gap-6">
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <MessageSquareText
                    size={17}
                    className="text-slate-500"
                    aria-hidden="true"
                  />
                  <h3 className="text-sm font-semibold text-slate-950">
                    Instâncias
                  </h3>
                </div>
                {admin.instances.length === 0 ? (
                  <OpsEmpty
                    title="Nenhuma instância retornada"
                    message="A API não informou instâncias para esta leitura."
                  />
                ) : (
                  <div className="grid min-w-0 gap-3 lg:grid-cols-2">
                    {admin.instances.map((instance) => (
                      <InstanceCard instance={instance} key={instance.name} />
                    ))}
                  </div>
                )}
              </div>
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <Network
                    size={17}
                    className="text-slate-500"
                    aria-hidden="true"
                  />
                  <h3 className="text-sm font-semibold text-slate-950">
                    Grupos e roteamento
                  </h3>
                </div>
                {admin.groups.length === 0 ? (
                  <OpsEmpty
                    title="Nenhum grupo retornado"
                    message="A API não informou grupos para esta leitura."
                  />
                ) : (
                  <div className="grid min-w-0 gap-3 lg:grid-cols-2">
                    {admin.groups.map((group) => (
                      <GroupCard group={group} key={group.id} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </ReadResource>
      </OpsSection>

      {operational ? (
        <OpsSection
          title="Pendências globais"
          meta="Códigos crus são exibidos somente nesta área técnica, sem interpretação automática."
        >
          <div className="grid min-w-0 gap-4 sm:grid-cols-3">
            <StatusCard
              icon={AlertTriangle}
              label="Investigation required"
              value={formatNumber(operational.investigationRequired)}
              tone={
                operational.investigationRequired > 0 ? 'danger' : 'success'
              }
            />
            <StatusCard
              icon={AlertTriangle}
              label="Ambiguity"
              value={formatNumber(operational.ambiguity)}
              tone={operational.ambiguity > 0 ? 'danger' : 'success'}
            />
            <StatusCard
              icon={ListChecks}
              label="Blockers"
              value={formatNumber(operational.blockers.length)}
              tone={operational.blockers.length > 0 ? 'warning' : 'success'}
            />
          </div>
          <div className="mt-4">
            <BlockerList blockers={operational.blockers} />
          </div>
        </OpsSection>
      ) : null}

      <OpsSection
        title="Ferramentas técnicas"
        meta="Links legados para diagnóstico e manutenção. Nenhum link executa uma ação nesta tela."
      >
        <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {legacyLinks.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="group min-w-0 rounded-md border border-slate-200 bg-white p-4 transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2"
            >
              <span className="flex items-center justify-between gap-3">
                <Code2
                  size={17}
                  className="shrink-0 text-slate-500"
                  aria-hidden="true"
                />
                <ArrowUpRight
                  size={16}
                  className="shrink-0 text-slate-400 group-hover:text-slate-700"
                  aria-hidden="true"
                />
              </span>
              <span className="mt-4 block min-w-0">
                <strong className="block break-words text-sm text-slate-950">
                  {item.title}
                </strong>
                <span className="mt-1 block text-sm leading-6 text-slate-600">
                  {item.description}
                </span>
                <span className="mt-3 block text-xs font-semibold text-slate-700">
                  Somente para diagnóstico/manutenção
                </span>
              </span>
            </Link>
          ))}
        </div>
      </OpsSection>

      <OpsSection title="Segurança desta área" className="ops-section--quiet">
        <div className="flex items-start gap-3 text-sm leading-6 text-slate-600">
          <FileClock
            size={18}
            className="mt-0.5 shrink-0 text-slate-500"
            aria-hidden="true"
          />
          <p>
            As leituras usam o proxy autenticado e não exibem credenciais,
            headers ou payloads completos.
          </p>
        </div>
      </OpsSection>
    </div>
  );
}
