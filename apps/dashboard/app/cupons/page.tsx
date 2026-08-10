'use client';

import { TicketPercent } from 'lucide-react';
import { useEffect, useState } from 'react';
import { EmptyState } from '../../components/empty-state';
import { ErrorState } from '../../components/error-state';
import { LoadingState } from '../../components/loading-state';
import { PageHeader } from '../../components/page-header';
import { StatusBadge } from '../../components/status-badge';
import { listCoupons, type Coupon } from '../../lib/api';
import { formatCurrency, formatDateTime } from '../../lib/format';

const isExpired = (coupon: Coupon) =>
  Boolean(coupon.endsAt && new Date(coupon.endsAt) <= new Date());

export default function CouponsPage() {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setCoupons(await listCoupons());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Cupons manuais"
        description="Cupons persistidos em modo somente leitura. Inclusão, edição e exclusão ficam fora do Operations Console."
      />

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
        O console exibe somente códigos já persistidos. Não há coleta ou
        alteração de cupons nesta versão.
      </div>

      {error ? <ErrorState message={error} onRetry={load} /> : null}

      {loading ? <LoadingState label="Carregando cupons" /> : null}
      {!loading && coupons.length === 0 ? (
        <EmptyState
          title="Nenhum cupom cadastrado"
          description="Nenhum cupom persistido está disponível para consulta."
        />
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {coupons.map((coupon) => {
          const expired = isExpired(coupon);
          return (
            <article
              key={coupon.id}
              className="rounded-lg border border-slate-200 bg-white p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span className="rounded-md bg-orange-50 p-2 text-orange-700">
                    <TicketPercent className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div>
                    <h2 className="font-semibold text-slate-950">
                      {coupon.code}
                    </h2>
                    <p className="mt-1 text-sm text-slate-600">
                      {coupon.description}
                    </p>
                  </div>
                </div>
                <StatusBadge
                  tone={coupon.active && !expired ? 'ok' : 'warning'}
                >
                  {expired ? 'Vencido' : coupon.active ? 'Ativo' : 'Inativo'}
                </StatusBadge>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <Metric
                  label="Desconto"
                  value={
                    coupon.discountType === 'PERCENTAGE'
                      ? `${coupon.discountValue}%`
                      : formatCurrency(Number(coupon.discountValue))
                  }
                />
                <Metric
                  label="Compra minima"
                  value={
                    coupon.minPurchase
                      ? formatCurrency(Number(coupon.minPurchase))
                      : 'Nao informada'
                  }
                />
                <Metric
                  label="Inicio"
                  value={formatDateTime(coupon.startsAt ?? undefined)}
                />
                <Metric
                  label="Fim"
                  value={formatDateTime(coupon.endsAt ?? undefined)}
                />
              </dl>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900">{value}</dd>
    </div>
  );
}
