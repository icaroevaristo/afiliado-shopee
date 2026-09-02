import { closeSync, existsSync, fstatSync, openSync, readSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { acquireLock, absoluteLogPath } from './state-store';
import {
  composeProjectRuntimeRoot,
  isValidComposeProjectName,
  OPERATIONAL_COMPOSE_PROJECT_NAME,
} from './runtime-identity';
import { createSystemDependencies } from './system-dependencies';
import { LocalSystemSupervisor, type SystemStatusSnapshot } from './supervisor';
import {
  LocalSystemError,
  LOG_SERVICE_NAMES,
  type LogServiceName,
} from './types';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

type ParsedCommand =
  | { command: 'start' | 'stop'; composeProjectName?: string }
  | { command: 'status'; json: boolean; composeProjectName?: string }
  | { command: 'logs'; service?: LogServiceName; lines: number };

const parseProjectNameFlag = (flags: readonly string[]) => {
  let composeProjectName: string | undefined;
  const remaining: string[] = [];
  for (const flag of flags) {
    if (!flag.startsWith('--compose-project-name=')) {
      remaining.push(flag);
      continue;
    }
    if (composeProjectName !== undefined) {
      throw new LocalSystemError(
        'Identidade Docker duplicada',
        'SYSTEM_INVALID_COMPOSE_PROJECT',
      );
    }
    composeProjectName = flag.slice('--compose-project-name='.length);
    if (!isValidComposeProjectName(composeProjectName)) {
      throw new LocalSystemError(
        'Identidade Docker invalida',
        'SYSTEM_INVALID_COMPOSE_PROJECT',
      );
    }
  }
  return { composeProjectName, remaining };
};

export const parseSystemArgs = (args: readonly string[]): ParsedCommand => {
  const normalized = args.filter((argument) => argument !== '--');
  const [command, ...flags] = normalized;
  if (command === 'start' || command === 'stop') {
    const parsedFlags = parseProjectNameFlag(flags);
    if (parsedFlags.remaining.length > 0) {
      throw new LocalSystemError(
        `O comando ${command} nao aceita argumentos`,
        'SYSTEM_INVALID_ARGUMENT',
      );
    }
    return { command, composeProjectName: parsedFlags.composeProjectName };
  }
  if (command === 'status') {
    const parsedFlags = parseProjectNameFlag(flags);
    if (parsedFlags.remaining.length === 0) {
      return {
        command,
        json: false,
        composeProjectName: parsedFlags.composeProjectName,
      };
    }
    if (
      parsedFlags.remaining.length === 1 &&
      parsedFlags.remaining[0] === '--json'
    ) {
      return {
        command,
        json: true,
        composeProjectName: parsedFlags.composeProjectName,
      };
    }
    throw new LocalSystemError(
      'system:status aceita somente --json',
      'SYSTEM_INVALID_ARGUMENT',
    );
  }
  if (command === 'logs') {
    let service: LogServiceName | undefined;
    let lines = 100;
    const seen = new Set<string>();
    for (const flag of flags) {
      const [key, value] = flag.split('=', 2);
      if (!value || seen.has(key)) {
        throw new LocalSystemError(
          'Argumento de logs invalido ou duplicado',
          'SYSTEM_INVALID_LOG_ARGUMENT',
        );
      }
      seen.add(key);
      if (key === '--service') {
        if (!LOG_SERVICE_NAMES.includes(value as LogServiceName)) {
          throw new LocalSystemError(
            'Servico de log nao permitido',
            'SYSTEM_INVALID_LOG_SERVICE',
          );
        }
        service = value as LogServiceName;
      } else if (key === '--lines') {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1_000) {
          throw new LocalSystemError(
            '--lines deve estar entre 1 e 1000',
            'SYSTEM_INVALID_LOG_LINES',
          );
        }
        lines = parsed;
      } else {
        throw new LocalSystemError(
          'Flag de logs nao permitida',
          'SYSTEM_INVALID_LOG_ARGUMENT',
        );
      }
    }
    return { command, service, lines };
  }
  throw new LocalSystemError(
    'Comando esperado: start, status, logs ou stop',
    'SYSTEM_COMMAND_REQUIRED',
  );
};

