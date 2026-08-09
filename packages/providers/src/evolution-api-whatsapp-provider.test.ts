import { AppError } from '@shopee-auto-affiliate-ai/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EvolutionApiWhatsAppProvider,
  type HttpClient,
  type ProviderLogger,
} from './evolution-api-whatsapp-provider';
import { EvolutionGroupSendGuard } from './evolution-group-send-guard';
import { EvolutionSendGuard } from './evolution-send-guard';
import { MockWhatsAppProvider } from './index';
import { createWhatsAppProvider } from './whatsapp-provider-factory';

const API_KEY = 'test-api-key-never-log';

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const createLogger = (): ProviderLogger => ({
  info: vi.fn(),
  error: vi.fn(),
});

const createProvider = (
  httpClient: HttpClient = vi
    .fn()
    .mockResolvedValue(response({ key: { id: 'message-123' } })),
  overrides: Partial<
    ConstructorParameters<typeof EvolutionApiWhatsAppProvider>[0]
  > = {},
) =>
  new EvolutionApiWhatsAppProvider({
    baseUrl: 'http://localhost:8080/',
    apiKey: API_KEY,
    instanceName: 'affiliate bot',
    httpClient,
    ...overrides,
  });

describe('EvolutionApiWhatsAppProvider', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('envia texto e mapeia o resultado sem expor a resposta externa', async () => {
    const provider = createProvider();

    await expect(
      provider.sendMessage({ destination: '5511999999999', message: 'Oferta' }),
    ).resolves.toEqual({
      externalMessageId: 'message-123',
      status: 'sent',
      sentAt: expect.any(Date),
    });
  });

  it('monta URL, headers e payload do contrato Evolution API v2.3.7', async () => {
    const httpClient = vi
      .fn()
      .mockResolvedValue(response({ key: { id: 'message-123' } }));
    const provider = createProvider(httpClient);

    await provider.sendMessage({
      destination: '5511999999999',
      message: 'Oferta do dia',
    });

    expect(httpClient).toHaveBeenCalledWith(
      'http://localhost:8080/message/sendText/affiliate%20bot',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: API_KEY,
        },
        body: JSON.stringify({
          number: '5511999999999',
          text: 'Oferta do dia',
        }),
        signal: expect.any(AbortSignal),
      }),
    );

    const request = vi.mocked(httpClient).mock.calls[0]?.[1];
    const payload = JSON.parse(String(request?.body)) as Record<
      string,
      unknown
    >;
    expect(payload).toEqual({
      number: '5511999999999',
      text: 'Oferta do dia',
    });
    expect(payload).not.toHaveProperty('textMessage');
  });

  it.each([undefined, null])(
    'envia texto quando imageUrl e %s (sendText)',
    async (imageUrl) => {
      const httpClient = vi
        .fn()
        .mockResolvedValue(response({ key: { id: 'message-123' } }));
      const provider = createProvider(httpClient);

      await provider.sendMessage({
        destination: '5511999999999',
        message: 'Oferta do dia',
        imageUrl,
      });

      expect(httpClient).toHaveBeenCalledTimes(1);
      expect(httpClient).toHaveBeenCalledWith(
        'http://localhost:8080/message/sendText/affiliate%20bot',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            number: '5511999999999',
            text: 'Oferta do dia',
          }),
        }),
      );
    },
  );

  it('monta URL, headers e payload para envio de imagem HTTPS (sendMedia)', async () => {
    const httpClient = vi
      .fn()
      .mockResolvedValue(response({ key: { id: 'message-img-123' } }));
    const provider = createProvider(httpClient);

    await provider.sendMessage({
      destination: '5511999999999',
      message: 'Legenda da oferta',
      imageUrl: 'https://example.com/image.jpg',
    });

    expect(httpClient).toHaveBeenCalledTimes(1);
    expect(httpClient).toHaveBeenCalledWith(
      'http://localhost:8080/message/sendMedia/affiliate%20bot',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: API_KEY,
        },
        body: JSON.stringify({
          number: '5511999999999',
          mediatype: 'image',
          media: 'https://example.com/image.jpg',
          caption: 'Legenda da oferta',
        }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('aceita URL com protocolo HTTP valido', async () => {
    const httpClient = vi
      .fn()
      .mockResolvedValue(response({ key: { id: 'message-img-http' } }));
    const provider = createProvider(httpClient);

    await provider.sendMessage({
      destination: '5511999999999',
      message: 'Legenda HTTP',
      imageUrl: 'http://example.com/image.jpg',
    });

    expect(httpClient).toHaveBeenCalledWith(
      'http://localhost:8080/message/sendMedia/affiliate%20bot',
      expect.objectContaining({
        body: JSON.stringify({
          number: '5511999999999',
          mediatype: 'image',
          media: 'http://example.com/image.jpg',
          caption: 'Legenda HTTP',
        }),
      }),
    );
  });

  it('normaliza URL com protocolo em caixa alta', async () => {
    const httpClient = vi
      .fn()
      .mockResolvedValue(response({ key: { id: 'message-img-upper' } }));
    const provider = createProvider(httpClient);

    await provider.sendMessage({
      destination: '5511999999999',
      message: 'Legenda Upper',
      imageUrl: 'HTTPS://EXAMPLE.COM/IMAGE.JPG',
    });

    expect(httpClient).toHaveBeenCalledWith(
      'http://localhost:8080/message/sendMedia/affiliate%20bot',
      expect.objectContaining({
        body: JSON.stringify({
          number: '5511999999999',
          mediatype: 'image',
          media: 'HTTPS://EXAMPLE.COM/IMAGE.JPG',
          caption: 'Legenda Upper',
        }),
      }),
    );
  });

  it.each(['', '   '])('rejeita imageUrl vazia ou com espacos (%j)', async (emptyValue) => {
    const httpClient = vi.fn();
    const provider = createProvider(httpClient);

    await expect(
      provider.sendMessage({
        destination: '5511999999999',
        message: 'Oferta',
        imageUrl: emptyValue,
      }),
    ).rejects.toMatchObject({
      code: 'WHATSAPP_IMAGE_URL_INVALID',
      deliveryMayHaveStarted: false,
    });

    expect(httpClient).not.toHaveBeenCalled();
  });

  it.each([
    'not-a-url',
    'ftp://example.com/image.jpg',
    'javascript:alert(1)',
    'file:///tmp/image.jpg',
    'data:image/png;base64,abc',
  ])('rejeita imagem com URL/esquema invalido (%s) e nao chama httpClient', async (invalidUrl) => {
    const httpClient = vi.fn();
    const provider = createProvider(httpClient);

    await expect(
      provider.sendMessage({
        destination: '5511999999999',
        message: 'Oferta',
        imageUrl: invalidUrl,
      }),
    ).rejects.toMatchObject({
      code: 'WHATSAPP_IMAGE_URL_INVALID',
      deliveryMayHaveStarted: false,
    });

    expect(httpClient).not.toHaveBeenCalled();
  });

  it.each([
    [
      'destination',
      { destination: ' ', message: 'Oferta' },
      'WHATSAPP_DESTINATION_REQUIRED',
    ],
    [
      'message',
      { destination: '5511999999999', message: ' ' },
      'WHATSAPP_MESSAGE_REQUIRED',
    ],
  ] as const)('rejeita %s vazio', async (_field, input, code) => {
    const provider = createProvider();
    await expect(provider.sendMessage(input)).rejects.toMatchObject({
      code,
      deliveryMayHaveStarted: false,
    });
  });

  it('classifica identificador de grupo invalido antes do request', async () => {
    const httpClient = vi.fn();
    const provider = createProvider(httpClient);

    await expect(
      provider.sendMessage({
        destination: 'invalid-group',
        destinationType: 'GROUP',
        message: 'Oferta',
      }),
    ).rejects.toMatchObject({
      code: 'WHATSAPP_GROUP_ID_INVALID',
      deliveryMayHaveStarted: false,
    });
    expect(httpClient).not.toHaveBeenCalled();
  });

  it('rejeita URL invalida', () => {
    expect(() =>
      createProvider(undefined, { baseUrl: 'not-a-url' }),
    ).toThrowError(expect.objectContaining({ code: 'EVOLUTION_INVALID_URL' }));
  });

  it.each([
    ['apiKey', { apiKey: ' ' }, 'EVOLUTION_API_KEY_REQUIRED'],
    ['instanceName', { instanceName: ' ' }, 'EVOLUTION_INSTANCE_NAME_REQUIRED'],
  ] as const)('rejeita %s vazio', (_field, overrides, code) => {
    expect(() => createProvider(undefined, overrides)).toThrowError(
      expect.objectContaining({ code }),
    );
  });

  it.each([
    [400, 'EVOLUTION_BAD_REQUEST'],
    [401, 'EVOLUTION_UNAUTHORIZED'],
    [403, 'EVOLUTION_FORBIDDEN'],
    [404, 'EVOLUTION_NOT_FOUND'],
    [429, 'EVOLUTION_RATE_LIMITED'],
    [500, 'EVOLUTION_SERVER_ERROR'],
    [503, 'EVOLUTION_SERVER_ERROR'],
  ])('mapeia HTTP %i para %s', async (status, code) => {
    const provider = createProvider(
      vi.fn().mockResolvedValue(response({ error: 'external error' }, status)),
    );

    await expect(
      provider.sendMessage({ destination: '5511999999999', message: 'Oferta' }),
    ).rejects.toMatchObject({ code, deliveryMayHaveStarted: true });
  });

  it('sanitiza a resposta HTTP 400 sem expor detalhes externos', async () => {
    const externalDetail = `${API_KEY} 5511999999999 payload rejected`;
    const logger = createLogger();
    const provider = createProvider(
      vi.fn().mockResolvedValue(response({ error: externalDetail }, 400)),
      { logger },
    );

    let caught: unknown;
    try {
      await provider.sendMessage({
        destination: '5511999999999',
        message: 'Oferta',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AppError);
    expect(caught).toMatchObject({ code: 'EVOLUTION_BAD_REQUEST' });
    expect(JSON.stringify(caught)).not.toContain(externalDetail);
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain(
      API_KEY,
    );
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain(
      '5511999999999',
    );
  });

  it('mapeia timeout sem realizar retry', async () => {
    const httpClient: HttpClient = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    const provider = createProvider(httpClient, { timeoutMs: 5 });

    await expect(
      provider.sendMessage({ destination: '5511999999999', message: 'Oferta' }),
    ).rejects.toMatchObject({
      code: 'EVOLUTION_TIMEOUT',
      deliveryMayHaveStarted: true,
    });
  });

  it('mapeia erro de rede', async () => {
    const provider = createProvider(
      vi.fn().mockRejectedValue(new TypeError('network unavailable')),
    );

    await expect(
      provider.sendMessage({ destination: '5511999999999', message: 'Oferta' }),
    ).rejects.toMatchObject({
      code: 'EVOLUTION_NETWORK_ERROR',
      deliveryMayHaveStarted: true,
    });
  });

  it('rejeita resposta sem identificador de mensagem', async () => {
    const provider = createProvider(vi.fn().mockResolvedValue(response({})));

    await expect(
      provider.sendMessage({ destination: '5511999999999', message: 'Oferta' }),
    ).rejects.toMatchObject({ code: 'EVOLUTION_MESSAGE_ID_MISSING' });
  });

  it('executa groupSendGuard antes do httpClient para envio de imagem em grupo', async () => {
    const httpClient = vi
      .fn()
      .mockResolvedValue(response({ key: { id: 'msg-group-img' } }));
    const groupSendGuard = new EvolutionGroupSendGuard({
      enabled: true,
      safeMode: true,
      maxMessagesPerRun: 10,
    });
    vi.spyOn(groupSendGuard, 'authorizeRequest');
    const provider = createProvider(httpClient, { groupSendGuard });

    const groupJid = '120363000000000000@g.us';
    await provider.sendMessage({
      destination: groupJid,
      destinationType: 'GROUP',
      message: 'Legenda grupo',
      imageUrl: 'https://example.com/group-image.jpg',
    });

    expect(groupSendGuard.authorizeRequest).toHaveBeenCalledWith(groupJid);
    expect(httpClient).toHaveBeenCalledTimes(1);
    expect(httpClient).toHaveBeenCalledWith(
      'http://localhost:8080/message/sendMedia/affiliate%20bot',
      expect.objectContaining({
        body: JSON.stringify({
          number: groupJid,
          mediatype: 'image',
          media: 'https://example.com/group-image.jpg',
          caption: 'Legenda grupo',
        }),
      }),
    );
  });

  it('permite uma mensagem GROUP em cada run distinto com provider persistente', async () => {
    const httpClient = vi
      .fn()
      .mockImplementation(async () =>
        response({ key: { id: 'msg-group-run' } }),
      );
    const groupSendGuard = new EvolutionGroupSendGuard({
      enabled: true,
      safeMode: true,
      maxMessagesPerRun: 1,
    });
    const provider = createProvider(httpClient, { groupSendGuard });
    const input = {
      destination: '120363000000000000@g.us',
      destinationType: 'GROUP' as const,
      message: 'Oferta em grupo',
    };

    provider.beginRun('run-a');
    await provider.sendMessage(input);
    provider.beginRun('run-b');
    await provider.sendMessage(input);

    provider.beginRun('run-a');
    await expect(provider.sendMessage(input)).rejects.toMatchObject({
      code: 'WHATSAPP_GROUP_LIMIT_REACHED',
      deliveryMayHaveStarted: false,
    });
    expect(httpClient).toHaveBeenCalledTimes(2);
  });

  it('beginRun nao reinicia o limite individual por boot', async () => {
    const destination = '5511999999999';
    const httpClient = vi
      .fn()
      .mockResolvedValue(response({ key: { id: 'msg-individual-run' } }));
    const sendGuard = new EvolutionSendGuard({
      safeMode: true,
      allowedDestinations: [destination],
      maxMessagesPerBoot: 1,
    });
    const provider = createProvider(httpClient, {
      sendGuard,
      groupSendGuard: new EvolutionGroupSendGuard({
        enabled: true,
        safeMode: true,
        maxMessagesPerRun: 1,
      }),
    });

    provider.beginRun('run-a');
    await provider.sendMessage({ destination, message: 'Oferta A' });
    provider.beginRun('run-b');
    await expect(
      provider.sendMessage({ destination, message: 'Oferta B' }),
    ).rejects.toMatchObject({
      code: 'EVOLUTION_SAFE_LIMIT_REACHED',
      deliveryMayHaveStarted: false,
    });

    expect(sendGuard.requestCount).toBe(1);
    expect(httpClient).toHaveBeenCalledTimes(1);
  });

  it('impede request HTTP se groupSendGuard bloquear envio de imagem em grupo', async () => {
    const httpClient = vi.fn();
    const groupSendGuard = new EvolutionGroupSendGuard({
      enabled: false,
      safeMode: true,
      maxMessagesPerRun: 10,
    });
    vi.spyOn(groupSendGuard, 'authorizeRequest');
    const provider = createProvider(httpClient, { groupSendGuard });

    const groupJid = '120363000000000000@g.us';
    await expect(
      provider.sendMessage({
        destination: groupJid,
        destinationType: 'GROUP',
        message: 'Legenda grupo',
        imageUrl: 'https://example.com/group-image.jpg',
      }),
    ).rejects.toMatchObject({
      code: 'WHATSAPP_GROUP_SEND_DISABLED',
      deliveryMayHaveStarted: false,
    });

    expect(groupSendGuard.authorizeRequest).toHaveBeenCalledWith(groupJid);
    expect(httpClient).not.toHaveBeenCalled();
  });

  it('mapeia timeout em sendMedia sem realizar retry nem chamar sendText', async () => {
    const httpClient: HttpClient = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    const spyClient = vi.fn(httpClient);
    const provider = createProvider(spyClient, { timeoutMs: 5 });

    await expect(
      provider.sendMessage({
        destination: '5511999999999',
        message: 'Oferta com imagem',
        imageUrl: 'https://example.com/image.jpg',
      }),
    ).rejects.toMatchObject({
      code: 'EVOLUTION_TIMEOUT',
      deliveryMayHaveStarted: true,
    });

    expect(spyClient).toHaveBeenCalledTimes(1);
    expect(spyClient).toHaveBeenCalledWith(
      'http://localhost:8080/message/sendMedia/affiliate%20bot',
      expect.anything(),
    );
  });

  it.each([
    [400, 'EVOLUTION_BAD_REQUEST'],
    [401, 'EVOLUTION_UNAUTHORIZED'],
    [429, 'EVOLUTION_RATE_LIMITED'],
    [500, 'EVOLUTION_SERVER_ERROR'],
  ])('mapeia HTTP %i para %s em sendMedia sem fallback para sendText', async (status, code) => {
    const httpClient = vi
      .fn()
      .mockResolvedValue(response({ error: 'sendMedia error' }, status));
    const provider = createProvider(httpClient);

    await expect(
      provider.sendMessage({
        destination: '5511999999999',
        message: 'Oferta com imagem',
        imageUrl: 'https://example.com/image.jpg',
      }),
    ).rejects.toMatchObject({
      code,
      deliveryMayHaveStarted: true,
    });

    expect(httpClient).toHaveBeenCalledTimes(1);
    expect(httpClient).toHaveBeenCalledWith(
      'http://localhost:8080/message/sendMedia/affiliate%20bot',
      expect.anything(),
    );
  });

  it('rejeita resposta sem identificador de mensagem em sendMedia', async () => {
    const httpClient = vi.fn().mockResolvedValue(response({}));
    const provider = createProvider(httpClient);

    await expect(
      provider.sendMessage({
        destination: '5511999999999',
        message: 'Oferta com imagem',
        imageUrl: 'https://example.com/image.jpg',
      }),
    ).rejects.toMatchObject({
      code: 'EVOLUTION_MESSAGE_ID_MISSING',
      deliveryMayHaveStarted: true,
    });

    expect(httpClient).toHaveBeenCalledTimes(1);
  });

  it('sanitiza logs de imagem sem expor caption, imageUrl, API key ou destino real', async () => {
    const logger = createLogger();
    const groupJid = '120363000000000000@g.us';
    const imageUrl = 'https://secret.com/sensitive-image.jpg';
    const caption = 'Super Segredo de Oferta';
    const groupSendGuard = new EvolutionGroupSendGuard({
      enabled: true,
      safeMode: true,
      maxMessagesPerRun: 10,
    });

    const provider = createProvider(
      vi.fn().mockResolvedValue(response({ key: { id: 'msg-img-sent' } })),
      { logger, groupSendGuard },
    );

    await provider.sendMessage({
      destination: groupJid,
      destinationType: 'GROUP',
      message: caption,
      imageUrl,
    });

    const infoCallsStr = JSON.stringify(vi.mocked(logger.info).mock.calls);
    expect(infoCallsStr).not.toContain(caption);
    expect(infoCallsStr).not.toContain(imageUrl);
    expect(infoCallsStr).not.toContain(API_KEY);
    expect(infoCallsStr).not.toContain(groupJid);

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'evolution.message.sent',
        instanceName: 'affiliate bot',
        deliveryMode: 'IMAGE',
        destinationType: 'GROUP',
      }),
      'Evolution API message sent',
    );
  });

  it('nao inclui a API key em erros ou logs', async () => {
    const logger = createLogger();
    const provider = createProvider(
      vi.fn().mockResolvedValue(response({ error: API_KEY }, 401)),
      { logger },
    );

    let caught: unknown;
    try {
      await provider.sendMessage({
        destination: '5511999999999',
        message: 'Oferta',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AppError);
    expect(String(caught)).not.toContain(API_KEY);
    expect(JSON.stringify(caught)).not.toContain(API_KEY);
    expect(
      JSON.stringify([
        vi.mocked(logger.info).mock.calls,
        vi.mocked(logger.error).mock.calls,
      ]),
    ).not.toContain(API_KEY);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        instanceName: 'affiliate bot',
        destination: expect.not.stringContaining('5511999999999'),
        code: 'EVOLUTION_UNAUTHORIZED',
        status: 401,
      }),
      'Evolution API message failed',
    );
  });
});

