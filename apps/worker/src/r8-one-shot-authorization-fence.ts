import { createHash } from 'node:crypto';

import { WhatsAppSendError } from '@shopee-auto-affiliate-ai/providers';
import type { WhatsAppDispatchDetails } from '../../api/src/repositories';
import type { WhatsAppSendInput } from '@shopee-auto-affiliate-ai/providers';

export type R8OneShotAuthorizationManifest = {
  authorizationId: string;
  authorized: boolean;
  approvedAt: string;
  expiresAt: string;
  candidateHead: string;
  candidateTree: string;
  jobId: string;
  dispatchId: string;
  targetFingerprint: string;
  destinationSha256: string;
  instanceName: string;
  assignmentRevision: number;
  campaignId: string;
  productId: string;
  candidateId: string;
  snapshotId: string;
  snapshotRevision: number;
  generatedCopyId: string;
  deliveryMode: 'TEXT' | 'IMAGE';
  messagePayloadSha256: string;
  maxWhatsAppSend: 1;
  maxEvolutionHttpRequests: 4;
  allowWebhookReadinessSync: true;
  allowSingleDispatchLifecycleWrites: true;
};

export type R8OneShotPreSendInput = {
  dispatch: WhatsAppDispatchDetails;
  providerInput: WhatsAppSendInput;
  deliveryMode: 'TEXT' | 'IMAGE';
};

export type R8OneShotAuthorizationFence = {
  assertRuntime(input: {
    instanceName: string | undefined;
    allowedDestinations: readonly string[];
    groupSendEnabled: boolean;
    safeMode: boolean;
    maxMessagesPerRun: number;
    schedulerEnabled: boolean;
    commercialSchedulerEnabled: boolean;
  }): void;
  assertJob(input: {
    jobId: string | undefined;
    dispatchId: string;
    instanceName: string | undefined;
  }): void;
  assertDispatch(dispatch: WhatsAppDispatchDetails | undefined): void;
  providerRunId(jobId: string | undefined, dispatchId: string): string;
  assertPreSend(input: R8OneShotPreSendInput): void;
  readonly sendBudgetConsumed: number;
};

export const MAX_R8_AUTHORIZATION_VALIDITY_MS = 30 * 60 * 1000;

const sha256 = (value: string) =>
  createHash('sha256').update(value, 'utf8').digest('hex');

const stableJson = (value: Record<string, string | null>) =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
    ),
  );

export const r8DestinationSha256 = (destination: string) =>
  sha256(destination.trim());

export const r8MessagePayloadSha256 = (input: {
  deliveryMode: 'TEXT' | 'IMAGE';
  message: string;
  imageUrl?: string | null;
}) =>
  sha256(
    stableJson({
      deliveryMode: input.deliveryMode,
      imageUrl: input.imageUrl?.trim() || null,
      message: input.message.replace(/\r\n/g, '\n').trim(),
    }),
  );

const rejected = (): never => {
  throw new WhatsAppSendError(
    'Autorizacao one-shot R8 ausente, expirada ou divergente',
    'R8_ONE_SHOT_AUTHORIZATION_INVALID',
    { deliveryMayHaveStarted: false },
  );
};

const exactNonEmpty = (value: string) => value.trim().length > 0;

