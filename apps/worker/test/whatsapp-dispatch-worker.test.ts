import { describe, expect, it, vi } from 'vitest';
import { processWhatsAppDispatchJob, type WhatsAppDispatchProcessorRepositories } from '../src/whatsapp-dispatch-worker';
import { JOB_NAMES, type WhatsAppDispatchJob } from '@shopee-auto-affiliate-ai/queue';
import type { WhatsAppProvider } from '@shopee-auto-affiliate-ai/providers';
import { fingerprintWhatsAppGroupId } from '@shopee-auto-affiliate-ai/providers';
import type { CommercialMessageDraftService } from '../../api/src/commercial-message-draft-service';
import { AppError } from '@shopee-auto-affiliate-ai/shared';
import type { Job } from 'bullmq';
import type { WhatsAppDispatchDetails } from '../../api/src/repositories';
import { fingerprintCommercialOffer } from '../../api/src/commercial-offer-snapshot';
import {
  COMMERCIAL_AI_COPY_PROMPT_VERSION,
  COMMERCIAL_AI_COPY_VALIDATION_VERSION,
} from '../../api/src/commercial-ai-copy-prompt';
import { WhatsAppGroupSendPolicy } from '../../api/src/whatsapp-group-send-policy';

const fakeDestination = {
  id: 'dest-123',
  destination: '5511999999999',
  type: 'INDIVIDUAL' as const,
  name: 'Test',
  active: true,
  available: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  fingerprint: 'hash',
  sourceInstanceName: 'instance',
};

const fakeProduct = {
  id: 'prod-123',
  providerProductId: 'prod-id-1',
  origin: 'OFFICIAL' as const,
  nome: 'Test',
  preco: 10,
  urlImagem: 'http://img',
  affiliateLink: 'http://link',
  desconto: 0,
  nota: 5,
  vendidos: 100,
  comissao: 1,
  loja: 'Shopee',
  categoria: 'cat',
  createdAt: new Date(),
  updatedAt: new Date(),
  score: 100,
  scoreUpdatedAt: new Date(),
  lastSeenAt: new Date(),
  unavailableAt: null,
  commercialSnapshotRevision: 1,
  commercialSnapshotFingerprint: 'hash',
};

const fakeCopy: WhatsAppDispatchDetails['generatedCopy'] = {
  id: 'copy-123',
  productId: 'prod-123',
  snapshotId: 'snap-123',
  titulo: 'Title',
  mensagem: 'Message',
  cta: 'Buy now',
  hashtags: '#sale',
  createdFromCandidateId: null,
  source: 'AI',
  promptVersion: COMMERCIAL_AI_COPY_PROMPT_VERSION,
  validationVersion: COMMERCIAL_AI_COPY_VALIDATION_VERSION,
};
const fakeDispatch: WhatsAppDispatchDetails = {
  id: 'dispatch-123',
  destinationId: 'dest-123',
  generatedCopyId: 'copy-123',
  productId: 'prod-123',
  status: 'PENDING',
  attemptCount: 0,
  errorMessage: null,
  sentAt: null,
  externalMessageId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  destination: fakeDestination,
  product: fakeProduct,
  generatedCopy: fakeCopy,
};

const commercialGroupId = '120363000000000000@g.us';
const commercialGroupFingerprint = fingerprintWhatsAppGroupId(commercialGroupId);
const commercialProductLink = 'https://shopee.com.br/product/1/1';
const commercialAffiliateLink = 'https://shope.ee/affiliate-product-1';
const commercialFingerprint = fingerprintCommercialOffer({
  source: 'OFFICIAL',
  providerProductId: 'prod-id-1',
  productLink: commercialProductLink,
  affiliateLink: commercialAffiliateLink,
  price: '10',
  priceMin: null,
  priceMax: null,
  discountRate: 0,
  commissionRate: 1,
  offerStartsAt: null,
  offerEndsAt: null,
  unavailableAt: null,
});

