import { AppError } from '@shopee-auto-affiliate-ai/shared';
import {
  WHATSAPP_DISPATCH_MANUAL_RECOVERY_CONFIRMATION,
  type CommercialAutomationTarget,
  type WhatsAppDispatchManualRecoveryInput,
  type WhatsAppDispatchManualRecoveryInspection,
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

export type ManualRecoveryCommercialPolicy = {
  evaluateAutomationReadiness(input: {
    excludedExecutionId?: string;
    excludedAmbiguousRunId?: string;
    target: CommercialAutomationTarget;
  }): Promise<{ allowed: boolean; reasons: string[] }>;
};

const assertConfirmation = (confirmation: string) => {
  if (confirmation !== WHATSAPP_DISPATCH_MANUAL_RECOVERY_CONFIRMATION) {
    throw new AppError(
      'Confirmacao humana literal obrigatoria para recovery do dispatch',
      'WHATSAPP_DISPATCH_MANUAL_RECOVERY_CONFIRMATION_REQUIRED',
    );
  }
};

const isAmbiguousRun = (inspection: WhatsAppDispatchManualRecoveryInspection) =>
  inspection.runStatus === 'FAILED' &&
  inspection.runFinalStatus === 'AMBIGUOUS' &&
  inspection.investigationRequired;

const assertRetryProgressIsProven = (
  state: ManualRecoveryJobState,
  attemptsMade: number,
  inspection: WhatsAppDispatchManualRecoveryInspection,
) => {
  if (!inspection.recovery.rearmedAt) return false;
  if (state === 'waiting' || state === 'delayed') {
    return (
      attemptsMade === 1 &&
      inspection.dispatchStatus === 'PENDING' &&
      inspection.attemptCount === 1 &&
      !inspection.externalMessageId &&
      !inspection.sentAt &&
      isAmbiguousRun(inspection)
    );
  }
  if (state === 'active') {
    const dispatchMatches =
      (inspection.dispatchStatus === 'PENDING' && inspection.attemptCount === 1) ||
      (inspection.dispatchStatus === 'PROCESSING' && inspection.attemptCount === 2);
    return dispatchMatches && isAmbiguousRun(inspection);
  }
  if (state === 'completed') {
    return (
      inspection.dispatchStatus === 'SENT' &&
      inspection.attemptCount === 2 &&
      Boolean(inspection.externalMessageId) &&
      Boolean(inspection.sentAt) &&
      inspection.runStatus === 'COMPLETED' &&
      inspection.runFinalStatus === 'SENT' &&
      !inspection.investigationRequired
    );
  }
  if (state === 'failed' && attemptsMade >= 2) {
    const secondAmbiguous =
      inspection.dispatchStatus === 'PROCESSING' &&
      inspection.attemptCount === 2 &&
      isAmbiguousRun(inspection);
    const safeFailure =
      inspection.dispatchStatus === 'FAILED' &&
      inspection.attemptCount === 2 &&
      inspection.runStatus === 'FAILED' &&
      inspection.runFinalStatus === 'FAILED';
    return secondAmbiguous || safeFailure;
  }
  return false;
};


const assertCommercialPolicyAllowsRetry = async (
  policy: ManualRecoveryCommercialPolicy,
  inspection: WhatsAppDispatchManualRecoveryInspection,
) => {
  const status = await policy.evaluateAutomationReadiness({
    excludedExecutionId: inspection.executionId,
    excludedAmbiguousRunId: inspection.runId,
    target: inspection.target,
  });
  if (!status.allowed) {
    throw new AppError(
      `Policy comercial bloqueou manual recovery: ${status.reasons.join(',')}`,
      'WHATSAPP_DISPATCH_MANUAL_RECOVERY_POLICY_BLOCKED',
    );
  }
};

const assertInitialRetryLifecycle = (
  inspection: WhatsAppDispatchManualRecoveryInspection,
) => {
  if (
    inspection.dispatchStatus !== 'PROCESSING' ||
    inspection.attemptCount !== 1 ||
    inspection.externalMessageId ||
    inspection.sentAt ||
    !isAmbiguousRun(inspection)
  ) {
    throw new AppError(
      'Lifecycle nao permite o primeiro retry manual',
      'WHATSAPP_DISPATCH_MANUAL_RECOVERY_LIFECYCLE_NOT_RETRYABLE',
    );
  }
};

export class WhatsAppDispatchManualRecoveryService {
  constructor(
    private readonly repository: WhatsAppDispatchManualRecoveryRepository,
    private readonly queue?: ManualRecoveryQueue,
    private readonly options: { clock?: () => Date; reservationLeaseMs?: number } = {},
    private readonly policy?: ManualRecoveryCommercialPolicy,
  ) {}

  async authorize(input: WhatsAppDispatchManualRecoveryInput) {
    assertConfirmation(input.confirmation);
    const now = this.options.clock?.() ?? new Date();
    return this.repository.authorizeConfirmedNonDelivery({ ...input, authorizedAt: now });
  }

  async requeueAuthorizedRetry(input: WhatsAppDispatchManualRecoveryInput) {
    assertConfirmation(input.confirmation);
    if (!this.queue) {
      throw new AppError(
        'BullMQ e obrigatorio somente para a etapa de requeue',
        'WHATSAPP_DISPATCH_MANUAL_RECOVERY_QUEUE_REQUIRED',
      );
    }
    if (!this.policy) {
      throw new AppError(
        'Policy comercial e obrigatoria para a etapa de requeue',
        'WHATSAPP_DISPATCH_MANUAL_RECOVERY_POLICY_REQUIRED',
      );
    }
    const now = this.options.clock?.() ?? new Date();
    const leaseMs = this.options.reservationLeaseMs ?? 120_000;
    let inspection = await this.repository.inspectAuthorizedRecovery(input);

    const job = await this.queue.getJob(inspection.jobId);
    if (!job || job.id !== inspection.jobId) {
      throw new AppError(
        'Job BullMQ deterministico nao encontrado para recovery',
        'WHATSAPP_DISPATCH_MANUAL_RECOVERY_JOB_MISSING',
      );
    }
    const equivalentJobIds = await this.queue.findEquivalentJobIds(inspection.dispatchId);
    const foreignEquivalentJobIds = [...new Set(equivalentJobIds)].filter(
      (jobId) => jobId !== inspection.jobId,
    );
    if (foreignEquivalentJobIds.length > 0) {
      throw new AppError(
        'Existe outro job BullMQ equivalente para o mesmo dispatch',
        'WHATSAPP_DISPATCH_MANUAL_RECOVERY_EQUIVALENT_JOB_CONFLICT',
      );
    }

    let state = await job.getState();
    let attemptsMade = job.attemptsMade;
    const existingRetryIsProven = assertRetryProgressIsProven(
      state,
      attemptsMade,
      inspection,
    );

    if (inspection.recovery.requeuedAt) {
      if (existingRetryIsProven) {
        return { kind: 'ALREADY_REQUEUED' as const, state, attemptsMade, context: inspection };
      }
      throw new AppError(
        'Recovery marcado como requeued sem evidencia coerente do retry',
        'WHATSAPP_DISPATCH_MANUAL_RECOVERY_QUEUE_STATE_CONFLICT',
      );
    }

    if (existingRetryIsProven) {
      const recovery = await this.repository.markManualRecoveryRequeued({
        dispatchId: input.dispatchId,
        requeuedAt: now,
      });
      return {
        kind: 'CONVERGED_AFTER_RESTART' as const,
        state,
        attemptsMade,
        context: { ...inspection, recovery },
      };
    }

    if (state !== 'failed' || attemptsMade !== 1) {
      throw new AppError(
        'Job BullMQ nao esta no estado failed da primeira tentativa',
        'WHATSAPP_DISPATCH_MANUAL_RECOVERY_JOB_NOT_RETRYABLE',
      );
    }

    await assertCommercialPolicyAllowsRetry(this.policy, inspection);

    if (!inspection.recovery.rearmedAt) {
      assertInitialRetryLifecycle(inspection);
      await this.repository.rearmAuthorizedRetry({
        ...input,
        checkedAt: now,
        leaseExpiresAt: new Date(now.getTime() + leaseMs),
      });
      inspection = await this.repository.inspectAuthorizedRecovery(input);
    } else if (
      inspection.dispatchStatus !== 'PENDING' ||
      inspection.attemptCount !== 1 ||
      !isAmbiguousRun(inspection)
    ) {
      throw new AppError(
        'Recovery rearmado nao esta pronto para job.retry()',
        'WHATSAPP_DISPATCH_MANUAL_RECOVERY_REARM_STATE_CONFLICT',
      );
    }

    await assertCommercialPolicyAllowsRetry(this.policy, inspection);

    try {
      await job.retry();
    } catch (error) {
      state = await job.getState();
      attemptsMade = job.attemptsMade;
      inspection = await this.repository.inspectAuthorizedRecovery(input);
      if (!assertRetryProgressIsProven(state, attemptsMade, inspection)) throw error;
    }

    state = await job.getState();
    attemptsMade = job.attemptsMade;
    inspection = await this.repository.inspectAuthorizedRecovery(input);
    if (!assertRetryProgressIsProven(state, attemptsMade, inspection)) {
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
      context: { ...inspection, recovery },
    };
  }
}
