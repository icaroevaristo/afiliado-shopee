import {
  closeSync,
  existsSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';

import type {
  LocalSystemState,
  LogServiceName,
  SystemDependencies,
} from './types';
import {
  LocalSystemError,
  processStartedAtMatches,
  SERVICE_NAMES,
} from './types';

export const runtimeDirectory = (root: string) =>
  resolve(root, '.runtime', 'local-system');
export const statePath = (root: string) =>
  resolve(runtimeDirectory(root), 'state.json');
export const operationLockPath = (root: string) =>
  resolve(runtimeDirectory(root), 'lock');
export const SUPERVISOR_PROCESS_MARKER = 'apps/system-supervisor/src/cli.ts';
export const PREVIEW_STABILITY_PROCESS_MARKER =
  'apps/system-supervisor/src/preview-stability-cli.ts';

type OperationProcessMarker =
  typeof SUPERVISOR_PROCESS_MARKER | typeof PREVIEW_STABILITY_PROCESS_MARKER;

export type OperationLockRecord = {
  version: 1;
  pid: number;
  ownerToken: string;
  acquiredAt: string;
  processStartedAt: string;
  processMarker: OperationProcessMarker;
  operation: 'start' | 'stop';
};

export type OperationLockSnapshot = {
  operationLock: 'unlocked' | 'active' | 'stale' | 'invalid' | 'unavailable';
  operation?: 'start' | 'stop';
  pid?: number;
  acquiredAt?: string;
};

const MAX_LOCK_ACQUISITION_ATTEMPTS = 50;

const exactKeys = (record: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(record).length === keys.length &&
  keys.every((key) => key in record);

export const ensureRuntimeDirectory = (root: string) =>
  mkdirSync(runtimeDirectory(root), { recursive: true });

export const relativeLogPath = (service: LogServiceName) =>
  `.runtime/local-system/${service}.log`;

export const absoluteLogPath = (root: string, service: LogServiceName) =>
  resolve(root, relativeLogPath(service));

export const rotateLogIfNeeded = (path: string, maximumBytes = 5_000_000) => {
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path) || statSync(path).size <= maximumBytes) return;
  const rotated = `${path}.1`;
  rmSync(rotated, { force: true });
  renameSync(path, rotated);
};

export const appendSupervisorLog = (root: string, message: string) => {
  const path = absoluteLogPath(root, 'supervisor');
  rotateLogIfNeeded(path);
  writeFileSync(path, `${new Date().toISOString()} ${message}\n`, {
    flag: 'a',
  });
};

const appendLockLog = (root: string, message: string) => {
  try {
    appendSupervisorLog(root, message);
  } catch {
    // Falha de observabilidade nunca altera ownership ou o resultado da operacao.
  }
};

const isState = (value: unknown): value is LocalSystemState => {
  if (!value || typeof value !== 'object') return false;
  const state = value as Record<string, unknown>;
  const validTimestamp = (timestamp: unknown) =>
    typeof timestamp === 'string' && Number.isFinite(Date.parse(timestamp));
  const hasComposeProjectName = 'composeProjectName' in state;
  if (
    !exactKeys(
      state,
      hasComposeProjectName
        ? [
            'version',
            'composeProjectName',
            'startedAt',
            'mode',
            'ports',
            'processes',
          ]
        : ['version', 'startedAt', 'mode', 'ports', 'processes'],
    )
  ) {
    return false;
  }
  if (
    state.version !== 1 ||
    !validTimestamp(state.startedAt) ||
    (state.mode !== 'preview' && state.mode !== 'send') ||
    !state.ports ||
    typeof state.ports !== 'object' ||
    !state.processes ||
    typeof state.processes !== 'object'
  ) {
    return false;
  }
  if (
    hasComposeProjectName &&
    (typeof state.composeProjectName !== 'string' ||
      !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(state.composeProjectName))
  ) {
    return false;
  }
  const ports = state.ports as Record<string, unknown>;
  const portNames = ['api', 'dashboard', 'postgres', 'redis', 'evolution'];
  if (
    !exactKeys(ports, portNames) ||
    !portNames.every(
      (name) =>
        Number.isInteger(ports[name]) &&
        (ports[name] as number) >= 1 &&
        (ports[name] as number) <= 65_535,
    )
  ) {
    return false;
  }
  const processes = state.processes as Record<string, unknown>;
  if (
    !Object.keys(processes).every((name) =>
      (SERVICE_NAMES as readonly string[]).includes(name),
    )
  ) {
    return false;
  }
  return Object.entries(processes).every(([name, processValue]) => {
    if (!processValue || typeof processValue !== 'object') return false;
    const registered = processValue as Record<string, unknown>;
    return (
      exactKeys(registered, ['pid', 'startedAt', 'log']) &&
      Number.isInteger(registered.pid) &&
      (registered.pid as number) > 0 &&
      validTimestamp(registered.startedAt) &&
      registered.log === relativeLogPath(name as LogServiceName)
    );
  });
};

