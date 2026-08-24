import type { DatabaseClient } from '@shopee-auto-affiliate-ai/database';

import type {
  CommercialCopyHistoryAttempt,
  CommercialCopyHistoryCandidate,
  CommercialCopyHistoryCopy,
  CommercialCopyHistoryDispatch,
  CommercialCopyHistoryListInput,
  CommercialCopyHistoryListResult,
  CommercialCopyHistoryRecord,
  CommercialCopyHistoryRepository,
} from './commercial-copy-history-repository';

type CopyHistoryPrisma = Pick<
  DatabaseClient,
  | 'generatedCopy'
  | 'commercialCopyGenerationAttempt'
  | 'commercialPromotionCandidate'
>;

const mapCandidate = (candidate: {
  id: string;
  campaignId: string;
  status: string;
  campaign: { name: string };
  product: { id: string; nome: string };
}): CommercialCopyHistoryCandidate => ({
  id: candidate.id,
  campaignId: candidate.campaignId,
  campaignName: candidate.campaign.name,
  productId: candidate.product.id,
  productName: candidate.product.nome,
  status: candidate.status,
});

const mapAttempt = (attempt: {
  id: string;
  candidateId: string;
  snapshotId: string;
  inputFingerprint: string;
  provider: string;
  model: string;
  promptVersion: string;
  validationVersion: string;
  status: string;
  generatedCopyId: string | null;
  failureCode: string | null;
  validationFailureCodes: string[];
  requestMayHaveStarted: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  startedAt: Date;
  completedAt: Date | null;
  createdAt: Date;
}): CommercialCopyHistoryAttempt => attempt;

const mapDispatch = (dispatch: {
  id: string;
  status: string;
  commercialPipelineRun: {
    id: string;
    status: string;
    finalStatus: string | null;
  } | null;
}): CommercialCopyHistoryDispatch => ({
  id: dispatch.id,
  status: dispatch.status,
  runId: dispatch.commercialPipelineRun?.id ?? null,
  runStatus: dispatch.commercialPipelineRun?.status ?? null,
  finalStatus: dispatch.commercialPipelineRun?.finalStatus ?? null,
});

const compareRoots = <
  T extends { kind: 'COPY' | 'ATTEMPT'; id: string; createdAt: Date },
>(
  left: T,
  right: T,
) => {
  const byTimestamp = right.createdAt.getTime() - left.createdAt.getTime();
  if (byTimestamp !== 0) return byTimestamp;

  const byKind = (left.kind === 'COPY' ? 0 : 1) - (right.kind === 'COPY' ? 0 : 1);
  if (byKind !== 0) return byKind;

  return right.id.localeCompare(left.id);
};

export class PrismaCommercialCopyHistoryRepository
  implements CommercialCopyHistoryRepository
{
  constructor(private readonly prisma: CopyHistoryPrisma) {}

  async list(
    input: CommercialCopyHistoryListInput,
  ): Promise<CommercialCopyHistoryListResult> {
    const offset = (input.page - 1) * input.limit;
    const take = offset + input.limit;
    const [copies, unlinkedAttempts, copyTotal, unlinkedAttemptTotal] =
      await Promise.all([
        this.prisma.generatedCopy.findMany({
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take,
          select: {
            id: true,
            productId: true,
            source: true,
            provider: true,
            model: true,
            promptVersion: true,
            validationVersion: true,
            inputFingerprint: true,
            snapshotId: true,
            createdFromCandidateId: true,
            usageInputTokens: true,
            usageOutputTokens: true,
            usageTotalTokens: true,
            createdAt: true,
            product: { select: { nome: true } },
            generationAttempts: {
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              select: {
                id: true,
                candidateId: true,
                snapshotId: true,
                inputFingerprint: true,
                provider: true,
                model: true,
                promptVersion: true,
                validationVersion: true,
                status: true,
                generatedCopyId: true,
                failureCode: true,
                validationFailureCodes: true,
                requestMayHaveStarted: true,
                inputTokens: true,
                outputTokens: true,
                totalTokens: true,
                startedAt: true,
                completedAt: true,
                createdAt: true,
              },
            },
            whatsappDispatches: {
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              select: {
                id: true,
                status: true,
                commercialPipelineRun: {
                  select: { id: true, status: true, finalStatus: true },
                },
              },
            },
          },
        }),
        this.prisma.commercialCopyGenerationAttempt.findMany({
          where: { generatedCopyId: null },
          orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
          take,
          select: {
            id: true,
            candidateId: true,
            snapshotId: true,
            inputFingerprint: true,
            provider: true,
            model: true,
            promptVersion: true,
            validationVersion: true,
            status: true,
            generatedCopyId: true,
            failureCode: true,
            validationFailureCodes: true,
            requestMayHaveStarted: true,
            inputTokens: true,
            outputTokens: true,
            totalTokens: true,
            startedAt: true,
            completedAt: true,
            createdAt: true,
            candidate: {
              select: {
                id: true,
                campaignId: true,
                status: true,
                campaign: { select: { name: true } },
                product: { select: { id: true, nome: true } },
              },
            },
          },
        }),
        this.prisma.generatedCopy.count(),
        this.prisma.commercialCopyGenerationAttempt.count({
          where: { generatedCopyId: null },
        }),
      ]);

    const candidateIds = copies.flatMap((copy) =>
      copy.createdFromCandidateId ? [copy.createdFromCandidateId] : [],
    );
    const copyCandidates = candidateIds.length
      ? await this.prisma.commercialPromotionCandidate.findMany({
          where: { id: { in: candidateIds } },
          select: {
            id: true,
            campaignId: true,
            status: true,
            campaign: { select: { name: true } },
            product: { select: { id: true, nome: true } },
          },
        })
      : [];
    const candidatesById = new Map<string, CommercialCopyHistoryCandidate>();
    for (const candidate of copyCandidates) {
      candidatesById.set(candidate.id, mapCandidate(candidate));
    }

    const roots: CommercialCopyHistoryRecord[] = [
      ...copies.map((copy) => {
        const candidate = copy.createdFromCandidateId
          ? candidatesById.get(copy.createdFromCandidateId) ?? null
          : null;
        const historyCopy: CommercialCopyHistoryCopy = {
          id: copy.id,
          productId: copy.productId,
          productName: copy.product.nome,
          source: copy.source,
          provider: copy.provider,
          model: copy.model,
          promptVersion: copy.promptVersion,
          validationVersion: copy.validationVersion,
          inputFingerprint: copy.inputFingerprint,
          snapshotId: copy.snapshotId,
          createdFromCandidateId: copy.createdFromCandidateId,
          usageInputTokens: copy.usageInputTokens,
          usageOutputTokens: copy.usageOutputTokens,
          usageTotalTokens: copy.usageTotalTokens,
          createdAt: copy.createdAt,
          candidate,
          attempts: copy.generationAttempts.map(mapAttempt),
          dispatches: copy.whatsappDispatches.map(mapDispatch),
        };
        return {
          kind: 'COPY' as const,
          id: copy.id,
          createdAt: copy.createdAt,
          copy: historyCopy,
          attempt: null,
          candidate,
        };
      }),
      ...unlinkedAttempts.map((attempt) => ({
        kind: 'ATTEMPT' as const,
        id: attempt.id,
        createdAt: attempt.startedAt,
        copy: null,
        attempt: mapAttempt(attempt),
        candidate: mapCandidate(attempt.candidate),
      })),
    ].sort(compareRoots);

    return {
      items: roots.slice(offset, offset + input.limit),
      total: copyTotal + unlinkedAttemptTotal,
    };
  }
}
