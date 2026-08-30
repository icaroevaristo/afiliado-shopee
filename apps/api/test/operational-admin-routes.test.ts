import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildAuthenticatedTestApp } from './authenticated-test-app';
import {
  OPERATIONAL_ASSIGNMENT_CONFIRMATION,
  OPERATIONAL_CHANGE_CONFIRMATION,
  OPERATIONAL_PAUSE_CONFIRMATION,
} from '../src/operational-admin-service';

const apps: Array<Awaited<ReturnType<typeof buildAuthenticatedTestApp>>> = [];
const NOW = new Date('2026-08-28T12:00:00.000Z');

const overview = {
  generatedAt: '2026-08-28T12:00:00.000Z',
  automation: {
    paused: true,
    allowedStartTime: '08:00',
    allowedEndTime: '22:00',
    timezone: 'America/Sao_Paulo',
    minimumIntervalMinutes: 15,
    staggerMinutes: 5,
    dailyGlobalLimit: 10,
    dailyGroupLimit: 5,
    dailyGlobalLimitOverride: null,
    dailyGroupLimitOverride: null,
    dailyShopeeHttpLimit: 10,
    dailyOpenAiGenerationLimit: 10,
    dailyShopeeHttpLimitOverride: null,
    dailyOpenAiGenerationLimitOverride: null,
    providerUsage: {
      dayKey: '2026-08-28',
      shopee: { used: 0, limit: 10, reached: false },
      openAi: { used: 0, limit: 10, reached: false },
    },
    hardCaps: {
      dailyGlobalLimit: 10,
      dailyGroupLimit: 5,
      maxMessagesPerRun: 1,
    },
    scheduleRevision: 3,
    updatedAt: '2026-08-28T12:00:00.000Z',
  },
  nextSendAt: null,
  lastSendAt: null,
  blockers: [],
  queues: {
    productPipeline: { waiting: 0, active: 0, delayed: 0, prioritized: 0 },
    whatsappDispatch: { waiting: 0, active: 0, delayed: 0, prioritized: 0 },
    commercialAutomation: { waiting: 0, active: 0, delayed: 0, prioritized: 0 },
  },
  activeExecutions: 0,
  activeReservations: 0,
  ambiguity: 0,
  investigationRequired: 0,
  pendingDispatches: 0,
  pendingOutboxes: 0,
  scheduler: null,
  instances: [],
  groups: [],
  campaigns: [],
};

const setup = async () => {
  const service = {
    getOverview: vi.fn(async () => overview),
    createInstance: vi.fn(async ({ name }: { name: string }) => ({
      name,
      active: false,
      paused: false,
      createdAt: NOW,
      updatedAt: NOW,
    })),
    updateInstance: vi.fn(async ({ name }: { name: string }) => ({
      name,
      active: true,
      paused: false,
      createdAt: NOW,
      updatedAt: NOW,
    })),
    updateGroup: vi.fn(async ({ id }: { id: string }) => ({
      id,
      name: 'Grupo de teste',
      destination: 'group-test@g.us',
      type: 'GROUP' as const,
      active: true,
      paused: false,
      available: true,
      fingerprint: 'grp_aaaaaaaaaaaa',
      sourceInstanceName: 'affiliate-bot',
      assignedInstanceName: 'affiliate-bot',
      discoveredAt: NOW,
      lastSyncedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    })),
    updateAutomationSettings: vi.fn(async () => ({
      timezone: 'America/Sao_Paulo',
      allowedStartTime: '08:00',
      allowedEndTime: '22:00',
      minimumIntervalMinutes: 15,
      staggerMinutes: 5,
      scheduleRevision: 4,
    })),
  };
  const app = await buildAuthenticatedTestApp({
    logger: false,
    prisma: {} as never,
    operationalAdminService: service,
  });
  apps.push(app);
  return { app, service };
};

afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

