import { describe, expect, it, vi } from 'vitest';

import { EvolutionDeliveryWebhookReadiness } from './evolution-delivery-webhook';

const callbackUrl =
  'http://host.docker.internal:3001/whatsapp/events/messages.update';
const callbackToken = 'dedicated-webhook-test-token';

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const configuredWebhook = {
  enabled: true,
  url: callbackUrl,
  events: ['MESSAGES_UPDATE'],
  headers: { authorization: `Bearer ${callbackToken}` },
  byEvents: false,
  base64: false,
};

const officialReadbackWebhook = {
  enabled: true,
  webhookUrl: callbackUrl,
  events: ['MESSAGES_UPDATE'],
  webhookHeaders: { authorization: `Bearer ${callbackToken}` },
  webhookByEvents: false,
  webhookBase64: false,
};

const createReadiness = (httpClient: ReturnType<typeof vi.fn>) =>
  new EvolutionDeliveryWebhookReadiness({
    baseUrl: 'http://evolution.invalid:8080',
    apiKey: 'api-key-not-logged',
    instanceName: 'affiliate-instance',
    callbackUrl,
    callbackToken,
    httpClient,
    timeoutMs: 1_000,
  });

describe('EvolutionDeliveryWebhookReadiness', () => {
  it('accepts a verified official per-instance MESSAGES_UPDATE configuration without rewriting it', async () => {
    const httpClient = vi.fn().mockResolvedValue(response(configuredWebhook));

    await expect(createReadiness(httpClient).ensureReady()).resolves.toBeUndefined();

    expect(httpClient).toHaveBeenCalledTimes(1);
    expect(httpClient).toHaveBeenCalledWith(
      'http://evolution.invalid:8080/webhook/find/affiliate-instance',
      expect.objectContaining({ method: 'GET', headers: { apikey: 'api-key-not-logged' } }),
    );
  });

  it('accepts the official Evolution 2.3.7 readback aliases when both format flags are false', async () => {
    const httpClient = vi.fn().mockResolvedValue(response(officialReadbackWebhook));

    await expect(createReadiness(httpClient).ensureReady()).resolves.toBeUndefined();

    expect(httpClient).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the official readback adds a trailing slash to the routed callback', async () => {
    const httpClient = vi.fn().mockResolvedValue(
      response({
        ...officialReadbackWebhook,
        webhookUrl: `${callbackUrl}/`,
      }),
    );

    await expect(createReadiness(httpClient).ensureReady()).rejects.toMatchObject({
      code: 'WHATSAPP_DELIVERY_CONFIRMATION_NOT_READY',
    });
    expect(httpClient).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ ...officialReadbackWebhook, webhookByEvents: true }],
    [{ ...officialReadbackWebhook, webhookBase64: true }],
    [
      {
        ...officialReadbackWebhook,
        webhookHeaders: { authorization: 'Bearer another-dedicated-token' },
      },
    ],
  ])(
    'fails closed when an official Evolution readback alias is incompatible',
    async (readback) => {
      const httpClient = vi.fn().mockResolvedValue(response(readback));

      await expect(createReadiness(httpClient).ensureReady()).rejects.toMatchObject({
        code: 'WHATSAPP_DELIVERY_CONFIRMATION_NOT_READY',
      });
      expect(httpClient).toHaveBeenCalledTimes(1);
    },
  );

  it('sets once, rereads, and verifies a missing configuration before a future SEND', async () => {
    const httpClient = vi
      .fn()
      .mockResolvedValueOnce(response({ enabled: false, url: '', events: [] }))
      .mockResolvedValueOnce(response({ webhook: configuredWebhook }, 201))
      .mockResolvedValueOnce(response({ webhook: configuredWebhook }));

    await expect(createReadiness(httpClient).ensureReady()).resolves.toBeUndefined();

    expect(httpClient).toHaveBeenCalledTimes(3);
    expect(httpClient).toHaveBeenNthCalledWith(
      2,
      'http://evolution.invalid:8080/webhook/set/affiliate-instance',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ apikey: 'api-key-not-logged' }),
        body: JSON.stringify({
          webhook: {
            enabled: true,
            url: callbackUrl,
            events: ['MESSAGES_UPDATE'],
            headers: { authorization: `Bearer ${callbackToken}` },
            byEvents: false,
            base64: false,
          },
        }),
      }),
    );
  });

  it('fails closed when an existing webhook belongs to another consumer', async () => {
    const httpClient = vi.fn().mockResolvedValue(
      response({ ...configuredWebhook, url: 'http://other.invalid/events' }),
    );

    await expect(createReadiness(httpClient).ensureReady()).rejects.toMatchObject({
      code: 'WHATSAPP_DELIVERY_CONFIRMATION_NOT_READY',
    });
    expect(httpClient).toHaveBeenCalledTimes(1);
  });

  it('rejects a callback outside the Docker-to-host-only topology before any Evolution request', () => {
    const httpClient = vi.fn();

    expect(
      () =>
        new EvolutionDeliveryWebhookReadiness({
          baseUrl: 'http://evolution.invalid:8080',
          apiKey: 'api-key-not-logged',
          instanceName: 'affiliate-instance',
          callbackUrl: 'https://public.example/whatsapp/events/messages.update',
          callbackToken,
          httpClient,
          timeoutMs: 1_000,
        }),
    ).toThrowError(
      expect.objectContaining({ code: 'WHATSAPP_DELIVERY_CONFIRMATION_NOT_READY' }),
    );
    expect(httpClient).not.toHaveBeenCalled();
  });

  it('rejects a host-only callback whose port differs from the API runtime port', () => {
    expect(
      () =>
        new EvolutionDeliveryWebhookReadiness({
          baseUrl: 'http://evolution.invalid:8080',
          apiKey: 'api-key-not-logged',
          instanceName: 'affiliate-instance',
          callbackUrl,
          callbackToken,
          callbackPort: 3333,
          httpClient: vi.fn(),
          timeoutMs: 1_000,
        }),
    ).toThrowError(
      expect.objectContaining({ code: 'WHATSAPP_DELIVERY_CONFIRMATION_NOT_READY' }),
    );
  });
});
