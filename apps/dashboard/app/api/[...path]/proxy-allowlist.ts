type PathPattern = readonly string[];

const READ_PATHS: readonly PathPattern[] = [
  ['health'], ['analytics'], ['scheduler'],
  ['commercial-automation', 'status'], ['commercial-automation', 'scheduler'],
  ['commercial-automation', 'settings'], ['commercial-automation', 'schedule', 'preview'],
  ['commercial-automation', 'executions'], ['commercial-automation', 'outbox'],
  ['commercial', 'campaigns'], ['commercial', 'campaigns', '*', 'queue'],
  ['commercial', 'niches'], ['commercial', 'niches', '*'], ['commercial-pipeline', 'runs'],
  ['coupons'], ['pipeline', 'jobs', '*'], ['shopee', 'offers'], ['shopee', 'offers', '*'],
  ['whatsapp', 'destinations'], ['whatsapp', 'dispatches'], ['whatsapp', 'dispatches', '*'],
  ['whatsapp', 'groups'], ['whatsapp', 'groups', 'admin'], ['whatsapp', 'instances'],
  ['operational-admin'], ['commercial-publications', 'manual', 'options'],
  ['commercial-publications', 'manual', '*'],
];

const PATCH_PATHS: readonly PathPattern[] = [
  ['commercial-automation', 'settings'], ['commercial-automation', 'settings', 'schedule'],
  ['commercial', 'campaigns', '*'], ['commercial', 'niches', '*'],
  ['whatsapp', 'groups', '*', 'admin'], ['whatsapp', 'instances', '*'],
  ['commercial-automation', 'settings', 'admin'],
];

const POST_PATHS: readonly PathPattern[] = [
  ['commercial-publications', 'manual'], ['shopee', 'offers', '*', 'copy-preview'],
  ['whatsapp', 'instances'], ['commercial', 'campaigns'],
  ['commercial', 'campaigns', '*', 'activate'], ['commercial', 'campaigns', '*', 'deactivate'],
  ['commercial', 'niches'], ['commercial', 'niches', 'preview'],
];

const matchesPath = (path: readonly string[], pattern: PathPattern) =>
  path.length === pattern.length &&
  pattern.every((segment, index) => segment === '*' || segment === path[index]);

const isSafePathSegment = (segment: string) =>
  segment.length > 0 && segment !== '.' && segment !== '..' && !segment.includes('\\');

export const isDashboardProxyPathAllowed = (method: string, path: readonly string[]) => {
  if (!path.every(isSafePathSegment)) return false;
  if (method === 'GET') return READ_PATHS.some((pattern) => matchesPath(path, pattern));
  if (method === 'PATCH') return PATCH_PATHS.some((pattern) => matchesPath(path, pattern));
  if (method === 'POST') return POST_PATHS.some((pattern) => matchesPath(path, pattern));
  return false;
};
