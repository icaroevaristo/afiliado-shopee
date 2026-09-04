import { createHash } from 'node:crypto';

import type { RoutingCertificationJobMetadata } from '@shopee-auto-affiliate-ai/queue';

export const ROUTING_CERTIFICATION_CONTRACT_VERSION = 'v1' as const;
export const ROUTING_CERTIFICATION_TECHNICAL_PRODUCT_NAME =
  'Routing certification technical product';
export const ROUTING_CERTIFICATION_TECHNICAL_COPY_TITLE =
  'Routing certification technical copy';

const ROUTING_CERTIFICATION_JOB_KEYS = [
  'dispatchId',
  'routingCertification',
] as const;

export type RoutingCertificationIds = {
  productId: string;
  providerProductId: string;
  copyId: string;
  dispatchId: string;
  jobId: string;
};

export type RoutingCertificationJobData = {
  dispatchId: string;
  routingCertification: RoutingCertificationJobMetadata;
};

const hasExactKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
) => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
};

export const isRoutingCertificationMetadata = (
  value: unknown,
): value is RoutingCertificationJobMetadata => {
  if (typeof value !== 'object' || value === null) return false;
  const metadata = value as Record<string, unknown>;
  if (
    !hasExactKeys(metadata, [
      'version',
      'certificationRunId',
      'sequenceNumber',
      'memberIndex',
      'groupFingerprint',
      'assignmentRevision',
    ])
  ) {
    return false;
  }
  return (
    metadata.version === ROUTING_CERTIFICATION_CONTRACT_VERSION &&
    typeof metadata.certificationRunId === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(metadata.certificationRunId) &&
    typeof metadata.sequenceNumber === 'number' &&
    Number.isSafeInteger(metadata.sequenceNumber) &&
    metadata.sequenceNumber > 0 &&
    metadata.sequenceNumber <= 999_999 &&
    (metadata.memberIndex === 0 || metadata.memberIndex === 1) &&
    typeof metadata.groupFingerprint === 'string' &&
    /^grp_[a-f0-9]{12}$/u.test(metadata.groupFingerprint) &&
    typeof metadata.assignmentRevision === 'number' &&
    Number.isSafeInteger(metadata.assignmentRevision) &&
    metadata.assignmentRevision >= 0
  );
};

export const isRoutingCertificationJobData = (
  value: unknown,
): value is RoutingCertificationJobData => {
  if (typeof value !== 'object' || value === null) return false;
  const data = value as Record<string, unknown>;
  return (
    hasExactKeys(data, ROUTING_CERTIFICATION_JOB_KEYS) &&
    typeof data.dispatchId === 'string' &&
    data.dispatchId.length > 0 &&
    isRoutingCertificationMetadata(data.routingCertification)
  );
};

export const sameRoutingCertificationMetadata = (
  left: RoutingCertificationJobMetadata,
  right: RoutingCertificationJobMetadata,
) =>
  left.version === right.version &&
  left.certificationRunId === right.certificationRunId &&
  left.sequenceNumber === right.sequenceNumber &&
  left.memberIndex === right.memberIndex &&
  left.groupFingerprint === right.groupFingerprint &&
  left.assignmentRevision === right.assignmentRevision;

export const buildRoutingCertificationMetadata = (
  input: Omit<RoutingCertificationJobMetadata, 'version'>,
): RoutingCertificationJobMetadata => ({
  version: ROUTING_CERTIFICATION_CONTRACT_VERSION,
  ...input,
});

export const buildRoutingCertificationIds = (
  input: RoutingCertificationJobMetadata & {
    selectedInstanceName: string;
  },
): RoutingCertificationIds => {
  const digest = createHash('sha256')
    .update(
      JSON.stringify([
        input.certificationRunId,
        input.sequenceNumber,
        input.groupFingerprint,
        input.assignmentRevision,
        input.selectedInstanceName,
      ]),
    )
    .digest('hex');
  return {
    productId: `routing-cert-product-${digest}`,
    providerProductId: `routing-certification-${digest}`,
    copyId: `routing-cert-copy-${digest}`,
    dispatchId: `routing-cert-dispatch-${digest}`,
    jobId: `routing-cert-job-${digest}`,
  };
};

export const buildRoutingCertificationMessage = (
  certificationRunId: string,
  sequenceNumber: number,
) =>
  `Teste controlado de roteamento Afiliado Shopee. Certificacao ${certificationRunId} / passo ${sequenceNumber}. Nenhuma acao e necessaria.`;
