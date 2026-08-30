[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptRoot = Split-Path -Parent $PSCommandPath
. (Join-Path $scriptRoot 'launcher-common.ps1')
. (Join-Path $scriptRoot 'start-shopee-affiliate.ps1') -Library
. (Join-Path $scriptRoot 'stop-shopee-affiliate.ps1') -Library
. (Join-Path $scriptRoot 'install-shopee-affiliate-shortcuts.ps1') -Library

$script:assertions = 0

function Assert-LauncherTrue {
    param(
        [bool]$Condition,
        [string]$Message
    )
    $script:assertions++
    if (-not $Condition) { throw "ASSERTION_FAILED: $Message" }
}

function Assert-LauncherEqual {
    param(
        [object]$Actual,
        [object]$Expected,
        [string]$Message
    )
    $script:assertions++
    if ($Actual -ne $Expected) {
        throw "ASSERTION_FAILED: $Message (actual=$Actual expected=$Expected)"
    }
}

function Assert-LauncherThrowsCode {
    param(
        [scriptblock]$Action,
        [string]$ExpectedCode,
        [string]$Message
    )
    $script:assertions++
    try {
        & $Action
        throw "ASSERTION_FAILED: $Message (no error)"
    } catch {
        $code = Get-LauncherErrorCode -ErrorRecord $_
        if ($code -ne $ExpectedCode) {
            throw "ASSERTION_FAILED: $Message (actual=$code expected=$ExpectedCode)"
        }
    }
}

$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) 'Shopee Affiliate Launcher Test Root'
if (Test-Path -LiteralPath $fixtureRoot) {
    [IO.Directory]::Delete($fixtureRoot, $true)
}
[void](New-Item -ItemType Directory -Path (Join-Path $fixtureRoot 'apps\system-supervisor\src') -Force)
[void](New-Item -ItemType Directory -Path (Join-Path $fixtureRoot 'apps\api\src') -Force)
[void](New-Item -ItemType Directory -Path (Join-Path $fixtureRoot 'apps\dashboard') -Force)
[void](New-Item -ItemType Directory -Path (Join-Path $fixtureRoot 'apps\worker\src') -Force)
[IO.File]::WriteAllText((Join-Path $fixtureRoot 'package.json'), '{}')
[IO.File]::WriteAllText((Join-Path $fixtureRoot 'pnpm-lock.yaml'), 'lockfileVersion: 9')
[IO.File]::WriteAllText((Join-Path $fixtureRoot 'apps\system-supervisor\src\cli.ts'), '')
[IO.File]::WriteAllText((Join-Path $fixtureRoot 'apps\api\src\server.ts'), '')
[IO.File]::WriteAllText((Join-Path $fixtureRoot 'apps\dashboard\package.json'), '{}')
[IO.File]::WriteAllText((Join-Path $fixtureRoot 'apps\worker\src\commercial-automation-worker.ts'), '')
[IO.File]::WriteAllText((Join-Path $fixtureRoot 'apps\worker\src\whatsapp-dispatch-runtime.ts'), '')
[IO.File]::WriteAllText((Join-Path $fixtureRoot '.env'), '# test fixture only')