describe('operational admin routes', () => {
  it('exposes the protected aggregate without exposing implementation details', async () => {
    const subject = await setup();
    const response = await subject.app.inject({
      method: 'GET',
      url: '/operational-admin',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(overview);
    expect(subject.service.getOverview).toHaveBeenCalledTimes(1);
  });

  it('requires strict bodies and explicit confirmations for mutations', async () => {
    const subject = await setup();

    const invalid = await subject.app.inject({
      method: 'PATCH',
      url: '/whatsapp/instances/affiliate-bot',
      payload: {
        active: true,
        expectedUpdatedAt: '2026-08-28T12:00:00.000Z',
        unexpected: true,
      },
    });
    expect(invalid.statusCode).toBe(400);
    expect(subject.service.updateInstance).not.toHaveBeenCalled();

    const created = await subject.app.inject({
      method: 'POST',
      url: '/whatsapp/instances',
      payload: {
        name: 'affiliate-bot',
        confirmation: OPERATIONAL_CHANGE_CONFIRMATION,
      },
    });
    expect(created.statusCode).toBe(201);
    expect(subject.service.createInstance).toHaveBeenCalledWith({
      name: 'affiliate-bot',
      confirmation: OPERATIONAL_CHANGE_CONFIRMATION,
    });

    const secretAttempt = await subject.app.inject({
      method: 'POST',
      url: '/whatsapp/instances',
      payload: {
        name: 'secret-instance',
        apiKey: 'must-not-be-accepted',
        confirmation: OPERATIONAL_CHANGE_CONFIRMATION,
      },
    });
    expect(secretAttempt.statusCode).toBe(400);
    expect(secretAttempt.json()).not.toHaveProperty('apiKey');
    expect(subject.service.createInstance).toHaveBeenCalledTimes(1);

    const updated = await subject.app.inject({
      method: 'PATCH',
      url: '/whatsapp/instances/affiliate-bot',
      payload: {
        paused: true,
        expectedUpdatedAt: '2026-08-28T12:00:00.000Z',
        confirmation: OPERATIONAL_PAUSE_CONFIRMATION,
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(subject.service.updateInstance).toHaveBeenCalledWith({
      name: 'affiliate-bot',
      active: undefined,
      paused: true,
      expectedUpdatedAt: '2026-08-28T12:00:00.000Z',
      confirmation: OPERATIONAL_PAUSE_CONFIRMATION,
    });
  });

  it('routes assignment and settings through their guarded service methods', async () => {
    const subject = await setup();

    const group = await subject.app.inject({
      method: 'PATCH',
      url: '/whatsapp/groups/group-1/admin',
      payload: {
        assignedInstanceName: 'affiliate-bot',
        expectedUpdatedAt: '2026-08-28T12:00:00.000Z',
        confirmation: OPERATIONAL_ASSIGNMENT_CONFIRMATION,
      },
    });
    expect(group.statusCode).toBe(200);
    expect(subject.service.updateGroup).toHaveBeenCalledWith({
      id: 'group-1',
      active: undefined,
      paused: undefined,
      assignedInstanceName: 'affiliate-bot',
      expectedUpdatedAt: '2026-08-28T12:00:00.000Z',
      confirmation: OPERATIONAL_ASSIGNMENT_CONFIRMATION,
    });

    const settings = await subject.app.inject({
      method: 'PATCH',
      url: '/commercial-automation/settings/admin',
      payload: {
        dailyGlobalLimit: 8,
        dailyShopeeHttpLimit: 7,
        dailyOpenAiGenerationLimit: 6,
        expectedRevision: 3,
        confirmation: OPERATIONAL_CHANGE_CONFIRMATION,
      },
    });
    expect(settings.statusCode).toBe(200);
    expect(subject.service.updateAutomationSettings).toHaveBeenCalledWith({
      allowedStartTime: undefined,
      allowedEndTime: undefined,
      minimumIntervalMinutes: undefined,
      staggerMinutes: undefined,
      dailyGlobalLimit: 8,
      dailyGroupLimit: undefined,
      dailyShopeeHttpLimit: 7,
      dailyOpenAiGenerationLimit: 6,
      expectedRevision: 3,
      confirmation: OPERATIONAL_CHANGE_CONFIRMATION,
    });
  });
});
