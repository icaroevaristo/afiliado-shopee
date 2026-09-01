'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { GroupsManagement } from '../../components/groups-management';
import { WhatsAppContextNav } from '../../components/whatsapp-context-nav';
import { WhatsAppInstancesManagement } from '../../components/whatsapp-instances-management';

function WhatsAppPageContent() {
  const searchParams = useSearchParams();
  const view =
    searchParams.get('view') === 'whatsapps' ? 'whatsapps' : 'groups';

  return (
    <div className="grid gap-6">
      <WhatsAppContextNav active={view} />
      {view === 'groups' ? (
        <GroupsManagement />
      ) : (
        <WhatsAppInstancesManagement />
      )}
      {view === 'groups' ? (
        <p className="text-sm text-slate-600">
          Precisa consultar entregas anteriores?{' '}
          <Link
            className="font-semibold text-orange-700 underline"
            href="/envios"
          >
            Ver histórico de envios
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}

export default function WhatsAppPage() {
  return (
    <Suspense
      fallback={
        <div className="ops-state" aria-live="polite">
          Carregando área de WhatsApp…
        </div>
      }
    >
      <WhatsAppPageContent />
    </Suspense>
  );
}
