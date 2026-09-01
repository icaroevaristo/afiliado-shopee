'use client';

import { X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import {
  DashboardApiError,
  listDispatches,
  listWhatsAppGroups,
  type DispatchFilters,
  type WhatsAppDispatch,
  type WhatsAppGroup,
} from '../../lib/api';
import {
  CopyIdButton,
  OpsBadge,
  OpsEmpty,
  OpsLoading,
  OpsPageHeading,
  OpsSection,
  OpsState,
  RefreshButton,
} from '../../components/ops-components';
import { SafeProductImage } from '../../components/safe-product-image';
import { formatCurrency, formatDateTimeInTimezone } from '../../lib/format';
import {
  presentSendHistoryError,
  presentSendHistoryStatus,
  presentSendHistoryTimestamp,
  SEND_HISTORY_FILTERS,
  type SendHistoryFilter,
} from '../../lib/send-history-display';

const TIMEZONE = 'America/Sao_Paulo';

const formatHistoryDate = (value: string, fallback: string) =>
  formatDateTimeInTimezone(value, TIMEZONE, fallback, 'medium');

const formatHistoryPrice = (value: unknown) => {
  const numericValue =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : null;
  return typeof numericValue === 'number' && Number.isFinite(numericValue)
    ? formatCurrency(numericValue)
    : '—';
};

const resolveGroupName = (
  dispatch: WhatsAppDispatch,
  groupNames: Readonly<Record<string, string>>,
) =>
  groupNames[dispatch.destinationId] ??
  dispatch.destination?.name ??
  'Grupo não disponível';

const readErrorMessage = (cause: unknown) => {
  if (cause instanceof DashboardApiError) return cause.message;
  return 'Não foi possível atualizar o histórico agora.';
};

function SendStatus({ status }: { status: WhatsAppDispatch['status'] }) {
  const presentation = presentSendHistoryStatus(status);

  return (
    <span className="grid gap-1">
      <span className="flex items-center gap-2">
        <OpsBadge tone={presentation.tone}>{presentation.label}</OpsBadge>
      </span>
      <span className="text-xs text-[var(--ops-muted)]">
        {presentation.description}
      </span>
    </span>
  );
}

function HistoryTimestamp({ dispatch }: { dispatch: WhatsAppDispatch }) {
  const timestamp = presentSendHistoryTimestamp(dispatch, formatHistoryDate);

  return (
    <span className="grid gap-0.5">
      <span className="ops-detail-label">{timestamp.label}</span>
      <span className="text-sm font-medium text-[var(--ops-ink)]">
        {timestamp.value}
      </span>
    </span>
  );
}

function HistoryRecord({
  dispatch,
  groupNames,
  onOpen,
}: {
  dispatch: WhatsAppDispatch;
  groupNames: Readonly<Record<string, string>>;
  onOpen: (dispatch: WhatsAppDispatch) => void;
}) {
  const productName = dispatch.product?.nome ?? 'Produto não informado';
  const groupName = resolveGroupName(dispatch, groupNames);
  const price = formatHistoryPrice(dispatch.product?.preco);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTableRowElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpen(dispatch);
    }
  };

  return (
    <tr
      data-history-record="true"
      tabIndex={0}
      className="cursor-pointer"
      onClick={() => onOpen(dispatch)}
      onKeyDown={handleKeyDown}
      aria-label={`Abrir detalhes de ${productName}`}
    >
      <td className="whitespace-nowrap align-top">
        <HistoryTimestamp dispatch={dispatch} />
      </td>
      <td className="align-top">
        <div className="ops-row-product">
          <SafeProductImage
            className="ops-thumb"
            src={dispatch.product?.urlImagem}
            alt=""
          />
          <div className="ops-row-product-copy min-w-0">
            <div className="ops-row-product-name line-clamp-2 !whitespace-normal">
              {productName}
            </div>
          </div>
        </div>
      </td>
      <td className="align-top">{groupName}</td>
      <td className="align-top">{price}</td>
      <td className="align-top">
        <SendStatus status={dispatch.status} />
      </td>
    </tr>
  );
}

