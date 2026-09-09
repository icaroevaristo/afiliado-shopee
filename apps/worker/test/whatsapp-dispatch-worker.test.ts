import { describe, expect, it, vi } from 'vitest';
import {
  processWhatsAppDispatchJob,
  type WhatsAppDispatchProcessorRepositories,
} from '../src/whatsapp-dispatch-worker';
import {
  JOB_NAMES,
  type WhatsAppDispatchJob,
} from '@shopee-auto-affiliate-ai/queue';
import {
  fingerprintWhatsAppGroupId,
  WhatsAppSendError,
  type WhatsAppProvider,
} from '@shopee-auto-affiliate-ai/providers';
import type { CommercialMessageDraftService } from '../../api/src/commercial-message-draft-service';
import { AppError } from '@shopee-auto-affiliate-ai/shared';
import type { Job } from 'bullmq';
import type { WhatsAppDispatchDetails } from '../../api/src/repositories';
import type {
  CommercialAutomationExecutionRecord,
  CommercialPipelineRunRecord,
} from '../../api/src/repositories';
import { fingerprintCommercialOffer } from '../../api/src/commercial-offer-snapshot';
import {
  COMMERCIAL_AI_COPY_PROMPT_VERSION,
  COMMERCIAL_AI_COPY_VALIDATION_VERSION,
} from '../../api/src/commercial-ai-copy-prompt';
import { WhatsAppGroupSendPolicy } from '../../api/src/whatsapp-group-send-policy';
import {
  createR8OneShotAuthorizationFence,
  r8DestinationSha256,
  r8MessagePayloadSha256,
  type R8OneShotAuthorizationManifest,
} from '../src/r8-one-shot-authorization-fence';

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
  assignedInstanceName: 'instance',
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
const commercialGroupFingerprint =
  fingerprintWhatsAppGroupId(commercialGroupId);
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
  instanceName: 'instance',
  destination: {
    id: 'dest-commercial',
    name: 'Commercial group',
    destination: commercialGroupId,
    type: 'GROUP',
    active: true,
    available: true,
    fingerprint: commercialGroupFingerprint,
    sourceInstanceName: 'instance',
    assignedInstanceName: 'instance',
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

const handoffNow = new Date('2026-08-14T12:00:00.000Z');
const handoffLeaseMilliseconds = 120_000;

const r8AuthorizationManifest = (
  overrides: Partial<R8OneShotAuthorizationManifest> = {},
): R8OneShotAuthorizationManifest => ({
  authorizationId: 'r8-authorization-test',
  authorized: true,
  approvedAt: '2026-08-14T11:59:00.000Z',
  expiresAt: '2026-08-14T12:01:00.000Z',
  candidateHead: 'candidate-head',
  candidateTree: 'candidate-tree',
  jobId: 'job-handoff',
  dispatchId: 'dispatch-handoff',
  targetFingerprint: commercialGroupFingerprint,
  destinationSha256: r8DestinationSha256(commercialGroupId),
  instanceName: 'instance',
  assignmentRevision: 7,
  campaignId: 'campaign-1',
  productId: 'prod-123',
  candidateId: 'candidate-123',
  snapshotId: 'snap-123',
  snapshotRevision: 1,
  generatedCopyId: 'copy-123',
  deliveryMode: 'IMAGE',
  messagePayloadSha256: r8MessagePayloadSha256({
    deliveryMode: 'IMAGE',
    message: `Title\n\nMessage\n\nBuy now ${commercialAffiliateLink}\n\n#sale`,
    imageUrl: 'https://shopee.com.br/image.jpg',
  }),
  maxWhatsAppSend: 1,
  maxEvolutionHttpRequests: 4,
  allowWebhookReadinessSync: true,
  allowSingleDispatchLifecycleWrites: true,
  ...overrides,
});

const commercialRunForHandoff = (): CommercialPipelineRunRecord => ({
  id: 'run-handoff',
  mode: 'CONFIRMED',
  status: 'STARTED',
  executionId: 'execution-handoff',
  instanceName: 'instance',
  productId: 'prod-123',
  groupDestinationId: 'dest-commercial',
  productName: 'Test',
  productPrice: '10',
  groupName: 'Commercial group',
  groupFingerprint: commercialGroupFingerprint,
  score: 90,
  scorePolicyVersion: 'official-v2',
  minimumScoreUsed: 60,
  maximumScoreObserved: 90,
  selectedScoreBreakdown: null,
  candidateCount: 1,
  eligibleCount: 1,
  rejectedCount: 0,
  rejectionSummary: {},
  selectionReasons: ['test'],
  plannedSubIds: [],
  dispatchId: 'dispatch-handoff',
  jobId: 'job-handoff',
  confirmedAt: handoffNow,
  finalStatus: 'PENDING',
  investigationRequired: false,
  failureCode: null,
  createdAt: handoffNow,
  completedAt: handoffNow,
});

const executionForHandoff = (): CommercialAutomationExecutionRecord => ({
  id: 'execution-handoff',
  schedulerJobId: 'scheduler-handoff',
  bullMqJobId: 'automation-job-handoff',
  activeKey: null,
  ownerId: 'owner-handoff',
  heartbeatAt: handoffNow,
  leaseExpiresAt: new Date(handoffNow.getTime() + handoffLeaseMilliseconds),
  mode: 'SEND',
  status: 'QUEUED',
  externalStage: 'EXTERNAL_MAY_HAVE_STARTED',
  reasons: [],
  commercialRunId: 'run-handoff',
  failureCode: null,
  startedAt: handoffNow,
  completedAt: handoffNow,
});

const createHandoffRepositories = (input: {
  dispatch: WhatsAppDispatchDetails;
  run?: CommercialPipelineRunRecord;
  execution?: CommercialAutomationExecutionRecord | null;
  renewal?: {
    kind: 'RENEWED' | 'CONFLICT';
    renewed?: boolean;
  };
  context?: {
    kind: 'FOUND';
    candidateId: string;
    campaignId: string;
    attemptExecutionId: string;
  };
  instanceName?: string;
  events?: string[];
}) => {
  const events = input.events ?? [];
  const run = input.run ?? commercialRunForHandoff();
  const instanceName = input.instanceName ?? run.instanceName ?? 'instance';
  const context = input.context ?? {
    kind: 'FOUND' as const,
    candidateId: 'candidate-123',
    campaignId: 'campaign-1',
    attemptExecutionId: run.executionId ?? 'execution-handoff',
  };
  const renewAttempt = vi.fn(async () => {
    events.push('renew');
    if (input.renewal?.kind === 'CONFLICT') {
      return {
        kind: 'CONFLICT' as const,
        campaignId: context.campaignId,
        executionId: run.executionId ?? 'execution-handoff',
      };
    }
    return {
      kind: 'RENEWED' as const,
      campaignId: context.campaignId,
      executionId: run.executionId ?? 'execution-handoff',
      leaseExpiresAt: new Date(handoffNow.getTime() + handoffLeaseMilliseconds),
      renewed: input.renewal?.renewed ?? true,
    };
  });
  const markAttemptPending = vi.fn(async () => {
    events.push('mark');
    return true;
  });
  const repositories: WhatsAppDispatchProcessorRepositories = {
    whatsappDispatches: {
      findByIdWithDetails: vi.fn().mockResolvedValue(input.dispatch),
      findByIdForSending: vi.fn().mockResolvedValue(input.dispatch),
      markAttemptPending,
      claimPendingForSending: vi.fn(async () =>
        (await markAttemptPending())
          ? { kind: 'CLAIMED' as const }
          : { kind: 'NOT_PENDING' as const },
      ),
      markSubmitted: vi.fn().mockResolvedValue({
        ...input.dispatch,
        status: 'SUBMITTED',
        attemptCount: 1,
      }),
      markFailed: vi.fn(),
      applyDeliveryEvent: vi.fn(async () => ({ kind: 'NOT_FOUND' as const })),
      expireSubmittedConfirmations: vi.fn(async () => []),
      createPending: vi.fn(),
      list: vi.fn(),
    },
    commercialRuns: {
      create: vi.fn(),
      update: vi.fn(),
      list: vi.fn(),
      findById: vi.fn(),
      findByExecutionId: vi.fn(),
      findByDispatchId: vi.fn().mockResolvedValue(run),
      finalizeByDispatchId: vi.fn().mockResolvedValue({
        kind: 'SENT',
        transitioned: true,
      }),
    },
    commercialAutomationExecutions: {
      findById: vi
        .fn()
        .mockResolvedValue(
          input.execution === undefined
            ? executionForHandoff()
            : input.execution,
        ),
    },
    commercialGroupCampaigns: { renewAttempt },
    commercialDispatchOutboxes: {
      findByDispatchId: vi.fn().mockResolvedValue({
        id: `outbox-${input.dispatch.id}`,
        commercialRunId: run.id,
        dispatchId: input.dispatch.id,
        jobId: `job-${input.dispatch.id}`,
        instanceName,
        status: 'PUBLISHED',
        failureCode: null,
        createdAt: handoffNow,
        publishedAt: handoffNow,
      }),
    },
    whatsappInstances: {
      findByName: vi.fn().mockResolvedValue({
        name: instanceName,
        active: true,
        createdAt: handoffNow,
        updatedAt: handoffNow,
      }),
    },
    commercialPromotions: {
      findAttemptContextByGeneratedCopyId: vi.fn().mockResolvedValue(context),
      markDispatchedByGeneratedCopyId: vi.fn().mockResolvedValue({
        kind: 'DISPATCHED',
        candidateId: 'candidate-123',
        campaignId: 'campaign-1',
        transitioned: true,
      }),
      markBlockedByGeneratedCopyId: vi.fn().mockResolvedValue({
        kind: 'BLOCKED',
        candidateId: 'candidate-123',
        transitioned: true,
      }),
      resetCampaignFailureStateByGeneratedCopyId: vi.fn().mockResolvedValue({
        kind: 'RESET',
        campaignId: 'campaign-1',
        transitioned: true,
      }),
      releaseAttempt: vi.fn().mockResolvedValue({
        kind: 'RELEASED',
        campaignId: context.campaignId,
        executionId: run.executionId ?? 'execution-handoff',
        released: true,
      }),
    },
  };
  return { repositories, renewAttempt, markAttemptPending, events };
};
describe('processWhatsAppDispatchJob', () => {
  it('rejeita dispatch antes do provider quando o processor esta em preview', async () => {
    const provider: WhatsAppProvider = {
      sendMessage: vi.fn(async () => ({
        status: 'sent' as const,
        externalMessageId: 'must-not-send',
        sentAt: handoffNow,
      })),
    };
    const logger = { info: vi.fn(), error: vi.fn() };

    await expect(
      processWhatsAppDispatchJob(
        {
          id: 'preview-job',
          name: JOB_NAMES.whatsappDispatch,
          data: { dispatchId: 'preview-dispatch' },
          opts: { attempts: 1 },
        },
        {
          prisma: {} as never,
          commercialAutomationMode: 'preview',
          whatsAppProvider: provider,
          logger,
        },
      ),
    ).rejects.toMatchObject({ name: 'UnrecoverableError' });

    expect(provider.sendMessage).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'commercial-dispatch.preview-fence-rejected',
        providerCallAllowed: false,
      }),
      expect.any(String),
    );
  });

  it('bloqueia um job comercial configurado com mais de uma tentativa antes do provider', async () => {
    const provider: WhatsAppProvider = {
      sendMessage: vi.fn(async () => ({
        status: 'sent' as const,
        externalMessageId: 'should-not-send',
        sentAt: handoffNow,
      })),
    };
    const { repositories } = createHandoffRepositories({
      dispatch: commercialDispatch,
    });

    await expect(
      processWhatsAppDispatchJob(
        {
          id: 'job-with-retries',
          name: JOB_NAMES.whatsappDispatch,
          data: { dispatchId: commercialDispatch.id },
          opts: { attempts: 3 },
        },
        {
          repositories,
          whatsAppProvider: provider,
          logger: { info: vi.fn(), error: vi.fn() },
          groupSendPolicy: commercialGroupSendPolicy(),
          draftService: {
            createDraft: vi.fn(),
          },
        },
      ),
    ).rejects.toMatchObject({ name: 'UnrecoverableError' });

    expect(provider.sendMessage).not.toHaveBeenCalled();
    expect(repositories.commercialRuns.findByDispatchId).toHaveBeenCalledOnce();
    expect(
      repositories.whatsappDispatches.markAttemptPending,
    ).not.toHaveBeenCalled();
  });

  it('mantem um unico processamento quando dois consumers disputam o mesmo job comercial', async () => {
    const fixture = createHandoffRepositories({ dispatch: commercialDispatch });
    let currentDispatch: WhatsAppDispatchDetails = commercialDispatch;
    const markAttemptPending = vi.fn(async () => {
      if (
        currentDispatch.status !== 'PENDING' ||
        currentDispatch.attemptCount !== 0
      ) {
        return false;
      }
      currentDispatch = {
        ...currentDispatch,
        status: 'PROCESSING',
        attemptCount: 1,
      };
      return true;
    });
    const markSubmitted = vi.fn(
      async (
        _dispatchId: string,
        input: {
          externalMessageId: string;
          submittedAt: Date;
          confirmationDeadlineAt: Date;
        },
      ) => {
        currentDispatch = {
          ...currentDispatch,
          status: 'SUBMITTED',
          externalMessageId: input.externalMessageId,
          submittedAt: input.submittedAt,
          confirmationDeadlineAt: input.confirmationDeadlineAt,
        };
        return currentDispatch;
      },
    );
    fixture.repositories.whatsappDispatches.findByIdForSending = vi.fn(
      async () => currentDispatch,
    );
    fixture.repositories.whatsappDispatches.findByIdWithDetails = vi.fn(
      async () => currentDispatch,
    );
    fixture.repositories.whatsappDispatches.markAttemptPending =
      markAttemptPending;
    fixture.repositories.whatsappDispatches.claimPendingForSending = vi.fn(
      async () =>
        (await markAttemptPending())
          ? { kind: 'CLAIMED' as const }
          : { kind: 'NOT_PENDING' as const },
    );
    fixture.repositories.whatsappDispatches.markSubmitted = markSubmitted;
    const provider: WhatsAppProvider = {
      beginRun: vi.fn(),
      sendMessage: vi.fn(async () => ({
        status: 'sent' as const,
        externalMessageId: 'external-single-processing',
        sentAt: handoffNow,
      })),
    };
    const options = {
      repositories: fixture.repositories,
      whatsAppProvider: provider,
      whatsAppProviderResolver: vi.fn().mockResolvedValue(provider),
      logger: { info: vi.fn(), error: vi.fn() },
      groupSendPolicy: commercialGroupSendPolicy(),
      draftService: {
        createDraft: vi.fn().mockReturnValue({
          candidateId: 'candidate-123',
          generatedCopyId: 'copy-123',
          caption: 'draft text',
          deliveryMode: 'TEXT',
          warnings: [],
        }),
      },
      clock: () => handoffNow,
      reservationLeaseMilliseconds: handoffLeaseMilliseconds,
    };

    const results = await Promise.allSettled([
      processWhatsAppDispatchJob(
        {
          id: 'consumer-a-job',
          name: JOB_NAMES.whatsappDispatch,
          data: { dispatchId: commercialDispatch.id, instanceName: 'instance' },
          opts: { attempts: 1 },
        },
        options,
      ),
      processWhatsAppDispatchJob(
        {
          id: 'consumer-b-job',
          name: JOB_NAMES.whatsappDispatch,
          data: { dispatchId: commercialDispatch.id, instanceName: 'instance' },
          opts: { attempts: 1 },
        },
        options,
      ),
    ]);

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect(provider.sendMessage).toHaveBeenCalledOnce();
    expect(markAttemptPending).toHaveBeenCalledTimes(2);
    expect(markSubmitted).toHaveBeenCalledOnce();
    expect(currentDispatch).toMatchObject({
      status: 'SUBMITTED',
      attemptCount: 1,
      externalMessageId: 'external-single-processing',
    });
  });

  it('inicia runs deterministicas para dois jobs GROUP no mesmo provider', async () => {
    const groupId = '120363000000000000@g.us';
    const destination = {
      ...fakeDestination,
      destination: groupId,
      type: 'GROUP' as const,
      fingerprint: fingerprintWhatsAppGroupId(groupId),
      assignedInstanceName: 'instance',
    };
    const dispatches = ['dispatch-a', 'dispatch-b'].map((id) => ({
      ...fakeDispatch,
      id,
      instanceName: 'instance',
      destination,
    }));
    const createRepositories = (
      dispatch: WhatsAppDispatchDetails,
    ): WhatsAppDispatchProcessorRepositories => ({
      whatsappDispatches: {
        findByIdWithDetails: vi.fn().mockResolvedValue(dispatch),
        markAttemptPending: vi.fn().mockResolvedValue(true),
        claimPendingForSending: vi.fn().mockResolvedValue({ kind: 'CLAIMED' }),
        markSubmitted: vi.fn().mockResolvedValue({ ...dispatch, status: 'SUBMITTED' }),
        createPending: vi.fn(),
        findByIdForSending: vi.fn().mockResolvedValue(dispatch),
        list: vi.fn(),
        markFailed: vi.fn(),
        applyDeliveryEvent: vi.fn(async () => ({ kind: 'NOT_FOUND' as const })),
        expireSubmittedConfirmations: vi.fn(async () => []),
      },
      commercialRuns: {
        create: vi.fn(),
        update: vi.fn(),
        list: vi.fn(),
        findById: vi.fn(),
        findByExecutionId: vi.fn(),
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

  it('resolve providers A/B no mesmo worker sem cruzar lifecycles sticky', async () => {
    const createLifecycle = (instanceName: string, suffix: string) => {
      const destinationId = `dest-${suffix}`;
      const groupId =
        suffix === 'a' ? '120363000000000001@g.us' : '120363000000000002@g.us';
      const dispatch = {
        ...commercialDispatch,
        id: `dispatch-${suffix}`,
        destinationId,
        instanceName,
        destination: {
          ...commercialDispatch.destination,
          id: destinationId,
          destination: groupId,
          fingerprint: fingerprintWhatsAppGroupId(groupId),
          sourceInstanceName: instanceName,
          assignedInstanceName: instanceName,
        },
        generatedCopy: {
          ...commercialDispatch.generatedCopy,
          promotionCandidates:
            commercialDispatch.generatedCopy.promotionCandidates?.map(
              (candidate) => ({
                ...candidate,
                campaign: {
                  ...candidate.campaign,
                  logicalGroupFingerprint: fingerprintWhatsAppGroupId(groupId),
                },
              }),
            ),
        },
      } satisfies WhatsAppDispatchDetails;
      const run = {
        ...commercialRunForHandoff(),
        id: `run-${suffix}`,
        executionId: `execution-${suffix}`,
        instanceName,
        groupDestinationId: destinationId,
        dispatchId: dispatch.id,
        jobId: `job-${suffix}`,
      } satisfies CommercialPipelineRunRecord;
      const execution = {
        ...executionForHandoff(),
        id: run.executionId!,
        commercialRunId: run.id,
      } satisfies CommercialAutomationExecutionRecord;
      const fixture = createHandoffRepositories({
        dispatch,
        run,
        execution,
        instanceName,
        context: {
          kind: 'FOUND',
          candidateId: 'candidate-123',
          campaignId: `campaign-${suffix}`,
          attemptExecutionId: run.executionId!,
        },
      });
      return { ...fixture, dispatch, run };
    };

    const lifecycleA = createLifecycle('instance-a', 'a');
    const lifecycleB = createLifecycle('instance-b', 'b');
    const providerA: WhatsAppProvider = {
      beginRun: vi.fn(),
      sendMessage: vi.fn().mockResolvedValue({
        status: 'sent' as const,
        externalMessageId: 'external-a',
        sentAt: handoffNow,
      }),
    };
    const providerB: WhatsAppProvider = {
      beginRun: vi.fn(),
      sendMessage: vi.fn().mockResolvedValue({
        status: 'sent' as const,
        externalMessageId: 'external-b',
        sentAt: handoffNow,
      }),
    };
    const resolver = vi.fn((instanceName: string) => {
      if (instanceName === 'instance-a') return providerA;
      if (instanceName === 'instance-b') return providerB;
      throw new Error(`unexpected instance ${instanceName}`);
    });
    const draftService: Pick<CommercialMessageDraftService, 'createDraft'> = {
      createDraft: vi.fn().mockReturnValue({
        candidateId: 'candidate-123',
        generatedCopyId: 'copy-123',
        caption: 'draft text',
        deliveryMode: 'TEXT',
        warnings: [],
      }),
    };
    const globalPolicy = new WhatsAppGroupSendPolicy({
      enabled: true,
      safeMode: true,
      instanceName: 'instance-b',
    });
    const options = (fixture: ReturnType<typeof createLifecycle>) => ({
      repositories: fixture.repositories,
      whatsAppProvider: providerB,
      whatsAppProviderResolver: resolver,
      logger: { info: vi.fn(), error: vi.fn() },
      groupSendPolicy: globalPolicy,
      draftService,
      clock: () => handoffNow,
      reservationLeaseMilliseconds: handoffLeaseMilliseconds,
    });

    await processWhatsAppDispatchJob(
      {
        id: 'job-a',
        name: JOB_NAMES.whatsappDispatch,
        data: {
          dispatchId: lifecycleA.dispatch.id,
          instanceName: 'instance-a',
        },
      },
      options(lifecycleA),
    );
    await processWhatsAppDispatchJob(
      {
        id: 'job-b',
        name: JOB_NAMES.whatsappDispatch,
        data: {
          dispatchId: lifecycleB.dispatch.id,
          instanceName: 'instance-b',
        },
      },
      options(lifecycleB),
    );

    expect(resolver).toHaveBeenNthCalledWith(1, 'instance-a');
    expect(resolver).toHaveBeenNthCalledWith(2, 'instance-b');
    expect(resolver).toHaveBeenCalledTimes(2);
    expect(providerA.sendMessage).toHaveBeenCalledOnce();
    expect(providerB.sendMessage).toHaveBeenCalledOnce();
    expect(providerA.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        destination: lifecycleA.dispatch.destination.destination,
      }),
    );
    expect(providerB.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        destination: lifecycleB.dispatch.destination.destination,
      }),
    );
    expect(providerA.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({
        destination: lifecycleB.dispatch.destination.destination,
      }),
    );
    expect(providerB.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({
        destination: lifecycleA.dispatch.destination.destination,
      }),
    );
    expect(
      lifecycleA.repositories.whatsappDispatches.markSubmitted,
    ).toHaveBeenCalledOnce();
    expect(
      lifecycleB.repositories.whatsappDispatches.markSubmitted,
    ).toHaveBeenCalledOnce();
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
        claimPendingForSending: vi.fn().mockResolvedValue({ kind: 'CLAIMED' }),
        markSubmitted: vi.fn().mockResolvedValue({ ...fakeDispatch, status: 'SUBMITTED' }),
        createPending: vi.fn(),
        findByIdForSending: vi.fn().mockResolvedValue(fakeDispatch),
        list: vi.fn(),
        markFailed: vi.fn(),
        applyDeliveryEvent: vi.fn(async () => ({ kind: 'NOT_FOUND' as const })),
        expireSubmittedConfirmations: vi.fn(async () => []),
      },
      commercialRuns: {
        create: vi.fn(),
        update: vi.fn(),
        list: vi.fn(),
        findById: vi.fn(),
        findByExecutionId: vi.fn(),
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
    const markSubmitted = vi.fn().mockResolvedValue({
      ...commercialDispatch,
      status: 'SUBMITTED',
    });
    const findByIdWithDetails = vi.fn().mockResolvedValue(commercialDispatch);

    const repositories: WhatsAppDispatchProcessorRepositories = {
      whatsappDispatches: {
        findByIdWithDetails,
        markAttemptPending,
        claimPendingForSending: vi.fn(async () =>
          (await markAttemptPending())
            ? { kind: 'CLAIMED' as const }
            : { kind: 'NOT_PENDING' as const },
        ),
        markSubmitted,
        createPending: vi.fn(),
        findByIdForSending: vi.fn().mockResolvedValue(commercialDispatch),
        list: vi.fn(),
        markFailed: vi.fn(),
        applyDeliveryEvent: vi.fn(async () => ({ kind: 'NOT_FOUND' as const })),
        expireSubmittedConfirmations: vi.fn(async () => []),
      },
      commercialRuns: {
        create: vi.fn(),
        update: vi.fn(),
        list: vi.fn(),
        findById: vi.fn(),
        findByExecutionId: vi.fn(),
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
        markSubmitted: vi.fn(),
        createPending: vi.fn(),
        findByIdForSending: vi.fn().mockResolvedValue(commercialDispatch),
        list: vi.fn(),
        applyDeliveryEvent: vi.fn(async () => ({ kind: 'NOT_FOUND' as const })),
        expireSubmittedConfirmations: vi.fn(async () => []),
      },
      commercialRuns: {
        create: vi.fn(),
        update: vi.fn(),
        list: vi.fn(),
        findById: vi.fn(),
        findByExecutionId: vi.fn(),
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
      }),
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
        markSubmitted: vi.fn(),
        createPending: vi.fn(),
        findByIdForSending,
        list: vi.fn(),
        markFailed: vi.fn(),
        applyDeliveryEvent: vi.fn(async () => ({ kind: 'NOT_FOUND' as const })),
        expireSubmittedConfirmations: vi.fn(async () => []),
      },
      commercialRuns: {
        create: vi.fn(),
        update: vi.fn(),
        list: vi.fn(),
        findById: vi.fn(),
        findByExecutionId: vi.fn(),
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

  it('renova a reservation antes de beginRun e do provider para um lifecycle comercial', async () => {
    const events: string[] = [];
    const dispatch = {
      ...commercialDispatch,
      id: 'dispatch-handoff',
      generatedCopy: {
        ...commercialDispatch.generatedCopy,
        createdFromCandidateId: 'candidate-123',
      },
    };
    const { repositories, renewAttempt, markAttemptPending } =
      createHandoffRepositories({ dispatch, events });
    const provider: WhatsAppProvider = {
      beginRun: vi.fn(() => events.push('begin')),
      sendMessage: vi.fn(async () => {
        events.push('send');
        return {
          status: 'sent' as const,
          externalMessageId: 'external-handoff',
          sentAt: handoffNow,
        };
      }),
    };

    await processWhatsAppDispatchJob(
      {
        id: 'job-handoff',
        name: JOB_NAMES.whatsappDispatch,
        data: { dispatchId: 'dispatch-handoff', instanceName: 'instance' },
      },
      {
        repositories,
        whatsAppProvider: provider,
        whatsAppProviderResolver: vi.fn().mockResolvedValue(provider),
        logger: { info: vi.fn(), error: vi.fn() },
        groupSendPolicy: commercialGroupSendPolicy(),
        draftService: {
          createDraft: vi.fn().mockReturnValue({
            candidateId: 'candidate-123',
            generatedCopyId: 'copy-123',
            caption: 'draft text',
            deliveryMode: 'TEXT',
            warnings: [],
          }),
        },
        clock: () => handoffNow,
        reservationLeaseMilliseconds: handoffLeaseMilliseconds,
      },
    );

    expect(events).toEqual(['renew', 'begin', 'mark', 'send']);
    expect(renewAttempt).toHaveBeenCalledWith({
      campaignId: 'campaign-1',
      executionId: 'execution-handoff',
      renewedAt: handoffNow,
      leaseExpiresAt: new Date(handoffNow.getTime() + handoffLeaseMilliseconds),
    });
    expect(markAttemptPending).toHaveBeenCalledOnce();
    expect(provider.sendMessage).toHaveBeenCalledOnce();
  });

  it('permite renew idempotente do mesmo owner e bloqueia conflito sem iniciar provider', async () => {
    const dispatch = {
      ...commercialDispatch,
      id: 'dispatch-handoff',
      generatedCopy: {
        ...commercialDispatch.generatedCopy,
        createdFromCandidateId: 'candidate-123',
      },
    };
    const idempotent = createHandoffRepositories({
      dispatch,
      renewal: { kind: 'RENEWED', renewed: false },
    });
    const provider = {
      beginRun: vi.fn(),
      sendMessage: vi.fn().mockResolvedValue({
        status: 'sent' as const,
        externalMessageId: 'external-handoff',
        sentAt: handoffNow,
      }),
    } satisfies WhatsAppProvider;

    await processWhatsAppDispatchJob(
      {
        id: 'job-handoff',
        name: JOB_NAMES.whatsappDispatch,
        data: { dispatchId: 'dispatch-handoff', instanceName: 'instance' },
      },
      {
        repositories: idempotent.repositories,
        whatsAppProvider: provider,
        whatsAppProviderResolver: vi.fn().mockResolvedValue(provider),
        logger: { info: vi.fn(), error: vi.fn() },
        groupSendPolicy: commercialGroupSendPolicy(),
        draftService: {
          createDraft: vi.fn().mockReturnValue({
            candidateId: 'candidate-123',
            generatedCopyId: 'copy-123',
            caption: 'draft text',
            deliveryMode: 'TEXT',
            warnings: [],
          }),
        },
        clock: () => handoffNow,
        reservationLeaseMilliseconds: handoffLeaseMilliseconds,
      },
    );
    expect(provider.sendMessage).toHaveBeenCalledOnce();

    const conflict = createHandoffRepositories({
      dispatch,
      renewal: { kind: 'CONFLICT' },
    });
    const blockedProvider: WhatsAppProvider = {
      beginRun: vi.fn(),
      sendMessage: vi.fn(),
    };
    await expect(
      processWhatsAppDispatchJob(
        {
          id: 'job-handoff',
          name: JOB_NAMES.whatsappDispatch,
          data: { dispatchId: 'dispatch-handoff', instanceName: 'instance' },
        },
        {
          repositories: conflict.repositories,
          whatsAppProvider: blockedProvider,
          whatsAppProviderResolver: vi.fn().mockResolvedValue(blockedProvider),
          logger: { info: vi.fn(), error: vi.fn() },
          clock: () => handoffNow,
          reservationLeaseMilliseconds: handoffLeaseMilliseconds,
        },
      ),
    ).rejects.toMatchObject({
      code: 'COMMERCIAL_DISPATCH_RESERVATION_CONFLICT',
    });
    expect(blockedProvider.beginRun).not.toHaveBeenCalled();
    expect(blockedProvider.sendMessage).not.toHaveBeenCalled();
    expect(conflict.markAttemptPending).not.toHaveBeenCalled();
  });

  it('renova e envia quando a execution e a reservation expiraram com o mesmo owner', async () => {
    const dispatch = {
      ...commercialDispatch,
      id: 'dispatch-handoff',
      generatedCopy: {
        ...commercialDispatch.generatedCopy,
        createdFromCandidateId: 'candidate-123',
      },
    };
    const { repositories, renewAttempt, markAttemptPending } =
      createHandoffRepositories({
        dispatch,
        execution: {
          ...executionForHandoff(),
          leaseExpiresAt: new Date(handoffNow.getTime() - 1),
        },
      });
    const provider: WhatsAppProvider = {
      beginRun: vi.fn(),
      sendMessage: vi.fn().mockResolvedValue({
        status: 'sent' as const,
        externalMessageId: 'external-handoff',
        sentAt: handoffNow,
      }),
    };

    await processWhatsAppDispatchJob(
      {
        id: 'job-handoff',
        name: JOB_NAMES.whatsappDispatch,
        data: { dispatchId: 'dispatch-handoff', instanceName: 'instance' },
      },
      {
        repositories,
        whatsAppProvider: provider,
        whatsAppProviderResolver: vi.fn().mockResolvedValue(provider),
        logger: { info: vi.fn(), error: vi.fn() },
        clock: () => handoffNow,
        reservationLeaseMilliseconds: handoffLeaseMilliseconds,
        groupSendPolicy: commercialGroupSendPolicy(),
        draftService: {
          createDraft: vi.fn().mockReturnValue({
            candidateId: 'candidate-123',
            generatedCopyId: 'copy-123',
            caption: 'draft text',
            deliveryMode: 'TEXT',
            warnings: [],
          }),
        },
      },
    );
    expect(renewAttempt).toHaveBeenCalledOnce();
    expect(markAttemptPending).toHaveBeenCalledOnce();
    expect(provider.sendMessage).toHaveBeenCalledOnce();
  });

  it('bloqueia sem renovar quando execution e run nao estao vinculados', async () => {
    const dispatch = {
      ...commercialDispatch,
      id: 'dispatch-handoff',
      generatedCopy: {
        ...commercialDispatch.generatedCopy,
        createdFromCandidateId: 'candidate-123',
      },
    };
    const run = {
      ...commercialRunForHandoff(),
      executionId: 'execution-other',
    };
    const { repositories, renewAttempt } = createHandoffRepositories({
      dispatch,
      run,
    });
    const provider: WhatsAppProvider = {
      beginRun: vi.fn(),
      sendMessage: vi.fn(),
    };

    await expect(
      processWhatsAppDispatchJob(
        {
          id: 'job-handoff',
          name: JOB_NAMES.whatsappDispatch,
          data: { dispatchId: 'dispatch-handoff', instanceName: 'instance' },
        },
        {
          repositories,
          whatsAppProvider: provider,
          whatsAppProviderResolver: vi.fn().mockResolvedValue(provider),
          logger: { info: vi.fn(), error: vi.fn() },
          clock: () => handoffNow,
          reservationLeaseMilliseconds: handoffLeaseMilliseconds,
        },
      ),
    ).rejects.toMatchObject({
      code: 'COMMERCIAL_DISPATCH_EXECUTION_OWNERSHIP_INVALID',
    });
    expect(renewAttempt).not.toHaveBeenCalled();
    expect(provider.beginRun).not.toHaveBeenCalled();
    expect(provider.sendMessage).not.toHaveBeenCalled();
  });

  it('bloqueia quando o candidate/copy nao pertence a mesma execution', async () => {
    const dispatch = {
      ...commercialDispatch,
      id: 'dispatch-handoff',
      generatedCopy: {
        ...commercialDispatch.generatedCopy,
        createdFromCandidateId: 'candidate-123',
      },
    };
    const { repositories, renewAttempt } = createHandoffRepositories({
      dispatch,
      context: {
        kind: 'FOUND',
        candidateId: 'candidate-123',
        campaignId: 'campaign-1',
        attemptExecutionId: 'execution-other',
      },
    });
    const provider: WhatsAppProvider = {
      beginRun: vi.fn(),
      sendMessage: vi.fn(),
    };

    await expect(
      processWhatsAppDispatchJob(
        {
          id: 'job-handoff',
          name: JOB_NAMES.whatsappDispatch,
          data: { dispatchId: 'dispatch-handoff', instanceName: 'instance' },
        },
        {
          repositories,
          whatsAppProvider: provider,
          whatsAppProviderResolver: vi.fn().mockResolvedValue(provider),
          logger: { info: vi.fn(), error: vi.fn() },
          clock: () => handoffNow,
          reservationLeaseMilliseconds: handoffLeaseMilliseconds,
        },
      ),
    ).rejects.toMatchObject({
      code: 'COMMERCIAL_DISPATCH_RESERVATION_OWNERSHIP_CONFLICT',
    });
    expect(renewAttempt).not.toHaveBeenCalled();
    expect(provider.beginRun).not.toHaveBeenCalled();
    expect(provider.sendMessage).not.toHaveBeenCalled();
  });

  it('falha fechado quando o grupo foi reassociado depois do nascimento do run', async () => {
    const baseDispatch = { ...commercialDispatch, id: 'dispatch-handoff' };
    const dispatch = {
      ...baseDispatch,
      destination: {
        ...baseDispatch.destination,
        assignedInstanceName: 'instance-b',
      },
    };
    const { repositories, renewAttempt } = createHandoffRepositories({
      dispatch,
    });
    const provider: WhatsAppProvider = {
      beginRun: vi.fn(),
      sendMessage: vi.fn(),
    };

    await expect(
      processWhatsAppDispatchJob(
        {
          id: 'job-handoff',
          name: JOB_NAMES.whatsappDispatch,
          data: { dispatchId: 'dispatch-handoff', instanceName: 'instance' },
        },
        {
          repositories,
          whatsAppProvider: provider,
          whatsAppProviderResolver: vi.fn().mockResolvedValue(provider),
          logger: { info: vi.fn(), error: vi.fn() },
          clock: () => handoffNow,
          reservationLeaseMilliseconds: handoffLeaseMilliseconds,
        },
      ),
    ).rejects.toMatchObject({
      code: 'COMMERCIAL_INSTANCE_ASSIGNMENT_CHANGED',
    });
    expect(renewAttempt).not.toHaveBeenCalled();
    expect(provider.beginRun).not.toHaveBeenCalled();
    expect(provider.sendMessage).not.toHaveBeenCalled();
  });

  it('bloqueia antes do provider quando a instancia persistida esta inativa', async () => {
    const dispatch = { ...commercialDispatch, id: 'dispatch-handoff' };
    const { repositories, renewAttempt } = createHandoffRepositories({
      dispatch,
    });
    repositories.whatsappInstances = {
      findByName: vi.fn().mockResolvedValue({
        name: 'instance',
        active: false,
        createdAt: handoffNow,
        updatedAt: handoffNow,
      }),
    };
    const provider: WhatsAppProvider = {
      beginRun: vi.fn(),
      sendMessage: vi.fn(),
    };

    await expect(
      processWhatsAppDispatchJob(
        {
          id: 'job-handoff',
          name: JOB_NAMES.whatsappDispatch,
          data: { dispatchId: 'dispatch-handoff', instanceName: 'instance' },
        },
        {
          repositories,
          whatsAppProvider: provider,
          whatsAppProviderResolver: vi.fn().mockResolvedValue(provider),
          logger: { info: vi.fn(), error: vi.fn() },
          clock: () => handoffNow,
          reservationLeaseMilliseconds: handoffLeaseMilliseconds,
        },
      ),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_INSTANCE_INACTIVE' });
    expect(renewAttempt).not.toHaveBeenCalled();
    expect(provider.sendMessage).not.toHaveBeenCalled();
  });

  it('revalida a instancia imediatamente antes do provider', async () => {
    const dispatch = { ...commercialDispatch, id: 'dispatch-handoff' };
    const { repositories, renewAttempt } = createHandoffRepositories({
      dispatch,
    });
    const findByName = vi
      .fn()
      .mockResolvedValueOnce({
        name: 'instance',
        active: true,
        createdAt: handoffNow,
        updatedAt: handoffNow,
      })
      .mockResolvedValueOnce({
        name: 'instance',
        active: false,
        createdAt: handoffNow,
        updatedAt: handoffNow,
      });
    repositories.whatsappInstances = { findByName };
    const provider: WhatsAppProvider = {
      beginRun: vi.fn(),
      sendMessage: vi.fn(),
    };

    await expect(
      processWhatsAppDispatchJob(
        {
          id: 'job-handoff',
          name: JOB_NAMES.whatsappDispatch,
          data: { dispatchId: 'dispatch-handoff', instanceName: 'instance' },
        },
        {
          repositories,
          whatsAppProvider: provider,
          whatsAppProviderResolver: vi.fn().mockResolvedValue(provider),
          logger: { info: vi.fn(), error: vi.fn() },
          clock: () => handoffNow,
          reservationLeaseMilliseconds: handoffLeaseMilliseconds,
        },
      ),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_INSTANCE_INACTIVE' });
    expect(findByName).toHaveBeenCalledTimes(2);
    expect(renewAttempt).toHaveBeenCalledOnce();
    expect(provider.beginRun).not.toHaveBeenCalled();
    expect(provider.sendMessage).not.toHaveBeenCalled();
  });

  it('bloqueia quando o outbox diverge da identidade persistida do run', async () => {
    const dispatch = { ...commercialDispatch, id: 'dispatch-handoff' };
    const { repositories, renewAttempt } = createHandoffRepositories({
      dispatch,
    });
    repositories.commercialDispatchOutboxes = {
      findByDispatchId: vi.fn().mockResolvedValue({
        id: 'outbox-handoff',
        commercialRunId: 'run-handoff',
        dispatchId: 'dispatch-handoff',
        jobId: 'job-handoff',
        instanceName: 'instance-b',
        status: 'PUBLISHED',
        failureCode: null,
        createdAt: handoffNow,
        publishedAt: handoffNow,
      }),
    };
    const provider: WhatsAppProvider = {
      beginRun: vi.fn(),
      sendMessage: vi.fn(),
    };

    await expect(
      processWhatsAppDispatchJob(
        {
          id: 'job-handoff',
          name: JOB_NAMES.whatsappDispatch,
          data: { dispatchId: 'dispatch-handoff', instanceName: 'instance' },
        },
        {
          repositories,
          whatsAppProvider: provider,
          whatsAppProviderResolver: vi.fn().mockResolvedValue(provider),
          logger: { info: vi.fn(), error: vi.fn() },
          clock: () => handoffNow,
          reservationLeaseMilliseconds: handoffLeaseMilliseconds,
        },
      ),
    ).rejects.toMatchObject({
      code: 'COMMERCIAL_INSTANCE_LIFECYCLE_MISMATCH',
    });
    expect(renewAttempt).not.toHaveBeenCalled();
    expect(provider.beginRun).not.toHaveBeenCalled();
    expect(provider.sendMessage).not.toHaveBeenCalled();
  });

  it('bloqueia quando o job sticky nao possui run associado', async () => {
    const { repositories, renewAttempt } = createHandoffRepositories({
      dispatch: commercialDispatch,
    });
    repositories.commercialRuns.findByDispatchId = vi
      .fn()
      .mockResolvedValue(null);
    const provider: WhatsAppProvider = {
      beginRun: vi.fn(),
      sendMessage: vi.fn(),
    };

    await expect(
      processWhatsAppDispatchJob(
        {
          id: 'job-handoff',
          name: JOB_NAMES.whatsappDispatch,
          data: { dispatchId: 'dispatch-handoff', instanceName: 'instance' },
        },
        {
          repositories,
          whatsAppProvider: provider,
          whatsAppProviderResolver: vi.fn().mockResolvedValue(provider),
          logger: { info: vi.fn(), error: vi.fn() },
          clock: () => handoffNow,
          reservationLeaseMilliseconds: handoffLeaseMilliseconds,
        },
      ),
    ).rejects.toMatchObject({
      code: 'COMMERCIAL_INSTANCE_LIFECYCLE_MISMATCH',
    });
    expect(renewAttempt).not.toHaveBeenCalled();
    expect(provider.beginRun).not.toHaveBeenCalled();
    expect(provider.sendMessage).not.toHaveBeenCalled();
  });

  it('bloqueia quando o outbox pertence a outro run', async () => {
    const { repositories, renewAttempt } = createHandoffRepositories({
      dispatch: commercialDispatch,
    });
    repositories.commercialDispatchOutboxes = {
      findByDispatchId: vi.fn().mockResolvedValue({
        id: 'outbox-handoff',
        commercialRunId: 'run-other',
        dispatchId: 'dispatch-handoff',
        jobId: 'job-handoff',
        instanceName: 'instance',
        status: 'PUBLISHED',
        failureCode: null,
        createdAt: handoffNow,
        publishedAt: handoffNow,
      }),
    };
    const provider: WhatsAppProvider = {
      beginRun: vi.fn(),
      sendMessage: vi.fn(),
    };

    await expect(
      processWhatsAppDispatchJob(
        {
          id: 'job-handoff',
          name: JOB_NAMES.whatsappDispatch,
          data: { dispatchId: 'dispatch-handoff', instanceName: 'instance' },
        },
        {
          repositories,
          whatsAppProvider: provider,
          whatsAppProviderResolver: vi.fn().mockResolvedValue(provider),
          logger: { info: vi.fn(), error: vi.fn() },
          clock: () => handoffNow,
          reservationLeaseMilliseconds: handoffLeaseMilliseconds,
        },
      ),
    ).rejects.toMatchObject({
      code: 'COMMERCIAL_INSTANCE_LIFECYCLE_MISMATCH',
    });
    expect(renewAttempt).not.toHaveBeenCalled();
    expect(provider.beginRun).not.toHaveBeenCalled();
    expect(provider.sendMessage).not.toHaveBeenCalled();
  });

  it('finaliza o lifecycle manual somente depois da finalizacao comercial', async () => {
    const events: string[] = [];
    const dispatch = {
      ...commercialDispatch,
      id: 'dispatch-manual-finalization',
      generatedCopy: {
        ...commercialDispatch.generatedCopy,
        createdFromCandidateId: 'candidate-123',
      },
    };
    const { repositories } = createHandoffRepositories({ dispatch, events });
    const provider: WhatsAppProvider = {
      beginRun: vi.fn(() => events.push('begin')),
      sendMessage: vi.fn(async () => {
        events.push('send');
        return {
          status: 'sent' as const,
          externalMessageId: 'external-manual-finalization',
          sentAt: handoffNow,
        };
      }),
    };
    const manualLifecycleFinalizer = {
      finalizeAfterDispatch: vi.fn(async () => {
        events.push('manual-finalize');
        return {
          outcome: 'FINALIZED' as const,
          requestId: 'manual-request-1',
          targetId: 'manual-target-1',
          targetStatus: 'SENT' as const,
          requestStatus: 'COMPLETED' as const,
          writes: 2,
        };
      }),
    };

    await processWhatsAppDispatchJob(
      {
        id: 'job-manual-finalization',
        name: JOB_NAMES.whatsappDispatch,
        data: { dispatchId: dispatch.id, instanceName: 'instance' },
      },
      {
        repositories,
        whatsAppProvider: provider,
        whatsAppProviderResolver: vi.fn().mockResolvedValue(provider),
        logger: { info: vi.fn(), error: vi.fn() },
        groupSendPolicy: commercialGroupSendPolicy(),
        draftService: {
          createDraft: vi.fn().mockReturnValue({
            candidateId: 'candidate-123',
            generatedCopyId: 'copy-123',
            caption: 'draft text',
            deliveryMode: 'TEXT',
            warnings: [],
          }),
        },
        clock: () => handoffNow,
        reservationLeaseMilliseconds: handoffLeaseMilliseconds,
        manualLifecycleFinalizer,
      },
    );

    expect(events).toEqual(['renew', 'begin', 'mark', 'send']);
    expect(manualLifecycleFinalizer.finalizeAfterDispatch).not.toHaveBeenCalled();
    expect(provider.sendMessage).toHaveBeenCalledOnce();
    expect(repositories.whatsappDispatches.markSubmitted).toHaveBeenCalledOnce();
  });

  it('finaliza lifecycle manual apos falha segura sem repetir o provider', async () => {
    const dispatch = {
      ...commercialDispatch,
      id: 'dispatch-manual-safe-failure',
      generatedCopy: {
        ...commercialDispatch.generatedCopy,
        createdFromCandidateId: 'candidate-123',
      },
    };
    const { repositories } = createHandoffRepositories({ dispatch });
    const provider: WhatsAppProvider = {
      beginRun: vi.fn(),
      sendMessage: vi
        .fn()
        .mockRejectedValue(
          new WhatsAppSendError(
            'blocked before request',
            'WHATSAPP_PROVIDER_BLOCKED',
            { deliveryMayHaveStarted: false },
          ),
        ),
    };
    const manualLifecycleFinalizer = {
      finalizeAfterDispatch: vi.fn().mockResolvedValue({
        outcome: 'FINALIZED' as const,
        requestId: 'manual-request-1',
        targetId: 'manual-target-1',
        targetStatus: 'FAILED' as const,
        requestStatus: 'FAILED' as const,
        writes: 2,
      }),
    };

    await expect(
      processWhatsAppDispatchJob(
        {
          id: 'job-manual-safe-failure',
          name: JOB_NAMES.whatsappDispatch,
          data: { dispatchId: dispatch.id, instanceName: 'instance' },
        },
        {
          repositories,
          whatsAppProvider: provider,
          whatsAppProviderResolver: vi.fn().mockResolvedValue(provider),
          logger: { info: vi.fn(), error: vi.fn() },
          groupSendPolicy: commercialGroupSendPolicy(),
          draftService: {
            createDraft: vi.fn().mockReturnValue({
              candidateId: 'candidate-123',
              generatedCopyId: 'copy-123',
              caption: 'draft text',
              deliveryMode: 'TEXT',
              warnings: [],
            }),
          },
          clock: () => handoffNow,
          reservationLeaseMilliseconds: handoffLeaseMilliseconds,
          manualLifecycleFinalizer,
        },
      ),
    ).rejects.toMatchObject({ code: 'WHATSAPP_PROVIDER_BLOCKED' });

    expect(provider.sendMessage).toHaveBeenCalledOnce();
    expect(repositories.whatsappDispatches.markFailed).toHaveBeenCalledOnce();
    expect(
      repositories.commercialRuns.finalizeByDispatchId,
    ).toHaveBeenCalledOnce();
    expect(
      manualLifecycleFinalizer.finalizeAfterDispatch,
    ).toHaveBeenCalledOnce();
  });

  it('não repete provider quando o finalizer manual falha depois de SENT', async () => {
    const dispatch = {
      ...commercialDispatch,
      id: 'dispatch-manual-finalization-failure',
      generatedCopy: {
        ...commercialDispatch.generatedCopy,
        createdFromCandidateId: 'candidate-123',
      },
    };
    const { repositories } = createHandoffRepositories({ dispatch });
    const provider: WhatsAppProvider = {
      beginRun: vi.fn(),
      sendMessage: vi.fn().mockResolvedValue({
        status: 'sent' as const,
        externalMessageId: 'external-manual-finalization-failure',
        sentAt: handoffNow,
      }),
    };
    const finalizerError = new Error('manual lifecycle unavailable');
    const manualLifecycleFinalizer = {
      finalizeAfterDispatch: vi.fn().mockRejectedValue(finalizerError),
    };
    const logger = { info: vi.fn(), error: vi.fn() };

    await expect(
      processWhatsAppDispatchJob(
        {
          id: 'job-manual-finalization-failure',
          name: JOB_NAMES.whatsappDispatch,
          data: { dispatchId: dispatch.id, instanceName: 'instance' },
        },
        {
          repositories,
          whatsAppProvider: provider,
          whatsAppProviderResolver: vi.fn().mockResolvedValue(provider),
          logger,
          groupSendPolicy: commercialGroupSendPolicy(),
          draftService: {
            createDraft: vi.fn().mockReturnValue({
              candidateId: 'candidate-123',
              generatedCopyId: 'copy-123',
              caption: 'draft text',
              deliveryMode: 'TEXT',
              warnings: [],
            }),
          },
          clock: () => handoffNow,
          reservationLeaseMilliseconds: handoffLeaseMilliseconds,
          manualLifecycleFinalizer,
        },
      ),
    ).resolves.toMatchObject({ status: 'SUBMITTED' });

    expect(provider.sendMessage).toHaveBeenCalledOnce();
    expect(repositories.whatsappDispatches.markSubmitted).toHaveBeenCalledOnce();
    expect(repositories.whatsappDispatches.markFailed).not.toHaveBeenCalled();
    expect(repositories.commercialRuns.finalizeByDispatchId).not.toHaveBeenCalled();
    expect(manualLifecycleFinalizer.finalizeAfterDispatch).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('vincula a autorização R8 ao job, target, revision e payload exatos', async () => {
    const dispatch: WhatsAppDispatchDetails = {
      ...commercialDispatch,
      id: 'dispatch-handoff',
      destination: {
        ...commercialDispatch.destination,
        assignmentRevision: 7,
        assignedInstanceNames: ['instance'],
      },
    };
    const { repositories } = createHandoffRepositories({ dispatch });
    const provider: WhatsAppProvider = {
      beginRun: vi.fn(),
      sendMessage: vi.fn().mockResolvedValue({
        status: 'sent' as const,
        externalMessageId: 'external-r8-one-shot',
        sentAt: handoffNow,
      }),
    };
    const fence = createR8OneShotAuthorizationFence({
      manifest: r8AuthorizationManifest(),
      candidateHead: 'candidate-head',
      candidateTree: 'candidate-tree',
      clock: () => handoffNow,
    });
    const job = {
      id: 'job-handoff',
      name: JOB_NAMES.whatsappDispatch,
      data: { dispatchId: 'dispatch-handoff', instanceName: 'instance' },
      opts: { attempts: 1 },
    };
    const options = {
      repositories,
      whatsAppProvider: provider,
      whatsAppProviderResolver: vi.fn().mockResolvedValue(provider),
      logger: { info: vi.fn(), error: vi.fn() },
      groupSendPolicy: commercialGroupSendPolicy(),
      clock: () => handoffNow,
      reservationLeaseMilliseconds: handoffLeaseMilliseconds,
      oneShotAuthorizationFence: fence,
    };

    await expect(processWhatsAppDispatchJob(job, options)).resolves.toMatchObject({
      status: 'SUBMITTED',
    });
    await expect(processWhatsAppDispatchJob(job, options)).rejects.toMatchObject({
      code: 'R8_ONE_SHOT_AUTHORIZATION_INVALID',
      deliveryMayHaveStarted: false,
    });

    expect(provider.sendMessage).toHaveBeenCalledOnce();
    expect(provider.beginRun).toHaveBeenCalledOnce();
    expect(provider.beginRun).toHaveBeenCalledWith(
      'r8:r8-authorization-test:job-handoff',
    );
    expect(fence.sendBudgetConsumed).toBe(1);
  });

  it('bloqueia revision stale mesmo quando a instância ainda pertence à lista', async () => {
    const dispatch: WhatsAppDispatchDetails = {
      ...commercialDispatch,
      id: 'dispatch-handoff',
      destination: {
        ...commercialDispatch.destination,
        assignmentRevision: 8,
        assignedInstanceNames: ['instance', 'instance-b'],
      },
    };
    const { repositories } = createHandoffRepositories({ dispatch });
    const provider: WhatsAppProvider = {
      beginRun: vi.fn(),
      sendMessage: vi.fn(),
    };
    const fence = createR8OneShotAuthorizationFence({
      manifest: r8AuthorizationManifest({ assignmentRevision: 7 }),
      candidateHead: 'candidate-head',
      candidateTree: 'candidate-tree',
      clock: () => handoffNow,
    });

    await expect(
      processWhatsAppDispatchJob(
        {
          id: 'job-handoff',
          name: JOB_NAMES.whatsappDispatch,
          data: { dispatchId: 'dispatch-handoff', instanceName: 'instance' },
          opts: { attempts: 1 },
        },
        {
          repositories,
          whatsAppProvider: provider,
          whatsAppProviderResolver: vi.fn().mockResolvedValue(provider),
          logger: { info: vi.fn(), error: vi.fn() },
          groupSendPolicy: commercialGroupSendPolicy(),
          clock: () => handoffNow,
          reservationLeaseMilliseconds: handoffLeaseMilliseconds,
          oneShotAuthorizationFence: fence,
        },
      ),
    ).rejects.toMatchObject({
      code: 'R8_ONE_SHOT_AUTHORIZATION_INVALID',
      deliveryMayHaveStarted: false,
    });

    expect(
      repositories.whatsappDispatches.claimPendingForSending,
    ).not.toHaveBeenCalled();
    expect(provider.sendMessage).not.toHaveBeenCalled();
    expect(fence.sendBudgetConsumed).toBe(0);
  });

  it.each([
    ['candidate head', { candidateHead: 'foreign-head' }],
    ['candidate tree', { candidateTree: 'foreign-tree' }],
    ['target fingerprint', { targetFingerprint: 'foreign-fingerprint' }],
    ['destination hash', { destinationSha256: '0'.repeat(64) }],
    ['instance', { instanceName: 'foreign-instance' }],
    ['candidate', { candidateId: 'foreign-candidate' }],
    ['snapshot', { snapshotRevision: 2 }],
    ['copy', { generatedCopyId: 'foreign-copy' }],
    ['delivery mode', { deliveryMode: 'TEXT' as const }],
  ])(
    'invalida autorização one-shot quando diverge %s',
    async (_field, overrides) => {
      const dispatch: WhatsAppDispatchDetails = {
        ...commercialDispatch,
        id: 'dispatch-handoff',
        destination: {
          ...commercialDispatch.destination,
          assignmentRevision: 7,
          assignedInstanceNames: ['instance'],
        },
      };
      const { repositories } = createHandoffRepositories({ dispatch });
      const provider: WhatsAppProvider = {
        beginRun: vi.fn(),
        sendMessage: vi.fn(),
      };
      const fence = createR8OneShotAuthorizationFence({
        manifest: r8AuthorizationManifest(overrides),
        candidateHead: 'candidate-head',
        candidateTree: 'candidate-tree',
        clock: () => handoffNow,
      });

      await expect(
        processWhatsAppDispatchJob(
          {
            id: 'job-handoff',
            name: JOB_NAMES.whatsappDispatch,
            data: { dispatchId: 'dispatch-handoff', instanceName: 'instance' },
            opts: { attempts: 1 },
          },
          {
            repositories,
            whatsAppProvider: provider,
            whatsAppProviderResolver: vi.fn().mockResolvedValue(provider),
            logger: { info: vi.fn(), error: vi.fn() },
            groupSendPolicy: commercialGroupSendPolicy(),
            clock: () => handoffNow,
            reservationLeaseMilliseconds: handoffLeaseMilliseconds,
            oneShotAuthorizationFence: fence,
          },
        ),
      ).rejects.toMatchObject({
        code: 'R8_ONE_SHOT_AUTHORIZATION_INVALID',
        deliveryMayHaveStarted: false,
      });

      expect(provider.sendMessage).not.toHaveBeenCalled();
      expect(fence.sendBudgetConsumed).toBe(0);
    },
  );

  it('bloqueia payload divergente da autorização one-shot antes do provider', async () => {
    const dispatch: WhatsAppDispatchDetails = {
      ...commercialDispatch,
      id: 'dispatch-handoff',
      destination: {
        ...commercialDispatch.destination,
        assignmentRevision: 7,
        assignedInstanceNames: ['instance'],
      },
    };
    const { repositories } = createHandoffRepositories({ dispatch });
    const provider: WhatsAppProvider = {
      beginRun: vi.fn(),
      sendMessage: vi.fn(),
    };
    const fence = createR8OneShotAuthorizationFence({
      manifest: r8AuthorizationManifest({
        messagePayloadSha256: '0'.repeat(64),
      }),
      candidateHead: 'candidate-head',
      candidateTree: 'candidate-tree',
      clock: () => handoffNow,
    });

    await expect(
      processWhatsAppDispatchJob(
        {
          id: 'job-handoff',
          name: JOB_NAMES.whatsappDispatch,
          data: { dispatchId: 'dispatch-handoff', instanceName: 'instance' },
          opts: { attempts: 1 },
        },
        {
          repositories,
          whatsAppProvider: provider,
          whatsAppProviderResolver: vi.fn().mockResolvedValue(provider),
          logger: { info: vi.fn(), error: vi.fn() },
          groupSendPolicy: commercialGroupSendPolicy(),
          clock: () => handoffNow,
          reservationLeaseMilliseconds: handoffLeaseMilliseconds,
          oneShotAuthorizationFence: fence,
        },
      ),
    ).rejects.toMatchObject({
      code: 'R8_ONE_SHOT_AUTHORIZATION_INVALID',
      deliveryMayHaveStarted: false,
    });

    expect(provider.sendMessage).not.toHaveBeenCalled();
    expect(fence.sendBudgetConsumed).toBe(0);
  });

  it('não reutiliza a mesma autorização depois de uma tentativa persistida', async () => {
    const dispatch: WhatsAppDispatchDetails = {
      ...commercialDispatch,
      id: 'dispatch-handoff',
      attemptCount: 1,
      destination: {
        ...commercialDispatch.destination,
        assignmentRevision: 7,
        assignedInstanceNames: ['instance'],
      },
    };
    const { repositories } = createHandoffRepositories({ dispatch });
    const provider: WhatsAppProvider = {
      beginRun: vi.fn(),
      sendMessage: vi.fn(),
    };
    const fence = createR8OneShotAuthorizationFence({
      manifest: r8AuthorizationManifest(),
      candidateHead: 'candidate-head',
      candidateTree: 'candidate-tree',
      clock: () => handoffNow,
    });

    await expect(
      processWhatsAppDispatchJob(
        {
          id: 'job-handoff',
          name: JOB_NAMES.whatsappDispatch,
          data: { dispatchId: 'dispatch-handoff', instanceName: 'instance' },
          opts: { attempts: 1 },
        },
        {
          repositories,
          whatsAppProvider: provider,
          whatsAppProviderResolver: vi.fn().mockResolvedValue(provider),
          logger: { info: vi.fn(), error: vi.fn() },
          groupSendPolicy: commercialGroupSendPolicy(),
          clock: () => handoffNow,
          reservationLeaseMilliseconds: handoffLeaseMilliseconds,
          oneShotAuthorizationFence: fence,
        },
      ),
    ).rejects.toMatchObject({
      code: 'COMMERCIAL_DISPATCH_RESERVATION_LIFECYCLE_INVALID',
    });

    expect(
      repositories.whatsappDispatches.claimPendingForSending,
    ).not.toHaveBeenCalled();
    expect(provider.sendMessage).not.toHaveBeenCalled();
    expect(fence.sendBudgetConsumed).toBe(0);
  });

  it('rejeita autorização não concedida antes de qualquer leitura de lifecycle', async () => {
    const { repositories, renewAttempt } = createHandoffRepositories({
      dispatch: { ...commercialDispatch, id: 'dispatch-handoff' },
    });
    const provider: WhatsAppProvider = {
      beginRun: vi.fn(),
      sendMessage: vi.fn(),
    };
    const fence = createR8OneShotAuthorizationFence({
      manifest: r8AuthorizationManifest({ authorized: false }),
      candidateHead: 'candidate-head',
      candidateTree: 'candidate-tree',
      clock: () => handoffNow,
    });

    await expect(
      processWhatsAppDispatchJob(
        {
          id: 'job-handoff',
          name: JOB_NAMES.whatsappDispatch,
          data: { dispatchId: 'dispatch-handoff', instanceName: 'instance' },
          opts: { attempts: 1 },
        },
        {
          repositories,
          whatsAppProvider: provider,
          whatsAppProviderResolver: vi.fn().mockResolvedValue(provider),
          logger: { info: vi.fn(), error: vi.fn() },
          oneShotAuthorizationFence: fence,
        },
      ),
    ).rejects.toMatchObject({ code: 'R8_ONE_SHOT_AUTHORIZATION_INVALID' });

    expect(repositories.commercialRuns.findByDispatchId).not.toHaveBeenCalled();
    expect(renewAttempt).not.toHaveBeenCalled();
    expect(provider.sendMessage).not.toHaveBeenCalled();
  });

  it('vincula a autorização one-shot ao runtime seguro e ao destino único', () => {
    const validRuntime = {
      allowedDestinations: [commercialGroupId],
      groupSendEnabled: true,
      safeMode: true,
      maxMessagesPerRun: 1,
      schedulerEnabled: false,
      commercialSchedulerEnabled: false,
    };
    const createFence = (overrides: Partial<R8OneShotAuthorizationManifest> = {}) =>
      createR8OneShotAuthorizationFence({
        manifest: r8AuthorizationManifest(overrides),
        candidateHead: 'candidate-head',
        candidateTree: 'candidate-tree',
        clock: () => handoffNow,
      });

    expect(() => createFence().assertRuntime(validRuntime)).not.toThrow();
    expect(() =>
      createFence().assertRuntime({
        ...validRuntime,
        allowedDestinations: [commercialGroupId, '120363111111111111@g.us'],
      }),
    ).toThrowError(expect.objectContaining({ code: 'R8_ONE_SHOT_AUTHORIZATION_INVALID' }));
    expect(() =>
      createFence().assertRuntime({
        ...validRuntime,
        allowedDestinations: ['120363111111111111@g.us'],
      }),
    ).toThrowError(expect.objectContaining({ code: 'R8_ONE_SHOT_AUTHORIZATION_INVALID' }));
    expect(() =>
      createFence().assertRuntime({ ...validRuntime, schedulerEnabled: true }),
    ).toThrowError(expect.objectContaining({ code: 'R8_ONE_SHOT_AUTHORIZATION_INVALID' }));
    expect(() =>
      createFence({ expiresAt: '2026-08-14T11:59:59.999Z' }).assertRuntime(
        validRuntime,
      ),
    ).toThrowError(expect.objectContaining({ code: 'R8_ONE_SHOT_AUTHORIZATION_INVALID' }));
  });
});
