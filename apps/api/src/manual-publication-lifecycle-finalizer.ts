import type {
  CommercialDispatchOutboxStatus,
  CommercialPipelineFinalStatus,
  CommercialPipelineRunStatus,
  ManualPublicationRequestRepository,
  ManualPublicationTargetStatus,
  ManualPublicationLifecycleFinalizationResult,
  WhatsAppDispatchStatus,
} from './repositories';

export type ManualPublicationLifecycleObservation = {
  hasRun: boolean;
  runStatus: CommercialPipelineRunStatus | null;
  runFinalStatus: CommercialPipelineFinalStatus | null;
  runInvestigationRequired: boolean;
  hasDispatch: boolean;
  dispatchStatus: WhatsAppDispatchStatus | null;
  hasOutbox: boolean;
  outboxStatus: CommercialDispatchOutboxStatus | null;
};

export type ManualPublicationTargetState = {
  status: ManualPublicationTargetStatus;
  investigationRequired: boolean;
};

/**
 * Keeps the status projection used by the existing manual service in one
 * place. The projection is deliberately based on persisted run/dispatch/
 * outbox state, never on BullMQ completion alone.
 */
export const deriveManualPublicationTargetState = (
  current: Pick<
    ManualPublicationTargetState,
    'status' | 'investigationRequired'
  >,
  observation: ManualPublicationLifecycleObservation,
): ManualPublicationTargetState => {
  if (current.status === 'AMBIGUOUS') return current;

  let status: ManualPublicationTargetStatus = current.status;
  let investigationRequired = current.investigationRequired;
  if (
    observation.outboxStatus === 'AMBIGUOUS' ||
    observation.runFinalStatus === 'AMBIGUOUS' ||
    observation.runInvestigationRequired
  ) {
    status = 'AMBIGUOUS';
    investigationRequired = true;
  } else if (
    observation.dispatchStatus === 'SENT' ||
    observation.runFinalStatus === 'SENT'
  ) {
    status = 'SENT';
    investigationRequired = false;
  } else if (
    observation.dispatchStatus === 'FAILED' ||
    observation.runFinalStatus === 'FAILED'
  ) {
    status = 'FAILED';
    investigationRequired = false;
  } else if (observation.hasOutbox || observation.hasDispatch) {
    status = 'QUEUED';
  } else if (observation.hasRun) {
    status = 'PROCESSING';
  }

  return { status, investigationRequired };
};

/**
 * The worker boundary only projects a terminal state when both persisted
 * commercial sources agree. This prevents a completed BullMQ job, or a
 * partially persisted run, from being treated as a successful publication.
 */
export const resolveManualPublicationTerminalStatus = (
  observation: ManualPublicationLifecycleObservation,
): Exclude<
  ManualPublicationTargetStatus,
  'ACCEPTED' | 'PROCESSING' | 'QUEUED'
> | null => {
  if (
    observation.outboxStatus === 'AMBIGUOUS' ||
    observation.runFinalStatus === 'AMBIGUOUS' ||
    observation.runInvestigationRequired
  ) {
    return 'AMBIGUOUS';
  }
  if (
    observation.hasRun &&
    observation.runStatus === 'COMPLETED' &&
    observation.hasDispatch &&
    observation.dispatchStatus === 'SENT' &&
    observation.runFinalStatus === 'SENT'
  ) {
    return 'SENT';
  }
  if (
    observation.hasRun &&
    observation.runStatus === 'FAILED' &&
    observation.hasDispatch &&
    observation.dispatchStatus === 'FAILED' &&
    observation.runFinalStatus === 'FAILED'
  ) {
    return 'FAILED';
  }
  return null;
};

export const aggregateManualPublicationRequestStatus = (
  statuses: ManualPublicationTargetStatus[],
) => {
  const hasAmbiguous = statuses.includes('AMBIGUOUS');
  const hasActive = statuses.some((status) =>
    ['ACCEPTED', 'PROCESSING', 'QUEUED'].includes(status),
  );
  const sentCount = statuses.filter((status) => status === 'SENT').length;
  const terminalCount = statuses.filter((status) =>
    ['SENT', 'BLOCKED', 'FAILED'].includes(status),
  ).length;
  return hasAmbiguous
    ? ('AMBIGUOUS' as const)
    : hasActive
      ? ('PROCESSING' as const)
      : sentCount === statuses.length
        ? ('COMPLETED' as const)
        : sentCount > 0
          ? ('PARTIAL' as const)
          : terminalCount === statuses.length &&
              statuses.every((status) => status === 'BLOCKED')
            ? ('BLOCKED' as const)
            : ('FAILED' as const);
};

export const isManualPublicationRequestTerminal = (status: string) =>
  ['COMPLETED', 'PARTIAL', 'BLOCKED', 'FAILED', 'AMBIGUOUS'].includes(status);

export type ManualPublicationLifecycleFinalizerLogger = {
  info: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

type ManualPublicationLifecycleFinalizerRepository = Pick<
  ManualPublicationRequestRepository,
  'finalizeAfterCommercialDispatch'
> & {
  finalizeAfterCommercialDispatch: NonNullable<
    ManualPublicationRequestRepository['finalizeAfterCommercialDispatch']
  >;
};

export class ManualPublicationLifecycleFinalizer {
  private readonly clock: () => Date;

  constructor(
    private readonly repository: ManualPublicationLifecycleFinalizerRepository,
    private readonly options: {
      clock?: () => Date;
      logger?: ManualPublicationLifecycleFinalizerLogger;
    } = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
  }

  async finalizeAfterDispatch(
    dispatchId: string,
  ): Promise<ManualPublicationLifecycleFinalizationResult> {
    try {
      const result = await this.repository.finalizeAfterCommercialDispatch({
        dispatchId,
        now: this.clock(),
      });
      this.options.logger?.info(
        {
          event: 'manual-publication.lifecycle.finalized',
          dispatchId,
          outcome: result.outcome,
          writes: result.writes,
          ...(result.outcome === 'FINALIZED' ||
          result.outcome === 'ALREADY_FINALIZED'
            ? {
                requestId: result.requestId,
                targetId: result.targetId,
                targetStatus: result.targetStatus,
                requestStatus: result.requestStatus,
              }
            : {}),
        },
        'Manual publication lifecycle finalization completed',
      );
      return result;
    } catch (error) {
      this.options.logger?.error(
        {
          event: 'manual-publication.lifecycle.finalization.error',
          dispatchId,
          errorType: error instanceof Error ? error.name : 'UnknownError',
          errorCode:
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            typeof error.code === 'string'
              ? error.code
              : 'UNKNOWN',
        },
        'Manual publication lifecycle finalization failed',
      );
      throw error;
    }
  }
}

export type ManualPublicationLifecycleFinalizerPort = Pick<
  ManualPublicationLifecycleFinalizer,
  'finalizeAfterDispatch'
>;
