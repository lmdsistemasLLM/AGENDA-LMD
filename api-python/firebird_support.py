import ctypes
import datetime as dt
import importlib
import importlib.metadata
import os
import platform
import struct
import sys
from collections.abc import Iterable
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from config_store import (
    get_saved_firebird_settings,
    logs_dir,
    preferred_env_path,
)


DEFAULT_DATABASE = r"C:\CAMINHO\BANCO.FDB"
DEFAULT_PORT = 3050
DEFAULT_CHARSET = "UTF8"
DEFAULT_PROVIDER = "AUTO"
DEFAULT_ARCH = "AUTO"
COMMON_SEARCH_ROOTS = [
    Path(r"C:\Program Files\Firebird"),
    Path(r"C:\Program Files (x86)\Firebird"),
    Path(r"C:\Firebird"),
    Path(r"C:\DataGoo"),
    Path(r"C:\LMD"),
]
SUPPORTED_ARCHITECTURES = {"X86", "X64"}
SUPPORTED_PROVIDERS = {"AUTO", "FDB", "FIREBIRD_DRIVER"}
SEARCH_GLOBS = [
    "fbclient.dll",
    "*/fbclient.dll",
    "*/*/fbclient.dll",
    "*/*/*/fbclient.dll",
    "*/*/*/*/fbclient.dll",
]
FDB_PROVIDER = "FDB"
MODERN_PROVIDER = "FIREBIRD_DRIVER"
_LAST_ERROR: dict[str, Any] | None = None


class VS_FIXEDFILEINFO(ctypes.Structure):
    _fields_ = [
        ("dwSignature", ctypes.c_uint32),
        ("dwStrucVersion", ctypes.c_uint32),
        ("dwFileVersionMS", ctypes.c_uint32),
        ("dwFileVersionLS", ctypes.c_uint32),
        ("dwProductVersionMS", ctypes.c_uint32),
        ("dwProductVersionLS", ctypes.c_uint32),
        ("dwFileFlagsMask", ctypes.c_uint32),
        ("dwFileFlags", ctypes.c_uint32),
        ("dwFileOS", ctypes.c_uint32),
        ("dwFileType", ctypes.c_uint32),
        ("dwFileSubtype", ctypes.c_uint32),
        ("dwFileDateMS", ctypes.c_uint32),
        ("dwFileDateLS", ctypes.c_uint32),
    ]


class FirebirdConfigurationError(RuntimeError):
    def __init__(self, message: str, diagnostics: dict[str, Any] | None = None):
        super().__init__(message)
        self.diagnostics = diagnostics or {}


@dataclass
class ClientCandidate:
    path: str
    source: str
    exists: bool
    architecture: str | None
    version: str | None
    compatible_with_process: bool
    loadable: bool
    status: str
    rejection_reason: str | None = None
    selected: bool = False


def _kernel32() -> ctypes.WinDLL:
    library = ctypes.WinDLL("kernel32", use_last_error=True)
    library.LoadLibraryW.argtypes = [ctypes.c_wchar_p]
    library.LoadLibraryW.restype = ctypes.c_void_p
    library.FreeLibrary.argtypes = [ctypes.c_void_p]
    library.FreeLibrary.restype = ctypes.c_int
    return library


def _version_dll() -> ctypes.WinDLL:
    return ctypes.WinDLL("version", use_last_error=True)


def write_runtime_log(category: str, message: str) -> None:
    try:
        target = logs_dir() / f"{category}.log"
        timestamp = dt.datetime.now(dt.timezone.utc).isoformat()
        with target.open("a", encoding="utf-8") as handle:
            handle.write(f"[{timestamp}] {message}\n")
    except Exception:
        return


def _normalized_text(value: str | None) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _env_value(*names: str) -> str | None:
    for name in names:
        value = _normalized_text(os.getenv(name))
        if value is not None:
            return value
    return None


def _normalized_arch(value: str | None) -> str:
    text = (_normalized_text(value) or DEFAULT_ARCH).upper()
    if text in SUPPORTED_ARCHITECTURES or text == "AUTO":
        return text
    return DEFAULT_ARCH


def _normalized_provider(value: str | None) -> str:
    text = (_normalized_text(value) or DEFAULT_PROVIDER).upper()
    if text in SUPPORTED_PROVIDERS:
        return text
    return DEFAULT_PROVIDER


def process_architecture() -> str:
    return "X64" if struct.calcsize("P") * 8 == 64 else "X86"


def os_architecture() -> str:
    if _normalized_text(os.getenv("PROCESSOR_ARCHITEW6432")):
        return "X64"

    candidates = [
        os.getenv("PROCESSOR_ARCHITECTURE"),
        platform.machine(),
        platform.architecture()[0],
    ]
    return "X64" if any("64" in str(item) for item in candidates if item) else "X86"


