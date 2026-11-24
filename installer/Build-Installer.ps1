param(
    [string]$PythonX86Exe = "",
    [string]$PythonX64Exe = "",
    [string]$AppVersion = "1.1.1",
    [string]$IsccExe = "",
    [switch]$AllowPartialBackend,
    [switch]$InstallInnoSetupWithWinget
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$apiDir = Join-Path $repoRoot "api-python"
$frontendDir = Join-Path $repoRoot "frontend"
$distRoot = Join-Path $repoRoot "dist"
$stageDir = Join-Path $distRoot "installer-stage"
$outputDir = $distRoot
$validationDir = Join-Path $distRoot "validation"
$unpackedDir = Join-Path $frontendDir "dist-electron\win-unpacked"
$venvX86 = Join-Path $apiDir ".venv-x86"
$venvX64 = Join-Path $apiDir ".venv-x64"

function Resolve-CommandPath {
    param([string]$Command)

    if ([string]::IsNullOrWhiteSpace($Command)) {
        return $null
    }

    if (Test-Path -LiteralPath $Command) {
        return (Resolve-Path -LiteralPath $Command).Path
    }

    $resolved = Get-Command $Command -ErrorAction SilentlyContinue
    if ($resolved) {
        return $resolved.Source
    }

    return $null
}

function Get-PythonInterpreterInfo {
    param([string]$PythonExe)

    $resolved = Resolve-CommandPath -Command $PythonExe
    if (-not $resolved) {
        throw "Interpretador Python nao encontrado: $PythonExe"
    }

    $raw = & $resolved -c "import json, struct, sys; print(json.dumps({'bits': struct.calcsize('P') * 8, 'version': '.'.join(map(str, sys.version_info[:3]))}))"
    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao validar o interpretador Python: $resolved"
    }

    $payload = $raw | ConvertFrom-Json
    $arch = switch ([int]$payload.bits) {
        32 { "X86" }
        64 { "X64" }
        default { throw "Arquitetura inesperada reportada por ${resolved}: $($payload.bits)" }
    }

    [pscustomobject]@{
        Path = $resolved
        Architecture = $arch
        Version = [version]$payload.version
    }
}

function Get-PyLauncherCandidates {
    $candidates = @()
    $pyCommand = Get-Command py -ErrorAction SilentlyContinue
    if (-not $pyCommand) {
        return $candidates
    }

    $raw = & $pyCommand.Source -0p 2>$null
    foreach ($line in ($raw -split "`r?`n")) {
        $trimmed = $line.Trim()
        if (-not $trimmed) { continue }

        $match = [regex]::Match($trimmed, '([A-Za-z]:\\.*?python(?:w)?\.exe)')
        if ($match.Success) {
            $candidates += $match.Groups[1].Value
        }
    }

    return $candidates
}

