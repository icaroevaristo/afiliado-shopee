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

  async updateMany(input: {
    where: {
      id: string;
      attemptExecutionId: string | null;
      attemptLeaseExpiresAt?: { gt?: Date; lt?: Date };
    };
    data: Partial<
      Pick<
        AttemptState,
        'attemptExecutionId' | 'attemptReservedAt' | 'attemptLeaseExpiresAt'
      >
    >;
  }) {
    const record = this.records.get(input.where.id);
    if (
      !record ||
      record.attemptExecutionId !== input.where.attemptExecutionId ||
      (input.where.attemptLeaseExpiresAt?.gt &&
        (!record.attemptLeaseExpiresAt ||
          record.attemptLeaseExpiresAt.getTime() <=
            input.where.attemptLeaseExpiresAt.gt.getTime())) ||
      (input.where.attemptLeaseExpiresAt?.lt &&
        record.attemptLeaseExpiresAt &&
        record.attemptLeaseExpiresAt.getTime() >=
          input.where.attemptLeaseExpiresAt.lt.getTime())
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
  });

  it('fails closed for another owner or an already expired reservation', async () => {
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

    campaigns.records.set(
      'campaign-a',
      state({
        attemptExecutionId: 'execution-a',
        attemptReservedAt: reservedAt,
        attemptLeaseExpiresAt: expiredLeaseExpiresAt,
      }),
    );
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
      attemptExecutionId: 'execution-a',
      attemptLeaseExpiresAt: expiredLeaseExpiresAt,
    });
  });
});
