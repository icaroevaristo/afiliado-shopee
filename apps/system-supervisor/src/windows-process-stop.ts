/** Pin OS handles before waiting: a later PID reuse must never become a kill target. */
export const windowsProcessStopScript = (pid: number, startedAt: string) => {
  if (
    !Number.isSafeInteger(pid) ||
    pid <= 0 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3,7}Z$/.test(startedAt) ||
    !Number.isFinite(Date.parse(startedAt))
  ) {
    throw new Error('Invalid process identity');
  }
  const expected = new Date(startedAt).toISOString();
  return `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SupervisorProcessHandle {
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool TerminateProcess(IntPtr handle, uint exitCode);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
}
'@
$owned = New-Object 'System.Collections.Generic.List[System.Diagnostics.Process]'
try {
  $rootProcess = [System.Diagnostics.Process]::GetProcessById(${pid})
  $owned.Add($rootProcess)
  [void]$rootProcess.Handle
  $expected = [DateTime]::Parse('${expected}').ToUniversalTime()
  if ([Math]::Abs(($rootProcess.StartTime.ToUniversalTime() - $expected).TotalMilliseconds) -ge 1) { exit 4 }
  $all = @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CreationDate)
  $byId = @{}
  $byId[${pid}] = $rootProcess
  do {
    $added = $false
    foreach ($entry in $all) {
      $childId = [int]$entry.ProcessId
      $parentId = [int]$entry.ParentProcessId
      if ($byId.ContainsKey($childId) -or !$byId.ContainsKey($parentId)) { continue }
      $parent = $byId[$parentId]
      if ($entry.CreationDate.ToUniversalTime() -lt $parent.StartTime.ToUniversalTime()) { continue }
      $child = [System.Diagnostics.Process]::GetProcessById($childId)
      $owned.Add($child)
      [void]$child.Handle
      if ([Math]::Abs(($child.StartTime.ToUniversalTime() - $entry.CreationDate.ToUniversalTime()).TotalMilliseconds) -ge 1) { exit 4 }
      $byId[$childId] = $child
      $added = $true
      if ($owned.Count -gt 1024) { exit 4 }
    }
  } while ($added)
  # No numeric-PID signal is used, including during force escalation.
  # Allow processes already shutting down to exit before forced termination.
  $deadline = [DateTime]::UtcNow.AddSeconds(5)
  do {
    $alive = @($owned | Where-Object { [SupervisorProcessHandle]::WaitForSingleObject($_.Handle, 0) -ne 0 })
    if ($alive.Count -eq 0) { exit 0 }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $deadline)
  for ($i = $owned.Count - 1; $i -ge 0; $i--) {
    $handle = $owned[$i].Handle
    if ([SupervisorProcessHandle]::WaitForSingleObject($handle, 0) -eq 0) { continue }
    if (![SupervisorProcessHandle]::TerminateProcess($handle, 1) -and [SupervisorProcessHandle]::WaitForSingleObject($handle, 0) -ne 0) { exit 5 }
  }
  foreach ($process in $owned) {
    if ([SupervisorProcessHandle]::WaitForSingleObject($process.Handle, 5000) -ne 0) { exit 5 }
  }
  exit 0
} catch { exit 4 } finally {
  foreach ($process in $owned) { $process.Dispose() }
}
`;
};
