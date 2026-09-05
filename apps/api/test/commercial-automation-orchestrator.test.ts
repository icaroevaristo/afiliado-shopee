import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@shopee-auto-affiliate-ai/shared';

import {
  COMMERCIAL_AUTOMATION_CANDIDATE_FLOW_REQUIRED,
  COMMERCIAL_AUTOMATION_OFFICIAL_PROVIDER_REQUIRED,
  CommercialAutomationOrchestrator,
} from '../src/commercial-automation-orchestrator';
import {
  CommercialAutomationCandidateFlowService,
  type CommercialAutomationCandidateAttemptReleaseResult,
  type CommercialAutomationCandidateAttemptRenewalResult,
  type CommercialAutomationCandidateAttemptReservationResult,
  type CommercialAutomationCandidateSelection,
  type CommercialAutomationCandidatePreflight,
} from '../src/commercial-automation-candidate-flow-service';
import { CommercialMessageDraftService } from '../src/commercial-message-draft-service';
import { fingerprintCommercialOffer } from '../src/commercial-offer-snapshot';
import { COMMERCIAL_EXECUTION_OWNERSHIP_LOST } from '../src/commercial-automation-execution-domain';
import {
  COMMERCIAL_EXECUTION_IN_PROGRESS,
  CommercialAutomationPolicyService,
} from '../src/commercial-automation-policy-service';
import type { CommercialPromotionMiningReport } from '../src/commercial-promotion-mining-service';
import type {
  CommercialAutomationExecutionRecord,
  CommercialAutomationExecutionRepository,
  CommercialAutomationExecutionStatus,
  CommercialAutomationTarget,
} from '../src/repositories';

const NOW = new Date('2026-07-26T15:00:00.000Z');

class MemoryExecutions implements CommercialAutomationExecutionRepository {
  records: CommercialAutomationExecutionRecord[] = [];
  lastExpectedScheduleRevision: number | undefined;
  concurrent = false;
  concurrentStale = false;
  heartbeatCalls = 0;
  loseAfterHeartbeats: number | null = null;

  async start(input: {
    schedulerJobId: string;
    bullMqJobId?: string;
    mode: 'PREVIEW' | 'SEND';
    startedAt: Date;
    ownerId: string;
    heartbeatAt: Date;
    leaseExpiresAt: Date;
    expectedScheduleRevision?: number;
  }) {
    this.lastExpectedScheduleRevision = input.expectedScheduleRevision;
    const existing = this.records.find(
      (record) => input.bullMqJobId && record.bullMqJobId === input.bullMqJobId,
    );
    if (existing) return { outcome: 'existing' as const, execution: existing };
    if (this.concurrent) {
      return {
        outcome: 'concurrent' as const,
        stale: this.concurrentStale,
      };
    }
    const execution: CommercialAutomationExecutionRecord = {
      id: `execution-${this.records.length + 1}`,
      schedulerJobId: input.schedulerJobId,
      bullMqJobId: input.bullMqJobId ?? null,
      activeKey: 'commercial-automation',
      ownerId: input.ownerId,
      heartbeatAt: input.heartbeatAt,
      leaseExpiresAt: input.leaseExpiresAt,
      mode: input.mode,
      status: 'STARTED',
      externalStage: 'NOT_REACHED',
      reasons: [],
      commercialRunId: null,
      failureCode: null,
      startedAt: input.startedAt,
      completedAt: null,
    };
    this.records.push(execution);
    return {
      outcome: 'created' as const,
      execution,
      ownership: { executionId: execution.id, ownerId: input.ownerId },
    };
  }

  async createBlocked(input: {
    schedulerJobId: string;
    bullMqJobId?: string;
    mode: 'PREVIEW' | 'SEND';
    reasons: string[];
    completedAt: Date;
  }) {
    const execution: CommercialAutomationExecutionRecord = {
      id: `execution-${this.records.length + 1}`,
      schedulerJobId: input.schedulerJobId,
      bullMqJobId: input.bullMqJobId ?? null,
      activeKey: null,
      ownerId: null,
      heartbeatAt: null,
      leaseExpiresAt: null,
      mode: input.mode,
      status: 'BLOCKED',
      externalStage: 'NOT_REACHED',
      reasons: input.reasons,
      commercialRunId: null,
      failureCode: null,
      startedAt: input.completedAt,
      completedAt: input.completedAt,
    };
    this.records.push(execution);
    return execution;
  }

  async findBySchedulerJobId(schedulerJobId: string) {
    return (
      this.records.find(
        (record) =>
          record.schedulerJobId === schedulerJobId && record.bullMqJobId === null,
      ) ?? null
    );
  }

  async heartbeat(
    ownership: { executionId: string; ownerId: string },
    input: { heartbeatAt: Date; leaseExpiresAt: Date },
  ) {
    this.heartbeatCalls += 1;
    const record = this.records.find(
      (candidate) => candidate.id === ownership.executionId,
    );
    if (
      !record ||
      record.status !== 'STARTED' ||
      record.ownerId !== ownership.ownerId ||
      !record.leaseExpiresAt ||
      record.leaseExpiresAt <= input.heartbeatAt ||
      (this.loseAfterHeartbeats !== null &&
        this.heartbeatCalls > this.loseAfterHeartbeats)
    ) {
      throw new AppError('ownership lost', COMMERCIAL_EXECUTION_OWNERSHIP_LOST);
    }
    record.heartbeatAt = input.heartbeatAt;
    record.leaseExpiresAt = input.leaseExpiresAt;
  }

  async markExternalMayHaveStarted(
    ownership: { executionId: string; ownerId: string },
    input: { markedAt: Date },
  ) {
    const record = this.records.find(
      (candidate) => candidate.id === ownership.executionId,
    );
    if (
      !record ||
      record.status !== 'STARTED' ||
      record.ownerId !== ownership.ownerId ||
      !record.leaseExpiresAt ||
      record.leaseExpiresAt <= input.markedAt
    ) {
      throw new AppError('ownership lost', COMMERCIAL_EXECUTION_OWNERSHIP_LOST);
    }
    record.externalStage = 'EXTERNAL_MAY_HAVE_STARTED';
    return record;
  }

  async finish(
    ownership: { executionId: string; ownerId: string },
    input: {
      status: Exclude<CommercialAutomationExecutionStatus, 'STARTED'>;
      reasons?: string[];
      commercialRunId?: string;
      failureCode?: string;
      completedAt: Date;
    },
  ) {
    const index = this.records.findIndex(
      (record) => record.id === ownership.executionId,
    );
    if (
      index < 0 ||
      this.records[index].ownerId !== ownership.ownerId ||
      !this.records[index].leaseExpiresAt ||
      this.records[index].leaseExpiresAt! <= input.completedAt
    ) {
      throw new AppError('ownership lost', COMMERCIAL_EXECUTION_OWNERSHIP_LOST);
    }
    this.records[index] = {
      ...this.records[index],
      ...input,
      reasons: input.reasons ?? this.records[index].reasons,
      commercialRunId:
        input.commercialRunId ?? this.records[index].commercialRunId,
      failureCode: input.failureCode ?? this.records[index].failureCode,
      activeKey: null,
    };
    return this.records[index];
  }

  async markQueuedAmbiguous(
    executionId: string,
    input: {
      commercialRunId: string;
      failureCode: string;
      completedAt: Date;
    },
  ) {
    const record = this.records.find((candidate) => candidate.id === executionId);
    if (
      !record ||
      record.status !== 'QUEUED' ||
      record.commercialRunId !== input.commercialRunId
    ) {
      throw new AppError('ownership lost', COMMERCIAL_EXECUTION_OWNERSHIP_LOST);
    }
    record.activeKey = null;
    record.status = 'AMBIGUOUS';
    record.failureCode = input.failureCode;
    record.completedAt = input.completedAt;
    return record;
  }

  async list() {
    return { items: this.records, total: this.records.length };
  }

  async findById(id: string) {
    return this.records.find((record) => record.id === id) ?? null;
  }

  async findRecoveryContext() {
    return null;
  }

  async recoverStale(): Promise<CommercialAutomationExecutionRecord> {
    throw new Error('not used');
  }
}

const createSubject = ({
  withCandidateFlow = true,
  targets,
  candidateFlowOverride,
  policyOverride,
  clock,
}: {
  withCandidateFlow?: boolean;
  targets?: CommercialAutomationTarget[];
  candidateFlowOverride?: ConstructorParameters<
    typeof CommercialAutomationOrchestrator
  >[0]['candidateFlow'];
  policyOverride?: Pick<
    CommercialAutomationPolicyService,
    'evaluateAutomationReadiness'
  >;
  clock?: () => Date;
} = {}) => {
  const resolvedTargets: CommercialAutomationTarget[] = targets ?? [
    {
      groupId: 'group-1',
      groupName: 'Grupo 1',
      logicalGroupFingerprint: 'grp_aaaaaaaaaaaa',
      campaignId: 'campaign-1',
      nicheId: 'niche-1',
      dailyLimit: 60,
    },
  ];
  const executions = new MemoryExecutions();
  const policy = {
    evaluateAutomationReadiness: vi.fn(async () => ({
      allowed: true,
      reasons: [] as string[],
    })),
  };
  const syncOffers = {
    run: vi.fn<
      (input?: { page?: number; cursor?: string }) => Promise<{
        hasNextPage?: boolean;
        page?: number;
        nextCursor?: string;
      }>
    >(async () => ({})),
  };
  const pipeline = {
    dryRun: vi.fn(async () => ({ runId: 'run-1' })),
  };
  const candidateFlow = {
    listTargets: vi.fn(async () => resolvedTargets),
    preflight: vi.fn<
      (target: CommercialAutomationTarget) => Promise<CommercialAutomationCandidatePreflight>
    >(async () => ({
      outcome: 'READY',
      candidateId: 'candidate-1',
      candidateStatus: 'COPY_READY',
    })),
    replenish: vi.fn<
      (
        target: CommercialAutomationTarget,
      ) => Promise<Pick<CommercialPromotionMiningReport, 'rejectionSummary'>>
    >(async () => ({ rejectionSummary: {} })),
    prepare: vi.fn<
      (
        selection: CommercialAutomationCandidateSelection,
        options: {
          executionId: string;
          miningReport?: Pick<
            CommercialPromotionMiningReport,
            'rejectionSummary'
          >;
        },
      ) => Promise<{
        runId: string;
        generatedCopyId: string;
        candidateId: string;
        campaignId: string;
        groupId: string;
        logicalGroupFingerprint: string;
        nicheId: string;
      }>
    >(async ({ target, candidateId }) => ({
      runId: 'run-1',
      generatedCopyId: 'ai-copy-1',
      candidateId,
      campaignId: target.campaignId,
      groupId: target.groupId,
      logicalGroupFingerprint: target.logicalGroupFingerprint,
      nicheId: target.nicheId,
    })),
    revalidate: vi.fn(async () => undefined),
    reserveAttempt: vi.fn<
      (
        target: CommercialAutomationTarget,
        input: {
          executionId: string;
          reservedAt: Date;
          leaseExpiresAt: Date;
        },
      ) => Promise<CommercialAutomationCandidateAttemptReservationResult>
    >(
      async (
        target: CommercialAutomationTarget,
        input: {
          executionId: string;
          reservedAt: Date;
          leaseExpiresAt: Date;
        },
      ) => ({
        kind: 'RESERVED' as const,
        campaignId: target.campaignId,
        executionId: input.executionId,
        reservedAt: input.reservedAt,
        leaseExpiresAt: input.leaseExpiresAt,
        acquired: true,
      }),
    ),
    releaseAttempt: vi.fn(
      async (input: {
        campaignId: string;
        executionId: string;
      }): Promise<CommercialAutomationCandidateAttemptReleaseResult> => ({
        kind: 'RELEASED',
        campaignId: input.campaignId,
        executionId: input.executionId,
        released: true,
      }),
    ),
    renewAttempt: vi.fn(async (input: {
      campaignId: string;
      executionId: string;
      renewedAt: Date;
      leaseExpiresAt: Date;
    }): Promise<CommercialAutomationCandidateAttemptRenewalResult> => ({
      kind: 'RENEWED' as const,
      campaignId: input.campaignId,
      executionId: input.executionId,
      leaseExpiresAt: input.leaseExpiresAt,
      renewed: true,
    })),
  };
  const confirmation = { confirm: vi.fn(async () => ({ status: 'queued' })) };
  const commercialRuns = {
    findById: vi.fn(
      async (): Promise<{
        finalStatus: 'AMBIGUOUS' | null;
        investigationRequired: boolean;
      }> => ({
        finalStatus: null,
        investigationRequired: false,
      }),
    ),
  };
  const logger = { info: vi.fn(), error: vi.fn() };
  const orchestrator = new CommercialAutomationOrchestrator({
    policy: policyOverride ?? (policy as never),
    syncOffers,
    pipeline: pipeline as never,
    ...(withCandidateFlow
      ? { candidateFlow: candidateFlowOverride ?? candidateFlow }
      : {}),
    confirmation: confirmation as never,
    commercialRuns: commercialRuns as never,
    executions,
    logger,
    clock: clock ?? (() => NOW),
    leaseSeconds: 120,
    heartbeatSeconds: 30,
    ownerIdFactory: () => 'owner-1',
  });
  return {
    orchestrator,
    executions,
    policy,
    syncOffers,
    pipeline,
    candidateFlow,
    confirmation,
    commercialRuns,
    logger,
  };
};

