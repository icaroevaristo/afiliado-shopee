import type { FastifyBaseLogger } from 'fastify';
import { AppError } from '@shopee-auto-affiliate-ai/shared';

import type { CommercialCopyGenerator } from './commercial-copy-service';
import {
  duplicateLogicalGroupFingerprints,
  isCommercialAssignedGroup,
  isCommercialAuthorizedGroup,
} from './commercial-group-selection';
import {
  assertActiveCommercialInstance,
  filterExecutableCommercialGroups,
  requireAssignedInstanceName,
} from './commercial-instance-stickiness';
import { commercialProductRejections } from './commercial-offer-eligibility';
import type {
  CommercialDeliveryHistoryRepository,
  CommercialDispatchOutboxRepository,
  CommercialPipelineRunRecord,
  CommercialPipelineRunRepository,
  WhatsAppInstanceRepository,
  ShopeeOfferRepository,
  WhatsAppGroupDirectoryRepository,
  WhatsAppGroupRecord,
} from './repositories';
import type { CommercialDispatchOutboxPublisher } from './commercial-dispatch-outbox-publisher';

export const COMMERCIAL_CONFIRMATION_TOKEN = 'CONFIRMAR_ENVIO_COMERCIAL';

export const commercialConfirmationIds = (dryRunId: string) => ({
  copyId: `commercial-${dryRunId}-copy`,
  dispatchId: `commercial-${dryRunId}-dispatch`,
  jobId: `commercial-${dryRunId}-job`,
  outboxId: `commercial-${dryRunId}-outbox`,
});

export type CommercialConfirmationEnvironment = {
  groupSendEnabled: boolean;
  safeMode: boolean;
  schedulerEnabled: boolean;
  maximumMessagesPerRun: number;
};

export type CommercialPipelineConfirmationResult = {
  runId: string;
  mode: 'confirmed';
  status: 'queued';
  selectedProduct: { name: string; price: string };
  selectedGroup: { name: string; fingerprint: string };
  copyPreview: string;
  dispatchWasCreated: true;
  jobWasCreated: true;
  messageWasSent: false;
  dispatchStatus: 'pending';
  attemptCount: 0;
  externalMessageIdRecorded: false;
  investigationRequired: false;
};

export type CommercialPipelineConfirmationOptions = {
  existingGeneratedCopyId?: string;
};

export type CommercialPipelineConfirmationServiceOptions = {
  runs: CommercialPipelineRunRepository;
  offers: ShopeeOfferRepository;
  groups: WhatsAppGroupDirectoryRepository;
  instances?: Pick<WhatsAppInstanceRepository, 'findByName'>;
  outboxes: CommercialDispatchOutboxRepository;
  deliveryHistory: CommercialDeliveryHistoryRepository;
  copy: CommercialCopyGenerator;
  publisher: Pick<CommercialDispatchOutboxPublisher, 'publish'>;
  instanceName: string;
  environment: CommercialConfirmationEnvironment;
  logger: Pick<FastifyBaseLogger, 'info' | 'error'>;
  clock?: () => Date;
};

const changed = (message: string, code: string): never => {
  throw new AppError(message, code);
};

const assertEnvironment = (environment: CommercialConfirmationEnvironment) => {
  if (!environment.groupSendEnabled) {
    changed(
      'Envio comercial para grupos esta desativado',
      'GROUP_SEND_DISABLED',
    );
  }
  if (!environment.safeMode) {
    changed(
      'Safe mode e obrigatorio para envio comercial',
      'COMMERCIAL_SAFE_MODE_REQUIRED',
    );
  }
  if (environment.schedulerEnabled) {
    changed(
      'Scheduler deve permanecer desativado',
      'COMMERCIAL_SCHEDULER_BLOCKED',
    );
  }
  if (environment.maximumMessagesPerRun !== 1) {
    changed(
      'O limite comercial deve ser exatamente uma mensagem',
      'COMMERCIAL_MESSAGE_LIMIT_INVALID',
    );
  }
};

