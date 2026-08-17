import { describe, expect, it, vi } from 'vitest';

import { PrismaCommercialPipelineRunRepository } from '../src/prisma-repositories';

type PersistedRun = {
  id: string;
  dispatchId: string;
  mode: 'CONFIRMED';
  status: 'STARTED' | 'COMPLETED' | 'FAILED';
  finalStatus: 'PENDING' | 'SENT' | 'FAILED' | 'AMBIGUOUS';
  investigationRequired: boolean;
  dispatch: { status: 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED' };
};

const completedAt = new Date('2026-08-11T15:00:00.000Z');

const startingRun = (): PersistedRun => ({
  id: 'run-id',
  dispatchId: 'dispatch-id',
  mode: 'CONFIRMED',
  status: 'STARTED',
  finalStatus: 'PENDING',
  investigationRequired: false,
  dispatch: { status: 'PROCESSING' },
});

const sentRun = (): PersistedRun => ({
  ...startingRun(),
  status: 'COMPLETED',
  finalStatus: 'SENT',
  investigationRequired: false,
  dispatch: { status: 'SENT' },
});

const failedRun = (): PersistedRun => ({
  ...startingRun(),
  status: 'FAILED',
  finalStatus: 'FAILED',
  investigationRequired: false,
  dispatch: { status: 'FAILED' },
});

const ambiguousRun = (): PersistedRun => ({
  ...startingRun(),
  status: 'FAILED',
  finalStatus: 'AMBIGUOUS',
  investigationRequired: true,
});

const clone = (run: PersistedRun): PersistedRun => ({
  ...run,
  dispatch: { ...run.dispatch },
});

const matchesCas = (where: Record<string, unknown>, run: PersistedRun) => {
  if (
    where.id !== run.id ||
    where.dispatchId !== run.dispatchId ||
    where.mode !== run.mode
  ) {
    return false;
  }
  if (where.status) return where.status === run.status;

  const alternatives = where.OR as Array<Record<string, unknown>> | undefined;
  return (
    !alternatives ||
    alternatives.some((alternative) =>
      Object.entries(alternative).every(
        ([key, value]) => run[key as keyof PersistedRun] === value,
      ),
    )
  );
};

const build = (
  initial: PersistedRun,
  beforeFirstCas?: (replace: (run: PersistedRun) => void) => void,
) => {
  let current = clone(initial);
  let casCount = 0;
  const findUnique = vi.fn(async () => clone(current));
  const updateMany = vi.fn(async ({ where, data }: Record<string, unknown>) => {
    casCount += 1;
    if (casCount === 1) beforeFirstCas?.((run) => (current = clone(run)));
    if (!matchesCas(where as Record<string, unknown>, current)) {
      return { count: 0 };
    }
    current = { ...current, ...(data as Partial<PersistedRun>) };
    return { count: 1 };
  });
  const repository = new PrismaCommercialPipelineRunRepository({
    commercialPipelineRun: { findUnique, updateMany },
  } as never);

  return { repository, findUnique, getRun: () => current, updateMany };
};

describe('PrismaCommercialPipelineRunRepository.finalizeByDispatchId', () => {
  it('does not let stale PROCESSING overwrite SENT', async () => {
    const state = build(startingRun(), (replace) => replace(sentRun()));

    await expect(
      state.repository.finalizeByDispatchId('dispatch-id', completedAt),
    ).resolves.toEqual({ kind: 'SENT', transitioned: false });
    expect(state.getRun()).toMatchObject(sentRun());
  });

  it('does not reopen investigation when stale PROCESSING follows a safe FAILED', async () => {
    const state = build(startingRun(), (replace) => replace(failedRun()));

    await expect(
      state.repository.finalizeByDispatchId('dispatch-id', completedAt),
    ).resolves.toEqual({ kind: 'FAILED', transitioned: false });
    expect(state.getRun()).toMatchObject(failedRun());
  });

  it('re-reads and converges on the terminal winner after a lost CAS', async () => {
    const state = build(startingRun(), (replace) => replace(sentRun()));

    const result = await state.repository.finalizeByDispatchId(
      'dispatch-id',
      completedAt,
    );

    expect(result).toEqual({ kind: 'SENT', transitioned: false });
    expect(state.findUnique).toHaveBeenCalledTimes(2);
    expect(state.getRun()).toMatchObject(sentRun());
  });

  it('lets SENT correct a prior AMBIGUOUS run', async () => {
    const state = build({
      ...ambiguousRun(),
      dispatch: { status: 'SENT' },
    });

    await expect(
      state.repository.finalizeByDispatchId('dispatch-id', completedAt),
    ).resolves.toEqual({ kind: 'SENT', transitioned: true });
    expect(state.getRun()).toMatchObject(sentRun());
  });

  it('does not let safe FAILED overwrite SENT', async () => {
    const state = build({
      ...sentRun(),
      dispatch: { status: 'FAILED' },
    });

    await expect(
      state.repository.finalizeByDispatchId('dispatch-id', completedAt),
    ).resolves.toEqual({ kind: 'SENT', transitioned: false });
    expect(state.getRun()).toMatchObject({
      status: 'COMPLETED',
      finalStatus: 'SENT',
      investigationRequired: false,
    });
    expect(state.updateMany).not.toHaveBeenCalled();
  });

  it('lets a safe FAILED repair AMBIGUOUS after its first CAS loses', async () => {
    const state = build(startingRun(), (replace) =>
      replace({ ...ambiguousRun(), dispatch: { status: 'FAILED' } }),
    );

    await expect(
      state.repository.finalizeByDispatchId('dispatch-id', completedAt),
    ).resolves.toEqual({ kind: 'FAILED', transitioned: true });
    expect(state.getRun()).toMatchObject(failedRun());
    expect(state.updateMany).toHaveBeenCalledTimes(2);
  });

  it('rejects a non-canonical run after bounded CAS attempts', async () => {
    const state = build({
      ...startingRun(),
      status: 'COMPLETED',
      finalStatus: 'PENDING',
      investigationRequired: false,
    });

    await expect(
      state.repository.finalizeByDispatchId('dispatch-id', completedAt),
    ).rejects.toMatchObject({
      code: 'COMMERCIAL_PIPELINE_RUN_FINALIZATION_CONFLICT',
    });

    expect(state.findUnique).toHaveBeenCalledTimes(2);
    expect(state.updateMany).toHaveBeenCalledTimes(2);
    expect(state.getRun()).toMatchObject({
      status: 'COMPLETED',
      finalStatus: 'PENDING',
      investigationRequired: false,
      dispatch: { status: 'PROCESSING' },
    });
  });
});

const runData = (executionId: string | null = null) => ({
  mode: 'DRY_RUN' as const,
  status: 'STARTED' as const,
  executionId,
  candidateCount: 0,
  eligibleCount: 0,
  rejectedCount: 0,
  rejectionSummary: {},
  selectionReasons: [],
  plannedSubIds: [],
  createdAt: new Date('2026-08-14T12:00:00.000Z'),
  completedAt: null,
});

const persistedRun = (executionId: string | null = null) => ({
  ...runData(executionId),
  id: 'run-id',
  createdAt: new Date('2026-08-14T12:00:00.000Z'),
});

describe('PrismaCommercialPipelineRunRepository.executionId', () => {
  it('persists executionId when creating an automated run', async () => {
    const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) =>
      persistedRun(data.executionId as string | null));
    const repository = new PrismaCommercialPipelineRunRepository({
      commercialPipelineRun: { create },
    } as never);

    const result = await repository.create(runData('execution-1'));

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ executionId: 'execution-1' }),
    });
    expect(result.executionId).toBe('execution-1');
  });

  it('translates an execution uniqueness conflict without reassociating a run', async () => {
    const create = vi.fn(async () => {
      throw { code: 'P2002' };
    });
    const repository = new PrismaCommercialPipelineRunRepository({
      commercialPipelineRun: { create },
    } as never);

    await expect(repository.create(runData('execution-1'))).rejects.toMatchObject({
      code: 'COMMERCIAL_PIPELINE_RUN_EXECUTION_CONFLICT',
    });
  });

  it('rejects attaching an execution after a legacy run was created', async () => {
    const findUnique = vi.fn(async () => ({ executionId: null }));
    const update = vi.fn();
    const repository = new PrismaCommercialPipelineRunRepository({
      commercialPipelineRun: { findUnique, update },
    } as never);

    await expect(
      repository.update('run-id', { executionId: 'execution-1' }),
    ).rejects.toMatchObject({
      code: 'COMMERCIAL_PIPELINE_RUN_EXECUTION_LINK_IMMUTABLE',
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects reassociating an automated run to another execution', async () => {
    const findUnique = vi.fn(async () => ({ executionId: 'execution-1' }));
    const update = vi.fn();
    const repository = new PrismaCommercialPipelineRunRepository({
      commercialPipelineRun: { findUnique, update },
    } as never);

    await expect(
      repository.update('run-id', { executionId: 'execution-2' }),
    ).rejects.toMatchObject({
      code: 'COMMERCIAL_PIPELINE_RUN_EXECUTION_LINK_IMMUTABLE',
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('allows an idempotent update with the same execution', async () => {
    const findUnique = vi.fn(async () => ({ executionId: 'execution-1' }));
    const update = vi.fn(async () => persistedRun('execution-1'));
    const repository = new PrismaCommercialPipelineRunRepository({
      commercialPipelineRun: { findUnique, update },
    } as never);

    await expect(
      repository.update('run-id', { executionId: 'execution-1' }),
    ).resolves.toMatchObject({ executionId: 'execution-1' });
    expect(update).toHaveBeenCalledOnce();
  });
});