function Get-AutoPythonCandidates {
    $common = @(
        "C:\Users\$env:USERNAME\AppData\Local\Python\pythoncore-3.14-64\python.exe",
        "C:\Users\$env:USERNAME\AppData\Local\Programs\Python\Python313-32\python.exe",
        "C:\Users\$env:USERNAME\AppData\Local\Programs\Python\Python311\python.exe",
        "C:\Users\$env:USERNAME\AppData\Local\Programs\Python\Python311-32\python.exe",
        "python"
    )

    $all = @()
    $seen = New-Object System.Collections.Generic.HashSet[string] ([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($candidate in (Get-PyLauncherCandidates + $common)) {
        $resolved = Resolve-CommandPath -Command $candidate
        if (-not $resolved) { continue }
        if ($seen.Add($resolved)) {
            $all += $resolved
        }
    }

    return $all
}

function Find-PythonInterpreter {
    param(
        [ValidateSet("X86", "X64")]
        [string]$TargetArch,
        [string]$ExplicitPath,
        [string]$EnvVarName
    )

    if (-not [string]::IsNullOrWhiteSpace($ExplicitPath)) {
        $info = Get-PythonInterpreterInfo -PythonExe $ExplicitPath
        if ($info.Architecture -ne $TargetArch) {
            throw "O Python informado para $TargetArch e $($info.Architecture): $($info.Path)"
        }
        return $info
    }

    $fromEnv = [Environment]::GetEnvironmentVariable($EnvVarName)
    if (-not [string]::IsNullOrWhiteSpace($fromEnv)) {
        $info = Get-PythonInterpreterInfo -PythonExe $fromEnv
        if ($info.Architecture -ne $TargetArch) {
            throw "O Python informado em $EnvVarName para $TargetArch e $($info.Architecture): $($info.Path)"
        }
        return $info
    }

    $matching = foreach ($candidate in Get-AutoPythonCandidates) {
        try {
            $info = Get-PythonInterpreterInfo -PythonExe $candidate
            if ($info.Architecture -eq $TargetArch) {
                $info
            }
        } catch {
            continue
        }
    }

    $selected = $matching | Sort-Object Version -Descending | Select-Object -First 1
    if (-not $selected) {
        throw "Nenhum Python $TargetArch foi encontrado automaticamente. Informe o caminho por parametro ou pela variavel $EnvVarName."
    }

    return $selected
}

function Copy-Directory {
    param(
        [string]$Source,
        [string]$Destination
    )

    if (-not (Test-Path -LiteralPath $Source)) {
        throw "Diretorio nao encontrado: $Source"
    }

    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    Copy-Item -Path (Join-Path $Source "*") -Destination $Destination -Recurse -Force
}

function Invoke-BackendBuild {
    param(
        [pscustomobject]$Interpreter,
        [string]$ArtifactName,
        [string]$VenvPath
    )

    Write-Host "Compilando $ArtifactName com $($Interpreter.Path) ($($Interpreter.Architecture), Python $($Interpreter.Version))..." -ForegroundColor Cyan

    Push-Location $apiDir
    try {
        & .\build-api.ps1 `
            -PythonExe $Interpreter.Path `
            -ArtifactName $ArtifactName `
            -ExpectedArch $Interpreter.Architecture `
            -VenvPath $VenvPath | Out-Host
    } finally {
        Pop-Location
    }

    $artifactDir = Join-Path $apiDir "dist\$ArtifactName"
    $artifactExe = Join-Path $artifactDir "$ArtifactName.exe"
    if (-not (Test-Path -LiteralPath $artifactExe)) {
        throw "Executavel nao encontrado apos o build de ${ArtifactName}: $artifactExe"
    }

    return [pscustomobject]@{
        Artifact = $ArtifactName
        Directory = $artifactDir
        Executable = $artifactExe
        Architecture = $Interpreter.Architecture
        PythonPath = $Interpreter.Path
        PythonVersion = "$($Interpreter.Version)"
    }
}

function Invoke-JsonCommand {
    param(
        [string]$Executable,
        [string[]]$Arguments
    )

    $raw = & $Executable @Arguments 2>&1 | Out-String
    $exitCode = $LASTEXITCODE
    $payload = $null
    try {
        $payload = $raw | ConvertFrom-Json -ErrorAction Stop
    } catch {
        $payload = [pscustomobject]@{
            error = $raw.Trim()
        }
    }

    [pscustomobject]@{
        ExitCode = $exitCode
        Payload = $payload
        RawOutput = $raw
    }
}

function Save-JsonFile {
    param(
        [string]$Path,
        $Payload
    )

    $directory = Split-Path -Parent $Path
    if ($directory) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }
    $Payload | ConvertTo-Json -Depth 8 | Set-Content -Path $Path -Encoding UTF8
}

function Invoke-BackendDiagnostics {
    param([pscustomobject]$BuildResult)

    $result = Invoke-JsonCommand -Executable $BuildResult.Executable -Arguments @("--print-firebird-diagnostics", "--json")
    if ($result.ExitCode -ne 0) {
        throw "Falha ao executar diagnostico de $($BuildResult.Artifact): $($result.RawOutput.Trim())"
    }

    if ($result.Payload.processArchitecture -ne $BuildResult.Architecture) {
        throw "O backend $($BuildResult.Artifact) reportou processo $($result.Payload.processArchitecture), mas o build esperado era $($BuildResult.Architecture)."
    }

    $targetPath = Join-Path $validationDir "$($BuildResult.Artifact)-diagnostics.json"
    Save-JsonFile -Path $targetPath -Payload $result.Payload
    return $result.Payload
}

function Invoke-BackendConnectionValidation {
    param(
        [pscustomobject]$BuildResult,
        $Diagnostics
    )

    $targetPath = Join-Path $validationDir "$($BuildResult.Artifact)-connection-test.json"
    if ($Diagnostics.validationStatus -ne "valid") {
        $payload = [pscustomobject]@{
            skipped = $true
            reason = "Nenhuma DLL compativel estava disponivel para $($BuildResult.Artifact) em $((Get-Date).ToString('yyyy-MM-dd'))."
        }
        Save-JsonFile -Path $targetPath -Payload $payload
        return $payload
    }

    $result = Invoke-JsonCommand -Executable $BuildResult.Executable -Arguments @("--test-firebird-connection", "--json")
    if ($result.ExitCode -ne 0) {
        $payload = [pscustomobject]@{
            skipped = $false
            ok = $false
            error = $result.Payload.error
            details = $result.Payload
        }
        Save-JsonFile -Path $targetPath -Payload $payload
        return $payload
    }

    Save-JsonFile -Path $targetPath -Payload $result.Payload
    return $result.Payload
}

function Copy-FileIfExists {
    param(
        [string]$Source,
        [string]$Destination
    )

    if (Test-Path -LiteralPath $Source) {
        Copy-Item -LiteralPath $Source -Destination $Destination -Force
    }
}

function Find-IsccCompiler {
    param([string]$ExplicitPath)

    foreach ($candidate in @(
        $ExplicitPath,
        $env:ISCC_EXE,
        $env:INNO_SETUP_COMPILER,
        (Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 6\ISCC.exe"),
        "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
        "C:\Program Files\Inno Setup 6\ISCC.exe"
    )) {
        $resolved = Resolve-CommandPath -Command $candidate
        if ($resolved) {
            return $resolved
        }
    }

    $command = Get-Command iscc.exe -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    return $null
}

function Ensure-InnoSetupCompiler {
    param([string]$ExplicitPath)

    $iscc = Find-IsccCompiler -ExplicitPath $ExplicitPath
    if ($iscc) {
        return $iscc
    }

    if ($InstallInnoSetupWithWinget) {
        $winget = Get-Command winget -ErrorAction SilentlyContinue
        if (-not $winget) {
            throw "A opcao -InstallInnoSetupWithWinget foi usada, mas o winget nao esta disponivel."
        }

        Write-Host "Instalando Inno Setup via winget..." -ForegroundColor Cyan
        & $winget.Source install --id JRSoftware.InnoSetup -e --accept-package-agreements --accept-source-agreements
        if ($LASTEXITCODE -ne 0) {
            throw "Falha ao instalar o Inno Setup via winget."
        }

        $iscc = Find-IsccCompiler -ExplicitPath $ExplicitPath
        if ($iscc) {
            return $iscc
        }
    }

    return $null
}

New-Item -ItemType Directory -Path $distRoot -Force | Out-Null
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
New-Item -ItemType Directory -Path $validationDir -Force | Out-Null

$x86Info = Find-PythonInterpreter -TargetArch X86 -ExplicitPath $PythonX86Exe -EnvVarName "PYTHON_X86_EXE"
$x64Info = Find-PythonInterpreter -TargetArch X64 -ExplicitPath $PythonX64Exe -EnvVarName "PYTHON_X64_EXE"

if ($x86Info.Path -eq $x64Info.Path) {
    throw "Os builds x86 e x64 apontaram para o mesmo interpretador: $($x86Info.Path)"
}

$buildResults = @()
$diagnosticsResults = @()
$connectionResults = @()

try {
    $buildResults += Invoke-BackendBuild -Interpreter $x86Info -ArtifactName "agenda-api-x86" -VenvPath $venvX86
    $buildResults += Invoke-BackendBuild -Interpreter $x64Info -ArtifactName "agenda-api-x64" -VenvPath $venvX64
} catch {
    if (-not $AllowPartialBackend) {
        throw
    }
    Write-Warning "Build parcial liberado para desenvolvimento: $($_.Exception.Message)"
}

if (-not $AllowPartialBackend -and $buildResults.Count -ne 2) {
    throw "O build dual do backend nao foi concluido. Use -AllowPartialBackend apenas para desenvolvimento."
}

foreach ($buildResult in $buildResults) {
    $diagnostics = Invoke-BackendDiagnostics -BuildResult $buildResult
    $diagnosticsResults += [pscustomobject]@{
        Artifact = $buildResult.Artifact
        Diagnostics = $diagnostics
    }

    $connectionResults += [pscustomobject]@{
        Artifact = $buildResult.Artifact
        Result = Invoke-BackendConnectionValidation -BuildResult $buildResult -Diagnostics $diagnostics
    }
}

Write-Host "Gerando aplicativo desktop em modo win-unpacked..." -ForegroundColor Cyan
Push-Location $frontendDir
try {
    npm run build:desktop:dir
    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao gerar win-unpacked do Electron."
    }
} finally {
    Pop-Location
}

if (Test-Path -LiteralPath $stageDir) {
    Remove-Item -LiteralPath $stageDir -Recurse -Force
}

Copy-Directory -Source $unpackedDir -Destination $stageDir

$stageApiRoot = Join-Path $stageDir "resources\api"
New-Item -ItemType Directory -Path $stageApiRoot -Force | Out-Null
Copy-Directory -Source (Join-Path $apiDir "dist\agenda-api-x86") -Destination (Join-Path $stageApiRoot "x86")
Copy-Directory -Source (Join-Path $apiDir "dist\agenda-api-x64") -Destination (Join-Path $stageApiRoot "x64")

$stageInstallerDir = Join-Path $stageDir "installer"
$stageDocsDir = Join-Path $stageDir "docs"
New-Item -ItemType Directory -Path $stageInstallerDir -Force | Out-Null
New-Item -ItemType Directory -Path $stageDocsDir -Force | Out-Null

$installerRuntimeScripts = @(
    "Backup-AgendaLMD.ps1",
    "Rollback-AgendaLMD.ps1",
    "Uninstall-AgendaLMD.ps1",
    "Write-AgendaEnv.ps1"
)
foreach ($scriptName in $installerRuntimeScripts) {
    $scriptPath = Join-Path $PSScriptRoot $scriptName
    if (-not (Test-Path -LiteralPath $scriptPath)) {
        throw "Script obrigatorio do instalador nao encontrado: $scriptPath"
    }

    Copy-Item -LiteralPath $scriptPath -Destination (Join-Path $stageInstallerDir $scriptName) -Force
}
Copy-FileIfExists -Source (Join-Path $repoRoot "README.md") -Destination (Join-Path $stageDocsDir "README.md")
Copy-FileIfExists -Source (Join-Path $repoRoot "GUIA_INSTALACAO_CLIENTE.md") -Destination (Join-Path $stageDocsDir "GUIA_INSTALACAO_CLIENTE.md")
Copy-FileIfExists -Source (Join-Path $repoRoot "ENTREGA.md") -Destination (Join-Path $stageDocsDir "ENTREGA.md")
Copy-FileIfExists -Source (Join-Path $apiDir ".env.example") -Destination (Join-Path $stageDocsDir ".env.example")

if (-not (Test-Path -LiteralPath (Join-Path $repoRoot "assets\icon.ico"))) {
    Write-Warning "Icone oficial nao encontrado em assets\icon.ico. O pacote pode ficar sem identidade visual padronizada."
}

if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot "assets\icon.ico"))) {
    Write-Warning "Icone derivado do instalador nao encontrado em installer\assets\icon.ico. Execute o sync de branding antes de compilar."
}

