import type { FastifyBaseLogger } from 'fastify';

import { AppError } from '@shopee-auto-affiliate-ai/shared';

import { finalizeCommercialPipelineRun } from './commercial-pipeline-run-finalizer';
import type { ManualPublicationLifecycleFinalizerPort } from './manual-publication-lifecycle-finalizer';
import type {
  CommercialPipelineRunFinalizationRepository,
  CommercialPipelineRunRepository,
  CommercialPromotionCandidateRepository,
  WhatsAppDeliveryEventInboxRepository,
  WhatsAppDeliveryEventApplyResult,
  WhatsAppDeliveryEventInput,
  WhatsAppDeliveryEventReplay,
  WhatsAppDeliveryEventStatus,
  WhatsAppDispatchRepository,
  WhatsAppDispatchRecord,
} from './repositories';

export type WhatsAppDeliveryConfirmationInput = WhatsAppDeliveryEventInput & {
  receivedAt?: Date;
};

type DeliveryConfirmationDependencies = {
  dispatches: Pick<
    WhatsAppDispatchRepository,
    | 'applyDeliveryEvent'
    | 'expireSubmittedConfirmations'
    | 'replayPendingDeliveryEvents'
  >;
  deliveryEvents: WhatsAppDeliveryEventInboxRepository;
  manualLifecycleFinalizer?: ManualPublicationLifecycleFinalizerPort;
  runs: CommercialPipelineRunRepository &
    CommercialPipelineRunFinalizationRepository;
  promotionCandidates?: Pick<
    CommercialPromotionCandidateRepository,
    | 'markDispatchedByGeneratedCopyId'
    | 'markBlockedByGeneratedCopyId'
    | 'resetCampaignFailureStateByGeneratedCopyId'
    | 'findAttemptContextByGeneratedCopyId'
    | 'releaseAttempt'
  >;
  logger: Pick<FastifyBaseLogger, 'info' | 'error'>;
  clock?: () => Date;
};

const isTerminalOrConfirmed = (status: string) =>
  status === 'SENT' ||
  status === 'DELIVERED' ||
  status === 'READ' ||
  status === 'FAILED' ||
  status === 'AMBIGUOUS';

const eventWasApplied = (result: WhatsAppDeliveryEventReplay['result']) =>
  result.kind === 'UPDATED' ||
  (result.kind === 'NOOP' && Boolean(result.dispatch));

const eventIsAmbiguous = (result: WhatsAppDeliveryEventReplay['result']) =>
  result.kind === 'AMBIGUOUS' ||
  (result.kind === 'NOOP' && !result.dispatch);

const hasDeliveryDispatch = (
  result: WhatsAppDeliveryEventApplyResult,
): result is Extract<WhatsAppDeliveryEventApplyResult, { dispatch: WhatsAppDispatchRecord }> =>
  'dispatch' in result && result.dispatch !== undefined;

/**
 * Persists Evolution MESSAGES_UPDATE transitions. The repository applies a
 * status-guarded CAS, so delayed or duplicate webhook deliveries cannot
 * downgrade a later delivery state or advance rotation twice.
 */
export class WhatsAppDeliveryConfirmationService {
  constructor(private readonly dependencies: DeliveryConfirmationDependencies) {}

  private async finalize(dispatch: WhatsAppDispatchRecord) {
    await finalizeCommercialPipelineRun({
      runs: this.dependencies.runs,
      promotionCandidates: this.dependencies.promotionCandidates,
      dispatch,
      failed: dispatch.status === 'FAILED',
      logger: this.dependencies.logger,
      clock: this.dependencies.clock,
    });
    await this.dependencies.manualLifecycleFinalizer?.finalizeAfterDispatch(
      dispatch.id,
    );
  }

