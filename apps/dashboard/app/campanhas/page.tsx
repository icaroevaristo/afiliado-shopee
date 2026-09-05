'use client';

import { Pause, Play, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  activateCommercialCampaign,
  deactivateCommercialCampaign,
  listCommercialCampaigns,
  listWhatsAppGroups,
  updateCommercialCampaign,
  type CommercialCampaign,
  type WhatsAppGroup,
} from '../../lib/api';
import { COMMERCIAL_DAILY_LIMIT_MAX } from '@shopee-auto-affiliate-ai/shared';
import { formatDateTime } from '../../lib/format';
import { OpsBadge, OpsEmpty, OpsLoading, OpsPageHeading, OpsSection, OpsState } from '../../components/ops-components';

const maskFingerprint = (value: string | null | undefined) => value ? `${value.slice(0, 10)}...${value.slice(-6)}` : '—';

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

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<CommercialCampaign[]>([]);
  const [groups, setGroups] = useState<WhatsAppGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { cadence: string; start: string; end: string; dailyLimit: string }>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([listCommercialCampaigns(1, 50), listWhatsAppGroups()]).then(([campaignResponse, groupResponse]) => {
      if (!active) return;
      setCampaigns(campaignResponse.items);
      setGroups(groupResponse);
      setDrafts(Object.fromEntries(campaignResponse.items.map((campaign) => [campaign.id, { cadence: String(campaign.cadenceMinutes), start: campaign.allowedStartTime, end: campaign.allowedEndTime, dailyLimit: String(campaign.dailyLimit) }])));
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar campanhas e grupos.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const groupById = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups]);

  const saveCampaign = async (campaign: CommercialCampaign) => {
    const draft = drafts[campaign.id];
    if (!draft) return;
    setSavingId(campaign.id);
    setError(null);
    try {
      const updated = await updateCommercialCampaign(campaign.id, {
        cadenceMinutes: Number(draft.cadence),
        allowedStartTime: draft.start,
        allowedEndTime: draft.end,
        dailyLimit: Number(draft.dailyLimit),
      });
      setCampaigns((current) => current.map((item) => item.id === updated.id ? updated : item));
      setDrafts((current) => ({ ...current, [campaign.id]: { cadence: String(updated.cadenceMinutes), start: updated.allowedStartTime, end: updated.allowedEndTime, dailyLimit: String(updated.dailyLimit) } }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'A campanha não foi atualizada.');
    } finally {
      setSavingId(null);
    }
  };

  const toggleCampaign = async (campaign: CommercialCampaign) => {
    const action = campaign.active ? 'desativar' : 'ativar';
    if (
      !window.confirm(
        `Confirmar ${action} a campanha "${campaign.name}"?`,
      )
    ) {
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

  return (
    <>
      <OpsPageHeading eyebrow="Configuração de campanhas" title="Campanhas" description="A associação entre campanha, nicho e grupo autorizado, com ajustes de cadência e janela." />
      {loading ? <OpsLoading label="Carregando campanhas e grupos" /> : null}
      {error ? <OpsState title="Configuração comercial indisponível" message={error} tone="danger" /> : null}
      {!loading && !error ? <div className="grid gap-4">{campaigns.length === 0 ? <OpsSection title="Campanhas ativas"><OpsEmpty title="Nenhuma campanha retornada" message="A API não possui campanha disponível para exibição." /></OpsSection> : null}{campaigns.map((campaign) => {
        const group = campaign.anchorDestinationId ? groupById.get(campaign.anchorDestinationId) : null;
        const draft = drafts[campaign.id];
        const slotCount = theoreticalSlotCount(
          draft?.start ?? campaign.allowedStartTime,
          draft?.end ?? campaign.allowedEndTime,
          draft?.cadence ?? String(campaign.cadenceMinutes),
        );
        const configuredLimit = Number(draft?.dailyLimit ?? campaign.dailyLimit);
        const effectiveLimit =
          slotCount === null || !Number.isFinite(configuredLimit)
            ? null
            : Math.min(configuredLimit, slotCount);
        return <OpsSection key={campaign.id} title={campaign.name} meta={`${campaign.niche?.name ?? `nicho ${campaign.nicheId}`} · atualizado ${formatDateTime(campaign.updatedAt)}`} actions={<div className="flex flex-wrap items-center justify-end gap-2"><OpsBadge tone={campaign.active ? 'success' : 'neutral'}>{campaign.active ? 'ATIVA' : 'INATIVA'}</OpsBadge><button type="button" className="ops-button is-small" data-variant={campaign.active ? 'danger' : 'primary'} onClick={() => void toggleCampaign(campaign)} disabled={savingId === campaign.id}>{campaign.active ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}{campaign.active ? 'Desativar campanha' : 'Ativar campanha'}</button></div>}>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="ops-control"><div className="ops-control-label">Grupo</div><div className="ops-control-value text-sm">{group?.name ?? campaign.anchorDestination?.name ?? 'Não associado'}</div><div className="ops-control-sub">{group?.active && group.available ? 'autorizado e disponível' : 'estado não confirmado'}</div></div>
            <div className="ops-control"><div className="ops-control-label">Fingerprint</div><div className="ops-control-value ops-mono">{maskFingerprint(group?.fingerprint ?? campaign.logicalGroupFingerprint)}</div><div className="ops-control-sub">identidade lógica</div></div>
            <label className="ops-control"><span className="ops-control-label">Cadência (min)</span><input className="ops-input" type="number" min="5" max="180" value={drafts[campaign.id]?.cadence ?? campaign.cadenceMinutes} onChange={(event) => setDrafts((current) => ({ ...current, [campaign.id]: { ...(current[campaign.id] ?? { cadence: String(campaign.cadenceMinutes), start: campaign.allowedStartTime, end: campaign.allowedEndTime, dailyLimit: String(campaign.dailyLimit) }), cadence: event.target.value } }))} /><span className="ops-control-sub">intervalo da campanha</span></label>
            <label className="ops-control"><span className="ops-control-label">Janela</span><span className="flex gap-2"><input className="ops-input min-w-0" type="time" value={drafts[campaign.id]?.start ?? campaign.allowedStartTime} onChange={(event) => setDrafts((current) => ({ ...current, [campaign.id]: { ...(current[campaign.id] ?? { cadence: String(campaign.cadenceMinutes), start: campaign.allowedStartTime, end: campaign.allowedEndTime, dailyLimit: String(campaign.dailyLimit) }), start: event.target.value } }))} /><input className="ops-input min-w-0" type="time" value={drafts[campaign.id]?.end ?? campaign.allowedEndTime} onChange={(event) => setDrafts((current) => ({ ...current, [campaign.id]: { ...(current[campaign.id] ?? { cadence: String(campaign.cadenceMinutes), start: campaign.allowedStartTime, end: campaign.allowedEndTime, dailyLimit: String(campaign.dailyLimit) }), end: event.target.value } }))} /></span><span className="ops-control-sub">fuso horário {campaign.timezone}</span></label>
            <label className="ops-control"><span className="ops-control-label">Limite diário</span><input className="ops-input" type="number" min="1" max={COMMERCIAL_DAILY_LIMIT_MAX} value={drafts[campaign.id]?.dailyLimit ?? campaign.dailyLimit} onChange={(event) => setDrafts((current) => ({ ...current, [campaign.id]: { ...(current[campaign.id] ?? { cadence: String(campaign.cadenceMinutes), start: campaign.allowedStartTime, end: campaign.allowedEndTime, dailyLimit: String(campaign.dailyLimit) }), dailyLimit: event.target.value } }))} /><span className="ops-control-sub">mensagens desta campanha · teto de entrada {formatDailyLimit(COMMERCIAL_DAILY_LIMIT_MAX)}</span></label>
            <div className="ops-control"><div className="ops-control-label">Fila alvo</div><div className="ops-control-value">{campaign.queueTargetSize}</div><div className="ops-control-sub">candidatos preparados</div></div>
          </div>
          <div className="mt-4 grid gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm sm:grid-cols-3">
            <div><div className="ops-control-label">Limite configurado</div><div className="mt-1 font-semibold text-slate-950">{formatDailyLimit(configuredLimit)}</div></div>
            <div><div className="ops-control-label">Teto teórico da janela</div><div className="mt-1 font-semibold text-slate-950">{formatDailyLimit(slotCount)}</div></div>
            <div><div className="ops-control-label">Limite efetivo</div><div className="mt-1 font-semibold text-slate-950">{formatDailyLimit(effectiveLimit)}</div></div>
            <p className="text-xs leading-5 text-slate-600 sm:col-span-3">A API também rejeita um limite acima dos slots teóricos entre o início e o fim da janela; esse limite não cria mensagens extras nem altera a agenda.</p>
          </div>
          <div className="mt-4 flex justify-end"><button type="button" className="ops-button" data-variant="primary" onClick={() => void saveCampaign(campaign)} disabled={savingId === campaign.id}><Save size={14} aria-hidden="true" /> {savingId === campaign.id ? 'Salvando...' : 'Salvar agenda da campanha'}</button></div>
        </OpsSection>;
      })}</div> : null}
      <OpsSection title="Diretório de grupos" meta={`${groups.length} grupos retornados · nenhuma autorização é alterada aqui`}>
        {groups.length === 0 ? <OpsEmpty title="Nenhum grupo retornado" message="A API não expôs grupos disponíveis nesta consulta." /> : <div className="ops-table-wrap -mx-[18px]"><table className="ops-table"><thead><tr><th>Nome</th><th>Fingerprint</th><th>Estado</th><th>Membros</th><th>Sincronizado</th></tr></thead><tbody>{groups.map((group) => <tr key={group.id}><td><strong>{group.name}</strong><div className="ops-row-product-meta ops-mono">{group.id}</div></td><td className="ops-mono">{maskFingerprint(group.fingerprint)}</td><td><div className="flex gap-2"><OpsBadge tone={group.active ? 'success' : 'neutral'}>{group.active ? 'ATIVO' : 'INATIVO'}</OpsBadge><OpsBadge tone={group.available ? 'success' : 'warning'}>{group.available ? 'ONLINE' : 'INDISPONÍVEL'}</OpsBadge></div></td><td className="ops-mono">{group.memberCount ?? '—'}</td><td>{formatDateTime(group.lastSyncedAt)}</td></tr>)}</tbody></table></div>}
      </OpsSection>
    </>
  );
}
