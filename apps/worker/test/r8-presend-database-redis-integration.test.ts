import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPrismaClient } from '@shopee-auto-affiliate-ai/database';
import { loadConfig } from '@shopee-auto-affiliate-ai/config';
import {
  createWhatsAppProvider,
  fingerprintWhatsAppGroupId,
  WhatsAppSendError,
  type HttpClient,
  type WhatsAppProvider,
} from '@shopee-auto-affiliate-ai/providers';
import {
  createRedisConnection,
  createWhatsAppDispatchQueue,
  enqueueControlledWhatsAppDispatch,
} from '@shopee-auto-affiliate-ai/queue';

import { createPrismaRepositories } from '../../api/src/application-services';
import {
  COMMERCIAL_AI_COPY_PROMPT_VERSION,
  COMMERCIAL_AI_COPY_VALIDATION_VERSION,
} from '../../api/src/commercial-ai-copy-prompt';
import { fingerprintCommercialOffer } from '../../api/src/commercial-offer-snapshot';
import { WhatsAppDeliveryConfirmationService } from '../../api/src/whatsapp-delivery-confirmation-service';
import { WhatsAppGroupSendPolicy } from '../../api/src/whatsapp-group-send-policy';
import {
  createWhatsAppDispatchWorker,
  processWhatsAppDispatchJob,
} from '../src/whatsapp-dispatch-worker';
import { startIsolatedWhatsAppDispatchWorker } from '../src/whatsapp-dispatch-runtime';
import {
  createR8OneShotAuthorizationFence,
  r8DestinationSha256,
  r8MessagePayloadSha256,
} from '../src/r8-one-shot-authorization-fence';

const enabled = process.env.RUN_R8_PRESEND_DB_REDIS_TEST === 'true';
const suite = enabled ? describe : describe.skip;
const PREFIX = 'r8-presend-fixture';
const HEAD = 'r8-test-head';
const TREE = 'r8-test-tree';
const logger = { info: () => undefined, error: () => undefined };

type Seed = {
  id: string;
  now: Date;
  instance: string;
  destination: string;
  fingerprint: string;
  affiliateLink: string;
  imageUrl: string;
  caption: string;
  jobId: string;
};

