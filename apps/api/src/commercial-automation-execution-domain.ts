import type {
  CommercialAutomationExecutionRecord,
  CommercialAutomationExecutionMode,
  CommercialAutomationExecutionStatus,
} from './repositories';

export const COMMERCIAL_EXECUTION_OWNERSHIP_LOST =
  'COMMERCIAL_EXECUTION_OWNERSHIP_LOST';
export const COMMERCIAL_AUTOMATION_SCHEDULE_REVISION_STALE =
  'SCHEDULE_REVISION_STALE';

export const isCommercialAutomationExecutionStale = (
  execution: CommercialAutomationExecutionRecord,
  now: Date,
) =>
  execution.status === 'STARTED' &&
  (!execution.activeKey ||
    !execution.ownerId ||
    !execution.heartbeatAt ||
    !execution.leaseExpiresAt ||
    execution.leaseExpiresAt.getTime() <= now.getTime());

export type CommercialAutomationMode = 'preview' | 'send';
export type CommercialAutomationProvider = 'mock' | 'manual' | 'official';
export type CommercialAutomationProviderSource = 'MOCK' | 'MANUAL' | 'OFFICIAL';
export type CommercialAutomationPublicStatus =
  'started' | 'blocked' | 'preview-ready' | 'queued' | 'failed' | 'ambiguous';

const PERSISTED_MODE_BY_PUBLIC = {
  preview: 'PREVIEW',
  send: 'SEND',
} as const satisfies Record<
  CommercialAutomationMode,
  CommercialAutomationExecutionMode
>;

const PUBLIC_MODE_BY_PERSISTED = {
  PREVIEW: 'preview',
  SEND: 'send',
} as const satisfies Record<
  CommercialAutomationExecutionMode,
  CommercialAutomationMode
>;

const SOURCE_BY_PROVIDER = {
  mock: 'MOCK',
  manual: 'MANUAL',
  official: 'OFFICIAL',
} as const satisfies Record<
  CommercialAutomationProvider,
  CommercialAutomationProviderSource
>;

const PUBLIC_STATUS_BY_PERSISTED = {
  STARTED: 'started',
  BLOCKED: 'blocked',
  PREVIEW_READY: 'preview-ready',
  QUEUED: 'queued',
  FAILED: 'failed',
  AMBIGUOUS: 'ambiguous',
} as const satisfies Record<
  CommercialAutomationExecutionStatus,
  CommercialAutomationPublicStatus
>;

export const toPersistedCommercialAutomationMode = (
  mode: CommercialAutomationMode,
) => PERSISTED_MODE_BY_PUBLIC[mode];

export const toPublicCommercialAutomationMode = (
  mode: CommercialAutomationExecutionMode,
) => PUBLIC_MODE_BY_PERSISTED[mode];

export const toCommercialAutomationProviderSource = (
  provider: CommercialAutomationProvider,
) => SOURCE_BY_PROVIDER[provider];

export const toPublicCommercialAutomationStatus = (
  status: CommercialAutomationExecutionStatus,
) => PUBLIC_STATUS_BY_PERSISTED[status];
