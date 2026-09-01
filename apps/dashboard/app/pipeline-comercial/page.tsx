'use client';

import { ClipboardList } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CopyButton } from '../../components/copy-button';
import { EmptyState } from '../../components/empty-state';
import { ErrorState } from '../../components/error-state';
import { LoadingState } from '../../components/loading-state';
import { PageHeader } from '../../components/page-header';
import { StatusBadge } from '../../components/status-badge';
import {
  listCommercialPipelineRuns,
  type CommercialPipelineRun,
} from '../../lib/api';

const formatDate = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'medium',
      }).format(new Date(value))
    : 'Não disponível';

const statusTone = (status: CommercialPipelineRun['status']) => {
  if (status === 'completed') return 'ok' as const;
  if (status === 'blocked' || status === 'started') return 'warning' as const;
  return 'error' as const;
};

export default function CommercialPipelinePage() {
  const [runs, setRuns] = useState<CommercialPipelineRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadRuns = async () => {
    setError(null);
    try {
      const response = await listCommercialPipelineRuns(1, 20);
      setRuns(response.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRuns();
  }, []);

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Pipeline comercial"
        description="Histórico de preparações e confirmações para auditoria. Esta tela é somente leitura."
      />

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
        Esta área não inicia dry-run, confirmação, dispatch ou job.
        Ações comerciais continuam restritas aos fluxos oficiais do backend.
      </div>

      {error ? <ErrorState message={error} onRetry={() => void loadRuns()} /> : null}
      {loading ? <LoadingState label="Carregando histórico comercial" /> : null}
      {!loading && !error && runs.length === 0 ? (
        <EmptyState
          title="Nenhuma execução registrada"
          description="Ainda não existem runs comerciais disponíveis para consulta."
        />
      ) : null}

      {!loading && !error && runs.length > 0 ? (
        <section className="grid gap-3">
          {runs.map((run) => (
            <article
              key={run.id}
              className="rounded-lg border border-slate-200 bg-white p-5"
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <ClipboardList
                      className="h-4 w-4 text-slate-500"
                      aria-hidden="true"
                    />
                    <StatusBadge tone={statusTone(run.status)}>
                      {run.status}
                    </StatusBadge>
                    <StatusBadge tone="neutral">{run.mode}</StatusBadge>
                    <span className="text-xs text-slate-500">
                      {formatDate(run.createdAt)}
                    </span>
                  </div>
                  <p className="mt-3 truncate font-medium text-slate-950">
                    {run.selectedProduct?.name ??
                      run.failureCode ??
                      'Execução sem produto selecionado'}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    {run.selectedGroup
                      ? `${run.selectedGroup.name} · ${run.selectedGroup.fingerprint}`
                      : 'Grupo não selecionado'}
                  </p>
                  <p className="mt-2 font-mono text-xs text-slate-500">
                    runId: {run.id}
                  </p>
                </div>

                <dl className="grid grid-cols-3 gap-4 text-center text-xs text-slate-600 sm:min-w-56">
                  <div>
                    <dt>Candidatos</dt>
                    <dd className="mt-1 text-base font-semibold text-slate-950">
                      {run.candidateCount}
                    </dd>
                  </div>
                  <div>
                    <dt>Elegíveis</dt>
                    <dd className="mt-1 text-base font-semibold text-slate-950">
                      {run.eligibleCount}
                    </dd>
                  </div>
                  <div>
                    <dt>Score</dt>
                    <dd className="mt-1 text-base font-semibold text-slate-950">
                      {run.selectedProduct?.score ?? '—'}
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 text-sm sm:grid-cols-3">
                <div>
                  <span className="block text-xs text-slate-500">Produto</span>
                  <strong className="text-slate-950">
                    {run.selectedProduct?.name ?? 'Não selecionado'}
                  </strong>
                </div>
                <div>
                  <span className="block text-xs text-slate-500">Grupo</span>
                  <strong className="text-slate-950">
                    {run.selectedGroup?.name ?? 'Não selecionado'}
                  </strong>
                </div>
                <div>
                  <span className="block text-xs text-slate-500">Dispatch</span>
                  <strong className="text-slate-950">
                    {run.dispatchStatus ?? 'Não criado'}
                  </strong>
                </div>
              </div>

              {run.copyPreview ? (
                <div className="mt-4 rounded-md bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Copy registrada
                    </span>
                    <CopyButton value={run.copyPreview} label="Copiar leitura" />
                  </div>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                    {run.copyPreview}
                  </p>
                </div>
              ) : null}

              {run.failureCode ? (
                <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-800">
                  Bloqueio: {run.failureCode}
                </p>
              ) : null}
              {run.investigationRequired ? (
                <p className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
                  Resultado ambíguo. A leitura não executa reprocessamento; a
                  investigação deve ocorrer fora do dashboard.
                </p>
              ) : null}
            </article>
          ))}
        </section>
      ) : null}
    </div>
  );
}
