import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@shopee-auto-affiliate-ai/shared';
import { buildApp } from '../src/app';
import { buildAuthenticatedTestApp } from './authenticated-test-app';

const apps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

const request = {
  id: 'manual-request-1',
  idempotencyKey: 'idem-1',
  payloadHash: 'hash-1',
  productId: 'official-product-1',
  requestedSnapshotId: 'snapshot-1',
  requestedSnapshotRevision: 3,
  requestedSnapshotFingerprint: 'snapshot-fingerprint',
  contractVersion: 'phase17-manual-v1',
  status: 'PARTIAL' as const,
  createdAt: new Date('2026-08-25T18:00:00.000Z'),
  updatedAt: new Date('2026-08-25T18:01:00.000Z'),
  completedAt: null,
  product: {
    id: 'official-product-1',
    name: 'Produto oficial',
    source: 'OFFICIAL',
  },
  targets: [],
};

const serializedRequest = {
  ...request,
  createdAt: request.createdAt.toISOString(),
  updatedAt: request.updatedAt.toISOString(),
};

const options = {
  product: {
    id: 'official-product-1',
    name: 'Produto oficial',
    source: 'OFFICIAL',
    price: '99.90',
    affiliateLinkPresent: true,
    available: true,
    snapshot: {
      id: 'snapshot-1',
      revision: 3,
      fingerprint: 'snapshot-fingerprint',
      capturedAt: new Date('2026-08-25T17:59:00.000Z'),
    },
  },
  candidate: { available: true, copyReady: true },
  groups: [
    {
      destinationId: 'group-1',
      displayName: 'Grupo permitido',
      fingerprint: 'grp_fingerprint',
      campaignId: 'campaign-1',
      assignedInstanceName: 'instance-1',
      eligible: true,
      blockers: [],
      copyStatus: 'READY' as const,
      draftPreview: null,
    },
  ],
};

const serializedOptions = {
  ...options,
  product: {
    ...options.product,
    snapshot: options.product.snapshot
      ? {
          ...options.product.snapshot,
          capturedAt: options.product.snapshot.capturedAt.toISOString(),
        }
      : null,
  },
};

const setup = async () => {
  const getOptions = vi.fn().mockResolvedValue(options);
  const create = vi.fn().mockResolvedValue({ created: true, request });
  const find = vi.fn().mockResolvedValue(request);
  const manualPublicationService = { getOptions, create, find };
  const app = await buildAuthenticatedTestApp({
    logger: false,
    prisma: {} as never,
    manualPublicationService,
  });
  apps.push(app);
  return { app, getOptions, create, find };
};

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('Manual publication API', () => {
  it('returns read-only options for an authenticated product', async () => {
    const { app, getOptions } = await setup();
    const response = await app.inject({
      method: 'GET',
      url: '/commercial-publications/manual/options?productId=official-product-1',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(serializedOptions);
    expect(getOptions).toHaveBeenCalledWith('official-product-1');
  });

  it('creates a request only through the exact manual payload', async () => {
    const { app, create } = await setup();
    const payload = {
      idempotencyKey: 'idem-1',
      productId: 'official-product-1',
      destinationIds: ['group-1'],
      confirm: 'ENVIAR_PUBLICACAO_MANUAL',
    };
    const response = await app.inject({
      method: 'POST',
      url: '/commercial-publications/manual',
      payload,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual(serializedRequest);
    expect(create).toHaveBeenCalledWith(payload);
  });

  it('rejects an extra field before the service and exposes status read-only', async () => {
    const { app, create, find } = await setup();
    const invalid = await app.inject({
      method: 'POST',
      url: '/commercial-publications/manual',
      payload: {
        idempotencyKey: 'idem-1',
        productId: 'official-product-1',
        destinationIds: ['group-1'],
        confirm: 'ENVIAR_PUBLICACAO_MANUAL',
        sendNow: true,
      },
    });
    const status = await app.inject({
      method: 'GET',
      url: '/commercial-publications/manual/manual-request-1',
    });

    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error).toBe('MANUAL_PUBLICATION_INVALID');
    expect(create).not.toHaveBeenCalled();
    expect(status.statusCode).toBe(200);
    expect(status.json()).toEqual(serializedRequest);
    expect(find).toHaveBeenCalledWith('manual-request-1');
  });

  it('maps sanitized service errors to the public contract', async () => {
    const { app } = await setup();
    const service = {
      getOptions: vi.fn().mockRejectedValue(new AppError('Produto ausente', 'OFFER_NOT_FOUND')),
      create: vi.fn(),
      find: vi.fn(),
    };
    await app.close();
    apps.splice(apps.indexOf(app), 1);
    const replacement = await buildAuthenticatedTestApp({
      logger: false,
      prisma: {} as never,
      manualPublicationService: service,
    });
    apps.push(replacement);

    const response = await replacement.inject({
      method: 'GET',
      url: '/commercial-publications/manual/options?productId=missing',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: 'OFFER_NOT_FOUND',
      message: 'Produto ausente',
    });
  });

  it('keeps the route behind the existing local auth guard', async () => {
    const getOptions = vi.fn();
    const create = vi.fn();
    const find = vi.fn();
    const app = await buildApp({
      logger: false,
      localApiAuthToken: 'local-api-test-token',
      prisma: {} as never,
      manualPublicationService: {
        getOptions,
        create,
        find,
      },
    });
    apps.push(app);

    const responses = await Promise.all([
      app.inject({
        method: 'GET',
        url: '/commercial-publications/manual/options?productId=official-product-1',
      }),
      app.inject({
        method: 'POST',
        url: '/commercial-publications/manual',
        payload: {
          idempotencyKey: 'idem-1',
          productId: 'official-product-1',
          destinationIds: ['group-1'],
          confirm: 'ENVIAR_PUBLICACAO_MANUAL',
        },
      }),
      app.inject({
        method: 'GET',
        url: '/commercial-publications/manual/manual-request-1',
      }),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([401, 401, 401]);
    expect(getOptions).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
  });
});
