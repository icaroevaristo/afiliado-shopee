import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildAuthenticatedTestApp } from './authenticated-test-app';
import { sanitizeCommercialAutomationExecution } from '../src/commercial-automation-execution-service';

const apps: Array<Awaited<ReturnType<typeof buildAuthenticatedTestApp>>> = [];

const schedulerStatus = {
  enabled: false,
  status: 'disabled' as const,
  jobId: 'scheduled-commercial-automation' as const,
  queue: 'commercial-automation' as const,
  jobName: 'commercial-automation-tick' as const,
  cron: '0 9 * * *',
  timezone: 'America/Sao_Paulo',
  nextRunAt: null,
  mode: 'preview' as const,
};

const execution = {
  id: 'execution-1',
  schedulerJobId: 'scheduled-commercial-automation',
  bullMqJobId: 'job-1',
  mode: 'preview' as const,
  status: 'preview-ready' as const,
  reasons: [] as string[],
  commercialRunId: 'run-1',
  failureCode: null,
  stale: false,
  heartbeatAt: '2026-07-26T15:00:00.500Z',
  leaseExpiresAt: '2026-07-26T15:02:00.000Z',
  startedAt: '2026-07-26T15:00:00.000Z',
  completedAt: '2026-07-26T15:00:01.000Z',
};

const createApp = async () => {
  const getStatus = vi.fn(async () => schedulerStatus);
  const list = vi.fn(async () => ({
    items: [execution],
    page: 1,
    limit: 20,
    total: 1,
    totalPages: 1,
  }));
  const find = vi.fn(async () => execution);
  const app = await buildAuthenticatedTestApp({
    logger: false,
    prisma: { $disconnect: vi.fn() } as never,
    commercialAutomationSchedulerStatusServiceFactory: () => ({ getStatus }),
    commercialAutomationExecutionService: { list, find },
  });
  apps.push(app);
  return { app, getStatus, list, find };
};

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('commercial automation scheduler read-only routes', () => {
  it('sanitiza lease e stale sem expor ownerId', () => {
    const result = sanitizeCommercialAutomationExecution(
      {
        id: 'execution-legacy',
        schedulerJobId: 'scheduler',
        bullMqJobId: null,
        activeKey: 'commercial-automation',
        ownerId: null,
        heartbeatAt: null,
        leaseExpiresAt: null,
        mode: 'PREVIEW',
        status: 'STARTED',
        reasons: [],
        commercialRunId: null,
        failureCode: null,
        startedAt: new Date('2026-07-26T15:00:00.000Z'),
        completedAt: null,
      },
      new Date('2026-07-26T15:01:00.000Z'),
    );

    expect(result).toMatchObject({
      stale: true,
      heartbeatAt: null,
      leaseExpiresAt: null,
    });
    expect(result).not.toHaveProperty('ownerId');
    expect(result).not.toHaveProperty('activeKey');
  });
  it('retorna o Scheduler comercial sanitizado sem registrar ou disparar tick', async () => {
    const subject = await createApp();
    const response = await subject.app.inject({
      method: 'GET',
      url: '/commercial-automation/scheduler',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(schedulerStatus);
    expect(subject.getStatus).toHaveBeenCalledOnce();
  });

  it('lista e detalha execucoes sanitizadas', async () => {
    const subject = await createApp();
    const listResponse = await subject.app.inject({
      method: 'GET',
      url: '/commercial-automation/executions',
    });
    const detailResponse = await subject.app.inject({
      method: 'GET',
      url: '/commercial-automation/executions/execution-1',
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().items).toEqual([execution]);
    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json()).toEqual(execution);
    expect(subject.list).toHaveBeenCalledWith({ page: 1, limit: 20 });
    expect(subject.find).toHaveBeenCalledWith('execution-1');
  });

  it('nao expoe endpoint para disparar tick ou habilitar Scheduler', async () => {
    const subject = await createApp();
    for (const path of [
      '/commercial-automation/tick',
      '/commercial-automation/scheduler',
    ]) {
      const response = await subject.app.inject({ method: 'POST', url: path });
      expect(response.statusCode).toBe(404);
    }
  });

  it('retorna 503 sem detalhes internos quando o Scheduler falha', async () => {
    const secret = 'redis://user:secret@private-host:6379';
    const app = await buildAuthenticatedTestApp({
      logger: false,
      prisma: { $disconnect: vi.fn() } as never,
      commercialAutomationSchedulerStatusServiceFactory: () => ({
        getStatus: vi.fn(async () => {
          throw new Error(secret);
        }),
      }),
      commercialAutomationExecutionService: {
        list: vi.fn(),
        find: vi.fn(),
      },
    });
    apps.push(app);

    const response = await app.inject({
      method: 'GET',
      url: '/commercial-automation/scheduler',
    });
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain(secret);
    expect(response.body).not.toContain('private-host');
  });
});
