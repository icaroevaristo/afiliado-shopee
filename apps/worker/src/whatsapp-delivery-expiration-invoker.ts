import { AppError } from '@shopee-auto-affiliate-ai/shared';

export type WhatsAppDeliveryExpirationInvokerLogger = {
  info: (obj: unknown, message?: string) => void;
  error: (obj: unknown, message?: string) => void;
};

export type WhatsAppDeliveryExpirationInvoker = {
  runNow: () => Promise<void>;
  close: () => Promise<void>;
};

const MIN_INTERVAL_MS = 10_000;
const MAX_INTERVAL_MS = 3_600_000;

export const createWhatsAppDeliveryExpirationInvoker = (options: {
  expireDue: () => Promise<{ expired: number }>;
  intervalMs: number;
  logger: WhatsAppDeliveryExpirationInvokerLogger;
}): WhatsAppDeliveryExpirationInvoker => {
  if (
    !Number.isSafeInteger(options.intervalMs) ||
    options.intervalMs < MIN_INTERVAL_MS ||
    options.intervalMs > MAX_INTERVAL_MS
  ) {
    throw new AppError(
      'Intervalo do invocador de expiracao WhatsApp invalido',
      'WHATSAPP_DELIVERY_EXPIRATION_INTERVAL_INVALID',
    );
  }

  let closed = false;
  let inFlight: Promise<void> | undefined;
  const runNow = async () => {
    if (closed) return;
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const result = await options.expireDue();
        options.logger.info(
          {
            event: 'whatsapp.delivery-confirmation.expiration-cycle',
            expired: result.expired,
          },
          'WhatsApp delivery confirmation expiration cycle completed',
        );
      } catch (error) {
        options.logger.error(
          {
            event: 'whatsapp.delivery-confirmation.expiration-cycle-failed',
            errorType: error instanceof Error ? error.name : 'UnknownError',
          },
          'WhatsApp delivery confirmation expiration cycle failed closed',
        );
      } finally {
        inFlight = undefined;
      }
    })();
    return inFlight;
  };

  const timer = setInterval(() => {
    void runNow();
  }, options.intervalMs);
  timer.unref?.();

  return {
    runNow,
    close: async () => {
      closed = true;
      clearInterval(timer);
      await inFlight;
    },
  };
};

export const WHATSAPP_DELIVERY_EXPIRATION_INTERVAL_BOUNDS = {
  minMs: MIN_INTERVAL_MS,
  maxMs: MAX_INTERVAL_MS,
} as const;
