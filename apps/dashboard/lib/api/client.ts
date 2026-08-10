import type { ApiErrorPayload } from './types';

export const DEFAULT_API_URL = 'http://localhost:3333';
const DEFAULT_TIMEOUT_MS = 8000;

export class DashboardApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'DashboardApiError';
  }
}

export const getApiBaseUrl = () => {
  if (typeof window !== 'undefined') return '/api';

  return (process.env.NEXT_PUBLIC_API_URL?.trim() || DEFAULT_API_URL).replace(
    /\/$/,
    '',
  );
};

type RequestOptions = Omit<RequestInit, 'body'> & {
  body?: unknown;
  timeoutMs?: number;
};

const parseResponse = async (response: Response) => {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    const text = await response.text();
    if (!response.ok) {
      throw new DashboardApiError(
        text || 'A API retornou uma resposta inesperada.',
        response.status,
      );
    }
    return text;
  }

  const data = (await response.json()) as unknown;
  if (!response.ok) {
    const payload = data as ApiErrorPayload;
    throw new DashboardApiError(
      payload.message || 'A API retornou um erro.',
      response.status,
      payload.error,
    );
  }
  return data;
};

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  try {
    const response = await fetch(`${getApiBaseUrl()}${path}`, {
      ...options,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      headers: {
        Accept: 'application/json',
        ...(options.body === undefined
          ? {}
          : { 'Content-Type': 'application/json' }),
        ...options.headers,
      },
      signal: controller.signal,
    });
    return (await parseResponse(response)) as T;
  } catch (error) {
    if (error instanceof DashboardApiError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new DashboardApiError(
        'A API demorou para responder. Tente novamente em instantes.',
      );
    }
    throw new DashboardApiError(
      'Nao foi possivel conectar a API. Verifique se ela esta em execucao.',
    );
  } finally {
    window.clearTimeout(timeout);
  }
}

