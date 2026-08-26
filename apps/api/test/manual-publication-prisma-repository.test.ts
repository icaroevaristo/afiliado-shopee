import { describe, expect, it, vi } from 'vitest';

import { PrismaManualPublicationRequestRepository } from '../src/prisma-repositories';

const existing = {
  id: 'preview-request-1',
  idempotencyKey: 'preview-key',
  payloadHash: 'preview-hash',
  mode: 'PREVIEW',
  productId: 'product-1',
  requestedSnapshotId: 'snapshot-1',
  requestedSnapshotRevision: 1,
  requestedSnapshotFingerprint: 'snapshot-fingerprint',
  status: 'PREVIEW_READY',
  createdAt: new Date('2026-08-26T10:00:00.000Z'),
  updatedAt: new Date('2026-08-26T10:00:00.000Z'),
  completedAt: null,
  processingOwnerId: null,
  processingLeaseExpiresAt: null,
  targets: [],
};

const input = {
  id: 'preview-request-2',
  idempotencyKey: 'preview-key',
  payloadHash: 'preview-hash',
  mode: 'PREVIEW' as const,
  productId: 'product-1',
  requestedSnapshotId: 'snapshot-1',
  requestedSnapshotRevision: 1,
  requestedSnapshotFingerprint: 'snapshot-fingerprint',
  status: 'PREVIEW_READY' as const,
  targets: [],
};

const currentProduct = {
  id: 'product-1',
  source: 'OFFICIAL' as const,
  affiliateLink: 'https://affiliate.example/product-1',
  productLink: 'https://shopee.example/product-1',
  unavailableAt: null as Date | null,
  offerStartsAt: null as Date | null,
  offerEndsAt: null as Date | null,
  commercialSnapshotRevision: 1,
  commercialSnapshotFingerprint: 'snapshot-fingerprint',
};

const currentSnapshot = {
  id: 'snapshot-1',
  productId: 'product-1',
  revision: 1,
  fingerprint: 'snapshot-fingerprint',
  offerStartsAt: null,
  offerEndsAt: null,
  unavailableAt: null,
};

const createRepository = () => {
  const findUnique = vi.fn().mockResolvedValue(existing);
  const transaction = { manualPublicationRequest: { findUnique } };
  const prisma = {
    $transaction: vi.fn(
      async (callback: (value: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    ),
  };
  return {
    repository: new PrismaManualPublicationRequestRepository(prisma as never),
    findUnique,
  };
};

const createRecheckRepository = (
  productOverrides: Partial<typeof currentProduct>,
) => {
  const requestFindUnique = vi.fn().mockResolvedValue(null);
  const productFindUnique = vi.fn().mockResolvedValue({
    ...currentProduct,
    ...productOverrides,
  });
  const snapshotFindUnique = vi.fn().mockResolvedValue(currentSnapshot);
  const transaction = {
    manualPublicationRequest: {
      findUnique: requestFindUnique,
      create: vi.fn(),
    },
    manualPublicationTarget: { createMany: vi.fn() },
    productLead: { findUnique: productFindUnique },
    commercialOfferSnapshot: { findUnique: snapshotFindUnique },
    whatsAppDestination: { findMany: vi.fn().mockResolvedValue([]) },
    commercialGroupCampaign: { findMany: vi.fn().mockResolvedValue([]) },
    whatsAppInstance: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const prisma = {
    $transaction: vi.fn(
      async (callback: (value: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    ),
  };
  return {
    repository: new PrismaManualPublicationRequestRepository(prisma as never),
    productFindUnique,
    requestCreate: transaction.manualPublicationRequest.create,
  };
};

describe('PrismaManualPublicationRequestRepository', () => {
  it.each([
    ['mode', { mode: 'SEND' as const }],
    ['payload hash', { payloadHash: 'other-hash' }],
    ['product', { productId: 'other-product' }],
  ])('fails closed when the idempotency gate differs by %s', async (_label, change) => {
    const subject = createRepository();

    await expect(
      subject.repository.accept({ ...input, ...change }),
    ).rejects.toMatchObject({
      code: 'MANUAL_PUBLICATION_IDEMPOTENCY_CONFLICT',
    });
    expect(subject.findUnique).toHaveBeenCalledOnce();
  });

  it('reuses the same durable preview request only for the same operation and payload', async () => {
    const subject = createRepository();

    await expect(subject.repository.accept(input)).resolves.toMatchObject({
      created: false,
      request: {
        id: 'preview-request-1',
        mode: 'PREVIEW',
        status: 'PREVIEW_READY',
      },
    });
  });

  it.each([
    [
      'future offer start',
      { offerStartsAt: new Date('2099-01-01T00:00:00.000Z') },
    ],
    ['non-http affiliate link', { affiliateLink: 'ftp://example.test' }],
    ['non-http product link', { productLink: 'not-a-url' }],
  ])('rechecks preview product state for %s before creation', async (_label, change) => {
    const subject = createRecheckRepository(change);

    await expect(subject.repository.accept(input)).rejects.toMatchObject({
      code: 'MANUAL_PUBLICATION_STATE_CHANGED',
    });
    expect(subject.productFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'product-1' },
        select: expect.objectContaining({
          affiliateLink: true,
          productLink: true,
          offerStartsAt: true,
        }),
      }),
    );
    expect(subject.requestCreate).not.toHaveBeenCalled();
  });
});
