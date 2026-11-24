const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { spawn } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const net = require('net');

const APP_VENDOR = 'LMD Sistemas';
const APP_PRODUCT = 'Agenda LMD Preview';
const ENV_FILENAME = '.env';
const RUNTIME_CONFIG_FILENAME = 'firebird-runtime.json';
const API_HEALTH_TIMEOUT_MS = 30000;
const API_HEALTH_POLL_MS = 500;
const MAX_API_LOG_LINES = 40;
const DEFAULT_LICENSE_API_URL = '';
const DEFAULT_PROJECT_SLUG = 'agenda-lmd-preview';
const APP_USER_MODEL_ID = 'com.agendalmd.preview';

process.on('uncaughtException', (error) => {
  console.error('Erro nao tratado no processo principal capturado:', error);
});

const isDev = process.env.NODE_ENV === 'development';

let mainWindow;
let apiProcess;
let apiPort = 3101;
let externalApiInUse = false;
let isRestartingApi = false;
let apiRestartTimer = null;
let configWatcher;
let isQuitting = false;
let isFinalizingQuit = false;
let apiStopInProgress = false;
let apiLogBuffer = [];
let apiLastExit = null;
let lastApiSelection = null;
let quitPromise = null;
let startupState = {
  status: 'idle',
  code: null,
  message: null,
  details: null,
  apiPort,
  externalApiInUse: false,
  logLines: [],
  updatedAt: null,
};

const vitePort = parseInt(process.env.VITE_PORT || '5173', 10) || 5173;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getAppIconPath() {
  const candidate = isDev
    ? path.resolve(path.join(__dirname, '../../assets/icon.ico'))
    : path.join(process.resourcesPath, 'branding', 'icon.ico');

  return fs.existsSync(candidate) ? candidate : undefined;
}

function serializeError(error) {
  if (!error) return null;
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
}

function updateStartupState(partial) {
  startupState = {
    ...startupState,
    ...partial,
    apiPort,
    externalApiInUse,
    logLines: [...apiLogBuffer],
    updatedAt: new Date().toISOString(),
  };
  return startupState;
}

function updateStartupFailure(code, message, details = null) {
  return updateStartupState({
    status: 'error',
    code,
    message,
    details,
  });
}

function pushApiLog(stream, chunk) {
  const message = String(chunk || '').trim();
  if (!message) return;

  const lines = message.split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    apiLogBuffer.push(`[${stream}] ${line}`);
  }

  if (apiLogBuffer.length > MAX_API_LOG_LINES) {
    apiLogBuffer = apiLogBuffer.slice(-MAX_API_LOG_LINES);
  }
}

function normalizeArch(value) {
  const text = String(value || '').trim().toLowerCase();
  if (['x64', 'amd64', '64'].includes(text)) return 'X64';
  if (['ia32', 'x86', '32'].includes(text)) return 'X86';
  return 'AUTO';
}

