import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activateCommercialCampaign,
  deactivateCommercialCampaign,
  listCommercialCampaignQueue,
  listCommercialCampaigns,
  updateCommercialCampaign,
} from './commercial-campaigns';

const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(() => Promise.resolve(response({ items: [] }))),
  );
});

describe('commercial campaigns API', () => {
  it('consulta campanhas com paginacao', async () => {
    await listCommercialCampaigns(2, 25);
    expect(fetch).toHaveBeenCalledWith(
      '/api/commercial/campaigns?page=2&limit=25',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('consulta fila por campanha e status sem executar mineracao', async () => {
    await listCommercialCampaignQueue('campaign/1', { page: 3, limit: 8, status: 'COPY_READY' });
    expect(fetch).toHaveBeenCalledWith(
      '/api/commercial/campaigns/campaign%2F1/queue?page=3&limit=8&status=COPY_READY',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('atualiza somente a agenda da campanha pelo endpoint existente', async () => {
    await updateCommercialCampaign('campaign/1', {
      cadenceMinutes: 30,
      allowedStartTime: '08:00',
      allowedEndTime: '22:00',
    });
    expect(fetch).toHaveBeenCalledWith(
      '/api/commercial/campaigns/campaign%2F1',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  it('usa os endpoints protegidos existentes para ativar e desativar campanha', async () => {
    await activateCommercialCampaign('campaign/1');
    expect(fetch).toHaveBeenCalledWith(
      '/api/commercial/campaigns/campaign%2F1/activate',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ confirm: 'ATIVAR_CAMPANHA' }),
      }),
    );

    vi.mocked(fetch).mockClear();
    await deactivateCommercialCampaign('campaign/1');
    expect(fetch).toHaveBeenCalledWith(
      '/api/commercial/campaigns/campaign%2F1/deactivate',
      expect.objectContaining({ method: 'POST', body: '{}' }),
    );
  });
});
