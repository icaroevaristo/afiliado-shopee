import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { render } from '../test/render';
import { AppShell } from './app-shell';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/lifecycle',
}));

vi.mock('../lib/api', () => ({
  getHealth: vi.fn().mockResolvedValue({ status: 'ok', service: 'api' }),
}));

describe('AppShell', () => {
  it('inclui a superficie de lifecycle na navegacao principal', async () => {
    const screen = await render(
      <AppShell>
        <div>conteudo</div>
      </AppShell>,
    );

    const lifecycleLink = screen.container.querySelector(
      'a[href="/lifecycle"]',
    );
    expect(lifecycleLink?.textContent).toContain('Lifecycle');
    expect(lifecycleLink?.getAttribute('data-active')).toBe('true');

    await screen.unmount();
  });
});
