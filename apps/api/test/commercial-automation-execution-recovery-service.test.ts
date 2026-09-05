import { describe, expect, it, vi } from 'vitest';
import { AppError } from '@shopee-auto-affiliate-ai/shared';

import {
  COMMERCIAL_EXECUTION_PREMARKER_RESERVATION_ABANDONED,
  COMMERCIAL_EXECUTION_RECOVERY_AMBIGUOUS,
  COMMERCIAL_OUTBOX_RECONCILIATION_REQUIRED,
  CommercialAutomationExecutionRecoveryService,
} from '../src/commercial-automation-execution-recovery-service';
import type {
  CommercialAutomationExecutionRecord,
  CommercialAutomationExecutionRecoveryContext,
} from '../src/repositories';

const NOW = new Date('2026-07-28T15:00:00.000Z');

const execution = (
  overrides: Partial<CommercialAutomationExecutionRecord> = {},
): CommercialAutomationExecutionRecord => ({
  id: 'execution-1',
  schedulerJobId: 'scheduled-commercial-automation',
  bullMqJobId: 'job-1',
  activeKey: 'commercial-automation',
  ownerId: 'owner-1',
  heartbeatAt: new Date('2026-07-28T14:57:00.000Z'),
  leaseExpiresAt: new Date('2026-07-28T14:59:00.000Z'),
  mode: 'SEND',
  status: 'STARTED',
  externalStage: 'NOT_REACHED',
  reasons: [],
  commercialRunId: null,
  failureCode: null,
  startedAt: new Date('2026-07-28T14:55:00.000Z'),
  completedAt: null,
  ...overrides,
});

const confirmedContext = (
  overrides: Partial<
    NonNullable<CommercialAutomationExecutionRecoveryContext['run']>
  > = {},
): CommercialAutomationExecutionRecoveryContext => ({
  execution: execution({ commercialRunId: 'run-1' }),
  run: {
    id: 'run-1',
    mode: 'CONFIRMED',
    dispatchId: 'dispatch-1',
    jobId: 'job-dispatch-1',
    finalStatus: 'PENDING',
    investigationRequired: false,
    dispatch: { id: 'dispatch-1', status: 'PENDING', attemptCount: 0 },
    outbox: {
      id: 'outbox-1',
      commercialRunId: 'run-1',
      dispatchId: 'dispatch-1',
      jobId: 'job-dispatch-1',
      status: 'PUBLISHED',
      instanceName: null,
      failureCode: null,
      createdAt: NOW,
      publishedAt: NOW,
    },
    ...overrides,
  },
});

