import { AppError } from '@shopee-auto-affiliate-ai/shared';

import { isCommercialAutomationExecutionStale } from './commercial-automation-execution-domain';
import type {
  CommercialAutomationExecutionRecord,
  CommercialAutomationExecutionRecoveryContext,
  CommercialAutomationExecutionRepository,
  CommercialAutomationSettingsRepository,
  CommercialDispatchOutboxPublicationContext,
  CommercialDispatchOutboxRecord,
  CommercialDispatchOutboxRepository,
} from './repositories';

export type CommercialRecoveryCategory =
  'SAFE_DB_RECOVERY' | 'SAFE_QUEUE_RECOVERY' | 'NO_ACTION' | 'HUMAN_REQUIRED';

export type CommercialRecoveryReport = {
  scanned: number;
  safeDbRecovered: number;
  safeQueueRecovered: number;
  noAction: number;
  historicalIgnored: number;
  humanRequired: number;
  jobsReused: number;
  jobsCreated: number;
  reservationsReleased: number;
  finalizersReplayed: number;
  ambiguitiesPreserved: number;
};

export const COMMERCIAL_RECOVERY_HUMAN_REQUIRED_CODE =
  'COMMERCIAL_RECOVERY_HUMAN_REQUIRED';

export const assertCommercialRecoveryStartupSafe = (
  report: Pick<
    CommercialRecoveryReport,
    'humanRequired' | 'ambiguitiesPreserved'
  >,
) => {
  if (report.humanRequired > 0 || report.ambiguitiesPreserved > 0) {
    throw new AppError(
      'Recuperacao comercial exige intervencao humana antes do startup',
      COMMERCIAL_RECOVERY_HUMAN_REQUIRED_CODE,
    );
  }
};

export type CommercialRecoveryLogger = {
  info: (data: Record<string, unknown>, message?: string) => void;
  error: (data: Record<string, unknown>, message?: string) => void;
};

export type CommercialRecoveryJob = {
  id: string;
  dispatchId: string;
  instanceName?: string | null;
};

export type CommercialRecoveryQueue = {
  hasJob(jobId: string): Promise<boolean>;
  getJob?(jobId: string): Promise<CommercialRecoveryJob | null>;
  enqueue(
    dispatchId: string,
    jobId: string,
    instanceName?: string | null,
  ): Promise<void>;
};

export type CommercialRecoveryPublishResult = {
  outbox: CommercialDispatchOutboxRecord;
  jobCreated?: boolean;
  jobReused?: boolean;
};

type RecoveryDependencies = {
  settings: Pick<CommercialAutomationSettingsRepository, 'get'>;
  executions: Pick<
    CommercialAutomationExecutionRepository,
    'list' | 'findRecoveryContext'
  >;
  outboxes: Pick<
    CommercialDispatchOutboxRepository,
    'list' | 'findPublicationContext'
  >;
  queue?: CommercialRecoveryQueue;
  recoverExecution?: (executionId: string) => Promise<{
    outcome: 'recovered' | 'already-terminal' | 'investigation-required';
  }>;
  publishOutbox?: (
    outboxId: string,
  ) => Promise<CommercialRecoveryPublishResult>;
  finalizeAfterDispatch?: (dispatchId: string) => Promise<unknown>;
  clock?: () => Date;
  logger: CommercialRecoveryLogger;
  pageSize?: number;
};

const emptyReport = (): CommercialRecoveryReport => ({
  scanned: 0,
  safeDbRecovered: 0,
  safeQueueRecovered: 0,
  noAction: 0,
  historicalIgnored: 0,
  humanRequired: 0,
  jobsReused: 0,
  jobsCreated: 0,
  reservationsReleased: 0,
  finalizersReplayed: 0,
  ambiguitiesPreserved: 0,
});

const readAllPages = async <T>(
  loader: (
    page: number,
    limit: number,
  ) => Promise<{
    items: T[];
    total: number;
  }>,
  pageSize: number,
) => {
  const items: T[] = [];
  let page = 1;
  while (true) {
    const result = await loader(page, pageSize);
    items.push(...result.items);
    if (
      result.items.length === 0 ||
      items.length >= result.total ||
      result.items.length < pageSize
    ) {
      return items;
    }
    page += 1;
  }
};

