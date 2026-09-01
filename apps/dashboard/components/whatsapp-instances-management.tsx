'use client';

import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Pause,
  Play,
  Plus,
  Power,
  RefreshCw,
} from 'lucide-react';
import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import {
  DashboardApiError,
  createOperationalInstance,
  getOperationalAdmin,
  updateOperationalInstance,
  type OperationalAdmin,
  type OperationalAdminBlocker,
  type OperationalAdminInstance,
} from '../lib/api';
import { formatDateTime } from '../lib/format';
import {
  OpsBadge,
  OpsEmpty,
  OpsLoading,
  OpsPageHeading,
  OpsSection,
  OpsState,
  type OpsTone,
} from './ops-components';

const CHANGE_CONFIRMATION = 'CONFIRMAR_ALTERACAO_OPERACIONAL';
const PAUSE_CONFIRMATION = 'CONFIRMAR_PAUSA_OPERACIONAL';

const blockerMessages: Record<string, string> = {
  INSTANCE_INACTIVE: 'Este WhatsApp está inativo.',
  INSTANCE_PAUSED: 'Este WhatsApp está pausado.',
  OPERATIONAL_STATUS_UNAVAILABLE:
    'O estado operacional não pôde ser confirmado agora.',
  COMMERCIAL_EXECUTION_IN_PROGRESS:
    'Há um envio em andamento. Aguarde antes de fazer uma alteração.',
  AMBIGUOUS_COMMERCIAL_RUN_EXISTS:
    'Há uma ocorrência que precisa de atenção antes de continuar.',
  STALE_COMMERCIAL_EXECUTION_EXISTS:
    'Há uma execução antiga que precisa de atenção.',
};

type HealthPresentation = {
  label: string;
  tone: OpsTone;
  description: string;
};

export const presentInstanceHealth = (health: string): HealthPresentation => {
  switch (health.trim().toUpperCase()) {
    case 'HEALTHY':
    case 'OK':
    case 'OPERATIONAL':
    case 'READY':
      return {
        label: 'Operacional',
        tone: 'success',
        description: 'O estado operacional foi confirmado.',
      };
    case 'UNAVAILABLE':
    case 'OFFLINE':
    case 'ERROR':
      return {
        label: 'Indisponível',
        tone: 'danger',
        description: 'O estado operacional não está disponível agora.',
      };
    case 'UNKNOWN':
    default:
      return {
        label: 'Estado não confirmado',
        tone: 'warning',
        description:
          'Ainda não há evidência suficiente para confirmar o estado.',
      };
  }
};

const presentBlocker = (blocker: OperationalAdminBlocker) =>
  blockerMessages[blocker.code] ??
  'Existe uma pendência que precisa de atenção.';

const actionConfirmed = (message: string) =>
  typeof window === 'undefined' || window.confirm(message);

const operationalErrorMessage = (cause: unknown, fallback: string) => {
  if (!(cause instanceof DashboardApiError)) {
    return fallback;
  }
  if (cause.code === 'OPERATIONAL_CAS_CONFLICT') {
    return 'Este WhatsApp foi alterado em outro lugar. Atualize os dados antes de tentar novamente.';
  }
  if (cause.code?.includes('LIFECYCLE_ACTIVE')) {
    return 'Há um envio em andamento. Aguarde a conclusão antes de alterar este WhatsApp.';
  }
  if (cause.code?.includes('CONFIRMATION')) {
    return 'Confirmação necessária para concluir esta alteração.';
  }
  return fallback;
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
    <div className="ops-kpi-card whatsapp-instance-kpi" data-tone={tone}>
      <span className="ops-kpi-label">{label}</span>
      <strong className="ops-kpi-value">{value}</strong>
      <span className="ops-kpi-detail">{detail}</span>
    </div>
  );
}

function AdvancedInstanceDetails({
  instance,
}: {
  instance: OperationalAdminInstance;
}) {
  return (
    <details className="whatsapp-instance-advanced">
      <summary>
        <span>Informações avançadas</span>
        <ChevronDown size={16} aria-hidden="true" />
      </summary>
      <dl>
        <div>
          <dt>Estado técnico de saúde</dt>
          <dd>{instance.health}</dd>
        </div>
        <div>
          <dt>Última atualização</dt>
          <dd>{formatDateTime(instance.updatedAt)}</dd>
        </div>
        {instance.blockers.length > 0 ? (
          <div className="whatsapp-instance-advanced-wide">
            <dt>Códigos de pendência</dt>
            <dd>
              {instance.blockers.map((blocker) => blocker.code).join(' · ')}
            </dd>
          </div>
        ) : null}
      </dl>
    </details>
  );
}

