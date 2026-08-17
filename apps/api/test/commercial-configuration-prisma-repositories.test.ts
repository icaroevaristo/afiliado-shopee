import { describe, expect, it, vi } from 'vitest';
import { fingerprintWhatsAppGroupId } from '@shopee-auto-affiliate-ai/providers';

import { PrismaCommercialGroupCampaignRepository } from '../src/prisma-repositories';

const GROUP_ID = '120363000000000000@g.us';
const createData = {
  name: 'Campanha',
  groupDestinationId: 'destination-1',
  nicheId: 'niche-1',
  cadenceMinutes: 15,
  timezone: 'America/Sao_Paulo',
  allowedStartTime: '07:00',
  allowedEndTime: '22:00',
  dailyLimit: 60,
  queueTargetSize: 40,
  dedupeDays: 30,
};

describe('PrismaCommercialGroupCampaignRepository', () => {
  it('resolve e persiste a identidade logica atomicamente sem instancia', async () => {
    const fingerprint = fingerprintWhatsAppGroupId(GROUP_ID);
    const create = vi.fn(async ({ data }) => ({
      id: 'campaign-1',
      ...data,
      failureCount: 0,
      nextEligibleAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      niche: { id: 'niche-1', name: 'Nicho', slug: 'nicho', active: true },
      anchorDestination: {
        id: 'destination-1',
        name: 'Grupo',
        fingerprint,
        active: true,
        available: true,
      },
    }));
    const transaction = {
      whatsAppDestination: {
        findUnique: vi.fn(async () => ({
          id: 'destination-1',
          destination: GROUP_ID,
          type: 'GROUP',
          fingerprint,
        })),
      },
      commercialNiche: { findUnique: vi.fn(async () => ({ id: 'niche-1' })) },
      commercialGroupCampaign: { create },
    };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(transaction)),
    };
    const repository = new PrismaCommercialGroupCampaignRepository(
      prisma as never,
    );
    const result = await repository.createForGroup(createData);
    expect(result.logicalGroupFingerprint).toBe(fingerprint);
    expect(result.failureCount).toBe(0);
    expect(result.nextEligibleAt).toBeNull();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          active: false,
          logicalGroupFingerprint: fingerprint,
          anchorDestinationId: 'destination-1',
        }),
      }),
    );
    expect(JSON.stringify(create.mock.calls)).not.toContain(
      'sourceInstanceName',
    );
  });

  it('rejeita destino individual e mapeia corrida unique de forma estavel', async () => {
    const individual = new PrismaCommercialGroupCampaignRepository({
      $transaction: async (callback: (transaction: unknown) => unknown) =>
        callback({
          whatsAppDestination: {
            findUnique: async () => ({
              id: 'destination-1',
              destination: '5511999999999',
              type: 'INDIVIDUAL',
              fingerprint: null,
            }),
          },
        }),
    } as never);
    await expect(individual.createForGroup(createData)).rejects.toMatchObject({
      code: 'COMMERCIAL_GROUP_DESTINATION_REQUIRED',
    });

    const concurrent = new PrismaCommercialGroupCampaignRepository({
      $transaction: async () => Promise.reject({ code: 'P2002' }),
    } as never);
    await expect(
      Promise.all([
        concurrent.createForGroup(createData),
        concurrent.createForGroup(createData),
      ]),
    ).rejects.toMatchObject({
      code: 'COMMERCIAL_GROUP_CAMPAIGN_ALREADY_EXISTS',
    });
  });

  it('mantem o fingerprint do mesmo grupo entre instancias', () => {
    expect(fingerprintWhatsAppGroupId(GROUP_ID)).toBe(
      fingerprintWhatsAppGroupId(` ${GROUP_ID} `),
    );
  });
});
