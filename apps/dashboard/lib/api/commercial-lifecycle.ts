import { apiRequest } from './client';
import type { CommercialLifecyclePage } from './types';

export const listCommercialLifecycles = (page = 1, limit = 20) =>
  apiRequest<CommercialLifecyclePage>(
    `/commercial-automation/lifecycles?page=${page}&limit=${limit}`,
    { method: 'GET' },
  );