function InstanceCard({
  instance,
  saving,
  onChange,
}: {
  instance: OperationalAdminInstance;
  saving: boolean;
  onChange: (
    instance: OperationalAdminInstance,
    input: { active?: boolean; paused?: boolean },
  ) => void;
}) {
  const health = presentInstanceHealth(instance.health);
  const hasPending = instance.blockers.length > 0;
  const assignedGroupLabel = `${instance.assignedGroupCount} ${instance.assignedGroupCount === 1 ? 'grupo atribuído' : 'grupos atribuídos'}`;

  return (
    <article
      className="whatsapp-instance-card"
      data-pending={hasPending}
      aria-labelledby={`whatsapp-instance-${instance.name}`}
    >
      <div className="whatsapp-instance-card-header">
        <div className="min-w-0">
          <div className="whatsapp-instance-title-row">
            <h2
              id={`whatsapp-instance-${instance.name}`}
              className="ops-card-title"
            >
              {instance.name}
            </h2>
            <OpsBadge tone={instance.active ? 'success' : 'neutral'}>
              {instance.active ? 'Ativa' : 'Inativa'}
            </OpsBadge>
            <OpsBadge
              tone={
                instance.paused
                  ? 'warning'
                  : instance.active
                    ? 'success'
                    : 'neutral'
              }
            >
              {instance.paused
                ? 'Pausada'
                : instance.active
                  ? 'Operando'
                  : 'Sem pausa'}
            </OpsBadge>
          </div>
          <div className="whatsapp-instance-health" data-tone={health.tone}>
            <span className="whatsapp-instance-health-label">
              {health.label}
            </span>
            <span>{health.description}</span>
          </div>
        </div>
        <Link
          className="ops-button whatsapp-instance-groups-link"
          href="/whatsapp"
        >
          Ver grupos
        </Link>
      </div>

      <dl className="whatsapp-instance-summary">
        <div>
          <dt>Grupos atribuídos</dt>
          <dd>{assignedGroupLabel}</dd>
        </div>
        <div>
          <dt>Último envio</dt>
          <dd>{formatDateTime(instance.lastSendAt)}</dd>
        </div>
        <div>
          <dt>Próximo envio</dt>
          <dd>{formatDateTime(instance.nextSendAt)}</dd>
        </div>
      </dl>

      <div className="whatsapp-instance-attention" aria-live="polite">
        {hasPending ? (
          <>
            <AlertCircle size={17} aria-hidden="true" />
            <span>
              <strong>Atenção:</strong> {presentBlocker(instance.blockers[0])}
              {instance.blockers.length > 1
                ? ` (+${instance.blockers.length - 1} outra${instance.blockers.length === 2 ? '' : 's'})`
                : ''}
            </span>
          </>
        ) : (
          <>
            <CheckCircle2 size={17} aria-hidden="true" />
            <span>Sem pendências acionáveis.</span>
          </>
        )}
      </div>

      <div className="whatsapp-instance-actions">
        <button
          type="button"
          className="ops-button"
          disabled={saving}
          onClick={() => onChange(instance, { active: !instance.active })}
        >
          <Power size={15} aria-hidden="true" />
          {instance.active ? 'Desativar' : 'Ativar'}
        </button>
        <button
          type="button"
          className="ops-button"
          data-variant="danger"
          disabled={saving}
          onClick={() => onChange(instance, { paused: !instance.paused })}
        >
          {instance.paused ? (
            <Play size={15} aria-hidden="true" />
          ) : (
            <Pause size={15} aria-hidden="true" />
          )}
          {instance.paused ? 'Retirar pausa' : 'Pausar'}
        </button>
      </div>

      <AdvancedInstanceDetails instance={instance} />
    </article>
  );
}