function normalizeDllPath(value) {
  if (!value) return null;

  const candidate = path.resolve(String(value).trim().replace(/^["']|["']$/g, ''));
  if (!fs.existsSync(candidate)) return candidate;

  if (fs.statSync(candidate).isDirectory()) {
    return path.join(candidate, 'fbclient.dll');
  }

  return candidate;
}

function readPeArchitecture(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    if (buffer.length < 64 || buffer.toString('ascii', 0, 2) !== 'MZ') return null;
    const peOffset = buffer.readUInt32LE(0x3c);
    if (buffer.toString('ascii', peOffset, peOffset + 4) !== 'PE\u0000\u0000') return null;

    const machine = buffer.readUInt16LE(peOffset + 4);
    if (machine === 0x14c) return 'X86';
    if (machine === 0x8664) return 'X64';
    return null;
  } catch {
    return null;
  }
}

function getDataDir() {
  const explicit = process.env.AGENDA_DATA_DIR;
  if (explicit) return path.resolve(explicit);

  if (isDev) {
    return path.resolve(path.join(__dirname, '../../api-python'));
  }

  const programData = process.env.PROGRAMDATA || path.join(process.env.SystemDrive || 'C:', 'ProgramData');
  return path.join(programData, APP_VENDOR, APP_PRODUCT);
}

function ensureDataDir() {
  const target = getDataDir();
  fs.mkdirSync(target, { recursive: true });
  return target;
}

function getEnvPath() {
  if (isDev) {
    return path.resolve(path.join(__dirname, '../../api-python/.env'));
  }

  return path.join(ensureDataDir(), ENV_FILENAME);
}

function getRuntimeConfigPath() {
  return path.join(ensureDataDir(), RUNTIME_CONFIG_FILENAME);
}

function readEnvFileValues(filePath) {
  const values = {};
  if (!filePath || !fs.existsSync(filePath)) return values;

  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#') || !rawLine.includes('=')) continue;

    const [key, ...rest] = rawLine.split('=');
    values[key.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
  }

  return values;
}

function writeEnvFileValues(filePath, updates) {
  const lines = fs.existsSync(filePath)
    ? fs.readFileSync(filePath, 'utf8').split(/\r?\n/)
    : [];
  const positions = new Map();

  lines.forEach((rawLine, index) => {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#') || !rawLine.includes('=')) return;
    const [key] = rawLine.split('=');
    positions.set(key.trim(), index);
  });

  const nextLines = [...lines];
  for (const [key, rawValue] of Object.entries(updates)) {
    const rendered = `${key}=${String(rawValue ?? '').replace(/\r?\n/g, ' ').trim()}`;
    if (positions.has(key)) {
      nextLines[positions.get(key)] = rendered;
    } else {
      nextLines.push(rendered);
    }
  }

  const content = `${nextLines.join('\n').replace(/\n+$/g, '')}\n`;
  fs.writeFileSync(filePath, content, 'utf8');
}

function ensureBootstrapEnv() {
  const envPath = getEnvPath();
  const current = readEnvFileValues(envPath);
  const defaults = {
    HOST: current.HOST || process.env.HOST || '127.0.0.1',
    PORT: current.PORT || process.env.PORT || '3101',
    JWT_SECRET: current.JWT_SECRET || crypto.randomBytes(48).toString('hex'),
    LICENSE_API_URL: current.LICENSE_API_URL || DEFAULT_LICENSE_API_URL,
    PROJECT_SLUG: current.PROJECT_SLUG || DEFAULT_PROJECT_SLUG,
    LICENSE_PROJECT_SLUG: current.LICENSE_PROJECT_SLUG || current.PROJECT_SLUG || DEFAULT_PROJECT_SLUG,
    APP_LOGIN_USER: current.APP_LOGIN_USER || 'admin',
    APP_LOGIN_PASSWORD: current.APP_LOGIN_PASSWORD || 'admin',
  };

  if (!isDev) {
    ensureDataDir();
    writeEnvFileValues(envPath, defaults);
    return;
  }

  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = defaults.JWT_SECRET;
  }
}

function readSavedFirebirdSettings() {
  try {
    const runtimeConfigPath = getRuntimeConfigPath();
    if (!fs.existsSync(runtimeConfigPath)) return {};

    const payload = JSON.parse(fs.readFileSync(runtimeConfigPath, 'utf8'));
    return payload.firebird && typeof payload.firebird === 'object' ? payload.firebird : {};
  } catch {
    return {};
  }
}

function loadInitialEnvironment() {
  ensureBootstrapEnv();
  const envPath = getEnvPath();

  if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
    return;
  }

  require('dotenv').config();
}

function readLauncherSettings() {
  const envValues = readEnvFileValues(getEnvPath());
  const saved = readSavedFirebirdSettings();

  return {
    host: envValues.HOST || process.env.HOST || '127.0.0.1',
    port: parseInt(envValues.PORT || process.env.PORT || '3101', 10) || 3101,
    requestedArch: normalizeArch(
      envValues.FIREBIRD_ARCH ||
      envValues.FB_ARCH ||
      process.env.FIREBIRD_ARCH ||
      process.env.FB_ARCH ||
      saved.arch ||
      'AUTO'
    ),
    clientPath: normalizeDllPath(
      envValues.FIREBIRD_CLIENT_PATH ||
      envValues.FBCLIENT_PATH ||
      envValues.FB_CLIENT_LIBRARY ||
      process.env.FIREBIRD_CLIENT_PATH ||
      process.env.FBCLIENT_PATH ||
      process.env.FB_CLIENT_LIBRARY ||
      null
    ),
    savedClientPath: normalizeDllPath(saved.client_path),
    provider: String(
      envValues.FIREBIRD_PROVIDER ||
      envValues.FB_PROVIDER ||
      envValues.FIREBIRD_DRIVER ||
      process.env.FIREBIRD_PROVIDER ||
      process.env.FB_PROVIDER ||
      process.env.FIREBIRD_DRIVER ||
      saved.provider ||
      'AUTO'
    ).trim().toUpperCase(),
  };
}

