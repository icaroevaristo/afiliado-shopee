import { AppError } from '@shopee-auto-affiliate-ai/shared';

import type {
  CommercialDispatchOutboxPublicationContext,
  CommercialDispatchOutboxRecord,
  CommercialDispatchOutboxRepository,
} from './repositories';

export type CommercialDispatchOutboxQueue = {
  hasJob(jobId: string): Promise<boolean>;
  getJob?(jobId: string): Promise<{
    id: string;
    dispatchId: string;
    instanceName?: string | null;
  } | null>;
  enqueue(
    dispatchId: string,
    jobId: string,
    instanceName?: string | null,
  ): Promise<void>;
};

export type CommercialDispatchOutboxPublisherOptions = {
  outboxes: CommercialDispatchOutboxRepository;
  queue: CommercialDispatchOutboxQueue;
  logger: {
    info(data: Record<string, unknown>, message?: string): void;
    error(data: Record<string, unknown>, message?: string): void;
  };
  clock?: () => Date;
};

type CommercialDispatchOutboxJob = {
  id: string;
  dispatchId: string;
  instanceName?: string | null;
};

const OUTBOX_INCONSISTENT = 'COMMERCIAL_OUTBOX_INCONSISTENT';
const OUTBOX_PUBLICATION_UNCERTAIN = 'COMMERCIAL_OUTBOX_PUBLICATION_UNCERTAIN';

const identitiesAreConsistent = ({
  outbox,
  run,
  dispatch,
}: CommercialDispatchOutboxPublicationContext) =>
  (run.instanceName ?? null) === (outbox.instanceName ?? null) &&
  (dispatch.instanceName ?? null) === (outbox.instanceName ?? null) &&
  run.id === outbox.commercialRunId &&
  run.mode === 'CONFIRMED' &&
  run.dispatchId === outbox.dispatchId &&
  dispatch.id === outbox.dispatchId;

const pendingRunIsSafe = ({
  outbox,
  run,
}: CommercialDispatchOutboxPublicationContext) =>
  run.status === 'STARTED' &&
  run.finalStatus === 'PENDING' &&
  !run.investigationRequired &&
  (run.jobId === null || run.jobId === outbox.jobId);

const pendingDispatchIsSafe = ({
  dispatch,
}: CommercialDispatchOutboxPublicationContext) =>
  dispatch.status === 'PENDING' &&
  dispatch.attemptCount === 0 &&
  dispatch.externalMessageId === null &&
  dispatch.sentAt === null;

export class CommercialDispatchOutboxPublisher {
  private readonly clock: () => Date;

  constructor(
    private readonly options: CommercialDispatchOutboxPublisherOptions,
  ) {
    this.clock = options.clock ?? (() => new Date());
  }