const createRealCandidateFlowForIntegration = () => {
  const groupA = {
    id: 'group-a',
    name: 'Grupo A',
    fingerprint: 'grp_aaaaaaaaaaaa',
    type: 'GROUP',
    active: true,
    available: true,
    sourceInstanceName: 'affiliate-bot',
    assignedInstanceName: 'affiliate-bot',
  };
  const groupB = {
    id: 'group-b',
    name: 'Grupo B',
    fingerprint: 'grp_bbbbbbbbbbbb',
    type: 'GROUP',
    active: true,
    available: true,
    sourceInstanceName: 'affiliate-bot',
    assignedInstanceName: 'affiliate-bot',
  };
  const campaignFor = (group: typeof groupA) => ({
    id: `campaign-${group.id.slice(-1)}`,
    logicalGroupFingerprint: group.fingerprint,
    nicheId: `niche-${group.id.slice(-1)}`,
    active: true,
    dailyLimit: 60,
    queueTargetSize: 40,
    niche: { active: true },
  });
  const contextFor = (group: typeof groupA, imageUrl: string) => {
    const suffix = group.id.slice(-1);
    const candidateId = `candidate-${suffix}`;
    const productId = `product-${suffix}`;
    const snapshotId = `snapshot-${suffix}`;
    const generatedCopyId = `copy-${suffix}`;
    const providerProductId = `provider-product-${suffix}`;
    const productLink = `https://shopee.com.br/product/1/${suffix}`;
    const affiliateLink = `https://s.shopee.com.br/affiliate-${suffix}`;
    const offerEndsAt = new Date('2026-07-27T15:00:00.000Z');
    const snapshotFingerprint = fingerprintCommercialOffer({
      source: 'OFFICIAL',
      providerProductId,
      productLink,
      affiliateLink,
      price: '99.90',
      priceMin: null,
      priceMax: null,
      discountRate: 20,
      commissionRate: 10,
      offerStartsAt: null,
      offerEndsAt,
      unavailableAt: null,
    });
    return {
      candidate: {
        id: candidateId,
        campaignId: `campaign-${suffix}`,
        productId,
        snapshotId,
        generatedCopyId,
        status: 'COPY_READY',
        expiresAt: new Date('2026-07-27T15:00:00.000Z'),
        commercialScore: 88,
        scorePolicyVersion: 'official-v2',
        minimumScoreUsed: 60,
        rankPosition: 1,
        scoreBreakdown: { policyVersion: 'official-v2' },
      },
      campaign: campaignFor(group),
      product: {
        id: productId,
        source: 'OFFICIAL',
        providerProductId,
        productName: `Produto ${suffix.toUpperCase()}`,
        shopName: `Loja ${suffix.toUpperCase()}`,
        productLink,
        affiliateLink,
        price: '99.90',
        priceMin: null,
        priceMax: null,
        discountRate: 20,
        commissionRate: 10,
        rating: 4.8,
        sales: 100,
        offerStartsAt: null,
        offerEndsAt,
        urlImagem: imageUrl,
        unavailableAt: null,
        commercialSnapshotRevision: 1,
        commercialSnapshotFingerprint: snapshotFingerprint,
      },
      snapshot: {
        id: snapshotId,
        productId,
        revision: 1,
        fingerprint: snapshotFingerprint,
        price: '99.90',
        priceMin: null,
        priceMax: null,
        discountRate: 20,
        commissionRate: 10,
        observedRating: 4.8,
        observedSales: 100,
        offerStartsAt: null,
        unavailableAt: null,
        offerEndsAt,
      },
    };
  };
  const contexts = {
    'candidate-a': contextFor(groupA, ''),
    'candidate-b': contextFor(
      groupB,
      'https://example.invalid/images/product-b.jpg',
    ),
  };
  const copies = Object.fromEntries(
    Object.values(contexts).map((context) => [
      context.candidate.id,
      {
        id: context.candidate.generatedCopyId,
        productId: context.product.id,
        snapshotId: context.snapshot.id,
        createdFromCandidateId: context.candidate.id,
        source: 'AI',
        titulo: 'Oferta selecionada',
        mensagem: context.product.affiliateLink,
        cta: '',
        hashtags: '',
      },
    ]),
  );
  const mining = { mine: vi.fn(async () => ({ rejectionSummary: {} })) };
  const copyGeneration = {
    findCopy: vi.fn(async (candidateId: keyof typeof contexts) => ({
      status: 'COPY_READY' as const,
      generatedCopyId: contexts[candidateId].candidate.generatedCopyId,
    })),
    preview: vi.fn(),
    generate: vi.fn(),
  };
  const lifecycle: string[] = [];
  const flowPipeline = {
    dryRunFromPromotionCandidate: vi.fn(
      async ({ candidate }: { candidate: { id: string } }) => {
        lifecycle.push('runs.create');
        return { runId: `run-${candidate.id}` };
      },
    ),
  };
  const service = new CommercialAutomationCandidateFlowService({
    groups: { list: vi.fn(async () => [groupA, groupB]) } as never,
    campaigns: {
      list: vi.fn(),
      findByLogicalGroupFingerprint: vi.fn(async (fingerprint: string) =>
        [groupA, groupB]
          .filter((group) => group.fingerprint === fingerprint)
          .map(campaignFor)[0] ?? null,
      ),
      reserveAttempt: vi.fn(async (input: {
        campaignId: string;
        executionId: string;
        reservedAt: Date;
        leaseExpiresAt: Date;
      }) => ({
        kind: 'RESERVED' as const,
        campaignId: input.campaignId,
        executionId: input.executionId,
        reservedAt: input.reservedAt,
        leaseExpiresAt: input.leaseExpiresAt,
        acquired: true,
      })),
      releaseAttempt: vi.fn(async (input: {
        campaignId: string;
        executionId: string;
      }) => ({
        kind: 'RELEASED' as const,
        campaignId: input.campaignId,
        executionId: input.executionId,
        released: true,
      })),
      renewAttempt: vi.fn(async (input: {
        campaignId: string;
        executionId: string;
        renewedAt: Date;
        leaseExpiresAt: Date;
      }) => ({
        kind: 'RENEWED' as const,
        campaignId: input.campaignId,
        executionId: input.executionId,
        leaseExpiresAt: input.leaseExpiresAt,
        renewed: true,
      })),
    } as never,
    candidates: {
      listQueue: vi.fn(async ({ campaignId }: { campaignId: string }) => {
        const suffix = campaignId.slice(-1);
        const candidateId = `candidate-${suffix}` as keyof typeof contexts;
        const context = contexts[candidateId];
        return {
          items: [
            {
              id: candidateId,
              productId: context.candidate.productId,
              status: 'COPY_READY',
              rankPosition: 1,
              queuedAt: NOW,
            },
          ],
          total: 1,
        };
      }),
    } as never,
    deliveryHistory: {
      wasProductSentToGroup: vi.fn(async () => false),
      findLastSentAtByGroup: vi.fn(async () => null),
    } as never,
    copies: {
      loadContext: vi.fn(async (candidateId: keyof typeof contexts) =>
        contexts[candidateId],
      ),
      findCopyForCandidate: vi.fn(async (candidateId: keyof typeof contexts) => ({
        candidate: contexts[candidateId].candidate,
        copy: copies[candidateId],
      })),
    } as never,
    mining: mining as never,
    copyGeneration: copyGeneration as never,
    draft: new CommercialMessageDraftService(),
    pipeline: flowPipeline as never,
    instances: {
      findByName: vi.fn(async () => ({
        name: 'affiliate-bot',
        active: true,
        createdAt: NOW,
        updatedAt: NOW,
      })),
    },
    instanceName: 'affiliate-bot',
    clock: () => NOW,
  });

  return { service, mining, copyGeneration, flowPipeline, lifecycle };
};

