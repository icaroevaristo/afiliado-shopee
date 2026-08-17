import { AppError } from '@shopee-auto-affiliate-ai/shared';

import type {
  WhatsAppProvider,
  WhatsAppSendInput,
  WhatsAppSendResult,
} from './index';
import {
  maskEvolutionDestination,
  type EvolutionSendGuard,
} from './evolution-send-guard';
import type { EvolutionGroupSendGuard } from './evolution-group-send-guard';
import { fingerprintWhatsAppGroupId } from './whatsapp-group-directory';
import { WhatsAppSendError } from './whatsapp-send-error';
import { buildEvolutionMessagePayload } from './evolution-payload-builder';

export type HttpClient = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type ProviderLogger = {
  info(data: Record<string, unknown>, message?: string): void;
  error(data: Record<string, unknown>, message?: string): void;
};

export type EvolutionApiWhatsAppProviderOptions = {
  baseUrl: string;
  apiKey: string;
  instanceName: string;
  httpClient?: HttpClient;
  logger?: ProviderLogger;
  timeoutMs?: number;
  sendGuard?: EvolutionSendGuard;
  groupSendGuard?: EvolutionGroupSendGuard;
};

const DEFAULT_TIMEOUT_MS = 10_000;

const normalizeBaseUrl = (value: string) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError(
      'URL da Evolution API invalida',
      'EVOLUTION_INVALID_URL',
    );
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new AppError(
      'URL da Evolution API invalida',
      'EVOLUTION_INVALID_URL',
    );
  }

  return value.replace(/\/+$/, '');
};

const requireValue = (value: string, message: string, code: string) => {
  if (value.trim().length === 0) throw new AppError(message, code);
  return value.trim();
};

const httpError = (status: number) => {
  if (status === 400) {
    return new AppError(
      'Requisicao rejeitada pela Evolution API',
      'EVOLUTION_BAD_REQUEST',
    );
  }
  if (status === 401) {
    return new AppError(
      'Evolution API recusou a autenticacao',
      'EVOLUTION_UNAUTHORIZED',
    );
  }
  if (status === 403) {
    return new AppError(
      'Evolution API recusou o acesso',
      'EVOLUTION_FORBIDDEN',
    );
  }
  if (status === 404) {
    return new AppError(
      'Instancia ou recurso nao encontrado na Evolution API',
      'EVOLUTION_NOT_FOUND',
    );
  }
  if (status === 429) {
    return new AppError(
      'Limite de requisicoes da Evolution API excedido',
      'EVOLUTION_RATE_LIMITED',
    );
  }
  if (status >= 500) {
    return new AppError('Evolution API indisponivel', 'EVOLUTION_SERVER_ERROR');
  }
  return new AppError(
    'Falha na requisicao para a Evolution API',
    'EVOLUTION_HTTP_ERROR',
  );
};

const readMessageId = (body: unknown) => {
  if (!body || typeof body !== 'object') return undefined;
  const response = body as {
    key?: { id?: unknown };
    id?: unknown;
    messageId?: unknown;
  };
  const id = response.key?.id ?? response.id ?? response.messageId;
  return typeof id === 'string' && id.trim().length > 0 ? id : undefined;
};

/**
 * Evolution API v2 contract documented at:
 * https://docs.evolutionfoundation.com.br/evolution-api/send-text-message
 */
export class EvolutionApiWhatsAppProvider implements WhatsAppProvider {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly instanceName: string;
  private readonly httpClient: HttpClient;
  private readonly logger?: ProviderLogger;
  private readonly timeoutMs: number;
  private readonly sendGuard?: EvolutionSendGuard;
  private readonly groupSendGuard?: EvolutionGroupSendGuard;

  constructor(options: EvolutionApiWhatsAppProviderOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.apiKey = requireValue(
      options.apiKey,
      'API key da Evolution API e obrigatoria',
      'EVOLUTION_API_KEY_REQUIRED',
    );
    this.instanceName = requireValue(
      options.instanceName,
      'Nome da instancia da Evolution API e obrigatorio',
      'EVOLUTION_INSTANCE_NAME_REQUIRED',
    );
    if (
      !Number.isFinite(options.timeoutMs ?? DEFAULT_TIMEOUT_MS) ||
      (options.timeoutMs ?? DEFAULT_TIMEOUT_MS) <= 0
    ) {
      throw new AppError(
        'Timeout da Evolution API deve ser positivo',
        'EVOLUTION_INVALID_TIMEOUT',
      );
    }
    this.httpClient = options.httpClient ?? fetch;
    this.logger = options.logger;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.sendGuard = options.sendGuard;
    this.groupSendGuard = options.groupSendGuard;
  }

  beginRun(runId: string) {
    this.groupSendGuard?.beginRun(runId);
  }