const hasExternalUncertainty = (
  context: CommercialAutomationExecutionRecoveryContext,
) => {
  const run = context.run;
  const dispatch = run?.dispatch;
  const dispatchEvidenceIsUnknown = Boolean(
    dispatch &&
    (dispatch.externalMessageId === undefined || dispatch.sentAt === undefined),
  );
  const dispatchHasExternalEvidence = Boolean(
    dispatch &&
    (dispatch.externalMessageId !== null || dispatch.sentAt !== null),
  );
  return Boolean(
    context.execution.externalStage === 'EXTERNAL_MAY_HAVE_STARTED' ||
    run?.investigationRequired ||
    run?.finalStatus === 'AMBIGUOUS' ||
    dispatchEvidenceIsUnknown ||
    dispatchHasExternalEvidence ||
    dispatch?.status === 'PROCESSING' ||
    run?.outbox?.status === 'AMBIGUOUS',
  );
};

const isSafeExecutionRecovery = (
  context: CommercialAutomationExecutionRecoveryContext,
) => {
  if (hasExternalUncertainty(context)) return false;
  const { execution, run } = context;
  if (execution.externalStage !== 'NOT_REACHED') return false;
  if (!run) return execution.commercialRunId === null;
  if (
    (run.dispatch && !run.outbox) ||
    (run.outbox && !run.dispatch) ||
    (run.dispatch && run.dispatchId !== run.dispatch.id) ||
    (run.outbox &&
      (run.id !== run.outbox.commercialRunId ||
        run.dispatchId !== run.outbox.dispatchId ||
        (run.jobId !== null && run.jobId !== run.outbox.jobId)))
  ) {
    return false;
  }
  if (run.mode === 'CONFIRMED' && execution.mode !== 'SEND') return false;
  if (
    run.outbox?.status === 'PENDING' ||
    (run.outbox?.status === 'PUBLISHED' && run.dispatch?.status !== 'SENT')
  ) {
    return false;
  }
  if (run.dispatch && run.dispatch.attemptCount > 0) {
    return run.dispatch.status === 'SENT' || run.dispatch.status === 'FAILED';
  }
  if (run.mode === 'DRY_RUN') {
    return (
      execution.commercialRunId === run.id &&
      !run.dispatchId &&
      !run.jobId &&
      !run.dispatch &&
      !run.outbox
    );
  }
  return Boolean(
    run.dispatch?.status === 'FAILED' && run.finalStatus === 'FAILED',
  );
};

const lifecycleIdentitiesAreConsistent = (
  context: CommercialDispatchOutboxPublicationContext,
) => {
  const { outbox, run, dispatch } = context;
  return (
    run.id === outbox.commercialRunId &&
    run.mode === 'CONFIRMED' &&
    run.dispatchId === dispatch.id &&
    outbox.dispatchId === dispatch.id &&
    (run.instanceName ?? null) === (outbox.instanceName ?? null) &&
    (dispatch.instanceName ?? null) === (outbox.instanceName ?? null)
  );
};

const pendingContextIsSafe = (
  context: CommercialDispatchOutboxPublicationContext,
) =>
  context.run.status === 'STARTED' &&
  context.run.finalStatus === 'PENDING' &&
  !context.run.investigationRequired &&
  context.dispatch.status === 'PENDING' &&
  context.dispatch.attemptCount === 0 &&
  context.dispatch.externalMessageId === null &&
  context.dispatch.sentAt === null &&
  (context.run.jobId === null || context.run.jobId === context.outbox.jobId);

const hasValidSentEvidence = (
  context: CommercialDispatchOutboxPublicationContext,
) =>
  context.dispatch.status === 'SENT' &&
  typeof context.dispatch.externalMessageId === 'string' &&
  context.dispatch.externalMessageId.trim().length > 0 &&
  context.dispatch.sentAt instanceof Date &&
  !Number.isNaN(context.dispatch.sentAt.getTime());

