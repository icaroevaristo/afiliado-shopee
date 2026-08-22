import { apiRequest } from './client';
import type { CommercialCopyHistoryPage, CopyResponse } from './types';

export const generateCopy = (productId: string) =>
  apiRequest<CopyResponse>('/copy/generate', {
    method: 'POST',
    body: { productId },
  });

export const listCommercialCopyHistory = (page = 1, limit = 20) =>
  apiRequest<CommercialCopyHistoryPage>(
    `/commercial-automation/copies?page=${page}&limit=${limit}`,
    { method: 'GET' },
  );

