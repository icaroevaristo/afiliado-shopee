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

    $pnpmExecutor = Resolve-LauncherPnpmExecutor -Root $Root -CommandRunner $CommandRunner -CommandLookup $CommandLookup

    $dockerResult = Invoke-LauncherCommandRunner -FilePath 'docker' -Arguments @('info', '--format', '{{.ServerVersion}}') -WorkingDirectory $Root -CommandRunner $CommandRunner
    if ([int]$dockerResult.ExitCode -ne 0) {
        Throw-LauncherError -Code 'DOCKER_DAEMON_UNAVAILABLE' -Message 'O daemon do Docker não respondeu.'
    }
    return $pnpmExecutor
}

function Test-SystemHealthyForLauncher {
    param(
        [Parameter(Mandatory = $true)]
        [psobject]$Status
    )

    if ([string]$Status.overall -ne 'running') { return $false }
    if ([string]$Status.operationLock -ne 'unlocked') { return $false }
    if ([string]$Status.endpoints.api -ne 'available') { return $false }
    if ([string]$Status.endpoints.dashboard -ne 'available') { return $false }
    if ([string]$Status.processes.api -ne 'running') { return $false }
    if ([string]$Status.processes.dashboard -ne 'running') { return $false }
    if ([string]$Status.processes.'commercial-worker' -ne 'running') { return $false }

    if ([string]$Status.mode -eq 'send' -and [string]$Status.processes.'whatsapp-dispatch-worker' -ne 'running') {
        return $false
    }
    if ([string]$Status.mode -eq 'send') {
        if ($null -eq $Status.controlPlane) { return $false }
        if (-not [bool]$Status.controlPlane.configured) { return $false }
        if (-not [bool]$Status.controlPlane.authenticated) { return $false }
    }

    return $true
}

function Get-SystemStatusForLauncher {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Root,

        [scriptblock]$CommandRunner,

        [Parameter(Mandatory = $true)]
        [psobject]$PnpmExecutor
    )

    $result = Invoke-LauncherPnpmCommand -Executor $PnpmExecutor -Arguments @('system:status', '--', '--json') -Root $Root -CommandRunner $CommandRunner
    return ConvertFrom-LauncherJsonOutput -CommandResult $result
}

function Get-LauncherStatusPort {
    param(
        [Parameter(Mandatory = $true)]
        [psobject]$Status,

        [Parameter(Mandatory = $true)]
        [ValidateSet('api', 'dashboard')]
        [string]$Name
    )

    $portsProperty = $Status.PSObject.Properties['ports']
    if ($null -eq $portsProperty -or $null -eq $portsProperty.Value) {
        Throw-LauncherError -Code 'SYSTEM_STATUS_UNKNOWN' -Message 'O supervisor não informou as portas efetivas.'
    }

    $portProperty = $portsProperty.Value.PSObject.Properties[$Name]
    if ($null -eq $portProperty) {
        Throw-LauncherError -Code 'SYSTEM_STATUS_UNKNOWN' -Message 'O supervisor não informou uma porta local válida.'
    }

    $port = 0
    if (-not [int]::TryParse([string]$portProperty.Value, [ref]$port) -or $port -lt 1 -or $port -gt 65535) {
        Throw-LauncherError -Code 'SYSTEM_STATUS_UNKNOWN' -Message 'O supervisor informou uma porta local inválida.'
    }
    return $port
}

