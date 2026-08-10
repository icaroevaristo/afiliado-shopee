import { apiRequest } from './client';
import type {
  CommercialAutomationExecutionPage,
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

export const resumeCommercialAutomation = (confirmation: string) =>
  apiRequest<CommercialAutomationStatus>('/commercial-automation/settings', {
    method: 'PATCH',
    body: { paused: false, confirmation },
  });
