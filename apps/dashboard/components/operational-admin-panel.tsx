'use client';

import { Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import {
  DashboardApiError,
  createOperationalInstance,
  getOperationalAdmin,
  updateOperationalGroup,
  updateOperationalInstance,
  type OperationalAdmin,
  type OperationalAdminGroup,
} from '../lib/api';
import { formatDateTime } from '../lib/format';

const CHANGE_CONFIRMATION = 'CONFIRMAR_ALTERACAO_OPERACIONAL';
const PAUSE_CONFIRMATION = 'CONFIRMAR_PAUSA_OPERACIONAL';
const ASSIGNMENT_CONFIRMATION = 'CONFIRMAR_REATRIBUICAO_GRUPO';

const blockerText = (group: OperationalAdminGroup) =>
  group.blockers.length === 0
    ? 'Nenhum blocker acionavel'
    : group.blockers.map((blocker) => blocker.code).join(' · ');

const actionConfirmed = (message: string) =>
  typeof window === 'undefined' || window.confirm(message);

const operationalErrorMessage = (cause: unknown, fallback: string) => {
  if (!(cause instanceof DashboardApiError)) {
    return cause instanceof Error ? cause.message : fallback;
  }
  if (cause.code === 'OPERATIONAL_CAS_CONFLICT') {
    return 'Conflito de concorrência: o estado mudou antes de salvar. Atualize o painel e tente novamente.';
  }
  if (
    cause.code?.includes('LIFECYCLE_ACTIVE') ||
    cause.code?.includes('BLOCKED')
  ) {
    return `Alteração bloqueada: ${cause.message}`;
  }
  if (cause.code?.includes('INVALID') || cause.code?.includes('CONFIRMATION')) {
    return `Validação: ${cause.message}`;
  }
  return cause.message || fallback;
};

export function OperationalAdminPanel() {
  const [overview, setOverview] = useState<OperationalAdmin | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [instanceName, setInstanceName] = useState('');
  const [groupFilters, setGroupFilters] = useState({
    instance: '',
    campaign: '',
    active: '',
    paused: '',
  });

  const load = async (initial = false) => {
    if (initial) setLoading(true);
    else setRefreshing(true);
    setError(null);
    setSuccess(null);
    try {
      setOverview(await getOperationalAdmin());
    } catch (cause) {
      setError(
        operationalErrorMessage(
          cause,
          'Falha ao carregar o painel operacional.',
        ),
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load(true);
  }, []);

  const visibleGroups = overview
    ? overview.groups.filter((group) => {
        if (
          groupFilters.instance &&
          group.assignedInstanceName !== groupFilters.instance
        ) {
          return false;
        }
        if (
          groupFilters.campaign &&
          group.campaign?.id !== groupFilters.campaign
        ) {
          return false;
        }
        if (
          groupFilters.active &&
          String(group.active) !== groupFilters.active
        ) {
          return false;
        }
        if (
          groupFilters.paused &&
          String(group.paused) !== groupFilters.paused
        ) {
          return false;
        }
        return true;
      })
    : [];

  const createInstance = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!instanceName.trim()) return;
    if (!actionConfirmed('Cadastrar esta instancia operacional?')) return;
    setSaving('create-instance');
    setError(null);
    try {
      await createOperationalInstance(instanceName.trim(), CHANGE_CONFIRMATION);
      setInstanceName('');
      await load();
      setSuccess(
        'Instância cadastrada como inativa até validação operacional.',
      );
    } catch (cause) {
      setError(
        operationalErrorMessage(cause, 'A instancia nao foi cadastrada.'),
      );
    } finally {
      setSaving(null);
    }
  };

  const changeInstance = async (
    name: string,
    input: { active?: boolean; paused?: boolean },
    updatedAt: string,
  ) => {
    const pauseChange = input.paused !== undefined;
    const confirmation = pauseChange ? PAUSE_CONFIRMATION : CHANGE_CONFIRMATION;
    const action = pauseChange
      ? input.paused
        ? 'pausar'
        : 'retirar a pausa de'
      : input.active
        ? 'ativar'
        : 'desativar';
    if (!actionConfirmed(`Confirmar ${action} a instancia ${name}?`)) return;
    setSaving(`instance:${name}`);
    setError(null);
    setSuccess(null);
    try {
      await updateOperationalInstance(name, {
        ...input,
        expectedUpdatedAt: updatedAt,
        confirmation,
      });
      await load();
      setSuccess(`Instância ${name} atualizada.`);
    } catch (cause) {
      setError(
        operationalErrorMessage(cause, 'A instancia nao foi atualizada.'),
      );
    } finally {
      setSaving(null);
    }
  };

  const changeGroup = async (
    group: OperationalAdminGroup,
    input: {
      active?: boolean;
      paused?: boolean;
      assignedInstanceName?: string | null;
    },
    confirmation: string,
  ) => {
    if (!actionConfirmed('Confirmar esta alteracao operacional do grupo?'))
      return;
    setSaving(`group:${group.id}`);
    setError(null);
    setSuccess(null);
    if (!group.updatedAt) {
      setError(
        'Validação: o grupo não possui versão para controle de concorrência. Atualize o painel.',
      );
      setSaving(null);
      return;
    }
    try {
      await updateOperationalGroup(group.id, {
        ...input,
        expectedUpdatedAt: group.updatedAt,
        confirmation,
      });
      await load();
      setSuccess(`Grupo ${group.name} atualizado.`);
    } catch (cause) {
      setError(operationalErrorMessage(cause, 'O grupo nao foi atualizado.'));
    } finally {
      setSaving(null);
    }
  };

  return (
    <section
      className="grid gap-4 rounded-lg border border-slate-200 bg-white p-5"
      aria-labelledby="operational-admin-title"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">
            Administração operacional
          </p>
          <h2
            id="operational-admin-title"
            className="mt-1 text-lg font-semibold text-slate-950"
          >
            Instâncias, grupos e assignments
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
            Controles administrativos passam pela API protegida. Health, próximo
            envio, último envio e blockers são derivados; nenhuma credencial é
            exibida.
          </p>
        </div>
        <button
          type="button"
          className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          onClick={() => void load()}
          disabled={refreshing}
        >
          <RefreshCw
            className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          Atualizar estado
        </button>
      </div>

      {loading ? (
        <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">
          Carregando controles operacionais…
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </p>
      ) : null}
      {success ? (
        <p
          role="status"
          className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"
        >
          {success}
        </p>
      ) : null}

      {overview ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-md border border-slate-200 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">
                Próximo envio
              </p>
              <p className="mt-1 font-medium text-slate-950">
                {formatDateTime(overview.nextSendAt)}
              </p>
            </div>
            <div className="rounded-md border border-slate-200 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">
                Último envio
              </p>
              <p className="mt-1 font-medium text-slate-950">
                {formatDateTime(overview.lastSendAt)}
              </p>
            </div>
            <div className="rounded-md border border-slate-200 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">
                Reservas ativas
              </p>
              <p className="mt-1 font-medium text-slate-950">
                {overview.activeReservations}
              </p>
            </div>
            <div className="rounded-md border border-slate-200 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">
                Blockers acionáveis
              </p>
              <p className="mt-1 font-medium text-slate-950">
                {overview.blockers.length}
              </p>
            </div>
          </div>

          <form
            onSubmit={createInstance}
            className="flex flex-col gap-2 rounded-md border border-orange-100 bg-orange-50 p-4 sm:flex-row sm:items-end"
          >
            <label className="flex-1">
              <span className="text-sm font-medium text-slate-700">
                Nova instância/provider name
              </span>
              <input
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                value={instanceName}
                onChange={(event) => setInstanceName(event.target.value)}
                placeholder="afiliado-shopee-local"
              />
            </label>
            <button
              type="submit"
              className="inline-flex items-center justify-center gap-2 rounded-md bg-orange-600 px-3 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-60"
              disabled={saving !== null}
            >
              <Plus className="h-4 w-4" aria-hidden="true" /> Cadastrar
              instância
            </button>
          </form>

          <div className="grid gap-3 lg:grid-cols-2">
            {overview.instances.map((instance) => {
              const busy = saving === `instance:${instance.name}`;
              return (
                <article
                  key={instance.name}
                  className="rounded-md border border-slate-200 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-slate-950">
                        {instance.name}
                      </h3>
                      <p className="mt-1 text-xs text-slate-500">
                        Health sanitizado: {instance.health} ·{' '}
                        {instance.assignedGroupCount} grupo(s) atribuído(s)
                      </p>
                    </div>
                    <div className="flex gap-2 text-xs">
                      <span className="rounded-full bg-slate-100 px-2 py-1">
                        {instance.active ? 'ATIVA' : 'INATIVA'}
                      </span>
                      <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-800">
                        {instance.paused ? 'PAUSADA' : 'SEM PAUSA'}
                      </span>
                    </div>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-slate-500">Último envio</dt>
                      <dd className="mt-1 text-slate-950">
                        {formatDateTime(instance.lastSendAt)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Próximo envio</dt>
                      <dd className="mt-1 text-slate-950">
                        {formatDateTime(instance.nextSendAt)}
                      </dd>
                    </div>
                  </dl>
                  {instance.blockers.length > 0 ? (
                    <p className="mt-3 text-xs text-amber-800">
                      {instance.blockers
                        .map((blocker) => blocker.code)
                        .join(' · ')}
                    </p>
                  ) : (
                    <p className="mt-3 text-xs text-emerald-700">
                      Sem blocker acionável
                    </p>
                  )}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded-md border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 disabled:opacity-60"
                      disabled={busy}
                      onClick={() =>
                        void changeInstance(
                          instance.name,
                          { active: !instance.active },
                          instance.updatedAt,
                        )
                      }
                    >
                      {busy
                        ? 'Salvando…'
                        : instance.active
                          ? 'Desativar'
                          : 'Ativar'}
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-amber-300 px-3 py-2 text-xs font-medium text-amber-800 disabled:opacity-60"
                      disabled={busy}
                      onClick={() =>
                        void changeInstance(
                          instance.name,
                          { paused: !instance.paused },
                          instance.updatedAt,
                        )
                      }
                    >
                      {busy
                        ? 'Salvando…'
                        : instance.paused
                          ? 'Retirar pausa'
                          : 'Pausar'}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          <div className="grid gap-3">
            <div>
              <h3 className="font-semibold text-slate-950">
                Grupos e assignments
              </h3>
              <p className="mt-1 text-sm text-slate-600">
                Disponibilidade e fingerprint vêm do diretório. Assignment só
                muda com CAS e é bloqueado durante lifecycle ativo.
              </p>
            </div>
            <div className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="text-xs text-slate-600">
                Instância
                <select
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm"
                  value={groupFilters.instance}
                  onChange={(event) =>
                    setGroupFilters((current) => ({
                      ...current,
                      instance: event.target.value,
                    }))
                  }
                >
                  <option value="">Todas</option>
                  {overview.instances.map((instance) => (
                    <option key={instance.name} value={instance.name}>
                      {instance.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-slate-600">
                Campanha
                <select
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm"
                  value={groupFilters.campaign}
                  onChange={(event) =>
                    setGroupFilters((current) => ({
                      ...current,
                      campaign: event.target.value,
                    }))
                  }
                >
                  <option value="">Todas</option>
                  {overview.campaigns?.map((campaign) => (
                    <option key={campaign.id} value={campaign.id}>
                      {campaign.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-slate-600">
                Estado
                <select
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm"
                  value={groupFilters.active}
                  onChange={(event) =>
                    setGroupFilters((current) => ({
                      ...current,
                      active: event.target.value,
                    }))
                  }
                >
                  <option value="">Todos</option>
                  <option value="true">Ativos</option>
                  <option value="false">Inativos</option>
                </select>
              </label>
              <label className="text-xs text-slate-600">
                Pausa
                <select
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm"
                  value={groupFilters.paused}
                  onChange={(event) =>
                    setGroupFilters((current) => ({
                      ...current,
                      paused: event.target.value,
                    }))
                  }
                >
                  <option value="">Todas</option>
                  <option value="true">Pausados</option>
                  <option value="false">Sem pausa</option>
                </select>
              </label>
            </div>
            {visibleGroups.length === 0 ? (
              <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">
                {overview.groups.length === 0
                  ? 'Nenhum grupo persistido.'
                  : 'Nenhum grupo corresponde aos filtros.'}
              </p>
            ) : (
              visibleGroups.map((group) => (
                <article
                  key={group.id}
                  className="grid gap-3 rounded-md border border-slate-200 p-4 lg:grid-cols-[1.2fr_1fr_auto]"
                >
                  <div>
                    <h4 className="font-medium text-slate-950">{group.name}</h4>
                    <p className="mt-1 font-mono text-xs text-slate-500">
                      {group.fingerprint ?? 'fingerprint indisponível'}
                    </p>
                    <p className="mt-2 text-xs text-slate-600">
                      {group.available ? 'Disponível' : 'Indisponível'} ·{' '}
                      {group.campaign?.name ?? 'Sem campanha'} ·{' '}
                      {group.niche?.name ?? 'Sem nicho'}
                    </p>
                    <p className="mt-1 text-xs text-amber-800">
                      {blockerText(group)}
                    </p>
                  </div>
                  <div className="grid content-start gap-2 text-sm">
                    <label>
                      <span className="text-xs text-slate-500">
                        Instância atribuída
                      </span>
                      <select
                        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm"
                        value={group.assignedInstanceName ?? ''}
                        onChange={(event) => {
                          const next = event.target.value || null;
                          if (next !== group.assignedInstanceName)
                            void changeGroup(
                              group,
                              { assignedInstanceName: next },
                              ASSIGNMENT_CONFIRMATION,
                            );
                        }}
                      >
                        <option value="">Não atribuída</option>
                        {overview.instances.map((instance) => (
                          <option
                            key={instance.name}
                            value={instance.name}
                            disabled={!instance.active || instance.paused}
                          >
                            {instance.name}
                            {!instance.active || instance.paused
                              ? ' (bloqueada)'
                              : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                    <p className="text-xs text-slate-500">
                      Último: {formatDateTime(group.lastSendAt)} · Próximo:{' '}
                      {formatDateTime(group.nextSendAt)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-start gap-2 lg:flex-col">
                    <button
                      type="button"
                      className="rounded-md border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 disabled:opacity-60"
                      disabled={saving === `group:${group.id}`}
                      onClick={() =>
                        void changeGroup(
                          group,
                          { active: !group.active },
                          CHANGE_CONFIRMATION,
                        )
                      }
                    >
                      {saving === `group:${group.id}`
                        ? 'Salvando…'
                        : group.active
                          ? 'Desativar'
                          : 'Ativar'}
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-amber-300 px-3 py-2 text-xs font-medium text-amber-800 disabled:opacity-60"
                      disabled={saving === `group:${group.id}`}
                      onClick={() =>
                        void changeGroup(
                          group,
                          { paused: !group.paused },
                          PAUSE_CONFIRMATION,
                        )
                      }
                    >
                      {saving === `group:${group.id}`
                        ? 'Salvando…'
                        : group.paused
                          ? 'Retirar pausa'
                          : 'Pausar'}
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>

          <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            <p className="font-medium text-slate-950">
              <ShieldCheck
                className="mr-1 inline h-4 w-4 text-emerald-600"
                aria-hidden="true"
              />
              Proteções
            </p>
            <p className="mt-1">
              Provider health permanece UNKNOWN quando não há evidência recente;
              chaves, URLs, Redis e PostgreSQL nunca fazem parte deste
              aggregate.
            </p>
            <p className="mt-1 font-mono text-xs">
              Queue: waiting {overview.queues.whatsappDispatch.waiting} · active{' '}
              {overview.queues.whatsappDispatch.active} · delayed{' '}
              {overview.queues.whatsappDispatch.delayed}
            </p>
          </div>
        </>
      ) : null}
    </section>
  );
}
