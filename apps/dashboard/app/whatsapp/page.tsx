'use client';

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
