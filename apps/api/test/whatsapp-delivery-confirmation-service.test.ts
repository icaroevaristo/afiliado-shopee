import { describe, expect, it, vi } from 'vitest';
import { MockWhatsAppProvider } from '@shopee-auto-affiliate-ai/providers';

import {
  WhatsAppDeliveryConfirmationService,
  parseEvolutionDeliveryOccurredAt,
  parseEvolutionDeliveryStatus,
  requireDeliveryEventString,
} from '../src/whatsapp-delivery-confirmation-service';
import type {
  WhatsAppDeliveryEventInboxInput,
  WhatsAppDeliveryEventInput,
} from '../src/repositories';

describe('WhatsApp delivery confirmation event contract', () => {
  it.each([
    [0, 'ERROR'],
    [1, 'PENDING'],
    [2, 'SERVER_ACK'],
    [3, 'DELIVERY_ACK'],
    [4, 'READ'],
    [5, 'READ'],
    ['SERVER_ACK', 'SERVER_ACK'],
    ['delivery_ack', 'DELIVERY_ACK'],
    ['PLAYED', 'READ'],
  ] as const)('maps Evolution status %s to %s', (input, expected) => {
    expect(parseEvolutionDeliveryStatus(input)).toBe(expected);
  });

  it('ignores an unknown provider status instead of inventing confirmation', () => {
    expect(parseEvolutionDeliveryStatus('DELIVERED_SOMEHOW')).toBeNull();
    expect(parseEvolutionDeliveryStatus(99)).toBeNull();
  });

  it('moves a mock HTTP submission from SUBMITTED to SENT only after an injected SERVER_ACK event', async () => {
    const provider = new MockWhatsAppProvider();
    const acknowledgement = await provider.sendMessage({
      destination: 'mock-destination',
      destinationType: 'INDIVIDUAL',
      message: 'Mensagem técnica de teste',
    });
    let dispatchStatus: 'SUBMITTED' | 'SENT' = 'SUBMITTED';
    const record = vi.fn(async (input: WhatsAppDeliveryEventInboxInput) => {
      const receivedAt = input.receivedAt ?? new Date();
      return {
        ...input,
        receivedAt,
        id: 'inbox-mock-1',
        fingerprint: 'mock-server-ack',
        state: 'PENDING' as const,
        appliedAt: null,
        createdAt: receivedAt,
        updatedAt: receivedAt,
      };
    });
    const applyDeliveryEvent = vi.fn(async (input: WhatsAppDeliveryEventInput) => {
      expect(input.externalMessageId).toBe(acknowledgement.externalMessageId);
      expect(dispatchStatus).toBe('SUBMITTED');
      dispatchStatus = 'SENT';
      return {
        kind: 'UPDATED' as const,
        dispatch: {
          id: 'dispatch-mock-1',
          productId: 'product-1',
          destinationId: 'destination-1',
          status: 'SENT' as const,
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
      deliveryEvents: { record, markProcessed: vi.fn(async () => true) },
      runs: { finalizeByDispatchId: vi.fn(async () => null) } as never,
      logger: { info: vi.fn(), error: vi.fn() } as never,
    });

    expect(dispatchStatus).toBe('SUBMITTED');
    await expect(
      service.consume({
        instanceName: 'mock-instance',
        externalMessageId: acknowledgement.externalMessageId,
        status: 'SERVER_ACK',
        occurredAt: acknowledgement.sentAt,
      }),
    ).resolves.toMatchObject({ kind: 'UPDATED', dispatch: { status: 'SENT' } });

    expect(provider.sentMessages).toHaveLength(1);
    expect(dispatchStatus).toBe('SENT');
    expect(record.mock.calls[0]?.[0]).not.toHaveProperty('remoteJid');
  });

  it('rejects missing correlation fields before a lifecycle write', () => {
    expect(() => requireDeliveryEventString('', 'message_id')).toThrow(
      'Evento de confirmacao de entrega invalido',
    );
    expect(() => requireDeliveryEventString(12, 'instance')).toThrow(
      'Evento de confirmacao de entrega invalido',
    );
  });

  it('retém evento desconhecido no inbox até a associação do dispatch e marca a aplicação uma vez', async () => {
    const receivedAt = new Date('2026-09-05T12:00:00.000Z');
    const event = {
      instanceName: 'instance-a',
      externalMessageId: 'provider-id',
      status: 'SERVER_ACK' as const,
      occurredAt: new Date('2026-09-05T11:59:00.000Z'),
      receivedAt,
    };
    const record = {
      ...event,
      id: 'inbox-1',
      fingerprint: 'fingerprint-1',
      state: 'PENDING' as const,
      appliedAt: null,
      createdAt: receivedAt,
      updatedAt: receivedAt,
    };
    const deliveryEvents = {
      record: vi.fn(async () => record),
      markProcessed: vi.fn(async () => true),
    };
    const applyDeliveryEvent = vi
      .fn()
      .mockResolvedValueOnce({ kind: 'NOT_FOUND' })
      .mockResolvedValueOnce({
        kind: 'UPDATED',
        dispatch: {
          id: 'dispatch-1',
          productId: 'product-1',
          destinationId: 'destination-1',
          status: 'SUBMITTED',
          generatedCopyId: 'copy-1',
          attemptCount: 1,
        },
      });
    const service = new WhatsAppDeliveryConfirmationService({
      dispatches: {
        applyDeliveryEvent,
        expireSubmittedConfirmations: vi.fn(async () => []),
      },
      deliveryEvents,
      runs: { finalizeByDispatchId: vi.fn(async () => null) } as never,
      logger: { info: vi.fn(), error: vi.fn() } as never,
    });

    await expect(service.consume(event)).resolves.toMatchObject({
      kind: 'NOT_FOUND',
    });
    expect(deliveryEvents.markProcessed).not.toHaveBeenCalled();

    await expect(service.consume(event)).resolves.toMatchObject({
      kind: 'UPDATED',
    });
    expect(deliveryEvents.record).toHaveBeenCalledTimes(2);
    expect(deliveryEvents.markProcessed).toHaveBeenCalledWith(
      expect.objectContaining({
        fingerprint: 'fingerprint-1',
        state: 'APPLIED',
      }),
    );
  });

  it('finaliza uma vez por consumo e mantém o inbox pendente quando a finalização falha', async () => {
    const event = {
      instanceName: 'instance-a',
      externalMessageId: 'provider-id',
      status: 'DELIVERY_ACK' as const,
      occurredAt: new Date('2026-09-05T12:01:00.000Z'),
    };
    const record = {
      ...event,
      id: 'inbox-1',
      fingerprint: 'fingerprint-1',
      state: 'PENDING' as const,
      receivedAt: new Date('2026-09-05T12:00:00.000Z'),
      appliedAt: null,
      createdAt: new Date('2026-09-05T12:00:00.000Z'),
      updatedAt: new Date('2026-09-05T12:00:00.000Z'),
    };
    const deliveryEvents = {
      record: vi.fn(async () => record),
      markProcessed: vi.fn(async () => true),
    };
    const applyDeliveryEvent = vi
      .fn()
      .mockResolvedValueOnce({
        kind: 'UPDATED',
        dispatch: {
          id: 'dispatch-1',
          productId: 'product-1',
          destinationId: 'destination-1',
          status: 'DELIVERED',
          generatedCopyId: 'copy-1',
          attemptCount: 1,
        },
      })
      .mockResolvedValueOnce({
        kind: 'NOOP',
        dispatch: {
          id: 'dispatch-1',
          productId: 'product-1',
          destinationId: 'destination-1',
          status: 'DELIVERED',
          generatedCopyId: 'copy-1',
          attemptCount: 1,
        },
      });
    const finalizeByDispatchId = vi.fn(async () => null);
    const manualLifecycleFinalizer = {
      finalizeAfterDispatch: vi
        .fn()
        .mockRejectedValueOnce(new Error('finalizer unavailable'))
        .mockResolvedValueOnce({
          outcome: 'ALREADY_FINALIZED' as const,
          requestId: 'request-1',
          targetId: 'target-1',
          targetStatus: 'SENT' as const,
          requestStatus: 'COMPLETED' as const,
          writes: 0,
        }),
    };
    const service = new WhatsAppDeliveryConfirmationService({
      dispatches: {
        applyDeliveryEvent,
        expireSubmittedConfirmations: vi.fn(async () => []),
      },
      deliveryEvents,
      manualLifecycleFinalizer,
      runs: { finalizeByDispatchId } as never,
      logger: { info: vi.fn(), error: vi.fn() } as never,
    });

    await expect(service.consume(event)).rejects.toThrow(
      'finalizer unavailable',
    );
    expect(deliveryEvents.markProcessed).not.toHaveBeenCalled();

    await expect(service.consume(event)).resolves.toMatchObject({
      kind: 'NOOP',
    });
    expect(manualLifecycleFinalizer.finalizeAfterDispatch).toHaveBeenCalledTimes(
      2,
    );
    expect(deliveryEvents.markProcessed).toHaveBeenCalledTimes(1);
  });

  it('deixa CAS limitado no inbox e o ciclo durável faz o replay', async () => {
    const event = {
      instanceName: 'instance-a',
      externalMessageId: 'provider-id',
      status: 'READ' as const,
      occurredAt: new Date('2026-09-05T12:03:00.000Z'),
    };
    const record = {
      ...event,
      id: 'inbox-2',
      fingerprint: 'fingerprint-2',
      state: 'PENDING' as const,
      receivedAt: new Date('2026-09-05T12:00:00.000Z'),
      appliedAt: null,
      createdAt: new Date('2026-09-05T12:00:00.000Z'),
      updatedAt: new Date('2026-09-05T12:00:00.000Z'),
    };
    const deliveryEvents = {
      record: vi.fn(async () => record),
      markProcessed: vi.fn(async () => true),
    };
    const replayPendingDeliveryEvents = vi.fn(async () => [
      {
        fingerprint: 'fingerprint-2',
        result: {
          kind: 'UPDATED' as const,
          dispatch: {
            id: 'dispatch-1',
            productId: 'product-1',
            destinationId: 'destination-1',
            status: 'READ' as const,
            generatedCopyId: 'copy-1',
            attemptCount: 1,
          },
        },
      },
    ]);
    const finalizeAfterDispatch = vi.fn(async () => ({
      outcome: 'FINALIZED' as const,
      requestId: 'request-1',
      targetId: 'target-1',
      targetStatus: 'SENT' as const,
      requestStatus: 'COMPLETED' as const,
      writes: 1,
    }));
    const service = new WhatsAppDeliveryConfirmationService({
      dispatches: {
        applyDeliveryEvent: vi.fn(async () => ({
          kind: 'PENDING' as const,
          dispatch: {
            id: 'dispatch-1',
            productId: 'product-1',
            destinationId: 'destination-1',
            status: 'DELIVERED' as const,
            generatedCopyId: 'copy-1',
            attemptCount: 1,
          },
        })),
        replayPendingDeliveryEvents,
        expireSubmittedConfirmations: vi.fn(async () => []),
      },
      deliveryEvents,
      manualLifecycleFinalizer: { finalizeAfterDispatch },
      runs: { finalizeByDispatchId: vi.fn(async () => null) } as never,
      logger: { info: vi.fn(), error: vi.fn() } as never,
    });

    await expect(service.consume(event)).resolves.toMatchObject({
      kind: 'PENDING',
    });
    expect(deliveryEvents.markProcessed).not.toHaveBeenCalled();

    await expect(service.expireDue()).resolves.toMatchObject({
      expired: 0,
      replayed: 1,
    });
    expect(replayPendingDeliveryEvents).toHaveBeenCalledOnce();
    expect(finalizeAfterDispatch).toHaveBeenCalledWith('dispatch-1');
    expect(deliveryEvents.markProcessed).toHaveBeenCalledWith(
      expect.objectContaining({
        fingerprint: 'fingerprint-2',
        state: 'APPLIED',
      }),
    );
  });

  it('mantém replay pendente quando a finalização falha no ciclo durável', async () => {
    const finalizeAfterDispatch = vi
      .fn()
      .mockRejectedValue(new Error('finalizer unavailable'));
    const deliveryEvents = {
      record: vi.fn(),
      markProcessed: vi.fn(async () => true),
    };
    const service = new WhatsAppDeliveryConfirmationService({
      dispatches: {
        replayPendingDeliveryEvents: vi.fn(async () => [
          {
            fingerprint: 'fingerprint-retry',
            result: {
              kind: 'NOOP' as const,
              dispatch: {
                id: 'dispatch-retry',
                productId: 'product-1',
                destinationId: 'destination-1',
                status: 'DELIVERED' as const,
                generatedCopyId: 'copy-1',
                attemptCount: 1,
              },
            },
          },
        ]),
        applyDeliveryEvent: vi.fn(),
        expireSubmittedConfirmations: vi.fn(async () => []),
      },
      deliveryEvents,
      manualLifecycleFinalizer: { finalizeAfterDispatch },
      runs: { finalizeByDispatchId: vi.fn(async () => null) } as never,
      logger: { info: vi.fn(), error: vi.fn() } as never,
    });

    await expect(service.expireDue()).rejects.toThrow('finalizer unavailable');
    expect(deliveryEvents.markProcessed).not.toHaveBeenCalled();
  });

  it('usa o timestamp do provider quando disponível e fallback recebido quando ausente', () => {
    const fallback = new Date('2026-09-05T12:00:00.000Z');
    expect(parseEvolutionDeliveryOccurredAt(1_787_000_000, fallback)).toEqual(
      new Date(1_787_000_000 * 1000),
    );
    expect(parseEvolutionDeliveryOccurredAt('invalid', fallback)).toBe(fallback);
  });
});
