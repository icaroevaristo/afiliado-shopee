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
  failureCount: 0,
  nextEligibleAt: null,
  attemptExecutionId: null,
  attemptReservedAt: null,
  attemptLeaseExpiresAt: null,
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
  const createNiche = vi.fn(async () => niche);
  const updateNiche = vi.fn(async () => niche);
  const listCampaigns = vi.fn(async (input) => ({
    items: [campaign],
    ...input,
    total: 1,
    totalPages: 1,
  }));
  const updateCampaign = vi.fn(async () => campaign);
  const activateCampaign = vi.fn(async () => ({ ...campaign, active: true }));
  const deactivateCampaign = vi.fn(async () => campaign);
  const dispatchAdd = vi.fn();
  const app = await buildAuthenticatedTestApp({
    logger: false,
    prisma: {} as never,
    commercialNicheService: {
      create: createNiche,
      list: listNiches,
      find: vi.fn(async () => niche),
      update: updateNiche,
    },
    commercialNichePreviewService: {
      preview: vi.fn(async () => ({
        preview: true as const,
        evaluatedCount: 2,
        matchedCount: 1,
        rejectedCount: 1,
        evaluationTruncated: false,
        matchSummary: { matched: 1, rejected: 1 },
        rejectionSummary: { PRICE_ABOVE_MAXIMUM: 1 },
        matches: [],
        rejections: [],
      })),
    },
    commercialGroupCampaignService: {
      create: vi.fn(async () => campaign),
      list: listCampaigns,
      find: vi.fn(async () => campaign),
      update: updateCampaign,
      activate: activateCampaign,
      deactivate: deactivateCampaign,
    },
    whatsappDispatchQueue: { add: dispatchAdd, getJob: vi.fn() },
  });
  apps.push(app);
  return {
    app,
    listNiches,
    createNiche,
    updateNiche,
    listCampaigns,
    updateCampaign,
    activateCampaign,
    deactivateCampaign,
    dispatchAdd,
  };
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

  it('expõe preview de nicho draft como operação read-only', async () => {
    const subject = await setup();
    const response = await subject.app.inject({
      method: 'POST',
      url: '/commercial/niches/preview',
      payload: {
        name: 'Achadinhos',
        categoryIds: [],
        includeKeywords: [],
        excludeKeywords: [],
        maxPrice: '50',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      preview: true,
      evaluatedCount: 2,
      matchedCount: 1,
    });
    expect(subject.dispatchAdd).not.toHaveBeenCalled();
  });

  it('encaminha criação e edição de nicho pelos endpoints protegidos', async () => {
    const subject = await setup();
    const input = {
      name: 'Maternidade',
      active: true,
      categoryIds: ['baby'],
      includeKeywords: ['fralda'],
      excludeKeywords: [],
      minPrice: null,
      maxPrice: '50',
      minDiscountRate: 5,
      minRating: 4,
      minSales: 10,
      minCommissionRate: 2,
      minimumScore: 70,
    };
    const created = await subject.app.inject({
      method: 'POST',
      url: '/commercial/niches',
      payload: input,
    });
    const updated = await subject.app.inject({
      method: 'PATCH',
      url: '/commercial/niches/niche-1',
      payload: { active: false, maxPrice: '40' },
    });

    expect(created.statusCode).toBe(201);
    expect(updated.statusCode).toBe(200);
    expect(subject.createNiche).toHaveBeenCalledWith(input);
    expect(subject.updateNiche).toHaveBeenCalledWith('niche-1', {
      active: false,
      maxPrice: '40',
    });
    expect(subject.dispatchAdd).not.toHaveBeenCalled();
  });

  it('permite alterar somente a agenda necessaria da campanha', async () => {
    const subject = await setup();
    const response = await subject.app.inject({
      method: 'PATCH',
      url: '/commercial/campaigns/campaign-1',
      payload: {
        cadenceMinutes: 30,
        allowedStartTime: '08:00',
        allowedEndTime: '21:00',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(subject.updateCampaign).toHaveBeenCalledWith('campaign-1', {
      cadenceMinutes: 30,
      allowedStartTime: '08:00',
      allowedEndTime: '21:00',
    });
    expect(subject.dispatchAdd).not.toHaveBeenCalled();
  });

  it('liga e desliga campanha pelos endpoints protegidos sem tocar na fila', async () => {
    const subject = await setup();
    const activated = await subject.app.inject({
      method: 'POST',
      url: '/commercial/campaigns/campaign-1/activate',
      payload: { confirm: 'ATIVAR_CAMPANHA' },
    });
    const deactivated = await subject.app.inject({
      method: 'POST',
      url: '/commercial/campaigns/campaign-1/deactivate',
      payload: {},
    });

    expect(activated.statusCode).toBe(200);
    expect(deactivated.statusCode).toBe(200);
    expect(subject.activateCampaign).toHaveBeenCalledWith(
      'campaign-1',
      { confirm: 'ATIVAR_CAMPANHA' },
    );
    expect(subject.deactivateCampaign).toHaveBeenCalledWith('campaign-1', {});
    expect(subject.dispatchAdd).not.toHaveBeenCalled();
  });
});
