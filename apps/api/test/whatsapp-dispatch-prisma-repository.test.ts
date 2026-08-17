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
});