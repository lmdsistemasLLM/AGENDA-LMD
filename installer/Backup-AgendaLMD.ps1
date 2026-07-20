param(
    [string]$InstallDir = "C:\Program Files\LMD Sistemas\Agenda LMD Preview",
    [string]$DataDir = $(if ($env:PROGRAMDATA) { Join-Path $env:PROGRAMDATA "LMD Sistemas\Agenda LMD Preview" } else { Join-Path $InstallDir "data" }),
    [string]$NewVersion = ""
)

$ErrorActionPreference = "Stop"

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

function Copy-Directory {
    param(
        [string]$Source,
        [string]$Destination
    )

    if (-not (Test-Path -LiteralPath $Source)) {
        return
    }

    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    Copy-Item -Path (Join-Path $Source "*") -Destination $Destination -Recurse -Force
}

function Get-CurrentInstalledVersion {
    $exe = Get-ChildItem -Path $InstallDir -Filter "*.exe" -File -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $exe) {
        return $null
    }

    $version = $exe.VersionInfo.ProductVersion
    if ([string]::IsNullOrWhiteSpace($version)) {
        return $exe.VersionInfo.FileVersion
    }

    return $version
}

New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
$rollbackRoot = Join-Path $DataDir "rollback"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupDir = Join-Path $rollbackRoot $timestamp
$backupAppDir = Join-Path $backupDir "app"
$backupDataDir = Join-Path $backupDir "data"

New-Item -ItemType Directory -Path $backupAppDir -Force | Out-Null
New-Item -ItemType Directory -Path $backupDataDir -Force | Out-Null

Copy-Directory -Source $InstallDir -Destination $backupAppDir

$envPath = Join-Path $DataDir ".env"
$runtimeConfigPath = Join-Path $DataDir "firebird-runtime.json"

if (Test-Path -LiteralPath $envPath) {
    Copy-Item -LiteralPath $envPath -Destination (Join-Path $backupDataDir ".env") -Force
}

if (Test-Path -LiteralPath $runtimeConfigPath) {
    Copy-Item -LiteralPath $runtimeConfigPath -Destination (Join-Path $backupDataDir "firebird-runtime.json") -Force
}

$manifest = [pscustomobject]@{
    createdAt = (Get-Date).ToString("o")
    previousVersion = Get-CurrentInstalledVersion
    newVersion = $NewVersion
    installDir = $InstallDir
    dataDir = $DataDir
}

$manifest | ConvertTo-Json -Depth 4 | Set-Content -Path (Join-Path $backupDir "manifest.json") -Encoding UTF8
Write-InstallerLog -Category "update" -Message "Backup criado em $backupDir"
Write-Host $backupDir
