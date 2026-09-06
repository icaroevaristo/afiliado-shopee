import { describe, expect, it, vi } from 'vitest';

import {
  EvolutionSendGuard,
  normalizeEvolutionDestination,
} from './evolution-send-guard';
import type { ProviderLogger } from './evolution-api-whatsapp-provider';
import {
  createWhatsAppProvider,
  type WhatsAppProviderFactoryOptions,
} from './whatsapp-provider-factory';

const DESTINATION = '0000000000000';
const API_KEY = 'test-only-api-key';

const response = (status = 200) =>
  new Response(JSON.stringify({ key: { id: 'test-message-id' } }), { status });

const createLogger = (): ProviderLogger => ({
  info: vi.fn(),
  error: vi.fn(),
});

const evolutionConfig = {
  WHATSAPP_PROVIDER: 'evolution' as const,
  EVOLUTION_API_URL: 'http://localhost:8080',
  EVOLUTION_API_KEY: API_KEY,
  EVOLUTION_INSTANCE_NAME: 'test-instance',
  WHATSAPP_DELIVERY_WEBHOOK_URL:
    'http://host.docker.internal:3333/whatsapp/events/messages.update',
  WHATSAPP_DELIVERY_WEBHOOK_TOKEN: 'dedicated-webhook-test-token',
};