function collectFbclientDlls(root, maxDepth, depth = 0, results = []) {
  if (!fs.existsSync(root) || depth > maxDepth) return results;

  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === 'fbclient.dll') {
      results.push(fullPath);
      continue;
    }

    if (entry.isDirectory()) {
      collectFbclientDlls(fullPath, maxDepth, depth + 1, results);
    }
  }

  return results;
}

function buildCandidate(source, candidatePath, requestedArch) {
  const exists = fs.existsSync(candidatePath);
  const architecture = exists ? readPeArchitecture(candidatePath) : null;
  let rejectionReason = null;
  let status = 'invalid';

  if (!exists) {
    rejectionReason = 'Arquivo nao encontrado.';
  } else if (!architecture) {
    rejectionReason = 'Arquitetura PE nao reconhecida.';
  } else if (requestedArch !== 'AUTO' && architecture !== requestedArch) {
    rejectionReason = `A DLL possui arquitetura ${architecture}, mas a configuracao exige ${requestedArch}.`;
  } else {
    status = 'valid';
  }

  return {
    source,
    path: candidatePath,
    exists,
    architecture,
    status,
    rejectionReason,
  };
}

function orderedAutoCandidates(discovered, requestedArch) {
  const preferredArchs = requestedArch === 'AUTO' ? ['X64', 'X86'] : [requestedArch];
  const grouped = [];

  for (const arch of preferredArchs) {
    for (const candidate of discovered) {
      if (candidate.architecture === arch) {
        grouped.push(candidate);
      }
    }
  }

  for (const candidate of discovered) {
    if (!grouped.includes(candidate)) {
      grouped.push(candidate);
    }
  }

  return grouped;
}

function searchFirebirdClientCandidates() {
  const settings = readLauncherSettings();
  const requestedArch = settings.requestedArch;
  const seen = new Set();
  const candidates = [];

  function pushCandidate(source, rawPath) {
    const normalized = normalizeDllPath(rawPath);
    if (!normalized) return;

    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(buildCandidate(source, normalized, requestedArch));
  }

  pushCandidate('manual', settings.clientPath);
  pushCandidate('saved', settings.savedClientPath);

  const searchRoots = [
    'C:\\Program Files\\Firebird',
    'C:\\Program Files (x86)\\Firebird',
    'C:\\Firebird',
    'C:\\DataGoo',
    'C:\\LMD',
  ];

  const autoDiscovered = [];
  for (const root of searchRoots) {
    if (!fs.existsSync(root)) continue;
    for (const match of collectFbclientDlls(root, 4)) {
      const key = normalizeDllPath(match)?.toLowerCase();
      if (!key || seen.has(key)) continue;

      seen.add(key);
      autoDiscovered.push(buildCandidate('auto', match, requestedArch));
    }
  }

  candidates.push(...orderedAutoCandidates(autoDiscovered, requestedArch));

  const selected = candidates.find((candidate) => candidate.status === 'valid') || null;
  return {
    requestedArch,
    settings,
    candidates,
    selected,
  };
}

function getPackagedBackendAvailability() {
  const legacyPath = path.join(process.resourcesPath, 'api', 'agenda-api.exe');
  const x86Path = path.join(process.resourcesPath, 'api', 'x86', 'agenda-api-x86.exe');
  const x64Path = path.join(process.resourcesPath, 'api', 'x64', 'agenda-api-x64.exe');

  return {
    legacy: fs.existsSync(legacyPath) ? legacyPath : null,
    X86: fs.existsSync(x86Path) ? x86Path : null,
    X64: fs.existsSync(x64Path) ? x64Path : null,
  };
}

