Write-Host "Build API Python..." -ForegroundColor Cyan
Push-Location api-python
.\build-api.ps1
if ($LASTEXITCODE -ne 0) { exit 1 }
Pop-Location

Write-Host "Build frontend..." -ForegroundColor Cyan
Push-Location frontend
npm run build
if ($LASTEXITCODE -ne 0) { exit 1 }
Pop-Location

Write-Host "Packaging..." -ForegroundColor Green

$outDir = "C:\Agenda_LMD_Release"
if (Test-Path $outDir) { Remove-Item -Recurse -Force $outDir }
New-Item -ItemType Directory -Path $outDir | Out-Null

Copy-Item frontend\dist-app -Destination "$outDir\app" -Recurse
Copy-Item frontend\electron -Destination "$outDir\" -Recurse -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path "$outDir\api" -Force | Out-Null
Copy-Item api-python\dist\agenda-api\* -Destination "$outDir\api" -Recurse -Force
Copy-Item frontend\package.json -Destination "$outDir\"
Copy-Item frontend\package-lock.json -Destination "$outDir\" -ErrorAction SilentlyContinue
Copy-Item install-agenda-service.ps1 -Destination "$outDir\"
Copy-Item uninstall-agenda-service.ps1 -Destination "$outDir\"

Compress-Archive -Path $outDir -DestinationPath "Agenda_LMD_Portavel.zip" -Force -ErrorAction Stop

Write-Host "`nSucesso! Arquivo gerado: Agenda_LMD_Portavel.zip" -ForegroundColor Green
Get-Item "Agenda_LMD_Portavel.zip" | Format-Table Name, @{N="Tamanho (MB)";E={"{0:N2}" -f ($_.Length/1MB)}}
