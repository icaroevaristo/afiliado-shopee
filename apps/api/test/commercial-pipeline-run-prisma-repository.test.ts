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
