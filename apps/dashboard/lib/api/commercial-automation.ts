import { apiRequest } from './client';
import type {
  CommercialAutomationExecutionPage,
  CommercialAutomationScheduleSettings,
  CommercialAutomationSchedulePreview,
  CommercialAutomationSchedulerStatus,
  CommercialAutomationStatus,
  CommercialDispatchOutboxPage,
} from './types';

export const getCommercialAutomationStatus = () =>
  apiRequest<CommercialAutomationStatus>('/commercial-automation/status', {
    method: 'GET',
  });

export const getCommercialAutomationSchedulerStatus = () =>
  apiRequest<CommercialAutomationSchedulerStatus>(
    '/commercial-automation/scheduler',
    { method: 'GET' },
  );

export const getCommercialAutomationScheduleSettings = () =>
  apiRequest<CommercialAutomationScheduleSettings>(
    '/commercial-automation/settings',
    {
      method: 'GET',
    },
  );

export const updateCommercialAutomationScheduleSettings = (input: {
  allowedStartTime?: string | null;
  allowedEndTime?: string | null;
  timezone?: string | null;
  minimumIntervalMinutes?: number | null;
  staggerMinutes?: number | null;
  expectedRevision?: number;
}) =>
  apiRequest<CommercialAutomationScheduleSettings>(
    '/commercial-automation/settings/schedule',
    { method: 'PATCH', body: input },
  );

export const getCommercialAutomationSchedulePreview = () =>
  apiRequest<CommercialAutomationSchedulePreview>(
    '/commercial-automation/schedule/preview',
    {
      method: 'GET',
    },
  );

export const listCommercialAutomationExecutions = (page = 1, limit = 20) =>
  apiRequest<CommercialAutomationExecutionPage>(
    `/commercial-automation/executions?page=${page}&limit=${limit}`,
    { method: 'GET' },
  );

export const listCommercialDispatchOutbox = (page = 1, limit = 20) =>
  apiRequest<CommercialDispatchOutboxPage>(
    `/commercial-automation/outbox?page=${page}&limit=${limit}`,
    { method: 'GET' },
  );

export const pauseCommercialAutomation = () =>
  apiRequest<CommercialAutomationStatus>('/commercial-automation/settings', {
    method: 'PATCH',
    body: { paused: true },
  });

export const resumeCommercialAutomation = (
  confirmation: string,
  expectedUpdatedAt: string,
) =>
  apiRequest<CommercialAutomationStatus>('/commercial-automation/settings', {
    method: 'PATCH',
    body: { paused: false, confirmation, expectedUpdatedAt },
  });