def runtime_version_label() -> str:
    return f"Python {platform.python_version()} ({process_architecture()})"


def _looks_like_windows_path(value: str | None) -> bool:
    text = str(value or "")
    return len(text) > 2 and text[1:3] == ":\\"


def connection_mode(host: str, database: str) -> str:
    normalized_host = str(host).strip().lower()
    if normalized_host in {"", "localhost", "127.0.0.1"} and _looks_like_windows_path(database):
        return "LOCAL_PATH"
    if normalized_host in {"", "localhost", "127.0.0.1"}:
        return "LOCAL_ALIAS"
    return "REMOTE"


def current_settings() -> dict[str, Any]:
    saved = get_saved_firebird_settings()
    return {
        "host": _env_value("FIREBIRD_HOST", "FB_HOST") or "127.0.0.1",
        "port": int(_env_value("FIREBIRD_PORT", "FB_PORT") or str(DEFAULT_PORT)),
        "database": _env_value("FIREBIRD_DATABASE", "FB_DATABASE") or DEFAULT_DATABASE,
        "user": _env_value("FIREBIRD_USER", "FB_USER") or "SYSDBA",
        "password": _env_value("FIREBIRD_PASSWORD", "FB_PASSWORD") or "",
        "charset": _env_value("FIREBIRD_CHARSET", "FB_CHARSET") or DEFAULT_CHARSET,
        "client_path": _env_value(
            "FIREBIRD_SELECTED_CLIENT_PATH",
            "FIREBIRD_CLIENT_PATH",
            "FBCLIENT_PATH",
            "FB_CLIENT_LIBRARY",
        ),
        "requested_arch": _normalized_arch(_env_value("FIREBIRD_ARCH", "FB_ARCH") or str(saved.get("arch") or DEFAULT_ARCH)),
        "provider": _normalized_provider(
            _env_value("FIREBIRD_PROVIDER", "FB_PROVIDER", "FIREBIRD_DRIVER")
            or str(saved.get("provider") or DEFAULT_PROVIDER)
        ),
        "saved_client_path": _normalized_text(str(saved.get("client_path") or "")),
        "env_file": str(preferred_env_path()),
    }


def _normalize_candidate_path(path_value: str | None) -> Path | None:
    text = _normalized_text(path_value)
    if not text:
        return None

    path = Path(text.strip('"').strip("'"))
    if path.is_dir():
        path = path / "fbclient.dll"
    return path


def _file_version(path: Path) -> str | None:
    try:
        version_lib = _version_dll()
        size = version_lib.GetFileVersionInfoSizeW(str(path), None)
        if not size:
            return None

        buffer = ctypes.create_string_buffer(size)
        if not version_lib.GetFileVersionInfoW(str(path), 0, size, buffer):
            return None

        info_ptr = ctypes.c_void_p()
        info_len = ctypes.c_uint()
        if not version_lib.VerQueryValueW(buffer, "\\", ctypes.byref(info_ptr), ctypes.byref(info_len)):
            return None

        info = ctypes.cast(info_ptr, ctypes.POINTER(VS_FIXEDFILEINFO)).contents
        return ".".join(
            [
                str(info.dwFileVersionMS >> 16),
                str(info.dwFileVersionMS & 0xFFFF),
                str(info.dwFileVersionLS >> 16),
                str(info.dwFileVersionLS & 0xFFFF),
            ]
        )
    except Exception:
        return None


def _pe_architecture(path: Path) -> str | None:
    try:
        with path.open("rb") as handle:
            header = handle.read(64)
            if len(header) < 64 or header[:2] != b"MZ":
                return None

            pe_offset = int.from_bytes(header[60:64], "little")
            handle.seek(pe_offset)
            if handle.read(4) != b"PE\x00\x00":
                return None

            machine = int.from_bytes(handle.read(2), "little")
    except OSError:
        return None

    return {
        0x14C: "X86",
        0x8664: "X64",
    }.get(machine)


def _attempt_library_load(path: Path) -> tuple[bool, str | None]:
    try:
        handle = _kernel32().LoadLibraryW(str(path))
        if handle:
            _kernel32().FreeLibrary(handle)
            return True, None

        error_code = ctypes.get_last_error()
        return False, ctypes.FormatError(error_code) or f"Windows error {error_code}"
    except OSError as exc:
        return False, str(exc)


