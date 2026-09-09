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
  public static extern bool TerminateProcess(IntPtr process, uint exitCode);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool CloseHandle(IntPtr handle);
}
'@
$owned = New-Object 'System.Collections.Generic.List[System.Diagnostics.Process]'
$depthById = @{}
try {
  $rootProcess = [System.Diagnostics.Process]::GetProcessById(${pid})
  $owned.Add($rootProcess)
  [void]$rootProcess.Handle
  $expected = [DateTime]::Parse('${expected}').ToUniversalTime()
  # JavaScript serializes the inspected Windows start time to milliseconds,
  # while DateTime retains sub-millisecond ticks. Preserve the identity pin
  # while accepting that loss of precision.
  if ([Math]::Abs(($rootProcess.StartTime.ToUniversalTime() - $expected).TotalMilliseconds) -gt 1) { exit 4 }
  $byId = @{}
  $byId[${pid}] = $rootProcess
  $depthById[${pid}] = 0
  function Add-OwnedDescendants {
    $all = @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CreationDate)
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
      if ([Math]::Abs(($child.StartTime.ToUniversalTime() - $entry.CreationDate.ToUniversalTime()).TotalMilliseconds) -gt 1) { exit 4 }
      $byId[$childId] = $child
      $depthById[$childId] = [int]$depthById[$parentId] + 1
      $added = $true
      if ($owned.Count -gt 1024) { exit 4 }
    }
    return $added
  }
  $passes = 0
  do {
    $passes++
    if ($passes -gt 16) { exit 4 }
    $added = Add-OwnedDescendants
  } while ($added)
  # No numeric-PID signal is used. The marker gives a process that forks while
  # the first inventory runs a bounded window to become part of the pinned set.
  Write-Output 'SUPERVISOR_TREE_CONTAINED'
  for ($poll = 0; $poll -lt 5; $poll++) {
    Start-Sleep -Milliseconds 100
    [void](Add-OwnedDescendants)
  }
  # Terminate pinned descendants before their parent. A Process.Handle remains
  # bound to the inspected process even if its numeric PID is later reused.
  foreach ($ownedProcess in @($owned | Sort-Object { $depthById[$_.Id] } -Descending)) {
    if ($ownedProcess.HasExited) { continue }
    if (![SupervisorProcessHandle]::TerminateProcess($ownedProcess.Handle, 1) -and !$ownedProcess.HasExited) { exit 5 }
  }
  $deadline = [DateTime]::UtcNow.AddSeconds(5)
  do {
    if (@($owned | Where-Object { !$_.HasExited }).Count -eq 0) { exit 0 }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $deadline)
  exit 5
} catch { exit 4 } finally {
  foreach ($process in $owned) { $process.Dispose() }
}
`;
};
