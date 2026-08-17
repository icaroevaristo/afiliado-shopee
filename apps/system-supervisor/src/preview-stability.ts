import { createHash } from 'node:crypto';
import { DEFAULT_COMMERCIAL_AUTOMATION_SCHEDULER_JOB_ID } from '@shopee-auto-affiliate-ai/queue';

import type { SystemStatusSnapshot } from './supervisor';
import {
  LocalSystemError,
  PREVIEW_STABILITY_PRISMA_VALIDATION,
  type ServiceName,
} from './types';

export const PREVIEW_STABILITY_CONFIRMATION =
  '--confirm-local-preview-stability-test';

export const PREVIEW_STABILITY_ENVIRONMENT = {
  COMMERCIAL_AUTOMATION_MODE: 'preview',
  COMMERCIAL_AUTOMATION_ENABLED: 'true',
  COMMERCIAL_SCHEDULER_ENABLED: 'true',
  COMMERCIAL_SCHEDULER_CRON: '*/1 * * * *',
  COMMERCIAL_SCHEDULER_TIMEZONE: 'America/Sao_Paulo',
  COMMERCIAL_ALLOWED_START_TIME: '00:00',
  COMMERCIAL_ALLOWED_END_TIME: '23:59',
  SCHEDULER_ENABLED: 'false',
  SHOPEE_AFFILIATE_PROVIDER: 'mock',
  WHATSAPP_PROVIDER: 'mock',
  WHATSAPP_GROUP_SEND_ENABLED: 'false',
} as const;

export const PREVIEW_STABILITY_CLEANUP_ENVIRONMENT = {
  ...PREVIEW_STABILITY_ENVIRONMENT,
  COMMERCIAL_SCHEDULER_ENABLED: 'false',
} as const;

export type PreviewExecutionEvidence = {
  id: string;
  bullMqJobId: string | null;
  status:
    'STARTED' | 'BLOCKED' | 'PREVIEW_READY' | 'QUEUED' | 'FAILED' | 'AMBIGUOUS';
  stale: boolean;
};

export type PreviewStabilityEvidence = {
  migrations: {
    applied: number;
    failed: number;
    pending: number;
    unexpected: number;
    baselineRegistered: boolean;
    schemaMatchesCurrent: boolean;
  };
  settings: { present: boolean; paused: boolean };
  executions: PreviewExecutionEvidence[];
  runs: {
    total: number;
    dryRun: number;
    ambiguous: number;
    investigationRequired: number;
  };
  dispatches: { total: number; processing: number };
  outboxes: { total: number; pending: number; ambiguous: number };
  queues: {
    commercialJobIds: string[];
    whatsappJobIds: string[];
    productJobIds: string[];
    commercialSchedulerIds: string[];
    legacySchedulerIds: string[];
  };
  tableCounts: Record<string, number>;
};

export type PreviewStabilityInfrastructure = {
  volumeCount: number;
  volumeFingerprint: string;
  containers: Record<string, string>;
  envFingerprint: string;
};

export type PreviewStabilityTopologyDiagnostic = {
  topologyStage: 'startSystem' | 'requireRunning' | 'scheduled-preview';
  component:
    | 'api'
    | 'dashboard'
    | 'commercial-worker'
    | 'dispatch-worker'
    | 'commercial-scheduler'
    | 'legacy-scheduler'
    | 'docker'
    | 'ports'
    | 'unknown';
  observedState:
    | 'running'
    | 'stopped'
    | 'unavailable'
    | 'unhealthy'
    | 'starting'
    | 'unknown';
  expectedState: 'running' | 'stopped' | 'not-required';
};

export type PreviewStabilityMainInfrastructureDiagnostic = {
  mainInfraStage: 'resolve' | 'stop' | 'start' | 'health';
  service: 'postgres' | 'redis';
  operation: 'restart';
  commandKind: 'discovery' | 'container' | 'compose';
  errorCode:
    | 'OWNERSHIP_UNPROVEN'
    | 'AMBIGUOUS_OWNERSHIP'
    | 'COMMAND_FAILED'
    | 'HEALTH_TIMEOUT'
    | 'UNEXPECTED_STATE';
  observedHealth: 'healthy' | 'starting' | 'unhealthy' | 'unavailable' | 'unknown';
  expectedHealth: 'healthy';
};

export type PreviewStabilityReport = {
  startedAt: string;
  completedAt: string;
  durationMs: number;
  status: 'completed' | 'failed';
  scenarios: Array<{
    name: string;
    status: 'completed' | 'failed';
    durationMs: number;
  }>;
  ticksObserved: number;
  failuresInjected: string[];
  recoveries: string[];
  deltas: {
    executions: number;
    runs: number;
    dispatches: number;
    outboxes: number;
    commercialJobs: number;
    whatsappJobs: number;
    productJobs: number;
    tables: Record<string, number>;
  };
  invariants: Record<string, boolean>;
  finalState: {
    system: SystemStatusSnapshot['overall'];
    operationLock: SystemStatusSnapshot['operationLock'];
    automationPaused: boolean;
    legacyScheduler: string;
    commercialScheduler: string;
    managedProcessesActive: number;
    volumesPreserved: boolean;
  };
  bugs: Array<{ severity: 'P0' | 'P1' | 'P2' | 'P3'; code: string }>;
  topologyDiagnostic?: PreviewStabilityTopologyDiagnostic;
  mainInfrastructureDiagnostic?: PreviewStabilityMainInfrastructureDiagnostic;
  failureCode?: string;
};

