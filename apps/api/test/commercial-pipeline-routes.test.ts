import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@shopee-auto-affiliate-ai/shared';
import { buildAuthenticatedTestApp } from './authenticated-test-app';

const result = {
  runId: 'run-safe-1',
  mode: 'dry-run' as const,
  status: 'ready' as const,
  provider: 'mock' as const,
  candidateCount: 2,
  eligibleCount: 1,
  rejectedCount: 1,
  rejectionSummary: { SCORE_BELOW_MINIMUM: 1 },
  scorePolicyVersion: 'legacy-v1',
  minimumScoreUsed: 70,
  maximumScoreObserved: 82,
  selectedScoreBreakdown: {
    policyVersion: 'legacy-v1',
    rawTotal: 82,
    finalScore: 82,
    components: {},
  },
  selectedProduct: {
    id: 'product-safe-1',
    name: 'Produto ficticio',
    price: '99.90',
    score: 82,
    affiliateLinkPresent: true as const,
  },
  selectedGroup: {
    id: 'group-safe-1',
    name: 'Grupo ficticio',
    fingerprint: 'grp_123456789abc',
  },
  selectionReasons: ['Maior score elegivel: 82'],
  copyPreview:
    'Oferta ficticia\nhttps://example.invalid/affiliate/product-safe-1',
  plannedSubIds: ['whatsapp', 'whatsapp', 'grp_123456789abc'],
  dispatchWillBeCreated: false as const,
  jobWillBeCreated: false as const,
  messageWillBeSent: false as const,
};

const runHistory = {
  id: 'run-safe-1',
  mode: 'dry-run',
  status: 'completed',
  selectedProduct: result.selectedProduct,
  selectedGroup: result.selectedGroup,
  candidateCount: 2,
  eligibleCount: 1,
  rejectedCount: 1,
  rejectionSummary: result.rejectionSummary,
  scorePolicyVersion: result.scorePolicyVersion,
  minimumScoreUsed: result.minimumScoreUsed,
  maximumScoreObserved: result.maximumScoreObserved,
  selectedScoreBreakdown: result.selectedScoreBreakdown,
  selectionReasons: result.selectionReasons,
  copyPreview: result.copyPreview,
  plannedSubIds: result.plannedSubIds,
  failureCode: null,
  createdAt: '2026-07-25T12:00:00.000Z',
  completedAt: '2026-07-25T12:00:01.000Z',
  dispatchWasCreated: false,
  jobWasCreated: false,
  messageWasSent: false,
};

const apps: Array<Awaited<ReturnType<typeof buildAuthenticatedTestApp>>> = [];

