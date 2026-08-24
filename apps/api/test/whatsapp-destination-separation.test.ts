import { describe, expect, it, vi } from 'vitest';

import {
  PrismaWhatsAppDestinationRepository,
  PrismaWhatsAppGroupDirectoryRepository,
  PrismaWhatsAppInstanceRepository,
} from '../src/prisma-repositories';

describe('separacao entre destinos individuais e grupos', () => {
  it('pipeline consulta somente destinos individuais ativos', async () => {
    const findMany = vi.fn(async () => []);
    const repository = new PrismaWhatsAppDestinationRepository({
      whatsAppDestination: { findMany },
    } as never);
    await repository.listActive();
    expect(findMany).toHaveBeenCalledWith({
      where: { active: true, type: 'INDIVIDUAL' },
    });
  });

  it('diretorio consulta somente grupos da instancia atual', async () => {
    const findMany = vi.fn(async () => []);
    const repository = new PrismaWhatsAppGroupDirectoryRepository({
      whatsAppDestination: { findMany },
    } as never);
    await repository.list('test-instance', { active: true, available: true });
    expect(findMany).toHaveBeenCalledWith({
      where: {
        type: 'GROUP',
        sourceInstanceName: 'test-instance',
        active: true,
        available: true,
      },
      orderBy: { name: 'asc' },
    });
  });

  it('persiste assignment de grupo somente para instancia existente', async () => {
    const update = vi.fn(async () => ({
      id: 'group-id',
      assignedInstanceName: 'instance-a',
    }));
    const destination = new PrismaWhatsAppDestinationRepository({
      whatsAppDestination: {
        findFirst: vi.fn(async () => ({ id: 'group-id', type: 'GROUP' })),
        update,
      },
      whatsAppInstance: {
        findUnique: vi.fn(async () => ({ name: 'instance-a' })),
      },
    } as never);

    await expect(
      destination.assignToInstance('group-id', 'instance-a'),
    ).resolves.toMatchObject({ assignedInstanceName: 'instance-a' });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'group-id' },
      data: { assignedInstanceName: 'instance-a' },
    });
  });

  it('nao atribui instancia a destino individual', async () => {
    const update = vi.fn();
    const destination = new PrismaWhatsAppDestinationRepository({
      whatsAppDestination: {
        findFirst: vi.fn(async () => ({ id: 'individual-id', type: 'INDIVIDUAL' })),
        update,
      },
      whatsAppInstance: {
        findUnique: vi.fn(async () => ({ name: 'instance-a' })),
      },
    } as never);

    await expect(
      destination.assignToInstance('individual-id', 'instance-a'),
    ).resolves.toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it('mantem o registry de instancia ativo/inativo sem acesso externo', async () => {
    const findUnique = vi.fn(async () => ({
      name: 'instance-a',
      active: true,
    }));
    const update = vi.fn(async () => ({
      name: 'instance-a',
      active: false,
    }));
    const repository = new PrismaWhatsAppInstanceRepository({
      whatsAppInstance: { findUnique, update },
    } as never);

    await expect(repository.findByName('instance-a')).resolves.toMatchObject({
      active: true,
    });
    await expect(repository.setActive('instance-a', false)).resolves.toMatchObject({
      active: false,
    });
    expect(update).toHaveBeenCalledWith({
      where: { name: 'instance-a' },
      data: { active: false },
    });
  });
});