def _search_roots_from_settings(settings: dict[str, Any]) -> list[Path]:
    roots = list(COMMON_SEARCH_ROOTS)
    database_path = _normalize_candidate_path(settings.get("database"))
    if database_path and _looks_like_windows_path(str(database_path)):
        roots.extend([
            database_path.parent,
            database_path.parent.parent if database_path.parent.parent != database_path.parent else database_path.parent,
        ])

    executable_dir = Path(sys.executable).resolve().parent
    roots.extend([Path.cwd(), executable_dir])

    deduped: list[Path] = []
    seen: set[str] = set()
    for root in roots:
        normalized = str(root.resolve(strict=False)).lower()
        if normalized in seen:
            continue
        seen.add(normalized)
        deduped.append(root)
    return deduped


def _search_auto_client_paths(settings: dict[str, Any]) -> tuple[list[Path], list[str]]:
    discovered: list[Path] = []
    checked: list[str] = []
    seen: set[str] = set()

    for root in _search_roots_from_settings(settings):
        checked.append(str(root))
        if not root.exists():
            continue

        for pattern in SEARCH_GLOBS:
            try:
                for candidate in root.glob(pattern):
                    if not candidate.is_file() or candidate.name.lower() != "fbclient.dll":
                        continue
                    normalized = str(candidate.resolve(strict=False)).lower()
                    if normalized in seen:
                        continue
                    seen.add(normalized)
                    discovered.append(candidate)
            except OSError:
                continue

    return discovered, checked


def _candidate_from_path(path: Path, source: str, process_arch: str, requested_arch: str) -> ClientCandidate:
    exists = path.exists()
    architecture = _pe_architecture(path) if exists else None
    version = _file_version(path) if exists else None
    rejection_reason = None
    compatible_with_process = architecture == process_arch
    loadable = False
    status = "rejected"

    if not exists:
        rejection_reason = "Arquivo nao encontrado."
    elif architecture not in SUPPORTED_ARCHITECTURES:
        rejection_reason = "Arquitetura PE nao reconhecida."
    elif requested_arch != "AUTO" and architecture != requested_arch:
        rejection_reason = (
            f"A DLL possui arquitetura {architecture}, mas a configuracao exige {requested_arch}."
        )
    elif architecture != process_arch:
        rejection_reason = (
            f"A DLL possui arquitetura {architecture}, mas o processo atual exige {process_arch}."
        )
    else:
        loadable, load_error = _attempt_library_load(path)
        if not loadable:
            rejection_reason = f"Falha ao carregar a DLL: {load_error}"
        else:
            status = "valid"

    candidate = ClientCandidate(
        path=str(path),
        source=source,
        exists=exists,
        architecture=architecture,
        version=version,
        compatible_with_process=compatible_with_process,
        loadable=loadable,
        status=status,
        rejection_reason=rejection_reason,
    )
    write_runtime_log(
        "dll-validation",
        f"{candidate.path} | source={source} | status={candidate.status} | reason={candidate.rejection_reason or 'OK'}",
    )
    return candidate


def resolve_client_library() -> dict[str, Any]:
    settings = current_settings()
    proc_arch = process_architecture()
    sys_arch = os_architecture()
    requested_arch = settings["requested_arch"]
    warnings: list[str] = []

    if requested_arch != "AUTO" and requested_arch != proc_arch:
        warnings.append(
            f"A configuracao solicita {requested_arch}, mas o processo atual e {proc_arch}. Apenas DLLs {proc_arch} podem ser carregadas."
        )

    ordered_sources: list[tuple[str, Path]] = []
    seen_paths: set[str] = set()

    manual_path = _normalize_candidate_path(settings.get("client_path"))
    if manual_path:
        ordered_sources.append(("env", manual_path))
        seen_paths.add(str(manual_path.resolve(strict=False)).lower())

    saved_path = _normalize_candidate_path(settings.get("saved_client_path"))
    if saved_path:
        normalized = str(saved_path.resolve(strict=False)).lower()
        if normalized not in seen_paths:
            ordered_sources.append(("saved", saved_path))
            seen_paths.add(normalized)

    auto_candidates, checked_roots = _search_auto_client_paths(settings)
    for candidate in auto_candidates:
        normalized = str(candidate.resolve(strict=False)).lower()
        if normalized in seen_paths:
            continue
        ordered_sources.append(("auto", candidate))
        seen_paths.add(normalized)

    candidates = [
        _candidate_from_path(path, source, proc_arch, requested_arch)
        for source, path in ordered_sources
    ]

    selected = next((candidate for candidate in candidates if candidate.status == "valid"), None)
    if selected:
        selected.selected = True

    diagnostics = {
        "envFile": settings["env_file"],
        "systemArchitecture": sys_arch,
        "processArchitecture": proc_arch,
        "runtimeVersion": runtime_version_label(),
        "runtimeExecutable": sys.executable,
        "requestedArchitecture": requested_arch,
        "providerRequested": settings["provider"],
        "host": settings["host"],
        "port": settings["port"],
        "database": settings["database"],
        "charset": settings["charset"],
        "connectionMode": connection_mode(settings["host"], settings["database"]),
        "passwordConfigured": bool(settings["password"]),
        "searchRoots": checked_roots,
        "warnings": warnings,
        "candidates": [asdict(candidate) for candidate in candidates],
        "clientPath": selected.path if selected else None,
        "clientArchitecture": selected.architecture if selected else None,
        "clientVersion": selected.version if selected else None,
        "clientSource": selected.source if selected else None,
        "validationStatus": "valid" if selected else "invalid",
        "manualSelectionRequired": selected is None,
        "lastConnectionError": _LAST_ERROR,
    }
    write_runtime_log(
        "firebird-detection",
        f"status={diagnostics['validationStatus']} | selected={diagnostics['clientPath'] or 'none'} | process={proc_arch} | system={sys_arch}",
    )
    return diagnostics


