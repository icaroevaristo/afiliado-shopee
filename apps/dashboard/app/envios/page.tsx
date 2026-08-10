'use client';

import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  listDispatches,
  type DispatchFilters,
  type WhatsAppDispatch,
  type WhatsAppDispatchStatus,
} from '../../lib/api';
import { formatCurrency, formatDateTimeInTimezone } from '../../lib/format';
import { CopyIdButton, OpsBadge, OpsEmpty, OpsLoading, OpsPageHeading, OpsSection, OpsState, toneForStatus } from '../../components/ops-components';
import { SafeProductImage } from '../../components/safe-product-image';

const statuses: Array<WhatsAppDispatchStatus | ''> = ['', 'SENT', 'PROCESSING', 'PENDING', 'FAILED'];

function DispatchDrawer({ dispatch, onClose }: { dispatch: WhatsAppDispatch; onClose: () => void }) {
  return (
    <div className="ops-drawer-backdrop" role="dialog" aria-modal="true" aria-label="Detalhes do envio">
      <button type="button" className="absolute inset-0 h-full w-full cursor-default border-0 bg-transparent" aria-label="Fechar detalhes" onClick={onClose} />
      <aside className="ops-drawer">
        <div className="ops-drawer-header">
          <div><p className="ops-eyebrow">Dispatch detail</p><h2 className="ops-section-title">{dispatch.product?.nome ?? 'Envio comercial'}</h2><p className="ops-section-meta">{dispatch.id}</p></div>
          <button type="button" className="ops-icon-button" onClick={onClose} aria-label="Fechar detalhes"><X size={16} aria-hidden="true" /></button>
        </div>
        <div className="ops-drawer-body">
          <SafeProductImage className="ops-product-image mb-5" src={dispatch.product?.urlImagem} />
          <div className="flex items-center justify-between gap-3"><span className="ops-detail-label">Status</span><OpsBadge tone={toneForStatus(dispatch.status)}>{dispatch.status}</OpsBadge></div>
          <div className="ops-detail-grid">
            <div><div className="ops-detail-label">Preco</div><div className="ops-detail-value">{formatCurrency(typeof dispatch.product?.preco === 'number' ? dispatch.product.preco : null)}</div></div>
            <div><div className="ops-detail-label">Modo</div><div className="ops-detail-value">{dispatch.deliveryMode ?? 'Nao disponivel'}</div></div>
            <div><div className="ops-detail-label">Tentativa</div><div className="ops-detail-value ops-mono">{dispatch.attemptCount}</div></div>
            <div><div className="ops-detail-label">Provider</div><div className="ops-detail-value">{dispatch.provider ?? 'Nao disponivel'}</div></div>
            <div><div className="ops-detail-label">Grupo</div><div className="ops-detail-value">{dispatch.destination?.name ?? 'Nao disponivel'}</div></div>
            <div><div className="ops-detail-label">Enviado em</div><div className="ops-detail-value">{formatDateTimeInTimezone(dispatch.sentAt, 'America/Sao_Paulo', '—', 'medium')}</div></div>
          </div>
          <div className="mt-6 grid gap-4">
            <div><div className="ops-detail-label">candidateId</div><CopyIdButton value={dispatch.generatedCopy?.createdFromCandidateId} /></div>
            <div><div className="ops-detail-label">generatedCopyId</div><CopyIdButton value={dispatch.generatedCopyId} /></div>
            <div><div className="ops-detail-label">dispatchId</div><CopyIdButton value={dispatch.id} /></div>
            <div><div className="ops-detail-label">externalMessageId</div><CopyIdButton value={dispatch.externalMessageId} /></div>
            {dispatch.errorMessage ? <div className="ops-state"><div><strong>Erro sanitizado</strong><span>{dispatch.errorMessage}</span></div></div> : null}
          </div>
        </div>
      </aside>
    </div>
  );
}

export default function SendsPage() {
  const [dispatches, setDispatches] = useState<WhatsAppDispatch[]>([]);
  const [filter, setFilter] = useState<DispatchFilters['status']>('');
  const [selected, setSelected] = useState<WhatsAppDispatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async (initial = false) => {
    if (initial) setLoading(true);
    setError(null);
    try {
      setDispatches(await listDispatches(filter ? { status: filter } : {}));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Nao foi possivel carregar os envios.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(true); }, [filter]);
  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 30_000);
    return () => window.clearInterval(timer);
  }, [filter]);

  return (
    <>
      <OpsPageHeading eyebrow="Dispatch ledger" title="Envios" description="Uma tabela de operação para rastrear IMAGE, destino, tentativa e resultado persistido." />
      <OpsSection title="Historico de dispatches" meta={`${dispatches.length} registros retornados pela API`}>
        <div className="ops-filter-row -mx-[18px] -mt-[18px] mb-0">
          {statuses.map((status) => <button type="button" className="ops-filter-button" data-active={filter === status} key={status || 'all'} onClick={() => setFilter(status)}>{status || 'Todos'}</button>)}
        </div>
        {loading ? <OpsLoading label="Carregando historico de envios" /> : null}
        {error ? <OpsState title="Historico indisponivel" message={error} tone="danger" action={<button type="button" className="ops-button" onClick={() => void load()}>Tentar novamente</button>} /> : null}
        {!loading && !error && dispatches.length === 0 ? <OpsEmpty title="Nenhum dispatch para este filtro" message="Dispatches criados pelo fluxo comercial aparecem aqui depois da persistencia." /> : null}
        {!loading && !error && dispatches.length > 0 ? (
          <div className="ops-table-wrap -mx-[18px]">
            <table className="ops-table">
              <thead><tr><th>Hora</th><th>Produto</th><th>Grupo</th><th>Preco</th><th>Modo</th><th>Status</th><th>Tentativa</th></tr></thead>
              <tbody>
                {dispatches.map((dispatch) => <tr key={dispatch.id} onClick={() => setSelected(dispatch)} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') setSelected(dispatch); }}>
                  <td className="whitespace-nowrap">{formatDateTimeInTimezone(dispatch.sentAt ?? dispatch.createdAt, 'America/Sao_Paulo', '—', 'medium')}</td>
                  <td><div className="ops-row-product"><SafeProductImage className="ops-thumb" src={dispatch.product?.urlImagem} /><div className="ops-row-product-copy"><div className="ops-row-product-name">{dispatch.product?.nome ?? 'Produto nao informado'}</div><div className="ops-row-product-meta">{dispatch.id}</div></div></div></td>
                  <td>{dispatch.destination?.name ?? 'Nao disponivel'}</td>
                  <td>{formatCurrency(typeof dispatch.product?.preco === 'number' ? dispatch.product.preco : null)}</td>
                  <td><OpsBadge tone="info">{dispatch.deliveryMode ?? 'N/D'}</OpsBadge></td>
                  <td><OpsBadge tone={toneForStatus(dispatch.status)}>{dispatch.status}</OpsBadge></td>
                  <td className="ops-mono">{dispatch.attemptCount}</td>
                </tr>)}
              </tbody>
            </table>
          </div>
        ) : null}
      </OpsSection>
      {selected ? <DispatchDrawer dispatch={selected} onClose={() => setSelected(null)} /> : null}
    </>
  );
}
