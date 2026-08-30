[CmdletBinding()]
param(
    [string]$RepositoryRoot,
    [switch]$DryRun,
    [switch]$NoBrowser,
    [switch]$Library,
    [int]$ReadinessTimeoutSeconds = 90,
    [int]$PollIntervalSeconds = 2
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'launcher-common.ps1')

function Test-LauncherPrerequisites {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Root,

        [scriptblock]$CommandRunner,
        [scriptblock]$CommandLookup,
        [switch]$SkipWindowsCheck
    )

    if (-not $SkipWindowsCheck -and [Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
        Throw-LauncherError -Code 'WINDOWS_REQUIRED' -Message 'O launcher exige Windows.'
    }

    if (-not (Test-Path -LiteralPath (Join-Path $Root '.env') -PathType Leaf)) {
        Throw-LauncherError -Code 'ENV_NOT_FOUND' -Message 'O arquivo .env não foi encontrado.'
    }

    if (-not (Test-LauncherCommandAvailable -Name 'node' -CommandLookup $CommandLookup)) {
        Throw-LauncherError -Code 'NODE_UNAVAILABLE' -Message 'Node.js não está disponível.'
    }
    if (-not (Test-LauncherCommandAvailable -Name 'corepack' -CommandLookup $CommandLookup)) {
        Throw-LauncherError -Code 'COREPACK_UNAVAILABLE' -Message 'Corepack não está disponível.'
    }
    if (-not (Test-LauncherCommandAvailable -Name 'docker' -CommandLookup $CommandLookup)) {
        Throw-LauncherError -Code 'DOCKER_CLI_UNAVAILABLE' -Message 'Docker CLI não está disponível.'
    }

    $nodeResult = Invoke-LauncherCommandRunner -FilePath 'node' -Arguments @('--version') -WorkingDirectory $Root -CommandRunner $CommandRunner
    if ([int]$nodeResult.ExitCode -ne 0) {
        Throw-LauncherError -Code 'NODE_UNAVAILABLE' -Message 'Node.js não respondeu.'
    }
    $nodeMatch = [regex]::Match(([string]$nodeResult.Output).Trim(), '^v(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)')
    if (-not $nodeMatch.Success) {
        Throw-LauncherError -Code 'NODE_VERSION_UNSUPPORTED' -Message 'A versão do Node.js não pôde ser validada.'
    }
    $nodeVersion = [version]::new(
        [int]$nodeMatch.Groups['major'].Value,
        [int]$nodeMatch.Groups['minor'].Value,
        [int]$nodeMatch.Groups['patch'].Value
    )
    if ($nodeVersion -lt [version]::new(20, 6, 0)) {
        Throw-LauncherError -Code 'NODE_VERSION_UNSUPPORTED' -Message 'A versão do Node.js é antiga.'
    }

    $pnpmResult = Invoke-LauncherCommandRunner -FilePath 'corepack' -Arguments @('pnpm', '--version') -WorkingDirectory $Root -CommandRunner $CommandRunner
    if ([int]$pnpmResult.ExitCode -ne 0) {
        Throw-LauncherError -Code 'PNPM_UNAVAILABLE' -Message 'O pnpm não respondeu pelo Corepack.'
    }

    $dockerResult = Invoke-LauncherCommandRunner -FilePath 'docker' -Arguments @('info', '--format', '{{.ServerVersion}}') -WorkingDirectory $Root -CommandRunner $CommandRunner
    if ([int]$dockerResult.ExitCode -ne 0) {
        Throw-LauncherError -Code 'DOCKER_DAEMON_UNAVAILABLE' -Message 'O daemon do Docker não respondeu.'
    }
}

function Test-SystemHealthyForLauncher {
    param(
        [Parameter(Mandatory = $true)]
        [psobject]$Status
    )

    if ([string]$Status.overall -ne 'running') { return $false }
    if ([string]$Status.endpoints.api -ne 'available') { return $false }
    if ([string]$Status.endpoints.dashboard -ne 'available') { return $false }
    if ([string]$Status.processes.api -ne 'running') { return $false }
    if ([string]$Status.processes.dashboard -ne 'running') { return $false }
    if ([string]$Status.processes.'commercial-worker' -ne 'running') { return $false }

    if ([string]$Status.mode -eq 'send' -and [string]$Status.processes.'whatsapp-dispatch-worker' -ne 'running') {
        return $false
    }

    return $true
}

function Get-SystemStatusForLauncher {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Root,

        [scriptblock]$CommandRunner
    )

    $result = Invoke-LauncherCommandRunner -FilePath 'corepack' -Arguments @('pnpm', 'system:status', '--', '--json') -WorkingDirectory $Root -CommandRunner $CommandRunner
    return ConvertFrom-LauncherJsonOutput -CommandResult $result
}

