'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { EmptyState } from '../../../components/empty-state';
import { ErrorState } from '../../../components/error-state';
import { LoadingState } from '../../../components/loading-state';
import { OffersContextNav } from '../../../components/offers-context-nav';
import {
  OpsBadge,
  OpsPageHeading,
  OpsSection,
  OpsState,
  type OpsTone,
} from '../../../components/ops-components';
import { SafeProductImage } from '../../../components/safe-product-image';
import {
  createManualPublication,
  getManualPublication,
  getManualPublicationOptions,
  getShopeeOffer,
  listShopeeCategories,
  previewShopeeOfferCopy,
  type CopyPreview,
  type ManualPublicationOptions,
  type ManualPublicationRequest,
  type ShopeeCategory,
  type ShopeeOfferDetail,
  type ShopeeOfferStatus,
} from '../../../lib/api';
import {
  formatCurrency,
  formatDateTime,
  formatNumber,
  formatPercent,
} from '../../../lib/format';

const offerStatusLabel: Record<ShopeeOfferStatus, string> = {
  ACTIVE: 'Ativa',
  EXPIRED: 'Expirada',
  UNAVAILABLE: 'Indisponível',
};

const toFiniteNumber = (value: string | number | null | undefined) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const safeCurrency = (value: string | number | null | undefined) =>
  formatCurrency(toFiniteNumber(value));

const safeNumber = (value: string | number | null | undefined) =>
  formatNumber(toFiniteNumber(value));

const safePercent = (value: string | number | null | undefined) =>
  formatPercent(toFiniteNumber(value));

const priceRangeLabel = (
  min: string | number | null | undefined,
  max: string | number | null | undefined,
) => {
  const minValue = toFiniteNumber(min);
  const maxValue = toFiniteNumber(max);
  if (minValue === null && maxValue === null) return null;
  if (minValue !== null && maxValue !== null && minValue === maxValue) {
    return null;
  }
  if (minValue !== null && maxValue !== null) {
    return `${formatCurrency(minValue)} – ${formatCurrency(maxValue)}`;
  }
  return minValue !== null
    ? `A partir de ${formatCurrency(minValue)}`
    : `Até ${formatCurrency(maxValue)}`;
};