export const readState = (root: string): LocalSystemState | null => {
  const path = statePath(root);
  if (!existsSync(path)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!isState(parsed)) throw new Error('invalid');
    return parsed;
  } catch {
    throw new LocalSystemError(
      'Estado local invalido; remova-o somente apos conferir os processos',
      'SYSTEM_STATE_INVALID',
    );
  }
};

export const writeState = (root: string, state: LocalSystemState) => {
  ensureRuntimeDirectory(root);
  writeFileSync(statePath(root), `${JSON.stringify(state, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
};

export const clearState = (root: string) =>
  rmSync(statePath(root), { force: true });

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isIsoTimestamp = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
};

const isOperationLockRecord = (
  value: unknown,
): value is OperationLockRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = [
    'version',
    'pid',
    'ownerToken',
    'acquiredAt',
    'processStartedAt',
    'processMarker',
    'operation',
  ];
  return (
    exactKeys(record, keys) &&
    record.version === 1 &&
    Number.isInteger(record.pid) &&
    (record.pid as number) > 0 &&
    typeof record.ownerToken === 'string' &&
    UUID_PATTERN.test(record.ownerToken) &&
    isIsoTimestamp(record.acquiredAt) &&
    isIsoTimestamp(record.processStartedAt) &&
    (record.processMarker === SUPERVISOR_PROCESS_MARKER ||
      record.processMarker === PREVIEW_STABILITY_PROCESS_MARKER) &&
    (record.operation === 'start' || record.operation === 'stop')
  );
};

type LockReadResult =
  | { kind: 'missing' }
  | { kind: 'valid'; record: OperationLockRecord }
  | { kind: 'invalid' }
  | { kind: 'unavailable' };

const readOperationLockAt = (path: string): LockReadResult => {
  let serialized: string;
  try {
    serialized = readFileSync(path, 'utf8');
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return { kind: 'missing' };
    }
    return { kind: 'unavailable' };
  }
  if (!serialized.trim()) return { kind: 'invalid' };
  try {
    const parsed: unknown = JSON.parse(serialized);
    return isOperationLockRecord(parsed)
      ? { kind: 'valid', record: parsed }
      : { kind: 'invalid' };
  } catch {
    return { kind: 'invalid' };
  }
};

const classifyValidLock = async (
  record: OperationLockRecord,
  deps: Pick<SystemDependencies, 'inspectProcessIdentity'>,
): Promise<'active' | 'stale' | 'unavailable'> => {
  let inspection;
  try {
    inspection = await deps.inspectProcessIdentity(
      record.pid,
      record.processMarker,
    );
  } catch {
    return 'unavailable';
  }
  if (!inspection.running) return 'stale';
  return inspection.markerMatches &&
    processStartedAtMatches(record.processStartedAt, inspection.startedAt)
    ? 'active'
    : 'stale';
};

export const inspectOperationLock = async (
  root: string,
  deps: Pick<SystemDependencies, 'inspectProcessIdentity'>,
): Promise<OperationLockSnapshot> => {
  const current = readOperationLockAt(operationLockPath(root));
  if (current.kind === 'missing') return { operationLock: 'unlocked' };
  if (current.kind === 'invalid') return { operationLock: 'invalid' };
  if (current.kind === 'unavailable') return { operationLock: 'unavailable' };
  const classification = await classifyValidLock(current.record, deps);
  return {
    operationLock: classification,
    operation: current.record.operation,
    pid: current.record.pid,
    acquiredAt: current.record.acquiredAt,
  };
};

const ownerKey = (ownerToken: string) =>
  createHash('sha256').update(ownerToken).digest('hex').slice(0, 20);

const tryCreateOperationLock = (root: string, record: OperationLockRecord) => {
  const path = operationLockPath(root);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, 'wx', 0o600);
    writeFileSync(descriptor, `${JSON.stringify(record)}\n`, {
      encoding: 'utf8',
    });
    closeSync(descriptor);
    return true;
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // O descritor pode ter sido fechado depois da escrita completa.
      }
    }
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'EEXIST'
    ) {
      return false;
    }
    if (readOperationLockAt(path).kind === 'invalid') {
      rmSync(path, { force: true });
    }
    throw new LocalSystemError(
      'Nao foi possivel criar o lock do supervisor',
      'SYSTEM_LOCK_IDENTITY_UNAVAILABLE',
    );
  }
};

const createRelease = (root: string, owner: OperationLockRecord) => {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    try {
      const path = operationLockPath(root);
      const releasedPath = `${path}.release-${ownerKey(owner.ownerToken)}`;
      try {
        linkSync(path, releasedPath);
      } catch {
        const current = readOperationLockAt(path);
        appendLockLog(
          root,
          `SYSTEM_LOCK_RELEASE_SKIPPED reason=${current.kind} operation=${owner.operation} pid=${owner.pid}`,
        );
        return;
      }
      const current = readOperationLockAt(releasedPath);
      if (
        current.kind !== 'valid' ||
        current.record.ownerToken !== owner.ownerToken ||
        current.record.pid !== owner.pid ||
        current.record.processStartedAt !== owner.processStartedAt ||
        current.record.processMarker !== owner.processMarker ||
        current.record.operation !== owner.operation
      ) {
        appendLockLog(
          root,
          `SYSTEM_LOCK_RELEASE_SKIPPED reason=owner-changed operation=${owner.operation} pid=${owner.pid}`,
        );
        rmSync(releasedPath, { force: true });
        return;
      }
      unlinkSync(path);
      rmSync(releasedPath, { force: true });
      appendLockLog(
        root,
        `SYSTEM_LOCK_RELEASED operation=${owner.operation} pid=${owner.pid}`,
      );
    } catch {
      appendLockLog(
        root,
        `SYSTEM_LOCK_RELEASE_SKIPPED reason=filesystem operation=${owner.operation} pid=${owner.pid}`,
      );
    }
  };
};

export const acquireLock = async (
  root: string,
  operation: 'start' | 'stop',
  deps: Pick<SystemDependencies, 'inspectProcessIdentity' | 'now'>,
  options: {
    pid?: number;
    ownerTokenFactory?: () => string;
    processMarker?: OperationProcessMarker;
  } = {},
) => {
  ensureRuntimeDirectory(root);
  const pid = options.pid ?? process.pid;
  const processMarker = options.processMarker ?? SUPERVISOR_PROCESS_MARKER;
  let selfIdentity;
  try {
    selfIdentity = await deps.inspectProcessIdentity(pid, processMarker);
  } catch {
    selfIdentity = undefined;
  }
  if (
    !selfIdentity?.running ||
    !selfIdentity.markerMatches ||
    !isIsoTimestamp(selfIdentity.startedAt)
  ) {
    throw new LocalSystemError(
      'Nao foi possivel comprovar a identidade do supervisor atual',
      'SYSTEM_LOCK_IDENTITY_UNAVAILABLE',
    );
  }
  const record: OperationLockRecord = {
    version: 1,
    pid,
    ownerToken: (options.ownerTokenFactory ?? randomUUID)(),
    acquiredAt: deps.now().toISOString(),
    processStartedAt: selfIdentity.startedAt,
    processMarker,
    operation,
  };
  if (!isOperationLockRecord(record)) {
    throw new LocalSystemError(
      'Identidade local do supervisor invalida',
      'SYSTEM_LOCK_IDENTITY_UNAVAILABLE',
    );
  }

  for (let attempt = 0; attempt < MAX_LOCK_ACQUISITION_ATTEMPTS; attempt += 1) {
    if (tryCreateOperationLock(root, record)) {
      appendLockLog(
        root,
        `SYSTEM_LOCK_ACQUIRED operation=${operation} pid=${pid}`,
      );
      return createRelease(root, record);
    }
    const current = readOperationLockAt(operationLockPath(root));
    if (current.kind === 'missing') continue;
    if (current.kind === 'invalid') {
      appendLockLog(root, 'SYSTEM_LOCK_INVALID');
      throw new LocalSystemError(
        'Lock do supervisor invalido; arquivo preservado para investigacao',
        'SYSTEM_LOCK_INVALID',
      );
    }
    if (current.kind === 'unavailable') {
      appendLockLog(root, 'SYSTEM_LOCK_IDENTITY_UNAVAILABLE');
      throw new LocalSystemError(
        'Identidade do lock do supervisor indisponivel',
        'SYSTEM_LOCK_IDENTITY_UNAVAILABLE',
      );
    }
    const classification = await classifyValidLock(current.record, deps);
    if (classification === 'active') {
      throw new LocalSystemError(
        'Outra operacao do supervisor esta em andamento',
        'SYSTEM_OPERATION_IN_PROGRESS',
      );
    }
    if (classification === 'unavailable') {
      appendLockLog(root, 'SYSTEM_LOCK_IDENTITY_UNAVAILABLE');
      throw new LocalSystemError(
        'Nao foi possivel comprovar a identidade do lock atual',
        'SYSTEM_LOCK_IDENTITY_UNAVAILABLE',
      );
    }

    const confirmed = readOperationLockAt(operationLockPath(root));
    if (
      confirmed.kind !== 'valid' ||
      confirmed.record.ownerToken !== current.record.ownerToken
    ) {
      continue;
    }
    const confirmation = await classifyValidLock(confirmed.record, deps);
    if (confirmation === 'active') continue;
    if (confirmation === 'unavailable') {
      appendLockLog(root, 'SYSTEM_LOCK_IDENTITY_UNAVAILABLE');
      throw new LocalSystemError(
        'Nao foi possivel reconfirmar a identidade do lock atual',
        'SYSTEM_LOCK_IDENTITY_UNAVAILABLE',
      );
    }
    const path = operationLockPath(root);
    const latest = readOperationLockAt(path);
    if (
      latest.kind !== 'valid' ||
      latest.record.ownerToken !== confirmed.record.ownerToken
    ) {
      continue;
    }
    const stalePath = `${path}.stale-${ownerKey(latest.record.ownerToken)}`;
    try {
      linkSync(path, stalePath);
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error.code === 'ENOENT' || error.code === 'EEXIST')
      ) {
        continue;
      }
      throw new LocalSystemError(
        'Falha ao isolar lock stale do supervisor',
        'SYSTEM_LOCK_IDENTITY_UNAVAILABLE',
      );
    }
    const moved = readOperationLockAt(stalePath);
    if (
      moved.kind !== 'valid' ||
      moved.record.ownerToken !== latest.record.ownerToken
    ) {
      appendLockLog(root, 'SYSTEM_LOCK_RECOVERY_RACE');
      rmSync(stalePath, { force: true });
      continue;
    }
    const currentBeforeRemoval = readOperationLockAt(path);
    if (
      currentBeforeRemoval.kind !== 'valid' ||
      currentBeforeRemoval.record.ownerToken !== moved.record.ownerToken
    ) {
      rmSync(stalePath, { force: true });
      continue;
    }
    try {
      unlinkSync(path);
    } catch (error) {
      rmSync(stalePath, { force: true });
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        continue;
      }
      throw new LocalSystemError(
        'Falha ao isolar lock stale do supervisor',
        'SYSTEM_LOCK_IDENTITY_UNAVAILABLE',
      );
    }
    const acquired = tryCreateOperationLock(root, record);
    rmSync(stalePath, { force: true });
    appendLockLog(
      root,
      `SYSTEM_LOCK_STALE_RECOVERED operation=${confirmed.record.operation} pid=${confirmed.record.pid}`,
    );
    if (acquired) return createRelease(root, record);
  }
  throw new LocalSystemError(
    'Concorrencia impediu a aquisicao segura do lock',
    'SYSTEM_OPERATION_IN_PROGRESS',
  );
};
