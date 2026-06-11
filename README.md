# Agenda LMD

Agenda LMD e uma aplicacao Electron com frontend React/Vite e API local Python para leitura de agendamentos no Firebird do cliente.

## Arquitetura

```text
Agenda LMD
├─ frontend
│  ├─ React/Vite
│  └─ Electron
├─ api-python
│  ├─ FastAPI
│  ├─ FDB
│  ├─ Licenciamento
│  └─ Endpoints REST
└─ Firebird Cliente
```

O frontend continua consumindo os mesmos endpoints em `http://localhost:3001/api`.

## Endpoints

- `GET /api/health`
- `GET /api/agendamentos`
- `GET /api/agendamentos/{id}`
- `POST /api/licenses/activate`
- `POST /api/licenses/verify-token`
- `GET /api/licenses/{licenseKey}/status`
- `POST /api/licenses/{licenseId}/usage`

## Banco Firebird

A API Python le as variaveis abaixo:

```env
FB_HOST=127.0.0.1
FB_PORT=3050
FB_DATABASE=C:\caminho\para\DADOS.FDB
FB_USER=SYSDBA
FB_PASSWORD=masterkey
FBCLIENT_PATH=C:\Program Files\Firebird\Firebird_3_0\fbclient.dll
```

`FBCLIENT_PATH` e opcional e permite selecionar explicitamente o `fbclient.dll` adequado ao ambiente.

## Licenciamento

As variaveis permanecem compativeis:

```env
JWT_SECRET=
LICENSE_API_URL=https://lmdsistemasdev.qzz.io/api
LICENSE_API_KEY=
PROJECT_SLUG=agenda-lmd-preview
```

O cache local e gravado em `%APPDATA%\Agenda LMD`:

- `.license-cache.json`
- `.usage-cache.json`

## Desenvolvimento

```powershell
cd api-python
python -m pip install -r requirements.txt

cd ..\frontend
npm install
npm run dev:desktop
```

Em desenvolvimento, o Electron inicia `python -m uvicorn main:app --host 127.0.0.1 --port 3001`.

## Build

```powershell
cd api-python
.\build-api.ps1

cd ..\frontend
npm run build:desktop
```

O Vite gera o frontend em `frontend/dist-app`. O Electron empacota `api-python/dist/agenda-api/agenda-api.exe` em `resources/api/agenda-api.exe` e encerra o processo da API ao fechar o sistema.

## Uso em Rede Sem CMD

Para acessar pelo navegador em outras maquinas da rede, instale a API como tarefa de inicializacao do Windows no servidor do cliente:

```powershell
.\install-agenda-service.ps1 -InstallDir "C:\Caminho\Da\Pasta\Do\Agenda LMD"
```

Configure o `.env` com:

```env
HOST=0.0.0.0
PORT=3001
FRONTEND_DIST=C:\Caminho\Da\Pasta\Do\Agenda LMD\resources\frontend
```

Depois acesse:

```text
http://IP-DO-SERVIDOR:3001
```

Para remover da inicializacao:

```powershell
.\uninstall-agenda-service.ps1
```