const safeCategoryLabel = (category: ShopeeCategory) => {
  const name = category.name?.trim();
  if (name) return name;
  const displayLabel = category.displayLabel?.trim();
  if (!displayLabel || displayLabel.includes(category.id)) {
    return 'Categoria não disponível';
  }
  return displayLabel;
};

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<ShopeeOfferDetail | null>(null);
  const [categories, setCategories] = useState<ShopeeCategory[]>([]);
  const [categoryError, setCategoryError] = useState(false);
  const [dispatchPage, setDispatchPage] = useState(1);
  const [snapshotPage, setSnapshotPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDetail(
        await getShopeeOffer(id, {
          dispatchPage,
          snapshotPage,
          dispatchLimit: 10,
          snapshotLimit: 10,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado.');
    } finally {
      setLoading(false);
    }
  }, [dispatchPage, id, snapshotPage]);

  useEffect(() => {
    if (id) void load();
  }, [id, load]);

  useEffect(() => {
    let active = true;
    void listShopeeCategories()
      .then((response) => {
        if (active) {
          setCategories(response.items);
          setCategoryError(false);
        }
      })
      .catch(() => {
        if (active) setCategoryError(true);
      });

    return () => {
      active = false;
    };
  }, []);

  const categoryMap = useMemo(
    () =>
      new Map(
        categories.map((category) => [
          category.id,
          safeCategoryLabel(category),
        ]),
      ),
    [categories],
  );

  if (loading) return <LoadingState label="Carregando detalhe da oferta" />;
  if (error) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!detail) {
    return (
      <EmptyState
        title="Oferta não encontrada"
        description="O produto não está disponível no catálogo local."
      />
    );
  }

  const categoriesText = categoryLabels(
    detail.categoryIds,
    categoryMap,
    categoryError,
  );

  return (
    <div className="offer-detail-page">
      <OpsPageHeading
        eyebrow="Catálogo / Ofertas"
        title="Detalhe da oferta"
        description="Veja o resumo comercial, a evolução da oferta e o histórico de envios."
        actions={
          <Link href="/produtos" className="ops-button">
            Voltar às ofertas
          </Link>
        }
      />

      <OffersContextNav active="offers" />

      <article className="offer-detail-hero" data-testid="offer-first-level">
        <SafeProductImage
          src={detail.imageUrl}
          className="offer-detail-image"
        />
        <div className="offer-detail-hero-copy">
          <div className="offer-detail-badges">
            <OpsBadge tone={offerStatusTone(detail.status)}>
              {offerStatusLabel[detail.status]}
            </OpsBadge>
            <OpsBadge tone={detail.everSent ? 'success' : 'neutral'}>
              {detail.everSent ? 'Já enviada' : 'Ainda não enviada'}
            </OpsBadge>
          </div>
          <h2>{detail.productName}</h2>
          <p className="offer-detail-shop">{detail.shopName}</p>
          <p className="offer-detail-categories">
            <span>Categoria</span>
            {categoriesText}
          </p>
          {categoryError ? (
            <p className="offer-detail-muted">
              O catálogo de categorias está indisponível; a oferta continua
              visível.
            </p>
          ) : null}
        </div>
      </article>

      <dl className="offer-detail-metrics">
        <Metric
          label="Preço atual"
          value={safeCurrency(detail.price)}
          emphasis
        />
        {priceRangeLabel(detail.priceMin, detail.priceMax) ? (
          <Metric
            label="Faixa observada"
            value={priceRangeLabel(detail.priceMin, detail.priceMax) ?? '—'}
          />
        ) : null}
        <Metric label="Desconto" value={safePercent(detail.discountRate)} />
        <Metric label="Comissão" value={safePercent(detail.commissionRate)} />
        <Metric label="Vendas" value={safeNumber(detail.sales)} />
        <Metric label="Avaliação" value={safeNumber(detail.rating)} />
        <Metric
          label="Link afiliado"
          value={detail.affiliateLinkPresent ? 'Disponível' : 'Ausente'}
        />
        <Metric
          label="Último envio"
          value={formatDateTime(detail.lastSentAt)}
        />
        <Metric
          label="Capturada em"
          value={formatDateTime(detail.capturedAt)}
        />
      </dl>

      <OpsSection
        title="Resumo da oportunidade"
        meta="A oferta é acompanhada a partir dos dados comerciais persistidos."
        className="offer-detail-section"
      >
        <div className="offer-detail-summary">
          <OpsBadge tone={commercialTone(detail)}>
            {commercialLabel(detail)}
          </OpsBadge>
          <p>{commercialMessage(detail)}</p>
        </div>
        <OpsState
          tone="info"
          title="Ofertas relâmpago"
          message="Esse tipo de sinal não está disponível no contrato atual."
        />
      </OpsSection>

      <CopyPreviewPanel
        productId={detail.id}
        available={detail.status === 'ACTIVE'}
      />

      {detail.source === 'OFFICIAL' ? (
        <ManualPublicationPanel productId={detail.id} />
      ) : null}

      <details
        className="offer-advanced-details"
        data-testid="offer-technical-details"
      >
        <summary>Informações técnicas</summary>
        <div className="offer-advanced-content">
          <dl className="offer-technical-grid">
            <TechnicalMetric
              label="Origem do catálogo"
              value={sourceLabel(detail.source)}
            />
            <TechnicalMetric label="ID interno" value={detail.id} />
            <TechnicalMetric
              label="ID no provedor"
              value={detail.providerProductId}
            />
            <TechnicalMetric
              label="Revisão do snapshot"
              value={
                detail.commercialSnapshotRevision
                  ? String(detail.commercialSnapshotRevision)
                  : 'Não registrada'
              }
            />
            <TechnicalMetric
              label="Fingerprint"
              value={detail.commercialSnapshotFingerprint ?? 'Não registrado'}
            />
            <TechnicalMetric label="Estado persistido" value={detail.status} />
            <TechnicalMetric
              label="Fonte da captura"
              value={detail.capturedAtSource}
            />
            <TechnicalMetric
              label="Melhor score atual"
              value={safeNumber(detail.bestCurrentCommercialScore)}
            />
          </dl>
          <div className="offer-diagnostic-list">
            <h3>Diagnóstico de seleção</h3>
            {detail.commercialScores.length === 0 ? (
              <p>Nenhum registro de seleção para o snapshot atual.</p>
            ) : (
              <ul>
                {detail.commercialScores.map((score) => (
                  <li key={score.candidateId}>
                    <strong>{score.campaignName}</strong>
                    <span>
                      Score {score.score} · posição{' '}
                      {score.rankPosition ?? 'não informada'} · status{' '}
                      {score.candidateStatus}
                    </span>
                    <span className="offer-technical-line">
                      candidateId {score.candidateId} · nicheId {score.nicheId}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </details>

      <HistorySection
        title="Histórico de envios"
        meta="Envios registrados para esta oferta, com o resultado de cada tentativa."
        empty="Nenhum envio registrado para esta oferta."
        page={detail.dispatchHistory.page}
        hasPreviousPage={detail.dispatchHistory.hasPreviousPage}
        hasNextPage={detail.dispatchHistory.hasNextPage}
        onPrevious={() => setDispatchPage((page) => Math.max(1, page - 1))}
        onNext={() => setDispatchPage((page) => page + 1)}
      >
        {detail.dispatchHistory.items.map((dispatch) => (
          <li key={dispatch.dispatchId} className="offer-history-item">
            <div className="offer-history-main">
              <div>
                <strong>{dispatch.destination.name}</strong>
                <p>
                  {destinationTypeLabel(dispatch.destination.type)} ·{' '}
                  {dispatch.instanceName ?? 'instância não registrada'}
                </p>
              </div>
              <OpsBadge tone={dispatchTone(dispatch.status)}>
                {dispatchStatusLabel(dispatch.status)}
              </OpsBadge>
            </div>
            <p className="offer-history-meta">
              {dispatch.sentAt
                ? `Enviado em ${formatDateTime(dispatch.sentAt)}`
                : 'Sem confirmação de envio'}{' '}
              · {dispatch.attemptCount} tentativa
              {dispatch.attemptCount === 1 ? '' : 's'}
            </p>
            <details className="offer-inline-details">
              <summary>Ver detalhes do registro</summary>
              <p>
                dispatchId {dispatch.dispatchId} · run{' '}
                {dispatch.run?.id ?? 'não registrado'} · resultado{' '}
                {runStatusLabel(dispatch.run?.finalStatus)}
              </p>
              {dispatch.run?.investigationRequired ? (
                <p className="offer-danger-text">
                  Investigações pendentes neste registro.
                </p>
              ) : null}
            </details>
          </li>
        ))}
      </HistorySection>

      <HistorySection
        title="Histórico comercial"
        meta="Cada registro mostra como preço, desconto e comissão foram observados ao longo do tempo."
        empty="Nenhum histórico comercial registrado para esta oferta."
        page={detail.snapshotHistory.page}
        hasPreviousPage={detail.snapshotHistory.hasPreviousPage}
        hasNextPage={detail.snapshotHistory.hasNextPage}
        onPrevious={() => setSnapshotPage((page) => Math.max(1, page - 1))}
        onNext={() => setSnapshotPage((page) => page + 1)}
      >
        {detail.snapshotHistory.items.map((snapshot) => (
          <li key={snapshot.id} className="offer-history-item">
            <div className="offer-history-main">
              <div>
                <strong>
                  Registro de {formatDateTime(snapshot.capturedAt)}
                </strong>
                <p>
                  {safeCurrency(snapshot.price)} · desconto{' '}
                  {safePercent(snapshot.discountRate)} · comissão{' '}
                  {safePercent(snapshot.commissionRate)}
                  {priceRangeLabel(snapshot.priceMin, snapshot.priceMax)
                    ? ` · faixa ${priceRangeLabel(snapshot.priceMin, snapshot.priceMax)}`
                    : ''}
                </p>
              </div>
              <span className="offer-history-value">
                {safeNumber(snapshot.observedSales)} vendas
              </span>
            </div>
            <p className="offer-history-meta">
              Avaliação {safeNumber(snapshot.observedRating)} · capturado em{' '}
              {formatDateTime(snapshot.capturedAt)}
            </p>
            <details className="offer-inline-details">
              <summary>Ver identificação técnica</summary>
              <p>
                Registro {snapshot.id} · revisão {snapshot.revision} ·
                fingerprint {snapshot.fingerprint}
              </p>
            </details>
          </li>
        ))}
      </HistorySection>
    </div>
  );
}

function CopyPreviewPanel({
  productId,
  available,
}: {
  productId: string;
  available: boolean;
}) {
  const [preview, setPreview] = useState<CopyPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPreview = async () => {
    if (!available || loading) return;
    setLoading(true);
    setError(null);
    try {
      setPreview(await previewShopeeOfferCopy(productId));
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Não foi possível carregar a prévia.',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <OpsSection
      title="Prévia da mensagem"
      meta="Confira o texto preparado sem publicar nem alterar a oferta."
      className="offer-detail-section"
    >
      {!preview ? (
        <>
          <p className="offer-detail-muted">
            A prévia usa apenas dados locais e não cria envio.
          </p>
          <button
            type="button"
            className="ops-button"
            onClick={() => void loadPreview()}
            disabled={!available || loading}
          >
            {loading ? 'Carregando prévia…' : 'Ver prévia da mensagem'}
          </button>
          {!available ? (
            <p className="offer-detail-muted">
              A prévia só está disponível para uma oferta ativa.
            </p>
          ) : null}
        </>
      ) : (
        <div className="offer-copy-preview">
          <OpsBadge tone="info">{preview.label}</OpsBadge>
          <h3>{preview.titulo}</h3>
          <p>{preview.mensagem}</p>
          <p>{preview.cta}</p>
          <a href={preview.affiliateLink} target="_blank" rel="noreferrer">
            Abrir link afiliado
          </a>
        </div>
      )}
      {error ? (
        <p className="offer-error-message" role="alert">
          {error}
        </p>
      ) : null}
    </OpsSection>
  );
}

function ManualPublicationPanel({ productId }: { productId: string }) {
  const [options, setOptions] = useState<ManualPublicationOptions | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [request, setRequest] = useState<ManualPublicationRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitInFlight = useRef(false);

  const loadOptions = async () => {
    setLoading(true);
    setError(null);
    try {
      setOptions(await getManualPublicationOptions(productId));
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Não foi possível carregar as opções manuais.',
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadOptions();
  }, [productId]);

  const submit = async () => {
    if (
      submitInFlight.current ||
      !selectedId ||
      confirmation !== 'ENVIAR_PUBLICACAO_MANUAL'
    ) {
      return;
    }
    submitInFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const storageKey = `manual-publication:${productId}:${selectedId}`;
      let idempotencyKey = window.sessionStorage.getItem(storageKey);
      if (!idempotencyKey) {
        idempotencyKey = globalThis.crypto.randomUUID();
        window.sessionStorage.setItem(storageKey, idempotencyKey);
      }
      setRequest(
        await createManualPublication({
          idempotencyKey,
          productId,
          destinationIds: [selectedId],
          confirm: 'ENVIAR_PUBLICACAO_MANUAL',
        }),
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Não foi possível criar a publicação manual.',
      );
    } finally {
      submitInFlight.current = false;
      setSubmitting(false);
    }
  };

  const refresh = async () => {
    if (!request) return;
    setError(null);
    try {
      setRequest(await getManualPublication(request.id));
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Não foi possível atualizar o status.',
      );
    }
  };

  return (
    <section className="manual-publication-panel">
      <div className="manual-publication-header">
        <div>
          <p className="ops-eyebrow">Ação controlada</p>
          <h2>Publicação manual segura</h2>
          <p>
            Selecione exatamente 1 grupo. A mesma mensagem e o mesmo fluxo
            comercial serão usados.
          </p>
        </div>
        <OpsBadge tone="warning">Fluxo oficial</OpsBadge>
      </div>

      {loading ? (
        <p className="manual-publication-muted">Carregando grupos elegíveis…</p>
      ) : null}
      {error ? (
        <p className="offer-error-message" role="alert">
          {error}
        </p>
      ) : null}
      {options ? (
        <>
          <div className="manual-publication-overview">
            <Metric
              label="Versão da oferta"
              value={
                options.product.snapshot
                  ? `Revisão ${options.product.snapshot.revision}`
                  : 'Não disponível'
              }
            />
            <Metric
              label="Oferta elegível"
              value={options.product.available ? 'Sim' : 'Não'}
            />
            <Metric
              label="Grupo selecionado"
              value={selectedId ? '1 de 1' : '0 de 1'}
            />
          </div>

          <div className="manual-publication-review">
            <h3>Revise antes de confirmar</h3>
            <p>
              Confira a oferta, a versão atual e o grupo escolhido. A mensagem
              não é editável nesta etapa.
            </p>
            {!selectedId ? (
              <p className="manual-publication-muted">
                Selecione um grupo para revisar a intenção.
              </p>
            ) : (
              <ul>
                {[selectedId].map((destinationId) => {
                  const group = options.groups.find(
                    (item) => item.destinationId === destinationId,
                  );
                  if (!group) return null;
                  return (
                    <li key={destinationId}>
                      <div className="manual-group-heading">
                        <strong>{group.displayName}</strong>
                        <span>{group.eligible ? 'Elegível' : 'Bloqueado'}</span>
                      </div>
                      {group.draftPreview ? (
                        <details className="offer-inline-details">
                          <summary>Ver prévia do texto pronto</summary>
                          <div className="manual-copy-preview">
                            <strong>{group.draftPreview.title}</strong>
                            <p>{group.draftPreview.message}</p>
                            <p>{group.draftPreview.cta}</p>
                            <p>{group.draftPreview.hashtags}</p>
                            <small>
                              Entrega:{' '}
                              {group.draftPreview.deliveryMode === 'IMAGE'
                                ? 'imagem + texto'
                                : 'texto'}
                              {group.draftPreview.imageUrl
                                ? ' · imagem disponível'
                                : ''}
                            </small>
                          </div>
                        </details>
                      ) : (
                        <p className="manual-publication-muted">
                          Texto ainda não pronto; será preparado pelo fluxo após
                          a confirmação.
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="manual-publication-groups">
            <h3>Grupos autorizados</h3>
            {options.groups.length === 0 ? (
              <p className="manual-publication-muted">
                Nenhum grupo disponível para seleção.
              </p>
            ) : null}
            {options.groups.map((group) => {
              const selected = selectedId === group.destinationId;
              return (
                <label
                  key={group.destinationId}
                  className={`manual-group-option ${selected ? 'is-selected' : ''} ${group.eligible ? '' : 'is-disabled'}`}
                >
                  <input
                    type="radio"
                    name="manual-publication-destination"
                    checked={selected}
                    disabled={!group.eligible || submitting}
                    onChange={() => setSelectedId(group.destinationId)}
                  />
                  <span>
                    <strong>{group.displayName}</strong>
                    <small>
                      {group.eligible
                        ? `Texto ${copyStatusLabel(group.copyStatus)}`
                        : group.blockers.map(blockerLabel).join(', ')}
                    </small>
                  </span>
                </label>
              );
            })}
          </div>

          {!request ? (
            <div className="manual-publication-confirm">
              <label>
                Confirmação exata
                <input
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  placeholder="ENVIAR_PUBLICACAO_MANUAL"
                />
              </label>
              <button
                type="button"
                className="ops-button"
                disabled={
                  submitting ||
                  !options.product.available ||
                  !selectedId ||
                  confirmation !== 'ENVIAR_PUBLICACAO_MANUAL'
                }
                onClick={() => void submit()}
              >
                {submitting ? 'Registrando…' : 'Enviar publicação manual'}
              </button>
              <p>
                A ação usa uma chave de idempotência desta sessão e não cria
                retry automático.
              </p>
            </div>
          ) : (
            <div className="manual-publication-result">
              <div className="manual-publication-result-heading">
                <div>
                  <strong>
                    Publicação manual:{' '}
                    {manualRequestStatusLabel(request.status)}
                  </strong>
                  <p>
                    {
                      request.targets.filter(
                        (target) => target.status === 'SENT',
                      ).length
                    }{' '}
                    de {request.targets.length} destinos enviados.
                  </p>
                </div>
                <button
                  type="button"
                  className="ops-button is-small"
                  onClick={() => void refresh()}
                >
                  Atualizar status
                </button>
              </div>
              <ul>
                {request.targets.map((target) => (
                  <li key={target.id}>
                    <span>
                      {target.destination?.name ?? 'Grupo selecionado'}
                    </span>
                    <strong>
                      {manualTargetStatusLabel(target.status)}
                      {target.blockedReason
                        ? ` · ${blockerLabel(target.blockedReason)}`
                        : ''}
                      {target.investigationRequired
                        ? ' · investigação manual obrigatória; não repita'
                        : ''}
                    </strong>
                  </li>
                ))}
              </ul>
              {request.status === 'AMBIGUOUS' ? (
                <p className="offer-danger-text">
                  Há um resultado ambíguo. Não tente reenviar; siga a
                  investigação manual indicada pelo histórico.
                </p>
              ) : null}
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}

function offerStatusTone(status: ShopeeOfferStatus): OpsTone {
  if (status === 'ACTIVE') return 'success';
  if (status === 'EXPIRED') return 'danger';
  return 'warning';
}

function commercialLabel(detail: ShopeeOfferDetail) {
  const summary = detail.commercialStateSummary;
  if (detail.status === 'EXPIRED') return 'Oferta expirada';
  if (detail.status === 'UNAVAILABLE') return 'Oferta indisponível';
  if (summary.blocked > 0) return 'Bloqueada no fluxo';
  if (summary.expired > 0) return 'Candidatos expirados';
  if (summary.copyReady > 0) return 'Texto pronto';
  if (summary.reserved > 0) return 'Em reserva';
  if (summary.queued > 0) return 'Em preparação';
  if (summary.dispatched > 0 || detail.everSent) return 'Já enviada';
  return 'Aguardando seleção';
}

function commercialMessage(detail: ShopeeOfferDetail) {
  const summary = detail.commercialStateSummary;
  if (detail.status === 'EXPIRED') {
    return 'Esta oferta expirou e não deve ser tratada como uma oportunidade ativa.';
  }
  if (detail.status === 'UNAVAILABLE') {
    return 'Esta oferta está indisponível no catálogo persistido no momento.';
  }
  if (summary.blocked > 0) {
    return 'A seleção comercial está bloqueada; nenhuma publicação é criada por esta tela.';
  }
  if (summary.expired > 0) {
    return 'Os candidatos anteriores expiraram; uma nova seleção depende das regras atuais.';
  }
  if (summary.copyReady > 0)
    return 'Há texto pronto para a próxima etapa do fluxo comercial.';
  if (summary.queued > 0 || summary.reserved > 0)
    return 'A oferta está sendo considerada pelo fluxo comercial.';
  if (detail.everSent)
    return 'Esta oferta já possui histórico de envio e continua disponível para acompanhamento.';
  return 'A oferta está disponível para avaliação conforme as regras comerciais atuais.';
}

function commercialTone(detail: ShopeeOfferDetail): OpsTone {
  if (detail.status === 'EXPIRED') return 'danger';
  if (
    detail.status === 'UNAVAILABLE' ||
    detail.commercialStateSummary.blocked > 0
  )
    return 'warning';
  if (detail.commercialStateSummary.expired > 0) return 'info';
  if (detail.commercialStateSummary.copyReady > 0 || detail.everSent)
    return 'success';
  if (
    detail.commercialStateSummary.queued > 0 ||
    detail.commercialStateSummary.reserved > 0
  )
    return 'info';
  return 'neutral';
}

function categoryLabels(
  categoryIds: string[],
  categoryMap: Map<string, string>,
  categoryError: boolean,
) {
  if (categoryIds.length === 0) return 'Sem categoria';
  return categoryIds
    .map(
      (categoryId) =>
        categoryMap.get(categoryId) ??
        (categoryError ? 'Categoria indisponível' : 'Categoria não disponível'),
    )
    .join(' · ');
}

function sourceLabel(source: ShopeeOfferDetail['source']) {
  return { MOCK: 'Demonstração', MANUAL: 'Importada', OFFICIAL: 'Oficial' }[
    source
  ];
}

function destinationTypeLabel(type: 'INDIVIDUAL' | 'GROUP') {
  return type === 'GROUP' ? 'Grupo' : 'Contato';
}

function dispatchTone(status: string): OpsTone {
  if (status === 'SENT') return 'success';
  if (status === 'FAILED') return 'danger';
  if (status === 'PROCESSING') return 'info';
  return 'warning';
}

function dispatchStatusLabel(status: string) {
  return (
    {
      PENDING: 'Aguardando',
      PROCESSING: 'Em andamento',
      SENT: 'Enviado',
      FAILED: 'Falhou',
    }[status] ?? 'Sem resultado'
  );
}

function runStatusLabel(status: string | null | undefined) {
  return (
    {
      PENDING: 'Aguardando',
      SENT: 'Enviado',
      FAILED: 'Falhou',
      AMBIGUOUS: 'Resultado incerto',
    }[status ?? ''] ?? 'Não registrado'
  );
}

function copyStatusLabel(
  status: 'AVAILABLE' | 'READY' | 'BLOCKED' | 'UNKNOWN',
) {
  return {
    AVAILABLE: 'disponível',
    READY: 'pronta',
    BLOCKED: 'bloqueada',
    UNKNOWN: 'não verificada',
  }[status];
}

function manualRequestStatusLabel(status: ManualPublicationRequest['status']) {
  return {
    ACCEPTED: 'aceita',
    PROCESSING: 'em processamento',
    COMPLETED: 'concluída',
    PARTIAL: 'parcial',
    BLOCKED: 'bloqueada',
    FAILED: 'falhou de forma terminal',
    AMBIGUOUS: 'ambígua: investigação obrigatória',
  }[status];
}

function manualTargetStatusLabel(
  status: ManualPublicationRequest['targets'][number]['status'],
) {
  return {
    ACCEPTED: 'aceito',
    PROCESSING: 'preparando',
    QUEUED: 'na fila segura',
    SENT: 'enviado',
    BLOCKED: 'bloqueado',
    FAILED: 'falhou de forma terminal',
    AMBIGUOUS: 'ambíguo',
  }[status];
}

function blockerLabel(code: string) {
  const labels: Record<string, string> = {
    DESTINATION_INACTIVE: 'grupo inativo',
    DESTINATION_UNAVAILABLE: 'grupo indisponível',
    CAMPAIGN_INACTIVE: 'campanha inativa',
    NICHE_INACTIVE: 'nicho inativo',
    GROUP_DAILY_LIMIT_REACHED: 'limite diário do grupo atingido',
    MINIMUM_INTERVAL_NOT_REACHED: 'aguarde o intervalo mínimo',
    GROUP_SEND_DISABLED: 'envio para grupos desativado',
    COMMERCIAL_SAFE_MODE_REQUIRED: 'safe mode obrigatório',
  };
  return labels[code] ?? 'Bloqueio operacional';
}

function Metric({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className={emphasis ? 'is-emphasis' : undefined}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function TechnicalMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function HistorySection({
  title,
  meta,
  empty,
  page,
  hasPreviousPage,
  hasNextPage,
  onPrevious,
  onNext,
  children,
}: {
  title: string;
  meta: string;
  empty: string;
  page: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  onPrevious(): void;
  onNext(): void;
  children: ReactNode;
}) {
  const entries = Array.isArray(children)
    ? children.filter(Boolean)
    : children
      ? [children]
      : [];
  return (
    <OpsSection
      title={title}
      meta={meta}
      className="offer-detail-section offer-history-section"
    >
      {entries.length === 0 ? (
        <p className="offer-detail-muted">{empty}</p>
      ) : (
        <ul className="offer-history-list">{children}</ul>
      )}
      <div className="offer-history-pagination">
        <span>Página {page}</span>
        <div>
          <button
            type="button"
            className="ops-button is-small"
            disabled={!hasPreviousPage}
            onClick={onPrevious}
          >
            Anterior
          </button>
          <button
            type="button"
            className="ops-button is-small"
            disabled={!hasNextPage}
            onClick={onNext}
          >
            Próxima
          </button>
        </div>
      </div>
    </OpsSection>
  );
}
