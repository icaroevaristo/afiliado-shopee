'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  listCommercialCampaignQueue,
  listCommercialCampaigns,
  type CommercialCampaign,
  type CommercialCandidateStatus,
  type CommercialQueueItem,
} from '../../lib/api';
import { formatCurrency, formatDateTime } from '../../lib/format';
import { CopyIdButton, OpsBadge, OpsEmpty, OpsLoading, OpsPageHeading, OpsSection, OpsState, toneForStatus } from '../../components/ops-components';

const filters: Array<CommercialCandidateStatus | ''> = ['', 'QUEUED', 'COPY_READY', 'RESERVED', 'DISPATCHED', 'EXPIRED', 'BLOCKED'];

export default function QueuePage() {
  const [campaigns, setCampaigns] = useState<CommercialCampaign[]>([]);
  const [campaignId, setCampaignId] = useState('');
  const [status, setStatus] = useState<CommercialCandidateStatus | ''>('');
  const [items, setItems] = useState<CommercialQueueItem[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(true);
  const [loadingQueue, setLoadingQueue] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void listCommercialCampaigns(1, 50).then((response) => {
      if (!active) return;
      setCampaigns(response.items);
      setCampaignId(response.items.find((campaign) => campaign.active)?.id ?? response.items[0]?.id ?? '');
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar campanhas.'); }).finally(() => { if (active) setLoadingCampaigns(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!campaignId) { setItems([]); return; }
    let active = true;
    setLoadingQueue(true);
    setError(null);
    void listCommercialCampaignQueue(campaignId, status ? { status } : {}).then((response) => { if (active) setItems(response.items); }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar a fila.'); }).finally(() => { if (active) setLoadingQueue(false); });
    return () => { active = false; };
  }, [campaignId, status]);

  const selectedCampaign = useMemo(() => campaigns.find((campaign) => campaign.id === campaignId) ?? null, [campaignId, campaigns]);

  return (
    <>
      <OpsPageHeading eyebrow="Fila de ofertas" title="Fila" description="Candidatos ordenados pelo ranking persistido da campanha. Nenhuma mineração ou geração é disparada nesta tela." />
      <OpsSection title="Fila da campanha" meta={selectedCampaign ? `${selectedCampaign.name} · alvo ${selectedCampaign.queueTargetSize}` : 'Selecione uma campanha ativa.'} actions={campaigns.length > 0 ? <select className="ops-button" value={campaignId} onChange={(event) => setCampaignId(event.target.value)} aria-label="Selecionar campanha"><option value="">Selecionar campanha</option>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}{campaign.active ? '' : ' · inativa'}</option>)}</select> : null}>
        <div className="ops-filter-row -mx-[18px] -mt-[18px] mb-0">
          {filters.map((item) => <button type="button" className="ops-filter-button" data-active={status === item} key={item || 'all'} onClick={() => setStatus(item)}>{item || 'Todos'}</button>)}
        </div>
        {loadingCampaigns || loadingQueue ? <OpsLoading label={loadingCampaigns ? 'Carregando campanhas' : 'Carregando candidatos'} /> : null}
        {error ? <OpsState title="Fila indisponível" message={error} tone="danger" /> : null}
        {!loadingQueue && !loadingCampaigns && !error && !campaignId ? <OpsEmpty title="Nenhuma campanha disponível" message="A API não retornou campanha para consultar a fila." /> : null}
        {!loadingQueue && !loadingCampaigns && !error && campaignId && items.length === 0 ? <OpsEmpty title="Fila vazia" message="Nenhum candidato corresponde ao filtro atual nesta campanha." /> : null}
        {!loadingQueue && !error && items.length > 0 ? <div className="ops-table-wrap -mx-[18px]"><table className="ops-table"><thead><tr><th>Rank</th><th>Produto</th><th>Score</th><th>Status</th><th>Snapshot</th><th>Copy</th><th>Atualizado</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td className="ops-mono">{item.rankPosition ?? '—'}</td><td><div className="ops-row-product-copy"><div className="ops-row-product-name">{item.productName}</div><div className="ops-row-product-meta">{formatCurrency(Number(item.price))} · {item.discountRate}% desconto</div></div></td><td><strong className="text-[var(--ops-accent)]">{item.commercialScore}</strong><div className="ops-meter mt-2 w-20"><span style={{ width: `${Math.min(100, Math.max(0, item.commercialScore))}%` }} /></div></td><td><OpsBadge tone={toneForStatus(item.status)}>{item.status}</OpsBadge></td><td className="ops-mono">rev. {item.snapshotRevision}</td><td><CopyIdButton value={item.generatedCopyId} /></td><td>{formatDateTime(item.updatedAt)}</td></tr>)}</tbody></table></div> : null}
      </OpsSection>
    </>
  );
}
