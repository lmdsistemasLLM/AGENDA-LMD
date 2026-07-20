import { useState, useEffect, useRef, useCallback } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import ptBrLocale from '@fullcalendar/core/locales/pt-br'
import axios from 'axios'
import {
  RefreshCw,
  AlertCircle,
  X,
  Clock,
  User,
  Info,
  Activity,
  ShieldCheck,
  LogIn,
  LockKeyhole,
  Cpu,
  HardDrive,
  PlugZap,
  Search,
  Save,
  CheckCircle2,
  ServerCog,
  Settings2,
  FolderOpen,
  RotateCcw,
  KeyRound,
} from 'lucide-react'
import { useLicense } from './context/LicenseContext.jsx'
import {
  getStartupState,
  hasDesktopBridge,
  openDataDir,
  openLogDir,
  restartApi,
  retryApiStart,
} from './desktopBridge.js'
import { BRAND_LOGO_ALT, BRAND_LOGO_PATH } from './branding.generated.js'

const MOBILE_BREAKPOINT = 768
const TABLET_BREAKPOINT = 1024
const LOGIN_STORAGE_KEY = 'agenda-lmd-login'
const LICENSE_CONFIGURATION_REQUIRED_CODES = new Set([
  'LICENSE_ENV_NOT_CONFIGURED',
  'INVALID_ACTIVATION_PAYLOAD',
])
const DEFINITIVE_LICENSE_BLOCK_CODES = new Set([
  'CLOCK_TAMPERING_DETECTED',
  'INVALID_LICENSE',
  'LICENSE_BLOCKED',
  'LICENSE_INACTIVE',
  'LICENSE_OFFLINE_LIMIT_EXPIRED',
  'LICENSE_REVOKED',
  'LICENSE_SERVICE_REJECTED',
])

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
        right: 'dayGridMonth,timeGridDay',
      },
    }
  }

  if (viewportMode === 'tablet') {
    return {
      view: 'timeGridDay',
      height: 620,
      headerToolbar: {
        left: 'prev,next today',
        center: 'title',
        right: 'dayGridMonth,timeGridDay,timeGridWeek',
      },
    }
  }

  return {
    view: 'timeGridWeek',
    height: 650,
    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: 'dayGridMonth,timeGridWeek,timeGridDay',
    },
  }
}

function createEmptySettingsForm() {
  return {
    firebird: {
      host: '127.0.0.1',
      port: '3050',
      database: '',
      user: 'SYSDBA',
      password: '',
      charset: 'UTF8',
      clientPath: '',
      arch: 'AUTO',
      provider: 'AUTO',
      connectionMode: 'AUTO',
    },
    license: {
      licenseKey: '',
      cnpj: '',
      projectSlug: 'agenda-lmd-preview',
      apiUrl: '',
    },
    auth: {
      username: 'admin',
      password: 'admin',
    },
  }
}

function normalizeSettingsResponse(payload) {
  const fallback = createEmptySettingsForm()
  return {
    firebird: {
      host: String(payload?.firebird?.host ?? fallback.firebird.host),
      port: String(payload?.firebird?.port ?? fallback.firebird.port),
      database: String(payload?.firebird?.database ?? fallback.firebird.database),
      user: String(payload?.firebird?.user ?? fallback.firebird.user),
      password: String(payload?.firebird?.password ?? fallback.firebird.password),
      charset: String(payload?.firebird?.charset ?? fallback.firebird.charset),
      clientPath: String(payload?.firebird?.clientPath ?? fallback.firebird.clientPath),
      arch: String(payload?.firebird?.arch ?? fallback.firebird.arch),
      provider: String(payload?.firebird?.provider ?? fallback.firebird.provider),
      connectionMode: String(payload?.firebird?.connectionMode ?? fallback.firebird.connectionMode),
    },
    license: {
      licenseKey: String(payload?.license?.licenseKey ?? fallback.license.licenseKey),
      cnpj: String(payload?.license?.cnpj ?? fallback.license.cnpj),
      projectSlug: String(payload?.license?.projectSlug ?? fallback.license.projectSlug),
      apiUrl: String(payload?.license?.apiUrl ?? fallback.license.apiUrl),
    },
    auth: {
      username: String(payload?.auth?.username ?? fallback.auth.username),
      password: String(payload?.auth?.password ?? fallback.auth.password),
    },
  }
}

function NoticeBanner({ notice }) {
  if (!notice) return null

  return (
    <div className={`rounded-2xl border px-4 py-3 text-sm font-medium ${
      notice.tone === 'danger'
        ? 'border-red-200 bg-red-50 text-red-700'
        : notice.tone === 'warning'
          ? 'border-amber-200 bg-amber-50 text-amber-800'
          : 'border-emerald-200 bg-emerald-50 text-emerald-700'
    }`}>
      {notice.message}
    </div>
  )
}

