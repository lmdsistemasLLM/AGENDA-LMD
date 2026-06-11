import { useState, useEffect, useRef, useCallback } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import ptBrLocale from '@fullcalendar/core/locales/pt-br'
import axios from 'axios'
import { RefreshCw, AlertCircle, X, Clock, User, Info, Activity, ShieldCheck, LogIn, LockKeyhole } from 'lucide-react'
import { useLicense } from './context/LicenseContext.jsx'

const MOBILE_BREAKPOINT = 768
const TABLET_BREAKPOINT = 1024
const LOGIN_STORAGE_KEY = 'agenda-lmd-login'

function getViewportMode(width = window.innerWidth) {
  if (width <= MOBILE_BREAKPOINT) {
    return 'mobile'
  }

  if (width <= TABLET_BREAKPOINT) {
    return 'tablet'
  }

  return 'desktop'
}

function getCalendarSettings(viewportMode) {
  if (viewportMode === 'mobile') {
    return {
      view: 'dayGridMonth',
      height: 'auto',
      headerToolbar: {
        left: 'prev,next today',
        center: 'title',
        right: 'dayGridMonth,timeGridDay'
      }
    }
  }

  if (viewportMode === 'tablet') {
    return {
      view: 'timeGridDay',
      height: 620,
      headerToolbar: {
        left: 'prev,next today',
        center: 'title',
        right: 'dayGridMonth,timeGridDay,timeGridWeek'
      }
    }
  }

  return {
    view: 'timeGridWeek',
    height: 650,
    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: 'dayGridMonth,timeGridWeek,timeGridDay'
    }
  }
}

