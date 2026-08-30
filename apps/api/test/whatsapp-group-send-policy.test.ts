import { describe, expect, it, vi } from 'vitest';
import {
  fingerprintWhatsAppGroupId,
  MockWhatsAppProvider,
} from '@shopee-auto-affiliate-ai/providers';

import { SenderService } from '../src/sender-service';
import type { WhatsAppDispatchDetails } from '../src/repositories';
import { WhatsAppGroupSendPolicy } from '../src/whatsapp-group-send-policy';

const GROUP_ID = '100000000000000000@g.us';
const FINGERPRINT = fingerprintWhatsAppGroupId(GROUP_ID);
const INSTANCE = 'test-instance';

const groupDestination = (
  overrides: Partial<WhatsAppDispatchDetails['destination']> = {},
): WhatsAppDispatchDetails['destination'] => ({
  destination: GROUP_ID,
  type: 'GROUP',
  active: true,
  available: true,
  fingerprint: FINGERPRINT,
  sourceInstanceName: INSTANCE,
  assignedInstanceName: INSTANCE,
  ...overrides,
});

const enabledPolicy = () =>
  new WhatsAppGroupSendPolicy({
    enabled: true,
    safeMode: true,
    instanceName: INSTANCE,
  });

describe('WhatsAppGroupSendPolicy', () => {
  it('nao altera a autorizacao de destinos individuais', () => {
    expect(() =>
      new WhatsAppGroupSendPolicy({
        enabled: false,
        safeMode: false,
      }).assertAuthorized({
        destination: '1000000000000',
        type: 'INDIVIDUAL',
        active: true,
      }),
    ).not.toThrow();
  });

  it.each([
    [
      { enabled: false, safeMode: true, instanceName: INSTANCE },
      {},
      'WHATSAPP_GROUP_SEND_DISABLED',
    ],
    [
      { enabled: true, safeMode: false, instanceName: INSTANCE },
      {},
      'WHATSAPP_GROUP_SAFE_MODE_REQUIRED',
    ],
    [
      { enabled: true, safeMode: true, instanceName: INSTANCE },
      { active: false },
      'WHATSAPP_GROUP_NOT_AUTHORIZED',
    ],
    [
      { enabled: true, safeMode: true, instanceName: INSTANCE },
      { available: false },
      'WHATSAPP_GROUP_UNAVAILABLE',
    ],
    [
      { enabled: true, safeMode: true, instanceName: 'other-instance' },
      {},
      'WHATSAPP_GROUP_INSTANCE_MISMATCH',
    ],
    [
      { enabled: true, safeMode: true, instanceName: INSTANCE },
      { fingerprint: 'grp_wrong000000' },
      'WHATSAPP_GROUP_IDENTITY_MISMATCH',
    ],
  ] as const)('bloqueia antes do HTTP: %s', (options, overrides, code) => {
    expect(() =>
      new WhatsAppGroupSendPolicy(options).assertAuthorized(
        groupDestination(overrides),
      ),
    ).toThrowError(expect.objectContaining({ code }));
  });

  it('aceita somente grupo ativo, disponivel, atual e com identidade exata', () => {
    expect(() =>
      enabledPolicy().assertAuthorized(groupDestination()),
    ).not.toThrow();
  });

  it('nao inclui JID completo em mensagens de erro', () => {
    try {
      new WhatsAppGroupSendPolicy({
        enabled: false,
        safeMode: true,
        instanceName: INSTANCE,
      }).assertAuthorized(groupDestination());
    } catch (error) {
      expect(String(error)).not.toContain(GROUP_ID);
    }
  });
});

describe('SenderService com grupo', () => {
  const dispatch = {
    id: 'dispatch-group-test',
    productId: 'product-test',
    generatedCopyId: 'copy-test',
    destinationId: 'group-test',
    instanceName: INSTANCE,
    generatedCopy: {
      titulo: 'Teste',
      mensagem: 'Mensagem',
      cta: '',
      hashtags: '',
    },
    destination: groupDestination(),
    status: 'PENDING',
  };

  it('informa GROUP ao provider depois da politica autorizar', async () => {
    const provider = new MockWhatsAppProvider();
    const dispatches = {
      findByIdForSending: vi.fn(async () => dispatch),
      markAttemptPending: vi.fn(async () => true),
      claimPendingForSending: vi.fn(async () => ({ kind: 'CLAIMED' as const })),
      markSent: vi.fn(async () => ({ ...dispatch, status: 'SENT' })),
      markFailed: vi.fn(),
    };
    const sender = new SenderService({
      dispatches: dispatches as never,
      provider,
      groupSendPolicy: enabledPolicy(),
      logger: { info: vi.fn(), error: vi.fn() },
    });
    await sender.sendDispatch(dispatch.id);
    expect(provider.sentMessages).toEqual([
      {
        destination: GROUP_ID,
        message: 'Teste\n\nMensagem',
        destinationType: 'GROUP',
      },
    ]);
  });

  it('bloqueia sem incrementar tentativa nem chamar provider', async () => {
    const provider = new MockWhatsAppProvider();
    const markAttemptPending = vi.fn();
    const sender = new SenderService({
      dispatches: {
        findByIdForSending: vi.fn(async () => dispatch),
        markAttemptPending,
      } as never,
      provider,
      groupSendPolicy: new WhatsAppGroupSendPolicy({
        enabled: false,
        safeMode: true,
        instanceName: INSTANCE,
      }),
      logger: { info: vi.fn(), error: vi.fn() },
    });
    await expect(sender.sendDispatch(dispatch.id)).rejects.toMatchObject({
      code: 'WHATSAPP_GROUP_SEND_DISABLED',
    });
    expect(markAttemptPending).not.toHaveBeenCalled();
    expect(provider.sentMessages).toHaveLength(0);
  });
});