const createSubject = (
  initial: CommercialAutomationExecutionRecoveryContext,
  options: {
    jobExists?: boolean;
    jobError?: boolean;
    jobDispatchId?: string;
    jobInstanceName?: string | null;
    preMarkerRecovery?: 'RECOVERED' | 'BLOCKED' | 'ALREADY_RECOVERED';
    preMarkerBlockedReason?:
      | 'RESERVATION_NOT_UNIQUE'
      | 'COPY_ATTEMPT_EVIDENCE'
      | 'CAS_CONFLICT'
      | 'LOOKUP_FAILED';
    preConfirmationRecovery?: 'RECOVERED' | 'BLOCKED' | 'ALREADY_RECOVERED';
    resolvedMinimumIntervalMinutes?: number;
  } = {},
) => {
  let record = { ...initial.execution };
  let mutations = 0;
  const findRecoveryContext = vi.fn(async () => ({
    ...initial,
    execution: { ...record },
  }));
  const recoverStale = vi.fn(
    async (
      _id: string,
      input: {
        status: 'QUEUED' | 'FAILED' | 'AMBIGUOUS';
        failureCode?: string;
        completedAt: Date;
      },
    ) => {
      if (record.status === 'STARTED') {
        mutations += 1;
        record = {
          ...record,
          ...input,
          activeKey: null,
          completedAt: input.completedAt,
        };
      }
      return { ...record };
    },
  );
  const recoverStalePreMarkerReservation = vi.fn(async () => {
    const outcome = options.preMarkerRecovery ?? 'RECOVERED';
    if (outcome === 'BLOCKED') {
      return {
        outcome: 'BLOCKED' as const,
        reason: options.preMarkerBlockedReason ?? 'RESERVATION_NOT_UNIQUE',
      };
    }
    if (outcome === 'ALREADY_RECOVERED') {
      return { outcome: 'ALREADY_RECOVERED' as const, execution: { ...record } };
    }
    if (record.status === 'STARTED') {
      mutations += 1;
      record = {
        ...record,
        activeKey: null,
        status: 'FAILED',
        failureCode: COMMERCIAL_EXECUTION_PREMARKER_RESERVATION_ABANDONED,
        completedAt: NOW,
      };
    }
    return {
      outcome: 'RECOVERED' as const,
      execution: { ...record },
      campaignId: 'campaign-1',
      failureCount: 1,
      nextEligibleAt: new Date('2026-07-28T16:00:00.000Z'),
    };
  });
  const recoverStalePreConfirmationReservation = vi.fn(async () => {
    const outcome = options.preConfirmationRecovery ?? 'RECOVERED';
    if (outcome === 'BLOCKED') {
      return {
        outcome: 'BLOCKED' as const,
        reason: 'RUN_EVIDENCE' as const,
      };
    }
    if (outcome === 'ALREADY_RECOVERED') {
      return { outcome: 'ALREADY_RECOVERED' as const, execution: { ...record } };
    }
    if (record.status === 'STARTED') {
      mutations += 1;
      record = {
        ...record,
        activeKey: null,
        status: 'FAILED',
        failureCode: 'COMMERCIAL_EXECUTION_ABANDONED_SAFE',
        completedAt: NOW,
      };
    }
    return { outcome: 'RECOVERED' as const, execution: { ...record } };
  });
  const findJob = vi.fn(async (jobId: string) => {
    if (options.jobError) throw new Error('redis unavailable');
    return options.jobExists
      ? {
          id: jobId,
          dispatchId: options.jobDispatchId ?? 'dispatch-1',
          instanceName: options.jobInstanceName ?? null,
        }
      : null;
  });
  const resolveMinimumIntervalMinutes =
    options.resolvedMinimumIntervalMinutes === undefined
      ? undefined
      : vi.fn(async () => options.resolvedMinimumIntervalMinutes!);
  const service = new CommercialAutomationExecutionRecoveryService({
    executions: {
      findRecoveryContext,
      recoverStale,
      recoverStalePreMarkerReservation,
      recoverStalePreConfirmationReservation,
    } as never,
    jobs: { findJob },
    clock: () => NOW,
    minimumIntervalMinutes: 60,
    ...(resolveMinimumIntervalMinutes
      ? { resolveMinimumIntervalMinutes }
      : {}),
  });
  return {
    service,
    recoverStale,
    recoverStalePreMarkerReservation,
    recoverStalePreConfirmationReservation,
    findJob,
    resolveMinimumIntervalMinutes,
    getMutations: () => mutations,
  };
};

