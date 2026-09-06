import { AppError } from '@shopee-auto-affiliate-ai/shared';

export type EvolutionWebhookHttpClient = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export const EVOLUTION_DELIVERY_WEBHOOK_EVENT = 'MESSAGES_UPDATE';
export const EVOLUTION_DELIVERY_WEBHOOK_PATH =
  '/whatsapp/events/messages.update';

type EvolutionWebhookConfiguration = {
  enabled?: unknown;
  url?: unknown;
  webhookUrl?: unknown;
  events?: unknown;
  headers?: unknown;
  webhookHeaders?: unknown;
  byEvents?: unknown;
  webhookByEvents?: unknown;
  base64?: unknown;
  webhookBase64?: unknown;
};

type DeliveryWebhookOptions = {
  baseUrl: string;
  apiKey: string;
  instanceName: string;
  callbackUrl?: string;
  callbackToken?: string;
  callbackPort?: number;
  httpClient: EvolutionWebhookHttpClient;
  timeoutMs: number;
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const normalizeUrl = (value: string) => value.replace(/\/+$/, '');

const failClosed = (message: string): never => {
  throw new AppError(message, 'WHATSAPP_DELIVERY_CONFIRMATION_NOT_READY');
};

const requireHostOnlyCallbackUrl = (
  value: string | undefined,
  expectedPort?: number,
) => {
  if (!value?.trim()) {
    return failClosed('Webhook de confirmacao de entrega nao configurado');
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return failClosed('URL do webhook de confirmacao invalida');
  }
  if (
    parsed.protocol !== 'http:' ||
    parsed.hostname !== 'host.docker.internal' ||
    parsed.pathname !== EVOLUTION_DELIVERY_WEBHOOK_PATH ||
    parsed.search ||
    parsed.hash ||
    parsed.username ||
    parsed.password
  ) {
    return failClosed('URL do webhook deve apontar para a API host-only');
  }
  if (
    expectedPort !== undefined &&
    (!Number.isSafeInteger(expectedPort) || expectedPort < 1 || expectedPort > 65_535 ||
      Number(parsed.port || '80') !== expectedPort)
  ) {
    return failClosed('Porta do webhook nao corresponde a porta da API local');
  }
  return parsed.toString();
};

const requireCallbackToken = (value: string | undefined) => {
  if (!value?.trim() || value.trim().length > 512) {
    return failClosed('Token dedicado do webhook de entrega nao configurado');
  }
  return value.trim();
};

const webhookFromResponse = (value: unknown): EvolutionWebhookConfiguration => {
  const record = asRecord(value);
  const nested = asRecord(record?.webhook);
  return (nested ?? record ?? {}) as EvolutionWebhookConfiguration;
};

const normalizedHeaders = (value: unknown) => {
  const headers = asRecord(value);
  if (!headers) return new Map<string, string>();
  const normalized = new Map<string, string>();
  for (const [key, headerValue] of Object.entries(headers)) {
    if (typeof headerValue === 'string') {
      normalized.set(key.toLocaleLowerCase('en-US'), headerValue);
    }
  }
  return normalized;
};

const configuredEvents = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((event): event is string => typeof event === 'string')
    : [];

const configuredUrl = (value: EvolutionWebhookConfiguration) =>
  value.url ?? value.webhookUrl;

const configuredHeaders = (value: EvolutionWebhookConfiguration) =>
  value.headers ?? value.webhookHeaders;

const usesIncompatibleFormat = (value: EvolutionWebhookConfiguration) =>
  value.byEvents === true ||
  value.webhookByEvents === true ||
  value.base64 === true ||
  value.webhookBase64 === true;

const configurationMatches = (input: {
  current: EvolutionWebhookConfiguration;
  callbackUrl: string;
  callbackToken: string;
}) => {
  const events = configuredEvents(input.current.events);
  const authorization = normalizedHeaders(configuredHeaders(input.current)).get(
    'authorization',
  );
  const url = configuredUrl(input.current);
  return (
    input.current.enabled === true &&
    typeof url === 'string' &&
    url === input.callbackUrl &&
    !usesIncompatibleFormat(input.current) &&
    events.includes(EVOLUTION_DELIVERY_WEBHOOK_EVENT) &&
    authorization === `Bearer ${input.callbackToken}`
  );
};

const assertNoForeignWebhookConflict = (input: {
  current: EvolutionWebhookConfiguration;
  callbackUrl: string;
  callbackToken: string;
}) => {
  const url = configuredUrl(input.current);
  if (
    typeof url === 'string' &&
    url.trim() &&
    url !== input.callbackUrl
  ) {
    return failClosed(
      'Webhook existente aponta para outro consumidor e nao pode ser sobrescrito',
    );
  }
  if (usesIncompatibleFormat(input.current)) {
    return failClosed(
      'Webhook existente usa formato incompativel com confirmacao de entrega',
    );
  }
  const authorization = normalizedHeaders(configuredHeaders(input.current)).get(
    'authorization',
  );
  if (
    authorization !== undefined &&
    authorization !== `Bearer ${input.callbackToken}`
  ) {
    return failClosed(
      'Webhook existente possui autenticacao dedicada diferente e nao pode ser sobrescrito',
    );
  }
};

/**
 * Synchronizes the official Evolution v2.3.7 per-instance webhook before the
 * provider can start a WhatsApp request. It never sends a WhatsApp message.
 */
export class EvolutionDeliveryWebhookReadiness {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly instanceName: string;
  private readonly callbackUrl: string;
  private readonly callbackToken: string;
  private readonly httpClient: EvolutionWebhookHttpClient;
  private readonly timeoutMs: number;

  constructor(options: DeliveryWebhookOptions) {
    this.baseUrl = normalizeUrl(options.baseUrl);
    this.apiKey = options.apiKey;
    this.instanceName = options.instanceName;
    this.callbackUrl = requireHostOnlyCallbackUrl(
      options.callbackUrl,
      options.callbackPort,
    );
    this.callbackToken = requireCallbackToken(options.callbackToken);
    this.httpClient = options.httpClient;
    this.timeoutMs = options.timeoutMs;
  }

  private endpoint(action: 'find' | 'set') {
    return `${this.baseUrl}/webhook/${action}/${encodeURIComponent(this.instanceName)}`;
  }

  private async request(input: {
    action: 'find' | 'set';
    body?: Record<string, unknown>;
  }) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.httpClient(this.endpoint(input.action), {
        method: input.action === 'find' ? 'GET' : 'POST',
        headers: {
          apikey: this.apiKey,
          ...(input.body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(input.body ? { body: JSON.stringify(input.body) } : {}),
        signal: controller.signal,
      });
      if (!response.ok) {
        return failClosed('Evolution recusou a configuracao do webhook de entrega');
      }
      try {
        return webhookFromResponse(await response.json());
      } catch {
        return failClosed('Evolution retornou configuracao de webhook invalida');
      }
    } catch {
      return failClosed(
        controller.signal.aborted
          ? 'Timeout ao verificar webhook de confirmacao de entrega'
          : 'Falha ao verificar webhook de confirmacao de entrega',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async ensureReady() {
    const current = await this.request({ action: 'find' });
    const expected = {
      current,
      callbackUrl: this.callbackUrl,
      callbackToken: this.callbackToken,
    };
    if (configurationMatches(expected)) return;
    assertNoForeignWebhookConflict(expected);

    const events = new Set(configuredEvents(current.events));
    events.add(EVOLUTION_DELIVERY_WEBHOOK_EVENT);
    const headers = Object.fromEntries(normalizedHeaders(configuredHeaders(current)));
    headers.authorization = `Bearer ${this.callbackToken}`;
    await this.request({
      action: 'set',
      body: {
        webhook: {
          enabled: true,
          url: this.callbackUrl,
          events: [...events].sort(),
          headers,
          byEvents: false,
          base64: false,
        },
      },
    });

    const verified = await this.request({ action: 'find' });
    if (
      !configurationMatches({
        current: verified,
        callbackUrl: this.callbackUrl,
        callbackToken: this.callbackToken,
      })
    ) {
      return failClosed('Evolution nao confirmou o webhook de entrega esperado');
    }
  }
}
