import {
  AppError,
  COMMERCIAL_DAILY_LIMIT_MAX,
} from '@shopee-auto-affiliate-ai/shared';

import type {
  CommercialGroupCampaignCreateData,
  CommercialGroupCampaignRecord,
  CommercialGroupCampaignUpdateData,
} from './repositories';

const CREATE_FIELDS = new Set([
  'name',
  'groupDestinationId',
  'nicheId',
  'cadenceMinutes',
  'timezone',
  'allowedStartTime',
  'allowedEndTime',
  'dailyLimit',
  'queueTargetSize',
  'dedupeDays',
]);
const PATCH_FIELDS = new Set([
  'name',
  'nicheId',
  'cadenceMinutes',
  'timezone',
  'allowedStartTime',
  'allowedEndTime',
  'dailyLimit',
  'queueTargetSize',
  'dedupeDays',
]);
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

const invalid = (
  message: string,
  code = 'COMMERCIAL_GROUP_CAMPAIGN_INVALID',
): never => {
  throw new AppError(message, code);
};

const recordInput = (input: unknown) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return invalid('Body da campanha comercial e invalido');
  }
  return input as Record<string, unknown>;
};

const strictFields = (
  input: Record<string, unknown>,
  allowed: ReadonlySet<string>,
) => {
  if (Object.keys(input).some((field) => !allowed.has(field))) {
    invalid('O body da campanha contem campos nao permitidos');
  }
};

const normalizedName = (value: unknown) => {
  if (typeof value !== 'string') return invalid('Nome da campanha e invalido');
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 80) {
    invalid('Nome da campanha deve ter entre 2 e 80 caracteres');
  }
  return name;
};

const internalId = (value: unknown, field: string) => {
  if (typeof value !== 'string' || !value.trim()) {
    return invalid(`${field} e obrigatorio`);
  }
  return value.trim();
};

const integerInRange = (
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
) => {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    return invalid(`${field} e invalido`);
  }
  return value;
};

const normalizedTimezone = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim()) {
    return invalid('Timezone IANA e obrigatoria');
  }
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: value.trim(),
    }).resolvedOptions().timeZone;
  } catch {
    return invalid('Timezone IANA e invalida');
  }
};

const timeInMinutes = (value: unknown, field: string) => {
  if (typeof value !== 'string') return invalid(`${field} e invalido`);
  const match = TIME_PATTERN.exec(value);
  if (!match) return invalid(`${field} deve usar HH:mm`);
  return {
    value,
    minutes: Number(match[1]) * 60 + Number(match[2]),
  };
};

export const commercialCampaignSlotCount = ({
  allowedStartTime,
  allowedEndTime,
  cadenceMinutes,
}: {
  allowedStartTime: string;
  allowedEndTime: string;
  cadenceMinutes: number;
}) => {
  integerInRange(cadenceMinutes, 'cadenceMinutes', 5, 180);
  const start = timeInMinutes(allowedStartTime, 'allowedStartTime');
  const end = timeInMinutes(allowedEndTime, 'allowedEndTime');
  if (start.minutes >= end.minutes) {
    return invalid('allowedStartTime deve ser anterior a allowedEndTime');
  }
  return Math.floor((end.minutes - start.minutes) / cadenceMinutes);
};

const normalizeConfiguration = (input: Record<string, unknown>) => {
  const cadenceMinutes = integerInRange(
    input.cadenceMinutes,
    'cadenceMinutes',
    5,
    180,
  );
  const start = timeInMinutes(input.allowedStartTime, 'allowedStartTime');
  const end = timeInMinutes(input.allowedEndTime, 'allowedEndTime');
  if (start.minutes >= end.minutes) {
    invalid('allowedStartTime deve ser anterior a allowedEndTime');
  }
  const dailyLimit = integerInRange(
    input.dailyLimit,
    'dailyLimit',
    1,
    COMMERCIAL_DAILY_LIMIT_MAX,
  );
  const slotCount = Math.floor((end.minutes - start.minutes) / cadenceMinutes);
  if (dailyLimit > slotCount) {
    invalid(
      'dailyLimit excede os slots teoricos da janela',
      'COMMERCIAL_GROUP_CAMPAIGN_DAILY_LIMIT_EXCEEDS_SLOTS',
    );
  }
  return {
    cadenceMinutes,
    timezone: normalizedTimezone(input.timezone),
    allowedStartTime: start.value,
    allowedEndTime: end.value,
    dailyLimit,
    queueTargetSize: integerInRange(
      input.queueTargetSize,
      'queueTargetSize',
      1,
      200,
    ),
    dedupeDays: integerInRange(input.dedupeDays, 'dedupeDays', 1, 365),
  };
};

export const parseCommercialGroupCampaignCreate = (
  input: unknown,
): CommercialGroupCampaignCreateData => {
  const record = recordInput(input);
  strictFields(record, CREATE_FIELDS);
  return {
    name: normalizedName(record.name),
    groupDestinationId: internalId(
      record.groupDestinationId,
      'groupDestinationId',
    ),
    nicheId: internalId(record.nicheId, 'nicheId'),
    ...normalizeConfiguration({
      ...record,
      cadenceMinutes: record.cadenceMinutes ?? 15,
      timezone: record.timezone ?? 'America/Sao_Paulo',
      allowedStartTime: record.allowedStartTime ?? '07:00',
      allowedEndTime: record.allowedEndTime ?? '22:00',
      dailyLimit: record.dailyLimit ?? 60,
      queueTargetSize: record.queueTargetSize ?? 40,
      dedupeDays: record.dedupeDays ?? 30,
    }),
  };
};

export const parseCommercialGroupCampaignPatch = (
  existing: CommercialGroupCampaignRecord,
  input: unknown,
): CommercialGroupCampaignUpdateData => {
  const record = recordInput(input);
  strictFields(record, PATCH_FIELDS);
  if (Object.keys(record).length === 0) {
    return invalid('PATCH da campanha esta vazio');
  }
  const normalized = {
    name: normalizedName(record.name ?? existing.name),
    nicheId: internalId(record.nicheId ?? existing.nicheId, 'nicheId'),
    ...normalizeConfiguration({ ...existing, ...record }),
  };
  return Object.fromEntries(
    Object.keys(record).map((field) => [
      field,
      normalized[field as keyof typeof normalized],
    ]),
  );
};
