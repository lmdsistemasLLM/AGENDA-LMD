const { app, BrowserWindow, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');

process.on('uncaughtException', (error) => {
  console.error('Erro nao tratado no processo principal capturado:', error);
});

const isDev = process.env.NODE_ENV === 'development';

const envPath = isDev
  ? path.join(__dirname, '../../api-python/.env')
  : path.join(path.dirname(process.execPath), '.env');

if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
} else {
  require('dotenv').config();
}

let mainWindow;
let apiProcess;
let externalApiInUse = false;
let apiPort = parseInt(process.env.PORT, 10) || 3001;
const vitePort = parseInt(process.env.VITE_PORT, 10) || 5173;

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', () => resolve(false))
      .once('listening', () => {
        tester.once('close', () => resolve(true)).close();
      })
      .listen(port, '127.0.0.1');
  });
}

async function findAvailablePort(startPort) {
  const configuredPort = parseInt(process.env.PORT, 10);
  if (Number.isInteger(configuredPort) && configuredPort > 0) {
    if (await isPortAvailable(configuredPort)) {
      return configuredPort;
    }

    if (await isApiHealthy(configuredPort)) {
      externalApiInUse = true;
      return configuredPort;
    }

    console.warn(`Porta configurada ${configuredPort} esta em uso. Procurando outra porta livre...`);
  }

  for (let port = startPort; port <= startPort + 20; port += 1) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }

  throw new Error(`Nao foi encontrada porta livre entre ${startPort} e ${startPort + 20}.`);
}

async function isApiHealthy(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    return response.ok;
  } catch {
    return false;
  }
}

function getPythonApiCommand() {
  const apiEnv = {
    ...process.env,
    PORT: String(apiPort),
    HOST: process.env.HOST || '127.0.0.1',
  };

  if (!isDev) {
    const apiExePath = path.join(process.resourcesPath, 'api', 'agenda-api.exe');
    apiEnv.FRONTEND_DIST = process.env.FRONTEND_DIST || path.join(process.resourcesPath, 'frontend');
    return {
      command: apiExePath,
      args: [],
      cwd: path.dirname(apiExePath),
      env: apiEnv,
    };
  }

  const apiDir = path.join(__dirname, '../../api-python');
  return {
    command: process.env.PYTHON_EXE || 'python',
    args: ['-m', 'uvicorn', 'main:app', '--host', apiEnv.HOST, '--port', String(apiPort)],
    cwd: apiDir,
    env: apiEnv,
  };
}

function startApiServer() {
  try {
    if (externalApiInUse) {
      console.log(`API local ja esta rodando na porta ${apiPort}. Usando processo existente.`);
      return;
    }

    const apiCommand = getPythonApiCommand();

    if (!isDev && !fs.existsSync(apiCommand.command)) {
      throw new Error(`agenda-api.exe nao encontrado em: ${apiCommand.command}`);
    }

    apiProcess = spawn(apiCommand.command, apiCommand.args, {
      cwd: apiCommand.cwd,
      env: apiCommand.env,
      windowsHide: true,
      stdio: isDev ? 'inherit' : 'ignore',
    });

    apiProcess.on('error', (error) => {
      console.error('Falha ao iniciar a API Python:', error);
      dialog.showErrorBox(
        'Erro fatal ao iniciar API',
        `Ocorreu um erro ao carregar a API Python:\n\n${error.stack || error.message}`
      );
    });

    apiProcess.on('exit', (code, signal) => {
      console.log(`API Python encerrada. code=${code} signal=${signal}`);
      apiProcess = null;
    });
  } catch (err) {
    console.error('Falha ao iniciar a API Local Python:', err);

    dialog.showErrorBox(
      'Erro fatal ao iniciar API',
      `Ocorreu um erro ao carregar a API Python:\n\n${err.stack || err.message}`
    );
  }
}

async function findVitePort(startPort = 5173, timeout = 30000) {
  const startTime = Date.now();
  let port = startPort;
  while (Date.now() - startTime < timeout) {
    try {
      const response = await fetch(`http://localhost:${port}`);
      if (response.ok) {
        return port;
      }
    } catch {
      // Port not ready yet
    }
    port += 1;
    if (port > 5200) port = 5173;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return 5173;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1300,
    height: 850,
    minWidth: 1000,
    minHeight: 700,
    title: 'Agenda LMD - Modulo Preview',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  if (isDev) {
    findVitePort().then(port => {
      mainWindow.loadURL(`http://localhost:${port}?apiPort=${apiPort}`);
      mainWindow.webContents.openDevTools();
    }).catch(err => {
      console.error('Falha ao descobrir porta Vite:', err);
      mainWindow.loadURL(`http://localhost:${vitePort}?apiPort=${apiPort}`);
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist-app/index.html'), {
      query: {
        apiPort: String(apiPort),
      },
    });
  }
}

if (gotSingleInstanceLock) {
  app.whenReady().then(async () => {
    try {
      apiPort = await findAvailablePort(apiPort);
    } catch (error) {
      console.error('Nao foi possivel reservar uma porta para a API:', error);
      dialog.showErrorBox(
        'Porta indisponivel',
        `Nao foi encontrada uma porta livre para iniciar a API local.\n\n${error.message}`
      );
      app.quit();
      return;
    }

    startApiServer();
    createWindow();
  });
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  if (apiProcess && !apiProcess.killed) {
    apiProcess.kill();
    apiProcess = null;
  }
});
