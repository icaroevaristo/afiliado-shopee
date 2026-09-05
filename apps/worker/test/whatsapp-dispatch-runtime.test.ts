import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '@shopee-auto-affiliate-ai/config';
import {
  createWhatsAppProvider,
  type WhatsAppProvider,
} from '@shopee-auto-affiliate-ai/providers';
import type { CommercialRecoveryReport } from '../../api/src/commercial-recovery-coordinator';

import {
  startIsolatedWhatsAppDispatchWorker,
  type WhatsAppDispatchWorkerFactory,
} from '../src/whatsapp-dispatch-runtime';

const previewConfig = loadConfig({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379',
  COMMERCIAL_AUTOMATION_MODE: 'preview',
});

const sendConfig = loadConfig({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379',
  COMMERCIAL_AUTOMATION_MODE: 'send',
  SHOPEE_AFFILIATE_PROVIDER: 'official',
  SHOPEE_AFFILIATE_API_ENABLED: 'true',
  SHOPEE_AFFILIATE_API_URL: 'https://example.test',
  SHOPEE_AFFILIATE_APP_ID: 'test-app',
  SHOPEE_AFFILIATE_SECRET: 'test-secret',
  WHATSAPP_PROVIDER: 'evolution',
  EVOLUTION_API_URL: 'http://localhost:8080',
  EVOLUTION_API_KEY: 'test-key',
  EVOLUTION_INSTANCE_NAME: 'test-instance',
  WHATSAPP_GROUP_SEND_ENABLED: 'true',
});