function validatedSelectionReason(candidate, requestedArch) {
  const arch = (candidate.architecture || 'AUTO').toLowerCase();
  if (candidate.source === 'manual') {
    return `DLL configurada possui arquitetura ${arch}.`;
  }
  if (candidate.source === 'saved') {
    return `Selecao salva aponta para DLL ${arch} valida.`;
  }
  if (requestedArch === 'AUTO') {
    return `Modo AUTO e DLL ${arch} encontrada em busca automatica.`;
  }
  return `Arquitetura ${arch} solicitada e DLL compativel encontrada.`;
}

function diagnosticSelectionReason(clientSearch, backendArch) {
  const firstRejected = clientSearch.candidates.find((candidate) => candidate.status !== 'valid');
  if (firstRejected?.rejectionReason) {
    return `${firstRejected.rejectionReason} API ${backendArch.toLowerCase()} iniciada apenas para diagnostico.`;
  }

  if (clientSearch.requestedArch !== 'AUTO') {
    return `Arquitetura ${clientSearch.requestedArch.toLowerCase()} solicitada sem DLL valida no momento. API ${backendArch.toLowerCase()} iniciada para diagnostico.`;
  }

  return `Nenhuma DLL compativel foi localizada. API ${backendArch.toLowerCase()} iniciada para diagnostico.`;
}

function getPackagedApiSelection() {
  const availability = getPackagedBackendAvailability();
  const clientSearch = searchFirebirdClientCandidates();
  const requestedArch = clientSearch.requestedArch;

  if (clientSearch.selected?.architecture && availability[clientSearch.selected.architecture]) {
    const apiArch = clientSearch.selected.architecture;
    return {
      apiExePath: availability[apiArch],
      apiArch,
      client: clientSearch.selected,
      mode: 'validated',
      reason: validatedSelectionReason(clientSearch.selected, requestedArch),
      clientSearch,
    };
  }

  if (requestedArch !== 'AUTO' && availability[requestedArch]) {
    return {
      apiExePath: availability[requestedArch],
      apiArch: requestedArch,
      client: clientSearch.selected,
      mode: 'diagnostic',
      reason: diagnosticSelectionReason(clientSearch, requestedArch),
      clientSearch,
    };
  }

  if (availability.X64) {
    return {
      apiExePath: availability.X64,
      apiArch: 'X64',
      client: clientSearch.selected,
      mode: 'diagnostic',
      reason: diagnosticSelectionReason(clientSearch, 'X64'),
      clientSearch,
    };
  }

  if (availability.X86) {
    return {
      apiExePath: availability.X86,
      apiArch: 'X86',
      client: clientSearch.selected,
      mode: 'diagnostic',
      reason: diagnosticSelectionReason(clientSearch, 'X86'),
      clientSearch,
    };
  }

  if (availability.legacy) {
    return {
      apiExePath: availability.legacy,
      apiArch: null,
      client: clientSearch.selected,
      mode: 'legacy',
      reason: 'Pacote legado detectado com backend unico.',
      clientSearch,
    };
  }

  return {
    apiExePath: null,
    apiArch: null,
    client: clientSearch.selected,
    mode: 'missing',
    reason: 'Nenhum backend Python empacotado foi encontrado.',
    clientSearch,
  };
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

const API_SERVICE_ID = 'agenda-lmd-api';

// Confirma que quem responde na porta e a API do Agenda, e nao outro sistema
// do cliente que tambem exponha /api/health (ex.: o backend do Delivery na porta 3001).
async function isApiHealthy(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    if (!response.ok) return false;
    const payload = await response.json().catch(() => null);
    return Boolean(payload && payload.service === API_SERVICE_ID);
  } catch {
    return false;
  }
}

