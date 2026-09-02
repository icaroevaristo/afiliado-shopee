'use client';

import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  Edit3,
  Pause,
  Play,
  Power,
  RefreshCw,
  ShieldAlert,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  DashboardApiError,
  getOperationalAdmin,
  updateOperationalGroup,
  type OperationalAdmin,
  type OperationalAdminBlocker,
  type OperationalAdminGroup,
} from '../lib/api';
import { formatDateTime } from '../lib/format';
import {
  OpsBadge,
  OpsEmpty,
  OpsLoading,
  OpsPageHeading,
  OpsSection,
  OpsState,
} from './ops-components';

const CHANGE_CONFIRMATION = 'CONFIRMAR_ALTERACAO_OPERACIONAL';
const PAUSE_CONFIRMATION = 'CONFIRMAR_PAUSA_OPERACIONAL';
const ASSIGNMENT_CONFIRMATION = 'CONFIRMAR_REATRIBUICAO_GRUPO';

type GroupFilter = 'all' | 'active' | 'paused' | 'pending';

const blockerMessages: Record<string, string> = {
  GROUP_INACTIVE: 'Este grupo está inativo.',
  GROUP_PAUSED: 'Este grupo está pausado.',
  GROUP_UNAVAILABLE: 'A disponibilidade deste grupo ainda não foi confirmada.',
  FINGERPRINT_MISMATCH: 'A identidade deste grupo precisa ser validada.',
  ASSIGNMENT_INVALID: 'Este grupo precisa de um WhatsApp responsável válido.',
  INSTANCE_INACTIVE: 'O WhatsApp responsável está inativo.',
  INSTANCE_PAUSED: 'O WhatsApp responsável está pausado.',
  NO_CAMPAIGN_ASSIGNMENT:
    'Este grupo precisa de configuração antes de receber ofertas.',
  CAMPAIGN_INACTIVE: 'A campanha deste grupo está inativa.',
  NICHE_INACTIVE: 'O nicho da campanha está inativo.',
  NEXT_ELIGIBLE_AT: 'O próximo envio ainda não está liberado.',
  MINIMUM_INTERVAL_NOT_REACHED:
    'O intervalo mínimo entre envios ainda não foi atingido.',
  GLOBAL_DAILY_LIMIT_REACHED: 'O limite diário de mensagens foi atingido.',
  GROUP_DAILY_LIMIT_REACHED: 'O limite diário deste grupo foi atingido.',
  COMMERCIAL_SHOPEE_DAILY_BUDGET_REACHED:
    'O limite diário de consultas de ofertas foi atingido.',
  COMMERCIAL_OPENAI_DAILY_BUDGET_REACHED:
    'O limite diário de geração de texto foi atingido.',
  COMMERCIAL_EXECUTION_IN_PROGRESS:
    'Há um envio em andamento para este grupo. Aguarde antes de trocar o WhatsApp responsável.',
  AMBIGUOUS_COMMERCIAL_RUN_EXISTS:
    'Há uma ocorrência que precisa de atenção antes de continuar.',
  STALE_COMMERCIAL_EXECUTION_EXISTS:
    'Há uma execução antiga que precisa de atenção.',
  OPERATIONAL_STATUS_UNAVAILABLE:
    'O estado operacional não pôde ser confirmado agora.',
};

const friendlyBlocker = (blocker: OperationalAdminBlocker) =>
  blockerMessages[blocker.code] ??
  'Existe uma pendência que precisa de atenção.';

const actionConfirmed = (message: string) =>
  typeof window === 'undefined' || window.confirm(message);

const operationalErrorMessage = (cause: unknown, fallback: string) => {
  if (!(cause instanceof DashboardApiError)) {
    return cause instanceof Error ? cause.message : fallback;
  }
  if (cause.code === 'OPERATIONAL_CAS_CONFLICT') {
    return 'Este grupo foi alterado em outro lugar. Atualize os dados antes de tentar novamente.';
  }
  if (cause.code === 'OPERATIONAL_ASSIGNMENT_LIFECYCLE_ACTIVE') {
    return 'Há um envio em andamento para este grupo. Aguarde a conclusão antes de trocar o WhatsApp responsável.';
  }
  if (cause.code === 'WHATSAPP_GROUP_DIRECTORY_UNAVAILABLE') {
    return 'Não foi possível consultar os grupos no WhatsApp agora.';
  }
  if (cause.code?.includes('CONFIRMATION')) {
    return 'Confirmação necessária para concluir esta alteração.';
  }
  if (cause.code?.includes('INVALID')) {
    return cause.message || 'Os dados desta alteração precisam ser revisados.';
  }
  return cause.message || fallback;
};