export type PreviewStabilityDependencies = {
  now(): Date;
  sleep(milliseconds: number): Promise<void>;
  status(environment: NodeJS.ProcessEnv): Promise<SystemStatusSnapshot>;
  prepareMainInfrastructure(
    environment: NodeJS.ProcessEnv,
    reuseManagedInfrastructure: boolean,
  ): Promise<void>;
  stopMainInfrastructure(environment: NodeJS.ProcessEnv): Promise<void>;
  startSystem(environment: NodeJS.ProcessEnv): Promise<SystemStatusSnapshot>;
  stopSystem(environment: NodeJS.ProcessEnv): Promise<void>;
  setAutomationPaused(
    paused: boolean,
    environment: NodeJS.ProcessEnv,
  ): Promise<void>;
  forceAutomationPaused(environment: NodeJS.ProcessEnv): Promise<void>;
  resolvePreviewGroupInstance(environment: NodeJS.ProcessEnv): Promise<string>;
  captureEvidence(
    environment: NodeJS.ProcessEnv,
  ): Promise<PreviewStabilityEvidence>;
  captureExecutions(
    environment: NodeJS.ProcessEnv,
  ): Promise<PreviewExecutionEvidence[]>;
  captureInfrastructure(
    environment: NodeJS.ProcessEnv,
  ): Promise<PreviewStabilityInfrastructure>;
  killManagedProcess(
    service: Extract<ServiceName, 'api' | 'commercial-worker'>,
  ): Promise<void>;
  restartMainService(
    service: 'redis' | 'postgres',
    environment: NodeJS.ProcessEnv,
  ): Promise<{ unavailableMs: number }>;
  waitForSafeTickGap(
    minimumMilliseconds: number,
    environment: NodeJS.ProcessEnv,
  ): Promise<number>;
  writeReport(report: PreviewStabilityReport): Promise<void>;
};

const normalizedArgs = (args: readonly string[]) => {
  const separators = args.filter((argument) => argument === '--').length;
  const values = args.filter((argument) => argument !== '--');
  if (separators > 1) return [];
  return values;
};

export const parsePreviewStabilityArgs = (args: readonly string[]) => {
  const normalized = normalizedArgs(args);
  if (
    normalized.length !== 1 ||
    normalized[0] !== PREVIEW_STABILITY_CONFIRMATION
  ) {
    throw new LocalSystemError(
      'Confirme exatamente o teste local de estabilidade em preview',
      'PREVIEW_STABILITY_CONFIRMATION_REQUIRED',
    );
  }
};

export const assertLocalPreviewStabilityRuntime = (
  environment: NodeJS.ProcessEnv,
) => {
  if (environment.CI && environment.CI.toLowerCase() !== 'false') {
    throw new LocalSystemError(
      'O teste de estabilidade nao pode executar em CI',
      'PREVIEW_STABILITY_CI_BLOCKED',
    );
  }
};

const idSet = (values: readonly string[]) => new Set(values);
const newValues = (before: readonly string[], after: readonly string[]) => {
  const existing = idSet(before);
  return after.filter((value) => !existing.has(value));
};

const duplicateBullMqJobIds = (executions: PreviewExecutionEvidence[]) => {
  const seen = new Set<string>();
  for (const execution of executions) {
    if (!execution.bullMqJobId) continue;
    if (seen.has(execution.bullMqJobId)) return true;
    seen.add(execution.bullMqJobId);
  }
  return false;
};

export const assertSafePreflightEvidence = (
  evidence: PreviewStabilityEvidence,
) => {
  if (
    evidence.migrations.failed > 0 ||
    evidence.migrations.pending > 0 ||
    evidence.migrations.unexpected > 0 ||
    !evidence.migrations.baselineRegistered ||
    !evidence.migrations.schemaMatchesCurrent
  ) {
    throw new LocalSystemError(
      'Historico Prisma ou baseline nao esta saudavel',
      'PREVIEW_STABILITY_MIGRATIONS_UNSAFE',
    );
  }
  if (!evidence.settings.present || !evidence.settings.paused) {
    throw new LocalSystemError(
      'A automacao comercial deve estar pausada antes do teste',
      'PREVIEW_STABILITY_AUTOMATION_NOT_PAUSED',
    );
  }
  if (
    evidence.executions.some(
      (execution) =>
        execution.status === 'STARTED' || execution.status === 'AMBIGUOUS',
    ) ||
    evidence.runs.ambiguous > 0 ||
    evidence.runs.investigationRequired > 0 ||
    evidence.outboxes.pending > 0 ||
    evidence.outboxes.ambiguous > 0 ||
    evidence.dispatches.processing > 0
  ) {
    throw new LocalSystemError(
      'Estado comercial inseguro exige investigacao manual',
      'PREVIEW_STABILITY_COMMERCIAL_STATE_UNSAFE',
    );
  }
  if (duplicateBullMqJobIds(evidence.executions)) {
    throw new LocalSystemError(
      'Identidade BullMQ das execucoes existentes nao e integra',
      'PREVIEW_STABILITY_EXECUTION_IDENTITY_UNSAFE',
    );
  }
  if (evidence.queues.legacySchedulerIds.length > 0) {
    throw new LocalSystemError(
      'Scheduler legado deve permanecer removido',
      'PREVIEW_STABILITY_LEGACY_SCHEDULER_PRESENT',
    );
  }
  if (evidence.queues.commercialSchedulerIds.length > 0) {
    throw new LocalSystemError(
      'Scheduler comercial deve estar removido antes do teste',
      'PREVIEW_STABILITY_COMMERCIAL_SCHEDULER_PRESENT',
    );
  }
};

export const evaluateEvidenceInvariants = (
  before: PreviewStabilityEvidence,
  after: PreviewStabilityEvidence,
) => {
  const baselineExecutionIds = idSet(
    before.executions.map((execution) => execution.id),
  );
  const newExecutions = after.executions.filter(
    (execution) => !baselineExecutionIds.has(execution.id),
  );
  return {
    noDispatchCreated: after.dispatches.total === before.dispatches.total,
    noOutboxCreated: after.outboxes.total === before.outboxes.total,
    noWhatsappJobCreated:
      newValues(before.queues.whatsappJobIds, after.queues.whatsappJobIds)
        .length === 0,
    noProductJobCreated:
      newValues(before.queues.productJobIds, after.queues.productJobIds)
        .length === 0,
    noStartedExecution: !newExecutions.some(
      (execution) => execution.status === 'STARTED',
    ),
    noStaleExecution: !newExecutions.some((execution) => execution.stale),
    noAmbiguousExecution:
      after.runs.ambiguous === before.runs.ambiguous &&
      after.runs.investigationRequired === before.runs.investigationRequired &&
      !newExecutions.some((execution) => execution.status === 'AMBIGUOUS'),
    allNewExecutionsAreValidPreviews: newExecutions.every(
      (execution) =>
        execution.status === 'PREVIEW_READY' && Boolean(execution.bullMqJobId),
    ),
    noProcessingDispatch:
      after.dispatches.processing === before.dispatches.processing,
    noPendingOrAmbiguousOutbox:
      after.outboxes.pending === before.outboxes.pending &&
      after.outboxes.ambiguous === before.outboxes.ambiguous,
    noDuplicateBullMqJobId: !duplicateBullMqJobIds(after.executions),
    atMostOneCommercialScheduler:
      after.queues.commercialSchedulerIds.length <= 1,
  };
};

