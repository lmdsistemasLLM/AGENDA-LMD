import base64
import datetime as dt
import hashlib
import json
import os
import re
from pathlib import Path
from typing import Any

import jwt
import requests
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


JWT_SECRET = os.getenv("JWT_SECRET")
PROJECT_SLUG = os.getenv("PROJECT_SLUG", "agenda-lmd-preview")
LICENSE_API_URL = os.getenv("LICENSE_API_URL", "https://lmdsistemasdev.qzz.io/api").rstrip("/")
LICENSE_API_KEY = os.getenv("LICENSE_API_KEY")
LICENSE_API_TIMEOUT = int(os.getenv("LICENSE_API_TIMEOUT", "10000")) / 1000
ENCRYPTION_SECRET = os.getenv("DATA_ENCRYPTION_KEY") or os.getenv("JWT_SECRET")
OFFLINE_TTL = dt.timedelta(hours=int(os.getenv("LICENSE_OFFLINE_HOURS", "72")))
CLOCK_SKEW_TOLERANCE = dt.timedelta(minutes=5)
BLOCKING_STATUSES = {"blocked", "revoked", "suspended", "inactive", "cancelled", "canceled"}
FORCED_BLOCKING_STATUSES = {"revoked", "suspended", "cancelled", "canceled"}


class LicenseError(Exception):
    def __init__(self, message: str, code: str = "LICENSE_ERROR", status: int = 500):
        super().__init__(message)
        self.code = code
        self.status = status


if not JWT_SECRET:
    raise RuntimeError("A API Python precisa de JWT_SECRET no .env para gerar e verificar tokens.")


def build_error_response(error: Exception) -> dict:
    return {
        "error": str(error) or "Erro interno de licenciamento.",
        "code": getattr(error, "code", "LICENSE_ERROR"),
        "status": getattr(error, "status", 500),
        "timestamp": dt.datetime.now(dt.timezone.utc).isoformat(),
    }


def _app_data_dir() -> Path:
    base_dir = Path(os.getenv("APPDATA") or Path.home())
    path = base_dir / "Agenda LMD"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _log_license_debug(message: str) -> None:
    try:
        log_path = _app_data_dir() / "license_debug.log"
        timestamp = dt.datetime.now(dt.timezone.utc).isoformat()
        with log_path.open("a", encoding="utf-8") as log_file:
            log_file.write(f"[{timestamp}] {message}\n")
    except Exception:
        pass


def _cache_path() -> Path:
    return _app_data_dir() / ".license-cache.json"


def _usage_cache_path() -> Path:
    return _app_data_dir() / ".usage-cache.json"


def normalize_cnpj(value: Any) -> str | None:
    if not value:
        return None
    return re.sub(r"\D+", "", str(value)).zfill(14)


def _encryption_key() -> bytes:
    if not ENCRYPTION_SECRET:
        raise LicenseError("DATA_ENCRYPTION_KEY ou JWT_SECRET deve ser definido no .env.", "MISSING_ENCRYPTION_KEY", 500)
    return hashlib.sha256(str(ENCRYPTION_SECRET).encode("utf-8")).digest()


def encrypt_value(value: Any) -> str:
    text = value if isinstance(value, str) else json.dumps(value)
    nonce = os.urandom(12)
    encrypted = AESGCM(_encryption_key()).encrypt(nonce, text.encode("utf-8"), None)
    ciphertext, tag = encrypted[:-16], encrypted[-16:]
    return ":".join(
        base64.b64encode(part).decode("ascii")
        for part in (nonce, ciphertext, tag)
    )


def decrypt_value(encoded: str | None) -> str | None:
    if not encoded:
        return None
    try:
        nonce_b64, ciphertext_b64, tag_b64 = str(encoded).split(":")
        nonce = base64.b64decode(nonce_b64)
        ciphertext = base64.b64decode(ciphertext_b64)
        tag = base64.b64decode(tag_b64)
        return AESGCM(_encryption_key()).decrypt(nonce, ciphertext + tag, None).decode("utf-8")
    except Exception:
        return None


