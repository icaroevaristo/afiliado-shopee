import React, { act, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { click, render } from '../test/render';
import { AppShell } from './app-shell';

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('../lib/api', () => ({
  getHealth: vi.fn().mockResolvedValue({ status: 'ok', service: 'api' }),
}));

describe('AppShell', () => {
  it('oferece números e grupos na navegação desktop', async () => {
    const screen = await render(
      <AppShell>
        <div>Conteúdo</div>
      </AppShell>,
    );
    await act(async () => undefined);

    const link = screen.container.querySelector('a[href="/whatsapp"]');
    expect(link?.textContent).toContain('Números e grupos');
    expect(screen.container.textContent).toContain('controle operacional');
    expect(screen.container.textContent).toContain('control plane / v1');
    await screen.unmount();
  });

  it('mantém a mesma navegação no menu mobile', async () => {
    const screen = await render(
      <AppShell>
        <div>Conteúdo</div>
      </AppShell>,
    );
    const menuButton = screen.container.querySelector(
      'button[aria-label="Abrir menu de operacao"]',
    );
    await click(menuButton as HTMLButtonElement);

    const mobileSidebar = screen.container.querySelector(
      '.ops-sidebar-mobile',
    );
    expect(mobileSidebar?.querySelector('a[href="/whatsapp"]')?.textContent).toContain(
      'Números e grupos',
    );
    await screen.unmount();
  });
});
