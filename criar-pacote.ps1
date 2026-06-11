#!/usr/bin/env pwsh
# Script para criar pacote distribuivel da Agenda LMD

Write-Host "Criando pacote Agenda LMD..." -ForegroundColor Green

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

$packageDir = "c:\Agenda_LMD_1.0.0"
if (Test-Path $packageDir) {
    Remove-Item -Recurse -Force $packageDir
}
New-Item -ItemType Directory -Path $packageDir | Out-Null

Write-Host "`nCopiando arquivos..." -ForegroundColor Cyan
New-Item -ItemType Directory -Path "$packageDir\frontend" -Force | Out-Null
New-Item -ItemType Directory -Path "$packageDir\api" -Force | Out-Null

Copy-Item -Path "frontend\dist-app\*" -Destination "$packageDir\frontend" -Recurse
Copy-Item -Path "frontend\electron\main.cjs" -Destination "$packageDir\"
Copy-Item -Path "frontend\public\*" -Destination "$packageDir\public" -Recurse -ErrorAction SilentlyContinue
Copy-Item -Path "api-python\dist\agenda-api\*" -Destination "$packageDir\api" -Recurse -Force
Copy-Item -Path "install-agenda-service.ps1" -Destination "$packageDir\"
Copy-Item -Path "uninstall-agenda-service.ps1" -Destination "$packageDir\"

$readmeContent = @"
Agenda LMD - Instalacao

Requisitos:
  Windows 10 ou superior
  Firebird instalado no ambiente do cliente

Como usar:
  1. Configure o .env ao lado do executavel.
  2. Execute Agenda LMD.exe.
  3. O Electron inicia automaticamente a API Python local.

Acesso pela rede sem CMD:
  1. Execute PowerShell como Administrador.
  2. Rode install-agenda-service.ps1 apontando para a pasta instalada.
  3. Acesse http://IP-DO-SERVIDOR:3001.

Variaveis de banco:
  FB_HOST
  FB_PORT
  FB_DATABASE
  FB_USER
  FB_PASSWORD
  FBCLIENT_PATH opcional

Licenciamento:
  LICENSE_API_URL=https://lmdsistemasdev.qzz.io/api
  PROJECT_SLUG=agenda-lmd-preview

Suporte:
  contato@lmd.com.br
"@
$readmeContent | Out-File "$packageDir\LEIA-ME.txt" -Encoding UTF8

Write-Host "`nCriando arquivo compactado..." -ForegroundColor Cyan
Compress-Archive -Path $packageDir -DestinationPath "Agenda_LMD_1.0.0_portable.zip" -Force

Write-Host "`nPacote criado com sucesso!" -ForegroundColor Green
Write-Host "   Arquivo: Agenda_LMD_1.0.0_portable.zip" -ForegroundColor Yellow
Get-Item "Agenda_LMD_1.0.0_portable.zip" | Format-Table Name, @{N="Tamanho";E={"{0:N2} MB" -f ($_.Length/1MB)}}
