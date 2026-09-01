'use client';

import { FileText } from 'lucide-react';
import { useEffect, useState } from 'react';
import { EmptyState } from '../../components/empty-state';
import { ErrorState } from '../../components/error-state';
import { LoadingState } from '../../components/loading-state';
import { PageHeader } from '../../components/page-header';
import { listProductsFromDispatches, type DashboardProduct } from '../../lib/api';

export default function CopiesPage() {
  const [products, setProducts] = useState<DashboardProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setError(null);
      try {
        setProducts(await listProductsFromDispatches());
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro inesperado.');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Textos das ofertas"
        description="Registro de produtos relacionados a envios em modo somente leitura. A geração manual não é exposta nesta versão."
      />

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
        A geração de copy pertence aos fluxos oficiais de automação. O
        Esta área não inicia geração nem persiste novos textos.
      </div>

      {error ? <ErrorState message={error} /> : null}
      {loading ? <LoadingState label="Carregando produtos relacionados" /> : null}
      {!loading && !error && products.length === 0 ? (
        <EmptyState
          title="Nenhum produto relacionado"
          description="Nenhum produto de dispatch está disponível para consulta."
        />
      ) : null}
      {products.length > 0 ? (
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-slate-500" aria-hidden="true" />
            <h2 className="font-semibold text-slate-950">Produtos com dispatch</h2>
          </div>
          <div className="mt-4 grid gap-3">
            {products.map((product) => (
              <article
                key={product.id}
                className="grid gap-2 rounded-md border border-slate-200 p-4 sm:grid-cols-[1fr_auto] sm:items-center"
              >
                <div>
                  <p className="font-medium text-slate-950">{product.nome}</p>
                  <p className="mt-1 font-mono text-xs text-slate-500">
                    productId: {product.id}
                  </p>
                </div>
                <span className="text-sm text-slate-600">
                  {product.urlImagem ? 'Imagem disponível' : 'Imagem indisponível'}
                </span>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