def _read_json(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def load_license_cache() -> dict | None:
    cache = _read_json(_cache_path())
    if not cache:
        return None
    if cache.get("encryptedToken"):
        token = decrypt_value(cache.get("encryptedToken"))
        if not token:
            return None
        cache["token"] = token
    if cache.get("encryptedRemoteToken"):
        remote_token = decrypt_value(cache.get("encryptedRemoteToken"))
        if remote_token:
            cache["remoteToken"] = remote_token
    return cache


def persist_license_cache(cache: dict) -> None:
    safe_cache = dict(cache)
    if safe_cache.get("token"):
        safe_cache["encryptedToken"] = encrypt_value(safe_cache["token"])
        safe_cache.pop("token", None)
    if safe_cache.get("remoteToken"):
        safe_cache["encryptedRemoteToken"] = encrypt_value(safe_cache["remoteToken"])
        safe_cache.pop("remoteToken", None)
    _write_json(_cache_path(), safe_cache)


def load_usage_cache() -> dict:
    return _read_json(_usage_cache_path()) or {"queued": []}


def persist_usage_cache(usage: dict) -> None:
    _write_json(_usage_cache_path(), usage)


def _headers() -> dict:
    headers = {"Content-Type": "application/json"}
    if LICENSE_API_KEY:
        headers["Authorization"] = f"Bearer {LICENSE_API_KEY}"
    return headers


def _post_license_api(path_suffix: str, data: dict) -> dict:
    if not LICENSE_API_URL:
        raise LicenseError("LICENSE_API_URL nao esta configurado.", "LICENSE_SERVICE_DISABLED", 503)
    url = f"{LICENSE_API_URL}/{path_suffix.lstrip('/')}"
    _log_license_debug(f"POST {url} payload_keys={list(data.keys())}")
    response = requests.post(
        url,
        json=data,
        headers=_headers(),
        timeout=LICENSE_API_TIMEOUT,
    )
    _log_license_debug(f"POST {url} status={response.status_code}")
    response.raise_for_status()
    return response.json()


def _remote_error_message(exc: requests.HTTPError) -> str:
    status_code = exc.response.status_code if exc.response is not None else 502
    body = ""
    if exc.response is not None:
        try:
            payload = exc.response.json()
            body = payload.get("error") or payload.get("message") or json.dumps(payload, ensure_ascii=False)
        except Exception:
            body = (exc.response.text or "").strip()
    body_suffix = f" Detalhes: {body[:300]}" if body else ""
    return f"API central de licencas retornou erro {status_code}.{body_suffix}"


def _get_remote_license_status(license_key: str) -> dict:
    response = requests.get(
        f"{LICENSE_API_URL}/licenses/{license_key}/status",
        headers=_headers(),
        timeout=LICENSE_API_TIMEOUT,
    )
    response.raise_for_status()
    return response.json()


def _post_remote_usage(license_id: str, payload: dict) -> dict:
    response = requests.post(
        f"{LICENSE_API_URL}/licenses/{license_id}/usage",
        json=payload,
        headers=_headers(),
        timeout=LICENSE_API_TIMEOUT,
    )
    response.raise_for_status()
    return response.json()


def _verify_remote_license_token(remote_token: str, cnpj: str | None, project_slug: str | None) -> dict:
    return _post_license_api("licenses/verify-token", {
        "token": remote_token,
        "cnpj": normalize_cnpj(cnpj),
        "projectSlug": project_slug,
    })


def _utc_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _parse_iso(value: str) -> dt.datetime:
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))


def _safe_parse_iso(value: str | None) -> dt.datetime | None:
    if not value:
        return None
    try:
        parsed = _parse_iso(value)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=dt.timezone.utc)
        return parsed.astimezone(dt.timezone.utc)
    except Exception:
        return None


def _iso_or_none(value: dt.datetime | None) -> str | None:
    return value.isoformat() if value else None


def _effective_block_at(expires_at: str | None, grace_days: int | None, effective_block_at: str | None = None) -> str | None:
    explicit = _safe_parse_iso(effective_block_at)
    if explicit:
        return explicit.isoformat()
    expires = _safe_parse_iso(expires_at)
    if not expires:
        return None
    return (expires + dt.timedelta(days=int(grace_days or 0))).isoformat()


