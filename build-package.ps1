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

Write-Host "Preparando pacote portavel..." -ForegroundColor Green

$repoRoot = (Resolve-Path ".").Path
$portableRoot = Join-Path $repoRoot "dist\\portable"
$outDir = Join-Path $portableRoot "Agenda_LMD_Portavel"

if (Test-Path $outDir) { Remove-Item -Recurse -Force $outDir }
New-Item -ItemType Directory -Path $outDir | Out-Null
New-Item -ItemType Directory -Path (Join-Path $outDir "api\\x86") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $outDir "api\\x64") -Force | Out-Null

Copy-Item frontend\dist-app -Destination (Join-Path $outDir "app") -Recurse
Copy-Item frontend\electron -Destination (Join-Path $outDir "electron") -Recurse -ErrorAction SilentlyContinue
Copy-Item api-python\dist\agenda-api-x86\* -Destination (Join-Path $outDir "api\\x86") -Recurse -Force
Copy-Item api-python\dist\agenda-api-x64\* -Destination (Join-Path $outDir "api\\x64") -Recurse -Force
Copy-Item frontend\package.json -Destination $outDir
Copy-Item frontend\package-lock.json -Destination $outDir -ErrorAction SilentlyContinue
Copy-Item install-agenda-service.ps1 -Destination $outDir
Copy-Item uninstall-agenda-service.ps1 -Destination $outDir
Copy-Item .env.example -Destination $outDir
Copy-Item README.md -Destination $outDir

$zipPath = Join-Path $portableRoot "Agenda_LMD_Portavel.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

Compress-Archive -Path $outDir -DestinationPath $zipPath -Force -ErrorAction Stop

Write-Host "`nSucesso! Arquivo gerado: $zipPath" -ForegroundColor Green
Get-Item $zipPath | Format-Table Name, @{N="Tamanho (MB)";E={"{0:N2}" -f ($_.Length/1MB)}}