const createStatefulCrossTickCandidateFlow = () => {
  const groups = ['a', 'b', 'c'].map((suffix) => ({
    id: `group-${suffix}`,
    name: `Grupo ${suffix.toUpperCase()}`,
    fingerprint: `grp_${suffix.repeat(12)}`,
    type: 'GROUP',
    active: true,
    available: true,
    sourceInstanceName: 'affiliate-bot',
    assignedInstanceName: 'affiliate-bot',
  }));
  type CandidateState = {
    id: string;
    group: (typeof groups)[number];
    status: 'QUEUED' | 'COPY_READY' | 'DISPATCHED';
    available: boolean;
    generatedCopyId: string | null;
  };
  const candidates = new Map<string, CandidateState>([
    [
      'candidate-b',
      {
        id: 'candidate-b',
        group: groups[1],
        status: 'QUEUED',
        available: false,
        generatedCopyId: null,
      },
    ],
    [
      'candidate-c',
      {
        id: 'candidate-c',
        group: groups[2],
        status: 'COPY_READY',
        available: true,
        generatedCopyId: 'copy-c',
      },
    ],
  ]);
  const sentAtByGroup = new Map<string, Date>();
  const campaignFor = (group: (typeof groups)[number]) => ({
    id: `campaign-${group.id.slice(-1)}`,
    logicalGroupFingerprint: group.fingerprint,
    nicheId: `niche-${group.id.slice(-1)}`,
    active: true,
    dailyLimit: 60,
    queueTargetSize: 40,
    niche: { active: true },
  });
  const contextFor = (candidateId: string) => {
    const state = candidates.get(candidateId);
    if (!state) return null;
    const suffix = state.group.id.slice(-1);
    const productId = `product-${suffix}`;
    const snapshotId = `snapshot-${suffix}`;
    const providerProductId = `provider-product-${suffix}`;
    const productLink = `https://shopee.com.br/product/1/${suffix}`;
    const affiliateLink = `https://s.shopee.com.br/affiliate-${suffix}`;
    const offerEndsAt = new Date('2026-07-27T15:00:00.000Z');
    const snapshotFingerprint = fingerprintCommercialOffer({
      source: 'OFFICIAL',
      providerProductId,
      productLink,
      affiliateLink,
      price: '99.90',
      priceMin: null,
      priceMax: null,
      discountRate: 20,
      commissionRate: 10,
      offerStartsAt: null,
      offerEndsAt,
      unavailableAt: null,
    });
    return {
      candidate: {
        id: state.id,
        campaignId: `campaign-${suffix}`,
        productId,
        snapshotId,
        generatedCopyId: state.generatedCopyId,
        status: state.status,
        expiresAt: new Date('2026-07-27T15:00:00.000Z'),
        commercialScore: 88,
        scorePolicyVersion: 'official-v2',
        minimumScoreUsed: 60,
        rankPosition: 1,
        scoreBreakdown: { policyVersion: 'official-v2' },
      },
      campaign: campaignFor(state.group),
      product: {
        id: productId,
        source: 'OFFICIAL',
        providerProductId,
        productName: `Produto ${suffix.toUpperCase()}`,
        shopName: `Loja ${suffix.toUpperCase()}`,
        productLink,
        affiliateLink,
        price: '99.90',
        priceMin: null,
        priceMax: null,
        discountRate: 20,
        commissionRate: 10,
        rating: 4.8,
        sales: 100,
        offerStartsAt: null,
        offerEndsAt,
        urlImagem: `https://example.invalid/images/product-${suffix}.jpg`,
        unavailableAt: null,
        commercialSnapshotRevision: 1,
        commercialSnapshotFingerprint: snapshotFingerprint,
      },
      snapshot: {
        id: snapshotId,
        productId,
        revision: 1,
        fingerprint: snapshotFingerprint,
        price: '99.90',
        priceMin: null,
        priceMax: null,
        discountRate: 20,
        commissionRate: 10,
        observedRating: 4.8,
        observedSales: 100,
        offerStartsAt: null,
        unavailableAt: null,
        offerEndsAt,
      },
    };
  };
  const copyFor = (candidateId: string) => {
    const context = contextFor(candidateId);
    if (!context?.candidate.generatedCopyId) return null;
    return {
      id: context.candidate.generatedCopyId,
      productId: context.product.id,
      snapshotId: context.snapshot.id,
      createdFromCandidateId: candidateId,
      source: 'AI',
      titulo: 'Oferta selecionada',
      mensagem: context.product.affiliateLink,
      cta: '',
      hashtags: '',
    };
  };
  const deliveryHistory = {
    wasProductSentToGroup: vi.fn(async (productId: string, groupId: string) =>
      sentAtByGroup.has(groupId) && productId === `product-${groupId.slice(-1)}`,
    ),
    findLastSentAtByGroup: vi.fn(async (groupId: string) =>
      sentAtByGroup.get(groupId) ?? null,
    ),
  };
  const mining = {
    mine: vi.fn(async (campaignId: string) => {
      if (campaignId === 'campaign-b') {
        const candidate = candidates.get('candidate-b')!;
        candidate.available = true;
        candidate.status = 'QUEUED';
      }
      return { rejectionSummary: {} };
    }),
  };
  const copyGeneration = {
    findCopy: vi.fn(async (candidateId: string) => {
      const candidate = candidates.get(candidateId)!;
      return {
        candidateId,
        status: candidate.status,
        generatedCopyId: candidate.generatedCopyId,
      };
    }),
    preview: vi.fn(async () => ({ eligible: true, blockers: [] })),
    generate: vi.fn(async (candidateId: string) => {
      const candidate = candidates.get(candidateId)!;
      candidate.status = 'COPY_READY';
      candidate.generatedCopyId = `copy-${candidate.group.id.slice(-1)}`;
    }),
  };
  const flowPipeline = {
    dryRunFromPromotionCandidate: vi.fn(
      async ({ candidate }: { candidate: { id: string } }) => ({
        runId: `run-${candidate.id}`,
      }),
    ),
  };
  const groupRepository = { list: vi.fn(async () => groups) };
  const service = new CommercialAutomationCandidateFlowService({
    groups: groupRepository as never,
    campaigns: {
      list: vi.fn(),
      findByLogicalGroupFingerprint: vi.fn(async (fingerprint: string) =>
        groups
          .filter((group) => group.fingerprint === fingerprint)
          .map(campaignFor)[0] ?? null,
      ),
      reserveAttempt: vi.fn(async (input: {
        campaignId: string;
        executionId: string;
        reservedAt: Date;
        leaseExpiresAt: Date;
      }) => ({
        kind: 'RESERVED' as const,
        campaignId: input.campaignId,
        executionId: input.executionId,
        reservedAt: input.reservedAt,
        leaseExpiresAt: input.leaseExpiresAt,
        acquired: true,
      })),
      releaseAttempt: vi.fn(async (input: {
        campaignId: string;
        executionId: string;
      }) => ({
        kind: 'RELEASED' as const,
        campaignId: input.campaignId,
        executionId: input.executionId,
        released: true,
      })),
      renewAttempt: vi.fn(async (input: {
        campaignId: string;
        executionId: string;
        renewedAt: Date;
        leaseExpiresAt: Date;
      }) => ({
        kind: 'RENEWED' as const,
        campaignId: input.campaignId,
        executionId: input.executionId,
        leaseExpiresAt: input.leaseExpiresAt,
        renewed: true,
      })),
    } as never,
    candidates: {
      listQueue: vi.fn(async ({ campaignId }: { campaignId: string }) => {
        const items = [...candidates.values()]
          .filter(
            (candidate) =>
              candidate.available &&
              campaignId === `campaign-${candidate.group.id.slice(-1)}`,
          )
          .map((candidate) => {
            const context = contextFor(candidate.id)!;
            return {
              ...context.candidate,
              productName: context.product.productName,
              price: context.product.price,
              discountRate: 20,
              snapshotRevision: 1,
              queuedAt: NOW,
            };
          });
        return { items, total: items.length };
      }),
    } as never,
    deliveryHistory: deliveryHistory as never,
    copies: {
      loadContext: vi.fn(async (candidateId: string) => contextFor(candidateId)),
      findCopyForCandidate: vi.fn(async (candidateId: string) => {
        const context = contextFor(candidateId);
        const copy = copyFor(candidateId);
        return context && copy ? { candidate: context.candidate, copy } : null;
      }),
    } as never,
    mining: mining as never,
    copyGeneration: copyGeneration as never,
    draft: new CommercialMessageDraftService(),
    pipeline: flowPipeline as never,
    instances: {
      findByName: vi.fn(async () => ({
        name: 'affiliate-bot',
        active: true,
        createdAt: NOW,
        updatedAt: NOW,
      })),
    },
    instanceName: 'affiliate-bot',
    clock: () => NOW,
  });
  const history = {
    async getSnapshot({ groupId }: { groupId?: string }) {
      const sentAt = [...sentAtByGroup.values()].sort(
        (left, right) => right.getTime() - left.getTime(),
      )[0] ?? null;
      return {
        globalSentToday: sentAtByGroup.size,
        groupSentToday: groupId && sentAtByGroup.has(groupId) ? 1 : 0,
        lastSentAt: sentAt,
        globalLastSentAt: sentAt,
        groupLastSentAt: groupId ? sentAtByGroup.get(groupId) ?? null : null,
      };
    },
    async hasAmbiguousCommercialExecution() {
      return false;
    },
    async hasActiveCommercialExecution() {
      return false;
    },
    async hasStaleCommercialExecution() {
      return false;
    },
  };
  const policy = new CommercialAutomationPolicyService({
    settings: {
      getOrCreate: async () => ({
        paused: false,
        pausedAt: null,
        resumedAt: NOW,
        updatedAt: NOW,
      }),
    } as never,
    history: history as never,
    groups: groupRepository as never,
    instances: {
      findByName: vi.fn(async () => ({
        name: 'affiliate-bot',
        active: true,
        createdAt: NOW,
        updatedAt: NOW,
      })),
    },
    instanceName: 'affiliate-bot',
    config: {
      enabled: true,
      timezone: 'America/Sao_Paulo',
      allowedStartTime: '08:00',
      allowedEndTime: '20:00',
      dailyGlobalLimit: 2,
      dailyGroupLimit: 1,
      minimumIntervalMinutes: 60,
    },
    clock: () => NOW,
  });
  return {
    service,
    policy,
    mining,
    copyGeneration,
    flowPipeline,
    candidates,
    deliveryHistory,
    finalizeSent(candidateId: string, sentAt: Date) {
      const candidate = candidates.get(candidateId)!;
      candidate.status = 'DISPATCHED';
      sentAtByGroup.set(candidate.group.id, sentAt);
    },
  };
};

const tick = {
  schedulerJobId: 'scheduled-commercial-automation',
  bullMqJobId: 'bull-job-1',
  mode: 'preview' as const,
  provider: 'mock' as const,
};

