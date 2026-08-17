import type { FastifyBaseLogger } from 'fastify';
import {
  WhatsAppSendError,
  type WhatsAppProvider,
} from '@shopee-auto-affiliate-ai/providers';
import { AppError } from '@shopee-auto-affiliate-ai/shared';
import type {
  WhatsAppDispatchRepository,
  WhatsAppDispatchRecord,
  WhatsAppDispatchDetails,
} from './repositories';
import type { WhatsAppGroupSendPolicy } from './whatsapp-group-send-policy';
import {
  COMMERCIAL_AI_COPY_PROMPT_VERSION,
  COMMERCIAL_AI_COPY_VALIDATION_VERSION,
} from './commercial-ai-copy-prompt';
import { validateCommercialAffiliateLinkProvenance } from './commercial-affiliate-link-provenance';

import {
  COMMERCIAL_AUTOMATION_IMAGE_REQUIRED,
  resolveCommercialImageDelivery,
  type CommercialMessageDraftService,
} from './commercial-message-draft-service';

export type SenderServiceOptions = {
  dispatches: WhatsAppDispatchRepository;
  provider: WhatsAppProvider;
  logger: Pick<FastifyBaseLogger, 'info' | 'error'>;
  messageBuilder?: (copy: WhatsAppDispatchDetails['generatedCopy']) => string;
  draftService?: Pick<CommercialMessageDraftService, 'createDraft'>;
  groupSendPolicy?: WhatsAppGroupSendPolicy;
};



const providerErrorCode = (error: unknown) =>
  error instanceof AppError ? error.code : undefined;

export const buildWhatsAppPublicMessage = (copy: {
  titulo: string;
  mensagem: string;
  cta: string;
  hashtags: string;
}) =>
  [copy.titulo, copy.mensagem, copy.cta, copy.hashtags]
    .filter(Boolean)
    .join('\n\n');

export class SenderService {
  constructor(private readonly options: SenderServiceOptions) {}

