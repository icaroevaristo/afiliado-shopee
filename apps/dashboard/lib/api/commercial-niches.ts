import { apiRequest } from './client';
import type {
  CommercialNiche,
  CommercialNicheInput,
  CommercialNichePage,
  CommercialNichePreviewReport,
} from './types';

const toQuery = (page: number, limit: number, active?: boolean) => {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });
  if (active !== undefined) params.set('active', String(active));
  return params.toString();
};

export const listCommercialNiches = (
  page = 1,
  limit = 100,
  active?: boolean,
) =>
  apiRequest<CommercialNichePage>(
    `/commercial/niches?${toQuery(page, limit, active)}`,
    { method: 'GET' },
  );

export const createCommercialNiche = (input: CommercialNicheInput) =>
  apiRequest<CommercialNiche>('/commercial/niches', {
    method: 'POST',
    body: input,
  });

export const updateCommercialNiche = (
  nicheId: string,
  input: Partial<CommercialNicheInput>,
) =>
  apiRequest<CommercialNiche>(
    `/commercial/niches/${encodeURIComponent(nicheId)}`,
    { method: 'PATCH', body: input },
  );

export const previewCommercialNiche = (input: CommercialNicheInput) =>
  apiRequest<CommercialNichePreviewReport>('/commercial/niches/preview', {
    method: 'POST',
    body: input,
  });
