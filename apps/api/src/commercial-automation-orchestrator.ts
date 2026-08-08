import { randomUUID } from 'node:crypto';
import { AppError } from '@shopee-auto-affiliate-ai/shared';

import {
  COMMERCIAL_CONFIRMATION_TOKEN,
  type CommercialPipelineConfirmationService,
} from './commercial-pipeline-confirmation-service';
import {
  COMMERCIAL_EXECUTION_IN_PROGRESS,
  STALE_COMMERCIAL_EXECUTION_EXISTS,
  type CommercialAutomationPolicyService,
} from './commercial-automation-policy-service';
import {
  toCommercialAutomationProviderSource,
  COMMERCIAL_EXECUTION_OWNERSHIP_LOST,
  isCommercialAutomationExecutionStale,
  toPersistedCommercialAutomationMode,
  toPublicCommercialAutomationMode,
  toPublicCommercialAutomationStatus,
  type CommercialAutomationMode,
  type CommercialAutomationProvider,
  type CommercialAutomationPublicStatus,
} from './commercial-automation-execution-domain';
import type { CommercialPipelineService } from './commercial-pipeline-service';
import type {
  CommercialAutomationExecutionRecord,
  CommercialAutomationExecutionOwnership,
  CommercialAutomationExecutionRepository,
  CommercialPipelineRunRepository,
} from './repositories';

export const COMMERCIAL_AUTOMATION_OFFICIAL_PROVIDER_REQUIRED =
  'COMMERCIAL_AUTOMATION_OFFICIAL_PROVIDER_REQUIRED';
export const COMMERCIAL_AUTOMATION_CANDIDATE_FLOW_REQUIRED =
  'COMMERCIAL_AUTOMATION_CANDIDATE_FLOW_REQUIRED';

export type { CommercialAutomationMode, CommercialAutomationProvider };

type CommercialAutomationLogger = {
  info: (obj: unknown, message?: string) => void;
  error: (obj: unknown, message?: string) => void;
};

export type CommercialAutomationTickResult = {
  executionId: string;
  mode: CommercialAutomationMode;
  status: CommercialAutomationPublicStatus;
  reasons: string[];
  commercialRunId: string | null;
  dispatchCreated: boolean;
  whatsappJobCreated: boolean;
  messageSent: false;
};

const publicResult = (
  execution: CommercialAutomationExecutionRecord,
): CommercialAutomationTickResult => ({
  executionId: execution.id,
  mode: toPublicCommercialAutomationMode(execution.mode),
  status: toPublicCommercialAutomationStatus(execution.status),
  reasons: execution.reasons,
  commercialRunId: execution.commercialRunId,
  dispatchCreated: execution.status === 'QUEUED',
  whatsappJobCreated: execution.status === 'QUEUED',
  messageSent: false,
});

const safeFailureCode = (error: unknown) =>
  error instanceof AppError ? error.code : 'COMMERCIAL_AUTOMATION_TICK_FAILED';

const isOwnershipLost = (error: unknown) =>
  error instanceof AppError &&
  error.code === COMMERCIAL_EXECUTION_OWNERSHIP_LOST;

const addMilliseconds = (date: Date, milliseconds: number) =>
  new Date(date.getTime() + milliseconds);

const createHeartbeatController = (input: {
  executions: CommercialAutomationExecutionRepository;
  ownership: CommercialAutomationExecutionOwnership;
  clock: () => Date;
  leaseMilliseconds: number;
  heartbeatMilliseconds: number;
}) => {
  let stopped = false;
  let ownershipError: unknown;
  let pending: Promise<void> | undefined;

  const renew = async () => {
    if (stopped || ownershipError) return;
    const heartbeatAt = input.clock();
    try {
      await input.executions.heartbeat(input.ownership, {
        heartbeatAt,
        leaseExpiresAt: addMilliseconds(heartbeatAt, input.leaseMilliseconds),
      });
    } catch (error) {
      ownershipError = error;
      stopped = true;
      clearInterval(timer);
    }
  };
  const queueRenewal = () => {
    if (pending) return pending;
    pending = renew().finally(() => {
      pending = undefined;
    });
    return pending;
  };
  const timer = setInterval(
    () => void queueRenewal(),
    input.heartbeatMilliseconds,
  );

  return {
    async checkpoint() {
      await queueRenewal();
      if (ownershipError) throw ownershipError;
    },
    async stop() {
      stopped = true;
      clearInterval(timer);
      await pending;
    },
  };
};

