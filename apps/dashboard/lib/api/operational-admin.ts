import { apiRequest } from './client';
import type {
  OperationalAdmin,
  OperationalAdminGroup,
  OperationalAdminInstance,
  CommercialAutomationScheduleSettings,
} from './types';

export const getOperationalAdmin = () =>
  apiRequest<OperationalAdmin>('/operational-admin', { method: 'GET' });

export const listOperationalInstances = () =>
  apiRequest<OperationalAdminInstance[]>('/whatsapp/instances', {
    method: 'GET',
  });

export const createOperationalInstance = (name: string, confirmation: string) =>
  apiRequest<OperationalAdminInstance>('/whatsapp/instances', {
    method: 'POST',
    body: { name, confirmation },
  });

export const updateOperationalInstance = (
  name: string,
  input: {
    active?: boolean;
    paused?: boolean;
    expectedUpdatedAt: string;
    confirmation: string;
  },
) =>
  apiRequest<OperationalAdminInstance>(
    `/whatsapp/instances/${encodeURIComponent(name)}`,
    { method: 'PATCH', body: input },
  );

export const updateOperationalGroup = (
  id: string,
  input: {
    active?: boolean;
    paused?: boolean;
    assignedInstanceName?: string | null;
    expectedUpdatedAt: string;
    confirmation: string;
  },
) =>
  apiRequest<OperationalAdminGroup>(
    `/whatsapp/groups/${encodeURIComponent(id)}/admin`,
    { method: 'PATCH', body: input },
  );

export const updateOperationalAutomation = (input: {
  allowedStartTime?: string | null;
  allowedEndTime?: string | null;
  minimumIntervalMinutes?: number | null;
  staggerMinutes?: number | null;
  dailyGlobalLimit?: number | null;
  dailyGroupLimit?: number | null;
  expectedRevision: number;
  confirmation: string;
}) =>
  apiRequest<CommercialAutomationScheduleSettings>(
    '/commercial-automation/settings/admin',
    {
      method: 'PATCH',
      body: input,
    },
  );