const assertReadyRun = (run: CommercialPipelineRunRecord | null) => {
  if (!run) {
    return changed(
      'Dry-run comercial nao esta pronto',
      'COMMERCIAL_RUN_NOT_READY',
    );
  }
  if (
    run.mode === 'CONFIRMED' ||
    run.confirmedAt ||
    run.dispatchId ||
    run.jobId
  ) {
    return changed(
      'Dry-run comercial ja possui confirmacao ou tentativa anterior',
      'COMMERCIAL_RUN_ALREADY_CONFIRMED',
    );
  }
  if (
    run.mode !== 'DRY_RUN' ||
    run.status !== 'COMPLETED' ||
    !run.productId ||
    !run.groupDestinationId ||
    !run.productName ||
    !run.productPrice ||
    !run.groupName ||
    !run.groupFingerprint ||
    !run.copyPreview
  ) {
    return changed(
      'Dry-run comercial nao esta pronto',
      'COMMERCIAL_RUN_NOT_READY',
    );
  }
  return run as CommercialPipelineRunRecord & {
    productId: string;
    groupDestinationId: string;
    productName: string;
    productPrice: string;
    groupName: string;
    groupFingerprint: string;
    copyPreview: string;
  };
};

export class CommercialPipelineConfirmationService {
  private readonly clock: () => Date;

  constructor(
    private readonly options: CommercialPipelineConfirmationServiceOptions,
  ) {
    this.clock = options.clock ?? (() => new Date());
  }

