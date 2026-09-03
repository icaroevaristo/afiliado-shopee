import { AppError } from '@shopee-auto-affiliate-ai/shared';

import {
  EvolutionApiWhatsAppProvider,
  type HttpClient,
  type ProviderLogger,
} from './evolution-api-whatsapp-provider';
import { MockWhatsAppProvider, type WhatsAppProvider } from './index';
import { EvolutionSendGuard } from './evolution-send-guard';
import { EvolutionGroupSendGuard } from './evolution-group-send-guard';
import {
  isWhatsAppGroupId,
  normalizeWhatsAppGroupId,
} from './whatsapp-group-directory';

export type WhatsAppProviderFactoryConfig = {
  WHATSAPP_PROVIDER?: 'mock' | 'evolution';
  EVOLUTION_API_URL?: string;
  EVOLUTION_API_KEY?: string;
  EVOLUTION_INSTANCE_NAME?: string;
  EVOLUTION_SAFE_MODE?: boolean;
  EVOLUTION_ALLOWED_DESTINATIONS?: string | readonly string[];
  EVOLUTION_MAX_MESSAGES_PER_BOOT?: number;
  WHATSAPP_GROUP_SEND_ENABLED?: boolean;
  WHATSAPP_GROUP_MAX_MESSAGES_PER_RUN?: number;
};

export type WhatsAppProviderFactoryOptions = {
  httpClient?: HttpClient;
  logger?: ProviderLogger;
  timeoutMs?: number;
};

const requireEvolutionConfig = (
  value: string | undefined,
  variableName: string,
) => {
  if (!value?.trim()) {
    throw new AppError(
      `${variableName} e obrigatoria para o provider evolution`,
      'EVOLUTION_CONFIG_REQUIRED',
    );
  }
  return value;
};

export const createWhatsAppProvider = (
  config: WhatsAppProviderFactoryConfig,
  options: WhatsAppProviderFactoryOptions = {},
): WhatsAppProvider => {
  if ((config.WHATSAPP_PROVIDER ?? 'mock') === 'mock') {
    return new MockWhatsAppProvider();
  }

  const allowedDestinationConfig = config.EVOLUTION_ALLOWED_DESTINATIONS;
  const allowedDestinations =
    typeof allowedDestinationConfig === 'string' ||
    allowedDestinationConfig === undefined
      ? (allowedDestinationConfig ?? '')
          .split(',')
          .map((destination) => destination.trim())
          .filter(Boolean)
      : allowedDestinationConfig;
  const allowedGroupDestinations = allowedDestinations
    .filter(isWhatsAppGroupId)
    .map(normalizeWhatsAppGroupId);
  const allowedIndividualDestinations = allowedDestinations.filter(
    (destination) => !isWhatsAppGroupId(destination),
  );
  const sendGuard = new EvolutionSendGuard({
    safeMode: config.EVOLUTION_SAFE_MODE ?? true,
    allowedDestinations: allowedIndividualDestinations,
    maxMessagesPerBoot: config.EVOLUTION_MAX_MESSAGES_PER_BOOT ?? 1,
    logger: options.logger,
  });
  const groupSendGuard = new EvolutionGroupSendGuard({
    enabled: config.WHATSAPP_GROUP_SEND_ENABLED ?? false,
    safeMode: config.EVOLUTION_SAFE_MODE ?? true,
    maxMessagesPerRun: config.WHATSAPP_GROUP_MAX_MESSAGES_PER_RUN ?? 1,
    allowedDestinations: allowedGroupDestinations,
    logger: options.logger,
  });

  return new EvolutionApiWhatsAppProvider({
    baseUrl: requireEvolutionConfig(
      config.EVOLUTION_API_URL,
      'EVOLUTION_API_URL',
    ),
    apiKey: requireEvolutionConfig(
      config.EVOLUTION_API_KEY,
      'EVOLUTION_API_KEY',
    ),
    instanceName: requireEvolutionConfig(
      config.EVOLUTION_INSTANCE_NAME,
      'EVOLUTION_INSTANCE_NAME',
    ),
    ...options,
    sendGuard,
    groupSendGuard,
  });
};
