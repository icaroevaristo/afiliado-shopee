import { describe, expect, it, vi } from 'vitest';

import { finalizeCommercialPipelineRun } from '../src/commercial-pipeline-run-finalizer';
import type {
  CommercialPipelineRunRecord,
  CommercialPipelineRunFinalizationKind,
  CommercialPipelineRunRepository,
  CommercialPipelineRunFinalizationRepository,
  CommercialPromotionAttemptContext,
  WhatsAppDispatchRecord,
} from '../src/repositories';

const now = new Date('2026-07-25T23:00:00.000Z');

const build = (
  investigationRequired = false,
  executionId: string | null = null,
) => {
  let run: CommercialPipelineRunRecord = {
    id: 'run-id',
    executionId,
    mode: 'CONFIRMED',
    status: 'STARTED',
    candidateCount: 1,
    eligibleCount: 1,
    rejectedCount: 0,
    rejectionSummary: {},
    selectionReasons: [],
    plannedSubIds: [],
    dispatchId: 'dispatch-id',
    finalStatus: 'PENDING',
    investigationRequired,
    createdAt: now,
  };
  let persistedDispatchStatus:
    | 'SENT'
    | 'FAILED'
    | 'PROCESSING'
    | 'PENDING' = 'PENDING';
  const finalizeByDispatchId = vi.fn(async () => {
    const kind: CommercialPipelineRunFinalizationKind =
      run.finalStatus === 'SENT' || persistedDispatchStatus === 'SENT'
        ? 'SENT'
        : (run.finalStatus === 'FAILED' && !run.investigationRequired) ||
            persistedDispatchStatus === 'FAILED'
          ? 'FAILED'
          : 'AMBIGUOUS';
    const alreadyTerminal =
      (kind === 'SENT' &&
        run.status === 'COMPLETED' &&
        run.finalStatus === 'SENT' &&
        !run.investigationRequired) ||
      (kind === 'FAILED' &&
        run.status === 'FAILED' &&
        run.finalStatus === 'FAILED' &&
        !run.investigationRequired) ||
      (kind === 'AMBIGUOUS' &&
        run.status === 'FAILED' &&
        run.finalStatus === 'AMBIGUOUS' &&
        run.investigationRequired);
    if (alreadyTerminal) return { kind, transitioned: false };
    if (
      kind !== 'SENT' &&
      run.status !== 'STARTED' &&
      !(
        kind === 'FAILED' &&
        run.status === 'FAILED' &&
        run.finalStatus === 'FAILED' &&
        run.investigationRequired
      )
    ) {
      return { kind, transitioned: false };
    }
    run = {
      ...run,
      status: kind === 'SENT' ? 'COMPLETED' : 'FAILED',
      finalStatus: kind === 'SENT' ? 'SENT' : kind,
      failureCode: kind === 'SENT' ? null : 'COMMERCIAL_DISPATCH_FAILED',
      investigationRequired: kind === 'AMBIGUOUS',
      completedAt: now,
    };
    return { kind, transitioned: true };
  });
  const update = vi.fn();
  const findExecutionById = vi.fn(async (id: string) =>
    id === run.executionId ? { id, commercialRunId: run.id } : null,
  );
  const runs = {
    create: vi.fn(),
    list: vi.fn(),
    findById: vi.fn(),
    findByExecutionId: vi.fn(),
    findByDispatchId: async (id: string) => (id === 'dispatch-id' ? run : null),
    findExecutionById,
    update,
    finalizeByDispatchId,
  } as CommercialPipelineRunRepository &
    CommercialPipelineRunFinalizationRepository;
  const markDispatchedByGeneratedCopyId = vi.fn(async () => ({
    kind: 'DISPATCHED' as const,
    candidateId: 'candidate-id',
    campaignId: 'campaign-id',
    transitioned: true,
  }));
  const markBlockedByGeneratedCopyId = vi.fn(async () => ({
    kind: 'BLOCKED' as const,
    candidateId: 'candidate-id',
    transitioned: true,
  }));
  const findAttemptContextByGeneratedCopyId = vi.fn<
    (generatedCopyId: string) => Promise<CommercialPromotionAttemptContext>
  >(async () => ({
    kind: 'FOUND',
    candidateId: 'candidate-id',
    campaignId: 'campaign-id',
    attemptExecutionId: executionId,
  }));
  const promotionCandidates = {
    markDispatchedByGeneratedCopyId,
    markBlockedByGeneratedCopyId,
    resetCampaignFailureStateByGeneratedCopyId: vi.fn(async () => ({
      kind: 'RESET' as const,
      campaignId: 'campaign-id',
      transitioned: true,
    })),
    findAttemptContextByGeneratedCopyId,
    releaseAttempt: vi.fn(async (input: {
      campaignId: string;
      executionId: string;
    }) => ({
      kind: 'RELEASED' as const,
      campaignId: input.campaignId,
      executionId: input.executionId,
      released: true,
    })),
  };
  return {
    runs,
    promotionCandidates,
    update,
    finalizeByDispatchId,
    setPersistedDispatchStatus: (
      status: 'SENT' | 'FAILED' | 'PROCESSING' | 'PENDING',
    ) => {
      persistedDispatchStatus = status;
    },
    setRun: (data: Partial<CommercialPipelineRunRecord>) => {
      run = { ...run, ...data };
    },
    getRun: () => run,
    findExecutionById,
    findAttemptContextByGeneratedCopyId,
  };
};

