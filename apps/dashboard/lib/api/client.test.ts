import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashboardApiError, apiRequest } from './client';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('apiRequest', () => {
  it('retorna JSON usando o proxy same-origin do dashboard', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:3333/');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiRequest('/health')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/health',
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it('mapeia erro HTTP com mensagem da API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: 'INVALID_PRODUCT_ID',
            message: 'productId e obrigatorio',
          }),
          {
            status: 400,
            headers: { 'content-type': 'application/json' },
          },
        ),
      ),
    );

    await expect(apiRequest('/copy/generate')).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_PRODUCT_ID',
      message: 'productId e obrigatorio',
    });
  });

  it('trata resposta nao JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('servico indisponivel', {
          status: 500,
          headers: { 'content-type': 'text/plain' },
        }),
      ),
    );

    await expect(apiRequest('/health')).rejects.toBeInstanceOf(
      DashboardApiError,
    );
  });

  it('retorna erro amigavel quando a API esta indisponivel', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('failed')));

    await expect(apiRequest('/health')).rejects.toMatchObject({
      message:
        'Nao foi possivel conectar a API. Verifique se ela esta em execucao.',
    });
  });
});