def _derive_license_status(session: dict, now: dt.datetime | None = None) -> str:
    now = now or _utc_now()
    remote_status = str(session.get("status") or "").lower()
    if remote_status in FORCED_BLOCKING_STATUSES:
        return "blocked"

    expires = _safe_parse_iso(session.get("expiresAt"))
    block_at = _safe_parse_iso(session.get("effectiveBlockAt"))
    if expires and now <= expires:
        return "active"
    if block_at and now <= block_at:
        return "grace"
    if expires or block_at:
        return "blocked"
    if remote_status in BLOCKING_STATUSES:
        return "blocked"
    return remote_status or "active"


def _has_remote_date_fields(remote_status: dict, remote_license: dict) -> bool:
    return any(
        source.get(field)
        for source in (remote_status or {}, remote_license or {})
        for field in ("expiresAt", "effectiveBlockAt", "graceDays")
    )


def _normalize_remote_status(value: Any) -> str:
    return str(value or "").strip().lower()


def _remote_status_snapshot(license_key: str | None) -> dict:
    if not license_key:
        return {}
    return _get_remote_license_status(license_key)


def _raise_if_remote_rejected(snapshot: dict | None) -> None:
    normalized_status = _normalize_remote_status((snapshot or {}).get("status"))
    if normalized_status in BLOCKING_STATUSES:
        raise LicenseError(
            "Licenca bloqueada ou expirada. Entre em contato com o suporte para regularizar o acesso.",
            "LICENSE_BLOCKED",
            403,
        )


def _assert_clock_not_rolled_back(session: dict) -> None:
    last_online = _safe_parse_iso(session.get("lastValidatedOnlineAt") or session.get("validatedAt"))
    if last_online and _utc_now() + CLOCK_SKEW_TOLERANCE < last_online:
        raise LicenseError(
            "Foi detectada uma inconsistencia na data/hora do computador. Conecte-se a internet para validar novamente a licenca.",
            "CLOCK_TAMPERING_DETECTED",
            403,
        )


def _sign_token(payload: dict, expires_at_override: str | None = None) -> tuple[str, str]:
    now = _utc_now()
    if expires_at_override:
        expires_at = _parse_iso(expires_at_override)
        ttl = max((expires_at - now).total_seconds(), 60)
    else:
        ttl = 24 * 60 * 60
    expires_at = now + dt.timedelta(seconds=int(ttl))
    token = jwt.encode({**payload, "exp": expires_at}, JWT_SECRET, algorithm="HS256")
    return token, expires_at.isoformat()


def _build_session_payload(options: dict) -> dict:
    return {
        "licenseKey": options.get("licenseKey"),
        "licenseId": options.get("licenseId") or options.get("licenseKey"),
        "cnpj": normalize_cnpj(options.get("cnpj")),
        "projectSlug": options.get("projectSlug"),
        "features": options.get("features") or [],
        "status": options.get("status") or "active",
        "expiresAt": options.get("expiresAt"),
        "effectiveBlockAt": options.get("effectiveBlockAt"),
        "graceDays": int(options.get("graceDays") or 0),
        "maxUsers": options.get("maxUsers") or 1,
        "license": options.get("license") or {},
        "project": options.get("project") or {},
    }


def _create_session(options: dict) -> dict:
    effective_block_at = _effective_block_at(
        options.get("expiresAt"),
        options.get("graceDays"),
        options.get("effectiveBlockAt"),
    )
    payload = _build_session_payload({**options, "effectiveBlockAt": effective_block_at})
    payload["status"] = _derive_license_status(payload)
    token, token_expires_at = _sign_token(payload, effective_block_at)
    validated_at = _utc_now().isoformat()
    session = {
        **payload,
        "token": token,
        "remoteToken": options.get("remoteToken") or options.get("token"),
        "tokenExpiresAt": token_expires_at,
        "validatedAt": validated_at,
        "lastValidatedOnlineAt": options.get("lastValidatedOnlineAt") or validated_at,
        "offline": False,
    }
    persist_license_cache(session)
    return session


