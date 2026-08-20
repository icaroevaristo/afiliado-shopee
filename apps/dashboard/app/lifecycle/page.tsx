'use client';

import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Copy,
  GitBranch,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { EmptyState } from '../../components/empty-state';
import { ErrorState } from '../../components/error-state';
import { LoadingState } from '../../components/loading-state';
import { PageHeader } from '../../components/page-header';
import { StatusBadge } from '../../components/status-badge';
import {
  listCommercialLifecycles,
  type CommercialLifecycle,
  type CommercialLifecyclePage,
} from '../../lib/api';

const formatDate = (value: string | null | undefined) =>
  value
    ? new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'medium',
      }).format(new Date(value))
    : 'Nao disponivel';

const toneFor = (value: string | null | undefined) => {
  const normalized = value?.toUpperCase();
  if (normalized === 'SENT' || normalized === 'COMPLETED') return 'ok' as const;
  if (normalized === 'AMBIGUOUS' || normalized === 'PROCESSING') {
    return 'warning' as const;
  }
  if (normalized === 'FAILED') return 'error' as const;
  return 'neutral' as const;
};

const shortId = (value: string | null | undefined) =>
  value ? `${value.slice(0, 8)}...` : 'Nao disponivel';

function Summary({ summary }: { summary: CommercialLifecyclePage['summary'] }) {
  const cards = [
    ['Ativos', summary.activeExecutions],
    ['SENT hoje', summary.sentToday],
    ['Falhos', summary.failed],
    ['Ambiguos', summary.ambiguous],
    ['Investigacao', summary.investigationRequired],
    ['Reservas ativas', summary.activeReservations],
    ['Dispatch pendente', summary.pendingDispatches],
    ['Outbox pendente', summary.pendingOutboxes],
  ] as const;

  return (
    <section
      aria-label="Resumo do lifecycle"
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
    >
      {cards.map(([label, value]) => (
        <div
          key={label}
          className="rounded-lg border border-slate-200 bg-white p-4"
        >
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {label}
          </dt>
          <dd className="mt-2 text-2xl font-semibold text-slate-950">
            {value}
          </dd>
        </div>
      ))}
      <div className="rounded-lg border border-slate-200 bg-white p-4 sm:col-span-2 xl:col-span-4">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-600">
          <span>
            Recovery manual:{' '}
            <strong className="text-slate-950">
              {summary.manualRecoveries}
            </strong>
          </span>
          <span>
            Jobs waiting:{' '}
            <strong className="text-slate-950">
              {summary.jobs?.waiting ?? 'Indisponivel'}
            </strong>
          </span>
          <span>
            Jobs active:{' '}
            <strong className="text-slate-950">
              {summary.jobs?.active ?? 'Indisponivel'}
            </strong>
          </span>
          <span>
            Jobs failed:{' '}
            <strong className="text-slate-950">
              {summary.jobs?.failed ?? 'Indisponivel'}
            </strong>
          </span>
        </div>
      </div>
    </section>
  );
}

