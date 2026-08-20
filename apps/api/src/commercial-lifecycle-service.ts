import type {
  CommercialLifecycleRecord,
  CommercialLifecycleRepository,
} from './commercial-lifecycle-repository';
import { getLocalDayRange } from './commercial-automation-policy-service';

export type CommercialLifecycleQueueName =
  'whatsapp-dispatch' | 'commercial-automation';

export type CommercialLifecycleJob = {
  attemptsMade: number;
  processedOn?: number;
  finishedOn?: number;
  failedReason?: string;
  getState(): Promise<string>;
};

export type CommercialLifecycleQueueCounts = {
  waiting: number;
  active: number;
  failed: number;
};

export type CommercialLifecycleQueueReader = {
  getJob(
    queue: CommercialLifecycleQueueName,
    jobId: string,
  ): Promise<CommercialLifecycleJob | null | undefined>;
  getJobCounts?(
    queue: CommercialLifecycleQueueName,
  ): Promise<CommercialLifecycleQueueCounts | null>;
};

export type CommercialLifecycleTimelineEvent = {
  type:
    | 'EXECUTION_CREATED'
    | 'CANDIDATE_LINKED'
    | 'COPY_CREATED'
    | 'COPY_ATTEMPT'
    | 'RESERVATION_RECORDED'
    | 'RUN_CREATED'
    | 'CONFIRMATION_RECORDED'
    | 'DISPATCH_CREATED'
    | 'OUTBOX_CREATED'
    | 'OUTBOX_PUBLISHED'
    | 'JOB_PROCESSED'
    | 'JOB_FINISHED'
    | 'FINALIZED';
  label: string;
  at: string;
};

export type CommercialLifecycleJobView = {
  queue: CommercialLifecycleQueueName;
  jobId: string;
  state: string;
  attemptsMade: number | null;
  processedOn: string | null;
  finishedOn: string | null;
  failedReason: string | null;
};

const toIso = (value: Date | null | undefined) =>
  value ? value.toISOString() : null;

const toTimeline = (
  record: CommercialLifecycleRecord,
  job: CommercialLifecycleJobView | null,
): CommercialLifecycleTimelineEvent[] => {
  const events: Array<
    CommercialLifecycleTimelineEvent & { timestamp: number }
  > = [];
  const add = (
    type: CommercialLifecycleTimelineEvent['type'],
    label: string,
    value: Date | null | undefined,
  ) => {
    if (!value) return;
    events.push({
      type,
      label,
      at: value.toISOString(),
      timestamp: value.getTime(),
    });
  };

  add('EXECUTION_CREATED', 'Execucao criada', record.execution?.startedAt);
  add('CANDIDATE_LINKED', 'Candidato vinculado', record.candidate?.createdAt);
  add('COPY_CREATED', 'GeneratedCopy criada', record.copy?.createdAt);
  add(
    'COPY_ATTEMPT',
    'Tentativa de copy registrada',
    record.copyAttempt?.startedAt,
  );
  add(
    'RESERVATION_RECORDED',
    'Reserva registrada',
    record.reservation?.attemptReservedAt,
  );
  add('RUN_CREATED', 'Run criado', record.run?.createdAt);
  add(
    'CONFIRMATION_RECORDED',
    'Confirmacao registrada',
    record.run?.confirmedAt,
  );
  add('DISPATCH_CREATED', 'Dispatch criado', record.dispatch?.createdAt);
  add('OUTBOX_CREATED', 'Outbox criado', record.outbox?.createdAt);
  add('OUTBOX_PUBLISHED', 'Outbox publicado', record.outbox?.publishedAt);
  add(
    'JOB_PROCESSED',
    'Job processado',
    job?.processedOn ? new Date(job.processedOn) : null,
  );
  add(
    'JOB_FINISHED',
    'Job finalizado',
    job?.finishedOn ? new Date(job.finishedOn) : null,
  );
  add(
    'FINALIZED',
    'Lifecycle finalizado',
    record.run?.completedAt ?? record.dispatch?.sentAt,
  );

  return events
    .sort((left, right) => left.timestamp - right.timestamp)
    .map((event) => ({
      type: event.type,
      label: event.label,
      at: event.at,
    }));
};

