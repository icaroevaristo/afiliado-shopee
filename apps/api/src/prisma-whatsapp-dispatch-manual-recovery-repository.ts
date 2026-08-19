import type { DatabaseClient } from '@shopee-auto-affiliate-ai/database';
import { AppError } from '@shopee-auto-affiliate-ai/shared';
import type {
  WhatsAppDispatchManualRecoveryAuthorization,
  WhatsAppDispatchManualRecoveryInput,
  WhatsAppDispatchManualRecoveryRecord,
  WhatsAppDispatchManualRecoveryRepository,
  WhatsAppDispatchManualRecoveryRequeueContext,
} from './repositories';
import { WHATSAPP_DISPATCH_MANUAL_RECOVERY_CONFIRMATION } from './repositories';

type RecoveryDb = Pick<
  DatabaseClient,
  | 'whatsAppDispatch'
  | 'whatsAppDispatchManualRecovery'
  | 'commercialPipelineRun'
  | 'commercialDispatchOutbox'
  | 'generatedCopy'
  | 'commercialPromotionCandidate'
  | 'commercialAutomationExecution'
  | 'commercialGroupCampaign'
>;

const fail = (message: string, code: string): never => {
  throw new AppError(message, code);
};

const isPrismaCode = (error: unknown, code: string) =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: unknown }).code === code;

