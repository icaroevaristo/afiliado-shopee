'use client';

import Link from 'next/link';

export type OffersContextPage = 'offers' | 'coupons';

export function OffersContextNav({ active }: { active: OffersContextPage }) {
  return (
    <nav className="offers-context-nav" aria-label="Navegação de ofertas">
      <span className="offers-context-nav-label">Catálogo comercial</span>
      <div className="offers-context-nav-links">
        <Link
          href="/produtos"
          className={active === 'offers' ? 'is-active' : undefined}
          aria-current={active === 'offers' ? 'page' : undefined}
        >
          Ofertas
        </Link>
        <Link
          href="/cupons"
          className={active === 'coupons' ? 'is-active' : undefined}
          aria-current={active === 'coupons' ? 'page' : undefined}
        >
          Cupons
        </Link>
      </div>
    </nav>
  );
}
