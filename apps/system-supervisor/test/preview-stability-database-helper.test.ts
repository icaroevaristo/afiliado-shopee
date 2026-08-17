import { MigrationBaselineSubstageError } from '@shopee-auto-affiliate-ai/database';
import { describe, expect, it, vi } from 'vitest';

import {
  CAPTURE_STAGES,
  createDatabaseHelperFailureDiagnostic,
  emitDatabaseHelperFailure,
  serializeDatabaseHelperSuccess,
  withCaptureStage,
} from '../src/preview-stability-database-helper';

const diagnosticForStage = async (
  captureStage: (typeof CAPTURE_STAGES)[number],
  error: unknown,
) => {
  try {
    await withCaptureStage(captureStage, async () => {
      throw error;
    });
    throw new Error('expected staged failure');
  } catch (stagedError: unknown) {
    return createDatabaseHelperFailureDiagnostic('capture', stagedError);
  }
};

const diagnosticForMigrationSubstage = async (
  substage: 'inspect' | 'diff',
  cause: unknown,
) =>
  diagnosticForStage(
    'migrations',
    new MigrationBaselineSubstageError(substage, cause),
  );

describe('preview stability database helper diagnostics', () => {
  it('keeps the exact stable capture-stage allowlist', () => {
    expect(CAPTURE_STAGES).toEqual([
      'migrations',
      'settings',
      'executions',
      'runs-total',
      'runs-dry-run',
      'runs-ambiguous',
      'runs-investigation',
      'dispatch-total',
      'dispatch-processing',
      'outbox-total',
      'outbox-pending',
      'outbox-ambiguous',
      'table-counts',
    ]);
  });

  it.each(CAPTURE_STAGES)(
    'preserves captureStage=%s for a synthetic failure',
    async (captureStage) => {
      const diagnostic = await diagnosticForStage(
        captureStage,
        new Error('sensitive message must not be emitted'),
      );
      expect(diagnostic).toEqual({
        code: 'PREVIEW_STABILITY_DATABASE_HELPER_FAILED',
        operation: 'capture',
        captureStage,
        errorKind: 'UNKNOWN',
        failed: true,
      });
    },
  );

  it('classifies Prisma validation errors without raw details', async () => {
    const diagnostic = await diagnosticForStage('settings', {
      name: 'PrismaClientValidationError',
      message: 'postgresql://user:password@host/db token=secret',
    });
    expect(diagnostic).toEqual({
      code: 'PREVIEW_STABILITY_DATABASE_HELPER_FAILED',
      operation: 'capture',
      captureStage: 'settings',
      errorKind: 'PRISMA_VALIDATION',
      failed: true,
    });
    expect(JSON.stringify(diagnostic)).not.toMatch(/postgresql:\/\/|password|token|secret/i);
  });

  it('classifies Prisma unknown request errors without their message', async () => {
    const diagnostic = await diagnosticForStage('executions', {
      name: 'PrismaClientUnknownRequestError',
      message: 'Bearer sensitive-token',
    });
    expect(diagnostic).toMatchObject({
      captureStage: 'executions',
      errorKind: 'PRISMA_UNKNOWN',
      failed: true,
    });
    expect(JSON.stringify(diagnostic)).not.toMatch(/Bearer|sensitive-token/i);
  });

  it('exposes Prisma initialization code only when it is Pdddd', async () => {
    await expect(
      diagnosticForStage('runs-total', {
        name: 'PrismaClientInitializationError',
        errorCode: 'P1001',
        message: 'sensitive',
      }),
    ).resolves.toMatchObject({
      captureStage: 'runs-total',
      errorKind: 'PRISMA_INITIALIZATION',
      errorCode: 'P1001',
    });
    await expect(
      diagnosticForStage('runs-total', {
        name: 'PrismaClientInitializationError',
        errorCode: 'SECRET_123',
      }),
    ).resolves.toEqual({
      code: 'PREVIEW_STABILITY_DATABASE_HELPER_FAILED',
      operation: 'capture',
      captureStage: 'runs-total',
      errorKind: 'PRISMA_INITIALIZATION',
      failed: true,
    });
  });

  it('allows only existing DatabaseBaselineError codes', async () => {
    await expect(
      diagnosticForStage('migrations', {
        name: 'DatabaseBaselineError',
        code: 'DATABASE_BASELINE_DRIFT_CHECK_FAILED',
      }),
    ).resolves.toMatchObject({
      captureStage: 'migrations',
      errorKind: 'DATABASE_BASELINE',
      errorCode: 'DATABASE_BASELINE_DRIFT_CHECK_FAILED',
    });
    await expect(
      diagnosticForStage('migrations', {
        name: 'DatabaseBaselineError',
        code: 'DATABASE_BASELINE_NOT_ALLOWLISTED',
        message: 'secret',
      }),
    ).resolves.toEqual({
      code: 'PREVIEW_STABILITY_DATABASE_HELPER_FAILED',
      operation: 'capture',
      captureStage: 'migrations',
      errorKind: 'DATABASE_BASELINE',
      failed: true,
    });
  });

  it('preserves only allowlisted system errors', async () => {
    for (const errorCode of ['ENOENT', 'EACCES', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE']) {
      await expect(
        diagnosticForStage('table-counts', { code: errorCode, message: 'secret' }),
      ).resolves.toMatchObject({
        captureStage: 'table-counts',
        errorKind: 'SYSTEM',
        errorCode,
      });
    }
  });

  it('downgrades unknown errors and codes to UNKNOWN', async () => {
    const diagnostic = await diagnosticForStage('outbox-total', {
      code: 'SECRET_CODE',
      message: 'password=hidden SELECT payload',
      stack: 'raw stack',
    });
    expect(diagnostic).toEqual({
      code: 'PREVIEW_STABILITY_DATABASE_HELPER_FAILED',
      operation: 'capture',
      captureStage: 'outbox-total',
      errorKind: 'UNKNOWN',
      failed: true,
    });
    expect(JSON.stringify(diagnostic)).not.toMatch(/SECRET_CODE|password|SELECT|payload|stack/i);
  });

  it.each(['inspect', 'diff'] as const)(
    'preserves migration captureSubstage=%s',
    async (captureSubstage) => {
      await expect(
        diagnosticForMigrationSubstage(captureSubstage, { code: 'P2025', message: 'secret' }),
      ).resolves.toEqual({
        code: 'PREVIEW_STABILITY_DATABASE_HELPER_FAILED',
        operation: 'capture',
        captureStage: 'migrations',
        captureSubstage,
        errorKind: 'PRISMA',
        errorCode: 'P2025',
        failed: true,
      });
    },
  );

  it.each([
    ['inspect', { name: 'PrismaClientValidationError', message: 'SELECT secret' }, 'PRISMA_VALIDATION', undefined],
    ['diff', { name: 'PrismaClientInitializationError', errorCode: 'P1001', message: 'postgresql://secret' }, 'PRISMA_INITIALIZATION', 'P1001'],
    ['inspect', { code: 'ENOENT', path: 'C:/sensitive/path' }, 'SYSTEM', 'ENOENT'],
    ['diff', { name: 'DatabaseBaselineError', code: 'DATABASE_BASELINE_DRIFT_CHECK_FAILED', message: 'secret' }, 'DATABASE_BASELINE', 'DATABASE_BASELINE_DRIFT_CHECK_FAILED'],
    ['inspect', { code: 'NOT_ALLOWLISTED', stack: 'SELECT password token' }, 'UNKNOWN', undefined],
  ] as const)(
    'classifies migration %s cause without exposing raw details',
    async (captureSubstage, cause, errorKind, errorCode) => {
      const diagnostic = await diagnosticForMigrationSubstage(captureSubstage, cause);
      expect(diagnostic).toEqual({
        code: 'PREVIEW_STABILITY_DATABASE_HELPER_FAILED',
        operation: 'capture',
        captureStage: 'migrations',
        captureSubstage,
        errorKind,
        ...(errorCode ? { errorCode } : {}),
        failed: true,
      });
      expect(JSON.stringify(diagnostic)).not.toMatch(/SELECT|secret|postgresql:\/\/|password|token|sensitive\/path/i);
    },
  );

  it('keeps exit code 1 and emits one structured failure line', () => {
    const writeError = vi.fn();
    const setExitCode = vi.fn();
    emitDatabaseHelperFailure('executions', { code: 'P2025', message: 'secret' }, {
      writeError,
      setExitCode,
    });
    expect(writeError).toHaveBeenCalledTimes(1);
    expect(setExitCode).toHaveBeenCalledTimes(1);
    expect(setExitCode).toHaveBeenCalledWith(1);
    expect(JSON.parse(String(writeError.mock.calls[0]?.[0]))).toEqual({
      code: 'PREVIEW_STABILITY_DATABASE_HELPER_FAILED',
      operation: 'executions',
      errorKind: 'PRISMA',
      errorCode: 'P2025',
      failed: true,
    });
  });

  it('preserves the existing success serialization protocol', () => {
    const result = { paused: true };
    expect(serializeDatabaseHelperSuccess(result)).toBe(JSON.stringify(result));
  });
});
