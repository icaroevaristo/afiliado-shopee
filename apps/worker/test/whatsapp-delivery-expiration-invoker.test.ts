import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createWhatsAppDeliveryExpirationInvoker,
  WHATSAPP_DELIVERY_EXPIRATION_INTERVAL_BOUNDS,
} from '../src/whatsapp-delivery-expiration-invoker';
import { createManualPublicationLifecycleFinalizer } from '../src/whatsapp-dispatch-worker';
import { WhatsAppDeliveryConfirmationService } from '../../api/src/whatsapp-delivery-confirmation-service';

describe('WhatsApp delivery expiration invoker', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs the durable finalization cycle periodically and closes cleanly', async () => {
    vi.useFakeTimers();
    const expireDue = vi.fn(async () => ({ expired: 2 }));
    const invoker = createWhatsAppDeliveryExpirationInvoker({
      expireDue,
      intervalMs: WHATSAPP_DELIVERY_EXPIRATION_INTERVAL_BOUNDS.minMs,
      logger: { info: vi.fn(), error: vi.fn() },
    });

    await vi.advanceTimersByTimeAsync(
      WHATSAPP_DELIVERY_EXPIRATION_INTERVAL_BOUNDS.minMs,
    );
    expect(expireDue).toHaveBeenCalledTimes(1);

    await invoker.close();
    await vi.advanceTimersByTimeAsync(
      WHATSAPP_DELIVERY_EXPIRATION_INTERVAL_BOUNDS.minMs * 2,
    );
    expect(expireDue).toHaveBeenCalledTimes(1);
  });

  it('serializes overlapping cycles and fails closed after an error', async () => {
    vi.useFakeTimers();
    let release: (() => void) | undefined;
    const expireDue = vi
      .fn<() => Promise<{ expired: number }>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => resolve({ expired: 0 });
          }),
      )
      .mockRejectedValueOnce(new Error('database unavailable'));
    const logger = { info: vi.fn(), error: vi.fn() };
    const invoker = createWhatsAppDeliveryExpirationInvoker({
      expireDue,
      intervalMs: WHATSAPP_DELIVERY_EXPIRATION_INTERVAL_BOUNDS.minMs,
      logger,
    });

    const first = invoker.runNow();
    await vi.advanceTimersByTimeAsync(
      WHATSAPP_DELIVERY_EXPIRATION_INTERVAL_BOUNDS.minMs,
    );
    expect(expireDue).toHaveBeenCalledTimes(1);
    release?.();
    await first;
    await vi.advanceTimersByTimeAsync(
      WHATSAPP_DELIVERY_EXPIRATION_INTERVAL_BOUNDS.minMs,
    );
    expect(expireDue).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'whatsapp.delivery-confirmation.expiration-cycle-failed',
      }),
      expect.any(String),
    );
    await invoker.close();
  });

  it('usa o mesmo finalizer manual idempotente no ciclo de expiração', async () => {
    const finalizeAfterCommercialDispatch = vi.fn(async () => ({
      outcome: 'FINALIZED' as const,
      writes: 1,
    }));
    const finalizer = createManualPublicationLifecycleFinalizer({
      repositories: {
        manualPublicationRequests: { finalizeAfterCommercialDispatch },
      },
      logger: { info: vi.fn(), error: vi.fn() },
    });
    expect(finalizer).toBeDefined();

    const service = new WhatsAppDeliveryConfirmationService({
      dispatches: {
        replayPendingDeliveryEvents: vi.fn(async () => []),
        applyDeliveryEvent: vi.fn(),
        expireSubmittedConfirmations: vi.fn(async () => [
          {
            id: 'dispatch-1',
            status: 'AMBIGUOUS' as const,
            generatedCopyId: 'copy-1',
            attemptCount: 1,
          },
        ]),
      },
      deliveryEvents: {
        record: vi.fn(),
        markProcessed: vi.fn(),
      },
      manualLifecycleFinalizer: finalizer,
      runs: { finalizeByDispatchId: vi.fn(async () => null) } as never,
      logger: { info: vi.fn(), error: vi.fn() } as never,
    });
    const invoker = createWhatsAppDeliveryExpirationInvoker({
      expireDue: () => service.expireDue(),
      intervalMs: WHATSAPP_DELIVERY_EXPIRATION_INTERVAL_BOUNDS.minMs,
      logger: { info: vi.fn(), error: vi.fn() },
    });

    await invoker.runNow();
    expect(finalizeAfterCommercialDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ dispatchId: 'dispatch-1' }),
    );
    await invoker.close();
  });
});
