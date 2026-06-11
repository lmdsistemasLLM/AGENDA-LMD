# ENTREGA - Agenda LMD

## Arquitetura Atual

| Componente | Status | Observacao |
| --- | --- | --- |
| Frontend React/Vite | Pronto | Mantido sem alteracao de endpoints |
| Electron | Pronto | Inicia e encerra a API Python local |
| API Local Python | Pronto | FastAPI + FDB na porta 3001 |
| Acesso em rede | Pronto | API pode servir o frontend em `http://IP:3001` |
| Licenciamento | Pronto | Mantem `https://lmdsistemasdev.qzz.io/api` |
| Firebird | Pronto | Configurado por `.env` e `FBCLIENT_PATH` opcional |

## Estrutura

```text
api-python/
  main.py
  database.py
  license_service.py
  middleware.py
  routes/
  requirements.txt
  build-api.ps1

frontend/
  src/
  electron/main.cjs
```

## Build

```powershell
cd api-python
.\build-api.ps1

cd ..\frontend
npm run build:desktop
```

O pacote Electron deve incluir `api-python/dist/agenda-api/agenda-api.exe` como `resources/api/agenda-api.exe`.

## Modo Servidor do Cliente

Para nao depender de CMD nem do Electron aberto, instale a API como tarefa de inicializacao:

```powershell
.\install-agenda-service.ps1 -InstallDir "C:\Caminho\Da\Pasta\Do\Agenda LMD"
```

O acesso pela rede fica em:

```text
http://IP-DO-SERVIDOR:3001
```

## Configuracao

Use `.env` ao lado do executavel:

```env
FB_HOST=127.0.0.1
FB_PORT=3050
FB_DATABASE=C:\caminho\DADOS.FDB
FB_USER=SYSDBA
FB_PASSWORD=masterkey
FBCLIENT_PATH=C:\Program Files\Firebird\Firebird_3_0\fbclient.dll

JWT_SECRET=
LICENSE_API_URL=https://lmdsistemasdev.qzz.io/api
LICENSE_API_KEY=
PROJECT_SLUG=agenda-lmd-preview
LICENSE_KEY=1187a6ea-a59b-495f-b8ce-a1ee6a3dc5f5
LICENSE_CNPJ=47645430000124
LICENSE_PROJECT_SLUG=agenda-lmd-preview
APP_LOGIN_USER=admin
APP_LOGIN_PASSWORD=admin
```

## Cache

Arquivos gravados em `%APPDATA%\Agenda LMD`:

- `.license-cache.json`
- `.usage-cache.json`
