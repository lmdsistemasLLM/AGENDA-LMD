# AGENDA LMD - GUIA DE INSTALACAO (Cliente)

## Pre-requisitos
- Windows 10 ou superior.
- Firebird instalado no ambiente do cliente.
- O usuario final nao precisa instalar Node.js nem Python.

## Instalacao Rapida

1. Execute `Agenda LMD.exe`.
2. Mantenha o arquivo `.env` na mesma pasta do executavel.
3. A API local `agenda-api.exe` sera iniciada automaticamente pelo Electron na porta `3001`.

## Acesso pela Rede sem CMD

No servidor do cliente, instale a API para iniciar com o Windows:

```powershell
.\install-agenda-service.ps1 -InstallDir "C:\Caminho\Da\Pasta\Do\Agenda LMD"
```

No `.env`, use:

```env
HOST=0.0.0.0
PORT=3001
FRONTEND_DIST=C:\Caminho\Da\Pasta\Do\Agenda LMD\resources\frontend
```

Depois acesse em qualquer computador da rede:

```text
http://IP-DO-SERVIDOR:3001
```

## Configuracao do Banco

Configure o arquivo `.env`:

```env
FB_HOST=127.0.0.1
FB_PORT=3050
FB_DATABASE=C:\caminho\para\DADOS.FDB
FB_USER=SYSDBA
FB_PASSWORD=masterkey
FBCLIENT_PATH=C:\Program Files\Firebird\Firebird_3_0\fbclient.dll
HOST=0.0.0.0
PORT=3001
FRONTEND_DIST=C:\Caminho\Da\Pasta\Do\Agenda LMD\resources\frontend
```

`FBCLIENT_PATH` e opcional, mas recomendado quando o cliente possui mais de uma versao do Firebird instalada.

## Licenciamento

As variaveis abaixo permanecem no `.env`:

```env
JWT_SECRET=
LICENSE_API_URL=https://lmdsistemasdev.qzz.io/api
LICENSE_API_KEY=
PROJECT_SLUG=agenda-lmd-preview
```

O cache local fica em `%APPDATA%\Agenda LMD`:

- `.license-cache.json`
- `.usage-cache.json`

## Troubleshooting

### Porta 3001 em uso
Feche outra instancia do Agenda LMD ou finalize o processo `agenda-api.exe`.

### App nao conecta com a API
Verifique se `agenda-api.exe` existe em `resources\api\agenda-api.exe` no pacote gerado.

### Erro de conexao Firebird
Confirme `FB_HOST`, `FB_PORT`, `FB_DATABASE`, usuario/senha e, se necessario, a versao correta do `fbclient.dll`.

## Suporte
- Email: contato@lmd.com.br
- Telefone: (xx) xxxx-xxxx

---
**Versao**: 1.0.0  
**Data**: 2026-05-29