function LifecycleList({
  items,
  selectedId,
  onSelect,
}: {
  items: CommercialLifecycle[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <section aria-label="Lifecycles recentes" className="grid gap-3">
      {items.map((item) => {
        const status =
          item.run?.finalStatus ??
          item.dispatch?.status ??
          item.execution?.status;
        const title =
          item.candidate?.productName ??
          item.run?.productName ??
          'Lifecycle sem produto';
        const group =
          item.dispatch?.destinationName ??
          item.run?.groupName ??
          'Destino nao identificado';
        return (
          <button
            key={item.lifecycleId}
            type="button"
            aria-pressed={selectedId === item.lifecycleId}
            onClick={() => onSelect(item.lifecycleId)}
            className={`w-full rounded-lg border bg-white p-4 text-left transition hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-500 ${
              selectedId === item.lifecycleId
                ? 'border-slate-900 shadow-sm'
                : 'border-slate-200'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <GitBranch
                    className="h-4 w-4 shrink-0 text-slate-500"
                    aria-hidden="true"
                  />
                  <StatusBadge tone={toneFor(status)}>
                    {status ?? 'SEM ESTADO'}
                  </StatusBadge>
                  {item.run?.investigationRequired ? (
                    <StatusBadge tone="warning">INVESTIGACAO</StatusBadge>
                  ) : null}
                </div>
                <p className="mt-3 truncate font-medium text-slate-950">
                  {title}
                </p>
                <p className="mt-1 truncate text-sm text-slate-600">{group}</p>
              </div>
              <span className="shrink-0 text-xs text-slate-500">
                {formatDate(item.createdAt)}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-slate-500">
              <span>lifecycle {shortId(item.lifecycleId)}</span>
              {item.execution ? (
                <span>execution {shortId(item.execution.id)}</span>
              ) : null}
              {item.run ? <span>run {shortId(item.run.id)}</span> : null}
            </div>
          </button>
        );
      })}
    </section>
  );
}

function Detail({ item }: { item: CommercialLifecycle }) {
  const status =
    item.run?.finalStatus ?? item.dispatch?.status ?? item.execution?.status;
  const reservationLabel = item.reservation
    ? item.reservation.state === 'ABSENT'
      ? 'Sem evidencia de reserva'
      : item.reservation.state === 'UNKNOWN'
        ? 'Estado da reserva desconhecido'
        : item.reservation.state
    : 'Sem evidencia de reserva';

  return (
    <section className="grid gap-4">
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={toneFor(status)}>
            {status ?? 'SEM ESTADO'}
          </StatusBadge>
          {item.run?.investigationRequired ? (
            <StatusBadge tone="warning">INVESTIGACAO NECESSARIA</StatusBadge>
          ) : null}
          {item.recovery ? (
            <StatusBadge tone="warning">RECOVERY REGISTRADO</StatusBadge>
          ) : null}
        </div>
        <h2 className="mt-3 text-lg font-semibold text-slate-950">
          {item.candidate?.productName ??
            item.run?.productName ??
            'Lifecycle comercial'}
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          {item.dispatch?.destinationName ??
            item.run?.groupName ??
            'Destino nao identificado'}
        </p>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <Info label="Execution" value={item.execution?.id} mono />
          <Info label="Run" value={item.run?.id} mono />
          <Info label="Campaign" value={item.candidate?.campaignName} />
          <Info label="Candidate" value={item.candidate?.id} mono />
          <Info
            label="Produto"
            value={item.candidate?.productName ?? item.run?.productName}
          />
          <Info
            label="Rank / score"
            value={
              item.candidate
                ? `${item.candidate.rankPosition ?? '—'} / ${item.candidate.score}`
                : undefined
            }
          />
        </dl>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex items-center gap-2">
          <Clock3 className="h-4 w-4 text-slate-500" aria-hidden="true" />
          <h3 className="font-semibold text-slate-950">Timeline comprovada</h3>
        </div>
        {item.timeline.length > 0 ? (
          <ol className="mt-4 grid gap-3 border-l border-slate-200 pl-4">
            {item.timeline.map((event) => (
              <li key={`${event.type}-${event.at}`} className="relative">
                <span
                  className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-slate-500"
                  aria-hidden="true"
                />
                <p className="text-sm font-medium text-slate-900">
                  {event.label}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {formatDate(event.at)}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-4 text-sm text-slate-600">
            Nenhum evento persistido suficiente para montar a timeline.
          </p>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <DetailBlock
          title="Copy e tentativa"
          icon={<Copy className="h-4 w-4" aria-hidden="true" />}
        >
          <Info label="GeneratedCopy" value={item.copy?.id} mono />
          <Info label="Origem" value={item.copy?.source} />
          <Info
            label="Tentativa"
            value={item.copyAttempt?.status ?? 'Sem tentativa registrada'}
          />
          <Info
            label="Request pode ter iniciado"
            value={
              item.copyAttempt
                ? item.copyAttempt.requestMayHaveStarted
                  ? 'Sim'
                  : 'Nao'
                : undefined
            }
          />
        </DetailBlock>
        <DetailBlock
          title="Dispatch e outbox"
          icon={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
        >
          <Info label="Dispatch" value={item.dispatch?.id} mono />
          <Info
            label="Status / tentativas"
            value={
              item.dispatch
                ? `${item.dispatch.status} / ${item.dispatch.attemptCount}`
                : undefined
            }
          />
          <Info label="Outbox" value={item.outbox?.id} mono />
          <Info label="Outbox status" value={item.outbox?.status} />
          <Info
            label="External message"
            value={item.dispatch?.externalMessageId}
            mono
          />
        </DetailBlock>
        <DetailBlock
          title="Job BullMQ"
          icon={<GitBranch className="h-4 w-4" aria-hidden="true" />}
        >
          <Info label="Fila" value={item.bullmq?.queue} />
          <Info label="Job" value={item.bullmq?.jobId} mono />
          <Info label="Estado" value={item.bullmq?.state} />
          <Info
            label="Tentativas"
            value={item.bullmq?.attemptsMade?.toString()}
          />
          <Info label="Falha" value={item.bullmq?.failedReason} />
        </DetailBlock>
        <DetailBlock
          title="Reserva e recovery"
          icon={<ShieldAlert className="h-4 w-4" aria-hidden="true" />}
        >
          <Info label="Reserva" value={reservationLabel} />
          <Info
            label="Owner"
            value={item.reservation?.attemptExecutionId}
            mono
          />
          <Info
            label="Lease"
            value={formatDate(item.reservation?.attemptLeaseExpiresAt)}
          />
          <Info label="Recovery" value={item.recovery?.id} mono />
          <Info
            label="Autorizado"
            value={formatDate(item.recovery?.authorizedAt)}
          />
          <Info
            label="Rearmado / reenfileirado"
            value={
              item.recovery
                ? `${formatDate(item.recovery.rearmedAt)} / ${formatDate(item.recovery.requeuedAt)}`
                : undefined
            }
          />
        </DetailBlock>
      </div>

      {item.run?.failureCode || item.dispatch?.errorMessage ? (
        <div className="flex gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0"
            aria-hidden="true"
          />
          <div>
            <strong>Falha registrada</strong>
            <p className="mt-1">
              {item.run?.failureCode ?? item.dispatch?.errorMessage}
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Info({
  label,
  value,
  mono = false,
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd
        className={`mt-1 break-words text-sm text-slate-900 ${mono ? 'font-mono text-xs' : ''}`}
      >
        {value || 'Nao disponivel'}
      </dd>
    </div>
  );
}

function DetailBlock({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex items-center gap-2 text-slate-700">
        {icon}
        <h3 className="font-semibold text-slate-950">{title}</h3>
      </div>
      <dl className="mt-4 grid gap-3">{children}</dl>
    </div>
  );
}

export default function LifecyclePage() {
  const [data, setData] = useState<CommercialLifecyclePage | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      const response = await listCommercialLifecycles(1, 25);
      setData(response);
      setSelectedId((current) =>
        current && response.items.some((item) => item.lifecycleId === current)
          ? current
          : (response.items[0]?.lifecycleId ?? null),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const selected =
    data?.items.find((item) => item.lifecycleId === selectedId) ?? null;

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Lifecycle comercial"
        description="Leitura consolidada de execution, run, candidato, copy, dispatch, outbox, fila, reserva e recovery. Nenhuma ação operacional é oferecida nesta tela."
        actions={
          <button
            type="button"
            className="ops-icon-button"
            onClick={() => void load()}
            aria-label="Atualizar lifecycles"
            title="Atualizar lifecycles"
          >
            <RefreshCw size={16} aria-hidden="true" />
          </button>
        }
      />

      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : null}
      {loading ? (
        <LoadingState label="Carregando lifecycles comerciais" />
      ) : null}
      {!loading && !error && data ? <Summary summary={data.summary} /> : null}
      {!loading && !error && data?.items.length === 0 ? (
        <EmptyState
          title="Nenhum lifecycle encontrado"
          description="Ainda não existem execuções comerciais persistidas para consulta."
        />
      ) : null}
      {!loading && !error && data && data.items.length > 0 ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-start">
          <LifecycleList
            items={data.items}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
          {selected ? <Detail item={selected} /> : null}
        </div>
      ) : null}
    </div>
  );
}