export const assertEvidenceInvariants = (
  before: PreviewStabilityEvidence,
  after: PreviewStabilityEvidence,
) => {
  const checks = evaluateEvidenceInvariants(before, after);
  if (Object.values(checks).some((value) => !value)) {
    throw new LocalSystemError(
      'Uma invariante proibida divergiu durante o teste',
      'PREVIEW_STABILITY_INVARIANT_VIOLATION',
    );
  }
  return checks;
};

const completedPreviewCount = (
  before: PreviewStabilityEvidence,
  after: PreviewStabilityEvidence,
) => {
  const initial = idSet(before.executions.map((execution) => execution.id));
  return after.executions.filter(
    (execution) =>
      !initial.has(execution.id) && execution.status === 'PREVIEW_READY',
  ).length;
};

export const assertPausedStartupEvidence = (
  before: PreviewStabilityEvidence,
  after: PreviewStabilityEvidence,
) => {
  const beforeExecutionIds = idSet(before.executions.map((execution) => execution.id));
  const newExecutions = after.executions.filter(
    (execution) => !beforeExecutionIds.has(execution.id),
  );
  const newCommercialJobs = newValues(
    before.queues.commercialJobIds,
    after.queues.commercialJobIds,
  );
  const unsafe =
    !after.settings.present ||
    !after.settings.paused ||
    newExecutions.length > 1 ||
    newExecutions.some(
      (execution) =>
        execution.status !== 'BLOCKED' ||
        !execution.bullMqJobId ||
        execution.stale,
    ) ||
    newCommercialJobs.length > 1 ||
    after.runs.total !== before.runs.total ||
    after.runs.dryRun !== before.runs.dryRun ||
    after.dispatches.total !== before.dispatches.total ||
    after.dispatches.processing !== before.dispatches.processing ||
    after.outboxes.total !== before.outboxes.total ||
    after.outboxes.pending !== before.outboxes.pending ||
    after.outboxes.ambiguous !== before.outboxes.ambiguous ||
    newValues(before.queues.whatsappJobIds, after.queues.whatsappJobIds).length > 0 ||
    newValues(before.queues.productJobIds, after.queues.productJobIds).length > 0 ||
    after.queues.legacySchedulerIds.length > 0 ||
    duplicateBullMqJobIds(after.executions);
  if (unsafe) {
    throw new LocalSystemError(
      'O startup pausado criou estado comercial inesperado',
      'PREVIEW_STABILITY_PAUSED_STARTUP_UNSAFE',
    );
  }
};

export const assertNoBootstrapTick = (
  before: PreviewStabilityEvidence,
  after: PreviewStabilityEvidence,
  expectedScheduledAt: number,
) => {
  const expectedJobId = `repeat:${DEFAULT_COMMERCIAL_AUTOMATION_SCHEDULER_JOB_ID}:${expectedScheduledAt}`;
  const created = newValues(
    before.executions.map((execution) => execution.id),
    after.executions.map((execution) => execution.id),
  ).map((id) => after.executions.find((execution) => execution.id === id)!);
  if (
    created.length > 1 ||
    created.some((execution) => execution.bullMqJobId !== expectedJobId)
  ) {
    throw new LocalSystemError(
      'O bootstrap criou uma execucao comercial inesperada',
      'PREVIEW_STABILITY_BOOTSTRAP_TICK_DETECTED',
    );
  }
};

const waitForPreviewCount = async (
  dependencies: PreviewStabilityDependencies,
  environment: NodeJS.ProcessEnv,
  baseline: PreviewStabilityEvidence,
  target: number,
  timeoutMs: number,
  assertNotInterrupted: () => void,
) => {
  const baselineExecutionIds = idSet(
    baseline.executions.map((execution) => execution.id),
  );
  const deadline = dependencies.now().getTime() + timeoutMs;
  while (dependencies.now().getTime() < deadline) {
    assertNotInterrupted();
    const executions = await dependencies.captureExecutions(environment);
    const newExecutions = executions.filter(
      (execution) => !baselineExecutionIds.has(execution.id),
    );
    if (
      newExecutions.some(
        (execution) =>
          !execution.bullMqJobId ||
          execution.stale ||
          execution.status === 'FAILED' ||
          execution.status === 'BLOCKED' ||
          execution.status === 'QUEUED' ||
          execution.status === 'AMBIGUOUS',
      ) ||
      duplicateBullMqJobIds(executions)
    ) {
      throw new LocalSystemError(
        'Tick agendado nao terminou como preview',
        'PREVIEW_STABILITY_TICK_FAILED',
      );
    }
    if (
      newExecutions.filter((execution) => execution.status === 'PREVIEW_READY')
        .length >= target
    ) {
      const evidence = await dependencies.captureEvidence(environment);
      assertEvidenceInvariants(baseline, evidence);
      return evidence;
    }
    await dependencies.sleep(2_000);
  }
  assertNotInterrupted();
  throw new LocalSystemError(
    'Tempo limite aguardando previews agendados',
    'PREVIEW_STABILITY_TICK_TIMEOUT',
  );
};

const hasReusableManagedMainInfrastructure = (status: SystemStatusSnapshot) => {
  const allowedServices = new Set(['postgres', 'redis']);
  return (
    status.docker.services.length === allowedServices.size &&
    status.docker.services.every(
      (service) =>
        allowedServices.has(service.service) &&
        service.state === 'running' &&
        service.health === 'healthy',
    ) &&
    [...allowedServices].every((service) =>
      status.docker.services.some((candidate) => candidate.service === service),
    )
  );
};