$summary = [pscustomobject]@{
    generatedAt = (Get-Date).ToString("o")
    appVersion = $AppVersion
    stageDir = $stageDir
    pythonX86 = $x86Info
    pythonX64 = $x64Info
    artifacts = $buildResults
    diagnostics = $diagnosticsResults
    connectionTests = $connectionResults
}
Save-JsonFile -Path (Join-Path $validationDir "build-summary.json") -Payload $summary

$iscc = Ensure-InnoSetupCompiler -ExplicitPath $IsccExe
if (-not $iscc) {
    Write-Warning "Inno Setup nao encontrado em $((Get-Date).ToString('yyyy-MM-dd')). O stage foi preparado em $stageDir, mas o instalador .exe nao foi gerado."
    Write-Host "Para concluir a compilacao do instalador, instale o Inno Setup e execute novamente:" -ForegroundColor Yellow
    Write-Host "winget install --id JRSoftware.InnoSetup -e --accept-package-agreements --accept-source-agreements" -ForegroundColor Yellow
    return
}

Write-Host "Compilando instalador com Inno Setup..." -ForegroundColor Cyan
& $iscc "/DStageDir=$stageDir" "/DAppVersion=$AppVersion" "/DOutputDir=$outputDir" (Join-Path $PSScriptRoot "AgendaLMD.iss")
if ($LASTEXITCODE -ne 0) {
    throw "Falha ao compilar o instalador Inno Setup."
}

$installerPath = Join-Path $outputDir "Agenda-LMD-Preview-Setup-$AppVersion.exe"
if (-not (Test-Path -LiteralPath $installerPath)) {
    $installerPath = Get-ChildItem -Path $outputDir -Filter "Agenda-LMD-Preview-Setup-*.exe" | Sort-Object LastWriteTime -Descending | Select-Object -ExpandProperty FullName -First 1
}

if (-not $installerPath -or -not (Test-Path -LiteralPath $installerPath)) {
    throw "O Inno Setup terminou sem gerar o executavel esperado em $outputDir."
}

$hash = Get-FileHash -Path $installerPath -Algorithm SHA256
$hashPath = "$installerPath.sha256"
"$($hash.Hash) *$(Split-Path -Leaf $installerPath)" | Set-Content -Path $hashPath -Encoding ASCII

Write-Host "Instalador gerado em $installerPath" -ForegroundColor Green
Write-Host "SHA-256 salvo em $hashPath" -ForegroundColor Green