  async consume(input: WhatsAppDeliveryConfirmationInput) {
    const inboxRecord = await this.dependencies.deliveryEvents.record(input);
    if (inboxRecord.state === 'AMBIGUOUS') {
      this.dependencies.logger.info(
        {
          event: 'whatsapp.delivery-confirmation.ignored',
          instanceName: input.instanceName,
          status: input.status,
          reason: 'INBOX_AMBIGUOUS',
        },
        'WhatsApp delivery update remains blocked by ambiguous correlation',
      );
      return { kind: 'NOOP' as const };
    }
    if (inboxRecord.state === 'APPLIED') {
      return { kind: 'NOOP' as const };
    }
    const result = await this.dependencies.dispatches.applyDeliveryEvent(input);
    if (result.kind === 'NOT_FOUND' || result.kind === 'PENDING') {
      this.dependencies.logger.info(
        {
          event: 'whatsapp.delivery-confirmation.pending',
          instanceName: input.instanceName,
          status: input.status,
          reason: result.kind,
        },
        'WhatsApp delivery update was retained until submission correlation exists',
      );
      return result;
    }

    if (
      (result.kind === 'UPDATED' || result.kind === 'NOOP') &&
      result.dispatch &&
      isTerminalOrConfirmed(result.dispatch.status)
    ) {
      // Keep the inbox PENDING until lifecycle finalization succeeds. A crash
      // after the CAS but before rotation/finalization must be recoverable by
      // the next delivery event or the pending inbox drain.
      await this.finalize(result.dispatch);
    }

    await this.dependencies.deliveryEvents.markProcessed({
      fingerprint: inboxRecord.fingerprint,
      state: eventIsAmbiguous(result)
        ? 'AMBIGUOUS'
        : eventWasApplied(result)
          ? 'APPLIED'
          : 'AMBIGUOUS',
      processedAt: (this.dependencies.clock ?? (() => new Date()))(),
    });

    if (result.kind !== 'UPDATED') {
      this.dependencies.logger.info(
        {
          event: 'whatsapp.delivery-confirmation.ignored',
          instanceName: input.instanceName,
          status: input.status,
          reason: result.kind,
        },
        'WhatsApp delivery update did not change a dispatch',
      );
      return result;
    }

    this.dependencies.logger.info(
      {
        event: 'whatsapp.delivery-confirmation.persisted',
        instanceName: input.instanceName,
        dispatchId: result.dispatch.id,
        status: result.dispatch.status,
      },
      'WhatsApp delivery update persisted',
    );
    return result;
  }

  async expireDue(now = (this.dependencies.clock ?? (() => new Date()))()) {
    const replayed =
      (await this.dependencies.dispatches.replayPendingDeliveryEvents?.()) ??
      [];
    const dispatchesToFinalize = new Map<string, WhatsAppDispatchRecord>();
    for (const replay of replayed) {
      if (
        hasDeliveryDispatch(replay.result) &&
        isTerminalOrConfirmed(replay.result.dispatch.status)
      ) {
        dispatchesToFinalize.set(replay.result.dispatch.id, replay.result.dispatch);
      }
    }
    for (const dispatch of dispatchesToFinalize.values()) {
      await this.finalize(dispatch);
    }
    const finalizedDispatchIds = new Set(dispatchesToFinalize.keys());
    for (const replay of replayed) {
      await this.dependencies.deliveryEvents.markProcessed({
        fingerprint: replay.fingerprint,
        state: eventIsAmbiguous(replay.result)
          ? 'AMBIGUOUS'
          : eventWasApplied(replay.result)
            ? 'APPLIED'
            : 'AMBIGUOUS',
        processedAt: now,
      });
    }
    const expired = await this.dependencies.dispatches.expireSubmittedConfirmations(
      now,
    );
    for (const dispatch of expired) {
      if (!finalizedDispatchIds.has(dispatch.id)) {
        finalizedDispatchIds.add(dispatch.id);
        await this.finalize(dispatch);
      }
    }
    this.dependencies.logger.info(
      {
        event: 'whatsapp.delivery-confirmation.expired',
        count: expired.length,
        replayed: replayed.length,
      },
      'Expired unconfirmed WhatsApp submissions require investigation',
    );
    return { expired: expired.length, replayed: replayed.length };
  }
}

export const parseEvolutionDeliveryStatus = (
  value: unknown,
): WhatsAppDeliveryEventStatus | null => {
  if (typeof value === 'number') {
    if (value === 0) return 'ERROR';
    if (value === 1) return 'PENDING';
    if (value === 2) return 'SERVER_ACK';
    if (value === 3) return 'DELIVERY_ACK';
    if (value === 4 || value === 5) return 'READ';
    return null;
  }
  if (typeof value !== 'string') return null;
  switch (value.trim().toUpperCase()) {
    case 'ERROR':
      return 'ERROR';
    case 'PENDING':
      return 'PENDING';
    case 'SERVER_ACK':
      return 'SERVER_ACK';
    case 'DELIVERY_ACK':
      return 'DELIVERY_ACK';
    case 'READ':
    case 'PLAYED':
      return 'READ';
    default:
      return null;
  }
};

export const requireDeliveryEventString = (value: unknown, field: string) => {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 512) {
    throw new AppError(
      'Evento de confirmacao de entrega invalido',
      `WHATSAPP_DELIVERY_EVENT_${field.toUpperCase()}_INVALID`,
    );
  }
  return value.trim();
};

export const parseEvolutionDeliveryOccurredAt = (
  value: unknown,
  fallback: Date,
) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    const milliseconds = value < 1_000_000_000_000 ? value * 1000 : value;
    const parsed = new Date(milliseconds);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return fallback;
};
