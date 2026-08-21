import { describe, expect, it, vi } from 'vitest';

import { PrismaCommercialCopyHistoryRepository } from '../src/prisma-commercial-copy-history-repository';

const candidate = {
  id: 'candidate-1',
  campaignId: 'campaign-1',
  status: 'COPY_READY',
  campaign: { name: 'Campanha real' },
  product: { id: 'product-1', nome: 'Produto persistido' },
};

const exactAttempt = {
  id: 'attempt-copy-1',
  candidateId: 'candidate-1',
  snapshotId: 'snapshot-1',
  inputFingerprint: 'fingerprint-copy-1',
  provider: 'openai',
  model: 'gpt-5-mini',
  promptVersion: 'copy-v10',
  validationVersion: 'validation-v2',
  status: 'OUTPUT_INVALID',
  generatedCopyId: 'copy-1',
  failureCode: 'COPY_OUTPUT_INVALID',
  validationFailureCodes: ['MISSING_CTA'],
  requestMayHaveStarted: true,
  inputTokens: 100,
  outputTokens: 30,
  totalTokens: 130,
  startedAt: new Date('2026-08-20T14:00:00.000Z'),
  completedAt: new Date('2026-08-20T14:00:01.000Z'),
  createdAt: new Date('2026-08-20T14:00:00.000Z'),
};

const generatedCopy = {
  id: 'copy-1',
  productId: 'product-1',
  source: 'AI',
  provider: 'openai',
  model: 'gpt-5-mini',
  promptVersion: 'copy-v10',
  validationVersion: 'validation-v2',
  inputFingerprint: 'fingerprint-copy-1',
  snapshotId: 'snapshot-1',
  createdFromCandidateId: 'candidate-1',
  usageInputTokens: 100,
  usageOutputTokens: 30,
  usageTotalTokens: 130,
  createdAt: new Date('2026-08-20T14:02:00.000Z'),
  product: { nome: 'Produto persistido' },
  generationAttempts: [exactAttempt],
  whatsappDispatches: [
    {
      id: 'dispatch-1',
      status: 'SENT',
      commercialPipelineRun: {
        id: 'run-1',
        status: 'COMPLETED',
        finalStatus: 'SENT',
      },
    },
  ],
};

const unlinkedAttempt = {
  ...exactAttempt,
  id: 'attempt-started',
  status: 'STARTED',
  generatedCopyId: null,
  validationFailureCodes: [],
  totalTokens: null,
  startedAt: new Date('2026-08-20T14:01:00.000Z'),
  candidate,
};

describe('PrismaCommercialCopyHistoryRepository', () => {
  it('lista copies persistidas e tentativas sem copy em uma ordem paginavel', async () => {
    const generatedCopyFindMany = vi.fn().mockResolvedValue([generatedCopy]);
    const unlinkedAttemptFindMany = vi.fn().mockResolvedValue([unlinkedAttempt]);
    const prisma = {
      generatedCopy: {
        findMany: generatedCopyFindMany,
        count: vi.fn().mockResolvedValue(1),
      },
      commercialCopyGenerationAttempt: {
        findMany: unlinkedAttemptFindMany,
        count: vi.fn().mockResolvedValue(1),
      },
      commercialPromotionCandidate: {
        findMany: vi.fn().mockResolvedValue([candidate]),
      },
    };
    const repository = new PrismaCommercialCopyHistoryRepository(prisma as never);

    const firstPage = await repository.list({ page: 1, limit: 1 });
    const secondPage = await repository.list({ page: 2, limit: 1 });

    expect(firstPage.total).toBe(2);
    expect(firstPage.items[0]).toMatchObject({
      kind: 'COPY',
      id: 'copy-1',
      copy: {
        productName: 'Produto persistido',
        attempts: [
          {
            id: 'attempt-copy-1',
            status: 'OUTPUT_INVALID',
            validationFailureCodes: ['MISSING_CTA'],
            totalTokens: 130,
          },
        ],
        dispatches: [{ id: 'dispatch-1', runId: 'run-1', finalStatus: 'SENT' }],
      },
    });
    expect(secondPage.items[0]).toMatchObject({
      kind: 'ATTEMPT',
      id: 'attempt-started',
      copy: null,
      attempt: { status: 'STARTED', generatedCopyId: null, totalTokens: null },
      candidate: {
        id: 'candidate-1',
        campaignName: 'Campanha real',
        productId: 'product-1',
        productName: 'Produto persistido',
      },
    });
    expect(generatedCopyFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 2,
      }),
    );
    expect(unlinkedAttemptFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { generatedCopyId: null },
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        take: 2,
      }),
    );
  });
});
