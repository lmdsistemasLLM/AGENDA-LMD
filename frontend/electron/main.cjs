const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const isDev = process.env.NODE_ENV === 'development';

// Configura o dotenv baseado no ambiente (Dev vs Prod instalado)
const envPath = isDev 
  ? path.join(__dirname, '../../backend/.env')
  : path.join(path.dirname(process.execPath), '.env');

if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
} else {
  require('dotenv').config(); // Fallback silencioso
}

let mainWindow;

function startApiServer() {
  try {
    if (isDev) {
      // Em desenvolvimento, rodamos a API original
      require('../../backend/server.js');
    } else {
      // Em produção, rodamos a API CommonJS embarcada no instalador
      require('./backend/server.cjs');
    }
  } catch (err) {
    console.error("Falha ao iniciar o Servidor de API Local:", err);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1300,
    height: 850,
    minWidth: 1000,
    minHeight: 700,
    title: "Agenda LMD - Módulo Preview",
    autoHideMenuBar: true, // Esconde o menu superior padrão do Windows
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    // Em produção, carrega os arquivos compilados do Vite
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(() => {
  startApiServer(); // Inicia a API integrada de forma invisível
  createWindow();   // Abre o calendário na tela
});

app.on('window-all-closed', () => {
  app.quit();
});
