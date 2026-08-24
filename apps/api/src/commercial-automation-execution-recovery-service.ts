import { loadConfig } from '@shopee-auto-affiliate-ai/config';
import { AppError } from '@shopee-auto-affiliate-ai/shared';

import { isCommercialAutomationExecutionStale } from './commercial-automation-execution-domain';
import { sanitizeCommercialAutomationExecution } from './commercial-automation-execution-service';
import {
  assertActiveCommercialInstance,
  assertCommercialStickyIdentity,
} from './commercial-instance-stickiness';
import type {
  CommercialAutomationExecutionRecord,
  CommercialAutomationExecutionRecoveryContext,
  CommercialAutomationExecutionRepository,
  WhatsAppInstanceRepository,
} from './repositories';

export const COMMERCIAL_EXECUTION_ABANDONED_SAFE =
  'COMMERCIAL_EXECUTION_ABANDONED_SAFE';
export const COMMERCIAL_EXECUTION_PREMARKER_RESERVATION_ABANDONED =
  'COMMERCIAL_EXECUTION_PREMARKER_RESERVATION_ABANDONED';
export const COMMERCIAL_OUTBOX_RECONCILIATION_REQUIRED =
  'COMMERCIAL_OUTBOX_RECONCILIATION_REQUIRED';
export const COMMERCIAL_EXECUTION_RECOVERY_AMBIGUOUS =
  'COMMERCIAL_EXECUTION_RECOVERY_AMBIGUOUS';
export const COMMERCIAL_EXECUTION_DISPATCH_FAILED =
  'COMMERCIAL_EXECUTION_DISPATCH_FAILED';

type RecoveryDecision = {
  status: 'QUEUED' | 'FAILED' | 'AMBIGUOUS';
  failureCode?: string;
};

type CommercialDispatchJobEvidence = {
  id: string;
  dispatchId: string;
  instanceName?: string | null;
};

const baseIdentitiesAreConsistent = (
  context: CommercialAutomationExecutionRecoveryContext,
) => {
  const { execution, run } = context;
  if (!run || !run.dispatch || !run.outbox) return false;
  return (
    execution.commercialRunId === run.id &&
    run.dispatchId === run.dispatch.id &&
    run.dispatchId === run.outbox.dispatchId &&
    run.id === run.outbox.commercialRunId &&
    (run.jobId === null || run.jobId === run.outbox.jobId)
  );
};

export class CommercialAutomationExecutionRecoveryService {
  private readonly clock: () => Date;
  private readonly minimumIntervalMinutes: number;

  constructor(
    private readonly dependencies: {
      executions: CommercialAutomationExecutionRepository;
      jobs: {
        findJob(jobId: string): Promise<CommercialDispatchJobEvidence | null>;
      };
      instances?: Pick<WhatsAppInstanceRepository, 'findByName'>;
      clock?: () => Date;
      minimumIntervalMinutes?: number;
    },
  ) {
    this.clock = dependencies.clock ?? (() => new Date());
    this.minimumIntervalMinutes =
      dependencies.minimumIntervalMinutes ??
      loadConfig().COMMERCIAL_MIN_INTERVAL_MINUTES;
  }

