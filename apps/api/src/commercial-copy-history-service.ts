import type {
  CommercialCopyHistoryRecord,
  CommercialCopyHistoryRepository,
} from './commercial-copy-history-repository';

const toIso = (value: Date | null) => (value ? value.toISOString() : null);

const serializeAttempt = (attempt: NonNullable<CommercialCopyHistoryRecord['attempt']>) => ({
  ...attempt,
  startedAt: attempt.startedAt.toISOString(),
  completedAt: toIso(attempt.completedAt),
  createdAt: attempt.createdAt.toISOString(),
});

export class CommercialCopyHistoryService {
  constructor(private readonly repository: CommercialCopyHistoryRepository) {}

  async list(input: { page: number; limit: number }) {
    const result = await this.repository.list(input);
    return {
      items: result.items.map((record) => ({
        kind: record.kind,
        id: record.id,
        createdAt: record.createdAt.toISOString(),
        copy: record.copy
          ? {
              ...record.copy,
              createdAt: record.copy.createdAt.toISOString(),
              attempts: record.copy.attempts.map(serializeAttempt),
            }
          : null,
        attempt: record.attempt ? serializeAttempt(record.attempt) : null,
        candidate: record.candidate,
      })),
      page: input.page,
      limit: input.limit,
      total: result.total,
      totalPages: Math.max(1, Math.ceil(result.total / input.limit)),
    };
  }
}
