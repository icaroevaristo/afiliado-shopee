import { afterAll, describe, expect, it } from 'vitest';
import { loadConfig } from '@shopee-auto-affiliate-ai/config';
import { createPrismaClient } from '@shopee-auto-affiliate-ai/database';
import {
  fingerprintWhatsAppGroupId,
  MockWhatsAppProvider,
} from '@shopee-auto-affiliate-ai/providers';
import {
  createRedisConnection,
  createWhatsAppDispatchQueue,
  enqueueControlledWhatsAppDispatch,
} from '@shopee-auto-affiliate-ai/queue';

import {
  createCommercialAutomationPolicyService,
  createPrismaRepositories,
} from '../../api/src/application-services';
import {
  COMMERCIAL_AI_COPY_PROMPT_VERSION,
  COMMERCIAL_AI_COPY_VALIDATION_VERSION,
} from '../../api/src/commercial-ai-copy-prompt';
import {
  COMMERCIAL_COPY_FALLBACK_MODEL,
  COMMERCIAL_COPY_FALLBACK_PROVIDER,
  buildCommercialPromotionFallbackOutput,
} from '../../api/src/commercial-promotion-copy-fallback';
import { CommercialAiCopyValidator } from '../../api/src/commercial-ai-copy-validator';
import { CommercialPromotionCopyAssembler } from '../../api/src/commercial-promotion-copy-assembler';
import { fingerprintCommercialOffer } from '../../api/src/commercial-offer-snapshot';
import type { CommercialAutomationTarget } from '../../api/src/repositories';
import { createCommercialAutomationOrchestratorRuntime } from '../src/commercial-automation-runtime';

const enabled =
  process.env.RUN_COMMERCIAL_FULFILLMENT_DB_TEST === 'true' &&
  process.env.DATABASE_URL !== undefined &&
  process.env.REDIS_URL !== undefined;
const describeDatabase = enabled ? describe : describe.skip;

const NOW = new Date('2026-09-07T12:00:00.000Z');
const PREFIX = 'fulfillment-precommit-finalization-db-fixture';
const INSTANCE = `${PREFIX}-instance`;
const GROUP_ID = '120363141000000010@g.us';
const INDEPENDENT_GROUP_ID = '120363141000000011@g.us';
const GROUP_FINGERPRINT = fingerprintWhatsAppGroupId(GROUP_ID);
const INDEPENDENT_GROUP_FINGERPRINT = fingerprintWhatsAppGroupId(
  INDEPENDENT_GROUP_ID,
);
const IDS = {
  niche: `${PREFIX}-niche`,
  campaign: `${PREFIX}-campaign`,
  destination: `${PREFIX}-destination`,
  product: `${PREFIX}-product`,
  snapshot: `${PREFIX}-snapshot`,
  candidate: `${PREFIX}-candidate`,
  copy: `${PREFIX}-copy`,
  competingCopy: `${PREFIX}-competing-copy`,
  competingDispatch: `${PREFIX}-competing-dispatch`,
  independentCampaign: `${PREFIX}-independent-campaign`,
  independentDestination: `${PREFIX}-independent-destination`,
  schedulerJob: `${PREFIX}-scheduler`,
  bullMqJob: `${PREFIX}-bullmq`,
};
const PRODUCT_LINK = `https://shopee.com.br/product/141/${PREFIX}`;
const AFFILIATE_LINK = `https://s.shopee.com.br/${PREFIX}`;
const SNAPSHOT_FINGERPRINT = fingerprintCommercialOffer({
  source: 'OFFICIAL',
  providerProductId: `${PREFIX}-provider`,
  productLink: PRODUCT_LINK,
  affiliateLink: AFFILIATE_LINK,
  price: '99.90',
  priceMin: '99.90',
  priceMax: '99.90',
  discountRate: 20,
  commissionRate: 10,
  offerStartsAt: null,
  offerEndsAt: null,
  unavailableAt: null,
});

