import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fingerprintWhatsAppGroupId,
  maskEvolutionDestination,
} from '@shopee-auto-affiliate-ai/providers';
import {
  runCommercialImageDispatchE2E,
  COMMERCIAL_IMAGE_DISPATCH_E2E_REAL_FLAG,
  type CommercialImageDispatchE2ERuntime,
  type CommercialImageDispatchE2EReadOnlyRuntime,
  type CommercialImageDispatchReadRepositories,
  type CommercialImageDispatchWriteRepositories,
  type CommercialImageDispatchCandidateReader,
  type CommercialImageDispatchDestinationReader,
  type CommercialImageDispatchDispatchWriter,
  type CommercialImageDispatchE2EPreflight,
} from '../src/commercial-image-dispatch-e2e';
import type {
  WhatsAppDestinationRecord,
  GeneratedCopyRecord,
  WhatsAppDispatchDetails,
  WhatsAppDispatchRecord
} from '../../api/src/repositories';
import type {
  CommercialMessageDraftService,
  CommercialMessageDraft,
  CommercialMessageDraftCandidate
} from '../../api/src/commercial-message-draft-service';

const DESTINATION = '0000000000000';
const GROUP_DESTINATION = '100000000000000000@g.us';
const GROUP_FINGERPRINT = fingerprintWhatsAppGroupId(GROUP_DESTINATION);
const API_KEY = 'unit-test-api-key-never-real';
const EXPECTED_EVOLUTION_INSTANCE = 'afiliado-shopee-local';
const baseEnv: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379',
  WHATSAPP_PROVIDER: 'evolution',
  EVOLUTION_API_URL: 'http://localhost:8080',
  EVOLUTION_API_KEY: API_KEY,
  EVOLUTION_INSTANCE_NAME: EXPECTED_EVOLUTION_INSTANCE,
  EVOLUTION_SAFE_MODE: 'true',
  EVOLUTION_ALLOWED_DESTINATIONS: DESTINATION,
  EVOLUTION_MAX_MESSAGES_PER_BOOT: '1',
  SCHEDULER_ENABLED: 'false',
};

const preflightOutput: CommercialImageDispatchE2EPreflight = {
  externalPreflightExecuted: true,
  evolutionAvailable: true,
  evolutionVersion: '2.3.7',
  instanceStatus: 'open',
};

const preflight = vi.fn(async () => preflightOutput);

const createLogger = () => ({ info: vi.fn(), error: vi.fn() });

type RuntimeState = {
  activeCount: number;
  workerCount: number;
  dispatch: WhatsAppDispatchRecord | null;
  apiDispatch: WhatsAppDispatchDetails | null;
  job: { id: string; waitUntilFinished: () => Promise<void> } | null;
  candidates: Record<string, CommercialMessageDraftCandidate>;
  copies: Record<string, GeneratedCopyRecord>;
  destinations: Record<string, WhatsAppDestinationRecord>;
  dispatches: WhatsAppDispatchRecord[];
};

const createMockReadOnlyRuntimeFactory = (state: RuntimeState) => {
  return async (): Promise<CommercialImageDispatchE2EReadOnlyRuntime> => {
    const repositories: CommercialImageDispatchReadRepositories = {
      whatsappDestinations: {
        findById: vi.fn(async (id: string) => {
          const destination = state.destinations[id];
          return destination?.type === 'INDIVIDUAL' ? destination : null;
        }),
      },
      whatsappDispatches: {
        list: vi.fn(async () => state.dispatches),
      },
    };

    const prisma: CommercialImageDispatchCandidateReader & CommercialImageDispatchDestinationReader = {
      whatsAppDestination: {
        findUnique: vi.fn(async (args: { where: { id: string } }) => state.destinations[args.where.id] || null),
      },
      commercialPromotionCandidate: {
        findUnique: vi.fn(async (args: { where: { id: string } }) => state.candidates[args.where.id] || null)
      },
    };

    const mockDraft: CommercialMessageDraft = {
      candidateId: 'candidate-1',
      generatedCopyId: 'copy-1',
      deliveryMode: 'IMAGE',
      imageUrl: 'https://example.invalid/image.jpg',
      caption: 'Promo test https://shope.ee/test',
      warnings: []
    };

    const draftService: Pick<CommercialMessageDraftService, 'createDraft'> = {
      createDraft: vi.fn((candidate) => ({
        ...mockDraft,
        imageUrl: candidate.product?.urlImagem || '',
        caption: candidate.product?.affiliateLink === 'double' ? 'double double' : `Promo test ${candidate.product?.affiliateLink || ''}`
      }))
    };

    return {
      repositories,
      prisma,
      draftService,
      close: vi.fn(),
    };
  };
};

