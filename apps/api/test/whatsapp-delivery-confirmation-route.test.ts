import { describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app';

const createDeliveryService = () => ({
  consume: vi.fn(),
  expireDue: vi.fn(async () => ({ expired: 0, replayed: 0 })),
});

const DELIVERY_WEBHOOK_TOKEN = 'delivery-webhook-test-token';

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
  const buildWebhookApp = (service = createDeliveryService()) =>
    buildApp({
      logger: false,
      localApiAuthToken: 'local-api-test-token',
      deliveryWebhookAuthToken: DELIVERY_WEBHOOK_TOKEN,
      prisma: {} as never,
      deliveryConfirmationService: service,
    });

  const webhookAuthorization = `Bearer ${DELIVERY_WEBHOOK_TOKEN}`;

  it('exige o bearer dedicado e não aceita LOCAL_API_AUTH_TOKEN como substituto', async () => {
    const consume = vi.fn();
    const app = await buildApp({
      logger: false,
      localApiAuthToken: 'local-api-test-token',
      deliveryWebhookAuthToken: DELIVERY_WEBHOOK_TOKEN,
      prisma: {} as never,
      deliveryConfirmationService: {
        consume,
        expireDue: vi.fn(async () => ({ expired: 0, replayed: 0 })),
      },
    });

    const missing = await app.inject({
      method: 'POST',
      url: '/whatsapp/events/messages.update',
      payload: eventPayload(2),
    });
    const localBearer = await app.inject({
      method: 'POST',
      url: '/whatsapp/events/messages.update',
      headers: { authorization: 'Bearer local-api-test-token' },
      payload: eventPayload(2),
    });

    expect(missing.statusCode).toBe(401);
    expect(localBearer.statusCode).toBe(401);
    expect(consume).not.toHaveBeenCalled();
    await app.close();
  });

  it('recusa iniciar quando o token dedicado e o token local coincidem', async () => {
    await expect(
      buildApp({
        logger: false,
        localApiAuthToken: 'same-test-token',
        deliveryWebhookAuthToken: 'same-test-token',
        prisma: {} as never,
        deliveryConfirmationService: createDeliveryService(),
      }),
    ).rejects.toMatchObject({
      code: 'WHATSAPP_DELIVERY_WEBHOOK_TOKEN_MUST_BE_DEDICATED',
    });
  });

  it('does not accept the trailing-slash callback path that Fastify does not route', async () => {
    const service = createDeliveryService();
    const app = await buildWebhookApp(service);

    const dedicatedTokenResponse = await app.inject({
      method: 'POST',
      url: '/whatsapp/events/messages.update/',
      headers: { authorization: webhookAuthorization },
      payload: eventPayload(2),
    });
    const routedResponse = await app.inject({
      method: 'POST',
      url: '/whatsapp/events/messages.update/',
      headers: { authorization: 'Bearer local-api-test-token' },
      payload: eventPayload(2),
    });

    expect(dedicatedTokenResponse.statusCode).toBe(401);
    expect(routedResponse.statusCode).toBe(404);
    expect(service.consume).not.toHaveBeenCalled();
    await app.close();
  });

  it('falha fechado quando o token dedicado não foi configurado', async () => {
    const app = await buildApp({
      logger: false,
      localApiAuthToken: 'local-api-test-token',
      prisma: {} as never,
      deliveryConfirmationService: createDeliveryService(),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/whatsapp/events/messages.update',
      headers: { authorization: webhookAuthorization },
      payload: eventPayload(2),
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      error: 'WHATSAPP_DELIVERY_WEBHOOK_AUTH_NOT_CONFIGURED',
    });
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
    const app = await buildWebhookApp(service);

    const response = await app.inject({
      method: 'POST',
      url: '/whatsapp/events/messages.update',
      headers: { authorization: webhookAuthorization },
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
    const app = await buildWebhookApp(service);

    const first = await app.inject({
      method: 'POST',
      url: '/whatsapp/events/messages.update',
      headers: { authorization: webhookAuthorization },
      payload: eventPayload(2),
    });
    const duplicate = await app.inject({
      method: 'POST',
      url: '/whatsapp/events/messages.update',
      headers: { authorization: webhookAuthorization },
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

  it.each([
    [0, 'ERROR'],
    [1, 'PENDING'],
  ] as const)('preserva os status numéricos oficiais %s', async (status, expected) => {
    const service = createDeliveryService();
    service.consume.mockResolvedValue({ kind: 'NOOP' });
    const app = await buildWebhookApp(service);

    const response = await app.inject({
      method: 'POST',
      url: '/whatsapp/events/messages.update',
      headers: { authorization: webhookAuthorization },
      payload: eventPayload(status),
    });

    expect(response.statusCode).toBe(200);
    expect(service.consume).toHaveBeenCalledWith(
      expect.objectContaining({ status: expected }),
    );
    await app.close();
  });
});