const commercialDispatch: WhatsAppDispatchDetails = {
  ...fakeDispatch,
  destination: {
    id: 'dest-commercial',
    destination: commercialGroupId,
    type: 'GROUP',
    active: true,
    available: true,
    fingerprint: commercialGroupFingerprint,
    sourceInstanceName: 'instance',
  },
  destinationId: 'dest-commercial',
  product: {
    comissao: 1,
    urlImagem: 'https://shopee.com.br/image.jpg',
    affiliateLink: commercialAffiliateLink,
  },
  generatedCopy: {
    id: 'copy-123',
    productId: 'prod-123',
    snapshotId: 'snap-123',
    titulo: 'Title',
    mensagem: 'Message',
    cta: `Buy now ${commercialAffiliateLink}`,
    hashtags: '#sale',
    createdFromCandidateId: 'candidate-123',
    source: 'AI',
    promptVersion: COMMERCIAL_AI_COPY_PROMPT_VERSION,
    validationVersion: COMMERCIAL_AI_COPY_VALIDATION_VERSION,
    promotionCandidates: [
      {
        id: 'candidate-123',
        campaignId: 'campaign-1',
        campaign: {
          id: 'campaign-1',
          logicalGroupFingerprint: commercialGroupFingerprint,
        },
        status: 'COPY_READY',
        productId: 'prod-123',
        snapshotId: 'snap-123',
        generatedCopyId: 'copy-123',
        expiresAt: null,
        snapshot: {
          id: 'snap-123',
          productId: 'prod-123',
          revision: 1,
          fingerprint: commercialFingerprint,
          unavailableAt: null,
          offerEndsAt: null,
        },
        product: {
          id: 'prod-123',
          source: 'OFFICIAL',
          providerProductId: 'prod-id-1',
          productName: 'Test',
          shopName: 'Shopee',
          productLink: commercialProductLink,
          affiliateLink: commercialAffiliateLink,
          price: '10',
          priceMin: null,
          priceMax: null,
          discountRate: 0,
          commissionRate: 1,
          rating: 5,
          sales: 100,
          offerStartsAt: null,
          urlImagem: 'https://shopee.com.br/image.jpg',
          offerEndsAt: null,
          unavailableAt: null,
          commercialSnapshotRevision: 1,
          commercialSnapshotFingerprint: commercialFingerprint,
          updatedAt: new Date(),
        },
      },
    ],
  },
};

const commercialGroupSendPolicy = () =>
  new WhatsAppGroupSendPolicy({
    enabled: true,
    safeMode: true,
    instanceName: 'instance',
  });
