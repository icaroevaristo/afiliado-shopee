import { AppError } from '@shopee-auto-affiliate-ai/shared';

import type {
  WhatsAppGroupRecord,
  WhatsAppInstanceRepository,
} from './repositories';

export type CommercialStickyIdentity = {
  runInstanceName?: string | null;
  dispatchInstanceName?: string | null;
  outboxInstanceName?: string | null;
  jobInstanceName?: string | null;
  destinationAssignedInstanceName?: string | null;
};

const normalized = (value: string | null | undefined) => value ?? null;

export const commercialStickyIdentityValues = (
  identity: CommercialStickyIdentity,
) => [
  normalized(identity.runInstanceName),
  normalized(identity.dispatchInstanceName),
  normalized(identity.outboxInstanceName),
  normalized(identity.jobInstanceName),
  ...(identity.destinationAssignedInstanceName !== undefined
    ? [normalized(identity.destinationAssignedInstanceName)]
    : []),
];

export const isLegacyCommercialStickyIdentity = (
  identity: CommercialStickyIdentity,
) => commercialStickyIdentityValues(identity).every((value) => value === null);

export const assertCommercialStickyIdentity = (
  identity: CommercialStickyIdentity,
  options: { allowLegacyFullNull?: boolean } = {},
) => {
  const values = commercialStickyIdentityValues(identity);
  const hasNull = values.some((value) => value === null);
  const hasValue = values.some((value) => value !== null);
  if (hasNull && hasValue) {
    throw new AppError(
      'Identidade sticky da instancia comercial esta incompleta ou divergente',
      'COMMERCIAL_INSTANCE_LIFECYCLE_MISMATCH',
    );
  }
  if (!hasValue && options.allowLegacyFullNull !== false) {
    return null;
  }
  if (!hasValue || new Set(values).size !== 1) {
    throw new AppError(
      'Identidade sticky da instancia comercial esta incompleta ou divergente',
      'COMMERCIAL_INSTANCE_LIFECYCLE_MISMATCH',
    );
  }
  return values[0];
};

export const requireAssignedInstanceName = (
  group: Pick<WhatsAppGroupRecord, 'assignedInstanceName'>,
) => {
  if (
    typeof group.assignedInstanceName !== 'string' ||
    group.assignedInstanceName.trim() === ''
  ) {
    throw new AppError(
      'Grupo comercial nao possui instancia atribuida',
      'COMMERCIAL_INSTANCE_ASSIGNMENT_REQUIRED',
    );
  }
  return group.assignedInstanceName;
};

export const assertActiveCommercialInstance = async (
  instances: Pick<WhatsAppInstanceRepository, 'findByName'> | undefined,
  instanceName: string,
) => {
  const instance = await instances?.findByName(instanceName);
  if (!instance || !instance.active) {
    throw new AppError(
      'Instancia do lifecycle comercial esta ausente ou inativa',
      'COMMERCIAL_INSTANCE_INACTIVE',
    );
  }
  return instance;
};

export const filterExecutableCommercialGroups = async (
  groups: readonly WhatsAppGroupRecord[],
  instances: Pick<WhatsAppInstanceRepository, 'findByName'> | undefined,
) => {
  const assigned = groups.filter(
    (group) =>
      typeof group.assignedInstanceName === 'string' &&
      group.assignedInstanceName.trim() !== '',
  );
  if (!instances) return [];
  const activeNames = new Set<string>();
  const names = [...new Set(assigned.map((group) => group.assignedInstanceName!))];
  const records = await Promise.all(
    names.map((name) => instances.findByName(name)),
  );
  names.forEach((name, index) => {
    if (records[index]?.active === true) activeNames.add(name);
  });
  return assigned.filter((group) => activeNames.has(group.assignedInstanceName!));
};
