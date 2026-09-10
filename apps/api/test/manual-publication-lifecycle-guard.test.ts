import { describe, expect, it, vi } from 'vitest';

import {
  PrismaOperationalStatusRepository,
  PrismaWhatsAppGroupDirectoryRepository,
} from '../src/prisma-repositories';

const NOW = new Date('2026-09-02T15:00:00.000Z');
const ACTIVE_TARGET_STATUSES = ['ACCEPTED', 'PROCESSING', 'QUEUED'] as const;
type ActiveTargetStatus = (typeof ACTIVE_TARGET_STATUSES)[number];
type RequestMode = 'PREVIEW' | 'SEND';
type OtherLifecycle = 'dispatch' | 'run' | 'outbox' | 'reservation';

type FakeCallArgs = {
  where?: unknown;
  data?: unknown;
};

const readWhere = (args?: FakeCallArgs) => {
  if (!args || typeof args.where !== 'object' || args.where === null) {
    return {} as Record<string, unknown>;
  }
  return args.where as Record<string, unknown>;
};

const containsNoRetryCloseout = (value: unknown): boolean => {
  if (value === 'AMBIGUITY_ACCEPTED_NO_RETRY') return true;
  if (Array.isArray(value)) return value.some(containsNoRetryCloseout);
  if (typeof value !== 'object' || value === null) return false;
  return Object.values(value).some(containsNoRetryCloseout);
};

const manualTargetMatches = (
  args: FakeCallArgs | undefined,
  mode: RequestMode,
  targetStatus: ActiveTargetStatus | undefined,
) => {
  if (!targetStatus) return false;
  const where = readWhere(args);
  const statuses = where.status as { in?: readonly string[] } | undefined;
  const request = where.request as { mode?: RequestMode } | undefined;
  const statusMatches = statuses?.in?.includes(targetStatus) ?? false;
  const modeMatches = request?.mode === undefined || request.mode === mode;
  return statusMatches && modeMatches;
};

const createStatusPrisma = (input: {
  mode: RequestMode;
  targetStatus?: ActiveTargetStatus;
  otherLifecycle?: OtherLifecycle;
}) => {
  const manualTargetCount = vi.fn(async (args?: FakeCallArgs) =>
    manualTargetMatches(args, input.mode, input.targetStatus) ? 1 : 0,
  );
  const count = (kind: OtherLifecycle) =>
    vi.fn(async () => (input.otherLifecycle === kind ? 1 : 0));

  return {
    prisma: {
      whatsAppDispatch: { count: count('dispatch') },
      commercialPipelineRun: { count: count('run') },
      commercialDispatchOutbox: { count: count('outbox') },
      commercialGroupCampaign: { count: count('reservation') },
      manualPublicationTarget: { count: manualTargetCount },
    },
    manualTargetCount,
  };
};