const hasNoActiveShopeeRuntime = (status: SystemStatusSnapshot) =>
  Object.values(status.processes).every(
    (processStatus) =>
      processStatus === 'stopped' || processStatus === 'not-required',
  ) &&
  status.endpoints.api === 'unavailable' &&
  status.endpoints.dashboard === 'unavailable' &&
  status.schedulers.legacy.enabled !== true &&
  status.schedulers.legacy.status !== 'registered' &&
  status.schedulers.commercial.enabled !== true &&
  status.schedulers.commercial.status !== 'registered';

const isReusableInfrastructureOnlyPartial = (status: SystemStatusSnapshot) =>
  status.overall === 'partial' &&
  status.mode === 'preview' &&
  hasReusableManagedMainInfrastructure(status) &&
  hasNoActiveShopeeRuntime(status);

const hasFinalSchedulersDisabled = (status: SystemStatusSnapshot) =>
  status.schedulers.legacy.enabled !== true &&
  (status.schedulers.legacy.status === 'disabled' ||
    status.schedulers.legacy.status === 'unavailable') &&
  status.schedulers.commercial.enabled !== true &&
  (status.schedulers.commercial.status === 'disabled' ||
    status.schedulers.commercial.status === 'unavailable');

const hasNoObservedEvolutionRuntime = (status: SystemStatusSnapshot) =>
  status.evolution.api === 'unavailable' &&
  status.evolution.services.every((service) => service.state !== 'running');

export const isSafePreviewStabilityFinalState = (input: {
  status: SystemStatusSnapshot | undefined;
  automationPaused: boolean;
  legacySchedulerIds: number;
  commercialSchedulerIds: number;
  managedProcessesActive: number;
  volumesPreserved: boolean;
}) => {
  const status = input.status;
  if (!status) return false;
  const aggregateStateAllowed =
    status.overall === 'stopped' || status.overall === 'partial';
  return (
    aggregateStateAllowed &&
    status.mode === 'preview' &&
    status.operationLock === 'unlocked' &&
    status.docker.daemon === 'available' &&
    hasReusableManagedMainInfrastructure(status) &&
    hasNoActiveShopeeRuntime(status) &&
    hasFinalSchedulersDisabled(status) &&
    hasNoObservedEvolutionRuntime(status) &&
    status.externalPortOccupants.length === 0 &&
    input.automationPaused &&
    input.legacySchedulerIds === 0 &&
    input.commercialSchedulerIds === 0 &&
    input.managedProcessesActive === 0 &&
    input.volumesPreserved
  );
};

const requireStoppedPreflight = (status: SystemStatusSnapshot) => {
  if (
    status.overall !== 'stopped' &&
    !isReusableInfrastructureOnlyPartial(status)
  ) {
    throw new LocalSystemError(
      'O sistema deve estar completamente parado antes do teste',
      'PREVIEW_STABILITY_SYSTEM_ALREADY_ACTIVE',
    );
  }
  if (status.operationLock !== 'unlocked') {
    throw new LocalSystemError(
      'O lock operacional deve estar livre',
      'PREVIEW_STABILITY_OPERATION_LOCKED',
    );
  }
  if (status.docker.daemon !== 'available') {
    throw new LocalSystemError(
      'Docker daemon indisponivel',
      'DOCKER_DAEMON_UNAVAILABLE',
    );
  }
  if (status.externalPortOccupants.length > 0) {
    throw new LocalSystemError(
      'Porta operacional ocupada externamente',
      'PREVIEW_STABILITY_EXTERNAL_PORT_OCCUPIED',
    );
  }
};

const observedProcessState = (
  state: SystemStatusSnapshot['processes'][keyof SystemStatusSnapshot['processes']],
): PreviewStabilityTopologyDiagnostic['observedState'] => {
  if (state === 'running' || state === 'stopped') return state;
  if (state === 'not-required') return 'unavailable';
  return 'unknown';
};

export const diagnoseRunningTopology = (
  status: SystemStatusSnapshot,
): PreviewStabilityTopologyDiagnostic | null => {
  if (status.operationLock !== 'unlocked' || status.mode !== 'preview') {
    return {
      topologyStage: 'requireRunning',
      component: 'unknown',
      observedState: 'unknown',
      expectedState: 'running',
    };
  }

  if (status.overall !== 'running') {
    const mainInfrastructureHealthy = ['postgres', 'redis'].every((service) =>
      status.docker.services.some(
        (item) =>
          item.service === service &&
          item.state === 'running' &&
          item.health === 'healthy',
      ),
    );
    if (!mainInfrastructureHealthy) {
      return {
        topologyStage: 'requireRunning',
        component: 'docker',
        observedState: 'unhealthy',
        expectedState: 'running',
      };
    }
    if (status.processes.api !== 'running') {
      return {
        topologyStage: 'requireRunning',
        component: 'api',
        observedState: observedProcessState(status.processes.api),
        expectedState: 'running',
      };
    }
    if (status.endpoints.api !== 'available') {
      return {
        topologyStage: 'requireRunning',
        component: 'api',
        observedState: 'unhealthy',
        expectedState: 'running',
      };
    }
    if (status.processes.dashboard !== 'running') {
      return {
        topologyStage: 'requireRunning',
        component: 'dashboard',
        observedState: observedProcessState(status.processes.dashboard),
        expectedState: 'running',
      };
    }
    if (status.endpoints.dashboard !== 'available') {
      return {
        topologyStage: 'requireRunning',
        component: 'dashboard',
        observedState: 'unhealthy',
        expectedState: 'running',
      };
    }
    if (status.processes['commercial-worker'] !== 'running') {
      return {
        topologyStage: 'requireRunning',
        component: 'commercial-worker',
        observedState: observedProcessState(status.processes['commercial-worker']),
        expectedState: 'running',
      };
    }
    if (
      !status.schedulers.commercial.enabled ||
      status.schedulers.commercial.status !== 'registered'
    ) {
      return {
        topologyStage: 'requireRunning',
        component: 'commercial-scheduler',
        observedState:
          status.schedulers.commercial.status === 'unavailable'
            ? 'unavailable'
            : status.schedulers.commercial.status === 'registered'
              ? 'running'
              : 'stopped',
        expectedState: 'running',
      };
    }
  }

  if (status.schedulers.legacy.status !== 'disabled') {
    return {
      topologyStage: 'requireRunning',
      component: 'legacy-scheduler',
      observedState:
        status.schedulers.legacy.status === 'registered'
          ? 'running'
          : status.schedulers.legacy.status === 'unavailable'
            ? 'unavailable'
            : 'stopped',
      expectedState: 'not-required',
    };
  }
  if (status.processes['whatsapp-dispatch-worker'] !== 'not-required') {
    return {
      topologyStage: 'requireRunning',
      component: 'dispatch-worker',
      observedState: observedProcessState(
        status.processes['whatsapp-dispatch-worker'],
      ),
      expectedState: 'not-required',
    };
  }
  if (status.overall === 'running') return null;
  return {
    topologyStage: 'requireRunning',
    component: 'unknown',
    observedState: status.overall === 'stopped' ? 'stopped' : 'unhealthy',
    expectedState: 'running',
  };
};

