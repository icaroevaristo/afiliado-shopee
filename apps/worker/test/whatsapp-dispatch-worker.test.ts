import { describe, expect, it, vi } from 'vitest';
import { processWhatsAppDispatchJob, type WhatsAppDispatchProcessorRepositories } from '../src/whatsapp-dispatch-worker';
import { JOB_NAMES, type WhatsAppDispatchJob } from '@shopee-auto-affiliate-ai/queue';
import type { WhatsAppProvider } from '@shopee-auto-affiliate-ai/providers';
import { fingerprintWhatsAppGroupId } from '@shopee-auto-affiliate-ai/providers';
import type { CommercialMessageDraftService } from '../../api/src/commercial-message-draft-service';
import { AppError } from '@shopee-auto-affiliate-ai/shared';
import type { Job } from 'bullmq';
import type { WhatsAppDispatchDetails } from '../../api/src/repositories';
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

const fakeCopy = {
  id: 'copy-123',
  productId: 'prod-123',
  snapshotId: 'snap-123',
  titulo: 'Title',
  mensagem: 'Message',
  cta: 'Buy now',
  hashtags: '#sale',
  createdAt: new Date(),
  createdFromCandidateId: 'candidate-123',
  promotionCandidates: [
    {
      id: 'candidate-123',
      status: 'COPY_READY' as const,
      productId: 'prod-123',
      snapshotId: 'snap-123',
      generatedCopyId: 'copy-123',
      createdAt: new Date(),
      expiresAt: null,
      snapshot: {
        id: 'snap-123',
        productId: 'prod-123',
        revision: 1,
        fingerprint: 'hash',
        preco: 10,
        comissao: 1,
        desconto: 0,
        nota: 5,
        vendidos: 100,
        createdAt: new Date(),
        updatedAt: new Date(),
        unavailableAt: null,
        offerEndsAt: null,
      },
      product: fakeProduct,
    },
  ],
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
    const markSent = vi.fn().mockResolvedValue(fakeDispatch);
    const findByIdWithDetails = vi.fn().mockResolvedValue(fakeDispatch);

    const repositories: WhatsAppDispatchProcessorRepositories = {
      whatsappDispatches: {
        findByIdWithDetails,
        markAttemptPending,
        markSent,
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
    });

    expect(draftService.createDraft).toHaveBeenCalledOnce();
    expect(whatsAppProvider.sendMessage).toHaveBeenCalledOnce();
    expect(whatsAppProvider.sendMessage).toHaveBeenCalledWith({
      destination: '5511999999999',
      message: 'draft text',
      imageUrl: 'http://image',
    });
    expect(markAttemptPending).toHaveBeenCalledOnce();
  });

  it('falha na criacao do draft nao chama o provider e falha sem tentativas adicionais', async () => {
    const markAttemptPending = vi.fn().mockResolvedValue(true);
    const markFailed = vi.fn().mockResolvedValue(fakeDispatch);
    const findByIdWithDetails = vi.fn().mockResolvedValue(fakeDispatch);

    const repositories: WhatsAppDispatchProcessorRepositories = {
      whatsappDispatches: {
        findByIdWithDetails,
        markAttemptPending,
        markFailed,
        markSent: vi.fn(),
        createPending: vi.fn(),
        findByIdForSending: vi.fn().mockResolvedValue(fakeDispatch),
        list: vi.fn(),
      },
      commercialRuns: {
        create: vi.fn(),
        update: vi.fn(),
        list: vi.fn(),
        findById: vi.fn(),
        findByDispatchId: vi.fn().mockResolvedValue(null),
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
      })
    ).rejects.toThrow('Falha ao montar mensagem');

    expect(draftService.createDraft).toHaveBeenCalledOnce();
    expect(whatsAppProvider.sendMessage).not.toHaveBeenCalled();
    expect(markAttemptPending).not.toHaveBeenCalled();
  });
});
