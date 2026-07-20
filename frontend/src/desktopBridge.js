function getIpcRenderer() {
  if (typeof window === 'undefined' || typeof window.require !== 'function') {
    return null
  }

  try {
    return window.require('electron').ipcRenderer
  } catch {
    return null
  }
}

export function hasDesktopBridge() {
  return !!getIpcRenderer()
}

export async function getStartupState() {
  const ipcRenderer = getIpcRenderer()
  if (!ipcRenderer) {
    return {
      status: 'browser',
      code: null,
      message: null,
      details: null,
      apiPort: null,
      externalApiInUse: false,
      logLines: [],
      updatedAt: null,
    }
  }

  return ipcRenderer.invoke('agenda:get-startup-state')
}

export async function retryApiStart() {
  const ipcRenderer = getIpcRenderer()
  if (!ipcRenderer) {
    throw new Error('Desktop bridge indisponivel.')
  }
  return ipcRenderer.invoke('agenda:retry-api-start')
}

export async function restartApi() {
  const ipcRenderer = getIpcRenderer()
  if (!ipcRenderer) {
    throw new Error('Desktop bridge indisponivel.')
  }
  return ipcRenderer.invoke('agenda:restart-api')
}

export async function openDataDir() {
  const ipcRenderer = getIpcRenderer()
  if (!ipcRenderer) {
    return null
  }
  return ipcRenderer.invoke('agenda:open-data-dir')
}

export async function openLogDir() {
  const ipcRenderer = getIpcRenderer()
  if (!ipcRenderer) {
    return null
  }
  return ipcRenderer.invoke('agenda:open-log-dir')
}
