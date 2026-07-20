param(
    [string]$PythonExe = "python",
    [string]$ArtifactName = "agenda-api",
    [string]$SpecFile = "agenda-api.spec",
    [ValidateSet("AUTO", "X86", "X64")]
    [string]$ExpectedArch = "AUTO",
    [string]$VenvPath
)

$ErrorActionPreference = "Stop"
$distPath = Join-Path $PSScriptRoot "dist"
$workPath = Join-Path $PSScriptRoot "build\$ArtifactName"
$artifactPath = Join-Path $distPath $ArtifactName
$artifactExePath = Join-Path $artifactPath "$ArtifactName.exe"
$env:AGENDA_API_NAME = $ArtifactName

function Resolve-PythonCommand {
    param([string]$Command)

    if ([string]::IsNullOrWhiteSpace($Command)) {
        throw "Nenhum interpretador Python foi informado."
    }

    if (Test-Path -LiteralPath $Command) {
        return (Resolve-Path -LiteralPath $Command).Path
    }

    $resolved = Get-Command $Command -ErrorAction SilentlyContinue
    if ($resolved) {
        return $resolved.Source
    }

    throw "Interpretador Python nao encontrado: $Command"
}

function Get-PythonArchitecture {
    param([string]$Command)

    $bits = & $Command -c "import struct; print(struct.calcsize('P') * 8)"
    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao identificar a arquitetura do Python: $Command"
    }

    switch ($bits.Trim()) {
        "32" { return "X86" }
        "64" { return "X64" }
        default { throw "Arquitetura inesperada retornada por ${Command}: $bits" }
    }
}

function Ensure-Venv {
    param(
        [string]$BasePython,
        [string]$TargetVenvPath
    )

    if ([string]::IsNullOrWhiteSpace($TargetVenvPath)) {
        return $BasePython
    }

    $venvExe = Join-Path $TargetVenvPath "Scripts\python.exe"
    if (-not (Test-Path -LiteralPath $venvExe)) {
        Write-Host "Criando ambiente virtual em $TargetVenvPath..." -ForegroundColor Cyan
        & $BasePython -m venv $TargetVenvPath
        if ($LASTEXITCODE -ne 0) {
            throw "Falha ao criar o ambiente virtual em $TargetVenvPath"
        }
    }

    return (Resolve-Path -LiteralPath $venvExe).Path
}

$resolvedPython = Resolve-PythonCommand -Command $PythonExe
$actualArch = Get-PythonArchitecture -Command $resolvedPython
if ($ExpectedArch -ne "AUTO" -and $actualArch -ne $ExpectedArch) {
    throw "O Python informado para $ArtifactName possui arquitetura $actualArch, mas era esperado $ExpectedArch."
}

$pythonForBuild = Ensure-Venv -BasePython $resolvedPython -TargetVenvPath $VenvPath
$venvArch = Get-PythonArchitecture -Command $pythonForBuild
if ($venvArch -ne $actualArch) {
    throw "O ambiente virtual $VenvPath foi criado com arquitetura $venvArch, divergente do interpretador base $actualArch."
}

if (-not (Test-Path -LiteralPath $SpecFile)) {
    throw "Spec file nao encontrado: $SpecFile"
}

if (Test-Path -LiteralPath $artifactPath) {
    Remove-Item -LiteralPath $artifactPath -Recurse -Force
}

if (Test-Path -LiteralPath $workPath) {
    Remove-Item -LiteralPath $workPath -Recurse -Force
}

Write-Host "Instalando dependencias Python com $pythonForBuild..." -ForegroundColor Cyan
& $pythonForBuild -m pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) {
    throw "Falha ao instalar as dependencias Python para $ArtifactName."
}

Write-Host "Gerando $ArtifactName com PyInstaller..." -ForegroundColor Cyan
& $pythonForBuild -m PyInstaller --clean --noconfirm --distpath $distPath --workpath $workPath $SpecFile
if ($LASTEXITCODE -ne 0) {
    throw "Falha ao gerar $ArtifactName com PyInstaller."
}

if (-not (Test-Path -LiteralPath $artifactExePath)) {
    throw "Executavel nao encontrado apos o build: $artifactExePath"
}

Write-Host "$ArtifactName gerado em $artifactPath" -ForegroundColor Green
