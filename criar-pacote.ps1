#!/usr/bin/env pwsh
# Script para criar pacote distribuivel da Agenda LMD Preview

Write-Host "Criando pacote Agenda LMD Preview..." -ForegroundColor Green

Write-Host "`nCompilando API Python..." -ForegroundColor Cyan
Push-Location api-python
.\build-api.ps1
if ($LASTEXITCODE -ne 0) {
    Write-Host "Erro ao compilar API Python" -ForegroundColor Red
    exit 1
}
Pop-Location

Write-Host "`nCompilando frontend..." -ForegroundColor Cyan
Push-Location frontend
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Erro ao compilar frontend" -ForegroundColor Red
    exit 1
}
Pop-Location

$repoRoot = (Resolve-Path ".").Path
$portableRoot = Join-Path $repoRoot "dist\\portable"
$packageDir = Join-Path $portableRoot "Agenda_LMD_1.1.1"
if (Test-Path $packageDir) {
    Remove-Item -Recurse -Force $packageDir
}
New-Item -ItemType Directory -Path $packageDir | Out-Null

Write-Host "`nCopiando arquivos..." -ForegroundColor Cyan
New-Item -ItemType Directory -Path (Join-Path $packageDir "frontend") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $packageDir "api\\x86") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $packageDir "api\\x64") -Force | Out-Null

Copy-Item -Path "frontend\dist-app\*" -Destination (Join-Path $packageDir "frontend") -Recurse
Copy-Item -Path "frontend\electron\main.cjs" -Destination $packageDir
Copy-Item -Path "frontend\public\*" -Destination (Join-Path $packageDir "public") -Recurse -ErrorAction SilentlyContinue
Copy-Item -Path "api-python\dist\agenda-api-x86\*" -Destination (Join-Path $packageDir "api\\x86") -Recurse -Force
Copy-Item -Path "api-python\dist\agenda-api-x64\*" -Destination (Join-Path $packageDir "api\\x64") -Recurse -Force
Copy-Item -Path "install-agenda-service.ps1" -Destination $packageDir
Copy-Item -Path "uninstall-agenda-service.ps1" -Destination $packageDir
Copy-Item -Path ".env.example" -Destination $packageDir

$readmeContent = @"
Agenda LMD Preview - Instalacao

Requisitos:
  Windows 10 ou superior
  Firebird instalado no ambiente do cliente

Como usar:
  1. Ajuste o .env conforme o ambiente.
  2. Execute o aplicativo.
  3. O Electron inicia automaticamente a API local.

Acesso pela rede:
  1. Execute o PowerShell como Administrador.
  2. Rode install-agenda-service.ps1 apontando para a pasta instalada.
  3. Acesse http://IP-DO-SERVIDOR:3001.

Variaveis principais:
  FB_HOST
  FB_PORT
  FB_DATABASE
  FB_USER
  FB_PASSWORD
  FBCLIENT_PATH
  LICENSE_API_URL
  PROJECT_SLUG

Empresa:
  LMD Sistemas
"@
$readmeContent | Out-File (Join-Path $packageDir "LEIA-ME.txt") -Encoding UTF8

Write-Host "`nCriando arquivo compactado..." -ForegroundColor Cyan
$zipPath = Join-Path $portableRoot "Agenda_LMD_1.1.1_portable.zip"
if (Test-Path $zipPath) {
    Remove-Item $zipPath -Force
}
Compress-Archive -Path $packageDir -DestinationPath $zipPath -Force

Write-Host "`nPacote criado com sucesso!" -ForegroundColor Green
Write-Host "   Arquivo: $zipPath" -ForegroundColor Yellow
Get-Item $zipPath | Format-Table Name, @{N="Tamanho";E={"{0:N2} MB" -f ($_.Length/1MB)}}
