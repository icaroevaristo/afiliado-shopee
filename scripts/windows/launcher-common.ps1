[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function New-LauncherError {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Code,

        [Parameter(Mandatory = $true)]
        [string]$Message
    )

    $error = [System.InvalidOperationException]::new($Message)
    $error.Data['LauncherCode'] = $Code
    return $error
}

function Throw-LauncherError {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Code,

        [Parameter(Mandatory = $true)]
        [string]$Message
    )

    throw (New-LauncherError -Code $Code -Message $Message)
}

function Resolve-LauncherRepositoryRoot {
    param(
        [string]$CandidateRoot
    )

    $rootCandidate = $CandidateRoot
    if ([string]::IsNullOrWhiteSpace($rootCandidate)) {
        $rootCandidate = Join-Path $PSScriptRoot '..\..'
    }

    try {
        $root = (Resolve-Path -LiteralPath $rootCandidate -ErrorAction Stop).Path
    } catch {
        Throw-LauncherError -Code 'ROOT_NOT_FOUND' -Message 'A pasta do Shopee Affiliate não foi encontrada.'
    }

    $requiredPaths = @(
        'package.json',
        'pnpm-lock.yaml',
        'apps\system-supervisor\src\cli.ts',
        'apps\api\src\server.ts',
        'apps\dashboard\package.json',
        'apps\worker\src\commercial-automation-worker.ts',
        'apps\worker\src\whatsapp-dispatch-runtime.ts'
    )
    foreach ($relativePath in $requiredPaths) {
        if (-not (Test-Path -LiteralPath (Join-Path $root $relativePath) -PathType Leaf)) {
            Throw-LauncherError -Code 'ROOT_NOT_FOUND' -Message 'A pasta selecionada não é uma instalação válida do Shopee Affiliate.'
        }
    }

    return $root
}

function Get-LauncherLogPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Root
    )

    return Join-Path $Root '.runtime\local-system\launcher.log'
}

function Write-LauncherTechnicalLog {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Root,

        [Parameter(Mandatory = $true)]
        [string]$Code,

        [string]$Stage = 'launcher'
    )

    try {
        $logPath = Get-LauncherLogPath -Root $Root
        $logDirectory = Split-Path -Parent $logPath
        [void](New-Item -ItemType Directory -Path $logDirectory -Force)
        $timestamp = [DateTime]::UtcNow.ToString('o')
        Add-Content -LiteralPath $logPath -Value "$timestamp`t$Stage`t$Code" -Encoding utf8
    } catch {
        # A diagnostic log must never prevent the friendly error path.
    }
}

function Get-LauncherErrorCode {
    param(
        [Parameter(Mandatory = $true)]
        [System.Management.Automation.ErrorRecord]$ErrorRecord
    )

    $data = $ErrorRecord.Exception.Data
    if ($null -ne $data -and $data.Contains('LauncherCode')) {
        return [string]$data['LauncherCode']
    }

    return 'LAUNCHER_FAILED'
}

