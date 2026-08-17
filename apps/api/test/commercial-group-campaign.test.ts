import { describe, expect, it, vi } from 'vitest';

import {
  commercialCampaignSlotCount,
  parseCommercialGroupCampaignCreate,
  parseCommercialGroupCampaignPatch,
} from '../src/commercial-group-campaign-domain';
import {
  CommercialGroupCampaignService,
  toCommercialGroupCampaignPublic,
} from '../src/commercial-group-campaign-service';
import type {
  CommercialGroupCampaignRecord,
  CommercialGroupCampaignRepository,
  CommercialNicheRecord,
  CommercialNicheRepository,
} from '../src/repositories';

const now = new Date('2026-07-29T12:00:00.000Z');
const niche: CommercialNicheRecord = {
  id: 'niche-1',
  name: 'Audio',
  slug: 'audio',
  active: true,
  categoryIds: [],
  includeKeywords: [],
  excludeKeywords: [],
  minPrice: null,
  maxPrice: null,
  minDiscountRate: 5,
  minRating: 0,
  minSales: 0,
  minCommissionRate: 0,
  minimumScore: 60,
  createdAt: now,
  updatedAt: now,
};
const campaign = (
  overrides: Partial<CommercialGroupCampaignRecord> = {},
): CommercialGroupCampaignRecord => ({
  id: 'campaign-1',
  name: 'Grupo Audio',
  logicalGroupFingerprint: 'grp_123456789abc',
  anchorDestinationId: 'group-1',
  nicheId: niche.id,
  active: false,
  cadenceMinutes: 15,
  timezone: 'America/Sao_Paulo',
  allowedStartTime: '07:00',
  allowedEndTime: '22:00',
  dailyLimit: 60,
  failureCount: 0,
  nextEligibleAt: null,
  attemptExecutionId: 'execution-1',
  attemptReservedAt: new Date('2026-07-29T11:55:00.000Z'),
  attemptLeaseExpiresAt: new Date('2026-07-29T12:05:00.000Z'),
  queueTargetSize: 40,
  dedupeDays: 30,
  niche: {
    id: niche.id,
    name: niche.name,
    slug: niche.slug,
    active: niche.active,
  },
  anchorDestination: {
    id: 'group-1',
    name: 'Grupo',
    fingerprint: 'grp_123456789abc',
    active: true,
    available: true,
  },
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const expectPublicCampaign = (
  value: ReturnType<typeof toCommercialGroupCampaignPublic>,
  expected: Partial<ReturnType<typeof toCommercialGroupCampaignPublic>> = {},
) => {
  expect(value).toMatchObject({
    id: 'campaign-1',
    name: 'Grupo Audio',
    logicalGroupFingerprint: 'grp_123456789abc',
    anchorDestinationId: 'group-1',
    nicheId: 'niche-1',
    cadenceMinutes: 15,
    timezone: 'America/Sao_Paulo',
    allowedStartTime: '07:00',
    allowedEndTime: '22:00',
    dailyLimit: 60,
    failureCount: 0,
    nextEligibleAt: null,
    queueTargetSize: 40,
    dedupeDays: 30,
    niche: {
      id: 'niche-1',
      name: 'Audio',
      slug: 'audio',
      active: true,
    },
    anchorDestination: {
      id: 'group-1',
      name: 'Grupo',
      fingerprint: 'grp_123456789abc',
      active: true,
      available: true,
    },
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...expected,
  });
  expect(Object.hasOwn(value, 'attemptExecutionId')).toBe(false);
  expect(Object.hasOwn(value, 'attemptReservedAt')).toBe(false);
  expect(Object.hasOwn(value, 'attemptLeaseExpiresAt')).toBe(false);
  expect(JSON.stringify(value)).not.toContain('attemptExecutionId');
  expect(JSON.stringify(value)).not.toContain('attemptReservedAt');
  expect(JSON.stringify(value)).not.toContain('attemptLeaseExpiresAt');
};

const setup = (
  overrides: { niche?: CommercialNicheRecord; eligible?: number } = {},
) => {
  let current = campaign();
  const campaigns: CommercialGroupCampaignRepository = {
    createForGroup: vi.fn(
      async (data) => (current = campaign({ ...data, active: false })),
    ),
    list: vi.fn(async () => ({ items: [current], total: 1 })),
    findById: vi.fn(async () => current),
    update: vi.fn(
      async (_id, data) => (current = campaign({ ...current, ...data })),
    ),
    hasEligibleDestination: vi.fn(async () => (overrides.eligible ?? 1) > 0),
    activateIfEligible: vi.fn(async () => {
      if (!(overrides.niche ?? niche).active) {
        throw Object.assign(new Error('inactive'), {
          code: 'COMMERCIAL_GROUP_CAMPAIGN_NICHE_INACTIVE',
        });
      }
      if ((overrides.eligible ?? 1) === 0) {
        throw Object.assign(new Error('unavailable'), {
          code: 'COMMERCIAL_GROUP_CAMPAIGN_GROUP_UNAVAILABLE',
        });
      }
      return (current = campaign({ ...current, active: true }));
    }),
  };
  const niches: CommercialNicheRepository = {
    create: vi.fn(),
    list: vi.fn(),
    update: vi.fn(),
    findById: vi.fn(async () => overrides.niche ?? niche),
  };
  return {
    service: new CommercialGroupCampaignService(campaigns, niches),
    campaigns,
  };
};

describe('commercial group campaign', () => {
  it('preserva o estado futuro de anti-starvation como contrato passivo', () => {
    const nextEligibleAt = new Date('2026-08-14T12:30:00.000Z');
    const firstCampaign = campaign({ failureCount: 3, nextEligibleAt });
    const secondCampaign = campaign({
      id: 'campaign-2',
      logicalGroupFingerprint: 'grp_abcdef123456',
      failureCount: 0,
      nextEligibleAt: null,
    });

    expect(firstCampaign.failureCount).toBe(3);
    expect(firstCampaign.nextEligibleAt).toBe(nextEligibleAt);
    expect(secondCampaign.failureCount).toBe(0);
    expect(secondCampaign.nextEligibleAt).toBeNull();
    expect(firstCampaign.dailyLimit).toBe(60);
    expect(secondCampaign.dailyLimit).toBe(60);
  });

  it('nasce inativa com cadencia padrao e valida slots', async () => {
    const { service } = setup();
    const created = await service.create({
      name: 'Grupo Audio',
      groupDestinationId: 'group-1',
      nicheId: 'niche-1',
    });
    expect(created).toMatchObject({
      active: false,
      cadenceMinutes: 15,
      dailyLimit: 60,
    });
    expect(
      commercialCampaignSlotCount({
        allowedStartTime: '07:00',
        allowedEndTime: '22:00',
        cadenceMinutes: 15,
      }),
    ).toBe(60);
    expect(() =>
      parseCommercialGroupCampaignCreate({
        name: 'Xx',
        groupDestinationId: 'g',
        nicheId: 'n',
        timezone: 'Zona/Invalida',
      }),
    ).toThrow();
    expect(
      parseCommercialGroupCampaignPatch(campaign(), { name: 'Novo nome' }),
    ).toEqual({ name: 'Novo nome' });
    expect(() =>
      parseCommercialGroupCampaignCreate({
        name: 'Xx',
        groupDestinationId: 'g',
        nicheId: 'n',
        allowedStartTime: '22:00',
        allowedEndTime: '07:00',
      }),
    ).toThrow();
    expect(() =>
      parseCommercialGroupCampaignCreate({
        name: 'Xx',
        groupDestinationId: 'g',
        nicheId: 'n',
        cadenceMinutes: 60,
        dailyLimit: 20,
      }),
    ).toThrow();
    expect(() =>
      parseCommercialGroupCampaignCreate({
        name: 'Xx',
        groupDestinationId: 'g',
        nicheId: 'n',
        destination: 'jid@g.us',
      }),
    ).toThrow();
  });

  it('remove reservas internas de todos os DTOs publicos sem alterar o record', async () => {
    const internal = campaign();
    const { service, campaigns } = setup();

    expect(internal.attemptExecutionId).toBe('execution-1');
    expect(internal.attemptReservedAt).toEqual(
      new Date('2026-07-29T11:55:00.000Z'),
    );
    expect(internal.attemptLeaseExpiresAt).toEqual(
      new Date('2026-07-29T12:05:00.000Z'),
    );
    expectPublicCampaign(toCommercialGroupCampaignPublic(internal));
    expectPublicCampaign(
      await service.create({
        name: 'Grupo Audio',
        groupDestinationId: 'group-1',
        nicheId: 'niche-1',
      }),
    );
    const listed = await service.list({ page: 1, limit: 20 });
    expect(listed.items).toHaveLength(1);
    expectPublicCampaign(listed.items[0]);
    expectPublicCampaign(await service.find('campaign-1'));
    expectPublicCampaign(
      await service.update('campaign-1', { name: 'Novo nome' }),
      { name: 'Novo nome' },
    );
    expectPublicCampaign(
      await service.activate('campaign-1', { confirm: 'ATIVAR_CAMPANHA' }),
      { active: true, name: 'Novo nome' },
    );
    expectPublicCampaign(await service.deactivate('campaign-1', {}), {
      name: 'Novo nome',
    });

    const current = await campaigns.findById('campaign-1');
    expect(current?.attemptExecutionId).toBe('execution-1');
    expect(current?.attemptReservedAt).toEqual(
      new Date('2026-07-29T11:55:00.000Z'),
    );
    expect(current?.attemptLeaseExpiresAt).toEqual(
      new Date('2026-07-29T12:05:00.000Z'),
    );
  });

  it('controla ativacao, aceita varios destinos logicos e desativa sem apagar', async () => {
    const { service, campaigns } = setup({ eligible: 2 });
    await expect(service.activate('campaign-1', {})).rejects.toMatchObject({
      code: 'COMMERCIAL_GROUP_CAMPAIGN_CONFIRMATION_REQUIRED',
    });
    expect(
      await service.activate('campaign-1', { confirm: 'ATIVAR_CAMPANHA' }),
    ).toMatchObject({ active: true });
    expect(campaigns.activateIfEligible).toHaveBeenCalledWith('campaign-1');
    expect(await service.deactivate('campaign-1', {})).toMatchObject({
      active: false,
    });
  });

  it('bloqueia nicho inativo e grupo indisponivel', async () => {
    await expect(
      setup({ niche: { ...niche, active: false } }).service.activate(
        'campaign-1',
        { confirm: 'ATIVAR_CAMPANHA' },
      ),
    ).rejects.toMatchObject({
      code: 'COMMERCIAL_GROUP_CAMPAIGN_NICHE_INACTIVE',
    });
    await expect(
      setup({ eligible: 0 }).service.activate('campaign-1', {
        confirm: 'ATIVAR_CAMPANHA',
      }),
    ).rejects.toMatchObject({
      code: 'COMMERCIAL_GROUP_CAMPAIGN_GROUP_UNAVAILABLE',
    });
  });
});
