'use client';

import { Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { listCommercialCampaigns, listWhatsAppGroups, updateCommercialCampaign, type CommercialCampaign, type WhatsAppGroup } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { OpsBadge, OpsEmpty, OpsLoading, OpsPageHeading, OpsSection, OpsState } from '../../components/ops-components';

const maskFingerprint = (value: string | null | undefined) => value ? `${value.slice(0, 10)}...${value.slice(-6)}` : '—';

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<CommercialCampaign[]>([]);
  const [groups, setGroups] = useState<WhatsAppGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { cadence: string; start: string; end: string }>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([listCommercialCampaigns(1, 50), listWhatsAppGroups()]).then(([campaignResponse, groupResponse]) => {
      if (!active) return;
      setCampaigns(campaignResponse.items);
      setGroups(groupResponse);
      setDrafts(Object.fromEntries(campaignResponse.items.map((campaign) => [campaign.id, { cadence: String(campaign.cadenceMinutes), start: campaign.allowedStartTime, end: campaign.allowedEndTime }])));
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
      });
      setCampaigns((current) => current.map((item) => item.id === updated.id ? updated : item));
      setDrafts((current) => ({ ...current, [campaign.id]: { cadence: String(updated.cadenceMinutes), start: updated.allowedStartTime, end: updated.allowedEndTime } }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'A campanha não foi atualizada.');
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
        return <OpsSection key={campaign.id} title={campaign.name} meta={`${campaign.niche?.name ?? `nicho ${campaign.nicheId}`} · atualizado ${formatDateTime(campaign.updatedAt)}`} actions={<OpsBadge tone={campaign.active ? 'success' : 'neutral'}>{campaign.active ? 'ATIVA' : 'INATIVA'}</OpsBadge>}>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="ops-control"><div className="ops-control-label">Grupo</div><div className="ops-control-value text-sm">{group?.name ?? campaign.anchorDestination?.name ?? 'Não associado'}</div><div className="ops-control-sub">{group?.active && group.available ? 'autorizado e disponível' : 'estado não confirmado'}</div></div>
            <div className="ops-control"><div className="ops-control-label">Fingerprint</div><div className="ops-control-value ops-mono">{maskFingerprint(group?.fingerprint ?? campaign.logicalGroupFingerprint)}</div><div className="ops-control-sub">identidade lógica</div></div>
            <label className="ops-control"><span className="ops-control-label">Cadência (min)</span><input className="ops-input" type="number" min="5" max="180" value={drafts[campaign.id]?.cadence ?? campaign.cadenceMinutes} onChange={(event) => setDrafts((current) => ({ ...current, [campaign.id]: { ...(current[campaign.id] ?? { cadence: String(campaign.cadenceMinutes), start: campaign.allowedStartTime, end: campaign.allowedEndTime }), cadence: event.target.value } }))} /><span className="ops-control-sub">intervalo da campanha</span></label>
            <label className="ops-control"><span className="ops-control-label">Janela</span><span className="flex gap-2"><input className="ops-input min-w-0" type="time" value={drafts[campaign.id]?.start ?? campaign.allowedStartTime} onChange={(event) => setDrafts((current) => ({ ...current, [campaign.id]: { ...(current[campaign.id] ?? { cadence: String(campaign.cadenceMinutes), start: campaign.allowedStartTime, end: campaign.allowedEndTime }), start: event.target.value } }))} /><input className="ops-input min-w-0" type="time" value={drafts[campaign.id]?.end ?? campaign.allowedEndTime} onChange={(event) => setDrafts((current) => ({ ...current, [campaign.id]: { ...(current[campaign.id] ?? { cadence: String(campaign.cadenceMinutes), start: campaign.allowedStartTime, end: campaign.allowedEndTime }), end: event.target.value } }))} /></span><span className="ops-control-sub">fuso horário {campaign.timezone}</span></label>
            <div className="ops-control"><div className="ops-control-label">Fila alvo</div><div className="ops-control-value">{campaign.queueTargetSize}</div><div className="ops-control-sub">limite diário {campaign.dailyLimit}</div></div>
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
