import { describe, expect, it } from 'vitest';

import { PrismaCommercialGroupCampaignAttemptRepository } from '../src/prisma-repositories';

type AttemptState = {
  attemptExecutionId: string | null;
  attemptReservedAt: Date | null;
  attemptLeaseExpiresAt: Date | null;
  failureCount: number;
  nextEligibleAt: Date | null;
  lastSentAt: Date | null;
  dispatchId: string | null;
};

class InMemoryCampaignAttempts {
  readonly records = new Map<string, AttemptState>();
  beforeUpdateMany?: () => void;

  async updateMany(input: {
    where: {
      id: string;
      attemptExecutionId: string | null;
      attemptReservedAt?: Date | null;
      attemptLeaseExpiresAt?: Date | null | { gt?: Date; lt?: Date };
    };
    data: Partial<
      Pick<
        AttemptState,
        'attemptExecutionId' | 'attemptReservedAt' | 'attemptLeaseExpiresAt'
      >
    >;
  }) {
    this.beforeUpdateMany?.();
    this.beforeUpdateMany = undefined;
    const record = this.records.get(input.where.id);
    const reservedAtMatches =
      input.where.attemptReservedAt === undefined ||
      record?.attemptReservedAt?.getTime() ===
        input.where.attemptReservedAt?.getTime();
    const leaseFilter = input.where.attemptLeaseExpiresAt;
    const leaseMatches =
      leaseFilter === undefined ||
      (leaseFilter instanceof Date
        ? record?.attemptLeaseExpiresAt?.getTime() === leaseFilter.getTime()
        : leaseFilter === null
          ? record?.attemptLeaseExpiresAt === null
          : (!leaseFilter.gt ||
              (record?.attemptLeaseExpiresAt !== null &&
                record?.attemptLeaseExpiresAt !== undefined &&
                record.attemptLeaseExpiresAt.getTime() >
                  leaseFilter.gt.getTime())) &&
            (!leaseFilter.lt ||
              (record?.attemptLeaseExpiresAt !== null &&
                record?.attemptLeaseExpiresAt !== undefined &&
                record.attemptLeaseExpiresAt.getTime() <
                  leaseFilter.lt.getTime())));
    if (
      !record ||
      record.attemptExecutionId !== input.where.attemptExecutionId ||
      !reservedAtMatches ||
      !leaseMatches
    ) {
      return { count: 0 };
    }
    Object.assign(record, input.data);
    return { count: 1 };
  }

  async findUnique(input: {
    where: { id: string };
    select: {
      attemptExecutionId: true;
      attemptReservedAt: true;
      attemptLeaseExpiresAt: true;
    };
  }) {
    const record = this.records.get(input.where.id);
    if (!record) return null;
    return {
      attemptExecutionId: record.attemptExecutionId,
      attemptReservedAt: record.attemptReservedAt,
      attemptLeaseExpiresAt: record.attemptLeaseExpiresAt,
    };
  }
}

const reservedAt = new Date('2026-08-14T12:00:00.000Z');
const leaseExpiresAt = new Date('2026-08-14T12:05:00.000Z');
const expiredLeaseExpiresAt = new Date('2026-08-14T11:59:59.999Z');
const futureEligibleAt = new Date('2026-08-14T13:00:00.000Z');

const state = (overrides: Partial<AttemptState> = {}): AttemptState => ({
  attemptExecutionId: null,
  attemptReservedAt: null,
  attemptLeaseExpiresAt: null,
  failureCount: 3,
  nextEligibleAt: futureEligibleAt,
  lastSentAt: new Date('2026-08-14T11:00:00.000Z'),
  dispatchId: 'dispatch-preserved',
  ...overrides,
});

const subject = () => {
  const campaigns = new InMemoryCampaignAttempts();
  return {
    campaigns,
    repository: new PrismaCommercialGroupCampaignAttemptRepository(campaigns),
  };
};

