param(
    [string]$InstallDir = "C:\Program Files\LMD Sistemas\Agenda LMD Preview",
    [string]$DataDir = $(if ($env:PROGRAMDATA) { Join-Path $env:PROGRAMDATA "LMD Sistemas\Agenda LMD Preview" } else { Join-Path $InstallDir "data" })
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = "Stop"
$script:LastTestSucceeded = $false
$script:LastDiagnostics = $null
$script:LastTestResult = $null
$script:LastSuccessfulExecutable = $null

function Get-LogDir {
    $root = Join-Path $DataDir "logs\installer"
    New-Item -ItemType Directory -Path $root -Force | Out-Null
    return $root
}

function Sanitize-Value {
    param([string]$Value)

    if (-not $Value) { return "" }

    $sanitized = $Value -replace '(?i)(password=)[^;\r\n]*', '$1***'
    $sanitized = $sanitized -replace '(?i)("password"\s*:\s*")[^"]*', '$1***'
    return $sanitized
}

function Write-InstallerLog {
    param(
        [string]$Category,
        [string]$Message
    )

    $target = Join-Path (Get-LogDir) "$Category.log"
    $timestamp = (Get-Date).ToUniversalTime().ToString("o")
    Add-Content -Path $target -Value "[$timestamp] $(Sanitize-Value $Message)" -Encoding UTF8
}

function Read-EnvFile {
    param([string]$Path)

    $values = @{}
    if (-not (Test-Path -LiteralPath $Path)) {
        return $values
    }

    foreach ($line in Get-Content -Path $Path -Encoding UTF8) {
        if ([string]::IsNullOrWhiteSpace($line) -or $line.TrimStart().StartsWith("#")) {
            continue
        }

        $pair = $line -split "=", 2
        if ($pair.Count -ne 2) {
            continue
        }

        $values[$pair[0].Trim()] = $pair[1].Trim().Trim('"').Trim("'")
    }

    return $values
}

function Get-EnvPath {
    return Join-Path $DataDir ".env"
}

function Get-RuntimeConfigPath {
    return Join-Path $DataDir "firebird-runtime.json"
}

function Get-ApiExecutables {
    $candidates = @()
    $x64 = Join-Path $InstallDir "resources\api\x64\agenda-api-x64.exe"
    $x86 = Join-Path $InstallDir "resources\api\x86\agenda-api-x86.exe"
    $legacy = Join-Path $InstallDir "resources\api\agenda-api.exe"

    if (Test-Path -LiteralPath $x64) { $candidates += [pscustomobject]@{ Arch = "X64"; Path = $x64 } }
    if (Test-Path -LiteralPath $x86) { $candidates += [pscustomobject]@{ Arch = "X86"; Path = $x86 } }
    if (Test-Path -LiteralPath $legacy) { $candidates += [pscustomobject]@{ Arch = "AUTO"; Path = $legacy } }

    return $candidates
}

function Get-OrderedExecutables {
    param([string]$RequestedArch)

    $executables = Get-ApiExecutables
    switch ($RequestedArch) {
        "X64" { return $executables | Sort-Object { if ($_.Arch -eq "X64") { 0 } elseif ($_.Arch -eq "AUTO") { 1 } else { 2 } } }
        "X86" { return $executables | Sort-Object { if ($_.Arch -eq "X86") { 0 } elseif ($_.Arch -eq "AUTO") { 1 } else { 2 } } }
        default { return $executables | Sort-Object { if ($_.Arch -eq "X64") { 0 } elseif ($_.Arch -eq "X86") { 1 } else { 2 } } }
    }
}

function Write-TempEnvFile {
    param([hashtable]$Values)

    $tempDir = Join-Path ([IO.Path]::GetTempPath()) ("AgendaLMD-" + [Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
    $tempEnv = Join-Path $tempDir ".env"

    $order = @(
        "FB_HOST",
        "FB_PORT",
        "FB_DATABASE",
        "FB_USER",
        "FB_PASSWORD",
        "FB_CHARSET",
        "FBCLIENT_PATH",
        "FIREBIRD_ARCH",
        "FIREBIRD_PROVIDER",
        "FIREBIRD_CONNECTION_MODE",
        "HOST",
        "PORT",
        "FRONTEND_DIST",
        "JWT_SECRET",
        "LICENSE_API_URL",
        "LICENSE_API_KEY",
        "PROJECT_SLUG",
        "LICENSE_KEY",
        "LICENSE_CNPJ",
        "LICENSE_PROJECT_SLUG",
        "APP_LOGIN_USER",
        "APP_LOGIN_PASSWORD"
    )

    $lines = foreach ($key in $order) {
        "$key=$($Values[$key])"
    }

    Set-Content -Path $tempEnv -Value ($lines -join [Environment]::NewLine) -Encoding UTF8
    return $tempEnv
}

function Write-TempPayloadFile {
    param([hashtable]$Values)

    $payload = @{
        host = $Values["FB_HOST"]
        port = $Values["FB_PORT"]
        database = $Values["FB_DATABASE"]
        user = $Values["FB_USER"]
        password = $Values["FB_PASSWORD"]
        charset = $Values["FB_CHARSET"]
        clientPath = $Values["FBCLIENT_PATH"]
        arch = $Values["FIREBIRD_ARCH"]
        provider = $Values["FIREBIRD_PROVIDER"]
        connectionMode = $Values["FIREBIRD_CONNECTION_MODE"]
    }

    $tempPath = Join-Path ([IO.Path]::GetTempPath()) ("AgendaLMD-" + [Guid]::NewGuid().ToString("N") + ".json")
    $payload | ConvertTo-Json -Depth 4 | Set-Content -Path $tempPath -Encoding UTF8
    return $tempPath
}

function Remove-TempArtifacts {
    param(
        [string]$TempEnv,
        [string]$TempPayload
    )

    if ($TempEnv) {
        Remove-Item -LiteralPath (Split-Path -Parent $TempEnv) -Recurse -Force -ErrorAction SilentlyContinue
    }
    if ($TempPayload) {
        Remove-Item -LiteralPath $TempPayload -Force -ErrorAction SilentlyContinue
    }
}

function Invoke-ApiJsonCommand {
    param(
        [string]$ApiExe,
        [string]$Action,
        [hashtable]$EnvValues,
        [switch]$PersistEnv,
        [switch]$PersistRuntime
    )

    $tempEnv = Write-TempEnvFile -Values $EnvValues
    $tempPayload = Write-TempPayloadFile -Values $EnvValues

    try {
        $arguments = @(
            "--env-file", $tempEnv,
            "--apply-firebird-config", $tempPayload,
            "--json"
        )

        switch ($Action) {
            "diagnostics" { $arguments += "--print-firebird-diagnostics" }
            "test" { $arguments += "--test-firebird-connection" }
            "save" {
                if ($PersistEnv) { $arguments += "--persist-firebird-env" }
                if ($PersistRuntime) { $arguments += "--persist-firebird-runtime" }
            }
            default { throw "Acao nao suportada: $Action" }
        }

        $processEnv = @{
            AGENDA_DATA_DIR = $DataDir
            AGENDA_ENV_PATH = $(if ($Action -eq "save") { Get-EnvPath } else { $tempEnv })
            AGENDA_INSTALLED_MODE = "1"
        }

        Write-InstallerLog -Category "installation" -Message "Executando $Action em $ApiExe"
        $rawOutput = & {
            $previous = @{}
            foreach ($item in $processEnv.GetEnumerator()) {
                $previous[$item.Key] = [Environment]::GetEnvironmentVariable($item.Key, "Process")
                [Environment]::SetEnvironmentVariable($item.Key, $item.Value, "Process")
            }

            try {
                & $ApiExe @arguments 2>&1 | Out-String
            } finally {
                foreach ($item in $processEnv.GetEnumerator()) {
                    [Environment]::SetEnvironmentVariable($item.Key, $previous[$item.Key], "Process")
                }
            }
        }

        $exitCode = $LASTEXITCODE
        $payload = $null

        try {
            $payload = $rawOutput | ConvertFrom-Json -ErrorAction Stop
        } catch {
            $payload = [pscustomobject]@{
                error = $rawOutput.Trim()
            }
        }

        return [pscustomobject]@{
            Ok = ($exitCode -eq 0)
            ExitCode = $exitCode
            Payload = $payload
            RawOutput = $rawOutput
            ApiExe = $ApiExe
        }
    } finally {
        Remove-TempArtifacts -TempEnv $tempEnv -TempPayload $tempPayload
    }
}

function Get-EnvValuesFromForm {
    param(
        $HostBox,
        $PortBox,
        $DatabaseBox,
        $UserBox,
        $PasswordBox,
        $CharsetBox,
        $ClientPathBox,
        $ArchBox,
        $ProviderBox,
        $ModeBox,
        [hashtable]$Existing
    )

    return @{
        FB_HOST = $HostBox.Text.Trim()
        FB_PORT = $PortBox.Text.Trim()
        FB_DATABASE = $DatabaseBox.Text.Trim()
        FB_USER = $UserBox.Text.Trim()
        FB_PASSWORD = $PasswordBox.Text
        FB_CHARSET = $CharsetBox.Text.Trim()
        FBCLIENT_PATH = $ClientPathBox.Text.Trim()
        FIREBIRD_ARCH = $ArchBox.SelectedItem.ToString()
        FIREBIRD_PROVIDER = $ProviderBox.SelectedItem.ToString()
        FIREBIRD_CONNECTION_MODE = $ModeBox.SelectedItem.ToString()
        HOST = if ($Existing["HOST"]) { $Existing["HOST"] } else { "127.0.0.1" }
        PORT = if ($Existing["PORT"]) { $Existing["PORT"] } else { "3001" }
        FRONTEND_DIST = if ($Existing["FRONTEND_DIST"]) { $Existing["FRONTEND_DIST"] } else { (Join-Path $InstallDir "resources\frontend") }
        JWT_SECRET = $Existing["JWT_SECRET"]
        LICENSE_API_URL = if ($Existing["LICENSE_API_URL"]) { $Existing["LICENSE_API_URL"] } else { "" }
        LICENSE_API_KEY = $Existing["LICENSE_API_KEY"]
        PROJECT_SLUG = if ($Existing["PROJECT_SLUG"]) { $Existing["PROJECT_SLUG"] } else { "agenda-lmd-preview" }
        LICENSE_KEY = $Existing["LICENSE_KEY"]
        LICENSE_CNPJ = $Existing["LICENSE_CNPJ"]
        LICENSE_PROJECT_SLUG = if ($Existing["LICENSE_PROJECT_SLUG"]) { $Existing["LICENSE_PROJECT_SLUG"] } else { "agenda-lmd-preview" }
        APP_LOGIN_USER = if ($Existing["APP_LOGIN_USER"]) { $Existing["APP_LOGIN_USER"] } else { "admin" }
        APP_LOGIN_PASSWORD = if ($Existing["APP_LOGIN_PASSWORD"]) { $Existing["APP_LOGIN_PASSWORD"] } else { "admin" }
    }
}

function Set-StatusText {
    param(
        $TextBox,
        [string]$Message
    )

    $TextBox.Text = $Message
}

$envPath = Get-EnvPath
$runtimeConfigPath = Get-RuntimeConfigPath
New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
$existingEnv = Read-EnvFile -Path $envPath
$apiExecutables = Get-ApiExecutables
Write-InstallerLog -Category "installation" -Message "Assistente iniciado para $InstallDir com dados em $DataDir"

$form = New-Object System.Windows.Forms.Form
$form.Text = "Agenda LMD Preview - Configuracao Firebird"
$form.Size = New-Object System.Drawing.Size(900, 790)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.Font = New-Object System.Drawing.Font("Segoe UI", 9)

$title = New-Object System.Windows.Forms.Label
$title.Text = "Configurar conexao Firebird do Agenda LMD Preview"
$title.Font = New-Object System.Drawing.Font("Segoe UI", 14, [System.Drawing.FontStyle]::Bold)
$title.Location = New-Object System.Drawing.Point(20, 18)
$title.Size = New-Object System.Drawing.Size(700, 32)
$form.Controls.Add($title)

$subtitle = New-Object System.Windows.Forms.Label
$subtitle.Text = "Preencha os dados abaixo, valide a arquitetura da DLL e execute um teste real de conexao antes de concluir."
$subtitle.Location = New-Object System.Drawing.Point(20, 50)
$subtitle.Size = New-Object System.Drawing.Size(820, 34)
$form.Controls.Add($subtitle)

function Add-LabeledControl {
    param(
        [string]$LabelText,
        [int]$X,
        [int]$Y,
        [int]$Width,
        [string]$DefaultValue = "",
        [switch]$Password
    )

    $label = New-Object System.Windows.Forms.Label
    $label.Text = $LabelText
    $label.Location = New-Object System.Drawing.Point($X, $Y)
    $label.Size = New-Object System.Drawing.Size($Width, 22)
    $form.Controls.Add($label)

    $textBox = New-Object System.Windows.Forms.TextBox
    $textBox.Location = New-Object System.Drawing.Point($X, ($Y + 24))
    $textBox.Size = New-Object System.Drawing.Size($Width, 28)
    $textBox.Text = $DefaultValue
    if ($Password) {
        $textBox.UseSystemPasswordChar = $true
    }
    $form.Controls.Add($textBox)
    return $textBox
}

function Add-ComboControl {
    param(
        [string]$LabelText,
        [int]$X,
        [int]$Y,
        [int]$Width,
        [string[]]$Items,
        [string]$DefaultValue
    )

    $label = New-Object System.Windows.Forms.Label
    $label.Text = $LabelText
    $label.Location = New-Object System.Drawing.Point($X, $Y)
    $label.Size = New-Object System.Drawing.Size($Width, 22)
    $form.Controls.Add($label)

    $comboBox = New-Object System.Windows.Forms.ComboBox
    $comboBox.Location = New-Object System.Drawing.Point($X, ($Y + 24))
    $comboBox.Size = New-Object System.Drawing.Size($Width, 28)
    $comboBox.DropDownStyle = "DropDownList"
    [void]$comboBox.Items.AddRange($Items)
    $comboBox.SelectedItem = if ($Items -contains $DefaultValue) { $DefaultValue } else { $Items[0] }
    $form.Controls.Add($comboBox)
    return $comboBox
}

$hostBox = Add-LabeledControl -LabelText "Host do Firebird" -X 20 -Y 98 -Width 250 -DefaultValue ($(if ($existingEnv["FB_HOST"]) { $existingEnv["FB_HOST"] } else { "127.0.0.1" }))
$portBox = Add-LabeledControl -LabelText "Porta do Firebird" -X 290 -Y 98 -Width 120 -DefaultValue ($(if ($existingEnv["FB_PORT"]) { $existingEnv["FB_PORT"] } else { "3050" }))
$charsetBox = Add-LabeledControl -LabelText "Charset" -X 430 -Y 98 -Width 160 -DefaultValue ($(if ($existingEnv["FB_CHARSET"]) { $existingEnv["FB_CHARSET"] } else { "UTF8" }))
$modeBox = Add-ComboControl -LabelText "Modo de conexao" -X 610 -Y 98 -Width 230 -Items @("AUTO", "LOCAL_PATH", "LOCAL_ALIAS", "REMOTE") -DefaultValue ($(if ($existingEnv["FIREBIRD_CONNECTION_MODE"]) { $existingEnv["FIREBIRD_CONNECTION_MODE"] } else { "AUTO" }))

$databaseBox = Add-LabeledControl -LabelText "Banco (caminho ou alias)" -X 20 -Y 168 -Width 820 -DefaultValue $existingEnv["FB_DATABASE"]
$userBox = Add-LabeledControl -LabelText "Usuario" -X 20 -Y 238 -Width 250 -DefaultValue ($(if ($existingEnv["FB_USER"]) { $existingEnv["FB_USER"] } else { "SYSDBA" }))
$passwordBox = Add-LabeledControl -LabelText "Senha" -X 290 -Y 238 -Width 250 -DefaultValue $existingEnv["FB_PASSWORD"] -Password
$clientPathBox = Add-LabeledControl -LabelText "Caminho opcional da fbclient.dll" -X 20 -Y 308 -Width 820 -DefaultValue $existingEnv["FBCLIENT_PATH"]
$archBox = Add-ComboControl -LabelText "Arquitetura" -X 20 -Y 378 -Width 180 -Items @("AUTO", "X86", "X64") -DefaultValue ($(if ($existingEnv["FIREBIRD_ARCH"]) { $existingEnv["FIREBIRD_ARCH"] } else { "AUTO" }))
$providerBox = Add-ComboControl -LabelText "Provider" -X 220 -Y 378 -Width 220 -Items @("AUTO", "FDB", "FIREBIRD_DRIVER") -DefaultValue ($(if ($existingEnv["FIREBIRD_PROVIDER"]) { $existingEnv["FIREBIRD_PROVIDER"] } else { "AUTO" }))

$installDirLabel = New-Object System.Windows.Forms.Label
$installDirLabel.Text = "Pasta de instalacao: $InstallDir"
$installDirLabel.Location = New-Object System.Drawing.Point(20, 448)
$installDirLabel.Size = New-Object System.Drawing.Size(820, 20)
$form.Controls.Add($installDirLabel)

$dataDirLabel = New-Object System.Windows.Forms.Label
$dataDirLabel.Text = "Pasta de dados gravaveis: $DataDir"
$dataDirLabel.Location = New-Object System.Drawing.Point(20, 470)
$dataDirLabel.Size = New-Object System.Drawing.Size(820, 20)
$form.Controls.Add($dataDirLabel)

$statusBox = New-Object System.Windows.Forms.TextBox
$statusBox.Location = New-Object System.Drawing.Point(20, 505)
$statusBox.Size = New-Object System.Drawing.Size(820, 180)
$statusBox.Multiline = $true
$statusBox.ScrollBars = "Vertical"
$statusBox.ReadOnly = $true
$statusBox.BackColor = [System.Drawing.Color]::White
$form.Controls.Add($statusBox)

Set-StatusText -TextBox $statusBox -Message ("APIs detectadas:`r`n" + ($apiExecutables | ForEach-Object { "- $($_.Arch) -> $($_.Path)" } | Out-String) + "Arquivo .env: $envPath`r`nRuntime config: $runtimeConfigPath")

$autoDetectButton = New-Object System.Windows.Forms.Button
$autoDetectButton.Text = "Auto detectar DLL"
$autoDetectButton.Location = New-Object System.Drawing.Point(20, 705)
$autoDetectButton.Size = New-Object System.Drawing.Size(150, 34)
$form.Controls.Add($autoDetectButton)

$testButton = New-Object System.Windows.Forms.Button
$testButton.Text = "Testar conexao"
$testButton.Location = New-Object System.Drawing.Point(190, 705)
$testButton.Size = New-Object System.Drawing.Size(150, 34)
$form.Controls.Add($testButton)

$saveButton = New-Object System.Windows.Forms.Button
$saveButton.Text = "Salvar configuracao"
$saveButton.Location = New-Object System.Drawing.Point(360, 705)
$saveButton.Size = New-Object System.Drawing.Size(170, 34)
$form.Controls.Add($saveButton)

$cancelButton = New-Object System.Windows.Forms.Button
$cancelButton.Text = "Fechar"
$cancelButton.Location = New-Object System.Drawing.Point(550, 705)
$cancelButton.Size = New-Object System.Drawing.Size(120, 34)
$form.Controls.Add($cancelButton)

$rollbackButton = New-Object System.Windows.Forms.Button
$rollbackButton.Text = "Rollback"
$rollbackButton.Location = New-Object System.Drawing.Point(690, 705)
$rollbackButton.Size = New-Object System.Drawing.Size(150, 34)
$form.Controls.Add($rollbackButton)

$autoDetectButton.Add_Click({
    $envValues = Get-EnvValuesFromForm -HostBox $hostBox -PortBox $portBox -DatabaseBox $databaseBox -UserBox $userBox -PasswordBox $passwordBox -CharsetBox $charsetBox -ClientPathBox $clientPathBox -ArchBox $archBox -ProviderBox $providerBox -ModeBox $modeBox -Existing $existingEnv
    $messages = @()
    $selectedPayload = $null

    foreach ($exe in (Get-OrderedExecutables -RequestedArch $archBox.SelectedItem.ToString())) {
        $result = Invoke-ApiJsonCommand -ApiExe $exe.Path -Action "diagnostics" -EnvValues $envValues
        $payload = $result.Payload
        Write-InstallerLog -Category "architecture-detection" -Message "$($exe.Path) => exit=$($result.ExitCode)"
        Write-InstallerLog -Category "dll-search" -Message ($payload | ConvertTo-Json -Depth 6)

        if ($payload.candidates) {
            Write-InstallerLog -Category "dll-validation" -Message ($payload.candidates | ConvertTo-Json -Depth 6)
        }

        $messages += "[$($exe.Arch)] status=$($payload.validationStatus) process=$($payload.processArchitecture) dll=$($payload.clientPath)"
        if ($payload.validationStatus -eq "valid" -and -not $selectedPayload) {
            $selectedPayload = $payload
        }
    }

    if ($selectedPayload) {
        $clientPathBox.Text = [string]$selectedPayload.clientPath
        if ($modeBox.Items.Contains([string]$selectedPayload.connectionMode)) {
            $modeBox.SelectedItem = [string]$selectedPayload.connectionMode
        }
        Set-StatusText -TextBox $statusBox -Message ("DLL valida localizada:`r`n" + ($messages -join "`r`n"))
        $script:LastDiagnostics = $selectedPayload
    } else {
        Set-StatusText -TextBox $statusBox -Message ("Nenhuma DLL compativel foi validada.`r`n" + ($messages -join "`r`n"))
    }
})

$testButton.Add_Click({
    $envValues = Get-EnvValuesFromForm -HostBox $hostBox -PortBox $portBox -DatabaseBox $databaseBox -UserBox $userBox -PasswordBox $passwordBox -CharsetBox $charsetBox -ClientPathBox $clientPathBox -ArchBox $archBox -ProviderBox $providerBox -ModeBox $modeBox -Existing $existingEnv

    foreach ($exe in (Get-OrderedExecutables -RequestedArch $archBox.SelectedItem.ToString())) {
        $result = Invoke-ApiJsonCommand -ApiExe $exe.Path -Action "test" -EnvValues $envValues
        $script:LastTestResult = $result.Payload
        Write-InstallerLog -Category "connection-test" -Message "$($exe.Path) => $($result.RawOutput)"

        if ($result.Ok) {
            $script:LastTestSucceeded = $true
            $script:LastSuccessfulExecutable = $exe.Path
            if ($result.Payload.clientPath) {
                $clientPathBox.Text = [string]$result.Payload.clientPath
            }
            if ($modeBox.Items.Contains([string]$result.Payload.connectionMode)) {
                $modeBox.SelectedItem = [string]$result.Payload.connectionMode
            }
            Set-StatusText -TextBox $statusBox -Message ("Teste concluido com sucesso usando $($exe.Path).`r`nProvider: $($result.Payload.providerSelected)`r`nDLL: $($result.Payload.clientPath)`r`nServidor: $($result.Payload.serverVersion)")
            [System.Windows.Forms.MessageBox]::Show(
                "Conexao validada com sucesso.",
                "Agenda LMD Preview",
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Information
            ) | Out-Null
            return
        }
    }

    $script:LastTestSucceeded = $false
    $script:LastSuccessfulExecutable = $null
    $errorMessage = if ($script:LastTestResult.error) { [string]$script:LastTestResult.error } else { "Falha ao testar a conexao." }
    Set-StatusText -TextBox $statusBox -Message $errorMessage
    [System.Windows.Forms.MessageBox]::Show(
        "O teste de conexao falhou. Revise os dados e a DLL selecionada.",
        "Agenda LMD Preview",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Warning
    ) | Out-Null
})

$saveButton.Add_Click({
    if (-not $script:LastTestSucceeded) {
        $decision = [System.Windows.Forms.MessageBox]::Show(
            "Nenhum teste bem-sucedido foi registrado nesta sessao. Deseja salvar mesmo assim?",
            "Agenda LMD Preview",
            [System.Windows.Forms.MessageBoxButtons]::YesNo,
            [System.Windows.Forms.MessageBoxIcon]::Warning
        )
        if ($decision -ne [System.Windows.Forms.DialogResult]::Yes) {
            return
        }
    }

    $envValues = Get-EnvValuesFromForm -HostBox $hostBox -PortBox $portBox -DatabaseBox $databaseBox -UserBox $userBox -PasswordBox $passwordBox -CharsetBox $charsetBox -ClientPathBox $clientPathBox -ArchBox $archBox -ProviderBox $providerBox -ModeBox $modeBox -Existing $existingEnv
    $executables = Get-OrderedExecutables -RequestedArch $archBox.SelectedItem.ToString()

    if ($script:LastSuccessfulExecutable) {
        $preferred = $executables | Where-Object { $_.Path -eq $script:LastSuccessfulExecutable }
        if ($preferred) {
            $executables = @($preferred) + @($executables | Where-Object { $_.Path -ne $script:LastSuccessfulExecutable })
        }
    }

    foreach ($exe in $executables) {
        $result = Invoke-ApiJsonCommand -ApiExe $exe.Path -Action "save" -EnvValues $envValues -PersistEnv -PersistRuntime
        if ($result.Ok) {
            $existingEnv = Read-EnvFile -Path $envPath
            $message = "Configuracao salva com sucesso.`r`n.env: $($result.Payload.envPath)`r`nRuntime config: $($result.Payload.runtimeConfigPath)"
            Set-StatusText -TextBox $statusBox -Message $message
            Write-InstallerLog -Category "env-creation" -Message ($result.Payload | ConvertTo-Json -Depth 6)
            [System.Windows.Forms.MessageBox]::Show(
                "Configuracao salva com sucesso.",
                "Agenda LMD Preview",
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Information
            ) | Out-Null
            return
        }
    }

    [System.Windows.Forms.MessageBox]::Show(
        "Nao foi possivel salvar a configuracao no backend empacotado.",
        "Agenda LMD Preview",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
})

$rollbackButton.Add_Click({
    try {
        & (Join-Path $PSScriptRoot "Rollback-AgendaLMD.ps1") -InstallDir $InstallDir -DataDir $DataDir
        [System.Windows.Forms.MessageBox]::Show(
            "Rollback executado com sucesso.",
            "Agenda LMD Preview",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Information
        ) | Out-Null
    } catch {
        [System.Windows.Forms.MessageBox]::Show(
            $_.Exception.Message,
            "Agenda LMD Preview",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error
        ) | Out-Null
    }
})

$cancelButton.Add_Click({
    $form.Close()
})

[void]$form.ShowDialog()
