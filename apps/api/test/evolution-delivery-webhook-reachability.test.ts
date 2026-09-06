import { request as httpRequest } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app';
import { WhatsAppDeliveryConfirmationService } from '../src/whatsapp-delivery-confirmation-service';
import type {
  WhatsAppDeliveryEventInboxInput,
  WhatsAppDeliveryEventInput,
} from '../src/repositories';

const deliveryWebhookToken = 'delivery-webhook-reachability-token';
const execFileAsync = promisify(execFile);

const evolutionMessagesUpdate = (status: number) => ({
  event: 'messages.update',
  instance: 'affiliate-instance',
  timestamp: 1_787_000_100,
  data: {
    key: {
      id: 'provider-message-id',
      fromMe: true,
      remoteJid: '120363000000000000@g.us',
    },
    update: { status },
    messageTimestamp: 1_787_000_000,
  },
});

const plainEvolutionMessagesUpdate = (status: number) => ({
  instance: 'affiliate-instance',
  data: {
    keyId: 'provider-message-id-plain',
    status,
    messageTimestamp: 1_787_000_200,
  },
});

const createSubmittedDeliveryConfirmationFixture = () => {
  let dispatchStatus: 'SUBMITTED' | 'SENT' = 'SUBMITTED';
  const inboxRecord = vi.fn(async (input: WhatsAppDeliveryEventInboxInput) => {
    const receivedAt = input.receivedAt ?? new Date();
    return {
      ...input,
      receivedAt,
      id: 'inbox-1',
      fingerprint: `${input.instanceName}:${input.externalMessageId}:${input.status}`,
      state: 'PENDING' as const,
      appliedAt: null,
      createdAt: receivedAt,
      updatedAt: receivedAt,
    };
  });
  const markProcessed = vi.fn(async () => true);
  const applyDeliveryEvent = vi.fn(async (input: WhatsAppDeliveryEventInput) => {
    if (dispatchStatus === 'SUBMITTED' && input.status === 'SERVER_ACK') {
      dispatchStatus = 'SENT';
      return {
        kind: 'UPDATED' as const,
        dispatch: {
          id: 'dispatch-1',
          productId: 'product-1',
          destinationId: 'destination-1',
          status: 'SENT' as const,
          generatedCopyId: 'copy-1',
          attemptCount: 1,
        },
      };
    }
    return {
      kind: 'NOOP' as const,
      dispatch: {
        id: 'dispatch-1',
        productId: 'product-1',
        destinationId: 'destination-1',
        status: dispatchStatus,
        generatedCopyId: 'copy-1',
        attemptCount: 1,
      },
    };
  });
  const service = new WhatsAppDeliveryConfirmationService({
    dispatches: {
      applyDeliveryEvent,
      expireSubmittedConfirmations: vi.fn(async () => []),
    },
    deliveryEvents: { record: inboxRecord, markProcessed },
    runs: { finalizeByDispatchId: vi.fn(async () => null) } as never,
    logger: { info: vi.fn(), error: vi.fn() } as never,
  });
  return {
    service,
    inboxRecord,
    applyDeliveryEvent,
    dispatchStatus: () => dispatchStatus,
  };
};

const postFromDisposableEvolutionAdapter = async (input: {
  callbackUrl: string;
  payload: unknown;
}) => {
  const callback = new URL(input.callbackUrl);
  const body = JSON.stringify(input.payload);
  return new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
    // Docker Desktop resolves host.docker.internal to the host. The disposable
    // adapter supplies that mapping explicitly while Fastify remains loopback-only.
    const request = httpRequest(
      {
        hostname: '127.0.0.1',
        port: Number(callback.port),
        path: `${callback.pathname}${callback.search}`,
        method: 'POST',
        headers: {
          host: callback.host,
          authorization: `Bearer ${deliveryWebhookToken}`,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
      },
      (response) => {
        let responseBody = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          responseBody += chunk;
        });
        response.on('end', () => {
          resolve({ statusCode: response.statusCode ?? 0, body: responseBody });
        });
      },
    );
    request.once('error', reject);
    request.end(body);
  });
};

