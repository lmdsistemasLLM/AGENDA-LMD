#ifndef StageDir
  #error StageDir nao informado. Use /DStageDir=...
#endif

#ifndef AppVersion
  #define AppVersion "1.1.1"
#endif

#ifndef OutputDir
  #define OutputDir "..\dist"
#endif

#define MyAppName "Agenda LMD Preview"
#define MyAppPublisher "LMD Sistemas"
#define MyAppExeName "Agenda LMD Preview.exe"
#define MyDataSubDir "LMD Sistemas\Agenda LMD Preview"
#define DefaultLicenseApiUrl "https://lmdsistemasdev.qzz.io/api"

[Setup]
AppId={{8E9B8D0F-A2B6-4B91-94BC-92C6BB7966FD}
AppName={#MyAppName}
AppVersion={#AppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\LMD Sistemas\Agenda LMD Preview
DefaultGroupName=Agenda LMD Preview
DisableProgramGroupPage=yes
UsePreviousAppDir=yes
Compression=lzma
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#OutputDir}
OutputBaseFilename=Agenda-LMD-Preview-Setup-{#AppVersion}
UninstallDisplayIcon={app}\{#MyAppExeName}
SetupLogging=yes
SetupIconFile=assets\icon.ico

[Dirs]
; O instalador grava o .env como administrador; o app roda como usuario comum e precisa atualiza-lo.
Name: "{commonappdata}\{#MyDataSubDir}"; Permissions: users-modify

[Tasks]
Name: "desktopicon"; Description: "Criar atalho na area de trabalho"; GroupDescription: "Atalhos:"
Name: "launchapp"; Description: "Executar Agenda LMD Preview ao concluir"; GroupDescription: "Pos-instalacao:"

[Files]
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Agenda LMD Preview"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\Agenda LMD Preview"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Executar Agenda LMD Preview"; Flags: postinstall nowait skipifsilent; Tasks: launchapp

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\installer\Uninstall-AgendaLMD.ps1"" -InstallDir ""{app}"" -DataDir ""{commonappdata}\LMD Sistemas\Agenda LMD Preview"""; Flags: runhidden

[Code]
var
  DbPage: TInputQueryWizardPage;
  FbClientPage: TInputFileWizardPage;
  LicensePage: TInputQueryWizardPage;
  ExistingEnv: TArrayOfString;
  PrefillValues: TStringList;

function DataDirPath(): String;
begin
  Result := ExpandConstant('{commonappdata}\{#MyDataSubDir}');
end;

function EnvFilePath(): String;
begin
  Result := AddBackslash(DataDirPath()) + '.env';
end;

function EnvHasKey(const Key: String): Boolean;
var
  I, P: Integer;
  Line: String;
begin
  Result := False;
  for I := 0 to GetArrayLength(ExistingEnv) - 1 do
  begin
    Line := Trim(ExistingEnv[I]);
    if (Line = '') or (Copy(Line, 1, 1) = '#') then
      Continue;
    P := Pos('=', Line);
    if (P > 1) and (Trim(Copy(Line, 1, P - 1)) = Key) then
    begin
      Result := True;
      Exit;
    end;
  end;
end;

function StripQuotes(const Value: String): String;
var
  First: String;
begin
  Result := Value;
  if Length(Value) >= 2 then
  begin
    First := Copy(Value, 1, 1);
    if ((First = '"') or (First = #39)) and (Copy(Value, Length(Value), 1) = First) then
      Result := Copy(Value, 2, Length(Value) - 2);
  end;
end;

function EnvValue(const Key, DefaultValue: String): String;
var
  I, P: Integer;
  Line: String;
begin
  Result := DefaultValue;
  for I := 0 to GetArrayLength(ExistingEnv) - 1 do
  begin
    Line := Trim(ExistingEnv[I]);
    if (Line = '') or (Copy(Line, 1, 1) = '#') then
      Continue;
    P := Pos('=', Line);
    if (P > 1) and (Trim(Copy(Line, 1, P - 1)) = Key) then
      Result := StripQuotes(Trim(Copy(Line, P + 1, Length(Line))));
  end;
end;

{ O Pascal Script do Inno nao expoe TStringList.Values; busca "CHAVE=valor" manualmente. }
function PrefillValue(const Key: String): String;
var
  I: Integer;
  Prefix: String;
begin
  Result := '';
  Prefix := Key + '=';
  for I := 0 to PrefillValues.Count - 1 do
    if Copy(PrefillValues[I], 1, Length(Prefix)) = Prefix then
    begin
      Result := Copy(PrefillValues[I], Length(Prefix) + 1, Length(PrefillValues[I]));
      Exit;
    end;
end;

function Prefill(const Key, DefaultValue: String): String;
begin
  Result := EnvValue(Key, DefaultValue);
  PrefillValues.Add(Key + '=' + Result);
end;

function DetectFbClient(): String;
var
  Candidates: TArrayOfString;
  I: Integer;
begin
  Result := '';
  SetArrayLength(Candidates, 10);
  Candidates[0] := ExpandConstant('{commonpf32}\Firebird\Firebird_5_0\fbclient.dll');
  Candidates[1] := ExpandConstant('{commonpf32}\Firebird\Firebird_4_0\fbclient.dll');
  Candidates[2] := ExpandConstant('{commonpf32}\Firebird\Firebird_3_0\fbclient.dll');
  Candidates[3] := ExpandConstant('{commonpf32}\Firebird\Firebird_2_5\bin\fbclient.dll');
  Candidates[4] := ExpandConstant('{commonpf64}\Firebird\Firebird_5_0\fbclient.dll');
  Candidates[5] := ExpandConstant('{commonpf64}\Firebird\Firebird_4_0\fbclient.dll');
  Candidates[6] := ExpandConstant('{commonpf64}\Firebird\Firebird_3_0\fbclient.dll');
  Candidates[7] := ExpandConstant('{commonpf64}\Firebird\Firebird_2_5\bin\fbclient.dll');
  Candidates[8] := ExpandConstant('{syswow64}\fbclient.dll');
  Candidates[9] := ExpandConstant('{sys}\fbclient.dll');
  for I := 0 to GetArrayLength(Candidates) - 1 do
    if FileExists(Candidates[I]) then
    begin
      Result := Candidates[I];
      Exit;
    end;
end;

procedure InitializeWizard();
begin
  PrefillValues := TStringList.Create;
  if FileExists(EnvFilePath()) then
    LoadStringsFromFile(EnvFilePath(), ExistingEnv);

  DbPage := CreateInputQueryPage(wpSelectTasks,
    'Banco de dados Firebird',
    'Informe a conexao com o banco de dados do cliente.',
    'Esses dados sao gravados na configuracao do Agenda LMD. ' +
    'Deixe o caminho do banco em branco para configurar depois, na tela Configuracoes locais do aplicativo.');
  DbPage.Add('Servidor (host ou IP):', False);
  DbPage.Add('Porta:', False);
  DbPage.Add('Caminho completo do banco (.FDB) no servidor:', False);
  DbPage.Add('Usuario:', False);
  DbPage.Add('Senha:', True);
  DbPage.Add('Charset:', False);
  DbPage.Values[0] := Prefill('FB_HOST', '127.0.0.1');
  DbPage.Values[1] := Prefill('FB_PORT', '3050');
  DbPage.Values[2] := Prefill('FB_DATABASE', '');
  DbPage.Values[3] := Prefill('FB_USER', 'SYSDBA');
  DbPage.Values[4] := Prefill('FB_PASSWORD', '');
  DbPage.Values[5] := Prefill('FB_CHARSET', 'UTF8');

  FbClientPage := CreateInputFilePage(DbPage.ID,
    'Cliente Firebird',
    'Informe a fbclient.dll do Firebird instalado neste computador.',
    'O caminho abaixo foi detectado automaticamente quando possivel. ' +
    'Deixe em branco para o aplicativo procurar sozinho.');
  FbClientPage.Add('fbclient.dll:', 'fbclient.dll|fbclient.dll|Bibliotecas (*.dll)|*.dll', '.dll');
  FbClientPage.Values[0] := Prefill('FBCLIENT_PATH', DetectFbClient());

  LicensePage := CreateInputQueryPage(FbClientPage.ID,
    'Licenca',
    'Informe os dados da licenca do cliente.',
    'Deixe a chave em branco para informar depois no aplicativo.');
  LicensePage.Add('Endereco da API de licenca:', False);
  LicensePage.Add('Chave da licenca:', False);
  LicensePage.Add('CNPJ do cliente:', False);
  LicensePage.Values[0] := Prefill('LICENSE_API_URL', '');
  if LicensePage.Values[0] = '' then
    LicensePage.Values[0] := '{#DefaultLicenseApiUrl}';
  LicensePage.Values[1] := Prefill('LICENSE_KEY', '');
  LicensePage.Values[2] := Prefill('LICENSE_CNPJ', '');
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if WizardSilent() then
    Exit;
  if CurPageID = DbPage.ID then
  begin
    if Trim(DbPage.Values[2]) = '' then
    begin
      Result := MsgBox('O caminho do banco esta em branco. O aplicativo nao vai conectar ate que a conexao seja configurada na tela Configuracoes locais.' + #13#10#13#10 +
        'Deseja continuar sem configurar o banco agora?', mbConfirmation, MB_YESNO) = IDYES;
      Exit;
    end;
    if Trim(DbPage.Values[0]) = '' then
    begin
      MsgBox('Informe o servidor do Firebird (por exemplo 127.0.0.1).', mbError, MB_OK);
      Result := False;
      Exit;
    end;
    if StrToIntDef(Trim(DbPage.Values[1]), -1) <= 0 then
    begin
      MsgBox('Informe uma porta valida (normalmente 3050).', mbError, MB_OK);
      Result := False;
      Exit;
    end;
  end;
end;

procedure AddUpdate(Updates: TStringList; const Key, NewValue: String);
var
  Value: String;
begin
  Value := Trim(NewValue);
  if EnvHasKey(Key) then
  begin
    { Reescreve apenas o que foi alterado no assistente; o restante do .env fica intacto. }
    if Value <> PrefillValue(Key) then
      Updates.Add(Key + '=' + Value);
  end
  else if Value <> '' then
    Updates.Add(Key + '=' + Value);
end;

procedure WriteWizardEnv();
var
  Updates: TStringList;
  Lines: TArrayOfString;
  I, ResultCode: Integer;
  UpdatesFile, ScriptPath, Params: String;
  Ok: Boolean;
begin
  Updates := TStringList.Create;
  try
    if Trim(DbPage.Values[2]) <> '' then
    begin
      AddUpdate(Updates, 'FB_HOST', DbPage.Values[0]);
      AddUpdate(Updates, 'FB_PORT', DbPage.Values[1]);
      AddUpdate(Updates, 'FB_DATABASE', DbPage.Values[2]);
      AddUpdate(Updates, 'FB_USER', DbPage.Values[3]);
      AddUpdate(Updates, 'FB_PASSWORD', DbPage.Values[4]);
      AddUpdate(Updates, 'FB_CHARSET', DbPage.Values[5]);
      AddUpdate(Updates, 'FBCLIENT_PATH', FbClientPage.Values[0]);
      if not EnvHasKey('FIREBIRD_ARCH') then
        Updates.Add('FIREBIRD_ARCH=AUTO');
      if not EnvHasKey('FIREBIRD_PROVIDER') then
        Updates.Add('FIREBIRD_PROVIDER=AUTO');
      if not EnvHasKey('FIREBIRD_CONNECTION_MODE') then
        Updates.Add('FIREBIRD_CONNECTION_MODE=AUTO');
    end;

    AddUpdate(Updates, 'LICENSE_API_URL', LicensePage.Values[0]);
    AddUpdate(Updates, 'LICENSE_KEY', LicensePage.Values[1]);
    AddUpdate(Updates, 'LICENSE_CNPJ', LicensePage.Values[2]);

    if Updates.Count = 0 then
      Exit;

    SetArrayLength(Lines, Updates.Count);
    for I := 0 to Updates.Count - 1 do
      Lines[I] := Updates[I];

    UpdatesFile := ExpandConstant('{tmp}\agenda-env-updates.txt');
    ScriptPath := ExpandConstant('{app}\installer\Write-AgendaEnv.ps1');
    Params :=
      '-NoProfile -ExecutionPolicy Bypass -File "' + ScriptPath + '"' +
      ' -EnvPath "' + EnvFilePath() + '"' +
      ' -UpdatesPath "' + UpdatesFile + '"';

    Ok := SaveStringsToUTF8File(UpdatesFile, Lines, False);
    if Ok then
      Ok := Exec('powershell.exe', Params, '', SW_HIDE, ewWaitUntilTerminated, ResultCode) and (ResultCode = 0);
    DeleteFile(UpdatesFile);

    if (not Ok) and (not WizardSilent()) then
      MsgBox('Nao foi possivel gravar a configuracao do banco e da licenca em:' + #13#10 + EnvFilePath() + #13#10#13#10 +
        'Abra o Agenda LMD e preencha a tela Configuracoes locais.', mbError, MB_OK);
  finally
    Updates.Free;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
    WriteWizardEnv();
end;

function TryBackupExistingInstall(): Boolean;
var
  ScriptPath, Params: String;
  ResultCode: Integer;
begin
  Result := True;
  ScriptPath := ExpandConstant('{app}\installer\Backup-AgendaLMD.ps1');
  if FileExists(ScriptPath) then
  begin
    Params :=
      '-ExecutionPolicy Bypass -File "' + ScriptPath + '"' +
      ' -InstallDir "' + ExpandConstant('{app}') + '"' +
      ' -DataDir "' + ExpandConstant('{commonappdata}\LMD Sistemas\Agenda LMD Preview') + '"' +
      ' -NewVersion "{#AppVersion}"';
    if not Exec('powershell.exe', Params, '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
    begin
      Result := False;
      Exit;
    end;
    if ResultCode <> 0 then
    begin
      Result := False;
      Exit;
    end;
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  if not TryBackupExistingInstall() then
    Result := 'Falha ao criar backup da versao anterior.';
end;
