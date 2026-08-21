import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listCommercialLifecycles } from './commercial-lifecycle';
import { listCommercialCopyHistory } from './copy';

const response = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ items: [] })));
});

describe('commercial lifecycle API', () => {
  it('consulta somente o endpoint GET agregado', async () => {
    await listCommercialLifecycles(2, 10);

    expect(fetch).toHaveBeenCalledWith(
      '/api/commercial-automation/lifecycles?page=2&limit=10',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('consulta o historico de copies somente por GET', async () => {
    await listCommercialCopyHistory(2, 10);

    expect(fetch).toHaveBeenCalledWith(
      '/api/commercial-automation/copies?page=2&limit=10',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});
