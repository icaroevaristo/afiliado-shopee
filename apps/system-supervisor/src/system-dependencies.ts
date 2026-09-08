import { spawn as spawnChild } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';

import type {
  CommandResult,
  CommandSpec,
  ProcessIdentityInspection,
  ProcessInspection,
  SystemDependencies,
} from './types';
import { processStartedAtMatches } from './types';
import { windowsProcessStopScript } from './windows-process-stop';

const runCommand = (spec: CommandSpec): Promise<CommandResult> =>
  new Promise((resolve, reject) => {
    const child = spawnChild(spec.command, spec.args, {
      cwd: spec.cwd,
      env: spec.env,
      shell: spec.shell ?? false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      if (stdout.length < 5_000_000) stdout += chunk;
    });
    child.stderr?.on('data', (chunk: string) => {
      if (stderr.length < 5_000_000) stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });

const processExists = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'EPERM'
    ) {
      return true;
    }
    return false;
  }
};

const normalizedMarkerMatches = (command: string | undefined, marker: string) =>
  Boolean(
    command
      ?.toLowerCase()
      .replaceAll('\\', '/')
      .includes(marker.toLowerCase().replaceAll('\\', '/')),
  );

const waitUntilStopped = async (pid: number, timeoutMs: number) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processExists(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !processExists(pid);
};

const getWindowsProcessTree = async (rootPid: number) => {
  const script = [
    '$all=Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId',
    `$ids=New-Object 'System.Collections.Generic.HashSet[int]'; [void]$ids.Add(${rootPid})`,
    'do {$added=$false; foreach($p in $all) {if($ids.Contains([int]$p.ParentProcessId) -and $ids.Add([int]$p.ProcessId)) {$added=$true}}} while($added)',
    '@($ids) | ConvertTo-Json -Compress',
  ].join('; ');
  const result = await runCommand({
    command: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-Command', script],
    cwd: process.cwd(),
  });
  if (result.code !== 0 || !result.stdout.trim()) return [rootPid];
  const parsed: unknown = JSON.parse(result.stdout);
  const values = Array.isArray(parsed) ? parsed : [parsed];
  const pids = values.filter(
    (value): value is number => Number.isInteger(value) && value > 0,
  );
  return pids.includes(rootPid) ? pids : [rootPid, ...pids];
};

const getPosixProcessTree = async (rootPid: number) => {
  const result = await runCommand({
    command: 'ps',
    args: ['-eo', 'pid=', '-o', 'ppid='],
    cwd: process.cwd(),
  });
  if (result.code !== 0) return [rootPid];
  const relationships = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/).map(Number))
    .filter(
      (values): values is [number, number] =>
        values.length === 2 && values.every(Number.isInteger),
    );
  const tree = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [pid, parentPid] of relationships) {
      if (tree.has(parentPid) && !tree.has(pid)) {
        tree.add(pid);
        changed = true;
      }
    }
  }
  return [...tree];
};

const inspectWindowsProcess = async (
  pid: number,
  marker: string,
  expectedStartedAt: string,
): Promise<ProcessInspection> => {
  const script = [
    `$p=Get-CimInstance Win32_Process -Filter \"ProcessId = ${pid}\"`,
    'if ($null -eq $p) { exit 3 }',
    `$g=Get-Process -Id ${pid}`,
    '[pscustomobject]@{CommandLine=$p.CommandLine;Name=$g.ProcessName;StartedAt=$g.StartTime.ToUniversalTime().ToString(\"o\")} | ConvertTo-Json -Compress',
  ].join('; ');
  const result = await runCommand({
    command: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-Command', script],
    cwd: process.cwd(),
  });
  if (result.code === 3) return { running: false, identityMatches: false };
  if (result.code !== 0) {
    return { running: processExists(pid), identityMatches: false };
  }
  const parsed = JSON.parse(result.stdout) as {
    CommandLine?: string;
    Name?: string;
    StartedAt?: string;
  };
  const startedAt = parsed.StartedAt;
  return {
    running: true,
    identityMatches:
      processStartedAtMatches(expectedStartedAt, startedAt) &&
      (Boolean(normalizedMarkerMatches(parsed.CommandLine, marker)) ||
        (!parsed.CommandLine && parsed.Name?.toLowerCase() === 'node')),
    command: parsed.CommandLine,
    startedAt,
  };
};

const inspectPosixProcess = async (
  pid: number,
  marker: string,
  expectedStartedAt: string,
): Promise<ProcessInspection> => {
  const result = await runCommand({
    command: 'ps',
    args: ['-p', String(pid), '-o', 'lstart=', '-o', 'command='],
    cwd: process.cwd(),
  });
  if (result.code !== 0 || !result.stdout.trim()) {
    return { running: false, identityMatches: false };
  }
  const line = result.stdout.trim();
  const startedAt = new Date(line.slice(0, 24)).toISOString();
  return {
    running: true,
    identityMatches:
      normalizedMarkerMatches(line.slice(25), marker) &&
      processStartedAtMatches(expectedStartedAt, startedAt),
    command: line.slice(25),
    startedAt,
  };
};

