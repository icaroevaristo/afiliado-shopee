import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@shopee-auto-affiliate-ai/shared';

import {
  COMMERCIAL_AUTOMATION_CANDIDATE_FLOW_REQUIRED,
  COMMERCIAL_AUTOMATION_OFFICIAL_PROVIDER_REQUIRED,
  CommercialAutomationOrchestrator,
} from '../src/commercial-automation-orchestrator';
import { COMMERCIAL_EXECUTION_OWNERSHIP_LOST } from '../src/commercial-automation-execution-domain';
import { COMMERCIAL_EXECUTION_IN_PROGRESS } from '../src/commercial-automation-policy-service';
import type {
  CommercialAutomationExecutionRecord,
  CommercialAutomationExecutionRepository,
  CommercialAutomationExecutionStatus,
  CommercialAutomationTarget,
} from '../src/repositories';

const NOW = new Date('2026-07-26T15:00:00.000Z');

class MemoryExecutions implements CommercialAutomationExecutionRepository {
  records: CommercialAutomationExecutionRecord[] = [];
  concurrent = false;
  concurrentStale = false;
  heartbeatCalls = 0;
  loseAfterHeartbeats: number | null = null;

  async start(input: {
    schedulerJobId: string;
    bullMqJobId?: string;
    mode: 'PREVIEW' | 'SEND';
    startedAt: Date;
    ownerId: string;
    heartbeatAt: Date;
    leaseExpiresAt: Date;
  }) {
    const existing = this.records.find(
      (record) => input.bullMqJobId && record.bullMqJobId === input.bullMqJobId,
    );
    if (existing) return { outcome: 'existing' as const, execution: existing };
    if (this.concurrent) {
      return {
        outcome: 'concurrent' as const,
        stale: this.concurrentStale,
      };
    }
    const execution: CommercialAutomationExecutionRecord = {
      id: `execution-${this.records.length + 1}`,
      schedulerJobId: input.schedulerJobId,
      bullMqJobId: input.bullMqJobId ?? null,
      activeKey: 'commercial-automation',
      ownerId: input.ownerId,
      heartbeatAt: input.heartbeatAt,
      leaseExpiresAt: input.leaseExpiresAt,
      mode: input.mode,
      status: 'STARTED',
      reasons: [],
      commercialRunId: null,
      failureCode: null,
      startedAt: input.startedAt,
      completedAt: null,
    };
    this.records.push(execution);
    return {
      outcome: 'created' as const,
      execution,
      ownership: { executionId: execution.id, ownerId: input.ownerId },
    };
  }

  async createBlocked(input: {
    schedulerJobId: string;
    bullMqJobId?: string;
    mode: 'PREVIEW' | 'SEND';
    reasons: string[];
    completedAt: Date;
  }) {
    const execution: CommercialAutomationExecutionRecord = {
      id: `execution-${this.records.length + 1}`,
      schedulerJobId: input.schedulerJobId,
      bullMqJobId: input.bullMqJobId ?? null,
      activeKey: null,
      ownerId: null,
      heartbeatAt: null,
      leaseExpiresAt: null,
      mode: input.mode,
      status: 'BLOCKED',
      reasons: input.reasons,
      commercialRunId: null,
      failureCode: null,
      startedAt: input.completedAt,
      completedAt: input.completedAt,
    };
    this.records.push(execution);
    return execution;
  }

  async heartbeat(
    ownership: { executionId: string; ownerId: string },
    input: { heartbeatAt: Date; leaseExpiresAt: Date },
  ) {
    this.heartbeatCalls += 1;
    const record = this.records.find(
      (candidate) => candidate.id === ownership.executionId,
    );
    if (
      !record ||
      record.status !== 'STARTED' ||
      record.ownerId !== ownership.ownerId ||
      !record.leaseExpiresAt ||
      record.leaseExpiresAt <= input.heartbeatAt ||
      (this.loseAfterHeartbeats !== null &&
        this.heartbeatCalls > this.loseAfterHeartbeats)
    ) {
      throw new AppError('ownership lost', COMMERCIAL_EXECUTION_OWNERSHIP_LOST);
    }
    record.heartbeatAt = input.heartbeatAt;
    record.leaseExpiresAt = input.leaseExpiresAt;
  }

