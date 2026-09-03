import { describe, expect, it, vi } from 'vitest';

import { EvolutionApiGroupDirectoryProvider } from './evolution-api-group-directory-provider';
import { EvolutionGroupSendGuard } from './evolution-group-send-guard';
import { EvolutionApiWhatsAppProvider } from './evolution-api-whatsapp-provider';
import { createWhatsAppProvider } from './whatsapp-provider-factory';
import {
  fingerprintWhatsAppGroupId,
  isWhatsAppGroupId,
  normalizeWhatsAppGroupId,
} from './whatsapp-group-directory';

const GROUP_ID = '100000000000000000@g.us';
const API_KEY = 'test-only-key';

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const createProvider = (
  httpClient: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>,
  extra: Partial<
    ConstructorParameters<typeof EvolutionApiGroupDirectoryProvider>[0]
  > = {},
) =>
  new EvolutionApiGroupDirectoryProvider({
    baseUrl: 'http://localhost:8080/',
    apiKey: API_KEY,
    instanceName: 'test-instance',
    httpClient,
    ...extra,
  });

describe('EvolutionApiGroupDirectoryProvider', () => {
  it('usa exatamente a rota read-only 2.3.7 sem participantes nem body', async () => {
    const httpClient = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        void input;
        void init;
        return response([
          {
            id: GROUP_ID,
            subject: 'Grupo controlado',
            size: 3,
            participants: [{ id: 'sensitive-participant' }],
            desc: 'sensitive-description',
            inviteCode: 'xyz',
            inviteUrl: 'https://chat.whatsapp.com/xyz',
          },
        ]);
      },
    );

    await expect(createProvider(httpClient).listGroups()).resolves.toEqual([
      {
        externalGroupId: GROUP_ID,
        name: 'Grupo controlado',
        memberCount: 3,
      },
    ]);
    expect(httpClient).toHaveBeenCalledTimes(1);
    const [url, init] = httpClient.mock.calls[0];
    expect(url).toBe(
      'http://localhost:8080/group/fetchAllGroups/test-instance?getParticipants=false',
    );
    expect(init).toMatchObject({
      method: 'GET',
      headers: { apikey: API_KEY },
    });
    expect(init?.body).toBeUndefined();
  });

  it('não inventa invite URL porque o contrato read-only atual não o fornece', async () => {
    const httpClient = vi.fn(async () =>
      response([
        {
          id: GROUP_ID,
          subject: 'Grupo sem convite confiável',
          size: 1,
          inviteCode: 'xyz',
          inviteUrl: 'https://chat.whatsapp.com/xyz',
        },
      ]),
    );

    const [group] = await createProvider(httpClient).listGroups();
    expect(group).toEqual({
      externalGroupId: GROUP_ID,
      name: 'Grupo sem convite confiável',
      memberCount: 1,
    });
    expect(group).not.toHaveProperty('inviteUrl');
    expect(group).not.toHaveProperty('inviteCode');
  });

  it('mapeia lista vazia', async () => {
    await expect(
      createProvider(async () => response([])).listGroups(),
    ).resolves.toEqual([]);
  });

  it.each([
    [400, 'EVOLUTION_GROUPS_BAD_REQUEST'],
    [401, 'EVOLUTION_GROUPS_UNAUTHORIZED'],
    [403, 'EVOLUTION_GROUPS_UNAUTHORIZED'],
    [404, 'EVOLUTION_GROUPS_NOT_FOUND'],
    [500, 'EVOLUTION_GROUPS_SERVER_ERROR'],
    [503, 'EVOLUTION_GROUPS_SERVER_ERROR'],
  ])('mapeia HTTP %s sem corpo bruto', async (status, code) => {
    const promise = createProvider(async () =>
      response({ secret: GROUP_ID }, status),
    ).listGroups();
    await expect(promise).rejects.toMatchObject({ code });
    await expect(promise).rejects.not.toThrow(GROUP_ID);
  });

  it.each([
    {},
    [{ id: GROUP_ID }],
    [{ id: 'not-a-group', subject: 'Grupo' }],
    [{ id: GROUP_ID, subject: 'Grupo', size: -1 }],
  ])('rejeita resposta malformada sem sincronizacao parcial', async (body) => {
    await expect(
      createProvider(async () => response(body)).listGroups(),
    ).rejects.toMatchObject({ code: 'EVOLUTION_GROUPS_RESPONSE_INVALID' });
  });

  it('aplica timeout configurado', async () => {
    const httpClient = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new Error('abort')),
          );
        }),
    );
    await expect(
      createProvider(httpClient, { timeoutMs: 5 }).listGroups(),
    ).rejects.toMatchObject({ code: 'EVOLUTION_GROUPS_TIMEOUT' });
  });

  it('registra somente contagem e erro sanitizado', async () => {
    const info = vi.fn();
    const error = vi.fn();
    await createProvider(
      async () =>
        response([{ id: GROUP_ID, subject: 'Nome interno', size: 1 }]),
      {
        logger: { info, error },
      },
    ).listGroups();
    const logs = JSON.stringify(info.mock.calls);
    expect(logs).toContain('groupCount');
    expect(logs).not.toContain(GROUP_ID);
    expect(logs).not.toContain('Nome interno');
    expect(logs).not.toContain(API_KEY);
  });
});