def _compact_license_response(session: dict) -> dict:
    return {
        "token": session.get("token"),
        "licenseKey": session.get("licenseKey"),
        "licenseId": session.get("licenseId"),
        "cnpj": session.get("cnpj"),
        "projectSlug": session.get("projectSlug"),
        "expiresAt": session.get("expiresAt"),
        "effectiveBlockAt": session.get("effectiveBlockAt"),
        "graceDays": session.get("graceDays"),
        "status": session.get("status"),
        "lastValidatedOnlineAt": session.get("lastValidatedOnlineAt"),
        "license": session.get("license"),
        "project": session.get("project"),
        "offline": bool(session.get("offline")),
    }


def _restore_cached_license(request_payload: dict) -> dict | None:
    cache = load_license_cache()
    if not cache:
        return None
    if normalize_cnpj(request_payload.get("cnpj")) != normalize_cnpj(cache.get("cnpj")):
        return None
    if request_payload.get("licenseKey") != cache.get("licenseKey"):
        return None
    if request_payload.get("projectSlug") != cache.get("projectSlug"):
        return None
    if not cache.get("validatedAt"):
        return None
    _assert_clock_not_rolled_back(cache)
    if _utc_now() - _parse_iso(cache["validatedAt"]) > OFFLINE_TTL:
        return None
    if _derive_license_status(cache) == "blocked":
        return None
    if not cache.get("token"):
        return None
    return {**cache, "status": _derive_license_status(cache), "offline": True}


def _env_license_payload() -> dict:
    payload = {
        "licenseKey": os.getenv("LICENSE_KEY") or os.getenv("LICENSE_LICENSE_KEY"),
        "cnpj": os.getenv("LICENSE_CNPJ") or os.getenv("CNPJ"),
        "projectSlug": os.getenv("LICENSE_PROJECT_SLUG") or os.getenv("PROJECT_SLUG") or PROJECT_SLUG,
    }
    if not payload["licenseKey"] or not payload["cnpj"] or not payload["projectSlug"]:
        raise LicenseError(
            "Licenca nao configurada no .env. Defina LICENSE_KEY, LICENSE_CNPJ e LICENSE_PROJECT_SLUG.",
            "LICENSE_ENV_NOT_CONFIGURED",
            500,
        )
    return payload


def bootstrap_license_from_env() -> dict:
    request_payload = _env_license_payload()
    cache = load_license_cache()

    if (
        cache
        and cache.get("token")
        and cache.get("licenseKey") == request_payload["licenseKey"]
        and normalize_cnpj(cache.get("cnpj")) == normalize_cnpj(request_payload["cnpj"])
        and cache.get("projectSlug") == request_payload["projectSlug"]
    ):
        try:
            return refresh_token(cache["token"])
        except LicenseError as exc:
            _log_license_debug(f"bootstrap refresh failed code={exc.code} status={exc.status}; trying env activation")
            if exc.code in {"CLOCK_TAMPERING_DETECTED"}:
                raise

    return activate_license(request_payload)


