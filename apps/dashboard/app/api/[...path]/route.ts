const DEFAULT_API_SERVER_URL = 'http://127.0.0.1:3333';

const getApiServerUrl = () =>
  (
    process.env.DASHBOARD_API_URL?.trim() ||
    process.env.API_SERVER_URL?.trim() ||
    DEFAULT_API_SERVER_URL
  ).replace(/\/$/, '');

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

const proxyRequest = async (request: Request, context: RouteContext) => {
  const { path } = await context.params;
  const upstreamPath = path.map((segment) => encodeURIComponent(segment)).join('/');
  const requestUrl = new URL(request.url);
  const upstreamUrl = `${getApiServerUrl()}/${upstreamPath}${requestUrl.search}`;
  const headers = new Headers();

  const accept = request.headers.get('accept');
  const contentType = request.headers.get('content-type');
  if (accept) headers.set('accept', accept);
  if (contentType) headers.set('content-type', contentType);

  const body = ['GET', 'HEAD'].includes(request.method)
    ? undefined
    : await request.arrayBuffer();

  const response = await fetch(upstreamUrl, {
    method: request.method,
    headers,
    body,
    cache: 'no-store',
  });
  const responseHeaders = new Headers();
  const responseContentType = response.headers.get('content-type');
  if (responseContentType) responseHeaders.set('content-type', responseContentType);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
};

export const GET = proxyRequest;
export const POST = proxyRequest;
export const PATCH = proxyRequest;
export const PUT = proxyRequest;
export const DELETE = proxyRequest;
