import { describe, expect, it, vi } from 'vitest';
import type { DatabaseClient } from '@shopee-auto-affiliate-ai/database';
import { AppError } from '@shopee-auto-affiliate-ai/shared';

import { buildAuthenticatedTestApp } from './authenticated-test-app';

const publicGroup = {
  id: 'group-1',
  name: 'Grupo controlado',
  fingerprint: 'grp_0123456789ab',
  memberCount: 3,
  ownerIsParticipant: null,
  active: false,
  available: true,
  discoveredAt: '2026-07-24T12:00:00.000Z',
  lastSyncedAt: '2026-07-24T12:00:00.000Z',
  updatedAt: null,
};

const buildHarness = async () => {
  const service = {
    sync: vi.fn(async () => ({
      discovered: 1,
      created: 1,
      updated: 0,
      unavailable: 0,
      active: 0,
    })),
    list: vi.fn(async () => [publicGroup]),
    find: vi.fn(async () => publicGroup),
    setActive: vi.fn(async (_id: string, active: boolean) => ({
      ...publicGroup,
      active,
    })),
  };
  const app = await buildAuthenticatedTestApp({
    logger: false,
    prisma: {} as DatabaseClient,
    groupDirectoryService: service,
    pipelineQueue: { add: vi.fn(), close: vi.fn() } as never,
  });
  return { app, service };
};

describe('rotas de grupos WhatsApp', () => {
  it('sincroniza com relatorio sanitizado e sem rota de envio', async () => {
    const { app, service } = await buildHarness();
    const response = await app.inject({
      method: 'POST',
      url: '/whatsapp/groups/sync',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      discovered: 1,
      created: 1,
      updated: 0,
      unavailable: 0,
      active: 0,
    });
    expect(service.sync).toHaveBeenCalledOnce();
    expect(
      (await app.inject({ method: 'POST', url: '/whatsapp/groups/send' }))
        .statusCode,
    ).toBe(404);
    await app.close();
  });

  it('lista e detalha sem JID, participantes ou identificador externo', async () => {
    const { app } = await buildHarness();
    for (const url of ['/whatsapp/groups', '/whatsapp/groups/group-1']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(200);
      const body = response.body;
      expect(body).not.toContain('@g.us');
      expect(body).not.toContain('participants');
      expect(body).not.toContain('externalGroupId');
    }
    await app.close();
  });

  it('repassa filtros booleanos e rejeita filtro invalido', async () => {
    const { app, service } = await buildHarness();
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/whatsapp/groups?active=true&available=false',
        })
      ).statusCode,
    ).toBe(200);
    expect(service.list).toHaveBeenLastCalledWith({
      active: true,
      available: false,
    });
    expect(
      (await app.inject({ method: 'GET', url: '/whatsapp/groups?active=1' }))
        .statusCode,
    ).toBe(400);
    await app.close();
  });

  it('exige confirmacao visual exata para autorizar e permite desautorizar', async () => {
    const { app, service } = await buildHarness();
    await app.inject({
      method: 'PATCH',
      url: '/whatsapp/groups/group-1',
      payload: { active: true, confirm: 'AUTORIZAR_GRUPO' },
    });
    expect(service.setActive).toHaveBeenLastCalledWith(
      'group-1',
      true,
      'AUTORIZAR_GRUPO',
    );
    await app.inject({
      method: 'PATCH',
      url: '/whatsapp/groups/group-1',
      payload: { active: false },
    });
    expect(service.setActive).toHaveBeenLastCalledWith(
      'group-1',
      false,
      undefined,
    );
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: '/whatsapp/groups/group-1',
          payload: { name: 'nao permitido' },
        })
      ).statusCode,
    ).toBe(400);
    await app.close();
  });

  it('mapeia grupo indisponivel e falha de sync sem resposta bruta', async () => {
    const { app, service } = await buildHarness();
    service.setActive.mockRejectedValueOnce(
      new AppError(
        'Grupo indisponivel nao pode ser autorizado',
        'WHATSAPP_GROUP_UNAVAILABLE',
      ),
    );
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: '/whatsapp/groups/group-1',
          payload: { active: true, confirm: 'AUTORIZAR_GRUPO' },
        })
      ).statusCode,
    ).toBe(409);
    service.sync.mockRejectedValueOnce(new Error('raw-sensitive-upstream'));
    const response = await app.inject({
      method: 'POST',
      url: '/whatsapp/groups/sync',
    });
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain('raw-sensitive-upstream');
    await app.close();
  });
});
