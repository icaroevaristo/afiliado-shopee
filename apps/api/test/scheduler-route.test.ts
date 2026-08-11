import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PIPELINE_SCHEDULER_JOB_ID } from '@shopee-auto-affiliate-ai/queue';
import { buildAuthenticatedTestApp } from './authenticated-test-app';

const publicStatus = {
  enabled: true,
  status: 'registered' as const,
  jobId: DEFAULT_PIPELINE_SCHEDULER_JOB_ID,
  queue: 'product-pipeline' as const,
  jobName: 'pipeline-product' as const,
  cronExpression: '0 8 * * *',
  timezone: 'America/Sao_Paulo',
  nextRunAt: '2026-07-25T11:00:00.000Z',
};

const createPrismaMock = () => ({ $disconnect: vi.fn() });

const createPipelineQueueMock = () => ({
  add: vi.fn(async () => ({ id: 'job-1' })),
  close: vi.fn(async () => undefined),
});

describe('GET /scheduler', () => {
  it('retorna HTTP 200 com o contrato publico exato', async () => {
    const getStatus = vi.fn(async () => publicStatus);
    const app = await buildAuthenticatedTestApp({
      logger: false,
      prisma: createPrismaMock() as never,
      schedulerStatusServiceFactory: () => ({ getStatus }),
    });

    const response = await app.inject({ method: 'GET', url: '/scheduler' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(publicStatus);
    expect(Object.keys(response.json())).toEqual(Object.keys(publicStatus));
    expect(getStatus).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('retorna 503 seguro quando o estado esta indisponivel', async () => {
    const secret = 'redis://user:secret@private-host:6379';
    const getStatus = vi.fn(async () => {
      const error = new Error(`Connection failed: ${secret}`);
      error.stack = `STACK_WITH_SECRET ${secret}`;
      throw error;
    });
    const app = await buildAuthenticatedTestApp({
      logger: false,
      prisma: createPrismaMock() as never,
      schedulerStatusServiceFactory: () => ({ getStatus }),
    });

    const response = await app.inject({ method: 'GET', url: '/scheduler' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: 'SCHEDULER_STATUS_UNAVAILABLE',
      message: 'Estado do Scheduler indisponivel',
    });
    expect(response.body).not.toContain(secret);
    expect(response.body).not.toContain('private-host');
    expect(response.body).not.toContain('STACK_WITH_SECRET');
    await app.close();
  });

  it('cria a facade uma vez, mesmo em multiplas requests', async () => {
    const getStatus = vi.fn(async () => publicStatus);
    const schedulerStatusServiceFactory = vi.fn(() => ({ getStatus }));
    const app = await buildAuthenticatedTestApp({
      logger: false,
      prisma: createPrismaMock() as never,
      schedulerStatusServiceFactory,
    });

    expect(schedulerStatusServiceFactory).toHaveBeenCalledTimes(1);
    await app.inject({ method: 'GET', url: '/scheduler' });
    await app.inject({ method: 'GET', url: '/scheduler' });

    expect(schedulerStatusServiceFactory).toHaveBeenCalledTimes(1);
    expect(getStatus).toHaveBeenCalledTimes(2);
    await app.close();
  });

  it('fecha recursos e nao adiciona jobs nem executa o pipeline', async () => {
    const pipelineQueue = createPipelineQueueMock();
    const getStatus = vi.fn(async () => publicStatus);
    const app = await buildAuthenticatedTestApp({
      logger: false,
      prisma: createPrismaMock() as never,
      pipelineQueue,
      schedulerStatusServiceFactory: () => ({ getStatus }),
    });

    const response = await app.inject({ method: 'GET', url: '/scheduler' });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(pipelineQueue.add).not.toHaveBeenCalled();
    expect(pipelineQueue.close).toHaveBeenCalledTimes(1);
  });
});
