import { describe, expect, it, vi } from 'vitest';
import {
  fingerprintWhatsAppGroupId,
  MockWhatsAppProvider,
  type WhatsAppProvider,
} from '@shopee-auto-affiliate-ai/providers';
import {
  buildWhatsAppPublicMessage,
  SenderService,
} from '../src/sender-service';
import { PrismaWhatsAppDispatchRepository } from '../src/prisma-repositories';
import { WhatsAppGroupSendPolicy } from '../src/whatsapp-group-send-policy';
import { CommercialMessageDraftService } from '../src/commercial-message-draft-service';
import { fingerprintCommercialOffer } from '../src/commercial-offer-snapshot';
import {
  COMMERCIAL_AI_COPY_PROMPT_VERSION,
  COMMERCIAL_AI_COPY_VALIDATION_VERSION,
} from '../src/commercial-ai-copy-prompt';
import type {
  CommercialDispatchCandidateDetails,
  WhatsAppDispatchDetails,
} from '../src/repositories';

const logger = { info: vi.fn(), error: vi.fn() };
const groupDestination = '120363000000000000@g.us';
const groupFingerprint = fingerprintWhatsAppGroupId(groupDestination);
const productLink = 'https://shopee.com.br/product/1/1';
const affiliateLink = 'https://s.shopee.com.br/affiliate-1';
const commercialFingerprint = fingerprintCommercialOffer({
  source: 'OFFICIAL',
  providerProductId: 'provider-product-1',
  productLink,
  affiliateLink,
  price: '99.90',
  priceMin: null,
  priceMax: null,
  discountRate: 20,
  commissionRate: 10,
  offerStartsAt: null,
  offerEndsAt: null,
  unavailableAt: null,
});

const mockCandidate: CommercialDispatchCandidateDetails = {
  id: 'candidate-123',
  campaignId: 'campaign-1',
  campaign: {
    id: 'campaign-1',
    logicalGroupFingerprint: groupFingerprint,
  },
  productId: 'product-1',
  snapshotId: 'snap-1',
  generatedCopyId: 'copy-1',
  status: 'COPY_READY',
  expiresAt: null,
  product: {
    id: 'product-1',
    source: 'OFFICIAL',
    providerProductId: 'provider-product-1',
    productName: 'Produto',
    shopName: 'Loja',
    productLink,
    affiliateLink,
    price: '99.90',
    priceMin: null,
    priceMax: null,
    discountRate: 20,
    commissionRate: 10,
    rating: 4.8,
    sales: 100,
    offerStartsAt: null,
    urlImagem: 'https://shopee.com/image.jpg',
    offerEndsAt: null,
    unavailableAt: null,
    commercialSnapshotRevision: 1,
    commercialSnapshotFingerprint: commercialFingerprint,
    updatedAt: new Date('2026-08-16T12:00:00.000Z'),
  },
  snapshot: {
    id: 'snap-1',
    productId: 'product-1',
    revision: 1,
    fingerprint: commercialFingerprint,
    unavailableAt: null,
    offerEndsAt: null,
  },
};

const dispatch: WhatsAppDispatchDetails = {
  id: 'dispatch-1',
  productId: 'product-1',
  generatedCopyId: 'copy-1',
  destinationId: 'dest-1',
  status: 'PENDING',
  attemptCount: 0,
  generatedCopy: {
    id: 'copy-1',
    productId: 'product-1',
    snapshotId: null,
    createdFromCandidateId: null,
    titulo: 'Título',
    mensagem: 'Mensagem sem comissão',
    cta: 'Compre agora',
    hashtags: '#Oferta',
    promotionCandidates: [],
  },
  destination: {
    id: 'dest-1',
    destination: 'mock-group-01',
    type: 'INDIVIDUAL',
    active: true,
    available: true,
    fingerprint: null,
    sourceInstanceName: 'affiliate-bot',
  },
  product: {
    comissao: 0.2,
    urlImagem: '',
    affiliateLink: 'https://shopee.com/affiliate-link',
  },
};

const prismaMock = (dispatchData = dispatch) => {
  const groupInstanceName =
    dispatchData.destination.type === 'GROUP'
      ? (dispatchData.instanceName ??
        dispatchData.destination.assignedInstanceName ??
        dispatchData.destination.sourceInstanceName)
      : dispatchData.instanceName;
  const rawDispatchData = {
    ...dispatchData,
    instanceName: groupInstanceName,
    destination: {
      ...dispatchData.destination,
      ...(dispatchData.destination.type === 'GROUP'
        ? { assignedInstanceName: groupInstanceName }
        : {}),
    },
    generatedCopy: {
      ...dispatchData.generatedCopy,
      promotionCandidates:
        dispatchData.generatedCopy.promotionCandidates?.map((candidate) => ({
          ...candidate,
          product: {
            id: candidate.product.id,
            source: candidate.product.source,
            providerProductId: candidate.product.providerProductId,
            nome: candidate.product.productName,
            loja: candidate.product.shopName,
            productLink: candidate.product.productLink,
            affiliateLink: candidate.product.affiliateLink,
            preco: candidate.product.price,
            precoMin: candidate.product.priceMin,
            precoMax: candidate.product.priceMax,
            desconto: candidate.product.discountRate,
            comissao: candidate.product.commissionRate,
            nota: candidate.product.rating,
            vendidos: candidate.product.sales,
            offerStartsAt: candidate.product.offerStartsAt,
            urlImagem: candidate.product.urlImagem,
            offerEndsAt: candidate.product.offerEndsAt,
            unavailableAt: candidate.product.unavailableAt,
            commercialSnapshotRevision:
              candidate.product.commercialSnapshotRevision,
            commercialSnapshotFingerprint:
              candidate.product.commercialSnapshotFingerprint,
            updatedAt: candidate.product.updatedAt,
          },
        })) ?? [],
    },
  };
  const client = {
    whatsAppDispatch: {
      findUnique: vi.fn(async () => rawDispatchData),
      updateMany: vi.fn(async () => ({ count: 1 })),
      update: vi.fn(async ({ data }) => ({ ...dispatch, ...data })),
    },
    $queryRaw: vi.fn(async () => [{ id: dispatchData.destinationId }]),
    $transaction: vi.fn(),
  };
  client.$transaction.mockImplementation(
    async (callback: (transaction: typeof client) => Promise<unknown>) =>
      callback(client),
  );
  return client;
};

