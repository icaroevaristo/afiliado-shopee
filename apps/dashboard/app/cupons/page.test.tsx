import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '../../test/render';
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
    expect(screen.container.textContent).toContain('Cupons manuais');
    expect(screen.container.textContent).toContain('somente leitura');
    expect(screen.container.textContent).toContain('Nenhum cupom cadastrado');
    expect(screen.container.textContent).not.toContain('Confirmar cupom manual');
    expect(screen.container.textContent).not.toContain('Novo cupom manual');
    await screen.unmount();
  });
});