  async sendMessage(input: WhatsAppSendInput): Promise<WhatsAppSendResult> {
    let destination: string;
    let message: string;
    let isGroup: boolean;
    let destinationPublic: string;
    let imageRequested: boolean;
    let imageUrl: string | undefined;
    let payload: { url: string; method: string; body: string };

    try {
      destination = requireValue(
        input.destination,
        'Destino WhatsApp e obrigatorio',
        'WHATSAPP_DESTINATION_REQUIRED',
      );
      message = requireValue(
        input.message,
        'Mensagem WhatsApp e obrigatoria',
        'WHATSAPP_MESSAGE_REQUIRED',
      );

      const rawImageUrl = input.imageUrl;
      imageRequested = rawImageUrl !== undefined && rawImageUrl !== null;
      if (imageRequested) {
        if (
          typeof rawImageUrl !== 'string' ||
          /[\u0000-\u001f\u007f]/u.test(rawImageUrl)
        ) {
          throw new AppError('URL de imagem invalida', 'WHATSAPP_IMAGE_URL_INVALID');
        }
        const trimmed = rawImageUrl.trim();
        if (trimmed.length === 0) {
          throw new AppError('URL de imagem invalida', 'WHATSAPP_IMAGE_URL_INVALID');
        }
        let parsedUrl: URL;
        try {
          parsedUrl = new URL(trimmed);
        } catch {
          throw new AppError('URL de imagem invalida', 'WHATSAPP_IMAGE_URL_INVALID');
        }
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
          throw new AppError('URL de imagem invalida', 'WHATSAPP_IMAGE_URL_INVALID');
        }
        imageUrl = trimmed;
      }

      isGroup = input.destinationType === 'GROUP';
      destinationPublic = isGroup
        ? fingerprintWhatsAppGroupId(destination)
        : maskEvolutionDestination(destination);

      if (isGroup) {
        if (!this.groupSendGuard) {
          throw new AppError(
            'Envio para grupos nao foi configurado',
            'WHATSAPP_GROUP_SEND_NOT_CONFIGURED',
          );
        }
        this.groupSendGuard.authorizeRequest(destination);
      } else {
        this.sendGuard?.authorizeRequest(destination);
      }

      try {
        payload = buildEvolutionMessagePayload({
          baseUrl: this.baseUrl,
          instanceName: this.instanceName,
          destination,
          deliveryMode: imageRequested ? 'IMAGE' : 'TEXT',
          text: message,
          imageUrl,
        });
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === 'COMMERCIAL_EVOLUTION_INVALID_IMAGE_URL'
        ) {
          throw new AppError('URL de imagem invalida', 'WHATSAPP_IMAGE_URL_INVALID');
        }
        throw new AppError(
          'Falha ao validar envio WhatsApp',
          'WHATSAPP_SEND_PREFLIGHT_FAILED',
        );
      }
    } catch (error) {
      const preflightError =
        error instanceof AppError
          ? error
          : new AppError(
              'Falha ao validar envio WhatsApp',
              'WHATSAPP_SEND_PREFLIGHT_FAILED',
            );

      throw new WhatsAppSendError(
        preflightError.message,
        preflightError.code,
        {
          deliveryMayHaveStarted: false,
        },
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let responseStatus: number | undefined;
    let deliveryMayHaveStarted = false;

    try {
      deliveryMayHaveStarted = true;
      const response = await this.httpClient(payload.url, {
        method: payload.method,
        headers: {
          'Content-Type': 'application/json',
          apikey: this.apiKey,
        },
        body: payload.body,
        signal: controller.signal,
      });
      responseStatus = response.status;

      if (!response.ok) throw httpError(response.status);

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        body = undefined;
      }
      const externalMessageId = readMessageId(body);
      if (!externalMessageId) {
        throw new AppError(
          'Evolution API retornou uma resposta sem identificador de mensagem',
          'EVOLUTION_MESSAGE_ID_MISSING',
        );
      }

      const result = {
        externalMessageId,
        status: 'sent' as const,
        sentAt: new Date(),
      };
      this.logger?.info(
        {
          event: 'evolution.message.sent',
          instanceName: this.instanceName,
          destination: destinationPublic,
          destinationType: input.destinationType ?? 'INDIVIDUAL',
          deliveryMode: imageRequested ? 'IMAGE' : 'TEXT',
        },
        'Evolution API message sent',
      );
      return result;
    } catch (error) {
      const mappedError = controller.signal.aborted
        ? new AppError(
            'Timeout ao acessar a Evolution API',
            'EVOLUTION_TIMEOUT',
          )
        : error instanceof AppError
          ? error
          : new AppError(
              'Falha de rede ao acessar a Evolution API',
              'EVOLUTION_NETWORK_ERROR',
            );
      this.logger?.error(
        {
          event: 'evolution.message.failed',
          instanceName: this.instanceName,
          destination: destinationPublic,
          destinationType: input.destinationType ?? 'INDIVIDUAL',
          deliveryMode: imageRequested ? 'IMAGE' : 'TEXT',
          code: mappedError.code,
          ...(responseStatus === undefined ? {} : { status: responseStatus }),
        },
        'Evolution API message failed',
      );
      throw new WhatsAppSendError(
        mappedError.message,
        mappedError.code,
        { deliveryMayHaveStarted },
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
