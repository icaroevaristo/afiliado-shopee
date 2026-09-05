import { describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app';
import { buildAuthenticatedTestApp } from './authenticated-test-app';

const createDeliveryService = () => ({
  consume: vi.fn(),
  expireDue: vi.fn(async () => ({ expired: 0 })),
});

const eventPayload = (status: number) => ({
  event: 'messages.update',
  instance: 'affiliate-instance',
  data: {
    key: {
      id: 'provider-message-id',
      remoteJid: '120363000000000000@g.us',
      fromMe: true,
    },
    update: { status },
    messageTimestamp: 1_787_000_000,
  },
});

describe('POST /whatsapp/events/messages.update', () => {
  it('exige a autenticação local antes de aceitar o webhook', async () => {
    const consume = vi.fn();
    const app = await buildApp({
      logger: false,
      localApiAuthToken: 'local-api-test-token',
      prisma: {} as never,
      deliveryConfirmationService: {
        consume,
        expireDue: vi.fn(async () => ({ expired: 0 })),
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/whatsapp/events/messages.update',
      payload: eventPayload(2),
    });

    expect(response.statusCode).toBe(401);
    expect(consume).not.toHaveBeenCalled();
    await app.close();
  });

  it.each([
    [2, 'SERVER_ACK'],
    [3, 'DELIVERY_ACK'],
    [4, 'READ'],
    [5, 'READ'],
  ] as const)('normaliza status Evolution %s para %s', async (status, expected) => {
    const service = createDeliveryService();
    service.consume.mockResolvedValue({ kind: 'UPDATED' });
    const app = await buildAuthenticatedTestApp({
      logger: false,
      prisma: {} as never,
      deliveryConfirmationService: service,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/whatsapp/events/messages.update',
      payload: eventPayload(status),
    });

    expect(response.statusCode).toBe(200);
    expect(service.consume).toHaveBeenCalledWith(
      expect.objectContaining({
        instanceName: 'affiliate-instance',
        externalMessageId: 'provider-message-id',
        status: expected,
        occurredAt: new Date(1_787_000_000 * 1000),
        receivedAt: expect.any(Date),
      }),
    );
    expect(response.body).not.toContain('remoteJid');
    expect(response.body).not.toContain('provider-message-id');
    await app.close();
  });

  it('delega duplicatas ao consumer idempotente sem armazenar o envelope bruto', async () => {
    const service = createDeliveryService();
    service.consume
      .mockResolvedValueOnce({ kind: 'UPDATED' })
      .mockResolvedValueOnce({ kind: 'NOOP' });
    const app = await buildAuthenticatedTestApp({
      logger: false,
      prisma: {} as never,
      deliveryConfirmationService: service,
    });

    const first = await app.inject({
      method: 'POST',
      url: '/whatsapp/events/messages.update',
      payload: eventPayload(2),
    });
    const duplicate = await app.inject({
      method: 'POST',
      url: '/whatsapp/events/messages.update',
      payload: eventPayload(2),
    });

    expect(first.json()).toMatchObject({ accepted: true, changed: true });
    expect(duplicate.json()).toMatchObject({
      accepted: true,
      changed: false,
      reason: 'NOOP',
    });
    expect(service.consume).toHaveBeenCalledTimes(2);
    await app.close();
  });
});
