import hmac
import os


class AuthError(Exception):
    def __init__(self, message: str, code: str = "AUTH_ERROR", status: int = 401):
        super().__init__(message)
        self.code = code
        self.status = status


def _configured_user() -> str:
    return os.getenv("APP_LOGIN_USER") or os.getenv("LOGIN_USER") or "admin"


def _configured_password() -> str:
    return os.getenv("APP_LOGIN_PASSWORD") or os.getenv("LOGIN_PASSWORD") or "admin"


def build_auth_error_response(error: Exception) -> dict:
    return {
        "error": str(error) or "Falha de autenticacao.",
        "code": getattr(error, "code", "AUTH_ERROR"),
        "status": getattr(error, "status", 401),
    }


def validate_login(payload: dict) -> dict:
    username = str((payload or {}).get("username") or "").strip()
    password = str((payload or {}).get("password") or "")

    if not username or not password:
        raise AuthError("Usuario e senha sao obrigatorios.", "AUTH_REQUIRED", 400)

    valid_user = hmac.compare_digest(username, _configured_user())
    valid_password = hmac.compare_digest(password, _configured_password())
    if not valid_user or not valid_password:
        raise AuthError("Usuario ou senha invalidos.", "INVALID_CREDENTIALS", 401)

    return {"ok": True, "user": username}
