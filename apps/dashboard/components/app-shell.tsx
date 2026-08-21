'use client';

import {
  Activity,
  Boxes,
  ClipboardList,
  FileText,
  GitBranch,
  Gauge,
  LayoutDashboard,
  Menu,
  PackageSearch,
  RadioTower,
  Settings2,
  Tags,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { getHealth } from '../lib/api';

const navigation = [
  { href: '/', label: 'Visao geral', icon: LayoutDashboard },
  { href: '/envios', label: 'Envios', icon: RadioTower },
  { href: '/fila', label: 'Fila', icon: Boxes },
  { href: '/produtos', label: 'Produtos', icon: PackageSearch },
  { href: '/campanhas', label: 'Campanhas', icon: Tags },
  { href: '/automacao', label: 'Automacao', icon: Gauge },
  { href: '/lifecycle', label: 'Lifecycle', icon: GitBranch },
  { href: '/copies', label: 'Copies', icon: FileText },
];

const secondaryNavigation = [
  { href: '/configuracoes', label: 'Sistema', icon: Settings2 },
];

function NavigationLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <>
      <p className="ops-nav-label">Operacao</p>
      <nav className="ops-nav" aria-label="Navegacao principal">
        {navigation.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className="ops-nav-link"
              data-active={active}
            >
              <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="ops-sidebar-separator" />
      <p className="ops-nav-label">Sistema</p>
      <nav className="ops-nav" aria-label="Navegacao do sistema">
        {secondaryNavigation.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className="ops-nav-link"
              data-active={active}
            >
              <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}

function ApiPulse() {
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    const check = async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        await getHealth();
        if (active) setOnline(true);
      } catch {
        if (active) setOnline(false);
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 15_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <span className="ops-header-chip" aria-live="polite">
      <span
        className="ops-status-dot"
        data-tone={online === true ? 'success' : online === false ? 'danger' : undefined}
        aria-hidden="true"
      />
      API {online === true ? 'online' : online === false ? 'offline' : 'verificando'}
    </span>
  );
}

function Sidebar({ mobile = false, onNavigate }: { mobile?: boolean; onNavigate?: () => void }) {
  return (
    <aside className={mobile ? 'ops-sidebar ops-sidebar-mobile' : 'ops-sidebar'}>
      <Link href="/" className="ops-brand" onClick={onNavigate}>
        <span className="ops-brand-mark" aria-hidden="true">SA</span>
        <span className="ops-brand-copy">
          <strong>Shopee Affiliate</strong>
          <span>Operations console</span>
        </span>
      </Link>
      <NavigationLinks onNavigate={onNavigate} />
      <div className="ops-sidebar-footer">
        <div className="ops-footer-status">
          <span className="ops-status-dot" data-tone="success" aria-hidden="true" />
          <span>LIVE · control local</span>
        </div>
        <span className="ops-mono">read-only / v1</span>
      </div>
    </aside>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="ops-app">
      <a className="ops-skip-link" href="#main-content">
        Pular para o conteudo
      </a>
      <Sidebar />
      <div className="ops-layout">
        <header className="ops-header">
          <div className="ops-header-context">
            <button
              type="button"
              className="ops-menu-button"
              onClick={() => setMobileOpen(true)}
              aria-label="Abrir menu de operacao"
            >
              <Menu size={17} aria-hidden="true" />
            </button>
            <Activity size={15} aria-hidden="true" />
            <strong>Centro de operacoes</strong>
            <span>/</span>
            <span>automacao comercial</span>
          </div>
          <div className="ops-header-actions">
            <ApiPulse />
            <span className="ops-header-chip">
              <ClipboardList size={13} aria-hidden="true" />
              leitura operacional
            </span>
          </div>
        </header>
        <main id="main-content" className="ops-main" tabIndex={-1}>{children}</main>
      </div>

      {mobileOpen ? (
        <div className="ops-drawer-backdrop" role="presentation">
          <button
            type="button"
            className="absolute inset-0 h-full w-full cursor-default border-0 bg-transparent"
            aria-label="Fechar menu"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative h-full w-[min(280px,88vw)]">
            <Sidebar mobile onNavigate={() => setMobileOpen(false)} />
            <button
              type="button"
              className="ops-icon-button absolute right-3 top-4 z-40"
              onClick={() => setMobileOpen(false)}
              aria-label="Fechar menu de operacao"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
