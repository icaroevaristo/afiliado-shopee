import {
  fingerprintWhatsAppGroupId,
  normalizeWhatsAppGroupId,
} from '@shopee-auto-affiliate-ai/providers';
import { AppError } from '@shopee-auto-affiliate-ai/shared';

import type { WhatsAppDispatchDetails } from './repositories';
import { isCommercialInstanceAssigned } from './commercial-instance-stickiness';

export type WhatsAppGroupSendPolicyOptions = {
  enabled: boolean;
  safeMode: boolean;
  instanceName?: string;
};

export class WhatsAppGroupSendPolicy {
  constructor(private readonly options: WhatsAppGroupSendPolicyOptions) {}

  assertAuthorized(
    destination: WhatsAppDispatchDetails['destination'],
    expectedInstanceName?: string,
  ) {
    if (destination.type !== 'GROUP') return;
    const externalGroupId = normalizeWhatsAppGroupId(destination.destination);
    const fingerprint = fingerprintWhatsAppGroupId(externalGroupId);

    const block = (message: string, code: string): never => {
      throw new AppError(message, code);
    };
    if (!this.options.enabled) {
      block(
        'Envio para grupos esta desativado',
        'WHATSAPP_GROUP_SEND_DISABLED',
      );
    }
    if (!this.options.safeMode) {
      block(
        'Safe mode e obrigatorio para envio em grupos',
        'WHATSAPP_GROUP_SAFE_MODE_REQUIRED',
      );
    }
    if (!destination.available) {
      block('Grupo indisponivel para envio', 'WHATSAPP_GROUP_UNAVAILABLE');
    }
    if (!destination.active) {
      block('Grupo nao autorizado para envio', 'WHATSAPP_GROUP_NOT_AUTHORIZED');
    }
    if (destination.paused === true) {
      block('Grupo pausado para operacao', 'WHATSAPP_GROUP_PAUSED');
    }
    const instanceName = expectedInstanceName ?? this.options.instanceName;
    const assignmentMatches =
      destination.assignedInstanceNames !== undefined
        ? isCommercialInstanceAssigned(destination, instanceName ?? '')
        : (destination.assignedInstanceName ??
            destination.sourceInstanceName) === instanceName;
    if (
      !instanceName ||
      !assignmentMatches
    ) {
      block(
        'Grupo nao pertence a instancia atual',
        'WHATSAPP_GROUP_INSTANCE_MISMATCH',
      );
    }
    if (destination.fingerprint !== fingerprint) {
      block(
        'Identidade do grupo nao corresponde ao cadastro',
        'WHATSAPP_GROUP_IDENTITY_MISMATCH',
      );
    }
  }
}
