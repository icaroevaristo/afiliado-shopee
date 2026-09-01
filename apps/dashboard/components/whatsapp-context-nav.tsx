'use client';

import Link from 'next/link';

export type WhatsAppContextView = 'groups' | 'whatsapps';

export function WhatsAppContextNav({
  active,
}: {
  active: WhatsAppContextView;
}) {
  return (
    <nav className="whatsapp-context-nav" aria-label="Navegação de WhatsApp">
      <span className="whatsapp-context-nav-label">Operação de WhatsApp</span>
      <div className="whatsapp-context-nav-links">
        <Link
          href="/whatsapp"
          className={active === 'groups' ? 'is-active' : undefined}
          aria-current={active === 'groups' ? 'page' : undefined}
        >
          Grupos
        </Link>
        <Link
          href="/whatsapp?view=whatsapps"
          className={active === 'whatsapps' ? 'is-active' : undefined}
          aria-current={active === 'whatsapps' ? 'page' : undefined}
        >
          WhatsApps
        </Link>
      </div>
    </nav>
  );
}
