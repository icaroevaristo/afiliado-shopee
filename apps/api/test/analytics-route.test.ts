import { describe, expect, it, vi } from 'vitest';

import { buildAuthenticatedTestApp } from './authenticated-test-app';
import type { AnalyticsSnapshot } from '../src/repositories';

const snapshot: AnalyticsSnapshot = {
  totalProducts: 40,
  totalApprovedProducts: 12,
  totalGeneratedCopies: 18,
  totalQueuedDispatches: 3,
  totalSentDispatches: 10,
  totalFailedDispatches: 2,
  totalActiveDestinations: 4,
};

const zeroSnapshot: AnalyticsSnapshot = {
  totalProducts: 0,
  totalApprovedProducts: 0,
  totalGeneratedCopies: 0,
  totalQueuedDispatches: 0,
  totalSentDispatches: 0,
  totalFailedDispatches: 0,
  totalActiveDestinations: 0,
};

describe('GET /analytics', () => {
  it('retorna o snapshot exato e chama o servico uma vez', async () => {
    const getSnapshot = vi.fn(async () => snapshot);
    const app = await buildAuthenticatedTestApp({
      logger: false,
      prisma: {} as never,
      analyticsService: { getSnapshot },
    });

    const response = await app.inject({ method: 'GET', url: '/analytics' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(snapshot);
    expect(Object.keys(response.json())).toEqual(Object.keys(snapshot));
    expect(getSnapshot).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('preserva o snapshot zerado', async () => {
    const app = await buildAuthenticatedTestApp({
      logger: false,
      prisma: {} as never,
      analyticsService: { getSnapshot: vi.fn(async () => zeroSnapshot) },
    });

    const response = await app.inject({ method: 'GET', url: '/analytics' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(zeroSnapshot);
    await app.close();
  });

  it('retorna erro padronizado sem expor detalhes internos', async () => {
    const getSnapshot = vi.fn(async (): Promise<AnalyticsSnapshot> => {
      throw new Error('Prisma connection failed at secret-host');
    });
    const app = await buildAuthenticatedTestApp({
      logger: false,
      prisma: {} as never,
      analyticsService: { getSnapshot },
    });

    const response = await app.inject({ method: 'GET', url: '/analytics' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: 'ANALYTICS_FETCH_FAILED',
      message: 'Falha ao consultar analytics',
    });
    expect(response.body).not.toContain('Prisma');
    expect(response.body).not.toContain('secret-host');
    expect(response.body).not.toContain('stack');
    await app.close();
  });

  it('nao acessa Prisma diretamente quando o servico esta injetado', async () => {
    const count = vi.fn(() => {
      throw new Error('A rota acessou Prisma diretamente');
    });
    const prisma = {
      productLead: { count },
      generatedCopy: { count },
      whatsAppDispatch: { count },
      whatsAppDestination: { count },
    };
    const app = await buildAuthenticatedTestApp({
      logger: false,
      prisma: prisma as never,
      analyticsService: { getSnapshot: vi.fn(async () => snapshot) },
    });

    const response = await app.inject({ method: 'GET', url: '/analytics' });

    expect(response.statusCode).toBe(200);
    expect(count).not.toHaveBeenCalled();
    await app.close();
  });
});