async function findAvailablePort(startPort) {
  const configuredPort = readLauncherSettings().port || startPort;
  if (await isPortAvailable(configuredPort)) {
    return { port: configuredPort, external: false };
  }

  if (await isApiHealthy(configuredPort)) {
    return { port: configuredPort, external: true };
  }

  console.warn(`Porta configurada ${configuredPort} esta em uso. Procurando outra porta livre...`);

  for (let port = startPort; port <= startPort + 20; port += 1) {
    if (await isPortAvailable(port)) {
      return { port, external: false };
    }
  }

  throw new Error(`Nao foi encontrada porta livre entre ${startPort} e ${startPort + 20}.`);
}

function getPythonApiCommand() {
  const settings = readLauncherSettings();
  const envPath = getEnvPath();
  const envValues = readEnvFileValues(envPath);
  const apiEnv = {
    ...process.env,
    ...envValues,
    PORT: String(apiPort),
    HOST: settings.host || '127.0.0.1',
    JWT_SECRET: envValues.JWT_SECRET || process.env.JWT_SECRET || crypto.randomBytes(48).toString('hex'),
    AGENDA_DATA_DIR: getDataDir(),
    AGENDA_ENV_PATH: envPath,
    AGENDA_INSTALLED_MODE: isDev ? '0' : '1',
  };

  if (!isDev) {
    const apiSelection = getPackagedApiSelection();
    lastApiSelection = apiSelection;
    if (!apiSelection.apiExePath) {
      throw new Error(apiSelection.reason);
    }

    apiEnv.FRONTEND_DIST = process.env.FRONTEND_DIST || path.join(process.resourcesPath, 'frontend');
    if (apiSelection.client?.path) {
      apiEnv.FIREBIRD_SELECTED_CLIENT_PATH = apiSelection.client.path;
    } else {
      delete apiEnv.FIREBIRD_SELECTED_CLIENT_PATH;
    }

    if (apiSelection.apiArch) {
      apiEnv.AGENDA_SELECTED_BACKEND_ARCH = apiSelection.apiArch;
    }

    console.log(`Backend selecionado: ${apiSelection.apiArch ? apiSelection.apiArch.toLowerCase() : 'legacy'}`);
    console.log(`Motivo: ${apiSelection.reason}`);

    return {
      command: apiSelection.apiExePath,
      args: [],
      cwd: path.dirname(apiSelection.apiExePath),
      env: apiEnv,
    };
  }

  lastApiSelection = { mode: 'development', reason: 'Backend Python em modo de desenvolvimento.' };
  const apiDir = path.join(__dirname, '../../api-python');
  return {
    command: process.env.PYTHON_EXE || 'python',
    args: ['-m', 'uvicorn', 'main:app', '--host', apiEnv.HOST, '--port', String(apiPort)],
    cwd: apiDir,
    env: apiEnv,
  };
}

async function terminateProcessTree(pid) {
  if (!pid) return;

  await new Promise((resolve) => {
    const killer = spawn('taskkill', ['/pid', String(pid), '/t', '/f'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    killer.once('exit', () => resolve());
    killer.once('error', () => resolve());
  });
}

async function stopApiServer() {
  if (!apiProcess) return;

  const child = apiProcess;
  apiStopInProgress = true;
  apiProcess = null;

  await new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      resolve();
    };

    child.once('exit', finish);

    try {
      child.kill();
    } catch {
      finish();
      return;
    }

    setTimeout(() => {
      if (child.exitCode === null) {
        void terminateProcessTree(child.pid).finally(finish);
        return;
      }

      finish();
    }, 2500);

    setTimeout(finish, 8000);
  });

  apiStopInProgress = false;
}

function attachApiOutput(child) {
  if (!child || isDev) return;

  child.stdout?.on('data', (chunk) => {
    pushApiLog('stdout', chunk);
    const message = String(chunk).trim();
    if (message) {
      console.log(`[api] ${message}`);
    }
  });

  child.stderr?.on('data', (chunk) => {
    pushApiLog('stderr', chunk);
    const message = String(chunk).trim();
    if (message) {
      console.error(`[api] ${message}`);
    }
  });
}

