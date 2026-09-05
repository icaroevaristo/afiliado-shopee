export type Product = {
  id: string;
  nome: string;
  categoria: string;
  preco: number;
  desconto: number;
  nota: number;
  vendidos: number;
  comissao: number;
  loja: string;
  urlImagem: string;
  url?: string;
  title?: string;
  price?: number;
  rating?: number;
  sales?: number;
  commissionRate?: number;
};

export type ProductFilters = {
  categoria?: string;
  precoMin?: number;
  precoMax?: number;
  descontoMin?: number;
  notaMin?: number;
  vendidosMin?: number;
  comissaoMin?: number;
};

export type ScoredProduct = Product & { score: number; reasons: string[] };

export class AppError extends Error {
  constructor(
    message: string,
    public readonly code = 'APP_ERROR',
  ) {
    super(message);
  }
}

/**
 * Upper bound for persisted daily message/provider budgets. The actual
 * campaign capacity is still constrained by its theoretical schedule slots.
 */
export const COMMERCIAL_DAILY_LIMIT_MAX = 1_000_000;

export const nowIso = () => new Date().toISOString();
