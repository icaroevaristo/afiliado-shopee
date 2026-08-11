import { describe, expect, it, vi } from 'vitest';
import { JOB_NAMES } from '@shopee-auto-affiliate-ai/queue';
import { buildAuthenticatedTestApp } from './authenticated-test-app';

const createPrismaMock = () => ({ $disconnect: vi.fn() });

const createQueueMock = (jobFound = true) => ({
  add: vi.fn(async () => ({ id: 'job-1' })),
  getJob: vi.fn(async () =>
    jobFound
      ? {
          progress: 100,
          processedOn: Date.UTC(2026, 0, 1, 10, 0, 0),
          finishedOn: Date.UTC(2026, 0, 1, 10, 0, 1),
          returnvalue: { copiesGeradas: 1 },
          failedReason: undefined,
          getState: vi.fn(async () => 'completed'),
        }
      : null,
  ),
  close: vi.fn(async () => undefined),
});

describe('Pipeline BullMQ API', () => {
  it('cria o job pipeline-product sem executar o pipeline no endpoint', async () => {
    const pipelineQueue = createQueueMock();
    const app = await buildAuthenticatedTestApp({
      logger: false,
      prisma: createPrismaMock() as never,
      pipelineQueue,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/pipeline/run',
      payload: { filters: { categoria: 'Eletrônicos' } },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ jobId: 'job-1', status: 'queued' });
    expect(pipelineQueue.add).toHaveBeenCalledWith(
      JOB_NAMES.pipelineProduct,
      { filters: { categoria: 'Eletrônicos' } },
      undefined,
    );
    await app.close();
  });

  it('consulta status do job com relatório completo no result', async () => {
    const pipelineQueue = createQueueMock();
    const app = await buildAuthenticatedTestApp({
      logger: false,
      prisma: createPrismaMock() as never,
      pipelineQueue,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/pipeline/jobs/job-1',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'completed',
      progress: 100,
      startedAt: '2026-01-01T10:00:00.000Z',
      finishedAt: '2026-01-01T10:00:01.000Z',
      result: { copiesGeradas: 1 },
      error: null,
    });
    expect(pipelineQueue.getJob).toHaveBeenCalledWith('job-1');
    await app.close();
  });

  it('retorna 404 quando o job não existe', async () => {
    const pipelineQueue = createQueueMock(false);
    const app = await buildAuthenticatedTestApp({
      logger: false,
      prisma: createPrismaMock() as never,
      pipelineQueue,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/pipeline/jobs/missing',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: 'JOB_NOT_FOUND',
      message: 'Job não encontrado',
    });
    await app.close();
  });
});