function Test-LauncherEndpoint {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Url,

        [scriptblock]$HttpProbe
    )

    if ($null -ne $HttpProbe) {
        return [bool](& $HttpProbe $Url)
    }

    try {
        $response = Invoke-WebRequest -Uri $Url -Method Get -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
        return [int]$response.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Wait-LauncherReadiness {
    param(
        [scriptblock]$HttpProbe,

        [int]$TimeoutSeconds,

        [int]$PollSeconds
    )

    if ($TimeoutSeconds -lt 1 -or $PollSeconds -lt 1) {
        Throw-LauncherError -Code 'LAUNCHER_FAILED' -Message 'O timeout do launcher é inválido.'
    }

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    $apiReady = $false
    $dashboardReady = $false
    while ([DateTime]::UtcNow -lt $deadline) {
        if (-not $apiReady) {
            $apiReady = Test-LauncherEndpoint -Url 'http://127.0.0.1:3333/health' -HttpProbe $HttpProbe
        }
        if (-not $dashboardReady) {
            $dashboardReady = Test-LauncherEndpoint -Url 'http://127.0.0.1:3000' -HttpProbe $HttpProbe
        }
        if ($apiReady -and $dashboardReady) { return }
        Start-Sleep -Seconds $PollSeconds
    }

    if (-not $apiReady) {
        Throw-LauncherError -Code 'API_NOT_READY' -Message 'A API não ficou pronta.'
    }
    Throw-LauncherError -Code 'DASHBOARD_NOT_READY' -Message 'O dashboard não ficou pronto.'
}

function Open-LauncherDashboard {
    param(
        [scriptblock]$BrowserOpener
    )

    try {
        if ($null -ne $BrowserOpener) {
            & $BrowserOpener 'http://localhost:3000'
        } else {
            Start-Process -FilePath 'http://localhost:3000' | Out-Null
        }
    } catch {
        Throw-LauncherError -Code 'BROWSER_OPEN_FAILED' -Message 'O navegador não pôde ser aberto.'
    }
}

function Invoke-StartLauncher {
    param(
        [string]$Root,
        [switch]$DryRun,
        [switch]$NoBrowser,
        [int]$TimeoutSeconds = 90,
        [int]$PollSeconds = 2,
        [scriptblock]$CommandRunner,
        [scriptblock]$CommandLookup,
        [scriptblock]$HttpProbe,
        [scriptblock]$BrowserOpener,
        [switch]$SkipWindowsCheck
    )

    $resolvedRoot = Resolve-LauncherRepositoryRoot -CandidateRoot $Root
    if ($DryRun) {
        return [pscustomobject]@{
            Mode = 'DryRun'
            RepositoryRoot = $resolvedRoot
            StatusCommand = 'corepack pnpm system:status -- --json'
            StartCommand = 'corepack pnpm system:start'
            ReadinessApi = 'http://127.0.0.1:3333/health'
            ReadinessDashboard = 'http://127.0.0.1:3000'
            BrowserUrl = 'http://localhost:3000'
        }
    }

    Test-LauncherPrerequisites -Root $resolvedRoot -CommandRunner $CommandRunner -CommandLookup $CommandLookup -SkipWindowsCheck:$SkipWindowsCheck
    $status = Get-SystemStatusForLauncher -Root $resolvedRoot -CommandRunner $CommandRunner

    if ([string]$status.operationLock -eq 'active') {
        Throw-LauncherError -Code 'SYSTEM_OPERATION_IN_PROGRESS' -Message 'Outra operação do sistema está em andamento.'
    }

    if ([string]$status.overall -eq 'running') {
        if (-not (Test-SystemHealthyForLauncher -Status $status)) {
            Throw-LauncherError -Code 'SYSTEM_STATUS_UNKNOWN' -Message 'O supervisor reportou um estado incompleto.'
        }
        if (-not $NoBrowser) { Open-LauncherDashboard -BrowserOpener $BrowserOpener }
        return [pscustomobject]@{ Action = 'already-running'; RepositoryRoot = $resolvedRoot }
    }

    if ([string]$status.overall -ne 'stopped' -and [string]$status.overall -ne 'partial') {
        Throw-LauncherError -Code 'SYSTEM_STATUS_UNKNOWN' -Message 'O estado do sistema não é reconhecido.'
    }

    $startResult = Invoke-LauncherCommandRunner -FilePath 'corepack' -Arguments @('pnpm', 'system:start') -WorkingDirectory $resolvedRoot -CommandRunner $CommandRunner
    if ([int]$startResult.ExitCode -ne 0) {
        Throw-LauncherError -Code 'SYSTEM_START_FAILED' -Message 'O supervisor não conseguiu iniciar o sistema.'
    }

    Wait-LauncherReadiness -HttpProbe $HttpProbe -TimeoutSeconds $TimeoutSeconds -PollSeconds $PollSeconds
    if (-not $NoBrowser) { Open-LauncherDashboard -BrowserOpener $BrowserOpener }
    return [pscustomobject]@{ Action = 'started'; RepositoryRoot = $resolvedRoot }
}

if (-not $Library) {
    $rootForLog = $RepositoryRoot
    try {
        $result = Invoke-StartLauncher -Root $RepositoryRoot -DryRun:$DryRun -NoBrowser:$NoBrowser -TimeoutSeconds $ReadinessTimeoutSeconds -PollSeconds $PollIntervalSeconds
        if ($DryRun) {
            $result | ConvertTo-Json -Compress
        }
    } catch {
        $code = Get-LauncherErrorCode -ErrorRecord $_
        if ([string]::IsNullOrWhiteSpace($rootForLog)) {
            try { $rootForLog = Resolve-LauncherRepositoryRoot -CandidateRoot $RepositoryRoot } catch { $rootForLog = $null }
        }
        if (-not [string]::IsNullOrWhiteSpace($rootForLog)) {
            Write-LauncherTechnicalLog -Root $rootForLog -Code $code -Stage 'start'
        }
        Show-LauncherMessage -Title 'Shopee Affiliate' -Message (Get-LauncherFriendlyMessage -Code $code)
        exit 1
    }
}