function startApiServer() {
  if (externalApiInUse) {
    console.log(`API local ja esta rodando na porta ${apiPort}. Usando processo existente.`);
    return updateStartupState({
      status: 'ready',
      code: null,
      message: `API local existente encontrada na porta ${apiPort}.`,
      details: {
        mode: 'external',
        apiSelection: lastApiSelection,
      },
    });
  }

  if (apiProcess) {
    console.log('Uma instancia da API ja esta em execucao. Nenhum novo processo sera iniciado.');
    return startupState;
  }

  const apiCommand = getPythonApiCommand();

  if (!isDev && !fs.existsSync(apiCommand.command)) {
    throw new Error(`Executavel da API nao encontrado em: ${apiCommand.command}`);
  }

  apiLastExit = null;
  updateStartupState({
    status: 'starting',
    code: null,
    message: 'Iniciando API local...',
    details: {
      command: apiCommand.command,
      cwd: apiCommand.cwd,
      apiSelection: lastApiSelection,
    },
  });

  const stdio = isDev ? 'inherit' : ['ignore', 'pipe', 'pipe'];
  apiProcess = spawn(apiCommand.command, apiCommand.args, {
    cwd: apiCommand.cwd,
    env: apiCommand.env,
    detached: !isDev,
    windowsHide: true,
    stdio,
  });

  attachApiOutput(apiProcess);

  apiProcess.on('error', (error) => {
    console.error('Falha ao iniciar a API Python:', error);
    updateStartupFailure(
      'BACKEND_SPAWN_ERROR',
      'Nao foi possivel iniciar a API local.',
      serializeError(error)
    );
  });

  apiProcess.on('exit', (code, signal) => {
    apiLastExit = {
      code,
      signal,
      happenedAt: new Date().toISOString(),
    };
    console.log(`API Python encerrada. code=${code} signal=${signal}`);
    apiProcess = null;

    if (apiStopInProgress || isQuitting || externalApiInUse) {
      return;
    }

    updateStartupFailure(
      'BACKEND_EXITED',
      'A API local foi encerrada antes de responder.',
      {
        ...apiLastExit,
        apiSelection: lastApiSelection,
      }
    );
  });

  return startupState;
}

async function waitForApiHealth(timeoutMs = API_HEALTH_TIMEOUT_MS) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await isApiHealthy(apiPort)) {
      return updateStartupState({
        status: 'ready',
        code: null,
        message: `API local pronta na porta ${apiPort}.`,
        details: {
          ...(startupState.details || {}),
          lastExit: apiLastExit,
          apiSelection: lastApiSelection,
        },
      });
    }

    if (!externalApiInUse && !apiProcess && apiLastExit) {
      return updateStartupFailure(
        'BACKEND_EXITED',
        'A API local foi encerrada antes de responder ao healthcheck.',
        {
          ...apiLastExit,
          apiSelection: lastApiSelection,
        }
      );
    }

    await delay(API_HEALTH_POLL_MS);
  }

  return updateStartupFailure(
    'BACKEND_HEALTH_TIMEOUT',
    `A API local nao respondeu ao endpoint /health em ate ${Math.floor(timeoutMs / 1000)} segundos.`,
    {
      lastExit: apiLastExit,
      apiProcessPid: apiProcess?.pid || null,
      apiSelection: lastApiSelection,
    }
  );
}

async function ensureBackendReady(reason = 'startup') {
  const reservation = await findAvailablePort(readLauncherSettings().port || apiPort);
  apiPort = reservation.port;
  externalApiInUse = reservation.external;

  updateStartupState({
    status: 'starting',
    code: null,
    message: externalApiInUse
      ? `API local existente encontrada na porta ${apiPort}.`
      : 'Inicializando o backend local...',
    details: {
      reason,
      external: externalApiInUse,
      apiSelection: lastApiSelection,
    },
  });

  if (!externalApiInUse) {
    startApiServer();
  }

  return waitForApiHealth();
}

function scheduleApiRestart(reason) {
  if (isDev || externalApiInUse) return;

  clearTimeout(apiRestartTimer);
  apiRestartTimer = setTimeout(() => {
    void restartApiServer(reason, { waitForReady: false });
  }, 700);
}

