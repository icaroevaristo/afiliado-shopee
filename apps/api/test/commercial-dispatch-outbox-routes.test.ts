import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildAuthenticatedTestApp } from './authenticated-test-app';
import type { CommercialDispatchOutboxService } from '../src/commercial-dispatch-outbox-service';

const apps: Array<Awaited<ReturnType<typeof buildAuthenticatedTestApp>>> = [];

const createApp = async () => {
  const list = vi.fn(async (input) => ({
    items: [
      {
        id: 'outbox-id',
        commercialRunId: 'run-id',
        dispatchId: 'dispatch-id',
        jobId: 'job-id',
        status: 'pending',
        failureCode: null,
        createdAt: '2026-07-28T12:00:00.000Z',
        publishedAt: null,
      },
    ],
    ...input,
    total: 1,
    totalPages: 1,
  }));
  const find = vi.fn(async (id: string) => ({
    id,
    commercialRunId: 'run-id',
    dispatchId: 'dispatch-id',
    jobId: 'job-id',
    status: 'published' as const,
    failureCode: null,
    createdAt: '2026-07-28T12:00:00.000Z',
    publishedAt: '2026-07-28T12:00:01.000Z',
  }));
  const dispatchAdd = vi.fn();
  const app = await buildAuthenticatedTestApp({
    logger: false,
    prisma: {} as never,
    commercialDispatchOutboxService: {
      list,
      find,
    } as Pick<CommercialDispatchOutboxService, 'list' | 'find'>,
    whatsappDispatchQueue: { add: dispatchAdd, getJob: vi.fn() },
  });
  apps.push(app);
  return { app, list, find, dispatchAdd };
};

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('commercial dispatch outbox routes', () => {
  it('lista com paginacao, filtro e resposta sanitizada', async () => {
    const subject = await createApp();
    const response = await subject.app.inject({
      method: 'GET',
      url: '/commercial-automation/outbox?page=2&limit=10&status=pending',
    });

    expect(response.statusCode).toBe(200);
    expect(subject.list).toHaveBeenCalledWith({
      page: 2,
      limit: 10,
      status: 'PENDING',
    });
    expect(JSON.stringify(response.json())).not.toMatch(
      /message|destination|jid|phone|apiKey|payload/iu,
    );
    expect(subject.dispatchAdd).not.toHaveBeenCalled();
  });

  it('consulta um outbox sem publicar', async () => {
    const subject = await createApp();
    const response = await subject.app.inject({
      method: 'GET',
      url: '/commercial-automation/outbox/outbox-id',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: 'outbox-id',
      status: 'published',
    });
    expect(subject.find).toHaveBeenCalledWith('outbox-id');
    expect(subject.dispatchAdd).not.toHaveBeenCalled();
  });

  it('rejeita paginacao e status invalidos', async () => {
    const subject = await createApp();
    for (const url of [
      '/commercial-automation/outbox?page=0',
      '/commercial-automation/outbox?status=processing',
    ]) {
      const response = await subject.app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(400);
    }
    expect(subject.list).not.toHaveBeenCalled();
  });
});