  async finish(
    ownership: { executionId: string; ownerId: string },
    input: {
      status: Exclude<CommercialAutomationExecutionStatus, 'STARTED'>;
      reasons?: string[];
      commercialRunId?: string;
      failureCode?: string;
      completedAt: Date;
    },
  ) {
    const index = this.records.findIndex(
      (record) => record.id === ownership.executionId,
    );
    if (
      index < 0 ||
      this.records[index].ownerId !== ownership.ownerId ||
      !this.records[index].leaseExpiresAt ||
      this.records[index].leaseExpiresAt! <= input.completedAt
    ) {
      throw new AppError('ownership lost', COMMERCIAL_EXECUTION_OWNERSHIP_LOST);
    }
    this.records[index] = {
      ...this.records[index],
      ...input,
      reasons: input.reasons ?? this.records[index].reasons,
      commercialRunId:
        input.commercialRunId ?? this.records[index].commercialRunId,
      failureCode: input.failureCode ?? this.records[index].failureCode,
      activeKey: null,
    };
    return this.records[index];
  }

  async list() {
    return { items: this.records, total: this.records.length };
  }

  async findById(id: string) {
    return this.records.find((record) => record.id === id) ?? null;
  }

  async findRecoveryContext() {
    return null;
  }

  async recoverStale(): Promise<CommercialAutomationExecutionRecord> {
    throw new Error('not used');
  }
}

const createSubject = ({
  withCandidateFlow = true,
  targets,
}: {
  withCandidateFlow?: boolean;
  targets?: CommercialAutomationTarget[];
} = {}) => {
  const resolvedTargets: CommercialAutomationTarget[] = targets ?? [
    {
      groupId: 'group-1',
      groupName: 'Grupo 1',
      logicalGroupFingerprint: 'grp_aaaaaaaaaaaa',
      campaignId: 'campaign-1',
      nicheId: 'niche-1',
    },
  ];
  const executions = new MemoryExecutions();
  const policy = {
    evaluateAutomationReadiness: vi.fn(async () => ({
      allowed: true,
      reasons: [] as string[],
    })),
  };
  const syncOffers = { run: vi.fn(async () => ({ synced: 1 })) };
  const pipeline = {
    dryRun: vi.fn(async () => ({ runId: 'run-1' })),
  };
  const candidateFlow = {
    listTargets: vi.fn(async () => resolvedTargets),
    prepare: vi.fn(async (target?: CommercialAutomationTarget) => ({
      runId: 'run-1',
      generatedCopyId: 'ai-copy-1',
      candidateId: 'candidate-1',
      campaignId: target?.campaignId ?? 'campaign-1',
      groupId: target?.groupId ?? 'group-1',
      logicalGroupFingerprint:
        target?.logicalGroupFingerprint ?? 'grp_aaaaaaaaaaaa',
      nicheId: target?.nicheId ?? 'niche-1',
    })),
    revalidate: vi.fn(async () => undefined),
  };
  const confirmation = { confirm: vi.fn(async () => ({ status: 'queued' })) };
  const commercialRuns = {
    findById: vi.fn(
      async (): Promise<{
        finalStatus: 'AMBIGUOUS' | null;
        investigationRequired: boolean;
      }> => ({
        finalStatus: null,
        investigationRequired: false,
      }),
    ),
  };
  const logger = { info: vi.fn(), error: vi.fn() };
  const orchestrator = new CommercialAutomationOrchestrator({
    policy: policy as never,
    syncOffers,
    pipeline: pipeline as never,
    ...(withCandidateFlow ? { candidateFlow } : {}),
    confirmation: confirmation as never,
    commercialRuns: commercialRuns as never,
    executions,
    logger,
    clock: () => NOW,
    leaseSeconds: 120,
    heartbeatSeconds: 30,
    ownerIdFactory: () => 'owner-1',
  });
  return {
    orchestrator,
    executions,
    policy,
    syncOffers,
    pipeline,
    candidateFlow,
    confirmation,
    commercialRuns,
  };
};

const tick = {
  schedulerJobId: 'scheduled-commercial-automation',
  bullMqJobId: 'bull-job-1',
  mode: 'preview' as const,
  provider: 'mock' as const,
};

