import { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react'
import axios from 'axios'
/* eslint-disable react-refresh/only-export-components */

const STORAGE_KEY = 'agenda-preview-license-session'
const API_DISCOVERY_TIMEOUT = 5000
const LICENSE_API_PATH = '/licenses'
const OFFLINE_TTL_MS = 72 * 60 * 60 * 1000
const LICENSE_CONFIGURATION_REQUIRED_CODES = new Set([
  'LICENSE_ENV_NOT_CONFIGURED',
  'INVALID_ACTIVATION_PAYLOAD',
])
const DEFINITIVE_LICENSE_FAILURE_CODES = new Set([
  'CLOCK_TAMPERING_DETECTED',
  'INVALID_LICENSE',
  'LICENSE_BLOCKED',
  'LICENSE_INACTIVE',
  'LICENSE_OFFLINE_LIMIT_EXPIRED',
  'LICENSE_REVOKED',
  'LICENSE_SERVICE_REJECTED',
])

function getEffectiveBlockAt(session) {
  const explicitBlockAt = session?.effectiveBlockAt || session?.license?.effectiveBlockAt
  if (explicitBlockAt) return explicitBlockAt
  const expiresAt = session?.expiresAt || session?.license?.expiresAt
  const graceDays = Number(session?.graceDays ?? session?.license?.graceDays ?? 0)
  if (!expiresAt) return null
  const blockAt = new Date(expiresAt)
  blockAt.setDate(blockAt.getDate() + graceDays)
  return blockAt.toISOString()
}

function getKnownStatus(session) {
  if (!session) return 'blocked'
  const hasDateInfo = !!(
    session.expiresAt
    || session.effectiveBlockAt
    || session.license?.expiresAt
    || session.license?.effectiveBlockAt
  )
  const rawStatus = String(session.status || session.license?.status || '').toLowerCase()
  if (['revoked', 'suspended', 'cancelled', 'canceled'].includes(rawStatus)) {
    return 'blocked'
  }
  if (!hasDateInfo && ['active', 'grace'].includes(rawStatus)) {
    return rawStatus
  }

  const expiresAt = session.expiresAt || session.license?.expiresAt
  const effectiveBlockAt = getEffectiveBlockAt(session)
  const now = Date.now()
  if (expiresAt && new Date(expiresAt).getTime() >= now) return 'active'
  if (effectiveBlockAt && new Date(effectiveBlockAt).getTime() >= now) return 'grace'
  if (expiresAt || effectiveBlockAt) return 'blocked'
  if (['blocked', 'inactive'].includes(rawStatus)) return 'blocked'
  return rawStatus === 'grace' ? 'grace' : 'blocked'
}

function localClockLooksInvalid(session) {
  const lastOnline = session?.lastValidatedOnlineAt || session?.validatedAt
  if (!lastOnline) return false
  return Date.now() + 5 * 60 * 1000 < new Date(lastOnline).getTime()
}

function offlineWindowExpired(session) {
  const validatedAt = session?.validatedAt
  if (!validatedAt) return true
  return Date.now() - new Date(validatedAt).getTime() > OFFLINE_TTL_MS
}

function isDefinitiveLicenseFailure(code, status) {
  if (DEFINITIVE_LICENSE_FAILURE_CODES.has(code)) return true
  return status === 401 || status === 403
}

function loadStoredSession() {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const stored = JSON.parse(raw)
    if (!stored.token) {
      return null
    }
    return stored
  } catch {
    return null
  }
}

function saveStoredSession(session) {
  if (typeof window === 'undefined') return
  const safeSession = {
    ...session,
    cnpj: session.cnpj,
    projectSlug: session.projectSlug,
    expiresAt: session.expiresAt,
    effectiveBlockAt: session.effectiveBlockAt || session.license?.effectiveBlockAt,
    graceDays: session.graceDays ?? session.license?.graceDays ?? 0,
    status: getKnownStatus(session),
    lastValidatedOnlineAt: session.lastValidatedOnlineAt || session.validatedAt || new Date().toISOString(),
    license: session.license || {},
    project: session.project || {},
    features: Array.isArray(session.features) ? session.features : [],
    validatedAt: session.validatedAt || new Date().toISOString(),
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(safeSession))
}