def _module_version(module_name: str) -> str | None:
    try:
        package_name = {
            "fdb": "fdb",
            "firebird.driver": "firebird-driver",
        }.get(module_name, module_name)
        return importlib.metadata.version(package_name)
    except Exception:
        try:
            module = importlib.import_module(module_name)
            return getattr(module, "__version__", None)
        except Exception:
            return None


def provider_availability() -> list[dict[str, Any]]:
    modern_version = _module_version("firebird.driver")
    fdb_version = _module_version("fdb")
    return [
        {
            "provider": FDB_PROVIDER,
            "available": fdb_version is not None,
            "version": fdb_version,
            "supports": "Firebird 2.5 e cenarios legados; suporte limitado em versoes mais novas.",
        },
        {
            "provider": MODERN_PROVIDER,
            "available": modern_version is not None,
            "version": modern_version,
            "supports": "Firebird 3+ com o driver oficial moderno.",
        },
    ]


def preferred_providers(diagnostics: dict[str, Any]) -> list[str]:
    requested = diagnostics["providerRequested"]
    client_version = diagnostics.get("clientVersion") or ""
    client_major = 0
    if client_version:
        try:
            client_major = int(str(client_version).split(".", 1)[0])
        except ValueError:
            client_major = 0

    if requested == FDB_PROVIDER:
        return [FDB_PROVIDER]

    if requested == MODERN_PROVIDER:
        return [MODERN_PROVIDER]

    if client_major >= 3:
        return [MODERN_PROVIDER, FDB_PROVIDER]
    return [FDB_PROVIDER]


def diagnostics_snapshot() -> dict[str, Any]:
    diagnostics = resolve_client_library()
    diagnostics["driverCandidates"] = provider_availability()
    return diagnostics


def _format_driver_error(provider: str, exc: Exception) -> str:
    return f"{provider}: {exc}"


def _connect_with_fdb(options: dict[str, Any], client_path: str) -> tuple[Any, dict[str, Any]]:
    import fdb

    fdb.load_api(client_path)
    connection = fdb.connect(
        host=options["host"],
        port=int(options["port"]),
        database=options["database"],
        user=options["user"],
        password=options["password"],
        charset=options["charset"],
    )
    info = {
        "provider": FDB_PROVIDER,
        "driverVersion": _module_version("fdb"),
        "serverVersion": getattr(connection, "version", None) or getattr(connection, "server_version", None),
        "clientPath": client_path,
    }
    return connection, info


def _connect_with_firebird_driver(options: dict[str, Any], client_path: str) -> tuple[Any, dict[str, Any]]:
    from firebird.driver import connect, driver_config

    driver_config.fb_client_library.value = client_path
    driver_config.server_defaults.host.value = options["host"]
    driver_config.server_defaults.port.value = str(options["port"])
    driver_config.server_defaults.user.value = options["user"]
    driver_config.server_defaults.password.value = options["password"]
    driver_config.db_defaults.charset.value = options["charset"]

    connection = connect(options["database"], user=options["user"], password=options["password"], charset=options["charset"])
    server_version = None
    try:
        server_version = str(connection.info.firebird_version)
    except Exception:
        server_version = None

    info = {
        "provider": MODERN_PROVIDER,
        "driverVersion": _module_version("firebird.driver"),
        "serverVersion": server_version,
        "clientPath": client_path,
    }
    return connection, info


