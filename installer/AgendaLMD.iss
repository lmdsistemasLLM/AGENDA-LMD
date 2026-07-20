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
