import json
import os
from pathlib import Path
from typing import Any

from config_store import save_firebird_settings, write_env_values


ENV_KEYS = {
    "host": ("FB_HOST", "FIREBIRD_HOST"),
    "port": ("FB_PORT", "FIREBIRD_PORT"),
    "database": ("FB_DATABASE", "FIREBIRD_DATABASE"),
    "user": ("FB_USER", "FIREBIRD_USER"),
    "password": ("FB_PASSWORD", "FIREBIRD_PASSWORD"),
    "charset": ("FB_CHARSET", "FIREBIRD_CHARSET"),
    "clientPath": ("FBCLIENT_PATH", "FIREBIRD_CLIENT_PATH", "FB_CLIENT_LIBRARY"),
    "arch": ("FIREBIRD_ARCH", "FB_ARCH"),
    "provider": ("FIREBIRD_PROVIDER", "FB_PROVIDER", "FIREBIRD_DRIVER"),
    "connectionMode": ("FIREBIRD_CONNECTION_MODE",),
}


def _payload_value(payload: dict[str, Any], key: str) -> str | None:
    raw = payload.get(key)
    if raw is None:
        return None
    return str(raw).strip()


def _provider_value(payload: dict[str, Any]) -> str | None:
    return _payload_value(payload, "provider") or _payload_value(payload, "driver")


def apply_runtime_overrides(payload: dict[str, Any]) -> None:
    normalized = dict(payload)
    provider = _provider_value(payload)
    if provider is not None:
        normalized["provider"] = provider

    for payload_key, env_names in ENV_KEYS.items():
        value = _payload_value(normalized, payload_key)
        if value is None:
            continue
        for env_name in env_names:
            os.environ[env_name] = value


def save_env_configuration(payload: dict[str, Any]) -> str | None:
    updates = {}
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

    provider = _provider_value(payload)
    for payload_key, env_key in mapping.items():
        value = provider if payload_key == "provider" else _payload_value(payload, payload_key)
        if value is not None:
            updates[env_key] = value

    if not updates:
        return None

    return str(write_env_values(updates))


def save_runtime_selection(payload: dict[str, Any]) -> str | None:
    settings = {}
    if _payload_value(payload, "clientPath") is not None:
        settings["client_path"] = _payload_value(payload, "clientPath")
    if _payload_value(payload, "arch") is not None:
        settings["arch"] = _payload_value(payload, "arch")
    if _provider_value(payload) is not None:
        settings["provider"] = _provider_value(payload)

    if not settings:
        return None

    return str(save_firebird_settings(settings))


def load_json_payload(path: str) -> dict[str, Any]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    return data if isinstance(data, dict) else {}
