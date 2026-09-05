'use client';

import { Pause, Play, Plus, Save, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { COMMERCIAL_DAILY_LIMIT_MAX } from '@shopee-auto-affiliate-ai/shared';
import {
  activateCommercialCampaign,
  createCommercialCampaign,
  deactivateCommercialCampaign,
  listCommercialCampaigns,
  listCommercialNiches,
  listWhatsAppGroups,
  updateCommercialCampaign,
  type CommercialCampaign,
  type CommercialCampaignCreate,
  type CommercialNiche,
  type CommercialCampaignScheduleUpdate,
  type WhatsAppGroup,
} from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import {
  OpsBadge,
  OpsEmpty,
  OpsLoading,
  OpsPageHeading,
  OpsSection,
  OpsState,
} from '../../components/ops-components';

type CampaignDraft = {
  name: string;
  nicheId: string;
  cadence: string;
  start: string;
  end: string;
  dailyLimit: string;
};

type CreateCampaignDraft = CampaignDraft & { groupDestinationId: string };

const campaignDraft = (campaign: CommercialCampaign): CampaignDraft => ({
  name: campaign.name,
  nicheId: campaign.nicheId,
  cadence: String(campaign.cadenceMinutes),
  start: campaign.allowedStartTime,
  end: campaign.allowedEndTime,
  dailyLimit: String(campaign.dailyLimit),
});

const emptyCreateDraft = (): CreateCampaignDraft => ({
  name: '',
  groupDestinationId: '',
  nicheId: '',
  cadence: '15',
  start: '07:00',
  end: '22:00',
  dailyLimit: '60',
});

const maskFingerprint = (value: string | null | undefined) =>
  value ? `${value.slice(0, 10)}...${value.slice(-6)}` : '—';

const timeToMinutes = (value: string) => {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
};

const theoreticalSlotCount = (start: string, end: string, cadence: string) => {
  const startMinutes = timeToMinutes(start);
  const endMinutes = timeToMinutes(end);
  const cadenceMinutes = Number(cadence);
  if (
    startMinutes === null ||
    endMinutes === null ||
    !Number.isInteger(cadenceMinutes) ||
    cadenceMinutes <= 0 ||
    startMinutes >= endMinutes
  ) {
    return null;
  }
  return Math.floor((endMinutes - startMinutes) / cadenceMinutes);
};

const formatDailyLimit = (value: number | null) =>
  value === null ? '—' : value.toLocaleString('pt-BR');

const activeAndAvailableGroups = (groups: WhatsAppGroup[]) =>
  groups.filter((group) => group.active && group.available && !group.paused);

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<CommercialCampaign[]>([]);
  const [groups, setGroups] = useState<WhatsAppGroup[]>([]);
  const [niches, setNiches] = useState<CommercialNiche[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, CampaignDraft>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<CreateCampaignDraft>(
    emptyCreateDraft,
  );

  useEffect(() => {
    let active = true;
    void Promise.all([
      listCommercialCampaigns(1, 50),
      listWhatsAppGroups(),
      listCommercialNiches(1, 100, true),
    ])
      .then(([campaignResponse, groupResponse, nicheResponse]) => {
        if (!active) return;
        setCampaigns(campaignResponse.items);
        setGroups(groupResponse);
        setNiches(nicheResponse.items);
        setDrafts(
          Object.fromEntries(
            campaignResponse.items.map((campaign) => [
              campaign.id,
              campaignDraft(campaign),
            ]),
          ),
        );
        const firstGroup = activeAndAvailableGroups(groupResponse)[0];
        const firstNiche = nicheResponse.items[0];
        const requestedGroupId =
          typeof window === 'undefined'
            ? null
            : new URLSearchParams(window.location.search).get('groupId');
        setCreateDraft((current) => ({
          ...current,
          groupDestinationId:
            requestedGroupId &&
            groupResponse.some((group) => group.id === requestedGroupId)
              ? requestedGroupId
              : current.groupDestinationId || firstGroup?.id || '',
          nicheId: current.nicheId || firstNiche?.id || '',
        }));
      })
      .catch((cause) => {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Não foi possível carregar campanhas, grupos e nichos.',
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const groupById = useMemo(
    () => new Map(groups.map((group) => [group.id, group])),
    [groups],
  );
  const availableGroups = useMemo(
    () => activeAndAvailableGroups(groups),
    [groups],
  );

  const saveCampaign = async (campaign: CommercialCampaign) => {
    const draft = drafts[campaign.id];
    if (!draft) return;
    const input: CommercialCampaignScheduleUpdate = {
      cadenceMinutes: Number(draft.cadence),
      allowedStartTime: draft.start,
      allowedEndTime: draft.end,
      dailyLimit: Number(draft.dailyLimit),
    };
    if (draft.name !== campaign.name) {
      input.name = draft.name;
    }
    if (draft.nicheId !== campaign.nicheId) {
      input.nicheId = draft.nicheId;
    }
    setSavingId(campaign.id);
    setError(null);
    try {
      const updated = await updateCommercialCampaign(campaign.id, input);
      setCampaigns((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setDrafts((current) => ({ ...current, [campaign.id]: campaignDraft(updated) }));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'A campanha não foi atualizada.',
      );
    } finally {
      setSavingId(null);
    }
  };

  const toggleCampaign = async (campaign: CommercialCampaign) => {
    const action = campaign.active ? 'desativar' : 'ativar';
    if (!window.confirm(`Confirmar ${action} a campanha "${campaign.name}"?`)) {
      return;
    }
    setSavingId(campaign.id);
    setError(null);
    try {
      const updated = campaign.active
        ? await deactivateCommercialCampaign(campaign.id)
        : await activateCommercialCampaign(campaign.id);
      setCampaigns((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setDrafts((current) => ({ ...current, [updated.id]: campaignDraft(updated) }));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : `Não foi possível ${action} a campanha.`,
      );
    } finally {
      setSavingId(null);
    }
  };

  const createCampaign = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      !createDraft.name.trim() ||
      !createDraft.groupDestinationId ||
      !createDraft.nicheId
    ) {
      setError('Informe nome, grupo e nicho para criar a campanha.');
      return;
    }
    const input: CommercialCampaignCreate = {
      name: createDraft.name,
      groupDestinationId: createDraft.groupDestinationId,
      nicheId: createDraft.nicheId,
      cadenceMinutes: Number(createDraft.cadence),
      timezone: 'America/Sao_Paulo',
      allowedStartTime: createDraft.start,
      allowedEndTime: createDraft.end,
      dailyLimit: Number(createDraft.dailyLimit),
    };
    setSavingId('new');
    setError(null);
    try {
      const created = await createCommercialCampaign(input);
      setCampaigns((current) => [created, ...current]);
      setDrafts((current) => ({ ...current, [created.id]: campaignDraft(created) }));
      setCreateDraft(emptyCreateDraft());
      setCreateOpen(false);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'A campanha não foi criada.',
      );
    } finally {
      setSavingId(null);
    }
  };

  return (
    <>
      <OpsPageHeading
        eyebrow="Configuração de campanhas"
        title="Campanhas"
        description="A associação entre campanha, nicho e grupo autorizado, com ajustes de cadência e janela."
        actions={
          <button
            type="button"
            className="ops-button"
            data-variant="primary"
            onClick={() => setCreateOpen((current) => !current)}
          >
            {createOpen ? <X size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
            {createOpen ? 'Fechar nova campanha' : 'Nova campanha'}
          </button>
        }
      />
      {loading ? <OpsLoading label="Carregando campanhas, grupos e nichos" /> : null}
      {error ? (
        <OpsState
          title="Configuração comercial indisponível"
          message={error}
          tone="danger"
        />
      ) : null}

      {!loading && createOpen ? (
        <OpsSection
          title="Nova campanha"
          meta="A campanha nasce inativa; revise o nicho e ative-a somente quando o grupo estiver pronto."
        >
          {availableGroups.length === 0 || niches.length === 0 ? (
            <OpsState
              title="Pré-requisitos pendentes"
              message={
                availableGroups.length === 0
                  ? 'Ative e confirme a disponibilidade de um grupo antes de criar a campanha.'
                  : 'Crie ou ative um nicho antes de criar a campanha.'
              }
              action={
                niches.length === 0 ? (
                  <Link className="ops-button" href="/nichos">
                    Configurar nicho
                  </Link>
                ) : undefined
              }
              tone="warning"
            />
          ) : (
            <form className="grid gap-4" onSubmit={(event) => void createCampaign(event)}>
              <div className="grid gap-4 md:grid-cols-3">
                <label className="ops-control md:col-span-2"><span className="ops-control-label">Nome da campanha</span><input className="ops-input" value={createDraft.name} onChange={(event) => setCreateDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Ex.: Ofertas para mamães" maxLength={80} /></label>
                <label className="ops-control"><span className="ops-control-label">Grupo</span><select className="ops-input" value={createDraft.groupDestinationId} onChange={(event) => setCreateDraft((current) => ({ ...current, groupDestinationId: event.target.value }))}><option value="">Selecione um grupo</option>{availableGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
                <label className="ops-control"><span className="ops-control-label">Nicho</span><select className="ops-input" value={createDraft.nicheId} onChange={(event) => setCreateDraft((current) => ({ ...current, nicheId: event.target.value }))}><option value="">Selecione um nicho</option>{niches.map((niche) => <option key={niche.id} value={niche.id}>{niche.name}</option>)}</select></label>
                <label className="ops-control"><span className="ops-control-label">Cadência (min)</span><input className="ops-input" type="number" min="5" max="180" value={createDraft.cadence} onChange={(event) => setCreateDraft((current) => ({ ...current, cadence: event.target.value }))} /></label>
                <label className="ops-control"><span className="ops-control-label">Limite diário</span><input className="ops-input" type="number" min="1" max={COMMERCIAL_DAILY_LIMIT_MAX} value={createDraft.dailyLimit} onChange={(event) => setCreateDraft((current) => ({ ...current, dailyLimit: event.target.value }))} /></label>
                <label className="ops-control"><span className="ops-control-label">Janela</span><span className="flex gap-2"><input className="ops-input min-w-0" type="time" value={createDraft.start} onChange={(event) => setCreateDraft((current) => ({ ...current, start: event.target.value }))} /><input className="ops-input min-w-0" type="time" value={createDraft.end} onChange={(event) => setCreateDraft((current) => ({ ...current, end: event.target.value }))} /></span><span className="ops-control-sub">America/Sao_Paulo</span></label>
              </div>
              <div className="flex justify-end"><button type="submit" className="ops-button" data-variant="primary" disabled={savingId === 'new'}><Save size={14} aria-hidden="true" />{savingId === 'new' ? 'Criando…' : 'Criar campanha'}</button></div>
            </form>
          )}
        </OpsSection>
      ) : null}

      {!loading ? (
        <div className="grid gap-4">
          {campaigns.length === 0 ? <OpsSection title="Campanhas"><OpsEmpty title="Nenhuma campanha retornada" message="Crie uma campanha para ligar um grupo a um nicho e a uma agenda." /></OpsSection> : null}
          {campaigns.map((campaign) => {
            const group = campaign.anchorDestinationId ? groupById.get(campaign.anchorDestinationId) : null;
            const draft = drafts[campaign.id] ?? campaignDraft(campaign);
            const slotCount = theoreticalSlotCount(draft.start, draft.end, draft.cadence);
            const configuredLimit = Number(draft.dailyLimit);
            const effectiveLimit = slotCount === null || !Number.isFinite(configuredLimit) ? null : Math.min(configuredLimit, slotCount);
            const currentNicheOptions: Array<Pick<CommercialNiche, 'id' | 'name' | 'active'>> = [
              ...(campaign.niche && !niches.some((niche) => niche.id === campaign.niche?.id)
                ? [{
                    id: campaign.niche.id,
                    name: campaign.niche.name,
                    active: campaign.niche.active,
                  }]
                : []),
              ...niches,
            ];
            return (
              <OpsSection
                key={campaign.id}
                title={draft.name || campaign.name}
                meta={`${campaign.niche?.name ?? `nicho ${draft.nicheId}`} · atualizado ${formatDateTime(campaign.updatedAt)}`}
                actions={<div className="flex flex-wrap items-center justify-end gap-2"><OpsBadge tone={campaign.active ? 'success' : 'neutral'}>{campaign.active ? 'ATIVA' : 'INATIVA'}</OpsBadge><button type="button" className="ops-button is-small" data-variant={campaign.active ? 'danger' : 'primary'} onClick={() => void toggleCampaign(campaign)} disabled={savingId === campaign.id}>{campaign.active ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}{campaign.active ? 'Desativar campanha' : 'Ativar campanha'}</button></div>}
              >
                <div className="grid gap-4 md:grid-cols-4">
                  <div className="ops-control"><div className="ops-control-label">Grupo</div><div className="ops-control-value text-sm">{group?.name ?? campaign.anchorDestination?.name ?? 'Não associado'}</div><div className="ops-control-sub">{group?.active && group.available ? 'autorizado e disponível' : 'estado não confirmado'}</div></div>
                  <div className="ops-control"><div className="ops-control-label">Fingerprint</div><div className="ops-control-value ops-mono">{maskFingerprint(group?.fingerprint ?? campaign.logicalGroupFingerprint)}</div><div className="ops-control-sub">identidade lógica</div></div>
                  <label className="ops-control"><span className="ops-control-label">Cadência (min)</span><input className="ops-input" type="number" min="5" max="180" value={draft.cadence} onChange={(event) => setDrafts((current) => ({ ...current, [campaign.id]: { ...draft, cadence: event.target.value } }))} /><span className="ops-control-sub">intervalo da campanha</span></label>
                  <label className="ops-control"><span className="ops-control-label">Janela</span><span className="flex gap-2"><input className="ops-input min-w-0" type="time" value={draft.start} onChange={(event) => setDrafts((current) => ({ ...current, [campaign.id]: { ...draft, start: event.target.value } }))} /><input className="ops-input min-w-0" type="time" value={draft.end} onChange={(event) => setDrafts((current) => ({ ...current, [campaign.id]: { ...draft, end: event.target.value } }))} /></span><span className="ops-control-sub">fuso horário {campaign.timezone}</span></label>
                  <label className="ops-control"><span className="ops-control-label">Limite diário</span><input className="ops-input" type="number" min="1" max={COMMERCIAL_DAILY_LIMIT_MAX} value={draft.dailyLimit} onChange={(event) => setDrafts((current) => ({ ...current, [campaign.id]: { ...draft, dailyLimit: event.target.value } }))} /><span className="ops-control-sub">mensagens desta campanha · teto de entrada {formatDailyLimit(COMMERCIAL_DAILY_LIMIT_MAX)}</span></label>
                  <label className="ops-control"><span className="ops-control-label">Nicho</span><select className="ops-input" value={draft.nicheId} onChange={(event) => setDrafts((current) => ({ ...current, [campaign.id]: { ...draft, nicheId: event.target.value } }))}>{currentNicheOptions.map((niche) => <option key={niche.id} value={niche.id} disabled={!niche.active && niche.id !== campaign.nicheId}>{niche.name}{!niche.active ? ' (inativo)' : ''}</option>)}</select><span className="ops-control-sub">a troca invalida a agenda antiga antes do próximo ciclo</span></label>
                  <label className="ops-control"><span className="ops-control-label">Nome</span><input className="ops-input" value={draft.name} onChange={(event) => setDrafts((current) => ({ ...current, [campaign.id]: { ...draft, name: event.target.value } }))} /><span className="ops-control-sub">identificação da campanha</span></label>
                  <div className="ops-control"><div className="ops-control-label">Fila alvo</div><div className="ops-control-value">{campaign.queueTargetSize}</div><div className="ops-control-sub">candidatos preparados</div></div>
                </div>
                <div className="mt-4 grid gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm sm:grid-cols-3"><div><div className="ops-control-label">Limite configurado</div><div className="mt-1 font-semibold text-slate-950">{formatDailyLimit(configuredLimit)}</div></div><div><div className="ops-control-label">Teto teórico da janela</div><div className="mt-1 font-semibold text-slate-950">{formatDailyLimit(slotCount)}</div></div><div><div className="ops-control-label">Limite efetivo</div><div className="mt-1 font-semibold text-slate-950">{formatDailyLimit(effectiveLimit)}</div></div><p className="text-xs leading-5 text-slate-600 sm:col-span-3">A API também rejeita um limite acima dos slots teóricos entre o início e o fim da janela; esse limite não cria mensagens extras nem altera a agenda.</p></div>
                <div className="mt-4 flex justify-end"><button type="button" className="ops-button" data-variant="primary" onClick={() => void saveCampaign(campaign)} disabled={savingId === campaign.id}><Save size={14} aria-hidden="true" /> {savingId === campaign.id ? 'Salvando...' : 'Salvar agenda da campanha'}</button></div>
              </OpsSection>
            );
          })}
        </div>
      ) : null}

      <OpsSection title="Diretório de grupos" meta={`${groups.length} grupos retornados · nenhuma autorização é alterada aqui`}>
        {groups.length === 0 ? <OpsEmpty title="Nenhum grupo retornado" message="A API não expôs grupos disponíveis nesta consulta." /> : <div className="ops-table-wrap -mx-[18px]"><table className="ops-table"><thead><tr><th>Nome</th><th>Fingerprint</th><th>Estado</th><th>Membros</th><th>Sincronizado</th></tr></thead><tbody>{groups.map((group) => <tr key={group.id}><td><strong>{group.name}</strong><div className="ops-row-product-meta ops-mono">{group.id}</div></td><td className="ops-mono">{maskFingerprint(group.fingerprint)}</td><td><div className="flex gap-2"><OpsBadge tone={group.active ? 'success' : 'neutral'}>{group.active ? 'ATIVO' : 'INATIVO'}</OpsBadge><OpsBadge tone={group.available ? 'success' : 'warning'}>{group.available ? 'ONLINE' : 'INDISPONÍVEL'}</OpsBadge></div></td><td className="ops-mono">{group.memberCount ?? '—'}</td><td>{formatDateTime(group.lastSyncedAt)}</td></tr>)}</tbody></table></div>}
      </OpsSection>
    </>
  );
}