function DiagnosticField({ label, value, tone = 'default' }) {
  const toneClasses = tone === 'danger'
    ? 'border-red-200 bg-red-50 text-red-900'
    : tone === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
      : 'border-slate-200 bg-slate-50 text-slate-900'

  return (
    <div className={`rounded-2xl border p-3 ${toneClasses}`}>
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold">{value || '--'}</p>
    </div>
  )
}

function DiagnosticStatusBadge({ status }) {
  if (status === 'valid' || status === 'ok') {
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">
        <CheckCircle2 className="h-4 w-4" />
        Validado
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.16em] text-amber-700">
      <AlertCircle className="h-4 w-4" />
      Requer atencao
    </span>
  )
}

function TextField({ label, value, onChange, placeholder = '', type = 'text' }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-slate-700">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-2 block w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
      />
    </label>
  )
}

function SelectField({ label, value, onChange, options }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-slate-700">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 block w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  )
}

function BrandMark({ className = '', compact = false }) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div className="flex h-14 w-32 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white/80 p-2">
        <img
          src={BRAND_LOGO_PATH}
          alt={BRAND_LOGO_ALT}
          className="max-h-full max-w-full object-contain"
        />
      </div>
      <div className="min-w-0">
        <p className="truncate text-lg font-black text-slate-900">Agenda LMD Preview</p>
        {!compact && (
          <p className="truncate text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            LMD Sistemas
          </p>
        )}
      </div>
    </div>
  )
}