const inspectWindowsProcessIdentity = async (
  pid: number,
  marker: string,
): Promise<ProcessIdentityInspection> => {
  const script = [
    `$p=Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"`,
    'if ($null -eq $p) { exit 3 }',
    `$g=Get-Process -Id ${pid}`,
    '[pscustomobject]@{CommandLine=$p.CommandLine;StartedAt=$g.StartTime.ToUniversalTime().ToString("o")} | ConvertTo-Json -Compress',
  ].join('; ');
  const result = await runCommand({
    command: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-Command', script],
    cwd: process.cwd(),
  });
  if (result.code === 3 || (!processExists(pid) && result.code !== 0)) {
    return { running: false, markerMatches: false };
  }
  if (result.code !== 0) throw new Error('Process identity unavailable');
  const parsed = JSON.parse(result.stdout) as {
    CommandLine?: string;
    StartedAt?: string;
  };
  const parsedStartedAt = new Date(parsed.StartedAt ?? '');
  if (!Number.isFinite(parsedStartedAt.getTime())) {
    throw new Error('Process identity unavailable');
  }
  return {
    running: true,
    markerMatches: normalizedMarkerMatches(parsed.CommandLine, marker),
    startedAt: parsedStartedAt.toISOString(),
  };
};

const inspectPosixProcessIdentity = async (
  pid: number,
  marker: string,
): Promise<ProcessIdentityInspection> => {
  const result = await runCommand({
    command: 'ps',
    args: ['-p', String(pid), '-o', 'lstart=', '-o', 'command='],
    cwd: process.cwd(),
  });
  if (result.code !== 0 || !result.stdout.trim()) {
    if (processExists(pid)) throw new Error('Process identity unavailable');
    return { running: false, markerMatches: false };
  }
  const line = result.stdout.trim();
  const parsedStartedAt = new Date(line.slice(0, 24));
  if (!Number.isFinite(parsedStartedAt.getTime())) {
    throw new Error('Process identity unavailable');
  }
  return {
    running: true,
    markerMatches: normalizedMarkerMatches(line.slice(25), marker),
    startedAt: parsedStartedAt.toISOString(),
  };
};

const getWindowsPortOccupant = async (port: number) => {
  const script = [
    `$c=Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -First 1`,
    'if ($null -eq $c) { exit 3 }',
    '$p=Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue',
    '[pscustomobject]@{Pid=$c.OwningProcess;Name=if($p){$p.ProcessName}else{\"unknown\"}} | ConvertTo-Json -Compress',
  ].join('; ');
  const result = await runCommand({
    command: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-Command', script],
    cwd: process.cwd(),
  });
  if (result.code === 3 || !result.stdout.trim()) return null;
  if (result.code !== 0) return { processName: 'unknown' };
  const parsed = JSON.parse(result.stdout) as { Pid?: number; Name?: string };
  return { pid: parsed.Pid, processName: parsed.Name ?? 'unknown' };
};

export const createSystemDependencies = (): SystemDependencies => ({
  run: runCommand,
  spawn: (spec) =>
    new Promise((resolve, reject) => {
      const descriptor = openSync(spec.logPath, 'a');
      const startedAt = new Date().toISOString();
      const child = spawnChild(spec.command, spec.args, {
        cwd: spec.cwd,
        env: spec.env,
        shell: spec.shell ?? false,
        detached: true,
        windowsHide: true,
        stdio: ['ignore', descriptor, descriptor],
      });
      closeSync(descriptor);
      child.once('error', reject);
      child.once('spawn', () => {
        if (!child.pid) return reject(new Error('Processo filho sem PID'));
        child.unref();
        resolve({ pid: child.pid, startedAt });
      });
    }),
  inspectProcess: (pid, marker, startedAt) =>
    process.platform === 'win32'
      ? inspectWindowsProcess(pid, marker, startedAt)
      : inspectPosixProcess(pid, marker, startedAt),
  inspectProcessIdentity: (pid, marker) =>
    process.platform === 'win32'
      ? inspectWindowsProcessIdentity(pid, marker)
      : inspectPosixProcessIdentity(pid, marker),
  stopProcessTree: async (pid, inspectedStartedAt) => {
    if (!processExists(pid)) return true;
    if (process.platform === 'win32') {
      if (!inspectedStartedAt) return false;
      const result = await runCommand({
        command: 'powershell.exe',
        args: [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          windowsProcessStopScript(pid, inspectedStartedAt),
        ],
        cwd: process.cwd(),
      });
      return result.code === 0;
    }
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      // O processo pode ter encerrado entre a inspecao e o sinal.
    }
    if (await waitUntilStopped(pid, 5_000)) return true;
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // O processo ja encerrou.
    }
    return waitUntilStopped(pid, 5_000);
  },
  getPortOccupant: async (port) => {
    if (process.platform === 'win32') return getWindowsPortOccupant(port);
    const result = await runCommand({
      command: 'lsof',
      args: ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp', '-Fc'],
      cwd: process.cwd(),
    }).catch(() => ({ code: 1, stdout: '', stderr: '' }));
    if (result.code !== 0) return null;
    const pid = Number(/^p(\d+)$/m.exec(result.stdout)?.[1]);
    const processName = /^c(.+)$/m.exec(result.stdout)?.[1] ?? 'unknown';
    return { ...(Number.isInteger(pid) ? { pid } : {}), processName };
  },
  isProcessInTree: async (rootPid, candidatePid) => {
    const tree =
      process.platform === 'win32'
        ? await getWindowsProcessTree(rootPid)
        : await getPosixProcessTree(rootPid);
    return tree.includes(candidatePid);
  },
  request: async (url, options = {}) => {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      options.timeoutMs ?? 5_000,
    );
    try {
      const response = await fetch(url, {
        headers: options.headers,
        signal: controller.signal,
      });
      const contentType = response.headers.get('content-type') ?? '';
      const body = contentType.includes('application/json')
        ? await response.json().catch(() => undefined)
        : undefined;
      return { ok: response.ok, status: response.status, body };
    } finally {
      clearTimeout(timeout);
    }
  },
  sleep: (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now: () => new Date(),
});