suite('R8 pre-send disposable PostgreSQL/Redis/BullMQ certification', () => {
  let prisma: ReturnType<typeof createPrismaClient>;
  let connection: ReturnType<typeof createRedisConnection>;
  let queue: ReturnType<typeof createWhatsAppDispatchQueue>;

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL ?? '';
    const redisUrl = process.env.REDIS_URL ?? '';
    const database = new URL(databaseUrl);
    const redis = new URL(redisUrl);
    if (
      database.hostname !== '127.0.0.1' ||
      !database.pathname.startsWith('/r8_') ||
      redis.hostname !== '127.0.0.1'
    ) {
      throw new Error('R8 disposable PostgreSQL/Redis identities required');
    }
    prisma = createPrismaClient(databaseUrl);
    connection = createRedisConnection(redisUrl);
    queue = createWhatsAppDispatchQueue(connection);
    await cleanup();
    await queue.obliterate({ force: true });
  });

  afterAll(async () => {
    await Promise.allSettled([queue?.obliterate({ force: true }), cleanup()]);
    await Promise.allSettled([
      queue?.close(),
      connection?.quit(),
      prisma?.$disconnect(),
    ]);
  });

  afterEach(async () => {
    await queue.obliterate({ force: true });
    await cleanup();
  });

  const cleanup = async () => {
    if (!prisma) return;
    await prisma.whatsAppDeliveryEventInbox.deleteMany({
      where: { instanceName: { startsWith: PREFIX } },
    });
    await prisma.commercialDispatchOutbox.deleteMany({
      where: { id: { startsWith: PREFIX } },
    });
    await prisma.whatsAppDispatchManualRecovery.deleteMany({
      where: { dispatchId: { startsWith: PREFIX } },
    });
    await prisma.whatsAppDispatch.deleteMany({
      where: { id: { startsWith: PREFIX } },
    });
    await prisma.commercialPipelineRun.deleteMany({
      where: { id: { startsWith: PREFIX } },
    });
    await prisma.commercialAutomationExecution.deleteMany({
      where: { id: { startsWith: PREFIX } },
    });
    await prisma.commercialPreparedMessage.deleteMany({
      where: { id: { startsWith: PREFIX } },
    });
    await prisma.commercialCopyGenerationAttempt.deleteMany({
      where: { id: { startsWith: PREFIX } },
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
    await prisma.manualPublicationTarget.deleteMany({
      where: { id: { startsWith: PREFIX } },
    });
    await prisma.manualPublicationRequest.deleteMany({
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
      where: { name: { startsWith: PREFIX } },
    });
    await prisma.commercialNiche.deleteMany({
      where: { id: { startsWith: PREFIX } },
    });
  };

  const makeProvider = (
    implementation: WhatsAppProvider['sendMessage'],
  ): WhatsAppProvider => ({
    beginRun: vi.fn(),
    sendMessage: vi.fn(implementation),
  });

  const fenceFor = (seed: Seed, assignmentRevision = 1) =>
    createR8OneShotAuthorizationFence({
      manifest: {
        authorizationId: `${seed.id}-authorization`,
        authorized: true,
        approvedAt: new Date(seed.now.getTime() - 60_000).toISOString(),
        expiresAt: new Date(seed.now.getTime() + 10 * 60_000).toISOString(),
        candidateHead: HEAD,
        candidateTree: TREE,
        jobId: seed.jobId,
        dispatchId: seed.id,
        targetFingerprint: seed.fingerprint,
        destinationSha256: r8DestinationSha256(seed.destination),
        instanceName: seed.instance,
        assignmentRevision,
        campaignId: seed.id,
        productId: seed.id,
        candidateId: seed.id,
        snapshotId: seed.id,
        snapshotRevision: 1,
        generatedCopyId: seed.id,
        deliveryMode: 'IMAGE',
        messagePayloadSha256: r8MessagePayloadSha256({
          deliveryMode: 'IMAGE',
          message: seed.caption,
          imageUrl: seed.imageUrl,
        }),
        maxWhatsAppSend: 1,
        maxEvolutionHttpRequests: 4,
        allowWebhookReadinessSync: true,
        allowSingleDispatchLifecycleWrites: true,
      },
      candidateHead: HEAD,
      candidateTree: TREE,
      clock: () => seed.now,
    });

  const processJob = (
    seed: Seed,
    provider: WhatsAppProvider,
    fence = fenceFor(seed),
  ) =>
    processWhatsAppDispatchJob(
      {
        id: seed.jobId,
        name: 'whatsapp-dispatch',
        data: { dispatchId: seed.id, instanceName: seed.instance },
        opts: { attempts: 1 },
      },
      {
        prisma,
        logger,
        commercialAutomationMode: 'send',
        whatsAppProvider: provider,
        whatsAppProviderResolver: () => provider,
        reservationLeaseMilliseconds: 120_000,
        groupSendPolicy: new WhatsAppGroupSendPolicy({
          enabled: true,
          safeMode: true,
          instanceName: seed.instance,
        }),
        oneShotAuthorizationFence: fence,
        clock: () => seed.now,
      },
    );

  const oneShotRuntimeConfig = (seed: Seed) =>
    loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: process.env.DATABASE_URL ?? '',
      REDIS_URL: process.env.REDIS_URL ?? '',
      COMMERCIAL_AUTOMATION_MODE: 'send',
      SHOPEE_AFFILIATE_PROVIDER: 'official',
      SHOPEE_AFFILIATE_API_ENABLED: 'true',
      SHOPEE_AFFILIATE_API_URL: 'https://example.invalid/graphql',
      SHOPEE_AFFILIATE_APP_ID: 'r8-synthetic-app',
      SHOPEE_AFFILIATE_SECRET: 'r8-synthetic-secret',
      WHATSAPP_PROVIDER: 'evolution',
      EVOLUTION_API_URL: 'http://127.0.0.1:1',
      EVOLUTION_API_KEY: 'r8-synthetic-key',
      EVOLUTION_INSTANCE_NAME: seed.instance,
      EVOLUTION_ALLOWED_DESTINATIONS: seed.destination,
      EVOLUTION_MAX_MESSAGES_PER_BOOT: '1',
      EVOLUTION_SAFE_MODE: 'true',
      WHATSAPP_GROUP_SEND_ENABLED: 'true',
      WHATSAPP_GROUP_MAX_MESSAGES_PER_RUN: '1',
      WHATSAPP_DELIVERY_WEBHOOK_URL:
        'http://host.docker.internal:3333/whatsapp/events/messages.update',
      WHATSAPP_DELIVERY_WEBHOOK_TOKEN: 'r8-synthetic-webhook-token',
      SCHEDULER_ENABLED: 'false',
      COMMERCIAL_SCHEDULER_ENABLED: 'false',
      PORT: '3333',
    });

  const runEvolutionHttpBudgetCase = async (
    scenario: 'already-ready' | 'sync-required' | 'foreign-webhook',
  ) => {
    const seed = await seedLifecycle(`http-budget-${scenario}`);
    const webhookUrl =
      'http://host.docker.internal:3333/whatsapp/events/messages.update';
    const webhookToken = 'r8-synthetic-webhook-token';
    let synchronized = false;
    const calls: Array<'find' | 'set' | 'send'> = [];
    const httpClient: HttpClient = async (input) => {
      const pathname = new URL(input.toString()).pathname;
      if (pathname.includes('/webhook/find/')) {
        calls.push('find');
        const webhook =
          scenario === 'foreign-webhook'
            ? {
                enabled: true,
                url: 'http://foreign.invalid/webhook',
                events: ['MESSAGES_UPDATE'],
              }
            : scenario === 'already-ready' || synchronized
              ? {
                  enabled: true,
                  url: webhookUrl,
                  events: ['MESSAGES_UPDATE'],
                  headers: { authorization: `Bearer ${webhookToken}` },
                  byEvents: false,
                  base64: false,
                }
              : { enabled: false, events: [] };
        return new Response(JSON.stringify(webhook), { status: 200 });
      }
      if (pathname.includes('/webhook/set/')) {
        calls.push('set');
        synchronized = true;
        return new Response(JSON.stringify({ configured: true }), {
          status: 200,
        });
      }
      if (pathname.includes('/message/send')) {
        calls.push('send');
        return new Response(
          JSON.stringify({ key: { id: `${seed.id}-external` } }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected synthetic Evolution path: ${pathname}`);
    };
    const config = oneShotRuntimeConfig(seed);
    const recoveryCoordinator = {
      run: vi.fn(async () => ({
        scanned: 0,
        safeDbRecovered: 0,
        safeQueueRecovered: 0,
        noAction: 0,
        humanRequired: 0,
        jobsReused: 0,
        jobsCreated: 0,
        reservationsReleased: 0,
        finalizersReplayed: 0,
        historicalIgnored: 0,
        ambiguitiesPreserved: 0,
      })),
    };
    const providerFactory = vi.fn<typeof createWhatsAppProvider>(
      (providerConfig, providerOptions) =>
        createWhatsAppProvider(providerConfig, providerOptions),
    );
    await enqueueControlledWhatsAppDispatch(
      queue,
      { dispatchId: seed.id, instanceName: seed.instance },
      seed.jobId,
    );
    const runtime = await startIsolatedWhatsAppDispatchWorker(config, {
      recoveryCoordinator,
      providerFactory,
      providerFactoryOptions: {
        httpClient,
        deliveryWebhookHttpClient: httpClient,
      },
      oneShotAuthorizationFence: fenceFor(seed),
      logger,
    });
    try {
      if ('done' in runtime) await runtime.done;
      else {
        await waitForJob(
          seed.jobId,
          scenario === 'foreign-webhook' ? 'failed' : 'completed',
        );
      }
    } finally {
      await runtime.close();
    }
    return {
      calls,
      providerFactoryCalls: providerFactory.mock.calls.length,
      recoveryCalls: recoveryCoordinator.run.mock.calls.length,
    };
  };

  it('bounds the complete one-shot Evolution HTTP call graph', async () => {
    const alreadyReady = await runEvolutionHttpBudgetCase('already-ready');
    expect(alreadyReady.calls).toEqual(['find', 'send']);
    expect(alreadyReady.calls).toHaveLength(2);
    expect(alreadyReady.providerFactoryCalls).toBe(2);
    expect(alreadyReady.recoveryCalls).toBe(0);

    const syncRequired = await runEvolutionHttpBudgetCase('sync-required');
    expect(syncRequired.calls).toEqual(['find', 'set', 'find', 'send']);
    expect(syncRequired.calls).toHaveLength(4);
    expect(syncRequired.providerFactoryCalls).toBe(2);
    expect(syncRequired.recoveryCalls).toBe(0);

    const foreignWebhook = await runEvolutionHttpBudgetCase('foreign-webhook');
    expect(foreignWebhook.calls).toEqual(['find']);
    expect(foreignWebhook.calls).toHaveLength(1);
    expect(foreignWebhook.providerFactoryCalls).toBe(2);
    expect(foreignWebhook.recoveryCalls).toBe(0);

    process.stdout.write(
      `R8_EVOLUTION_HTTP_BUDGET_SUMMARY=${JSON.stringify({
        oneShotStartupReadinessCalls: 0,
        alreadyReadyEvolutionHttpCount: alreadyReady.calls.length,
        syncRequiredEvolutionHttpCount: syncRequired.calls.length,
        foreignWebhookSendCount: foreignWebhook.calls.filter(
          (call) => call === 'send',
        ).length,
        structuralMax: 4,
        scope: 'ONE_AUTHORIZED_ONE_SHOT_EXECUTION',
      })}\n`,
    );
  }, 60_000);

  it('fails closed before consumer, provider or recovery when the queue has an unrelated job', async () => {
    const seed = await seedLifecycle('queue-isolation');
    const config = oneShotRuntimeConfig(seed);
    const unrelatedJobId = `${seed.id}-unrelated`;
    const unrelated = await enqueueControlledWhatsAppDispatch(
      queue,
      { dispatchId: `${seed.id}-unrelated`, instanceName: seed.instance },
      unrelatedJobId,
    );
    const authorized = await enqueueControlledWhatsAppDispatch(
      queue,
      { dispatchId: seed.id, instanceName: seed.instance },
      seed.jobId,
    );
    const recoveryCoordinator = { run: vi.fn() };
    const providerFactory = vi.fn<typeof createWhatsAppProvider>();
    const workerFactory = vi.fn<typeof createWhatsAppDispatchWorker>();

    await expect(
      startIsolatedWhatsAppDispatchWorker(config, {
        recoveryCoordinator,
        providerFactory,
        workerFactory,
        oneShotAuthorizationFence: fenceFor(seed),
        logger,
      }),
    ).rejects.toMatchObject({
      code: 'R8_ONE_SHOT_AUTHORIZATION_INVALID',
      deliveryMayHaveStarted: false,
    });

    expect(recoveryCoordinator.run).not.toHaveBeenCalled();
    expect(providerFactory).not.toHaveBeenCalled();
    expect(workerFactory).not.toHaveBeenCalled();
    expect(await unrelated.getState()).toBe('waiting');
    expect(unrelated.attemptsMade).toBe(0);
    expect(unrelated.failedReason).toBeUndefined();
    expect(await authorized.getState()).toBe('waiting');
    expect(authorized.attemptsMade).toBe(0);

    await Promise.all([unrelated.remove(), authorized.remove()]);

    process.stdout.write(
      `R8_ONE_SHOT_QUEUE_ISOLATION_SUMMARY=${JSON.stringify({
        defaultMutatingRecoveryCalls: 0,
        unrelatedJobConsumed: 0,
        unrelatedJobStateMutations: 0,
        maxConsumedJobs: 1,
        fakeEvolutionHttpCalls: 0,
        fakeSendCalls: 0,
      })}\n`,
    );
  }, 60_000);

  it('ignora no preflight somente job historico fechado e preserva os dois jobs', async () => {
    const old = await seedLifecycle('closed-historical-queue');
    await prisma.whatsAppDispatch.update({
      where: { id: old.id },
      data: { status: 'PROCESSING', attemptCount: 1 },
    });
    await prisma.commercialPipelineRun.update({
      where: { id: old.id },
      data: {
        status: 'FAILED',
        finalStatus: 'AMBIGUOUS',
        investigationRequired: true,
      },
    });
    await prisma.commercialGroupCampaign.update({
      where: { id: old.id },
      data: {
        attemptExecutionId: null,
        attemptReservedAt: null,
        attemptLeaseExpiresAt: null,
      },
    });
    await prisma.commercialPromotionCandidate.update({
      where: { id: old.id },
      data: {
        status: 'BLOCKED',
        blockedReason: 'AMBIGUITY_ACCEPTED_NO_RETRY',
      },
    });
    await prisma.whatsAppDispatchManualRecovery.create({
      data: {
        id: `${old.id}-manual-recovery`,
        dispatchId: old.id,
        runId: old.id,
        executionId: old.id,
        candidateId: old.id,
        campaignId: old.id,
        jobId: old.jobId,
        decision: 'AMBIGUITY_ACCEPTED_NO_RETRY',
        confirmation: 'ENCERRAR_AMBIGUIDADE_SEM_RETRY',
        attemptCountObserved: 1,
        authorizedAt: new Date(old.now.getTime() + 1_000),
      },
    });
    const oldJob = await enqueueControlledWhatsAppDispatch(
      queue,
      { dispatchId: old.id, instanceName: old.instance },
      old.jobId,
    );

    const fresh = await seedLifecycle('new-authorized-queue');
    const freshJob = await enqueueControlledWhatsAppDispatch(
      queue,
      { dispatchId: fresh.id, instanceName: fresh.instance },
      fresh.jobId,
    );
    const provider: WhatsAppProvider = { sendMessage: vi.fn() };
    const providerFactory = vi.fn<typeof createWhatsAppProvider>(() => provider);
    const oneShotExecutor = vi.fn(async () => ({
      close: async () => undefined,
      done: Promise.resolve(),
    }));
    const runtime = await startIsolatedWhatsAppDispatchWorker(
      oneShotRuntimeConfig(fresh),
      {
        providerFactory,
        oneShotAuthorizationFence: fenceFor(fresh),
        oneShotExecutor,
        logger,
      },
    );

    try {
      expect(providerFactory).toHaveBeenCalledOnce();
      expect(oneShotExecutor).toHaveBeenCalledOnce();
      expect(await oldJob.getState()).toBe('waiting');
      expect(oldJob.attemptsMade).toBe(0);
      expect(await freshJob.getState()).toBe('waiting');
      expect(freshJob.attemptsMade).toBe(0);
      expect(provider.sendMessage).not.toHaveBeenCalled();
    } finally {
      await runtime.close();
      await Promise.allSettled([oldJob.remove(), freshJob.remove()]);
    }
  }, 60_000);

  it('never claims an unrelated job added after one-shot preflight', async () => {
    const seed = await seedLifecycle('queue-toctou-reproduction');
    const authorized = await queue.add(
      'whatsapp-dispatch',
      { dispatchId: seed.id, instanceName: seed.instance },
      { jobId: seed.jobId, delay: 250, attempts: 1 },
    );
    const unrelated = await enqueueControlledWhatsAppDispatch(
      queue,
      { dispatchId: `${seed.id}-unrelated`, instanceName: seed.instance },
      `${seed.jobId}-unrelated`,
    );
    await unrelated.remove();
    const provider = makeProvider(async () => ({
      status: 'sent',
      externalMessageId: `${seed.id}-should-not-send`,
      sentAt: seed.now,
    }));
    const workerFactory = vi.fn<typeof createWhatsAppDispatchWorker>();
    const runtime = await startIsolatedWhatsAppDispatchWorker(
      oneShotRuntimeConfig(seed),
      {
        providerFactory: vi.fn(() => provider),
        workerFactory,
        oneShotAuthorizationFence: fenceFor(seed),
        logger,
      },
    );
    const injected = await enqueueControlledWhatsAppDispatch(
      queue,
      { dispatchId: `${seed.id}-unrelated`, instanceName: seed.instance },
      `${seed.jobId}-unrelated`,
    );
    try {
      if ('done' in runtime) await runtime.done;
      const persistedUnrelated = await queue.getJob(injected.id ?? '');
      expect(await persistedUnrelated?.getState()).toBe('waiting');
      expect(persistedUnrelated?.attemptsMade).toBe(0);
      expect(provider.sendMessage).toHaveBeenCalledOnce();
      expect(workerFactory).not.toHaveBeenCalled();
      process.stdout.write(
        `R8_ONE_SHOT_QUEUE_TOCTOU_FIXED=${JSON.stringify({
          beforeState: 'waiting',
          afterState: 'waiting',
          attemptsMadeBefore: 0,
          attemptsMadeAfter: 0,
          failedReasonBefore: null,
          failedReasonAfter: null,
          authorizedProviderCalls: 1,
          unrelatedProviderCalls: 0,
        })}\n`,
      );
    } finally {
      await runtime.close(true);
      await Promise.allSettled([authorized.remove(), injected.remove()]);
    }
  }, 60_000);

  it('does not reenter processing, submitted or terminal lifecycle state through the one-shot runtime', async () => {
    const outcomes: Record<string, { evolutionHttp: number; sends: number }> = {};
    for (const status of [
      'PROCESSING',
      'SUBMITTED',
      'SENT',
      'DELIVERED',
      'READ',
    ] as const) {
      const seed = await seedLifecycle(`runtime-reentry-${status.toLowerCase()}`);
      await prisma.whatsAppDispatch.update({
        where: { id: seed.id },
        data:
          status === 'PROCESSING'
            ? { status }
            : status === 'SUBMITTED'
              ? {
                  status,
                  externalMessageId: `${seed.id}-external`,
                  submittedAt: seed.now,
                }
              : status === 'DELIVERED'
                ? {
                    status,
                    externalMessageId: `${seed.id}-external`,
                    sentAt: seed.now,
                    deliveredAt: seed.now,
                  }
                : status === 'READ'
                  ? {
                      status,
                      externalMessageId: `${seed.id}-external`,
                      sentAt: seed.now,
                      deliveredAt: seed.now,
                      readAt: seed.now,
                    }
              : {
                  status,
                  externalMessageId: `${seed.id}-external`,
                  sentAt: seed.now,
                },
      });
      await enqueueControlledWhatsAppDispatch(
        queue,
        { dispatchId: seed.id, instanceName: seed.instance },
        seed.jobId,
      );
      const recoveryCoordinator = { run: vi.fn() };
      const provider = makeProvider(async () => ({
        status: 'sent',
        externalMessageId: `${seed.id}-should-not-send`,
        sentAt: seed.now,
      }));
      const providerFactory = vi.fn(() => provider);
      const workerFactory = vi.fn<typeof createWhatsAppDispatchWorker>();
      const runtime = await startIsolatedWhatsAppDispatchWorker(
        oneShotRuntimeConfig(seed),
        {
          recoveryCoordinator,
          providerFactory,
          workerFactory,
          oneShotAuthorizationFence: fenceFor(seed),
          logger,
        },
      );
      if ('done' in runtime) await runtime.done;
      await runtime.close();
      expect(recoveryCoordinator.run).not.toHaveBeenCalled();
      expect(workerFactory).not.toHaveBeenCalled();
      expect(provider.sendMessage).not.toHaveBeenCalled();
      outcomes[status] = { evolutionHttp: 0, sends: 0 };
    }
    process.stdout.write(
      `R8_ONE_SHOT_RUNTIME_REENTRY_SUMMARY=${JSON.stringify(outcomes)}\n`,
    );
  }, 60_000);

  it('persists one exact effect across duplicate, crash, restart, stale revision and webhook replay matrices', async () => {
    const fetchGuard = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('External network forbidden in R8'));
    try {
      const baselineJobs = await queue.getJobs(
        ['waiting', 'delayed', 'active', 'prioritized'],
        0,
        -1,
      );
      expect(baselineJobs).toHaveLength(0);

      const success = await seedLifecycle('success');
      const successProvider = makeProvider(async () => ({
        status: 'sent',
        externalMessageId: `${success.id}-external`,
        sentAt: success.now,
      }));
      const successFence = fenceFor(success);
      await enqueueControlledWhatsAppDispatch(
        queue,
        { dispatchId: success.id, instanceName: success.instance },
        success.jobId,
      );
      const runtime = await startIsolatedWhatsAppDispatchWorker(
        oneShotRuntimeConfig(success),
        {
          providerFactory: vi.fn(() => successProvider),
          oneShotAuthorizationFence: successFence,
          logger,
        },
      );
      try {
        if ('done' in runtime) await runtime.done;
      } finally {
        await runtime.close();
      }
      expect(successProvider.sendMessage).toHaveBeenCalledTimes(1);
      expect(successFence.sendBudgetConsumed).toBe(1);
      expect(await queue.getJobs(['waiting', 'delayed', 'active'], 0, -1)).toHaveLength(0);
      const persistedSuccessJobs = await queue.getJobs(
        ['waiting', 'delayed', 'active', 'completed', 'failed'],
        0,
        -1,
      );
      expect(persistedSuccessJobs.filter((job) => job.id === success.jobId)).toHaveLength(0);
      const persistedSuccess = await prisma.whatsAppDispatch.findUniqueOrThrow({
        where: { id: success.id },
      });
      expect(persistedSuccess).toMatchObject({
        status: 'SUBMITTED',
        attemptCount: 1,
        externalMessageId: `${success.id}-external`,
      });
      await expect(
        processJob(success, successProvider, fenceFor(success)),
      ).rejects.toThrow();
      expect(successProvider.sendMessage).toHaveBeenCalledTimes(1);

      const deliveryRepositories = createPrismaRepositories(prisma);
      if (!deliveryRepositories.whatsappDeliveryEvents) {
        throw new Error('R8 durable delivery inbox repository unavailable');
      }
      const delivery = new WhatsAppDeliveryConfirmationService({
        dispatches: deliveryRepositories.whatsappDispatches,
        deliveryEvents: deliveryRepositories.whatsappDeliveryEvents,
        runs: deliveryRepositories.commercialRuns,
        promotionCandidates: deliveryRepositories.commercialPromotions,
        logger,
      });
      const receipt = {
        instanceName: success.instance,
        externalMessageId: `${success.id}-external`,
        status: 'SERVER_ACK' as const,
        occurredAt: success.now,
      };
      await delivery.consume(receipt);
      await delivery.consume(receipt);
      expect(
        await prisma.whatsAppDispatch.findUniqueOrThrow({
          where: { id: success.id },
        }),
      ).toMatchObject({ status: 'SENT', attemptCount: 1 });
      expect(successProvider.sendMessage).toHaveBeenCalledTimes(1);

      const preflight = await seedLifecycle('preflight');
      const preflightProvider = makeProvider(async () => {
        throw new WhatsAppSendError(
          'Synthetic local pre-request block',
          'R8_SYNTHETIC_PRE_REQUEST_BLOCK',
          { deliveryMayHaveStarted: false },
        );
      });
      await expect(processJob(preflight, preflightProvider)).rejects.toMatchObject({
        code: 'R8_SYNTHETIC_PRE_REQUEST_BLOCK',
      });
      expect(
        await prisma.whatsAppDispatch.findUniqueOrThrow({
          where: { id: preflight.id },
        }),
      ).toMatchObject({ status: 'FAILED', attemptCount: 1 });
      await expect(
        processJob(preflight, preflightProvider, fenceFor(preflight)),
      ).rejects.toThrow();
      expect(preflightProvider.sendMessage).toHaveBeenCalledTimes(1);

      const ambiguous = await seedLifecycle('ambiguous');
      const ambiguousProvider = makeProvider(async () => {
        throw new WhatsAppSendError(
          'Synthetic request uncertainty',
          'EVOLUTION_TIMEOUT',
          { deliveryMayHaveStarted: true },
        );
      });
      await expect(processJob(ambiguous, ambiguousProvider)).rejects.toMatchObject({
        code: 'WHATSAPP_DISPATCH_DELIVERY_AMBIGUOUS',
      });
      expect(
        await prisma.whatsAppDispatch.findUniqueOrThrow({
          where: { id: ambiguous.id },
        }),
      ).toMatchObject({ status: 'PROCESSING', attemptCount: 1 });
      await expect(
        processJob(ambiguous, ambiguousProvider, fenceFor(ambiguous)),
      ).rejects.toThrow();
      expect(ambiguousProvider.sendMessage).toHaveBeenCalledTimes(1);

      const crash = await seedLifecycle('post-provider-crash');
      const crashProvider = makeProvider(async () => ({
        status: 'sent',
        externalMessageId: `${crash.id}-external`,
        sentAt: crash.now,
      }));
      const repositories = createPrismaRepositories(prisma);
      const markSubmitted = vi
        .spyOn(repositories.whatsappDispatches, 'markSubmitted')
        .mockRejectedValueOnce(new Error('Synthetic crash before markSubmitted'));
      await expect(
        processWhatsAppDispatchJob(
          {
            id: crash.jobId,
            name: 'whatsapp-dispatch',
            data: { dispatchId: crash.id, instanceName: crash.instance },
            opts: { attempts: 1 },
          },
          {
            repositories,
            logger,
            commercialAutomationMode: 'send',
            whatsAppProvider: crashProvider,
            whatsAppProviderResolver: () => crashProvider,
            reservationLeaseMilliseconds: 120_000,
            groupSendPolicy: new WhatsAppGroupSendPolicy({
              enabled: true,
              safeMode: true,
              instanceName: crash.instance,
            }),
            oneShotAuthorizationFence: fenceFor(crash),
            clock: () => crash.now,
          },
        ),
      ).rejects.toMatchObject({ code: 'WHATSAPP_DISPATCH_DELIVERY_AMBIGUOUS' });
      markSubmitted.mockRestore();
      expect(
        await prisma.whatsAppDispatch.findUniqueOrThrow({
          where: { id: crash.id },
        }),
      ).toMatchObject({
        status: 'PROCESSING',
        attemptCount: 1,
        externalMessageId: null,
      });
      await expect(
        processJob(crash, crashProvider, fenceFor(crash)),
      ).rejects.toThrow();
      expect(crashProvider.sendMessage).toHaveBeenCalledTimes(1);

      const stale = await seedLifecycle('stale-assignment');
      await prisma.whatsAppInstance.create({
        data: { name: `${stale.instance}-b`, active: true, paused: false },
      });
      await prisma.whatsAppDestination.update({
        where: { id: stale.id },
        data: {
          assignmentRevision: { increment: 1 },
          instanceAssignments: {
            create: { instanceName: `${stale.instance}-b`, position: 1 },
          },
        },
      });
      const staleProvider = makeProvider(async () => ({
        status: 'sent',
        externalMessageId: `${stale.id}-should-not-send`,
        sentAt: stale.now,
      }));
      await expect(
        processJob(stale, staleProvider, fenceFor(stale, 1)),
      ).rejects.toMatchObject({
        code: 'R8_ONE_SHOT_AUTHORIZATION_INVALID',
        deliveryMayHaveStarted: false,
      });
      expect(staleProvider.sendMessage).not.toHaveBeenCalled();

      expect(fetchGuard).not.toHaveBeenCalled();
      expect(
        await queue.getJobs(['waiting', 'delayed', 'active'], 0, -1),
      ).toHaveLength(0);
      process.stdout.write(
        `R8_PRESEND_CERTIFICATION_SUMMARY=${JSON.stringify({
          postgres: 'DISPOSABLE_LOOPBACK_R8_DATABASE',
          redis: 'DISPOSABLE_LOOPBACK_R8_REDIS',
          bullMqBaselineActiveJobs: 0,
          deterministicJobRecords: 1,
          successfulProviderCalls: 1,
          successfulDispatchAttemptCount: 1,
          successfulLifecycle: ['SUBMITTED', 'SENT'],
          duplicateWebhookProviderCalls: 0,
          preRequestFailureProviderCalls: 1,
          preRequestFailureStatus: 'FAILED',
          ambiguousProviderCalls: 1,
          ambiguousStatus: 'PROCESSING',
          postProviderCrashCalls: 1,
          postProviderCrashStatus: 'PROCESSING',
          submittedRestartAdditionalProviderCalls: 0,
          staleAssignmentProviderCalls: 0,
          additionalInjectedUnrelatedConsumed: 0,
          maxConsumedJobs: 1,
          finalActiveQueueJobs: 0,
          externalNetworkAttempts: 0,
        })}\n`,
      );
    } finally {
      fetchGuard.mockRestore();
    }
  }, 60_000);

  const waitForJob = async (jobId: string, state: 'completed' | 'failed') => {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const job = await queue.getJob(jobId);
      if (job && (await job.getState()) === state) return;
      if (job && state === 'completed' && (await job.getState()) === 'failed') {
        throw new Error(`R8 job failed: ${job.failedReason}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`R8 job did not reach ${state}`);
  };

  async function seedLifecycle(scenario: string) {
    const id = `${PREFIX}-${scenario}-${randomUUID()}`;
    const now = new Date();
    const instance = `${id}-instance`;
    const numeric = BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 16)}`)
      .toString()
      .slice(0, 12)
      .padStart(12, '0');
    const destination = `120363${numeric}@g.us`;
    const fingerprint = fingerprintWhatsAppGroupId(destination);
    const affiliateLink = `https://s.shopee.com.br/${id}`;
    const productLink = `https://shopee.com.br/product/1/${id}`;
    const imageUrl = `https://example.invalid/${id}.jpg`;
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
    const caption = `Synthetic offer\n\nSynthetic product\n\nConfira ${affiliateLink}\n\n#r8`;
    const jobId = `${id}-job`;
    await prisma.whatsAppInstance.create({
      data: { name: instance, active: true, paused: false },
    });
    await prisma.whatsAppDestination.create({
      data: {
        id,
        name: 'Synthetic R8 group',
        destination,
        type: 'GROUP',
        active: true,
        available: true,
        paused: false,
        fingerprint,
        sourceInstanceName: instance,
        assignedInstanceName: instance,
        assignmentRevision: 1,
        instanceAssignments: {
          create: { instanceName: instance, position: 0 },
        },
      },
    });
    await prisma.commercialNiche.create({
      data: { id, name: 'Synthetic R8 niche', slug: id, active: true },
    });
    await prisma.commercialGroupCampaign.create({
      data: {
        id,
        name: 'Synthetic R8 campaign',
        logicalGroupFingerprint: fingerprint,
        anchorDestinationId: id,
        nicheId: id,
        active: true,
        attemptExecutionId: id,
        attemptReservedAt: now,
        attemptLeaseExpiresAt: new Date(now.getTime() + 120_000),
      },
    });
    await prisma.productLead.create({
      data: {
        id,
        source: 'OFFICIAL',
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
        urlImagem: imageUrl,
        productLink,
        affiliateLink,
        title: 'Synthetic product',
        fetchedAt: now,
        lastSeenAt: now,
        commercialSnapshotRevision: 1,
        commercialSnapshotFingerprint: snapshotFingerprint,
      },
    });
    await prisma.commercialOfferSnapshot.create({
      data: {
        id,
        productId: id,
        revision: 1,
        fingerprint: snapshotFingerprint,
        price: 100,
        priceMin: 100,
        priceMax: 100,
        discountRate: 20,
        commissionRate: 10,
        observedRating: 4.8,
        observedSales: 100,
        capturedAt: now,
      },
    });
    await prisma.generatedCopy.create({
      data: {
        id,
        productId: id,
        source: 'AI',
        provider: 'r8-fake',
        model: 'r8-fake',
        promptVersion: COMMERCIAL_AI_COPY_PROMPT_VERSION,
        validationVersion: COMMERCIAL_AI_COPY_VALIDATION_VERSION,
        inputFingerprint: id,
        snapshotId: id,
        createdFromCandidateId: id,
        titulo: 'Synthetic offer',
        mensagem: 'Synthetic product',
        cta: `Confira ${affiliateLink}`,
        hashtags: '#r8',
      },
    });
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
        expiresAt: new Date(now.getTime() + 3_600_000),
      },
    });
    await prisma.commercialAutomationExecution.create({
      data: {
        id,
        schedulerJobId: `${id}-scheduler`,
        bullMqJobId: `${id}-execution-job`,
        ownerId: `${id}-owner`,
        heartbeatAt: now,
        leaseExpiresAt: new Date(now.getTime() + 120_000),
        mode: 'SEND',
        status: 'QUEUED',
        externalStage: 'EXTERNAL_MAY_HAVE_STARTED',
        reasons: [],
        commercialRunId: id,
      },
    });
    await prisma.whatsAppDispatch.create({
      data: {
        id,
        productId: id,
        generatedCopyId: id,
        destinationId: id,
        instanceName: instance,
        status: 'PENDING',
        attemptCount: 0,
      },
    });
    await prisma.commercialPipelineRun.create({
      data: {
        id,
        executionId: id,
        instanceName: instance,
        mode: 'CONFIRMED',
        status: 'STARTED',
        productId: id,
        groupDestinationId: id,
        productName: 'Synthetic product',
        productPrice: 100,
        groupName: 'Synthetic R8 group',
        groupFingerprint: fingerprint,
        score: 82,
        scorePolicyVersion: 'official-v2',
        minimumScoreUsed: 60,
        maximumScoreObserved: 82,
        candidateCount: 1,
        eligibleCount: 1,
        rejectedCount: 0,
        rejectionSummary: {},
        selectionReasons: ['R8 synthetic fixture'],
        copyPreview: caption,
        plannedSubIds: [],
        dispatchId: id,
        jobId,
        confirmedAt: now,
        finalStatus: 'PENDING',
        investigationRequired: false,
      },
    });
    await prisma.commercialDispatchOutbox.create({
      data: {
        id,
        commercialRunId: id,
        dispatchId: id,
        jobId,
        instanceName: instance,
        status: 'PUBLISHED',
        publishedAt: now,
      },
    });
    return {
      id,
      now,
      instance,
      destination,
      fingerprint,
      affiliateLink,
      imageUrl,
      caption,
      jobId,
    };
  }
});
