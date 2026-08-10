'use client';

import { Search } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { ErrorState } from '../../components/error-state';
import { JobProgress } from '../../components/job-progress';
import { LoadingState } from '../../components/loading-state';
import { PageHeader } from '../../components/page-header';
import { getPipelineJob, type PipelineJobResponse } from '../../lib/api';

const POLLING_MS = 5000;
const ACTIVE_STATES = new Set(['active', 'waiting', 'delayed', 'queued']);

export default function PipelinePage() {
  const [jobId, setJobId] = useState('');
  const [manualJobId, setManualJobId] = useState('');
  const [job, setJob] = useState<PipelineJobResponse | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentJobIsActive = useMemo(
    () => Boolean(jobId && (!job || ACTIVE_STATES.has(job.status))),
    [job, jobId],
  );

  const consultJob = async (id: string) => {
    setChecking(true);
    setError(null);
    try {
      const response = await getPipelineJob(id);
      setJob(response);
      setJobId(id);
      sessionStorage.setItem('lastPipelineJobId', id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado.');
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (!currentJobIsActive || !jobId) return;
    const interval = window.setInterval(() => {
      void consultJob(jobId);
    }, POLLING_MS);

    return () => window.clearInterval(interval);
  }, [currentJobIsActive, jobId]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (manualJobId.trim()) await consultJob(manualJobId.trim());
  };

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Pipeline"
        description="Acompanhe jobs existentes por ID. A criação manual de pipeline não é exposta no Operations Console."
      />

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
        Esta tela é somente leitura e consulta apenas o estado persistido do
        job informado.
      </div>

      <form onSubmit={submit} className="rounded-lg border border-slate-200 bg-white p-5">
        <label>
          <span className="text-sm font-medium text-slate-700">
            Consultar jobId
          </span>
          <div className="mt-1 flex flex-col gap-2 sm:flex-row">
            <input
              value={manualJobId}
              onChange={(event) => setManualJobId(event.target.value)}
              className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
              placeholder="Cole o jobId"
            />
            <button
              type="submit"
              disabled={checking || !manualJobId.trim()}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Search className="h-4 w-4" aria-hidden="true" />
              Consultar
            </button>
          </div>
        </label>
      </form>

      {checking ? <LoadingState label="Consultando job" /> : null}
      {error ? <ErrorState message={error} /> : null}
      <JobProgress job={job} queuedJobId={jobId} />

      {job?.result ? (
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="font-semibold text-slate-950">Resultado completo</h2>
          <pre className="mt-3 max-h-96 overflow-auto rounded-md bg-slate-950 p-4 text-xs leading-6 text-slate-50">
            {JSON.stringify(job.result, null, 2)}
          </pre>
        </section>
      ) : null}
    </div>
  );
}