def activate_license(payload: dict) -> dict:
    cnpj = payload.get("cnpj")
    license_key = payload.get("licenseKey")
    project_slug = payload.get("projectSlug")
    if not cnpj or not license_key or not project_slug:
        raise LicenseError("cnpj, licenseKey e projectSlug sao obrigatorios.", "INVALID_ACTIVATION_PAYLOAD", 400)

    request_payload = {
        "cnpj": normalize_cnpj(cnpj),
        "licenseKey": license_key,
        "projectSlug": project_slug,
    }

    try:
        remote_response = _post_license_api("licenses/activate", request_payload)
    except requests.HTTPError as exc:
        status_code = exc.response.status_code if exc.response is not None else 502
        _log_license_debug(f"activate http_error status={status_code} message={_remote_error_message(exc)}")
        try:
            _raise_if_remote_rejected(_remote_status_snapshot(license_key))
        except LicenseError:
            raise
        except requests.RequestException:
            pass
        if status_code < 500:
            message = None
            try:
                message = exc.response.json().get("error")
            except Exception:
                pass
            raise LicenseError(message or str(exc), "LICENSE_SERVICE_REJECTED", status_code) from exc
        raise LicenseError(
            (
                f"{_remote_error_message(exc)} "
                "Confirme se CNPJ, chave da licenca e projeto/produto existem na plataforma central."
            ),
            "LICENSE_SERVICE_UPSTREAM_ERROR",
            502,
        ) from exc
    except requests.RequestException as exc:
        _log_license_debug(f"activate request_error {type(exc).__name__}: {exc}")
        offline_session = _restore_cached_license(request_payload)
        if not offline_session:
            raise LicenseError(
                "Nao foi possivel conectar ao servico de licenca e nao ha cache local valido.",
                "LICENSE_SERVICE_OFFLINE",
                503,
            ) from exc
        return _compact_license_response(offline_session)

    status_snapshot = _remote_status_snapshot(license_key)
    _raise_if_remote_rejected(status_snapshot)

    remote_license = remote_response.get("license") or {}
    remote_project = remote_response.get("project") or {}
    expires_at = status_snapshot.get("expiresAt") or remote_license.get("expiresAt") or remote_response.get("expiresAt")
    grace_days = status_snapshot.get("graceDays") if status_snapshot.get("graceDays") is not None else (remote_license.get("graceDays") or remote_response.get("graceDays") or 0)
    effective_block_at = _effective_block_at(
        expires_at,
        grace_days,
        status_snapshot.get("effectiveBlockAt") or remote_license.get("effectiveBlockAt") or remote_response.get("effectiveBlockAt"),
    )
    session = _create_session({
        "licenseKey": license_key,
        "licenseId": remote_license.get("id") or license_key,
        "cnpj": normalize_cnpj(cnpj),
        "projectSlug": project_slug,
        "features": remote_license.get("features") if isinstance(remote_license.get("features"), list) else ["api_access"],
        "status": status_snapshot.get("status") or remote_response.get("status") or remote_license.get("status") or "active",
        "maxUsers": remote_license.get("maxUsers") or 1,
        "license": {
            **remote_license,
            **status_snapshot,
            "expiresAt": expires_at,
            "effectiveBlockAt": effective_block_at,
            "graceDays": int(grace_days or 0),
        },
        "project": {"slug": project_slug, **remote_project},
        "expiresAt": expires_at,
        "effectiveBlockAt": effective_block_at,
        "graceDays": int(grace_days or 0),
        "remoteToken": remote_response.get("token"),
    })
    if session.get("status") == "blocked":
        raise LicenseError(
            "Licenca bloqueada ou expirada. Entre em contato com o suporte para regularizar o acesso.",
            "LICENSE_BLOCKED",
            403,
        )
    return _compact_license_response(session)


def get_jwt_payload(token: str | None) -> dict:
    if not token:
        raise LicenseError("Token nao fornecido.", "MISSING_TOKEN", 401)
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise LicenseError("Token invalido ou expirado.", "INVALID_TOKEN", 401) from exc


def verify_token(token: str | None) -> dict:
    payload = get_jwt_payload(token)
    if payload.get("projectSlug") != PROJECT_SLUG:
        raise LicenseError(
            f"ProjectSlug invalido. Esperado: {PROJECT_SLUG}, Recebido: {payload.get('projectSlug')}",
            "INVALID_PROJECT",
            401,
        )
    if _derive_license_status(payload) == "blocked":
        raise LicenseError("Licenca inativa.", "LICENSE_INACTIVE", 403)
    payload["status"] = _derive_license_status(payload)
    return payload


def _decode_refresh_payload(token: str | None) -> dict:
    payload = get_jwt_payload(token)
    if payload.get("projectSlug") != PROJECT_SLUG:
        raise LicenseError(
            f"ProjectSlug invalido. Esperado: {PROJECT_SLUG}, Recebido: {payload.get('projectSlug')}",
            "INVALID_PROJECT",
            401,
        )
    return payload


