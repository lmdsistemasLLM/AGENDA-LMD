Write-Host "Instalando dependencias Python..." -ForegroundColor Cyan
python -m pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "Gerando agenda-api.exe com PyInstaller..." -ForegroundColor Cyan
python -m PyInstaller --clean --noconfirm agenda-api.spec
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "API gerada em api-python\\dist\\agenda-api\\agenda-api.exe" -ForegroundColor Green
