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

export type DashboardProxyMethod = 'GET' | 'PATCH' | 'POST';

export type DashboardProxyContract = {
  readonly method: DashboardProxyMethod;
  readonly pattern: readonly string[];
};

/**
 * The bounded Dashboard-to-API proxy contract. A wildcard matches exactly one
 * encoded segment; it never crosses a path boundary.
 */
export const DASHBOARD_PROXY_CONTRACTS: readonly DashboardProxyContract[] = [
  { method: 'GET', pattern: ['health'] },
  { method: 'GET', pattern: ['commercial-automation', 'status'] },
  { method: 'GET', pattern: ['commercial-automation', 'scheduler'] },
  { method: 'GET', pattern: ['commercial-automation', 'settings'] },
  { method: 'GET', pattern: ['commercial-automation', 'schedule', 'preview'] },
  { method: 'GET', pattern: ['commercial-automation', 'executions'] },
  { method: 'GET', pattern: ['commercial-automation', 'outbox'] },
  { method: 'PATCH', pattern: ['commercial-automation', 'settings'] },
  { method: 'PATCH', pattern: ['commercial-automation', 'settings', 'admin'] },
  { method: 'GET', pattern: ['operational-admin'] },
  { method: 'GET', pattern: ['commercial', 'campaigns'] },
  { method: 'POST', pattern: ['commercial', 'campaigns'] },
  { method: 'PATCH', pattern: ['commercial', 'campaigns', '*'] },
  { method: 'POST', pattern: ['commercial', 'campaigns', '*', 'activate'] },
  { method: 'POST', pattern: ['commercial', 'campaigns', '*', 'deactivate'] },
  { method: 'GET', pattern: ['commercial', 'campaigns', '*', 'queue'] },
  { method: 'GET', pattern: ['commercial', 'niches'] },
  { method: 'POST', pattern: ['commercial', 'niches'] },
  { method: 'PATCH', pattern: ['commercial', 'niches', '*'] },
  { method: 'POST', pattern: ['commercial', 'niches', 'preview'] },
  { method: 'GET', pattern: ['commercial-pipeline', 'runs'] },
  { method: 'GET', pattern: ['pipeline', 'jobs', '*'] },
  { method: 'GET', pattern: ['shopee', 'offers'] },
  { method: 'GET', pattern: ['shopee', 'offers', '*'] },
  { method: 'POST', pattern: ['shopee', 'offers', '*', 'copy-preview'] },
  { method: 'GET', pattern: ['whatsapp', 'dispatches'] },
  { method: 'GET', pattern: ['whatsapp', 'groups'] },
  { method: 'PATCH', pattern: ['whatsapp', 'groups', '*', 'admin'] },
  { method: 'GET', pattern: ['whatsapp', 'instances'] },
  { method: 'POST', pattern: ['whatsapp', 'instances'] },
  { method: 'PATCH', pattern: ['whatsapp', 'instances', '*'] },
  { method: 'GET', pattern: ['coupons'] },
  { method: 'GET', pattern: ['commercial-publications', 'manual', 'options'] },
  { method: 'GET', pattern: ['commercial-publications', 'manual', '*'] },
  { method: 'POST', pattern: ['commercial-publications', 'manual'] },
];