describe('identidade segura de grupos', () => {
  it('preserva o sufixo e remove somente espacos externos', () => {
    expect(normalizeWhatsAppGroupId(`  ${GROUP_ID}  `)).toBe(GROUP_ID);
  });

  it.each([
    '',
    '100 000@g.us',
    '100000',
    '+100000@g.us',
    '100000@s.whatsapp.net',
    '-100@g.us',
    '100--200@g.us',
  ])('rejeita identificador vazio, telefonico ou malformado: %s', (value) =>
    expect(() => normalizeWhatsAppGroupId(value)).toThrow(),
  );

  it('gera fingerprint criptografico estavel e nao obvio', () => {
    const fingerprint = fingerprintWhatsAppGroupId(GROUP_ID);
    expect(fingerprint).toMatch(/^grp_[a-f0-9]{12}$/);
    expect(fingerprintWhatsAppGroupId(GROUP_ID)).toBe(fingerprint);
    expect(fingerprint).not.toContain(GROUP_ID.slice(0, 6));
    expect(isWhatsAppGroupId(GROUP_ID)).toBe(true);
    expect(isWhatsAppGroupId('1000000000000')).toBe(false);
  });
});

describe('EvolutionGroupSendGuard', () => {
  it('separa uma allowlist mista entre individuo e grupo sem conversao de tipo', async () => {
    const individual = '55 (11) 99999-8888';
    const unallowedIndividual = '55119999999999';
    const wrongGroup = '200000000000000000@g.us';
    const httpClient = vi.fn(async () =>
      response({ key: { id: 'message-mixed-allowlist' } }),
    );
    const provider = createWhatsAppProvider(
      {
        WHATSAPP_PROVIDER: 'evolution',
        EVOLUTION_API_URL: 'http://localhost:8080',
        EVOLUTION_API_KEY: API_KEY,
        EVOLUTION_INSTANCE_NAME: 'test-instance',
        EVOLUTION_SAFE_MODE: true,
        EVOLUTION_ALLOWED_DESTINATIONS: `${individual}, ${GROUP_ID}`,
        EVOLUTION_MAX_MESSAGES_PER_BOOT: 1,
        WHATSAPP_GROUP_SEND_ENABLED: true,
        WHATSAPP_GROUP_MAX_MESSAGES_PER_RUN: 1,
      },
      { httpClient },
    );

    await expect(
      provider.sendMessage({
        destination: individual,
        destinationType: 'INDIVIDUAL',
        message: 'Individuo permitido',
      }),
    ).resolves.toMatchObject({ status: 'sent' });

    await expect(
      provider.sendMessage({
        destination: `  ${GROUP_ID}  `,
        destinationType: 'GROUP',
        message: 'Grupo permitido',
      }),
    ).resolves.toMatchObject({ status: 'sent' });
    expect(httpClient).toHaveBeenCalledTimes(2);

    await expect(
      provider.sendMessage({
        destination: unallowedIndividual,
        destinationType: 'INDIVIDUAL',
        message: 'Individuo bloqueado',
      }),
    ).rejects.toMatchObject({
      code: 'EVOLUTION_SAFE_DESTINATION_BLOCKED',
      deliveryMayHaveStarted: false,
    });
    await expect(
      provider.sendMessage({
        destination: wrongGroup,
        destinationType: 'GROUP',
        message: 'Grupo bloqueado',
      }),
    ).rejects.toMatchObject({
      code: 'WHATSAPP_GROUP_DESTINATION_BLOCKED',
      deliveryMayHaveStarted: false,
    });

    await expect(
      provider.sendMessage({
        destination: GROUP_ID,
        destinationType: 'INDIVIDUAL',
        message: 'JID de grupo tratado como individuo',
      }),
    ).rejects.toMatchObject({ code: 'EVOLUTION_SAFE_DESTINATION_INVALID' });
    await expect(
      provider.sendMessage({
        destination: individual,
        destinationType: 'GROUP',
        message: 'Individuo tratado como grupo',
      }),
    ).rejects.toThrow();

    expect(httpClient).toHaveBeenCalledTimes(2);
  });

  it('bloqueia grupo quando a allowlist de grupos esta vazia', async () => {
    const httpClient = vi.fn(async () =>
      response({ key: { id: 'message-not-allowed' } }),
    );
    const provider = createWhatsAppProvider(
      {
        WHATSAPP_PROVIDER: 'evolution',
        EVOLUTION_API_URL: 'http://localhost:8080',
        EVOLUTION_API_KEY: API_KEY,
        EVOLUTION_INSTANCE_NAME: 'test-instance',
        EVOLUTION_SAFE_MODE: true,
        EVOLUTION_ALLOWED_DESTINATIONS: '',
        EVOLUTION_MAX_MESSAGES_PER_BOOT: 1,
        WHATSAPP_GROUP_SEND_ENABLED: true,
        WHATSAPP_GROUP_MAX_MESSAGES_PER_RUN: 1,
      },
      { httpClient },
    );

    await expect(
      provider.sendMessage({
        destination: GROUP_ID,
        destinationType: 'GROUP',
        message: 'Mensagem bloqueada',
      }),
    ).rejects.toMatchObject({
      code: 'WHATSAPP_GROUP_DESTINATION_BLOCKED',
      deliveryMayHaveStarted: false,
    });
    expect(httpClient).not.toHaveBeenCalled();
  });

  it('aceita allowlist de JID de grupo e bloqueia outro grupo antes do HTTP', async () => {
    const httpClient = vi.fn(async () =>
      response({ key: { id: 'message-allowlisted-group' } }),
    );
    const provider = createWhatsAppProvider(
      {
        WHATSAPP_PROVIDER: 'evolution',
        EVOLUTION_API_URL: 'http://localhost:8080',
        EVOLUTION_API_KEY: API_KEY,
        EVOLUTION_INSTANCE_NAME: 'test-instance',
        EVOLUTION_SAFE_MODE: true,
        EVOLUTION_ALLOWED_DESTINATIONS: GROUP_ID,
        EVOLUTION_MAX_MESSAGES_PER_BOOT: 1,
        WHATSAPP_GROUP_SEND_ENABLED: true,
        WHATSAPP_GROUP_MAX_MESSAGES_PER_RUN: 1,
      },
      { httpClient },
    );

    await expect(
      provider.sendMessage({
        destination: '200000000000000000@g.us',
        destinationType: 'GROUP',
        message: 'Mensagem bloqueada',
      }),
    ).rejects.toMatchObject({
      code: 'WHATSAPP_GROUP_DESTINATION_BLOCKED',
      deliveryMayHaveStarted: false,
    });
    expect(httpClient).not.toHaveBeenCalled();

    await expect(
      provider.sendMessage({
        destination: GROUP_ID,
        destinationType: 'GROUP',
        message: 'Mensagem permitida',
      }),
    ).resolves.toMatchObject({ status: 'sent' });
    expect(httpClient).toHaveBeenCalledOnce();
  });

  it('bloqueia grupo quando o master switch esta desligado', () => {
    const guard = new EvolutionGroupSendGuard({
      enabled: false,
      safeMode: true,
      maxMessagesPerRun: 1,
    });
    expect(() => guard.authorizeRequest(GROUP_ID)).toThrowError(
      expect.objectContaining({ code: 'WHATSAPP_GROUP_SEND_DISABLED' }),
    );
    expect(guard.requestCount).toBe(0);
  });

  it('exige safe mode e limita requests iniciados', () => {
    expect(() =>
      new EvolutionGroupSendGuard({
        enabled: true,
        safeMode: false,
        maxMessagesPerRun: 1,
      }).authorizeRequest(GROUP_ID),
    ).toThrowError(
      expect.objectContaining({ code: 'WHATSAPP_GROUP_SAFE_MODE_REQUIRED' }),
    );

    const guard = new EvolutionGroupSendGuard({
      enabled: true,
      safeMode: true,
      maxMessagesPerRun: 1,
    });
    guard.authorizeRequest(GROUP_ID);
    expect(() => guard.authorizeRequest(GROUP_ID)).toThrowError(
      expect.objectContaining({ code: 'WHATSAPP_GROUP_LIMIT_REACHED' }),
    );
  });

  it('limita requests por run sem resetar um run ja iniciado', () => {
    const guard = new EvolutionGroupSendGuard({
      enabled: true,
      safeMode: true,
      maxMessagesPerRun: 1,
    });

    guard.beginRun('run-a');
    guard.authorizeRequest(GROUP_ID);
    expect(() => guard.authorizeRequest(GROUP_ID)).toThrowError(
      expect.objectContaining({ code: 'WHATSAPP_GROUP_LIMIT_REACHED' }),
    );

    guard.beginRun('run-a');
    expect(() => guard.authorizeRequest(GROUP_ID)).toThrowError(
      expect.objectContaining({ code: 'WHATSAPP_GROUP_LIMIT_REACHED' }),
    );

    guard.beginRun('run-b');
    expect(() => guard.authorizeRequest(GROUP_ID)).not.toThrow();

    guard.beginRun('run-a');
    expect(() => guard.authorizeRequest(GROUP_ID)).toThrowError(
      expect.objectContaining({ code: 'WHATSAPP_GROUP_LIMIT_REACHED' }),
    );
  });

  it('provider usa guard de grupo separado e loga apenas fingerprint', async () => {
    const info = vi.fn();
    const groupSendGuard = new EvolutionGroupSendGuard({
      enabled: true,
      safeMode: true,
      maxMessagesPerRun: 1,
    });
    const httpClient = vi.fn(async () =>
      response({ key: { id: 'message-test-id' } }),
    );
    const provider = new EvolutionApiWhatsAppProvider({
      baseUrl: 'http://localhost:8080',
      apiKey: API_KEY,
      instanceName: 'test-instance',
      httpClient,
      logger: { info, error: vi.fn() },
      groupSendGuard,
    });
    await provider.sendMessage({
      destination: GROUP_ID,
      message: 'Mensagem fixa de teste',
      destinationType: 'GROUP',
    });
    expect(httpClient).toHaveBeenCalledOnce();
    const logs = JSON.stringify(info.mock.calls);
    expect(logs).toContain('grp_');
    expect(logs).not.toContain(GROUP_ID);
    expect(logs).not.toContain(API_KEY);
  });
});
