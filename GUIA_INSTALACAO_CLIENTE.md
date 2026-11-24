# AGENDA LMD PREVIEW - GUIA DE INSTALACAO

## Pre-requisitos

- Windows 10 ou superior
- Firebird acessivel no ambiente do cliente
- `fbclient.dll` compativel com a arquitetura do backend utilizado
- Permissao para instalar o aplicativo e gravar configuracoes em `%ProgramData%`

## Fluxo recomendado

1. Execute o instalador do Agenda LMD Preview.
2. Nas telas do assistente, informe:
   - **Banco de dados Firebird:** servidor, porta, caminho completo do `.FDB`, usuario, senha e charset.
   - **Cliente Firebird:** a `fbclient.dll` (o instalador tenta detectar automaticamente).
   - **Licenca:** endereco da API, chave e CNPJ do cliente.
3. O instalador grava esses dados em `%ProgramData%\LMD Sistemas\Agenda LMD Preview\.env`.
   Em uma atualizacao, os valores atuais aparecem preenchidos e so o que for alterado e regravado.
4. Abra o aplicativo. Se algum dado ficou em branco ou precisar de ajuste, use a tela **Configuracoes locais**
   e a tela de diagnostico para validar a `fbclient.dll`.
5. Ao salvar, o backend sera reiniciado automaticamente e a interface seguira para a tela principal.

## Variaveis principais do `.env`

```env
HOST=127.0.0.1
PORT=3001
FRONTEND_DIST=

FB_HOST=127.0.0.1
FB_PORT=3050
FB_DATABASE=C:\CAMINHO\BANCO.FDB
FB_USER=SYSDBA
FB_PASSWORD=CHANGE_ME
FB_CHARSET=UTF8
FBCLIENT_PATH=C:\CAMINHO\FIREBIRD\fbclient.dll
FIREBIRD_ARCH=AUTO
FIREBIRD_PROVIDER=AUTO
FIREBIRD_CONNECTION_MODE=AUTO
```

## Valores aceitos

`FIREBIRD_ARCH`:

- `AUTO`
- `X86`
- `X64`

`FIREBIRD_PROVIDER`:

- `AUTO`
- `FDB`
- `FIREBIRD_DRIVER`

## Diagnostico

O aplicativo e a API retornam informacoes como:

- arquitetura do sistema operacional e do processo;
- runtime do Python em uso;
- provider solicitado e provider selecionado;
- caminho, arquitetura e versao da `fbclient.dll`;
- host, porta, banco, charset e modo de conexao;
- ultimo erro conhecido de conexao.

Senhas nao sao exibidas no painel nem nos logs.

## Uso em rede

Se a API precisar iniciar com o Windows em um servidor interno:

```powershell
.\install-agenda-service.ps1 -InstallDir "C:\CAMINHO\INSTALACAO\Agenda LMD Preview"
```

Exemplo de parametros de rede:

```env
HOST=0.0.0.0
PORT=3001
FRONTEND_DIST=C:\CAMINHO\INSTALACAO\Agenda LMD Preview\resources\frontend
```

Depois acesse:

```text
http://IP-DO-SERVIDOR:3001
```

## Atualizacao e rollback

- Atualizacoes podem gerar backup da versao anterior em `%ProgramData%\LMD Sistemas\Agenda LMD Preview\rollback`
- A configuracao do backend permanece fora da pasta do aplicativo
- O rollback pode ser executado com:

```powershell
.\installer\Rollback-AgendaLMD.ps1 -InstallDir "C:\CAMINHO\INSTALACAO\Agenda LMD Preview" -DataDir "$env:ProgramData\LMD Sistemas\Agenda LMD Preview"
```

## Logs

Os logs do instalador e dos utilitarios ficam em:

```text
%ProgramData%\LMD Sistemas\Agenda LMD Preview\logs\installer
```

## Suporte

- Empresa: LMD Sistemas
- Produto: Agenda LMD Preview
- Versao: 1.1.1
