import React, { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { change, click, render } from '../../test/render';
import NichesPage from './page';

const listNichesMock = vi.fn();
const listCampaignsMock = vi.fn();
const listCategoriesMock = vi.fn();
const createNicheMock = vi.fn();
const updateNicheMock = vi.fn();
const previewNicheMock = vi.fn();

vi.mock('../../lib/api', () => ({
  listCommercialNiches: (...args: unknown[]) => listNichesMock(...args),
  listCommercialCampaigns: (...args: unknown[]) => listCampaignsMock(...args),
  listShopeeCategories: (...args: unknown[]) => listCategoriesMock(...args),
  createCommercialNiche: (...args: unknown[]) => createNicheMock(...args),
  updateCommercialNiche: (...args: unknown[]) => updateNicheMock(...args),
  previewCommercialNiche: (...args: unknown[]) => previewNicheMock(...args),
}));

const niche = {
  id: 'niche-1',
  name: 'Maternidade',
  slug: 'maternidade',
  active: true,
  categoryIds: ['baby'],
  includeKeywords: ['bebe'],
  excludeKeywords: [],
  minPrice: null,
  maxPrice: null,
  minDiscountRate: 5,
  minRating: 0,
  minSales: 0,
  minCommissionRate: 0,
  minimumScore: 60,
  createdAt: '2026-08-30T12:00:00.000Z',
  updatedAt: '2026-08-30T12:00:00.000Z',
};

const previewReport = {
  preview: true,
  evaluatedCount: 3,
  matchedCount: 1,
  rejectedCount: 2,
  evaluationTruncated: false,
  matchSummary: { matched: 1, rejected: 2 },
  rejectionSummary: { CATEGORY_NOT_INCLUDED: 2 },
  matches: [
    {
      productId: 'product-1',
      productName: 'Fralda para bebê',
      price: '39.90',
      discountRate: 20,
      rating: 4.8,
      sales: 1000,
      commissionRate: 12,
      finalScore: 80,
      categoryIds: ['baby'],
    },
  ],
  rejections: [
    {
      productId: 'product-2',
      productName: 'Furadeira',
      reasons: ['CATEGORY_NOT_INCLUDED'],
    },
  ],
};

beforeEach(() => {
  listNichesMock.mockReset().mockResolvedValue({
    items: [niche],
    page: 1,
    limit: 100,
    total: 1,
    totalPages: 1,
  });
  listCampaignsMock.mockReset().mockResolvedValue({
    items: [
      {
        id: 'campaign-1',
        nicheId: 'niche-1',
        name: 'Ofertas para mamães',
      },
    ],
    page: 1,
    limit: 100,
    total: 1,
    totalPages: 1,
  });
  listCategoriesMock.mockReset().mockResolvedValue({
    items: [
      {
        id: 'baby',
        name: 'Bebês',
        parentId: null,
        mappingSource: 'OFFICIAL_PRODUCT_CATEGORY_ID',
        productCount: 4,
        displayLabel: 'Bebês',
      },
    ],
    hierarchyStatus: 'NOT_AVAILABLE_FROM_CURRENT_PROVIDER_CONTRACT',
  });
  createNicheMock.mockReset().mockResolvedValue(niche);
  updateNicheMock.mockReset().mockResolvedValue(niche);
  previewNicheMock.mockReset().mockResolvedValue(previewReport);
  vi.stubGlobal('confirm', vi.fn(() => true));
});

describe('NichesPage', () => {
  it('lista nichos, mostra categorias humanas e explica regras transversais', async () => {
    const screen = await render(<NichesPage />);
    await act(async () => undefined);

    expect(screen.container.querySelector('h1')?.textContent).toBe('Nichos');
    expect(screen.container.textContent).toContain('Maternidade');
    expect(screen.container.textContent).toContain('Bebês');
    expect(screen.container.textContent).toContain('1 campanha(s) utilizam este nicho');
    expect(screen.container.textContent).toContain('Nicho não é categoria Shopee.');
    expect(screen.container.textContent).not.toContain('baby');
    await screen.unmount();
  });

  it('testa o draft e exibe aprovados e rejeitados sem salvar', async () => {
    const screen = await render(<NichesPage />);
    await act(async () => undefined);

    const name = screen.container.querySelector(
      'input[placeholder="Ex.: Maternidade"]',
    );
    await change(name as HTMLInputElement, 'Maternidade');
    const categories = screen.container.querySelector(
      'select[aria-label="Categorias Shopee do nicho"]',
    ) as HTMLSelectElement;
    categories.options[0].selected = true;
    await act(async () => {
      categories.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const testButton = Array.from(screen.container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Testar nicho'),
    );
    await click(testButton as HTMLButtonElement);

    expect(previewNicheMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Maternidade', categoryIds: ['baby'] }),
    );
    expect(createNicheMock).not.toHaveBeenCalled();
    expect(screen.container.textContent).toContain('Fralda para bebê');
    expect(screen.container.textContent).toContain('Furadeira');
    expect(screen.container.textContent).toContain('Categoria não selecionada');
    await screen.unmount();
  });

  it('preserva categorias selecionadas enquanto a busca muda', async () => {
    listCategoriesMock.mockResolvedValueOnce({
      items: [
        {
          id: 'baby',
          name: 'Bebês',
          parentId: null,
          mappingSource: 'OFFICIAL_PRODUCT_CATEGORY_ID',
          productCount: 4,
          displayLabel: 'Bebês',
        },
        {
          id: 'audio',
          name: 'Áudio',
          parentId: null,
          mappingSource: 'OFFICIAL_PRODUCT_CATEGORY_ID',
          productCount: 2,
          displayLabel: 'Áudio',
        },
      ],
      hierarchyStatus: 'NOT_AVAILABLE_FROM_CURRENT_PROVIDER_CONTRACT',
    });
    const screen = await render(<NichesPage />);
    await act(async () => undefined);

    const name = screen.container.querySelector(
      'input[placeholder="Ex.: Maternidade"]',
    );
    await change(name as HTMLInputElement, 'Achadinhos');
    const categories = screen.container.querySelector(
      'select[aria-label="Categorias Shopee do nicho"]',
    ) as HTMLSelectElement;
    categories.options[0].selected = true;
    await act(async () => {
      categories.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const categorySearch = screen.container.querySelector(
      'input[placeholder="Buscar por nome"]',
    );
    await change(categorySearch as HTMLInputElement, 'Áudio');
    const filteredCategories = screen.container.querySelector(
      'select[aria-label="Categorias Shopee do nicho"]',
    ) as HTMLSelectElement;
    filteredCategories.options[0].selected = true;
    await act(async () => {
      filteredCategories.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const testButton = Array.from(screen.container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Testar nicho'),
    );
    await click(testButton as HTMLButtonElement);
    expect(previewNicheMock).toHaveBeenCalledWith(
      expect.objectContaining({ categoryIds: ['baby', 'audio'] }),
    );
    await screen.unmount();
  });

  it('descarta preview quando o draft muda', async () => {
    const screen = await render(<NichesPage />);
    await act(async () => undefined);

    const name = screen.container.querySelector(
      'input[placeholder="Ex.: Maternidade"]',
    );
    await change(name as HTMLInputElement, 'Maternidade');
    const testButton = Array.from(screen.container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Testar nicho'),
    );
    await click(testButton as HTMLButtonElement);
    expect(screen.container.textContent).toContain('Fralda para bebê');

    const changedName = screen.container.querySelector(
      'input[placeholder="Ex.: Maternidade"]',
    );
    await change(changedName as HTMLInputElement, 'Outro nicho');
    expect(screen.container.textContent).not.toContain('Fralda para bebê');
    await screen.unmount();
  });

  it('edita e desativa pelo contrato oficial com confirmação', async () => {
    const screen = await render(<NichesPage />);
    await act(async () => undefined);

    const edit = Array.from(screen.container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Editar'),
    );
    await click(edit as HTMLButtonElement);
    const name = Array.from(screen.container.querySelectorAll('input')).find(
      (input) => input.value === 'Maternidade',
    );
    await change(name as HTMLInputElement, 'Maternidade e bebê');
    const save = Array.from(screen.container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Salvar nicho'),
    );
    await click(save as HTMLButtonElement);
    expect(updateNicheMock).toHaveBeenCalledWith(
      'niche-1',
      expect.objectContaining({ name: 'Maternidade e bebê', active: true }),
    );

    const toggle = Array.from(screen.container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Desativar'),
    );
    await click(toggle as HTMLButtonElement);
    expect(window.confirm).toHaveBeenCalled();
    expect(updateNicheMock).toHaveBeenLastCalledWith('niche-1', { active: false });
    await screen.unmount();
  });
});
