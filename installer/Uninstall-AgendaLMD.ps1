param(
    [string]$InstallDir = "C:\Program Files\LMD Sistemas\Agenda LMD Preview",
    [string]$DataDir = $(if ($env:PROGRAMDATA) { Join-Path $env:PROGRAMDATA "LMD Sistemas\Agenda LMD Preview" } else { Join-Path $InstallDir "data" }),
    [switch]$RemoveData
)

function Get-LogDir {
    $root = Join-Path $DataDir "logs\installer"
    New-Item -ItemType Directory -Path $root -Force | Out-Null
    return $root
}

function Write-InstallerLog {
    param(
        [string]$Category,
        [string]$Message
    )

    $target = Join-Path (Get-LogDir) "$Category.log"
    $timestamp = (Get-Date).ToUniversalTime().ToString("o")
    Add-Content -Path $target -Value "[$timestamp] $Message" -Encoding UTF8
}

$backupDir = Join-Path $DataDir ("uninstall-backup\" + (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null

$envPath = Join-Path $DataDir ".env"
$runtimeConfigPath = Join-Path $DataDir "firebird-runtime.json"

if (Test-Path -LiteralPath $envPath) {
    Copy-Item -LiteralPath $envPath -Destination (Join-Path $backupDir ".env") -Force
}

if (Test-Path -LiteralPath $runtimeConfigPath) {
    Copy-Item -LiteralPath $runtimeConfigPath -Destination (Join-Path $backupDir "firebird-runtime.json") -Force
}

Write-InstallerLog -Category "uninstall" -Message "Backup de desinstalacao criado em $backupDir"

if ($RemoveData -and (Test-Path -LiteralPath $DataDir)) {
    Remove-Item -LiteralPath $DataDir -Recurse -Force
    Write-InstallerLog -Category "uninstall" -Message "Diretorio de dados removido em $DataDir"
} else {
    Write-InstallerLog -Category "uninstall" -Message "Diretorio de dados preservado em $DataDir"
}

Write-InstallerLog -Category "uninstall" -Message "Fluxo de desinstalacao executado para $InstallDir"