class PreviewStabilityTopologyError extends LocalSystemError {
  constructor(readonly diagnostic: PreviewStabilityTopologyDiagnostic) {
    super(
      'Topologia preview nao esta integralmente saudavel',
      'PREVIEW_STABILITY_TOPOLOGY_UNHEALTHY',
    );
    this.name = 'PreviewStabilityTopologyError';
  }
}

export class PreviewStabilityMainInfrastructureError extends LocalSystemError {
  constructor(
    code: string,
    readonly diagnostic: PreviewStabilityMainInfrastructureDiagnostic,
  ) {
    super('Falha controlada na infraestrutura principal do preview', code);
    this.name = 'PreviewStabilityMainInfrastructureError';
  }
}

const requireRunning = (status: SystemStatusSnapshot) => {
  const diagnostic = diagnoseRunningTopology(status);
  if (diagnostic) throw new PreviewStabilityTopologyError(diagnostic);
};

const requireExactlyOneCommercialScheduler = (
  evidence: PreviewStabilityEvidence,
) => {
  if (
    evidence.queues.commercialSchedulerIds.length !== 1 ||
    evidence.queues.commercialSchedulerIds[0] !==
      DEFAULT_COMMERCIAL_AUTOMATION_SCHEDULER_JOB_ID
  ) {
    throw new LocalSystemError(
      'Scheduler comercial registrado em quantidade inesperada',
      'PREVIEW_STABILITY_SCHEDULER_COUNT_INVALID',
    );
  }
};

const managedProcessCount = (status: SystemStatusSnapshot) =>
  Object.values(status.processes).filter((value) => value === 'running').length;

const delta = (before: number, after: number) => after - before;