const statusLabel = (group: OperationalAdminGroup) => {
  if (group.paused) return 'Pausado';
  return group.active ? 'Ativo' : 'Inativo';
};

const statusTone = (group: OperationalAdminGroup) => {
  if (group.paused) return 'warning' as const;
  return group.active ? ('success' as const) : ('neutral' as const);
};

const groupHasPending = (group: OperationalAdminGroup) =>
  group.blockers.length > 0;

const groupAssignments = (group: OperationalAdminGroup) => {
  if (group.assignedInstanceNames !== undefined) {
    return [...group.assignedInstanceNames];
  }
  return group.assignedInstanceName ? [group.assignedInstanceName] : [];
};

const assignmentsEqual = (left: string[], right: string[]) =>
  left.length === right.length &&
  left.every((name, index) => name === right[index]);

const upcomingAssignmentLabel = (group: OperationalAdminGroup) => {
  const upcoming = group.upcomingAssignments ?? [];
  return upcoming.length > 0
    ? upcoming
        .map(
          ({ scheduledFor, instanceName }) =>
            `${formatDateTime(scheduledFor)} · ${instanceName}`,
        )
        .join(' · ')
    : 'Não planejado';
};

function SummaryCard({
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  detail: string;
  tone?: 'neutral' | 'warning' | 'danger';
}) {
  return (
    <div className="ops-kpi-card" data-tone={tone}>
      <span className="ops-kpi-label">{label}</span>
      <strong className="ops-kpi-value">{value}</strong>
      <span className="ops-kpi-detail">{detail}</span>
    </div>
  );
}

function AdvancedGroupDetails({ group }: { group: OperationalAdminGroup }) {
  return (
    <details className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-3 font-medium text-slate-700">
        <span>Informações avançadas</span>
        <ChevronDown size={16} aria-hidden="true" />
      </summary>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-slate-500">Identificador técnico</dt>
          <dd className="mt-1 break-all font-mono text-xs text-slate-700">
            {group.id}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Fingerprint</dt>
          <dd className="mt-1 break-all font-mono text-xs text-slate-700">
            {group.fingerprint ?? 'Não disponível'}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Instância de origem</dt>
          <dd className="mt-1 text-slate-700">
            {group.sourceInstanceName ?? 'Não disponível'}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Última sincronização</dt>
          <dd className="mt-1 text-slate-700">
            {formatDateTime(group.lastSyncedAt)}
          </dd>
        </div>
        {group.blockers.length > 0 ? (
          <div className="sm:col-span-2">
            <dt className="text-xs text-slate-500">Diagnóstico técnico</dt>
            <dd className="mt-1 break-words font-mono text-xs text-slate-700">
              {group.blockers.map((blocker) => blocker.code).join(' · ')}
            </dd>
          </div>
        ) : null}
      </dl>
    </details>
  );
}

