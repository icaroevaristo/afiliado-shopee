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
  /** Ordered assignments; the lifecycle identity must be one of these names. */
  destinationAssignedInstanceNames?: string[];
};

const normalized = (value: string | null | undefined) => value ?? null;

const normalizeOrderedAssignments = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new AppError(
      'Assignment ordenado da instancia comercial e invalido',
      'COMMERCIAL_INSTANCE_LIFECYCLE_MISMATCH',
    );
  }
  const names = value.map((name) =>
    typeof name === 'string' ? name.trim() : '',
  );
  if (
    names.some((name) => name === '') ||
    new Set(names).size !== names.length
  ) {
    throw new AppError(
      'Assignment ordenado da instancia comercial e invalido',
      'COMMERCIAL_INSTANCE_LIFECYCLE_MISMATCH',
    );
  }
  return names;
};

const commercialLifecycleIdentityValues = (
  identity: CommercialStickyIdentity,
) => [
  normalized(identity.runInstanceName),
  normalized(identity.dispatchInstanceName),
  normalized(identity.outboxInstanceName),
  normalized(identity.jobInstanceName),
];

export const commercialStickyIdentityValues = (
  identity: CommercialStickyIdentity,
) => [
  ...commercialLifecycleIdentityValues(identity),
  ...(identity.destinationAssignedInstanceName !== undefined
    ? [normalized(identity.destinationAssignedInstanceName)]
    : identity.destinationAssignedInstanceNames !== undefined
      ? [identity.destinationAssignedInstanceNames[0] ?? null]
      : []),
];

export const isLegacyCommercialStickyIdentity = (
  identity: CommercialStickyIdentity,
) =>
  commercialLifecycleIdentityValues(identity).every((value) => value === null);

export const assertCommercialStickyIdentity = (
  identity: CommercialStickyIdentity,
  options: { allowLegacyFullNull?: boolean; allowMissingJob?: boolean } = {},
) => {
  const orderedAssignments =
    identity.destinationAssignedInstanceNames === undefined
      ? undefined
      : normalizeOrderedAssignments(identity.destinationAssignedInstanceNames);
  if (orderedAssignments !== undefined) {
    if (
      identity.destinationAssignedInstanceName !== undefined &&
      identity.destinationAssignedInstanceName !== null &&
      identity.destinationAssignedInstanceName.trim() !== orderedAssignments[0]
    ) {
      throw new AppError(
        'Assignment legado diverge da lista ordenada da instancia comercial',
        'COMMERCIAL_INSTANCE_LIFECYCLE_MISMATCH',
      );
    }
  }
  const lifecycleValues =
    orderedAssignments !== undefined
      ? [
          normalized(identity.runInstanceName),
          normalized(identity.dispatchInstanceName),
          normalized(identity.outboxInstanceName),
          ...(options.allowMissingJob || identity.jobInstanceName === undefined
            ? []
            : [normalized(identity.jobInstanceName)]),
        ]
      : options.allowMissingJob
        ? [
            normalized(identity.runInstanceName),
            normalized(identity.dispatchInstanceName),
            normalized(identity.outboxInstanceName),
          ]
        : commercialLifecycleIdentityValues(identity);
  const hasLifecycleIdentity = lifecycleValues.some((value) => value !== null);
  const destinationIdentity =
    orderedAssignments === undefined &&
    identity.destinationAssignedInstanceName !== undefined
      ? normalized(identity.destinationAssignedInstanceName)
      : undefined;
  const values = hasLifecycleIdentity
    ? [
        ...lifecycleValues,
        ...(destinationIdentity !== undefined ? [destinationIdentity] : []),
      ]
    : lifecycleValues;
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
  const lifecycleIdentity = values[0];
  if (
    orderedAssignments !== undefined &&
    (typeof lifecycleIdentity !== 'string' ||
      !orderedAssignments.includes(lifecycleIdentity))
  ) {
    throw new AppError(
      'Lifecycle comercial nao pertence ao assignment ordenado persistido',
      'COMMERCIAL_INSTANCE_LIFECYCLE_MISMATCH',
    );
  }
  return lifecycleIdentity;
};

export const requireAssignedInstanceName = (
  group: Pick<
    WhatsAppGroupRecord,
    'assignedInstanceName' | 'assignedInstanceNames'
  >,
) => {
  const names = getOrderedAssignedInstanceNames(group);
  if (names.length === 0) {
    throw new AppError(
      'Grupo comercial nao possui instancia atribuida',
      'COMMERCIAL_INSTANCE_ASSIGNMENT_REQUIRED',
    );
  }
  return names[0];
};

export const getOrderedAssignedInstanceNames = (
  group: Pick<
    WhatsAppGroupRecord,
    'assignedInstanceName' | 'assignedInstanceNames'
  >,
): string[] => {
  if (group.assignedInstanceNames !== undefined) {
    if (
      !Array.isArray(group.assignedInstanceNames) ||
      group.assignedInstanceNames.length === 0
    ) {
      throw new AppError(
        'Lista ordenada de instancias do grupo e invalida',
        'COMMERCIAL_INSTANCE_ASSIGNMENT_INVALID',
      );
    }
    const names = group.assignedInstanceNames.map((name) =>
      typeof name === 'string' ? name.trim() : '',
    );
    if (
      names.some((name) => name === '') ||
      new Set(names).size !== names.length
    ) {
      throw new AppError(
        'Lista ordenada de instancias do grupo e invalida',
        'COMMERCIAL_INSTANCE_ASSIGNMENT_INVALID',
      );
    }
    if (
      typeof group.assignedInstanceName === 'string' &&
      group.assignedInstanceName.trim() !== names[0]
    ) {
      throw new AppError(
        'Assignment legado diverge da lista ordenada do grupo',
        'COMMERCIAL_INSTANCE_ASSIGNMENT_INVALID',
      );
    }
    return names;
  }
  if (
    typeof group.assignedInstanceName !== 'string' ||
    group.assignedInstanceName.trim() === ''
  ) {
    return [];
  }
  return [group.assignedInstanceName.trim()];
};

export const isCommercialInstanceAssigned = (
  group: Pick<
    WhatsAppGroupRecord,
    'assignedInstanceName' | 'assignedInstanceNames'
  >,
  instanceName: string,
) => {
  try {
    return getOrderedAssignedInstanceNames(group).includes(instanceName);
  } catch {
    return false;
  }
};

export const assertActiveCommercialInstance = async (
  instances: Pick<WhatsAppInstanceRepository, 'findByName'> | undefined,
  instanceName: string,
) => {
  const instance = await instances?.findByName(instanceName);
  if (!instance || !instance.active || instance.paused === true) {
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
  const assigned = groups.filter((group) => {
    try {
      return getOrderedAssignedInstanceNames(group).length > 0;
    } catch {
      return false;
    }
  });
  if (!instances) return [];
  const activeNames = new Set<string>();
  const names = [
    ...new Set(
      assigned.flatMap((group) => getOrderedAssignedInstanceNames(group)),
    ),
  ];
  const records = await Promise.all(
    names.map((name) => instances.findByName(name)),
  );
  names.forEach((name, index) => {
    if (records[index]?.active === true && records[index]?.paused !== true) {
      activeNames.add(name);
    }
  });
  return assigned.filter((group) =>
    getOrderedAssignedInstanceNames(group).some((name) =>
      activeNames.has(name),
    ),
  );
};
