import { AppError } from '@shopee-auto-affiliate-ai/shared';

import {
  parseCommercialGroupCampaignCreate,
  parseCommercialGroupCampaignPatch,
} from './commercial-group-campaign-domain';
import type {
  CommercialGroupCampaignFilters,
  CommercialGroupCampaignRecord,
  CommercialGroupCampaignRepository,
  CommercialNicheRepository,
} from './repositories';

export type CommercialGroupCampaignPublic = Omit<
  CommercialGroupCampaignRecord,
  | 'attemptExecutionId'
  | 'attemptReservedAt'
  | 'attemptLeaseExpiresAt'
  | 'createdAt'
  | 'updatedAt'
> & { createdAt: string; updatedAt: string };

const notFound = (): never => {
  throw new AppError(
    'Campanha comercial nao encontrada',
    'COMMERCIAL_GROUP_CAMPAIGN_NOT_FOUND',
  );
};

const parseConfirmation = (input: unknown) => {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).length !== 1 ||
    (input as Record<string, unknown>).confirm !== 'ATIVAR_CAMPANHA'
  ) {
    throw new AppError(
      'Confirmacao de ativacao invalida',
      'COMMERCIAL_GROUP_CAMPAIGN_CONFIRMATION_REQUIRED',
    );
  }
};

const parseEmptyBody = (input: unknown) => {
  if (
    input !== undefined &&
    (input === null ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).length > 0)
  ) {
    throw new AppError(
      'A desativacao nao aceita campos',
      'COMMERCIAL_GROUP_CAMPAIGN_INVALID',
    );
  }
};

export const toCommercialGroupCampaignPublic = (
  campaign: CommercialGroupCampaignRecord,
): CommercialGroupCampaignPublic => {
  const {
    attemptExecutionId: _attemptExecutionId,
    attemptReservedAt: _attemptReservedAt,
    attemptLeaseExpiresAt: _attemptLeaseExpiresAt,
    createdAt,
    updatedAt,
    id,
    name,
    logicalGroupFingerprint,
    anchorDestinationId,
    nicheId,
    active,
    cadenceMinutes,
    timezone,
    allowedStartTime,
    allowedEndTime,
    dailyLimit,
    failureCount,
    nextEligibleAt,
    queueTargetSize,
    dedupeDays,
    niche,
    anchorDestination,
  } = campaign;
  void _attemptExecutionId;
  void _attemptReservedAt;
  void _attemptLeaseExpiresAt;

  return {
    id,
    name,
    logicalGroupFingerprint,
    anchorDestinationId,
    nicheId,
    active,
    cadenceMinutes,
    timezone,
    allowedStartTime,
    allowedEndTime,
    dailyLimit,
    failureCount,
    nextEligibleAt,
    queueTargetSize,
    dedupeDays,
    niche,
    anchorDestination,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  };
};

export class CommercialGroupCampaignService {
  constructor(
    private readonly campaigns: CommercialGroupCampaignRepository,
    private readonly niches: CommercialNicheRepository,
  ) {}

  async create(input: unknown) {
    return toCommercialGroupCampaignPublic(
      await this.campaigns.createForGroup(
        parseCommercialGroupCampaignCreate(input),
      ),
    );
  }

  async list(filters: CommercialGroupCampaignFilters) {
    const result = await this.campaigns.list(filters);
    return {
      items: result.items.map(toCommercialGroupCampaignPublic),
      page: filters.page,
      limit: filters.limit,
      total: result.total,
      totalPages: Math.max(1, Math.ceil(result.total / filters.limit)),
    };
  }

  async find(id: string) {
    const campaign = await this.campaigns.findById(id);
    if (!campaign) return notFound();
    return toCommercialGroupCampaignPublic(campaign);
  }

  async update(id: string, input: unknown) {
    const campaign = await this.campaigns.findById(id);
    if (!campaign) return notFound();
    const data = parseCommercialGroupCampaignPatch(campaign, input);
    if (data.nicheId !== undefined && data.nicheId !== campaign.nicheId) {
      const niche = await this.niches.findById(
        data.nicheId ?? campaign.nicheId,
      );
      if (!niche) {
        throw new AppError(
          'Nicho comercial nao encontrado',
          'COMMERCIAL_NICHE_NOT_FOUND',
        );
      }
      if (campaign.active && !niche.active) {
        throw new AppError(
          'Campanha ativa exige nicho ativo',
          'COMMERCIAL_GROUP_CAMPAIGN_NICHE_INACTIVE',
        );
      }
    }
    const updated = await this.campaigns.update(id, data);
    if (!updated) return notFound();
    return toCommercialGroupCampaignPublic(updated);
  }

  async activate(id: string, input: unknown) {
    parseConfirmation(input);
    const campaign = await this.campaigns.findById(id);
    if (!campaign) return notFound();
    const updated = await this.campaigns.activateIfEligible(id);
    if (!updated) return notFound();
    return toCommercialGroupCampaignPublic(updated);
  }

  async deactivate(id: string, input: unknown) {
    parseEmptyBody(input);
    const campaign = await this.campaigns.update(id, { active: false });
    if (!campaign) return notFound();
    return toCommercialGroupCampaignPublic(campaign);
  }
}
