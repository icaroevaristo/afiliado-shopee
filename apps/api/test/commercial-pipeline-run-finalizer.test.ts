import { describe, expect, it, vi } from 'vitest';

import { finalizeCommercialPipelineRun } from '../src/commercial-pipeline-run-finalizer';
import type {
  CommercialPipelineRunRecord,
  CommercialPipelineRunFinalizationKind,
  CommercialPipelineRunRepository,
  CommercialPipelineRunFinalizationRepository,
  WhatsAppDispatchRecord,
} from '../src/repositories';

const now = new Date('2026-07-25T23:00:00.000Z');

const build = (investigationRequired = false) => {
  let run: CommercialPipelineRunRecord = {
    id: 'run-id',
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
  const runs = {
    create: vi.fn(),
    list: vi.fn(),
    findById: vi.fn(),
    findByDispatchId: async (id: string) => (id === 'dispatch-id' ? run : null),
    update,
    finalizeByDispatchId,
  } as CommercialPipelineRunRepository &
    CommercialPipelineRunFinalizationRepository;
  const markDispatchedByGeneratedCopyId = vi.fn(async () => ({
    kind: 'DISPATCHED' as const,
    candidateId: 'candidate-id',
    transitioned: true,
  }));
  const markBlockedByGeneratedCopyId = vi.fn(async () => ({
    kind: 'BLOCKED' as const,
    candidateId: 'candidate-id',
    transitioned: true,
  }));
  const promotionCandidates = {
    markDispatchedByGeneratedCopyId,
    markBlockedByGeneratedCopyId,
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
        transitioned: true,
      })
      .mockResolvedValueOnce({
        kind: 'DISPATCHED',
        candidateId: 'candidate-id',
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
});