function Get-LauncherFriendlyMessage {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Code
    )

    $messages = @{
        WINDOWS_REQUIRED = 'Este atalho funciona somente no Windows.'
        ROOT_NOT_FOUND = 'A instalação do Shopee Affiliate não foi localizada.'
        ENV_NOT_FOUND = 'O arquivo .env local não foi encontrado. Configure o ambiente e tente novamente.'
        NODE_UNAVAILABLE = 'Node.js 20.6 ou mais recente não está disponível. Instale ou atualize o Node.js.'
        NODE_VERSION_UNSUPPORTED = 'O Node.js instalado é antigo. Atualize para a versão 20.6 ou mais recente.'
        COREPACK_UNAVAILABLE = 'O Corepack não está disponível. Ative-o no Node.js e tente novamente.'
        PNPM_UNAVAILABLE = 'O pnpm compatível não está disponível. Instale a versão indicada pelo projeto e tente novamente.'
        DOCKER_CLI_UNAVAILABLE = 'O Docker CLI não está disponível. Instale o Docker Desktop e tente novamente.'
        DOCKER_DAEMON_UNAVAILABLE = 'O Docker Desktop não está iniciado. Abra o Docker Desktop e tente novamente.'
        SYSTEM_STATUS_UNAVAILABLE = 'Não foi possível consultar o estado do sistema. Verifique o log técnico e tente novamente.'
        SYSTEM_OPERATION_IN_PROGRESS = 'Outra operação do sistema está em andamento. Aguarde e tente novamente.'
        SYSTEM_STATUS_UNKNOWN = 'O estado do sistema não pôde ser confirmado com segurança.'
        SYSTEM_START_FAILED = 'O sistema não iniciou corretamente. Consulte o log técnico para obter ajuda.'
        API_NOT_READY = 'A API não ficou disponível dentro do tempo esperado. Consulte o log técnico.'
        DASHBOARD_NOT_READY = 'O dashboard não ficou disponível dentro do tempo esperado. Consulte o log técnico.'
        BROWSER_OPEN_FAILED = 'O sistema iniciou, mas não foi possível abrir o navegador automaticamente.'
        SYSTEM_STOP_INCOMPLETE = 'Intervenção necessária. O sistema não foi encerrado completamente.'
        SYSTEM_STOP_FAILED = 'Não foi possível encerrar o sistema. Consulte o log técnico para obter ajuda.'
        SHORTCUT_INSTALL_FAILED = 'Não foi possível criar os atalhos no Desktop. Consulte o log técnico.'
        RUNTIME_PROFILE_FAILED = 'Não foi possível instalar o perfil diário local. Consulte o log técnico.'
        LAUNCHER_FAILED = 'Não foi possível concluir a operação. Consulte o log técnico para obter ajuda.'
    }

    if ($messages.ContainsKey($Code)) {
        return $messages[$Code]
    }

    return $messages['LAUNCHER_FAILED']
}

function Show-LauncherMessage {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Title,

        [Parameter(Mandatory = $true)]
        [string]$Message
    )

    try {
        Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
        [System.Windows.Forms.MessageBox]::Show(
            $Message,
            $Title,
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Warning
        ) | Out-Null
    } catch {
        Write-Error $Message
    }
}

function Invoke-LauncherExternalCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,

        [string[]]$Arguments = @(),

        [Parameter(Mandatory = $true)]
        [string]$WorkingDirectory
    )

    $captured = @()
    $exitCode = 1
    try {
        Push-Location -LiteralPath $WorkingDirectory
        $captured = @(& $FilePath @Arguments 2>&1)
        $exitCode = $LASTEXITCODE
    } catch {
        $captured = @($_.Exception.Message)
        $exitCode = 1
    } finally {
        Pop-Location
    }

    return [pscustomobject]@{
        ExitCode = [int]$exitCode
        Output = ($captured | Out-String)
    }
}

function Invoke-LauncherCommandRunner {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,

        [string[]]$Arguments = @(),

        [Parameter(Mandatory = $true)]
        [string]$WorkingDirectory,

        [scriptblock]$CommandRunner
    )

    if ($null -ne $CommandRunner) {
        $result = & $CommandRunner $FilePath $Arguments $WorkingDirectory
        if ($null -eq $result) {
            Throw-LauncherError -Code 'LAUNCHER_FAILED' -Message 'O executor de comandos não retornou resultado.'
        }
        return $result
    }

    return Invoke-LauncherExternalCommand -FilePath $FilePath -Arguments $Arguments -WorkingDirectory $WorkingDirectory
}

function Test-LauncherCommandAvailable {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,

        [scriptblock]$CommandLookup
    )

    if ($null -ne $CommandLookup) {
        return [bool](& $CommandLookup $Name)
    }

    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Get-LauncherExpectedPnpmMajor {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Root
    )

    try {
        $package = Get-Content -LiteralPath (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json -ErrorAction Stop
        $match = [regex]::Match([string]$package.packageManager, '^pnpm@(?<major>\d+)\.\d+\.\d+(?:[-+].*)?$')
        if (-not $match.Success) { throw 'invalid packageManager' }
        return [int]$match.Groups['major'].Value
    } catch {
        Throw-LauncherError -Code 'PNPM_UNAVAILABLE' -Message 'A versão de pnpm exigida pelo projeto não pôde ser determinada.'
    }
}

function Test-LauncherPnpmVersion {
    param(
        [Parameter(Mandatory = $true)]
        [psobject]$Result,

        [Parameter(Mandatory = $true)]
        [int]$ExpectedMajor
    )

    if ([int]$Result.ExitCode -ne 0) { return $false }
    $match = [regex]::Match(([string]$Result.Output).Trim(), '^(?<major>\d+)\.\d+\.\d+(?:[-+].*)?$')
    return $match.Success -and [int]$match.Groups['major'].Value -eq $ExpectedMajor
}

