export type CommercialPreparedRecoveryEvidence = {
  runMode: 'DRY_RUN' | 'CONFIRMED';
  dispatchId: string | null;
  dispatchExists: boolean;
  outboxExists: boolean;
};

export type CommercialPreparedRecoveryDecision = 'REOPEN_READY' | 'CLOSE_DISPATCHED';

export const decideCommercialPreparedRecovery = (
  evidence: CommercialPreparedRecoveryEvidence,
): CommercialPreparedRecoveryDecision =>
  evidence.runMode === 'CONFIRMED' ||
  evidence.dispatchId !== null ||
  evidence.dispatchExists ||
  evidence.outboxExists
    ? 'CLOSE_DISPATCHED'
    : 'REOPEN_READY';

export type CommercialPreparedMessageMaterialityRecord = {
  status: 'READY' | 'RESERVED' | 'DISPATCHED' | 'INVALIDATED';
  generatedCopyId: string;
  snapshotId: string;
  expiresAt: Date;
  offerEndsAt: Date | null;
  candidate: {
    productId: string;
    snapshotId: string;
    status:
      | 'QUEUED'
      | 'COPY_READY'
      | 'RESERVED'
      | 'DISPATCHED'
      | 'EXPIRED'
      | 'BLOCKED';
    generatedCopyId: string | null;
    expiresAt: Date | null;
    product: {
      id: string;
      commercialSnapshotRevision: number;
      commercialSnapshotFingerprint: string | null;
      offerStartsAt: Date | null;
      offerEndsAt: Date | null;
      unavailableAt: Date | null;
    };
    snapshot: {
      id: string;
      productId: string;
      revision: number;
      fingerprint: string;
      offerStartsAt: Date | null;
      offerEndsAt: Date | null;
      unavailableAt: Date | null;
    };
    generatedCopy: {
      id: string;
      productId: string;
      snapshotId: string | null;
    } | null;
  };
};

export type CommercialPreparedMessageInvalidationReason =
  | 'PREPARED_EXPIRED'
  | 'SNAPSHOT_OR_COPY_STALE';

const isExpired = (date: Date | null, now: Date) =>
  date !== null && date <= now;

/**
 * Expiry is evaluated from every persisted deadline that can make the
 * material unusable.  Keeping this decision beside the freshness predicate
 * prevents claim, release and recovery from disagreeing about whether a
 * candidate may be reopened.
 */
export const commercialPreparedMessageInvalidationReason = (
  record: CommercialPreparedMessageMaterialityRecord,
  now: Date,
): CommercialPreparedMessageInvalidationReason =>
  record.expiresAt <= now ||
  isExpired(record.offerEndsAt, now) ||
  isExpired(record.candidate.expiresAt, now) ||
  isExpired(record.candidate.product.offerEndsAt, now) ||
  isExpired(record.candidate.snapshot.offerEndsAt, now)
    ? 'PREPARED_EXPIRED'
    : 'SNAPSHOT_OR_COPY_STALE';

/** The single material content contract shared by every prepared inventory path. */
export const isCommercialPreparedMessageContentFresh = (
  record: CommercialPreparedMessageMaterialityRecord,
  now: Date,
) => {
  const isFresh = (date: Date | null) => date === null || date > now;
  const isStarted = (date: Date | null) => date === null || date <= now;
  const sameInstant = (left: Date | null, right: Date | null) =>
    (left?.getTime() ?? null) === (right?.getTime() ?? null);
  return (
    record.expiresAt > now &&
    record.candidate.productId === record.candidate.product.id &&
    record.candidate.snapshotId === record.candidate.snapshot.id &&
    record.candidate.snapshotId === record.snapshotId &&
    record.candidate.snapshot.productId === record.candidate.product.id &&
    isFresh(record.candidate.expiresAt) &&
    isFresh(record.offerEndsAt) &&
    sameInstant(record.offerEndsAt, record.candidate.snapshot.offerEndsAt) &&
    sameInstant(
      record.candidate.product.offerStartsAt,
      record.candidate.snapshot.offerStartsAt,
    ) &&
    sameInstant(
      record.candidate.product.offerEndsAt,
      record.candidate.snapshot.offerEndsAt,
    ) &&
    record.candidate.product.unavailableAt === null &&
    record.candidate.snapshot.unavailableAt === null &&
    isStarted(record.candidate.product.offerStartsAt) &&
    isStarted(record.candidate.snapshot.offerStartsAt) &&
    isFresh(record.candidate.product.offerEndsAt) &&
    isFresh(record.candidate.snapshot.offerEndsAt) &&
    record.candidate.generatedCopyId !== null &&
    record.candidate.generatedCopyId === record.generatedCopyId &&
    record.candidate.generatedCopy?.id === record.generatedCopyId &&
    record.candidate.generatedCopy?.productId === record.candidate.product.id &&
    record.candidate.product.commercialSnapshotRevision ===
      record.candidate.snapshot.revision &&
    record.candidate.product.commercialSnapshotFingerprint ===
      record.candidate.snapshot.fingerprint &&
    record.candidate.generatedCopy?.snapshotId === record.snapshotId
  );
};

/** The single material READY contract shared by every prepared inventory path. */
export const isCommercialPreparedMessageMateriallyReady = (
  record: CommercialPreparedMessageMaterialityRecord,
  now: Date,
) => record.status === 'READY' && isCommercialPreparedMessageContentFresh(record, now);
