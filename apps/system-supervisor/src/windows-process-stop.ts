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
  [StructLayout(LayoutKind.Sequential)]
  public struct Accounting {
    public long User, Kernel, PeriodUser, PeriodKernel;
    public uint PageFaults, TotalProcesses, ActiveProcesses, TerminatedProcesses;
  }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool member);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool TerminateJobObject(IntPtr job, uint exitCode);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll", SetLastError=true)]
  private static extern bool QueryInformationJobObject(IntPtr job, int infoClass, out Accounting data, uint length, IntPtr returned);
  public static uint Active(IntPtr job) {
    Accounting data;
    if (!QueryInformationJobObject(job, 1, out data, (uint)Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero)) throw new InvalidOperationException();
    return data.ActiveProcesses;
  }
}
'@
$owned = New-Object 'System.Collections.Generic.List[System.Diagnostics.Process]'
$job = [IntPtr]::Zero
try {
  $rootProcess = [System.Diagnostics.Process]::GetProcessById(${pid})
  $owned.Add($rootProcess)
  [void]$rootProcess.Handle
  $expected = [DateTime]::Parse('${expected}').ToUniversalTime()
  # JavaScript serializes the inspected Windows start time to milliseconds,
  # while DateTime retains sub-millisecond ticks. Preserve the identity pin
  # while accepting that loss of precision.
  if ([Math]::Abs(($rootProcess.StartTime.ToUniversalTime() - $expected).TotalMilliseconds) -gt 1) { exit 4 }
  # Default job limits do not permit breakaway. Future CreateProcess children
  # inherit membership; failure to adopt the owned tree fails closed.
  $job = [SupervisorProcessHandle]::CreateJobObject([IntPtr]::Zero, $null)
  if ($job -eq [IntPtr]::Zero -or ![SupervisorProcessHandle]::AssignProcessToJobObject($job, $rootProcess.Handle)) { exit 4 }
  $byId = @{}
  $byId[${pid}] = $rootProcess
  $passes = 0
  do {
    $passes++
    if ($passes -gt 16) { exit 4 }
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
      if ([Math]::Abs(($child.StartTime.ToUniversalTime() - $entry.CreationDate.ToUniversalTime()).TotalMilliseconds) -ge 1) { exit 4 }
      $member = $false
      if (![SupervisorProcessHandle]::IsProcessInJob($child.Handle, $job, [ref]$member)) { exit 4 }
      if (!$member -and ![SupervisorProcessHandle]::AssignProcessToJobObject($job, $child.Handle)) { exit 4 }
      $byId[$childId] = $child
      $added = $true
      if ($owned.Count -gt 1024) { exit 4 }
    }
  } while ($added)
  # No numeric-PID signal is used, including during force escalation.
  Write-Output 'SUPERVISOR_TREE_CONTAINED'
  # Allow processes already shutting down to exit before forced termination.
  $deadline = [DateTime]::UtcNow.AddSeconds(5)
  do {
    if ([SupervisorProcessHandle]::Active($job) -eq 0) { exit 0 }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $deadline)
  if (![SupervisorProcessHandle]::TerminateJobObject($job, 1)) { exit 5 }
  $deadline = [DateTime]::UtcNow.AddSeconds(5)
  do {
    if ([SupervisorProcessHandle]::Active($job) -eq 0) { exit 0 }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $deadline)
  exit 5
} catch { exit 4 } finally {
  foreach ($process in $owned) { $process.Dispose() }
  if ($job -ne [IntPtr]::Zero) { [void][SupervisorProcessHandle]::CloseHandle($job) }
}
`;
};