function HistoryCard({
  dispatch,
  groupNames,
  onOpen,
}: {
  dispatch: WhatsAppDispatch;
  groupNames: Readonly<Record<string, string>>;
  onOpen: (dispatch: WhatsAppDispatch) => void;
}) {
  const productName = dispatch.product?.nome ?? 'Produto não informado';
  const groupName = resolveGroupName(dispatch, groupNames);
  const price = formatHistoryPrice(dispatch.product?.preco);

  return (
    <button
      type="button"
      data-history-record="true"
      data-history-card="true"
      className="grid min-h-[44px] gap-4 rounded-[var(--ops-radius-md)] border border-[var(--ops-border)] bg-[var(--ops-surface)] p-4 text-left shadow-[var(--ops-shadow-sm)] transition hover:border-[var(--ops-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ops-primary)]"
      onClick={() => onOpen(dispatch)}
      aria-label={`Abrir detalhes de ${productName}`}
    >
      <span className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 items-start gap-3">
          <SafeProductImage
            className="ops-thumb shrink-0"
            src={dispatch.product?.urlImagem}
            alt=""
          />
          <span className="line-clamp-2 text-sm font-semibold text-[var(--ops-ink)]">
            {productName}
          </span>
        </span>
        <SendStatus status={dispatch.status} />
      </span>
      <span className="grid grid-cols-2 gap-3 border-t border-[var(--ops-border)] pt-3">
        <span className="grid gap-0.5">
          <span className="ops-detail-label">Grupo</span>
          <span className="truncate text-sm text-[var(--ops-ink)]">
            {groupName}
          </span>
        </span>
        <span className="grid gap-0.5 text-right">
          <span className="ops-detail-label">Preço</span>
          <span className="text-sm font-medium text-[var(--ops-ink)]">
            {price}
          </span>
        </span>
      </span>
      <HistoryTimestamp dispatch={dispatch} />
    </button>
  );
}

function AdvancedDispatchDetails({ dispatch }: { dispatch: WhatsAppDispatch }) {
  return (
    <details className="mt-6 border-t border-[var(--ops-border)] pt-4">
      <summary className="cursor-pointer text-sm font-semibold text-[var(--ops-ink)]">
        Informações avançadas
      </summary>
      <div className="mt-4 grid gap-4">
        <div className="grid gap-1">
          <span className="ops-detail-label">Status técnico</span>
          <span className="ops-detail-value ops-mono">{dispatch.status}</span>
        </div>
        <div className="grid gap-1">
          <span className="ops-detail-label">Modo</span>
          <span className="ops-detail-value">
            {dispatch.deliveryMode ?? 'Não disponível'}
          </span>
        </div>
        <div className="grid gap-1">
          <span className="ops-detail-label">Tentativa registrada</span>
          <span className="ops-detail-value ops-mono">
            {dispatch.attemptCount}
          </span>
        </div>
        <div className="grid gap-1">
          <span className="ops-detail-label">Provider</span>
          <span className="ops-detail-value">
            {dispatch.provider ?? 'Não disponível'}
          </span>
        </div>
        <div className="grid gap-1">
          <span className="ops-detail-label">candidateId</span>
          <CopyIdButton
            value={dispatch.generatedCopy?.createdFromCandidateId}
          />
        </div>
        <div className="grid gap-1">
          <span className="ops-detail-label">generatedCopyId</span>
          <CopyIdButton value={dispatch.generatedCopyId} />
        </div>
        <div className="grid gap-1">
          <span className="ops-detail-label">dispatchId</span>
          <CopyIdButton value={dispatch.id} />
        </div>
        <div className="grid gap-1">
          <span className="ops-detail-label">externalMessageId</span>
          <CopyIdButton value={dispatch.externalMessageId} />
        </div>
        <div className="grid gap-1">
          <span className="ops-detail-label">Criado em</span>
          <span className="ops-detail-value">
            {dispatch.createdAt
              ? formatHistoryDate(dispatch.createdAt, 'Data não disponível')
              : 'Data não disponível'}
          </span>
        </div>
      </div>
    </details>
  );
}

function SendHistoryDrawer({
  dispatch,
  onClose,
}: {
  dispatch: WhatsAppDispatch;
  onClose: () => void;
}) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const productName = dispatch.product?.nome ?? 'Envio comercial';
  const error = presentSendHistoryError(dispatch.errorMessage, dispatch.status);
  const isUncertain = dispatch.status === 'PROCESSING';

  useEffect(() => {
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Tab' || !drawerRef.current) return;
      const focusable = Array.from(
        drawerRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]):not([tabindex="-1"]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => {
        const closedDetails = element.closest('details:not([open])');
        return !closedDetails || element.matches('summary');
      });
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      restoreFocusRef.current?.focus();
    };
  }, [onClose]);

  return (
    <div
      ref={drawerRef}
      className="ops-drawer-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="send-history-dialog-title"
    >
      <button
        type="button"
        className="absolute inset-0 h-full w-full cursor-default border-0 bg-transparent"
        aria-label="Fechar detalhes"
        tabIndex={-1}
        onClick={onClose}
      />
      <aside
        className="ops-drawer"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="ops-drawer-header">
          <div className="min-w-0">
            <p className="ops-eyebrow">Detalhes do envio</p>
            <h2
              id="send-history-dialog-title"
              className="ops-section-title line-clamp-2"
            >
              {productName}
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="ops-icon-button shrink-0"
            onClick={onClose}
            aria-label="Fechar detalhes"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="ops-drawer-body">
          <SafeProductImage
            className="ops-product-image mb-5"
            src={dispatch.product?.urlImagem}
            alt={productName}
          />
          <div className="grid gap-2">
            <span className="ops-detail-label">Status</span>
            <SendStatus status={dispatch.status} />
          </div>
          <div className="ops-detail-grid mt-5">
            <div>
              <div className="ops-detail-label">Grupo</div>
              <div className="ops-detail-value">
                {dispatch.destination?.name ?? 'Grupo não disponível'}
              </div>
            </div>
            <div>
              <div className="ops-detail-label">Preço</div>
              <div className="ops-detail-value">
                {formatCurrency(
                  typeof dispatch.product?.preco === 'number'
                    ? dispatch.product.preco
                    : null,
                )}
              </div>
            </div>
            <div>
              <HistoryTimestamp dispatch={dispatch} />
            </div>
          </div>

          {error ? (
            <div className="mt-6">
              <OpsState title="O que aconteceu" message={error} tone="danger" />
            </div>
          ) : null}
          {isUncertain ? (
            <div className="mt-6">
              <OpsState
                title="Resultado pendente"
                message="Não foi possível confirmar com segurança se este envio chegou ao destino. Nenhuma nova tentativa é oferecida aqui."
                tone="warning"
              />
            </div>
          ) : null}

          <AdvancedDispatchDetails dispatch={dispatch} />
        </div>
      </aside>
    </div>
  );
}

