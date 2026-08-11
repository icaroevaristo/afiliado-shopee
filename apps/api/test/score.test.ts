import { describe, expect, it, vi } from 'vitest';
import { ScoreService, type ScorableProduct } from '../src/score-service';
import { buildAuthenticatedTestApp } from './authenticated-test-app';
import { PrismaProductRepository } from '../src/prisma-repositories';

const baseProduct = (
  overrides: Partial<ScorableProduct> = {},
): ScorableProduct => ({
  id: 'product-1',
  providerProductId: 'provider-1',
  nome: 'Produto Teste',
  desconto: 0,
  nota: 0,
  vendidos: 0,
  comissao: 0,
  loja: 'Loja Parceira',
  preco: 100,
  ...overrides,
});

const createPrismaMock = (products: ScorableProduct[]) => ({
  $disconnect: vi.fn(),
  productLead: {
    findMany: vi.fn(async () => products),
    update: vi.fn(
      async ({ where, data }: { where: { id: string }; data: unknown }) => ({
        id: where.id,
        ...(data as object),
      }),
    ),
  },
});

const logger = { info: vi.fn(), error: vi.fn() };

describe('ScoreService', () => {
  it('calcula produto excelente', () => {
    const service = new ScoreService({
      products: new PrismaProductRepository(createPrismaMock([]) as never),
      logger,
    });
    expect(
      service.calculate(
        baseProduct({
          comissao: 0.2,
          nota: 5,
          vendidos: 10000,
          desconto: 100,
          loja: 'Shopee Oficial',
        }),
      ),
    ).toBe(100);
  });

  it('calcula produto médio', () => {
    const service = new ScoreService({
      products: new PrismaProductRepository(createPrismaMock([]) as never),
      logger,
    });
    expect(
      service.calculate(
        baseProduct({ comissao: 0.1, nota: 3, vendidos: 5000, desconto: 50 }),
      ),
    ).toBe(48);
  });

  it('calcula produto ruim', () => {
    const service = new ScoreService({
      products: new PrismaProductRepository(createPrismaMock([]) as never),
      logger,
    });
    expect(
      service.calculate(
        baseProduct({ comissao: 0.02, nota: 1, vendidos: 100, desconto: 5 }),
      ),
    ).toBe(9);
  });

  it('calcula produto sem vendas', () => {
    const service = new ScoreService({
      products: new PrismaProductRepository(createPrismaMock([]) as never),
      logger,
    });
    expect(
      service.calculate(
        baseProduct({ comissao: 0.2, nota: 5, vendidos: 0, desconto: 100 }),
      ),
    ).toBe(70);
  });

  it('calcula produto sem comissão', () => {
    const service = new ScoreService({
      products: new PrismaProductRepository(createPrismaMock([]) as never),
      logger,
    });
    expect(
      service.calculate(
        baseProduct({ comissao: 0, nota: 5, vendidos: 10000, desconto: 100 }),
      ),
    ).toBe(55);
  });

  it('calcula produto nota máxima', () => {
    const service = new ScoreService({
      products: new PrismaProductRepository(createPrismaMock([]) as never),
      logger,
    });
    expect(service.calculate(baseProduct({ nota: 5 }))).toBe(25);
  });

  it('calcula produto loja oficial', () => {
    const service = new ScoreService({
      products: new PrismaProductRepository(createPrismaMock([]) as never),
      logger,
    });
    expect(service.calculate(baseProduct({ loja: 'Marca Oficial' }))).toBe(10);
  });

  it('torna oferta expirada ou indisponivel inelegivel sem mudar os pesos', () => {
    const service = new ScoreService({
      products: new PrismaProductRepository(createPrismaMock([]) as never),
      logger,
    });
    expect(
      service.calculate(
        baseProduct({
          comissao: 20,
          nota: 5,
          vendidos: 10000,
          desconto: 100,
          loja: 'Shopee Oficial',
          offerEndsAt: new Date('2020-01-01T00:00:00.000Z'),
        }),
      ),
    ).toBe(0);
    expect(service.calculate(baseProduct({ unavailableAt: new Date() }))).toBe(
      0,
    );
  });

  it('expõe POST /score/run e persiste score no banco', async () => {
    const prisma = createPrismaMock([
      baseProduct({
        id: 'product-1',
        comissao: 0.2,
        nota: 5,
        vendidos: 10000,
        desconto: 100,
        loja: 'Shopee Oficial',
      }),
      baseProduct({
        id: 'product-2',
        comissao: 0,
        nota: 0,
        vendidos: 0,
        desconto: 0,
      }),
    ]);
    const app = await buildAuthenticatedTestApp({ logger: false, prisma: prisma as never });

    const response = await app.inject({ method: 'POST', url: '/score/run' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      produtosProcessados: 2,
      maiorScore: 100,
      menorScore: 0,
      mediaScore: 50,
      tempoExecucao: expect.stringMatching(/ms$/),
    });
    expect(prisma.productLead.update).toHaveBeenCalledWith({
      where: { id: 'product-1' },
      data: { score: 100, scoreUpdatedAt: expect.any(Date) },
    });
    await app.close();
  });
});