def refresh_token(token: str | None) -> dict:
    payload = _decode_refresh_payload(token)
    cache = load_license_cache() or {}
    if cache and cache.get("licenseKey") == payload.get("licenseKey"):
        _assert_clock_not_rolled_back(cache)

    remote_token = cache.get("remoteToken") or payload.get("remoteToken") or token
    remote_status = None
    try:
        remote_status = _verify_remote_license_token(
            remote_token,
            payload.get("cnpj"),
            payload.get("projectSlug"),
        )
    except requests.HTTPError as exc:
        status_code = exc.response.status_code if exc.response is not None else 502
        if status_code < 500:
            message = None
            try:
                message = exc.response.json().get("error")
            except Exception:
                pass
            raise LicenseError(message or "Licenca bloqueada.", "LICENSE_BLOCKED", status_code) from exc
        if not cache:
            raise LicenseError(
                "Nao foi possivel validar a licenca. Conecte-se a internet para continuar utilizando o sistema.",
                "LICENSE_ONLINE_VALIDATION_REQUIRED",
                503,
            ) from exc
        validated_at = _safe_parse_iso(cache.get("validatedAt"))
        if not validated_at or _utc_now() - validated_at > OFFLINE_TTL:
            raise LicenseError(
                "Nao foi possivel validar a licenca. Conecte-se a internet para continuar utilizando o sistema.",
                "LICENSE_OFFLINE_LIMIT_EXPIRED",
                403,
            ) from exc
        if _derive_license_status(cache) == "blocked":
            raise LicenseError(
                "Licenca bloqueada. O periodo de carencia terminou.",
                "LICENSE_BLOCKED",
                403,
            ) from exc
        return _compact_license_response({**cache, "status": _derive_license_status(cache), "offline": True})
    except requests.RequestException:
        if not cache:
            raise LicenseError(
                "Nao foi possivel validar a licenca. Conecte-se a internet para continuar utilizando o sistema.",
                "LICENSE_ONLINE_VALIDATION_REQUIRED",
                503,
            )
        validated_at = _safe_parse_iso(cache.get("validatedAt"))
        if not validated_at or _utc_now() - validated_at > OFFLINE_TTL:
            raise LicenseError(
                "Nao foi possivel validar a licenca. Conecte-se a internet para continuar utilizando o sistema.",
                "LICENSE_OFFLINE_LIMIT_EXPIRED",
                403,
            )
        if _derive_license_status(cache) == "blocked":
            raise LicenseError(
                "Licenca bloqueada. O periodo de carencia terminou.",
                "LICENSE_BLOCKED",
                403,
            )
        return _compact_license_response({**cache, "status": _derive_license_status(cache), "offline": True})

    status_snapshot = _remote_status_snapshot(payload.get("licenseKey") or payload.get("licenseId"))
    _raise_if_remote_rejected(status_snapshot)

    remote_license = (remote_status or {}).get("license") or {}
    remote_status_value = status_snapshot.get("status") or (remote_status or {}).get("status") or remote_license.get("status") or payload.get("status")
    normalized_remote_status = _normalize_remote_status(remote_status_value)
    has_remote_dates = _has_remote_date_fields(status_snapshot or {}, remote_license) or _has_remote_date_fields(remote_status or {}, remote_license)
    remote_allows_use = (remote_status or {}).get("valid") is True or normalized_remote_status in {"active", "grace"}
    expires_at = status_snapshot.get("expiresAt") or remote_license.get("expiresAt") or (remote_status or {}).get("expiresAt")
    grace_days = status_snapshot.get("graceDays") if status_snapshot.get("graceDays") is not None else (remote_license.get("graceDays") or (remote_status or {}).get("graceDays"))
    if has_remote_dates or not remote_allows_use:
        expires_at = expires_at or payload.get("expiresAt")
        grace_days = grace_days if grace_days is not None else (payload.get("graceDays") or 0)
    else:
        grace_days = grace_days or 0
    effective_block_at = _effective_block_at(
        expires_at,
        grace_days,
        (
            status_snapshot.get("effectiveBlockAt")
            or remote_license.get("effectiveBlockAt")
            or (remote_status or {}).get("effectiveBlockAt")
            or (payload.get("effectiveBlockAt") if has_remote_dates or not remote_allows_use else None)
        ),
    )
    if remote_allows_use and not has_remote_dates:
        remote_derived_status = "grace" if normalized_remote_status == "grace" else "active"
    else:
        remote_derived_status = _derive_license_status({
            "status": remote_status_value,
            "expiresAt": expires_at,
            "effectiveBlockAt": effective_block_at,
            "graceDays": grace_days,
        })
    if remote_status and remote_status.get("valid") is False and remote_derived_status == "blocked":
        raise LicenseError(
            remote_status.get("error") or "Licenca bloqueada.",
            "LICENSE_BLOCKED",
            403,
        )
    updated_payload = {
        **payload,
        "features": remote_license.get("features") or payload.get("features") or [],
        "status": remote_derived_status,
        "expiresAt": expires_at,
        "effectiveBlockAt": effective_block_at,
        "graceDays": int(grace_days or 0),
        "maxUsers": remote_license.get("maxUsers") or payload.get("maxUsers") or 1,
        "license": {
            **(payload.get("license") or {}),
            **remote_license,
            **status_snapshot,
            "expiresAt": expires_at,
            "effectiveBlockAt": effective_block_at,
            "graceDays": int(grace_days or 0),
        },
        "project": (remote_status or {}).get("project") or payload.get("project") or {"slug": PROJECT_SLUG},
    }
    if _derive_license_status(updated_payload) == "blocked":
        raise LicenseError("Licenca inativa.", "LICENSE_INACTIVE", 403)

    session = _create_session({
        "licenseKey": updated_payload.get("licenseKey") or updated_payload.get("licenseId"),
        "licenseId": updated_payload.get("licenseId"),
        "cnpj": updated_payload.get("cnpj"),
        "projectSlug": updated_payload.get("projectSlug"),
        "features": updated_payload.get("features"),
        "status": updated_payload.get("status"),
        "maxUsers": updated_payload.get("maxUsers"),
        "license": updated_payload.get("license"),
        "project": updated_payload.get("project"),
        "expiresAt": updated_payload.get("expiresAt"),
        "effectiveBlockAt": updated_payload.get("effectiveBlockAt"),
        "graceDays": updated_payload.get("graceDays"),
        "remoteToken": remote_token,
    })
    response = _compact_license_response(session)
    response["renewed"] = True
    return response


