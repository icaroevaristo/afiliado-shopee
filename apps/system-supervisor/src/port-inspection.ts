import {
  LocalSystemError,
  type CommandSpec,
  type CommandResult,
  type PortOccupant,
} from './types';

const unavailable = (): never => {
  throw new LocalSystemError(
    'Consulta de porta indisponivel',
    'SYSTEM_PORT_INSPECTION_UNAVAILABLE',
  );
};

export const readPortOccupant = async (
  port: number,
  platform: NodeJS.Platform,
  run: (spec: CommandSpec) => Promise<CommandResult>,
): Promise<PortOccupant | null> => {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return unavailable();
  if (platform === 'win32') {
    // Enumerating native listeners returns an empty collection on success, and throws
    // on inspection failure. Never turn a suppressed CIM/PowerShell error into "free".
    const script = [
      "$ErrorActionPreference='Stop'",
      'try {',
      '$listeners=[System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()',
      `if (-not ($listeners | Where-Object { $_.Port -eq ${port} })) { '{"Occupied":false}'; exit 0 }`,
      `$c=Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction Stop | Select-Object -First 1`,
      'if ($null -eq $c) { throw "unavailable" }',
      '$p=Get-Process -Id $c.OwningProcess -ErrorAction Stop',
      '[pscustomobject]@{Occupied=$true;Pid=$c.OwningProcess;Name=$p.ProcessName} | ConvertTo-Json -Compress',
      '} catch { [Console]::Error.WriteLine("PORT_INSPECTION_UNAVAILABLE"); exit 1 }',
    ].join('; ');
    const result = await run({
      command: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-Command', script],
      cwd: process.cwd(),
    });
    if (result.code !== 0 || result.stderr.trim() || !result.stdout.trim())
      return unavailable();
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      return unavailable();
    }
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      !('Occupied' in parsed)
    )
      return unavailable();
    if (parsed.Occupied === false && Object.keys(parsed).length === 1)
      return null;
    if (
      parsed.Occupied !== true ||
      !('Pid' in parsed) ||
      typeof parsed.Pid !== 'number' ||
      !Number.isInteger(parsed.Pid) ||
      parsed.Pid <= 0 ||
      !('Name' in parsed) ||
      typeof parsed.Name !== 'string' ||
      !parsed.Name
    )
      return unavailable();
    return { pid: parsed.Pid, processName: parsed.Name };
  }
  // -Q makes an empty search successful; exit 1 remains an error, including
  // unsupported -Q. https://lsof.readthedocs.io/en/stable/manpage/#diagnostics
  const result = await run({
    command: 'lsof',
    args: ['-Q', '-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp', '-Fc'],
    cwd: process.cwd(),
  });
  if (result.code !== 0 || result.stderr.trim()) return unavailable();
  if (!result.stdout.trim()) return null;
  const pid = Number(/^p(\d+)$/m.exec(result.stdout)?.[1]);
  const processName = /^c(.+)$/m.exec(result.stdout)?.[1];
  if (!Number.isInteger(pid) || pid <= 0 || !processName) return unavailable();
  return { pid, processName };
};