describe('CommercialAutomationOrchestrator', () => {
  afterEach(() => vi.restoreAllMocks());

  it('cria ownership, lease e encerra o timer depois do tick', async () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const subject = createSubject();

    await subject.orchestrator.executeTick(tick);

    expect(subject.executions.records[0]).toMatchObject({
      ownerId: 'owner-1',
      heartbeatAt: NOW,
      leaseExpiresAt: new Date('2026-07-26T15:02:00.000Z'),
      activeKey: null,
    });
    expect(subject.executions.heartbeatCalls).toBe(2);
    expect(clearIntervalSpy).toHaveBeenCalled();
  });
  it('registra BLOCKED e nao sincroniza nem executa pipeline quando o guardrail bloqueia', async () => {
    const subject = createSubject();
    subject.policy.evaluateAutomationReadiness.mockResolvedValue({
      allowed: false,
      reasons: ['AUTOMATION_PAUSED'],
    });

    await expect(subject.orchestrator.executeTick(tick)).resolves.toMatchObject(
      {
        status: 'blocked',
        reasons: ['AUTOMATION_PAUSED'],
        dispatchCreated: false,
        whatsappJobCreated: false,
        messageSent: false,
      },
    );
    expect(subject.syncOffers.run).not.toHaveBeenCalled();
    expect(subject.pipeline.dryRun).not.toHaveBeenCalled();
    expect(subject.confirmation.confirm).not.toHaveBeenCalled();
  });

  it('bloqueia um segundo tick quando existe execucao concorrente', async () => {
    const subject = createSubject();
    subject.executions.concurrent = true;

    await expect(subject.orchestrator.executeTick(tick)).resolves.toMatchObject(
      {
        status: 'blocked',
        reasons: [COMMERCIAL_EXECUTION_IN_PROGRESS],
      },
    );
    expect(subject.policy.evaluateAutomationReadiness).not.toHaveBeenCalled();
  });

  it('separa concorrencia stale de execucao ativa', async () => {
    const subject = createSubject();
    subject.executions.concurrent = true;
    subject.executions.concurrentStale = true;

    await expect(subject.orchestrator.executeTick(tick)).resolves.toMatchObject(
      { reasons: ['STALE_COMMERCIAL_EXECUTION_EXISTS'] },
    );
  });

  it('sincroniza e executa exatamente um dry-run no modo preview sem confirmar', async () => {
    const subject = createSubject();

    await expect(subject.orchestrator.executeTick(tick)).resolves.toMatchObject(
      {
        status: 'preview-ready',
        commercialRunId: 'run-1',
        dispatchCreated: false,
        whatsappJobCreated: false,
        messageSent: false,
      },
    );
    expect(subject.syncOffers.run).toHaveBeenCalledOnce();
    expect(subject.pipeline.dryRun).toHaveBeenCalledOnce();
    expect(subject.pipeline.dryRun).toHaveBeenCalledWith({
      source: 'MOCK',
      campaign: 'commercial-automation',
      target: {
        groupId: 'group-1',
        groupName: 'Grupo 1',
        logicalGroupFingerprint: 'grp_aaaaaaaaaaaa',
        campaignId: 'campaign-1',
        nicheId: 'niche-1',
      },
    });
    expect(subject.confirmation.confirm).not.toHaveBeenCalled();
  });

  it.each(['mock', 'manual'] as const)(
    'bloqueia send com provider %s antes do sync',
    async (provider) => {
      const subject = createSubject();

      await expect(
        subject.orchestrator.executeTick({
          ...tick,
          mode: 'send',
          provider,
        }),
      ).resolves.toMatchObject({
        status: 'blocked',
        reasons: [COMMERCIAL_AUTOMATION_OFFICIAL_PROVIDER_REQUIRED],
      });
      expect(subject.syncOffers.run).not.toHaveBeenCalled();
      expect(subject.pipeline.dryRun).not.toHaveBeenCalled();
      expect(subject.confirmation.confirm).not.toHaveBeenCalled();
    },
  );

  it('bloqueia send sem candidate flow em vez de cair no pipeline legacy', async () => {
    const subject = createSubject({ withCandidateFlow: false });

    await expect(
      subject.orchestrator.executeTick({
        ...tick,
        mode: 'send',
        provider: 'official',
      }),
    ).resolves.toMatchObject({
      status: 'blocked',
      reasons: [COMMERCIAL_AUTOMATION_CANDIDATE_FLOW_REQUIRED],
    });
    expect(subject.syncOffers.run).not.toHaveBeenCalled();
    expect(subject.pipeline.dryRun).not.toHaveBeenCalled();
  });

  it('confirma uma unica vez no modo send official totalmente mockado', async () => {
    const subject = createSubject();

    await expect(
      subject.orchestrator.executeTick({
        ...tick,
        mode: 'send',
        provider: 'official',
      }),
    ).resolves.toMatchObject({
      status: 'queued',
      dispatchCreated: true,
      whatsappJobCreated: true,
      messageSent: false,
    });
    expect(subject.pipeline.dryRun).not.toHaveBeenCalled();
    expect(subject.candidateFlow.prepare).toHaveBeenCalledOnce();
    expect(subject.candidateFlow.revalidate).toHaveBeenCalledOnce();
    expect(subject.confirmation.confirm).toHaveBeenCalledWith(
      'run-1',
      expect.any(String),
      { existingGeneratedCopyId: 'ai-copy-1' },
    );
    expect(subject.confirmation.confirm).toHaveBeenCalledOnce();
  });

  it('nao duplica execucao nem efeitos para a mesma job ID', async () => {
    const subject = createSubject();
    const first = await subject.orchestrator.executeTick(tick);
    const second = await subject.orchestrator.executeTick(tick);

    expect(second).toEqual(first);
    expect(subject.executions.records).toHaveLength(1);
    expect(subject.syncOffers.run).toHaveBeenCalledOnce();
    expect(subject.pipeline.dryRun).toHaveBeenCalledOnce();
  });

  it('nao conclui como sucesso uma reentrega cuja execucao continua STARTED', async () => {
    const subject = createSubject();
    subject.executions.records.push({
      id: 'execution-started',
      schedulerJobId: tick.schedulerJobId,
      bullMqJobId: tick.bullMqJobId,
      activeKey: 'commercial-automation',
      ownerId: 'owner-existing',
      heartbeatAt: NOW,
      leaseExpiresAt: new Date('2026-07-26T15:02:00.000Z'),
      mode: 'PREVIEW',
      status: 'STARTED',
      reasons: [],
      commercialRunId: null,
      failureCode: null,
      startedAt: NOW,
      completedAt: null,
    });

    await expect(subject.orchestrator.executeTick(tick)).rejects.toMatchObject({
      code: COMMERCIAL_EXECUTION_IN_PROGRESS,
    });
    expect(subject.syncOffers.run).not.toHaveBeenCalled();
  });

  it('interrompe a proxima etapa ao perder ownership', async () => {
    const subject = createSubject();
    subject.executions.loseAfterHeartbeats = 1;

    await expect(subject.orchestrator.executeTick(tick)).rejects.toMatchObject({
      code: COMMERCIAL_EXECUTION_OWNERSHIP_LOST,
    });
    expect(subject.syncOffers.run).toHaveBeenCalledOnce();
    expect(subject.pipeline.dryRun).not.toHaveBeenCalled();
    expect(subject.executions.records[0].status).toBe('STARTED');
  });

  it('finaliza FAILED quando a sincronizacao falha antes do dry-run', async () => {
    const subject = createSubject();
    subject.syncOffers.run.mockRejectedValue(new Error('offline'));

    await expect(subject.orchestrator.executeTick(tick)).resolves.toMatchObject(
      {
        status: 'failed',
        commercialRunId: null,
      },
    );
    expect(subject.pipeline.dryRun).not.toHaveBeenCalled();
  });

  it('finaliza AMBIGUOUS quando a confirmacao entra em estado incerto', async () => {
    const subject = createSubject();
    subject.confirmation.confirm.mockRejectedValue(new Error('timeout'));
    subject.commercialRuns.findById.mockResolvedValue({
      finalStatus: 'AMBIGUOUS',
      investigationRequired: true,
    });

    await expect(
      subject.orchestrator.executeTick({
        ...tick,
        mode: 'send',
        provider: 'official',
      }),
    ).resolves.toMatchObject({
      status: 'ambiguous',
      commercialRunId: 'run-1',
    });
    expect(subject.confirmation.confirm).toHaveBeenCalledOnce();
  });

  it('finaliza FAILED quando a confirmacao falha antes de criar estado incerto', async () => {
    const subject = createSubject();
    subject.confirmation.confirm.mockRejectedValue(
      new AppError('Produto mudou', 'COMMERCIAL_PRODUCT_CHANGED'),
    );

    await expect(
      subject.orchestrator.executeTick({
        ...tick,
        mode: 'send',
        provider: 'official',
      }),
    ).resolves.toMatchObject({
      status: 'failed',
    });
  });

  it('reavalia guardrails imediatamente antes de confirmar', async () => {
    const subject = createSubject();
    subject.policy.evaluateAutomationReadiness
      .mockResolvedValueOnce({ allowed: true, reasons: [] })
      .mockResolvedValueOnce({ allowed: true, reasons: [] })
      .mockResolvedValueOnce({
        allowed: false,
        reasons: ['AUTOMATION_PAUSED'],
      });

    await expect(
      subject.orchestrator.executeTick({
        ...tick,
        mode: 'send',
        provider: 'official',
      }),
    ).resolves.toMatchObject({
      status: 'blocked',
      reasons: ['AUTOMATION_PAUSED'],
      commercialRunId: 'run-1',
    });
    expect(subject.confirmation.confirm).not.toHaveBeenCalled();
  });

  it('avalia targets em ordem e confirma somente o primeiro permitido', async () => {
    const targets: CommercialAutomationTarget[] = [
      {
        groupId: 'group-a',
        groupName: 'Grupo A',
        logicalGroupFingerprint: 'grp_aaaaaaaaaaaa',
        campaignId: 'campaign-a',
        nicheId: 'niche-a',
      },
      {
        groupId: 'group-b',
        groupName: 'Grupo B',
        logicalGroupFingerprint: 'grp_bbbbbbbbbbbb',
        campaignId: 'campaign-b',
        nicheId: 'niche-b',
      },
    ];
    const subject = createSubject({ targets });
    subject.policy.evaluateAutomationReadiness.mockImplementation(
      async (input?: { target?: CommercialAutomationTarget }) =>
        input?.target?.groupId === 'group-a'
          ? { allowed: false, reasons: ['MINIMUM_INTERVAL_NOT_REACHED'] }
          : { allowed: true, reasons: [] },
    );

    await expect(
      subject.orchestrator.executeTick({
        ...tick,
        mode: 'send',
        provider: 'official',
      }),
    ).resolves.toMatchObject({ status: 'queued' });

    expect(subject.syncOffers.run).toHaveBeenCalledOnce();
    expect(subject.candidateFlow.prepare).toHaveBeenCalledWith(targets[1]);
    expect(subject.candidateFlow.prepare).toHaveBeenCalledOnce();
    expect(subject.candidateFlow.revalidate).toHaveBeenCalledWith(
      expect.objectContaining({
        groupId: 'group-b',
        campaignId: 'campaign-b',
      }),
    );
    expect(subject.confirmation.confirm).toHaveBeenCalledOnce();
  });

  it('nao tenta o proximo target depois que a preparacao inicia e falha', async () => {
    const targets: CommercialAutomationTarget[] = [
      {
        groupId: 'group-a',
        groupName: 'Grupo A',
        logicalGroupFingerprint: 'grp_aaaaaaaaaaaa',
        campaignId: 'campaign-a',
        nicheId: 'niche-a',
      },
      {
        groupId: 'group-b',
        groupName: 'Grupo B',
        logicalGroupFingerprint: 'grp_bbbbbbbbbbbb',
        campaignId: 'campaign-b',
        nicheId: 'niche-b',
      },
    ];
    const subject = createSubject({ targets });
    subject.candidateFlow.prepare.mockRejectedValue(
      new AppError('Falha na geração de copy', 'COMMERCIAL_AI_COPY_FAILED'),
    );

    await expect(
      subject.orchestrator.executeTick({
        ...tick,
        mode: 'send',
        provider: 'official',
      }),
    ).resolves.toMatchObject({ status: 'failed' });

    expect(subject.candidateFlow.prepare).toHaveBeenCalledWith(targets[0]);
    expect(subject.candidateFlow.prepare).toHaveBeenCalledOnce();
    expect(subject.confirmation.confirm).not.toHaveBeenCalled();
  });

  it('passa um unico target deterministico ao preview sem confirmar', async () => {
    const targets: CommercialAutomationTarget[] = [
      {
        groupId: 'group-a',
        groupName: 'Grupo A',
        logicalGroupFingerprint: 'grp_aaaaaaaaaaaa',
        campaignId: 'campaign-a',
        nicheId: 'niche-a',
      },
      {
        groupId: 'group-b',
        groupName: 'Grupo B',
        logicalGroupFingerprint: 'grp_bbbbbbbbbbbb',
        campaignId: 'campaign-b',
        nicheId: 'niche-b',
      },
    ];
    const subject = createSubject({ targets });

    await expect(subject.orchestrator.executeTick(tick)).resolves.toMatchObject({
      status: 'preview-ready',
    });
    expect(subject.pipeline.dryRun).toHaveBeenCalledWith({
      source: 'MOCK',
      campaign: 'commercial-automation',
      target: targets[0],
    });
    expect(subject.candidateFlow.prepare).not.toHaveBeenCalled();
    expect(subject.confirmation.confirm).not.toHaveBeenCalled();
  });
});