const serializeRecord = (
  record: CommercialLifecycleRecord,
  job: CommercialLifecycleJobView | null,
) => ({
  lifecycleId: record.lifecycleId,
  createdAt: record.createdAt.toISOString(),
  execution: record.execution
    ? {
        ...record.execution,
        leaseExpiresAt: toIso(record.execution.leaseExpiresAt),
        startedAt: record.execution.startedAt.toISOString(),
        completedAt: toIso(record.execution.completedAt),
      }
    : null,
  run: record.run
    ? {
        ...record.run,
        confirmedAt: toIso(record.run.confirmedAt),
        createdAt: record.run.createdAt.toISOString(),
        completedAt: toIso(record.run.completedAt),
      }
    : null,
  candidate: record.candidate
    ? {
        ...record.candidate,
        createdAt: record.candidate.createdAt.toISOString(),
        updatedAt: record.candidate.updatedAt.toISOString(),
      }
    : null,
  copy: record.copy
    ? {
        ...record.copy,
        createdAt: record.copy.createdAt.toISOString(),
      }
    : null,
  copyAttempt: record.copyAttempt
    ? {
        ...record.copyAttempt,
        startedAt: record.copyAttempt.startedAt.toISOString(),
        completedAt: toIso(record.copyAttempt.completedAt),
      }
    : null,
  dispatch: record.dispatch
    ? {
        ...record.dispatch,
        sentAt: toIso(record.dispatch.sentAt),
        createdAt: record.dispatch.createdAt.toISOString(),
        updatedAt: record.dispatch.updatedAt.toISOString(),
      }
    : null,
  outbox: record.outbox
    ? {
        ...record.outbox,
        createdAt: record.outbox.createdAt.toISOString(),
        publishedAt: toIso(record.outbox.publishedAt),
      }
    : null,
  reservation: record.reservation
    ? {
        ...record.reservation,
        attemptReservedAt: toIso(record.reservation.attemptReservedAt),
        attemptLeaseExpiresAt: toIso(record.reservation.attemptLeaseExpiresAt),
      }
    : null,
  recovery: record.recovery
    ? {
        ...record.recovery,
        authorizedAt: record.recovery.authorizedAt.toISOString(),
        rearmedAt: toIso(record.recovery.rearmedAt),
        requeuedAt: toIso(record.recovery.requeuedAt),
      }
    : null,
  bullmq: job,
  timeline: toTimeline(record, job),
});

export class CommercialLifecycleService {
  constructor(
    private readonly repository: CommercialLifecycleRepository,
    private readonly queues: CommercialLifecycleQueueReader,
    private readonly clock: () => Date = () => new Date(),
    private readonly timezone = 'America/Sao_Paulo',
  ) {}

  async list(input: { page: number; limit: number }) {
    const now = this.clock();
    const todayStart = getLocalDayRange(now, this.timezone).dayStartsAt;
    const result = await this.repository.list({
      page: input.page,
      limit: input.limit,
      now,
      todayStart,
    });
    const items = await Promise.all(
      result.items.map(async (record) => {
        const job = await this.loadJob(record);
        return serializeRecord(record, job);
      }),
    );
    const dispatchCounts = this.queues.getJobCounts
      ? await this.queues.getJobCounts('whatsapp-dispatch')
      : null;
    return {
      items,
      page: input.page,
      limit: input.limit,
      total: result.total,
      totalPages: Math.max(1, Math.ceil(result.total / input.limit)),
      summary: {
        ...result.summary,
        jobs: dispatchCounts,
      },
    };
  }

  private async loadJob(
    record: CommercialLifecycleRecord,
  ): Promise<CommercialLifecycleJobView | null> {
    const reference = record.run?.jobId
      ? { queue: 'whatsapp-dispatch' as const, jobId: record.run.jobId }
      : record.execution?.bullMqJobId
        ? {
            queue: 'commercial-automation' as const,
            jobId: record.execution.bullMqJobId,
          }
        : null;
    if (!reference) return null;
    const job = await this.queues.getJob(reference.queue, reference.jobId);
    if (!job) {
      return {
        queue: reference.queue,
        jobId: reference.jobId,
        state: 'missing',
        attemptsMade: null,
        processedOn: null,
        finishedOn: null,
        failedReason: null,
      };
    }
    return {
      queue: reference.queue,
      jobId: reference.jobId,
      state: await job.getState(),
      attemptsMade: job.attemptsMade,
      processedOn: toIso(job.processedOn ? new Date(job.processedOn) : null),
      finishedOn: toIso(job.finishedOn ? new Date(job.finishedOn) : null),
      failedReason: job.failedReason?.slice(0, 500) ?? null,
    };
  }
}