export const createR8OneShotAuthorizationFence = (input: {
  manifest: R8OneShotAuthorizationManifest;
  candidateHead: string;
  candidateTree: string;
  clock?: () => Date;
}): R8OneShotAuthorizationFence => {
  const { manifest } = input;
  const clock = input.clock ?? (() => new Date());
  let sendBudgetConsumed = 0;

  const assertManifest = () => {
    const approvedAt = Date.parse(manifest.approvedAt);
    const expiresAt = Date.parse(manifest.expiresAt);
    const now = clock().getTime();
    if (
      !manifest.authorized ||
      manifest.maxWhatsAppSend !== 1 ||
      manifest.maxEvolutionHttpRequests !== 4 ||
      manifest.allowWebhookReadinessSync !== true ||
      manifest.allowSingleDispatchLifecycleWrites !== true ||
      !exactNonEmpty(manifest.authorizationId) ||
      !Number.isFinite(approvedAt) ||
      !Number.isFinite(expiresAt) ||
      approvedAt > now ||
      expiresAt < now ||
      expiresAt <= approvedAt ||
      expiresAt - approvedAt > MAX_R8_AUTHORIZATION_VALIDITY_MS ||
      manifest.candidateHead !== input.candidateHead ||
      manifest.candidateTree !== input.candidateTree ||
      !Number.isSafeInteger(manifest.assignmentRevision) ||
      manifest.assignmentRevision < 1 ||
      !Number.isSafeInteger(manifest.snapshotRevision) ||
      manifest.snapshotRevision < 1
    ) {
      rejected();
    }
  };

  const assertJob: R8OneShotAuthorizationFence['assertJob'] = (job) => {
    assertManifest();
    if (
      job.jobId !== manifest.jobId ||
      job.dispatchId !== manifest.dispatchId ||
      job.instanceName !== manifest.instanceName ||
      sendBudgetConsumed !== 0
    ) {
      rejected();
    }
  };

  const assertDispatchIdentity = (
    dispatch: WhatsAppDispatchDetails | undefined,
  ) => {
    assertManifest();
    const candidateId = dispatch?.generatedCopy.createdFromCandidateId;
    const candidates =
      dispatch?.generatedCopy.promotionCandidates?.filter(
        (candidate) => candidate.id === candidateId,
      ) ?? [];
    const candidate = candidates.length === 1 ? candidates[0] : undefined;
    if (
      !dispatch ||
      dispatch.status !== 'PENDING' ||
      dispatch.attemptCount !== 0 ||
      dispatch.externalMessageId !== null ||
      dispatch.sentAt !== null ||
      dispatch.id !== manifest.dispatchId ||
      dispatch.destination.fingerprint !== manifest.targetFingerprint ||
      r8DestinationSha256(dispatch.destination.destination) !==
        manifest.destinationSha256 ||
      dispatch.instanceName !== manifest.instanceName ||
      dispatch.destination.assignmentRevision !== manifest.assignmentRevision ||
      dispatch.productId !== manifest.productId ||
      dispatch.generatedCopyId !== manifest.generatedCopyId ||
      !candidate ||
      candidate.id !== manifest.candidateId ||
      candidate.campaignId !== manifest.campaignId ||
      candidate.snapshotId !== manifest.snapshotId ||
      candidate.snapshot.revision !== manifest.snapshotRevision
    ) {
      rejected();
    }
  };

  return {
    assertRuntime(runtime) {
      assertManifest();
      if (
        runtime.instanceName !== manifest.instanceName ||
        runtime.allowedDestinations.length !== 1 ||
        r8DestinationSha256(runtime.allowedDestinations[0] ?? '') !==
          manifest.destinationSha256 ||
        !runtime.groupSendEnabled ||
        !runtime.safeMode ||
        runtime.maxMessagesPerRun !== 1 ||
        runtime.schedulerEnabled ||
        runtime.commercialSchedulerEnabled ||
        sendBudgetConsumed !== 0
      ) {
        rejected();
      }
    },
    assertJob,
    assertDispatch: assertDispatchIdentity,
    providerRunId(jobId, dispatchId) {
      assertJob({
        jobId,
        dispatchId,
        instanceName: manifest.instanceName,
      });
      return `r8:${manifest.authorizationId}:${manifest.jobId}`;
    },
    assertPreSend(preSend) {
      const dispatch = preSend.dispatch;
      assertDispatchIdentity(dispatch);
      if (
        sendBudgetConsumed !== 0 ||
        preSend.deliveryMode !== manifest.deliveryMode ||
        r8MessagePayloadSha256({
          deliveryMode: preSend.deliveryMode,
          message: preSend.providerInput.message,
          imageUrl: preSend.providerInput.imageUrl,
        }) !== manifest.messagePayloadSha256
      ) {
        rejected();
      }
      sendBudgetConsumed += 1;
    },
    get sendBudgetConsumed() {
      return sendBudgetConsumed;
    },
  };
};