const createGroupTransactionPrisma = (input: {
  mode: RequestMode;
  targetStatus?: ActiveTargetStatus;
  otherLifecycle?: OtherLifecycle;
}) => {
  const destination = {
    id: 'group-id',
    name: 'Grupo de teste',
    destination: '120363123@g.us',
    type: 'GROUP' as const,
    active: true,
    paused: false,
    available: true,
    fingerprint: 'grp_test',
    sourceInstanceName: 'instance-a',
    assignedInstanceName: 'instance-a' as string | null,
    assignmentRevision: 1,
    instanceAssignments: [{ instanceName: 'instance-a', position: 0 }],
    updatedAt: NOW,
  };
  const manualTargetCount = vi.fn(async (args?: FakeCallArgs) =>
    manualTargetMatches(args, input.mode, input.targetStatus) ? 1 : 0,
  );
  const count = (kind: OtherLifecycle) =>
    vi.fn(async () => (input.otherLifecycle === kind ? 1 : 0));
  const assignmentDeleteMany = vi.fn(async () => ({ count: 1 }));
  const assignmentCreateMany = vi.fn(async (args: FakeCallArgs) => {
    if (!Array.isArray(args.data)) return { count: 0 };
    destination.instanceAssignments = args.data.filter(
      (assignment): assignment is { instanceName: string; position: number } =>
        typeof assignment === 'object' &&
        assignment !== null &&
        typeof (assignment as { instanceName?: unknown }).instanceName ===
          'string' &&
        typeof (assignment as { position?: unknown }).position === 'number',
    );
    return { count: destination.instanceAssignments.length };
  });
  const transaction = {
    $queryRaw: vi.fn(async () => [{ id: destination.id }]),
    whatsAppDestination: {
      findFirst: vi.fn(async () => destination),
      updateMany: vi.fn(async (args: FakeCallArgs) => {
        const data =
          args.data && typeof args.data === 'object'
            ? (args.data as Record<string, unknown>)
            : {};
        if ('assignedInstanceName' in data) {
          destination.assignedInstanceName = data.assignedInstanceName as
            string | null;
        }
        if (
          data.assignmentRevision &&
          typeof data.assignmentRevision === 'object' &&
          'increment' in data.assignmentRevision
        ) {
          destination.assignmentRevision += Number(
            (data.assignmentRevision as { increment: unknown }).increment,
          );
        }
        return { count: 1 };
      }),
      findUnique: vi.fn(async () => destination),
    },
    whatsAppDispatch: { count: count('dispatch') },
    commercialPipelineRun: { count: count('run') },
    commercialDispatchOutbox: { count: count('outbox') },
    commercialGroupCampaign: { count: count('reservation') },
    manualPublicationTarget: { count: manualTargetCount },
    whatsAppGroupInstanceAssignment: {
      deleteMany: assignmentDeleteMany,
      createMany: assignmentCreateMany,
    },
  };
  const prisma = {
    $transaction: vi.fn(
      async (callback: (value: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    ),
  };

  return { prisma, manualTargetCount };
};

describe('manual publication lifecycle mode guards', () => {
  describe('OperationalStatusRepository precheck', () => {
    it.each(ACTIVE_TARGET_STATUSES)(
      'does not treat PREVIEW target %s as an active SEND lifecycle',
      async (targetStatus) => {
        const { prisma, manualTargetCount } = createStatusPrisma({
          mode: 'PREVIEW',
          targetStatus,
        });
        const repository = new PrismaOperationalStatusRepository(
          prisma as never,
        );

        await expect(
          repository.hasActiveGroupLifecycle('group-id', NOW),
        ).resolves.toBe(false);
        expect(manualTargetCount).toHaveBeenCalledWith({
          where: {
            destinationId: 'group-id',
            status: { in: ['ACCEPTED', 'PROCESSING', 'QUEUED'] },
            request: { mode: 'SEND' },
          },
        });
      },
    );

    it.each(ACTIVE_TARGET_STATUSES)(
      'keeps SEND target %s as an active lifecycle',
      async (targetStatus) => {
        const { prisma } = createStatusPrisma({
          mode: 'SEND',
          targetStatus,
        });
        const repository = new PrismaOperationalStatusRepository(
          prisma as never,
        );

        await expect(
          repository.hasActiveGroupLifecycle('group-id', NOW),
        ).resolves.toBe(true);
      },
    );

    it('libera o blocker de grupo do dispatch encerrado como ambiguidade sem retry', async () => {
      const dispatchCount = vi.fn(async (args?: FakeCallArgs) => {
        const where = readWhere(args);
        return 'NOT' in where ? 0 : 1;
      });
      const outboxCount = vi.fn(async (args?: FakeCallArgs) => {
        const where = readWhere(args);
        const dispatch =
          typeof where.dispatch === 'object' && where.dispatch !== null
            ? (where.dispatch as Record<string, unknown>)
            : {};
        return 'NOT' in dispatch ? 0 : 1;
      });
      const prisma = {
        whatsAppDispatch: { count: dispatchCount },
        commercialPipelineRun: { count: vi.fn().mockResolvedValue(0) },
        commercialDispatchOutbox: { count: outboxCount },
        commercialGroupCampaign: { count: vi.fn().mockResolvedValue(0) },
        manualPublicationTarget: { count: vi.fn().mockResolvedValue(0) },
        whatsAppDispatchManualRecovery: {},
      };
      const repository = new PrismaOperationalStatusRepository(
        prisma as never,
      );

      await expect(
        repository.hasActiveGroupLifecycle('group-id', NOW),
      ).resolves.toBe(false);
      expect(dispatchCount).toHaveBeenCalledWith({
        where: {
          destinationId: 'group-id',
          status: { in: ['PENDING', 'PROCESSING'] },
          NOT: {
            manualRecovery: {
              is: { decision: 'AMBIGUITY_ACCEPTED_NO_RETRY' },
            },
          },
        },
      });
      expect(outboxCount).toHaveBeenCalledWith({
        where: {
          dispatch: {
            destinationId: 'group-id',
            status: { in: ['PENDING', 'PROCESSING'] },
            NOT: {
              manualRecovery: {
                is: { decision: 'AMBIGUITY_ACCEPTED_NO_RETRY' },
              },
            },
          },
        },
      });
    });

    it('mantem ambiguidades sem closeout nos contadores operacionais', async () => {
      const prisma = {
        commercialAutomationExecution: {
          count: vi.fn().mockResolvedValue(0),
        },
        commercialGroupCampaign: { count: vi.fn().mockResolvedValue(0) },
        commercialPipelineRun: { count: vi.fn().mockResolvedValue(1) },
        whatsAppDispatch: { count: vi.fn().mockResolvedValue(1) },
        commercialDispatchOutbox: { count: vi.fn().mockResolvedValue(0) },
        manualPublicationTarget: { count: vi.fn().mockResolvedValue(0) },
      };
      const repository = new PrismaOperationalStatusRepository(
        prisma as never,
      );

      await expect(repository.getCounts(NOW)).resolves.toMatchObject({
        ambiguity: 2,
        investigationRequired: 1,
        pendingDispatches: 1,
        pendingOutboxes: 0,
      });
    });

    it('exclui do operacional somente a ambiguidade encerrada sem retry', async () => {
      const runCount = vi.fn(async (args?: FakeCallArgs) =>
        containsNoRetryCloseout(readWhere(args)) ? 0 : 1,
      );
      const dispatchCount = vi.fn(async (args?: FakeCallArgs) =>
        containsNoRetryCloseout(readWhere(args)) ? 0 : 1,
      );
      const prisma = {
        commercialAutomationExecution: {
          count: vi.fn().mockResolvedValue(0),
        },
        commercialGroupCampaign: { count: vi.fn().mockResolvedValue(0) },
        commercialPipelineRun: { count: runCount },
        whatsAppDispatch: { count: dispatchCount },
        commercialDispatchOutbox: {
          count: vi.fn().mockResolvedValue(0),
        },
        manualPublicationTarget: { count: vi.fn().mockResolvedValue(0) },
        whatsAppDispatchManualRecovery: {},
      };
      const repository = new PrismaOperationalStatusRepository(
        prisma as never,
      );

      await expect(repository.getCounts(NOW)).resolves.toMatchObject({
        ambiguity: 0,
        investigationRequired: 0,
        pendingDispatches: 0,
        pendingOutboxes: 0,
      });
      expect(runCount).toHaveBeenCalledTimes(2);
      expect(dispatchCount).toHaveBeenCalledTimes(2);
      expect(
        runCount.mock.calls.every(([args]) =>
          containsNoRetryCloseout(readWhere(args)),
        ),
      ).toBe(true);
      expect(
        dispatchCount.mock.calls.every(([args]) =>
          containsNoRetryCloseout(readWhere(args)),
        ),
      ).toBe(true);
    });

    it.each(['dispatch', 'run', 'outbox', 'reservation'] as const)(
      'preserves the %s blocker while a preview target exists',
      async (otherLifecycle) => {
        const { prisma } = createStatusPrisma({
          mode: 'PREVIEW',
          targetStatus: 'ACCEPTED',
          otherLifecycle,
        });
        const repository = new PrismaOperationalStatusRepository(
          prisma as never,
        );

        await expect(
          repository.hasActiveGroupLifecycle('group-id', NOW),
        ).resolves.toBe(true);
      },
    );
  });

  describe('transactional assignment guard', () => {
    it.each(ACTIVE_TARGET_STATUSES)(
      'allows reassignment with PREVIEW target %s and no SEND lifecycle',
      async (targetStatus) => {
        const { prisma, manualTargetCount } = createGroupTransactionPrisma({
          mode: 'PREVIEW',
          targetStatus,
        });
        const repository = new PrismaWhatsAppGroupDirectoryRepository(
          prisma as never,
        );

        await expect(
          repository.updateAdministrativeWithLifecycleGuard('group-id', {
            assignedInstanceName: 'instance-b',
            expectedUpdatedAt: NOW,
            now: NOW,
          }),
        ).resolves.toMatchObject({ kind: 'UPDATED' });
        expect(manualTargetCount).toHaveBeenCalledWith({
          where: {
            destinationId: 'group-id',
            status: { in: ['ACCEPTED', 'PROCESSING', 'QUEUED'] },
            request: { mode: 'SEND' },
          },
        });
      },
    );

    it.each(ACTIVE_TARGET_STATUSES)(
      'blocks reassignment with SEND target %s',
      async (targetStatus) => {
        const { prisma } = createGroupTransactionPrisma({
          mode: 'SEND',
          targetStatus,
        });
        const repository = new PrismaWhatsAppGroupDirectoryRepository(
          prisma as never,
        );

        await expect(
          repository.updateAdministrativeWithLifecycleGuard('group-id', {
            assignedInstanceName: 'instance-b',
            expectedUpdatedAt: NOW,
            now: NOW,
          }),
        ).resolves.toEqual({ kind: 'ACTIVE_LIFECYCLE' });
      },
    );

    it.each(['dispatch', 'run', 'outbox', 'reservation'] as const)(
      'preserves the %s transaction blocker with a preview target',
      async (otherLifecycle) => {
        const { prisma } = createGroupTransactionPrisma({
          mode: 'PREVIEW',
          targetStatus: 'ACCEPTED',
          otherLifecycle,
        });
        const repository = new PrismaWhatsAppGroupDirectoryRepository(
          prisma as never,
        );

        await expect(
          repository.updateAdministrativeWithLifecycleGuard('group-id', {
            assignedInstanceName: 'instance-b',
            expectedUpdatedAt: NOW,
            now: NOW,
          }),
        ).resolves.toEqual({ kind: 'ACTIVE_LIFECYCLE' });
      },
    );
  });
});