export default function SendsPage() {
  const [dispatches, setDispatches] = useState<WhatsAppDispatch[]>([]);
  const [filter, setFilter] = useState<SendHistoryFilter>('');
  const [selected, setSelected] = useState<WhatsAppDispatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groupNames, setGroupNames] = useState<Record<string, string>>({});
  const requestIdRef = useRef(0);
  const refreshInFlightRef = useRef(false);

  const load = useCallback(
    async (preserveData: boolean) => {
      if (preserveData && refreshInFlightRef.current) return;

      const requestId = ++requestIdRef.current;
      if (preserveData) {
        refreshInFlightRef.current = true;
        setRefreshing(true);
      } else {
        setLoading(true);
        setDispatches([]);
      }
      setError(null);

      try {
        const filters: DispatchFilters = filter ? { status: filter } : {};
        const [nextDispatches, nextGroupNames] = await Promise.all([
          listDispatches(filters),
          listWhatsAppGroups()
            .then((groups: WhatsAppGroup[]) =>
              Object.fromEntries(groups.map((group) => [group.id, group.name])),
            )
            .catch(() => null),
        ]);
        if (requestId === requestIdRef.current) {
          setDispatches(nextDispatches);
          if (nextGroupNames) setGroupNames(nextGroupNames);
        }
      } catch (cause) {
        if (requestId === requestIdRef.current)
          setError(readErrorMessage(cause));
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
          setRefreshing(false);
          refreshInFlightRef.current = false;
        }
      }
    },
    [filter],
  );

  useEffect(() => {
    setSelected(null);
    void load(false);
  }, [load]);

  const openDetails = (dispatch: WhatsAppDispatch) => setSelected(dispatch);

  return (
    <>
      <OpsPageHeading
        eyebrow="Histórico"
        title="Histórico"
        description="Acompanhe os envios realizados e os resultados registrados pelo sistema."
        actions={
          <RefreshButton onClick={() => void load(true)} busy={refreshing} />
        }
      />
      <OpsSection title="Envios registrados">
        <div
          className="ops-filter-row -mx-[18px] -mt-[18px] mb-0"
          role="group"
          aria-label="Filtrar histórico de envios"
        >
          {SEND_HISTORY_FILTERS.map((option) => (
            <button
              type="button"
              className="ops-filter-button"
              data-active={filter === option.value}
              aria-pressed={filter === option.value}
              key={option.value || 'all'}
              onClick={() => setFilter(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>

        {loading ? <OpsLoading label="Carregando histórico de envios" /> : null}

        {error ? (
          <OpsState
            title="Histórico indisponível"
            message={
              dispatches.length > 0
                ? 'Não foi possível atualizar agora. Os dados abaixo são da última leitura.'
                : error
            }
            tone="danger"
            action={
              <RefreshButton
                onClick={() => void load(true)}
                busy={refreshing}
              />
            }
          />
        ) : null}

        {!loading && !error && dispatches.length === 0 ? (
          <OpsEmpty
            title="Nenhum envio encontrado"
            message="Os envios registrados pelo sistema aparecerão aqui."
          />
        ) : null}

        {!loading && dispatches.length > 0 ? (
          <>
            <div className="ops-table-wrap -mx-[18px] hidden md:block">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>Quando</th>
                    <th>Produto</th>
                    <th>Grupo</th>
                    <th>Preço</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {dispatches.map((dispatch) => (
                    <HistoryRecord
                      key={dispatch.id}
                      dispatch={dispatch}
                      groupNames={groupNames}
                      onOpen={openDetails}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid gap-3 md:hidden">
              {dispatches.map((dispatch) => (
                <HistoryCard
                  key={dispatch.id}
                  dispatch={dispatch}
                  groupNames={groupNames}
                  onOpen={openDetails}
                />
              ))}
            </div>
          </>
        ) : null}
      </OpsSection>
      {selected ? (
        <SendHistoryDrawer
          dispatch={selected}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </>
  );
}
