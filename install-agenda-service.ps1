param(
    [string]$InstallDir = "C:\Agenda_LMD",
    [string]$TaskName = "Agenda LMD API"
)

$apiExe = Join-Path $InstallDir "resources\api\agenda-api.exe"
$frontendDir = Join-Path $InstallDir "resources\frontend"
$envFile = Join-Path $InstallDir ".env"

if (-not (Test-Path $apiExe)) {
    throw "agenda-api.exe nao encontrado em $apiExe"
}

if (-not (Test-Path $envFile)) {
    @"
HOST=0.0.0.0
PORT=3001
FRONTEND_DIST=$frontendDir

FB_HOST=127.0.0.1
FB_PORT=3050
FB_DATABASE=C:\caminho\para\DADOS.FDB
FB_USER=SYSDBA
FB_PASSWORD=masterkey
FBCLIENT_PATH=

JWT_SECRET=
LICENSE_API_URL=https://lmdsistemasdev.qzz.io/api
LICENSE_API_KEY=
PROJECT_SLUG=agenda-lmd-preview
"@ | Out-File -FilePath $envFile -Encoding UTF8
    Write-Host "Arquivo .env criado em $envFile. Revise as configuracoes antes de iniciar." -ForegroundColor Yellow
}

$action = New-ScheduledTaskAction -Execute $apiExe -WorkingDirectory (Split-Path $apiExe)
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null

New-NetFirewallRule -DisplayName "Agenda LMD API 3001" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3001 -ErrorAction SilentlyContinue | Out-Null

Start-ScheduledTask -TaskName $TaskName

Write-Host "Agenda LMD API configurada para iniciar com o Windows." -ForegroundColor Green
Write-Host "Acesse na rede: http://IP-DO-SERVIDOR:3001" -ForegroundColor Cyan
