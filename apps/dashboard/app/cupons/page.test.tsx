import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { click, render } from '../../test/render';
import CouponsPage from './page';

const listMock = vi.fn();

vi.mock('../../lib/api', () => ({
  listCoupons: (...args: unknown[]) => listMock(...args),
}));

beforeEach(() => {
  listMock.mockReset().mockResolvedValue([]);
});

describe('CouponsPage', () => {
  it('mostra estado manual seguro sem coleta automatica', async () => {
    const screen = await render(<CouponsPage />);
    expect(screen.container.textContent).toContain('Cupons');
    expect(screen.container.textContent).toContain('Consulta somente leitura');
    expect(screen.container.textContent).toContain('Nenhum cupom cadastrado');
    expect(screen.container.textContent).not.toContain(
      'Confirmar cupom manual',
    );
    expect(screen.container.textContent).not.toContain('Novo cupom manual');
    expect(
      screen.container.querySelector('a[href="/produtos"]'),
    ).not.toBeNull();
    expect(
      screen.container
        .querySelector('a[href="/cupons"]')
        ?.getAttribute('aria-current'),
    ).toBe('page');
    await screen.unmount();
  });

  it('exibe cupons em linguagem operacional e sem ações de alteração', async () => {
    listMock.mockResolvedValue([
      {
        id: 'coupon-1',
        code: 'CASA10',
        description: 'Desconto para a casa',
        source: 'MANUAL',
        active: true,
        discountType: 'PERCENTAGE',
        discountValue: '10',
        minPurchase: '100',
        startsAt: '2026-08-01T00:00:00.000Z',
        endsAt: '2099-08-01T00:00:00.000Z',
      },
    ]);
    const screen = await render(<CouponsPage />);

    expect(screen.container.textContent).toContain('CASA10');
    expect(screen.container.textContent).toContain('Disponível');
    expect(screen.container.textContent).toContain('Compra mínima');
    expect(screen.container.textContent).not.toContain('coupon-1');
    expect(screen.container.querySelector('button')).toBeNull();
    await screen.unmount();
  });

  it('oferece retry para uma leitura indisponível', async () => {
    listMock
      .mockRejectedValueOnce(new Error('temporarily offline'))
      .mockResolvedValueOnce([]);
    const screen = await render(<CouponsPage />);

    expect(screen.container.textContent).toContain('temporarily offline');
    const retry = Array.from(screen.container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Atualizar',
    );
    expect(retry).toBeDefined();
    await click(retry as HTMLButtonElement);
    expect(screen.container.textContent).toContain('Nenhum cupom cadastrado');
    await screen.unmount();
  });
});
