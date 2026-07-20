# Agenda LMD Preview

Aplicacao desktop da **LMD Sistemas** para consulta e acompanhamento de agendamentos, com interface **Electron + React/Vite** e backend local **FastAPI/Python** com suporte a Firebird `x86` e `x64`.

**Versao atual:** `1.1.1`

## Visao geral

O projeto empacota uma interface desktop em Electron que gerencia automaticamente uma API local em Python. Essa API concentra:

- leitura da configuracao local;
- diagnostico de ambiente Firebird;
- selecao e validacao de `fbclient.dll`;
- endpoints REST para a interface;
- fluxo de licenciamento e cache local.

No modo instalado, o aplicativo usa `%ProgramData%\LMD Sistemas\Agenda LMD Preview` para armazenar configuracoes, cache, logs e backups.

## Arquitetura

```text
Agenda LMD Preview
|- assets/                 # identidade visual oficial
|- frontend/               # React + Vite + Electron
|  |- electron/
|  |- public/
|  `- src/
|- api-python/             # FastAPI, Firebird, licenciamento
|  `- routes/
|- installer/              # Inno Setup e scripts de empacotamento
`- dist/                   # artefatos gerados (ignorado no Git)
```

### Componentes principais

- **Frontend:** React 19 + Vite
- **Desktop shell:** Electron
- **Backend local:** FastAPI + Uvicorn
- **Acesso Firebird:** `fdb` e `firebird-driver`
- **Empacotamento:** `electron-builder` e Inno Setup

## Requisitos de desenvolvimento

- Windows 10 ou superior
- Node.js 20+ com `npm`
- Python 3.11+ para desenvolvimento local
- Python `x86` e `x64` quando for necessario gerar ambos os executaveis do backend
- Inno Setup 6 para gerar o instalador final

## Configuracao de ambiente

Use o arquivo `.env.example` como base. Um espelho tambem existe em `api-python/.env.example`.

Exemplo resumido:

```env
HOST=127.0.0.1
PORT=3001

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

JWT_SECRET=CHANGE_ME_WITH_A_LONG_RANDOM_SECRET
LICENSE_API_URL=
PROJECT_SLUG=agenda-lmd-preview
LICENSE_PROJECT_SLUG=agenda-lmd-preview
LICENSE_KEY=
LICENSE_CNPJ=
APP_LOGIN_USER=admin
APP_LOGIN_PASSWORD=CHANGE_ME
```

## Identidade visual

Os arquivos oficiais da marca ficam em:

- `assets/icon.ico`
- `assets/logo.png`

O comando `npm run sync:branding` sincroniza os recursos derivados usados pelo frontend e pelo instalador.

## Comandos principais

### Instalar dependencias do frontend

```powershell
cd frontend
npm install
```

### Instalar dependencias do backend

```powershell
cd api-python
python -m pip install -r requirements.txt
```

### Executar em desenvolvimento

```powershell
cd frontend
npm run dev:desktop
```

### Gerar build web do frontend

```powershell
cd frontend
npm run build
```

### Validar lint e sintaxe do Electron

```powershell
cd frontend
npx eslint src electron
node --check electron/main.cjs
```

### Compilar os backends `x86` e `x64`

Build individual:

```powershell
cd api-python
.\build-api.ps1
```

Pipeline completo do instalador, incluindo backend dual:

```powershell
cd installer
.\Build-Installer.ps1 -AppVersion 1.1.1
```

### Gerar pasta desktop `win-unpacked`

```powershell
cd frontend
npm run build:desktop:dir
```

### Gerar o instalador

```powershell
cd installer
.\Build-Installer.ps1 -AppVersion 1.1.1
```

## Instalacao basica

1. Gere ou obtenha o instalador final da versao desejada.
2. Execute o instalador no Windows.
3. Abra o **Agenda LMD Preview**.
4. Na primeira execucao, preencha a configuracao do Firebird.
5. Salve e teste a conexao pela propria interface.
6. Ajuste licenca e credenciais locais quando necessario.

## Observacoes importantes

- DLLs do Firebird, bancos `.fdb`, credenciais reais, `.env`, logs e executaveis compilados **nao sao versionados**.
- A pasta `dist/` contem apenas artefatos gerados e permanece fora do Git.
- A configuracao de licenciamento deve ser definida por ambiente; o repositorio nao publica endpoint padrao nem chaves reais.
- Os scripts em `installer/` e os utilitarios raiz foram mantidos para build e distribuicao, sem incluir saidas compiladas.