export class CommercialAutomationOrchestrator {
  private readonly clock: () => Date;

  constructor(
    private readonly dependencies: {
      policy: Pick<
        CommercialAutomationPolicyService,
        'evaluateAutomationReadiness'
      >;
      syncOffers: { run(): Promise<unknown> };
      pipeline: Pick<CommercialPipelineService, 'dryRun'>;
      candidateFlow?: {
        prepare(): Promise<{
          runId: string;
          generatedCopyId: string;
          candidateId: string;
          campaignId: string;
          groupId: string;
        }>;
        revalidate(input: {
          candidateId: string;
          generatedCopyId: string;
          campaignId: string;
          groupId: string;
        }): Promise<void>;
      };
      confirmation: Pick<CommercialPipelineConfirmationService, 'confirm'>;
      commercialRuns: Pick<CommercialPipelineRunRepository, 'findById'>;
      executions: CommercialAutomationExecutionRepository;
      logger: CommercialAutomationLogger;
      clock?: () => Date;
      leaseSeconds: number;
      heartbeatSeconds: number;
      ownerIdFactory?: () => string;
    },
  ) {
    this.clock = dependencies.clock ?? (() => new Date());
  }

  async executeTick(input: {
    schedulerJobId: string;
    bullMqJobId?: string;
    mode: CommercialAutomationMode;
    provider: CommercialAutomationProvider;
  }): Promise<CommercialAutomationTickResult> {
    const mode = toPersistedCommercialAutomationMode(input.mode);
    const startedAt = this.clock();
    const ownerId = (this.dependencies.ownerIdFactory ?? randomUUID)();
    const started = await this.dependencies.executions.start({
      schedulerJobId: input.schedulerJobId,
      bullMqJobId: input.bullMqJobId,
      mode,
      startedAt,
      ownerId,
      heartbeatAt: startedAt,
      leaseExpiresAt: addMilliseconds(
        startedAt,
        this.dependencies.leaseSeconds * 1000,
      ),
    });
    if (started.outcome === 'existing') {
      if (started.execution.status === 'STARTED') {
        const stale = isCommercialAutomationExecutionStale(
          started.execution,
          startedAt,
        );
        throw new AppError(
          stale
            ? 'Execucao comercial anterior exige recuperacao manual'
            : 'Execucao comercial anterior permanece em andamento',
          stale
            ? STALE_COMMERCIAL_EXECUTION_EXISTS
            : COMMERCIAL_EXECUTION_IN_PROGRESS,
        );
      }
      return publicResult(started.execution);
    }
    if (started.outcome === 'concurrent') {
      return publicResult(
        await this.dependencies.executions.createBlocked({
          schedulerJobId: input.schedulerJobId,
          bullMqJobId: input.bullMqJobId,
          mode,
          reasons: [
            started.stale
              ? STALE_COMMERCIAL_EXECUTION_EXISTS
              : COMMERCIAL_EXECUTION_IN_PROGRESS,
          ],
          completedAt: this.clock(),
        }),
      );
    }

    const execution = started.execution;
    const ownership = started.ownership;
    const heartbeat = createHeartbeatController({
      executions: this.dependencies.executions,
      ownership,
      clock: this.clock,
      leaseMilliseconds: this.dependencies.leaseSeconds * 1000,
      heartbeatMilliseconds: this.dependencies.heartbeatSeconds * 1000,
    });
    const finish = async (
      data: Parameters<CommercialAutomationExecutionRepository['finish']>[1],
    ) => {
      await heartbeat.stop();
      return this.dependencies.executions.finish(ownership, data);
    };
    let commercialRunId: string | undefined;
    let existingGeneratedCopyId: string | undefined;
    let candidatePreparation:
      | {
          candidateId: string;
          generatedCopyId: string;
          campaignId: string;
          groupId: string;
        }
      | undefined;
    let confirmationAttempted = false;
    try {
      const readiness =
        await this.dependencies.policy.evaluateAutomationReadiness({
          excludedExecutionId: execution.id,
        });
      if (!readiness.allowed) {
        return publicResult(
          await finish({
            status: 'BLOCKED',
            reasons: readiness.reasons,
            completedAt: this.clock(),
          }),
        );
      }
      if (input.mode === 'send' && input.provider !== 'official') {
        return publicResult(
          await finish({
            status: 'BLOCKED',
            reasons: [COMMERCIAL_AUTOMATION_OFFICIAL_PROVIDER_REQUIRED],
            failureCode: COMMERCIAL_AUTOMATION_OFFICIAL_PROVIDER_REQUIRED,
            completedAt: this.clock(),
          }),
        );
      }

      await heartbeat.checkpoint();
      if (input.mode === 'send' && !this.dependencies.candidateFlow) {
        return publicResult(
          await finish({
            status: 'BLOCKED',
            reasons: [COMMERCIAL_AUTOMATION_CANDIDATE_FLOW_REQUIRED],
            failureCode: COMMERCIAL_AUTOMATION_CANDIDATE_FLOW_REQUIRED,
            completedAt: this.clock(),
          }),
        );
      }
      await this.dependencies.syncOffers.run();
      await heartbeat.checkpoint();
      if (input.mode === 'send') {
        const prepared = await this.dependencies.candidateFlow!.prepare();
        commercialRunId = prepared.runId;
        existingGeneratedCopyId = prepared.generatedCopyId;
        candidatePreparation = prepared;
      } else {
        const dryRun = await this.dependencies.pipeline.dryRun({
          source: toCommercialAutomationProviderSource(input.provider),
          campaign: 'commercial-automation',
        });
        commercialRunId = dryRun.runId;
      }
      if (input.mode === 'preview') {
        return publicResult(
          await finish({
            status: 'PREVIEW_READY',
            commercialRunId,
            completedAt: this.clock(),
          }),
        );
      }

      const confirmationReadiness =
        await this.dependencies.policy.evaluateAutomationReadiness({
          excludedExecutionId: execution.id,
        });
      if (!confirmationReadiness.allowed) {
        return publicResult(
          await finish({
            status: 'BLOCKED',
            reasons: confirmationReadiness.reasons,
            commercialRunId,
            completedAt: this.clock(),
          }),
        );
      }

      await heartbeat.checkpoint();
      if (candidatePreparation) {
        await this.dependencies.candidateFlow!.revalidate(candidatePreparation);
      }
      confirmationAttempted = true;
      await this.dependencies.confirmation.confirm(
        commercialRunId,
        COMMERCIAL_CONFIRMATION_TOKEN,
        existingGeneratedCopyId
          ? { existingGeneratedCopyId }
          : undefined,
      );
      return publicResult(
        await finish({
          status: 'QUEUED',
          commercialRunId,
          completedAt: this.clock(),
        }),
      );
    } catch (error) {
      if (isOwnershipLost(error)) throw error;
      const failureCode = safeFailureCode(error);
      let status: 'FAILED' | 'AMBIGUOUS' = 'FAILED';
      if (confirmationAttempted && commercialRunId) {
        try {
          const run =
            await this.dependencies.commercialRuns.findById(commercialRunId);
          if (
            !run ||
            run.investigationRequired ||
            run.finalStatus === 'AMBIGUOUS' ||
            run.finalStatus === 'PENDING'
          ) {
            status = 'AMBIGUOUS';
          }
        } catch {
          status = 'AMBIGUOUS';
        }
      }
      this.dependencies.logger.error(
        {
          event: 'commercial-automation.tick.failed',
          executionId: execution.id,
          failureCode,
          status,
        },
        'Commercial automation tick failed',
      );
      return publicResult(
        await finish({
          status,
          commercialRunId,
          failureCode,
          completedAt: this.clock(),
        }),
      );
    } finally {
      await heartbeat.stop();
      this.dependencies.logger.info(
        {
          event: 'commercial-automation.tick.finished',
          executionId: execution.id,
          mode: input.mode,
        },
        'Commercial automation tick finished',
      );
    }
  }
}