const mapRecovery = (record: {
  id: string;
  dispatchId: string;
  runId: string;
  executionId: string;
  candidateId: string;
  campaignId: string;
  jobId: string;
  decision: string;
  confirmation: string;
  attemptCountObserved: number;
  authorizedAt: Date;
  rearmedAt: Date | null;
  requeuedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): WhatsAppDispatchManualRecoveryRecord => ({
  ...record,
  decision: 'CONFIRMED_NON_DELIVERY',
});

const loadLifecycle = async (
  db: RecoveryDb,
  input: WhatsAppDispatchManualRecoveryInput,
  expectedDispatchStatus: 'PROCESSING' | 'PENDING',
  recoveryExists: boolean,
) => {
  if (input.confirmation !== WHATSAPP_DISPATCH_MANUAL_RECOVERY_CONFIRMATION) {
    fail(
      'Confirmacao humana literal invalida',
      'WHATSAPP_DISPATCH_MANUAL_RECOVERY_CONFIRMATION_REQUIRED',
    );
  }
  const dispatch = await db.whatsAppDispatch.findUnique({
    where: { id: input.dispatchId },
    select: {
      id: true,
      status: true,
      attemptCount: true,
      externalMessageId: true,
      sentAt: true,
      generatedCopyId: true,
      productId: true,
    },
  });
  if (!dispatch) {
    throw new AppError(
      'Dispatch nao encontrado',
      'WHATSAPP_DISPATCH_MANUAL_RECOVERY_DISPATCH_NOT_FOUND',
    );
  }
  if (dispatch.attemptCount !== 1) {
    fail(
      'Dispatch nao esta na primeira tentativa ambigua',
      recoveryExists && dispatch.attemptCount >= 2
        ? 'WHATSAPP_DISPATCH_MANUAL_RECOVERY_THIRD_RETRY_FORBIDDEN'
        : 'WHATSAPP_DISPATCH_MANUAL_RECOVERY_ATTEMPT_COUNT_INVALID',
    );
  }
  if (dispatch.status !== expectedDispatchStatus) {
    fail(
      'Status do dispatch divergiu do recovery esperado',
      'WHATSAPP_DISPATCH_MANUAL_RECOVERY_DISPATCH_STATE_MISMATCH',
    );
  }
  if (dispatch.externalMessageId || dispatch.sentAt) {
    fail(
      'Existe evidencia persistida de entrega',
      'WHATSAPP_DISPATCH_MANUAL_RECOVERY_DELIVERY_EVIDENCE_PRESENT',
    );
  }

  const runs = await db.commercialPipelineRun.findMany({
    where: { dispatchId: dispatch.id },
    select: {
      id: true,
      executionId: true,
      mode: true,
      status: true,
      finalStatus: true,
      investigationRequired: true,
      jobId: true,
      dispatchId: true,
    },
  });
  if (runs.length !== 1) {
    fail(
      'Run do dispatch nao e inequivoco',
      'WHATSAPP_DISPATCH_MANUAL_RECOVERY_RUN_LINK_INVALID',
    );
  }
  const run = runs[0]!;
  if (
    run.id !== input.expectedRunId ||
    run.executionId !== input.expectedExecutionId
  ) {
    fail(
      'Run/execution divergiram do esperado',
      'WHATSAPP_DISPATCH_MANUAL_RECOVERY_RUN_EXECUTION_MISMATCH',
    );
  }
  if (
    run.mode !== 'CONFIRMED' ||
    run.status !== 'FAILED' ||
    run.finalStatus !== 'AMBIGUOUS' ||
    run.investigationRequired !== true
  ) {
    fail(
      'Run nao esta AMBIGUOUS sob investigacao',
      'WHATSAPP_DISPATCH_MANUAL_RECOVERY_RUN_NOT_AMBIGUOUS',
    );
  }
  if (!run.jobId) {
    fail(
      'Run nao possui jobId deterministico',
      'WHATSAPP_DISPATCH_MANUAL_RECOVERY_JOB_LINK_INVALID',
    );
  }

  const outboxes = await db.commercialDispatchOutbox.findMany({
    where: { dispatchId: dispatch.id },
    select: {
      id: true,
      commercialRunId: true,
      dispatchId: true,
      jobId: true,
      status: true,
    },
  });
  if (
    outboxes.length !== 1 ||
    outboxes[0]!.commercialRunId !== run.id ||
    outboxes[0]!.dispatchId !== dispatch.id ||
    outboxes[0]!.status !== 'PUBLISHED' ||
    outboxes[0]!.jobId !== run.jobId
  ) {
    fail(
      'Outbox publicado nao corresponde ao lifecycle',
      'WHATSAPP_DISPATCH_MANUAL_RECOVERY_OUTBOX_INVALID',
    );
  }

  const copy = await db.generatedCopy.findUnique({
    where: { id: dispatch.generatedCopyId },
    select: { id: true, productId: true, createdFromCandidateId: true },
  });
  if (
    !copy ||
    !copy.createdFromCandidateId ||
    copy.productId !== dispatch.productId
  ) {
    throw new AppError(
      'GeneratedCopy nao esta inequivocamente ligada ao dispatch',
      'WHATSAPP_DISPATCH_MANUAL_RECOVERY_COPY_LINK_INVALID',
    );
  }
  const candidates = await db.commercialPromotionCandidate.findMany({
    where: { generatedCopyId: dispatch.generatedCopyId },
    select: {
      id: true,
      campaignId: true,
      productId: true,
      generatedCopyId: true,
      status: true,
    },
  });
  if (
    candidates.length !== 1 ||
    candidates[0]!.id !== copy.createdFromCandidateId ||
    candidates[0]!.productId !== dispatch.productId ||
    candidates[0]!.status !== 'RESERVED'
  ) {
    fail(
      'Candidate/copy nao estao inequivocamente ligados ao lifecycle',
      'WHATSAPP_DISPATCH_MANUAL_RECOVERY_CANDIDATE_LINK_INVALID',
    );
  }
  const candidate = candidates[0]!;

  const execution = await db.commercialAutomationExecution.findUnique({
    where: { id: input.expectedExecutionId },
    select: {
      id: true,
      status: true,
      commercialRunId: true,
      completedAt: true,
    },
  });
  if (
    !execution ||
    execution.commercialRunId !== run.id ||
    execution.status !== 'QUEUED'
  ) {
    fail(
      'Execution nao corresponde ao lifecycle terminal enfileirado',
      'WHATSAPP_DISPATCH_MANUAL_RECOVERY_EXECUTION_INVALID',
    );
  }

  const campaign = await db.commercialGroupCampaign.findUnique({
    where: { id: candidate.campaignId },
    select: {
      id: true,
      attemptExecutionId: true,
      attemptReservedAt: true,
      attemptLeaseExpiresAt: true,
    },
  });
  if (
    !campaign ||
    campaign.attemptExecutionId !== input.expectedExecutionId ||
    !campaign.attemptReservedAt ||
    !campaign.attemptLeaseExpiresAt
  ) {
    fail(
      'Reservation nao pertence a mesma execution do run',
      'WHATSAPP_DISPATCH_MANUAL_RECOVERY_RESERVATION_INVALID',
    );
  }

  return {
    dispatch,
    run,
    outbox: outboxes[0]!,
    copy,
    candidate,
    execution,
    campaign: campaign!,
  };
};

const assertExistingRecoveryMatches = (
  recovery: WhatsAppDispatchManualRecoveryRecord,
  input: WhatsAppDispatchManualRecoveryInput,
) => {
  if (
    recovery.runId !== input.expectedRunId ||
    recovery.executionId !== input.expectedExecutionId ||
    recovery.confirmation !== input.confirmation ||
    recovery.decision !== 'CONFIRMED_NON_DELIVERY' ||
    recovery.attemptCountObserved !== 1
  ) {
    fail(
      'Recovery existente diverge desta autorizacao',
      'WHATSAPP_DISPATCH_MANUAL_RECOVERY_ALREADY_EXISTS',
    );
  }
};

export class PrismaWhatsAppDispatchManualRecoveryRepository implements WhatsAppDispatchManualRecoveryRepository {
  constructor(private readonly prisma: DatabaseClient) {}

  async rearmAfterConfirmedNonDelivery(
    input: WhatsAppDispatchManualRecoveryInput & { authorizedAt: Date },
  ): Promise<WhatsAppDispatchManualRecoveryAuthorization> {
    for (
      let transactionAttempt = 0;
      transactionAttempt < 2;
      transactionAttempt += 1
    ) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const existingRaw =
              await tx.whatsAppDispatchManualRecovery.findUnique({
                where: { dispatchId: input.dispatchId },
              });
            const existing = existingRaw ? mapRecovery(existingRaw) : null;
            const lifecycle = await loadLifecycle(
              tx as RecoveryDb,
              input,
              existing?.rearmedAt ? 'PENDING' : 'PROCESSING',
              Boolean(existing),
            );

            if (existing) {
              assertExistingRecoveryMatches(existing, input);
              if (existing.requeuedAt) {
                fail(
                  'Recovery unico ja foi utilizado',
                  'WHATSAPP_DISPATCH_MANUAL_RECOVERY_ALREADY_USED',
                );
              }
              if (existing.rearmedAt) {
                return {
                  kind: 'ALREADY_AUTHORIZED' as const,
                  recovery: existing,
                  jobId: lifecycle.run.jobId!,
                  campaignId: lifecycle.candidate.campaignId,
                  candidateId: lifecycle.candidate.id,
                };
              }
            }

            const recoveryRaw =
              existingRaw ??
              (await tx.whatsAppDispatchManualRecovery.create({
                data: {
                  dispatchId: input.dispatchId,
                  runId: input.expectedRunId,
                  executionId: input.expectedExecutionId,
                  candidateId: lifecycle.candidate.id,
                  campaignId: lifecycle.candidate.campaignId,
                  jobId: lifecycle.run.jobId!,
                  decision: 'CONFIRMED_NON_DELIVERY',
                  confirmation: input.confirmation,
                  attemptCountObserved: 1,
                  authorizedAt: input.authorizedAt,
                },
              }));

            const rearmed = await tx.whatsAppDispatch.updateMany({
              where: {
                id: input.dispatchId,
                status: 'PROCESSING',
                attemptCount: 1,
                externalMessageId: null,
                sentAt: null,
              },
              data: { status: 'PENDING' },
            });
            if (rearmed.count !== 1) {
              fail(
                'CAS de rearm do dispatch falhou',
                'WHATSAPP_DISPATCH_MANUAL_RECOVERY_REARM_CONFLICT',
              );
            }
            const persisted = await tx.whatsAppDispatchManualRecovery.update({
              where: { id: recoveryRaw.id },
              data: { rearmedAt: input.authorizedAt },
            });
            return {
              kind: 'AUTHORIZED' as const,
              recovery: mapRecovery(persisted),
              jobId: lifecycle.run.jobId!,
              campaignId: lifecycle.candidate.campaignId,
              candidateId: lifecycle.candidate.id,
            };
          },
          { isolationLevel: 'Serializable' },
        );
      } catch (error) {
        if (isPrismaCode(error, 'P2034') && transactionAttempt === 0) continue;
        if (isPrismaCode(error, 'P2002')) {
          const existing =
            await this.prisma.whatsAppDispatchManualRecovery.findUnique({
              where: { dispatchId: input.dispatchId },
            });
          if (existing) {
            const mapped = mapRecovery(existing);
            assertExistingRecoveryMatches(mapped, input);
            const lifecycle = await loadLifecycle(
              this.prisma,
              input,
              'PENDING',
              true,
            );
            return {
              kind: 'ALREADY_AUTHORIZED',
              recovery: mapped,
              jobId: lifecycle.run.jobId!,
              campaignId: lifecycle.candidate.campaignId,
              candidateId: lifecycle.candidate.id,
            };
          }
        }
        throw error;
      }
    }
    throw new AppError(
      'Recovery nao convergiu',
      'WHATSAPP_DISPATCH_MANUAL_RECOVERY_TRANSACTION_CONFLICT',
    );
  }

  async prepareManualRecoveryRequeue(
    input: WhatsAppDispatchManualRecoveryInput & {
      leaseExpiresAt: Date;
      checkedAt: Date;
    },
  ): Promise<WhatsAppDispatchManualRecoveryRequeueContext> {
    if (input.leaseExpiresAt.getTime() <= input.checkedAt.getTime()) {
      fail(
        'Nova lease precisa estar no futuro',
        'WHATSAPP_DISPATCH_MANUAL_RECOVERY_LEASE_INVALID',
      );
    }
    return this.prisma.$transaction(
      async (tx) => {
        const recoveryRaw = await tx.whatsAppDispatchManualRecovery.findUnique({
          where: { dispatchId: input.dispatchId },
        });
        if (!recoveryRaw) {
          throw new AppError(
            'Recovery ainda nao foi autorizado',
            'WHATSAPP_DISPATCH_MANUAL_RECOVERY_NOT_AUTHORIZED',
          );
        }
        const recovery = mapRecovery(recoveryRaw);
        assertExistingRecoveryMatches(recovery, input);
        if (!recovery.rearmedAt) {
          fail(
            'Dispatch ainda nao foi rearmado',
            'WHATSAPP_DISPATCH_MANUAL_RECOVERY_NOT_REARMED',
          );
        }
        const lifecycle = await loadLifecycle(
          tx as RecoveryDb,
          input,
          'PENDING',
          true,
        );
        if (
          recovery.jobId !== lifecycle.run.jobId ||
          recovery.campaignId !== lifecycle.candidate.campaignId ||
          recovery.candidateId !== lifecycle.candidate.id
        ) {
          fail(
            'Audit trail divergiu do lifecycle atual',
            'WHATSAPP_DISPATCH_MANUAL_RECOVERY_AUDIT_MISMATCH',
          );
        }

        const renewed = await tx.commercialGroupCampaign.updateMany({
          where: {
            id: lifecycle.campaign.id,
            attemptExecutionId: input.expectedExecutionId,
          },
          data: { attemptLeaseExpiresAt: input.leaseExpiresAt },
        });
        if (renewed.count !== 1) {
          fail(
            'Renew CAS da reservation falhou',
            'WHATSAPP_DISPATCH_MANUAL_RECOVERY_RESERVATION_RENEW_CONFLICT',
          );
        }
        return {
          recovery,
          jobId: lifecycle.run.jobId!,
          campaignId: lifecycle.candidate.campaignId,
          candidateId: lifecycle.candidate.id,
          dispatchId: input.dispatchId,
          runId: lifecycle.run.id,
          executionId: input.expectedExecutionId,
        };
      },
      { isolationLevel: 'Serializable' },
    );
  }

  async markManualRecoveryRequeued(input: {
    dispatchId: string;
    requeuedAt: Date;
  }): Promise<WhatsAppDispatchManualRecoveryRecord> {
    await this.prisma.whatsAppDispatchManualRecovery.updateMany({
      where: {
        dispatchId: input.dispatchId,
        rearmedAt: { not: null },
        requeuedAt: null,
      },
      data: { requeuedAt: input.requeuedAt },
    });
    const record = await this.prisma.whatsAppDispatchManualRecovery.findUnique({
      where: { dispatchId: input.dispatchId },
    });
    if (!record || !record.requeuedAt) {
      throw new AppError(
        'Nao foi possivel persistir requeuedAt',
        'WHATSAPP_DISPATCH_MANUAL_RECOVERY_REQUEUED_AUDIT_FAILED',
      );
    }
    return mapRecovery(record);
  }
}