async function restartApiServer(reason, options = {}) {
  if (isRestartingApi || externalApiInUse) {
    return startupState;
  }

  const { waitForReady = true } = options;
  isRestartingApi = true;
  console.log(`Reiniciando backend: ${reason}`);

  try {
    await stopApiServer();
    if (!waitForReady) {
      startApiServer();
      return startupState;
    }
    return await ensureBackendReady(reason);
  } catch (error) {
    console.error('Falha ao reiniciar a API Python:', error);
    return updateStartupFailure(
      'BACKEND_RESTART_FAILED',
      'Nao foi possivel reiniciar a API local.',
      serializeError(error)
    );
  } finally {
    isRestartingApi = false;
  }
}

function startConfigWatcher() {
  if (isDev) return;

  const dataDir = ensureDataDir();
  if (configWatcher) {
    configWatcher.close();
  }

  configWatcher = fs.watch(dataDir, { persistent: false }, (_eventType, fileName) => {
    const normalized = String(fileName || '').toLowerCase();
    if (!normalized) return;

    if (normalized === ENV_FILENAME.toLowerCase() || normalized === RUNTIME_CONFIG_FILENAME.toLowerCase()) {
      scheduleApiRestart(`arquivo ${fileName} alterado`);
    }
  });

  configWatcher.on('error', (error) => {
    console.warn('Falha ao observar o diretorio de configuracao:', error);
  });
}

async function finalizeQuit() {
  if (quitPromise) {
    return quitPromise;
  }

  quitPromise = (async () => {
    isQuitting = true;
    clearTimeout(apiRestartTimer);

    if (configWatcher) {
      configWatcher.close();
      configWatcher = null;
    }

    await stopApiServer();
  })();

  return quitPromise;
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
      // porta ainda nao esta pronta
    }

    port += 1;
    if (port > 5200) port = 5173;
    await delay(100);
  }

  return 5173;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1300,
    height: 850,
    minWidth: 1000,
    minHeight: 700,
    title: 'Agenda LMD Preview',
    icon: getAppIconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  if (isDev) {
    findVitePort().then((port) => {
      mainWindow.loadURL(`http://localhost:${port}?apiPort=${apiPort}`);
      mainWindow.webContents.openDevTools();
    }).catch((error) => {
      console.error('Falha ao descobrir porta Vite:', error);
      mainWindow.loadURL(`http://localhost:${vitePort}?apiPort=${apiPort}`);
    });
    return;
  }

  mainWindow.loadFile(path.join(__dirname, '../dist-app/index.html'), {
    query: {
      apiPort: String(apiPort),
    },
  });
}

ipcMain.handle('agenda:get-startup-state', async () => startupState);

ipcMain.handle('agenda:retry-api-start', async () => {
  try {
    return await ensureBackendReady('renderer retry');
  } catch (error) {
    console.error('Falha ao tentar iniciar a API por solicitacao da interface:', error);
    return updateStartupFailure(
      'BACKEND_RETRY_FAILED',
      'Nao foi possivel iniciar novamente a API local.',
      serializeError(error)
    );
  }
});

ipcMain.handle('agenda:restart-api', async () => {
  return restartApiServer('renderer restart', { waitForReady: true });
});

ipcMain.handle('agenda:open-data-dir', async () => {
  return shell.openPath(ensureDataDir());
});

ipcMain.handle('agenda:open-log-dir', async () => {
  const target = path.join(ensureDataDir(), 'logs');
  fs.mkdirSync(target, { recursive: true });
  return shell.openPath(target);
});

loadInitialEnvironment();

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

if (gotSingleInstanceLock) {
  app.whenReady().then(async () => {
    app.setAppUserModelId(APP_USER_MODEL_ID);
    ensureDataDir();
    startConfigWatcher();

    try {
      await ensureBackendReady('app ready');
    } catch (error) {
      console.error('Falha ao preparar a API local Python:', error);
      updateStartupFailure(
        'BACKEND_PREPARE_FAILED',
        error.message || 'Nao foi possivel preparar o backend local.',
        serializeError(error)
      );
    }

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

app.on('before-quit', (event) => {
  if (isFinalizingQuit) {
    return;
  }

  event.preventDefault();
  isFinalizingQuit = true;

  void finalizeQuit()
    .catch((error) => {
      console.error('Falha ao encerrar a API local durante o fechamento:', error);
    })
    .finally(() => {
      app.exit(0);
    });
});
