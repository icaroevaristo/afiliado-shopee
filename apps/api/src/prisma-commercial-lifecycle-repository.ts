import type { DatabaseClient } from '@shopee-auto-affiliate-ai/database';

import type {
  CommercialLifecycleCandidateRecord,
  CommercialLifecycleCopyAttemptRecord,
  CommercialLifecycleCopyRecord,
  CommercialLifecycleDispatchRecord,
  CommercialLifecycleExecutionRecord,
  CommercialLifecycleListInput,
  CommercialLifecycleListResult,
  CommercialLifecycleOutboxRecord,
  CommercialLifecycleRecoveryRecord,
  CommercialLifecycleRecord,
  CommercialLifecycleRepository,
  CommercialLifecycleReservationRecord,
  CommercialLifecycleRunRecord,
} from './commercial-lifecycle-repository';

type LifecyclePrisma = Pick<
  DatabaseClient,
  | 'commercialAutomationExecution'
  | 'commercialPipelineRun'
  | 'commercialPromotionCandidate'
  | 'commercialCopyGenerationAttempt'
  | 'whatsAppDispatch'
  | 'commercialDispatchOutbox'
  | 'commercialGroupCampaign'
  | 'whatsAppDispatchManualRecovery'
>;

const toDecimalString = (value: { toString(): string } | null) =>
  value === null ? null : value.toString();

const mapExecution = (record: {
  id: string;
  bullMqJobId: string | null;
  mode: string;
  status: string;
  externalStage: string;
  commercialRunId: string | null;
  failureCode: string | null;
  leaseExpiresAt: Date | null;
  startedAt: Date;
  completedAt: Date | null;
}): CommercialLifecycleExecutionRecord => record;

const mapRun = (record: {
  id: string;
  executionId: string | null;
  mode: string;
  status: string;
  productId: string | null;
  productName: string | null;
  productPrice: { toString(): string } | null;
  groupDestinationId: string | null;
  groupName: string | null;
  groupFingerprint: string | null;
  score: number | null;
  candidateCount: number;
  eligibleCount: number;
  rejectedCount: number;
  dispatchId: string | null;
  jobId: string | null;
  confirmedAt: Date | null;
  finalStatus: string | null;
  investigationRequired: boolean;
  failureCode: string | null;
  createdAt: Date;
  completedAt: Date | null;
}): CommercialLifecycleRunRecord => ({
  ...record,
  productPrice: toDecimalString(record.productPrice),
});