  async recover(executionId: string) {
    const now = this.clock();
    const context =
      await this.dependencies.executions.findRecoveryContext(executionId);
    if (!context) {
      throw new AppError(
        'Execucao da automacao comercial nao encontrada',
        'COMMERCIAL_AUTOMATION_EXECUTION_NOT_FOUND',
      );
    }
    if (context.execution.status !== 'STARTED') {
      return this.result('already-terminal', context.execution, now);
    }
    if (!isCommercialAutomationExecutionStale(context.execution, now)) {
      throw new AppError(
        'Execucao comercial ainda possui lease valida',
        'COMMERCIAL_EXECUTION_NOT_STALE',
      );
    }

    if (
      context.execution.externalStage === 'NOT_REACHED' &&
      context.execution.commercialRunId === null
    ) {
      const recoverPreMarkerReservation =
        this.dependencies.executions.recoverStalePreMarkerReservation;
      if (!recoverPreMarkerReservation) {
        return {
          outcome: 'investigation-required' as const,
          reason: 'PREMARKER_RECOVERY_CONTRACT_UNAVAILABLE' as const,
          execution: sanitizeCommercialAutomationExecution(
            context.execution,
            now,
          ),
        };
      }
      const safeRecovery =
        await recoverPreMarkerReservation.call(
          this.dependencies.executions,
          executionId,
          {
            completedAt: now,
            minimumIntervalMinutes: this.minimumIntervalMinutes,
            failureCode:
              COMMERCIAL_EXECUTION_PREMARKER_RESERVATION_ABANDONED,
          },
        );
      if (safeRecovery.outcome === 'RECOVERED') {
        return this.result('recovered', safeRecovery.execution, now);
      }
      if (safeRecovery.outcome === 'ALREADY_RECOVERED') {
        return this.result('already-terminal', safeRecovery.execution, now);
      }
      return {
        outcome: 'investigation-required' as const,
        reason: safeRecovery.reason,
        execution: sanitizeCommercialAutomationExecution(
          context.execution,
          now,
        ),
      };
    }

    if (this.isSafeDryRunWithoutExternalEvidence(context)) {
      const recoverPreConfirmationReservation =
        this.dependencies.executions.recoverStalePreConfirmationReservation;
      if (!recoverPreConfirmationReservation) {
        return {
          outcome: 'investigation-required' as const,
          reason: 'PRECONFIRMATION_RECOVERY_CONTRACT_UNAVAILABLE' as const,
          execution: sanitizeCommercialAutomationExecution(
            context.execution,
            now,
          ),
        };
      }
      const safeRecovery = await recoverPreConfirmationReservation.call(
        this.dependencies.executions,
        executionId,
        {
          completedAt: now,
          failureCode: COMMERCIAL_EXECUTION_ABANDONED_SAFE,
        },
      );
      if (safeRecovery.outcome === 'RECOVERED') {
        return this.result('recovered', safeRecovery.execution, now);
      }
      if (safeRecovery.outcome === 'ALREADY_RECOVERED') {
        return this.result('already-terminal', safeRecovery.execution, now);
      }
      return {
        outcome: 'investigation-required' as const,
        reason: safeRecovery.reason,
        execution: sanitizeCommercialAutomationExecution(
          context.execution,
          now,
        ),
      };
    }

    const stickyJob = await this.validateStickyIdentity(context);
    const decision = await this.classify(context, stickyJob);
    const recovered = await this.dependencies.executions.recoverStale(
      executionId,
      { ...decision, completedAt: now },
    );
    return this.result('recovered', recovered, now);
  }

  private async classify(
    context: CommercialAutomationExecutionRecoveryContext,
    stickyJob?: CommercialDispatchJobEvidence | null,
  ): Promise<RecoveryDecision> {
    const { execution, run } = context;
    if (!execution.commercialRunId) {
      if (execution.externalStage === 'EXTERNAL_MAY_HAVE_STARTED') {
        return this.ambiguous();
      }
      return {
        status: 'FAILED',
        failureCode: COMMERCIAL_EXECUTION_ABANDONED_SAFE,
      };
    }
    if (!run) return this.ambiguous();
    if (
      run.finalStatus === 'AMBIGUOUS' ||
      run.investigationRequired ||
      run.outbox?.status === 'AMBIGUOUS' ||
      run.dispatch?.status === 'PROCESSING'
    ) {
      return this.ambiguous();
    }
    if (run.finalStatus === 'SENT' || run.dispatch?.status === 'SENT') {
      return { status: 'QUEUED' };
    }
    if (run.dispatch?.status === 'FAILED') {
      return {
        status: 'FAILED',
        failureCode: COMMERCIAL_EXECUTION_DISPATCH_FAILED,
      };
    }
    if (run.mode === 'DRY_RUN') {
      return !run.dispatchId && !run.jobId && !run.dispatch && !run.outbox
        ? {
            status: 'FAILED',
            failureCode: COMMERCIAL_EXECUTION_ABANDONED_SAFE,
          }
        : this.ambiguous();
    }
    if (!baseIdentitiesAreConsistent(context)) return this.ambiguous();
    if (run.dispatch!.attemptCount > 0) return this.ambiguous();
    if (run.outbox!.status === 'PUBLISHED' && run.jobId !== run.outbox!.jobId) {
      return this.ambiguous();
    }
    let job: CommercialDispatchJobEvidence | null = stickyJob ?? null;
    try {
      job ??= await this.dependencies.jobs.findJob(run.outbox!.jobId);
    } catch {
      return this.ambiguous();
    }
    const jobMatches =
      job?.id === run.outbox!.jobId &&
      job.dispatchId === run.outbox!.dispatchId &&
      this.jobHasExpectedStickyInstance(context, job);
    if (run.outbox!.status === 'PENDING') {
      if (job && !jobMatches) return this.ambiguous();
      throw new AppError(
        'Outbox comercial deve ser reconciliado antes da execucao',
        COMMERCIAL_OUTBOX_RECONCILIATION_REQUIRED,
      );
    }
    return jobMatches ? { status: 'QUEUED' } : this.ambiguous();
  }

