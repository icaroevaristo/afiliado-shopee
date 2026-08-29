import { describe, expect, it, vi } from 'vitest';

import { CommercialDispatchOutboxPublisher } from '../src/commercial-dispatch-outbox-publisher';
import type {
  CommercialDispatchOutboxPublicationContext,
  CommercialDispatchOutboxRecord,
  CommercialDispatchOutboxRepository,
} from '../src/repositories';

const now = new Date('2026-07-28T12:00:00.000Z');

const build = ({
  outboxStatus = 'PENDING',
  dispatchStatus = 'PENDING',
  attemptCount = 0,
  runJobId = null,
  jobExists = false,
  instanceName = null,
  useGetJob = false,
  jobDispatchId = 'dispatch-id',
  jobInstanceName = instanceName,
}: {
  outboxStatus?: CommercialDispatchOutboxRecord['status'];
  dispatchStatus?: CommercialDispatchOutboxPublicationContext['dispatch']['status'];
  attemptCount?: number;
  runJobId?: string | null;
  jobExists?: boolean;
  instanceName?: string | null;
  useGetJob?: boolean;
  jobDispatchId?: string;
  jobInstanceName?: string | null;
} = {}) => {
  const record: CommercialDispatchOutboxRecord = {
    id: 'outbox-id',
    commercialRunId: 'run-id',
    dispatchId: 'dispatch-id',
    jobId: 'job-id',
    status: outboxStatus,
    instanceName,
    failureCode: null,
    createdAt: now,
    publishedAt: outboxStatus === 'PUBLISHED' ? now : null,
  };
  const context: CommercialDispatchOutboxPublicationContext = {
    outbox: record,
    run: {
      id: 'run-id',
      mode: 'CONFIRMED',
      status: 'STARTED',
      dispatchId: 'dispatch-id',
      jobId: runJobId,
      finalStatus: 'PENDING',
      investigationRequired: false,
      instanceName,
    },
    dispatch: {
      id: 'dispatch-id',
      status: dispatchStatus,
      attemptCount,
      instanceName,
      externalMessageId: dispatchStatus === 'SENT' ? 'external-id' : null,
      sentAt: dispatchStatus === 'SENT' ? now : null,
    },
  };
  const jobs = new Set(jobExists ? ['job-id'] : []);
  const enqueue = vi.fn(
    async (_dispatchId: string, jobId: string, queuedInstanceName?: string | null) => {
      expect(queuedInstanceName ?? null).toBe(instanceName);
      jobs.add(jobId);
    },
  );
  const markPublished = vi.fn(
    async (
      _id: string,
      publishedAt: Date,
    ): Promise<CommercialDispatchOutboxRecord | null> => {
      record.status = 'PUBLISHED';
      record.publishedAt = publishedAt;
      context.run.jobId = record.jobId;
      return record;
    },
  );
  const markAmbiguous = vi.fn(async (_id: string, failureCode: string) => {
    record.status = 'AMBIGUOUS';
    record.failureCode = failureCode;
    context.run.investigationRequired = true;
    return record;
  });
  const outboxes = {
    findPublicationContext: vi.fn(async () => context),
    markPublished,
    markAmbiguous,
  } as unknown as CommercialDispatchOutboxRepository;
  const hasJob = vi.fn(async (jobId: string) => jobs.has(jobId));
  const getJob = vi.fn(async (jobId: string) =>
    jobs.has(jobId)
      ? {
          id: jobId,
          dispatchId: jobDispatchId,
          instanceName: jobInstanceName,
        }
      : null,
  );
  const publisher = new CommercialDispatchOutboxPublisher({
    outboxes,
    queue: {
      hasJob,
      ...(useGetJob ? { getJob } : {}),
      enqueue,
    },
    logger: { info: vi.fn(), error: vi.fn() },
    clock: () => now,
  });
  return {
    publisher,
    context,
    record,
    jobs,
    enqueue,
    hasJob,
    getJob,
    markPublished,
    markAmbiguous,
  };
};