const evolutionResponse = () =>
  new Response(JSON.stringify({ key: { id: 'evolution-test-message' } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const recoveryReport = (
  overrides: Partial<CommercialRecoveryReport> = {},
): CommercialRecoveryReport => ({
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
  ...overrides,
});

const createWorkerHarness = () => {
  const provider: WhatsAppProvider = {
    sendMessage: vi.fn<WhatsAppProvider['sendMessage']>(async () => ({
      externalMessageId: 'mock-id',
      status: 'sent' as const,
      sentAt: new Date('2026-07-25T12:00:00.000Z'),
    })),
  };
  const close = vi.fn(async () => undefined);
  const providerFactory = vi.fn<typeof createWhatsAppProvider>(() => provider);
  const workerFactory = vi.fn<WhatsAppDispatchWorkerFactory>(() => ({
    close,
  }));
  const logger = { info: vi.fn(), error: vi.fn() };
  return { provider, close, providerFactory, workerFactory, logger };
};

describe('isolated WhatsApp dispatch worker', () => {
  it('fails closed in preview before creating provider or worker', async () => {
    const providerFactory = vi.fn();
    const workerFactory = vi.fn();
    await expect(
      startIsolatedWhatsAppDispatchWorker(previewConfig, {
        providerFactory,
        workerFactory,
      }),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: 'WHATSAPP_DISPATCH_WORKER_SEND_MODE_REQUIRED',
      }),
    );
    expect(providerFactory).not.toHaveBeenCalled();
    expect(workerFactory).not.toHaveBeenCalled();
  });

  it('compoe somente provider, politica e consumer de whatsapp-dispatch', async () => {
    const provider: WhatsAppProvider = {
      sendMessage: vi.fn<WhatsAppProvider['sendMessage']>(async () => ({
        externalMessageId: 'mock-id',
        status: 'sent' as const,
        sentAt: new Date('2026-07-25T12:00:00.000Z'),
      })),
    };
    const close = vi.fn(async () => undefined);
    const providerFactory = vi.fn<typeof createWhatsAppProvider>(
      () => provider,
    );
    const workerFactory = vi.fn<WhatsAppDispatchWorkerFactory>(() => ({
      close,
    }));
    const logger = { info: vi.fn(), error: vi.fn() };

    const runtime = await startIsolatedWhatsAppDispatchWorker(sendConfig, {
      providerFactory,
      workerFactory,
      logger,
    });

    expect(providerFactory).toHaveBeenCalledOnce();
    expect(workerFactory).toHaveBeenCalledOnce();
    expect(workerFactory.mock.calls[0][0]).toBe(sendConfig.REDIS_URL);
    expect(workerFactory.mock.calls[0][1]).toMatchObject({
      logger,
      whatsAppProvider: provider,
      groupSendPolicy: expect.any(Object),
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'whatsapp-dispatch.worker.started',
        queue: 'whatsapp-dispatch',
      }),
      expect.any(String),
    );
    await runtime.close();
    expect(close).toHaveBeenCalledOnce();
  });

  it('bloqueia o startup quando recovery exige intervencao humana', async () => {
    const harness = createWorkerHarness();
    const recoveryCoordinator = {
      run: vi.fn(async () => recoveryReport({ humanRequired: 1 })),
    };

    await expect(
      startIsolatedWhatsAppDispatchWorker(sendConfig, {
        providerFactory: harness.providerFactory,
        workerFactory: harness.workerFactory,
        recoveryCoordinator,
        logger: harness.logger,
      }),
    ).rejects.toMatchObject({
      code: 'COMMERCIAL_RECOVERY_HUMAN_REQUIRED',
    });

    expect(recoveryCoordinator.run).toHaveBeenCalledOnce();
    expect(harness.providerFactory).not.toHaveBeenCalled();
    expect(harness.workerFactory).not.toHaveBeenCalled();
    expect(harness.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'commercial-recovery.coordinator.startup-blocked',
        humanRequired: 1,
        ambiguitiesPreserved: 0,
        errorCode: 'COMMERCIAL_RECOVERY_HUMAN_REQUIRED',
      }),
      'Commercial recovery requires human intervention before startup',
    );
    expect(harness.logger.info).not.toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'commercial-recovery.coordinator.startup-complete',
      }),
      expect.any(String),
    );
  });

  it('bloqueia o startup quando recovery preserva ambiguity', async () => {
    const harness = createWorkerHarness();
    const recoveryCoordinator = {
      run: vi.fn(async () => recoveryReport({ ambiguitiesPreserved: 1 })),
    };

    await expect(
      startIsolatedWhatsAppDispatchWorker(sendConfig, {
        providerFactory: harness.providerFactory,
        workerFactory: harness.workerFactory,
        recoveryCoordinator,
        logger: harness.logger,
      }),
    ).rejects.toMatchObject({
      code: 'COMMERCIAL_RECOVERY_HUMAN_REQUIRED',
    });

    expect(harness.providerFactory).not.toHaveBeenCalled();
    expect(harness.workerFactory).not.toHaveBeenCalled();
    expect(harness.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'commercial-recovery.coordinator.startup-blocked',
        humanRequired: 0,
        ambiguitiesPreserved: 1,
        errorCode: 'COMMERCIAL_RECOVERY_HUMAN_REQUIRED',
      }),
      'Commercial recovery requires human intervention before startup',
    );
  });

  it('bloqueia o startup quando recovery exige humano e preserva ambiguity', async () => {
    const harness = createWorkerHarness();
    const recoveryCoordinator = {
      run: vi.fn(async () =>
        recoveryReport({ humanRequired: 1, ambiguitiesPreserved: 1 }),
      ),
    };

    await expect(
      startIsolatedWhatsAppDispatchWorker(sendConfig, {
        providerFactory: harness.providerFactory,
        workerFactory: harness.workerFactory,
        recoveryCoordinator,
        logger: harness.logger,
      }),
    ).rejects.toMatchObject({
      code: 'COMMERCIAL_RECOVERY_HUMAN_REQUIRED',
    });

    expect(harness.providerFactory).not.toHaveBeenCalled();
    expect(harness.workerFactory).not.toHaveBeenCalled();
    expect(harness.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'commercial-recovery.coordinator.startup-blocked',
        humanRequired: 1,
        ambiguitiesPreserved: 1,
        errorCode: 'COMMERCIAL_RECOVERY_HUMAN_REQUIRED',
      }),
      'Commercial recovery requires human intervention before startup',
    );
  });

  it('permite startup quando apenas historico terminal foi ignorado', async () => {
    const harness = createWorkerHarness();
    const recoveryCoordinator = {
      run: vi.fn(async () => recoveryReport({ historicalIgnored: 19 })),
    };

    const runtime = await startIsolatedWhatsAppDispatchWorker(sendConfig, {
      providerFactory: harness.providerFactory,
      workerFactory: harness.workerFactory,
      recoveryCoordinator,
      logger: harness.logger,
    });

    expect(harness.providerFactory).toHaveBeenCalledOnce();
    expect(harness.workerFactory).toHaveBeenCalledOnce();
    expect(harness.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'commercial-recovery.coordinator.startup-complete',
        historicalIgnored: 19,
      }),
      'Commercial recovery coordinator completed before WhatsApp worker startup',
    );
    expect(harness.logger.error).not.toHaveBeenCalled();
    await runtime.close();
  });

  it('permite startup quando recovery seguro foi concluido', async () => {
    const harness = createWorkerHarness();
    const recoveryCoordinator = {
      run: vi.fn(async () =>
        recoveryReport({
          safeDbRecovered: 1,
          safeQueueRecovered: 1,
          finalizersReplayed: 1,
        }),
      ),
    };

    const runtime = await startIsolatedWhatsAppDispatchWorker(sendConfig, {
      providerFactory: harness.providerFactory,
      workerFactory: harness.workerFactory,
      recoveryCoordinator,
      logger: harness.logger,
    });

    expect(harness.providerFactory).toHaveBeenCalledOnce();
    expect(harness.workerFactory).toHaveBeenCalledOnce();
    expect(harness.logger.error).not.toHaveBeenCalled();
    await runtime.close();
  });

  it('executa recovery antes de criar provider ou consumer', async () => {
    const events: string[] = [];
    const recoveryCoordinator = {
      run: vi.fn(async () => {
        events.push('recovery');
        return {
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
        };
      }),
    };
    const provider: WhatsAppProvider = {
      sendMessage: vi.fn(),
    };
    const close = vi.fn(async () => undefined);
    const providerFactory = vi.fn<typeof createWhatsAppProvider>(() => {
      events.push('provider');
      return provider;
    });
    const workerFactory = vi.fn<WhatsAppDispatchWorkerFactory>(() => {
      events.push('worker');
      return {
        close,
      };
    });

    const runtime = await startIsolatedWhatsAppDispatchWorker(sendConfig, {
      providerFactory,
      workerFactory,
      recoveryCoordinator,
      logger: { info: vi.fn(), error: vi.fn() },
    });

    expect(events).toEqual(['recovery', 'provider', 'worker']);
    expect(recoveryCoordinator.run).toHaveBeenCalledOnce();
    await runtime.close();
  });

  it('mantem o cap individual no escopo do provider resolvido por dispatch', async () => {
    const destination = '5511999999999';
    const httpClient = vi
      .fn()
      .mockImplementation(async () => evolutionResponse());
    const close = vi.fn(async () => undefined);
    let providerResolver:
      | ((instanceName: string) => WhatsAppProvider | Promise<WhatsAppProvider>)
      | undefined;
    const providerFactory = vi.fn<typeof createWhatsAppProvider>(
      (config, options) =>
        createWhatsAppProvider(
          {
            ...config,
            EVOLUTION_ALLOWED_DESTINATIONS: [destination],
            EVOLUTION_MAX_MESSAGES_PER_BOOT: 1,
          },
          { ...options, httpClient },
        ),
    );
    const workerFactory = vi.fn<WhatsAppDispatchWorkerFactory>(
      (_redisUrl, options) => {
        providerResolver = options.whatsAppProviderResolver;
        return { close };
      },
    );

    const runtime = await startIsolatedWhatsAppDispatchWorker(sendConfig, {
      providerFactory,
      workerFactory,
      logger: { info: vi.fn(), error: vi.fn() },
    });

    expect(providerResolver).toBeDefined();
    const firstProvider = await providerResolver!('test-instance');
    await firstProvider.sendMessage({ destination, message: 'Oferta A' });
    const secondProvider = await providerResolver!('test-instance');
    await secondProvider.sendMessage({ destination, message: 'Oferta B' });

    expect(firstProvider).not.toBe(secondProvider);
    expect(providerFactory).toHaveBeenCalledTimes(3);
    expect(httpClient).toHaveBeenCalledTimes(2);
    await runtime.close();
    expect(close).toHaveBeenCalledOnce();
  });
});
