'use client';

import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { EmptyState } from '../../components/empty-state';
import { ErrorState } from '../../components/error-state';
import { LoadingState } from '../../components/loading-state';
import { PageHeader } from '../../components/page-header';
import { StatusBadge } from '../../components/status-badge';
import {
  listCommercialCopyHistory,
  type CommercialCopyHistoryAttempt,
  type CommercialCopyHistoryCandidate,
  type CommercialCopyHistoryCopy,
  type CommercialCopyHistoryItem,
  type CommercialCopyHistoryPage,
} from '../../lib/api';

const formatDate = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'medium',
      }).format(new Date(value))
    : 'Nao disponivel';

const shortId = (value: string | null) =>
  value ? `${value.slice(0, 12)}...` : 'Nao disponivel';

const valueOrUnavailable = (value: string | number | null) =>
  value ?? 'Nao disponivel';

const statusTone = (status: string) =>
  ['SENT', 'SUCCEEDED', 'PERSISTED', 'COMPLETED'].includes(status)
    ? ('ok' as const)
    : ['FAILED', 'OUTPUT_INVALID', 'AMBIGUOUS'].includes(status)
      ? ('error' as const)
      : ['STARTED', 'PROCESSING', 'PENDING'].includes(status)
        ? ('warning' as const)
        : ('neutral' as const);

function EvidenceBadge({ status }: { status: string }) {
  return <StatusBadge tone={statusTone(status)}>{status}</StatusBadge>;
}

function CandidateReference({
  candidate,
}: {
  candidate: CommercialCopyHistoryCandidate | null;
}) {
  if (!candidate) return <span className="text-slate-500">Nao vinculada</span>;

  return (
    <div className="grid gap-1 text-sm text-slate-700">
      <span>candidateId: {shortId(candidate.id)}</span>
      <span>Campanha: {candidate.campaignName}</span>
      <EvidenceBadge status={candidate.status} />
    </div>
  );
}