export function WhatsAppInstancesManagement() {
  const [overview, setOverview] = useState<OperationalAdmin | null>(null);
  const [instanceName, setInstanceName] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = async (initial = false) => {
    if (initial) setLoading(true);
    else setRefreshing(true);
    setError(null);
    setSuccess(null);
    try {
      setOverview(await getOperationalAdmin());
      return true;
    } catch (cause) {
      setError(
        operationalErrorMessage(
          cause,
          'Não foi possível carregar os WhatsApps agora.',
        ),
      );
      return false;
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load(true);
  }, []);

  const createInstance = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = instanceName.trim();
    if (
      !trimmedName ||
      !actionConfirmed('Cadastrar esta instancia operacional?')
    ) {
      return;
    }
    setSaving('create-instance');
    setError(null);
    setSuccess(null);
    try {
      await createOperationalInstance(trimmedName, CHANGE_CONFIRMATION);
      setInstanceName('');
      if (await load()) {
        setSuccess(
          'Instância cadastrada como inativa até validação operacional.',
        );
      }
    } catch (cause) {
      setError(
        operationalErrorMessage(cause, 'A instância não foi cadastrada.'),
      );
    } finally {
      setSaving(null);
    }
  };

  const changeInstance = async (
    instance: OperationalAdminInstance,
    input: { active?: boolean; paused?: boolean },
  ) => {
    const isPauseChange = input.paused !== undefined;
    const confirmation = isPauseChange
      ? PAUSE_CONFIRMATION
      : CHANGE_CONFIRMATION;
    const prompt = isPauseChange
      ? input.paused
        ? `Confirmar pausar a instancia ${instance.name}?`
        : `Confirmar retirar a pausa da instancia ${instance.name}?`
      : input.active
        ? `Confirmar ativar a instancia ${instance.name}?`
        : `Confirmar desativar a instancia ${instance.name}?`;

    if (!actionConfirmed(prompt)) return;
    setSaving(`instance:${instance.name}`);
    setError(null);
    setSuccess(null);
    try {
      await updateOperationalInstance(instance.name, {
        ...input,
        expectedUpdatedAt: instance.updatedAt,
        confirmation,
      });
      if (await load()) {
        setSuccess(`Instância ${instance.name} atualizada.`);
      }
    } catch (cause) {
      setError(
        operationalErrorMessage(cause, 'A instância não foi atualizada.'),
      );
    } finally {
      setSaving(null);
    }
  };

  const instances = overview?.instances ?? [];
  const activeCount = instances.filter((instance) => instance.active).length;
  const pausedCount = instances.filter((instance) => instance.paused).length;
  const assignedGroupCount = instances.reduce(
    (total, instance) => total + instance.assignedGroupCount,
    0,
  );
  const pendingCount = instances.filter(
    (instance) => instance.blockers.length > 0,
  ).length;

  return (
    <div className="whatsapp-instances-management">
      <OpsPageHeading
        eyebrow="Operação diária"
        title="WhatsApps"
        description="Acompanhe as instâncias usadas para enviar ofertas aos grupos."
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

      {loading ? <OpsLoading label="Carregando WhatsApps" /> : null}
      {error ? (
        <OpsState
          title="WhatsApps indisponíveis"
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
          <section className="ops-kpi-grid" aria-label="Resumo dos WhatsApps">
            <SummaryCard
              label="Instâncias ativas"
              value={activeCount}
              detail="com estado ativo"
            />
            <SummaryCard
              label="Instâncias pausadas"
              value={pausedCount}
              detail="temporariamente paradas"
              tone="warning"
            />
            <SummaryCard
              label="Grupos atribuídos"
              value={assignedGroupCount}
              detail="derivados dos vínculos reais"
            />
            <SummaryCard
              label="Com pendência"
              value={pendingCount}
              detail="precisam de atenção"
              tone={pendingCount > 0 ? 'danger' : 'neutral'}
            />
          </section>

          <OpsSection
            title="Instâncias"
            meta={`${instances.length} ${instances.length === 1 ? 'WhatsApp cadastrado' : 'WhatsApps cadastrados'}`}
          >
            {instances.length === 0 ? (
              <OpsEmpty
                title="Nenhum WhatsApp cadastrado"
                message="Cadastre uma identificação operacional para acompanhar seus grupos."
              />
            ) : (
              <div className="whatsapp-instance-list">
                {instances.map((instance) => (
                  <InstanceCard
                    key={instance.name}
                    instance={instance}
                    saving={saving === `instance:${instance.name}`}
                    onChange={(current, input) =>
                      void changeInstance(current, input)
                    }
                  />
                ))}
              </div>
            )}
          </OpsSection>

          <OpsSection
            title="Cadastrar instância"
            className="whatsapp-instance-create"
          >
            <p className="whatsapp-instance-create-help">
              O cadastro cria a identificação operacional. A conexão de um novo
              WhatsApp ainda não está disponível pelo painel.
            </p>
            <form
              onSubmit={createInstance}
              className="whatsapp-instance-create-form"
            >
              <label>
                <span>Nome da instância</span>
                <input
                  className="ops-input"
                  value={instanceName}
                  onChange={(event) => setInstanceName(event.target.value)}
                  placeholder="afiliado-shopee-local"
                  autoComplete="off"
                />
              </label>
              <button
                type="submit"
                className="ops-button"
                data-variant="primary"
                disabled={saving !== null || !instanceName.trim()}
              >
                <Plus size={15} aria-hidden="true" />
                Cadastrar instância
              </button>
            </form>
          </OpsSection>

          <div className="whatsapp-instance-footer-links">
            <Link href="/envios">Ver histórico de envios</Link>
            <span aria-hidden="true">·</span>
            <Link href="/whatsapp">Ver grupos</Link>
          </div>
        </>
      ) : null}
    </div>
  );
}
