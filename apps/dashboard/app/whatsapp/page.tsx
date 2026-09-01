'use client';

import { Eye, RefreshCw, Users } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useEffect, useMemo, useState } from 'react';
import { EmptyState } from '../../components/empty-state';
import { ErrorState } from '../../components/error-state';
import { GroupsManagement } from '../../components/groups-management';
import { LoadingState } from '../../components/loading-state';
import { OperationalAdminPanel } from '../../components/operational-admin-panel';
import { OpsPageHeading } from '../../components/ops-components';
import { StatusBadge } from '../../components/status-badge';
import { WhatsAppContextNav } from '../../components/whatsapp-context-nav';
import {
  getDispatch,
  listDestinations,
  listDispatches,
  type DispatchFilters,
  type WhatsAppDestination,
  type WhatsAppDispatch,
  type WhatsAppDispatchStatus,
} from '../../lib/api';
import { formatDateTime, maskDestination } from '../../lib/format';

function WhatsAppsView() {
  const [destinations, setDestinations] = useState<WhatsAppDestination[]>([]);
  const [dispatches, setDispatches] = useState<WhatsAppDispatch[]>([]);
  const [dispatchFilters, setDispatchFilters] = useState<DispatchFilters>({
    status: '',
    destinationId: '',
    productId: '',
  });
  const [selectedDispatch, setSelectedDispatch] =
    useState<WhatsAppDispatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadDestinations = async () => {
    setDestinations(await listDestinations());
  };

  const loadDispatches = async () => {
    setDispatches(await listDispatches(dispatchFilters));
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([loadDestinations(), loadDispatches()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const filteredDispatches = useMemo(() => dispatches, [dispatches]);

  const openDispatch = async (id: string) => {
    setLoadingDetailId(id);
    setError(null);
    try {
      setSelectedDispatch(await getDispatch(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado.');
    } finally {
      setLoadingDetailId(null);
    }
  };

  const submitFilters = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await loadDispatches();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid gap-6">
      <OpsPageHeading
        eyebrow="Números e operação"
        title="WhatsApps"
        description="Consulte instâncias, destinos individuais e o histórico técnico de dispatches."
      />

      <OperationalAdminPanel showGroups={false} />

      {error ? <ErrorState message={error} onRetry={load} /> : null}

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex items-start gap-3">
          <Users className="h-5 w-5 text-slate-500" aria-hidden="true" />
          <div>
            <h2 className="font-semibold text-slate-950">
              Destinos individuais
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Destinos persistidos e mascarados para consulta operacional.
            </p>
          </div>
        </div>
        {loading ? (
          <div className="mt-4">
            <LoadingState label="Carregando destinos" />
          </div>
        ) : null}
        {!loading && destinations.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="Nenhum destino cadastrado"
              description="Nenhum destino persistido está disponível para consulta."
            />
          </div>
        ) : null}
        {destinations.length > 0 ? (
          <div className="mt-4 grid gap-3">
            {destinations.map((destination) => (
              <article
                key={destination.id}
                className="grid gap-2 rounded-md border border-slate-200 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-center"
              >
                <div>
                  <span className="text-xs uppercase tracking-wide text-slate-500">
                    Nome
                  </span>
                  <p className="font-medium text-slate-950">
                    {destination.name}
                  </p>
                </div>
                <div>
                  <span className="text-xs uppercase tracking-wide text-slate-500">
                    Identificador
                  </span>
                  <p className="font-mono text-sm text-slate-700">
                    {maskDestination(destination.destination)}
                  </p>
                </div>
                <StatusBadge tone={destination.active ? 'ok' : 'neutral'}>
                  {destination.active ? 'Ativo' : 'Inativo'}
                </StatusBadge>
              </article>
            ))}
          </div>
        ) : null}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold text-slate-950">Dispatches</h2>
            <p className="mt-1 text-sm text-slate-600">
              Histórico técnico de entregas; nenhuma ação de reprocessamento é
              oferecida aqui.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-orange-500"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Atualizar leituras
          </button>
        </div>

        <form
          onSubmit={submitFilters}
          className="mt-4 grid gap-3 md:grid-cols-4"
        >
          <label>
            <span className="text-sm font-medium text-slate-700">Status</span>
            <select
              value={dispatchFilters.status}
              onChange={(event) =>
                setDispatchFilters((current) => ({
                  ...current,
                  status: event.target.value as WhatsAppDispatchStatus | '',
                }))
              }
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
            >
              <option value="">Todos</option>
              <option value="PENDING">PENDING</option>
              <option value="SENT">SENT</option>
              <option value="FAILED">FAILED</option>
            </select>
          </label>
          <label>
            <span className="text-sm font-medium text-slate-700">
              Destination ID
            </span>
            <input
              value={dispatchFilters.destinationId}
              onChange={(event) =>
                setDispatchFilters((current) => ({
                  ...current,
                  destinationId: event.target.value,
                }))
              }
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </label>
          <label>
            <span className="text-sm font-medium text-slate-700">
              Product ID
            </span>
            <input
              value={dispatchFilters.productId}
              onChange={(event) =>
                setDispatchFilters((current) => ({
                  ...current,
                  productId: event.target.value,
                }))
              }
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </label>
          <button
            type="submit"
            disabled={loading}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:cursor-not-allowed disabled:opacity-60 md:self-end"
          >
            Filtrar
          </button>
        </form>

        {loading ? (
          <div className="mt-4">
            <LoadingState label="Carregando dispatches" />
          </div>
        ) : null}
        {!loading && filteredDispatches.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="Nenhum dispatch encontrado"
              description="Nenhum registro corresponde aos filtros atuais."
            />
          </div>
        ) : null}

        {filteredDispatches.length > 0 ? (
          <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Produto</th>
                  <th className="px-4 py-3">Destino</th>
                  <th className="px-4 py-3">Tentativas</th>
                  <th className="px-4 py-3">Enviado em</th>
                  <th className="px-4 py-3">Erro</th>
                  <th className="px-4 py-3">Detalhes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredDispatches.map((dispatch) => (
                  <tr key={dispatch.id}>
                    <td className="px-4 py-3">
                      <StatusBadge status={dispatch.status}>
                        {dispatch.status}
                      </StatusBadge>
                    </td>
                    <td className="max-w-xs px-4 py-3 text-slate-700">
                      {dispatch.product?.nome ?? dispatch.productId}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {maskDestination(dispatch.destination?.destination)}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {dispatch.attemptCount}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {formatDateTime(dispatch.sentAt)}
                    </td>
                    <td className="max-w-xs truncate px-4 py-3 text-slate-700">
                      {dispatch.errorMessage ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => void openDispatch(dispatch.id)}
                        disabled={loadingDetailId === dispatch.id}
                        className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <Eye className="h-4 w-4" aria-hidden="true" />
                        {loadingDetailId === dispatch.id ? 'Abrindo...' : 'Ver'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {selectedDispatch ? (
        <div className="fixed inset-0 z-40 grid place-items-center bg-slate-950/45 p-4">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="dispatch-title"
            className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-lg bg-white p-5 shadow-xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2
                  id="dispatch-title"
                  className="font-semibold text-slate-950"
                >
                  Detalhes do dispatch
                </h2>
                <p className="mt-1 break-all text-sm text-slate-500">
                  {selectedDispatch.id}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedDispatch(null)}
                className="min-h-[44px] rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-orange-500"
              >
                Fechar
              </button>
            </div>
            <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-slate-500">Status</dt>
                <dd className="mt-1">
                  <StatusBadge status={selectedDispatch.status}>
                    {selectedDispatch.status}
                  </StatusBadge>
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">External message ID</dt>
                <dd className="mt-1 break-all font-medium text-slate-950">
                  {selectedDispatch.externalMessageId ?? '—'}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Produto</dt>
                <dd className="mt-1 font-medium text-slate-950">
                  {selectedDispatch.product?.nome ?? selectedDispatch.productId}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Destino</dt>
                <dd className="mt-1 font-medium text-slate-950">
                  {maskDestination(selectedDispatch.destination?.destination)}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-slate-500">Copy</dt>
                <dd className="mt-1 whitespace-pre-wrap rounded-md bg-slate-50 p-3 leading-6 text-slate-950">
                  {selectedDispatch.generatedCopy
                    ? `${selectedDispatch.generatedCopy.titulo}\n\n${selectedDispatch.generatedCopy.mensagem}\n\n${selectedDispatch.generatedCopy.cta}\n\n${selectedDispatch.generatedCopy.hashtags}`
                    : '—'}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-slate-500">Erro seguro</dt>
                <dd className="mt-1 text-slate-950">
                  {selectedDispatch.errorMessage ?? '—'}
                </dd>
              </div>
            </dl>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function WhatsAppPageContent() {
  const searchParams = useSearchParams();
  const view =
    searchParams.get('view') === 'whatsapps' ? 'whatsapps' : 'groups';

  return (
    <div className="grid gap-6">
      <WhatsAppContextNav active={view} />
      {view === 'groups' ? <GroupsManagement /> : <WhatsAppsView />}
      {view === 'groups' ? (
        <p className="text-sm text-slate-600">
          Precisa consultar entregas anteriores?{' '}
          <Link
            className="font-semibold text-orange-700 underline"
            href="/envios"
          >
            Ver histórico de envios
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}

export default function WhatsAppPage() {
  return (
    <Suspense
      fallback={
        <div className="ops-state" aria-live="polite">
          Carregando área de WhatsApp…
        </div>
      }
    >
      <WhatsAppPageContent />
    </Suspense>
  );
}
