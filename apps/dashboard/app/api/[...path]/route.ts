type RouteContext = {
  params: Promise<{ path: string[] }>;
};

type PathPattern = readonly string[];

const READ_PATHS: readonly PathPattern[] = [
  ['health'],
  ['analytics'],
  ['scheduler'],
  ['commercial-automation', 'status'],
  ['commercial-automation', 'scheduler'],
  ['commercial-automation', 'settings'],
  ['commercial-automation', 'schedule', 'preview'],
  ['commercial-automation', 'executions'],
  ['commercial-automation', 'outbox'],
  ['commercial', 'campaigns'],
  ['commercial', 'campaigns', '*', 'queue'],
  ['commercial', 'niches'],
  ['commercial', 'niches', '*'],
  ['commercial-pipeline', 'runs'],
  ['coupons'],
  ['pipeline', 'jobs', '*'],
  ['shopee', 'offers'],
  ['shopee', 'offers', '*'],
  ['whatsapp', 'destinations'],
  ['whatsapp', 'dispatches'],
  ['whatsapp', 'dispatches', '*'],
  ['whatsapp', 'groups'],
  ['whatsapp', 'groups', 'admin'],
  ['whatsapp', 'instances'],
  ['operational-admin'],
  ['commercial-publications', 'manual', 'options'],
  ['commercial-publications', 'manual', '*'],
];

const PATCH_PATHS: readonly PathPattern[] = [
  ['commercial-automation', 'settings'],
  ['commercial-automation', 'settings', 'schedule'],
  ['commercial', 'campaigns', '*'],
  ['commercial', 'niches', '*'],
  ['whatsapp', 'groups', '*', 'admin'],
  ['whatsapp', 'instances', '*'],
  ['commercial-automation', 'settings', 'admin'],
];

const POST_PATHS: readonly PathPattern[] = [
  ['commercial-publications', 'manual'],
  ['shopee', 'offers', '*', 'copy-preview'],
  ['whatsapp', 'instances'],
  ['commercial', 'campaigns'],
  ['commercial', 'campaigns', '*', 'activate'],
  ['commercial', 'campaigns', '*', 'deactivate'],
  ['commercial', 'niches'],
  ['commercial', 'niches', 'preview'],
];

const matchesPath = (path: readonly string[], pattern: PathPattern) =>
  path.length === pattern.length &&
  pattern.every((segment, index) => segment === '*' || segment === path[index]);

const isAllowedPath = (method: string, path: readonly string[]) => {
  if (method === 'GET')
    return READ_PATHS.some((pattern) => matchesPath(path, pattern));
  if (method === 'PATCH')
    return PATCH_PATHS.some((pattern) => matchesPath(path, pattern));
  if (method === 'POST')
    return POST_PATHS.some((pattern) => matchesPath(path, pattern));
  return false;
};

const blockedResponse = () =>
  Response.json(
    {
      error: 'DASHBOARD_ROUTE_NOT_ALLOWED',
      message: 'Este caminho nao esta disponivel no Operations Console.',
    },
    { status: 404 },
  );

const getApiServerUrl = () => {
  const rawUrl = process.env.DASHBOARD_API_URL?.trim();
  if (!rawUrl) throw new Error('DASHBOARD_API_TARGET_NOT_CONFIGURED');

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('DASHBOARD_API_TARGET_INVALID');
  }

  const localHosts = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    !localHosts.has(parsed.hostname) ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error('DASHBOARD_API_TARGET_INVALID');
  }

  return rawUrl.replace(/\/$/, '');
};

const getApiAuthorization = () => {
  const token = process.env.LOCAL_API_AUTH_TOKEN?.trim();
  if (!token) throw new Error('DASHBOARD_API_AUTH_NOT_CONFIGURED');
  return `Bearer ${token}`;
};

const isApiHealth = (
  value: unknown,
): value is { status: 'ok'; service: 'api' } =>
  typeof value === 'object' &&
  value !== null &&
  'status' in value &&
  'service' in value &&
  value.status === 'ok' &&
  value.service === 'api';

const assertApiServer = async (apiServerUrl: string) => {
  let healthResponse: Response;
  try {
    healthResponse = await fetch(`${apiServerUrl}/health`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
  } catch {
    throw new Error('DASHBOARD_API_TARGET_UNAVAILABLE');
  }

  if (!healthResponse.ok) {
    throw new Error('DASHBOARD_API_TARGET_INCOMPATIBLE');
  }

  let health: unknown;
  try {
    health = await healthResponse.json();
  } catch {
    throw new Error('DASHBOARD_API_TARGET_INCOMPATIBLE');
  }

  if (!isApiHealth(health)) {
    throw new Error('DASHBOARD_API_TARGET_INCOMPATIBLE');
  }
};

const proxyRequest = async (request: Request, context: RouteContext) => {
  const { path } = await context.params;
  if (!isAllowedPath(request.method, path)) return blockedResponse();

  let apiServerUrl: string;
  let authorization: string;
  try {
    apiServerUrl = getApiServerUrl();
    authorization = getApiAuthorization();
    await assertApiServer(apiServerUrl);
  } catch (error) {
    const errorCode =
      error instanceof Error ? error.message : 'DASHBOARD_API_TARGET_INVALID';
    return Response.json(
      {
        error: errorCode,
        message:
          errorCode === 'DASHBOARD_API_TARGET_NOT_CONFIGURED'
            ? 'DASHBOARD_API_URL precisa ser configurada no processo do servidor.'
            : errorCode === 'DASHBOARD_API_AUTH_NOT_CONFIGURED'
              ? 'A autenticacao local da API precisa ser configurada no processo do servidor.'
              : errorCode === 'DASHBOARD_API_TARGET_INCOMPATIBLE'
                ? 'O destino local nao respondeu como a API operacional.'
                : errorCode === 'DASHBOARD_API_TARGET_UNAVAILABLE'
                  ? 'A API local configurada esta indisponivel.'
                  : 'O destino local da API nao e valido.',
      },
      { status: 503 },
    );
  }

  const upstreamPath = path
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const requestUrl = new URL(request.url);
  const upstreamUrl = `${apiServerUrl}/${upstreamPath}${requestUrl.search}`;
  const headers = new Headers();

  const accept = request.headers.get('accept');
  const contentType = request.headers.get('content-type');
  if (accept) headers.set('accept', accept);
  if (contentType) headers.set('content-type', contentType);
  headers.set('authorization', authorization);

  const body =
    request.method === 'GET' ? undefined : await request.arrayBuffer();

  let response: Response;
  try {
    response = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body,
      cache: 'no-store',
    });
  } catch {
    return Response.json(
      {
        error: 'DASHBOARD_API_UPSTREAM_UNAVAILABLE',
        message: 'A API local configurada esta indisponivel.',
      },
      { status: 503 },
    );
  }

  const responseHeaders = new Headers();
  const responseContentType = response.headers.get('content-type');
  if (responseContentType)
    responseHeaders.set('content-type', responseContentType);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
};

const rejectUnsupportedMethod = (request: Request, context: RouteContext) => {
  void request;
  void context;
  return blockedResponse();
};

export const GET = proxyRequest;
export const PATCH = proxyRequest;
export const POST = proxyRequest;
export const PUT = rejectUnsupportedMethod;
export const DELETE = rejectUnsupportedMethod;
