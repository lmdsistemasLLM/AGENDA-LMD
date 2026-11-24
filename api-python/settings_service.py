import secrets
from typing import Any

from config_store import parse_env_file, preferred_env_path, runtime_config_path, write_env_values
from firebird_configuration import apply_runtime_overrides, save_runtime_selection
from firebird_support import DEFAULT_CHARSET, DEFAULT_PORT, current_settings, diagnostics_snapshot


DEFAULT_LICENSE_API_URL = ""
DEFAULT_PROJECT_SLUG = "agenda-lmd-preview"


def _text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _int(value: Any, default: int) -> int:
    try:
        return int(str(value).strip())
    except (TypeError, ValueError, AttributeError):
        return default


def _env_values() -> dict[str, str]:
    return parse_env_file()


def _firebird_settings_payload(env_values: dict[str, str]) -> dict[str, Any]:
    current = current_settings()
    return {
        "host": _text(env_values.get("FB_HOST") or current.get("host") or "127.0.0.1"),
        "port": _int(env_values.get("FB_PORT") or current.get("port"), DEFAULT_PORT),
        "database": _text(env_values.get("FB_DATABASE") or current.get("database")),
        "user": _text(env_values.get("FB_USER") or current.get("user") or "SYSDBA"),
        "password": _text(env_values.get("FB_PASSWORD") or current.get("password")),
        "charset": _text(env_values.get("FB_CHARSET") or current.get("charset") or DEFAULT_CHARSET),
        "clientPath": _text(
            env_values.get("FBCLIENT_PATH")
            or env_values.get("FIREBIRD_CLIENT_PATH")
            or current.get("client_path")
        ),
        "arch": _text(env_values.get("FIREBIRD_ARCH") or current.get("requested_arch") or "AUTO"),
        "provider": _text(env_values.get("FIREBIRD_PROVIDER") or current.get("provider") or "AUTO"),
        "connectionMode": _text(env_values.get("FIREBIRD_CONNECTION_MODE") or "AUTO"),
    }


def _license_settings_payload(env_values: dict[str, str]) -> dict[str, Any]:
    project_slug = _text(
        env_values.get("LICENSE_PROJECT_SLUG")
        or env_values.get("PROJECT_SLUG")
        or DEFAULT_PROJECT_SLUG
    )
    return {
        "licenseKey": _text(env_values.get("LICENSE_KEY")),
        "cnpj": _text(env_values.get("LICENSE_CNPJ") or env_values.get("CNPJ")),
        "projectSlug": project_slug,
        "apiUrl": _text(env_values.get("LICENSE_API_URL") or DEFAULT_LICENSE_API_URL),
        "configured": bool(env_values.get("LICENSE_KEY") and (env_values.get("LICENSE_CNPJ") or env_values.get("CNPJ"))),
    }


def _auth_settings_payload(env_values: dict[str, str]) -> dict[str, Any]:
    return {
        "username": _text(env_values.get("APP_LOGIN_USER") or env_values.get("LOGIN_USER") or "admin"),
        "password": _text(env_values.get("APP_LOGIN_PASSWORD") or env_values.get("LOGIN_PASSWORD") or "admin"),
    }


def read_current_settings() -> dict[str, Any]:
    env_values = _env_values()
    return {
        "envPath": str(preferred_env_path()),
        "runtimeConfigPath": str(runtime_config_path()),
        "firebird": _firebird_settings_payload(env_values),
        "license": _license_settings_payload(env_values),
        "auth": _auth_settings_payload(env_values),
        "diagnostics": diagnostics_snapshot(),
    }


def _build_firebird_env_updates(payload: dict[str, Any]) -> dict[str, str]:
    firebird = payload.get("firebird") if isinstance(payload.get("firebird"), dict) else {}
    updates: dict[str, str] = {}
    mapping = {
        "host": "FB_HOST",
        "port": "FB_PORT",
        "database": "FB_DATABASE",
        "user": "FB_USER",
        "password": "FB_PASSWORD",
        "charset": "FB_CHARSET",
        "clientPath": "FBCLIENT_PATH",
        "arch": "FIREBIRD_ARCH",
        "provider": "FIREBIRD_PROVIDER",
        "connectionMode": "FIREBIRD_CONNECTION_MODE",
    }

    for payload_key, env_key in mapping.items():
        if payload_key in firebird:
            updates[env_key] = _text(firebird.get(payload_key))

    return updates


def _build_license_env_updates(payload: dict[str, Any]) -> dict[str, str]:
    license_settings = payload.get("license") if isinstance(payload.get("license"), dict) else None
    auth_settings = payload.get("auth") if isinstance(payload.get("auth"), dict) else None

    updates: dict[str, str] = {}
    if license_settings is not None:
        project_slug = _text(license_settings.get("projectSlug") or DEFAULT_PROJECT_SLUG)
        updates.update({
            "LICENSE_KEY": _text(license_settings.get("licenseKey")),
            "LICENSE_CNPJ": _text(license_settings.get("cnpj")),
            "LICENSE_PROJECT_SLUG": project_slug,
            "PROJECT_SLUG": project_slug,
            "LICENSE_API_URL": _text(license_settings.get("apiUrl") or DEFAULT_LICENSE_API_URL),
        })

    if auth_settings is not None:
        updates["APP_LOGIN_USER"] = _text(auth_settings.get("username") or "admin")
        updates["APP_LOGIN_PASSWORD"] = _text(auth_settings.get("password") or "admin")

    return updates


def _build_runtime_payload(payload: dict[str, Any]) -> dict[str, Any]:
    firebird = payload.get("firebird") if isinstance(payload.get("firebird"), dict) else {}
    runtime_payload: dict[str, Any] = {}

    if "clientPath" in firebird:
        runtime_payload["clientPath"] = _text(firebird.get("clientPath"))
    if "arch" in firebird:
        runtime_payload["arch"] = _text(firebird.get("arch"))
    if "provider" in firebird:
        runtime_payload["provider"] = _text(firebird.get("provider"))

    return runtime_payload


def persist_settings(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    body = payload or {}
    env_values = _env_values()
    env_updates = {
        **_build_firebird_env_updates(body),
        **_build_license_env_updates(body),
    }

    env_updates["HOST"] = _text(env_values.get("HOST") or "127.0.0.1")
    env_updates["PORT"] = _text(env_values.get("PORT") or "3101")
    env_updates["JWT_SECRET"] = _text(env_values.get("JWT_SECRET") or secrets.token_urlsafe(48))

    env_path = write_env_values(env_updates)

    firebird_runtime_payload = _build_runtime_payload(body)
    runtime_path = save_runtime_selection(firebird_runtime_payload) if firebird_runtime_payload else runtime_config_path()

    firebird_payload = body.get("firebird") if isinstance(body.get("firebird"), dict) else {}
    if firebird_payload:
        apply_runtime_overrides(firebird_payload)

    result = read_current_settings()
    result["envPath"] = str(env_path)
    result["runtimeConfigPath"] = str(runtime_path)
    return result