describe('processWhatsAppDispatchJob', () => {
  it('inicia runs deterministicas para dois jobs GROUP no mesmo provider', async () => {
    const groupId = '120363000000000000@g.us';
    const destination = {
      ...fakeDestination,
      destination: groupId,
      type: 'GROUP' as const,
      fingerprint: fingerprintWhatsAppGroupId(groupId),
    };
    const dispatches = ['dispatch-a', 'dispatch-b'].map((id) => ({
      ...fakeDispatch,
      id,
      destination,
    }));
    const createRepositories = (
      dispatch: WhatsAppDispatchDetails,
    ): WhatsAppDispatchProcessorRepositories => ({
      whatsappDispatches: {
        findByIdWithDetails: vi.fn().mockResolvedValue(dispatch),
        markAttemptPending: vi.fn().mockResolvedValue(true),
        markSent: vi.fn().mockResolvedValue({ ...dispatch, status: 'SENT' }),
        createPending: vi.fn(),
        findByIdForSending: vi.fn().mockResolvedValue(dispatch),
        list: vi.fn(),
        markFailed: vi.fn(),
      },
      commercialRuns: {
        create: vi.fn(),
        update: vi.fn(),
        list: vi.fn(),
        findById: vi.fn(),
        findByDispatchId: vi.fn().mockResolvedValue(null),
        finalizeByDispatchId: vi.fn().mockResolvedValue(null),
      },
    });
    const events: string[] = [];
    const whatsAppProvider: WhatsAppProvider = {
      beginRun: vi.fn((runId) => events.push(`begin:${runId}`)),
      sendMessage: vi.fn(async () => {
        events.push('send');
        return {
          status: 'sent' as const,
          externalMessageId: 'external-id',
          sentAt: new Date(),
        };
      }),
    };
    const groupSendPolicy = new WhatsAppGroupSendPolicy({
      enabled: true,
      safeMode: true,
      instanceName: 'instance',
    });
    const draftService: Pick<CommercialMessageDraftService, 'createDraft'> = {
      createDraft: vi.fn().mockReturnValue({
        candidateId: 'candidate-123',
        generatedCopyId: 'copy-123',
        caption: 'draft text',
        deliveryMode: 'IMAGE',
        imageUrl: 'http://image',
        warnings: [],
      }),
    };

    await processWhatsAppDispatchJob(
      {
        id: 'job-a',
        name: JOB_NAMES.whatsappDispatch,
        data: { dispatchId: dispatches[0].id },
      },
      {
        repositories: createRepositories(dispatches[0]),
        whatsAppProvider,
        logger: { info: vi.fn(), error: vi.fn() },
        groupSendPolicy,
        draftService,
      },
    );
    await processWhatsAppDispatchJob(
      {
        id: 'job-b',
        name: JOB_NAMES.whatsappDispatch,
        data: { dispatchId: dispatches[1].id },
      },
      {
        repositories: createRepositories(dispatches[1]),
        whatsAppProvider,
        logger: { info: vi.fn(), error: vi.fn() },
        groupSendPolicy,
        draftService,
      },
    );

    expect(whatsAppProvider.beginRun).toHaveBeenNthCalledWith(1, 'job-a');
    expect(whatsAppProvider.beginRun).toHaveBeenNthCalledWith(2, 'job-b');
    expect(whatsAppProvider.sendMessage).toHaveBeenCalledTimes(2);
    expect(events).toEqual(['begin:job-a', 'send', 'begin:job-b', 'send']);
  });

  it('usa dispatchId como identidade deterministica quando job.id esta ausente', async () => {
    const whatsAppProvider: WhatsAppProvider = {
      beginRun: vi.fn(),
      sendMessage: vi.fn().mockResolvedValue({
        status: 'sent',
        externalMessageId: 'ext-123',
        sentAt: new Date(),
      }),
    };
    const repositories: WhatsAppDispatchProcessorRepositories = {
      whatsappDispatches: {
        findByIdWithDetails: vi.fn().mockResolvedValue(fakeDispatch),
        markAttemptPending: vi.fn().mockResolvedValue(true),
        markSent: vi.fn().mockResolvedValue(fakeDispatch),
        createPending: vi.fn(),
        findByIdForSending: vi.fn().mockResolvedValue(fakeDispatch),
        list: vi.fn(),
        markFailed: vi.fn(),
      },
      commercialRuns: {
        create: vi.fn(),
        update: vi.fn(),
        list: vi.fn(),
        findById: vi.fn(),
        findByDispatchId: vi.fn().mockResolvedValue(null),
        finalizeByDispatchId: vi.fn().mockResolvedValue(null),
      },
    };
    const draftService: Pick<CommercialMessageDraftService, 'createDraft'> = {
      createDraft: vi.fn().mockReturnValue({
        candidateId: 'candidate-123',
        generatedCopyId: 'copy-123',
        caption: 'draft text',
        deliveryMode: 'IMAGE',
        imageUrl: 'http://image',
        warnings: [],
      }),
    };

    await processWhatsAppDispatchJob(
      {
        id: undefined,
        name: JOB_NAMES.whatsappDispatch,
        data: { dispatchId: 'dispatch-123' },
      },
      {
        repositories,
        whatsAppProvider,
        logger: { info: vi.fn(), error: vi.fn() },
        draftService,
      },
    );

    expect(whatsAppProvider.beginRun).toHaveBeenCalledOnce();
    expect(whatsAppProvider.beginRun).toHaveBeenCalledWith('dispatch-123');
  });

  it('dispatch comercial recebe draftService sem COMMERCIAL_MESSAGE_DRAFT_SERVICE_UNAVAILABLE e chama provider uma vez para draft IMAGE', async () => {
    const markAttemptPending = vi.fn().mockResolvedValue(true);
    const markSent = vi.fn().mockResolvedValue(commercialDispatch);
    const findByIdWithDetails = vi.fn().mockResolvedValue(commercialDispatch);

    const repositories: WhatsAppDispatchProcessorRepositories = {
      whatsappDispatches: {
        findByIdWithDetails,
        markAttemptPending,
        markSent,
        createPending: vi.fn(),
        findByIdForSending: vi.fn().mockResolvedValue(commercialDispatch),
        list: vi.fn(),
        markFailed: vi.fn(),
      },
      commercialRuns: {
        create: vi.fn(),
        update: vi.fn(),
        list: vi.fn(),
        findById: vi.fn(),
        findByDispatchId: vi.fn().mockResolvedValue(null),
        finalizeByDispatchId: vi.fn().mockResolvedValue(null),
      },
    };

    const fakeJob: Pick<Job<WhatsAppDispatchJob>, 'id' | 'name' | 'data'> = {
      id: 'job-123',
      name: JOB_NAMES.whatsappDispatch,
      data: { dispatchId: 'dispatch-123' },
    };

    const whatsAppProvider: WhatsAppProvider = {
      sendMessage: vi.fn().mockResolvedValue({
        status: 'sent',
        externalMessageId: 'ext-123',
        sentAt: new Date(),
      }),
    };

    const draftService: Pick<CommercialMessageDraftService, 'createDraft'> = {
      createDraft: vi.fn().mockReturnValue({
        candidateId: 'candidate-123',
        generatedCopyId: 'copy-123',
        caption: 'draft text',
        deliveryMode: 'IMAGE',
        imageUrl: 'http://image',
        warnings: [],
      }),
    };

    const logger = { info: vi.fn(), error: vi.fn() };

    await processWhatsAppDispatchJob(fakeJob, {
      repositories,
      whatsAppProvider,
      logger,
      draftService,
      groupSendPolicy: commercialGroupSendPolicy(),
    });

    expect(draftService.createDraft).toHaveBeenCalledOnce();
    expect(whatsAppProvider.sendMessage).toHaveBeenCalledOnce();
    expect(whatsAppProvider.sendMessage).toHaveBeenCalledWith({
      destination: commercialGroupId,
      destinationType: 'GROUP',
      message: 'draft text',
      imageUrl: 'http://image',
    });
    expect(markAttemptPending).toHaveBeenCalledOnce();
  });

  it('falha na criacao do draft nao chama o provider e falha sem tentativas adicionais', async () => {
    const markAttemptPending = vi.fn().mockResolvedValue(true);
    const markFailed = vi.fn().mockResolvedValue(commercialDispatch);
    const findByIdWithDetails = vi.fn().mockResolvedValue(commercialDispatch);

    const repositories: WhatsAppDispatchProcessorRepositories = {
      whatsappDispatches: {
        findByIdWithDetails,
        markAttemptPending,
        markFailed,
        markSent: vi.fn(),
        createPending: vi.fn(),
        findByIdForSending: vi.fn().mockResolvedValue(commercialDispatch),
        list: vi.fn(),
      },
      commercialRuns: {
        create: vi.fn(),
        update: vi.fn(),
        list: vi.fn(),
        findById: vi.fn(),
        findByDispatchId: vi.fn().mockResolvedValue(null),
        finalizeByDispatchId: vi.fn().mockResolvedValue(null),
      },
    };

    const fakeJob: Pick<Job<WhatsAppDispatchJob>, 'id' | 'name' | 'data'> = {
      id: 'job-123',
      name: JOB_NAMES.whatsappDispatch,
      data: { dispatchId: 'dispatch-123' },
    };

    const whatsAppProvider: WhatsAppProvider = {
      sendMessage: vi.fn(),
    };

    const draftService: Pick<CommercialMessageDraftService, 'createDraft'> = {
      createDraft: vi.fn().mockImplementation(() => {
        throw new AppError('Draft failure', 'DRAFT_ERROR');
      }),
    };

    const logger = { info: vi.fn(), error: vi.fn() };

    await expect(
      processWhatsAppDispatchJob(fakeJob, {
        repositories,
        whatsAppProvider,
        logger,
        draftService,
        groupSendPolicy: commercialGroupSendPolicy(),
      })
    ).rejects.toThrow('Falha ao montar mensagem');

    expect(draftService.createDraft).toHaveBeenCalledOnce();
    expect(whatsAppProvider.sendMessage).not.toHaveBeenCalled();
    expect(markAttemptPending).not.toHaveBeenCalled();
  });

  it('propaga conflito da finalizacao comercial sem mascarar o erro do Sender', async () => {
    const senderError = new AppError(
      'Dispatch requer revisao manual',
      'WHATSAPP_DISPATCH_DELIVERY_AMBIGUOUS',
    );
    const finalizationError = new AppError(
      'Finalizacao comercial em conflito',
      'COMMERCIAL_PIPELINE_RUN_FINALIZATION_CONFLICT',
    );
    const dispatch = {
      ...commercialDispatch,
      status: 'PROCESSING' as const,
      attemptCount: 1,
    };
    const findByIdForSending = vi.fn().mockRejectedValue(senderError);
    const findByIdWithDetails = vi.fn().mockResolvedValue(dispatch);
    const markAttemptPending = vi.fn();
    const repositories: WhatsAppDispatchProcessorRepositories = {
      whatsappDispatches: {
        findByIdWithDetails,
        markAttemptPending,
        markSent: vi.fn(),
        createPending: vi.fn(),
        findByIdForSending,
        list: vi.fn(),
        markFailed: vi.fn(),
      },
      commercialRuns: {
        create: vi.fn(),
        update: vi.fn(),
        list: vi.fn(),
        findById: vi.fn(),
        findByDispatchId: vi.fn().mockResolvedValue(null),
        finalizeByDispatchId: vi.fn().mockRejectedValue(finalizationError),
      },
    };
    const whatsAppProvider: WhatsAppProvider = { sendMessage: vi.fn() };
    const logger = { info: vi.fn(), error: vi.fn() };

    const result = await processWhatsAppDispatchJob(
      {
        id: 'job-123',
        name: JOB_NAMES.whatsappDispatch,
        data: { dispatchId: 'dispatch-123' },
      },
      { repositories, whatsAppProvider, logger },
    ).catch((error: unknown) => error);

    expect(result).toBe(finalizationError);
    expect(result).toMatchObject({
      code: 'COMMERCIAL_PIPELINE_RUN_FINALIZATION_CONFLICT',
    });
    expect((result as Error & { cause?: unknown }).cause).toBe(senderError);
    expect(whatsAppProvider.sendMessage).not.toHaveBeenCalled();
    expect(markAttemptPending).not.toHaveBeenCalled();
    expect(dispatch.attemptCount).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        dispatchId: 'dispatch-123',
        senderErrorCode: 'WHATSAPP_DISPATCH_DELIVERY_AMBIGUOUS',
        finalizationErrorCode: 'COMMERCIAL_PIPELINE_RUN_FINALIZATION_CONFLICT',
      }),
      'Commercial pipeline finalization failed',
    );
  });
});
