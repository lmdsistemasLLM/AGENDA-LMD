@echo off
REM Script de Instalacao Automatica - Agenda LMD
REM Execute como Administrador

title Agenda LMD - Instalacao

echo.
echo ====================================
echo   AGENDA LMD - INSTALACAO
echo ====================================
echo.

set APP_DIR=C:\Agenda_LMD

echo Criando pasta %APP_DIR%...
if not exist "%APP_DIR%" (
    mkdir "%APP_DIR%"
    echo Pasta criada
) else (
    echo Pasta ja existe
)
echo.

set /p SOURCE_DIR="Informe o caminho dos arquivos de origem (ex: C:\Downloads\agenda-src): "

echo.
echo Copiando arquivos...
if exist "%SOURCE_DIR%\frontend\dist-app" (
    xcopy "%SOURCE_DIR%\frontend\dist-app" "%APP_DIR%\frontend\dist-app" /E /I /Y >nul
    echo   - Frontend: OK
) else (
    echo   - ERROR: frontend\dist-app nao encontrado
)

if exist "%SOURCE_DIR%\frontend\electron" (
    xcopy "%SOURCE_DIR%\frontend\electron" "%APP_DIR%\frontend\electron" /E /I /Y >nul
    echo   - Electron: OK
) else (
    echo   - ERROR: frontend\electron nao encontrado
)

if exist "%SOURCE_DIR%\api-python\dist\agenda-api\agenda-api.exe" (
    if not exist "%APP_DIR%\api" mkdir "%APP_DIR%\api"
    xcopy "%SOURCE_DIR%\api-python\dist\agenda-api" "%APP_DIR%\api" /E /I /Y >nul
    echo   - API Python: OK
) else (
    echo   - ERROR: api-python\dist\agenda-api\agenda-api.exe nao encontrado
)

echo.
echo Instalacao concluida!
echo.
echo Proximos passos:
echo   1. Configure o arquivo .env na pasta do executavel.
echo   2. Execute Agenda LMD.exe.
echo.
pause
