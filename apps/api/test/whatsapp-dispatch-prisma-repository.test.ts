import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PrismaWhatsAppDispatchRepository } from '../src/prisma-repositories';
import {
  COMMERCIAL_AI_COPY_PROMPT_VERSION,
  COMMERCIAL_AI_COPY_VALIDATION_VERSION,
} from '../src/commercial-ai-copy-prompt';

const fingerprint = 'commercial-fingerprint';
const groupFingerprint = 'grp_aaaaaaaaaaaa';

describe('PrismaWhatsAppDispatchRepository', () => {
  let prismaMock: Record<string, Record<string, import('vitest').Mock>>;
  let repository: PrismaWhatsAppDispatchRepository;

  beforeEach(() => {
    prismaMock = {
      whatsAppDispatch: {
        findUnique: vi.fn(),
        findUniqueOrThrow: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        updateMany: vi.fn(),
      },
      whatsAppDeliveryEventInbox: {
        createMany: vi.fn(),
        findUniqueOrThrow: vi.fn(),
        findMany: vi.fn(),
        updateMany: vi.fn(),
      },
      commercialPromotionCandidate: {
        findUnique: vi.fn(),
      },
    };
    repository = new PrismaWhatsAppDispatchRepository(prismaMock as never);
  });

  it('findByIdForSending carrega e normaliza todo o boundary comercial em uma unica query', async () => {
    prismaMock.whatsAppDispatch.findUnique.mockResolvedValueOnce({
      id: 'disp-1',
      productId: 'prod-1',
      generatedCopyId: 'copy-1',
      destinationId: 'dest-1',
      externalMessageId: null,
      status: 'PENDING',
      attemptCount: 0,
      errorMessage: null,
      sentAt: null,
      createdAt: new Date('2026-08-16T12:00:00.000Z'),
      updatedAt: new Date('2026-08-16T12:00:00.000Z'),
      destination: {
        id: 'dest-1',
        destination: '120363000000000000@g.us',
        type: 'GROUP',
        active: true,
        available: true,
        fingerprint: groupFingerprint,
        sourceInstanceName: 'affiliate-bot',
      },
      product: {
        comissao: 10,
        urlImagem: 'https://shopee.com/image.jpg',
        affiliateLink: 'https://s.shopee.com.br/affiliate-1',
      },
      generatedCopy: {
        id: 'copy-1',
        productId: 'prod-1',
        snapshotId: 'snap-1',
        titulo: 'Title',
        mensagem: 'Message',
        cta: 'CTA',
        hashtags: '#promo',
        createdFromCandidateId: 'cand-1',
        source: 'AI',
        provider: 'openai',
        model: 'gpt-test',
        promptVersion: COMMERCIAL_AI_COPY_PROMPT_VERSION,
        validationVersion: COMMERCIAL_AI_COPY_VALIDATION_VERSION,
        promotionCandidates: [
          {
            id: 'cand-1',
            campaignId: 'campaign-1',
            productId: 'prod-1',
            snapshotId: 'snap-1',
            generatedCopyId: 'copy-1',
            status: 'COPY_READY',
            expiresAt: null,
            campaign: {
              id: 'campaign-1',
              logicalGroupFingerprint: groupFingerprint,
            },
            product: {
              id: 'prod-1',
              source: 'OFFICIAL',
              providerProductId: 'provider-prod-1',
              nome: 'Produto',
              loja: 'Loja',
              productLink: 'https://shopee.com.br/product/1/1',
              affiliateLink: 'https://s.shopee.com.br/affiliate-1',
              preco: '99.90',
              precoMin: null,
              precoMax: null,
              desconto: 20,
              comissao: 10,
              nota: 4.8,
              vendidos: 100,
              offerStartsAt: null,
              urlImagem: 'https://shopee.com/image.jpg',
              offerEndsAt: null,
              unavailableAt: null,
              commercialSnapshotRevision: 1,
              commercialSnapshotFingerprint: fingerprint,
              updatedAt: new Date('2026-08-16T12:00:00.000Z'),
            },
            snapshot: {
              id: 'snap-1',
              productId: 'prod-1',
              revision: 1,
              fingerprint,
              unavailableAt: null,
              offerEndsAt: null,
            },
          },
        ],
      },
    });

    const result = await repository.findByIdForSending('disp-1');

    expect(prismaMock.whatsAppDispatch.findUnique).toHaveBeenCalledTimes(1);
    expect(prismaMock.commercialPromotionCandidate.findUnique).not.toHaveBeenCalled();
    const callArgs = prismaMock.whatsAppDispatch.findUnique.mock.calls[0]?.[0];
    expect(callArgs).toBeDefined();
    expect(callArgs.include).toBeUndefined();
    expect(callArgs.select.destination.select).toMatchObject({
      id: true,
      fingerprint: true,
      sourceInstanceName: true,
    });
    expect(callArgs.select.generatedCopy.select).toMatchObject({
      source: true,
      provider: true,
      model: true,
      promptVersion: true,
      validationVersion: true,
    });
    const candidateSelect =
      callArgs.select.generatedCopy.select.promotionCandidates.select;
    expect(candidateSelect.campaign.select).toMatchObject({
      id: true,
      logicalGroupFingerprint: true,
    });
    expect(candidateSelect.product.select).toMatchObject({
      commercialSnapshotFingerprint: true,
      commercialSnapshotRevision: true,
      productLink: true,
      affiliateLink: true,
    });
    expect(candidateSelect.snapshot.select).toMatchObject({ fingerprint: true });

    expect(result).toMatchObject({
      id: 'disp-1',
      destination: {
        id: 'dest-1',
        fingerprint: groupFingerprint,
        sourceInstanceName: 'affiliate-bot',
      },
      generatedCopy: {
        source: 'AI',
        provider: 'openai',
        model: 'gpt-test',
        promptVersion: COMMERCIAL_AI_COPY_PROMPT_VERSION,
        validationVersion: COMMERCIAL_AI_COPY_VALIDATION_VERSION,
        promotionCandidates: [
          {
            campaignId: 'campaign-1',
            campaign: { logicalGroupFingerprint: groupFingerprint },
            product: {
              productName: 'Produto',
              shopName: 'Loja',
              price: '99.90',
              commercialSnapshotFingerprint: fingerprint,
            },
            snapshot: { fingerprint },
          },
        ],
      },
    });
  });

  it('persiste submissão sem promover para SENT antes do evento do provedor', async () => {
    const submittedAt = new Date('2026-09-05T12:00:00.000Z');
    prismaMock.whatsAppDispatch.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.whatsAppDispatch.findUniqueOrThrow.mockResolvedValue({
      id: 'dispatch-1',
      status: 'SUBMITTED',
      externalMessageId: 'provider-id',
      submittedAt,
    });

    const result = await repository.markSubmitted('dispatch-1', {
      externalMessageId: 'provider-id',
      submittedAt,
      confirmationDeadlineAt: new Date('2026-09-05T12:15:00.000Z'),
    });

    expect(prismaMock.whatsAppDispatch.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'dispatch-1',
        status: 'PROCESSING',
        externalMessageId: null,
      },
      data: expect.objectContaining({
        status: 'SUBMITTED',
        externalMessageId: 'provider-id',
      }),
    });
    expect(result.status).toBe('SUBMITTED');
  });

  it('advances SERVER_ACK once and ignores a delayed duplicate', async () => {
    prismaMock.whatsAppDispatch.findMany
      .mockResolvedValueOnce([
        { id: 'dispatch-1', status: 'SUBMITTED', sentAt: null },
      ])
      .mockResolvedValueOnce([
        { id: 'dispatch-1', status: 'SENT', sentAt: new Date('2026-09-05T12:01:00.000Z') },
      ]);
    prismaMock.whatsAppDispatch.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    prismaMock.whatsAppDispatch.findUniqueOrThrow.mockResolvedValue({
      id: 'dispatch-1',
      status: 'SENT',
      generatedCopyId: 'copy-1',
      attemptCount: 1,
    });

    const acknowledgedAt = new Date('2026-09-05T12:01:00.000Z');
    const first = await repository.applyDeliveryEvent({
      instanceName: 'instance-a',
      externalMessageId: 'provider-id',
      status: 'SERVER_ACK',
      occurredAt: acknowledgedAt,
    });
    const duplicate = await repository.applyDeliveryEvent({
      instanceName: 'instance-a',
      externalMessageId: 'provider-id',
      status: 'SERVER_ACK',
      occurredAt: acknowledgedAt,
    });

    expect(first).toMatchObject({ kind: 'UPDATED', dispatch: { status: 'SENT' } });
    expect(duplicate).toMatchObject({ kind: 'NOOP' });
    expect(prismaMock.whatsAppDispatch.updateMany.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        where: { id: 'dispatch-1', status: 'SUBMITTED', sentAt: null },
        data: expect.objectContaining({ status: 'SENT', sentAt: acknowledgedAt }),
      }),
    );
  });

  it('fails closed when historical rows make external-message correlation ambiguous', async () => {
    prismaMock.whatsAppDispatch.findMany.mockResolvedValue([
      { id: 'dispatch-1', status: 'SUBMITTED', sentAt: null },
      { id: 'dispatch-2', status: 'SUBMITTED', sentAt: null },
    ]);

    const result = await repository.applyDeliveryEvent({
      instanceName: 'instance-a',
      externalMessageId: 'historical-collision',
      status: 'SERVER_ACK',
      occurredAt: new Date('2026-09-05T12:01:00.000Z'),
    });

    expect(result).toEqual({ kind: 'NOOP' });
    expect(prismaMock.whatsAppDispatch.updateMany).not.toHaveBeenCalled();
  });

  it('preserves the minimum SERVER_ACK timestamp on later delivery and read events', async () => {
    const serverAckAt = new Date('2026-09-05T12:01:00.000Z');
    prismaMock.whatsAppDispatch.findMany
      .mockResolvedValueOnce([
        { id: 'dispatch-1', status: 'SENT', sentAt: serverAckAt },
      ])
      .mockResolvedValueOnce([
        { id: 'dispatch-1', status: 'DELIVERED', sentAt: serverAckAt },
      ]);
    prismaMock.whatsAppDispatch.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.whatsAppDispatch.findUniqueOrThrow
      .mockResolvedValueOnce({ id: 'dispatch-1', status: 'DELIVERED', sentAt: serverAckAt })
      .mockResolvedValueOnce({ id: 'dispatch-1', status: 'READ', sentAt: serverAckAt });

    await repository.applyDeliveryEvent({
      instanceName: 'instance-a',
      externalMessageId: 'provider-id',
      status: 'DELIVERY_ACK',
      occurredAt: new Date('2026-09-05T12:02:00.000Z'),
    });
    await repository.applyDeliveryEvent({
      instanceName: 'instance-a',
      externalMessageId: 'provider-id',
      status: 'READ',
      occurredAt: new Date('2026-09-05T12:03:00.000Z'),
    });

    expect(prismaMock.whatsAppDispatch.updateMany.mock.calls[0]?.[0]?.data).not.toHaveProperty('sentAt');
    expect(prismaMock.whatsAppDispatch.updateMany.mock.calls[1]?.[0]?.data).not.toHaveProperty('sentAt');
  });

  it('retries a later delivery when its first CAS races with SERVER_ACK', async () => {
    const serverAckAt = new Date('2026-09-05T12:01:00.000Z');
    const deliveryAt = new Date('2026-09-05T12:02:00.000Z');
    prismaMock.whatsAppDispatch.findMany.mockResolvedValueOnce([
      {
        id: 'dispatch-1',
        status: 'SUBMITTED',
        sentAt: null,
        deliveredAt: null,
        readAt: null,
      },
    ]);
    prismaMock.whatsAppDispatch.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    prismaMock.whatsAppDispatch.findUniqueOrThrow
      .mockResolvedValueOnce({
        id: 'dispatch-1',
        status: 'SENT',
        sentAt: serverAckAt,
        generatedCopyId: 'copy-1',
        attemptCount: 1,
      })
      .mockResolvedValueOnce({
        id: 'dispatch-1',
        status: 'DELIVERED',
        sentAt: serverAckAt,
        deliveredAt: deliveryAt,
        generatedCopyId: 'copy-1',
        attemptCount: 1,
      });

    const result = await repository.applyDeliveryEvent({
      instanceName: 'instance-a',
      externalMessageId: 'provider-id',
      status: 'DELIVERY_ACK',
      occurredAt: deliveryAt,
    });

    expect(result).toMatchObject({
      kind: 'UPDATED',
      dispatch: {
        status: 'DELIVERED',
        sentAt: serverAckAt,
        deliveredAt: deliveryAt,
      },
    });
    expect(prismaMock.whatsAppDispatch.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'dispatch-1',
        status: { in: ['SUBMITTED', 'SENT'] },
        sentAt: null,
      },
      data: expect.objectContaining({
        status: 'DELIVERED',
        sentAt: deliveryAt,
      }),
    });
    expect(prismaMock.whatsAppDispatch.updateMany.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        where: {
          id: 'dispatch-1',
          status: { in: ['SUBMITTED', 'SENT'] },
          sentAt: serverAckAt,
        },
        data: expect.objectContaining({
          status: 'DELIVERED',
          deliveredAt: deliveryAt,
        }),
      }),
    );
    expect(prismaMock.whatsAppDispatch.updateMany.mock.calls[1]?.[0]?.data).not.toHaveProperty(
      'sentAt',
    );
  });

  it('keeps a delivery event pending after bounded CAS contention', async () => {
    const serverAckAt = new Date('2026-09-05T12:01:00.000Z');
    prismaMock.whatsAppDispatch.findMany.mockResolvedValueOnce([
      {
        id: 'dispatch-1',
        status: 'SUBMITTED',
        sentAt: null,
        deliveredAt: null,
        readAt: null,
      },
    ]);
    prismaMock.whatsAppDispatch.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.whatsAppDispatch.findUniqueOrThrow.mockResolvedValue({
      id: 'dispatch-1',
      status: 'SENT',
      sentAt: serverAckAt,
      deliveredAt: null,
      readAt: null,
      generatedCopyId: 'copy-1',
      attemptCount: 1,
    });

    const result = await repository.applyDeliveryEvent({
      instanceName: 'instance-a',
      externalMessageId: 'provider-id',
      status: 'DELIVERY_ACK',
      occurredAt: new Date('2026-09-05T12:02:00.000Z'),
    });

    expect(result).toMatchObject({
      kind: 'PENDING',
      dispatch: { status: 'SENT', sentAt: serverAckAt },
    });
    expect(prismaMock.whatsAppDispatch.updateMany).toHaveBeenCalledTimes(3);
  });

  it('drena evento inbox depois de markSubmitted sem rebaixar o lifecycle', async () => {
    const submittedAt = new Date('2026-09-05T12:00:00.000Z');
    const occurredAt = new Date('2026-09-05T12:01:00.000Z');
    prismaMock.whatsAppDispatch.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.whatsAppDispatch.findUniqueOrThrow
      .mockResolvedValueOnce({
        id: 'dispatch-1',
        instanceName: 'instance-a',
        externalMessageId: 'provider-id',
        status: 'SUBMITTED',
        submittedAt,
      })
      .mockResolvedValueOnce({
        id: 'dispatch-1',
        instanceName: 'instance-a',
        externalMessageId: 'provider-id',
        status: 'SENT',
        sentAt: occurredAt,
      })
      .mockResolvedValueOnce({
        id: 'dispatch-1',
        instanceName: 'instance-a',
        externalMessageId: 'provider-id',
        status: 'SENT',
        sentAt: occurredAt,
      });
    prismaMock.whatsAppDeliveryEventInbox.findMany.mockResolvedValue([
      {
        id: 'inbox-1',
        instanceName: 'instance-a',
        externalMessageId: 'provider-id',
        status: 'SERVER_ACK',
        occurredAt,
        receivedAt: submittedAt,
      },
    ]);
    prismaMock.whatsAppDeliveryEventInbox.updateMany.mockResolvedValue({
      count: 1,
    });
    prismaMock.whatsAppDispatch.findMany.mockResolvedValueOnce([
      { id: 'dispatch-1', status: 'SUBMITTED', sentAt: null, deliveredAt: null, readAt: null },
    ]);
    prismaMock.whatsAppDispatch.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });

    const result = await repository.markSubmitted('dispatch-1', {
      externalMessageId: 'provider-id',
      submittedAt,
      confirmationDeadlineAt: new Date('2026-09-05T12:15:00.000Z'),
    });

    expect(result).toMatchObject({ status: 'SENT', sentAt: occurredAt });
    expect(prismaMock.whatsAppDeliveryEventInbox.updateMany).not.toHaveBeenCalled();
  });

  it('expires only SUBMITTED dispatches through a compare-and-set', async () => {
    const deadline = new Date('2026-09-05T12:15:00.000Z');
    prismaMock.whatsAppDispatch.findMany.mockResolvedValue([{ id: 'dispatch-1' }]);
    prismaMock.whatsAppDispatch.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.whatsAppDispatch.findUniqueOrThrow.mockResolvedValue({
      id: 'dispatch-1',
      status: 'AMBIGUOUS',
      generatedCopyId: 'copy-1',
      attemptCount: 1,
    });

    const expired = await repository.expireSubmittedConfirmations(deadline);

    expect(expired).toHaveLength(1);
    expect(prismaMock.whatsAppDispatch.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'dispatch-1',
        status: 'SUBMITTED',
        confirmationDeadlineAt: { lte: deadline },
      },
      data: expect.objectContaining({ status: 'AMBIGUOUS' }),
    });
  });
});