function Get-LauncherStatusPorts {
    param(
        [Parameter(Mandatory = $true)]
        [psobject]$Status
    )

    return [pscustomobject]@{
        Api = Get-LauncherStatusPort -Status $Status -Name 'api'
        Dashboard = Get-LauncherStatusPort -Status $Status -Name 'dashboard'
    }
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

        [Parameter(Mandatory = $true)]
        [int]$ApiPort,

        [Parameter(Mandatory = $true)]
        [int]$DashboardPort,

        [int]$TimeoutSeconds,

        [int]$PollSeconds
    )

    if ($TimeoutSeconds -lt 1 -or $PollSeconds -lt 1) {
        Throw-LauncherError -Code 'LAUNCHER_FAILED' -Message 'O timeout do launcher é inválido.'
    }

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    $apiReady = $false
    $dashboardReady = $false
    $apiUrl = 'http://127.0.0.1:{0}/health' -f $ApiPort
    $dashboardUrl = 'http://127.0.0.1:{0}' -f $DashboardPort
    while ([DateTime]::UtcNow -lt $deadline) {
        if (-not $apiReady) {
            $apiReady = Test-LauncherEndpoint -Url $apiUrl -HttpProbe $HttpProbe
        }
        if (-not $dashboardReady) {
            $dashboardReady = Test-LauncherEndpoint -Url $dashboardUrl -HttpProbe $HttpProbe
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
        [scriptblock]$BrowserOpener,

        [Parameter(Mandatory = $true)]
        [int]$DashboardPort
    )

    try {
        $url = 'http://localhost:{0}' -f $DashboardPort
        if ($null -ne $BrowserOpener) {
            & $BrowserOpener $url
        } else {
            Start-Process -FilePath $url | Out-Null
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
            ReadinessApi = 'http://127.0.0.1:3433/health'
            ReadinessDashboard = 'http://127.0.0.1:3000'
            BrowserUrl = 'http://localhost:3000'
            ApiPort = 3433
            DashboardPort = 3000
        }
    }

    $pnpmExecutor = Test-LauncherPrerequisites -Root $resolvedRoot -CommandRunner $CommandRunner -CommandLookup $CommandLookup -SkipWindowsCheck:$SkipWindowsCheck
    $status = Get-SystemStatusForLauncher -Root $resolvedRoot -CommandRunner $CommandRunner -PnpmExecutor $pnpmExecutor
    $statusPorts = Get-LauncherStatusPorts -Status $status

    if ([string]$status.operationLock -eq 'active') {
        Throw-LauncherError -Code 'SYSTEM_OPERATION_IN_PROGRESS' -Message 'Outra operação do sistema está em andamento.'
    }

    if ([string]$status.overall -eq 'running') {
        if (-not (Test-SystemHealthyForLauncher -Status $status)) {
            Throw-LauncherError -Code 'SYSTEM_STATUS_UNKNOWN' -Message 'O supervisor reportou um estado incompleto.'
        }
        if (-not $NoBrowser) { Open-LauncherDashboard -BrowserOpener $BrowserOpener -DashboardPort $statusPorts.Dashboard }
        return [pscustomobject]@{ Action = 'already-running'; RepositoryRoot = $resolvedRoot }
    }

    if ([string]$status.overall -ne 'stopped' -and [string]$status.overall -ne 'partial') {
        Throw-LauncherError -Code 'SYSTEM_STATUS_UNKNOWN' -Message 'O estado do sistema não é reconhecido.'
    }

    $startResult = Invoke-LauncherPnpmCommand -Executor $pnpmExecutor -Arguments @('system:start') -Root $resolvedRoot -CommandRunner $CommandRunner
    if ([int]$startResult.ExitCode -ne 0) {
        Throw-LauncherError -Code 'SYSTEM_START_FAILED' -Message 'O supervisor não conseguiu iniciar o sistema.'
    }

    $startedStatus = Get-SystemStatusForLauncher -Root $resolvedRoot -CommandRunner $CommandRunner -PnpmExecutor $pnpmExecutor
    $startedStatusPorts = Get-LauncherStatusPorts -Status $startedStatus
    Wait-LauncherReadiness -HttpProbe $HttpProbe -ApiPort $startedStatusPorts.Api -DashboardPort $startedStatusPorts.Dashboard -TimeoutSeconds $TimeoutSeconds -PollSeconds $PollSeconds
    $readyStatus = Get-SystemStatusForLauncher -Root $resolvedRoot -CommandRunner $CommandRunner -PnpmExecutor $pnpmExecutor
    $readyStatusPorts = Get-LauncherStatusPorts -Status $readyStatus
    if ($readyStatusPorts.Api -ne $startedStatusPorts.Api -or $readyStatusPorts.Dashboard -ne $startedStatusPorts.Dashboard) {
        Throw-LauncherError -Code 'SYSTEM_STATUS_UNKNOWN' -Message 'As portas do supervisor mudaram durante a inicialização.'
    }
    if (-not (Test-SystemHealthyForLauncher -Status $readyStatus)) {
        Throw-LauncherError -Code 'SYSTEM_STATUS_UNKNOWN' -Message 'O control plane autenticado não ficou pronto.'
    }
    if (-not $NoBrowser) { Open-LauncherDashboard -BrowserOpener $BrowserOpener -DashboardPort $readyStatusPorts.Dashboard }
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