function GroupCard({
  group,
  overview,
  saving,
  expanded,
  onToggleExpanded,
  onChange,
}: {
  group: OperationalAdminGroup;
  overview: OperationalAdmin;
  saving: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  onChange: (
    group: OperationalAdminGroup,
    input: {
      active?: boolean;
      paused?: boolean;
      assignedInstanceName?: string | null;
      assignedInstanceNames?: string[];
    },
    confirmation: string,
    confirmationMessage: string,
  ) => void;
}) {
  const [assignments, setAssignments] = useState(() => groupAssignments(group));
  const [assignmentToAdd, setAssignmentToAdd] = useState('');

  useEffect(() => {
    setAssignments(groupAssignments(group));
    setAssignmentToAdd('');
  }, [
    group.assignedInstanceName,
    group.assignedInstanceNames?.join('\u0000'),
    group.assignmentRevision,
    group.updatedAt,
  ]);

  const activeInstances = overview.instances.filter(
    (instance) => instance.active && !instance.paused,
  );
  const hasPending = groupHasPending(group);
  const originalAssignments = groupAssignments(group);
  const assignmentChanged = !assignmentsEqual(assignments, originalAssignments);
  const assignmentLabel = assignments.length
    ? assignments.join(' → ')
    : 'Nenhum WhatsApp responsável';

  return (
    <article className="ops-group-card" data-pending={hasPending}>
      <div className="ops-group-card-header">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="ops-card-title truncate">{group.name}</h3>
            <OpsBadge tone={statusTone(group)}>{statusLabel(group)}</OpsBadge>
            {group.available ? (
              <OpsBadge tone="success">Disponível</OpsBadge>
            ) : (
              <OpsBadge tone="warning">Disponibilidade pendente</OpsBadge>
            )}
          </div>
          <p className="mt-2 text-sm text-slate-600">{assignmentLabel}</p>
        </div>
        <button
          type="button"
          className="ops-button shrink-0"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          aria-controls={`group-edit-${group.id}`}
        >
          <Edit3 size={14} aria-hidden="true" />
          {expanded ? 'Fechar edição' : 'Editar'}
        </button>
      </div>

      <div className="ops-group-card-summary">
        <div>
          <span className="ops-detail-label">Campanha</span>
          <strong>{group.campaign?.name ?? 'Sem campanha'}</strong>
        </div>
        <div>
          <span className="ops-detail-label">Envios hoje</span>
          <strong>Não disponível</strong>
        </div>
        <div>
          <span className="ops-detail-label">Limite diário</span>
          <strong>Não disponível</strong>
        </div>
        <div>
          <span className="ops-detail-label">Próximo envio</span>
          <strong>{formatDateTime(group.nextSendAt)}</strong>
        </div>
        <div>
          <span className="ops-detail-label">Último envio</span>
          <strong>{formatDateTime(group.lastSendAt)}</strong>
        </div>
        <div className="sm:col-span-2">
          <span className="ops-detail-label">Próximos slots</span>
          <strong className="text-sm font-medium">
            {upcomingAssignmentLabel(group)}
          </strong>
        </div>
      </div>

      <div className="ops-group-card-attention" aria-live="polite">
        {hasPending ? (
          <>
            <AlertCircle size={16} aria-hidden="true" />
            <span>
              <strong>Pendência:</strong> {friendlyBlocker(group.blockers[0])}
              {group.blockers.length > 1
                ? ` (+${group.blockers.length - 1} outra${group.blockers.length === 2 ? '' : 's'})`
                : ''}
            </span>
          </>
        ) : (
          <>
            <CheckCircle2 size={16} aria-hidden="true" />
            <span>Sem pendências acionáveis.</span>
          </>
        )}
      </div>

      {expanded ? (
        <div
          id={`group-edit-${group.id}`}
          className="ops-group-editor"
          aria-label={`Editar ${group.name}`}
        >
          <div className="ops-group-editor-actions">
            <button
              type="button"
              className="ops-button"
              disabled={saving}
              onClick={() =>
                onChange(
                  group,
                  { active: !group.active },
                  CHANGE_CONFIRMATION,
                  group.active
                    ? `Desativar o grupo ${group.name}?`
                    : `Ativar o grupo ${group.name}?`,
                )
              }
            >
              <Power size={14} aria-hidden="true" />
              {group.active ? 'Desativar grupo' : 'Ativar grupo'}
            </button>
            <button
              type="button"
              className="ops-button"
              data-variant="danger"
              disabled={saving}
              onClick={() =>
                onChange(
                  group,
                  { paused: !group.paused },
                  PAUSE_CONFIRMATION,
                  group.paused
                    ? `Retomar o grupo ${group.name}?`
                    : `Pausar o grupo ${group.name}?`,
                )
              }
            >
              {group.paused ? (
                <Play size={14} aria-hidden="true" />
              ) : (
                <Pause size={14} aria-hidden="true" />
              )}
              {group.paused ? 'Retomar grupo' : 'Pausar grupo'}
            </button>
          </div>

          <div className="ops-group-assignment">
            <div>
              <p className="ops-control-label">Números por ordem de slot</p>
              <p className="ops-control-sub">
                A rotação segue esta ordem. A troca é explícita e fica bloqueada
                enquanto houver envio em andamento.
              </p>
            </div>
            <div
              className="grid gap-2"
              aria-label={`Ordem de WhatsApps para ${group.name}`}
            >
              {assignments.length === 0 ? (
                <p className="text-sm text-slate-500">
                  Nenhum número atribuído.
                </p>
              ) : null}
              {assignments.map((name, index) => {
                const currentUnavailable = !activeInstances.some(
                  (instance) => instance.name === name,
                );
                return (
                  <div
                    key={`${name}-${index}`}
                    className="flex items-center gap-2"
                  >
                    <span className="w-6 text-center text-xs font-semibold text-slate-500">
                      {index + 1}
                    </span>
                    <label className="min-w-0 flex-1">
                      <span className="sr-only">
                        WhatsApp na posição {index + 1} para {group.name}
                      </span>
                      <select
                        className="ops-input"
                        value={name}
                        onChange={(event) => {
                          const next = event.target.value;
                          if (
                            !next ||
                            assignments.some(
                              (item, itemIndex) =>
                                item === next && itemIndex !== index,
                            )
                          )
                            return;
                          setAssignments((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index ? next : item,
                            ),
                          );
                        }}
                        disabled={saving}
                        aria-label={`Novo WhatsApp responsável para ${group.name} posição ${index + 1}`}
                      >
                        {currentUnavailable ? (
                          <option value={name} disabled>
                            {name} (indisponível)
                          </option>
                        ) : null}
                        {activeInstances
                          .filter(
                            (instance) =>
                              instance.name === name ||
                              !assignments.includes(instance.name),
                          )
                          .map((instance) => (
                            <option key={instance.name} value={instance.name}>
                              {instance.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="ops-button"
                      aria-label={`Mover ${name} para cima`}
                      disabled={saving || index === 0}
                      onClick={() =>
                        setAssignments((current) => {
                          const next = [...current];
                          [next[index - 1], next[index]] = [
                            next[index],
                            next[index - 1],
                          ];
                          return next;
                        })
                      }
                    >
                      <ArrowUp size={14} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="ops-button"
                      aria-label={`Mover ${name} para baixo`}
                      disabled={saving || index === assignments.length - 1}
                      onClick={() =>
                        setAssignments((current) => {
                          const next = [...current];
                          [next[index], next[index + 1]] = [
                            next[index + 1],
                            next[index],
                          ];
                          return next;
                        })
                      }
                    >
                      <ArrowDown size={14} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="ops-button"
                      aria-label={`Remover ${name}`}
                      disabled={saving}
                      onClick={() =>
                        setAssignments((current) =>
                          current.filter((_, itemIndex) => itemIndex !== index),
                        )
                      }
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
              <div className="flex flex-wrap items-center gap-2">
                <label className="min-w-0 flex-1">
                  <span className="sr-only">
                    Adicionar WhatsApp para {group.name}
                  </span>
                  <select
                    className="ops-input"
                    value={assignmentToAdd}
                    onChange={(event) => setAssignmentToAdd(event.target.value)}
                    disabled={saving}
                    aria-label={`Adicionar WhatsApp para ${group.name}`}
                  >
                    <option value="">Adicionar número…</option>
                    {activeInstances
                      .filter(
                        (instance) => !assignments.includes(instance.name),
                      )
                      .map((instance) => (
                        <option key={instance.name} value={instance.name}>
                          {instance.name}
                        </option>
                      ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="ops-button"
                  disabled={saving || !assignmentToAdd}
                  onClick={() => {
                    setAssignments((current) => [...current, assignmentToAdd]);
                    setAssignmentToAdd('');
                  }}
                >
                  Adicionar
                </button>
              </div>
            </div>
            <button
              type="button"
              className="ops-button"
              data-variant="primary"
              disabled={saving || !assignmentChanged}
              onClick={() => {
                const previous = originalAssignments.length
                  ? originalAssignments.join(' → ')
                  : 'nenhum';
                const nextLabel = assignments.length
                  ? assignments.join(' → ')
                  : 'nenhum';
                const input =
                  group.assignedInstanceNames !== undefined ||
                  assignments.length > 1 ||
                  originalAssignments.length > 1
                    ? { assignedInstanceNames: assignments }
                    : { assignedInstanceName: assignments[0] ?? null };
                const confirmationMessage =
                  assignments.length <= 1 && originalAssignments.length <= 1
                    ? `Trocar o WhatsApp responsável de ${previous} para ${nextLabel} no grupo ${group.name}?`
                    : `Trocar a ordem de WhatsApps de ${previous} para ${nextLabel} no grupo ${group.name}?`;
                onChange(
                  group,
                  input,
                  ASSIGNMENT_CONFIRMATION,
                  confirmationMessage,
                );
              }}
            >
              {assignments.length > 1 || originalAssignments.length > 1
                ? 'Salvar ordem dos WhatsApps'
                : 'Trocar WhatsApp responsável'}
            </button>
          </div>
        </div>
      ) : null}

      <AdvancedGroupDetails group={group} />
    </article>
  );
}

export function GroupsManagement() {
  const [overview, setOverview] = useState<OperationalAdmin | null>(null);
  const [filter, setFilter] = useState<GroupFilter>('all');
  const [instanceFilter, setInstanceFilter] = useState('');
  const [campaignFilter, setCampaignFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = async (
    initial = false,
    { showError = true }: { showError?: boolean } = {},
  ): Promise<boolean> => {
    if (initial) setLoading(true);
    else setRefreshing(true);
    setError(null);
    setSuccess(null);
    try {
      setOverview(await getOperationalAdmin());
      return true;
    } catch (cause) {
      if (showError) {
        setError(
          operationalErrorMessage(
            cause,
            'Não foi possível carregar os grupos agora.',
          ),
        );
      }
      return false;
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load(true);
  }, []);

  const visibleGroups = useMemo(() => {
    if (!overview) return [];
    return overview.groups.filter((group) => {
      if (filter === 'active' && (!group.active || group.paused)) return false;
      if (filter === 'paused' && !group.paused) return false;
      if (filter === 'pending' && !groupHasPending(group)) return false;
      const assignments = groupAssignments(group);
      if (instanceFilter === '__none__' && assignments.length > 0) {
        return false;
      }
      if (
        instanceFilter &&
        instanceFilter !== '__none__' &&
        !assignments.includes(instanceFilter)
      ) {
        return false;
      }
      if (campaignFilter && group.campaign?.id !== campaignFilter) {
        return false;
      }
      return true;
    });
  }, [campaignFilter, filter, instanceFilter, overview]);

  const updateGroup = async (
    group: OperationalAdminGroup,
    input: {
      active?: boolean;
      paused?: boolean;
      assignedInstanceName?: string | null;
      assignedInstanceNames?: string[];
    },
    confirmation: string,
    confirmationMessage: string,
  ) => {
    if (!actionConfirmed(confirmationMessage)) return;
    if (!group.updatedAt) {
      setError(
        'Não foi possível confirmar a versão atual deste grupo. Atualize os dados e tente novamente.',
      );
      return;
    }
    setSavingId(group.id);
    setError(null);
    setSuccess(null);
    try {
      await updateOperationalGroup(group.id, {
        ...input,
        expectedUpdatedAt: group.updatedAt,
        confirmation,
      });
      const refreshed = await load(false, { showError: false });
      setSuccess(
        refreshed
          ? `Grupo ${group.name} atualizado.`
          : 'Alteração concluída, mas não foi possível atualizar os dados exibidos.',
      );
    } catch (cause) {
      setError(operationalErrorMessage(cause, 'O grupo não foi atualizado.'));
    } finally {
      setSavingId(null);
    }
  };

  const activeCount = overview?.groups.filter(
    (group) => group.active && !group.paused,
  ).length;
  const pausedCount = overview?.groups.filter((group) => group.paused).length;
  const pendingCount = overview?.groups.filter(groupHasPending).length;
  const unassignedCount = overview?.groups.filter(
    (group) => groupAssignments(group).length === 0,
  ).length;

  return (
    <div className="groups-management">
      <OpsPageHeading
        eyebrow="Roteamento diário"
        title="Grupos"
        description="Gerencie onde as ofertas serão enviadas e qual WhatsApp é responsável."
        actions={
          <button
            type="button"
            className="ops-button"
            onClick={() => void load()}
            disabled={refreshing}
          >
            <RefreshCw
              size={14}
              className={refreshing ? 'animate-spin' : ''}
              aria-hidden="true"
            />
            Atualizar
          </button>
        }
      />

      {loading ? <OpsLoading label="Carregando grupos" /> : null}
      {error ? (
        <OpsState
          title="Grupos indisponíveis"
          message={error}
          tone="danger"
          action={
            <button
              type="button"
              className="ops-button"
              onClick={() => void load()}
            >
              Tentar novamente
            </button>
          }
        />
      ) : null}
      {success ? (
        <div className="ops-state" role="status" aria-live="polite">
          <CheckCircle2 size={16} aria-hidden="true" />
          <span>{success}</span>
        </div>
      ) : null}

      {overview ? (
        <>
          <section className="ops-kpi-grid" aria-label="Resumo dos grupos">
            <SummaryCard
              label="Grupos em operação"
              value={activeCount ?? 0}
              detail="ativos e sem pausa"
            />
            <SummaryCard
              label="Grupos pausados"
              value={pausedCount ?? 0}
              detail="temporariamente parados"
              tone="warning"
            />
            <SummaryCard
              label="Com pendência"
              value={pendingCount ?? 0}
              detail="precisam de atenção"
              tone={pendingCount ? 'danger' : 'neutral'}
            />
            <SummaryCard
              label="Sem responsável"
              value={unassignedCount ?? 0}
              detail="aguardam um WhatsApp"
              tone={unassignedCount ? 'warning' : 'neutral'}
            />
          </section>

          <OpsSection
            title="Filtrar grupos"
            meta={`${visibleGroups.length} de ${overview.groups.length} grupo(s)`}
          >
            <div className="ops-filter-row -mx-[18px] -mt-[18px] border-b-0">
              {(
                [
                  ['all', 'Todos'],
                  ['active', 'Ativos'],
                  ['paused', 'Pausados'],
                  ['pending', 'Com pendência'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className="ops-filter-button"
                  data-active={filter === value}
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="groups-secondary-filters">
              <label className="ops-control">
                <span className="ops-control-label">WhatsApp responsável</span>
                <select
                  className="ops-input"
                  value={instanceFilter}
                  onChange={(event) => setInstanceFilter(event.target.value)}
                >
                  <option value="">Todos</option>
                  <option value="__none__">Sem responsável</option>
                  {overview.instances.map((instance) => (
                    <option key={instance.name} value={instance.name}>
                      {instance.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ops-control">
                <span className="ops-control-label">Campanha</span>
                <select
                  className="ops-input"
                  value={campaignFilter}
                  onChange={(event) => setCampaignFilter(event.target.value)}
                >
                  <option value="">Todas</option>
                  {overview.campaigns.map((campaign) => (
                    <option key={campaign.id} value={campaign.id}>
                      {campaign.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </OpsSection>

          <OpsSection
            title="Lista de grupos"
            meta="Estado operacional, responsável e agenda persistidos pela API."
            className="groups-list-section"
          >
            {overview.groups.length === 0 ? (
              <OpsEmpty
                title="Nenhum grupo cadastrado"
                message="Não há grupos disponíveis para administrar agora."
              />
            ) : visibleGroups.length === 0 ? (
              <OpsEmpty
                title="Nenhum grupo neste filtro"
                message="Ajuste os filtros para consultar os grupos disponíveis."
              />
            ) : (
              <div className="groups-list">
                {visibleGroups.map((group) => (
                  <GroupCard
                    key={group.id}
                    group={group}
                    overview={overview}
                    saving={savingId === group.id}
                    expanded={expandedId === group.id}
                    onToggleExpanded={() =>
                      setExpandedId((current) =>
                        current === group.id ? null : group.id,
                      )
                    }
                    onChange={(nextGroup, input, confirmation, message) =>
                      void updateGroup(nextGroup, input, confirmation, message)
                    }
                  />
                ))}
              </div>
            )}
          </OpsSection>

          <div className="ops-state" role="note">
            <ShieldAlert size={16} aria-hidden="true" />
            <span>
              A disponibilidade é somente leitura nesta tela. O histórico de
              envios fica em <Link href="/envios">Ver histórico de envios</Link>
              .
            </span>
          </div>
        </>
      ) : null}
    </div>
  );
}
