param(
    [Parameter(Mandatory = $true)][string]$EnvPath,
    [Parameter(Mandatory = $true)][string]$UpdatesPath
)

# Mescla as chaves informadas no assistente de instalacao no .env do Agenda LMD.
# Linhas existentes sao preservadas; apenas as chaves recebidas sao criadas ou substituidas.

$ErrorActionPreference = "Stop"
$utf8 = New-Object System.Text.UTF8Encoding($false)

try {
    $updates = [ordered]@{}
    foreach ($line in [IO.File]::ReadAllLines($UpdatesPath, $utf8)) {
        $eq = $line.IndexOf("=")
        if ($eq -lt 1) { continue }
        $updates[$line.Substring(0, $eq).Trim()] = $line.Substring($eq + 1).Trim()
    }

    if ($updates.Count -eq 0) { exit 0 }

    $dir = Split-Path -Parent $EnvPath
    New-Item -ItemType Directory -Path $dir -Force | Out-Null

    $lines = New-Object System.Collections.Generic.List[string]
    if (Test-Path -LiteralPath $EnvPath) {
        $backupDir = Join-Path $dir "backups"
        New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
        Copy-Item -LiteralPath $EnvPath -Destination (Join-Path $backupDir (".env-instalador-" + (Get-Date -Format "yyyyMMddHHmmss") + ".bak")) -Force

        foreach ($existing in [IO.File]::ReadAllLines($EnvPath, $utf8)) {
            $lines.Add($existing)
        }
    }

    foreach ($key in $updates.Keys) {
        $rendered = "$key=$($updates[$key])"
        $found = $false
        for ($n = $lines.Count - 1; $n -ge 0; $n--) {
            $trimmed = $lines[$n].Trim()
            if (-not $trimmed -or $trimmed.StartsWith("#")) { continue }
            $eq = $lines[$n].IndexOf("=")
            if ($eq -gt 0 -and $lines[$n].Substring(0, $eq).Trim() -ceq $key) {
                $lines[$n] = $rendered
                $found = $true
                break
            }
        }
        if (-not $found) { $lines.Add($rendered) }
    }

    $content = (($lines -join "`n").TrimEnd()) + "`n"
    [IO.File]::WriteAllText($EnvPath, $content, $utf8)
    exit 0
}
catch {
    Write-Error $_
    exit 1
}
finally {
    Remove-Item -LiteralPath $UpdatesPath -Force -ErrorAction SilentlyContinue
}
