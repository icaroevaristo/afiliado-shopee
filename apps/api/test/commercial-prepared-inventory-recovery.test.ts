import { describe, expect, it } from 'vitest';

import {
  commercialPreparedMessageInvalidationReason,
  isCommercialPreparedMessageMateriallyReady,
  type CommercialPreparedMessageMaterialityRecord,
} from '../src/commercial-prepared-inventory-recovery';

const NOW = new Date('2026-09-07T12:00:00.000Z');
const FUTURE = new Date('2026-09-07T13:00:00.000Z');

const materialityRecord = (
  candidateStatus: CommercialPreparedMessageMaterialityRecord['candidate']['status'] =
    'COPY_READY',
): CommercialPreparedMessageMaterialityRecord => ({
  status: 'READY',
  generatedCopyId: 'copy-1',
  snapshotId: 'snapshot-1',
  expiresAt: FUTURE,
  offerEndsAt: null,
  candidate: {
    productId: 'product-1',
    snapshotId: 'snapshot-1',
    status: candidateStatus,
    generatedCopyId: 'copy-1',
    expiresAt: FUTURE,
    product: {
      id: 'product-1',
      commercialSnapshotRevision: 1,
      commercialSnapshotFingerprint: 'snapshot-fingerprint',
      offerStartsAt: null,
      offerEndsAt: null,
      unavailableAt: null,
    },
    snapshot: {
      id: 'snapshot-1',
      productId: 'product-1',
      revision: 1,
      fingerprint: 'snapshot-fingerprint',
      offerStartsAt: null,
      offerEndsAt: null,
      unavailableAt: null,
    },
    generatedCopy: {
      id: 'copy-1',
      productId: 'product-1',
      snapshotId: 'snapshot-1',
    },
  },
});

describe('commercial prepared inventory recovery', () => {
  it.each([
    'QUEUED',
    'RESERVED',
    'DISPATCHED',
    'EXPIRED',
    'BLOCKED',
  ] as const)('nao considera candidate %s materialmente pronto', (status) => {
    const record = materialityRecord(status);

    expect(isCommercialPreparedMessageMateriallyReady(record, NOW)).toBe(false);
    expect(commercialPreparedMessageInvalidationReason(record, NOW)).toBe(
      'CANDIDATE_NOT_COPY_READY',
    );
  });

  it('considera somente COPY_READY com conteudo fresco materialmente pronto', () => {
    expect(
      isCommercialPreparedMessageMateriallyReady(
        materialityRecord('COPY_READY'),
        NOW,
      ),
    ).toBe(true);
  });

  it('distingue expiração local da oferta expirada', () => {
    const localExpired = materialityRecord();
    localExpired.expiresAt = NOW;
    expect(commercialPreparedMessageInvalidationReason(localExpired, NOW)).toBe(
      'PREPARED_EXPIRED',
    );

    const offerExpired = materialityRecord();
    offerExpired.candidate.snapshot.offerEndsAt = NOW;
    expect(commercialPreparedMessageInvalidationReason(offerExpired, NOW)).toBe(
      'OFFER_EXPIRED',
    );
  });
});