describe('PrismaCommercialGroupCampaignAttemptRepository', () => {
  it('acquires only an unowned campaign and leaves an expired lease reserved', async () => {
    const { campaigns, repository } = subject();
    campaigns.records.set('campaign-a', state());

    await expect(
      repository.reserve({
        campaignId: 'campaign-a',
        executionId: 'execution-a',
        reservedAt,
        leaseExpiresAt: expiredLeaseExpiresAt,
      }),
    ).resolves.toEqual({
      kind: 'RESERVED',
      campaignId: 'campaign-a',
      executionId: 'execution-a',
      reservedAt,
      leaseExpiresAt: expiredLeaseExpiresAt,
      acquired: true,
    });
    expect(campaigns.records.get('campaign-a')).toMatchObject({
      attemptExecutionId: 'execution-a',
      attemptReservedAt: reservedAt,
      attemptLeaseExpiresAt: expiredLeaseExpiresAt,
    });
    await expect(
      repository.reserve({
        campaignId: 'campaign-a',
        executionId: 'execution-b',
        reservedAt,
        leaseExpiresAt,
      }),
    ).resolves.toEqual({
      kind: 'CONFLICT',
      campaignId: 'campaign-a',
      executionId: 'execution-b',
    });
  });

  it('returns conflict for another owner and preserves the existing reservation', async () => {
    const { campaigns, repository } = subject();
    campaigns.records.set(
      'campaign-a',
      state({
        attemptExecutionId: 'execution-a',
        attemptReservedAt: reservedAt,
        attemptLeaseExpiresAt: leaseExpiresAt,
      }),
    );

    await expect(
      repository.reserve({
        campaignId: 'campaign-a',
        executionId: 'execution-b',
        reservedAt: new Date('2026-08-14T12:01:00.000Z'),
        leaseExpiresAt: new Date('2026-08-14T12:06:00.000Z'),
      }),
    ).resolves.toEqual({
      kind: 'CONFLICT',
      campaignId: 'campaign-a',
      executionId: 'execution-b',
    });
    expect(campaigns.records.get('campaign-a')).toMatchObject({
      attemptExecutionId: 'execution-a',
      attemptReservedAt: reservedAt,
      attemptLeaseExpiresAt: leaseExpiresAt,
    });
  });

  it('makes a repeated reservation by the same owner idempotent', async () => {
    const { campaigns, repository } = subject();
    campaigns.records.set(
      'campaign-a',
      state({
        attemptExecutionId: 'execution-a',
        attemptReservedAt: reservedAt,
        attemptLeaseExpiresAt: leaseExpiresAt,
      }),
    );

    await expect(
      repository.reserve({
        campaignId: 'campaign-a',
        executionId: 'execution-a',
        reservedAt: new Date('2026-08-14T12:01:00.000Z'),
        leaseExpiresAt: new Date('2026-08-14T12:06:00.000Z'),
      }),
    ).resolves.toEqual({
      kind: 'RESERVED',
      campaignId: 'campaign-a',
      executionId: 'execution-a',
      reservedAt,
      leaseExpiresAt,
      acquired: false,
    });
  });

  it('isolates campaign reservations from other groups and existing eligibility', async () => {
    const { campaigns, repository } = subject();
    campaigns.records.set('campaign-a', state());
    campaigns.records.set('campaign-b', state());

    await repository.reserve({
      campaignId: 'campaign-a',
      executionId: 'execution-a',
      reservedAt,
      leaseExpiresAt,
    });

    expect(campaigns.records.get('campaign-a')?.nextEligibleAt).toEqual(
      futureEligibleAt,
    );
    expect(campaigns.records.get('campaign-b')).toEqual(state());
  });

  it('releases only for the owner and clears only the three attempt fields idempotently', async () => {
    const { campaigns, repository } = subject();
    const preserved = state({
      attemptExecutionId: 'execution-a',
      attemptReservedAt: reservedAt,
      attemptLeaseExpiresAt: leaseExpiresAt,
    });
    campaigns.records.set('campaign-a', preserved);

    await expect(
      repository.release({ campaignId: 'campaign-a', executionId: 'execution-b' }),
    ).resolves.toEqual({
      kind: 'CONFLICT',
      campaignId: 'campaign-a',
      executionId: 'execution-b',
    });
    expect(campaigns.records.get('campaign-a')).toEqual(preserved);

    await expect(
      repository.release({ campaignId: 'campaign-a', executionId: 'execution-a' }),
    ).resolves.toEqual({
      kind: 'RELEASED',
      campaignId: 'campaign-a',
      executionId: 'execution-a',
      released: true,
    });
    expect(campaigns.records.get('campaign-a')).toEqual(
      state({
        attemptExecutionId: null,
        attemptReservedAt: null,
        attemptLeaseExpiresAt: null,
      }),
    );

    await expect(
      repository.release({ campaignId: 'campaign-a', executionId: 'execution-a' }),
    ).resolves.toEqual({
      kind: 'RELEASED',
      campaignId: 'campaign-a',
      executionId: 'execution-a',
      released: false,
    });
  });

  it('renews a live reservation by owner without changing its origin timestamp', async () => {
    const { campaigns, repository } = subject();
    campaigns.records.set(
      'campaign-a',
      state({
        attemptExecutionId: 'execution-a',
        attemptReservedAt: reservedAt,
        attemptLeaseExpiresAt: leaseExpiresAt,
      }),
    );
    const renewedLeaseExpiresAt = new Date('2026-08-14T12:10:00.000Z');

    await expect(
      repository.renew({
        campaignId: 'campaign-a',
        executionId: 'execution-a',
        renewedAt: new Date('2026-08-14T12:02:00.000Z'),
        leaseExpiresAt: renewedLeaseExpiresAt,
      }),
    ).resolves.toEqual({
      kind: 'RENEWED',
      campaignId: 'campaign-a',
      executionId: 'execution-a',
      leaseExpiresAt: renewedLeaseExpiresAt,
      renewed: true,
    });
    expect(campaigns.records.get('campaign-a')).toMatchObject({
      attemptExecutionId: 'execution-a',
      attemptReservedAt: reservedAt,
      attemptLeaseExpiresAt: renewedLeaseExpiresAt,
      failureCount: 3,
      nextEligibleAt: futureEligibleAt,
      lastSentAt: new Date('2026-08-14T11:00:00.000Z'),
      dispatchId: 'dispatch-preserved',
    });

    await expect(
      repository.renew({
        campaignId: 'campaign-a',
        executionId: 'execution-a',
        renewedAt: new Date('2026-08-14T12:02:00.000Z'),
        leaseExpiresAt: renewedLeaseExpiresAt,
      }),
    ).resolves.toEqual({
      kind: 'RENEWED',
      campaignId: 'campaign-a',
      executionId: 'execution-a',
      leaseExpiresAt: renewedLeaseExpiresAt,
      renewed: false,
    });

    await expect(
      repository.renew({
        campaignId: 'campaign-a',
        executionId: 'execution-a',
        renewedAt: new Date('2026-08-14T12:03:00.000Z'),
        leaseExpiresAt: new Date('2026-08-14T12:08:00.000Z'),
      }),
    ).resolves.toEqual({
      kind: 'RENEWED',
      campaignId: 'campaign-a',
      executionId: 'execution-a',
      leaseExpiresAt: renewedLeaseExpiresAt,
      renewed: false,
    });
    expect(campaigns.records.get('campaign-a')?.attemptLeaseExpiresAt).toEqual(
      renewedLeaseExpiresAt,
    );
  });

  it('renews an expired reservation for the same owner and preserves reservedAt', async () => {
    const { campaigns, repository } = subject();
    campaigns.records.set(
      'campaign-a',
      state({
        attemptExecutionId: 'execution-a',
        attemptReservedAt: reservedAt,
        attemptLeaseExpiresAt: expiredLeaseExpiresAt,
      }),
    );

    const renewedLeaseExpiresAt = new Date('2026-08-14T12:10:00.000Z');
    await expect(
      repository.renew({
        campaignId: 'campaign-a',
        executionId: 'execution-a',
        renewedAt: new Date('2026-08-14T12:00:00.000Z'),
        leaseExpiresAt: renewedLeaseExpiresAt,
      }),
    ).resolves.toEqual({
      kind: 'RENEWED',
      campaignId: 'campaign-a',
      executionId: 'execution-a',
      leaseExpiresAt: renewedLeaseExpiresAt,
      renewed: true,
    });
    expect(campaigns.records.get('campaign-a')).toMatchObject({
      attemptExecutionId: 'execution-a',
      attemptReservedAt: reservedAt,
      attemptLeaseExpiresAt: renewedLeaseExpiresAt,
    });
  });

  it('fails closed for another owner or a released reservation', async () => {
    const { campaigns, repository } = subject();
    campaigns.records.set(
      'campaign-a',
      state({
        attemptExecutionId: 'execution-a',
        attemptReservedAt: reservedAt,
        attemptLeaseExpiresAt: leaseExpiresAt,
      }),
    );

    await expect(
      repository.renew({
        campaignId: 'campaign-a',
        executionId: 'execution-b',
        renewedAt: new Date('2026-08-14T12:02:00.000Z'),
        leaseExpiresAt: new Date('2026-08-14T12:10:00.000Z'),
      }),
    ).resolves.toEqual({
      kind: 'CONFLICT',
      campaignId: 'campaign-a',
      executionId: 'execution-b',
    });

    campaigns.records.set('campaign-a', state());
    await expect(
      repository.renew({
        campaignId: 'campaign-a',
        executionId: 'execution-a',
        renewedAt: new Date('2026-08-14T12:00:00.000Z'),
        leaseExpiresAt: new Date('2026-08-14T12:10:00.000Z'),
      }),
    ).resolves.toEqual({
      kind: 'CONFLICT',
      campaignId: 'campaign-a',
      executionId: 'execution-a',
    });
  });

  it('fails closed when the owner changes between read and CAS', async () => {
    const { campaigns, repository } = subject();
    campaigns.records.set(
      'campaign-a',
      state({
        attemptExecutionId: 'execution-a',
        attemptReservedAt: reservedAt,
        attemptLeaseExpiresAt: expiredLeaseExpiresAt,
      }),
    );
    campaigns.beforeUpdateMany = () => {
      campaigns.records.set(
        'campaign-a',
        state({
          attemptExecutionId: 'execution-b',
          attemptReservedAt: new Date('2026-08-14T12:01:00.000Z'),
          attemptLeaseExpiresAt: leaseExpiresAt,
        }),
      );
    };

    await expect(
      repository.renew({
        campaignId: 'campaign-a',
        executionId: 'execution-a',
        renewedAt: new Date('2026-08-14T12:00:00.000Z'),
        leaseExpiresAt: new Date('2026-08-14T12:10:00.000Z'),
      }),
    ).resolves.toEqual({
      kind: 'CONFLICT',
      campaignId: 'campaign-a',
      executionId: 'execution-a',
    });
    expect(campaigns.records.get('campaign-a')).toMatchObject({
      attemptExecutionId: 'execution-b',
      attemptReservedAt: new Date('2026-08-14T12:01:00.000Z'),
      attemptLeaseExpiresAt: leaseExpiresAt,
    });
  });
});
