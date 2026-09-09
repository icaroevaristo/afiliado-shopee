import {
  DASHBOARD_PROXY_CONTRACTS,
  type DashboardProxyMethod,
} from '@shopee-auto-affiliate-ai/shared';

export { DASHBOARD_PROXY_CONTRACTS } from '@shopee-auto-affiliate-ai/shared';

type PathPattern = readonly string[];

export type DashboardUiCallout = {
  readonly method: DashboardProxyMethod;
  readonly pattern: PathPattern;
  readonly functions: readonly string[];
  readonly callsites: readonly string[];
};

/**
 * The complete dashboard callout inventory. A wildcard matches one encoded
 * segment only. Each row names the dashboard imports that invoke its helper;
 * the proxy derives its allowlist from this inventory and cannot retain an
 * unaccounted route.
 */
export const DASHBOARD_UI_CALLOUTS: readonly DashboardUiCallout[] = [
  { method: 'GET', pattern: ['health'], functions: ['getHealth'], callsites: ['app/page.tsx', 'app/diagnostico/page.tsx', 'components/api-status.tsx', 'components/app-shell.tsx'] },
  { method: 'GET', pattern: ['commercial-automation', 'status'], functions: ['getCommercialAutomationStatus'], callsites: ['app/page.tsx', 'app/automacao/page.tsx', 'app/diagnostico/page.tsx', 'components/commercial-automation-control.tsx'] },
  { method: 'GET', pattern: ['commercial-automation', 'scheduler'], functions: ['getCommercialAutomationSchedulerStatus'], callsites: ['app/page.tsx', 'app/automacao/page.tsx', 'app/diagnostico/page.tsx'] },
  { method: 'GET', pattern: ['commercial-automation', 'settings'], functions: ['getCommercialAutomationScheduleSettings'], callsites: ['app/automacao/page.tsx'] },
  { method: 'GET', pattern: ['commercial-automation', 'schedule', 'preview'], functions: ['getCommercialAutomationSchedulePreview'], callsites: ['app/automacao/page.tsx'] },
  { method: 'GET', pattern: ['commercial-automation', 'executions'], functions: ['listCommercialAutomationExecutions'], callsites: ['app/page.tsx', 'app/diagnostico/page.tsx'] },
  { method: 'GET', pattern: ['commercial-automation', 'outbox'], functions: ['listCommercialDispatchOutbox'], callsites: ['app/diagnostico/page.tsx'] },
  { method: 'PATCH', pattern: ['commercial-automation', 'settings'], functions: ['pauseCommercialAutomation', 'resumeCommercialAutomation'], callsites: ['app/automacao/page.tsx', 'components/commercial-automation-control.tsx'] },
  { method: 'PATCH', pattern: ['commercial-automation', 'settings', 'admin'], functions: ['updateOperationalAutomation'], callsites: ['app/automacao/page.tsx'] },
  { method: 'GET', pattern: ['operational-admin'], functions: ['getOperationalAdmin'], callsites: ['app/page.tsx', 'app/automacao/page.tsx', 'app/diagnostico/page.tsx', 'components/groups-management.tsx', 'components/operational-admin-panel.tsx', 'components/operational-status-summary.tsx', 'components/whatsapp-instances-management.tsx'] },
  { method: 'GET', pattern: ['commercial', 'campaigns'], functions: ['listCommercialCampaigns'], callsites: ['app/campanhas/page.tsx', 'app/fila/page.tsx', 'app/nichos/page.tsx'] },
  { method: 'POST', pattern: ['commercial', 'campaigns'], functions: ['createCommercialCampaign'], callsites: ['app/campanhas/page.tsx'] },
  { method: 'PATCH', pattern: ['commercial', 'campaigns', '*'], functions: ['updateCommercialCampaign'], callsites: ['app/campanhas/page.tsx'] },
  { method: 'POST', pattern: ['commercial', 'campaigns', '*', 'activate'], functions: ['activateCommercialCampaign'], callsites: ['app/campanhas/page.tsx'] },
  { method: 'POST', pattern: ['commercial', 'campaigns', '*', 'deactivate'], functions: ['deactivateCommercialCampaign'], callsites: ['app/campanhas/page.tsx'] },
  { method: 'GET', pattern: ['commercial', 'campaigns', '*', 'queue'], functions: ['listCommercialCampaignQueue'], callsites: ['app/fila/page.tsx'] },
  { method: 'GET', pattern: ['commercial', 'niches'], functions: ['listCommercialNiches'], callsites: ['app/campanhas/page.tsx', 'app/nichos/page.tsx'] },
  { method: 'POST', pattern: ['commercial', 'niches'], functions: ['createCommercialNiche'], callsites: ['app/nichos/page.tsx'] },
  { method: 'PATCH', pattern: ['commercial', 'niches', '*'], functions: ['updateCommercialNiche'], callsites: ['app/nichos/page.tsx'] },
  { method: 'POST', pattern: ['commercial', 'niches', 'preview'], functions: ['previewCommercialNiche'], callsites: ['app/nichos/page.tsx'] },
  { method: 'GET', pattern: ['commercial-pipeline', 'runs'], functions: ['listCommercialPipelineRuns'], callsites: ['app/pipeline-comercial/page.tsx'] },
  { method: 'GET', pattern: ['pipeline', 'jobs', '*'], functions: ['getPipelineJob'], callsites: ['app/pipeline/page.tsx'] },
  { method: 'GET', pattern: ['shopee', 'offers'], functions: ['listShopeeOffers', 'listProductsFromDispatches'], callsites: ['app/produtos/page.tsx', 'app/copies/page.tsx'] },
  { method: 'GET', pattern: ['shopee', 'offers', '*'], functions: ['getShopeeOffer', 'listShopeeCategories'], callsites: ['app/produtos/[id]/page.tsx', 'app/nichos/page.tsx', 'app/produtos/page.tsx'] },
  { method: 'POST', pattern: ['shopee', 'offers', '*', 'copy-preview'], functions: ['previewShopeeOfferCopy'], callsites: ['app/produtos/[id]/page.tsx'] },
  { method: 'GET', pattern: ['whatsapp', 'dispatches'], functions: ['listDispatches'], callsites: ['app/page.tsx', 'app/diagnostico/page.tsx', 'app/envios/page.tsx'] },
  { method: 'GET', pattern: ['whatsapp', 'groups'], functions: ['listWhatsAppGroups'], callsites: ['app/campanhas/page.tsx', 'app/envios/page.tsx'] },
  { method: 'PATCH', pattern: ['whatsapp', 'groups', '*', 'admin'], functions: ['updateOperationalGroup'], callsites: ['components/groups-management.tsx', 'components/operational-admin-panel.tsx', 'components/whatsapp-instances-management.tsx'] },
  { method: 'GET', pattern: ['whatsapp', 'instances'], functions: ['listOperationalInstances'], callsites: ['components/operational-admin-panel.tsx'] },
  { method: 'POST', pattern: ['whatsapp', 'instances'], functions: ['createOperationalInstance'], callsites: ['components/operational-admin-panel.tsx', 'components/whatsapp-instances-management.tsx'] },
  { method: 'PATCH', pattern: ['whatsapp', 'instances', '*'], functions: ['updateOperationalInstance'], callsites: ['components/operational-admin-panel.tsx', 'components/whatsapp-instances-management.tsx'] },
  { method: 'GET', pattern: ['coupons'], functions: ['listCoupons'], callsites: ['app/cupons/page.tsx'] },
  { method: 'GET', pattern: ['commercial-publications', 'manual', 'options'], functions: ['getManualPublicationOptions'], callsites: ['app/produtos/[id]/page.tsx'] },
  { method: 'GET', pattern: ['commercial-publications', 'manual', '*'], functions: ['getManualPublication'], callsites: ['app/produtos/[id]/page.tsx'] },
  { method: 'POST', pattern: ['commercial-publications', 'manual'], functions: ['createManualPublication'], callsites: ['app/produtos/[id]/page.tsx'] },
];

const matchesPath = (path: readonly string[], pattern: PathPattern) =>
  path.length === pattern.length &&
  pattern.every((segment, index) => segment === '*' || segment === path[index]);

const isSafePathSegment = (segment: string) =>
  segment.length > 0 && segment !== '.' && segment !== '..' && !segment.includes('\\');

export const isDashboardProxyPathAllowed = (method: string, path: readonly string[]) => {
  if (!path.every(isSafePathSegment)) return false;
  return DASHBOARD_PROXY_CONTRACTS.some(
    (contract) => contract.method === method && matchesPath(path, contract.pattern),
  );
};