const createService = (
  prisma: object = prismaMock(),
  provider: WhatsAppProvider = new MockWhatsAppProvider(),
  options?: {
    draftService?: Pick<CommercialMessageDraftService, 'createDraft'>;
    groupSendPolicy?: WhatsAppGroupSendPolicy;
  },
) =>
  new SenderService({
    dispatches: new PrismaWhatsAppDispatchRepository(prisma as never),
    provider,
    logger,
    groupSendPolicy:
      options?.groupSendPolicy ??
      new WhatsAppGroupSendPolicy({
        enabled: true,
        safeMode: true,
        instanceName: 'affiliate-bot',
      }),
    ...(options || {}),
  });

describe('SenderService', () => {
  it('altera PENDING para SENT e incrementa attemptCount', async () => {
    const prisma = prismaMock();
    const result = await createService(prisma).sendDispatch('dispatch-1');

    expect(prisma.whatsAppDispatch.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'dispatch-1', status: 'PENDING' },
        data: expect.objectContaining({ attemptCount: { increment: 1 } }),
      }),
    );
    expect(prisma.whatsAppDispatch.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'SENT' }),
      }),
    );
    expect(result).toMatchObject({
      status: 'SENT',
      externalMessageId: 'mock-whatsapp-1',
      sentAt: expect.any(Date),
    });
  });

  it('mantem PROCESSING quando o resultado do provider e incerto', async () => {
    const prisma = prismaMock();
    const provider = {
      sendMessage: vi.fn(async () => {
        throw new Error('provider indisponível');
      }),
    };

    await expect(
      createService(prisma, provider).sendDispatch('dispatch-1'),
    ).rejects.toMatchObject({
      code: 'WHATSAPP_DISPATCH_DELIVERY_AMBIGUOUS',
    });
    expect(prisma.whatsAppDispatch.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.whatsAppDispatch.update).not.toHaveBeenCalled();
  });

  it('registra FAILED quando o provider bloqueia antes do request externo', async () => {
    const prisma = prismaMock();
    const provider = new MockWhatsAppProvider();
    provider.simulateFailure('falha simulada antes do request');

    await expect(
      createService(prisma, provider).sendDispatch('dispatch-1'),
    ).rejects.toMatchObject({ code: 'MOCK_WHATSAPP_FAILURE' });
    expect(prisma.whatsAppDispatch.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          errorMessage: 'Envio bloqueado antes do request externo',
        }),
      }),
    );
  });

  it('monta mensagem pública com título, mensagem, CTA e hashtags sem comissão', () => {
    const message = buildWhatsAppPublicMessage(dispatch.generatedCopy);
    expect(message).toContain('Título');
    expect(message).toContain('Mensagem sem comissão');
    expect(message).toContain('Compre agora');
    expect(message).toContain('#Oferta');
    expect(message.toLocaleLowerCase('pt-BR')).not.toContain(
      'comissão de afiliado',
    );
    expect(message).not.toContain('0.2');
  });

  it('bloqueia retry automatico de dispatch FAILED', async () => {
    const prisma = prismaMock({ ...dispatch, status: 'FAILED' });
    const provider = new MockWhatsAppProvider();

    await expect(
      createService(prisma, provider).sendDispatch('dispatch-1'),
    ).rejects.toMatchObject({
      code: 'WHATSAPP_DISPATCH_RETRY_REQUIRES_MANUAL_REVIEW',
    });
    expect(provider.sentMessages).toHaveLength(0);
    expect(prisma.whatsAppDispatch.updateMany).not.toHaveBeenCalled();
  });

  it('bloqueia redelivery de dispatch PROCESSING sem chamar o provider', async () => {
    const prisma = prismaMock({ ...dispatch, status: 'PROCESSING' });
    const provider = new MockWhatsAppProvider();

    await expect(
      createService(prisma, provider).sendDispatch('dispatch-1'),
    ).rejects.toMatchObject({
      code: 'WHATSAPP_DISPATCH_DELIVERY_AMBIGUOUS',
    });
    expect(provider.sentMessages).toHaveLength(0);
    expect(prisma.whatsAppDispatch.updateMany).not.toHaveBeenCalled();
  });

  it('nao envia quando outro processamento adquiriu o mesmo dispatch', async () => {
    const prisma = prismaMock();
    prisma.whatsAppDispatch.updateMany.mockResolvedValue({ count: 0 });
    const provider = new MockWhatsAppProvider();

    await expect(
      createService(prisma, provider).sendDispatch('dispatch-1'),
    ).rejects.toMatchObject({ code: 'WHATSAPP_DISPATCH_ALREADY_CLAIMED' });
    expect(provider.sentMessages).toHaveLength(0);
  });

  it('permite somente um envio quando dois workers disputam o dispatch', async () => {
    let current = { ...dispatch, attemptCount: 0 };
    const prisma = {
      whatsAppDispatch: {
        findUnique: vi.fn(async () => current),
        updateMany: vi.fn(async () => {
          if (current.status !== 'PENDING') return { count: 0 };
          current = {
            ...current,
            status: 'PROCESSING',
            attemptCount: current.attemptCount + 1,
          };
          return { count: 1 };
        }),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          current = { ...current, ...data } as typeof current;
          return current;
        }),
      },
    };
    const provider = new MockWhatsAppProvider();
    const firstWorker = createService(prisma, provider);
    const secondWorker = createService(prisma, provider);

    const results = await Promise.allSettled([
      firstWorker.sendDispatch('dispatch-1'),
      secondWorker.sendDispatch('dispatch-1'),
    ]);

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(
      1,
    );
    expect(provider.sentMessages).toHaveLength(1);
    expect(prisma.whatsAppDispatch.updateMany).toHaveBeenCalledTimes(2);
  });

  it('nao reenvia quando o provider respondeu mas persistir SENT falhou', async () => {
    let current = { ...dispatch };
    const prisma = {
      whatsAppDispatch: {
        findUnique: vi.fn(async () => current),
        updateMany: vi.fn(async () => {
          current = { ...current, status: 'PROCESSING' };
          return { count: 1 };
        }),
        update: vi.fn(async () => {
          throw new Error('database unavailable');
        }),
      },
    };
    const provider = new MockWhatsAppProvider();
    const service = createService(prisma, provider);

    await expect(service.sendDispatch('dispatch-1')).rejects.toMatchObject({
      code: 'WHATSAPP_DISPATCH_DELIVERY_AMBIGUOUS',
    });
    await expect(service.sendDispatch('dispatch-1')).rejects.toMatchObject({
      code: 'WHATSAPP_DISPATCH_DELIVERY_AMBIGUOUS',
    });
    expect(provider.sentMessages).toHaveLength(1);
    expect(prisma.whatsAppDispatch.updateMany).toHaveBeenCalledTimes(1);
  });

  it('não reenvia dispatch SENT', async () => {
    const prisma = prismaMock({ ...dispatch, status: 'SENT' });
    const provider = new MockWhatsAppProvider();
    const result = await createService(prisma, provider).sendDispatch(
      'dispatch-1',
    );

    expect(result).toMatchObject({ status: 'SENT' });
    expect(provider.sentMessages).toHaveLength(0);
    expect(prisma.whatsAppDispatch.updateMany).not.toHaveBeenCalled();
    expect(prisma.whatsAppDispatch.update).not.toHaveBeenCalled();
  });

  it('bloqueia a corrida quando o assignment muda antes do claim serializado', async () => {
    let persistedAssignment = 'instance-a';
    const dispatchSnapshot: WhatsAppDispatchDetails = {
      ...dispatch,
      instanceName: 'instance-a',
      destination: {
        id: 'dest-1',
        destination: groupDestination,
        type: 'GROUP',
        active: true,
        paused: false,
        available: true,
        fingerprint: groupFingerprint,
        sourceInstanceName: 'instance-a',
        assignedInstanceName: 'instance-a',
      },
    };
    const provider = {
      sendMessage: vi.fn(async () => ({
        status: 'sent' as const,
        externalMessageId: 'message-1',
        sentAt: new Date(),
      })),
    };
    const repository: import('../src/repositories').WhatsAppDispatchRepository =
      {
        createPending: async () => null,
        findByIdForSending: async () => structuredClone(dispatchSnapshot),
        findByIdWithDetails: async () => structuredClone(dispatchSnapshot),
        list: async () => [],
        markAttemptPending: async () => {
          return true;
        },
        claimPendingForSending: async () => {
          persistedAssignment = 'instance-b';
          return { kind: 'STICKY_INSTANCE_MISMATCH' };
        },
        markSent: async () => ({ ...dispatchSnapshot, status: 'SENT' }),
        markFailed: async () => ({ ...dispatchSnapshot, status: 'FAILED' }),
      };
    const service = new SenderService({
      dispatches: repository,
      provider,
      logger,
      instanceName: 'instance-a',
      groupSendPolicy: new WhatsAppGroupSendPolicy({
        enabled: true,
        safeMode: true,
        instanceName: 'instance-a',
      }),
    });

    await expect(
      service.sendDispatch(dispatchSnapshot.id),
    ).rejects.toMatchObject({
      code: 'COMMERCIAL_INSTANCE_LIFECYCLE_MISMATCH',
    });

    expect(persistedAssignment).toBe('instance-b');
    expect(provider.sendMessage).not.toHaveBeenCalled();
  });

  describe('Integração com CommercialMessageDraftService', () => {
    const commercialDispatch: WhatsAppDispatchDetails = {
      ...dispatch,
      destination: {
        id: 'dest-1',
        destination: groupDestination,
        type: 'GROUP',
        active: true,
        available: true,
        fingerprint: groupFingerprint,
        sourceInstanceName: 'affiliate-bot',
      },
      generatedCopy: {
        ...dispatch.generatedCopy,
        source: 'AI',
        promptVersion: COMMERCIAL_AI_COPY_PROMPT_VERSION,
        validationVersion: COMMERCIAL_AI_COPY_VALIDATION_VERSION,
        snapshotId: 'snap-1',
        createdFromCandidateId: 'candidate-123',
        promotionCandidates: [mockCandidate],
      },
    };

    const cloneCommercialDispatch = (): WhatsAppDispatchDetails =>
      structuredClone(commercialDispatch);

    const candidateFrom = (dispatchData: WhatsAppDispatchDetails) => {
      const [candidate] = dispatchData.generatedCopy.promotionCandidates ?? [];
      if (!candidate) throw new Error('commercial candidate fixture missing');
      return candidate;
    };

    const validDraftService = () =>
      ({
        createDraft: vi.fn(() => ({
          candidateId: 'candidate-123',
          generatedCopyId: 'copy-1',
          warnings: [],
          caption: `Oferta certificada ${affiliateLink}`,
          imageUrl: 'https://shopee.com/image.jpg',
          deliveryMode: 'IMAGE' as const,
        })),
      }) satisfies Pick<CommercialMessageDraftService, 'createDraft'>;

    const expectPreClaimFailure = async (
      dispatchData: WhatsAppDispatchDetails,
      expectedCode: string,
      draftService: Pick<
        CommercialMessageDraftService,
        'createDraft'
      > = validDraftService(),
    ) => {
      const prisma = prismaMock(dispatchData);
      const provider = new MockWhatsAppProvider();
      logger.error.mockClear();
      await expect(
        createService(prisma, provider, { draftService }).sendDispatch(
          'dispatch-1',
        ),
      ).rejects.toMatchObject({ code: expectedCode });
      expect(prisma.whatsAppDispatch.findUnique).toHaveBeenCalledTimes(1);
      expect(prisma.whatsAppDispatch.updateMany).not.toHaveBeenCalled();
      expect(provider.sentMessages).toHaveLength(0);
      const serializedLogs = JSON.stringify(logger.error.mock.calls);
      expect(serializedLogs).not.toContain(affiliateLink);
      expect(serializedLogs).not.toContain(groupDestination);
      expect(serializedLogs).not.toContain('Oferta certificada');
    };

    it('usa draft com imagem se candidato válido e draft image for gerado', async () => {
      const prisma = prismaMock(commercialDispatch);
      const provider = new MockWhatsAppProvider();
      const draftService = {
        createDraft: vi.fn(() => ({
          candidateId: 'candidate-123',
          generatedCopyId: 'copy-1',
          warnings: [],
          caption: 'Draft caption',
          imageUrl: 'https://shopee.com/image.jpg',
          deliveryMode: 'IMAGE' as const,
        })),
      } satisfies Pick<CommercialMessageDraftService, 'createDraft'>;

      await createService(prisma, provider, { draftService }).sendDispatch(
        'dispatch-1',
      );

      expect(draftService.createDraft).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'candidate-123' }),
      );
      expect(provider.sentMessages[0]).toMatchObject({
        message: 'Draft caption',
        imageUrl: 'https://shopee.com/image.jpg',
      });
      expect(prisma.whatsAppDispatch.updateMany).toHaveBeenCalledTimes(1);
    });

    it('envia IMAGE para grupo com candidato RESERVED', async () => {
      const prisma = prismaMock({
        ...commercialDispatch,
        destination: {
          id: 'dest-1',
          destination: groupDestination,
          type: 'GROUP',
          active: true,
          available: true,
          sourceInstanceName: 'affiliate-bot',
          fingerprint: groupFingerprint,
        },
        generatedCopy: {
          ...commercialDispatch.generatedCopy,
          promotionCandidates: [
            { ...mockCandidate, status: 'RESERVED' as const },
          ],
        },
      });
      const provider = new MockWhatsAppProvider();
      const draftService = {
        createDraft: vi.fn(() => ({
          candidateId: 'candidate-123',
          generatedCopyId: 'copy-1',
          warnings: [],
          caption: 'Draft caption',
          imageUrl: 'https://shopee.com/image.jpg',
          deliveryMode: 'IMAGE' as const,
        })),
      } satisfies Pick<CommercialMessageDraftService, 'createDraft'>;
      const groupSendPolicy = new WhatsAppGroupSendPolicy({
        enabled: true,
        safeMode: true,
        instanceName: 'affiliate-bot',
      });
      const assertAuthorized = vi
        .spyOn(groupSendPolicy, 'assertAuthorized')
        .mockImplementation(() => undefined);

      await createService(prisma, provider, {
        draftService,
        groupSendPolicy,
      }).sendDispatch('dispatch-1');

      expect(provider.sentMessages).toHaveLength(1);
      expect(provider.sentMessages[0]).toMatchObject({
        destination: groupDestination,
        message: 'Draft caption',
        imageUrl: 'https://shopee.com/image.jpg',
        destinationType: 'GROUP',
      });
      expect(assertAuthorized).toHaveBeenCalledOnce();
      expect(prisma.whatsAppDispatch.updateMany).toHaveBeenCalledOnce();
    });

    it('lança erro se zero candidato correspondente e interrompe fluxo', async () => {
      const dispatchSemCandidato = {
        ...commercialDispatch,
        generatedCopy: {
          ...commercialDispatch.generatedCopy,
          promotionCandidates: [],
        },
      };
      const prisma = prismaMock(dispatchSemCandidato);
      const provider = new MockWhatsAppProvider();
      const draftService = {
        createDraft: vi.fn(),
      } satisfies Pick<CommercialMessageDraftService, 'createDraft'>;

      await expect(
        createService(prisma, provider, { draftService }).sendDispatch(
          'dispatch-1',
        ),
      ).rejects.toMatchObject({ code: 'COMMERCIAL_MESSAGE_RELATION_MISMATCH' });

      expect(draftService.createDraft).not.toHaveBeenCalled();
      expect(provider.sentMessages).toHaveLength(0);
      expect(prisma.whatsAppDispatch.updateMany).not.toHaveBeenCalled();
    });

    it('lança erro se múltiplos candidatos correspondentes e interrompe fluxo', async () => {
      const dispatchComMultiplos = {
        ...commercialDispatch,
        generatedCopy: {
          ...commercialDispatch.generatedCopy,
          promotionCandidates: [mockCandidate, mockCandidate],
        },
      };
      const prisma = prismaMock(dispatchComMultiplos);
      const provider = new MockWhatsAppProvider();
      const draftService = {
        createDraft: vi.fn(),
      } satisfies Pick<CommercialMessageDraftService, 'createDraft'>;

      await expect(
        createService(prisma, provider, { draftService }).sendDispatch(
          'dispatch-1',
        ),
      ).rejects.toMatchObject({ code: 'COMMERCIAL_MESSAGE_RELATION_MISMATCH' });

      expect(draftService.createDraft).not.toHaveBeenCalled();
      expect(provider.sentMessages).toHaveLength(0);
      expect(prisma.whatsAppDispatch.updateMany).not.toHaveBeenCalled();
    });
    it('lança erro de draftService e interrompe fluxo (candidato inválido ou vencido)', async () => {
      const prisma = prismaMock(commercialDispatch);
      const provider = new MockWhatsAppProvider();
      const draftService = {
        createDraft: vi.fn(() => {
          throw new Error('COMMERCIAL_MESSAGE_CANDIDATE_EXPIRED');
        }),
      } satisfies Pick<CommercialMessageDraftService, 'createDraft'>;

      await expect(
        createService(prisma, provider, { draftService }).sendDispatch(
          'dispatch-1',
        ),
      ).rejects.toMatchObject({ code: 'COMMERCIAL_MESSAGE_CANDIDATE_EXPIRED' });

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'whatsapp.dispatch.draft_failed' }),
        'Failed to create commercial draft',
      );
      expect(provider.sentMessages).toHaveLength(0);
      expect(prisma.whatsAppDispatch.updateMany).not.toHaveBeenCalled();
    });

    it('fluxo classico sem imagem permanece TEXT e nao chama draftService', async () => {
      const dispatchLegado = {
        ...commercialDispatch,
        product: {
          comissao: 0.2,
          urlImagem: '',
          affiliateLink: 'https://shopee.com/affiliate-link',
        },
        generatedCopy: {
          ...commercialDispatch.generatedCopy,
          createdFromCandidateId: null,
          promotionCandidates: [],
        },
      };
      const prisma = prismaMock(dispatchLegado);
      const provider = new MockWhatsAppProvider();
      const draftService = {
        createDraft: vi.fn(),
      } satisfies Pick<CommercialMessageDraftService, 'createDraft'>;

      await createService(prisma, provider, { draftService }).sendDispatch(
        'dispatch-1',
      );

      expect(draftService.createDraft).not.toHaveBeenCalled();
      expect(provider.sentMessages[0]).toMatchObject({
        message: expect.stringContaining(dispatchLegado.generatedCopy.titulo),
      });
      expect(provider.sentMessages[0]).not.toHaveProperty('imageUrl');
      expect(prisma.whatsAppDispatch.updateMany).toHaveBeenCalledTimes(1);
    });

    it('fluxo classico com imagem valida permanece TEXT-only', async () => {
      const dispatchWithImage = {
        ...commercialDispatch,
        product: {
          comissao: 0.2,
          urlImagem: 'https://cdn.example.com/product.jpg',
          affiliateLink: 'https://shopee.com/affiliate-link',
        },
        generatedCopy: {
          ...commercialDispatch.generatedCopy,
          createdFromCandidateId: null,
          promotionCandidates: [],
        },
      };
      const prisma = prismaMock(dispatchWithImage);
      const provider = new MockWhatsAppProvider();

      await createService(prisma, provider).sendDispatch('dispatch-1');

      expect(provider.sentMessages).toHaveLength(1);
      expect(provider.sentMessages[0]).toMatchObject({
        message: buildWhatsAppPublicMessage(dispatchWithImage.generatedCopy),
      });
      expect(provider.sentMessages[0]).not.toHaveProperty('imageUrl');
      expect(prisma.whatsAppDispatch.updateMany).toHaveBeenCalledOnce();
    });

    it('fluxo classico com URL de imagem invalida permanece TEXT-only', async () => {
      const invalidImageDispatch = {
        ...commercialDispatch,
        product: {
          comissao: 0.2,
          urlImagem: 'not-a-url',
          affiliateLink: 'https://shopee.com/affiliate-link',
        },
        generatedCopy: {
          ...commercialDispatch.generatedCopy,
          createdFromCandidateId: null,
          promotionCandidates: [],
        },
      };
      const prisma = prismaMock(invalidImageDispatch);
      const provider = new MockWhatsAppProvider();

      await createService(prisma, provider).sendDispatch('dispatch-1');

      expect(provider.sentMessages).toHaveLength(1);
      expect(provider.sentMessages[0]).not.toHaveProperty('imageUrl');
    });
    it('candidate-scoped faz fallback texto quando a imagem esta ausente', async () => {
      const prisma = prismaMock(commercialDispatch);
      const provider = new MockWhatsAppProvider();
      const draftService = {
        createDraft: vi.fn(() => ({
          candidateId: 'candidate-123',
          generatedCopyId: 'copy-1',
          warnings: ['COMMERCIAL_MESSAGE_IMAGE_MISSING'],
          caption: 'Draft caption text',
          imageUrl: null,
          deliveryMode: 'TEXT' as const,
        })),
      } satisfies Pick<CommercialMessageDraftService, 'createDraft'>;

      await createService(prisma, provider, { draftService }).sendDispatch(
        'dispatch-1',
      );

      expect(provider.sentMessages).toHaveLength(1);
      expect(provider.sentMessages[0]).toMatchObject({
        message: 'Draft caption text',
      });
      expect(provider.sentMessages[0]).not.toHaveProperty('imageUrl');
      expect(prisma.whatsAppDispatch.updateMany).toHaveBeenCalledOnce();
    });

    it('candidate-scoped faz fallback texto quando a URL de imagem e invalida', async () => {
      const prisma = prismaMock(commercialDispatch);
      const provider = new MockWhatsAppProvider();
      const draftService = {
        createDraft: vi.fn(() => ({
          candidateId: 'candidate-123',
          generatedCopyId: 'copy-1',
          warnings: ['COMMERCIAL_MESSAGE_IMAGE_URL_INVALID'],
          caption: 'Draft caption',
          imageUrl: null,
          deliveryMode: 'TEXT' as const,
        })),
      } satisfies Pick<CommercialMessageDraftService, 'createDraft'>;

      await createService(prisma, provider, { draftService }).sendDispatch(
        'dispatch-1',
      );

      expect(provider.sentMessages).toHaveLength(1);
      expect(provider.sentMessages[0]).toMatchObject({
        message: 'Draft caption',
      });
      expect(provider.sentMessages[0]).not.toHaveProperty('imageUrl');
      expect(prisma.whatsAppDispatch.updateMany).toHaveBeenCalledOnce();
    });

    it('bloqueia candidate-scoped quando imageUrl esta ausente', async () => {
      const prisma = prismaMock(commercialDispatch);
      const provider = new MockWhatsAppProvider();
      const draftService = {
        createDraft: vi.fn(() => ({
          candidateId: 'candidate-123',
          generatedCopyId: 'copy-1',
          warnings: [],
          caption: 'Draft caption',
          imageUrl: null,
          deliveryMode: 'IMAGE' as const,
        })),
      } satisfies Pick<CommercialMessageDraftService, 'createDraft'>;

      await expect(
        createService(prisma, provider, { draftService }).sendDispatch(
          'dispatch-1',
        ),
      ).rejects.toMatchObject({
        code: 'COMMERCIAL_AUTOMATION_IMAGE_REQUIRED',
      });

      expect(provider.sentMessages).toHaveLength(0);
      expect(prisma.whatsAppDispatch.updateMany).not.toHaveBeenCalled();
    });

    describe('boundary fail-closed de identidade e provenance', () => {
      it('bloqueia snapshot fingerprint divergente', async () => {
        const dispatchData = cloneCommercialDispatch();
        candidateFrom(dispatchData).snapshot.fingerprint =
          'snapshot-divergente';
        await expectPreClaimFailure(
          dispatchData,
          'COMMERCIAL_AI_COPY_AFFILIATE_LINK_SNAPSHOT_MISMATCH',
        );
      });

      it('bloqueia product commercialSnapshotFingerprint divergente', async () => {
        const dispatchData = cloneCommercialDispatch();
        candidateFrom(dispatchData).product.commercialSnapshotFingerprint =
          'product-fingerprint-divergente';
        await expectPreClaimFailure(
          dispatchData,
          'COMMERCIAL_AI_COPY_AFFILIATE_LINK_SNAPSHOT_MISMATCH',
        );
      });

      it('bloqueia provenance invalida', async () => {
        const dispatchData = cloneCommercialDispatch();
        candidateFrom(dispatchData).product.productLink =
          'ftp://produto-invalido';
        await expectPreClaimFailure(
          dispatchData,
          'COMMERCIAL_AI_COPY_AFFILIATE_LINK_PROVENANCE_INVALID',
        );
      });

      it('bloqueia affiliateLink divergente do contrato afiliado', async () => {
        const dispatchData = cloneCommercialDispatch();
        const candidate = candidateFrom(dispatchData);
        candidate.product.affiliateLink = candidate.product.productLink;
        await expectPreClaimFailure(
          dispatchData,
          'COMMERCIAL_AI_COPY_AFFILIATE_LINK_NOT_AFFILIATE',
        );
      });

      it('bloqueia campaign fingerprint divergente do target', async () => {
        const dispatchData = cloneCommercialDispatch();
        candidateFrom(dispatchData).campaign.logicalGroupFingerprint =
          'grp_bbbbbbbbbbbb';
        await expectPreClaimFailure(
          dispatchData,
          'COMMERCIAL_MESSAGE_DESTINATION_MISMATCH',
        );
      });

      it('bloqueia destination id divergente', async () => {
        const dispatchData = cloneCommercialDispatch();
        dispatchData.destination.id = 'dest-outro';
        await expectPreClaimFailure(
          dispatchData,
          'COMMERCIAL_MESSAGE_RELATION_MISMATCH',
        );
      });

      it('bloqueia group fingerprint divergente', async () => {
        const dispatchData = cloneCommercialDispatch();
        dispatchData.destination.fingerprint = 'grp_cccccccccccc';
        await expectPreClaimFailure(
          dispatchData,
          'COMMERCIAL_MESSAGE_DESTINATION_MISMATCH',
        );
      });

      it('bloqueia instance divergente', async () => {
        const dispatchData = cloneCommercialDispatch();
        dispatchData.destination.sourceInstanceName = 'outra-instancia';
        await expectPreClaimFailure(
          dispatchData,
          'WHATSAPP_GROUP_INSTANCE_MISMATCH',
        );
      });
    });

    describe('boundary fail-closed de draft, copy e relacoes', () => {
      it('bloqueia draft candidateId divergente', async () => {
        const draftService = validDraftService();
        draftService.createDraft.mockReturnValue({
          candidateId: 'candidate-outro',
          generatedCopyId: 'copy-1',
          warnings: [],
          caption: `Oferta certificada ${affiliateLink}`,
          imageUrl: 'https://shopee.com/image.jpg',
          deliveryMode: 'IMAGE',
        });
        await expectPreClaimFailure(
          cloneCommercialDispatch(),
          'COMMERCIAL_MESSAGE_RELATION_MISMATCH',
          draftService,
        );
      });

      it('bloqueia draft generatedCopyId divergente', async () => {
        const draftService = validDraftService();
        draftService.createDraft.mockReturnValue({
          candidateId: 'candidate-123',
          generatedCopyId: 'copy-outra',
          warnings: [],
          caption: `Oferta certificada ${affiliateLink}`,
          imageUrl: 'https://shopee.com/image.jpg',
          deliveryMode: 'IMAGE',
        });
        await expectPreClaimFailure(
          cloneCommercialDispatch(),
          'COMMERCIAL_MESSAGE_RELATION_MISMATCH',
          draftService,
        );
      });

      it('bloqueia Copy V10 version divergente', async () => {
        const dispatchData = cloneCommercialDispatch();
        dispatchData.generatedCopy.promptVersion =
          'commercial-promotion-copy-v9';
        await expectPreClaimFailure(
          dispatchData,
          'COMMERCIAL_MESSAGE_COPY_INCOMPATIBLE',
        );
      });

      it('bloqueia validation version divergente', async () => {
        const dispatchData = cloneCommercialDispatch();
        dispatchData.generatedCopy.validationVersion =
          'commercial-promotion-copy-validation-v3';
        await expectPreClaimFailure(
          dispatchData,
          'COMMERCIAL_MESSAGE_COPY_INCOMPATIBLE',
        );
      });

      it('bloqueia candidate ausente sem fallback legado', async () => {
        const dispatchData = cloneCommercialDispatch();
        dispatchData.generatedCopy.promotionCandidates = [];
        await expectPreClaimFailure(
          dispatchData,
          'COMMERCIAL_MESSAGE_RELATION_MISMATCH',
        );
      });

      it('bloqueia multiplos candidates sem fallback legado', async () => {
        const dispatchData = cloneCommercialDispatch();
        const candidate = candidateFrom(dispatchData);
        dispatchData.generatedCopy.promotionCandidates = [
          candidate,
          structuredClone(candidate),
        ];
        await expectPreClaimFailure(
          dispatchData,
          'COMMERCIAL_MESSAGE_RELATION_MISMATCH',
        );
      });

      it('bloqueia draft IMAGE sem imagem valida', async () => {
        const draftService = validDraftService();
        draftService.createDraft.mockReturnValue({
          candidateId: 'candidate-123',
          generatedCopyId: 'copy-1',
          warnings: [],
          caption: `Oferta certificada ${affiliateLink}`,
          imageUrl: '',
          deliveryMode: 'IMAGE',
        });
        await expectPreClaimFailure(
          cloneCommercialDispatch(),
          'COMMERCIAL_AUTOMATION_IMAGE_REQUIRED',
          draftService,
        );
      });

      it('bloqueia relacao product/snapshot inconsistente', async () => {
        const dispatchData = cloneCommercialDispatch();
        candidateFrom(dispatchData).snapshot.productId = 'product-outro';
        await expectPreClaimFailure(
          dispatchData,
          'COMMERCIAL_AI_COPY_AFFILIATE_LINK_PROVENANCE_INVALID',
        );
      });
    });

    describe('Testes com CommercialMessageDraftService real', () => {
      const buildRealDispatch = (): WhatsAppDispatchDetails => {
        const now = new Date();
        return {
          id: 'dispatch-1',
          destinationId: 'dest-1',
          productId: 'product-1',
          generatedCopyId: 'copy-1',
          status: 'PENDING',
          attemptCount: 0,
          destination: {
            id: 'dest-1',
            type: 'GROUP',
            destination: groupDestination,
            active: true,
            available: true,
            fingerprint: groupFingerprint,
            sourceInstanceName: 'affiliate-bot',
          },
          product: {
            comissao: 0.2,
            urlImagem: '',
            affiliateLink,
          },
          generatedCopy: {
            id: 'copy-1',
            productId: 'product-1',
            snapshotId: 'snap-1',
            createdFromCandidateId: 'candidate-123',
            source: 'AI',
            promptVersion: COMMERCIAL_AI_COPY_PROMPT_VERSION,
            validationVersion: COMMERCIAL_AI_COPY_VALIDATION_VERSION,
            titulo: 'Title',
            mensagem: 'Message',
            cta: `CTA ${affiliateLink}`,
            hashtags: '#hash',
            promotionCandidates: [
              {
                ...mockCandidate,
                expiresAt: new Date(now.getTime() + 100000),
              },
            ],
          },
        };
      };
      it('generatedCopy.productId diferente do produto gera erro de integridade de relação', async () => {
        const dispatchObj = buildRealDispatch();
        dispatchObj.generatedCopy.productId = 'other-product';
        const prisma = prismaMock(dispatchObj);
        const provider = new MockWhatsAppProvider();
        const draftService = new CommercialMessageDraftService();

        await expect(
          createService(prisma, provider, { draftService }).sendDispatch(
            'dispatch-1',
          ),
        ).rejects.toMatchObject({
          code: 'COMMERCIAL_MESSAGE_RELATION_MISMATCH',
        });

        expect(prisma.whatsAppDispatch.updateMany).not.toHaveBeenCalled();
        expect(provider.sentMessages).toHaveLength(0);
      });

      it('generatedCopy.snapshotId diferente do snapshot gera erro de integridade de relação', async () => {
        const dispatchObj = buildRealDispatch();
        dispatchObj.generatedCopy.snapshotId = 'other-snap';
        const prisma = prismaMock(dispatchObj);
        const provider = new MockWhatsAppProvider();
        const draftService = new CommercialMessageDraftService();

        await expect(
          createService(prisma, provider, { draftService }).sendDispatch(
            'dispatch-1',
          ),
        ).rejects.toMatchObject({
          code: 'COMMERCIAL_MESSAGE_RELATION_MISMATCH',
        });

        expect(prisma.whatsAppDispatch.updateMany).not.toHaveBeenCalled();
        expect(provider.sentMessages).toHaveLength(0);
      });

      it('candidato com expiresAt no passado gera AppError com código COMMERCIAL_MESSAGE_CANDIDATE_EXPIRED', async () => {
        const dispatchObj = buildRealDispatch();
        const [candidate] = dispatchObj.generatedCopy.promotionCandidates ?? [];
        if (!candidate) throw new Error('candidate fixture missing');
        candidate.expiresAt = new Date(Date.now() - 10000);
        const prisma = prismaMock(dispatchObj);
        const provider = new MockWhatsAppProvider();
        const draftService = new CommercialMessageDraftService();

        await expect(
          createService(prisma, provider, { draftService }).sendDispatch(
            'dispatch-1',
          ),
        ).rejects.toMatchObject({
          code: 'COMMERCIAL_MESSAGE_CANDIDATE_EXPIRED',
        });

        expect(prisma.whatsAppDispatch.updateMany).not.toHaveBeenCalled();
        expect(provider.sentMessages).toHaveLength(0);
      });
    });
  });
  it('envia retry manual rearmado como segunda tentativa sem resetar attemptCount', async () => {
    const retryDispatch = {
      ...dispatch,
      status: 'PENDING' as const,
      attemptCount: 1,
    };
    const prisma = prismaMock(retryDispatch);
    prisma.whatsAppDispatch.update.mockImplementation(async ({ data }) => ({
      ...retryDispatch,
      attemptCount: 2,
      ...data,
    }));

    const result = await createService(prisma).sendDispatch('dispatch-1');

    expect(prisma.whatsAppDispatch.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'dispatch-1', status: 'PENDING' },
        data: expect.objectContaining({ attemptCount: { increment: 1 } }),
      }),
    );
    expect(result).toMatchObject({ status: 'SENT', attemptCount: 2 });
  });

  it('segunda tentativa ambigua preserva PROCESSING e consome attemptCount 2', async () => {
    const retryDispatch = {
      ...dispatch,
      status: 'PENDING' as const,
      attemptCount: 1,
    };
    const prisma = prismaMock(retryDispatch);
    const provider = {
      sendMessage: vi.fn(async () => {
        throw new Error('resultado externo incerto');
      }),
    };

    await expect(
      createService(prisma, provider).sendDispatch('dispatch-1'),
    ).rejects.toMatchObject({
      code: 'WHATSAPP_DISPATCH_DELIVERY_AMBIGUOUS',
    });

    expect(prisma.whatsAppDispatch.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'dispatch-1', status: 'PENDING' },
        data: expect.objectContaining({ attemptCount: { increment: 1 } }),
      }),
    );
    expect(prisma.whatsAppDispatch.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED' }),
      }),
    );
    expect(provider.sendMessage).toHaveBeenCalledTimes(1);
  });
});