  private async validateStickyIdentity(
    context: CommercialAutomationExecutionRecoveryContext,
  ) {
    const run = context.run;
    if (!run) return null;
    if (
      run.mode === 'DRY_RUN' &&
      !run.dispatchId &&
      !run.jobId &&
      !run.dispatch &&
      !run.outbox
    ) {
      return null;
    }
    if (run.outbox?.status === 'PENDING' && !run.jobId) {
      const identity = assertCommercialStickyIdentity(
        {
          runInstanceName: run.instanceName,
          dispatchInstanceName: run.dispatch?.instanceName,
          outboxInstanceName: run.outbox.instanceName,
          destinationAssignedInstanceName:
            run.dispatch?.destinationAssignedInstanceName,
        },
        { allowMissingJob: true },
      );
      if (identity) {
        let job: CommercialDispatchJobEvidence | null;
        try {
          job = await this.dependencies.jobs.findJob(run.outbox.jobId);
        } catch {
          throw new AppError(
            'Job comercial nao pode validar identidade sticky',
            'COMMERCIAL_INSTANCE_LIFECYCLE_MISMATCH',
          );
        }
        if (job && (job.instanceName ?? null) !== identity) {
          throw new AppError(
            'Job comercial diverge da identidade sticky persistida',
            'COMMERCIAL_INSTANCE_LIFECYCLE_MISMATCH',
          );
        }
      }
      return null;
    }
    const persistedIdentity = assertCommercialStickyIdentity({
      runInstanceName: run.instanceName,
      dispatchInstanceName: run.dispatch?.instanceName,
      outboxInstanceName: run.outbox?.instanceName,
      destinationAssignedInstanceName:
        run.dispatch?.destinationAssignedInstanceName,
    });
    if (persistedIdentity === null) return null;
    if (!run.dispatch || !run.outbox || !run.jobId) {
      throw new AppError(
        'Lifecycle comercial sticky esta incompleto para recovery',
        'COMMERCIAL_INSTANCE_LIFECYCLE_MISMATCH',
      );
    }
    let job: CommercialDispatchJobEvidence | null;
    try {
      job = await this.dependencies.jobs.findJob(run.outbox.jobId);
    } catch {
      throw new AppError(
        'Job comercial nao pode validar identidade sticky',
        'COMMERCIAL_INSTANCE_LIFECYCLE_MISMATCH',
      );
    }
    const identity = assertCommercialStickyIdentity({
      runInstanceName: run.instanceName,
      dispatchInstanceName: run.dispatch.instanceName,
      outboxInstanceName: run.outbox.instanceName,
      jobInstanceName: job?.instanceName,
      destinationAssignedInstanceName:
        run.dispatch.destinationAssignedInstanceName,
    });
    if (!identity) return null;
    await assertActiveCommercialInstance(this.dependencies.instances, identity);
    if (
      !job ||
      job.id !== run.outbox.jobId ||
      job.dispatchId !== run.outbox.dispatchId ||
      (job.instanceName ?? null) !== identity
    ) {
      throw new AppError(
        'Job comercial diverge da identidade sticky persistida',
        'COMMERCIAL_INSTANCE_LIFECYCLE_MISMATCH',
      );
    }
    return job;
  }

  private isSafeDryRunWithoutExternalEvidence(
    context: CommercialAutomationExecutionRecoveryContext,
  ) {
    const { execution, run } = context;
    return Boolean(
      run &&
        run.mode === 'DRY_RUN' &&
        execution.commercialRunId === run.id &&
        !run.dispatchId &&
        !run.jobId &&
        !run.dispatch &&
        !run.outbox,
    );
  }

  private jobHasExpectedStickyInstance(
    context: CommercialAutomationExecutionRecoveryContext,
    job: CommercialDispatchJobEvidence,
  ) {
    const run = context.run;
    if (!run) return false;
    const identity = assertCommercialStickyIdentity(
      {
        runInstanceName: run.instanceName,
        dispatchInstanceName: run.dispatch?.instanceName,
        outboxInstanceName: run.outbox?.instanceName,
        destinationAssignedInstanceName:
          run.dispatch?.destinationAssignedInstanceName,
        jobInstanceName: job.instanceName,
      },
      { allowMissingJob: true },
    );
    return identity === null || (job.instanceName ?? null) === identity;
  }

  private ambiguous(): RecoveryDecision {
    return {
      status: 'AMBIGUOUS',
      failureCode: COMMERCIAL_EXECUTION_RECOVERY_AMBIGUOUS,
    };
  }

  private result(
    outcome: 'recovered' | 'already-terminal',
    execution: CommercialAutomationExecutionRecord,
    now: Date,
  ) {
    return {
      outcome,
      execution: sanitizeCommercialAutomationExecution(execution, now),
    };
  }
}
