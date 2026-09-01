import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { change, click, render } from '../../../test/render';
import ProductDetailPage from './page';

const detailMock = vi.fn();
const categoriesMock = vi.fn();
const manualOptionsMock = vi.fn();
const previewMock = vi.fn();
const createManualPublicationMock = vi.fn();

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'offer-1' }),
}));

vi.mock('../../../lib/api', () => ({
  getShopeeOffer: (...args: unknown[]) => detailMock(...args),
  listShopeeCategories: (...args: unknown[]) => categoriesMock(...args),
  getManualPublicationOptions: (...args: unknown[]) =>
    manualOptionsMock(...args),
  previewShopeeOfferCopy: (...args: unknown[]) => previewMock(...args),
  createManualPublication: (...args: unknown[]) =>
    createManualPublicationMock(...args),
  getManualPublication: vi.fn(),
}));

const detail = {
  id: 'offer-1',
  source: 'OFFICIAL',
  providerProductId: 'product-1',
  productName: 'Produto oficial',
  shopName: 'Loja oficial',
  categoryIds: ['100001'],
  price: '99.90',
  priceMin: '99.90',
  priceMax: '99.90',
  referencePrice: null,
  referencePriceUnavailableReason: 'OFFICIAL_REFERENCE_PRICE_NOT_AVAILABLE',
  discountRate: 20,
  rating: 4.8,
  sales: 1000,
  commissionRate: 8,
  imageUrl: 'https://example.invalid/image.jpg',
  productLink: 'https://example.invalid/product',
  affiliateLink: 'https://example.invalid/affiliate',
  affiliateLinkPresent: true,
  fetchedAt: '2026-08-24T00:00:00.000Z',
  lastSeenAt: '2026-08-24T00:00:00.000Z',
  unavailableAt: null,
  score: null,
  scoreUpdatedAt: null,
  createdAt: '2026-08-24T00:00:00.000Z',
  updatedAt: '2026-08-24T00:00:00.000Z',
  status: 'ACTIVE',
  commercialSnapshotRevision: 2,
  commercialSnapshotFingerprint: 'fingerprint-current',
  snapshot: null,
  capturedAt: '2026-08-24T00:00:00.000Z',
  capturedAtSource: 'FALLBACK_FETCHED_AT',
  commercialScores: [
    {
      candidateId: 'candidate-1',
      campaignId: 'campaign-1',
      campaignName: 'Campanha oficial',
      nicheId: 'niche-1',
      score: 80,
      rankPosition: 1,
      candidateStatus: 'QUEUED',
    },
  ],
  bestCurrentCommercialScore: 80,
  commercialStateSummary: {
    currentCandidateCount: 1,
    queued: 1,
    copyReady: 0,
    reserved: 0,
    dispatched: 0,
    blocked: 0,
    expired: 0,
    bestCurrentCommercialScore: 80,
  },
  everSent: true,
  sentDestinationCount: 1,
  lastSentAt: '2026-08-24T01:00:00.000Z',
  destinationDelivery: null,
  flashDealCapability: {
    status: 'UNSUPPORTED_CURRENT_PROVIDER_CONTRACT',
    reasonCode: 'OFFICIAL_SIGNAL_NOT_AVAILABLE',
  },
  dispatchHistory: {
    items: [
      {
        dispatchId: 'dispatch-1',
        status: 'SENT',
        destination: {
          id: 'destination-1',
          name: 'Grupo oficial',
          fingerprint: 'group-fingerprint',
          type: 'GROUP',
        },
        instanceName: 'instance-1',
        sentAt: '2026-08-24T01:00:00.000Z',
        attemptCount: 1,
        run: { id: 'run-1', finalStatus: 'SENT', investigationRequired: false },
      },
    ],
    page: 1,
    limit: 10,
    hasNextPage: false,
    hasPreviousPage: false,
  },
  snapshotHistory: {
    items: [
      {
        id: 'snapshot-2',
        revision: 2,
        fingerprint: 'fingerprint-current',
        price: '99.90',
        priceMin: '99.90',
        priceMax: '99.90',
        discountRate: 20,
        commissionRate: 8,
        observedRating: 4.8,
        observedSales: 1000,
        offerStartsAt: null,
        offerEndsAt: null,
        unavailableAt: null,
        capturedAt: '2026-08-24T00:00:00.000Z',
      },
    ],
    page: 1,
    limit: 10,
    hasNextPage: false,
    hasPreviousPage: false,
  },
};

beforeEach(() => {
  window.sessionStorage.clear();
  detailMock.mockReset().mockResolvedValue(detail);
  previewMock.mockReset().mockResolvedValue({
    label: 'PREVIEW — NAO ENVIADO',
    titulo: 'Oferta: Produto oficial',
    mensagem: 'Produto oficial por R$ 99,90.',
    cta: 'Confira a oferta no link afiliado.',
    affiliateLink: 'https://example.invalid/affiliate',
    coupon: null,
  });
  categoriesMock.mockReset().mockResolvedValue({
    items: [
      {
        id: '100001',
        name: 'Nome observado',
        parentId: null,
        mappingSource: 'OFFICIAL_PRODUCT_CATEGORY_ID',
        productCount: 1,
        displayLabel: 'Nome observado',
      },
    ],
    hierarchyStatus: 'NOT_AVAILABLE_FROM_CURRENT_PROVIDER_CONTRACT',
  });
  manualOptionsMock.mockReset().mockResolvedValue({
    product: {
      id: 'offer-1',
      name: 'Produto oficial',
      source: 'OFFICIAL',
      price: '99.90',
      affiliateLinkPresent: true,
      available: true,
      snapshot: {
        id: 'snapshot-2',
        revision: 2,
        fingerprint: 'fingerprint-current',
        capturedAt: '2026-08-24T00:00:00.000Z',
      },
    },
    candidate: { available: true, copyReady: false },
    groups: [
      {
        destinationId: 'destination-1',
        displayName: 'Grupo oficial',
        fingerprint: 'group-fingerprint',
        campaignId: 'campaign-1',
        assignedInstanceName: 'instance-1',
        eligible: true,
        blockers: [],
        copyStatus: 'AVAILABLE',
        draftPreview: null,
      },
    ],
  });
  createManualPublicationMock.mockReset().mockResolvedValue({
    id: 'request-1',
    status: 'ACCEPTED',
    targets: [
      {
        id: 'target-1',
        status: 'PENDING',
        destination: { name: 'Grupo oficial' },
        blockedReason: null,
        investigationRequired: false,
      },
    ],
  });
});