def get_license_status(license_key: str) -> dict:
    if not license_key:
        raise LicenseError("licenseKey e obrigatorio.", "MISSING_LICENSE_KEY", 400)

    cache = load_license_cache()
    status = cache.get("status") if cache and cache.get("licenseKey") == license_key else "unknown"
    license_data = cache.get("license") if cache and cache.get("licenseKey") == license_key else None
    project = cache.get("project") if cache and cache.get("licenseKey") == license_key else None
    expires_at = cache.get("expiresAt") if cache and cache.get("licenseKey") == license_key else None

    if LICENSE_API_URL:
        try:
            remote_status = _get_remote_license_status(license_key)
            status = (remote_status.get("license") or {}).get("status") or status
            license_data = remote_status.get("license") or license_data
            project = remote_status.get("project") or project
            expires_at = remote_status.get("expiresAt") or expires_at
        except Exception:
            pass

    return {
        "licenseKey": license_key,
        "status": status or "unknown",
        "license": license_data,
        "project": project,
        "expiresAt": expires_at,
        "cached": bool(cache),
    }


def register_usage(license_id: str, metrics: dict) -> dict:
    required = ["requestCount", "dataUsedMB", "activeUsers", "periodStart", "periodEnd"]
    if any(key not in metrics for key in required):
        raise LicenseError("Payload de uso invalido.", "INVALID_USAGE_PAYLOAD", 400)

    record = {
        "licenseId": license_id,
        **metrics,
        "receivedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
    }

    if LICENSE_API_URL:
        try:
            _post_remote_usage(license_id, metrics)
            cache = load_usage_cache()
            if cache.get("queued"):
                queued = list(cache["queued"])
                cache["queued"] = []
                persist_usage_cache(cache)
                for item in queued:
                    try:
                        _post_remote_usage(license_id, item)
                    except Exception:
                        cache["queued"].insert(0, item)
                        persist_usage_cache(cache)
                        break
            return {"cached": False}
        except Exception:
            cache = load_usage_cache()
            cache.setdefault("queued", []).append(record)
            persist_usage_cache(cache)
            return {"cached": True}

    cache = load_usage_cache()
    cache.setdefault("queued", []).append(record)
    persist_usage_cache(cache)
    return {"cached": True}