function AttemptDetails({ attempt }: { attempt: CommercialCopyHistoryAttempt }) {
  return (
    <div className="grid gap-3 border-t border-slate-200 pt-4 text-sm text-slate-700">
      <div className="flex flex-wrap items-center gap-2">
        <EvidenceBadge status={attempt.status} />
        {attempt.failureCode ? <span>Falha: {attempt.failureCode}</span> : null}
        {attempt.requestMayHaveStarted ? (
          <span className="text-amber-800">Requisicao pode ter iniciado</span>
        ) : null}
      </div>
      {attempt.validationFailureCodes.length > 0 ? (
        <div>
          <p className="font-medium text-slate-900">Falhas de validacao</p>
          <p className="mt-1 break-words font-mono text-xs text-rose-700">
            {attempt.validationFailureCodes.join(', ')}
          </p>
        </div>
      ) : null}
      <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-slate-500">Tentativa</dt>
          <dd className="font-mono text-xs">{shortId(attempt.id)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Provider / modelo</dt>
          <dd>{attempt.provider} / {attempt.model}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Prompt / validacao</dt>
          <dd>{attempt.promptVersion} / {attempt.validationVersion}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Tokens entrada / saida / total</dt>
          <dd>{valueOrUnavailable(attempt.inputTokens)} / {valueOrUnavailable(attempt.outputTokens)} / {valueOrUnavailable(attempt.totalTokens)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Snapshot</dt>
          <dd className="font-mono text-xs">{shortId(attempt.snapshotId)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Fingerprint</dt>
          <dd className="font-mono text-xs">{shortId(attempt.inputFingerprint)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Iniciada</dt>
          <dd>{formatDate(attempt.startedAt)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Concluida</dt>
          <dd>{formatDate(attempt.completedAt)}</dd>
        </div>
      </dl>
    </div>
  );
}

function DispatchReferences({ copy }: { copy: CommercialCopyHistoryCopy }) {
  if (copy.dispatches.length === 0) {
    return <p className="text-sm text-slate-500">Nenhum dispatch vinculado.</p>;
  }

  return (
    <div className="grid gap-2">
      {copy.dispatches.map((dispatch) => (
        <div key={dispatch.id} className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
          <span className="font-mono text-xs">dispatchId: {shortId(dispatch.id)}</span>
          <EvidenceBadge status={dispatch.status} />
          {dispatch.runId ? <span className="font-mono text-xs">runId: {shortId(dispatch.runId)}</span> : null}
          {dispatch.runStatus ? <EvidenceBadge status={dispatch.runStatus} /> : null}
          {dispatch.finalStatus ? <EvidenceBadge status={dispatch.finalStatus} /> : null}
        </div>
      ))}
    </div>
  );
}

function CopyRecord({ item }: { item: CommercialCopyHistoryItem }) {
  const copy = item.copy;
  if (!copy) return null;

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <EvidenceBadge status="PERSISTED" />
            <EvidenceBadge status={copy.source} />
          </div>
          <h2 className="mt-3 font-semibold text-slate-950">{copy.productName}</h2>
          <p className="mt-1 font-mono text-xs text-slate-500">copyId: {shortId(copy.id)}</p>
        </div>
        <span className="text-sm text-slate-500">{formatDate(copy.createdAt)}</span>
      </div>

      <dl className="mt-4 grid gap-3 text-sm text-slate-700 sm:grid-cols-2 lg:grid-cols-4">
        <div><dt className="text-slate-500">Produto</dt><dd className="font-mono text-xs">{shortId(copy.productId)}</dd></div>
        <div><dt className="text-slate-500">Provider / modelo</dt><dd>{valueOrUnavailable(copy.provider)} / {valueOrUnavailable(copy.model)}</dd></div>
        <div><dt className="text-slate-500">Prompt / validacao</dt><dd>{valueOrUnavailable(copy.promptVersion)} / {valueOrUnavailable(copy.validationVersion)}</dd></div>
        <div><dt className="text-slate-500">Snapshot</dt><dd className="font-mono text-xs">{shortId(copy.snapshotId)}</dd></div>
        <div><dt className="text-slate-500">Fingerprint</dt><dd className="font-mono text-xs">{shortId(copy.inputFingerprint)}</dd></div>
        <div><dt className="text-slate-500">Tokens entrada / saida / total</dt><dd>{valueOrUnavailable(copy.usageInputTokens)} / {valueOrUnavailable(copy.usageOutputTokens)} / {valueOrUnavailable(copy.usageTotalTokens)}</dd></div>
        <div className="sm:col-span-2"><dt className="text-slate-500">Candidato</dt><dd className="mt-1"><CandidateReference candidate={copy.candidate} /></dd></div>
      </dl>

      <section className="mt-5 border-t border-slate-200 pt-4">
        <h3 className="font-medium text-slate-950">Referencias de dispatch e run</h3>
        <div className="mt-2"><DispatchReferences copy={copy} /></div>
      </section>

      <section className="mt-5 grid gap-3">
        <h3 className="font-medium text-slate-950">Tentativas associadas</h3>
        {copy.attempts.length === 0 ? <p className="text-sm text-slate-500">Nenhuma tentativa com este generatedCopyId.</p> : copy.attempts.map((attempt) => <AttemptDetails key={attempt.id} attempt={attempt} />)}
      </section>
    </article>
  );
}

function AttemptRecord({ item }: { item: CommercialCopyHistoryItem }) {
  const attempt = item.attempt;
  if (!attempt) return null;

  return (
    <article className="rounded-lg border border-amber-200 bg-amber-50 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2"><EvidenceBadge status={attempt.status} /><EvidenceBadge status="SEM GENERATEDCOPY" /></div>
          <h2 className="mt-3 font-semibold text-slate-950">Tentativa sem copy persistida</h2>
        </div>
        <span className="text-sm text-slate-600">{formatDate(attempt.startedAt)}</span>
      </div>
      {item.candidate ? (
        <div className="mt-4 grid gap-1 text-sm text-slate-700">
          <span className="font-medium text-slate-950">
            {item.candidate.productName}
          </span>
          <span className="font-mono text-xs">
            productId: {shortId(item.candidate.productId)}
          </span>
        </div>
      ) : null}
      <div className="mt-4"><CandidateReference candidate={item.candidate} /></div>
      <div className="mt-4"><AttemptDetails attempt={attempt} /></div>
    </article>
  );
}

export default function CopiesPage() {
  const pageLimit = 20;
  const [data, setData] = useState<CommercialCopyHistoryPage | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async (requestedPage: number) => {
    setLoading(true);
    setError(null);
    try {
      const response = await listCommercialCopyHistory(requestedPage, pageLimit);
      setData(response);
      setPage(response.page);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erro inesperado.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(1);
  }, []);

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Copies"
        description="Historico persistido de GeneratedCopy e tentativas de geracao. Esta tela e somente leitura."
        actions={<button type="button" aria-label="Atualizar copies" title="Atualizar copies" className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 text-slate-700" onClick={() => void load(page)}><RefreshCw className="h-4 w-4" aria-hidden="true" /></button>}
      />

      {error ? <ErrorState message={error} onRetry={() => void load(page)} /> : null}
      {loading ? <LoadingState label="Carregando copies e tentativas" /> : null}
      {!loading && !error && data?.items.length === 0 ? <EmptyState title="Nenhuma copy ou tentativa encontrada" description="O historico persistido ainda nao possui registros para consulta." /> : null}
      {!loading && !error && data && data.items.length > 0 ? (
        <>
          <section aria-label="Historico de copies" className="grid gap-4">
            {data.items.map((item) => item.kind === 'COPY' ? <CopyRecord key={`${item.kind}-${item.id}`} item={item} /> : <AttemptRecord key={`${item.kind}-${item.id}`} item={item} />)}
          </section>
        </>
      ) : null}
      {!error && data && data.totalPages > 1 ? (
        <div className="flex items-center justify-between gap-3 text-sm text-slate-600">
          <span>Pagina {data.page} de {data.totalPages} ({data.total} registros)</span>
          <div className="flex gap-2">
            <button type="button" aria-label="Pagina anterior" className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 disabled:cursor-not-allowed disabled:opacity-50" disabled={loading || data.page <= 1} onClick={() => void load(data.page - 1)}>{'<'}</button>
            <button type="button" aria-label="Proxima pagina" className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 disabled:cursor-not-allowed disabled:opacity-50" disabled={loading || data.page >= data.totalPages} onClick={() => void load(data.page + 1)}>{'>'}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
