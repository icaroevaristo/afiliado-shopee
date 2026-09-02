import type { WhatsAppGroupRecord } from './repositories';
import { isCommercialInstanceAssigned } from './commercial-instance-stickiness';

export const COMMERCIAL_GROUP_FINGERPRINT = /^grp_[a-f0-9]{12}$/;

export const isCommercialAuthorizedGroup = (
  group: WhatsAppGroupRecord,
  instanceName: string,
) =>
  group.type === 'GROUP' &&
  group.active === true &&
  group.paused !== true &&
  group.available === true &&
  group.sourceInstanceName === instanceName &&
  (group.assignedInstanceNames === undefined &&
    (group.assignedInstanceName === undefined ||
      group.assignedInstanceName === null ||
      group.assignedInstanceName === instanceName) ||
    group.assignedInstanceNames !== undefined &&
      isCommercialInstanceAssigned(group, instanceName)) &&
  COMMERCIAL_GROUP_FINGERPRINT.test(group.fingerprint);

export const isCommercialAssignedGroup = (
  group: WhatsAppGroupRecord,
  instanceName: string,
) =>
  group.type === 'GROUP' &&
  group.active === true &&
  group.paused !== true &&
  group.available === true &&
  isCommercialInstanceAssigned(group, instanceName) &&
  COMMERCIAL_GROUP_FINGERPRINT.test(group.fingerprint);

export const duplicateLogicalGroupFingerprints = (
  groups: readonly WhatsAppGroupRecord[],
) => {
  const counts = new Map<string, number>();
  for (const group of groups) {
    counts.set(group.fingerprint, (counts.get(group.fingerprint) ?? 0) + 1);
  }
  return [...counts]
    .filter(([, count]) => count > 1)
    .map(([fingerprint]) => fingerprint)
    .sort();
};