const logger = {
  info: () => undefined,
  error: () => undefined,
};

describeDatabase(
  'commercial precommit finalization PostgreSQL and Redis fixture',
  () => {
    const databaseUrl = process.env.DATABASE_URL ?? '';
    const redisUrl = process.env.REDIS_URL ?? '';
    const prisma = createPrismaClient(databaseUrl);
    const repositories = createPrismaRepositories(prisma);
    const prepared = repositories.commercialPreparedMessages;
    const copyValidator = new CommercialAiCopyValidator();
    const copyAssembler = new CommercialPromotionCopyAssembler();

    const removeFixtures = async () => {
      await prisma.commercialPreparedMessage.deleteMany({
        where: {
          campaignId: { in: [IDS.campaign, IDS.independentCampaign] },
        },
      });
      await prisma.commercialDispatchOutbox.deleteMany({
        where: {
          dispatch: {
            destinationId: {
              in: [IDS.destination, IDS.independentDestination],
            },
          },
        },
      });
      await prisma.whatsAppDispatch.deleteMany({
        where: {
          destinationId: {
            in: [IDS.destination, IDS.independentDestination],
          },
        },
      });
      await prisma.commercialPipelineRun.deleteMany({
        where: {
          groupDestinationId: {
            in: [IDS.destination, IDS.independentDestination],
          },
        },
      });
      await prisma.commercialAutomationExecution.deleteMany({
        where: { schedulerJobId: { startsWith: PREFIX } },
      });
      await prisma.commercialPromotionCandidate.deleteMany({
        where: { id: { startsWith: PREFIX } },
      });
      await prisma.generatedCopy.deleteMany({
        where: { id: { startsWith: PREFIX } },
      });
      await prisma.commercialOfferSnapshot.deleteMany({
        where: { id: { startsWith: PREFIX } },
      });
      await prisma.productLead.deleteMany({
        where: { id: { startsWith: PREFIX } },
      });
      await prisma.commercialGroupCampaign.deleteMany({
        where: { id: { startsWith: PREFIX } },
      });
      await prisma.whatsAppDestination.deleteMany({
        where: { id: { startsWith: PREFIX } },
      });
      await prisma.whatsAppInstance.deleteMany({
        where: { name: INSTANCE },
      });
      await prisma.commercialNiche.deleteMany({
        where: { id: IDS.niche },
      });
    };

    afterAll(async () => {
      await removeFixtures();
      await prisma.$disconnect();
    });

    it(
      'localiza falha de finalizacao do claim sem criar ambiguidade global',
      async () => {
        await removeFixtures();
        const redisConnection = createRedisConnection(redisUrl);
        const dispatchQueue = createWhatsAppDispatchQueue(redisConnection);
        await dispatchQueue.waitUntilReady();
        await dispatchQueue.obliterate({ force: true });

        const provider = new MockWhatsAppProvider();
        const confirmationQueue = {
          hasJob: async (jobId: string) =>
            Boolean(await dispatchQueue.getJob(jobId)),
          getJob: async (jobId: string) => {
            const job = await dispatchQueue.getJob(jobId);
            if (!job) return null;
            return {
              id: String(job.id ?? jobId),
              dispatchId: job.data.dispatchId,
              instanceName: job.data.instanceName,
            };
          },
          enqueue: async (
            dispatchId: string,
            jobId: string,
            instanceName?: string | null,
          ) => {
            await enqueueControlledWhatsAppDispatch(
              dispatchQueue,
              {
                dispatchId,
                ...(instanceName ? { instanceName } : {}),
              },
              jobId,
            );
          },
        };

        try {
          await prisma.commercialNiche.create({
            data: {
              id: IDS.niche,
              name: 'Fixture precommit finalization',
              slug: IDS.niche,
              active: true,
              minimumScore: 60,
            },
          });
          await prisma.whatsAppInstance.create({
            data: { name: INSTANCE, active: true, paused: false },
          });
          await prisma.whatsAppDestination.create({
            data: {
              id: IDS.destination,
              name: 'Grupo precommit finalization',
              destination: GROUP_ID,
              type: 'GROUP',
              active: true,
              paused: false,
              available: true,
              fingerprint: GROUP_FINGERPRINT,
              sourceInstanceName: INSTANCE,
              assignedInstanceName: INSTANCE,
              assignmentRevision: 1,
              instanceAssignments: {
                create: [{ instanceName: INSTANCE, position: 0 }],
              },
            },
          });
          await prisma.whatsAppDestination.create({
            data: {
              id: IDS.independentDestination,
              name: 'Grupo independente precommit finalization',
              destination: INDEPENDENT_GROUP_ID,
              type: 'GROUP',
              active: true,
              paused: false,
              available: true,
              fingerprint: INDEPENDENT_GROUP_FINGERPRINT,
              sourceInstanceName: INSTANCE,
              assignedInstanceName: INSTANCE,
              assignmentRevision: 1,
              instanceAssignments: {
                create: [{ instanceName: INSTANCE, position: 0 }],
              },
            },
          });
          await prisma.commercialGroupCampaign.createMany({
            data: [
              {
                id: IDS.campaign,
                name: 'Campaign precommit finalization',
                logicalGroupFingerprint: GROUP_FINGERPRINT,
                anchorDestinationId: IDS.destination,
                nicheId: IDS.niche,
                active: true,
                cadenceMinutes: 15,
                timezone: 'UTC',
                allowedStartTime: '00:00',
                allowedEndTime: '23:59',
                dailyLimit: 100,
                queueTargetSize: 4,
                dedupeDays: 30,
              },
              {
                id: IDS.independentCampaign,
                name: 'Campaign independente precommit finalization',
                logicalGroupFingerprint: INDEPENDENT_GROUP_FINGERPRINT,
                anchorDestinationId: IDS.independentDestination,
                nicheId: IDS.niche,
                active: true,
                cadenceMinutes: 15,
                timezone: 'UTC',
                allowedStartTime: '00:00',
                allowedEndTime: '23:59',
                dailyLimit: 100,
                queueTargetSize: 4,
                dedupeDays: 30,
              },
            ],
          });
          await prisma.productLead.create({
            data: {
              id: IDS.product,
              source: 'OFFICIAL',
              providerProductId: `${PREFIX}-provider`,
              nome: 'Produto precommit finalization',
              categoria: 'fixture',
              preco: 99.9,
              precoMin: 99.9,
              precoMax: 99.9,
              desconto: 20,
              nota: 4.8,
              vendidos: 100,
              comissao: 10,
              loja: 'Loja precommit finalization',
              urlImagem: 'https://example.invalid/precommit-finalization.jpg',
              productLink: PRODUCT_LINK,
              affiliateLink: AFFILIATE_LINK,
              title: 'Produto precommit finalization',
              commercialSnapshotRevision: 1,
              commercialSnapshotFingerprint: SNAPSHOT_FINGERPRINT,
              fetchedAt: NOW,
              lastSeenAt: NOW,
            },
          });
          await prisma.commercialOfferSnapshot.create({
            data: {
              id: IDS.snapshot,
              productId: IDS.product,
              revision: 1,
              fingerprint: SNAPSHOT_FINGERPRINT,
              price: 99.9,
              discountRate: 20,
              commissionRate: 10,
              observedRating: 4.8,
              observedSales: 100,
              capturedAt: NOW,
            },
          });
          await prisma.generatedCopy.create({
            data: {
              id: IDS.copy,
              productId: IDS.product,
              source: 'LEGACY_TEMPLATE',
              provider: COMMERCIAL_COPY_FALLBACK_PROVIDER,
              model: COMMERCIAL_COPY_FALLBACK_MODEL,
              promptVersion: COMMERCIAL_AI_COPY_PROMPT_VERSION,
              validationVersion: COMMERCIAL_AI_COPY_VALIDATION_VERSION,
              inputFingerprint: `${PREFIX}-input`,
              snapshotId: IDS.snapshot,
              createdFromCandidateId: IDS.candidate,
              ...copyAssembler.assemble({
                output: buildCommercialPromotionFallbackOutput(
                  copyValidator,
                  'Produto precommit finalization',
                  ['Loja precommit finalization'],
                ),
                productName: 'Produto precommit finalization',
                shopName: '',
                price: '99.90',
                discountRate: 20,
                promotionSignals: ['CURRENT_DISCOUNT'],
                priceDropPercent: null,
                affiliateLink: AFFILIATE_LINK,
                maximumLength: 1000,
              }),
            },
          });
          await prisma.commercialPromotionCandidate.create({
            data: {
              id: IDS.candidate,
              campaignId: IDS.campaign,
              productId: IDS.product,
              snapshotId: IDS.snapshot,
              generatedCopyId: IDS.copy,
              status: 'COPY_READY',
              rankPosition: 1,
              commercialScore: 82,
              scorePolicyVersion: 'official-v2',
              minimumScoreUsed: 60,
              scoreBreakdown: { policyVersion: 'official-v2', finalScore: 82 },
              promotionSignals: ['CURRENT_DISCOUNT'],
              queuedAt: NOW,
              lastEvaluatedAt: NOW,
              expiresAt: new Date(NOW.getTime() + 60 * 60_000),
            },
          });
          const ready = await prepared.createReady({
            campaignId: IDS.campaign,
            groupDestinationId: IDS.destination,
            instanceName: INSTANCE,
            logicalGroupFingerprint: GROUP_FINGERPRINT,
            candidateId: IDS.candidate,
            generatedCopyId: IDS.copy,
            copyPreview: `Oferta factual ${AFFILIATE_LINK}`,
            scheduleRevision: 1,
            assignmentRevision: 1,
            expiresAt: new Date(NOW.getTime() + 30 * 60_000),
            now: NOW,
          });
          expect(ready).toMatchObject({ status: 'READY', runId: null });
          if (!ready) throw new Error('precommit fixture was not created');
          await prisma.generatedCopy.create({
            data: {
              id: IDS.competingCopy,
              productId: IDS.product,
              source: 'LEGACY_TEMPLATE',
              titulo: 'Disputa precommit finalization',
              mensagem: 'Disputa de envio local.',
              cta: AFFILIATE_LINK,
              hashtags: '#oferta',
            },
          });
          await prisma.whatsAppDispatch.create({
            data: {
              id: IDS.competingDispatch,
              productId: IDS.product,
              generatedCopyId: IDS.competingCopy,
              destinationId: IDS.destination,
              instanceName: INSTANCE,
              status: 'PENDING',
              attemptCount: 0,
            },
          });
          await prisma.commercialAutomationSettings.upsert({
            where: { id: 'commercial-automation' },
            create: {
              id: 'commercial-automation',
              paused: false,
              pausedAt: null,
              resumedAt: NOW,
              allowedStartTime: '00:00',
              allowedEndTime: '23:59',
              timezone: 'UTC',
              minimumIntervalMinutes: 1,
              staggerMinutes: 0,
              dailyGlobalLimit: 100,
              dailyGroupLimit: 100,
              dailyShopeeHttpLimit: 100,
              dailyOpenAiGenerationLimit: 100,
              scheduleRevision: 1,
            },
            update: {
              paused: false,
              pausedAt: null,
              resumedAt: NOW,
              allowedStartTime: '00:00',
              allowedEndTime: '23:59',
              timezone: 'UTC',
              minimumIntervalMinutes: 1,
              staggerMinutes: 0,
              dailyGlobalLimit: 100,
              dailyGroupLimit: 100,
              dailyShopeeHttpLimit: 100,
              dailyOpenAiGenerationLimit: 100,
              scheduleRevision: 1,
              updatedAt: NOW,
            },
          });

          const config = loadConfig({
            NODE_ENV: 'test',
            DATABASE_URL: databaseUrl,
            REDIS_URL: redisUrl,
            COMMERCIAL_AUTOMATION_ENABLED: 'true',
            COMMERCIAL_TIMEZONE: 'UTC',
            COMMERCIAL_ALLOWED_START_TIME: '00:00',
            COMMERCIAL_ALLOWED_END_TIME: '23:59',
            COMMERCIAL_DAILY_GLOBAL_LIMIT: '100',
            COMMERCIAL_DAILY_GROUP_LIMIT: '100',
            COMMERCIAL_MIN_INTERVAL_MINUTES: '1',
            COMMERCIAL_AUTOMATION_MODE: 'send',
            COMMERCIAL_SCHEDULER_ENABLED: 'false',
            COMMERCIAL_SCHEDULER_CRON: '* * * * *',
            COMMERCIAL_SCHEDULER_TIMEZONE: 'UTC',
            COMMERCIAL_EXECUTION_LEASE_SECONDS: '120',
            COMMERCIAL_EXECUTION_HEARTBEAT_SECONDS: '10',
            COMMERCIAL_AI_COPY_ENABLED: 'false',
            SHOPEE_AFFILIATE_PROVIDER: 'official',
            SHOPEE_AFFILIATE_API_ENABLED: 'true',
            SHOPEE_AFFILIATE_API_URL: 'https://example.invalid/shopee',
            SHOPEE_AFFILIATE_APP_ID: `${PREFIX}-app`,
            SHOPEE_AFFILIATE_SECRET: `${PREFIX}-secret`,
            WHATSAPP_PROVIDER: 'evolution',
            EVOLUTION_API_URL: 'http://127.0.0.1:9',
            EVOLUTION_API_KEY: `${PREFIX}-key`,
            EVOLUTION_INSTANCE_NAME: INSTANCE,
            EVOLUTION_SAFE_MODE: 'true',
            WHATSAPP_GROUP_SEND_ENABLED: 'true',
            WHATSAPP_GROUP_MAX_MESSAGES_PER_RUN: '1',
            SCHEDULER_ENABLED: 'false',
          });
          const preparedInventory = {
            claimReady: (
              input: Parameters<typeof prepared.claimReady>[0],
            ) => prepared.claimReady(input),
            markDispatched: (
              input: Parameters<typeof prepared.markDispatched>[0],
            ) => prepared.markDispatched(input),
            release: (input: Parameters<typeof prepared.release>[0]) =>
              prepared.release(input),
            invalidateReserved: async () => {
              throw new Error('injected local finalization uncertainty');
            },
          };
          const runtime = createCommercialAutomationOrchestratorRuntime(
            config,
            {
              prisma,
              clock: () => NOW,
              confirmationQueue,
              logger,
              preparedInventory,
            },
          );
          const result = await runtime.orchestrator.executeTick({
            schedulerJobId: IDS.schedulerJob,
            bullMqJobId: IDS.bullMqJob,
            mode: 'send',
            provider: 'official',
            targetConstraint: {
              campaignId: IDS.campaign,
              groupId: IDS.destination,
              logicalGroupFingerprint: GROUP_FINGERPRINT,
              instanceName: INSTANCE,
              scheduledFor: NOW.toISOString(),
              slotKey: `${PREFIX}-slot`,
              scheduleRevision: 1,
              assignmentRevision: 1,
            },
          });
          expect(result).toMatchObject({
            status: 'blocked',
            commercialRunId: null,
            reasons: ['COMMERCIAL_AUTOMATION_PREPARED_CLAIM_FINALIZATION_UNKNOWN'],
          });
          expect(provider.sentMessages).toHaveLength(0);
          const execution = await prisma.commercialAutomationExecution.findFirst({
            where: { schedulerJobId: IDS.schedulerJob },
            orderBy: { startedAt: 'desc' },
          });
          expect(execution).toMatchObject({
            id: result.executionId,
            status: 'BLOCKED',
            externalStage: 'NOT_REACHED',
            commercialRunId: null,
            failureCode: 'COMMERCIAL_AUTOMATION_PREPARED_CLAIM_FINALIZATION_UNKNOWN',
            reasons: ['COMMERCIAL_AUTOMATION_PREPARED_CLAIM_FINALIZATION_UNKNOWN'],
          });
          const persistedPrepared = await prisma.commercialPreparedMessage.findUnique({
            where: { id: ready.id },
            select: {
              status: true,
              runId: true,
              reservationOwnerId: true,
            },
          });
          expect(persistedPrepared).toEqual({
            status: 'RESERVED',
            runId: null,
            reservationOwnerId: result.executionId,
          });
          expect(
            await prisma.commercialPromotionCandidate.findUnique({
              where: { id: IDS.candidate },
              select: { status: true },
            }),
          ).toEqual({ status: 'COPY_READY' });
          expect(
            await prisma.commercialPipelineRun.count({
              where: { groupDestinationId: IDS.destination },
            }),
          ).toBe(0);
          expect(
            await prisma.commercialDispatchOutbox.count({
              where: {
                dispatch: { destinationId: IDS.destination },
              },
            }),
          ).toBe(0);
          expect(
            await prisma.whatsAppDispatch.findMany({
              where: { destinationId: IDS.destination },
              select: { id: true },
            }),
          ).toEqual([{ id: IDS.competingDispatch }]);
          expect(
            await dispatchQueue.getJob(
              `commercial-prepared-${ready.id}-job`,
            ),
          ).toBeUndefined();
          expect(
            await repositories.commercialAutomationHistory.hasAmbiguousCommercialExecution(),
          ).toBe(false);

          const policy = createCommercialAutomationPolicyService({
            repositories,
            instanceName: INSTANCE,
            config: {
              enabled: true,
              timezone: 'UTC',
              allowedStartTime: '00:00',
              allowedEndTime: '23:59',
              dailyGlobalLimit: 100,
              dailyGroupLimit: 100,
              minimumIntervalMinutes: 1,
            },
            clock: () => NOW,
          });
          const independentTarget = {
            groupId: IDS.independentDestination,
            groupName: 'Grupo independente precommit finalization',
            instanceName: INSTANCE,
            orderedInstanceNames: [INSTANCE],
            assignmentRevision: 1,
            scheduleRevision: 1,
            logicalGroupFingerprint: INDEPENDENT_GROUP_FINGERPRINT,
            campaignId: IDS.independentCampaign,
            nicheId: IDS.niche,
            dailyLimit: 100,
            cadenceMinutes: 15,
            timezone: 'UTC',
            allowedStartTime: '00:00',
            allowedEndTime: '23:59',
            failureCount: 0,
            nextEligibleAt: null,
          } satisfies CommercialAutomationTarget;
          const independentReadiness =
            await policy.evaluateAutomationReadiness({
              target: independentTarget,
            });
          expect(independentReadiness.allowed).toBe(true);
          expect(independentReadiness.reasons).not.toContain(
            'AMBIGUOUS_COMMERCIAL_RUN_EXISTS',
          );
        } finally {
          await dispatchQueue.obliterate({ force: true }).catch(() => undefined);
          await dispatchQueue.close();
          await redisConnection.quit();
          await prisma.commercialAutomationSettings
            .update({
              where: { id: 'commercial-automation' },
              data: { paused: true, pausedAt: NOW },
            })
            .catch(() => undefined);
          await removeFixtures();
        }
      },
      45_000,
    );
  },
);
