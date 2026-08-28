import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiRequestMock = vi.fn();

vi.mock('./client', () => ({
  apiRequest: (...args: unknown[]) => apiRequestMock(...args),
}));

import {
  createOperationalInstance,
  getOperationalAdmin,
  updateOperationalAutomation,
  updateOperationalGroup,
  updateOperationalInstance,
} from './operational-admin';

beforeEach(() => apiRequestMock.mockReset().mockResolvedValue({}));

describe('operational admin dashboard API', () => {
  it('uses the read-only aggregate endpoint', async () => {
    await getOperationalAdmin();
    expect(apiRequestMock).toHaveBeenCalledWith('/operational-admin', {
      method: 'GET',
    });
  });

  it('keeps instance mutations strict and encoded', async () => {
    await createOperationalInstance(
      'affiliate bot',
      'CONFIRMAR_ALTERACAO_OPERACIONAL',
    );
    await updateOperationalInstance('affiliate/bot', {
      paused: true,
      expectedUpdatedAt: '2026-08-28T12:00:00.000Z',
      confirmation: 'CONFIRMAR_PAUSA_OPERACIONAL',
    });

    expect(apiRequestMock).toHaveBeenNthCalledWith(1, '/whatsapp/instances', {
      method: 'POST',
      body: {
        name: 'affiliate bot',
        confirmation: 'CONFIRMAR_ALTERACAO_OPERACIONAL',
      },
    });
    expect(apiRequestMock).toHaveBeenNthCalledWith(
      2,
      '/whatsapp/instances/affiliate%2Fbot',
      {
        method: 'PATCH',
        body: {
          paused: true,
          expectedUpdatedAt: '2026-08-28T12:00:00.000Z',
          confirmation: 'CONFIRMAR_PAUSA_OPERACIONAL',
        },
      },
    );
  });

  it('routes assignment and settings through the guarded endpoints', async () => {
    await updateOperationalGroup('group/1', {
      assignedInstanceName: null,
      expectedUpdatedAt: '2026-08-28T12:00:00.000Z',
      confirmation: 'CONFIRMAR_REATRIBUICAO_GRUPO',
    });
    await updateOperationalAutomation({
      dailyGlobalLimit: 8,
      expectedRevision: 3,
      confirmation: 'CONFIRMAR_ALTERACAO_OPERACIONAL',
    });

    expect(apiRequestMock).toHaveBeenNthCalledWith(
      1,
      '/whatsapp/groups/group%2F1/admin',
      {
        method: 'PATCH',
        body: {
          assignedInstanceName: null,
          expectedUpdatedAt: '2026-08-28T12:00:00.000Z',
          confirmation: 'CONFIRMAR_REATRIBUICAO_GRUPO',
        },
      },
    );
    expect(apiRequestMock).toHaveBeenNthCalledWith(
      2,
      '/commercial-automation/settings/admin',
      {
        method: 'PATCH',
        body: {
          dailyGlobalLimit: 8,
          expectedRevision: 3,
          confirmation: 'CONFIRMAR_ALTERACAO_OPERACIONAL',
        },
      },
    );
  });
});
