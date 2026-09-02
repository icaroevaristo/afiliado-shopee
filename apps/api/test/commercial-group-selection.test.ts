import { describe, expect, it } from 'vitest';

import {
  duplicateLogicalGroupFingerprints,
  isCommercialAssignedGroup,
  isCommercialAuthorizedGroup,
} from '../src/commercial-group-selection';
import {
  assertCommercialStickyIdentity,
  getOrderedAssignedInstanceNames,
  isCommercialInstanceAssigned,
} from '../src/commercial-instance-stickiness';
import type { WhatsAppGroupRecord } from '../src/repositories';

const NOW = new Date('2026-08-16T12:00:00.000Z');
const INSTANCE = 'affiliate-bot';

const group = (
  overrides: Partial<WhatsAppGroupRecord> = {},
): WhatsAppGroupRecord => ({
  id: 'group-1',
  name: 'Mesmo nome visivel',
  destination: '120363000000000000@g.us',
  active: true,
  type: 'GROUP',
  available: true,
  fingerprint: 'grp_aaaaaaaaaaaa',
  sourceInstanceName: INSTANCE,
  discoveredAt: NOW,
  lastSyncedAt: NOW,
  ...overrides,
});

describe('commercial group selection identity', () => {
  it('autoriza somente GROUP ativo, disponivel, da instancia e com fingerprint valido', () => {
    expect(isCommercialAuthorizedGroup(group(), INSTANCE)).toBe(true);
    expect(
      isCommercialAuthorizedGroup(
        group({ assignedInstanceName: null }),
        INSTANCE,
      ),
    ).toBe(true);
    expect(
      isCommercialAuthorizedGroup(group({ active: false }), INSTANCE),
    ).toBe(false);
    expect(
      isCommercialAuthorizedGroup(group({ available: false }), INSTANCE),
    ).toBe(false);
    expect(
      isCommercialAuthorizedGroup(
        group({ sourceInstanceName: 'other-instance' }),
        INSTANCE,
      ),
    ).toBe(false);
    expect(
      isCommercialAuthorizedGroup(group({ fingerprint: 'invalid' }), INSTANCE),
    ).toBe(false);
  });

  it('nao usa nome como identidade e detecta ambiguidade somente pela fingerprint logica', () => {
    const first = group();
    const sameNameOtherLogicalGroup = group({
      id: 'group-2',
      destination: '120363000000000001@g.us',
      fingerprint: 'grp_bbbbbbbbbbbb',
    });
    expect(
      duplicateLogicalGroupFingerprints([first, sameNameOtherLogicalGroup]),
    ).toEqual([]);

    const renamedDuplicate = group({
      id: 'group-3',
      name: 'Outro nome',
      destination: '120363000000000002@g.us',
    });
    expect(
      duplicateLogicalGroupFingerprints([first, renamedDuplicate]),
    ).toEqual(['grp_aaaaaaaaaaaa']);
  });

  it('preserva lifecycle legado full-null mesmo com assignment migrado no destino', () => {
    expect(
      assertCommercialStickyIdentity({
        runInstanceName: null,
        dispatchInstanceName: null,
        outboxInstanceName: null,
        jobInstanceName: null,
        destinationAssignedInstanceName: 'instance-a',
      }),
    ).toBeNull();
  });

  it('aceita apenas membros da lista ordenada de assignment', () => {
    const rotating = group({
      assignedInstanceName: 'instance-a',
      assignedInstanceNames: ['instance-a', 'instance-b'],
    });

    expect(getOrderedAssignedInstanceNames(rotating)).toEqual([
      'instance-a',
      'instance-b',
    ]);
    expect(isCommercialInstanceAssigned(rotating, 'instance-a')).toBe(true);
    expect(isCommercialInstanceAssigned(rotating, 'instance-b')).toBe(true);
    expect(isCommercialInstanceAssigned(rotating, 'instance-c')).toBe(false);
    expect(isCommercialAssignedGroup(rotating, 'instance-b')).toBe(true);
  });

  it('aceita lifecycle vinculado ao segundo membro sem confundir o primary legado', () => {
    expect(
      assertCommercialStickyIdentity({
        runInstanceName: 'instance-b',
        dispatchInstanceName: 'instance-b',
        outboxInstanceName: 'instance-b',
        jobInstanceName: 'instance-b',
        destinationAssignedInstanceName: 'instance-a',
        destinationAssignedInstanceNames: ['instance-a', 'instance-b'],
      }),
    ).toBe('instance-b');
  });

  it('aceita lifecycle ordenado sem job durante a fase de outbox pendente', () => {
    expect(
      assertCommercialStickyIdentity(
        {
          runInstanceName: 'instance-b',
          dispatchInstanceName: 'instance-b',
          outboxInstanceName: 'instance-b',
          destinationAssignedInstanceName: 'instance-a',
          destinationAssignedInstanceNames: ['instance-a', 'instance-b'],
        },
        { allowMissingJob: true },
      ),
    ).toBe('instance-b');
  });

  it('falha fechado quando assignment legado diverge da lista ordenada', () => {
    const inconsistent = group({
      assignedInstanceName: 'instance-c',
      assignedInstanceNames: ['instance-a', 'instance-b'],
    });

    expect(isCommercialInstanceAssigned(inconsistent, 'instance-a')).toBe(
      false,
    );
    expect(isCommercialAssignedGroup(inconsistent, 'instance-a')).toBe(false);
  });
});
