import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiRequestMock = vi.fn();

vi.mock('./client', () => ({
  apiRequest: (...args: unknown[]) => apiRequestMock(...args),
}));

import {
  createCommercialNiche,
  listCommercialNiches,
  previewCommercialNiche,
  updateCommercialNiche,
} from './commercial-niches';

beforeEach(() => apiRequestMock.mockReset().mockResolvedValue({}));

describe('API de nichos do dashboard', () => {
  it('lista nichos com paginação e filtro de status', async () => {
    await listCommercialNiches(2, 25, true);
    expect(apiRequestMock).toHaveBeenCalledWith(
      '/commercial/niches?page=2&limit=25&active=true',
      { method: 'GET' },
    );
  });

  it('cria e atualiza nicho sem inventar endpoint paralelo', async () => {
    const input = {
      name: 'Achadinhos',
      active: true,
      categoryIds: [],
      includeKeywords: [],
      excludeKeywords: [],
      minPrice: null,
      maxPrice: '50',
      minDiscountRate: 10,
      minRating: 4,
      minSales: 100,
      minCommissionRate: 5,
      minimumScore: 60,
    };
    await createCommercialNiche(input);
    expect(apiRequestMock).toHaveBeenLastCalledWith('/commercial/niches', {
      method: 'POST',
      body: input,
    });
    await updateCommercialNiche('niche/1', { active: false });
    expect(apiRequestMock).toHaveBeenLastCalledWith('/commercial/niches/niche%2F1', {
      method: 'PATCH',
      body: { active: false },
    });
  });

  it('testa draft somente por preview read-only', async () => {
    const input = {
      name: 'Maternidade',
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
    };
    await previewCommercialNiche(input);
    expect(apiRequestMock).toHaveBeenCalledWith('/commercial/niches/preview', {
      method: 'POST',
      body: input,
    });
  });
});
