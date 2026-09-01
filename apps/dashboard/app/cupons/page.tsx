'use client';

import { TicketPercent } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { OffersContextNav } from '../../components/offers-context-nav';
import {
  OpsBadge,
  OpsEmpty,
  OpsLoading,
  OpsPageHeading,
  OpsState,
  RefreshButton,
  type OpsTone,
} from '../../components/ops-components';
import { listCoupons, type Coupon } from '../../lib/api';
import { formatCurrency, formatDateTime } from '../../lib/format';

type CouponState = {
  label: string;
  tone: OpsTone;
};

const toFiniteNumber = (value: string | number | null | undefined) => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const couponDiscount = (coupon: Coupon) => {
  const value = toFiniteNumber(coupon.discountValue);
  if (value === null) return 'Não informado';
  return coupon.discountType === 'PERCENTAGE'
    ? `${value.toLocaleString('pt-BR')}%`
    : formatCurrency(value);
};

const couponState = (coupon: Coupon, now = Date.now()): CouponState => {
  const startsAt = coupon.startsAt ? new Date(coupon.startsAt).getTime() : null;
  const endsAt = coupon.endsAt ? new Date(coupon.endsAt).getTime() : null;

  if (endsAt !== null && Number.isFinite(endsAt) && endsAt <= now) {
    return { label: 'Expirado', tone: 'danger' };
  }
  if (!coupon.active) return { label: 'Inativo', tone: 'neutral' };
  if (startsAt !== null && Number.isFinite(startsAt) && startsAt > now) {
    return { label: 'Agendado', tone: 'info' };
  }
  return { label: 'Disponível', tone: 'success' };
};

export default function CouponsPage() {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCoupons(await listCoupons());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="offers-page coupons-page">
      <OpsPageHeading
        eyebrow="Catálogo"
        title="Cupons"
        description="Consulte os cupons disponíveis para complementar uma oferta."
      />

      <OffersContextNav active="coupons" />

      <div className="coupons-readonly-note">
        <div>
          <strong>Consulta somente leitura</strong>
          <p>
            Aqui aparecem apenas cupons já cadastrados. Inclusão, edição e
            exclusão continuam fora do painel diário.
          </p>
        </div>
      </div>

      {error ? (
        <OpsState
          tone="danger"
          title="Não foi possível carregar os cupons"
          message={error}
          action={<RefreshButton onClick={() => void load()} busy={loading} />}
        />
      ) : null}

      {loading && coupons.length === 0 ? (
        <OpsLoading label="Carregando cupons" />
      ) : null}

      {!loading && !error && coupons.length === 0 ? (
        <OpsEmpty
          title="Nenhum cupom cadastrado"
          message="Nenhum cupom persistido está disponível para consulta."
        />
      ) : null}

      {coupons.length > 0 ? (
        <div className="coupons-grid">
          {coupons.map((coupon) => {
            const state = couponState(coupon);
            return (
              <article key={coupon.id} className="coupon-card">
                <div className="coupon-card-header">
                  <div className="coupon-card-title">
                    <span className="coupon-icon" aria-hidden="true">
                      <TicketPercent size={19} />
                    </span>
                    <div>
                      <h2>{coupon.code}</h2>
                      <p>{coupon.description || 'Cupom sem descrição'}</p>
                    </div>
                  </div>
                  <OpsBadge tone={state.tone}>{state.label}</OpsBadge>
                </div>
                <dl className="coupon-details">
                  <Metric label="Desconto" value={couponDiscount(coupon)} />
                  <Metric
                    label="Compra mínima"
                    value={
                      coupon.minPurchase
                        ? formatCurrency(toFiniteNumber(coupon.minPurchase))
                        : 'Não informada'
                    }
                  />
                  <Metric
                    label="Válido a partir de"
                    value={formatDateTime(coupon.startsAt ?? undefined)}
                  />
                  <Metric
                    label="Válido até"
                    value={formatDateTime(coupon.endsAt ?? undefined)}
                  />
                </dl>
              </article>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
