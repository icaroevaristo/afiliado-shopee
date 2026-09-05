import { randomUUID } from 'node:crypto';
import { AppError } from '@shopee-auto-affiliate-ai/shared';
import type { CommercialAutomationTargetConstraint } from '@shopee-auto-affiliate-ai/queue';

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
import type {
  CommercialAutomationCandidateSelection,
  CommercialAutomationCandidatePreflight,
  CommercialAutomationCandidateAttemptReservationResult,
} from './commercial-automation-candidate-flow-service';
import type { CommercialPromotionMiningReport } from './commercial-promotion-mining-service';
import type { CommercialPipelineService } from './commercial-pipeline-service';
import { isCommercialInstanceAssigned } from './commercial-instance-stickiness';
import type {
  CommercialAutomationTarget,
  CommercialGroupCampaignAttemptRelease,
  CommercialGroupCampaignAttemptRenewal,
  CommercialAutomationExecutionRecord,
  CommercialAutomationExecutionOwnership,
  CommercialAutomationExecutionRepository,
  CommercialPipelineRunRepository,
} from './repositories';

type CommercialAutomationOfferSyncReport = {
  hasNextPage?: boolean;
  page?: number;
  nextCursor?: string;
};

export const COMMERCIAL_AUTOMATION_OFFICIAL_PROVIDER_REQUIRED =
  'COMMERCIAL_AUTOMATION_OFFICIAL_PROVIDER_REQUIRED';
export const COMMERCIAL_AUTOMATION_CANDIDATE_FLOW_REQUIRED =
  'COMMERCIAL_AUTOMATION_CANDIDATE_FLOW_REQUIRED';
export const COMMERCIAL_AUTOMATION_NO_ELIGIBLE_CANDIDATE =
  'COMMERCIAL_AUTOMATION_NO_ELIGIBLE_CANDIDATE';
export const COMMERCIAL_AUTOMATION_TARGET_ATTEMPT_RESERVED =
  'COMMERCIAL_AUTOMATION_TARGET_ATTEMPT_RESERVED';
export const COMMERCIAL_AUTOMATION_TARGET_BACKOFF =
  'COMMERCIAL_AUTOMATION_TARGET_BACKOFF';
export const COMMERCIAL_AUTOMATION_EXECUTION_LEASE_INVALID =
  'COMMERCIAL_AUTOMATION_EXECUTION_LEASE_INVALID';
