import { describe, expect, it } from 'vitest';
import {
  sanitizeDispatchDestination,
  sanitizeDispatchForCommonUi,
} from '../src/app';

describe('sanitizeDispatchDestination', () => {
  it('substitui o JID de grupo pelo fingerprint e omite a instancia interna', () => {
    const serialized = sanitizeDispatchDestination({
      destination: '100000000000000000@g.us',
      type: 'GROUP',
      active: true,
      available: true,
      fingerprint: 'grp_123456789abc',
      sourceInstanceName: 'private-instance',
    });

    expect(serialized).toEqual({
      type: 'GROUP',
      active: true,
      available: true,
      fingerprint: 'grp_123456789abc',
      destination: 'grp_123456789abc',
    });
    expect(JSON.stringify(serialized)).not.toContain('@g.us');
    expect(JSON.stringify(serialized)).not.toContain('private-instance');
  });

  it('mantem a resposta individual mascarada', () => {
    expect(
      sanitizeDispatchDestination({
        destination: '5511999999999',
        type: 'INDIVIDUAL',
        active: true,
        available: true,
        fingerprint: null,
        sourceInstanceName: null,
      }).destination,
    ).toBe('*********9999');
  });

  it('omite externalMessageId da resposta comum de dispatch', () => {
    const serialized = sanitizeDispatchForCommonUi({
      id: 'dispatch-1',
      externalMessageId: 'provider-message-id-private',
      destination: {
        destination: '100000000000000000@g.us',
        type: 'GROUP' as const,
        fingerprint: 'grp_123456789abc',
      },
    });

    expect(serialized).not.toHaveProperty('externalMessageId');
    expect(JSON.stringify(serialized)).not.toContain('provider-message-id-private');
  });
});
