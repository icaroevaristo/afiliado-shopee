import { describe, expect, it, vi } from 'vitest';
import { MockShopeeProvider } from '@shopee-auto-affiliate-ai/providers';
import { HunterService } from '../src/hunter-service';
import { buildAuthenticatedTestApp } from './authenticated-test-app';
import { PrismaProductRepository } from '../src/prisma-repositories';

const createPrismaMock = () => {
  const store = new Map<string, unknown>();
  return {
    $disconnect: vi.fn(),
    productLead: {
      findUnique: vi.fn(
        async ({
          where,
        }: {
          where: { source_providerProductId: { providerProductId: string } };
        }) => {
          const providerProductId =
            where.source_providerProductId.providerProductId;
          return store.has(providerProductId)
            ? { id: providerProductId }
            : null;
        },
      ),
      create: vi.fn(
        async ({ data }: { data: { providerProductId: string } }) => {
          store.set(data.providerProductId, data);
          return data;
        },
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { source_providerProductId: { providerProductId: string } };
          data: unknown;
        }) => {
          store.set(where.source_providerProductId.providerProductId, data);
          return data;
        },
      ),
    },
  };
};

const logger = { info: vi.fn(), error: vi.fn() };

describe('Hunter Agent', () => {
  it('retorna cerca de 40 produtos fictícios com categorias variadas', async () => {
    const produtos = await new MockShopeeProvider().buscarProdutos();
    expect(produtos).toHaveLength(40);
    expect(
      new Set(produtos.map((produto) => produto.categoria)).size,
    ).toBeGreaterThan(3);
    expect(produtos[0]).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        nome: expect.any(String),
        categoria: expect.any(String),
        preco: expect.any(Number),
        desconto: expect.any(Number),
        nota: expect.any(Number),
        vendidos: expect.any(Number),
        comissao: expect.any(Number),
        loja: expect.any(String),
        urlImagem: expect.any(String),
      }),
    );
  });

  it('cria produtos novos e atualiza existentes', async () => {
    const prisma = createPrismaMock();
    const service = new HunterService({
      provider: new MockShopeeProvider(),
      products: new PrismaProductRepository(prisma as never),
      logger,
    });

    const primeiraExecucao = await service.run({ categoria: 'Eletrônicos' });
    const segundaExecucao = await service.run({ categoria: 'Eletrônicos' });

    expect(primeiraExecucao).toMatchObject({
      encontrados: 5,
      novos: 5,
      atualizados: 0,
    });
    expect(segundaExecucao).toMatchObject({
      encontrados: 5,
      novos: 0,
      atualizados: 5,
    });
  });

  it('expõe POST /hunter/run', async () => {
    const prisma = createPrismaMock();
    const app = await buildAuthenticatedTestApp({
      logger: false,
      prisma: prisma as never,
      hunterProvider: new MockShopeeProvider(),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/hunter/run',
      payload: { notaMin: 4.8 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      encontrados: expect.any(Number),
      novos: expect.any(Number),
      atualizados: expect.any(Number),
      tempoExecucao: expect.stringMatching(/ms$/),
    });
    await app.close();
  });
});