describe('CommercialAutomationExecutionRecoveryService', () => {
  it('recupera execution stale pre-marker com reserva owned como FAILED seguro', async () => {
    const subject = createSubject({ execution: execution(), run: null });

    await expect(subject.service.recover('execution-1')).resolves.toMatchObject(
      {
        outcome: 'recovered',
        execution: {
          status: 'failed',
          failureCode: COMMERCIAL_EXECUTION_PREMARKER_RESERVATION_ABANDONED,
        },
      },
    );
    expect(subject.recoverStalePreMarkerReservation).toHaveBeenCalledWith(
      'execution-1',
      {
        completedAt: NOW,
        minimumIntervalMinutes: 60,
        failureCode: COMMERCIAL_EXECUTION_PREMARKER_RESERVATION_ABANDONED,
      },
    );
    expect(subject.recoverStale).not.toHaveBeenCalled();
    expect(subject.findJob).not.toHaveBeenCalled();
  });

  it('mantem bloqueio quando a prova pre-marker e ambigua', async () => {
    const subject = createSubject(
      { execution: execution(), run: null },
      {
        preMarkerRecovery: 'BLOCKED',
        preMarkerBlockedReason: 'COPY_ATTEMPT_EVIDENCE',
      },
    );

    await expect(subject.service.recover('execution-1')).resolves.toMatchObject({
      outcome: 'investigation-required',
      reason: 'COPY_ATTEMPT_EVIDENCE',
      execution: { status: 'started' },
    });
    expect(subject.getMutations()).toBe(0);
    expect(subject.recoverStale).not.toHaveBeenCalled();
    expect(subject.findJob).not.toHaveBeenCalled();
  });

  it('mapeia LOOKUP_FAILED pre-marker para investigation-required sem recovery generico', async () => {
    const subject = createSubject(
      { execution: execution(), run: null },
      {
        preMarkerRecovery: 'BLOCKED',
        preMarkerBlockedReason: 'LOOKUP_FAILED',
      },
    );

    await expect(subject.service.recover('execution-1')).resolves.toMatchObject({
      outcome: 'investigation-required',
      reason: 'LOOKUP_FAILED',
      execution: { status: 'started' },
    });
    expect(subject.getMutations()).toBe(0);
    expect(subject.recoverStale).not.toHaveBeenCalled();
    expect(subject.findJob).not.toHaveBeenCalled();
  });
  it('repeticao do recovery pre-marker nao duplica a finalizacao', async () => {
    const subject = createSubject({ execution: execution(), run: null });

    await expect(subject.service.recover('execution-1')).resolves.toMatchObject({
      outcome: 'recovered',
    });
    await expect(subject.service.recover('execution-1')).resolves.toMatchObject({
      outcome: 'already-terminal',
    });

    expect(subject.getMutations()).toBe(1);
    expect(subject.recoverStalePreMarkerReservation).toHaveBeenCalledTimes(1);
  });

  it('resolve o intervalo persistido no momento do recovery pre-marker', async () => {
    const subject = createSubject(
      { execution: execution(), run: null },
      { resolvedMinimumIntervalMinutes: 15 },
    );

    await expect(subject.service.recover('execution-1')).resolves.toMatchObject({
      outcome: 'recovered',
    });
    expect(subject.resolveMinimumIntervalMinutes).toHaveBeenCalledOnce();
    expect(subject.recoverStalePreMarkerReservation).toHaveBeenCalledWith(
      'execution-1',
      {
        completedAt: NOW,
        minimumIntervalMinutes: 15,
        failureCode: COMMERCIAL_EXECUTION_PREMARKER_RESERVATION_ABANDONED,
      },
    );
  });

  it('recupera execution marcada sem run como AMBIGUOUS', async () => {
    const subject = createSubject({
      execution: execution({ externalStage: 'EXTERNAL_MAY_HAVE_STARTED' }),
      run: null,
    });

    await expect(subject.service.recover('execution-1')).resolves.toMatchObject({
      outcome: 'recovered',
      execution: {
        status: 'ambiguous',
        failureCode: COMMERCIAL_EXECUTION_RECOVERY_AMBIGUOUS,
      },
    });
    expect(subject.findJob).not.toHaveBeenCalled();
  });
  it('recupera DRY_RUN sem dispatch, outbox ou job', async () => {
    const context = confirmedContext({
      mode: 'DRY_RUN',
      dispatchId: null,
      jobId: null,
      finalStatus: null,
      dispatch: null,
      outbox: null,
    });
    const subject = createSubject(context);

    await expect(subject.service.recover('execution-1')).resolves.toMatchObject(
      {
        execution: { status: 'failed' },
      },
    );
  });

  it('recupera DRY_RUN sticky sem dispatch, outbox ou job como FAILED seguro', async () => {
    const subject = createSubject({
      execution: execution({
        commercialRunId: 'run-1',
        externalStage: 'EXTERNAL_MAY_HAVE_STARTED',
      }),
      run: {
        ...confirmedContext().run!,
        mode: 'DRY_RUN',
        dispatchId: null,
        jobId: null,
        instanceName: 'instance-a',
        dispatch: null,
        outbox: null,
      },
    });

    await expect(subject.service.recover('execution-1')).resolves.toMatchObject({
      execution: { status: 'failed' },
    });
    expect(subject.findJob).not.toHaveBeenCalled();
    expect(subject.recoverStalePreConfirmationReservation).toHaveBeenCalledWith(
      'execution-1',
      {
        completedAt: NOW,
        failureCode: 'COMMERCIAL_EXECUTION_ABANDONED_SAFE',
      },
    );
  });

  it('exige reconcile para outbox PENDING e nao altera a execucao', async () => {
    const context = confirmedContext({
      jobId: null,
      outbox: {
        ...confirmedContext().run!.outbox!,
        status: 'PENDING',
        publishedAt: null,
      },
    });
    const subject = createSubject(context, { jobExists: false });

    await expect(subject.service.recover('execution-1')).rejects.toMatchObject({
      code: COMMERCIAL_OUTBOX_RECONCILIATION_REQUIRED,
    });
    expect(subject.recoverStale).not.toHaveBeenCalled();
  });

  it('exige reconcile para outbox sticky PENDING sem job', async () => {
    const base = confirmedContext();
    const subject = createSubject({
      execution: execution({
        commercialRunId: 'run-1',
        externalStage: 'EXTERNAL_MAY_HAVE_STARTED',
      }),
      run: {
        ...base.run!,
        instanceName: 'instance-a',
        jobId: null,
        dispatch: {
          ...base.run!.dispatch!,
          instanceName: 'instance-a',
        },
        outbox: {
          ...base.run!.outbox!,
          status: 'PENDING',
          publishedAt: null,
          instanceName: 'instance-a',
        },
      },
    });

    await expect(subject.service.recover('execution-1')).rejects.toMatchObject({
      code: COMMERCIAL_OUTBOX_RECONCILIATION_REQUIRED,
    });
    expect(subject.findJob).toHaveBeenCalledWith('job-dispatch-1');
    expect(subject.recoverStale).not.toHaveBeenCalled();
  });

  it('bloqueia job PENDING de outra instancia como lifecycle divergente', async () => {
    const base = confirmedContext();
    const subject = createSubject(
      {
        execution: execution({
          commercialRunId: 'run-1',
          externalStage: 'EXTERNAL_MAY_HAVE_STARTED',
        }),
        run: {
          ...base.run!,
          instanceName: 'instance-a',
          jobId: null,
          dispatch: {
            ...base.run!.dispatch!,
            instanceName: 'instance-a',
          },
          outbox: {
            ...base.run!.outbox!,
            status: 'PENDING',
            publishedAt: null,
            instanceName: 'instance-a',
          },
        },
      },
      { jobExists: true, jobInstanceName: 'instance-b' },
    );

    await expect(subject.service.recover('execution-1')).rejects.toMatchObject({
      code: 'COMMERCIAL_INSTANCE_LIFECYCLE_MISMATCH',
    });
    expect(subject.recoverStale).not.toHaveBeenCalled();
  });

  it('preserva job divergente de outbox PENDING como AMBIGUOUS', async () => {
    const context = confirmedContext({
      jobId: null,
      outbox: {
        ...confirmedContext().run!.outbox!,
        status: 'PENDING',
        publishedAt: null,
      },
    });
    const subject = createSubject(context, {
      jobExists: true,
      jobDispatchId: 'dispatch-other',
    });

    await expect(subject.service.recover('execution-1')).resolves.toMatchObject(
      {
        execution: { status: 'ambiguous' },
      },
    );
  });

  it('finaliza QUEUED quando outbox PUBLISHED e job deterministico existem', async () => {
    const subject = createSubject(confirmedContext(), { jobExists: true });

    await expect(subject.service.recover('execution-1')).resolves.toMatchObject(
      {
        execution: { status: 'queued' },
      },
    );
    expect(subject.findJob).toHaveBeenCalledWith('job-dispatch-1');
  });

  it.each([
    [
      'dispatch PROCESSING',
      {
        dispatch: {
          id: 'dispatch-1',
          status: 'PROCESSING' as const,
          attemptCount: 1,
        },
      },
    ],
    [
      'outbox AMBIGUOUS',
      {
        outbox: {
          ...confirmedContext().run!.outbox!,
          status: 'AMBIGUOUS' as const,
        },
      },
    ],
    ['identidades inconsistentes', { dispatchId: 'dispatch-other' }],
    [
      'attemptCount maior que zero',
      {
        dispatch: {
          id: 'dispatch-1',
          status: 'PENDING' as const,
          attemptCount: 1,
        },
      },
    ],
  ])('preserva %s como AMBIGUOUS', async (_label, overrides) => {
    const subject = createSubject(confirmedContext(overrides));

    await expect(subject.service.recover('execution-1')).resolves.toMatchObject(
      {
        execution: {
          status: 'ambiguous',
          failureCode: COMMERCIAL_EXECUTION_RECOVERY_AMBIGUOUS,
        },
      },
    );
  });

  it('finaliza FAILED quando o dispatch comprova falha', async () => {
    const subject = createSubject(
      confirmedContext({
        dispatch: { id: 'dispatch-1', status: 'FAILED', attemptCount: 1 },
        finalStatus: 'FAILED',
      }),
    );

    await expect(subject.service.recover('execution-1')).resolves.toMatchObject(
      {
        execution: {
          status: 'failed',
          failureCode: 'COMMERCIAL_EXECUTION_DISPATCH_FAILED',
        },
      },
    );
  });

  it('classifica consulta incerta do job como AMBIGUOUS', async () => {
    const subject = createSubject(confirmedContext(), { jobError: true });

    await expect(subject.service.recover('execution-1')).resolves.toMatchObject(
      {
        execution: { status: 'ambiguous' },
      },
    );
  });

  it('classifica job com dispatch divergente como AMBIGUOUS', async () => {
    const subject = createSubject(confirmedContext(), {
      jobExists: true,
      jobDispatchId: 'dispatch-other',
    });

    await expect(subject.service.recover('execution-1')).resolves.toMatchObject(
      {
        execution: { status: 'ambiguous' },
      },
    );
  });

  it('aceita SENT como QUEUED sem consultar ou criar job', async () => {
    const subject = createSubject(
      confirmedContext({
        finalStatus: 'SENT',
        dispatch: { id: 'dispatch-1', status: 'SENT', attemptCount: 1 },
      }),
    );

    await expect(subject.service.recover('execution-1')).resolves.toMatchObject(
      {
        execution: { status: 'queued' },
      },
    );
    expect(subject.findJob).not.toHaveBeenCalled();
  });

  it('e idempotente sob duas recuperacoes concorrentes', async () => {
    const subject = createSubject({ execution: execution(), run: null });

    const results = await Promise.all([
      subject.service.recover('execution-1'),
      subject.service.recover('execution-1'),
    ]);

    expect(results.map((result) => result.execution.status)).toEqual([
      'failed',
      'failed',
    ]);
    expect(subject.getMutations()).toBe(1);
  });

  it('rejeita execucao ativa e registro terminal permanece idempotente', async () => {
    const active = createSubject({
      execution: execution({
        leaseExpiresAt: new Date('2026-07-28T15:01:00.000Z'),
      }),
      run: null,
    });
    await expect(active.service.recover('execution-1')).rejects.toMatchObject({
      code: 'COMMERCIAL_EXECUTION_NOT_STALE',
    });

    const terminal = createSubject({
      execution: execution({ status: 'FAILED', activeKey: null }),
      run: null,
    });
    await expect(
      terminal.service.recover('execution-1'),
    ).resolves.toMatchObject({
      outcome: 'already-terminal',
      execution: { status: 'failed' },
    });
  });

  it('heartbeat e recovery disputam sem reativar lease vencida', async () => {
    const stale = execution();
    const heartbeat = async () => {
      if (!stale.leaseExpiresAt || stale.leaseExpiresAt <= NOW) {
        throw new AppError(
          'ownership lost',
          'COMMERCIAL_EXECUTION_OWNERSHIP_LOST',
        );
      }
      stale.heartbeatAt = NOW;
    };
    const subject = createSubject({ execution: stale, run: null });

    const [heartbeatResult, recoveryResult] = await Promise.allSettled([
      heartbeat(),
      subject.service.recover('execution-1'),
    ]);

    expect(heartbeatResult.status).toBe('rejected');
    expect(recoveryResult.status).toBe('fulfilled');
    expect(subject.getMutations()).toBe(1);
  });
});