const isTerminalSentHistory = (
  context: CommercialDispatchOutboxPublicationContext,
) => {
  const { outbox, run } = context;
  return (
    lifecycleIdentitiesAreConsistent(context) &&
    outbox.status === 'PUBLISHED' &&
    run.status === 'COMPLETED' &&
    run.finalStatus === 'SENT' &&
    !run.investigationRequired &&
    run.jobId === outbox.jobId &&
    hasValidSentEvidence(context)
  );
};

const isSafePostSendFinalization = (
  context: CommercialDispatchOutboxPublicationContext,
) => {
  const { outbox, run, dispatch } = context;
  return (
    lifecycleIdentitiesAreConsistent(context) &&
    outbox.status === 'PUBLISHED' &&
    run.status === 'STARTED' &&
    run.finalStatus === 'PENDING' &&
    !run.investigationRequired &&
    dispatch.attemptCount === 1 &&
    run.jobId === outbox.jobId &&
    hasValidSentEvidence(context)
  );
};

const jobMatchesOutbox = (
  job: CommercialRecoveryJob | null,
  outbox: CommercialDispatchOutboxRecord,
) =>
  job === null ||
  (job.id === outbox.jobId &&
    job.dispatchId === outbox.dispatchId &&
    (job.instanceName ?? null) === (outbox.instanceName ?? null));

const hasPublicationUncertainty = (
  context: CommercialDispatchOutboxPublicationContext,
) =>
  context.run.investigationRequired ||
  context.run.finalStatus === 'AMBIGUOUS' ||
  context.outbox.status === 'AMBIGUOUS' ||
  context.dispatch.status === 'PROCESSING' ||
  context.dispatch.externalMessageId === undefined ||
  context.dispatch.sentAt === undefined ||
  context.dispatch.externalMessageId !== null ||
  context.dispatch.sentAt !== null;

export class CommercialRecoveryCoordinator {
  private readonly clock: () => Date;
  private readonly pageSize: number;
  private inFlight: Promise<CommercialRecoveryReport> | undefined;

  constructor(private readonly dependencies: RecoveryDependencies) {
    this.clock = dependencies.clock ?? (() => new Date());
    this.pageSize = dependencies.pageSize ?? 100;
  }

  run(): Promise<CommercialRecoveryReport> {
    this.inFlight ??= this.runOnce();
    return this.inFlight;
  }

  private async runOnce() {
    const report = emptyReport();
    const settings = await this.dependencies.settings.get();
    const automationPaused = settings?.paused !== false;
    const executions = await readAllPages(
      (page, limit) => this.dependencies.executions.list({ page, limit }),
      this.pageSize,
    );

    for (const execution of executions) {
      if (
        execution.status !== 'STARTED' ||
        !isCommercialAutomationExecutionStale(execution, this.clock())
      ) {
        continue;
      }
      report.scanned += 1;
      await this.recoverStaleExecution(execution, automationPaused, report);
    }

    const outboxes = await readAllPages(
      (page, limit) => this.dependencies.outboxes.list({ page, limit }),
      this.pageSize,
    );
    const finalizedDispatches = new Set<string>();
    for (const outbox of outboxes) {
      report.scanned += 1;
      const context = await this.dependencies.outboxes.findPublicationContext(
        outbox.id,
      );
      if (!context) {
        this.markHuman(report, false);
        continue;
      }
      if (isTerminalSentHistory(context)) {
        report.historicalIgnored += 1;
        continue;
      }
      if (isSafePostSendFinalization(context)) {
        await this.replayFinalizer(
          context.dispatch.id,
          finalizedDispatches,
          report,
        );
        continue;
      }
      if (context.dispatch.attemptCount > 1) {
        this.markHuman(report, true);
        continue;
      }
      if (
        context.dispatch.status === 'SENT' ||
        hasPublicationUncertainty(context)
      ) {
        this.markHuman(report, true);
        continue;
      }
      if (context.outbox.status === 'PENDING') {
        await this.recoverPendingOutbox(context, automationPaused, report);
        continue;
      }
      await this.classifyPublishedOutbox(context, report);
    }

    this.dependencies.logger.info(
      { event: 'commercial-recovery.coordinator.completed', ...report },
      'Commercial recovery coordinator completed',
    );
    return report;
  }