function App() {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [selectedEventDetails, setSelectedEventDetails] = useState(null)
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [viewportMode, setViewportMode] = useState(() => getViewportMode())
  const [loginState, setLoginState] = useState({ username: '', password: '', remember: false })
  const [loginError, setLoginError] = useState(null)
  const [loggingIn, setLoggingIn] = useState(false)
  const [isLoggedIn, setIsLoggedIn] = useState(() => window.localStorage.getItem(LOGIN_STORAGE_KEY) === '1')
  const calendarRef = useRef(null)

  const {
    session,
    licenseError,
    offlineMode,
    isReady,
    apiUrl,
    verifySession,
  } = useLicense()

  const hasLicense = !!session && ['active', 'grace'].includes(session.status)

  const formatLicenseDate = (value) => {
    if (!value) return '--'
    return new Intl.DateTimeFormat('pt-BR').format(new Date(value))
  }

  const getLicenseMessage = () => {
    if (!session) return null
    if (offlineMode) {
      return 'Nao foi possivel validar a licenca online. Funcionamento temporario com a ultima validacao valida.'
    }
    if (session.status === 'grace') {
      return `Sua licenca venceu em ${formatLicenseDate(session.expiresAt)} e esta em periodo de carencia ate ${formatLicenseDate(session.effectiveBlockAt)}. Entre em contato para renovar.`
    }
    return `Licenca ativa ate ${formatLicenseDate(session.expiresAt)}.`
  }

  const getAuthHeaders = () => {
    if (!session?.token) return {}
    return { Authorization: `Bearer ${session.token}` }
  }

  const fetchAgendamentos = useCallback(async () => {
    if (!apiUrl || !session?.token) {
      setError('Licenca nao validada ou API local nao encontrada.')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const headers = session?.token ? { Authorization: `Bearer ${session.token}` } : {}
      const response = await axios.get(`${apiUrl}/agendamentos`, {
        timeout: 30000,
        headers,
      })
      setEvents(response.data)
    } catch (err) {
      console.error('Erro ao buscar agendamentos', err)
      setError('Nao foi possivel sincronizar os dados da agenda no momento.')
      setEvents([])
    } finally {
      setLoading(false)
    }
  }, [apiUrl, session])

  useEffect(() => {
    if (!hasLicense || !apiUrl || !isLoggedIn) return
    const tid = setTimeout(() => { void fetchAgendamentos() }, 0)
    return () => clearTimeout(tid)
  }, [hasLicense, apiUrl, isLoggedIn, fetchAgendamentos])

  useEffect(() => {
    if (!hasLicense || !apiUrl || !isLoggedIn) return
    const intervalId = window.setInterval(() => {
      void fetchAgendamentos()
    }, 120000)

    return () => window.clearInterval(intervalId)
  }, [hasLicense, apiUrl, isLoggedIn, fetchAgendamentos])

  useEffect(() => {
    void verifySession()
  }, [verifySession])

  useEffect(() => {
    const onResize = () => {
      const nextViewportMode = getViewportMode()
      setViewportMode((currentViewportMode) => (
        currentViewportMode === nextViewportMode ? currentViewportMode : nextViewportMode
      ))
    }

    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const handleLogin = async (event) => {
    event.preventDefault()
    setLoginError(null)
    setLoggingIn(true)

    try {
      await axios.post(`${apiUrl}/auth/login`, {
        username: loginState.username,
        password: loginState.password,
      }, { timeout: 10000 })
      if (loginState.remember) {
        window.localStorage.setItem(LOGIN_STORAGE_KEY, '1')
      } else {
        window.localStorage.removeItem(LOGIN_STORAGE_KEY)
      }
      setIsLoggedIn(true)
      setLoginState((current) => ({ ...current, password: '' }))
    } catch (err) {
      setLoginError(err.response?.data?.error || 'Usuario ou senha invalidos.')
    } finally {
      setLoggingIn(false)
    }
  }

  const handleLogout = () => {
    window.localStorage.removeItem(LOGIN_STORAGE_KEY)
    setIsLoggedIn(false)
    setEvents([])
  }

  const getEventMainLabel = (event) => {
    return event?.extendedProps?.nome || event?.extendedProps?.animal || event?.title || 'Sem informacao'
  }

  const getEventCliente = (event) => {
    return event?.extendedProps?.cliente || ''
  }

  const getEventType = (event) => {
    return event?.extendedProps?.animal || 'Nao informado'
  }

  const getResponsavel = (event) => {
    return event?.extendedProps?.tecnico || event?.extendedProps?.responsavel || 'Nao atribuido'
  }

  const renderEventContent = (eventInfo) => {
    try {
      const customTime = eventInfo.event.extendedProps?.hora_texto || eventInfo.timeText || ''
      const title = eventInfo.event.title || ''
      const isMonth = eventInfo.view.type === 'dayGridMonth'

      if (isMonth) {
        return (
          <div className="truncate text-[10px] px-1 font-semibold leading-tight text-white w-full flex items-center gap-1">
            <b className="shrink-0">{String(customTime).split(' - ')[0]}</b>
            <span className="opacity-90 truncate">{getEventMainLabel(eventInfo.event)}</span>
          </div>
        )
      }

      return (
        <div className="flex flex-col p-1 w-full h-full overflow-hidden leading-tight text-[11px]">
          <div className="flex flex-wrap gap-x-1">
            <b className="font-bold">{customTime}</b>
            <span className="font-semibold text-white/90">{title}</span>
          </div>
        </div>
      )
    } catch (err) {
      console.error(err)
      return <div className="text-white text-xs px-1">Erro</div>
    }
  }

  const detailFields = selectedEvent?.extendedProps?.customFields || []

  if (!isReady) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="rounded-3xl bg-white p-8 shadow-lg border border-gray-200 max-w-lg w-full text-center">
          <p className="text-lg font-semibold text-gray-800">Verificando licenca...</p>
          <p className="mt-3 text-sm text-gray-500">Aguarde, o aplicativo esta inicializando com a validacao de licenca.</p>
        </div>
      </div>
    )
  }

  if (!hasLicense) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-xl text-center">
          <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-red-600">
            <LockKeyhole className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-black text-slate-900">
            {licenseError ? 'Acesso bloqueado' : 'Validando licenca'}
          </h1>
          <p className="mt-3 text-sm text-slate-600">
            {licenseError
              ? 'Licenca bloqueada ou expirada. Entre em contato com o suporte para regularizar o acesso.'
              : 'Aguarde enquanto o sistema valida a licenca configurada.'}
          </p>
          {licenseError && (
            <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">
              {licenseError.message}
            </div>
          )}
        </div>
      </div>
    )
  }

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-xl">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
              <LogIn className="h-6 w-6" />
            </div>
            <h1 className="text-2xl font-black text-slate-900">Login</h1>
            <p className="mt-2 text-sm text-slate-500">Informe seu usuario e senha para acessar a agenda.</p>
          </div>

          {session.status === 'grace' && (
            <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-800">
              Sua licenca esta em periodo de carencia. Regularize para evitar bloqueio.
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-5">
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">Usuario</span>
              <input
                type="text"
                value={loginState.username}
                onChange={(event) => setLoginState((current) => ({ ...current, username: event.target.value }))}
                autoComplete="username"
                className="mt-2 block w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </label>

            <label className="block">
              <span className="text-sm font-semibold text-slate-700">Senha</span>
              <input
                type="password"
                value={loginState.password}
                onChange={(event) => setLoginState((current) => ({ ...current, password: event.target.value }))}
                autoComplete="current-password"
                className="mt-2 block w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </label>

            <div className="flex items-center justify-between gap-4 text-sm">
              <label className="inline-flex items-center gap-2 text-slate-600">
                <input
                  type="checkbox"
                  checked={loginState.remember}
                  onChange={(event) => setLoginState((current) => ({ ...current, remember: event.target.checked }))}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                Lembrar acesso
              </label>
              <button type="button" className="font-semibold text-blue-600 hover:text-blue-700">
                Esqueci minha senha
              </button>
            </div>

            {loginError && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {loginError}
              </div>
            )}

            <button
              type="submit"
              disabled={loggingIn}
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <LogIn className="h-4 w-4" />
              {loggingIn ? 'Entrando...' : 'Entrar'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans">
      <header className="bg-white border-b border-gray-200 px-4 py-4 shadow-sm sticky top-0 z-10 sm:px-6">
        <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <div className="h-10 w-24 shrink-0 flex items-center justify-center bg-transparent overflow-hidden sm:h-12 sm:w-32">
              <img
                src="/logo.svg"
                alt="Logo da empresa"
                className="max-h-full max-w-full object-contain"
                onError={(e) => {
                  e.target.outerHTML = '<div class="bg-blue-600 p-2.5 rounded-xl shadow-inner flex items-center justify-center"><svg class="w-6 h-6 text-white" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg></div>'
                }}
              />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-black text-gray-800 tracking-tight sm:text-2xl">Agenda</h1>
              <p className="text-xs text-gray-500 font-medium sm:text-sm">Painel de Agenda</p>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className={`rounded-2xl border px-4 py-2 text-xs font-semibold ${
              session.status === 'grace'
                ? 'border-amber-200 bg-amber-50 text-amber-700'
                : 'border-emerald-200 bg-emerald-50 text-emerald-700'
            }`}>
              <span className="inline-flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" />
                {getLicenseMessage()}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                void fetchAgendamentos()
              }}
              disabled={loading}
              className="flex items-center justify-center gap-2 bg-white border border-gray-300 hover:bg-gray-50 hover:border-gray-400 text-gray-700 px-4 py-2.5 rounded-xl font-medium transition-all shadow-sm active:scale-95 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Sincronizar
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-100"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      {error && (
        <div className="mb-4 bg-red-50 border-l-4 border-red-500 p-4 rounded-r-lg flex items-center gap-3 shadow-sm">
          <AlertCircle className="w-5 h-5 text-red-500" />
          <p className="text-red-700 text-sm font-medium">{error}</p>
        </div>
      )}

      {licenseError && hasLicense && (
        <div className="mx-auto mt-4 w-full max-w-[1400px] px-4 sm:px-6">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-800">
            {licenseError.message}
          </div>
        </div>
      )}

      <main className="flex-1 p-4 max-w-[1400px] mx-auto w-full flex flex-col sm:p-6">
        <div className="bg-white p-3 rounded-2xl shadow-sm border border-gray-100 flex-1 min-h-[300px] flex flex-col sm:p-6 md:min-h-[600px]">
          <div className="flex-1">
            <FullCalendar
              ref={calendarRef}
              plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
              initialView={getCalendarSettings(viewportMode).view}
              headerToolbar={getCalendarSettings(viewportMode).headerToolbar}
              events={events}
              eventContent={renderEventContent}
              eventClick={async (clickInfo) => {
                setSelectedEvent(clickInfo.event)
                setSelectedEventDetails(null)
                setLoadingDetails(true)

                try {
                  const detailId = clickInfo.event.extendedProps?.detailId || clickInfo.event.id
                  const response = await axios.get(`${apiUrl}/agendamentos/${detailId}`, {
                    headers: getAuthHeaders(),
                    timeout: 10000,
                  })
                  setSelectedEventDetails(response.data)
                } catch (err) {
                  console.error('Erro ao buscar detalhes do agendamento:', err)
                  setSelectedEventDetails({
                    diagnostico: 'Nao foi possivel carregar os detalhes deste registro.',
                  })
                } finally {
                  setLoadingDetails(false)
                }
              }}
              locale={ptBrLocale}
              buttonText={{
                today: 'Hoje',
                month: 'Mes',
                week: 'Semana',
                day: 'Dia',
                list: 'Lista'
              }}
              allDaySlot={false}
              slotMinTime="07:00:00"
              slotMaxTime="20:00:00"
              height={getCalendarSettings(viewportMode).height}
              dayMaxEvents={true}
              slotDuration="00:30:00"
              slotLabelInterval="00:30:00"
              defaultTimedEventDuration="00:30:00"
              eventDisplay="block"
              nowIndicator={true}
              dayHeaderFormat={viewportMode === 'mobile' ? { weekday: 'short' } : { weekday: 'short', day: '2-digit', month: '2-digit' }}
              slotLabelFormat={{
                hour: '2-digit',
                minute: '2-digit',
                omitZeroMinute: false,
                meridiem: false
              }}
            />
          </div>
        </div>
      </main>

      {selectedEvent && (
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[calc(100vh-2rem)] overflow-hidden flex flex-col transform transition-all animate-in fade-in zoom-in-95 duration-200">
            <div className="bg-gradient-to-r from-blue-600 to-blue-700 p-4 text-white flex justify-between items-start gap-4 sm:p-6">
              <div className="min-w-0">
                <h2 className="text-xl font-bold mb-1 pr-2 break-words sm:text-2xl">
                  {getEventMainLabel(selectedEvent)}
                </h2>
                <p className="text-blue-100 flex flex-wrap items-center gap-2 text-sm">
                  <Clock className="w-4 h-4" />
                  {new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(selectedEvent.start)}
                  {selectedEvent.extendedProps?.hora_texto ? `, ${selectedEvent.extendedProps.hora_texto}` : `, ${new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(selectedEvent.start)}`}
                </p>
                <div className="mt-2">
                  <span className="bg-blue-800/50 px-2 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider text-blue-50 border border-blue-500/30">
                    Tipo - {getEventType(selectedEvent)}
                  </span>
                </div>
              </div>
              <button
                onClick={() => setSelectedEvent(null)}
                className="text-white hover:bg-white/20 p-2 rounded-full transition-colors flex-shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto p-4 space-y-6 sm:p-6">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex items-start gap-3">
                  <div className="bg-gray-100 p-2 rounded-lg text-gray-600">
                    <User className="w-5 h-5" />
                  </div>
                  <div className="overflow-hidden">
                    <p className="text-xs text-gray-500 font-bold uppercase tracking-wider mb-0.5">{selectedEvent.extendedProps?.clienteLabel || 'Cliente'}</p>
                    <p className="text-gray-800 font-semibold text-sm truncate">
                      {getEventCliente(selectedEvent) || 'Nao informado'}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="bg-blue-50 p-2 rounded-lg text-blue-600">
                    <Info className="w-5 h-5" />
                  </div>
                  <div className="overflow-hidden">
                    <p className="text-xs text-blue-600 font-bold uppercase tracking-wider mb-0.5">Responsavel</p>
                    <p className="text-gray-800 font-semibold text-sm truncate">
                      {getResponsavel(selectedEvent)}
                    </p>
                  </div>
                </div>
              </div>

              <hr className="border-gray-100" />

              <div>
                <p className="text-xs text-gray-500 font-bold uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Info className="w-4 h-4" /> Informacoes adicionais
                </p>
                {detailFields.length > 0 ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {detailFields.map((field, index) => (
                      <div key={index} className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                        <p className="text-[11px] text-gray-500 mb-0.5 font-semibold uppercase">{field.label || `Campo ${index + 1}`}</p>
                        <p className="font-bold text-gray-800 text-sm truncate">{field.value || '--'}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 italic">Nenhuma informacao adicional registrada.</p>
                )}
              </div>

              <div className="bg-blue-50/50 p-4 rounded-xl border border-blue-100">
                <p className="text-xs text-blue-700 font-bold uppercase tracking-wider mb-2 flex items-center gap-2">
                  <Activity className="w-4 h-4" /> Observacoes
                </p>
                {loadingDetails ? (
                  <div className="flex flex-col gap-2 animate-pulse py-1">
                    <div className="h-3 bg-blue-200/50 rounded w-3/4"></div>
                    <div className="h-3 bg-blue-200/50 rounded w-5/6"></div>
                    <div className="h-3 bg-blue-200/50 rounded w-2/3"></div>
                  </div>
                ) : selectedEventDetails ? (
                  <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed max-h-32 overflow-y-auto">
                    {selectedEventDetails.diagnostico}
                  </p>
                ) : (
                  <p className="text-sm text-gray-400 italic">Sem observacoes registradas.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
