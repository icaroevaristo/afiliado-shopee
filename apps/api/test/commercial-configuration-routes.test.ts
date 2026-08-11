import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildAuthenticatedTestApp } from './authenticated-test-app';

const apps: Array<Awaited<ReturnType<typeof buildAuthenticatedTestApp>>> = [];
const niche = {
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
  createdAt: '2026-07-29T12:00:00.000Z',
  updatedAt: '2026-07-29T12:00:00.000Z',
};
const campaign = {
  id: 'campaign-1',
  name: 'Campanha',
  logicalGroupFingerprint: 'grp_123456789abc',
  anchorDestinationId: 'destination-1',
  nicheId: 'niche-1',
  active: false,
  cadenceMinutes: 15,
  timezone: 'America/Sao_Paulo',
  allowedStartTime: '07:00',
  allowedEndTime: '22:00',
  dailyLimit: 60,
  queueTargetSize: 40,
  dedupeDays: 30,
  niche: { id: 'niche-1', name: 'Audio', slug: 'audio', active: true },
  anchorDestination: {
    id: 'destination-1',
    name: 'Grupo',
    fingerprint: 'grp_123456789abc',
    active: true,
    available: true,
  },
  createdAt: niche.createdAt,
  updatedAt: niche.updatedAt,
};

const setup = async () => {
  const listNiches = vi.fn(async (input) => ({
    items: [niche],
    ...input,
    total: 1,
    totalPages: 1,
  }));
  const listCampaigns = vi.fn(async (input) => ({
    items: [campaign],
    ...input,
    total: 1,
    totalPages: 1,
  }));
  const dispatchAdd = vi.fn();
  const app = await buildAuthenticatedTestApp({
    logger: false,
    prisma: {} as never,
    commercialNicheService: {
      create: vi.fn(async () => niche),
      list: listNiches,
      find: vi.fn(async () => niche),
      update: vi.fn(async () => niche),
    },
    commercialGroupCampaignService: {
      create: vi.fn(async () => campaign),
      list: listCampaigns,
      find: vi.fn(async () => campaign),
      update: vi.fn(async () => campaign),
      activate: vi.fn(async () => ({ ...campaign, active: true })),
      deactivate: vi.fn(async () => campaign),
    },
    whatsappDispatchQueue: { add: dispatchAdd, getJob: vi.fn() },
  });
  apps.push(app);
  return { app, listNiches, listCampaigns, dispatchAdd };
};

afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

describe('commercial configuration routes', () => {
  it('pagina nichos e campanhas e mantem respostas sanitizadas', async () => {
    const subject = await setup();
    const niches = await subject.app.inject({
      method: 'GET',
      url: '/commercial/niches?page=2&limit=10&active=true',
    });
    const campaigns = await subject.app.inject({
      method: 'GET',
      url: '/commercial/campaigns?page=1&limit=5',
    });
    expect(niches.statusCode).toBe(200);
    expect(campaigns.statusCode).toBe(200);
    expect(subject.listNiches).toHaveBeenCalledWith({
      page: 2,
      limit: 10,
      active: true,
    });
    expect(subject.listCampaigns).toHaveBeenCalledWith({
      page: 1,
      limit: 5,
      active: undefined,
    });
    expect(JSON.stringify(campaigns.json())).not.toMatch(
      /"destination":|@g\.us|sourceInstanceName|jid/i,
    );
    expect(subject.dispatchAdd).not.toHaveBeenCalled();
  });

  it('rejeita query e bodies extras sem provider, fila ou envio', async () => {
    const subject = await setup();
    expect(
      (
        await subject.app.inject({
          method: 'GET',
          url: '/commercial/niches?extra=1',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await subject.app.inject({
          method: 'GET',
          url: '/commercial/campaigns?active=yes',
        })
      ).statusCode,
    ).toBe(400);
    expect(subject.dispatchAdd).not.toHaveBeenCalled();
  });
});