  private async recoverStaleExecution(
    execution: CommercialAutomationExecutionRecord,
    automationPaused: boolean,
    report: CommercialRecoveryReport,
  ) {
    const context = await this.dependencies.executions.findRecoveryContext(
      execution.id,
    );
    if (!context) {
      this.markHuman(report, false);
      return;
    }
    if (hasExternalUncertainty(context)) {
      this.markHuman(report, true);
      return;
    }
    if (
      context.run?.outbox?.status === 'PENDING' ||
      (context.run?.outbox?.status === 'PUBLISHED' &&
        context.run.dispatch?.status !== 'SENT')
    ) {
      report.noAction += 1;
      return;
    }
    if (!isSafeExecutionRecovery(context)) {
      this.markHuman(report, false);
      return;
    }
    if (!this.dependencies.recoverExecution) {
      this.markHuman(report, false);
      return;
    }
    try {
      const result = await this.dependencies.recoverExecution(execution.id);
      if (
        result.outcome === 'recovered' ||
        result.outcome === 'already-terminal'
      ) {
        report.safeDbRecovered += 1;
      } else {
        this.markHuman(report, true);
      }
    } catch (error) {
      this.dependencies.logger.error(
        {
          event: 'commercial-recovery.execution.failed',
          executionId: execution.id,
          automationPaused,
          errorType: error instanceof Error ? error.name : 'UnknownError',
        },
        'Commercial execution recovery requires review',
      );
      this.markHuman(report, false);
    }
  }

  private async recoverPendingOutbox(
    context: CommercialDispatchOutboxPublicationContext,
    automationPaused: boolean,
    report: CommercialRecoveryReport,
  ) {
    if (
      !lifecycleIdentitiesAreConsistent(context) ||
      !pendingContextIsSafe(context)
    ) {
      this.markHuman(report, true);
      return;
    }
    if (!(await this.hasSafeExternalStage(context, report))) return;
    if (automationPaused || !this.dependencies.queue) {
      report.noAction += 1;
      return;
    }
    if (!this.dependencies.publishOutbox) {
      this.markHuman(report, false);
      return;
    }
    const { outbox } = context;
    let job: CommercialRecoveryJob | null;
    try {
      job = this.dependencies.queue.getJob
        ? await this.dependencies.queue.getJob(outbox.jobId)
        : null;
      if (!job && (await this.dependencies.queue.hasJob(outbox.jobId))) {
        this.markHuman(report, false);
        return;
      }
    } catch (error) {
      this.dependencies.logger.error(
        {
          event: 'commercial-recovery.outbox.inspect-failed',
          outboxId: outbox.id,
          errorType: error instanceof Error ? error.name : 'UnknownError',
        },
        'Commercial outbox recovery inspection failed',
      );
      this.markHuman(report, false);
      return;
    }
    if (!jobMatchesOutbox(job, outbox)) {
      this.markHuman(report, true);
      return;
    }
    try {
      const result = await this.dependencies.publishOutbox(outbox.id);
      if (result.outbox.status !== 'PUBLISHED') {
        this.markHuman(report, true);
        return;
      }
      report.safeQueueRecovered += 1;
      if (result.jobCreated) report.jobsCreated += 1;
      if (result.jobReused || (!result.jobCreated && job))
        report.jobsReused += 1;
    } catch (error) {
      this.dependencies.logger.error(
        {
          event: 'commercial-recovery.outbox.failed',
          outboxId: outbox.id,
          errorType: error instanceof Error ? error.name : 'UnknownError',
        },
        'Commercial outbox recovery requires review',
      );
      this.markHuman(report, true);
    }
  }