export const COMMERCIAL_AUTOMATION_SCHEDULED_SLOT_NOT_DUE =
  'COMMERCIAL_AUTOMATION_SCHEDULED_SLOT_NOT_DUE';

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
      syncOffers: {
        run(
          input?: { page?: number; cursor?: string },
        ): Promise<CommercialAutomationOfferSyncReport>;
      };
      pipeline: Pick<CommercialPipelineService, 'dryRun'>;
      candidateFlow?: {
        listTargets(): Promise<CommercialAutomationTarget[]>;
        preflight(
          target: CommercialAutomationTarget,
        ): Promise<CommercialAutomationCandidatePreflight>;
        replenish(
          target: CommercialAutomationTarget,
        ): Promise<
          Pick<CommercialPromotionMiningReport, 'rejectionSummary'>
        >;
        prepare(
          selection: CommercialAutomationCandidateSelection,
          options: {
            executionId: string;
            miningReport?: Pick<
            CommercialPromotionMiningReport,
            'rejectionSummary'
            >;
          },
        ): Promise<{
          runId: string;
          generatedCopyId: string;
          candidateId: string;
          campaignId: string;
          groupId: string;
          logicalGroupFingerprint?: string;
          nicheId?: string;
        }>;
        revalidate(input: {
          candidateId: string;
          generatedCopyId: string;
          campaignId: string;
          groupId: string;
          logicalGroupFingerprint?: string;
          nicheId?: string;
        }): Promise<void>;
        reserveAttempt(
          target: CommercialAutomationTarget,
          input: {
            executionId: string;
            reservedAt: Date;
            leaseExpiresAt: Date;
          },
        ): Promise<CommercialAutomationCandidateAttemptReservationResult>;
        releaseAttempt(input: {
          campaignId: string;
          executionId: string;
        }): Promise<CommercialGroupCampaignAttemptRelease>;
        renewAttempt(input: {
          campaignId: string;
          executionId: string;
          renewedAt: Date;
          leaseExpiresAt: Date;
        }): Promise<CommercialGroupCampaignAttemptRenewal>;
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
    targetConstraint?: CommercialAutomationTargetConstraint;
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
      // FREEZE_AT_EXECUTION_ACCEPTANCE: this is the sole authoritative
      // revision check; the worker read above remains only a fast-path.
      ...(input.targetConstraint
        ? { expectedScheduleRevision: input.targetConstraint.scheduleRevision }
        : {}),
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
    let confirmationAttempted = false;
    let reservationAcquired = false;
    let acquiredReservation:
      | { campaignId: string; executionId: string }
      | undefined;
    let reservationReleaseAttempted = false;
    const releaseReservationBeforeConfirmation = async () => {
      if (
        !reservationAcquired ||
        !acquiredReservation ||
        confirmationAttempted ||
        reservationReleaseAttempted
      ) {
        return;
      }
      reservationReleaseAttempted = true;
      const release = await this.dependencies.candidateFlow!.releaseAttempt(
        acquiredReservation,
      );
      if (release.kind === 'CONFLICT') {
        this.dependencies.logger.error(
          {
            event: 'commercial-automation.attempt-release.blocked',
            executionId: acquiredReservation.executionId,
            campaignId: acquiredReservation.campaignId,
            reason: 'RESERVATION_OWNER_MISMATCH',
          },
          'Commercial automation attempt release blocked',
        );
        return;
      }
      reservationAcquired = false;
      acquiredReservation = undefined;
    };
    const finish = async (
      data: Parameters<CommercialAutomationExecutionRepository['finish']>[1],
    ) => {
      await releaseReservationBeforeConfirmation();
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
          logicalGroupFingerprint?: string;
          nicheId?: string;
        }
      | undefined;
    let selectedTarget: CommercialAutomationTarget | undefined;
    let selectedCandidateSelection:
      | CommercialAutomationCandidateSelection
      | undefined;
    let selectedMiningReport:
      | Pick<CommercialPromotionMiningReport, 'rejectionSummary'>
      | undefined;
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

      if (this.dependencies.candidateFlow) {
        let targets: CommercialAutomationTarget[];
        try {
          targets = await this.dependencies.candidateFlow.listTargets();
        } catch (error) {
          const failureCode = safeFailureCode(error);
          return publicResult(
            await finish({
              status: 'BLOCKED',
              reasons: [failureCode],
              failureCode,
              completedAt: this.clock(),
            }),
          );
        }
        const targetReasons = new Set<string>();
        if (input.targetConstraint) {
          const constraint = input.targetConstraint;
          const scheduledFor = Date.parse(constraint.scheduledFor);
          const matchingTargets = targets.flatMap((target) => {
            if (
              target.campaignId !== constraint.campaignId ||
              target.groupId !== constraint.groupId ||
              target.logicalGroupFingerprint !==
                constraint.logicalGroupFingerprint ||
              !isCommercialInstanceAssigned(
                {
                  assignedInstanceName: target.instanceName,
                  assignedInstanceNames: target.orderedInstanceNames,
                },
                constraint.instanceName,
              ) ||
              (constraint.assignmentRevision !== undefined &&
                target.assignmentRevision !== constraint.assignmentRevision)
            ) {
              return [];
            }
            // The planner binds the selected member before enqueue. Preserve
            // that binding instead of reverting to the group's primary member.
            return [{
              ...target,
              instanceName: constraint.instanceName,
              ...(constraint.assignmentRevision !== undefined
                ? { assignmentRevision: constraint.assignmentRevision }
                : {}),
            }];
          });
          if (
            !Number.isFinite(scheduledFor) ||
            scheduledFor > this.clock().getTime()
          ) {
            return publicResult(
              await finish({
                status: 'BLOCKED',
                reasons: [COMMERCIAL_AUTOMATION_SCHEDULED_SLOT_NOT_DUE],
                failureCode: COMMERCIAL_AUTOMATION_SCHEDULED_SLOT_NOT_DUE,
                completedAt: this.clock(),
              }),
            );
          }
          if (matchingTargets.length !== 1) {
            return publicResult(
              await finish({
                status: 'BLOCKED',
                reasons: ['COMMERCIAL_AUTOMATION_TARGET_NOT_ELIGIBLE'],
                failureCode: 'COMMERCIAL_AUTOMATION_TARGET_NOT_ELIGIBLE',
                completedAt: this.clock(),
              }),
            );
          }
          targets = matchingTargets;
        }
        let externalSyncStarted = false;
        const syncOffers = async (syncInput: { page?: number; cursor?: string }) => {
          if (!externalSyncStarted) {
            await this.dependencies.executions.markExternalMayHaveStarted(
              ownership,
              { markedAt: this.clock() },
            );
            externalSyncStarted = true;
          }
          const report = await this.dependencies.syncOffers.run(syncInput);
          await heartbeat.checkpoint();
          return report;
        };
        const reserveSelection = async (
          target: CommercialAutomationTarget,
          preflight: Extract<CommercialAutomationCandidatePreflight, { outcome: 'READY' }>,
          miningReport?: Pick<CommercialPromotionMiningReport, 'rejectionSummary'>,
        ) => {
          selectedMiningReport = miningReport;
          selectedCandidateSelection = {
            target,
            candidateId: preflight.candidateId,
            candidateStatus: preflight.candidateStatus,
            queue: preflight.queue ?? {
              candidateCount: 1,
              eligibleCount: 1,
              rejectedCount: 0,
            },
          };
          const reservedAt = this.clock();
          const reservation = await this.dependencies.candidateFlow!.reserveAttempt(
            target,
            {
              executionId: execution.id,
              reservedAt,
              leaseExpiresAt: addMilliseconds(
                reservedAt,
                this.dependencies.leaseSeconds * 1000,
              ),
            },
          );
          if (reservation.kind === 'INELIGIBLE') {
            selectedCandidateSelection = undefined;
            selectedMiningReport = undefined;
            targetReasons.add(COMMERCIAL_AUTOMATION_TARGET_BACKOFF);
            return false;
          }
          if (reservation.kind === 'CONFLICT') {
            selectedCandidateSelection = undefined;
            selectedMiningReport = undefined;
            targetReasons.add(COMMERCIAL_AUTOMATION_TARGET_ATTEMPT_RESERVED);
            return false;
          }
          acquiredReservation = {
            campaignId: reservation.campaignId,
            executionId: execution.id,
          };
          reservationAcquired = true;
          selectedTarget = target;
          return true;
        };
        const targetsNeedingSync: CommercialAutomationTarget[] = [];
        const recordPreflightReasons = (
          preflight: CommercialAutomationCandidatePreflight,
        ) => {
          for (const reason of Object.keys(
            preflight.queue?.rejectionSummary ?? {},
          )) {
            targetReasons.add(reason);
          }
        };
        for (const target of targets) {
          const targetReadiness =
            await this.dependencies.policy.evaluateAutomationReadiness({
              excludedExecutionId: execution.id,
              target,
            });
          if (targetReadiness.allowed) {
            if (input.mode === 'send') {
              // Local queue and persisted catalog mining are both provider-free.
              // They must be exhausted before this slot may consume Shopee budget.
              const localPreflight = await this.dependencies.candidateFlow.preflight(target);
              if (localPreflight.outcome === 'READY') {
                if (await reserveSelection(target, localPreflight)) break;
                continue;
              }
              const replenishmentReport = await this.dependencies.candidateFlow.replenish(target);
              await heartbeat.checkpoint();
              const replenishedPreflight = await this.dependencies.candidateFlow.preflight(target);
              if (replenishedPreflight.outcome === 'READY') {
                if (await reserveSelection(target, replenishedPreflight, replenishmentReport)) break;
                continue;
              }
              recordPreflightReasons(replenishedPreflight);
              targetsNeedingSync.push(target);
              continue;
            }
            selectedTarget = target;
            break;
          }
          for (const reason of targetReadiness.reasons) {
            targetReasons.add(reason);
          }
        }
        if (input.mode === 'send' && !selectedTarget) {
          syncTargets: for (const target of targetsNeedingSync) {
            let page = 1;
            let cursor: string | undefined;
            for (let syncCall = 0; syncCall < 3; syncCall += 1) {
              const report = await syncOffers({ page, ...(cursor ? { cursor } : {}) });
              const replenishmentReport = await this.dependencies.candidateFlow.replenish(target);
              await heartbeat.checkpoint();
              const preflight = await this.dependencies.candidateFlow.preflight(target);
              if (preflight.outcome === 'READY') {
                if (await reserveSelection(target, preflight, replenishmentReport)) {
                  break syncTargets;
                }
                break;
              }
              targetReasons.add(COMMERCIAL_AUTOMATION_NO_ELIGIBLE_CANDIDATE);
              recordPreflightReasons(preflight);
              if (report.hasNextPage !== true) break;
              cursor = typeof report.nextCursor === 'string' && report.nextCursor.length > 0
                ? report.nextCursor
                : undefined;
              page =
                typeof report.page === 'number' && Number.isSafeInteger(report.page)
                  ? report.page + 1
                : page + 1;
            }
          }
        }
        if (!selectedTarget) {
          return publicResult(
            await finish({
              status: 'BLOCKED',
              reasons: [...targetReasons],
              completedAt: this.clock(),
            }),
          );
        }
      }
      if (input.mode === 'send') {
        if (!selectedTarget || !selectedCandidateSelection) {
          return publicResult(
            await finish({
              status: 'BLOCKED',
              reasons: ['COMMERCIAL_AUTOMATION_TARGET_NOT_ELIGIBLE'],
              failureCode: 'COMMERCIAL_AUTOMATION_TARGET_NOT_ELIGIBLE',
              completedAt: this.clock(),
            }),
          );
        }
        const candidateSelection = selectedCandidateSelection;
        let prepared;
        try {
          prepared = await this.dependencies.candidateFlow!.prepare(
            candidateSelection,
            {
              executionId: execution.id,
              ...(selectedMiningReport
                ? { miningReport: selectedMiningReport }
                : {}),
            },
          );
        } catch (error) {
          if (
            safeFailureCode(error) ===
            COMMERCIAL_AUTOMATION_NO_ELIGIBLE_CANDIDATE
          ) {
            return publicResult(
              await finish({
                status: 'BLOCKED',
                reasons: [COMMERCIAL_AUTOMATION_NO_ELIGIBLE_CANDIDATE],
                failureCode: COMMERCIAL_AUTOMATION_NO_ELIGIBLE_CANDIDATE,
                completedAt: this.clock(),
              }),
            );
          }
          throw error;
        }
        commercialRunId = prepared.runId;
        existingGeneratedCopyId = prepared.generatedCopyId;
        candidatePreparation = prepared;
      } else {
        const dryRun = await this.dependencies.pipeline.dryRun({
          executionId: execution.id,
          source: toCommercialAutomationProviderSource(input.provider),
          campaign: 'commercial-automation',
          ...(selectedTarget ? { target: selectedTarget } : {}),
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
          target: selectedTarget,
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
      if (!candidatePreparation) {
        throw new AppError(
          'Preparacao comercial ausente antes da confirmacao',
          'COMMERCIAL_AUTOMATION_CANDIDATE_PREPARATION_MISSING',
        );
      }
      await this.dependencies.candidateFlow!.revalidate(candidatePreparation);
      const renewedAt = this.clock();
      const reservationRenewal =
        await this.dependencies.candidateFlow!.renewAttempt({
          campaignId: candidatePreparation.campaignId,
          executionId: execution.id,
          renewedAt,
          leaseExpiresAt: addMilliseconds(
            renewedAt,
            this.dependencies.leaseSeconds * 1000,
          ),
        });
      if (reservationRenewal.kind === 'CONFLICT') {
        const failureCode =
          'COMMERCIAL_AUTOMATION_ATTEMPT_RENEWAL_CONFLICT';
        return publicResult(
          await finish({
            status: 'BLOCKED',
            reasons: [failureCode],
            commercialRunId,
            failureCode,
            completedAt: renewedAt,
          }),
        );
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
