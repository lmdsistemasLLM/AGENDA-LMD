param(
    [string]$InstallDir = "C:\Program Files\LMD Sistemas\Agenda LMD Preview",
    [string]$TaskName = "Agenda LMD API"
)

function Resolve-ApiExecutable {
    param([string]$BaseDir)

    $candidates = @(
        (Join-Path $BaseDir "resources\api\x64\agenda-api-x64.exe"),
        (Join-Path $BaseDir "resources\api\x86\agenda-api-x86.exe"),
        (Join-Path $BaseDir "resources\api\agenda-api.exe")
    )

    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    return $null
}

$apiExe = Resolve-ApiExecutable -BaseDir $InstallDir
$frontendDir = Join-Path $InstallDir "resources\frontend"
$envFile = Join-Path $InstallDir ".env"

if (-not $apiExe) {
    throw "Nenhum executavel da API foi encontrado em $InstallDir"
}

if (-not (Test-Path $envFile)) {
    @"
HOST=0.0.0.0
PORT=3001
FRONTEND_DIST=$frontendDir

FB_HOST=127.0.0.1
FB_PORT=3050
FB_DATABASE=C:\CAMINHO\BANCO.FDB
FB_USER=SYSDBA
FB_PASSWORD=CHANGE_ME
FBCLIENT_PATH=C:\CAMINHO\FIREBIRD\fbclient.dll

JWT_SECRET=CHANGE_ME_WITH_A_LONG_RANDOM_SECRET
LICENSE_API_URL=
LICENSE_API_KEY=
PROJECT_SLUG=agenda-lmd-preview
LICENSE_PROJECT_SLUG=agenda-lmd-preview
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