function Resolve-LauncherPnpmExecutor {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Root,

        [scriptblock]$CommandRunner,
        [scriptblock]$CommandLookup
    )

    $expectedMajor = Get-LauncherExpectedPnpmMajor -Root $Root
    if (Test-LauncherCommandAvailable -Name 'corepack' -CommandLookup $CommandLookup) {
        $corepack = Invoke-LauncherCommandRunner -FilePath 'corepack' -Arguments @('pnpm', '--version') -WorkingDirectory $Root -CommandRunner $CommandRunner
        if (Test-LauncherPnpmVersion -Result $corepack -ExpectedMajor $expectedMajor) {
            return [pscustomobject]@{ FilePath = 'corepack'; PrefixArguments = @('pnpm'); DisplayName = 'corepack pnpm' }
        }
    }

    if (Test-LauncherCommandAvailable -Name 'pnpm' -CommandLookup $CommandLookup) {
        $direct = Invoke-LauncherCommandRunner -FilePath 'pnpm' -Arguments @('--version') -WorkingDirectory $Root -CommandRunner $CommandRunner
        if (Test-LauncherPnpmVersion -Result $direct -ExpectedMajor $expectedMajor) {
            return [pscustomobject]@{ FilePath = 'pnpm'; PrefixArguments = @(); DisplayName = 'pnpm' }
        }
    }

    Throw-LauncherError -Code 'PNPM_UNAVAILABLE' -Message 'Nenhum executor pnpm compatível foi encontrado.'
}

function Invoke-LauncherPnpmCommand {
    param(
        [Parameter(Mandatory = $true)]
        [psobject]$Executor,

        [Parameter(Mandatory = $true)]
        [string[]]$Arguments,

        [Parameter(Mandatory = $true)]
        [string]$Root,

        [scriptblock]$CommandRunner
    )

    return Invoke-LauncherCommandRunner -FilePath ([string]$Executor.FilePath) -Arguments @($Executor.PrefixArguments + $Arguments) -WorkingDirectory $Root -CommandRunner $CommandRunner
}

function ConvertFrom-LauncherJsonOutput {
    param(
        [Parameter(Mandatory = $true)]
        [psobject]$CommandResult
    )

    if ([int]$CommandResult.ExitCode -ne 0) {
        Throw-LauncherError -Code 'SYSTEM_STATUS_UNAVAILABLE' -Message 'O comando de status falhou.'
    }

    $output = [string]$CommandResult.Output
    $firstBrace = $output.IndexOf('{')
    $lastBrace = $output.LastIndexOf('}')
    if ($firstBrace -lt 0 -or $lastBrace -le $firstBrace) {
        Throw-LauncherError -Code 'SYSTEM_STATUS_UNAVAILABLE' -Message 'O comando de status não retornou JSON válido.'
    }

    try {
        return $output.Substring($firstBrace, $lastBrace - $firstBrace + 1) | ConvertFrom-Json -ErrorAction Stop
    } catch {
        Throw-LauncherError -Code 'SYSTEM_STATUS_UNAVAILABLE' -Message 'O comando de status não retornou JSON válido.'
    }
}

function ConvertTo-LauncherShortcutArgument {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Value
    )

    return '"' + $Value.Replace('"', '\"') + '"'
}

function Get-DailyRuntimeProfile {
    $profile = [ordered]@{
        NODE_ENV = 'production'
        PORT = '3433'
        DASHBOARD_API_URL = 'http://127.0.0.1:3433'
        COMMERCIAL_AUTOMATION_ENABLED = 'true'
        COMMERCIAL_SCHEDULER_ENABLED = 'true'
        SCHEDULER_ENABLED = 'false'
        COMMERCIAL_AUTOMATION_MODE = 'send'
        SHOPEE_AFFILIATE_PROVIDER = 'official'
        SHOPEE_AFFILIATE_API_ENABLED = 'true'
        COMMERCIAL_AI_COPY_ENABLED = 'true'
        WHATSAPP_PROVIDER = 'evolution'
        EVOLUTION_SAFE_MODE = 'true'
        WHATSAPP_GROUP_SEND_ENABLED = 'true'
    }

    return $profile
}