def _connection_attempts(providers: Iterable[str], options: dict[str, Any], client_path: str) -> tuple[Any, dict[str, Any], list[str]]:
    errors: list[str] = []
    for provider in providers:
        try:
            if provider == FDB_PROVIDER:
                return (*_connect_with_fdb(options, client_path), errors)
            if provider == MODERN_PROVIDER:
                return (*_connect_with_firebird_driver(options, client_path), errors)
        except Exception as exc:
            errors.append(_format_driver_error(provider, exc))
            continue

    raise FirebirdConfigurationError(
        "Nenhum provider Firebird disponivel conseguiu abrir a conexao.",
        diagnostics={"driverErrors": errors},
    )


def open_connection() -> tuple[Any, dict[str, Any], dict[str, Any]]:
    diagnostics = diagnostics_snapshot()
    if diagnostics["validationStatus"] != "valid" or not diagnostics["clientPath"]:
        raise FirebirdConfigurationError(build_missing_client_message(diagnostics), diagnostics)

    options = current_settings()
    connection, provider_info, provider_errors = _connection_attempts(
        preferred_providers(diagnostics),
        options,
        diagnostics["clientPath"],
    )
    if provider_errors:
        diagnostics.setdefault("warnings", []).extend(provider_errors)

    diagnostics["providerSelected"] = provider_info["provider"]
    diagnostics["driverVersion"] = provider_info.get("driverVersion")
    diagnostics["serverVersion"] = provider_info.get("serverVersion")
    diagnostics["clientPath"] = provider_info.get("clientPath")
    return connection, provider_info, diagnostics


def build_missing_client_message(diagnostics: dict[str, Any]) -> str:
    lines = [
        "Nenhuma fbclient.dll compativel foi encontrada para o processo atual.",
        f"Arquitetura do sistema: {diagnostics['systemArchitecture']}",
        f"Arquitetura do processo: {diagnostics['processArchitecture']}",
        "Caminhos verificados:",
    ]
    lines.extend(f"- {path}" for path in diagnostics.get("searchRoots", []))

    candidates = diagnostics.get("candidates", [])
    if candidates:
        lines.append("DLLs localizadas e motivos de rejeicao:")
        for candidate in candidates:
            path = candidate.get("path")
            arch = candidate.get("architecture") or "desconhecida"
            reason = candidate.get("rejection_reason") or "Motivo nao informado."
            lines.append(f"- {path} [{arch}]: {reason}")

    lines.append(
        "Defina FBCLIENT_PATH ou FIREBIRD_CLIENT_PATH com uma DLL compativel, ou salve uma selecao manual."
    )
    return "\n".join(lines)


def remember_last_error(message: str, diagnostics: dict[str, Any] | None = None) -> None:
    global _LAST_ERROR
    _LAST_ERROR = {
        "message": message,
        "timestamp": dt.datetime.now(dt.timezone.utc).isoformat(),
        "provider": (diagnostics or {}).get("providerSelected"),
        "clientPath": (diagnostics or {}).get("clientPath"),
    }
    write_runtime_log("connection-test", message)


def clear_last_error() -> None:
    global _LAST_ERROR
    _LAST_ERROR = None


def _close_connection(connection: Any) -> None:
    try:
        connection.close()
    except Exception:
        return


def _json_safe(value: Any) -> Any:
    if isinstance(value, (dt.date, dt.datetime, dt.time)):
        return value.isoformat()
    if isinstance(value, tuple):
        return [_json_safe(item) for item in value]
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    if isinstance(value, dict):
        return {key: _json_safe(item) for key, item in value.items()}
    return value


def test_connection(sql: str = "SELECT CURRENT_DATE FROM RDB$DATABASE") -> dict[str, Any]:
    connection = None
    diagnostics: dict[str, Any] = diagnostics_snapshot()
    try:
        connection, _, diagnostics = open_connection()
        cursor = connection.cursor()
        cursor.execute(sql)
        row = cursor.fetchone()
        diagnostics["testQuery"] = sql
        diagnostics["testQueryResult"] = _json_safe(list(row) if row is not None else [])
        diagnostics["status"] = "ok"
        diagnostics["lastConnectionError"] = None
        clear_last_error()
        write_runtime_log(
            "connection-test",
            f"status=ok | provider={diagnostics.get('providerSelected')} | client={diagnostics.get('clientPath')}",
        )
        return diagnostics
    except Exception as exc:
        diagnostics["status"] = "error"
        diagnostics["error"] = str(exc)
        remember_last_error(str(exc), diagnostics)
        diagnostics["lastConnectionError"] = _LAST_ERROR
        raise FirebirdConfigurationError(str(exc), diagnostics) from exc
    finally:
        if connection is not None:
            _close_connection(connection)
