import React, { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { change, click, render } from '../../test/render';
import CampaignsPage from './page';

const listCampaignsMock = vi.fn();
const listGroupsMock = vi.fn();
const updateCampaignMock = vi.fn();
const activateCampaignMock = vi.fn();
const deactivateCampaignMock = vi.fn();

vi.mock('../../lib/api', () => ({
  listCommercialCampaigns: (...args: unknown[]) => listCampaignsMock(...args),
  listWhatsAppGroups: (...args: unknown[]) => listGroupsMock(...args),
  updateCommercialCampaign: (...args: unknown[]) => updateCampaignMock(...args),
  activateCommercialCampaign: (...args: unknown[]) => activateCampaignMock(...args),
  deactivateCommercialCampaign: (...args: unknown[]) => deactivateCampaignMock(...args),
}));

const campaign = {
  id: 'campaign-1',
  name: 'Campanha A',
  logicalGroupFingerprint: 'fingerprint-a',
  anchorDestinationId: 'group-1',
  nicheId: 'niche-1',
  active: true,
  cadenceMinutes: 15,
  timezone: 'America/Sao_Paulo',
  allowedStartTime: '08:00',
  allowedEndTime: '20:00',
  dailyLimit: 10,
  failureCount: 0,
  nextEligibleAt: null,
  queueTargetSize: 20,
  dedupeDays: 30,
  niche: { id: 'niche-1', name: 'Audio' },
  anchorDestination: { id: 'group-1', name: 'Grupo A' },
  createdAt: '2026-08-24T10:00:00.000Z',
  updatedAt: '2026-08-24T10:00:00.000Z',
};

const group = {
  id: 'group-1',
  name: 'Grupo A',
  fingerprint: 'fingerprint-a',
  active: true,
  available: true,
  memberCount: 10,
  lastSyncedAt: '2026-08-24T10:00:00.000Z',
};

beforeEach(() => {
  listCampaignsMock.mockReset().mockResolvedValue({
    items: [campaign],
    page: 1,
    limit: 50,
    total: 1,
    totalPages: 1,
  });
  listGroupsMock.mockReset().mockResolvedValue([group]);
  updateCampaignMock.mockReset().mockResolvedValue({
    ...campaign,
    cadenceMinutes: 30,
    allowedEndTime: '21:00',
  });
  activateCampaignMock.mockReset().mockResolvedValue({ ...campaign, active: true });
  deactivateCampaignMock.mockReset().mockResolvedValue({ ...campaign, active: false });
  vi.stubGlobal('confirm', vi.fn(() => true));
});

describe('CampaignsPage', () => {
  it('edita cadencia e janela sem alterar autorizacao do grupo', async () => {
    const screen = await render(<CampaignsPage />);
    await act(async () => undefined);

    const inputs = Array.from(screen.container.querySelectorAll('input'));
    await change(inputs[0], '30');
    await change(inputs[2], '21:00');
    const save = Array.from(screen.container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Salvar agenda da campanha'),
    );
    expect(save).toBeDefined();
    await click(save as HTMLButtonElement);

    expect(updateCampaignMock).toHaveBeenCalledWith('campaign-1', {
      cadenceMinutes: 30,
      allowedStartTime: '08:00',
      allowedEndTime: '21:00',
      dailyLimit: 10,
    });
    expect(screen.container.textContent).toContain('Grupo A');
    await screen.unmount();
  });

  it('confirma e alterna uma campanha ativa sem reiniciar a página', async () => {
    const screen = await render(<CampaignsPage />);
    await act(async () => undefined);

    const deactivate = Array.from(screen.container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Desativar campanha'),
    );
    expect(deactivate).toBeDefined();
    await click(deactivate as HTMLButtonElement);

    expect(deactivateCampaignMock).toHaveBeenCalledWith('campaign-1');
    expect(screen.container.textContent).toContain('INATIVA');
    expect(screen.container.textContent).toContain('Ativar campanha');

    const activate = Array.from(screen.container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Ativar campanha'),
    );
    await click(activate as HTMLButtonElement);

    expect(activateCampaignMock).toHaveBeenCalledWith('campaign-1');
    expect(screen.container.textContent).toContain('ATIVA');
    await screen.unmount();
  });

  it('não chama a API quando a confirmação humana é cancelada', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    const screen = await render(<CampaignsPage />);
    await act(async () => undefined);

    const deactivate = Array.from(screen.container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Desativar campanha'),
    );
    await click(deactivate as HTMLButtonElement);

    expect(deactivateCampaignMock).not.toHaveBeenCalled();
    expect(screen.container.textContent).toContain('ATIVA');
    await screen.unmount();
  });

  it('expõe o teto técnico da janela sem esconder o limite efetivo', async () => {
    const screen = await render(<CampaignsPage />);
    await act(async () => undefined);

    expect(screen.container.textContent).toContain('Limite configurado10');
    expect(screen.container.textContent).toContain('Teto teórico da janela48');
    expect(screen.container.textContent).toContain('Limite efetivo10');
    const dailyLimitInput = Array.from(screen.container.querySelectorAll('input')).find(
      (input) => input.getAttribute('type') === 'number' && input.getAttribute('max') === '1000000',
    );
    expect(dailyLimitInput).toBeDefined();
    await screen.unmount();
  });
});
