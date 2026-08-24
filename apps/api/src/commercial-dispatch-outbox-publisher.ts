import { AppError } from '@shopee-auto-affiliate-ai/shared';

import type {
  CommercialDispatchOutboxPublicationContext,
  CommercialDispatchOutboxRecord,
  CommercialDispatchOutboxRepository,
} from './repositories';

export type CommercialDispatchOutboxQueue = {
  hasJob(jobId: string): Promise<boolean>;
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
      return this.failAmbiguous(context.outbox.id, OUTBOX_INCONSISTENT);
    }
    const { outbox } = context;
    let jobExists: boolean;
    try {
      jobExists = await this.options.queue.hasJob(outbox.jobId);
    } catch {
      return this.failAmbiguous(outbox.id, OUTBOX_PUBLICATION_UNCERTAIN);
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

    if (
      context.dispatch.status !== 'PENDING' ||
      context.dispatch.attemptCount !== 0
    ) {
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
          jobExists = await this.options.queue.hasJob(outbox.jobId);
        } catch {
          jobExists = false;
        }
        if (!jobExists) {
          return this.failAmbiguous(outbox.id, OUTBOX_PUBLICATION_UNCERTAIN);
        }
      }
    }

    const published = await this.options.outboxes.markPublished(
      outbox.id,
      this.clock(),
    );
    if (!published) {
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