describe('Evolution 2.3.7 webhook reachability fixture', () => {
  it('delivers a realistic MESSAGES_UPDATE envelope through the host-only callback to the durable inbox consumer without SEND', async () => {
    const inboxStates = new Map<string, 'PENDING' | 'APPLIED'>();
    const inboxRecord = vi.fn(async (input: WhatsAppDeliveryEventInboxInput) => {
      const receivedAt = input.receivedAt ?? new Date();
      const fingerprint = `${input.instanceName}:${input.externalMessageId}:${input.status}:${input.occurredAt.toISOString()}`;
      const state = inboxStates.get(fingerprint) ?? 'PENDING';
      return {
        ...input,
        receivedAt,
        id: `inbox-${inboxStates.size + 1}`,
        fingerprint,
        state,
        appliedAt: state === 'APPLIED' ? receivedAt : null,
        createdAt: receivedAt,
        updatedAt: receivedAt,
      };
    });
    const markProcessed = vi.fn(async (input: { fingerprint: string }) => {
      inboxStates.set(input.fingerprint, 'APPLIED');
      return true;
    });
    const applyDeliveryEvent = vi.fn(async (input: WhatsAppDeliveryEventInput) => ({
      kind: 'UPDATED' as const,
      dispatch: {
        id: 'dispatch-1',
        productId: 'product-1',
        destinationId: 'destination-1',
        status: input.status === 'READ' ? ('READ' as const) : ('SENT' as const),
        generatedCopyId: 'copy-1',
        attemptCount: 1,
      },
    }));
    const deliveryConfirmationService = new WhatsAppDeliveryConfirmationService({
      dispatches: {
        applyDeliveryEvent,
        expireSubmittedConfirmations: vi.fn(async () => []),
      },
      deliveryEvents: { record: inboxRecord, markProcessed },
      runs: { finalizeByDispatchId: vi.fn(async () => null) } as never,
      logger: { info: vi.fn(), error: vi.fn() } as never,
    });
    const app = await buildApp({
      logger: false,
      localApiAuthToken: 'local-api-test-token',
      deliveryWebhookAuthToken: deliveryWebhookToken,
      prisma: {} as never,
      deliveryConfirmationService,
    });
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const bound = new URL(address);
    const callbackUrl = `http://host.docker.internal:${bound.port}/whatsapp/events/messages.update`;

    try {
      const first = await postFromDisposableEvolutionAdapter({
        callbackUrl,
        payload: evolutionMessagesUpdate(4),
      });
      const duplicate = await postFromDisposableEvolutionAdapter({
        callbackUrl,
        payload: evolutionMessagesUpdate(4),
      });
      const lateServerAck = await postFromDisposableEvolutionAdapter({
        callbackUrl,
        payload: evolutionMessagesUpdate(2),
      });
      const plain = await postFromDisposableEvolutionAdapter({
        callbackUrl,
        payload: plainEvolutionMessagesUpdate(2),
      });

      expect(first.statusCode).toBe(200);
      expect(duplicate.statusCode).toBe(200);
      expect(lateServerAck.statusCode).toBe(200);
      expect(plain.statusCode).toBe(200);
      expect(inboxRecord).toHaveBeenCalledTimes(4);
      expect(inboxRecord).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          instanceName: 'affiliate-instance',
          externalMessageId: 'provider-message-id',
          status: 'READ',
          occurredAt: new Date(1_787_000_000 * 1000),
        }),
      );
      expect(applyDeliveryEvent).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ status: 'SERVER_ACK' }),
      );
      expect(applyDeliveryEvent).toHaveBeenLastCalledWith(
        expect.objectContaining({
          externalMessageId: 'provider-message-id-plain',
          status: 'SERVER_ACK',
        }),
      );
      expect(applyDeliveryEvent).toHaveBeenCalledTimes(3);
      expect(markProcessed).toHaveBeenCalledTimes(3);
      expect(inboxRecord.mock.calls[0]?.[0]).not.toHaveProperty('remoteJid');
      expect(inboxRecord.mock.calls[0]?.[0]).not.toHaveProperty('key');
      expect(first.body).not.toContain('provider-message-id');
      expect(first.body).not.toContain('remoteJid');
    } finally {
      await app.close();
    }
  });

  const containerIt =
    process.env.RUN_EVOLUTION_CONTAINER_REACHABILITY === '1' ? it : it.skip;

  containerIt('uses the compiled official WebhookController.emit path to reach the loopback-only API through host.docker.internal without SEND', async () => {
    const fixture = createSubmittedDeliveryConfirmationFixture();
    const app = await buildApp({
      logger: false,
      localApiAuthToken: 'local-api-test-token',
      deliveryWebhookAuthToken: deliveryWebhookToken,
      prisma: {} as never,
      deliveryConfirmationService: fixture.service,
    });
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const bound = new URL(address);
    const callbackUrl = `http://host.docker.internal:${bound.port}/whatsapp/events/messages.update`;
    const script = [
      '(async () => {',
      "const { WebhookController } = require('/evolution/dist/api/integrations/event/webhook/webhook.controller.js');",
      'const [url, token] = process.argv.slice(1);',
      "const instanceName = 'affiliate-instance';",
      "const instanceId = 'official-emitter-fixture';",
      'let webhook;',
      'const prisma = { webhook: {',
      '  upsert: async ({ where, create, update }) => (webhook = { ...(webhook ?? {}), ...(webhook ? update : create), instanceId: where.instanceId }),',
      '  findUnique: async () => webhook ?? null,',
      '} };',
      'const monitor = { waInstances: { [instanceName]: { instanceId } } };',
      'const controller = new WebhookController(prisma, monitor);',
      'await controller.set(instanceName, { webhook: { enabled: true, url, events: [\'MESSAGES_UPDATE\'], headers: { Authorization: `Bearer ${token}` }, byEvents: false, base64: false } });',
      "await controller.emit({ instanceName, origin: 'reachability-fixture', event: 'messages.update', data: { key: { id: 'provider-message-id', fromMe: true, remoteJid: '120363000000000000@g.us' }, update: { status: 2 }, messageTimestamp: 1787000000 }, serverUrl: 'http://evolution.fixture', dateTime: '2026-09-05T13:00:00.000Z', sender: 'official-webhook-controller', local: true, integration: ['webhook'] });",
      "if (!webhook || webhook.webhookByEvents !== false || webhook.webhookBase64 !== false) throw new Error('official WebhookController.set did not retain the false EventDto flags');",
      "})().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });",
    ].join('');

    try {
      await expect(
        execFileAsync('docker', [
          'run',
          '--rm',
          '--add-host',
          'host.docker.internal:host-gateway',
          '--entrypoint',
          'node',
          'evoapicloud/evolution-api:v2.3.7',
          '-e',
          script,
          callbackUrl,
          deliveryWebhookToken,
        ]),
      ).resolves.toMatchObject({ stderr: '' });
      expect(fixture.applyDeliveryEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          instanceName: 'affiliate-instance',
          externalMessageId: 'provider-message-id',
          status: 'SERVER_ACK',
        }),
      );
      expect(fixture.dispatchStatus()).toBe('SENT');
      expect(fixture.inboxRecord.mock.calls[0]?.[0]).not.toHaveProperty('remoteJid');
      expect(fixture.inboxRecord.mock.calls[0]?.[0]).not.toHaveProperty('key');
    } finally {
      await app.close();
    }
  }, 30_000);
});
