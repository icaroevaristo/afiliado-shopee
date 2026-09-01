import React, { act, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getHealth } from '../lib/api';
import { click, render } from '../test/render';
import { AppShell } from './app-shell';

const navigationState = vi.hoisted(() => ({ pathname: '/' }));

vi.mock('next/navigation', () => ({
  usePathname: () => navigationState.pathname,
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    onClick,
    ...props
  }: {
    href: string;
    children: ReactNode;
    onClick?: React.MouseEventHandler<HTMLAnchorElement>;
  }) => (
    <a
      href={href}
      {...props}
      onClick={(event) => {
        event.preventDefault();
        onClick?.(event);
      }}
    >
      {children}
    </a>
  ),
}));

vi.mock('../lib/api', () => ({
  getHealth: vi.fn().mockResolvedValue({ status: 'ok', service: 'api' }),
}));

describe('AppShell', () => {
  afterEach(() => {
    navigationState.pathname = '/';
    vi.mocked(getHealth).mockClear();
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
  });

  it('oferece o menu principal em português e sem jargão técnico', async () => {
    const screen = await render(
      <AppShell>
        <div>Conteúdo</div>
      </AppShell>,
    );
    await act(async () => undefined);

    const labels = [
      'Início',
      'Ofertas',
      'Grupos e WhatsApps',
      'Automação',
      'Histórico',
      'Configurações',
    ];
    for (const label of labels) {
      expect(screen.container.textContent).toContain(label);
    }
    expect(screen.container.textContent).toContain('Operação diária');
    expect(screen.container.textContent).toContain('API online');
    expect(screen.container.textContent).not.toContain('Operations console');
    expect(screen.container.textContent).not.toContain('Centro de operações');
    expect(screen.container.textContent).not.toContain('control plane / v1');
    expect(screen.container.textContent).not.toContain('LIVE · control local');
    expect(
      screen.container
        .querySelector('.ops-nav a[href="/"]')
        ?.getAttribute('aria-current'),
    ).toBe('page');
    expect(screen.container.querySelector('a[href="/campanhas"]')).toBeNull();
    await screen.unmount();
  });

  it('marca a seção ativa em subrotas e mantém deep links legados fora do menu', async () => {
    navigationState.pathname = '/produtos/offer-123';
    const screen = await render(
      <AppShell>
        <div>Conteúdo</div>
      </AppShell>,
    );

    expect(
      screen.container
        .querySelector('.ops-nav a[href="/produtos"]')
        ?.getAttribute('aria-current'),
    ).toBe('page');
    expect(
      screen.container
        .querySelector('.ops-nav a[href="/"]')
        ?.getAttribute('aria-current'),
    ).toBeNull();
    expect(screen.container.querySelector('a[href="/campanhas"]')).toBeNull();
    await screen.unmount();
  });

  it('mantém a navegação acessível no drawer mobile', async () => {
    const screen = await render(
      <AppShell>
        <div>Conteúdo</div>
      </AppShell>,
    );
    const menuButton = screen.container.querySelector(
      'button[aria-label="Abrir menu principal"]',
    );
    await click(menuButton as HTMLButtonElement);

    const mobileSidebar = screen.container.querySelector('.ops-sidebar-mobile');
    expect(mobileSidebar?.getAttribute('role')).toBe('dialog');
    expect(mobileSidebar?.getAttribute('aria-modal')).toBe('true');
    expect(document.body.style.overflow).toBe('hidden');
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(
      mobileSidebar?.querySelector('a[href="/whatsapp"]')?.textContent,
    ).toContain('Grupos e WhatsApps');
    expect(document.activeElement).toBe(
      mobileSidebar?.querySelector(
        'button[aria-label="Fechar menu principal"]',
      ),
    );

    const firstFocusable = mobileSidebar?.querySelector(
      'button[aria-label="Fechar menu principal"]',
    ) as HTMLButtonElement;
    const lastFocusable = mobileSidebar?.querySelector(
      'a[href="/configuracoes"]',
    ) as HTMLAnchorElement;
    lastFocusable.focus();
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(firstFocusable);

    firstFocusable.focus();
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          shiftKey: true,
          bubbles: true,
        }),
      );
    });
    expect(document.activeElement).toBe(lastFocusable);

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });
    expect(screen.container.querySelector('.ops-sidebar-mobile')).toBeNull();
    expect(document.activeElement).toBe(menuButton);
    expect(document.body.style.overflow).toBe('');

    await click(menuButton as HTMLButtonElement);
    const navigationLink = screen.container.querySelector(
      '.ops-sidebar-mobile a[href="/produtos"]',
    );
    await act(async () => {
      navigationLink?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });
    expect(screen.container.querySelector('.ops-sidebar-mobile')).toBeNull();
    expect(document.body.style.overflow).toBe('');

    await click(menuButton as HTMLButtonElement);
    const backdrop = screen.container.querySelector('.ops-mobile-backdrop');
    await click(backdrop as HTMLButtonElement);
    expect(screen.container.querySelector('.ops-sidebar-mobile')).toBeNull();
    expect(document.body.style.overflow).toBe('');
    await screen.unmount();
  });

  it('não consulta a API enquanto a página está oculta', async () => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    const screen = await render(
      <AppShell>
        <div>Conteúdo</div>
      </AppShell>,
    );
    await act(async () => undefined);

    expect(getHealth).not.toHaveBeenCalled();
    await screen.unmount();
  });

  it('consulta a API quando a página está visível', async () => {
    const screen = await render(
      <AppShell>
        <div>Conteúdo</div>
      </AppShell>,
    );
    await act(async () => undefined);

    expect(getHealth).toHaveBeenCalledTimes(1);
    expect(screen.container.textContent).toContain('API online');
    await screen.unmount();
  });

  it('fecha o drawer quando a viewport volta para desktop', async () => {
    const originalInnerWidth = window.innerWidth;
    const screen = await render(
      <AppShell>
        <div>Conteúdo</div>
      </AppShell>,
    );
    const menuButton = screen.container.querySelector(
      'button[aria-label="Abrir menu principal"]',
    ) as HTMLButtonElement;
    await click(menuButton);
    expect(
      screen.container.querySelector('.ops-sidebar-mobile'),
    ).not.toBeNull();

    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 1024,
    });
    await act(async () => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(screen.container.querySelector('.ops-sidebar-mobile')).toBeNull();
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: originalInnerWidth,
    });
    await screen.unmount();
  });
});
