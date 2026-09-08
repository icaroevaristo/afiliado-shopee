import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Job, Worker } from 'bullmq';
import { loadConfig } from '@shopee-auto-affiliate-ai/config';
import { createPrismaClient } from '@shopee-auto-affiliate-ai/database';
import {
  fingerprintWhatsAppGroupId,
  type WhatsAppProvider,
} from '@shopee-auto-affiliate-ai/providers';
import {
  createRedisConnection,
  createWhatsAppDispatchQueue,
  JOB_NAMES,
  QUEUE_NAMES,
} from '@shopee-auto-affiliate-ai/queue';
import {
  createPrismaRepositories,
  createSenderService,
} from '../../api/src/application-services';
import {
  COMMERCIAL_AI_COPY_PROMPT_VERSION,
  COMMERCIAL_AI_COPY_VALIDATION_VERSION,
} from '../../api/src/commercial-ai-copy-prompt';
import { fingerprintCommercialOffer } from '../../api/src/commercial-offer-snapshot';
import { PrismaWhatsAppDispatchManualRecoveryRepository } from '../../api/src/prisma-whatsapp-dispatch-manual-recovery-repository';
import {
  WhatsAppDispatchManualRecoveryService,
  type ManualRecoveryQueue,
  type ManualRecoveryJobState,
} from '../../api/src/whatsapp-dispatch-manual-recovery-service';
import { WHATSAPP_DISPATCH_MANUAL_RECOVERY_CONFIRMATION } from '../../api/src/repositories';
import { WhatsAppDeliveryConfirmationService } from '../../api/src/whatsapp-delivery-confirmation-service';
import { WhatsAppGroupSendPolicy } from '../../api/src/whatsapp-group-send-policy';
import {
  createWhatsAppDispatchWorker,
  processWhatsAppDispatchJob,
} from '../src/whatsapp-dispatch-worker';
import { startIsolatedWhatsAppDispatchWorker } from '../src/whatsapp-dispatch-runtime';
import { startCommercialAutomationWorker } from '../src/commercial-automation-worker';
import {
  createCommercialRecoveryCoordinator,
  createCommercialRecoveryQueue,
} from '../src/commercial-recovery-bootstrap';

const enabled = process.env.RUN_R1B_RECOVERY_DB_TEST === 'true';
const databaseSuite = enabled ? describe : describe.skip;
const logger = { info: () => undefined, error: () => undefined };
const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
const jobState = (state: string): ManualRecoveryJobState => {
  switch (state) {
    case 'failed':
    case 'waiting':
    case 'active':
    case 'delayed':
    case 'completed':
    case 'paused':
      return state;
    default:
      return 'unknown';
  }
};

