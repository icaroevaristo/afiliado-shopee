export const SERVICE_NAMES = [
  'api',
  'dashboard',
  'commercial-worker',
  'whatsapp-dispatch-worker',
] as const;

export const LOG_SERVICE_NAMES = [...SERVICE_NAMES, 'supervisor'] as const;
export const PREVIEW_STABILITY_PRISMA_VALIDATION =
  'PREVIEW_STABILITY_PRISMA_CLIENT_VALIDATED';

export type ServiceName = (typeof SERVICE_NAMES)[number];
export type LogServiceName = (typeof LOG_SERVICE_NAMES)[number];
export type AutomationMode = 'preview' | 'send';

export type RegisteredProcess = {
  pid: number;
  startedAt: string;
  log: string;
};

export type LocalSystemState = {
  version: 1;
  /**
   * The Compose project is part of ownership identity. It is optional only
   * while reading state written by pre-identity supervisor versions; active
   * legacy state is rejected before any stop/start mutation.
   */
  composeProjectName?: string;
  startedAt: string;
  mode: AutomationMode;
  ports: {
    api: number;
    dashboard: number;
    postgres: number;
    redis: number;
    evolution: number;
  };
  processes: Partial<Record<ServiceName, RegisteredProcess>>;
};

export type CommandSpec = {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  shell?: boolean;
};

export type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export type ProcessInspection = {
  running: boolean;
  identityMatches: boolean;
  command?: string;
  startedAt?: string;
};

export type ProcessIdentityInspection = {
  running: boolean;
  markerMatches: boolean;
  startedAt?: string;
};

export const PROCESS_START_TOLERANCE_MS = 15_000;

export const processStartedAtMatches = (
  expected: string,
  actual: string | undefined,
) => {
  if (!actual) return false;
  const expectedTime = Date.parse(expected);
  const actualTime = Date.parse(actual);
  return (
    Number.isFinite(expectedTime) &&
    Number.isFinite(actualTime) &&
    Math.abs(expectedTime - actualTime) < PROCESS_START_TOLERANCE_MS
  );
};

export type PortOccupant = {
  pid?: number;
  processName: string;
};

export type StartedProcess = {
  pid: number;
  startedAt: string;
};

export type SystemDependencies = {
  run(spec: CommandSpec): Promise<CommandResult>;
  spawn(spec: CommandSpec & { logPath: string }): Promise<StartedProcess>;
  inspectProcess(
    pid: number,
    expectedMarker: string,
    expectedStartedAt: string,
  ): Promise<ProcessInspection>;
  inspectProcessIdentity(
    pid: number,
    expectedMarker: string,
  ): Promise<ProcessIdentityInspection>;
  stopProcessTree(pid: number): Promise<boolean>;
  getPortOccupant(port: number): Promise<PortOccupant | null>;
  isProcessInTree?(rootPid: number, candidatePid: number): Promise<boolean>;
  request(
    url: string,
    options?: { headers?: Record<string, string>; timeoutMs?: number },
  ): Promise<{ ok: boolean; status: number; body?: unknown }>;
  sleep(milliseconds: number): Promise<void>;
  now(): Date;
};

export class LocalSystemError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'LocalSystemError';
  }
}
