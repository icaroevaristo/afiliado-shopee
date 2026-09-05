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

type CommercialAutomationShopeeReplenishmentState = {
  pagesUsed: number;
  hasNextPage: boolean;
  nextPage: number;
  nextCursor?: string;
};

export const COMMERCIAL_AUTOMATION_OFFICIAL_PROVIDER_REQUIRED =
  'COMMERCIAL_AUTOMATION_OFFICIAL_PROVIDER_REQUIRED';
export const COMMERCIAL_AUTOMATION_CANDIDATE_FLOW_REQUIRED =
  'COMMERCIAL_AUTOMATION_CANDIDATE_FLOW_REQUIRED';
export const COMMERCIAL_AUTOMATION_NO_ELIGIBLE_CANDIDATE =
  'COMMERCIAL_AUTOMATION_NO_ELIGIBLE_CANDIDATE';
export const COMMERCIAL_AUTOMATION_REPLENISHMENT_LIMIT_REACHED =
  'COMMERCIAL_AUTOMATION_REPLENISHMENT_LIMIT_REACHED';
export const COMMERCIAL_AUTOMATION_CATALOG_EXHAUSTED =
  'COMMERCIAL_AUTOMATION_CATALOG_EXHAUSTED';
export const COMMERCIAL_AUTOMATION_SHOPEE_REPLENISHMENT_PAGE_LIMIT = 3;
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

const addPreflightRejectionReasons = (
  reasons: Set<string>,
  preflight: CommercialAutomationCandidatePreflight,
) => {
  for (const reason of Object.keys(preflight.queue?.rejectionSummary ?? {})) {
    reasons.add(reason);
  }
};