describe('ProductDetailPage', () => {
  it('exibe histórico, snapshots e a ação manual somente para oferta OFFICIAL', async () => {
    const screen = await render(<ProductDetailPage />);

    expect(screen.container.textContent).toContain('Produto oficial');
    expect(screen.container.textContent).toContain('Nome observado');
    expect(screen.container.textContent).toContain('Campanha oficial');
    expect(screen.container.textContent).toContain('Grupo oficial');
    expect(screen.container.textContent).toContain('Revisão 2');
    expect(screen.container.textContent).toContain('Ofertas relâmpago');
    expect(screen.container.textContent).toContain('Prévia da mensagem');
    expect(screen.container.textContent).toContain('Enviar publicação manual');
    expect(screen.container.textContent).toContain('Fluxo oficial');
    expect(screen.container.textContent).not.toContain('Preço de referência');
    const firstLevel = screen.container.querySelector(
      '[data-testid="offer-first-level"]',
    );
    expect(firstLevel?.textContent).not.toContain('offer-1');
    expect(firstLevel?.textContent).not.toContain('product-1');
    expect(firstLevel?.textContent).not.toContain('candidate-1');
    expect(firstLevel?.textContent).not.toContain('fingerprint-current');
    const technical = screen.container.querySelector(
      '[data-testid="offer-technical-details"]',
    );
    expect(technical?.hasAttribute('open')).toBe(false);
    expect(
      screen.container.querySelector('input[type="radio"]'),
    ).not.toBeNull();
    expect(screen.container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(screen.container.textContent).toContain(
      'Selecione exatamente 1 grupo',
    );
    expect(manualOptionsMock).toHaveBeenCalledWith('offer-1');
    expect(detailMock).toHaveBeenCalledWith(
      'offer-1',
      expect.objectContaining({ dispatchPage: 1, snapshotPage: 1 }),
    );
    await screen.unmount();
  });

  it('carrega prévia local sem criar publicação', async () => {
    const screen = await render(<ProductDetailPage />);
    const button = Array.from(screen.container.querySelectorAll('button')).find(
      (item) => item.textContent === 'Ver prévia da mensagem',
    );

    expect(button).toBeDefined();
    await click(button as HTMLButtonElement);

    expect(previewMock).toHaveBeenCalledWith('offer-1');
    expect(screen.container.textContent).toContain('PREVIEW — NAO ENVIADO');
    expect(screen.container.textContent).toContain(
      'Confira a oferta no link afiliado.',
    );
    await screen.unmount();
  });

  it('envia publicação manual para exatamente o grupo escolhido', async () => {
    vi.stubGlobal('crypto', {
      randomUUID: () => 'idempotency-test',
    });
    const screen = await render(<ProductDetailPage />);
    const radio = screen.container.querySelector(
      'input[type="radio"]',
    ) as HTMLInputElement;
    const confirmation = screen.container.querySelector(
      'input[placeholder="ENVIAR_PUBLICACAO_MANUAL"]',
    ) as HTMLInputElement;
    const send = Array.from(screen.container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Enviar publicação manual',
    );

    await click(radio);
    await change(confirmation, 'ENVIAR_PUBLICACAO_MANUAL');
    expect(send).toBeDefined();
    await click(send as HTMLButtonElement);

    expect(createManualPublicationMock).toHaveBeenCalledWith({
      idempotencyKey: 'idempotency-test',
      productId: 'offer-1',
      destinationIds: ['destination-1'],
      confirm: 'ENVIAR_PUBLICACAO_MANUAL',
    });
    expect(screen.container.textContent).toContain('Publicação manual: aceita');
    vi.unstubAllGlobals();
    await screen.unmount();
  });

  it('traduz oferta expirada como indisponível para ação comercial', async () => {
    detailMock.mockResolvedValueOnce({
      ...detail,
      status: 'EXPIRED',
    });
    const screen = await render(<ProductDetailPage />);

    expect(screen.container.textContent).toContain('Oferta expirada');
    expect(screen.container.textContent).toContain(
      'Esta oferta expirou e não deve ser tratada como uma oportunidade ativa.',
    );
    await screen.unmount();
  });

  it('mantém o contrato de retry no erro de carregamento', async () => {
    detailMock
      .mockRejectedValueOnce(new Error('temporarily offline'))
      .mockResolvedValueOnce(detail);
    const screen = await render(<ProductDetailPage />);

    expect(screen.container.textContent).toContain('temporarily offline');
    const retry = Array.from(screen.container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Tentar novamente',
    );
    expect(retry).toBeDefined();
    await click(retry as HTMLButtonElement);
    expect(screen.container.textContent).toContain('Produto oficial');
    await screen.unmount();
  });
});
