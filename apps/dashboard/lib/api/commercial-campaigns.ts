import { apiRequest } from './client';
import type {
  CommercialCampaignPage,
  CommercialQueuePage,
  CommercialCandidateStatus,
} from './types';

export const listCommercialCampaigns = (page = 1, limit = 50) =>
  apiRequest<CommercialCampaignPage>(
    `/commercial/campaigns?page=${page}&limit=${limit}`,
    { method: 'GET' },
  );

export const listCommercialCampaignQueue = (
  campaignId: string,
  input: { page?: number; limit?: number; status?: CommercialCandidateStatus } = {},
) => {
  const params = new URLSearchParams({
    page: String(input.page ?? 1),
    limit: String(input.limit ?? 50),
  });
  if (input.status) params.set('status', input.status);
  return apiRequest<CommercialQueuePage>(
    `/commercial/campaigns/${encodeURIComponent(campaignId)}/queue?${params.toString()}`,
    { method: 'GET' },
  );
};