const nextShopeeReplenishmentState = (input: {
  report: CommercialAutomationOfferSyncReport;
  requestedPage: number;
  pagesUsed: number;
}): CommercialAutomationShopeeReplenishmentState => ({
  pagesUsed: input.pagesUsed,
  hasNextPage: input.report.hasNextPage === true,
  nextPage:
    typeof input.report.page === 'number' && Number.isSafeInteger(input.report.page)
      ? input.report.page + 1
      : input.requestedPage + 1,
  ...(typeof input.report.nextCursor === 'string' &&
  input.report.nextCursor.length > 0
    ? { nextCursor: input.report.nextCursor }
    : {}),
});

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
            beforeExternalCopyGeneration?: () => Promise<void>;
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
    let selectedShopeeReplenishment:
      | CommercialAutomationShopeeReplenishmentState
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

      const targetReasons = new Set<string>();
      let externalBoundaryMarked = false;
      const markExternalMayHaveStartedOnce = async () => {
        if (externalBoundaryMarked) return;
        await this.dependencies.executions.markExternalMayHaveStarted(
          ownership,
          { markedAt: this.clock() },
        );
        externalBoundaryMarked = true;
      };
      const syncOffers = async (syncInput: { page?: number; cursor?: string }) => {
        await markExternalMayHaveStartedOnce();
        const report = await this.dependencies.syncOffers.run(syncInput);
        await heartbeat.checkpoint();
        return report;
      };
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
              addPreflightRejectionReasons(targetReasons, replenishedPreflight);
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
            for (
              let syncCall = 0;
              syncCall < COMMERCIAL_AUTOMATION_SHOPEE_REPLENISHMENT_PAGE_LIMIT;
              syncCall += 1
            ) {
              const report = await syncOffers({ page, ...(cursor ? { cursor } : {}) });
              const replenishmentState = nextShopeeReplenishmentState({
                report,
                requestedPage: page,
                pagesUsed: syncCall + 1,
              });
              const replenishmentReport = await this.dependencies.candidateFlow.replenish(target);
              await heartbeat.checkpoint();
              const preflight = await this.dependencies.candidateFlow.preflight(target);
              if (preflight.outcome === 'READY') {
                if (await reserveSelection(target, preflight, replenishmentReport)) {
                  selectedShopeeReplenishment = replenishmentState;
                  break syncTargets;
                }
                break;
              }
              addPreflightRejectionReasons(targetReasons, preflight);
              if (!replenishmentState.hasNextPage) {
                targetReasons.add(COMMERCIAL_AUTOMATION_CATALOG_EXHAUSTED);
                this.dependencies.logger.info(
                  {
                    event: 'commercial-automation.replenishment.catalog-exhausted',
                    executionId: execution.id,
                    campaignId: target.campaignId,
                    pagesUsed: replenishmentState.pagesUsed,
                  },
                  'Commercial automation catalog exhausted during replenishment',
                );
                break;
              }
              if (
                replenishmentState.pagesUsed >=
                COMMERCIAL_AUTOMATION_SHOPEE_REPLENISHMENT_PAGE_LIMIT
              ) {
                targetReasons.add(
                  COMMERCIAL_AUTOMATION_REPLENISHMENT_LIMIT_REACHED,
                );
                this.dependencies.logger.info(
                  {
                    event: 'commercial-automation.replenishment.limit-reached',
                    executionId: execution.id,
                    campaignId: target.campaignId,
                    maxPages:
                      COMMERCIAL_AUTOMATION_SHOPEE_REPLENISHMENT_PAGE_LIMIT,
                  },
                  'Commercial automation replenishment page limit reached',
                );
                break;
              }
              cursor = replenishmentState.nextCursor;
              page = replenishmentState.nextPage;
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
        const target = selectedTarget;
        let candidateSelection = selectedCandidateSelection;
        let prepared;
        const prepareSelection = async (
          selection: CommercialAutomationCandidateSelection,
          miningReport = selectedMiningReport,
        ) => {
          try {
            return await this.dependencies.candidateFlow!.prepare(selection, {
              executionId: execution.id,
              ...(miningReport ? { miningReport } : {}),
              beforeExternalCopyGeneration: async () => {
                if (!(await renewReservedAttempt())) {
                  throw new AppError(
                    'Reserva comercial mudou antes da geracao de copy',
                    'COMMERCIAL_AUTOMATION_ATTEMPT_RENEWAL_CONFLICT',
                  );
                }
                await markExternalMayHaveStartedOnce();
              },
            });
          } catch (error) {
            if (
              safeFailureCode(error) !==
              COMMERCIAL_AUTOMATION_NO_ELIGIBLE_CANDIDATE
            ) {
              throw error;
            }
            this.dependencies.logger.info(
              {
                event:
                  'commercial-automation.fulfillment.candidate-terminal-exhausted',
                executionId: execution.id,
                campaignId: target.campaignId,
                candidateId: selection.candidateId,
              },
              'Commercial automation candidate exhausted during reserved fulfillment',
            );
            return undefined;
          }
        };
        const selectionFromPreflight = (
          preflight: Extract<
            CommercialAutomationCandidatePreflight,
            { outcome: 'READY' }
          >,
        ): CommercialAutomationCandidateSelection => ({
          target,
          candidateId: preflight.candidateId,
          candidateStatus: preflight.candidateStatus,
          queue: preflight.queue ?? {
            candidateCount: 1,
            eligibleCount: 1,
            rejectedCount: 0,
          },
        });
        const renewReservedAttempt = async () => {
          await heartbeat.checkpoint();
          const renewedAt = this.clock();
          const renewal = await this.dependencies.candidateFlow!.renewAttempt({
            campaignId: target.campaignId,
            executionId: execution.id,
            renewedAt,
            leaseExpiresAt: addMilliseconds(
              renewedAt,
              this.dependencies.leaseSeconds * 1000,
            ),
          });
          return renewal.kind !== 'CONFLICT';
        };
        const blockForReservationConflict = async () => {
          const failureCode = 'COMMERCIAL_AUTOMATION_ATTEMPT_RENEWAL_CONFLICT';
          return publicResult(
            await finish({
              status: 'BLOCKED',
              reasons: [failureCode],
              failureCode,
              completedAt: this.clock(),
            }),
          );
        };

        prepared = await prepareSelection(candidateSelection);
        if (!prepared) {
          const localReplenishment =
            await this.dependencies.candidateFlow!.replenish(target);
          if (!(await renewReservedAttempt())) {
            return blockForReservationConflict();
          }
          const localPreflight =
            await this.dependencies.candidateFlow!.preflight(target);
          addPreflightRejectionReasons(targetReasons, localPreflight);
          this.dependencies.logger.info(
            {
              event: 'commercial-automation.fulfillment.local-replenished',
              executionId: execution.id,
              campaignId: target.campaignId,
              outcome: localPreflight.outcome,
            },
            'Commercial automation replenished reserved fulfillment from persisted catalog',
          );
          if (localPreflight.outcome === 'READY') {
            candidateSelection = selectionFromPreflight(localPreflight);
            selectedCandidateSelection = candidateSelection;
            selectedMiningReport = localReplenishment;
            prepared = await prepareSelection(
              candidateSelection,
              localReplenishment,
            );
          }
        }

        let fulfillmentStopReason: string | undefined;
        if (!prepared) {
          let replenishmentState = selectedShopeeReplenishment;
          if (replenishmentState && !replenishmentState.hasNextPage) {
            fulfillmentStopReason = COMMERCIAL_AUTOMATION_CATALOG_EXHAUSTED;
          } else if (
            replenishmentState &&
            replenishmentState.pagesUsed >=
              COMMERCIAL_AUTOMATION_SHOPEE_REPLENISHMENT_PAGE_LIMIT
          ) {
            fulfillmentStopReason =
              COMMERCIAL_AUTOMATION_REPLENISHMENT_LIMIT_REACHED;
          }

          while (!prepared && !fulfillmentStopReason) {
            const page = replenishmentState?.nextPage ?? 1;
            const cursor = replenishmentState?.nextCursor;
            const pagesUsed = (replenishmentState?.pagesUsed ?? 0) + 1;
            const report = await syncOffers({
              page,
              ...(cursor ? { cursor } : {}),
            });
            replenishmentState = nextShopeeReplenishmentState({
              report,
              requestedPage: page,
              pagesUsed,
            });
            selectedShopeeReplenishment = replenishmentState;
            const replenishmentReport =
              await this.dependencies.candidateFlow!.replenish(target);
            if (!(await renewReservedAttempt())) {
              return blockForReservationConflict();
            }
            const preflight =
              await this.dependencies.candidateFlow!.preflight(target);
            addPreflightRejectionReasons(targetReasons, preflight);
            if (preflight.outcome === 'READY') {
              candidateSelection = selectionFromPreflight(preflight);
              selectedCandidateSelection = candidateSelection;
              selectedMiningReport = replenishmentReport;
              prepared = await prepareSelection(
                candidateSelection,
                replenishmentReport,
              );
              if (prepared) {
                this.dependencies.logger.info(
                  {
                    event:
                      'commercial-automation.fulfillment.replacement-prepared',
                    executionId: execution.id,
                    campaignId: target.campaignId,
                    candidateId: prepared.candidateId,
                    pagesUsed: replenishmentState.pagesUsed,
                  },
                  'Commercial automation prepared replacement in reserved fulfillment',
                );
                break;
              }
            }
            if (!replenishmentState.hasNextPage) {
              fulfillmentStopReason = COMMERCIAL_AUTOMATION_CATALOG_EXHAUSTED;
              this.dependencies.logger.info(
                {
                  event:
                    'commercial-automation.fulfillment.catalog-exhausted',
                  executionId: execution.id,
                  campaignId: target.campaignId,
                  pagesUsed: replenishmentState.pagesUsed,
                },
                'Commercial automation catalog exhausted during reserved fulfillment',
              );
              break;
            }
            if (
              replenishmentState.pagesUsed >=
              COMMERCIAL_AUTOMATION_SHOPEE_REPLENISHMENT_PAGE_LIMIT
            ) {
              fulfillmentStopReason =
                COMMERCIAL_AUTOMATION_REPLENISHMENT_LIMIT_REACHED;
              this.dependencies.logger.info(
                {
                  event: 'commercial-automation.fulfillment.limit-reached',
                  executionId: execution.id,
                  campaignId: target.campaignId,
                  pagesUsed: replenishmentState.pagesUsed,
                  maxPages:
                    COMMERCIAL_AUTOMATION_SHOPEE_REPLENISHMENT_PAGE_LIMIT,
                },
                'Commercial automation replenishment page limit reached during reserved fulfillment',
              );
            }
          }
        }

        if (!prepared) {
          const failureCode =
            fulfillmentStopReason ??
            COMMERCIAL_AUTOMATION_NO_ELIGIBLE_CANDIDATE;
          return publicResult(
            await finish({
              status: 'BLOCKED',
              reasons: [failureCode],
              failureCode,
              completedAt: this.clock(),
            }),
          );
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
      if (
        failureCode === 'COMMERCIAL_AUTOMATION_ATTEMPT_RENEWAL_CONFLICT'
      ) {
        return publicResult(
          await finish({
            status: 'BLOCKED',
            reasons: [failureCode],
            failureCode,
            completedAt: this.clock(),
          }),
        );
      }
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
