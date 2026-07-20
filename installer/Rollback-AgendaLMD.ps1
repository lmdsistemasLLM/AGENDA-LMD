param(
    [string]$InstallDir = "C:\Program Files\LMD Sistemas\Agenda LMD Preview",
    [string]$DataDir = $(if ($env:PROGRAMDATA) { Join-Path $env:PROGRAMDATA "LMD Sistemas\Agenda LMD Preview" } else { Join-Path $InstallDir "data" }),
    [string]$RollbackPath = ""
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

function Copy-DirectoryContents {
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

function Clear-InstallDirectory {
    if (-not (Test-Path -LiteralPath $InstallDir)) {
        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
        return
    }

    if ($InstallDir -notmatch "Agenda LMD Preview") {
        throw "Caminho de instalacao inesperado para limpeza segura: $InstallDir"
    }

    Get-ChildItem -LiteralPath $InstallDir -Force | Remove-Item -Recurse -Force
}

function Get-LatestRollbackDirectory {
    if ($RollbackPath) {
        if (-not (Test-Path -LiteralPath $RollbackPath)) {
            throw "Diretorio de rollback nao encontrado: $RollbackPath"
        }
        return Get-Item -LiteralPath $RollbackPath
    }

    $rollbackRoot = Join-Path $DataDir "rollback"
    if (-not (Test-Path -LiteralPath $rollbackRoot)) {
        return $null
    }

    return Get-ChildItem -Path $rollbackRoot -Directory | Sort-Object LastWriteTime -Descending | Select-Object -First 1
}

$rollbackDir = Get-LatestRollbackDirectory
$restoredFiles = @()

if ($rollbackDir) {
    $appBackupDir = Join-Path $rollbackDir.FullName "app"
    $dataBackupDir = Join-Path $rollbackDir.FullName "data"

    if (Test-Path -LiteralPath $appBackupDir) {
        Clear-InstallDirectory
        Copy-DirectoryContents -Source $appBackupDir -Destination $InstallDir
        $restoredFiles += "app"
    }

    if (Test-Path -LiteralPath (Join-Path $dataBackupDir ".env")) {
        New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $dataBackupDir ".env") -Destination (Join-Path $DataDir ".env") -Force
        $restoredFiles += ".env"
    }

    if (Test-Path -LiteralPath (Join-Path $dataBackupDir "firebird-runtime.json")) {
        New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $dataBackupDir "firebird-runtime.json") -Destination (Join-Path $DataDir "firebird-runtime.json") -Force
        $restoredFiles += "firebird-runtime.json"
    }
}

if ($restoredFiles.Count -eq 0) {
    $envBackupRoot = Join-Path $DataDir "backups"
    if (-not (Test-Path -LiteralPath $envBackupRoot)) {
        throw "Nenhum backup de rollback foi encontrado em $DataDir"
    }

    $latestEnvBackup = Get-ChildItem -Path $envBackupRoot -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $latestEnvBackup) {
        throw "Nenhum arquivo de backup foi encontrado em $envBackupRoot"
    }

    New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
    Copy-Item -LiteralPath $latestEnvBackup.FullName -Destination (Join-Path $DataDir ".env") -Force
    $restoredFiles += ".env"
}

Write-InstallerLog -Category "rollback" -Message "Rollback aplicado. Arquivos restaurados: $($restoredFiles -join ', ')"
Write-Host "Rollback concluido com sucesso. Arquivos restaurados: $($restoredFiles -join ', ')" -ForegroundColor Green
