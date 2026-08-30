[CmdletBinding()]
param(
    [string]$RepositoryRoot,
    [switch]$DryRun,
    [switch]$Library
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'launcher-common.ps1')

function Invoke-StopLauncher {
    param(
        [string]$Root,
        [switch]$DryRun,
        [scriptblock]$CommandRunner,
        [scriptblock]$CommandLookup,
        [switch]$SkipWindowsCheck
    )

    $resolvedRoot = Resolve-LauncherRepositoryRoot -CandidateRoot $Root
    if (-not $SkipWindowsCheck -and [Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
        Throw-LauncherError -Code 'WINDOWS_REQUIRED' -Message 'O launcher exige Windows.'
    }
    if ($DryRun) {
        return [pscustomobject]@{
            Mode = 'DryRun'
            RepositoryRoot = $resolvedRoot
            StopCommand = 'corepack pnpm system:stop'
        }
    }
    $pnpmExecutor = Resolve-LauncherPnpmExecutor -Root $resolvedRoot -CommandRunner $CommandRunner -CommandLookup $CommandLookup

    $stopResult = Invoke-LauncherPnpmCommand -Executor $pnpmExecutor -Arguments @('system:stop') -Root $resolvedRoot -CommandRunner $CommandRunner
    if ([int]$stopResult.ExitCode -ne 0) {
        if ([string]$stopResult.Output -match 'SYSTEM_STOP_INCOMPLETE') {
            Throw-LauncherError -Code 'SYSTEM_STOP_INCOMPLETE' -Message 'O supervisor não encerrou todos os recursos.'
        }
        Throw-LauncherError -Code 'SYSTEM_STOP_FAILED' -Message 'O supervisor não conseguiu encerrar o sistema.'
    }
    return [pscustomobject]@{ Action = 'stopped'; RepositoryRoot = $resolvedRoot }
}

if (-not $Library) {
    $rootForLog = $RepositoryRoot
    try {
        $result = Invoke-StopLauncher -Root $RepositoryRoot -DryRun:$DryRun
        if ($DryRun) {
            $result | ConvertTo-Json -Compress
        }
    } catch {
        $code = Get-LauncherErrorCode -ErrorRecord $_
        if ([string]::IsNullOrWhiteSpace($rootForLog)) {
            try { $rootForLog = Resolve-LauncherRepositoryRoot -CandidateRoot $RepositoryRoot } catch { $rootForLog = $null }
        }
        if (-not [string]::IsNullOrWhiteSpace($rootForLog)) {
            Write-LauncherTechnicalLog -Root $rootForLog -Code $code -Stage 'stop'
        }
        Show-LauncherMessage -Title 'Shopee Affiliate' -Message (Get-LauncherFriendlyMessage -Code $code)
        exit 1
    }
}
