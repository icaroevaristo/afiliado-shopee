[CmdletBinding()]
param(
    [string]$RepositoryRoot,
    [string]$DesktopPath,
    [switch]$InstallRuntimeProfile,
    [switch]$DryRun,
    [switch]$Library,
    [switch]$SkipWindowsCheck
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'launcher-common.ps1')

function Get-RuntimeProfileBackupPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Root
    )

    return Join-Path $Root '.runtime\local-system\runtime-profile-backup.json'
}

function Get-RuntimeProfileExistingValues {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RuntimeEnvPath,

        [Parameter(Mandatory = $true)]
        [System.Collections.IDictionary]$Profile
    )

    $values = [ordered]@{}
    foreach ($key in $Profile.Keys) {
        $values[$key] = [pscustomobject]@{ Present = $false; Value = $null }
    }

    if (-not (Test-Path -LiteralPath $RuntimeEnvPath -PathType Leaf)) {
        return $values
    }

    foreach ($line in [System.IO.File]::ReadAllLines($RuntimeEnvPath)) {
        $match = [regex]::Match($line, '^\s*(?:export\s+)?(?<key>[A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?<value>.*)\s*$')
        if ($match.Success -and $Profile.Contains($match.Groups['key'].Value)) {
            $key = $match.Groups['key'].Value
            $values[$key] = [pscustomobject]@{
                Present = $true
                Value = $match.Groups['value'].Value
            }
        }
    }
    return $values
}

function Write-RuntimeProfileBackup {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Root,

        [Parameter(Mandatory = $true)]
        [string]$RuntimeEnvPath,

        [Parameter(Mandatory = $true)]
        [System.Collections.IDictionary]$Profile
    )

    $backupPath = Get-RuntimeProfileBackupPath -Root $Root
    if (Test-Path -LiteralPath $backupPath -PathType Leaf) {
        return $backupPath
    }

    $directory = Split-Path -Parent $backupPath
    [void](New-Item -ItemType Directory -Path $directory -Force)
    $existingValues = Get-RuntimeProfileExistingValues -RuntimeEnvPath $RuntimeEnvPath -Profile $Profile
    $snapshot = [ordered]@{
        createdAt = [DateTime]::UtcNow.ToString('o')
        file = 'runtime.env'
        values = $existingValues
    }
    $json = $snapshot | ConvertTo-Json -Depth 5
    [System.IO.File]::WriteAllText($backupPath, $json, [System.Text.UTF8Encoding]::new($false))
    return $backupPath
}

function Install-DailyRuntimeProfile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Root
    )

    $profile = Get-DailyRuntimeProfile
    $runtimeEnvPath = Join-Path $Root 'runtime.env'
    $backupPath = Write-RuntimeProfileBackup -Root $Root -RuntimeEnvPath $runtimeEnvPath -Profile $profile
    $lines = @()
    if (Test-Path -LiteralPath $runtimeEnvPath -PathType Leaf) {
        $lines = @([System.IO.File]::ReadAllLines($runtimeEnvPath))
    } else {
        $lines = @(
            '# Shopee Affiliate daily profile',
            '# Non-secret process overrides only; persisted automation pause remains authoritative.'
        )
    }

    $found = @{}
    for ($index = 0; $index -lt $lines.Count; $index++) {
        $match = [regex]::Match($lines[$index], '^\s*(?:export\s+)?(?<key>[A-Za-z_][A-Za-z0-9_]*)\s*=')
        if ($match.Success -and $profile.Contains($match.Groups['key'].Value)) {
            $key = $match.Groups['key'].Value
            $lines[$index] = "$key=$($profile[$key])"
            $found[$key] = $true
        }
    }
    foreach ($key in $profile.Keys) {
        if (-not $found.Contains($key)) {
            $lines += "$key=$($profile[$key])"
        }
    }

    $content = ($lines -join [Environment]::NewLine) + [Environment]::NewLine
    [System.IO.File]::WriteAllText($runtimeEnvPath, $content, [System.Text.UTF8Encoding]::new($false))
    return [pscustomobject]@{
        RuntimeEnvPath = $runtimeEnvPath
        BackupPath = $backupPath
        Keys = @($profile.Keys)
    }
}

function New-LauncherShortcut {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Desktop,

        [Parameter(Mandatory = $true)]
        [string]$Name,

        [Parameter(Mandatory = $true)]
        [string]$ScriptPath,

        [Parameter(Mandatory = $true)]
        [string]$Root,

        [Parameter(Mandatory = $true)]
        [string]$PowerShellPath
    )

    $shortcutPath = Join-Path $Desktop "$Name.lnk"
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $PowerShellPath
    $shortcut.Arguments = '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File ' +
        (ConvertTo-LauncherShortcutArgument -Value $ScriptPath) +
        ' -RepositoryRoot ' + (ConvertTo-LauncherShortcutArgument -Value $Root)
    $shortcut.WorkingDirectory = $Root
    $shortcut.WindowStyle = 7
    $shortcut.Description = $Name
    $shortcut.IconLocation = "$env:SystemRoot\System32\SHELL32.dll,0"
    $shortcut.Save()
    return $shortcutPath
}