describe('CommercialDispatchOutboxPublisher', () => {
  it('marca PUBLISHED sem enqueue quando o job deterministico ja existe', async () => {
    const state = build({ jobExists: true });
    await expect(state.publisher.publish('outbox-id')).resolves.toMatchObject({
      status: 'PUBLISHED',
    });
    expect(state.enqueue).not.toHaveBeenCalled();
    expect(state.markPublished).toHaveBeenCalledOnce();
    expect(state.context.run.jobId).toBe('job-id');
  });

  it('enfileira uma vez e marca PUBLISHED quando o job esta ausente', async () => {
    const state = build();
    await state.publisher.publish('outbox-id');
    expect(state.enqueue).toHaveBeenCalledOnce();
    expect(state.enqueue).toHaveBeenCalledWith('dispatch-id', 'job-id');
    expect(state.jobs).toEqual(new Set(['job-id']));
    expect(state.record.status).toBe('PUBLISHED');
  });

  it('transporta a instancia persistida para o job novo', async () => {
    const state = build({ instanceName: 'instance-a' });

    await state.publisher.publish('outbox-id');

    expect(state.enqueue).toHaveBeenCalledWith(
      'dispatch-id',
      'job-id',
      'instance-a',
    );
    expect(state.record.status).toBe('PUBLISHED');
  });

  it('trata falha de enqueue como sucesso quando a releitura comprova o job', async () => {
    const state = build();
    state.enqueue.mockImplementationOnce(async (_dispatchId, jobId) => {
      state.jobs.add(jobId);
      throw new Error('connection lost after write');
    });
    await expect(state.publisher.publish('outbox-id')).resolves.toMatchObject({
      status: 'PUBLISHED',
    });
    expect(state.hasJob).toHaveBeenCalledTimes(2);
    expect(state.markAmbiguous).not.toHaveBeenCalled();
  });

  it('preserva incerteza como AMBIGUOUS sem repetir enqueue', async () => {
    const state = build();
    state.enqueue.mockRejectedValueOnce(new Error('redis unavailable'));
    await expect(state.publisher.publish('outbox-id')).rejects.toMatchObject({
      code: 'COMMERCIAL_OUTBOX_AMBIGUOUS',
    });
    expect(state.enqueue).toHaveBeenCalledOnce();
    expect(state.markAmbiguous).toHaveBeenCalledWith(
      'outbox-id',
      'COMMERCIAL_OUTBOX_PUBLICATION_UNCERTAIN',
      now,
    );
  });

  it('deduplica publishers concorrentes pelo mesmo jobId', async () => {
    const state = build();
    await Promise.all([
      state.publisher.publish('outbox-id'),
      state.publisher.publish('outbox-id'),
    ]);
    expect(state.jobs).toEqual(new Set(['job-id']));
    expect(state.enqueue).toHaveBeenCalledWith('dispatch-id', 'job-id');
  });

  it('converge quando perde o CAS de publicacao para outro publisher', async () => {
    const state = build();
    state.markPublished.mockImplementationOnce(async (_id, publishedAt) => {
      state.record.status = 'PUBLISHED';
      state.record.publishedAt = publishedAt;
      state.context.run.jobId = state.record.jobId;
      return null;
    });

    await expect(state.publisher.publish('outbox-id')).resolves.toMatchObject({
      status: 'PUBLISHED',
    });
    expect(state.markAmbiguous).not.toHaveBeenCalled();
  });

  it('nao marca AMBIGUOUS quando o provider ja persistiu SENT durante a corrida', async () => {
    const state = build();
    state.markPublished.mockImplementationOnce(async () => {
      state.record.status = 'PENDING';
      state.context.dispatch.status = 'SENT';
      state.context.dispatch.attemptCount = 1;
      state.context.dispatch.externalMessageId = 'external-id';
      state.context.dispatch.sentAt = now;
      return null;
    });

    await expect(state.publisher.publish('outbox-id')).rejects.toMatchObject({
      code: 'COMMERCIAL_OUTBOX_SENT_METADATA_PENDING',
    });
    expect(state.markAmbiguous).not.toHaveBeenCalled();
    expect(state.record.status).toBe('PENDING');
  });

  it('recupera crash depois do enqueue sem duplicar o job', async () => {
    const state = build();
    state.markPublished.mockRejectedValueOnce(
      new Error('database unavailable'),
    );

    await expect(state.publisher.publish('outbox-id')).rejects.toThrow(
      'database unavailable',
    );
    expect(state.record.status).toBe('PENDING');
    expect(state.jobs).toEqual(new Set(['job-id']));

    await expect(state.publisher.publish('outbox-id')).resolves.toMatchObject({
      status: 'PUBLISHED',
    });
    expect(state.enqueue).toHaveBeenCalledOnce();
  });

  it('reconcile repetido de PUBLISHED apenas verifica o job', async () => {
    const state = build({
      outboxStatus: 'PUBLISHED',
      runJobId: 'job-id',
      jobExists: true,
    });
    await state.publisher.publish('outbox-id');
    await state.publisher.publish('outbox-id');
    expect(state.enqueue).not.toHaveBeenCalled();
    expect(state.markAmbiguous).not.toHaveBeenCalled();
  });

  it.each([
    ['PROCESSING', 1, 'COMMERCIAL_OUTBOX_AMBIGUOUS'],
    ['FAILED', 1, 'COMMERCIAL_OUTBOX_AMBIGUOUS'],
    ['SENT', 1, 'COMMERCIAL_OUTBOX_SENT_METADATA_PENDING'],
    ['PENDING', 1, 'COMMERCIAL_OUTBOX_AMBIGUOUS'],
  ] as const)(
    'bloqueia dispatch %s com attemptCount %i',
    async (dispatchStatus, attemptCount, expectedCode) => {
      const state = build({ dispatchStatus, attemptCount });
      await expect(state.publisher.publish('outbox-id')).rejects.toMatchObject({
        code: expectedCode,
      });
      expect(state.enqueue).not.toHaveBeenCalled();
      if (dispatchStatus === 'SENT') {
        expect(state.markAmbiguous).not.toHaveBeenCalled();
      } else {
        expect(state.markAmbiguous).toHaveBeenCalledOnce();
      }
    },
  );

  it('marca inconsistencia entre run, dispatch e outbox como AMBIGUOUS', async () => {
    const state = build();
    state.context.run.dispatchId = 'other-dispatch';
    await expect(state.publisher.publish('outbox-id')).rejects.toMatchObject({
      code: 'COMMERCIAL_OUTBOX_AMBIGUOUS',
    });
    expect(state.enqueue).not.toHaveBeenCalled();
    expect(state.record.failureCode).toBe('COMMERCIAL_OUTBOX_INCONSISTENT');
  });

  it('nao publica run que ja exige investigacao', async () => {
    const state = build();
    state.context.run.status = 'FAILED';
    state.context.run.finalStatus = 'AMBIGUOUS';
    state.context.run.investigationRequired = true;

    await expect(state.publisher.publish('outbox-id')).rejects.toMatchObject({
      code: 'COMMERCIAL_OUTBOX_AMBIGUOUS',
    });
    expect(state.enqueue).not.toHaveBeenCalled();
    expect(state.markAmbiguous).toHaveBeenCalledOnce();
  });

  it('reconhece PUBLISHED concluido sem exigir dispatch PENDING', async () => {
    const state = build({
      outboxStatus: 'PUBLISHED',
      dispatchStatus: 'SENT',
      attemptCount: 1,
      runJobId: 'job-id',
      jobExists: true,
    });
    state.context.run.status = 'COMPLETED';
    state.context.run.finalStatus = 'SENT';

    await expect(state.publisher.publish('outbox-id')).resolves.toMatchObject({
      status: 'PUBLISHED',
    });
    expect(state.enqueue).not.toHaveBeenCalled();
    expect(state.markAmbiguous).not.toHaveBeenCalled();
  });

  it('preserva SENT quando o job deterministico desaparece', async () => {
    const state = build({
      outboxStatus: 'PUBLISHED',
      dispatchStatus: 'SENT',
      attemptCount: 1,
      runJobId: 'job-id',
      jobExists: false,
    });

    await expect(state.publisher.publish('outbox-id')).rejects.toMatchObject({
      code: 'COMMERCIAL_OUTBOX_SENT_METADATA_PENDING',
    });
    expect(state.markAmbiguous).not.toHaveBeenCalled();
    expect(state.record.status).toBe('PUBLISHED');
  });

  it('falha fechado quando o job existente possui dispatch diferente', async () => {
    const state = build({
      jobExists: true,
      useGetJob: true,
      jobDispatchId: 'other-dispatch',
    });

    await expect(state.publisher.publish('outbox-id')).rejects.toMatchObject({
      code: 'COMMERCIAL_OUTBOX_AMBIGUOUS',
    });
    expect(state.enqueue).not.toHaveBeenCalled();
    expect(state.markAmbiguous).toHaveBeenCalledOnce();
  });
});