  async publish(outboxId: string): Promise<CommercialDispatchOutboxRecord> {
    const context =
      await this.options.outboxes.findPublicationContext(outboxId);
    if (!context) {
      throw new AppError(
        'Outbox comercial nao encontrado',
        'COMMERCIAL_OUTBOX_NOT_FOUND',
      );
    }
    if (context.outbox.status === 'AMBIGUOUS') {
      throw new AppError(
        'Outbox comercial exige investigacao manual',
        'COMMERCIAL_OUTBOX_AMBIGUOUS',
      );
    }
    if (!identitiesAreConsistent(context)) {
      if (context.dispatch.status === 'SENT') {
        return this.throwSentMetadataPending(context.outbox.id);
      }
      return this.failAmbiguous(context.outbox.id, OUTBOX_INCONSISTENT);
    }
    const { outbox } = context;
    let existingJob: CommercialDispatchOutboxJob | null;
    try {
      existingJob = await this.readExistingJob(outbox);
    } catch {
      return this.failAmbiguous(outbox.id, OUTBOX_PUBLICATION_UNCERTAIN);
    }
    const jobExists = existingJob !== null;

    if (
      existingJob !== null &&
      !this.jobMatchesOutbox(existingJob, outbox)
    ) {
      if (context.dispatch.status === 'SENT') {
        return this.throwSentMetadataPending(context.outbox.id);
      }
      return this.failAmbiguous(outbox.id, OUTBOX_INCONSISTENT);
    }

    if (context.dispatch.status === 'SENT') {
      if (
        outbox.status === 'PUBLISHED' &&
        jobExists &&
        context.run.jobId === outbox.jobId
      ) {
        return outbox;
      }
      return this.throwSentMetadataPending(context.outbox.id);
    }

    if (
      outbox.status === 'PUBLISHED' &&
      (!jobExists || context.run.jobId !== outbox.jobId)
    ) {
      return this.failAmbiguous(outbox.id, OUTBOX_INCONSISTENT);
    }
    if (outbox.status === 'PUBLISHED') return outbox;

    if (!pendingRunIsSafe(context)) {
      return this.failAmbiguous(outbox.id, OUTBOX_INCONSISTENT);
    }

    if (!pendingDispatchIsSafe(context)) {
      return this.failAmbiguous(
        context.outbox.id,
        'COMMERCIAL_OUTBOX_DISPATCH_UNSAFE',
      );
    }

    if (!jobExists) {
      try {
        if (outbox.instanceName) {
          await this.options.queue.enqueue(
            outbox.dispatchId,
            outbox.jobId,
            outbox.instanceName,
          );
        } else {
          await this.options.queue.enqueue(outbox.dispatchId, outbox.jobId);
        }
      } catch {
        try {
          existingJob = await this.readExistingJob(outbox);
        } catch {
          existingJob = null;
        }
        if (!existingJob) {
          return this.failAmbiguous(outbox.id, OUTBOX_PUBLICATION_UNCERTAIN);
        }
        if (!this.jobMatchesOutbox(existingJob, outbox)) {
          return this.failAmbiguous(outbox.id, OUTBOX_INCONSISTENT);
        }
      }
    }

    const published = await this.options.outboxes.markPublished(
      outbox.id,
      this.clock(),
    );
    if (!published) {
      const current = await this.options.outboxes.findPublicationContext(
        outbox.id,
      );
      if (
        current?.outbox.status === 'PUBLISHED' &&
        current.outbox.commercialRunId === outbox.commercialRunId &&
        current.outbox.dispatchId === outbox.dispatchId &&
        current.outbox.jobId === outbox.jobId &&
        current.run.id === outbox.commercialRunId &&
        current.run.jobId === outbox.jobId &&
        current.dispatch.id === outbox.dispatchId
      ) {
        this.options.logger.info(
          {
            event: 'commercial-outbox.publication-race-converged',
            outboxId: outbox.id,
            commercialRunId: outbox.commercialRunId,
          },
          'Commercial dispatch outbox publication race converged',
        );
        return current.outbox;
      }
      if (current?.dispatch.status === 'SENT') {
        return this.throwSentMetadataPending(outbox.id);
      }
      return this.failAmbiguous(outbox.id, OUTBOX_INCONSISTENT);
    }
    this.options.logger.info(
      {
        event: 'commercial-outbox.published',
        outboxId: outbox.id,
        commercialRunId: outbox.commercialRunId,
      },
      'Commercial dispatch outbox published',
    );
    return published;
  }

  private async readExistingJob(
    outbox: CommercialDispatchOutboxRecord,
  ): Promise<CommercialDispatchOutboxJob | null> {
    if (this.options.queue.getJob) {
      return this.options.queue.getJob(outbox.jobId);
    }
    const exists = await this.options.queue.hasJob(outbox.jobId);
    return exists
      ? {
          id: outbox.jobId,
          dispatchId: outbox.dispatchId,
          instanceName: outbox.instanceName,
        }
      : null;
  }

  private jobMatchesOutbox(
    job: CommercialDispatchOutboxJob,
    outbox: CommercialDispatchOutboxRecord,
  ) {
    return (
      job.id === outbox.jobId &&
      job.dispatchId === outbox.dispatchId &&
      (job.instanceName ?? null) === (outbox.instanceName ?? null)
    );
  }

  private throwSentMetadataPending(outboxId: string): never {
    this.options.logger.error(
      {
        event: 'commercial-outbox.sent-metadata-pending',
        outboxId,
        providerRetryAllowed: false,
        requeueAllowed: false,
      },
      'Commercial dispatch is already SENT while outbox metadata converges',
    );
    throw new AppError(
      'Dispatch comercial ja enviado exige convergencia de metadata',
      'COMMERCIAL_OUTBOX_SENT_METADATA_PENDING',
    );
  }

  private async failAmbiguous(
    outboxId: string,
    failureCode: string,
  ): Promise<never> {
    await this.options.outboxes.markAmbiguous(
      outboxId,
      failureCode,
      this.clock(),
    );
    this.options.logger.error(
      { event: 'commercial-outbox.ambiguous', outboxId, failureCode },
      'Commercial dispatch outbox is ambiguous',
    );
    throw new AppError(
      'Publicacao comercial exige investigacao manual',
      'COMMERCIAL_OUTBOX_AMBIGUOUS',
    );
  }
}