function clearStoredSession() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(STORAGE_KEY)
}

function getCandidateApiUrls() {
  const hostname = window.location.hostname || 'localhost'
  const urls = []
  const queryPort = new URLSearchParams(window.location.search).get('apiPort')
  if (queryPort) {
    urls.push(`http://${hostname}:${queryPort}/api`)
  }
  for (let port = 3001; port <= 3021; port += 1) {
    urls.push(`http://${hostname}:${port}/api`)
  }
  return [...new Set(urls)]
}

async function discoverApiUrl() {
  const urls = getCandidateApiUrls()
  let lastError = null
  for (const url of urls) {
    try {
      const response = await axios.get(`${url}/health`, { timeout: API_DISCOVERY_TIMEOUT })
      if (response.status === 200) {
        return url
      }
    } catch (error) {
      lastError = error
    }
  }
  throw lastError || new Error('API local nao encontrada.')
}

const LicenseContext = createContext(null)

export function LicenseProvider({ children }) {
  const [isReady, setIsReady] = useState(false)
  const [session, setSession] = useState(null)
  const [licenseError, setLicenseError] = useState(null)
  const [offlineMode, setOfflineMode] = useState(false)
  const [apiUrl, setApiUrl] = useState(null)
  const [apiError, setApiError] = useState(null)
  const apiUrlRef = useRef(null)

  const reloadApiUrl = useCallback(async () => {
    try {
      const discovered = await discoverApiUrl()
      apiUrlRef.current = discovered
      setApiUrl(discovered)
      setApiError(null)
      return discovered
    } catch (err) {
      apiUrlRef.current = null
      setApiUrl(null)
      const apiDiscoveryError = {
        message: 'Nao foi possivel encontrar a API local. Verifique se o backend esta rodando.',
        code: 'API_UNAVAILABLE',
        cause: err,
      }
      setApiError(apiDiscoveryError)
      throw Object.assign(new Error(apiDiscoveryError.message), apiDiscoveryError)
    }
  }, [])

  const getApiUrl = useCallback(async () => {
    if (apiUrlRef.current) return apiUrlRef.current
    return await reloadApiUrl()
  }, [reloadApiUrl])

  const buildAuthHeaders = useCallback((token) => {
    if (!token) return {}
    return { Authorization: `Bearer ${token}` }
  }, [])

  const persistSession = useCallback((nextSession) => {
    saveStoredSession(nextSession)
    setSession(nextSession)
  }, [])

  const bootstrapLicense = useCallback(async () => {
    setLicenseError(null)
    let currentApiUrl
    try {
      currentApiUrl = await getApiUrl()
    } catch (err) {
      const apiUnavailableError = {
        message: 'Nao foi possivel encontrar a API local. Verifique se o backend esta rodando.',
        code: 'API_UNAVAILABLE',
        cause: err,
      }
      setLicenseError({ message: apiUnavailableError.message, code: apiUnavailableError.code })
      throw Object.assign(new Error(apiUnavailableError.message), apiUnavailableError)
    }

    try {
      const response = await axios.post(
        `${currentApiUrl}${LICENSE_API_PATH}/bootstrap`,
        {},
        { timeout: API_DISCOVERY_TIMEOUT },
      )

      const nextSession = {
        licenseKey: response.data.licenseKey,
        licenseId: response.data.licenseId || response.data.license?.id || response.data.licenseKey,
        cnpj: response.data.cnpj,
        projectSlug: response.data.projectSlug,
        token: response.data.token,
        expiresAt: response.data.expiresAt,
        effectiveBlockAt: response.data.effectiveBlockAt,
        graceDays: response.data.graceDays || 0,
        license: response.data.license || {},
        project: response.data.project || {},
        features: response.data.license?.features || [],
        status: response.data.status || response.data.license?.status || 'active',
        validatedAt: new Date().toISOString(),
        lastValidatedOnlineAt: response.data.lastValidatedOnlineAt || new Date().toISOString(),
        offline: !!response.data.offline,
      }
      persistSession(nextSession)
      return nextSession
    } catch (err) {
      const message = err.response?.data?.error || err.message || 'Falha ao validar a licenca.'
      const details = err.response?.data?.code || 'LICENSE_BOOTSTRAP_FAILED'
      setLicenseError({ message, code: details })
      throw new Error(message, { cause: err })
    }
  }, [getApiUrl, persistSession])

  const verifySession = useCallback(async () => {
    const stored = loadStoredSession()

    try {
      const nextSession = await bootstrapLicense()
      setOfflineMode(false)
      return nextSession
    } catch (err) {
      const backendMessage = err.cause?.response?.data?.error || err.message
      const backendCode = err.code || err.cause?.response?.data?.code || 'LICENSE_BOOTSTRAP_FAILED'
      const backendStatus = err.cause?.response?.status
      setLicenseError({ message: backendMessage, code: backendCode })

      if (LICENSE_CONFIGURATION_REQUIRED_CODES.has(backendCode)) {
        setSession(null)
        setOfflineMode(false)
        clearStoredSession()
        return null
      }

      if (isDefinitiveLicenseFailure(backendCode, backendStatus)) {
        setSession(null)
        setOfflineMode(false)
        clearStoredSession()
        return null
      }

      const alreadyValid = stored
        && stored.token
        && getKnownStatus(stored) !== 'blocked'
        && !offlineWindowExpired(stored)
        && !localClockLooksInvalid(stored)
      if (alreadyValid) {
        setSession({ ...stored, status: getKnownStatus(stored), offline: true })
        setOfflineMode(true)
        if (!backendMessage) {
          setLicenseError({
            message: 'Nao foi possivel validar a licenca online. O sistema continuara funcionando temporariamente com a ultima validacao valida.',
            code: 'LICENSE_OFFLINE',
          })
        }
        return { ...stored, status: getKnownStatus(stored), offline: true }
      }
      setSession(null)
      setOfflineMode(false)
      clearStoredSession()
      return null
    }
  }, [bootstrapLicense])

  const logout = useCallback(() => {
    clearStoredSession()
    setSession(null)
    setOfflineMode(false)
    setLicenseError(null)
  }, [])

  const registerUsage = useCallback(async (metrics) => {
    if (!session?.licenseId || !session?.token) return null
    try {
      const currentApiUrl = await getApiUrl()
      const response = await axios.post(
        `${currentApiUrl}${LICENSE_API_PATH}/${encodeURIComponent(session.licenseId)}/usage`,
        metrics,
        {
          headers: buildAuthHeaders(session.token),
          timeout: API_DISCOVERY_TIMEOUT,
        },
      )
      return response.data
    } catch {
      return null
    }
  }, [session, getApiUrl, buildAuthHeaders])

  useEffect(() => {
    async function bootstrap() {
      const stored = loadStoredSession()
      if (stored) {
        setSession(stored)
      }
      try {
        await reloadApiUrl()
      } catch {
        // keep offline state if api discovery falhar.
      }
      setIsReady(true)
    }
    bootstrap()
  }, [reloadApiUrl])

  const value = useMemo(
    () => ({
      isReady,
      session,
      licenseError,
      offlineMode,
      apiUrl,
      apiError,
      bootstrapLicense,
      verifySession,
      registerUsage,
      logout,
      reloadApiUrl,
    }),
    [isReady, session, licenseError, offlineMode, apiUrl, apiError, bootstrapLicense, verifySession, registerUsage, logout, reloadApiUrl],
  )

  return <LicenseContext.Provider value={value}>{children}</LicenseContext.Provider>
}

export function useLicense() {
  const context = useContext(LicenseContext)
  if (!context) {
    throw new Error('useLicense must be used within LicenseProvider')
  }
  return context
}
