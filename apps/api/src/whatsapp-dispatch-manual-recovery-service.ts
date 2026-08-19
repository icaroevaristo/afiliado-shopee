import { AppError } from '@shopee-auto-affiliate-ai/shared';
import {
  WHATSAPP_DISPATCH_MANUAL_RECOVERY_CONFIRMATION,
  type WhatsAppDispatchManualRecoveryInput,
  type WhatsAppDispatchManualRecoveryRepository,
} from './repositories';

export type ManualRecoveryJobState =
  | 'failed'
  | 'waiting'
  | 'active'
  | 'delayed'
  | 'completed'
  | 'paused'
  | 'unknown';

export type ManualRecoveryQueueJob = {
  id: string;
  attemptsMade: number;
  getState(): Promise<ManualRecoveryJobState>;
  retry(): Promise<void>;
};

export type ManualRecoveryQueue = {
  getJob(jobId: string): Promise<ManualRecoveryQueueJob | null>;
  findEquivalentJobIds(dispatchId: string): Promise<string[]>;
};

const assertConfirmation = (confirmation: string) => {
  if (confirmation !== WHATSAPP_DISPATCH_MANUAL_RECOVERY_CONFIRMATION) {
    throw new AppError(
      'Confirmacao humana literal obrigatoria para recovery do dispatch',
      'WHATSAPP_DISPATCH_MANUAL_RECOVERY_CONFIRMATION_REQUIRED',
    );
  }
};

const isEvidenceOfExistingRetry = (
  state: ManualRecoveryJobState,
  attemptsMade: number,
) =>
  state === 'waiting' ||
  state === 'active' ||
  state === 'delayed' ||
  state === 'completed' ||
  (state === 'failed' && attemptsMade >= 2);

export class WhatsAppDispatchManualRecoveryService {
  constructor(
    private readonly repository: WhatsAppDispatchManualRecoveryRepository,
    private readonly queue: ManualRecoveryQueue,
    private readonly options: {
      clock?: () => Date;
      reservationLeaseMs?: number;
    } = {},
  ) {}

  async authorizeAndRearm(input: WhatsAppDispatchManualRecoveryInput) {
    assertConfirmation(input.confirmation);
    const now = this.options.clock?.() ?? new Date();
    return this.repository.rearmAfterConfirmedNonDelivery({
      ...input,
      authorizedAt: now,
    });
  }

  async requeueAuthorizedRetry(input: WhatsAppDispatchManualRecoveryInput) {
    assertConfirmation(input.confirmation);
    const now = this.options.clock?.() ?? new Date();
    const leaseMs = this.options.reservationLeaseMs ?? 120_000;
    const context = await this.repository.prepareManualRecoveryRequeue({
      ...input,
      checkedAt: now,
      leaseExpiresAt: new Date(now.getTime() + leaseMs),
    });

    const job = await this.queue.getJob(context.jobId);
    if (!job || job.id !== context.jobId) {
      throw new AppError(
        'Job BullMQ deterministico nao encontrado para recovery',
        'WHATSAPP_DISPATCH_MANUAL_RECOVERY_JOB_MISSING',
      );
    }

    const equivalentJobIds = await this.queue.findEquivalentJobIds(
      context.dispatchId,
    );
    const foreignEquivalentJobIds = [...new Set(equivalentJobIds)].filter(
      (jobId) => jobId !== context.jobId,
    );
    if (foreignEquivalentJobIds.length > 0) {
      throw new AppError(
        'Existe outro job BullMQ equivalente para o mesmo dispatch',
        'WHATSAPP_DISPATCH_MANUAL_RECOVERY_EQUIVALENT_JOB_CONFLICT',
      );
    }

    let state = await job.getState();
    let attemptsMade = job.attemptsMade;

    if (context.recovery.requeuedAt) {
      if (isEvidenceOfExistingRetry(state, attemptsMade)) {
        return {
          kind: 'ALREADY_REQUEUED' as const,
          state,
          attemptsMade,
          context,
        };
      }
      throw new AppError(
        'Recovery ja marcado como requeued sem evidencia de retry no BullMQ',
        'WHATSAPP_DISPATCH_MANUAL_RECOVERY_QUEUE_STATE_CONFLICT',
      );
    }

    if (isEvidenceOfExistingRetry(state, attemptsMade)) {
      const recovery = await this.repository.markManualRecoveryRequeued({
        dispatchId: input.dispatchId,
        requeuedAt: now,
      });
      return {
        kind: 'CONVERGED_AFTER_RESTART' as const,
        state,
        attemptsMade,
        context: { ...context, recovery },
      };
    }

    if (state !== 'failed' || attemptsMade !== 1) {
      throw new AppError(
        'Job BullMQ nao esta no estado failed da primeira tentativa',
        'WHATSAPP_DISPATCH_MANUAL_RECOVERY_JOB_NOT_RETRYABLE',
      );
    }

    try {
      await job.retry();
    } catch (error) {
      state = await job.getState();
      attemptsMade = job.attemptsMade;
      if (!isEvidenceOfExistingRetry(state, attemptsMade)) throw error;
    }

    state = await job.getState();
    attemptsMade = job.attemptsMade;
    if (!isEvidenceOfExistingRetry(state, attemptsMade)) {
      throw new AppError(
        'BullMQ retry nao convergiu para estado observavel seguro',
        'WHATSAPP_DISPATCH_MANUAL_RECOVERY_REQUEUE_UNCERTAIN',
      );
    }

    const recovery = await this.repository.markManualRecoveryRequeued({
      dispatchId: input.dispatchId,
      requeuedAt: now,
    });
    return {
      kind: 'REQUEUED' as const,
      state,
      attemptsMade,
      context: { ...context, recovery },
    };
  }
}