databaseSuite('R1B disposable PostgreSQL/BullMQ lifecycle', () => {
  const prisma = createPrismaClient(process.env.DATABASE_URL);
  const repositories = createPrismaRepositories(prisma);
  const redisUrl = process.env.REDIS_URL ?? '';
  let connection: ReturnType<typeof createRedisConnection>;
  let queue: ReturnType<typeof createWhatsAppDispatchQueue>;
  const retries = vi.spyOn(Job.prototype, 'retry');
  const fetchGuard = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('Commercial HTTP forbidden in R1B tests'));

  beforeAll(async () => {
    const db = new URL(process.env.DATABASE_URL ?? '');
    const redis = new URL(redisUrl);
    if (
      db.hostname !== '127.0.0.1' ||
      !db.pathname.startsWith('/r1b_') ||
      db.port !== '55472' ||
      redis.hostname !== '127.0.0.1' ||
      redis.port !== '56382'
    )
      throw new Error('R1B disposable identities required');
    connection = createRedisConnection(redisUrl);
    queue = createWhatsAppDispatchQueue(connection);
    await prisma.commercialAutomationSettings.upsert({
      where: { id: 'commercial-automation' },
      create: { paused: true },
      update: { paused: true },
    });
  });
  afterAll(async () => {
    try {
      expect(fetchGuard).not.toHaveBeenCalled();
    } finally {
      retries.mockRestore();
      fetchGuard.mockRestore();
      await queue?.close();
      await connection?.quit();
      await prisma.$disconnect();
    }
  });

  const waitState = async (id: string, expected: 'failed' | 'completed') => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const job = await queue.getJob(id);
      if (job && (await job.getState()) === expected) return job;
      if (
        job &&
        expected === 'completed' &&
        (await job.getState()) === 'failed'
      )
        throw new Error('Retry failed: ' + job.failedReason);
      await delay(20);
    }
    throw new Error('Timed out waiting for bounded fixture job ' + expected);
  };

  const seed = async (commercial: boolean, ordered = true) => {
    const id = 'r1b-' + randomUUID();
    const now = new Date();
    const instance = id + '-instance';
    const destination =
      '120363' +
      String(Math.floor(Math.random() * 1e12)).padStart(12, '0') +
      '@g.us';
    const fingerprint = fingerprintWhatsAppGroupId(destination);
    const affiliateLink = 'https://s.shopee.com.br/' + id;
    const productLink = 'https://shopee.com.br/product/1/' + id;
    const snapshotFingerprint = fingerprintCommercialOffer({
      source: 'OFFICIAL',
      providerProductId: id,
      productLink,
      affiliateLink,
      price: '100.00',
      priceMin: '100.00',
      priceMax: '100.00',
      discountRate: 20,
      commissionRate: 10,
      offerStartsAt: null,
      offerEndsAt: null,
      unavailableAt: null,
    });
    await prisma.whatsAppInstance.create({
      data: { name: instance, active: true, paused: false },
    });
    await prisma.whatsAppDestination.create({
      data: {
        id,
        name: 'Synthetic R1B',
        destination,
        type: 'GROUP',
        active: true,
        available: true,
        paused: false,
        fingerprint,
        sourceInstanceName: instance,
        assignedInstanceName: instance,
        ...(ordered
          ? {
              instanceAssignments: {
                create: { instanceName: instance, position: 0 },
              },
            }
          : {}),
      },
    });
    await prisma.productLead.create({
      data: {
        id,
        source: commercial ? 'OFFICIAL' : 'MOCK',
        providerProductId: id,
        nome: 'Synthetic product',
        categoria: 'fixture',
        preco: 100,
        precoMin: 100,
        precoMax: 100,
        desconto: 20,
        nota: 4.8,
        vendidos: 100,
        comissao: 10,
        loja: 'Synthetic shop',
        urlImagem: 'https://example.invalid/image.jpg',
        productLink,
        affiliateLink,
        title: 'Synthetic product',
        fetchedAt: now,
        lastSeenAt: now,
        commercialSnapshotRevision: commercial ? 1 : 0,
        commercialSnapshotFingerprint: commercial ? snapshotFingerprint : null,
      },
    });
    if (commercial) {
      await prisma.commercialNiche.create({
        data: {
          id,
          name: 'Synthetic niche',
          slug: id,
          active: true,
          minimumScore: 60,
        },
      });
      await prisma.commercialGroupCampaign.create({
        data: {
          id,
          name: 'Synthetic campaign',
          logicalGroupFingerprint: fingerprint,
          anchorDestinationId: id,
          nicheId: id,
          active: true,
          dailyLimit: 100,
          attemptExecutionId: id,
          attemptReservedAt: now,
          attemptLeaseExpiresAt: new Date(now.getTime() + 120_000),
        },
      });
      await prisma.commercialOfferSnapshot.create({
        data: {
          id,
          productId: id,
          revision: 1,
          fingerprint: snapshotFingerprint,
          price: 100,
          discountRate: 20,
          commissionRate: 10,
          observedRating: 4.8,
          observedSales: 100,
          capturedAt: now,
        },
      });
    }
    await prisma.generatedCopy.create({
      data: {
        id,
        productId: id,
        titulo: 'Synthetic offer',
        mensagem: 'Synthetic product',
        cta: 'Confira ' + affiliateLink,
        hashtags: '#oferta',
        ...(commercial
          ? {
              source: 'AI',
              provider: 'fixture',
              model: 'fixture',
              promptVersion: COMMERCIAL_AI_COPY_PROMPT_VERSION,
              validationVersion: COMMERCIAL_AI_COPY_VALIDATION_VERSION,
              inputFingerprint: id,
              snapshotId: id,
              createdFromCandidateId: id,
            }
          : {}),
      },
    });
    if (commercial)
      await prisma.commercialPromotionCandidate.create({
        data: {
          id,
          campaignId: id,
          productId: id,
          snapshotId: id,
          generatedCopyId: id,
          status: 'RESERVED',
          rankPosition: 1,
          commercialScore: 82,
          scorePolicyVersion: 'official-v2',
          minimumScoreUsed: 60,
          scoreBreakdown: {},
          promotionSignals: ['CURRENT_DISCOUNT'],
          queuedAt: now,
          lastEvaluatedAt: now,
          expiresAt: new Date(now.getTime() + 3600_000),
        },
      });
    await prisma.whatsAppDispatch.create({
      data: {
        id,
        productId: id,
        generatedCopyId: id,
        destinationId: id,
        instanceName: instance,
        status: 'PROCESSING',
        attemptCount: 1,
      },
    });
    if (commercial) {
      await prisma.commercialAutomationExecution.create({
        data: {
          id,
          schedulerJobId: id,
          bullMqJobId: id + '-execution',
          mode: 'SEND',
          status: 'QUEUED',
          externalStage: 'EXTERNAL_MAY_HAVE_STARTED',
          reasons: [],
          commercialRunId: id,
          completedAt: now,
        },
      });
      await prisma.commercialPipelineRun.create({
        data: {
          id,
          executionId: id,
          instanceName: instance,
          mode: 'CONFIRMED',
          status: 'FAILED',
          finalStatus: 'AMBIGUOUS',
          investigationRequired: true,
          dispatchId: id,
          jobId: id,
          productId: id,
          groupDestinationId: id,
          groupFingerprint: fingerprint,
          rejectionSummary: {},
          selectionReasons: [],
          plannedSubIds: [],
          completedAt: now,
        },
      });
      await prisma.commercialDispatchOutbox.create({
        data: {
          id,
          commercialRunId: id,
          dispatchId: id,
          jobId: id,
          instanceName: instance,
          status: 'PUBLISHED',
          publishedAt: now,
        },
      });
    }
    // Reconstruct only the queue failure, without a provider or lifecycle rewrite.
    const initialWorker = new Worker(
      QUEUE_NAMES.whatsappDispatch,
      async () => {
        throw new Error('Synthetic first-attempt failure');
      },
      { connection },
    );
    try {
      await queue.add(
        JOB_NAMES.whatsappDispatch,
        { dispatchId: id, instanceName: instance },
        {
          jobId: id,
          attempts: 1,
          removeOnComplete: false,
          removeOnFail: false,
        },
      );
      const failed = await waitState(id, 'failed');
      expect(failed.attemptsMade).toBe(1);
      expect(failed.opts.attempts).toBe(1);
    } finally {
      await initialWorker.close();
    }
    return { id, instance };
  };

  const recoveryQueue: ManualRecoveryQueue = {
    async getJob(id) {
      const job = await queue.getJob(id);
      if (!job) return null;
      return {
        id,
        instanceName: job.data.instanceName,
        get attemptsMade() {
          return job.attemptsMade;
        },
        getState: async () => {
          const fresh = await queue.getJob(id);
          if (fresh) job.attemptsMade = fresh.attemptsMade;
          return jobState(await job.getState());
        },
        retry: () => job.retry(),
      };
    },
    async findEquivalentJobIds(dispatchId) {
      const jobs = await queue.getJobs([
        'waiting',
        'active',
        'delayed',
        'completed',
        'failed',
        'paused',
      ]);
      return jobs
        .filter((job) => job.data.dispatchId === dispatchId)
        .map((job) => String(job.id));
    },
  };

  it('orphan stays inert through real worker, paused automation, recovery, expiration and restart', async () => {
    const { id, instance } = await seed(false);
    const before = await prisma.whatsAppDispatch.findUniqueOrThrow({
      where: { id },
    });
    const provider: WhatsAppProvider = {
      sendMessage: vi.fn<WhatsAppProvider['sendMessage']>(async () => ({
        status: 'sent',
        externalMessageId: 'fake-orphan',
        sentAt: new Date(),
      })),
    };
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: process.env.DATABASE_URL,
      REDIS_URL: redisUrl,
      COMMERCIAL_AUTOMATION_MODE: 'preview',
      COMMERCIAL_SCHEDULER_ENABLED: 'false',
      COMMERCIAL_AUTOMATION_ENABLED: 'false',
      EVOLUTION_INSTANCE_NAME: instance,
    });
    // Direct Sender control complements the automatic restart observation.
    const sender = createSenderService({
      repositories,
      whatsAppProvider: provider,
      logger,
    });
    await expect(sender.sendDispatch(id)).rejects.toMatchObject({
      code: 'WHATSAPP_DISPATCH_DELIVERY_AMBIGUOUS',
    });
    const retryCount = retries.mock.calls.length;
    const recover = () =>
      createCommercialRecoveryCoordinator({
        config,
        prisma,
        queue: createCommercialRecoveryQueue(queue),
        logger,
      });
    let expirationRuns = 0;
    const expiryLogger = {
      error: logger.error,
      info: (data: unknown) => {
        if (
          typeof data === 'object' &&
          data !== null &&
          'event' in data &&
          data.event === 'whatsapp.delivery-confirmation.expired'
        )
          expirationRuns++;
      },
    };
    for (let restart = 0; restart < 2; restart++) {
      const dispatchRuntime = await startIsolatedWhatsAppDispatchWorker(
        { ...config, COMMERCIAL_AUTOMATION_MODE: 'send' },
        {
          logger,
          providerFactory: () => provider,
          recoveryCoordinator: recover(),
          workerFactory: (url, opts) =>
            createWhatsAppDispatchWorker(url, {
              ...opts,
              prisma,
              logger: expiryLogger,
              deliveryConfirmationExpiryIntervalMs: 10_000,
            }),
        },
      );
      let automation:
        Awaited<ReturnType<typeof startCommercialAutomationWorker>> | undefined;
      try {
        automation = await startCommercialAutomationWorker(config, {
          prisma,
          logger,
          recoveryCoordinator: recover(),
        });
        await delay(10_500);
      } finally {
        await automation?.close();
        await dispatchRuntime.close();
      }
    }
    expect(expirationRuns).toBeGreaterThanOrEqual(2);
    expect(provider.sendMessage).not.toHaveBeenCalled();
    expect(retries.mock.calls.length - retryCount).toBe(0);
    expect(await recoveryQueue.findEquivalentJobIds(id)).toEqual([id]);
    expect(
      await prisma.whatsAppDispatch.findUniqueOrThrow({ where: { id } }),
    ).toEqual(before);
    expect(
      await prisma.commercialPipelineRun.count({ where: { dispatchId: id } }),
    ).toBe(0);
    expect(
      await prisma.commercialDispatchOutbox.count({
        where: { dispatchId: id },
      }),
    ).toBe(0);
    expect(await prisma.commercialAutomationExecution.count()).toBe(0);
    expect(
      (
        await prisma.commercialAutomationSettings.findUniqueOrThrow({
          where: { id: 'commercial-automation' },
        })
      ).paused,
    ).toBe(true);
    expect((await waitState(id, 'failed')).attemptsMade).toBe(1);
  }, 30_000);

  it.each(['no-authorization', 'foreign-job', 'third-queue-attempt'] as const)(
    'worker rejects %s before provider',
    async (control) => {
      const { id, instance } = await seed(true);
      const repo = new PrismaWhatsAppDispatchManualRecoveryRepository(prisma);
      const input = {
        dispatchId: id,
        expectedRunId: id,
        expectedExecutionId: id,
        confirmation: WHATSAPP_DISPATCH_MANUAL_RECOVERY_CONFIRMATION,
      };
      if (control === 'no-authorization') {
        // Corrupt only the disposable fixture to exercise a missing-audit boundary.
        await prisma.whatsAppDispatch.update({
          where: { id },
          data: { status: 'PENDING' },
        });
      } else {
        const now = new Date();
        await repo.authorizeConfirmedNonDelivery({
          ...input,
          authorizedAt: now,
        });
        await repo.rearmAuthorizedRetry({
          ...input,
          checkedAt: now,
          leaseExpiresAt: new Date(now.getTime() + 120_000),
        });
      }
      const provider: WhatsAppProvider = {
        sendMessage: vi.fn<WhatsAppProvider['sendMessage']>(async () => {
          throw new Error('Provider forbidden');
        }),
      };
      const before = await prisma.whatsAppDispatch.findUniqueOrThrow({
        where: { id },
      });
      await expect(
        processWhatsAppDispatchJob(
          {
            id: control === 'foreign-job' ? id + '-foreign' : id,
            name: JOB_NAMES.whatsappDispatch,
            data: { dispatchId: id, instanceName: instance },
            opts: { attempts: 1 },
            attemptsMade: control === 'third-queue-attempt' ? 2 : 1,
          },
          {
            prisma,
            logger,
            commercialAutomationMode: 'send',
            whatsAppProvider: provider,
            whatsAppProviderResolver: () => provider,
            reservationLeaseMilliseconds: 120_000,
          },
        ),
      ).rejects.toThrow();
      expect(provider.sendMessage).not.toHaveBeenCalled();
      expect(
        await prisma.whatsAppDispatch.findUniqueOrThrow({ where: { id } }),
      ).toEqual(before);
    },
  );

  it.each(['ack', 'timeout'] as const)(
    'authorized second attempt submits, converges after restart, then %s without another retry',
    async (terminal) => {
      const { id, instance } = await seed(true, terminal === 'ack');
      const provider: WhatsAppProvider = {
        sendMessage: vi.fn<WhatsAppProvider['sendMessage']>(async () => ({
          status: 'sent',
          externalMessageId: id + '-submission',
          sentAt: new Date(),
        })),
      };
      const repo = new PrismaWhatsAppDispatchManualRecoveryRepository(prisma);
      const policy = {
        evaluateAutomationReadiness: async () => ({
          allowed: true,
          reasons: [],
        }),
      };
      const service = () =>
        new WhatsAppDispatchManualRecoveryService(
          repo,
          recoveryQueue,
          {},
          policy,
        );
      const input = {
        dispatchId: id,
        expectedRunId: id,
        expectedExecutionId: id,
        confirmation: WHATSAPP_DISPATCH_MANUAL_RECOVERY_CONFIRMATION,
      };
      await service().authorize(input);
      const retryCount = retries.mock.calls.length;
      if (terminal === 'ack') {
        class CrashBeforeReceipt extends PrismaWhatsAppDispatchManualRecoveryRepository {
          override async markManualRecoveryRequeued(): Promise<never> {
            throw new Error('Synthetic crash before retry receipt');
          }
        }
        const crashingService = new WhatsAppDispatchManualRecoveryService(
          new CrashBeforeReceipt(prisma),
          recoveryQueue,
          {},
          policy,
        );
        await expect(
          crashingService.requeueAuthorizedRetry(input),
        ).rejects.toThrow('Synthetic crash before retry receipt');
        expect(
          (await repo.inspectAuthorizedRecovery(input)).recovery.requeuedAt,
        ).toBeNull();
      } else {
        await service().requeueAuthorizedRetry(input);
      }
      const runtime = createWhatsAppDispatchWorker(redisUrl, {
        prisma,
        connection,
        logger,
        commercialAutomationMode: 'send',
        whatsAppProvider: provider,
        whatsAppProviderResolver: () => provider,
        reservationLeaseMilliseconds: 120_000,
        groupSendPolicy: new WhatsAppGroupSendPolicy({
          enabled: true,
          safeMode: true,
          instanceName: instance,
        }),
      });
      try {
        const job = await waitState(id, 'completed');
        expect(job.attemptsMade).toBe(2);
        const submitted = await prisma.whatsAppDispatch.findUniqueOrThrow({
          where: { id },
        });
        expect(submitted).toMatchObject({
          status: 'SUBMITTED',
          attemptCount: 2,
          sentAt: null,
        });
        expect(submitted.submittedAt).not.toBeNull();
        expect(submitted.confirmationDeadlineAt).not.toBeNull();
        expect((await service().requeueAuthorizedRetry(input)).kind).toBe(
          terminal === 'ack' ? 'CONVERGED_AFTER_RESTART' : 'ALREADY_REQUEUED',
        );
        expect((await service().requeueAuthorizedRetry(input)).kind).toBe(
          'ALREADY_REQUEUED',
        );
        expect(provider.sendMessage).toHaveBeenCalledTimes(1);
        expect(retries.mock.calls.length - retryCount).toBe(1);
        expect(
          await prisma.commercialPipelineRun.findUniqueOrThrow({
            where: { id },
          }),
        ).toMatchObject({
          status: 'FAILED',
          finalStatus: 'AMBIGUOUS',
          investigationRequired: true,
        });
        if (!repositories.whatsappDeliveryEvents)
          throw new Error('Delivery inbox repository missing');
        const delivery = new WhatsAppDeliveryConfirmationService({
          dispatches: repositories.whatsappDispatches,
          deliveryEvents: repositories.whatsappDeliveryEvents,
          runs: repositories.commercialRuns,
          promotionCandidates: repositories.commercialPromotions,
          logger,
        });
        if (terminal === 'ack') {
          await delivery.consume({
            instanceName: instance,
            externalMessageId: id + '-submission',
            status: 'SERVER_ACK',
            occurredAt: new Date(),
          });
          expect(
            await prisma.whatsAppDispatch.findUniqueOrThrow({ where: { id } }),
          ).toMatchObject({ status: 'SENT', attemptCount: 2 });
          expect(
            await prisma.commercialPipelineRun.findUniqueOrThrow({
              where: { id },
            }),
          ).toMatchObject({
            status: 'COMPLETED',
            finalStatus: 'SENT',
            investigationRequired: false,
          });
        } else {
          if (!submitted.confirmationDeadlineAt)
            throw new Error('Submission deadline missing');
          await delivery.expireDue(
            new Date(submitted.confirmationDeadlineAt.getTime() + 1),
          );
          expect(
            await prisma.whatsAppDispatch.findUniqueOrThrow({ where: { id } }),
          ).toMatchObject({ status: 'AMBIGUOUS', attemptCount: 2 });
          expect(
            await prisma.commercialPipelineRun.findUniqueOrThrow({
              where: { id },
            }),
          ).toMatchObject({
            finalStatus: 'AMBIGUOUS',
            investigationRequired: true,
          });
          await expect(
            service().requeueAuthorizedRetry(input),
          ).rejects.toThrow();
        }
        expect(provider.sendMessage).toHaveBeenCalledTimes(1);
        expect(retries.mock.calls.length - retryCount).toBe(1);
      } finally {
        await runtime.close();
      }
    },
    30_000,
  );
});
