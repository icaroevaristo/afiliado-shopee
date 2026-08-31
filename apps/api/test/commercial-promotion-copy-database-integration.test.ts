import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPrismaClient } from '@shopee-auto-affiliate-ai/database';

import {
  CommercialAiCopyProviderError,
  type CommercialAiCopyProvider,
} from '../src/commercial-ai-copy-provider';
import { CommercialPromotionCopyGenerationService } from '../src/commercial-promotion-copy-generation-service';
import { PrismaCommercialPromotionCopyRepository } from '../src/prisma-repositories';

const enabled = process.env.RUN_COMMERCIAL_AI_COPY_DB_TEST === 'true';
const describeDatabase = enabled ? describe : describe.skip;
const NOW = new Date('2026-08-01T12:00:00.000Z');
const PREFIX = 'validated-ai-copy-fixture';
const CASES = ['success', 'failed', 'ambiguous', 'changed', 'expired'] as const;

const validOutput = (productSuffix: string) => ({
  headline: 'Oferta confiável',
  body: `Produto ${productSuffix} em destaque.`,
  cta: 'Confira os detalhes',
  hashtags: ['#Oferta'],
});

describeDatabase('validated AI promotion copy database fixture', () => {
  const prisma = createPrismaClient();
  const repository = new PrismaCommercialPromotionCopyRepository(prisma);
  const candidateId = (name: (typeof CASES)[number]) =>
    `${PREFIX}-candidate-${name}`;
  const productId = (name: (typeof CASES)[number]) =>
    `${PREFIX}-product-${name}`;
  const snapshotId = (name: (typeof CASES)[number]) =>
    `${PREFIX}-snapshot-${name}`;
  const campaignId = `${PREFIX}-campaign`;
  const nicheId = `${PREFIX}-niche`;
  let protectedBefore: Record<string, number>;

  const protectedCounts = async () => ({
    pipelineRuns: await prisma.commercialPipelineRun.count(),
    automationExecutions: await prisma.commercialAutomationExecution.count(),
    dispatches: await prisma.whatsAppDispatch.count(),
    outboxes: await prisma.commercialDispatchOutbox.count(),
  });

  const service = (provider: CommercialAiCopyProvider) =>
    new CommercialPromotionCopyGenerationService({
      repository,
      provider,
      config: {
        enabled: true,
        provider: 'openai',
        model: 'fixture-model',
        apiKeyConfigured: true,
        timeoutMs: 30_000,
        maxOutputTokens: 300,
        reasoningEffort: 'minimal',
        maximumCopyLength: 1_000,
      },
      clock: () => NOW,
    });

  beforeAll(async () => {
    protectedBefore = await protectedCounts();
    await prisma.commercialNiche.create({
      data: {
        id: nicheId,
        name: 'Casa',
        slug: `${PREFIX}-niche`,
        active: true,
        minimumScore: 60,
      },
    });
    await prisma.commercialGroupCampaign.create({
      data: {
        id: campaignId,
        name: 'Campanha fixture',
        logicalGroupFingerprint: `${PREFIX}-logical-group`,
        nicheId,
        active: true,
      },
    });
    for (const name of CASES) {
      await prisma.productLead.create({
        data: {
          id: productId(name),
          source: 'OFFICIAL',
          providerProductId: `${PREFIX}-provider-${name}`,
          nome: `Produto ${name}`,
          categoria: 'fixture',
          preco: 99.9,
          desconto: 20,
          nota: 4.8,
          vendidos: 500,
          comissao: 10,
          loja: 'Loja fixture',
          urlImagem: 'https://example.invalid/image',
          title: `Produto ${name}`,
          affiliateLink: `https://example.invalid/affiliate/${name}`,
          fetchedAt: NOW,
          lastSeenAt: NOW,
          commercialSnapshotRevision: 1,
          commercialSnapshotFingerprint: `${PREFIX}-fingerprint-${name}`,
        },
      });
      await prisma.commercialOfferSnapshot.create({
        data: {
          id: snapshotId(name),
          productId: productId(name),
          revision: 1,
          fingerprint: `${PREFIX}-fingerprint-${name}`,
          price: 99.9,
          discountRate: 20,
          commissionRate: 10,
          observedRating: 4.8,
          observedSales: 500,
          capturedAt: NOW,
        },
      });
      await prisma.commercialPromotionCandidate.create({
        data: {
          id: candidateId(name),
          campaignId,
          productId: productId(name),
          snapshotId: snapshotId(name),
          status: 'QUEUED',
          rankPosition: 1,
          commercialScore: 82,
          scorePolicyVersion: 'official-v2',
          minimumScoreUsed: 60,
          scoreBreakdown: {
            policyVersion: 'official-v2',
            rawTotal: 82,
            finalScore: 82,
            components: { commission: 20, rating: 20, sales: 20, discount: 22 },
          },
          promotionSignals: ['CURRENT_DISCOUNT'],
          queuedAt: NOW,
          lastEvaluatedAt: NOW,
          expiresAt: new Date('2026-08-02T12:00:00.000Z'),
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.commercialCopyGenerationAttempt.deleteMany({
      where: { candidateId: { startsWith: `${PREFIX}-candidate-` } },
    });
    await prisma.commercialPromotionCandidate.deleteMany({
      where: { campaignId },
    });
    await prisma.generatedCopy.deleteMany({
      where: { createdFromCandidateId: { startsWith: `${PREFIX}-candidate-` } },
    });
    await prisma.commercialOfferSnapshot.deleteMany({
      where: { productId: { startsWith: `${PREFIX}-product-` } },
    });
    await prisma.productLead.deleteMany({
      where: { id: { startsWith: `${PREFIX}-product-` } },
    });
    await prisma.commercialGroupCampaign.delete({ where: { id: campaignId } });
    await prisma.commercialNiche.delete({ where: { id: nicheId } });
    expect(await protectedCounts()).toEqual(protectedBefore);
    await prisma.$disconnect();
  });

  it('persiste sucesso atomicamente e reutiliza cache sem nova chamada', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const provider: CommercialAiCopyProvider = {
      generate: vi.fn(async () => {
        await gate;
        return {
          output: validOutput('success'),
          provider: 'openai' as const,
          model: 'fixture-model',
          usage: {
            inputTokens: 10,
            outputTokens: 20,
            totalTokens: 30,
            reasoningTokens: 4,
          },
        };
      }),
    };
    const copyService = service(provider);
    const first = copyService.generate(
      candidateId('success'),
      'GERAR_COPY_COM_IA',
    );
    await vi.waitFor(async () => {
      expect(
        await prisma.commercialCopyGenerationAttempt.count({
          where: { candidateId: candidateId('success'), status: 'STARTED' },
        }),
      ).toBe(1);
    });
    const concurrent = copyService.generate(
      candidateId('success'),
      'GERAR_COPY_COM_IA',
    );
    await expect(concurrent).rejects.toMatchObject({
      code: 'COMMERCIAL_AI_COPY_GENERATION_IN_PROGRESS',
    });
    release();
    await expect(first).resolves.toMatchObject({
      status: 'COPY_READY',
      cacheHit: false,
    });
    await expect(
      copyService.generate(candidateId('success'), 'GERAR_COPY_COM_IA'),
    ).resolves.toMatchObject({ status: 'COPY_READY', cacheHit: true });
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(
      await prisma.commercialPromotionCandidate.findUnique({
        where: { id: candidateId('success') },
        select: { status: true, generatedCopyId: true },
      }),
    ).toMatchObject({
      status: 'COPY_READY',
      generatedCopyId: expect.any(String),
    });
    expect(
      await prisma.commercialCopyGenerationAttempt.findFirst({
        where: { candidateId: candidateId('success') },
        select: { status: true, generatedCopyId: true },
      }),
    ).toMatchObject({
      status: 'SUCCEEDED',
      generatedCopyId: expect.any(String),
    });
  });

  it.each([
    ['failed', 'FAILED_CONFIRMED', 'FAILED', false],
    ['ambiguous', 'AMBIGUOUS', 'AMBIGUOUS', true],
  ] as const)(
    'preserva QUEUED e nenhuma copy para resultado %s',
    async (name, kind, expectedStatus, requestMayHaveStarted) => {
      const provider: CommercialAiCopyProvider = {
        generate: vi
          .fn()
          .mockRejectedValue(
            new CommercialAiCopyProviderError(
              kind,
              kind === 'AMBIGUOUS'
                ? 'COMMERCIAL_AI_COPY_PROVIDER_RESULT_AMBIGUOUS'
                : 'COMMERCIAL_AI_COPY_PROVIDER_FAILED',
            ),
          ),
      };
      await expect(
        service(provider).generate(candidateId(name), 'GERAR_COPY_COM_IA'),
      ).rejects.toBeDefined();
      expect(
        await prisma.commercialPromotionCandidate.findUnique({
          where: { id: candidateId(name) },
          select: { status: true, generatedCopyId: true },
        }),
      ).toEqual({ status: 'QUEUED', generatedCopyId: null });
      expect(
        await prisma.commercialCopyGenerationAttempt.findFirst({
          where: { candidateId: candidateId(name) },
          select: { status: true, requestMayHaveStarted: true },
        }),
      ).toEqual({ status: expectedStatus, requestMayHaveStarted });
    },
  );

  it('rejeita atomicamente quando o snapshot muda durante a chamada', async () => {
    const provider: CommercialAiCopyProvider = {
      generate: vi.fn(async () => {
        await prisma.productLead.update({
          where: { id: productId('changed') },
          data: {
            commercialSnapshotFingerprint: `${PREFIX}-changed-during-call`,
          },
        });
        return {
          output: validOutput('changed'),
          provider: 'openai' as const,
          model: 'fixture-model',
          usage: {
            inputTokens: null,
            outputTokens: null,
            totalTokens: null,
            reasoningTokens: null,
          },
        };
      }),
    };
    await expect(
      service(provider).generate(candidateId('changed'), 'GERAR_COPY_COM_IA'),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_AI_COPY_CATALOG_CHANGED' });
    expect(
      await prisma.generatedCopy.count({
        where: { createdFromCandidateId: candidateId('changed') },
      }),
    ).toBe(0);
    expect(
      await prisma.commercialPromotionCandidate.findUnique({
        where: { id: candidateId('changed') },
        select: { status: true, generatedCopyId: true },
      }),
    ).toEqual({ status: 'QUEUED', generatedCopyId: null });
  });

  it('rejeita atomicamente quando a oferta expira durante a chamada', async () => {
    const provider: CommercialAiCopyProvider = {
      generate: vi.fn(async () => {
        await prisma.$executeRaw`
          UPDATE "CommercialPromotionCandidate"
          SET "expiresAt" = ${NOW}
          WHERE "id" = ${candidateId('expired')}
        `;
        return {
          output: validOutput('expired'),
          provider: 'openai' as const,
          model: 'fixture-model',
          usage: {
            inputTokens: null,
            outputTokens: null,
            totalTokens: null,
            reasoningTokens: null,
          },
        };
      }),
    };
    await expect(
      service(provider).generate(candidateId('expired'), 'GERAR_COPY_COM_IA'),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_AI_COPY_CATALOG_CHANGED' });
    expect(
      await prisma.generatedCopy.count({
        where: { createdFromCandidateId: candidateId('expired') },
      }),
    ).toBe(0);
    expect(
      await prisma.commercialPromotionCandidate.findUnique({
        where: { id: candidateId('expired') },
        select: { status: true, generatedCopyId: true },
      }),
    ).toEqual({ status: 'QUEUED', generatedCopyId: null });
  });

  it('markAttemptTerminal sanitiza códigos (malformado, desconhecido, duplicado, fora de ordem)', async () => {
    const fingerprint = `${PREFIX}-mark-terminal-fingerprint`;
    await prisma.commercialCopyGenerationAttempt.create({
      data: {
        id: `${PREFIX}-mark-terminal`,
        candidateId: candidateId('failed'),
        snapshotId: snapshotId('failed'),
        inputFingerprint: fingerprint,
        provider: 'openai',
        model: 'fixture-model',
        promptVersion: 'v1',
        validationVersion: 'v1',
        status: 'STARTED',
        startedAt: NOW,
      },
    });

    const result = await repository.markAttemptTerminal({
      inputFingerprint: fingerprint,
      status: 'FAILED',
      failureCode: 'COMMERCIAL_AI_COPY_OUTPUT_INVALID',
      requestMayHaveStarted: true,
      validationFailureCodes: ['UNKNOWN', 'AI_HEADLINE_LENGTH', 'AI_HEADLINE_LENGTH', 'AI_BODY_LENGTH', null as unknown as string],
      completedAt: NOW,
    });
    expect(result).toBe(true);

    const attempts = await prisma.commercialCopyGenerationAttempt.findMany({
      where: { candidateId: candidateId('failed') },
    });
    const attempt = attempts.find((a) => a.inputFingerprint === fingerprint);
    expect(attempt?.status).toBe('FAILED');
    expect(attempt?.validationFailureCodes).toEqual([
      'AI_BODY_LENGTH',
      'AI_HEADLINE_LENGTH',
    ]);

    // Attempt já terminal não é alterado
    const result2 = await repository.markAttemptTerminal({
      inputFingerprint: fingerprint,
      status: 'AMBIGUOUS',
      failureCode: 'COMMERCIAL_AI_COPY_PERSISTENCE_AMBIGUOUS',
      requestMayHaveStarted: true,
      validationFailureCodes: ['AI_CTA_LENGTH'],
      completedAt: NOW,
    });
    expect(result2).toBe(false);

    const attempts2 = await prisma.commercialCopyGenerationAttempt.findMany({
      where: { candidateId: candidateId('failed') },
    });
    const attempt2 = attempts2.find((a) => a.inputFingerprint === fingerprint);
    expect(attempt2?.status).toBe('FAILED');
    expect(attempt2?.validationFailureCodes).toEqual([
      'AI_BODY_LENGTH',
      'AI_HEADLINE_LENGTH',
    ]);
  });
});