function Invoke-InstallLauncher {
    param(
        [string]$Root,
        [string]$Desktop,
        [switch]$InstallRuntimeProfile,
        [switch]$DryRun,
        [switch]$SkipWindowsCheck
    )

    $resolvedRoot = Resolve-LauncherRepositoryRoot -CandidateRoot $Root
    if (-not $SkipWindowsCheck -and [Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
        Throw-LauncherError -Code 'WINDOWS_REQUIRED' -Message 'O installer exige Windows.'
    }

    $startScript = Join-Path $resolvedRoot 'scripts\windows\start-shopee-affiliate.ps1'
    $stopScript = Join-Path $resolvedRoot 'scripts\windows\stop-shopee-affiliate.ps1'
    if (-not (Test-Path -LiteralPath $startScript -PathType Leaf) -or -not (Test-Path -LiteralPath $stopScript -PathType Leaf)) {
        Throw-LauncherError -Code 'SHORTCUT_INSTALL_FAILED' -Message 'Os scripts do launcher não foram encontrados.'
    }

    $desktopDirectory = $Desktop
    if ([string]::IsNullOrWhiteSpace($desktopDirectory)) {
        $desktopDirectory = [Environment]::GetFolderPath([Environment+SpecialFolder]::Desktop)
    }
    if ([string]::IsNullOrWhiteSpace($desktopDirectory) -or -not (Test-Path -LiteralPath $desktopDirectory -PathType Container)) {
        Throw-LauncherError -Code 'SHORTCUT_INSTALL_FAILED' -Message 'O Desktop do usuário não foi encontrado.'
    }

    $profile = Get-DailyRuntimeProfile
    if ($DryRun) {
        return [pscustomobject]@{
            Mode = 'DryRun'
            RepositoryRoot = $resolvedRoot
            Desktop = $desktopDirectory
            Shortcuts = @('Shopee Affiliate.lnk', 'Shopee Affiliate - Encerrar.lnk')
            RuntimeProfileKeys = @($profile.Keys)
        }
    }

    $runtimeProfile = $null
    if ($InstallRuntimeProfile) {
        $runtimeProfile = Install-DailyRuntimeProfile -Root $resolvedRoot
    }

    $powerShellCommand = Get-Command 'powershell.exe' -ErrorAction SilentlyContinue
    if ($null -eq $powerShellCommand) {
        Throw-LauncherError -Code 'SHORTCUT_INSTALL_FAILED' -Message 'O PowerShell do Windows não foi encontrado.'
    }
    $startShortcut = New-LauncherShortcut -Desktop $desktopDirectory -Name 'Shopee Affiliate' -ScriptPath $startScript -Root $resolvedRoot -PowerShellPath $powerShellCommand.Source
    $stopShortcut = New-LauncherShortcut -Desktop $desktopDirectory -Name 'Shopee Affiliate - Encerrar' -ScriptPath $stopScript -Root $resolvedRoot -PowerShellPath $powerShellCommand.Source
    return [pscustomobject]@{
        Action = 'installed'
        RepositoryRoot = $resolvedRoot
        StartShortcut = $startShortcut
        StopShortcut = $stopShortcut
        RuntimeProfile = $runtimeProfile
    }
}

if (-not $Library) {
    $rootForLog = $RepositoryRoot
    try {
        $result = Invoke-InstallLauncher -Root $RepositoryRoot -Desktop $DesktopPath -InstallRuntimeProfile:$InstallRuntimeProfile -DryRun:$DryRun -SkipWindowsCheck:$SkipWindowsCheck
        if ($DryRun) {
            $result | ConvertTo-Json -Compress
        }
    } catch {
        $code = Get-LauncherErrorCode -ErrorRecord $_
        if ([string]::IsNullOrWhiteSpace($rootForLog)) {
            try { $rootForLog = Resolve-LauncherRepositoryRoot -CandidateRoot $RepositoryRoot } catch { $rootForLog = $null }
        }
        if (-not [string]::IsNullOrWhiteSpace($rootForLog)) {
            Write-LauncherTechnicalLog -Root $rootForLog -Code $code -Stage 'install'
        }
        Show-LauncherMessage -Title 'Shopee Affiliate' -Message (Get-LauncherFriendlyMessage -Code $code)
        exit 1
    }
}