try {
    $dryRun = Invoke-StartLauncher -Root $fixtureRoot -DryRun
    Assert-LauncherEqual $dryRun.Mode 'DryRun' 'start dry-run does not execute commands'
    Assert-LauncherTrue ($dryRun.StatusCommand -eq 'corepack pnpm system:status -- --json') 'start delegates status to supervisor'
    Assert-LauncherTrue ($dryRun.StartCommand -eq 'corepack pnpm system:start') 'start delegates lifecycle to supervisor'
    Assert-LauncherTrue ($dryRun.RepositoryRoot -like '*Shopee Affiliate Launcher Test Root') 'repository paths with spaces resolve'

    $script:launcherCalls = @()
    $script:browserCalls = @()
    $healthyStatus = [pscustomobject]@{
        overall = 'running'
        operationLock = 'unlocked'
        mode = 'send'
        endpoints = [pscustomobject]@{ api = 'available'; dashboard = 'available' }
        processes = [pscustomobject]@{ api = 'running'; dashboard = 'running'; 'commercial-worker' = 'running'; 'whatsapp-dispatch-worker' = 'running' }
    }
    $stoppedStatus = [pscustomobject]@{
        overall = 'stopped'
        operationLock = 'unlocked'
        mode = 'send'
        endpoints = [pscustomobject]@{ api = 'unavailable'; dashboard = 'unavailable' }
        processes = [pscustomobject]@{ api = 'stopped'; dashboard = 'stopped'; 'commercial-worker' = 'stopped'; 'whatsapp-dispatch-worker' = 'stopped' }
    }
    $script:fakeStatus = $healthyStatus
    $runner = {
        param($FilePath, $Arguments, $WorkingDirectory)
        $script:launcherCalls += [pscustomobject]@{ FilePath = $FilePath; Arguments = @($Arguments); WorkingDirectory = $WorkingDirectory }
        if ($FilePath -eq 'node') { return [pscustomobject]@{ ExitCode = 0; Output = 'v20.11.1' } }
        if ($FilePath -eq 'docker') { return [pscustomobject]@{ ExitCode = 0; Output = '27.0.0' } }
        if ($FilePath -eq 'corepack' -and $Arguments[1] -eq '--version') { return [pscustomobject]@{ ExitCode = 0; Output = '9.12.3' } }
        if ($FilePath -eq 'corepack' -and $Arguments[1] -eq 'system:status') { return [pscustomobject]@{ ExitCode = 0; Output = ($script:fakeStatus | ConvertTo-Json -Compress -Depth 5) } }
        if ($FilePath -eq 'corepack' -and $Arguments[1] -eq 'system:start') { return [pscustomobject]@{ ExitCode = 0; Output = 'started' } }
        if ($FilePath -eq 'corepack' -and $Arguments[1] -eq 'system:stop') { return [pscustomobject]@{ ExitCode = 0; Output = 'stopped' } }
        return [pscustomobject]@{ ExitCode = 0; Output = '' }
    }
    $lookup = { param($Name) return $true }
    $browser = { param($Url) $script:browserCalls += $Url }
    $httpReady = { param($Url) return $true }

    $runningResult = Invoke-StartLauncher -Root $fixtureRoot -CommandRunner $runner -CommandLookup $lookup -HttpProbe $httpReady -BrowserOpener $browser -SkipWindowsCheck
    Assert-LauncherEqual $runningResult.Action 'already-running' 'healthy system is reused'
    Assert-LauncherEqual (@($script:launcherCalls | Where-Object { $_.Arguments -contains 'system:start' }).Count) 0 'already-running does not start another system'
    Assert-LauncherEqual $script:browserCalls.Count 1 'already-running opens the dashboard once'

    $script:fakeStatus = [pscustomobject]@{
        overall = 'running'
        operationLock = 'stale'
        mode = 'send'
        endpoints = [pscustomobject]@{ api = 'available'; dashboard = 'available' }
        processes = [pscustomobject]@{ api = 'running'; dashboard = 'running'; 'commercial-worker' = 'running'; 'whatsapp-dispatch-worker' = 'running' }
    }
    Assert-LauncherThrowsCode { Invoke-StartLauncher -Root $fixtureRoot -CommandRunner $runner -CommandLookup $lookup -SkipWindowsCheck } 'SYSTEM_STATUS_UNKNOWN' 'uncertain supervisor lock does not count as healthy'

    $script:launcherCalls = @()
    $script:browserCalls = @()
    $script:fakeStatus = $stoppedStatus
    $startedResult = Invoke-StartLauncher -Root $fixtureRoot -CommandRunner $runner -CommandLookup $lookup -HttpProbe $httpReady -BrowserOpener $browser -SkipWindowsCheck -TimeoutSeconds 1 -PollSeconds 1
    Assert-LauncherEqual $startedResult.Action 'started' 'stopped system is started through supervisor'
    Assert-LauncherEqual (@($script:launcherCalls | Where-Object { $_.Arguments -contains 'system:start' }).Count) 1 'start command is issued once'
    Assert-LauncherEqual $script:browserCalls.Count 1 'started system opens the dashboard once'

    $statusFailureRunner = {
        param($FilePath, $Arguments, $WorkingDirectory)
        if ($FilePath -eq 'node') { return [pscustomobject]@{ ExitCode = 0; Output = 'v20.11.1' } }
        if ($FilePath -eq 'docker') { return [pscustomobject]@{ ExitCode = 0; Output = '27.0.0' } }
        if ($FilePath -eq 'corepack' -and $Arguments[1] -eq '--version') { return [pscustomobject]@{ ExitCode = 0; Output = '9.12.3' } }
        return [pscustomobject]@{ ExitCode = 1; Output = 'status unavailable' }
    }
    Assert-LauncherThrowsCode { Invoke-StartLauncher -Root $fixtureRoot -CommandRunner $statusFailureRunner -CommandLookup $lookup -SkipWindowsCheck } 'SYSTEM_STATUS_UNAVAILABLE' 'status failure is fail-closed'

    $dockerFailureRunner = {
        param($FilePath, $Arguments, $WorkingDirectory)
        if ($FilePath -eq 'node') { return [pscustomobject]@{ ExitCode = 0; Output = 'v20.11.1' } }
        if ($FilePath -eq 'docker') { return [pscustomobject]@{ ExitCode = 1; Output = 'daemon unavailable' } }
        return [pscustomobject]@{ ExitCode = 0; Output = '9.12.3' }
    }
    Assert-LauncherThrowsCode { Invoke-StartLauncher -Root $fixtureRoot -CommandRunner $dockerFailureRunner -CommandLookup $lookup -SkipWindowsCheck } 'DOCKER_DAEMON_UNAVAILABLE' 'Docker daemon failure is friendly and fail-closed'

    $startFailureRunner = {
        param($FilePath, $Arguments, $WorkingDirectory)
        if ($FilePath -eq 'node') { return [pscustomobject]@{ ExitCode = 0; Output = 'v20.11.1' } }
        if ($FilePath -eq 'docker') { return [pscustomobject]@{ ExitCode = 0; Output = '27.0.0' } }
        if ($FilePath -eq 'corepack' -and $Arguments[1] -eq '--version') { return [pscustomobject]@{ ExitCode = 0; Output = '9.12.3' } }
        if ($FilePath -eq 'corepack' -and $Arguments[1] -eq 'system:status') { return [pscustomobject]@{ ExitCode = 0; Output = ($stoppedStatus | ConvertTo-Json -Compress -Depth 5) } }
        return [pscustomobject]@{ ExitCode = 1; Output = 'start failed' }
    }
    Assert-LauncherThrowsCode { Invoke-StartLauncher -Root $fixtureRoot -CommandRunner $startFailureRunner -CommandLookup $lookup -SkipWindowsCheck } 'SYSTEM_START_FAILED' 'start failure is surfaced without raw stack trace'

    $httpFailure = { param($Url) return $false }
    Assert-LauncherThrowsCode { Invoke-StartLauncher -Root $fixtureRoot -CommandRunner $runner -CommandLookup $lookup -HttpProbe $httpFailure -NoBrowser -SkipWindowsCheck -TimeoutSeconds 1 -PollSeconds 1 } 'API_NOT_READY' 'API timeout is bounded'

    $stopCalls = @()
    $stopRunner = {
        param($FilePath, $Arguments, $WorkingDirectory)
        $script:stopCalls += [pscustomobject]@{ FilePath = $FilePath; Arguments = @($Arguments) }
        return [pscustomobject]@{ ExitCode = 0; Output = 'stopped' }
    }
    $stopResult = Invoke-StopLauncher -Root $fixtureRoot -CommandRunner $stopRunner -CommandLookup $lookup -SkipWindowsCheck
    Assert-LauncherEqual $stopResult.Action 'stopped' 'stop delegates to supervisor'
    Assert-LauncherEqual (@($script:stopCalls | Where-Object { $_.Arguments -contains 'system:stop' }).Count) 1 'stop uses exactly system:stop'

    $incompleteStopRunner = { param($FilePath, $Arguments, $WorkingDirectory) return [pscustomobject]@{ ExitCode = 1; Output = 'SYSTEM_STOP_INCOMPLETE' } }
    Assert-LauncherThrowsCode { Invoke-StopLauncher -Root $fixtureRoot -CommandRunner $incompleteStopRunner -CommandLookup $lookup -SkipWindowsCheck } 'SYSTEM_STOP_INCOMPLETE' 'stop incomplete never force-kills processes'

    $profile = Get-DailyRuntimeProfile
    $forbiddenProfileKeys = @('DATABASE_URL', 'REDIS_URL', 'OPENAI_API_KEY', 'SHOPEE_AFFILIATE_SECRET', 'EVOLUTION_API_KEY', 'LOCAL_API_AUTH_TOKEN')
    foreach ($key in $forbiddenProfileKeys) {
        Assert-LauncherTrue (-not $profile.Contains($key)) "daily profile does not include $key"
    }
    $projectRoot = (Resolve-Path -LiteralPath (Join-Path $scriptRoot '..\..')).Path
    $installDryRun = Invoke-InstallLauncher -Root $projectRoot -Desktop $fixtureRoot -InstallRuntimeProfile -DryRun -SkipWindowsCheck
    Assert-LauncherEqual $installDryRun.Mode 'DryRun' 'installer dry-run does not create files'
    Assert-LauncherEqual (Test-Path -LiteralPath (Join-Path $fixtureRoot 'runtime.env')) $false 'dry-run does not write runtime.env'

    Write-Output "PASS: $script:assertions launcher assertions"
} finally {
    if (Test-Path -LiteralPath $fixtureRoot) {
        [IO.Directory]::Delete($fixtureRoot, $true)
    }
}
