import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPrismaClient } from '@shopee-auto-affiliate-ai/database';
import { fingerprintWhatsAppGroupId } from '@shopee-auto-affiliate-ai/providers';

import {
  PrismaWhatsAppDispatchRepository,
  PrismaWhatsAppGroupDirectoryRepository,
} from '../src/prisma-repositories';
import { SenderService } from '../src/sender-service';
import { WhatsAppGroupSendPolicy } from '../src/whatsapp-group-send-policy';

const enabled = process.env.RUN_ROUTING_ASSIGNMENT_DB_TEST === 'true';
const describeDatabase = enabled ? describe.sequential : describe.skip;
const PREFIX = 'phase23-routing-lock';
const INSTANCE_A = `${PREFIX}-instance-a`;
const INSTANCE_B = `${PREFIX}-instance-b`;

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const databaseUrlWithApplicationName = (name: string) => {
  const raw = process.env.DATABASE_URL;
  if (!raw && enabled) {
    throw new Error('DATABASE_URL is required for the isolated test');
  }
  if (!raw) {
    return `postgresql://unused:unused@127.0.0.1:1/unused?application_name=${name}`;
  }
  const url = new URL(raw);
  url.searchParams.set('application_name', name);
  return url.toString();
};

describeDatabase('routing assignment PostgreSQL serialization', () => {
  const adminPrisma = createPrismaClient(
    databaseUrlWithApplicationName('phase23_admin'),
  );
  const senderPrisma = createPrismaClient(
    databaseUrlWithApplicationName('phase23_sender'),
  );
  const observerPrisma = createPrismaClient(
    databaseUrlWithApplicationName('phase23_observer'),
  );
  const adminRepository = new PrismaWhatsAppGroupDirectoryRepository(
    adminPrisma,
  );
  const senderRepository = new PrismaWhatsAppDispatchRepository(senderPrisma);

  const createFixture = async (name: string, withDispatch = true) => {
    const productId = `${PREFIX}-${name}-product`;
    const copyId = `${PREFIX}-${name}-copy`;
    const destinationId = `${PREFIX}-${name}-destination`;
    const dispatchId = `${PREFIX}-${name}-dispatch`;
    const externalGroupId = `120363${Array.from(name)
      .map((character) => character.charCodeAt(0).toString().padStart(3, '0'))
      .join('')}@g.us`;
    await adminPrisma.productLead.create({
      data: {
        id: productId,
        source: 'OFFICIAL',
        providerProductId: `${PREFIX}-${name}-provider`,
        nome: 'Produto fixture',
        categoria: 'fixture',
        preco: 10,
        desconto: 0,
        nota: 5,
        vendidos: 1,
        comissao: 1,
        loja: 'Loja fixture',
        urlImagem: 'https://example.invalid/image',
        affiliateLink: 'https://example.invalid/affiliate',
        title: 'Produto fixture',
      },
    });
    await adminPrisma.generatedCopy.create({
      data: {
        id: copyId,
        productId,
        titulo: 'Oferta',
        mensagem: 'Mensagem segura',
        cta: 'Confira',
        hashtags: '#Oferta',
      },
    });
    const destination = await adminPrisma.whatsAppDestination.create({
      data: {
        id: destinationId,
        name: `Grupo ${name}`,
        destination: externalGroupId,
        type: 'GROUP',
        active: true,
        paused: false,
        available: true,
        fingerprint: fingerprintWhatsAppGroupId(externalGroupId),
        sourceInstanceName: INSTANCE_A,
        assignedInstanceName: INSTANCE_A,
      },
    });
    if (withDispatch) {
      await adminPrisma.whatsAppDispatch.create({
        data: {
          id: dispatchId,
          productId,
          generatedCopyId: copyId,
          destinationId,
          instanceName: INSTANCE_A,
          status: 'PENDING',
        },
      });
    }
    return { productId, copyId, destinationId, dispatchId, destination };
  };

  const waitForLock = async (applicationName: string) => {
    await vi.waitFor(
      async () => {
        const rows = await observerPrisma.$queryRaw<
          Array<{ waitEventType: string | null }>
        >`
          SELECT "wait_event_type" AS "waitEventType"
          FROM pg_stat_activity
          WHERE application_name = ${applicationName}
            AND state = 'active'
        `;
        expect(rows.some((row) => row.waitEventType === 'Lock')).toBe(true);
      },
      { timeout: 5_000, interval: 20 },
    );
  };

  beforeAll(async () => {
    await adminPrisma.whatsAppInstance.createMany({
      data: [
        { name: INSTANCE_A, active: true },
        { name: INSTANCE_B, active: true },
      ],
      skipDuplicates: true,
    });
  });

  afterAll(async () => {
    await adminPrisma.whatsAppDispatch.deleteMany({
      where: { id: { startsWith: PREFIX } },
    });
    await adminPrisma.generatedCopy.deleteMany({
      where: { id: { startsWith: PREFIX } },
    });
    await adminPrisma.whatsAppDestination.deleteMany({
      where: { id: { startsWith: PREFIX } },
    });
    await adminPrisma.productLead.deleteMany({
      where: { id: { startsWith: PREFIX } },
    });
    await adminPrisma.whatsAppInstance.deleteMany({
      where: { name: { in: [INSTANCE_A, INSTANCE_B] } },
    });
    await Promise.all([
      adminPrisma.$disconnect(),
      senderPrisma.$disconnect(),
      observerPrisma.$disconnect(),
    ]);
  });

  it('ADMIN_WINS: sender observa o novo assignment e nao adquire o dispatch', async () => {
    const fixture = await createFixture('admin-wins', false);
    const update = await adminRepository.updateAdministrativeWithLifecycleGuard(
      fixture.destinationId,
      {
        assignedInstanceName: INSTANCE_B,
        expectedUpdatedAt: fixture.destination.updatedAt,
        now: new Date(),
      },
    );
    expect(update).toMatchObject({ kind: 'UPDATED' });
    await adminPrisma.whatsAppDispatch.create({
      data: {
        id: fixture.dispatchId,
        productId: fixture.productId,
        generatedCopyId: fixture.copyId,
        destinationId: fixture.destinationId,
        instanceName: INSTANCE_A,
        status: 'PENDING',
      },
    });

    await expect(
      senderRepository.claimPendingForSending(fixture.dispatchId, INSTANCE_A),
    ).resolves.toEqual({ kind: 'STICKY_INSTANCE_MISMATCH' });
    await expect(
      adminPrisma.whatsAppDispatch.findUnique({
        where: { id: fixture.dispatchId },
        select: { status: true, attemptCount: true },
      }),
    ).resolves.toEqual({ status: 'FAILED', attemptCount: 0 });
  });

  it('SENDER_WINS: PROCESSING impede reassignment depois do claim', async () => {
    const fixture = await createFixture('sender-wins');
    await expect(
      senderRepository.claimPendingForSending(fixture.dispatchId, INSTANCE_A),
    ).resolves.toEqual({ kind: 'CLAIMED' });

    await expect(
      adminRepository.updateAdministrativeWithLifecycleGuard(
        fixture.destinationId,
        {
          assignedInstanceName: INSTANCE_B,
          expectedUpdatedAt: fixture.destination.updatedAt,
          now: new Date(),
        },
      ),
    ).resolves.toEqual({ kind: 'ACTIVE_LIFECYCLE' });
  });

  it('sender espera o lock administrativo e falha sticky depois do commit A para B', async () => {
    const fixture = await createFixture('sender-waits');
    const locked = deferred();
    const release = deferred();
    const adminTransaction = adminPrisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id" FROM "WhatsAppDestination"
        WHERE "id" = ${fixture.destinationId}
        FOR UPDATE
      `;
      await transaction.whatsAppDestination.update({
        where: { id: fixture.destinationId },
        data: { assignedInstanceName: INSTANCE_B },
      });
      locked.resolve();
      await release.promise;
    });
    await locked.promise;
    const claim = senderRepository.claimPendingForSending(
      fixture.dispatchId,
      INSTANCE_A,
    );
    await waitForLock('phase23_sender');
    release.resolve();
    await adminTransaction;
    await expect(claim).resolves.toEqual({
      kind: 'STICKY_INSTANCE_MISMATCH',
    });
  });

  it('admin espera o sender PROCESSING e reavalia lifecycle apos o commit', async () => {
    const fixture = await createFixture('admin-waits');
    const locked = deferred();
    const release = deferred();
    const senderTransaction = senderPrisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id" FROM "WhatsAppDestination"
        WHERE "id" = ${fixture.destinationId}
        FOR UPDATE
      `;
      await transaction.whatsAppDispatch.update({
        where: { id: fixture.dispatchId },
        data: { status: 'PROCESSING', attemptCount: 1 },
      });
      locked.resolve();
      await release.promise;
    });
    await locked.promise;
    const update = adminRepository.updateAdministrativeWithLifecycleGuard(
      fixture.destinationId,
      {
        assignedInstanceName: INSTANCE_B,
        expectedUpdatedAt: fixture.destination.updatedAt,
        now: new Date(),
      },
    );
    await waitForLock('phase23_admin');
    release.resolve();
    await senderTransaction;
    await expect(update).resolves.toEqual({ kind: 'ACTIVE_LIFECYCLE' });
  });

  it('preserva stale expectedUpdatedAt e permite reassignment normal sem lifecycle', async () => {
    const stale = await createFixture('stale', false);
    await expect(
      adminRepository.updateAdministrativeWithLifecycleGuard(
        stale.destinationId,
        {
          assignedInstanceName: INSTANCE_B,
          expectedUpdatedAt: new Date(
            stale.destination.updatedAt.getTime() - 1,
          ),
          now: new Date(),
        },
      ),
    ).resolves.toEqual({ kind: 'CAS_CONFLICT' });

    const normal = await createFixture('normal', false);
    await expect(
      adminRepository.updateAdministrativeWithLifecycleGuard(
        normal.destinationId,
        {
          assignedInstanceName: INSTANCE_B,
          expectedUpdatedAt: normal.destination.updatedAt,
          now: new Date(),
        },
      ),
    ).resolves.toMatchObject({
      kind: 'UPDATED',
      group: { assignedInstanceName: INSTANCE_B },
    });
  });

  it('libera o row lock antes do provider fake', async () => {
    const fixture = await createFixture('provider-lock');
    const providerEntered = deferred();
    const releaseProvider = deferred();
    const provider = {
      sendMessage: vi.fn(async () => {
        providerEntered.resolve();
        await releaseProvider.promise;
        return {
          status: 'sent' as const,
          externalMessageId: 'fake-external-id',
          sentAt: new Date(),
        };
      }),
    };
    const sender = new SenderService({
      dispatches: senderRepository,
      provider,
      logger: { info: vi.fn(), error: vi.fn() },
      instanceName: INSTANCE_A,
      groupSendPolicy: new WhatsAppGroupSendPolicy({
        enabled: true,
        safeMode: true,
        instanceName: INSTANCE_A,
      }),
    });
    const sending = sender.sendDispatch(fixture.dispatchId);
    await providerEntered.promise;
    await expect(
      observerPrisma.$transaction(
        async (transaction) =>
          transaction.$queryRaw`
          SELECT "id" FROM "WhatsAppDestination"
          WHERE "id" = ${fixture.destinationId}
          FOR UPDATE NOWAIT
        `,
      ),
    ).resolves.toBeDefined();
    releaseProvider.resolve();
    await expect(sending).resolves.toMatchObject({ status: 'SENT' });
    expect(provider.sendMessage).toHaveBeenCalledOnce();
  });
});