const dispatch = (
  status: 'SENT' | 'FAILED' | 'PROCESSING' | 'PENDING',
): WhatsAppDispatchRecord => ({
  id: 'dispatch-id',
  productId: 'product-id',
  generatedCopyId: 'copy-id',
  destinationId: 'group-id',
  status,
  attemptCount: status === 'PENDING' ? 0 : 1,
  externalMessageId: status === 'SENT' ? 'recorded-internally' : null,
});

  const finalizerOptions = (
  state: ReturnType<typeof build>,
  currentDispatch: WhatsAppDispatchRecord,
  failed = false,
  persistedStatus = currentDispatch.status,
) => {
  state.setPersistedDispatchStatus(persistedStatus);
  return {
    runs: state.runs,
    promotionCandidates: state.promotionCandidates,
    dispatch: currentDispatch,
    failed,
    logger: { info: vi.fn(), error: vi.fn() },
    clock: () => now,
  };
};

describe('finalizeCommercialPipelineRun', () => {
  it('persiste SENT e uma tentativa no run confirmado', async () => {
    const state = build();

    await finalizeCommercialPipelineRun(
      finalizerOptions(state, dispatch('SENT')),
    );

    expect(state.getRun()).toMatchObject({
      status: 'COMPLETED',
      finalStatus: 'SENT',
      investigationRequired: false,
      completedAt: now,
    });
    expect(
      state.promotionCandidates.markDispatchedByGeneratedCopyId,
    ).toHaveBeenCalledWith('copy-id');
    expect(
      state.promotionCandidates.markBlockedByGeneratedCopyId,
    ).not.toHaveBeenCalled();
    expect(
      state.promotionCandidates.resetCampaignFailureStateByGeneratedCopyId,
    ).toHaveBeenCalledWith('copy-id');
  });

  it('reconcilia SENT mesmo quando o run carregava investigação pendente', async () => {
    const state = build(true);

    await finalizeCommercialPipelineRun(
      finalizerOptions(state, dispatch('SENT')),
    );

    expect(state.getRun()).toMatchObject({
      status: 'COMPLETED',
      finalStatus: 'SENT',
      investigationRequired: false,
    });
  });

  it('aceita finalização SENT repetida sem mudar a fonte de verdade', async () => {
    const state = build();
    state.promotionCandidates.markDispatchedByGeneratedCopyId
      .mockResolvedValueOnce({
        kind: 'DISPATCHED',
        candidateId: 'candidate-id',
        campaignId: 'campaign-id',
        transitioned: true,
      })
      .mockResolvedValueOnce({
        kind: 'DISPATCHED',
        candidateId: 'candidate-id',
        campaignId: 'campaign-id',
        transitioned: false,
      });

    await finalizeCommercialPipelineRun(
      finalizerOptions(state, dispatch('SENT')),
    );
    await finalizeCommercialPipelineRun(
      finalizerOptions(state, dispatch('SENT')),
    );

    expect(
      state.promotionCandidates.markDispatchedByGeneratedCopyId,
    ).toHaveBeenCalledTimes(2);
    expect(state.getRun()).toMatchObject({
      status: 'COMPLETED',
      finalStatus: 'SENT',
      investigationRequired: false,
    });
    expect(
      state.promotionCandidates.resetCampaignFailureStateByGeneratedCopyId,
    ).toHaveBeenCalledTimes(2);
  });

  it('nao reseta o estado de campanha para FAILED ou PROCESSING', async () => {
    const state = build();

    await finalizeCommercialPipelineRun(
      finalizerOptions(state, dispatch('FAILED'), true),
    );
    await finalizeCommercialPipelineRun(
      finalizerOptions(state, dispatch('PROCESSING'), true),
    );

    expect(
      state.promotionCandidates.resetCampaignFailureStateByGeneratedCopyId,
    ).not.toHaveBeenCalled();
  });

  it('repete somente o reset quando SENT ja estava finalizado e a limpeza anterior falhou', async () => {
    const state = build();
    state.promotionCandidates.resetCampaignFailureStateByGeneratedCopyId
      .mockRejectedValueOnce(new Error('reset unavailable'));

    await expect(
      finalizeCommercialPipelineRun(finalizerOptions(state, dispatch('SENT'))),
    ).rejects.toThrow('reset unavailable');

    await finalizeCommercialPipelineRun(
      finalizerOptions(state, dispatch('SENT')),
    );

    expect(state.finalizeByDispatchId).toHaveBeenCalledTimes(2);
    expect(
      state.promotionCandidates.resetCampaignFailureStateByGeneratedCopyId,
    ).toHaveBeenCalledTimes(2);
  });

  it('persiste falha segura, bloqueia o candidato e nao autoriza retry', async () => {
    const state = build();

    await finalizeCommercialPipelineRun(
      finalizerOptions(state, dispatch('FAILED'), true),
    );

    expect(state.getRun()).toMatchObject({
      status: 'FAILED',
      finalStatus: 'FAILED',
      failureCode: 'COMMERCIAL_DISPATCH_FAILED',
      investigationRequired: false,
    });
    expect(
      state.promotionCandidates.markBlockedByGeneratedCopyId,
    ).toHaveBeenCalledWith('copy-id');
    expect(
      state.promotionCandidates.markDispatchedByGeneratedCopyId,
    ).not.toHaveBeenCalled();
  });

  it('limpa investigationRequired de uma falha segura antiga', async () => {
    const state = build(true);
    state.setRun({ status: 'FAILED', finalStatus: 'FAILED' });

    await finalizeCommercialPipelineRun(
      finalizerOptions(state, dispatch('FAILED'), true, 'FAILED'),
    );

    expect(state.getRun()).toMatchObject({
      status: 'FAILED',
      finalStatus: 'FAILED',
      investigationRequired: false,
    });
  });

  it('mantem falha segura idempotente quando o candidato ja esta BLOCKED', async () => {
    const state = build();
    state.promotionCandidates.markBlockedByGeneratedCopyId
      .mockResolvedValueOnce({
        kind: 'BLOCKED',
        candidateId: 'candidate-id',
        transitioned: true,
      })
      .mockResolvedValueOnce({
        kind: 'BLOCKED',
        candidateId: 'candidate-id',
        transitioned: false,
      });

    await finalizeCommercialPipelineRun(
      finalizerOptions(state, dispatch('FAILED'), true),
    );
    await finalizeCommercialPipelineRun(
      finalizerOptions(state, dispatch('FAILED'), true),
    );

    expect(
      state.promotionCandidates.markBlockedByGeneratedCopyId,
    ).toHaveBeenCalledTimes(2);
    expect(state.getRun()).toMatchObject({
      finalStatus: 'FAILED',
      investigationRequired: false,
    });
  });

  it('preserva PROCESSING ambiguo e o candidato protegido', async () => {
    const state = build(true);

    await finalizeCommercialPipelineRun(
      finalizerOptions(state, dispatch('PROCESSING'), true),
    );

    expect(state.getRun()).toMatchObject({
      status: 'FAILED',
      finalStatus: 'AMBIGUOUS',
      investigationRequired: true,
    });
    expect(state.finalizeByDispatchId).toHaveBeenCalledOnce();
    expect(
      state.promotionCandidates.markDispatchedByGeneratedCopyId,
    ).not.toHaveBeenCalled();
    expect(
      state.promotionCandidates.markBlockedByGeneratedCopyId,
    ).not.toHaveBeenCalled();
  });

  it('registra investigação para PENDING quando ainda não estava registrada', async () => {
    const state = build();

    await finalizeCommercialPipelineRun(
      finalizerOptions(state, dispatch('PENDING'), true),
    );

    expect(state.getRun()).toMatchObject({
      status: 'FAILED',
      finalStatus: 'AMBIGUOUS',
      investigationRequired: true,
    });
  });

  it('propaga falha da primeira finalização e converge na chamada seguinte', async () => {
    const state = build();
    state.promotionCandidates.markDispatchedByGeneratedCopyId
      .mockRejectedValueOnce(new Error('candidate finalization failed'))
      .mockResolvedValueOnce({
        kind: 'DISPATCHED',
        candidateId: 'candidate-id',
        campaignId: 'campaign-id',
        transitioned: false,
      });

    await expect(
      finalizeCommercialPipelineRun(
        finalizerOptions(state, dispatch('SENT')),
      ),
    ).rejects.toThrow('candidate finalization failed');
    expect(state.getRun()).toMatchObject({
      status: 'COMPLETED',
      finalStatus: 'SENT',
      investigationRequired: false,
    });

    await finalizeCommercialPipelineRun(
      finalizerOptions(state, dispatch('SENT')),
    );
    expect(state.getRun()).toMatchObject({
      status: 'COMPLETED',
      finalStatus: 'SENT',
      investigationRequired: false,
    });
  });

  it('converge quando a primeira atualização do run falha após SENT', async () => {
    const state = build();
    state.finalizeByDispatchId.mockRejectedValueOnce(
      new Error('run update failed'),
    );

    await expect(
      finalizeCommercialPipelineRun(
        finalizerOptions(state, dispatch('SENT')),
      ),
    ).rejects.toThrow('run update failed');

    await finalizeCommercialPipelineRun(
      finalizerOptions(state, dispatch('SENT')),
    );
    expect(state.getRun()).toMatchObject({
      status: 'COMPLETED',
      finalStatus: 'SENT',
      investigationRequired: false,
    });
  });

  it('finaliza run legacy sem candidate sem tentar mutar candidato', async () => {
    const state = build();
    state.setPersistedDispatchStatus('SENT');

    await finalizeCommercialPipelineRun({
      runs: state.runs,
      dispatch: dispatch('SENT'),
      failed: false,
      logger: { info: vi.fn(), error: vi.fn() },
      clock: () => now,
    });

    expect(state.getRun()).toMatchObject({
      status: 'COMPLETED',
      finalStatus: 'SENT',
      investigationRequired: false,
    });
  });

  it('nao deixa PROCESSING obsoleto sobrescrever SENT', async () => {
    const state = build();
    state.setRun({
      status: 'COMPLETED',
      finalStatus: 'SENT',
      investigationRequired: false,
    });

    await finalizeCommercialPipelineRun(
      finalizerOptions(state, dispatch('PROCESSING'), true, 'SENT'),
    );

    expect(state.getRun()).toMatchObject({
      status: 'COMPLETED',
      finalStatus: 'SENT',
      investigationRequired: false,
    });
    expect(
      state.promotionCandidates.markBlockedByGeneratedCopyId,
    ).not.toHaveBeenCalled();
  });

  it('nao reabre investigation quando PROCESSING obsoleto chega depois de FAILED seguro', async () => {
    const state = build();
    await finalizeCommercialPipelineRun(
      finalizerOptions(state, dispatch('FAILED'), true, 'FAILED'),
    );

    await finalizeCommercialPipelineRun(
      finalizerOptions(state, dispatch('PROCESSING'), true, 'FAILED'),
    );

    expect(state.getRun()).toMatchObject({
      status: 'FAILED',
      finalStatus: 'FAILED',
      investigationRequired: false,
    });
  });

  it('aceita o vencedor terminal relido depois de perder o CAS', async () => {
    const state = build();
    state.finalizeByDispatchId.mockImplementationOnce(async () => {
      state.setRun({
        status: 'COMPLETED',
        finalStatus: 'SENT',
        investigationRequired: false,
      });
      return { kind: 'SENT', transitioned: false };
    });

    await finalizeCommercialPipelineRun(
      finalizerOptions(state, dispatch('PROCESSING'), true, 'SENT'),
    );

    expect(state.getRun()).toMatchObject({
      status: 'COMPLETED',
      finalStatus: 'SENT',
      investigationRequired: false,
    });
    expect(
      state.promotionCandidates.markDispatchedByGeneratedCopyId,
    ).toHaveBeenCalledOnce();
  });

  it('SENT corrige uma run AMBIGUOUS anterior', async () => {
    const state = build(true);
    state.setRun({
      status: 'FAILED',
      finalStatus: 'AMBIGUOUS',
      investigationRequired: true,
    });

    await finalizeCommercialPipelineRun(
      finalizerOptions(state, dispatch('SENT'), false, 'SENT'),
    );

    expect(state.getRun()).toMatchObject({
      status: 'COMPLETED',
      finalStatus: 'SENT',
      investigationRequired: false,
    });
  });

  it('FAILED seguro nao sobrescreve uma run SENT', async () => {
    const state = build();
    state.setRun({
      status: 'COMPLETED',
      finalStatus: 'SENT',
      investigationRequired: false,
    });

    await finalizeCommercialPipelineRun(
      finalizerOptions(state, dispatch('FAILED'), true, 'FAILED'),
    );

    expect(state.getRun()).toMatchObject({
      status: 'COMPLETED',
      finalStatus: 'SENT',
      investigationRequired: false,
    });
    expect(
      state.promotionCandidates.markBlockedByGeneratedCopyId,
    ).not.toHaveBeenCalled();
  });

  it('libera a reserva somente apos SENT e com o vinculo exato', async () => {
    const state = build(false, 'execution-1');

    await finalizeCommercialPipelineRun(
      finalizerOptions(state, dispatch('SENT')),
    );

    expect(state.findExecutionById).toHaveBeenCalledWith('execution-1');
    expect(
      state.findAttemptContextByGeneratedCopyId,
    ).toHaveBeenCalledWith('copy-id');
    expect(state.promotionCandidates.releaseAttempt).toHaveBeenCalledWith({
      campaignId: 'campaign-id',
      executionId: 'execution-1',
    });
  });

  it('preserva o receiver dos repositories stateful na finalizacao SENT', async () => {
    const state = build(false, 'execution-1');
    const runsWithReceiver = state.runs as typeof state.runs & {
      receiverExecution: { id: string; commercialRunId: string };
    };
    runsWithReceiver.receiverExecution = {
      id: 'execution-1',
      commercialRunId: 'run-id',
    };
    runsWithReceiver.findExecutionById = async function (
      this: typeof runsWithReceiver,
      id: string,
    ) {
      return id === this.receiverExecution.id ? this.receiverExecution : null;
    };

    type StatefulPromotionCandidates = Omit<
      typeof state.promotionCandidates,
      'findAttemptContextByGeneratedCopyId' | 'releaseAttempt'
    > & {
      receiverState: {
        context: CommercialPromotionAttemptContext;
        releaseCalls: number;
      };
      findAttemptContextByGeneratedCopyId: (
        this: StatefulPromotionCandidates,
        generatedCopyId: string,
      ) => Promise<CommercialPromotionAttemptContext>;
      releaseAttempt: (
        this: StatefulPromotionCandidates,
        input: { campaignId: string; executionId: string },
      ) => Promise<{
        kind: 'RELEASED';
        campaignId: string;
        executionId: string;
        released: boolean;
      }>;
    };
    const candidatesWithReceiver = state.promotionCandidates as unknown as StatefulPromotionCandidates;
    candidatesWithReceiver.receiverState = {
      context: {
        kind: 'FOUND',
        candidateId: 'candidate-id',
        campaignId: 'campaign-id',
        attemptExecutionId: 'execution-1',
      },
      releaseCalls: 0,
    };
    candidatesWithReceiver.findAttemptContextByGeneratedCopyId = async function (
      this: StatefulPromotionCandidates,
      generatedCopyId: string,
    ) {
      return generatedCopyId === 'copy-id'
        ? this.receiverState.context
        : ({ kind: 'NONE' } as const);
    };
    candidatesWithReceiver.releaseAttempt = async function (
      this: StatefulPromotionCandidates,
      input: { campaignId: string; executionId: string },
    ) {
      this.receiverState.releaseCalls += 1;
      return {
        kind: 'RELEASED' as const,
        campaignId: input.campaignId,
        executionId: input.executionId,
        released: this.receiverState.releaseCalls === 1,
      };
    };

    await finalizeCommercialPipelineRun(
      finalizerOptions(state, dispatch('SENT')),
    );
    await finalizeCommercialPipelineRun(
      finalizerOptions(state, dispatch('SENT')),
    );

    expect(
      state.promotionCandidates.markDispatchedByGeneratedCopyId,
    ).toHaveBeenCalledTimes(2);
    expect(
      state.promotionCandidates.resetCampaignFailureStateByGeneratedCopyId,
    ).toHaveBeenCalledTimes(2);
    expect(candidatesWithReceiver.receiverState.releaseCalls).toBe(2);
  });
  it('mantem a reserva quando o vinculo da execution diverge do run', async () => {
    const state = build(false, 'execution-1');
    state.findExecutionById.mockResolvedValue({
      id: 'execution-1',
      commercialRunId: 'other-run',
    });

    await finalizeCommercialPipelineRun(
      finalizerOptions(state, dispatch('SENT')),
    );

    expect(state.promotionCandidates.releaseAttempt).not.toHaveBeenCalled();
    expect(
      state.findAttemptContextByGeneratedCopyId,
    ).not.toHaveBeenCalled();
  });

  it('mantem a reserva quando o candidato esta ausente ou ambiguo', async () => {
    const state = build(false, 'execution-1');
    state.findAttemptContextByGeneratedCopyId
      .mockResolvedValueOnce({ kind: 'NONE' })
      .mockResolvedValueOnce({ kind: 'AMBIGUOUS' });

    await finalizeCommercialPipelineRun(
      finalizerOptions(state, dispatch('SENT')),
    );
    await finalizeCommercialPipelineRun(
      finalizerOptions(state, dispatch('SENT')),
    );

    expect(state.promotionCandidates.releaseAttempt).not.toHaveBeenCalled();
  });

  it('nao libera a reserva em FAILED ou PROCESSING', async () => {
    const state = build(false, 'execution-1');

    await finalizeCommercialPipelineRun(
      finalizerOptions(state, dispatch('FAILED'), true),
    );
    await finalizeCommercialPipelineRun(
      finalizerOptions(state, dispatch('PROCESSING'), true),
    );

    expect(state.promotionCandidates.releaseAttempt).not.toHaveBeenCalled();
  });

  it('repete a liberacao de SENT de forma idempotente', async () => {
    const state = build(false, 'execution-1');
    state.promotionCandidates.releaseAttempt
      .mockResolvedValueOnce({
        kind: 'RELEASED',
        campaignId: 'campaign-id',
        executionId: 'execution-1',
        released: true,
      })
      .mockResolvedValueOnce({
        kind: 'RELEASED',
        campaignId: 'campaign-id',
        executionId: 'execution-1',
        released: false,
      });

    await finalizeCommercialPipelineRun(
      finalizerOptions(state, dispatch('SENT')),
    );
    await finalizeCommercialPipelineRun(
      finalizerOptions(state, dispatch('SENT')),
    );

    expect(state.promotionCandidates.releaseAttempt).toHaveBeenCalledTimes(2);
  });

  it('SENT automatizado valida todos os vinculos antes de resetar e liberar', async () => {
    const state = build(false, 'execution-1');

    await finalizeCommercialPipelineRun(
      finalizerOptions(state, dispatch('SENT')),
    );

    expect(
      state.promotionCandidates.resetCampaignFailureStateByGeneratedCopyId,
    ).toHaveBeenCalledWith('copy-id', {
      campaignId: 'campaign-id',
      executionId: 'execution-1',
    });
    expect(state.promotionCandidates.releaseAttempt).toHaveBeenCalledWith({
      campaignId: 'campaign-id',
      executionId: 'execution-1',
    });
    const executionOrder = state.findExecutionById.mock.invocationCallOrder[0];
    const contextOrder =
      state.findAttemptContextByGeneratedCopyId.mock.invocationCallOrder[0];
    const dispatchedOrder =
      state.promotionCandidates.markDispatchedByGeneratedCopyId.mock
        .invocationCallOrder[0];
    const resetOrder =
      state.promotionCandidates.resetCampaignFailureStateByGeneratedCopyId.mock
        .invocationCallOrder[0];
    const releaseOrder =
      state.promotionCandidates.releaseAttempt.mock.invocationCallOrder[0];
    expect(executionOrder).toBeLessThan(contextOrder);
    expect(contextOrder).toBeLessThan(dispatchedOrder);
    expect(dispatchedOrder).toBeLessThan(resetOrder);
    expect(resetOrder).toBeLessThan(releaseOrder);
  });

  it('execution ausente nao reseta nem libera', async () => {
    const state = build(false, 'execution-1');
    state.findExecutionById.mockResolvedValue(null);

    await finalizeCommercialPipelineRun(
      finalizerOptions(state, dispatch('SENT')),
    );

    expect(
      state.promotionCandidates.resetCampaignFailureStateByGeneratedCopyId,
    ).not.toHaveBeenCalled();
    expect(state.promotionCandidates.releaseAttempt).not.toHaveBeenCalled();
  });

  it('commercialRunId divergente nao reseta nem libera', async () => {
    const state = build(false, 'execution-1');
    state.findExecutionById.mockResolvedValue({
      id: 'execution-1',
      commercialRunId: 'other-run',
    });

    await finalizeCommercialPipelineRun(
      finalizerOptions(state, dispatch('SENT')),
    );

    expect(
      state.promotionCandidates.resetCampaignFailureStateByGeneratedCopyId,
    ).not.toHaveBeenCalled();
    expect(state.promotionCandidates.releaseAttempt).not.toHaveBeenCalled();
  });

  it('candidato ausente ou multiplo nao reseta nem libera', async () => {
    const state = build(false, 'execution-1');
    state.findAttemptContextByGeneratedCopyId
      .mockResolvedValueOnce({ kind: 'NONE' })
      .mockResolvedValueOnce({ kind: 'AMBIGUOUS' });

    await finalizeCommercialPipelineRun(
      finalizerOptions(state, dispatch('SENT')),
    );
    await finalizeCommercialPipelineRun(
      finalizerOptions(state, dispatch('SENT')),
    );

    expect(
      state.promotionCandidates.resetCampaignFailureStateByGeneratedCopyId,
    ).not.toHaveBeenCalled();
    expect(state.promotionCandidates.releaseAttempt).not.toHaveBeenCalled();
  });

  it('campaignId divergente nao reseta nem libera', async () => {
    const state = build(false, 'execution-1');
    state.promotionCandidates.markDispatchedByGeneratedCopyId.mockResolvedValue({
      kind: 'DISPATCHED',
      candidateId: 'candidate-id',
      campaignId: 'other-campaign',
      transitioned: true,
    });

    await finalizeCommercialPipelineRun(
      finalizerOptions(state, dispatch('SENT')),
    );

    expect(
      state.promotionCandidates.resetCampaignFailureStateByGeneratedCopyId,
    ).not.toHaveBeenCalled();
    expect(state.promotionCandidates.releaseAttempt).not.toHaveBeenCalled();
  });

  it('owner divergente nao reseta nem libera', async () => {
    const state = build(false, 'execution-1');
    state.findAttemptContextByGeneratedCopyId.mockResolvedValue({
      kind: 'FOUND',
      candidateId: 'candidate-id',
      campaignId: 'campaign-id',
      attemptExecutionId: 'other-execution',
    });

    await finalizeCommercialPipelineRun(
      finalizerOptions(state, dispatch('SENT')),
    );

    expect(
      state.promotionCandidates.resetCampaignFailureStateByGeneratedCopyId,
    ).not.toHaveBeenCalled();
    expect(state.promotionCandidates.releaseAttempt).not.toHaveBeenCalled();
  });

  it('falha durante validacao nao altera estado de falha nem libera', async () => {
    const state = build(false, 'execution-1');
    state.findExecutionById.mockRejectedValue(new Error('validation unavailable'));

    await expect(
      finalizeCommercialPipelineRun(finalizerOptions(state, dispatch('SENT'))),
    ).rejects.toThrow('validation unavailable');

    expect(
      state.promotionCandidates.resetCampaignFailureStateByGeneratedCopyId,
    ).not.toHaveBeenCalled();
    expect(state.promotionCandidates.releaseAttempt).not.toHaveBeenCalled();
  });

  it('run legado preserva reset sem contrato de reserva', async () => {
    const state = build(false, null);

    await finalizeCommercialPipelineRun(
      finalizerOptions(state, dispatch('SENT')),
    );

    expect(
      state.promotionCandidates.resetCampaignFailureStateByGeneratedCopyId,
    ).toHaveBeenCalledWith('copy-id');
    expect(state.findExecutionById).not.toHaveBeenCalled();
    expect(state.promotionCandidates.releaseAttempt).not.toHaveBeenCalled();
  });
  it('run ausente apos SENT nao reseta nem libera', async () => {
    const state = build(false, 'execution-1');
    vi.spyOn(state.runs, 'findByDispatchId').mockResolvedValue(null);

    await finalizeCommercialPipelineRun(
      finalizerOptions(state, dispatch('SENT')),
    );

    expect(
      state.promotionCandidates.resetCampaignFailureStateByGeneratedCopyId,
    ).not.toHaveBeenCalled();
    expect(state.findExecutionById).not.toHaveBeenCalled();
    expect(state.promotionCandidates.releaseAttempt).not.toHaveBeenCalled();
  });});