describe('CommercialAutomationOrchestrator', () => {
  afterEach(() => vi.restoreAllMocks());

  it('cria ownership, lease e encerra o timer depois do tick', async () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const subject = createSubject();

    await subject.orchestrator.executeTick(tick);

    expect(subject.executions.records[0]).toMatchObject({
      ownerId: 'owner-1',
      heartbeatAt: NOW,
      leaseExpiresAt: new Date('2026-07-26T15:02:00.000Z'),
      activeKey: null,
    });
    expect(subject.executions.heartbeatCalls).toBe(1);
    expect(clearIntervalSpy).toHaveBeenCalled();
  });
  it('persiste EXTERNAL_MAY_HAVE_STARTED antes de syncOffers em SEND', async () => {
    const subject = createSubject();
    subject.candidateFlow.preflight
      .mockResolvedValueOnce({ outcome: 'NO_CANDIDATE' })
      .mockResolvedValueOnce({ outcome: 'NO_CANDIDATE' })
      .mockResolvedValueOnce({
        outcome: 'READY',
        candidateId: 'candidate-after-sync',
        candidateStatus: 'COPY_READY',
      });
    subject.syncOffers.run.mockImplementation(async () => {
      expect(subject.executions.records[0].externalStage).toBe(
        'EXTERNAL_MAY_HAVE_STARTED',
      );
      return { hasNextPage: false };
    });

    await subject.orchestrator.executeTick({
      ...tick,
      mode: 'send',
      provider: 'official',
    });

    expect(subject.executions.records[0].externalStage).toBe(
      'EXTERNAL_MAY_HAVE_STARTED',
    );
    expect(subject.syncOffers.run).toHaveBeenCalledOnce();
  });

  it('falha fechado antes de syncOffers quando a persistencia do marcador falha', async () => {
    const subject = createSubject();
    subject.candidateFlow.preflight.mockResolvedValue({ outcome: 'NO_CANDIDATE' });
    vi.spyOn(subject.executions, 'markExternalMayHaveStarted').mockRejectedValue(
      new Error('marker persistence failed'),
    );

    await expect(
      subject.orchestrator.executeTick({
        ...tick,
        mode: 'send',
        provider: 'official',
      }),
    ).resolves.toMatchObject({ status: 'failed' });

    expect(subject.syncOffers.run).not.toHaveBeenCalled();
    expect(subject.candidateFlow.replenish).toHaveBeenCalledOnce();
    expect(subject.candidateFlow.reserveAttempt).not.toHaveBeenCalled();
    expect(subject.candidateFlow.prepare).not.toHaveBeenCalled();
    expect(subject.executions.records[0].externalStage).toBe('NOT_REACHED');
  });
  it('registra BLOCKED e nao sincroniza nem executa pipeline quando o guardrail bloqueia', async () => {
    const subject = createSubject();
    subject.policy.evaluateAutomationReadiness.mockResolvedValue({
      allowed: false,
      reasons: ['AUTOMATION_PAUSED'],
    });

    await expect(subject.orchestrator.executeTick(tick)).resolves.toMatchObject(
      {
        status: 'blocked',
        reasons: ['AUTOMATION_PAUSED'],
        dispatchCreated: false,
        whatsappJobCreated: false,
        messageSent: false,
      },
    );
    expect(subject.syncOffers.run).not.toHaveBeenCalled();
    expect(subject.executions.records[0].externalStage).toBe('NOT_REACHED');
    expect(subject.pipeline.dryRun).not.toHaveBeenCalled();
    expect(subject.confirmation.confirm).not.toHaveBeenCalled();
  });

  it('bloqueia um segundo tick quando existe execucao concorrente', async () => {
    const subject = createSubject();
    subject.executions.concurrent = true;

    await expect(subject.orchestrator.executeTick(tick)).resolves.toMatchObject(
      {
        status: 'blocked',
        reasons: [COMMERCIAL_EXECUTION_IN_PROGRESS],
      },
    );
    expect(subject.policy.evaluateAutomationReadiness).not.toHaveBeenCalled();
  });

  it('separa concorrencia stale de execucao ativa', async () => {
    const subject = createSubject();
    subject.executions.concurrent = true;
    subject.executions.concurrentStale = true;

    await expect(subject.orchestrator.executeTick(tick)).resolves.toMatchObject(
      { reasons: ['STALE_COMMERCIAL_EXECUTION_EXISTS'] },
    );
  });

  it('executa exatamente um dry-run no modo preview sem sincronizar nem confirmar', async () => {
    const subject = createSubject();

    await expect(subject.orchestrator.executeTick(tick)).resolves.toMatchObject(
      {
        status: 'preview-ready',
        commercialRunId: 'run-1',
        dispatchCreated: false,
        whatsappJobCreated: false,
        messageSent: false,
      },
    );
    expect(subject.syncOffers.run).not.toHaveBeenCalled();
    expect(subject.executions.records[0].externalStage).toBe('NOT_REACHED');
    expect(subject.pipeline.dryRun).toHaveBeenCalledOnce();
    expect(subject.pipeline.dryRun).toHaveBeenCalledWith({
      executionId: 'execution-1',
      source: 'MOCK',
      campaign: 'commercial-automation',
      target: {
        groupId: 'group-1',
        groupName: 'Grupo 1',
        logicalGroupFingerprint: 'grp_aaaaaaaaaaaa',
        campaignId: 'campaign-1',
        nicheId: 'niche-1',
        dailyLimit: 60,
      },
    });
    expect(subject.confirmation.confirm).not.toHaveBeenCalled();
  });

  it.each(['mock', 'manual'] as const)(
    'bloqueia send com provider %s antes do sync',
    async (provider) => {
      const subject = createSubject();

      await expect(
        subject.orchestrator.executeTick({
          ...tick,
          mode: 'send',
          provider,
        }),
      ).resolves.toMatchObject({
        status: 'blocked',
        reasons: [COMMERCIAL_AUTOMATION_OFFICIAL_PROVIDER_REQUIRED],
      });
      expect(subject.syncOffers.run).not.toHaveBeenCalled();
      expect(subject.pipeline.dryRun).not.toHaveBeenCalled();
      expect(subject.confirmation.confirm).not.toHaveBeenCalled();
    },
  );

  it('bloqueia send sem candidate flow em vez de cair no pipeline legacy', async () => {
    const subject = createSubject({ withCandidateFlow: false });

    await expect(
      subject.orchestrator.executeTick({
        ...tick,
        mode: 'send',
        provider: 'official',
      }),
    ).resolves.toMatchObject({
      status: 'blocked',
      reasons: [COMMERCIAL_AUTOMATION_CANDIDATE_FLOW_REQUIRED],
    });
    expect(subject.syncOffers.run).not.toHaveBeenCalled();
    expect(subject.executions.records[0].externalStage).toBe('NOT_REACHED');
    expect(subject.pipeline.dryRun).not.toHaveBeenCalled();
  });

  it('confirma uma unica vez no modo send official totalmente mockado', async () => {
    const subject = createSubject();

    await expect(
      subject.orchestrator.executeTick({
        ...tick,
        mode: 'send',
        provider: 'official',
      }),
    ).resolves.toMatchObject({
      status: 'queued',
      dispatchCreated: true,
      whatsappJobCreated: true,
      messageSent: false,
    });
    expect(subject.pipeline.dryRun).not.toHaveBeenCalled();
    expect(subject.candidateFlow.preflight).toHaveBeenCalledOnce();
    expect(subject.candidateFlow.prepare).toHaveBeenCalledOnce();
    expect(subject.candidateFlow.revalidate).toHaveBeenCalledOnce();
    expect(subject.candidateFlow.renewAttempt).toHaveBeenCalledWith({
      campaignId: 'campaign-1',
      executionId: 'execution-1',
      renewedAt: NOW,
      leaseExpiresAt: new Date(NOW.getTime() + 120_000),
    });
    expect(subject.candidateFlow.renewAttempt).toHaveBeenCalledOnce();
    expect(subject.confirmation.confirm).toHaveBeenCalledWith(
      'run-1',
      expect.any(String),
      { existingGeneratedCopyId: 'ai-copy-1' },
    );
    expect(subject.confirmation.confirm).toHaveBeenCalledOnce();
    expect(subject.candidateFlow.releaseAttempt).not.toHaveBeenCalled();
  });

  it('usa uma lease fresca no reserve mesmo quando a lease inicial ficou stale', async () => {
    let now = NOW;
    const subject = createSubject({ clock: () => now });
    subject.candidateFlow.preflight
      .mockResolvedValueOnce({ outcome: 'NO_CANDIDATE' })
      .mockResolvedValueOnce({
        outcome: 'READY',
        candidateId: 'candidate-1',
        candidateStatus: 'COPY_READY',
      });
    subject.candidateFlow.replenish.mockImplementation(async () => {
      now = new Date(NOW.getTime() + 60_000);
      return { rejectionSummary: {} };
    });

    await expect(
      subject.orchestrator.executeTick({
        ...tick,
        mode: 'send',
        provider: 'official',
      }),
    ).resolves.toMatchObject({ status: 'queued' });

    expect(subject.candidateFlow.reserveAttempt).toHaveBeenCalledWith(
      expect.anything(),
      {
        executionId: 'execution-1',
        reservedAt: now,
        leaseExpiresAt: new Date(now.getTime() + 120_000),
      },
    );
    expect(
      subject.candidateFlow.reserveAttempt.mock.calls[0]?.[1].leaseExpiresAt,
    ).not.toEqual(new Date(NOW.getTime() + 120_000));
  });

  it('renova a reservation imediatamente antes da confirmacao', async () => {
    const subject = createSubject();
    const order: string[] = [];
    subject.candidateFlow.revalidate.mockImplementation(async () => {
      order.push('revalidate');
    });
    subject.candidateFlow.renewAttempt.mockImplementation(async (input) => {
      order.push('renew');
      return {
        kind: 'RENEWED',
        campaignId: input.campaignId,
        executionId: input.executionId,
        leaseExpiresAt: input.leaseExpiresAt,
        renewed: true,
      };
    });
    subject.confirmation.confirm.mockImplementation(async () => {
      order.push('confirm');
      return { status: 'queued' };
    });

    await subject.orchestrator.executeTick({
      ...tick,
      mode: 'send',
      provider: 'official',
    });

    expect(order).toEqual(['revalidate', 'renew', 'confirm']);
    expect(subject.confirmation.confirm).toHaveBeenCalledOnce();
  });

  it('bloqueia a confirmacao quando a renovacao pre-confirmacao perde ownership', async () => {
    const subject = createSubject();
    subject.candidateFlow.renewAttempt.mockResolvedValue({
      kind: 'CONFLICT',
      campaignId: 'campaign-1',
      executionId: 'execution-1',
    });

    await expect(
      subject.orchestrator.executeTick({
        ...tick,
        mode: 'send',
        provider: 'official',
      }),
    ).resolves.toMatchObject({ status: 'blocked' });

    expect(subject.candidateFlow.renewAttempt).toHaveBeenCalledOnce();
    expect(subject.confirmation.confirm).not.toHaveBeenCalled();
    expect(subject.candidateFlow.releaseAttempt).toHaveBeenCalledWith({
      campaignId: 'campaign-1',
      executionId: 'execution-1',
    });
  });

  it('nao duplica execucao nem efeitos para a mesma job ID', async () => {
    const subject = createSubject();
    const first = await subject.orchestrator.executeTick(tick);
    const second = await subject.orchestrator.executeTick(tick);

    expect(second).toEqual(first);
    expect(subject.executions.records).toHaveLength(1);
    expect(subject.syncOffers.run).not.toHaveBeenCalled();
    expect(subject.pipeline.dryRun).toHaveBeenCalledOnce();
  });

  it('nao conclui como sucesso uma reentrega cuja execucao continua STARTED', async () => {
    const subject = createSubject();
    subject.executions.records.push({
      id: 'execution-started',
      schedulerJobId: tick.schedulerJobId,
      bullMqJobId: tick.bullMqJobId,
      activeKey: 'commercial-automation',
      ownerId: 'owner-existing',
      heartbeatAt: NOW,
      leaseExpiresAt: new Date('2026-07-26T15:02:00.000Z'),
      mode: 'PREVIEW',
      status: 'STARTED',
      externalStage: 'NOT_REACHED',
      reasons: [],
      commercialRunId: null,
      failureCode: null,
      startedAt: NOW,
      completedAt: null,
    });

    await expect(subject.orchestrator.executeTick(tick)).rejects.toMatchObject({
      code: COMMERCIAL_EXECUTION_IN_PROGRESS,
    });
    expect(subject.syncOffers.run).not.toHaveBeenCalled();
  });

  it('interrompe a proxima etapa ao perder ownership', async () => {
    const subject = createSubject();
    subject.executions.loseAfterHeartbeats = 1;

    await expect(
      subject.orchestrator.executeTick({
        ...tick,
        mode: 'send',
        provider: 'official',
      }),
    ).rejects.toMatchObject({ code: COMMERCIAL_EXECUTION_OWNERSHIP_LOST });
    expect(subject.syncOffers.run).not.toHaveBeenCalled();
    expect(subject.pipeline.dryRun).not.toHaveBeenCalled();
    expect(subject.executions.records[0].status).toBe('STARTED');
  });


  it('falha de replenishment nao cria reserva nem toca a campanha', async () => {
    const subject = createSubject();
    subject.candidateFlow.preflight.mockResolvedValue({ outcome: 'NO_CANDIDATE' });
    subject.syncOffers.run.mockRejectedValue(new Error('offline'));

    await expect(
      subject.orchestrator.executeTick({
        ...tick,
        mode: 'send',
        provider: 'official',
      }),
    ).resolves.toMatchObject({ status: 'failed', commercialRunId: null });

    expect(subject.executions.records[0].externalStage).toBe(
      'EXTERNAL_MAY_HAVE_STARTED',
    );
    expect(subject.candidateFlow.replenish).toHaveBeenCalledOnce();
    expect(subject.candidateFlow.reserveAttempt).not.toHaveBeenCalled();
    expect(subject.candidateFlow.prepare).not.toHaveBeenCalled();
    expect(subject.confirmation.confirm).not.toHaveBeenCalled();
  });
  it('finaliza FAILED quando a sincronizacao falha antes do dry-run', async () => {
    const subject = createSubject();
    subject.candidateFlow.preflight.mockResolvedValue({ outcome: 'NO_CANDIDATE' });
    subject.syncOffers.run.mockRejectedValue(new Error('offline'));

    await expect(
      subject.orchestrator.executeTick({
        ...tick,
        mode: 'send',
        provider: 'official',
      }),
    ).resolves.toMatchObject({
      status: 'failed',
      commercialRunId: null,
    });
    expect(subject.pipeline.dryRun).not.toHaveBeenCalled();
  });

  it('finaliza AMBIGUOUS quando a confirmacao entra em estado incerto', async () => {
    const subject = createSubject();
    subject.confirmation.confirm.mockRejectedValue(new Error('timeout'));
    subject.commercialRuns.findById.mockResolvedValue({
      finalStatus: 'AMBIGUOUS',
      investigationRequired: true,
    });

    await expect(
      subject.orchestrator.executeTick({
        ...tick,
        mode: 'send',
        provider: 'official',
      }),
    ).resolves.toMatchObject({
      status: 'ambiguous',
      commercialRunId: 'run-1',
    });
    expect(subject.confirmation.confirm).toHaveBeenCalledOnce();
  });

  it('finaliza FAILED quando a confirmacao falha antes de criar estado incerto', async () => {
    const subject = createSubject();
    subject.confirmation.confirm.mockRejectedValue(
      new AppError('Produto mudou', 'COMMERCIAL_PRODUCT_CHANGED'),
    );

    await expect(
      subject.orchestrator.executeTick({
        ...tick,
        mode: 'send',
        provider: 'official',
      }),
    ).resolves.toMatchObject({
      status: 'failed',
    });
  });

  it('reavalia guardrails imediatamente antes de confirmar', async () => {
    const subject = createSubject();
    subject.policy.evaluateAutomationReadiness
      .mockResolvedValueOnce({ allowed: true, reasons: [] })
      .mockResolvedValueOnce({ allowed: true, reasons: [] })
      .mockResolvedValueOnce({
        allowed: false,
        reasons: ['AUTOMATION_PAUSED'],
      });

    await expect(
      subject.orchestrator.executeTick({
        ...tick,
        mode: 'send',
        provider: 'official',
      }),
    ).resolves.toMatchObject({
      status: 'blocked',
      reasons: ['AUTOMATION_PAUSED'],
      commercialRunId: 'run-1',
    });
    expect(subject.confirmation.confirm).not.toHaveBeenCalled();
  });

  it('avalia targets em ordem e confirma somente o primeiro permitido', async () => {
    const targets: CommercialAutomationTarget[] = [
      {
        groupId: 'group-a',
        groupName: 'Grupo A',
        logicalGroupFingerprint: 'grp_aaaaaaaaaaaa',
        campaignId: 'campaign-a',
        nicheId: 'niche-a',
        dailyLimit: 60,
      },
      {
        groupId: 'group-b',
        groupName: 'Grupo B',
        logicalGroupFingerprint: 'grp_bbbbbbbbbbbb',
        campaignId: 'campaign-b',
        nicheId: 'niche-b',
        dailyLimit: 60,
      },
    ];
    const subject = createSubject({ targets });
    subject.policy.evaluateAutomationReadiness.mockImplementation(
      async (input?: { target?: CommercialAutomationTarget }) =>
        input?.target?.groupId === 'group-a'
          ? { allowed: false, reasons: ['MINIMUM_INTERVAL_NOT_REACHED'] }
          : { allowed: true, reasons: [] },
    );

    await expect(
      subject.orchestrator.executeTick({
        ...tick,
        mode: 'send',
        provider: 'official',
      }),
    ).resolves.toMatchObject({ status: 'queued' });

    expect(subject.syncOffers.run).not.toHaveBeenCalled();
    expect(subject.candidateFlow.preflight).toHaveBeenCalledWith(targets[1]);
    expect(subject.candidateFlow.preflight).toHaveBeenCalledOnce();
    expect(subject.candidateFlow.prepare).toHaveBeenCalledWith(
      expect.objectContaining({ target: targets[1] }),
      expect.objectContaining({ executionId: 'execution-1' }),
    );
    expect(subject.candidateFlow.prepare).toHaveBeenCalledOnce();
    expect(subject.candidateFlow.revalidate).toHaveBeenCalledWith(
      expect.objectContaining({
        groupId: 'group-b',
        campaignId: 'campaign-b',
      }),
    );
    expect(subject.confirmation.confirm).toHaveBeenCalledOnce();
  });

  it('aplica target constraint do scheduler sem fallback para outro grupo', async () => {
    const targets: CommercialAutomationTarget[] = [
      {
        groupId: 'group-a',
        groupName: 'Grupo A',
        logicalGroupFingerprint: 'grp_aaaaaaaaaaaa',
        campaignId: 'campaign-a',
        nicheId: 'niche-a',
        dailyLimit: 60,
        instanceName: 'instance-a',
      },
      {
        groupId: 'group-b',
        groupName: 'Grupo B',
        logicalGroupFingerprint: 'grp_bbbbbbbbbbbb',
        campaignId: 'campaign-b',
        nicheId: 'niche-b',
        dailyLimit: 60,
        instanceName: 'instance-b',
      },
    ];
    const subject = createSubject({ targets });

    await expect(
      subject.orchestrator.executeTick({
        ...tick,
        mode: 'send',
        provider: 'official',
        targetConstraint: {
          campaignId: 'campaign-b',
          groupId: 'group-b',
          logicalGroupFingerprint: 'grp_bbbbbbbbbbbb',
          instanceName: 'instance-b',
          scheduledFor: '2026-07-25T14:00:00.000Z',
          slotKey: 'slot-b',
          scheduleRevision: 1,
        },
      }),
    ).resolves.toMatchObject({ status: 'queued' });

    expect(subject.candidateFlow.preflight).toHaveBeenCalledOnce();
    expect(subject.candidateFlow.preflight).toHaveBeenCalledWith(targets[1]);
    expect(subject.candidateFlow.prepare).toHaveBeenCalledWith(
      expect.objectContaining({ target: targets[1] }),
      expect.any(Object),
    );
    expect(subject.candidateFlow.prepare).not.toHaveBeenCalledWith(
      expect.objectContaining({ target: targets[0] }),
    );
    expect(subject.executions.lastExpectedScheduleRevision).toBe(1);
  });

  it('bloqueia target reatribuido sem cair para outro grupo', async () => {
    const targetA: CommercialAutomationTarget = {
      groupId: 'group-a',
      groupName: 'Grupo A',
      logicalGroupFingerprint: 'grp_aaaaaaaaaaaa',
      campaignId: 'campaign-a',
      nicheId: 'niche-a',
      dailyLimit: 60,
      instanceName: 'instance-a',
    };
    const subject = createSubject({ targets: [targetA] });

    await expect(
      subject.orchestrator.executeTick({
        ...tick,
        mode: 'send',
        provider: 'official',
        targetConstraint: {
          campaignId: 'campaign-b',
          groupId: 'group-b',
          logicalGroupFingerprint: 'grp_bbbbbbbbbbbb',
          instanceName: 'instance-b',
          scheduledFor: '2026-07-25T14:00:00.000Z',
          slotKey: 'slot-b',
          scheduleRevision: 1,
        },
      }),
    ).resolves.toMatchObject({
      status: 'blocked',
      reasons: ['COMMERCIAL_AUTOMATION_TARGET_NOT_ELIGIBLE'],
    });
    expect(subject.syncOffers.run).not.toHaveBeenCalled();
    expect(subject.candidateFlow.preflight).not.toHaveBeenCalled();
    expect(subject.candidateFlow.prepare).not.toHaveBeenCalled();
  });

  it('avanca de A sem candidato para B com COPY_READY sem criar artefatos em A', async () => {
    const targets: CommercialAutomationTarget[] = [
      {
        groupId: 'group-a',
        groupName: 'Grupo A',
        logicalGroupFingerprint: 'grp_aaaaaaaaaaaa',
        campaignId: 'campaign-a',
        nicheId: 'niche-a',
        dailyLimit: 60,
      },
      {
        groupId: 'group-b',
        groupName: 'Grupo B',
        logicalGroupFingerprint: 'grp_bbbbbbbbbbbb',
        campaignId: 'campaign-b',
        nicheId: 'niche-b',
        dailyLimit: 60,
      },
    ];
    const subject = createSubject({ targets });
    subject.candidateFlow.preflight
      .mockResolvedValueOnce({ outcome: 'NO_CANDIDATE' })
      .mockResolvedValueOnce({ outcome: 'NO_CANDIDATE' })
      .mockResolvedValue({
        outcome: 'READY',
        candidateId: 'candidate-b',
        candidateStatus: 'COPY_READY',
      });

    await expect(
      subject.orchestrator.executeTick({
        ...tick,
        mode: 'send',
        provider: 'official',
      }),
    ).resolves.toMatchObject({ status: 'queued' });

    expect(subject.candidateFlow.preflight).toHaveBeenNthCalledWith(1, targets[0]);
    expect(subject.candidateFlow.preflight).toHaveBeenNthCalledWith(2, targets[0]);
    expect(subject.candidateFlow.preflight).toHaveBeenNthCalledWith(3, targets[1]);
    expect(subject.candidateFlow.replenish).toHaveBeenCalledOnce();
    expect(subject.candidateFlow.replenish).toHaveBeenNthCalledWith(1, targets[0]);
    expect(subject.candidateFlow.prepare).toHaveBeenCalledOnce();
    expect(subject.candidateFlow.prepare).toHaveBeenCalledWith(
      expect.objectContaining({ target: targets[1] }),
      expect.objectContaining({ executionId: 'execution-1' }),
    );
    expect(subject.syncOffers.run).not.toHaveBeenCalled();
    expect(subject.confirmation.confirm).toHaveBeenCalledOnce();
  });

  it('integra flow real: imagem inelegivel em A alcanca B com maxMiningCallsPerTick e writesForSkippedTargets', async () => {
    const realFlow = createRealCandidateFlowForIntegration();
    const subject = createSubject({
      candidateFlowOverride: realFlow.service,
    });
    const dispatches: string[] = [];
    const outbox: string[] = [];
    const jobs: string[] = [];
    subject.confirmation.confirm.mockImplementation(async (runId?: string) => {
      realFlow.lifecycle.push('confirmation');
      const confirmedRunId = runId ?? '';
      dispatches.push(confirmedRunId);
      outbox.push(confirmedRunId);
      jobs.push(confirmedRunId);
      return { status: 'queued' };
    });

    await expect(
      subject.orchestrator.executeTick({
        ...tick,
        mode: 'send',
        provider: 'official',
      }),
    ).resolves.toMatchObject({
      status: 'queued',
      commercialRunId: 'run-candidate-b',
    });

    const miningCallsForEvaluatedTargets = 1;
    const writesForSkippedTargets = {
      copies: realFlow.copyGeneration.generate.mock.calls.filter(
        ([candidateId]) => candidateId === 'candidate-a',
      ).length,
      runs: realFlow.flowPipeline.dryRunFromPromotionCandidate.mock.calls.filter(
        ([input]) => input.candidate.id === 'candidate-a',
      ).length,
      dispatches: dispatches.filter((runId) => runId === 'run-candidate-a')
        .length,
      outbox: outbox.filter((runId) => runId === 'run-candidate-a').length,
      jobs: jobs.filter((runId) => runId === 'run-candidate-a').length,
    };

    expect(realFlow.mining.mine).toHaveBeenCalledTimes(miningCallsForEvaluatedTargets);
    expect(realFlow.mining.mine).toHaveBeenNthCalledWith(1, 'campaign-a', {
      confirm: 'MINERAR_PROMOCOES',
    });
    expect(subject.syncOffers.run).not.toHaveBeenCalled();
    expect(realFlow.copyGeneration.generate).not.toHaveBeenCalled();
    expect(realFlow.flowPipeline.dryRunFromPromotionCandidate).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: 'execution-1',
        candidate: expect.objectContaining({ id: 'candidate-b' }),
      }),
    );
    expect(realFlow.lifecycle).toEqual(['runs.create', 'confirmation']);
    expect(writesForSkippedTargets).toEqual({
      copies: 0,
      runs: 0,
      dispatches: 0,
      outbox: 0,
      jobs: 0,
    });
  });

  it('avanca de A sem candidato para B QUEUED com no maximo uma geracao de IA', async () => {
    const targets: CommercialAutomationTarget[] = [
      {
        groupId: 'group-a',
        groupName: 'Grupo A',
        logicalGroupFingerprint: 'grp_aaaaaaaaaaaa',
        campaignId: 'campaign-a',
        nicheId: 'niche-a',
        dailyLimit: 60,
      },
      {
        groupId: 'group-b',
        groupName: 'Grupo B',
        logicalGroupFingerprint: 'grp_bbbbbbbbbbbb',
        campaignId: 'campaign-b',
        nicheId: 'niche-b',
        dailyLimit: 60,
      },
    ];
    const subject = createSubject({ targets });
    const generateAiCopy = vi.fn();
    subject.candidateFlow.preflight
      .mockResolvedValueOnce({ outcome: 'NO_CANDIDATE' })
      .mockResolvedValueOnce({ outcome: 'NO_CANDIDATE' })
      .mockResolvedValue({
        outcome: 'READY',
        candidateId: 'candidate-b',
        candidateStatus: 'QUEUED',
      });
    subject.candidateFlow.prepare.mockImplementation(async ({ target }) => {
      generateAiCopy();
      return {
        runId: 'run-1',
        generatedCopyId: 'ai-copy-1',
        candidateId: 'candidate-b',
        campaignId: target.campaignId,
        groupId: target.groupId,
        logicalGroupFingerprint: target.logicalGroupFingerprint,
        nicheId: target.nicheId,
      };
    });

    await subject.orchestrator.executeTick({
      ...tick,
      mode: 'send',
      provider: 'official',
    });

    expect(generateAiCopy).toHaveBeenCalledOnce();
    expect(subject.candidateFlow.prepare).toHaveBeenCalledOnce();
    expect(subject.candidateFlow.prepare).toHaveBeenCalledWith(
      expect.objectContaining({ target: targets[1] }),
      expect.objectContaining({ executionId: 'execution-1' }),
    );
  });

  it('reabastece B uma vez e o seleciona quando a reposicao cria candidato', async () => {
    const targets: CommercialAutomationTarget[] = ['a', 'b'].map((suffix) => ({
      groupId: `group-${suffix}`,
      groupName: `Grupo ${suffix.toUpperCase()}`,
      logicalGroupFingerprint: `grp_${suffix.repeat(12)}`,
      campaignId: `campaign-${suffix}`,
      nicheId: `niche-${suffix}`,
      dailyLimit: 60,
    }));
    const subject = createSubject({ targets });
    const replenished = new Set<string>();
    subject.candidateFlow.preflight.mockImplementation(async (target) => {
      if (target.groupId === 'group-a') return { outcome: 'NO_CANDIDATE' };
      return replenished.has(target.groupId)
        ? {
            outcome: 'READY',
            candidateId: 'candidate-b',
            candidateStatus: 'QUEUED',
          }
        : { outcome: 'NO_CANDIDATE' };
    });
    subject.candidateFlow.replenish.mockImplementation(async (target) => {
      replenished.add(target.groupId);
      return { rejectionSummary: {} };
    });

    await expect(
      subject.orchestrator.executeTick({
        ...tick,
        mode: 'send',
        provider: 'official',
      }),
    ).resolves.toMatchObject({ status: 'queued' });

    expect(subject.candidateFlow.replenish).toHaveBeenCalledTimes(2);
    expect(subject.candidateFlow.replenish).toHaveBeenNthCalledWith(1, targets[0]);
    expect(subject.candidateFlow.replenish).toHaveBeenNthCalledWith(2, targets[1]);
    expect(subject.candidateFlow.prepare).toHaveBeenCalledWith(
      expect.objectContaining({ target: targets[1] }),
      {
        executionId: 'execution-1',
        miningReport: { rejectionSummary: {} },
      },
    );
    expect(subject.confirmation.confirm).toHaveBeenCalledOnce();
  });

  it('avanca de A e B sem candidato para C pronto, sem fan-out de preparacao', async () => {
    const targets: CommercialAutomationTarget[] = ['a', 'b', 'c'].map(
      (suffix) => ({
        groupId: `group-${suffix}`,
        groupName: `Grupo ${suffix.toUpperCase()}`,
        logicalGroupFingerprint: `grp_${suffix.repeat(12)}`,
        campaignId: `campaign-${suffix}`,
        nicheId: `niche-${suffix}`,
        dailyLimit: 60,
      }),
    );
    const subject = createSubject({ targets });
    subject.candidateFlow.preflight.mockImplementation(
      async (target: CommercialAutomationTarget) =>
        target.groupId === 'group-c'
          ? {
              outcome: 'READY' as const,
              candidateId: 'candidate-c',
              candidateStatus: 'COPY_READY' as const,
            }
          : { outcome: 'NO_CANDIDATE' as const },
    );

    await subject.orchestrator.executeTick({
      ...tick,
      mode: 'send',
      provider: 'official',
    });

    expect(subject.candidateFlow.preflight).toHaveBeenCalledTimes(5);
    expect(subject.candidateFlow.preflight).toHaveBeenNthCalledWith(1, targets[0]);
    expect(subject.candidateFlow.preflight).toHaveBeenNthCalledWith(2, targets[0]);
    expect(subject.candidateFlow.preflight).toHaveBeenNthCalledWith(3, targets[1]);
    expect(subject.candidateFlow.preflight).toHaveBeenNthCalledWith(4, targets[1]);
    expect(subject.candidateFlow.preflight).toHaveBeenNthCalledWith(5, targets[2]);
    expect(subject.candidateFlow.replenish).toHaveBeenCalledTimes(2);
    expect(subject.candidateFlow.replenish).toHaveBeenNthCalledWith(1, targets[0]);
    expect(subject.candidateFlow.replenish).toHaveBeenNthCalledWith(2, targets[1]);
    expect(subject.candidateFlow.prepare).toHaveBeenCalledOnce();
    expect(subject.candidateFlow.prepare).toHaveBeenCalledWith(
      expect.objectContaining({ target: targets[2] }),
      expect.objectContaining({ executionId: 'execution-1' }),
    );
  });

  it('esgota capacidade local antes de marcar e sincronizar', async () => {
    const subject = createSubject();
    const events: string[] = [];
    const mark = subject.executions.markExternalMayHaveStarted.bind(
      subject.executions,
    );
    vi.spyOn(subject.executions, 'markExternalMayHaveStarted').mockImplementation(
      async (ownership, input) => {
        events.push('marker');
        return mark(ownership, input);
      },
    );
    let preflightCalls = 0;
    subject.candidateFlow.preflight.mockImplementation(async () => {
      events.push('preflight');
      preflightCalls += 1;
      if (preflightCalls < 3) return { outcome: 'NO_CANDIDATE' };
      return {
        outcome: 'READY',
        candidateId: 'candidate-after-sync',
        candidateStatus: 'COPY_READY',
      };
    });
    subject.syncOffers.run.mockImplementation(async () => {
      events.push('sync');
      expect(subject.executions.records[0].externalStage).toBe(
        'EXTERNAL_MAY_HAVE_STARTED',
      );
      return { hasNextPage: false };
    });
    subject.candidateFlow.replenish.mockImplementation(async () => {
      events.push('replenish');
      return { rejectionSummary: {} };
    });
    subject.candidateFlow.reserveAttempt.mockImplementation(
      async (target, input) => {
        events.push('reserve');
        return {
          kind: 'RESERVED',
          campaignId: target.campaignId,
          executionId: input.executionId,
          reservedAt: input.reservedAt,
          leaseExpiresAt: input.leaseExpiresAt,
          acquired: true,
        };
      },
    );
    subject.candidateFlow.prepare.mockImplementation(async ({ target, candidateId }) => {
      events.push('prepare');
      expect(subject.executions.records[0].externalStage).toBe(
        'EXTERNAL_MAY_HAVE_STARTED',
      );
      return {
        runId: 'run-after-sync',
        generatedCopyId: 'copy-after-sync',
        candidateId,
        campaignId: target.campaignId,
        groupId: target.groupId,
        logicalGroupFingerprint: target.logicalGroupFingerprint,
        nicheId: target.nicheId,
      };
    });

    await subject.orchestrator.executeTick({
      ...tick,
      mode: 'send',
      provider: 'official',
    });

    expect(events).toEqual([
      'preflight',
      'replenish',
      'preflight',
      'marker',
      'sync',
      'replenish',
      'preflight',
      'reserve',
      'prepare',
    ]);
    expect(subject.candidateFlow.reserveAttempt).toHaveBeenCalledOnce();
    expect(subject.candidateFlow.prepare).toHaveBeenCalledOnce();
  });
  it('seleciona o novo rank-1 produzido pelo sync e nunca prepara o candidate pre-sync', async () => {
    const subject = createSubject();
    const events: string[] = [];
    const target = (await subject.candidateFlow.listTargets())[0];
    if (!target) throw new Error('target ausente no teste');

    const queueState = { rank1: 'candidate-old' };
    const currentPreflight = () => ({
      outcome: 'READY' as const,
      candidateId: queueState.rank1,
      candidateStatus: 'COPY_READY' as const,
    });
    expect(currentPreflight()).toMatchObject({ candidateId: 'candidate-old' });

    const mark = subject.executions.markExternalMayHaveStarted.bind(subject.executions);
    vi.spyOn(subject.executions, 'markExternalMayHaveStarted').mockImplementation(
      async (ownership, input) => {
        events.push('marker');
        return mark(ownership, input);
      },
    );
    subject.syncOffers.run.mockImplementation(async () => {
      events.push('sync');
      queueState.rank1 = 'candidate-new';
      return { hasNextPage: false };
    });
    subject.candidateFlow.replenish.mockImplementation(async () => {
      events.push('replenish');
      return { rejectionSummary: {} };
    });
    let preflightCalls = 0;
    subject.candidateFlow.preflight.mockImplementation(async () => {
      events.push('preflight');
      preflightCalls += 1;
      if (preflightCalls < 3) return { outcome: 'NO_CANDIDATE' };
      return currentPreflight();
    });
    subject.candidateFlow.reserveAttempt.mockImplementation(async (selectedTarget, input) => {
      events.push('reserve');
      return {
        kind: 'RESERVED',
        campaignId: selectedTarget.campaignId,
        executionId: input.executionId,
        reservedAt: input.reservedAt,
        leaseExpiresAt: input.leaseExpiresAt,
        acquired: true,
      };
    });
    subject.candidateFlow.prepare.mockImplementation(async ({ target: selectedTarget, candidateId }) => {
      events.push('prepare');
      expect(candidateId).toBe('candidate-new');
      expect(candidateId).not.toBe('candidate-old');
      return {
        runId: 'run-candidate-new',
        generatedCopyId: 'copy-candidate-new',
        candidateId,
        campaignId: selectedTarget.campaignId,
        groupId: selectedTarget.groupId,
        logicalGroupFingerprint: selectedTarget.logicalGroupFingerprint,
        nicheId: selectedTarget.nicheId,
      };
    });

    await expect(
      subject.orchestrator.executeTick({
        ...tick,
        mode: 'send',
        provider: 'official',
      }),
    ).resolves.toMatchObject({ status: 'queued', commercialRunId: 'run-candidate-new' });

    expect(events).toEqual([
      'preflight',
      'replenish',
      'preflight',
      'marker',
      'sync',
      'replenish',
      'preflight',
      'reserve',
      'prepare',
    ]);
    expect(subject.syncOffers.run).toHaveBeenCalledOnce();
    expect(subject.candidateFlow.replenish).toHaveBeenCalledTimes(2);
    expect(subject.candidateFlow.preflight).toHaveBeenCalledTimes(3);
    expect(subject.candidateFlow.reserveAttempt).toHaveBeenCalledOnce();
    expect(subject.candidateFlow.prepare).toHaveBeenCalledOnce();
    expect(subject.candidateFlow.prepare).toHaveBeenCalledWith(
      expect.objectContaining({ candidateId: 'candidate-new' }),
      expect.objectContaining({
        executionId: 'execution-1',
        miningReport: { rejectionSummary: {} },
      }),
    );
  });

  it('reabastece cada target vazio uma vez e bloqueia sem preparar artefatos', async () => {
    const targets: CommercialAutomationTarget[] = ['a', 'b'].map((suffix) => ({
      groupId: `group-${suffix}`,
      groupName: `Grupo ${suffix.toUpperCase()}`,
      logicalGroupFingerprint: `grp_${suffix.repeat(12)}`,
      campaignId: `campaign-${suffix}`,
      nicheId: `niche-${suffix}`,
      dailyLimit: 60,
    }));
    const subject = createSubject({ targets });
    subject.candidateFlow.preflight.mockResolvedValue({
      outcome: 'NO_CANDIDATE',
    });

    await expect(
      subject.orchestrator.executeTick({
        ...tick,
        mode: 'send',
        provider: 'official',
      }),
    ).resolves.toMatchObject({
      status: 'blocked',
      reasons: ['COMMERCIAL_AUTOMATION_NO_ELIGIBLE_CANDIDATE'],
    });

    expect(subject.syncOffers.run).toHaveBeenCalledTimes(2);
    expect(subject.candidateFlow.replenish).toHaveBeenCalledTimes(4);
    expect(subject.candidateFlow.prepare).not.toHaveBeenCalled();
    expect(subject.pipeline.dryRun).not.toHaveBeenCalled();
    expect(subject.confirmation.confirm).not.toHaveBeenCalled();
  });

  it('mantem single-group vazio bloqueado sem copy, run ou confirmacao', async () => {
    const subject = createSubject({
      targets: [
        {
          groupId: 'group-a',
          groupName: 'Grupo A',
          logicalGroupFingerprint: 'grp_aaaaaaaaaaaa',
          campaignId: 'campaign-a',
          nicheId: 'niche-a',
          dailyLimit: 60,
        },
      ],
    });
    subject.candidateFlow.preflight.mockResolvedValue({
      outcome: 'NO_CANDIDATE',
    });

    await expect(
      subject.orchestrator.executeTick({
        ...tick,
        mode: 'send',
        provider: 'official',
      }),
    ).resolves.toMatchObject({
      status: 'blocked',
      reasons: ['COMMERCIAL_AUTOMATION_NO_ELIGIBLE_CANDIDATE'],
    });

    expect(subject.candidateFlow.replenish).toHaveBeenCalledTimes(2);
    expect(subject.candidateFlow.prepare).not.toHaveBeenCalled();
    expect(subject.pipeline.dryRun).not.toHaveBeenCalled();
    expect(subject.confirmation.confirm).not.toHaveBeenCalled();
  });

  it('nao tenta B quando a IA de A falha depois do preflight', async () => {
    const targets: CommercialAutomationTarget[] = ['a', 'b'].map((suffix) => ({
      groupId: `group-${suffix}`,
      groupName: `Grupo ${suffix.toUpperCase()}`,
      logicalGroupFingerprint: `grp_${suffix.repeat(12)}`,
      campaignId: `campaign-${suffix}`,
      nicheId: `niche-${suffix}`,
      dailyLimit: 60,
    }));
    const subject = createSubject({ targets });
    subject.candidateFlow.prepare.mockRejectedValue(
      new AppError('Falha na IA', 'COMMERCIAL_AI_COPY_FAILED'),
    );

    await expect(
      subject.orchestrator.executeTick({
        ...tick,
        mode: 'send',
        provider: 'official',
      }),
    ).resolves.toMatchObject({ status: 'failed' });

    expect(subject.candidateFlow.preflight).toHaveBeenCalledWith(targets[0]);
    expect(subject.candidateFlow.preflight).toHaveBeenCalledOnce();
    expect(subject.candidateFlow.prepare).toHaveBeenCalledOnce();
  });

  it('nao tenta B quando a revalidacao de A falha', async () => {
    const targets: CommercialAutomationTarget[] = ['a', 'b'].map((suffix) => ({
      groupId: `group-${suffix}`,
      groupName: `Grupo ${suffix.toUpperCase()}`,
      logicalGroupFingerprint: `grp_${suffix.repeat(12)}`,
      campaignId: `campaign-${suffix}`,
      nicheId: `niche-${suffix}`,
      dailyLimit: 60,
    }));
    const subject = createSubject({ targets });
    subject.candidateFlow.revalidate.mockRejectedValue(
      new AppError('Grupo mudou', 'COMMERCIAL_GROUP_CHANGED'),
    );

    await expect(
      subject.orchestrator.executeTick({
        ...tick,
        mode: 'send',
        provider: 'official',
      }),
    ).resolves.toMatchObject({ status: 'failed' });

    expect(subject.candidateFlow.preflight).toHaveBeenCalledWith(targets[0]);
    expect(subject.candidateFlow.preflight).toHaveBeenCalledOnce();
    expect(subject.confirmation.confirm).not.toHaveBeenCalled();
  });

  it('nao tenta B quando A possui blocker estrutural ou source invalid', async () => {
    const targets: CommercialAutomationTarget[] = ['a', 'b'].map((suffix) => ({
      groupId: `group-${suffix}`,
      groupName: `Grupo ${suffix.toUpperCase()}`,
      logicalGroupFingerprint: `grp_${suffix.repeat(12)}`,
      campaignId: `campaign-${suffix}`,
      nicheId: `niche-${suffix}`,
      dailyLimit: 60,
    }));
    const subject = createSubject({ targets });
    subject.candidateFlow.preflight.mockRejectedValue(
      new AppError('Source invalido', 'COMMERCIAL_AI_COPY_SOURCE_INVALID'),
    );

    await expect(
      subject.orchestrator.executeTick({
        ...tick,
        mode: 'send',
        provider: 'official',
      }),
    ).resolves.toMatchObject({ status: 'failed' });

    expect(subject.candidateFlow.preflight).toHaveBeenCalledWith(targets[0]);
    expect(subject.candidateFlow.preflight).toHaveBeenCalledOnce();
    expect(subject.syncOffers.run).not.toHaveBeenCalled();
    expect(subject.candidateFlow.replenish).not.toHaveBeenCalled();
    expect(subject.candidateFlow.reserveAttempt).not.toHaveBeenCalled();
    expect(subject.candidateFlow.prepare).not.toHaveBeenCalled();
  });

  it.each([
    'COMMERCIAL_GROUP_CAMPAIGN_FINGERPRINT_MISMATCH',
    'COMMERCIAL_AI_COPY_SNAPSHOT_OUTDATED',
    'COMMERCIAL_AI_COPY_CACHE_INCONSISTENT',
  ])('nao tenta B quando A possui %s', async (failureCode) => {
    const targets: CommercialAutomationTarget[] = ['a', 'b'].map((suffix) => ({
      groupId: `group-${suffix}`,
      groupName: `Grupo ${suffix.toUpperCase()}`,
      logicalGroupFingerprint: `grp_${suffix.repeat(12)}`,
      campaignId: `campaign-${suffix}`,
      nicheId: `niche-${suffix}`,
      dailyLimit: 60,
    }));
    const subject = createSubject({ targets });
    subject.candidateFlow.preflight.mockRejectedValue(
      new AppError('Invariante comercial divergente', failureCode),
    );

    await expect(
      subject.orchestrator.executeTick({
        ...tick,
        mode: 'send',
        provider: 'official',
      }),
    ).resolves.toMatchObject({ status: 'failed' });

    expect(subject.candidateFlow.preflight).toHaveBeenCalledWith(targets[0]);
    expect(subject.candidateFlow.preflight).toHaveBeenCalledOnce();
    expect(subject.syncOffers.run).not.toHaveBeenCalled();
    expect(subject.candidateFlow.replenish).not.toHaveBeenCalled();
    expect(subject.candidateFlow.reserveAttempt).not.toHaveBeenCalled();
    expect(subject.candidateFlow.prepare).not.toHaveBeenCalled();
  });

  it('mantem A/B READY na ordenacao original e compromete somente A', async () => {
    const targets: CommercialAutomationTarget[] = ['a', 'b'].map((suffix) => ({
      groupId: `group-${suffix}`,
      groupName: `Grupo ${suffix.toUpperCase()}`,
      logicalGroupFingerprint: `grp_${suffix.repeat(12)}`,
      campaignId: `campaign-${suffix}`,
      nicheId: `niche-${suffix}`,
      dailyLimit: 60,
    }));
    const subject = createSubject({ targets });

    await expect(
      subject.orchestrator.executeTick({
        ...tick,
        mode: 'send',
        provider: 'official',
      }),
    ).resolves.toMatchObject({ status: 'queued' });

    expect(subject.candidateFlow.preflight).toHaveBeenCalledWith(targets[0]);
    expect(subject.candidateFlow.preflight).toHaveBeenCalledOnce();
    expect(subject.syncOffers.run).not.toHaveBeenCalled();
    expect(subject.candidateFlow.replenish).not.toHaveBeenCalled();
    expect(subject.candidateFlow.prepare).toHaveBeenCalledWith(
      expect.objectContaining({ target: targets[0] }),
      expect.objectContaining({ executionId: 'execution-1' }),
    );
    expect(subject.confirmation.confirm).toHaveBeenCalledOnce();
  });

  it('permite B quando o bloqueio diario e especifico de A', async () => {
    const targets: CommercialAutomationTarget[] = ['a', 'b'].map((suffix) => ({
      groupId: `group-${suffix}`,
      groupName: `Grupo ${suffix.toUpperCase()}`,
      logicalGroupFingerprint: `grp_${suffix.repeat(12)}`,
      campaignId: `campaign-${suffix}`,
      nicheId: `niche-${suffix}`,
      dailyLimit: 60,
    }));
    const subject = createSubject({ targets });
    subject.policy.evaluateAutomationReadiness.mockImplementation(
      async (input?: { target?: CommercialAutomationTarget }) =>
        input?.target?.groupId === 'group-a'
          ? { allowed: false, reasons: ['GROUP_DAILY_LIMIT_REACHED'] }
          : { allowed: true, reasons: [] },
    );

    await subject.orchestrator.executeTick({
      ...tick,
      mode: 'send',
      provider: 'official',
    });

    expect(subject.candidateFlow.preflight).toHaveBeenCalledWith(targets[1]);
    expect(subject.candidateFlow.preflight).toHaveBeenCalledOnce();
    expect(subject.candidateFlow.prepare).toHaveBeenCalledWith(
      expect.objectContaining({ target: targets[1] }),
      expect.objectContaining({ executionId: 'execution-1' }),
    );
  });

  it('mantem o isolamento quando o mesmo produto aparece em grupos distintos', async () => {
    const targets: CommercialAutomationTarget[] = ['a', 'b'].map((suffix) => ({
      groupId: `group-${suffix}`,
      groupName: `Grupo ${suffix.toUpperCase()}`,
      logicalGroupFingerprint: `grp_${suffix.repeat(12)}`,
      campaignId: `campaign-${suffix}`,
      nicheId: `niche-${suffix}`,
      dailyLimit: 60,
    }));
    const subject = createSubject({ targets });
    subject.candidateFlow.preflight.mockImplementation(
      async (target: CommercialAutomationTarget) =>
        target.groupId === 'group-a'
          ? { outcome: 'NO_CANDIDATE' as const }
          : {
              outcome: 'READY' as const,
              candidateId: 'same-product-candidate-b',
              candidateStatus: 'COPY_READY' as const,
            },
    );

    await subject.orchestrator.executeTick({
      ...tick,
      mode: 'send',
      provider: 'official',
    });

    expect(subject.candidateFlow.prepare).toHaveBeenCalledWith(
      expect.objectContaining({ target: targets[1] }),
      expect.objectContaining({ executionId: 'execution-1' }),
    );
    expect(subject.candidateFlow.prepare).not.toHaveBeenCalledWith(
      targets[0],
    );
  });

  it('falha sem fallback quando o preflight encontra erro inesperado de repositorio', async () => {
    const targets: CommercialAutomationTarget[] = ['a', 'b'].map((suffix) => ({
      groupId: `group-${suffix}`,
      groupName: `Grupo ${suffix.toUpperCase()}`,
      logicalGroupFingerprint: `grp_${suffix.repeat(12)}`,
      campaignId: `campaign-${suffix}`,
      nicheId: `niche-${suffix}`,
      dailyLimit: 60,
    }));
    const subject = createSubject({ targets });
    subject.candidateFlow.preflight.mockRejectedValue(new Error('database down'));

    await expect(
      subject.orchestrator.executeTick({
        ...tick,
        mode: 'send',
        provider: 'official',
      }),
    ).resolves.toMatchObject({ status: 'failed' });

    expect(subject.candidateFlow.preflight).toHaveBeenCalledWith(targets[0]);
    expect(subject.candidateFlow.preflight).toHaveBeenCalledOnce();
    expect(subject.syncOffers.run).not.toHaveBeenCalled();
    expect(subject.candidateFlow.replenish).not.toHaveBeenCalled();
    expect(subject.candidateFlow.reserveAttempt).not.toHaveBeenCalled();
    expect(subject.candidateFlow.prepare).not.toHaveBeenCalled();
  });

  it('recalcula ordem e lifecycle entre ticks sem A vazio bloquear B ou C', async () => {
    const statefulFlow = createStatefulCrossTickCandidateFlow();
    const subject = createSubject({
      candidateFlowOverride: statefulFlow.service,
      policyOverride: statefulFlow.policy,
    });

    await expect(
      subject.orchestrator.executeTick({
        ...tick,
        bullMqJobId: 'bull-job-cross-tick-1',
        mode: 'send',
        provider: 'official',
      }),
    ).resolves.toMatchObject({
      status: 'queued',
      commercialRunId: 'run-candidate-b',
    });

    expect(statefulFlow.mining.mine).toHaveBeenNthCalledWith(
      1,
      'campaign-a',
      { confirm: 'MINERAR_PROMOCOES' },
    );
    expect(statefulFlow.mining.mine).toHaveBeenNthCalledWith(
      2,
      'campaign-b',
      { confirm: 'MINERAR_PROMOCOES' },
    );
    expect(statefulFlow.copyGeneration.generate).toHaveBeenCalledOnce();
    expect(statefulFlow.copyGeneration.generate).toHaveBeenCalledWith(
      'candidate-b',
      'GERAR_COPY_COM_IA',
    );

    // Mirrors the dispatch finalizer: only a terminal SENT updates history and lifecycle.
    statefulFlow.finalizeSent('candidate-b', NOW);
    expect(statefulFlow.candidates.get('candidate-b')?.status).toBe('DISPATCHED');
    await expect(
      statefulFlow.policy.evaluateAutomationReadiness({
        target: {
          groupId: 'group-b',
          groupName: 'Grupo B',
          logicalGroupFingerprint: 'grp_bbbbbbbbbbbb',
          campaignId: 'campaign-b',
          nicheId: 'niche-b',
          dailyLimit: 60,
          instanceName: 'affiliate-bot',
        },
      }),
    ).resolves.toMatchObject({
      allowed: false,
      reasons: expect.arrayContaining([
        'GROUP_DAILY_LIMIT_REACHED',
        'MINIMUM_INTERVAL_NOT_REACHED',
      ]),
    });
    await expect(statefulFlow.service.listTargets()).resolves.toMatchObject([
      { groupId: 'group-a' },
      { groupId: 'group-c' },
      { groupId: 'group-b' },
    ]);

    await expect(
      subject.orchestrator.executeTick({
        ...tick,
        bullMqJobId: 'bull-job-cross-tick-2',
        mode: 'send',
        provider: 'official',
      }),
    ).resolves.toMatchObject({
      status: 'queued',
      commercialRunId: 'run-candidate-c',
    });

    expect(statefulFlow.mining.mine).toHaveBeenCalledTimes(3);
    expect(statefulFlow.mining.mine).toHaveBeenNthCalledWith(3, 'campaign-a', {
      confirm: 'MINERAR_PROMOCOES',
    });
    expect(statefulFlow.flowPipeline.dryRunFromPromotionCandidate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        candidate: expect.objectContaining({ id: 'candidate-b' }),
      }),
    );
    expect(statefulFlow.flowPipeline.dryRunFromPromotionCandidate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        candidate: expect.objectContaining({ id: 'candidate-c' }),
      }),
    );
    expect(statefulFlow.copyGeneration.generate).toHaveBeenCalledOnce();
    expect(statefulFlow.candidates.get('candidate-c')?.status).toBe('COPY_READY');
    expect(subject.confirmation.confirm).toHaveBeenCalledTimes(2);
  });

  it('nao tenta o proximo target depois que a preparacao inicia e falha', async () => {
    const targets: CommercialAutomationTarget[] = [
      {
        groupId: 'group-a',
        groupName: 'Grupo A',
        logicalGroupFingerprint: 'grp_aaaaaaaaaaaa',
        campaignId: 'campaign-a',
        nicheId: 'niche-a',
        dailyLimit: 60,
      },
      {
        groupId: 'group-b',
        groupName: 'Grupo B',
        logicalGroupFingerprint: 'grp_bbbbbbbbbbbb',
        campaignId: 'campaign-b',
        nicheId: 'niche-b',
        dailyLimit: 60,
      },
    ];
    const subject = createSubject({ targets });
    subject.candidateFlow.prepare.mockRejectedValue(
      new AppError('Falha na geraÃ§Ã£o de copy', 'COMMERCIAL_AI_COPY_FAILED'),
    );

    await expect(
      subject.orchestrator.executeTick({
        ...tick,
        mode: 'send',
        provider: 'official',
      }),
    ).resolves.toMatchObject({ status: 'failed' });

    expect(subject.candidateFlow.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        target: targets[0],
        candidateId: 'candidate-1',
        candidateStatus: 'COPY_READY',
      }),
      expect.objectContaining({ executionId: 'execution-1' }),
    );
    expect(subject.candidateFlow.prepare).toHaveBeenCalledOnce();
    expect(subject.candidateFlow.preflight).toHaveBeenCalledWith(targets[0]);
    expect(subject.candidateFlow.preflight).toHaveBeenCalledOnce();
    expect(subject.confirmation.confirm).not.toHaveBeenCalled();
  });

  it('libera a reserva quando prepare rejeita output invalido antes da confirmacao', async () => {
    const subject = createSubject();
    subject.candidateFlow.prepare.mockRejectedValue(
      new AppError('Output rejeitado', 'COMMERCIAL_AI_COPY_OUTPUT_INVALID'),
    );

    await expect(
      subject.orchestrator.executeTick({
        ...tick,
        mode: 'send',
        provider: 'official',
      }),
    ).resolves.toMatchObject({ status: 'failed' });

    expect(subject.candidateFlow.releaseAttempt).toHaveBeenCalledTimes(1);
    expect(subject.candidateFlow.releaseAttempt).toHaveBeenCalledWith({
      campaignId: 'campaign-1',
      executionId: 'execution-1',
    });
    expect(subject.executions.records[0].status).toBe('FAILED');
    expect(subject.confirmation.confirm).not.toHaveBeenCalled();
  });

  it('libera a reserva quando a readiness bloqueia depois do prepare', async () => {
    const subject = createSubject();
    subject.policy.evaluateAutomationReadiness
      .mockResolvedValueOnce({ allowed: true, reasons: [] })
      .mockResolvedValueOnce({ allowed: true, reasons: [] })
      .mockResolvedValueOnce({
        allowed: false,
        reasons: ['AUTOMATION_PAUSED'],
      });

    await expect(
      subject.orchestrator.executeTick({
        ...tick,
        mode: 'send',
        provider: 'official',
      }),
    ).resolves.toMatchObject({ status: 'blocked' });

    expect(subject.candidateFlow.releaseAttempt).toHaveBeenCalledTimes(1);
    expect(subject.candidateFlow.releaseAttempt).toHaveBeenCalledWith({
      campaignId: 'campaign-1',
      executionId: 'execution-1',
    });
    expect(subject.confirmation.confirm).not.toHaveBeenCalled();
  });

  it('libera a reserva quando revalidate falha antes da confirmacao', async () => {
    const subject = createSubject();
    subject.candidateFlow.revalidate.mockRejectedValue(
      new AppError('Grupo mudou', 'COMMERCIAL_GROUP_CHANGED'),
    );

    await expect(
      subject.orchestrator.executeTick({
        ...tick,
        mode: 'send',
        provider: 'official',
      }),
    ).resolves.toMatchObject({ status: 'failed' });

    expect(subject.candidateFlow.releaseAttempt).toHaveBeenCalledTimes(1);
    expect(subject.candidateFlow.releaseAttempt).toHaveBeenCalledWith({
      campaignId: 'campaign-1',
      executionId: 'execution-1',
    });
    expect(subject.confirmation.confirm).not.toHaveBeenCalled();
  });

  it('nao libera a reserva quando confirmation ja foi tentada e falha', async () => {
    const subject = createSubject();
    subject.confirmation.confirm.mockRejectedValue(new Error('timeout'));

    await expect(
      subject.orchestrator.executeTick({
        ...tick,
        mode: 'send',
        provider: 'official',
      }),
    ).resolves.toMatchObject({ status: 'failed' });

    expect(subject.confirmation.confirm).toHaveBeenCalledOnce();
    expect(subject.candidateFlow.releaseAttempt).not.toHaveBeenCalled();
  });

  it('trata release ja concluido como idempotente', async () => {
    const subject = createSubject();
    subject.candidateFlow.prepare.mockRejectedValue(new Error('prepare failed'));
    subject.candidateFlow.releaseAttempt.mockResolvedValue({
      kind: 'RELEASED',
      campaignId: 'campaign-1',
      executionId: 'execution-1',
      released: false,
    });

    await expect(
      subject.orchestrator.executeTick({
        ...tick,
        mode: 'send',
        provider: 'official',
      }),
    ).resolves.toMatchObject({ status: 'failed' });

    expect(subject.candidateFlow.releaseAttempt).toHaveBeenCalledOnce();
  });

  it('trata conflito de release fail-closed sem tocar owner alheio', async () => {
    const subject = createSubject();
    subject.candidateFlow.prepare.mockRejectedValue(new Error('prepare failed'));
    subject.candidateFlow.releaseAttempt.mockResolvedValue({
      kind: 'CONFLICT',
      campaignId: 'campaign-1',
      executionId: 'execution-1',
    });

    await expect(
      subject.orchestrator.executeTick({
        ...tick,
        mode: 'send',
        provider: 'official',
      }),
    ).resolves.toMatchObject({ status: 'failed' });

    expect(subject.candidateFlow.releaseAttempt).toHaveBeenCalledWith({
      campaignId: 'campaign-1',
      executionId: 'execution-1',
    });
    expect(subject.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'commercial-automation.attempt-release.blocked',
        reason: 'RESERVATION_OWNER_MISMATCH',
      }),
      expect.any(String),
    );
  });

  it('nao sincroniza Shopee quando a fila local ja resolve o slot', async () => {
    const subject = createSubject();

    await expect(
      subject.orchestrator.executeTick({ ...tick, mode: 'send', provider: 'official' }),
    ).resolves.toMatchObject({ status: 'queued' });

    expect(subject.candidateFlow.preflight).toHaveBeenCalledOnce();
    expect(subject.candidateFlow.replenish).not.toHaveBeenCalled();
    expect(subject.syncOffers.run).not.toHaveBeenCalled();
  });

  it('pagina sync de forma limitada somente apos fila e catalogo local esgotados', async () => {
    const subject = createSubject();
    subject.candidateFlow.preflight
      .mockResolvedValueOnce({ outcome: 'NO_CANDIDATE' })
      .mockResolvedValueOnce({ outcome: 'NO_CANDIDATE' })
      .mockResolvedValueOnce({ outcome: 'NO_CANDIDATE' })
      .mockResolvedValueOnce({
        outcome: 'READY',
        candidateId: 'candidate-page-2',
        candidateStatus: 'COPY_READY',
      });
    subject.syncOffers.run
      .mockResolvedValueOnce({ hasNextPage: true, page: 1, nextCursor: 'cursor-2' })
      .mockResolvedValueOnce({ hasNextPage: false, page: 2 });

    await expect(
      subject.orchestrator.executeTick({ ...tick, mode: 'send', provider: 'official' }),
    ).resolves.toMatchObject({ status: 'queued' });

    expect(subject.candidateFlow.replenish).toHaveBeenCalledTimes(3);
    expect(subject.syncOffers.run).toHaveBeenNthCalledWith(1, { page: 1 });
    expect(subject.syncOffers.run).toHaveBeenNthCalledWith(2, {
      page: 2,
      cursor: 'cursor-2',
    });
    expect(subject.candidateFlow.prepare).toHaveBeenCalledWith(
      expect.objectContaining({ candidateId: 'candidate-page-2' }),
      expect.anything(),
    );
  });

  it('passa um unico target deterministico ao preview sem confirmar', async () => {
    const targets: CommercialAutomationTarget[] = [
      {
        groupId: 'group-a',
        groupName: 'Grupo A',
        logicalGroupFingerprint: 'grp_aaaaaaaaaaaa',
        campaignId: 'campaign-a',
        nicheId: 'niche-a',
        dailyLimit: 60,
      },
      {
        groupId: 'group-b',
        groupName: 'Grupo B',
        logicalGroupFingerprint: 'grp_bbbbbbbbbbbb',
        campaignId: 'campaign-b',
        nicheId: 'niche-b',
        dailyLimit: 60,
      },
    ];
    const subject = createSubject({ targets });

    await expect(subject.orchestrator.executeTick(tick)).resolves.toMatchObject({
      status: 'preview-ready',
    });
    expect(subject.pipeline.dryRun).toHaveBeenCalledWith({
      executionId: 'execution-1',
      source: 'MOCK',
      campaign: 'commercial-automation',
      target: targets[0],
    });
    expect(subject.candidateFlow.prepare).not.toHaveBeenCalled();
    expect(subject.confirmation.confirm).not.toHaveBeenCalled();
  });

  it('ordena selecao, reserva e prepare sem abrir uma segunda selecao', async () => {
    const subject = createSubject();
    const order: string[] = [];
    subject.candidateFlow.preflight.mockImplementation(async () => {
      order.push('selection');
      return {
        outcome: 'READY',
        candidateId: 'candidate-1',
        candidateStatus: 'COPY_READY',
      };
    });
    subject.candidateFlow.reserveAttempt.mockImplementation(async () => {
      order.push('reserve');
      return {
        kind: 'RESERVED',
        campaignId: 'campaign-1',
        executionId: 'execution-1',
        reservedAt: NOW,
        leaseExpiresAt: new Date(NOW.getTime() + 120_000),
        acquired: true,
      };
    });
    subject.candidateFlow.prepare.mockImplementation(async () => {
      order.push('prepare');
      return {
        runId: 'run-1',
        generatedCopyId: 'copy-1',
        candidateId: 'candidate-1',
        campaignId: 'campaign-1',
        groupId: 'group-1',
        logicalGroupFingerprint: 'grp_aaaaaaaaaaaa',
        nicheId: 'niche-1',
      };
    });

    await expect(
      subject.orchestrator.executeTick({
        ...tick,
        mode: 'send',
        provider: 'official',
      }),
    ).resolves.toMatchObject({ status: 'queued' });

    expect(order).toEqual(['selection', 'reserve', 'prepare']);
    expect(subject.candidateFlow.reserveAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: 'campaign-1' }),
      {
        executionId: 'execution-1',
        reservedAt: NOW,
        leaseExpiresAt: new Date(NOW.getTime() + 120_000),
      },
    );
  });

  it('avanca para B quando A esta reservada por outro owner, sem compartilhar lock', async () => {
    const targets: CommercialAutomationTarget[] = ['a', 'b'].map((suffix) => ({
      groupId: `group-${suffix}`,
      groupName: `Grupo ${suffix.toUpperCase()}`,
      logicalGroupFingerprint: `grp_${suffix.repeat(12)}`,
      campaignId: `campaign-${suffix}`,
      nicheId: `niche-${suffix}`,
      dailyLimit: 60,
    }));
    const subject = createSubject({ targets });
    subject.candidateFlow.preflight.mockImplementation(async (target) => {
      return {
        outcome: 'READY',
        candidateId: `candidate-${target.campaignId}`,
        candidateStatus: 'COPY_READY',
      };
    });
    subject.candidateFlow.replenish.mockResolvedValue({ rejectionSummary: {} });
    subject.candidateFlow.reserveAttempt.mockImplementation(async (target, input) =>
      target.campaignId === 'campaign-a'
        ? {
            kind: 'CONFLICT',
            campaignId: target.campaignId,
            executionId: input.executionId,
          }
        : {
            kind: 'RESERVED',
            campaignId: target.campaignId,
            executionId: input.executionId,
            reservedAt: input.reservedAt,
            leaseExpiresAt: input.leaseExpiresAt,
            acquired: true,
          },
    );

    await expect(
      subject.orchestrator.executeTick({
        ...tick,
        mode: 'send',
        provider: 'official',
      }),
    ).resolves.toMatchObject({ status: 'queued' });

    expect(subject.candidateFlow.preflight).toHaveBeenCalledTimes(2);
    expect(subject.candidateFlow.preflight).toHaveBeenNthCalledWith(1, targets[0]);
    expect(subject.candidateFlow.preflight).toHaveBeenNthCalledWith(2, targets[1]);
    expect(subject.candidateFlow.replenish).not.toHaveBeenCalled();
    expect(subject.candidateFlow.reserveAttempt).toHaveBeenCalledTimes(2);
    expect(subject.candidateFlow.prepare).toHaveBeenCalledOnce();
    expect(subject.candidateFlow.prepare).toHaveBeenCalledWith(
      expect.objectContaining({ target: targets[1] }),
      expect.objectContaining({ executionId: 'execution-1' }),
    );
    expect(subject.confirmation.confirm).toHaveBeenCalledOnce();
  });

  it('prossegue quando a reserva ja pertence a mesma execution', async () => {
    const subject = createSubject();
    subject.candidateFlow.reserveAttempt.mockResolvedValue({
      kind: 'RESERVED',
      campaignId: 'campaign-1',
      executionId: 'execution-1',
      reservedAt: new Date('2026-08-08T11:59:00.000Z'),
      leaseExpiresAt: new Date('2026-08-08T12:02:00.000Z'),
      acquired: false,
    });

    await expect(
      subject.orchestrator.executeTick({
        ...tick,
        mode: 'send',
        provider: 'official',
      }),
    ).resolves.toMatchObject({ status: 'queued' });

    expect(subject.candidateFlow.prepare).toHaveBeenCalledOnce();
  });
});
