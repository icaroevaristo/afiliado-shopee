'use client';

import {
  Gauge,
  History,
  Home,
  Menu,
  PackageSearch,
  Settings2,
  Tags,
  UsersRound,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { getHealth } from '../lib/api';

const navigation = [
  { href: '/', label: 'Início', icon: Home },
  { href: '/produtos', label: 'Ofertas', icon: PackageSearch },
  // TEMPORARY_NAV_DEVIATION: ambas as áreas ainda compartilham /whatsapp.
  { href: '/whatsapp', label: 'Grupos e WhatsApps', icon: UsersRound },
  { href: '/automacao', label: 'Automação', icon: Gauge },
  { href: '/nichos', label: 'Nichos', icon: Tags },
  { href: '/envios', label: 'Histórico', icon: History },
  { href: '/configuracoes', label: 'Configurações', icon: Settings2 },
];

function isNavigationItemActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavigationLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="ops-nav" aria-label="Menu principal">
      <p className="ops-nav-label">Menu principal</p>
      {navigation.map((item) => {
        const active = isNavigationItemActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className="ops-nav-link"
            data-active={active}
            aria-current={active ? 'page' : undefined}
          >
            <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
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
        data-tone={
          online === true ? 'success' : online === false ? 'danger' : undefined
        }
        aria-hidden="true"
      />
      API{' '}
      {online === true
        ? 'online'
        : online === false
          ? 'indisponível'
          : 'Verificando…'}
    </span>
  );
}

function Sidebar({
  mobile = false,
  onNavigate,
  closeButtonRef,
  id,
}: {
  mobile?: boolean;
  onNavigate?: () => void;
  closeButtonRef?: RefObject<HTMLButtonElement | null>;
  id?: string;
}) {
  return (
    <aside
      className={mobile ? 'ops-sidebar ops-sidebar-mobile' : 'ops-sidebar'}
      role={mobile ? 'dialog' : undefined}
      aria-modal={mobile ? true : undefined}
      aria-label={mobile ? 'Menu principal' : undefined}
      data-mobile-drawer={mobile ? true : undefined}
      id={id}
    >
      <div className="ops-sidebar-top">
        {mobile ? (
          <button
            ref={closeButtonRef}
            type="button"
            className="ops-icon-button"
            onClick={onNavigate}
            aria-label="Fechar menu principal"
          >
            <X size={18} aria-hidden="true" />
          </button>
        ) : null}
        <Link href="/" className="ops-brand" onClick={onNavigate}>
          <span className="ops-brand-mark" aria-hidden="true">
            SA
          </span>
          <span className="ops-brand-copy">
            <strong>Shopee Affiliate</strong>
            <span>Operação diária</span>
          </span>
        </Link>
      </div>
      <NavigationLinks onNavigate={onNavigate} />
      <div className="ops-sidebar-footer">
        <span>Ambiente local</span>
      </div>
    </aside>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const closeOnDesktop = () => {
      if (window.innerWidth > 800) setMobileOpen(false);
    };
    window.addEventListener('resize', closeOnDesktop);
    return () => window.removeEventListener('resize', closeOnDesktop);
  }, []);

  useEffect(() => {
    if (!mobileOpen) return undefined;

    const previousActive = document.activeElement as HTMLElement | null;
    const focusReturn = menuButtonRef.current ?? previousActive;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusTimer = window.setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMobileOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;

      const drawer = document.querySelector<HTMLElement>(
        '[data-mobile-drawer="true"]',
      );
      if (!drawer) return;
      const focusable = Array.from(
        drawer.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
        ),
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (focusReturn && document.contains(focusReturn)) focusReturn.focus();
    };
  }, [mobileOpen]);

  const closeMobileMenu = () => setMobileOpen(false);

  return (
    <div className="ops-app">
      <a className="ops-skip-link" href="#main-content">
        Pular para o conteúdo
      </a>
      <Sidebar />
      <div className="ops-layout">
        <header className="ops-header">
          <div className="ops-header-context">
            <button
              ref={menuButtonRef}
              type="button"
              className="ops-menu-button"
              onClick={() => setMobileOpen(true)}
              aria-label="Abrir menu principal"
              aria-expanded={mobileOpen}
              aria-controls="mobile-navigation"
            >
              <Menu size={20} aria-hidden="true" />
            </button>
            <span className="ops-header-title">Operação diária</span>
          </div>
          <div className="ops-header-actions">
            <ApiPulse />
          </div>
        </header>
        <main id="main-content" className="ops-main" tabIndex={-1}>
          {children}
        </main>
      </div>

      {mobileOpen ? (
        <div className="ops-mobile-overlay">
          <button
            type="button"
            className="ops-mobile-backdrop"
            aria-label="Fechar menu principal"
            onClick={closeMobileMenu}
          />
          <Sidebar
            mobile
            id="mobile-navigation"
            onNavigate={closeMobileMenu}
            closeButtonRef={closeButtonRef}
          />
        </div>
      ) : null}
    </div>
  );
}