const tail = (path: string, lines: number) => {
  if (!existsSync(path)) return '(sem log)';
  const descriptor = openSync(path, 'r');
  try {
    let position = fstatSync(descriptor).size;
    let newlineCount = 0;
    const chunks: Buffer[] = [];
    const chunkSize = 8_192;
    while (position > 0 && newlineCount <= lines) {
      const length = Math.min(chunkSize, position);
      position -= length;
      const chunk = Buffer.allocUnsafe(length);
      readSync(descriptor, chunk, 0, length, position);
      for (const byte of chunk) if (byte === 10) newlineCount += 1;
      chunks.unshift(chunk);
    }
    return Buffer.concat(chunks)
      .toString('utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-lines)
      .join('\n');
  } finally {
    closeSync(descriptor);
  }
};

const printLogs = (service: LogServiceName | undefined, lines: number) => {
  const services = service ? [service] : LOG_SERVICE_NAMES;
  for (const name of services) {
    console.log(`\n[${name}]`);
    console.log(tail(absoluteLogPath(ROOT, name), lines));
  }
};

const display = (value: string | boolean | null) =>
  value === null ? 'indisponivel' : String(value);

const composeServiceDisplay = (
  services: SystemStatusSnapshot['docker']['services'],
  name: string,
) => {
  const service = services.find((item) => item.service === name);
  if (!service || service.state !== 'running') return 'offline';
  return service.health === 'healthy' ? 'online' : 'degraded';
};

type OperationSignalRuntime = Pick<NodeJS.Process, 'once' | 'off' | 'exit'>;

export const installOperationSignalCleanup = (
  release: () => void,
  runtime: OperationSignalRuntime = process,
) => {
  const onSigint = () => {
    release();
    runtime.exit(130);
  };
  const onSigterm = () => {
    release();
    runtime.exit(143);
  };
  runtime.once('SIGINT', onSigint);
  runtime.once('SIGTERM', onSigterm);
  return () => {
    runtime.off('SIGINT', onSigint);
    runtime.off('SIGTERM', onSigterm);
  };
};

export const formatStatus = (status: SystemStatusSnapshot) =>
  [
    `Sistema: ${status.overall}`,
    `Lock operacional: ${status.operationLock}`,
    ...(status.operation
      ? [
          `Operacao do lock: ${status.operation}`,
          `PID do lock: ${status.pid ?? 'indisponivel'}`,
          `Lock adquirido em: ${status.acquiredAt ?? 'indisponivel'}`,
        ]
      : []),
    `Modo comercial: ${status.mode}`,
    `Docker: ${status.docker.daemon}`,
    `PostgreSQL: ${composeServiceDisplay(status.docker.services, 'postgres')}`,
    `Redis: ${composeServiceDisplay(status.docker.services, 'redis')}`,
    `Evolution API: ${status.evolution.api}`,
    `WhatsApp: ${status.evolution.whatsappConnection}`,
    `API: ${status.processes.api} / ${status.endpoints.api}`,
    `Dashboard: ${status.processes.dashboard} / ${status.endpoints.dashboard}`,
    `Portas locais: API ${status.ports.api} / Dashboard ${status.ports.dashboard}`,
    `Identidade Docker: ${status.runtime.composeProjectName}`,
    `Volume PostgreSQL esperado: ${status.runtime.expectedPostgresVolume}`,
    `Volume PostgreSQL montado: ${status.runtime.mountedPostgresVolume ?? 'nenhum'}`,
    `Identidade do volume: ${status.runtime.volumeStatus}`,
    `Worker comercial: ${status.processes['commercial-worker']}`,
    `Worker de dispatch: ${status.processes['whatsapp-dispatch-worker']}`,
    `Scheduler legado: ${status.schedulers.legacy.status}`,
    `Scheduler comercial: ${status.schedulers.commercial.status} / ${status.mode}`,
    `Proxima execucao comercial: ${display(status.schedulers.commercial.nextRunAt)}`,
    `Automacao habilitada: ${display(status.automation.enabled)}`,
    `Automacao pausada: ${display(status.automation.paused)}`,
    `Automacao permitida: ${display(status.automation.allowed)}`,
    `Motivos: ${status.automation.reasons.join(', ') || 'nenhum'}`,
    `Proxima permissao: ${display(status.automation.nextAllowedAt)}`,
    `Portas externas: ${
      status.externalPortOccupants.length === 0
        ? 'nenhuma'
        : status.externalPortOccupants
            .map((item) => `${item.port}:${item.processName}`)
            .join(', ')
    }`,
  ].join('\n');

export const runSystemCli = async (
  args: readonly string[] = process.argv.slice(2),
) => {
  const parsed = parseSystemArgs(args);
  if (parsed.command === 'logs') {
    printLogs(parsed.service, parsed.lines);
    return;
  }
  const deps = createSystemDependencies();
  const composeProjectName =
    parsed.composeProjectName ?? OPERATIONAL_COMPOSE_PROJECT_NAME;
  const operationLockRoot = composeProjectRuntimeRoot(composeProjectName);
  const supervisor = new LocalSystemSupervisor(resolve(ROOT), deps, undefined, {
    composeProjectName,
    operationLockRoot,
  });
  if (parsed.command === 'status') {
    const status = await supervisor.status();
    console.log(
      parsed.json ? JSON.stringify(status, null, 2) : formatStatus(status),
    );
    return;
  }

  const release = await acquireLock(operationLockRoot, parsed.command, deps);
  const removeSignalCleanup = installOperationSignalCleanup(release);
  try {
    if (parsed.command === 'start') {
      const status = await supervisor.start();
      console.log('Sistema local pronto. Nenhum tick ou envio foi disparado.');
      console.log(formatStatus(status));
    } else {
      const result = await supervisor.stop();
      if (!result.stopped) {
        throw new LocalSystemError(
          `Intervencao manual necessaria: ${result.manualIntervention.join(', ')}`,
          'SYSTEM_STOP_INCOMPLETE',
        );
      }
      console.log(
        'Sistema local parado. Containers, volumes, dados e agendamentos foram preservados.',
      );
    }
  } finally {
    removeSignalCleanup();
    release();
  }
};

if (process.env.NODE_ENV !== 'test') {
  runSystemCli().catch((error) => {
    const code =
      error instanceof LocalSystemError
        ? error.code
        : 'SYSTEM_UNEXPECTED_ERROR';
    const message = error instanceof Error ? error.message : 'Falha inesperada';
    console.error(`${code}: ${message}`);
    process.exitCode = 1;
  });
}