  async confirm(
    dryRunId: string,
    confirmation: string,
    options: CommercialPipelineConfirmationOptions = {},
  ): Promise<CommercialPipelineConfirmationResult> {
    if (confirmation !== COMMERCIAL_CONFIRMATION_TOKEN) {
      changed(
        'Confirmacao comercial invalida',
        'COMMERCIAL_CONFIRMATION_INVALID',
      );
    }
    assertEnvironment(this.options.environment);
    const existingGeneratedCopyId = options.existingGeneratedCopyId;
    const hasExistingGeneratedCopy = existingGeneratedCopyId !== undefined;
    if (existingGeneratedCopyId !== undefined && !existingGeneratedCopyId.trim()) {
      changed(
        'Copy candidate-scoped invalida',
        'COMMERCIAL_OUTBOX_CANDIDATE_COPY_INVALID',
      );
    }

    const initial = assertReadyRun(await this.options.runs.findById(dryRunId));
    const ids = commercialConfirmationIds(dryRunId);
    const confirmedAt = this.clock();
    try {
      const run = initial;
      const product = await this.options.offers.findOfferById(run.productId);
      if (
        !product ||
        !['MOCK', 'MANUAL', 'OFFICIAL'].includes(product.source) ||
        commercialProductRejections(product, this.clock()).length > 0 ||
        product.productName !== run.productName ||
        product.price !== run.productPrice ||
        !product.affiliateLink ||
        !run.copyPreview.includes(product.affiliateLink)
      ) {
        return changed(
          'Produto mudou desde o dry-run',
          'COMMERCIAL_PRODUCT_CHANGED',
        );
      }
      if (hasExistingGeneratedCopy) {
        if (!run.copyPreview.includes(product.affiliateLink)) {
          return changed(
            'Produto ou link mudou desde o dry-run',
            'COMMERCIAL_PRODUCT_CHANGED',
          );
        }
      } else {
        const currentCopy = this.options.copy.generate({
          productName: product.productName,
          price: product.price,
          discountRate: product.discountRate,
          shopName: product.shopName,
          affiliateLink: product.affiliateLink,
        });
        if (currentCopy !== run.copyPreview) {
          return changed(
            'Produto ou link mudou desde o dry-run',
            'COMMERCIAL_PRODUCT_CHANGED',
          );
        }
      }

      const candidateGroups = (
        this.options.groups.listAll
          ? await this.options.groups.listAll({ active: true, available: true })
          : await this.options.groups.list(this.options.instanceName, {
              active: true,
              available: true,
            })
      ).filter((group): group is WhatsAppGroupRecord =>
        this.options.groups.listAll
          ? typeof group.assignedInstanceName === 'string' &&
            isCommercialAssignedGroup(group, group.assignedInstanceName)
          : isCommercialAuthorizedGroup(group, this.options.instanceName),
      );
      const groups = await filterExecutableCommercialGroups(
        candidateGroups,
        this.options.instances,
      );
      if (duplicateLogicalGroupFingerprints(groups).length > 0) {
        return changed(
          'Mais de um destino representa o mesmo grupo logico',
          'COMMERCIAL_AUTOMATION_DUPLICATE_LOGICAL_GROUP',
        );
      }
      const group = groups.find(
        (candidate) => candidate.id === run.groupDestinationId,
      );
      if (
        !group ||
        group.id !== run.groupDestinationId ||
        group.name !== run.groupName ||
        group.fingerprint !== run.groupFingerprint
      ) {
        return changed(
          'Grupo mudou desde o dry-run',
          'COMMERCIAL_GROUP_CHANGED',
        );
      }
      const assignedInstanceName = requireAssignedInstanceName(group);
      if (!run.instanceName || group.assignedInstanceName !== run.instanceName) {
        return changed(
          'Lifecycle comercial nao possui assignment sticky valida',
          'COMMERCIAL_INSTANCE_ASSIGNMENT_INVALID',
        );
      }
      if (assignedInstanceName !== run.instanceName) {
        return changed(
          'Lifecycle comercial possui instancia atribuida divergente',
          'COMMERCIAL_INSTANCE_ASSIGNMENT_INVALID',
        );
      }
      try {
        await assertActiveCommercialInstance(
          this.options.instances,
          assignedInstanceName,
        );
      } catch (error) {
        if (error instanceof AppError) return changed(error.message, error.code);
        throw error;
      }
      const stickyInstanceName = assignedInstanceName;
      if (
        await this.options.deliveryHistory.wasProductSentToGroup(
          run.productId,
          group.id,
        )
      ) {
        return changed(
          'Produto ja foi enviado ao grupo',
          'PRODUCT_ALREADY_SENT',
        );
      }

      const outbox = await this.options.outboxes.createPendingConfirmation(
        existingGeneratedCopyId !== undefined
          ? {
              outboxId: ids.outboxId,
              runId: run.id,
              confirmedAt,
              instanceName: stickyInstanceName,
              existingGeneratedCopyId,
              dispatch: {
                id: ids.dispatchId,
                productId: run.productId,
                generatedCopyId: existingGeneratedCopyId,
                destinationId: group.id,
                instanceName: stickyInstanceName,
              },
              jobId: ids.jobId,
            }
          : {
              outboxId: ids.outboxId,
              runId: run.id,
              confirmedAt,
              instanceName: stickyInstanceName,
              copy: {
                id: ids.copyId,
                productId: run.productId,
                titulo: '',
                mensagem: run.copyPreview,
                cta: '',
                hashtags: '',
              },
              dispatch: {
                id: ids.dispatchId,
                productId: run.productId,
                generatedCopyId: ids.copyId,
                destinationId: group.id,
                instanceName: stickyInstanceName,
              },
              jobId: ids.jobId,
            },
      );
      if (!outbox) {
        return changed(
          'Dry-run comercial ja foi confirmado',
          'COMMERCIAL_RUN_ALREADY_CONFIRMED',
        );
      }
      await this.options.publisher.publish(outbox.id);
      this.options.logger.info(
        {
          event: 'commercial-pipeline.confirmed.queued',
          runId: run.id,
          groupFingerprint: group.fingerprint,
        },
        'Commercial pipeline confirmation queued',
      );
      return {
        runId: run.id,
        mode: 'confirmed',
        status: 'queued',
        selectedProduct: { name: run.productName, price: run.productPrice },
        selectedGroup: {
          name: run.groupName,
          fingerprint: run.groupFingerprint,
        },
        copyPreview: run.copyPreview,
        dispatchWasCreated: true,
        jobWasCreated: true,
        messageWasSent: false,
        dispatchStatus: 'pending',
        attemptCount: 0,
        externalMessageIdRecorded: false,
        investigationRequired: false,
      };
    } catch (error) {
      const safeCode =
        error instanceof AppError ? error.code : 'COMMERCIAL_DISPATCH_FAILED';
      if (safeCode === 'COMMERCIAL_OUTBOX_INCONSISTENT') {
        await this.options.runs.update(initial.id, {
          status: 'FAILED',
          finalStatus: 'AMBIGUOUS',
          investigationRequired: true,
          failureCode: safeCode,
          completedAt: this.clock(),
        });
      }
      this.options.logger.error(
        {
          event: 'commercial-pipeline.confirmed.failed',
          runId: initial.id,
          code: safeCode,
        },
        'Commercial pipeline confirmation failed',
      );
      if (error instanceof AppError) throw error;
      throw new AppError(
        'Falha segura ao confirmar pipeline comercial',
        'COMMERCIAL_DISPATCH_FAILED',
      );
    }
  }

  async markInvestigationRequired(runId: string) {
    await this.options.outboxes.markAmbiguous(
      commercialConfirmationIds(runId).outboxId,
      'COMMERCIAL_DISPATCH_FAILED',
      this.clock(),
    );
  }
}