describe('createWhatsAppProvider', () => {
  it('usa mock como padrao sem exigir configuracao da Evolution API', () => {
    expect(createWhatsAppProvider({})).toBeInstanceOf(MockWhatsAppProvider);
  });

  it('usa mock quando selecionado explicitamente', () => {
    expect(
      createWhatsAppProvider({ WHATSAPP_PROVIDER: 'mock' }),
    ).toBeInstanceOf(MockWhatsAppProvider);
  });

  it('cria o provider Evolution somente quando selecionado', () => {
    expect(
      createWhatsAppProvider({
        WHATSAPP_PROVIDER: 'evolution',
        EVOLUTION_API_URL: 'http://localhost:8080',
        EVOLUTION_API_KEY: API_KEY,
        EVOLUTION_INSTANCE_NAME: 'affiliate-bot',
      }),
    ).toBeInstanceOf(EvolutionApiWhatsAppProvider);
  });

  it.each([
    'EVOLUTION_API_URL',
    'EVOLUTION_API_KEY',
    'EVOLUTION_INSTANCE_NAME',
  ] as const)('exige %s no modo evolution', (field) => {
    const config = {
      WHATSAPP_PROVIDER: 'evolution' as const,
      EVOLUTION_API_URL: 'http://localhost:8080',
      EVOLUTION_API_KEY: API_KEY,
      EVOLUTION_INSTANCE_NAME: 'affiliate-bot',
      [field]: '',
    };

    expect(() => createWhatsAppProvider(config)).toThrowError(
      expect.objectContaining({ code: 'EVOLUTION_CONFIG_REQUIRED' }),
    );
  });
});