const readyDeliveryWebhookClient = () =>
  vi.fn(async () =>
    new Response(
      JSON.stringify({
        enabled: true,
        url: evolutionConfig.WHATSAPP_DELIVERY_WEBHOOK_URL,
        events: ['MESSAGES_UPDATE'],
        headers: {
          authorization: `Bearer ${evolutionConfig.WHATSAPP_DELIVERY_WEBHOOK_TOKEN}`,
        },
        byEvents: false,
        base64: false,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  );

const providerOptions = (
  httpClient: NonNullable<WhatsAppProviderFactoryOptions['httpClient']>,
): WhatsAppProviderFactoryOptions => ({
  httpClient,
  deliveryWebhookHttpClient: readyDeliveryWebhookClient(),
});

describe('normalizeEvolutionDestination', () => {
  it('remove formatacao e preserva comparacao exata por digitos', () => {
    expect(normalizeEvolutionDestination('+00 (00) 00000-0000')).toBe(
      DESTINATION,
    );
  });

  it.each(['', '   ', '0000000000000@c.us', 'invalid-destination'])(
    'rejeita destino invalido: %s',
    (destination) => {
      expect(() => normalizeEvolutionDestination(destination)).toThrowError(
        expect.objectContaining({ code: 'EVOLUTION_SAFE_DESTINATION_INVALID' }),
      );
    },
  );
});

describe('EvolutionSendGuard', () => {
  it('bloqueia todos os destinos quando a allowlist esta vazia', () => {
    const guard = new EvolutionSendGuard({
      safeMode: true,
      allowedDestinations: [],
      maxMessagesPerBoot: 1,
    });

    expect(() => guard.authorizeRequest(DESTINATION)).toThrowError(
      expect.objectContaining({ code: 'EVOLUTION_SAFE_DESTINATION_BLOCKED' }),
    );
    expect(guard.requestCount).toBe(0);
  });

  it('aceita destino permitido apos normalizacao exata', () => {
    const guard = new EvolutionSendGuard({
      safeMode: true,
      allowedDestinations: ['+00 (00) 00000-0000'],
      maxMessagesPerBoot: 1,
    });

    expect(() => guard.authorizeRequest(DESTINATION)).not.toThrow();
    expect(guard.requestCount).toBe(1);
  });

  it('nao aceita correspondencia parcial', () => {
    const guard = new EvolutionSendGuard({
      safeMode: true,
      allowedDestinations: [DESTINATION],
      maxMessagesPerBoot: 1,
    });

    expect(() => guard.authorizeRequest(`1${DESTINATION}`)).toThrowError(
      expect.objectContaining({ code: 'EVOLUTION_SAFE_DESTINATION_BLOCKED' }),
    );
  });

  it('bloqueia acima do limite sem incrementar o contador', () => {
    const guard = new EvolutionSendGuard({
      safeMode: true,
      allowedDestinations: [DESTINATION],
      maxMessagesPerBoot: 1,
    });

    guard.authorizeRequest(DESTINATION);
    expect(() => guard.authorizeRequest(DESTINATION)).toThrowError(
      expect.objectContaining({ code: 'EVOLUTION_SAFE_LIMIT_REACHED' }),
    );
    expect(guard.requestCount).toBe(1);
  });

  it('preserva o comportamento sem restricoes quando safe mode esta inativo', () => {
    const guard = new EvolutionSendGuard({
      safeMode: false,
      allowedDestinations: ['ignored-invalid-destination'],
      maxMessagesPerBoot: 1,
    });

    expect(() =>
      guard.authorizeRequest('destination-as-provided'),
    ).not.toThrow();
    expect(guard.requestCount).toBe(0);
  });

  it('registra apenas quantidade e destinos mascarados', () => {
    const logger = createLogger();
    const allowedDestinations = [DESTINATION, '0000111111111'];
    const guard = new EvolutionSendGuard({
      safeMode: true,
      allowedDestinations,
      maxMessagesPerBoot: 1,
      logger,
    });

    guard.authorizeRequest(DESTINATION);
    const logs = JSON.stringify([
      vi.mocked(logger.info).mock.calls,
      vi.mocked(logger.error).mock.calls,
    ]);

    expect(logs).toContain('allowedDestinationCount');
    expect(logs).not.toContain(DESTINATION);
    expect(logs).not.toContain(allowedDestinations[1]);
  });
});

describe('Evolution safe mode provider integration', () => {
  it('fica ativo por padrao e bloqueia antes do HTTP com allowlist vazia', async () => {
    const httpClient = vi.fn();
    const provider = createWhatsAppProvider(evolutionConfig, providerOptions(httpClient));

    await expect(
      provider.sendMessage({ destination: DESTINATION, message: 'Test only' }),
    ).rejects.toMatchObject({
      code: 'EVOLUTION_SAFE_DESTINATION_BLOCKED',
      deliveryMayHaveStarted: false,
    });
    expect(httpClient).not.toHaveBeenCalled();
  });

  it('permite o primeiro request e bloqueia o segundo no limite padrao', async () => {
    const httpClient = vi.fn().mockResolvedValue(response());
    const provider = createWhatsAppProvider(
      {
        ...evolutionConfig,
        EVOLUTION_ALLOWED_DESTINATIONS: `+00 (00) 00000-0000`,
      },
      providerOptions(httpClient),
    );

    await expect(
      provider.sendMessage({ destination: DESTINATION, message: 'Test only' }),
    ).resolves.toMatchObject({ status: 'sent' });
    await expect(
      provider.sendMessage({ destination: DESTINATION, message: 'Test only' }),
    ).rejects.toMatchObject({ code: 'EVOLUTION_SAFE_LIMIT_REACHED' });
    expect(httpClient).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'erro HTTP',
      vi.fn().mockResolvedValue(response(500)),
      'EVOLUTION_SERVER_ERROR',
    ],
    [
      'timeout',
      vi.fn(
        (_input: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
          }),
      ),
      'EVOLUTION_TIMEOUT',
    ],
  ] as const)(
    'contabiliza request iniciado em %s',
    async (_scenario, httpClient, expectedCode) => {
      const provider = createWhatsAppProvider(
        {
          ...evolutionConfig,
          EVOLUTION_ALLOWED_DESTINATIONS: [DESTINATION],
        },
        { ...providerOptions(httpClient), timeoutMs: 5 },
      );

      await expect(
        provider.sendMessage({
          destination: DESTINATION,
          message: 'Test only',
        }),
      ).rejects.toMatchObject({ code: expectedCode });
      await expect(
        provider.sendMessage({
          destination: DESTINATION,
          message: 'Test only',
        }),
      ).rejects.toMatchObject({ code: 'EVOLUTION_SAFE_LIMIT_REACHED' });
      expect(httpClient).toHaveBeenCalledTimes(1);
    },
  );

  it('safe mode false preserva chamadas sem allowlist ou limite', async () => {
    const httpClient = vi.fn().mockImplementation(async () => response());
    const provider = createWhatsAppProvider(
      { ...evolutionConfig, EVOLUTION_SAFE_MODE: false },
      providerOptions(httpClient),
    );

    await provider.sendMessage({
      destination: DESTINATION,
      message: 'Test only',
    });
    await provider.sendMessage({
      destination: DESTINATION,
      message: 'Test only',
    });

    expect(httpClient).toHaveBeenCalledTimes(2);
  });

  it('nao expoe API key nem allowlist em erros', async () => {
    const httpClient = vi.fn();
    const provider = createWhatsAppProvider(
      {
        ...evolutionConfig,
        EVOLUTION_ALLOWED_DESTINATIONS: ['0000111111111'],
      },
      providerOptions(httpClient),
    );

    let caught: unknown;
    try {
      await provider.sendMessage({
        destination: DESTINATION,
        message: 'Test only',
      });
    } catch (error) {
      caught = error;
    }

    const serialized = JSON.stringify(caught);
    expect(serialized).not.toContain(API_KEY);
    expect(serialized).not.toContain('0000111111111');
    expect(httpClient).not.toHaveBeenCalled();
  });
});
