param(
    [string]$TaskName = "Agenda LMD API"
)

Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Remove-NetFirewallRule -DisplayName "Agenda LMD API 3001" -ErrorAction SilentlyContinue

Write-Host "Agenda LMD API removida da inicializacao do Windows." -ForegroundColor Green