const setup = async (
  dryRun = vi.fn().mockResolvedValue(result),
  confirm = vi.fn().mockResolvedValue({
    runId: 'run-safe-1',
    mode: 'confirmed',
    status: 'queued',
    dispatchWasCreated: true,
    jobWasCreated: true,
    messageWasSent: false,
  }),
) => {
  const pipelineAdd = vi.fn();
  const commercialPipelineService = {
    dryRun,
    listRuns: vi.fn().mockResolvedValue({
      items: [runHistory],
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    }),
    findRun: vi.fn().mockResolvedValue(runHistory),
  };
  const app = await buildAuthenticatedTestApp({
    logger: false,
    prisma: {} as never,
    pipelineQueue: { add: pipelineAdd },
    commercialPipelineService,
    commercialPipelineConfirmationService: { confirm },
  });
  apps.push(app);
  return { app, commercialPipelineService, pipelineAdd, confirm };
};

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('Commercial pipeline API', () => {
  it('confirma em endpoint separado com body estrito', async () => {
    const { app, confirm } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/commercial-pipeline/runs/run-safe-1/confirm',
      payload: { confirmation: 'CONFIRMAR_ENVIO_COMERCIAL' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'queued',
      dispatchWasCreated: true,
      jobWasCreated: true,
      messageWasSent: false,
    });
    expect(confirm).toHaveBeenCalledWith(
      'run-safe-1',
      'CONFIRMAR_ENVIO_COMERCIAL',
    );
  });

  it.each([
    {},
    { confirmation: 'CONFIRMAR_ENVIO_COMERCIAL', groupId: 'forbidden' },
    { confirmation: 'CONFIRMAR_ENVIO_COMERCIAL', coupon: 'forbidden' },
    { confirmation: true },
  ])('rejeita body confirmado com campos invalidos', async (payload) => {
    const { app, confirm } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/commercial-pipeline/runs/run-safe-1/confirm',
      payload,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('COMMERCIAL_CONFIRMATION_INVALID');
    expect(confirm).not.toHaveBeenCalled();
  });

  it.each([
    ['COMMERCIAL_CONFIRMATION_INVALID', 400],
    ['COMMERCIAL_RUN_NOT_READY', 404],
    ['COMMERCIAL_RUN_ALREADY_CONFIRMED', 409],
    ['COMMERCIAL_PRODUCT_CHANGED', 409],
    ['COMMERCIAL_GROUP_CHANGED', 409],
    ['PRODUCT_ALREADY_SENT', 409],
    ['GROUP_SEND_DISABLED', 409],
    ['COMMERCIAL_DISPATCH_FAILED', 500],
  ])('mapeia erro publico confirmado %s', async (code, status) => {
    const { app } = await setup(
      undefined,
      vi.fn().mockRejectedValue(new AppError('Falha sanitizada', code)),
    );
    const response = await app.inject({
      method: 'POST',
      url: '/commercial-pipeline/runs/run-safe-1/confirm',
      payload: { confirmation: 'CONFIRMAR_ENVIO_COMERCIAL' },
    });
    expect(response.statusCode).toBe(status);
    expect(response.json()).toEqual({
      error: code,
      message: 'Falha sanitizada',
    });
  });

  it('retorna preview pronto sem fila ou dispatch', async () => {
    const { app, pipelineAdd } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/commercial-pipeline/dry-run',
      payload: {},
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(result);
    expect(response.json()).toMatchObject({
      dispatchWillBeCreated: false,
      jobWillBeCreated: false,
      messageWillBeSent: false,
    });
    expect(pipelineAdd).not.toHaveBeenCalled();
  });

  it('aceita somente os filtros comerciais permitidos', async () => {
    const { app, commercialPipelineService } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/commercial-pipeline/dry-run',
      payload: {
        source: 'manual',
        categoryId: 'cat-1',
        minPrice: 10,
        maxPrice: 100,
        minDiscountRate: 5,
        minRating: 4,
        minSales: 10,
        minCommissionRate: 3,
        minimumScore: 70,
        campaign: 'teste-local',
        limitCandidates: 20,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(commercialPipelineService.dryRun).toHaveBeenCalledWith({
      source: 'MANUAL',
      categoryId: 'cat-1',
      minPrice: 10,
      maxPrice: 100,
      minDiscountRate: 5,
      minRating: 4,
      minSales: 10,
      minCommissionRate: 3,
      minimumScore: 70,
      campaign: 'teste-local',
      limitCandidates: 20,
    });
  });

  it('aceita source OFFICIAL sem compor provider externo', async () => {
    const { app, commercialPipelineService, pipelineAdd } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/commercial-pipeline/dry-run',
      payload: { source: 'official' },
    });
    expect(response.statusCode).toBe(200);
    expect(commercialPipelineService.dryRun).toHaveBeenCalledWith({
      source: 'OFFICIAL',
    });
    expect(pipelineAdd).not.toHaveBeenCalled();
  });

  it.each([
    ['body invalido', []],
    ['coupon rejeitado', { coupon: 'FAKE' }],
    ['groupId rejeitado', { groupId: 'group' }],
    ['message rejeitado', { message: 'texto' }],
    ['send rejeitado', { send: true }],
  ])('%s', async (_, payload) => {
    const { app, commercialPipelineService } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/commercial-pipeline/dry-run',
      payload,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: 'INVALID_PIPELINE_FILTERS',
      message: expect.any(String),
    });
    expect(commercialPipelineService.dryRun).not.toHaveBeenCalled();
  });

  it.each([
    'NO_ELIGIBLE_PRODUCT',
    'NO_AUTHORIZED_GROUP',
    'MULTIPLE_AUTHORIZED_GROUPS',
    'PRODUCT_ALREADY_SENT',
  ])('retorna bloqueio publico %s', async (code) => {
    const { app } = await setup(
      vi.fn().mockRejectedValue(new AppError('Bloqueio seguro', code)),
    );
    const response = await app.inject({
      method: 'POST',
      url: '/commercial-pipeline/dry-run',
      payload: {},
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: code,
      message: 'Bloqueio seguro',
    });
  });

  it('sanitiza erro inesperado', async () => {
    const { app } = await setup(
      vi.fn().mockRejectedValue(new Error('database detail')),
    );
    const response = await app.inject({
      method: 'POST',
      url: '/commercial-pipeline/dry-run',
      payload: {},
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: 'COMMERCIAL_PIPELINE_FAILED',
      message: 'Falha segura no pipeline comercial',
    });
    expect(response.body).not.toContain('database detail');
  });

  it('lista runs sanitizados com filtros e paginacao', async () => {
    const { app, commercialPipelineService } = await setup();
    const response = await app.inject({
      method: 'GET',
      url: '/commercial-pipeline/runs?status=completed&mode=dry-run&productId=product-safe-1&page=1&limit=20',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toEqual([runHistory]);
    expect(commercialPipelineService.listRuns).toHaveBeenCalledWith({
      status: 'COMPLETED',
      mode: 'DRY_RUN',
      productId: 'product-safe-1',
      page: 1,
      limit: 20,
    });
    expect(response.body).not.toContain('@g.us');
  });

  it('retorna detalhe sanitizado de run', async () => {
    const { app, commercialPipelineService } = await setup();
    const response = await app.inject({
      method: 'GET',
      url: '/commercial-pipeline/runs/run-safe-1',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(runHistory);
    expect(commercialPipelineService.findRun).toHaveBeenCalledWith(
      'run-safe-1',
    );
    expect(response.body).not.toContain('@g.us');
  });
});