const tableDeltas = (
  before: Record<string, number>,
  after: Record<string, number>,
) =>
  Object.fromEntries(
    [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .sort()
      .map((table) => [table, delta(before[table] ?? 0, after[table] ?? 0)]),
  );

const safeCode = (error: unknown) =>
  error instanceof LocalSystemError
    ? error.code
    : 'PREVIEW_STABILITY_UNEXPECTED_FAILURE';

export const sanitizePreviewStabilityReport = (
  report: PreviewStabilityReport,
) =>
  ({
    startedAt: report.startedAt,
    completedAt: report.completedAt,
    durationMs: report.durationMs,
    status: report.status,
    scenarios: report.scenarios.map(({ name, status, durationMs }) => ({
      name,
      status,
      durationMs,
    })),
    ticksObserved: report.ticksObserved,
    failuresInjected: [...report.failuresInjected],
    recoveries: [...report.recoveries],
    deltas: {
      executions: report.deltas.executions,
      runs: report.deltas.runs,
      dispatches: report.deltas.dispatches,
      outboxes: report.deltas.outboxes,
      commercialJobs: report.deltas.commercialJobs,
      whatsappJobs: report.deltas.whatsappJobs,
      productJobs: report.deltas.productJobs,
      tables: { ...report.deltas.tables },
    },
    invariants: { ...report.invariants },
    finalState: { ...report.finalState },
    bugs: report.bugs.map(({ severity, code }) => ({ severity, code })),
    ...(report.topologyDiagnostic
      ? {
          topologyDiagnostic: {
            topologyStage: report.topologyDiagnostic.topologyStage,
            component: report.topologyDiagnostic.component,
            observedState: report.topologyDiagnostic.observedState,
            expectedState: report.topologyDiagnostic.expectedState,
          },
        }
      : {}),
    ...(report.mainInfrastructureDiagnostic
      ? {
          mainInfrastructureDiagnostic: {
            mainInfraStage: report.mainInfrastructureDiagnostic.mainInfraStage,
            service: report.mainInfrastructureDiagnostic.service,
            operation: report.mainInfrastructureDiagnostic.operation,
            commandKind: report.mainInfrastructureDiagnostic.commandKind,
            errorCode: report.mainInfrastructureDiagnostic.errorCode,
            observedHealth: report.mainInfrastructureDiagnostic.observedHealth,
            expectedHealth: report.mainInfrastructureDiagnostic.expectedHealth,
          },
        }
      : {}),
    ...(report.failureCode ? { failureCode: report.failureCode } : {}),
  }) satisfies PreviewStabilityReport;

type SignalRuntime = {
  once(signal: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
  off(signal: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
};

export const installPreviewStabilitySignalCleanup = (
  requestInterruption: (exitCode: 130 | 143) => void,
  runtime: SignalRuntime = process,
) => {
  const handler = (exitCode: 130 | 143) => () => requestInterruption(exitCode);
  const onSigint = handler(130);
  const onSigterm = handler(143);
  runtime.once('SIGINT', onSigint);
  runtime.once('SIGTERM', onSigterm);
  return () => {
    runtime.off('SIGINT', onSigint);
    runtime.off('SIGTERM', onSigterm);
  };
};

export const runPreviewStabilityValidation = async ({
  args,
  processEnvironment,
  dependencies,
  signalRuntime = process,
}: {
  args: readonly string[];
  processEnvironment: NodeJS.ProcessEnv;
  dependencies: PreviewStabilityDependencies;
  signalRuntime?: SignalRuntime;
}) => {
  parsePreviewStabilityArgs(args);
  assertLocalPreviewStabilityRuntime(processEnvironment);
  let environment: NodeJS.ProcessEnv = {
    ...processEnvironment,
    ...PREVIEW_STABILITY_ENVIRONMENT,
  };
  let cleanupEnvironment: NodeJS.ProcessEnv = {
    ...processEnvironment,
    ...PREVIEW_STABILITY_CLEANUP_ENVIRONMENT,
  };
  const startedAt = dependencies.now();
  const scenarios: PreviewStabilityReport['scenarios'] = [];
  const failuresInjected: string[] = [];
  const recoveries: string[] = [];
  const bugs: PreviewStabilityReport['bugs'] = [
    {
      severity: 'P1',
      code: 'SYSTEM_PARTIAL_RESTART_PRISMA_GENERATE_CONFLICT',
    },
    {
      severity: 'P1',
      code: 'SYSTEM_MANAGED_CHILD_PORT_OWNERSHIP_FALSE_POSITIVE',
    },
  ];
  let initialEvidence: PreviewStabilityEvidence | undefined;
  let operationalBaseline: PreviewStabilityEvidence | undefined;
  let latestEvidence: PreviewStabilityEvidence | undefined;
  let initialInfrastructure: PreviewStabilityInfrastructure | undefined;
  let finalInfrastructure: PreviewStabilityInfrastructure | undefined;
  let finalStatus: SystemStatusSnapshot | undefined;
  let failureCode: string | undefined;
  let topologyDiagnostic: PreviewStabilityTopologyDiagnostic | undefined;
  let mainInfrastructureDiagnostic:
    | PreviewStabilityMainInfrastructureDiagnostic
    | undefined;
  let infrastructurePrepared = false;
  let restorationRequired = false;
  let cleanupPromise: Promise<void> | undefined;
  let restorationFinalStopCompleted = false;
  let interruptionCode:
    | 'PREVIEW_STABILITY_INTERRUPTED_SIGINT'
    | 'PREVIEW_STABILITY_INTERRUPTED_SIGTERM'
    | undefined;

  const assertNotInterrupted = () => {
    if (interruptionCode) {
      throw new LocalSystemError(
        'Validacao de estabilidade interrompida por sinal',
        interruptionCode,
      );
    }
  };

  const scenario = async (name: string, operation: () => Promise<void>) => {
    const scenarioStartedAt = dependencies.now();
    try {
      assertNotInterrupted();
      await operation();
      assertNotInterrupted();
      scenarios.push({
        name,
        status: 'completed',
        durationMs: dependencies.now().getTime() - scenarioStartedAt.getTime(),
      });
    } catch (error) {
      scenarios.push({
        name,
        status: 'failed',
        durationMs: dependencies.now().getTime() - scenarioStartedAt.getTime(),
      });
      throw error;
    }
  };

  const cleanup = () => {
    cleanupPromise ??= (async () => {
      if (!restorationRequired) {
        finalStatus = await dependencies.status(cleanupEnvironment);
        finalInfrastructure =
          await dependencies.captureInfrastructure(cleanupEnvironment);
        return;
      }
      try {
        const current = await dependencies.status(cleanupEnvironment);
        if (current.overall !== 'stopped') {
          await dependencies
            .setAutomationPaused(true, cleanupEnvironment)
            .catch(() =>
              dependencies.forceAutomationPaused(cleanupEnvironment),
            );
          await dependencies.stopSystem(cleanupEnvironment);
        } else if (infrastructurePrepared) {
          await dependencies
            .forceAutomationPaused(cleanupEnvironment)
            .catch(() => undefined);
        }

        await dependencies.startSystem(cleanupEnvironment);
        await dependencies
          .setAutomationPaused(true, cleanupEnvironment)
          .catch(() => dependencies.forceAutomationPaused(cleanupEnvironment));
        latestEvidence = await dependencies.captureEvidence(cleanupEnvironment);
        if (
          latestEvidence.queues.commercialSchedulerIds.length !== 0 ||
          latestEvidence.queues.legacySchedulerIds.length !== 0
        ) {
          throw new LocalSystemError(
            'Scheduler conhecido permaneceu registrado no cleanup',
            'PREVIEW_STABILITY_CLEANUP_SCHEDULER_PRESENT',
          );
        }
        await dependencies.stopSystem(cleanupEnvironment);
        restorationFinalStopCompleted = true;
        infrastructurePrepared = false;
      } finally {
        let finalStopError: unknown;
        if (!restorationFinalStopCompleted) {
          try {
            await dependencies.stopSystem(cleanupEnvironment);
            restorationFinalStopCompleted = true;
          } catch (error) {
            finalStopError = error;
            if (infrastructurePrepared) {
              await dependencies
                .stopMainInfrastructure(cleanupEnvironment)
                .catch(() => undefined);
            }
          }
        }
        infrastructurePrepared = false;
        finalStatus = await dependencies.status(cleanupEnvironment);
        finalInfrastructure =
          await dependencies.captureInfrastructure(cleanupEnvironment);
        if (finalStopError) throw finalStopError;
      }
    })();
    return cleanupPromise;
  };

  const removeSignalCleanup = installPreviewStabilitySignalCleanup(
    (exitCode) => {
      interruptionCode =
        exitCode === 130
          ? 'PREVIEW_STABILITY_INTERRUPTED_SIGINT'
          : 'PREVIEW_STABILITY_INTERRUPTED_SIGTERM';
      failureCode ??= interruptionCode;
    },
    signalRuntime,
  );
  try {
    await scenario('initial-state', async () => {
      const status = await dependencies.status(environment);
      requireStoppedPreflight(status);
      initialInfrastructure =
        await dependencies.captureInfrastructure(environment);
      restorationRequired = true;
      infrastructurePrepared = true;
      await dependencies.prepareMainInfrastructure(
        environment,
        hasReusableManagedMainInfrastructure(status),
      );
      const previewGroupInstance =
        await dependencies.resolvePreviewGroupInstance(environment);
      environment = {
        ...environment,
        EVOLUTION_INSTANCE_NAME: previewGroupInstance,
      };
      cleanupEnvironment = {
        ...cleanupEnvironment,
        EVOLUTION_INSTANCE_NAME: previewGroupInstance,
      };
      initialEvidence = await dependencies.captureEvidence(environment);
      assertSafePreflightEvidence(initialEvidence);
      environment = {
        ...environment,
        [PREVIEW_STABILITY_PRISMA_VALIDATION]: 'true',
      };
      cleanupEnvironment = {
        ...cleanupEnvironment,
        [PREVIEW_STABILITY_PRISMA_VALIDATION]: 'true',
      };
    });
    const baseline = initialEvidence;
    if (!baseline) {
      throw new LocalSystemError(
        'Evidencia inicial nao foi capturada',
        'PREVIEW_STABILITY_BASELINE_MISSING',
      );
    }

    await scenario('scheduled-preview', async () => {
      const status = await dependencies.startSystem(environment);
      requireRunning(status);
      infrastructurePrepared = false;
      const startupEvidence = await dependencies.captureEvidence(environment);
      assertPausedStartupEvidence(baseline, startupEvidence);
      requireExactlyOneCommercialScheduler(startupEvidence);
      operationalBaseline = startupEvidence;
      await dependencies.setAutomationPaused(false, environment);
      const schedulerEvidence = await dependencies.captureEvidence(environment);
      if (!schedulerEvidence.settings.present || schedulerEvidence.settings.paused) {
        throw new LocalSystemError(
          'A automacao comercial permaneceu pausada apos a retomada',
          'PREVIEW_STABILITY_PAUSE_UPDATE_FAILED',
        );
      }
      requireExactlyOneCommercialScheduler(schedulerEvidence);
      latestEvidence = await waitForPreviewCount(
        dependencies,
        environment,
        startupEvidence,
        3,
        300_000,
        assertNotInterrupted,
      );
    });
    const runtimeBaseline = operationalBaseline ?? baseline;

    await scenario('commercial-worker-abrupt-stop', async () => {
      await dependencies.killManagedProcess('commercial-worker');
      failuresInjected.push('commercial-worker-stopped');
      const partial = await dependencies.status(environment);
      if (partial.overall !== 'partial') {
        throw new LocalSystemError(
          'Queda do worker nao foi refletida como estado parcial',
          'PREVIEW_STABILITY_WORKER_PARTIAL_NOT_DETECTED',
        );
      }
      requireRunning(await dependencies.startSystem(environment));
      recoveries.push('commercial-worker-restarted');
      latestEvidence = await waitForPreviewCount(
        dependencies,
        environment,
        runtimeBaseline,
        4,
        120_000,
        assertNotInterrupted,
      );
    });

    await scenario('api-abrupt-stop', async () => {
      await dependencies.killManagedProcess('api');
      failuresInjected.push('api-stopped');
      const partial = await dependencies.status(environment);
      if (partial.overall !== 'partial') {
        throw new LocalSystemError(
          'Queda da API nao foi refletida como estado parcial',
          'PREVIEW_STABILITY_API_PARTIAL_NOT_DETECTED',
        );
      }
      const recovered = await dependencies.startSystem(environment);
      requireRunning(recovered);
      recoveries.push('api-restarted');
    });

    await scenario('redis-temporary-unavailability', async () => {
      await dependencies.waitForSafeTickGap(20_000, environment);
      const beforeOutage = await dependencies.captureEvidence(environment);
      assertEvidenceInvariants(runtimeBaseline, beforeOutage);
      const recoveryTarget = completedPreviewCount(runtimeBaseline, beforeOutage) + 1;
      const outage = await dependencies.restartMainService(
        'redis',
        environment,
      );
      if (outage.unavailableMs > 30_000) {
        throw new LocalSystemError(
          'Redis permaneceu parado por mais de 30 segundos',
          'PREVIEW_STABILITY_REDIS_OUTAGE_TOO_LONG',
        );
      }
      failuresInjected.push('redis-temporarily-stopped');
      requireRunning(await dependencies.startSystem(environment));
      latestEvidence = await waitForPreviewCount(
        dependencies,
        environment,
        runtimeBaseline,
        recoveryTarget,
        120_000,
        assertNotInterrupted,
      );
      requireExactlyOneCommercialScheduler(latestEvidence);
      recoveries.push('redis-reconnected');
    });

    await scenario('postgres-temporary-unavailability', async () => {
      await dependencies.waitForSafeTickGap(20_000, environment);
      const outage = await dependencies.restartMainService(
        'postgres',
        environment,
      );
      if (outage.unavailableMs > 30_000) {
        throw new LocalSystemError(
          'PostgreSQL permaneceu parado por mais de 30 segundos',
          'PREVIEW_STABILITY_POSTGRES_OUTAGE_TOO_LONG',
        );
      }
      failuresInjected.push('postgres-temporarily-stopped');
      requireRunning(await dependencies.startSystem(environment));
      latestEvidence = await dependencies.captureEvidence(environment);
      assertEvidenceInvariants(runtimeBaseline, latestEvidence);
      recoveries.push('postgres-reconnected');
    });

    await scenario('full-topology-restart', async () => {
      const scheduledAt = await dependencies.waitForSafeTickGap(
        30_000,
        environment,
      );
      const beforeRestart = await dependencies.captureEvidence(environment);
      assertEvidenceInvariants(runtimeBaseline, beforeRestart);
      const infrastructureBeforeRestart =
        await dependencies.captureInfrastructure(environment);
      await dependencies.stopSystem(environment);
      const stoppedInfrastructure =
        await dependencies.captureInfrastructure(environment);
      if (
        infrastructureBeforeRestart.volumeCount !==
          stoppedInfrastructure.volumeCount ||
        infrastructureBeforeRestart.volumeFingerprint !==
          stoppedInfrastructure.volumeFingerprint
      ) {
        throw new LocalSystemError(
          'Volumes divergiram durante o reinicio completo',
          'PREVIEW_STABILITY_RESTART_VOLUME_DIVERGENCE',
        );
      }
      requireRunning(await dependencies.startSystem(environment));
      latestEvidence = await dependencies.captureEvidence(environment);
      assertNoBootstrapTick(beforeRestart, latestEvidence, scheduledAt);
      assertEvidenceInvariants(runtimeBaseline, latestEvidence);
      requireExactlyOneCommercialScheduler(latestEvidence);
      const nextPreviewTarget =
        completedPreviewCount(runtimeBaseline, latestEvidence) + 1;
      latestEvidence = await waitForPreviewCount(
        dependencies,
        environment,
        runtimeBaseline,
        nextPreviewTarget,
        120_000,
        assertNotInterrupted,
      );
      recoveries.push('full-topology-restarted');
    });
  } catch (error) {
    failureCode = safeCode(error);
    if (error instanceof PreviewStabilityTopologyError) {
      topologyDiagnostic = error.diagnostic;
    }
    if (error instanceof PreviewStabilityMainInfrastructureError) {
      mainInfrastructureDiagnostic = error.diagnostic;
    }
    throw error;
  } finally {
    const cleanupStartedAt = dependencies.now();
    try {
      await cleanup();
      scenarios.push({
        name: 'mandatory-restoration',
        status: 'completed',
        durationMs: dependencies.now().getTime() - cleanupStartedAt.getTime(),
      });
    } catch (cleanupError) {
      failureCode ??= safeCode(cleanupError);
      scenarios.push({
        name: 'mandatory-restoration',
        status: 'failed',
        durationMs: dependencies.now().getTime() - cleanupStartedAt.getTime(),
      });
    }
    const completedAt = dependencies.now();
    const before = initialEvidence;
    const after = latestEvidence;
    const volumesPreserved = Boolean(
      initialInfrastructure &&
      finalInfrastructure &&
      initialInfrastructure.volumeCount === finalInfrastructure.volumeCount &&
      initialInfrastructure.volumeFingerprint ===
        finalInfrastructure.volumeFingerprint,
    );
    const invariantBefore = operationalBaseline ?? before;
    const evidenceInvariants =
      invariantBefore && after
        ? evaluateEvidenceInvariants(invariantBefore, after)
        : {
            noDispatchCreated: false,
            noOutboxCreated: false,
            noWhatsappJobCreated: false,
            noProductJobCreated: false,
            noStartedExecution: false,
            noStaleExecution: false,
            noAmbiguousExecution: false,
            allNewExecutionsAreValidPreviews: false,
            noProcessingDispatch: false,
            noPendingOrAmbiguousOutbox: false,
            noDuplicateBullMqJobId: false,
            atMostOneCommercialScheduler: false,
          };
    const finalInvariants = {
      ...evidenceInvariants,
      automationPaused: after?.settings.paused ?? false,
      legacySchedulerRemoved: after?.queues.legacySchedulerIds.length === 0,
      commercialSchedulerRemoved:
        after?.queues.commercialSchedulerIds.length === 0,
      envUnchanged: Boolean(
        initialInfrastructure &&
        finalInfrastructure &&
        initialInfrastructure.envFingerprint ===
          finalInfrastructure.envFingerprint,
      ),
      volumesPreserved,
    };
    const finalManagedProcesses = finalStatus
      ? managedProcessCount(finalStatus)
      : -1;
    const finalStateSafe = isSafePreviewStabilityFinalState({
      status: finalStatus,
      automationPaused: after?.settings.paused ?? false,
      legacySchedulerIds: after?.queues.legacySchedulerIds.length ?? -1,
      commercialSchedulerIds: after?.queues.commercialSchedulerIds.length ?? -1,
      managedProcessesActive: finalManagedProcesses,
      volumesPreserved,
    });
    if (
      Object.values(finalInvariants).some((value) => !value) ||
      (restorationRequired && !finalStateSafe)
    ) {
      failureCode ??= 'PREVIEW_STABILITY_FINAL_STATE_UNSAFE';
    }
    const report: PreviewStabilityReport = {
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
      status: failureCode ? 'failed' : 'completed',
      scenarios,
      ticksObserved: before && after ? completedPreviewCount(before, after) : 0,
      failuresInjected,
      recoveries,
      deltas: {
        executions:
          before && after
            ? delta(before.executions.length, after.executions.length)
            : 0,
        runs: before && after ? delta(before.runs.total, after.runs.total) : 0,
        dispatches:
          before && after
            ? delta(before.dispatches.total, after.dispatches.total)
            : 0,
        outboxes:
          before && after
            ? delta(before.outboxes.total, after.outboxes.total)
            : 0,
        commercialJobs:
          before && after
            ? delta(
                before.queues.commercialJobIds.length,
                after.queues.commercialJobIds.length,
              )
            : 0,
        whatsappJobs:
          before && after
            ? delta(
                before.queues.whatsappJobIds.length,
                after.queues.whatsappJobIds.length,
              )
            : 0,
        productJobs:
          before && after
            ? delta(
                before.queues.productJobIds.length,
                after.queues.productJobIds.length,
              )
            : 0,
        tables:
          before && after
            ? tableDeltas(before.tableCounts, after.tableCounts)
            : {},
      },
      invariants: finalInvariants,
      finalState: {
        system: finalStatus?.overall ?? 'partial',
        operationLock: finalStatus?.operationLock ?? 'unavailable',
        automationPaused:
          after?.settings.paused ?? finalStatus?.automation.paused ?? false,
        legacyScheduler: after
          ? after.queues.legacySchedulerIds.length === 0
            ? 'disabled'
            : 'registered'
          : (finalStatus?.schedulers.legacy.status ?? 'unavailable'),
        commercialScheduler: after
          ? after.queues.commercialSchedulerIds.length === 0
            ? 'disabled'
            : 'registered'
          : (finalStatus?.schedulers.commercial.status ?? 'unavailable'),
        managedProcessesActive: finalManagedProcesses,
        volumesPreserved,
      },
      bugs,
      ...(topologyDiagnostic ? { topologyDiagnostic } : {}),
      ...(mainInfrastructureDiagnostic
        ? { mainInfrastructureDiagnostic }
        : {}),
      ...(failureCode ? { failureCode } : {}),
    };
    try {
      await dependencies.writeReport(sanitizePreviewStabilityReport(report));
    } finally {
      removeSignalCleanup();
    }
  }
  if (failureCode) {
    throw new LocalSystemError(
      'Validacao de estabilidade terminou com falha',
      failureCode,
    );
  }
};

export const fingerprintValues = (values: readonly string[]) =>
  createHash('sha256')
    .update([...values].sort().join('\n'))
    .digest('hex');