const mapCandidate = (record: {
  id: string;
  campaignId: string;
  campaign: { name: string };
  productId: string;
  product: { nome: string; providerProductId: string };
  status: string;
  rankPosition: number | null;
  commercialScore: number;
  scorePolicyVersion: string;
  createdAt: Date;
  updatedAt: Date;
}): CommercialLifecycleCandidateRecord => ({
  id: record.id,
  campaignId: record.campaignId,
  campaignName: record.campaign.name,
  productId: record.productId,
  productName: record.product.nome,
  providerProductId: record.product.providerProductId,
  status: record.status,
  rankPosition: record.rankPosition,
  score: record.commercialScore,
  scorePolicyVersion: record.scorePolicyVersion,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

const mapCopy = (record: {
  id: string;
  productId: string;
  snapshotId: string | null;
  createdFromCandidateId: string | null;
  source: string;
  createdAt: Date;
}): CommercialLifecycleCopyRecord => record;

const mapDispatch = (record: {
  id: string;
  destinationId: string;
  destination: { name: string; fingerprint: string | null };
  status: string;
  attemptCount: number;
  externalMessageId: string | null;
  errorMessage: string | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): CommercialLifecycleDispatchRecord => ({
  id: record.id,
  destinationId: record.destinationId,
  destinationName: record.destination.name,
  destinationFingerprint: record.destination.fingerprint,
  status: record.status,
  attemptCount: record.attemptCount,
  externalMessageId: record.externalMessageId,
  errorMessage: record.errorMessage,
  sentAt: record.sentAt,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

const mapOutbox = (record: {
  id: string;
  dispatchId: string;
  jobId: string;
  status: string;
  failureCode: string | null;
  createdAt: Date;
  publishedAt: Date | null;
}): CommercialLifecycleOutboxRecord => record;

const mapRecovery = (record: {
  id: string;
  dispatchId: string;
  runId: string;
  executionId: string;
  candidateId: string;
  campaignId: string;
  jobId: string;
  decision: string;
  attemptCountObserved: number;
  authorizedAt: Date;
  rearmedAt: Date | null;
  requeuedAt: Date | null;
}): CommercialLifecycleRecoveryRecord => record;

export class PrismaCommercialLifecycleRepository implements CommercialLifecycleRepository {
  constructor(private readonly prisma: LifecyclePrisma) {}

  async list(
    input: CommercialLifecycleListInput,
  ): Promise<CommercialLifecycleListResult> {
    const take = Math.min(
      Math.max(input.page * input.limit * 2, input.limit),
      200,
    );
    const [runs, executions, summary] = await Promise.all([
      this.prisma.commercialPipelineRun.findMany({
        orderBy: { createdAt: 'desc' },
        take,
        select: {
          id: true,
          executionId: true,
          mode: true,
          status: true,
          productId: true,
          productName: true,
          productPrice: true,
          groupDestinationId: true,
          groupName: true,
          groupFingerprint: true,
          score: true,
          candidateCount: true,
          eligibleCount: true,
          rejectedCount: true,
          dispatchId: true,
          jobId: true,
          confirmedAt: true,
          finalStatus: true,
          investigationRequired: true,
          failureCode: true,
          createdAt: true,
          completedAt: true,
        },
      }),
      this.prisma.commercialAutomationExecution.findMany({
        where: { commercialRunId: null },
        orderBy: { startedAt: 'desc' },
        take,
        select: {
          id: true,
          bullMqJobId: true,
          mode: true,
          status: true,
          externalStage: true,
          commercialRunId: true,
          failureCode: true,
          leaseExpiresAt: true,
          startedAt: true,
          completedAt: true,
        },
      }),
      this.loadSummary(input.todayStart, input.now),
    ]);

    const roots = [
      ...runs.map((run) => ({
        kind: 'RUN' as const,
        createdAt: run.createdAt,
        run,
        execution: null,
      })),
      ...executions.map((execution) => ({
        kind: 'EXECUTION' as const,
        createdAt: execution.startedAt,
        run: null,
        execution,
      })),
    ].sort(
      (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
    );

    const offset = (input.page - 1) * input.limit;
    const pageRoots = roots.slice(offset, offset + input.limit);
    const items = await Promise.all(
      pageRoots.map((root) =>
        this.loadLifecycle(root.run, root.execution, input.now),
      ),
    );

    const [runTotal, unlinkedExecutionTotal] = await Promise.all([
      this.prisma.commercialPipelineRun.count(),
      this.prisma.commercialAutomationExecution.count({
        where: { commercialRunId: null },
      }),
    ]);

    return { items, total: runTotal + unlinkedExecutionTotal, summary };
  }

  private async loadSummary(todayStart: Date, now: Date) {
    const [
      activeExecutions,
      sentToday,
      failed,
      ambiguous,
      investigationRequired,
      activeReservations,
      pendingDispatches,
      pendingOutboxes,
      manualRecoveries,
    ] = await Promise.all([
      this.prisma.commercialAutomationExecution.count({
        where: {
          status: 'STARTED',
          activeKey: { not: null },
          ownerId: { not: null },
          heartbeatAt: { not: null },
          leaseExpiresAt: { gt: now },
          completedAt: null,
        },
      }),
      this.prisma.whatsAppDispatch.count({
        where: { status: 'SENT', sentAt: { gte: todayStart } },
      }),
      this.prisma.commercialPipelineRun.count({
        where: { finalStatus: 'FAILED' },
      }),
      this.prisma.commercialPipelineRun.count({
        where: { finalStatus: 'AMBIGUOUS' },
      }),
      this.prisma.commercialPipelineRun.count({
        where: { investigationRequired: true },
      }),
      this.prisma.commercialGroupCampaign.count({
        where: {
          attemptExecutionId: { not: null },
          attemptLeaseExpiresAt: { gt: now },
        },
      }),
      this.prisma.whatsAppDispatch.count({
        where: { status: { in: ['PENDING', 'PROCESSING'] } },
      }),
      this.prisma.commercialDispatchOutbox.count({
        where: { status: 'PENDING' },
      }),
      this.prisma.whatsAppDispatchManualRecovery.count(),
    ]);

    return {
      activeExecutions,
      sentToday,
      failed,
      ambiguous,
      investigationRequired,
      activeReservations,
      pendingDispatches,
      pendingOutboxes,
      manualRecoveries,
    };
  }

  private async loadLifecycle(
    runRow: {
      id: string;
      executionId: string | null;
      mode: string;
      status: string;
      productId: string | null;
      productName: string | null;
      productPrice: { toString(): string } | null;
      groupDestinationId: string | null;
      groupName: string | null;
      groupFingerprint: string | null;
      score: number | null;
      candidateCount: number;
      eligibleCount: number;
      rejectedCount: number;
      dispatchId: string | null;
      jobId: string | null;
      confirmedAt: Date | null;
      finalStatus: string | null;
      investigationRequired: boolean;
      failureCode: string | null;
      createdAt: Date;
      completedAt: Date | null;
    } | null,
    executionRow: {
      id: string;
      bullMqJobId: string | null;
      mode: string;
      status: string;
      externalStage: string;
      commercialRunId: string | null;
      failureCode: string | null;
      leaseExpiresAt: Date | null;
      startedAt: Date;
      completedAt: Date | null;
    } | null,
    now: Date,
  ): Promise<CommercialLifecycleRecord> {
    const executionId = runRow?.executionId ?? executionRow?.id ?? null;
    const linkedExecution = executionRow
      ? executionRow
      : executionId
        ? await this.prisma.commercialAutomationExecution.findUnique({
            where: { id: executionId },
            select: {
              id: true,
              bullMqJobId: true,
              mode: true,
              status: true,
              externalStage: true,
              commercialRunId: true,
              failureCode: true,
              leaseExpiresAt: true,
              startedAt: true,
              completedAt: true,
            },
          })
        : null;
    const execution = linkedExecution ? mapExecution(linkedExecution) : null;
    const run = runRow ? mapRun(runRow) : null;
    const dispatchRow = run?.dispatchId
      ? await this.prisma.whatsAppDispatch.findUnique({
          where: { id: run.dispatchId },
          select: {
            id: true,
            destinationId: true,
            status: true,
            attemptCount: true,
            externalMessageId: true,
            errorMessage: true,
            sentAt: true,
            createdAt: true,
            updatedAt: true,
            destination: { select: { name: true, fingerprint: true } },
            generatedCopy: {
              select: {
                id: true,
                productId: true,
                snapshotId: true,
                createdFromCandidateId: true,
                source: true,
                createdAt: true,
              },
            },
          },
        })
      : null;
    const copy = dispatchRow?.generatedCopy
      ? mapCopy(dispatchRow.generatedCopy)
      : null;
    const candidateRow = copy?.createdFromCandidateId
      ? await this.prisma.commercialPromotionCandidate.findUnique({
          where: { id: copy.createdFromCandidateId },
          select: {
            id: true,
            campaignId: true,
            productId: true,
            status: true,
            rankPosition: true,
            commercialScore: true,
            scorePolicyVersion: true,
            createdAt: true,
            updatedAt: true,
            campaign: { select: { name: true } },
            product: { select: { nome: true, providerProductId: true } },
          },
        })
      : null;
    const candidate = candidateRow ? mapCandidate(candidateRow) : null;
    const copyAttempt = candidate
      ? await this.prisma.commercialCopyGenerationAttempt.findFirst({
          where: { candidateId: candidate.id },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: {
            id: true,
            status: true,
            failureCode: true,
            requestMayHaveStarted: true,
            startedAt: true,
            completedAt: true,
          },
        })
      : null;
    const dispatch = dispatchRow ? mapDispatch(dispatchRow) : null;
    const outbox = run
      ? await this.prisma.commercialDispatchOutbox.findUnique({
          where: { commercialRunId: run.id },
          select: {
            id: true,
            dispatchId: true,
            jobId: true,
            status: true,
            failureCode: true,
            createdAt: true,
            publishedAt: true,
          },
        })
      : null;
    const recovery = dispatch
      ? await this.prisma.whatsAppDispatchManualRecovery.findUnique({
          where: { dispatchId: dispatch.id },
          select: {
            id: true,
            dispatchId: true,
            runId: true,
            executionId: true,
            candidateId: true,
            campaignId: true,
            jobId: true,
            decision: true,
            attemptCountObserved: true,
            authorizedAt: true,
            rearmedAt: true,
            requeuedAt: true,
          },
        })
      : null;
    const reservation = await this.loadReservation(
      executionId,
      candidate?.campaignId ?? null,
      now,
    );

    return {
      lifecycleId: run?.id ?? execution?.id ?? 'unknown',
      createdAt: run?.createdAt ?? execution?.startedAt ?? now,
      execution,
      run,
      candidate,
      copy,
      copyAttempt: copyAttempt as CommercialLifecycleCopyAttemptRecord | null,
      dispatch,
      outbox: outbox ? mapOutbox(outbox) : null,
      reservation,
      recovery: recovery ? mapRecovery(recovery) : null,
    };
  }

  private async loadReservation(
    executionId: string | null,
    campaignId: string | null,
    now: Date,
  ): Promise<CommercialLifecycleReservationRecord | null> {
    const records = campaignId
      ? await this.prisma.commercialGroupCampaign.findMany({
          where: { id: campaignId },
          take: 2,
          select: {
            id: true,
            name: true,
            attemptExecutionId: true,
            attemptReservedAt: true,
            attemptLeaseExpiresAt: true,
          },
        })
      : executionId
        ? await this.prisma.commercialGroupCampaign.findMany({
            where: { attemptExecutionId: executionId },
            take: 2,
            select: {
              id: true,
              name: true,
              attemptExecutionId: true,
              attemptReservedAt: true,
              attemptLeaseExpiresAt: true,
            },
          })
        : [];

    if (records.length === 0) return null;
    if (records.length > 1) {
      const first = records[0]!;
      return {
        campaignId: first.id,
        campaignName: first.name,
        attemptExecutionId: null,
        attemptReservedAt: null,
        attemptLeaseExpiresAt: null,
        state: 'UNKNOWN',
      };
    }
    const record = records[0]!;
    if (
      record.attemptExecutionId &&
      record.attemptExecutionId !== executionId
    ) {
      return {
        campaignId: record.id,
        campaignName: record.name,
        attemptExecutionId: null,
        attemptReservedAt: null,
        attemptLeaseExpiresAt: null,
        state: 'UNKNOWN',
      };
    }
    const state = !record.attemptExecutionId
      ? 'ABSENT'
      : record.attemptLeaseExpiresAt && record.attemptLeaseExpiresAt > now
        ? 'ACTIVE'
        : 'EXPIRED';
    return {
      campaignId: record.id,
      campaignName: record.name,
      attemptExecutionId: record.attemptExecutionId,
      attemptReservedAt: record.attemptReservedAt,
      attemptLeaseExpiresAt: record.attemptLeaseExpiresAt,
      state,
    };
  }
}