function StartupDiagnosticScreen({
  startupState,
  onRetry,
  onOpenDataDir,
  onOpenLogs,
  retrying,
}) {
  const logLines = Array.isArray(startupState?.logLines) ? startupState.logLines : []

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-5xl items-center justify-center">
        <div className="w-full rounded-[32px] border border-slate-200 bg-white p-6 shadow-xl sm:p-10">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-2xl">
              <BrandMark className="mb-5" />
              <div className="flex items-center gap-3">
                <div className="flex h-14 w-14 items-center justify-center rounded-3xl bg-amber-50 text-amber-700">
                  <ServerCog className="h-7 w-7" />
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.22em] text-slate-500">Diagnostico de inicializacao</p>
                  <h1 className="text-3xl font-black text-slate-900">Nao foi possivel iniciar a API local</h1>
                </div>
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-600">
                O frontend abriu, mas o backend local nao respondeu. Isso e tratado separadamente de licenca para que a configuracao continue acessivel.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={onRetry}
                disabled={retrying}
                className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RotateCcw className={`h-4 w-4 ${retrying ? 'animate-spin' : ''}`} />
                {retrying ? 'Tentando novamente...' : 'Tentar novamente'}
              </button>
              <button
                type="button"
                onClick={onOpenDataDir}
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
              >
                <FolderOpen className="h-4 w-4" />
                Abrir dados
              </button>
              <button
                type="button"
                onClick={onOpenLogs}
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
              >
                <Search className="h-4 w-4" />
                Abrir logs
              </button>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <DiagnosticField label="Status" value={startupState?.status} tone="danger" />
            <DiagnosticField label="Codigo" value={startupState?.code} tone="danger" />
            <DiagnosticField label="Porta da API" value={startupState?.apiPort} />
            <DiagnosticField label="API externa" value={startupState?.externalApiInUse ? 'Sim' : 'Nao'} />
            <DiagnosticField label="Mensagem" value={startupState?.message} tone="danger" />
            <DiagnosticField label="Atualizado em" value={startupState?.updatedAt} />
          </div>

          {startupState?.details && (
            <div className="mt-6 rounded-[28px] border border-slate-200 bg-slate-50 p-5">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Detalhes tecnicos</p>
              <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words rounded-2xl bg-slate-900 p-4 text-xs leading-6 text-slate-100">
                {JSON.stringify(startupState.details, null, 2)}
              </pre>
            </div>
          )}

          <div className="mt-6 rounded-[28px] border border-slate-200 bg-slate-50 p-5">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Ultimas saidas da API</p>
            {logLines.length > 0 ? (
              <pre className="mt-3 max-h-72 overflow-auto rounded-2xl bg-slate-950 p-4 text-xs leading-6 text-emerald-100">
                {logLines.join('\n')}
              </pre>
            ) : (
              <p className="mt-3 text-sm text-slate-500">Nenhum log de inicializacao foi capturado ainda.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function LicenseBlockedScreen({ licenseError, onOpenConfiguration, onRetry }) {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-8 shadow-xl text-center">
        <div className="mb-6 flex justify-center">
          <BrandMark compact className="justify-center text-left" />
        </div>
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-red-600">
          <LockKeyhole className="h-6 w-6" />
        </div>
        <h1 className="text-2xl font-black text-slate-900">Acesso bloqueado</h1>
        <p className="mt-3 text-sm text-slate-600">
          A API local respondeu, mas a licenca retornou um bloqueio explicito. Esse estado nao e usado para backend offline.
        </p>
        {licenseError && (
          <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">
            {licenseError.message}
          </div>
        )}

        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
          >
            <RefreshCw className="h-4 w-4" />
            Revalidar licenca
          </button>
          <button
            type="button"
            onClick={onOpenConfiguration}
            className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            <Settings2 className="h-4 w-4" />
            Configuracoes locais
          </button>
        </div>
      </div>
    </div>
  )
}

function LicenseTroubleshootingScreen({ licenseError, onRetry, onOpenConfiguration }) {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl rounded-[30px] border border-slate-200 bg-white p-8 shadow-xl">
        <BrandMark className="mb-6" />
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Licenca</p>
            <h1 className="mt-2 text-3xl font-black text-slate-900">Nao foi possivel validar a licenca agora</h1>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              O backend local esta acessivel, mas a validacao ainda nao concluiu. Voce pode tentar novamente ou ajustar as configuracoes sem cair na tela de bloqueio.
            </p>
          </div>
          <div className="flex h-14 w-14 items-center justify-center rounded-3xl bg-amber-50 text-amber-700">
            <KeyRound className="h-7 w-7" />
          </div>
        </div>

        {licenseError && (
          <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
            {licenseError.message}
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            <RefreshCw className="h-4 w-4" />
            Tentar novamente
          </button>
          <button
            type="button"
            onClick={onOpenConfiguration}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
          >
            <Settings2 className="h-4 w-4" />
            Configuracoes locais
          </button>
        </div>
      </div>
    </div>
  )
}

function ConfigurationWorkspace({
  title,
  subtitle,
  settingsForm,
  diagnostics,
  notice,
  loadingDiagnostics,
  testingConnection,
  savingSettings,
  restartingBackend,
  onFieldChange,
  onRefreshDiagnostics,
  onTestConnection,
  onSave,
  onClose,
  allowClose,
}) {
  const busy = savingSettings || restartingBackend

  return (
    <section className="rounded-[30px] border border-slate-200 bg-white/95 p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <BrandMark compact className="mb-4" />
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-50 text-sky-600">
              <ServerCog className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-slate-500">Configuracoes locais</p>
              <h2 className="text-xl font-black text-slate-900">{title}</h2>
            </div>
          </div>
          <p className="mt-3 max-w-3xl text-sm text-slate-600">{subtitle}</p>
        </div>

        <div className="flex flex-wrap gap-3">
          <DiagnosticStatusBadge status={diagnostics?.status || diagnostics?.validationStatus} />
          <button
            type="button"
            onClick={onRefreshDiagnostics}
            disabled={loadingDiagnostics}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Search className={`h-4 w-4 ${loadingDiagnostics ? 'animate-spin' : ''}`} />
            Atualizar diagnostico
          </button>
          <button
            type="button"
            onClick={onTestConnection}
            disabled={testingConnection}
            className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <PlugZap className={`h-4 w-4 ${testingConnection ? 'animate-pulse' : ''}`} />
            {testingConnection ? 'Testando...' : 'Testar conexao'}
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm font-semibold text-sky-700 transition hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Save className="h-4 w-4" />
            {busy ? 'Salvando...' : 'Salvar e reiniciar'}
          </button>
          {allowClose && (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
            >
              <X className="h-4 w-4" />
              Fechar
            </button>
          )}
        </div>
      </div>

      <div className="mt-5">
        <NoticeBanner notice={notice} />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <DiagnosticField label="Arquitetura do SO" value={diagnostics?.systemArchitecture} />
        <DiagnosticField label="Arquitetura do processo" value={diagnostics?.processArchitecture} />
        <DiagnosticField label="Runtime" value={diagnostics?.runtimeVersion} />
        <DiagnosticField label="Provider selecionado" value={diagnostics?.providerSelected || diagnostics?.providerRequested} />
        <DiagnosticField label="Driver" value={diagnostics?.driverVersion || '--'} />
        <DiagnosticField label="fbclient.dll" value={diagnostics?.clientPath} tone={diagnostics?.validationStatus === 'valid' ? 'success' : 'danger'} />
        <DiagnosticField label="Arquitetura da DLL" value={diagnostics?.clientArchitecture} />
        <DiagnosticField label="Versao da DLL" value={diagnostics?.clientVersion} />
        <DiagnosticField label="Host" value={diagnostics?.host} />
        <DiagnosticField label="Porta" value={diagnostics?.port} />
        <DiagnosticField label="Banco" value={diagnostics?.database} />
        <DiagnosticField label="Charset" value={diagnostics?.charset} />
        <DiagnosticField label="Modo" value={diagnostics?.connectionMode} />
        <DiagnosticField label="Status de validacao" value={diagnostics?.status || diagnostics?.validationStatus} />
        <DiagnosticField label="Ultimo erro" value={diagnostics?.lastConnectionError?.message || diagnostics?.error} tone={diagnostics?.lastConnectionError?.message || diagnostics?.error ? 'danger' : 'default'} />
        <DiagnosticField label="Arquivo .env" value={diagnostics?.envFile} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-2">
        <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
          <div className="flex items-center gap-3">
            <HardDrive className="h-5 w-5 text-slate-600" />
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Firebird</p>
              <h3 className="text-base font-black text-slate-900">Banco, DLL e provider</h3>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
            <TextField label="Host do Firebird" value={settingsForm.firebird.host} onChange={(value) => onFieldChange('firebird', 'host', value)} />
            <TextField label="Porta do Firebird" value={settingsForm.firebird.port} onChange={(value) => onFieldChange('firebird', 'port', value)} />
            <TextField label="Charset" value={settingsForm.firebird.charset} onChange={(value) => onFieldChange('firebird', 'charset', value)} />
            <SelectField
              label="Modo de conexao"
              value={settingsForm.firebird.connectionMode}
              onChange={(value) => onFieldChange('firebird', 'connectionMode', value)}
              options={[
                { value: 'AUTO', label: 'AUTO' },
                { value: 'LOCAL_PATH', label: 'LOCAL_PATH' },
                { value: 'LOCAL_ALIAS', label: 'LOCAL_ALIAS' },
                { value: 'REMOTE', label: 'REMOTE' },
              ]}
            />
            <div className="lg:col-span-2">
              <TextField
                label="Banco (caminho ou alias)"
                value={settingsForm.firebird.database}
                onChange={(value) => onFieldChange('firebird', 'database', value)}
                placeholder="C:\\Dados\\DADOS.FDB"
              />
            </div>
            <TextField label="Usuario" value={settingsForm.firebird.user} onChange={(value) => onFieldChange('firebird', 'user', value)} />
            <TextField label="Senha" type="password" value={settingsForm.firebird.password} onChange={(value) => onFieldChange('firebird', 'password', value)} />
            <div className="lg:col-span-2">
              <TextField
                label="Caminho da fbclient.dll"
                value={settingsForm.firebird.clientPath}
                onChange={(value) => onFieldChange('firebird', 'clientPath', value)}
                placeholder="C:\\Program Files\\Firebird\\Firebird_3_0\\fbclient.dll"
              />
            </div>
            <SelectField
              label="Arquitetura"
              value={settingsForm.firebird.arch}
              onChange={(value) => onFieldChange('firebird', 'arch', value)}
              options={[
                { value: 'AUTO', label: 'AUTO' },
                { value: 'X86', label: 'X86' },
                { value: 'X64', label: 'X64' },
              ]}
            />
            <SelectField
              label="Provider"
              value={settingsForm.firebird.provider}
              onChange={(value) => onFieldChange('firebird', 'provider', value)}
              options={[
                { value: 'AUTO', label: 'AUTO' },
                { value: 'FDB', label: 'FDB' },
                { value: 'FIREBIRD_DRIVER', label: 'FIREBIRD_DRIVER' },
              ]}
            />
          </div>
        </div>

        <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
          <div className="flex items-center gap-3">
            <KeyRound className="h-5 w-5 text-slate-600" />
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Licenca e acesso</p>
              <h3 className="text-base font-black text-slate-900">Dados locais do aplicativo</h3>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="lg:col-span-2">
              <TextField
                label="Chave da licenca"
                value={settingsForm.license.licenseKey}
                onChange={(value) => onFieldChange('license', 'licenseKey', value)}
              />
            </div>
            <TextField
              label="CNPJ"
              value={settingsForm.license.cnpj}
              onChange={(value) => onFieldChange('license', 'cnpj', value)}
            />
            <TextField
              label="Project slug"
              value={settingsForm.license.projectSlug}
              onChange={(value) => onFieldChange('license', 'projectSlug', value)}
            />
            <div className="lg:col-span-2">
              <TextField
                label="API de licenca"
                value={settingsForm.license.apiUrl}
                onChange={(value) => onFieldChange('license', 'apiUrl', value)}
              />
            </div>
            <TextField
              label="Usuario do app"
              value={settingsForm.auth.username}
              onChange={(value) => onFieldChange('auth', 'username', value)}
            />
            <TextField
              label="Senha do app"
              type="password"
              value={settingsForm.auth.password}
              onChange={(value) => onFieldChange('auth', 'password', value)}
            />
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="rounded-[24px] border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-3">
            <Cpu className="h-5 w-5 text-slate-600" />
            <h3 className="text-sm font-black uppercase tracking-[0.16em] text-slate-700">Providers disponiveis</h3>
          </div>
          <div className="mt-3 space-y-3">
            {(diagnostics?.driverCandidates || []).map((item) => (
              <div key={item.provider} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-sm font-bold text-slate-900">{item.provider}</p>
                <p className="mt-1 text-xs font-medium text-slate-500">Versao: {item.version || 'nao instalado'}</p>
                <p className="mt-2 text-sm text-slate-600">{item.supports}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[24px] border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-3">
            <Search className="h-5 w-5 text-slate-600" />
            <h3 className="text-sm font-black uppercase tracking-[0.16em] text-slate-700">DLLs avaliadas</h3>
          </div>
          <div className="mt-3 space-y-3">
            {(diagnostics?.candidates || []).length > 0 ? (
              diagnostics.candidates.map((candidate) => (
                <div
                  key={`${candidate.path}-${candidate.source}`}
                  className={`rounded-2xl border p-3 ${
                    candidate.status === 'valid'
                      ? 'border-emerald-200 bg-emerald-50'
                      : 'border-amber-200 bg-amber-50'
                  }`}
                >
                  <p className="break-words text-sm font-semibold text-slate-900">{candidate.path}</p>
                  <p className="mt-1 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
                    {candidate.source} - {candidate.architecture || 'arquitetura desconhecida'}
                  </p>
                  <p className="mt-2 text-sm text-slate-700">
                    {candidate.status === 'valid' ? 'Selecionada e validada para o processo atual.' : candidate.rejection_reason}
                  </p>
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                Nenhuma DLL foi localizada ainda nos caminhos pesquisados.
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
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
  const [diagnostics, setDiagnostics] = useState(null)
  const [settingsForm, setSettingsForm] = useState(() => createEmptySettingsForm())
  const [loadingDiagnostics, setLoadingDiagnostics] = useState(false)
  const [testingConnection, setTestingConnection] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)
  const [restartingBackend, setRestartingBackend] = useState(false)
  const [settingsNotice, setSettingsNotice] = useState(null)
  const [showConfiguration, setShowConfiguration] = useState(false)
  const [startupState, setStartupState] = useState(null)
  const [retryingStartup, setRetryingStartup] = useState(false)
  const calendarRef = useRef(null)

  const {
    session,
    licenseError,
    offlineMode,
    isReady,
    apiUrl,
    apiError,
    verifySession,
    reloadApiUrl,
  } = useLicense()

  const hasLicense = !!session && ['active', 'grace'].includes(session.status)
  const configurationRequired = LICENSE_CONFIGURATION_REQUIRED_CODES.has(licenseError?.code)
  const licenseBlocked = !!licenseError && !hasLicense && DEFINITIVE_LICENSE_BLOCK_CODES.has(licenseError.code)
  const apiUnavailable = !apiUrl && (!!apiError || startupState?.status === 'error')
  const showStandaloneConfiguration = configurationRequired || (!hasLicense && showConfiguration)

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

  const updateSettingsField = useCallback((section, field, value) => {
    setSettingsForm((current) => ({
      ...current,
      [section]: {
        ...current[section],
        [field]: value,
      },
    }))
  }, [])

  const refreshStartupState = useCallback(async () => {
    const nextState = await getStartupState()
    setStartupState(nextState)
    return nextState
  }, [])

  const waitForApiAvailability = useCallback(async (timeoutMs = 30000) => {
    const startedAt = Date.now()
    let lastError = null

    while (Date.now() - startedAt < timeoutMs) {
      try {
        return await reloadApiUrl()
      } catch (err) {
        lastError = err
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
    }

    throw lastError || new Error('A API local nao respondeu novamente a tempo.')
  }, [reloadApiUrl])

  const syncSettingsFromResponse = useCallback((payload) => {
    setSettingsForm(normalizeSettingsResponse(payload))
    if (payload?.diagnostics) {
      setDiagnostics(payload.diagnostics)
    }
  }, [])

  const loadSettings = useCallback(async () => {
    if (!apiUrl) return null

    setLoadingDiagnostics(true)
    try {
      const response = await axios.get(`${apiUrl}/settings`, { timeout: 15000 })
      syncSettingsFromResponse(response.data)
      return response.data
    } catch (err) {
      console.error('Erro ao carregar configuracoes locais:', err)
      setSettingsNotice({
        tone: 'danger',
        message: err.response?.data?.error || 'Nao foi possivel carregar as configuracoes locais.',
      })
      return null
    } finally {
      setLoadingDiagnostics(false)
    }
  }, [apiUrl, syncSettingsFromResponse])

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
      const backendMessage = err.response?.data?.details || err.response?.data?.error
      setError(backendMessage || 'Nao foi possivel sincronizar os dados da agenda no momento.')
      setEvents([])
    } finally {
      setLoading(false)
    }
  }, [apiUrl, session])

  const fetchDiagnostics = useCallback(async () => {
    if (!apiUrl) return

    setLoadingDiagnostics(true)
    try {
      const response = await axios.get(`${apiUrl}/diagnostics/firebird`, {
        timeout: 15000,
      })
      setDiagnostics(response.data)
    } catch (err) {
      console.error('Erro ao carregar diagnostico Firebird:', err)
      setSettingsNotice({
        tone: 'danger',
        message: err.response?.data?.error || 'Nao foi possivel carregar o diagnostico Firebird.',
      })
    } finally {
      setLoadingDiagnostics(false)
    }
  }, [apiUrl])

  const runDiagnosticConnectionTest = useCallback(async () => {
    if (!apiUrl) return

    setTestingConnection(true)
    setSettingsNotice(null)

    try {
      const response = await axios.post(`${apiUrl}/diagnostics/firebird/test`, {
        ...settingsForm.firebird,
      }, { timeout: 30000 })

      setDiagnostics(response.data.diagnostics)
      setSettingsNotice({
        tone: 'success',
        message: 'Teste de conexao concluido com sucesso.',
      })
    } catch (err) {
      console.error('Erro ao testar conexao Firebird:', err)
      const payload = err.response?.data?.detail || err.response?.data || {}
      if (payload && typeof payload === 'object') {
        setDiagnostics(payload)
      }
      setSettingsNotice({
        tone: 'danger',
        message: payload?.error || 'O teste de conexao falhou. Revise a DLL e os dados do banco.',
      })
    } finally {
      setTestingConnection(false)
    }
  }, [apiUrl, settingsForm])

  const saveSettings = useCallback(async () => {
    if (!apiUrl) return

    setSavingSettings(true)
    setSettingsNotice(null)

    try {
      const response = await axios.post(`${apiUrl}/settings`, settingsForm, { timeout: 20000 })
      syncSettingsFromResponse(response.data)
      setSettingsNotice({
        tone: 'success',
        message: 'Configuracao salva. Reiniciando o backend local para aplicar as alteracoes.',
      })

      setRestartingBackend(true)
      if (hasDesktopBridge()) {
        const nextStartupState = await restartApi()
        setStartupState(nextStartupState)
      }

      await waitForApiAvailability()
      await refreshStartupState()
      await loadSettings()
      const nextSession = await verifySession()

      if (nextSession) {
        setShowConfiguration(false)
        setSettingsNotice({
          tone: 'success',
          message: 'Configuracao salva, backend reiniciado e licenca validada com sucesso.',
        })
      } else if (response.data?.license?.configured) {
        setSettingsNotice({
          tone: 'warning',
          message: 'As configuracoes foram salvas, mas a licenca ainda precisa ser validada novamente.',
        })
      } else {
        setSettingsNotice({
          tone: 'warning',
          message: 'As configuracoes foram salvas. Se a licenca ainda nao foi preenchida, complete os dados para continuar.',
        })
      }
    } catch (err) {
      console.error('Erro ao salvar configuracoes locais:', err)
      setSettingsNotice({
        tone: 'danger',
        message: err.response?.data?.error || err.message || 'Nao foi possivel salvar as configuracoes locais.',
      })
    } finally {
      setSavingSettings(false)
      setRestartingBackend(false)
    }
  }, [apiUrl, settingsForm, syncSettingsFromResponse, waitForApiAvailability, refreshStartupState, loadSettings, verifySession])

  const handleRetryStartup = useCallback(async () => {
    setRetryingStartup(true)
    try {
      const nextState = hasDesktopBridge() ? await retryApiStart() : await refreshStartupState()
      setStartupState(nextState)
      if (nextState?.status === 'ready') {
        await waitForApiAvailability()
        await loadSettings()
        await verifySession()
      }
    } catch (err) {
      console.error('Erro ao tentar iniciar a API novamente:', err)
      setSettingsNotice({
        tone: 'danger',
        message: err.message || 'Nao foi possivel iniciar a API novamente.',
      })
    } finally {
      setRetryingStartup(false)
    }
  }, [loadSettings, refreshStartupState, verifySession, waitForApiAvailability])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void refreshStartupState()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [refreshStartupState])

  useEffect(() => {
    void verifySession()
  }, [verifySession])

  useEffect(() => {
    if (!apiUrl) return

    const timeoutId = window.setTimeout(() => {
      void loadSettings()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [apiUrl, loadSettings])

  useEffect(() => {
    if (!hasLicense || !apiUrl || !isLoggedIn) return
    const tid = setTimeout(() => { void fetchAgendamentos() }, 0)
    return () => clearTimeout(tid)
  }, [hasLicense, apiUrl, isLoggedIn, fetchAgendamentos])

  useEffect(() => {
    if (!hasLicense || !apiUrl || !isLoggedIn || !showConfiguration) return
    const tid = setTimeout(() => { void fetchDiagnostics() }, 0)
    return () => clearTimeout(tid)
  }, [hasLicense, apiUrl, isLoggedIn, showConfiguration, fetchDiagnostics])

  useEffect(() => {
    if (!hasLicense || !apiUrl || !isLoggedIn) return
    const intervalId = window.setInterval(() => {
      void fetchAgendamentos()
    }, 120000)

    return () => window.clearInterval(intervalId)
  }, [hasLicense, apiUrl, isLoggedIn, fetchAgendamentos])

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
          <p className="text-lg font-semibold text-gray-800">Inicializando aplicativo...</p>
          <p className="mt-3 text-sm text-gray-500">Aguarde enquanto a API local e a licenca sao verificadas.</p>
        </div>
      </div>
    )
  }

  if (apiUnavailable) {
    return (
      <StartupDiagnosticScreen
        startupState={startupState || {
          status: 'error',
          code: apiError?.code || 'API_UNAVAILABLE',
          message: apiError?.message || 'Nao foi possivel encontrar a API local.',
          details: null,
          apiPort: null,
          externalApiInUse: false,
          logLines: [],
        }}
        onRetry={() => {
          void handleRetryStartup()
        }}
        onOpenDataDir={() => {
          void openDataDir()
        }}
        onOpenLogs={() => {
          void openLogDir()
        }}
        retrying={retryingStartup}
      />
    )
  }

  if (showStandaloneConfiguration) {
    const standaloneTitle = configurationRequired
      ? 'Configuracao inicial do Agenda LMD Preview'
      : licenseBlocked
        ? 'Revisar configuracoes apos bloqueio de licenca'
        : 'Configuracoes locais do Agenda LMD Preview'
    const standaloneSubtitle = configurationRequired
      ? 'A API local ja esta rodando. Agora voce pode salvar Firebird, DLL, licenca e credenciais sem depender de PowerShell, e o backend sera reiniciado automaticamente apos o salvamento.'
      : 'Edite banco, Firebird, DLL, licenca e credenciais em uma tela dedicada. O backend sera reiniciado automaticamente apos o salvamento.'
    const standaloneNotice = configurationRequired
      ? (settingsNotice || {
          tone: 'warning',
          message: 'A licenca ainda nao esta configurada no .env. Preencha os dados abaixo, teste a conexao e salve para continuar.',
        })
      : settingsNotice

    return (
      <div className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6">
        <div className="mx-auto w-full max-w-[1400px]">
          <ConfigurationWorkspace
            title={standaloneTitle}
            subtitle={standaloneSubtitle}
            settingsForm={settingsForm}
            diagnostics={diagnostics}
            notice={standaloneNotice}
            loadingDiagnostics={loadingDiagnostics}
            testingConnection={testingConnection}
            savingSettings={savingSettings}
            restartingBackend={restartingBackend}
            onFieldChange={updateSettingsField}
            onRefreshDiagnostics={() => {
              void fetchDiagnostics()
            }}
            onTestConnection={() => {
              void runDiagnosticConnectionTest()
            }}
            onSave={() => {
              void saveSettings()
            }}
            onClose={() => setShowConfiguration(false)}
            allowClose={!configurationRequired}
          />
        </div>
      </div>
    )
  }

  if (licenseBlocked) {
    return (
      <LicenseBlockedScreen
        licenseError={licenseError}
        onOpenConfiguration={() => setShowConfiguration(true)}
        onRetry={() => {
          void verifySession()
        }}
      />
    )
  }

  if (!hasLicense) {
    return (
      <LicenseTroubleshootingScreen
        licenseError={licenseError}
        onRetry={() => {
          void verifySession()
        }}
        onOpenConfiguration={() => setShowConfiguration(true)}
      />
    )
  }

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-xl">
          <div className="mb-6 text-center">
            <div className="mb-5 flex justify-center">
              <BrandMark compact className="justify-center text-left" />
            </div>
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

          {licenseError && (
            <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-800">
              {licenseError.message}
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
              <button
                type="button"
                onClick={() => setShowConfiguration((current) => !current)}
                className="font-semibold text-blue-600 hover:text-blue-700"
              >
                Configuracoes
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

          {showConfiguration && (
            <div className="mt-6">
              <ConfigurationWorkspace
                title="Configuracoes locais"
                subtitle="Edite banco, DLL, provider, licenca e credenciais sem depender da primeira execucao."
                settingsForm={settingsForm}
                diagnostics={diagnostics}
                notice={settingsNotice}
                loadingDiagnostics={loadingDiagnostics}
                testingConnection={testingConnection}
                savingSettings={savingSettings}
                restartingBackend={restartingBackend}
                onFieldChange={updateSettingsField}
                onRefreshDiagnostics={() => {
                  void fetchDiagnostics()
                }}
                onTestConnection={() => {
                  void runDiagnosticConnectionTest()
                }}
                onSave={() => {
                  void saveSettings()
                }}
                onClose={() => setShowConfiguration(false)}
                allowClose
              />
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans">
      <header className="bg-white border-b border-gray-200 px-4 py-4 shadow-sm sticky top-0 z-10 sm:px-6">
        <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <BrandMark compact className="min-w-0" />
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
              onClick={() => setShowConfiguration((current) => !current)}
              className="flex items-center justify-center gap-2 bg-white border border-gray-300 hover:bg-gray-50 hover:border-gray-400 text-gray-700 px-4 py-2.5 rounded-xl font-medium transition-all shadow-sm active:scale-95"
            >
              <Settings2 className="w-4 h-4" />
              {showConfiguration ? 'Fechar configuracoes' : 'Configuracoes'}
            </button>
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
        <div className="mx-auto mt-4 w-full max-w-[1400px] px-4 sm:px-6">
          <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-r-lg flex items-center gap-3 shadow-sm">
            <AlertCircle className="w-5 h-5 text-red-500" />
            <p className="text-red-700 text-sm font-medium">{error}</p>
          </div>
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
        {showConfiguration && (
          <div className="mb-6">
            <ConfigurationWorkspace
              title="Configuracoes locais do Agenda LMD Preview"
              subtitle="Edite banco, Firebird, DLL, licenca e credenciais a qualquer momento. O backend e reiniciado automaticamente apos o salvamento."
              settingsForm={settingsForm}
              diagnostics={diagnostics}
              notice={settingsNotice}
              loadingDiagnostics={loadingDiagnostics}
              testingConnection={testingConnection}
              savingSettings={savingSettings}
              restartingBackend={restartingBackend}
              onFieldChange={updateSettingsField}
              onRefreshDiagnostics={() => {
                void fetchDiagnostics()
              }}
              onTestConnection={() => {
                void runDiagnosticConnectionTest()
              }}
              onSave={() => {
                void saveSettings()
              }}
              onClose={() => setShowConfiguration(false)}
              allowClose
            />
          </div>
        )}

        {!showConfiguration && diagnostics?.validationStatus && diagnostics.validationStatus !== 'valid' && (
          <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
            A API esta rodando, mas a configuracao atual do Firebird ainda requer atencao. Abra "Configuracoes" para revisar DLL, provider e conexao.
          </div>
        )}

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
                list: 'Lista',
              }}
              allDaySlot={false}
              slotMinTime="07:00:00"
              slotMaxTime="20:00:00"
              height={getCalendarSettings(viewportMode).height}
              dayMaxEvents
              slotDuration="00:30:00"
              slotLabelInterval="00:30:00"
              defaultTimedEventDuration="00:30:00"
              eventDisplay="block"
              nowIndicator
              dayHeaderFormat={viewportMode === 'mobile' ? { weekday: 'short' } : { weekday: 'short', day: '2-digit', month: '2-digit' }}
              slotLabelFormat={{
                hour: '2-digit',
                minute: '2-digit',
                omitZeroMinute: false,
                meridiem: false,
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
                    <div className="h-3 bg-blue-200/50 rounded w-3/4" />
                    <div className="h-3 bg-blue-200/50 rounded w-5/6" />
                    <div className="h-3 bg-blue-200/50 rounded w-2/3" />
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