const createMockRuntimeFactory = (state: RuntimeState) => {
  return async (): Promise<CommercialImageDispatchE2ERuntime> => {
    const ro = await createMockReadOnlyRuntimeFactory(state)();

    const repositories: CommercialImageDispatchWriteRepositories = {
      ...ro.repositories,
      whatsappDispatches: {
        ...ro.repositories.whatsappDispatches,
        findByIdWithDetails: vi.fn(async (): Promise<WhatsAppDispatchDetails | null> => state.apiDispatch),
        createPending: vi.fn(async (data: { id: string; productId: string; generatedCopyId: string; destinationId: string }) => {
          const newDispatch: WhatsAppDispatchRecord = {
            ...data,
            status: 'PENDING',
            attemptCount: 0,
            externalMessageId: null,
            sentAt: null,
            errorMessage: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          state.dispatch = newDispatch;
          state.dispatches.push(newDispatch);
          return newDispatch;
        }),
      },
    };

    const prisma: CommercialImageDispatchCandidateReader & CommercialImageDispatchDestinationReader & CommercialImageDispatchDispatchWriter = {
      ...ro.prisma,
      whatsAppDispatch: {
        findUnique: vi.fn(async (args: { where: { id: string } }) => state.dispatches.find(d => d.id === args.where.id) || null)
      }
    };

    return {
      repositories,
      prisma,
      draftService: ro.draftService,
      assertNoCompetingWork: vi.fn(async () => {
        if (state.activeCount > 0 || state.workerCount > 0)
          throw new Error('Ha worker ou pipeline ativo; execucao E2E bloqueada');
      }),
      findJob: vi.fn(async (jobId: string) => state.job?.id === jobId ? state.job : null),
      enqueue: vi.fn(async (dispatchId: string, jobId: string) => {
        const job = { id: jobId, waitUntilFinished: vi.fn() };
        state.job = job;
        return job;
      }),
      startWorker: vi.fn(),
      waitForJob: vi.fn(async () => {
        if (state.dispatch) {
          state.dispatch.status = 'SENT';
          state.dispatch.attemptCount = 1;
          state.dispatch.externalMessageId = 'mock-id';
          state.dispatch.sentAt = new Date();
        }
      }),
      queryDispatchApi: vi.fn(async (): Promise<WhatsAppDispatchDetails> => {
        if (!state.apiDispatch) throw new Error('No apiDispatch');
        return state.apiDispatch;
      }),
      close: vi.fn(),
    };
  };
};

describe('Commercial Image Dispatch E2E CLI', () => {
  let logger: ReturnType<typeof createLogger>;
  let state: RuntimeState;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = createLogger();

    const copy: GeneratedCopyRecord = {
      id: 'copy-1', productId: 'product-1', createdFromCandidateId: 'candidate-1', snapshotId: 'snap-1',
      titulo: 'T', mensagem: 'M', cta: 'C', hashtags: 'H', createdAt: new Date(), model: null, source: 'AI'
    };

    const candidate: CommercialMessageDraftCandidate = {
      id: 'candidate-1',
      productId: 'product-1',
      snapshotId: 'snap-1',
      generatedCopyId: 'copy-1',
      status: 'COPY_READY',
      expiresAt: new Date(),
      product: {
        id: 'product-1',
        unavailableAt: null,
        affiliateLink: 'https://shope.ee/test',
        urlImagem: 'https://example.invalid/image.jpg',
        commercialSnapshotRevision: 1
      },
      snapshot: {
        id: 'snap-1',
        productId: 'product-1',
        revision: 1,
        unavailableAt: null,
        offerEndsAt: null
      },
      generatedCopy: {
        id: 'copy-1',
        productId: 'product-1',
        snapshotId: 'snap-1',
        createdFromCandidateId: 'candidate-1',
        titulo: 'T',
        mensagem: 'M',
        cta: 'C',
        hashtags: 'H'
      }
    };

    const dest: WhatsAppDestinationRecord = {
      id: 'dest-1',
      type: 'INDIVIDUAL',
      destination: DESTINATION,
      active: true,
      available: true,
      sourceInstanceName: EXPECTED_EVOLUTION_INSTANCE,
      createdAt: new Date(),
      updatedAt: new Date(),
      name: 'Test Name'
    };

    const apiDispatch: WhatsAppDispatchDetails = {
      id: 'dispatch-e2e-candidate-1-copy-1-dest-1',
      productId: 'product-1',
      generatedCopyId: 'copy-1',
      destinationId: 'dest-1',
      status: 'SENT',
      attemptCount: 1,
      externalMessageId: 'mock-id',
      sentAt: new Date(),
      errorMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      destination: { name: 'Destino controlado', type: 'INDIVIDUAL', destination: maskEvolutionDestination(DESTINATION), active: true, available: true, sourceInstanceName: EXPECTED_EVOLUTION_INSTANCE },
      generatedCopy: copy
    };

    state = {
      activeCount: 0,
      workerCount: 0,
      dispatch: null,
      apiDispatch,
      job: null,
      candidates: {
        'candidate-1': candidate
      },
      copies: {
        'copy-1': copy
      },
      destinations: {
        'dest-1': dest
      },
      dispatches: []
    };
  });

  const runWithEnv = (args: string[], envOverrides = {}) =>
    runCommercialImageDispatchE2E({
      args,
      env: { ...baseEnv, ...envOverrides },
      readEnvFile: () => '',
      logger,
      preflight,
      readOnlyRuntimeFactory: createMockReadOnlyRuntimeFactory(state),
      runtimeFactory: createMockRuntimeFactory(state),
    });

  const useGroupDestination = (
    overrides: Partial<WhatsAppDestinationRecord> = {},
  ) => {
    state.destinations['dest-1'] = {
      ...state.destinations['dest-1'],
      type: 'GROUP',
      destination: GROUP_DESTINATION,
      active: true,
      available: true,
      fingerprint: GROUP_FINGERPRINT,
      sourceInstanceName: EXPECTED_EVOLUTION_INSTANCE,
      ...overrides,
    };
  };

  const groupArgs = [
    '--candidate-id', 'candidate-1',
    '--copy-id', 'copy-1',
    '--destination-id', 'dest-1',
  ];

  const groupEnv: NodeJS.ProcessEnv = {
    WHATSAPP_GROUP_SEND_ENABLED: 'true',
    WHATSAPP_GROUP_MAX_MESSAGES_PER_RUN: '1',
  };

  const runBlockedGroup = async (envOverrides: NodeJS.ProcessEnv = {}, destinationOverrides: Partial<WhatsAppDestinationRecord> = {}) => {
    useGroupDestination(destinationOverrides);
    const runtimeFactory = vi.fn(createMockRuntimeFactory(state));
    const result = await runCommercialImageDispatchE2E({
      args: groupArgs,
      env: { ...baseEnv, ...groupEnv, ...envOverrides },
      readEnvFile: () => '', logger, preflight,
      readOnlyRuntimeFactory: createMockReadOnlyRuntimeFactory(state), runtimeFactory,
    });
    return { result, runtimeFactory };
  };

  const expectGroupBlockedBeforeSideEffects = (observation: Awaited<ReturnType<typeof runBlockedGroup>>, code: string) => {
    expect(observation.result).toMatchObject({ exitCode: 1, output: { code } });
    expect(preflight).not.toHaveBeenCalled();
    expect(observation.runtimeFactory).not.toHaveBeenCalled();
    expect(state.dispatches).toHaveLength(0);
    expect(state.dispatch).toBeNull();
    expect(state.job).toBeNull();
  };

  it('INDIVIDUAL with one allowed matching destination returns GO in dry-run', async () => {
    const result = await runWithEnv([
      '--candidate-id', 'candidate-1',
      '--copy-id', 'copy-1',
      '--destination-id', 'dest-1'
    ], { EVOLUTION_ALLOWED_DESTINATIONS: DESTINATION });
    expect(result).toMatchObject({
      exitCode: 0,
      output: {
        mode: 'dry-run',
        result: 'GO',
        destination: maskEvolutionDestination(DESTINATION),
      },
    });
    expect(state.dispatches).toHaveLength(0);
  });

  it('GROUP valid returns GO even though the individual destination repository cannot read GROUP', async () => {
    useGroupDestination();
    const result = await runWithEnv(groupArgs, { ...groupEnv, EVOLUTION_ALLOWED_DESTINATIONS: DESTINATION });
    expect(result).toMatchObject({ exitCode: 0, output: { mode: 'dry-run', result: 'GO', destination: GROUP_FINGERPRINT } });
    expect(preflight).not.toHaveBeenCalled();
    expect(state.dispatches).toHaveLength(0);
    expect(state.job).toBeNull();
  });

  it('GROUP valid remains GO with an empty individual allowlist', async () => {
    useGroupDestination();
    const result = await runWithEnv(groupArgs, { ...groupEnv, EVOLUTION_ALLOWED_DESTINATIONS: '' });
    expect(result).toMatchObject({ exitCode: 0, output: { mode: 'dry-run', result: 'GO', destination: GROUP_FINGERPRINT } });
    expect(preflight).not.toHaveBeenCalled();
    expect(state.dispatches).toHaveLength(0);
    expect(state.job).toBeNull();
  });

  it('GROUP blocks when WHATSAPP_GROUP_SEND_ENABLED is false', async () => {
    const observation = await runBlockedGroup({ WHATSAPP_GROUP_SEND_ENABLED: 'false' });
    expectGroupBlockedBeforeSideEffects(observation, 'COMMERCIAL_E2E_GROUP_SEND_REQUIRED');
  });

  it('GROUP blocks when WHATSAPP_GROUP_MAX_MESSAGES_PER_RUN is not one', async () => {
    const observation = await runBlockedGroup({ WHATSAPP_GROUP_MAX_MESSAGES_PER_RUN: '2' });
    expectGroupBlockedBeforeSideEffects(observation, 'COMMERCIAL_E2E_GROUP_LIMIT_MUST_BE_ONE');
  });

  it('GROUP blocks when sourceInstanceName differs from the current instance', async () => {
    const observation = await runBlockedGroup({}, { sourceInstanceName: 'other-instance' });
    expectGroupBlockedBeforeSideEffects(observation, 'COMMERCIAL_E2E_GROUP_INSTANCE_MISMATCH');
  });

  it('GROUP blocks when fingerprint differs from the stored identity', async () => {
    const observation = await runBlockedGroup({}, { fingerprint: 'grp_invalid' });
    expectGroupBlockedBeforeSideEffects(observation, 'COMMERCIAL_E2E_GROUP_IDENTITY_MISMATCH');
  });

  it('missing flag blocks real execution (runs dry-run)', async () => {
    const result = await runWithEnv([
      '--candidate-id', 'candidate-1',
      '--copy-id', 'copy-1',
      '--destination-id', 'dest-1'
    ]);
    expect(result.exitCode).toBe(0);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'dry-run' })
    );
  });

  it('incorrect flag block (invalid args)', async () => {
    const result = await runWithEnv([
      '--candidate-id', 'candidate-1',
      '--wrong-flag'
    ]);
    expect(result.exitCode).toBe(1);
  });

  it('candidate or copy mismatch blocks execution', async () => {
    state.copies['copy-1'] = { ...state.copies['copy-1'], createdFromCandidateId: 'other-candidate' };
    if (state.candidates['candidate-1'].generatedCopy) {
      state.candidates['candidate-1'].generatedCopy = {
        id: 'copy-1',
        productId: 'product-1',
        snapshotId: 'snap-1',
        titulo: 'T',
        mensagem: 'M',
        cta: 'C',
        hashtags: 'H',
        createdFromCandidateId: 'other-candidate'
      };
    }
    const result = await runWithEnv([
      '--candidate-id', 'candidate-1',
      '--copy-id', 'copy-1',
      '--destination-id', 'dest-1'
    ]);
    expect(result.exitCode).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'COMMERCIAL_E2E_RELATION_MISMATCH' })
    );
  });

  it('inactive destination blocks execution', async () => {
    state.destinations['dest-1'].active = false;
    const result = await runWithEnv([
      '--candidate-id', 'candidate-1',
      '--copy-id', 'copy-1',
      '--destination-id', 'dest-1'
    ]);
    expect(result.exitCode).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'COMMERCIAL_E2E_DESTINATION_UNAVAILABLE' })
    );
  });

  it('destination not in allowlist blocks execution', async () => {
    state.destinations['dest-1'] = { ...state.destinations['dest-1'], destination: '5511999999999' };
    const result = await runWithEnv([
      '--candidate-id', 'candidate-1',
      '--copy-id', 'copy-1',
      '--destination-id', 'dest-1'
    ]);
    expect(result.exitCode).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'COMMERCIAL_E2E_DESTINATION_NOT_ALLOWED' })
    );
  });

  it('previous dispatch blocks execution', async () => {
    state.dispatches.push({
      id: 'dispatch-e2e-candidate-1-copy-1-dest-1',
      productId: 'product-1',
      generatedCopyId: 'copy-1',
      destinationId: 'dest-1',
      status: 'SENT',
      attemptCount: 1,
      externalMessageId: null,
      sentAt: null,
      errorMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const result = await runWithEnv([
      '--candidate-id', 'candidate-1',
      '--copy-id', 'copy-1',
      '--destination-id', 'dest-1'
    ]);
    expect(result.exitCode).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'COMMERCIAL_E2E_PREVIOUS_DISPATCH_BLOCKED' })
    );
  });

  it('blocks if image url is missing or invalid', async () => {
    state.candidates['candidate-1'].product = { ...state.candidates['candidate-1'].product, urlImagem: '' };
    const result = await runWithEnv(['--candidate-id', 'candidate-1', '--copy-id', 'copy-1', '--destination-id', 'dest-1']);
    expect(result.exitCode).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ code: 'COMMERCIAL_E2E_NOT_IMAGE_DRAFT' }));
  });

  it('blocks if affiliate link is missing', async () => {
    state.candidates['candidate-1'].product = { ...state.candidates['candidate-1'].product, affiliateLink: '' };
    const result = await runWithEnv(['--candidate-id', 'candidate-1', '--copy-id', 'copy-1', '--destination-id', 'dest-1']);
    expect(result.exitCode).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ code: 'COMMERCIAL_E2E_PRODUCT_NO_LINK' }));
  });

  it('blocks if affiliate link occurs more than once or zero times', async () => {
    state.candidates['candidate-1'].product.affiliateLink = 'double';
    const result = await runWithEnv(['--candidate-id', 'candidate-1', '--copy-id', 'copy-1', '--destination-id', 'dest-1']);
    expect(result.exitCode).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ code: 'COMMERCIAL_E2E_LINK_COUNT_INVALID' }));
  });

  it('dry-run explicit guarantees: no preflight, no fetch, no queue, no worker', async () => {
    const result = await runWithEnv(['--candidate-id', 'candidate-1', '--copy-id', 'copy-1', '--destination-id', 'dest-1']);
    expect(result.exitCode).toBe(0);
    expect(preflight).not.toHaveBeenCalled();
  });

  it('real mode success path', async () => {
    state.dispatch = {
      id: 'dispatch-e2e-candidate-1-copy-1-dest-1',
      productId: 'product-1',
      generatedCopyId: 'copy-1',
      destinationId: 'dest-1',
      status: 'PENDING',
      attemptCount: 0,
      externalMessageId: null,
      sentAt: null,
      errorMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const result = await runWithEnv([
      '--candidate-id', 'candidate-1',
      '--copy-id', 'copy-1',
      '--destination-id', 'dest-1',
      `--${COMMERCIAL_IMAGE_DISPATCH_E2E_REAL_FLAG}`
    ]);
    expect(result.exitCode).toBe(0);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'confirmed',
        status: 'SENT',
        attemptCount: 1,
        externalMessageIdPresent: true,
      })
    );
  });

  it('blocks if job anterior exists', async () => {
    state.job = { id: 'commercial-image-e2e-candidate-1-copy-1-dest-1', waitUntilFinished: vi.fn() };
    const result = await runWithEnv(['--candidate-id', 'candidate-1', '--copy-id', 'copy-1', '--destination-id', 'dest-1', '--confirm-one-real-commercial-image-dispatch']);
    expect(result.exitCode).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ code: 'COMMERCIAL_E2E_PREVIOUS_JOB_BLOCKED' }));
  });

  it('legacy INDIVIDUAL dispatch for another destination does not block GROUP', async () => {
    state.dispatches.push({
      id: 'dispatch-e2e-candidate-1-copy-1',
      productId: 'product-1',
      generatedCopyId: 'copy-1',
      destinationId: 'dest-individual-legacy',
      status: 'SENT',
      attemptCount: 1,
      externalMessageId: 'legacy-message-id',
      sentAt: new Date(),
      errorMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    useGroupDestination();

    const result = await runWithEnv(groupArgs, groupEnv);

    expect(result).toMatchObject({ exitCode: 0, output: { mode: 'dry-run', result: 'GO', destination: GROUP_FINGERPRINT } });
    expect(state.dispatches).toHaveLength(1);
    expect(state.job).toBeNull();
    expect(preflight).not.toHaveBeenCalled();
  });

  it('previous dispatch for the same GROUP blocks regardless of dispatch id format', async () => {
    useGroupDestination();
    state.dispatches.push({
      id: 'legacy-dispatch-id-for-group',
      productId: 'product-1',
      generatedCopyId: 'copy-1',
      destinationId: 'dest-1',
      status: 'SENT',
      attemptCount: 1,
      externalMessageId: 'previous-message-id',
      sentAt: new Date(),
      errorMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await runWithEnv(groupArgs, groupEnv);

    expect(result.exitCode).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ code: 'COMMERCIAL_E2E_PREVIOUS_DISPATCH_BLOCKED' }));
    expect(state.job).toBeNull();
    expect(preflight).not.toHaveBeenCalled();
  });

  it('job scoped to another destination does not block GROUP and GROUP ids include destinationId', async () => {
    const groupDestinationId = 'dest-group';
    state.destinations[groupDestinationId] = {
      ...state.destinations['dest-1'],
      id: groupDestinationId,
      type: 'GROUP',
      destination: GROUP_DESTINATION,
      fingerprint: GROUP_FINGERPRINT,
      sourceInstanceName: EXPECTED_EVOLUTION_INSTANCE,
    };
    if (!state.apiDispatch) throw new Error('Expected apiDispatch fixture');
    state.apiDispatch = {
      ...state.apiDispatch,
      id: 'dispatch-e2e-candidate-1-copy-1-' + groupDestinationId,
      destinationId: groupDestinationId,
      destination: {
        ...state.apiDispatch.destination,
        type: 'GROUP',
        destination: GROUP_FINGERPRINT,
      },
    };
    state.job = {
      id: 'commercial-image-e2e-candidate-1-copy-1-dest-individual',
      waitUntilFinished: vi.fn(),
    };

    const result = await runWithEnv([
      '--candidate-id', 'candidate-1',
      '--copy-id', 'copy-1',
      '--destination-id', groupDestinationId,
      '--' + COMMERCIAL_IMAGE_DISPATCH_E2E_REAL_FLAG,
    ], groupEnv);

    expect(result).toMatchObject({
      exitCode: 0,
      output: {
        mode: 'confirmed',
        dispatchId: 'dispatch-e2e-candidate-1-copy-1-' + groupDestinationId,
        jobId: 'commercial-image-e2e-candidate-1-copy-1-' + groupDestinationId,
        jobAttempts: 1,
        retryEnabled: false,
        status: 'SENT',
        attemptCount: 1,
      },
    });
    if (!('mode' in result.output) || result.output.mode !== 'confirmed') throw new Error('Expected confirmed output');
    expect(result.output.dispatchId).not.toBe('dispatch-e2e-candidate-1-copy-1-dest-1');
    expect(result.output.jobId).not.toBe('commercial-image-e2e-candidate-1-copy-1-dest-1');
  });

  it('job scoped to the same GROUP destination blocks', async () => {
    useGroupDestination();
    state.job = {
      id: 'commercial-image-e2e-candidate-1-copy-1-dest-1',
      waitUntilFinished: vi.fn(),
    };

    const result = await runWithEnv([
      ...groupArgs,
      '--' + COMMERCIAL_IMAGE_DISPATCH_E2E_REAL_FLAG,
    ], groupEnv);

    expect(result.exitCode).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ code: 'COMMERCIAL_E2E_PREVIOUS_JOB_BLOCKED' }));
  });

  it('blocks if candidate.generatedCopyId divergent', async () => {
    if (state.candidates['candidate-1'].generatedCopy) {
      state.candidates['candidate-1'].generatedCopy.id = 'other-copy';
    }
    const result = await runWithEnv(['--candidate-id', 'candidate-1', '--copy-id', 'copy-1', '--destination-id', 'dest-1']);
    expect(result.exitCode).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ code: 'COMMERCIAL_E2E_COPY_NOT_FOUND' }));
  });

  it('blocks if generatedCopy.productId divergent', async () => {
    if (state.candidates['candidate-1'].generatedCopy) {
      state.candidates['candidate-1'].generatedCopy.productId = 'other-product';
    }
    const result = await runWithEnv(['--candidate-id', 'candidate-1', '--copy-id', 'copy-1', '--destination-id', 'dest-1']);
    expect(result.exitCode).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ code: 'COMMERCIAL_E2E_RELATION_MISMATCH' }));
  });

  it('blocks if generatedCopy.snapshotId divergent', async () => {
    if (state.candidates['candidate-1'].generatedCopy) {
      state.candidates['candidate-1'].generatedCopy.snapshotId = 'other-snap';
    }
    const result = await runWithEnv(['--candidate-id', 'candidate-1', '--copy-id', 'copy-1', '--destination-id', 'dest-1']);
    expect(result.exitCode).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ code: 'COMMERCIAL_E2E_RELATION_MISMATCH' }));
  });

  it('blocks if draft is TEXT', async () => {
    const runtime = await createMockReadOnlyRuntimeFactory(state)();

    const draftMock: CommercialMessageDraft = {
      candidateId: 'candidate-1',
      generatedCopyId: 'copy-1',
      deliveryMode: 'TEXT',
      imageUrl: '',
      caption: 'Promo test https://shope.ee/test',
      warnings: []
    };

    runtime.draftService.createDraft = vi.fn(() => draftMock);

    const result = await runCommercialImageDispatchE2E({
      args: ['--candidate-id', 'candidate-1', '--copy-id', 'copy-1', '--destination-id', 'dest-1'],
      env: baseEnv,
      readEnvFile: () => '',
      logger,
      preflight,
      readOnlyRuntimeFactory: async () => runtime,
      runtimeFactory: async () => { throw new Error('should not be called'); },
    });

    expect(result.exitCode).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ code: 'COMMERCIAL_E2E_NOT_IMAGE_DRAFT' }));
  });

  it('blocks if image url is invalid (not empty)', async () => {
    state.candidates['candidate-1'].product = { ...state.candidates['candidate-1'].product, urlImagem: 'not-an-url' };
    const result = await runWithEnv(['--candidate-id', 'candidate-1', '--copy-id', 'copy-1', '--destination-id', 'dest-1']);
    expect(result.exitCode).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ code: 'COMMERCIAL_E2E_NOT_IMAGE_DRAFT' }));
  });

  it('blocks if destination available is false', async () => {
    state.destinations['dest-1'].available = false;
    const result = await runWithEnv(['--candidate-id', 'candidate-1', '--copy-id', 'copy-1', '--destination-id', 'dest-1']);
    expect(result.exitCode).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ code: 'COMMERCIAL_E2E_DESTINATION_UNAVAILABLE' }));
  });

  it('dry-run ensures runtimeFactory and external preflight are not called', async () => {
    const runtimeFactory = vi.fn();
    const result = await runCommercialImageDispatchE2E({
      args: ['--candidate-id', 'candidate-1', '--copy-id', 'copy-1', '--destination-id', 'dest-1'],
      env: baseEnv,
      readEnvFile: () => '',
      logger,
      preflight,
      readOnlyRuntimeFactory: createMockReadOnlyRuntimeFactory(state),
      runtimeFactory,
    });
    expect(result.exitCode).toBe(0);
    expect(preflight).not.toHaveBeenCalled();
    expect(runtimeFactory).not.toHaveBeenCalled();
  });
});