  async sendDispatch(dispatchId: string): Promise<WhatsAppDispatchRecord> {
    this.options.logger.info(
      { event: 'whatsapp.dispatch.started', dispatchId },
      'WhatsApp dispatch started',
    );

    const dispatch = await this.options.dispatches.findByIdForSending(
      dispatchId,
    );

    if (!dispatch) {
      throw new AppError(
        'Envio WhatsApp não encontrado',
        'WHATSAPP_DISPATCH_NOT_FOUND',
      );
    }

    if (dispatch.status === 'SENT') return dispatch;

    if (dispatch.status !== 'PENDING') {
      throw new AppError(
        'Dispatch sem permissao para envio automatico',
        dispatch.status === 'PROCESSING'
          ? 'WHATSAPP_DISPATCH_DELIVERY_AMBIGUOUS'
          : 'WHATSAPP_DISPATCH_RETRY_REQUIRES_MANUAL_REVIEW',
      );
    }

    let message: string;
    let imageUrl: string | undefined;
    let deliveryMode: 'TEXT' | 'IMAGE' = 'TEXT';

    const candidateId = dispatch.generatedCopy.createdFromCandidateId;

    if (candidateId !== null && candidateId !== undefined) {
      if (!this.options.draftService) {
        throw new AppError(
          'Servico de rascunho comercial indisponivel',
          'COMMERCIAL_MESSAGE_DRAFT_SERVICE_UNAVAILABLE',
        );
      }

      const matches = dispatch.generatedCopy.promotionCandidates?.filter(
        (candidate) => candidate.id === candidateId,
      ) ?? [];

      if (matches.length !== 1) {
        throw new AppError(
          'Inconsistencia na relacao do candidato de promocao comercial',
          'COMMERCIAL_MESSAGE_RELATION_MISMATCH',
        );
      }

      const selectedCandidate = matches[0];
      if (!selectedCandidate) {
        throw new AppError(
          'Inconsistencia na relacao do candidato de promocao comercial',
          'COMMERCIAL_MESSAGE_RELATION_MISMATCH',
        );
      }

      if (
        dispatch.generatedCopyId !== dispatch.generatedCopy.id ||
        dispatch.productId !== dispatch.generatedCopy.productId ||
        selectedCandidate.generatedCopyId !== dispatch.generatedCopy.id ||
        selectedCandidate.productId !== dispatch.productId ||
        selectedCandidate.snapshotId !== dispatch.generatedCopy.snapshotId ||
        selectedCandidate.campaignId !== selectedCandidate.campaign.id ||
        dispatch.destinationId !== dispatch.destination.id
      ) {
        throw new AppError(
          'Inconsistencia na relacao do dispatch comercial',
          'COMMERCIAL_MESSAGE_RELATION_MISMATCH',
        );
      }

      if (dispatch.destination.type !== 'GROUP') {
        throw new AppError(
          'Dispatch promocional exige destino de grupo',
          'COMMERCIAL_MESSAGE_DESTINATION_TYPE_MISMATCH',
        );
      }

      if (
        !dispatch.destination.fingerprint ||
        selectedCandidate.campaign.logicalGroupFingerprint !==
          dispatch.destination.fingerprint
      ) {
        throw new AppError(
          'Destino comercial nao corresponde a campanha selecionada',
          'COMMERCIAL_MESSAGE_DESTINATION_MISMATCH',
        );
      }

      if (
        dispatch.generatedCopy.source !== 'AI' ||
        dispatch.generatedCopy.promptVersion !== COMMERCIAL_AI_COPY_PROMPT_VERSION ||
        dispatch.generatedCopy.validationVersion !==
          COMMERCIAL_AI_COPY_VALIDATION_VERSION
      ) {
        throw new AppError(
          'Copy comercial incompativel com o contrato certificado',
          'COMMERCIAL_MESSAGE_COPY_INCOMPATIBLE',
        );
      }

      const provenance = validateCommercialAffiliateLinkProvenance(
        {
          candidate: selectedCandidate,
          campaign: selectedCandidate.campaign,
          product: selectedCandidate.product,
          snapshot: selectedCandidate.snapshot,
        },
        {
          candidateId,
          campaignId: selectedCandidate.campaign.id,
          groupId: dispatch.destination.id,
        },
      );
      if (!provenance.valid) {
        throw new AppError(
          'Proveniencia do affiliate link invalida no dispatch',
          provenance.code,
        );
      }

      const candidate = {
        ...selectedCandidate,
        generatedCopy: {
          id: dispatch.generatedCopy.id,
          productId: dispatch.generatedCopy.productId,
          snapshotId: dispatch.generatedCopy.snapshotId ?? null,
          createdFromCandidateId: dispatch.generatedCopy.createdFromCandidateId ?? null,
          titulo: dispatch.generatedCopy.titulo,
          mensagem: dispatch.generatedCopy.mensagem,
          cta: dispatch.generatedCopy.cta,
          hashtags: dispatch.generatedCopy.hashtags,
        },
      };

      try {
        const draft = this.options.draftService.createDraft(candidate);
        if (
          draft.candidateId !== candidateId ||
          draft.generatedCopyId !== dispatch.generatedCopy.id
        ) {
          throw new AppError(
            'Rascunho comercial nao corresponde ao dispatch',
            'COMMERCIAL_MESSAGE_RELATION_MISMATCH',
          );
        }
        message = draft.caption;
        if (draft.deliveryMode === 'IMAGE') {
          if (!draft.imageUrl || draft.warnings.length > 0) {
            throw new AppError(
              'Rascunho comercial de imagem inconsistente',
              COMMERCIAL_AUTOMATION_IMAGE_REQUIRED,
            );
          }
          imageUrl = draft.imageUrl;
          deliveryMode = 'IMAGE';
        } else {
          imageUrl = undefined;
          deliveryMode = 'TEXT';
          this.options.logger.info(
            {
              event: 'whatsapp.dispatch.image_fallback',
              dispatchId,
              warningCodes: draft.warnings,
            },
            'Commercial message falling back to text',
          );
        }
      } catch (error) {
        let errorCode = 'COMMERCIAL_MESSAGE_DRAFT_FAILED';
        if (error instanceof AppError) {
          errorCode = error.code;
        } else if (error instanceof Error && /^COMMERCIAL_MESSAGE_[A-Z0-9_]+$/.test(error.message)) {
          errorCode = error.message;
        }

        this.options.logger.error(
          { event: 'whatsapp.dispatch.draft_failed', dispatchId, errorCode },
          'Failed to create commercial draft',
        );
        throw new AppError('Falha ao montar mensagem comercial', errorCode);
      }
    } else {
      message = this.options.messageBuilder
        ? this.options.messageBuilder(dispatch.generatedCopy)
        : buildWhatsAppPublicMessage(dispatch.generatedCopy);
      const media = resolveCommercialImageDelivery({
        imageUrl: dispatch.product?.urlImagem,
        affiliateLink: dispatch.product?.affiliateLink,
      });
      if (media.deliveryMode === 'IMAGE' && media.imageUrl) {
        imageUrl = media.imageUrl;
        deliveryMode = 'IMAGE';
      } else {
        imageUrl = undefined;
        deliveryMode = 'TEXT';
        this.options.logger.info(
          {
            event: 'whatsapp.dispatch.image_fallback',
            dispatchId,
            warningCodes: media.warnings,
          },
          'Commercial message falling back to text',
        );
      }
    }

    if (dispatch.destination.type === 'GROUP') {
      if (!this.options.groupSendPolicy) {
        throw new AppError(
          'Politica de envio para grupos nao configurada',
          'WHATSAPP_GROUP_POLICY_REQUIRED',
        );
      }
      this.options.groupSendPolicy.assertAuthorized(dispatch.destination);
    }

    const claimed = await this.options.dispatches.markAttemptPending(
      dispatchId,
    );
    if (!claimed) {
      throw new AppError(
        'Dispatch ja adquirido por outro processamento',
        'WHATSAPP_DISPATCH_ALREADY_CLAIMED',
      );
    }

    try {
      const result = await this.options.provider.sendMessage({
        destination: dispatch.destination.destination,
        message,
        ...(imageUrl && deliveryMode === 'IMAGE' ? { imageUrl } : {}),
        ...(dispatch.destination.type === 'GROUP'
          ? { destinationType: 'GROUP' as const }
          : {}),
      });

      const updated = await this.options.dispatches.markSent(dispatch.id, {
        externalMessageId: result.externalMessageId,
        sentAt: result.sentAt,
      });

      this.options.logger.info(
        {
          event: 'whatsapp.dispatch.sent',
          dispatchId,
        },
        'WhatsApp dispatch sent',
      );
      return updated;
    } catch (error) {
      if (
        error instanceof WhatsAppSendError &&
        !error.deliveryMayHaveStarted
      ) {
        try {
          await this.options.dispatches.markFailed(
            dispatch.id,
            'Envio bloqueado antes do request externo',
          );
        } catch (persistenceError) {
          this.options.logger.error(
            {
              event: 'whatsapp.dispatch.preflight-persistence-failed',
              dispatchId,
              errorType:
                persistenceError instanceof Error
                  ? persistenceError.name
                  : 'UnknownError',
            },
            'WhatsApp dispatch preflight failure could not be persisted',
          );
          throw new AppError(
            'Estado do dispatch incerto; revisao manual obrigatoria',
            'WHATSAPP_DISPATCH_DELIVERY_AMBIGUOUS',
          );
        }
        this.options.logger.error(
          {
            event: 'whatsapp.dispatch.blocked-before-request',
            dispatchId,
            providerErrorCode: error.code,
          },
          'WhatsApp dispatch blocked before external request',
        );
        throw error;
      }
      this.options.logger.error(
        {
          event: 'whatsapp.dispatch.delivery-ambiguous',
          dispatchId,
          errorType: error instanceof Error ? error.name : 'UnknownError',
          providerErrorCode: providerErrorCode(error),
        },
        'WhatsApp dispatch delivery is ambiguous',
      );
      throw new AppError(
        'Resultado do envio incerto; revisao manual obrigatoria',
        'WHATSAPP_DISPATCH_DELIVERY_AMBIGUOUS',
      );
    }
  }
}