  private async hasSafeExternalStage(
    context: CommercialDispatchOutboxPublicationContext,
    report: CommercialRecoveryReport,
  ) {
    const executionId = context.run.executionId;
    if (executionId === undefined) {
      this.markHuman(report, true);
      return false;
    }
    if (executionId === null) return true;
    try {
      const recoveryContext =
        await this.dependencies.executions.findRecoveryContext(executionId);
      const linkedRun = recoveryContext?.run;
      const linkedDispatch = linkedRun?.dispatch;
      const linkedOutbox = linkedRun?.outbox;
      if (
        !recoveryContext ||
        recoveryContext.execution.commercialRunId !== context.run.id ||
        recoveryContext.execution.externalStage !== 'NOT_REACHED' ||
        !['QUEUED', 'STARTED'].includes(recoveryContext.execution.status) ||
        linkedRun?.id !== context.run.id ||
        linkedRun?.dispatchId !== context.dispatch.id ||
        linkedRun?.mode !== 'CONFIRMED' ||
        !linkedDispatch ||
        linkedDispatch.id !== context.dispatch.id ||
        linkedDispatch.status !== 'PENDING' ||
        linkedDispatch.attemptCount !== 0 ||
        linkedDispatch.externalMessageId !== null ||
        linkedDispatch.sentAt !== null ||
        !linkedOutbox ||
        linkedOutbox.id !== context.outbox.id ||
        linkedOutbox.status !== 'PENDING' ||
        linkedOutbox.jobId !== context.outbox.jobId ||
        (linkedRun?.jobId !== null && linkedRun?.jobId !== context.outbox.jobId)
      ) {
        this.markHuman(report, true);
        return false;
      }
      return true;
    } catch (error) {
      this.dependencies.logger.error(
        {
          event: 'commercial-recovery.outbox.execution-inspection-failed',
          outboxId: context.outbox.id,
          errorType: error instanceof Error ? error.name : 'UnknownError',
        },
        'Commercial outbox execution safety inspection failed',
      );
      this.markHuman(report, true);
      return false;
    }
  }

  private async classifyPublishedOutbox(
    context: CommercialDispatchOutboxPublicationContext,
    report: CommercialRecoveryReport,
  ) {
    if (!this.dependencies.queue) {
      this.markHuman(report, false);
      return;
    }
    try {
      const job = this.dependencies.queue.getJob
        ? await this.dependencies.queue.getJob(context.outbox.jobId)
        : null;
      if (
        !job &&
        (await this.dependencies.queue.hasJob(context.outbox.jobId))
      ) {
        this.markHuman(report, false);
        return;
      }
      if (!jobMatchesOutbox(job, context.outbox)) {
        this.markHuman(report, true);
        return;
      }
      if (!job) {
        this.markHuman(report, false);
        return;
      }
      report.noAction += 1;
    } catch (error) {
      this.dependencies.logger.error(
        {
          event: 'commercial-recovery.published-inspection-failed',
          outboxId: context.outbox.id,
          errorType: error instanceof Error ? error.name : 'UnknownError',
        },
        'Published commercial outbox requires review',
      );
      this.markHuman(report, false);
    }
  }

  private async replayFinalizer(
    dispatchId: string,
    finalizedDispatches: Set<string>,
    report: CommercialRecoveryReport,
  ) {
    if (finalizedDispatches.has(dispatchId)) {
      report.noAction += 1;
      return;
    }
    finalizedDispatches.add(dispatchId);
    if (!this.dependencies.finalizeAfterDispatch) {
      this.markHuman(report, false);
      return;
    }
    try {
      await this.dependencies.finalizeAfterDispatch(dispatchId);
      report.safeDbRecovered += 1;
      report.finalizersReplayed += 1;
    } catch (error) {
      this.dependencies.logger.error(
        {
          event: 'commercial-recovery.finalizer.failed',
          dispatchId,
          providerRetryAllowed: false,
          requeueAllowed: false,
          errorType: error instanceof Error ? error.name : 'UnknownError',
        },
        'Commercial post-SENT finalizer replay requires review',
      );
      this.markHuman(report, false);
    }
  }

  private markHuman(report: CommercialRecoveryReport, ambiguity: boolean) {
    report.humanRequired += 1;
    if (ambiguity) report.ambiguitiesPreserved += 1;
  }
}
