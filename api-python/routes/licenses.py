from fastapi import APIRouter, Depends, Header, HTTPException, Request

from license_service import (
    LicenseError,
    activate_license,
    bootstrap_license_from_env,
    build_error_response,
    get_license_status,
    refresh_token,
    register_usage,
)
from middleware import validate_license


router = APIRouter(prefix="/api/licenses", tags=["licenses"])


def _raise_license_error(error: Exception) -> None:
    status = getattr(error, "status", 500)
    raise HTTPException(status_code=status, detail=build_error_response(error))


def _extract_token(authorization: str | None, body: dict | None) -> str | None:
    if authorization and authorization.startswith("Bearer "):
        return authorization[7:]
    return (body or {}).get("token")


@router.post("/activate")
def activate(payload: dict):
    try:
        return activate_license(payload or {})
    except Exception as exc:
        _raise_license_error(exc)


@router.post("/bootstrap")
def bootstrap():
    try:
        return bootstrap_license_from_env()
    except Exception as exc:
        _raise_license_error(exc)


@router.post("/verify-token")
def verify(payload: dict | None = None, authorization: str | None = Header(default=None)):
    try:
        return refresh_token(_extract_token(authorization, payload))
    except Exception as exc:
        _raise_license_error(exc)


@router.get("/{license_key}/status")
def status(license_key: str):
    try:
        return get_license_status(license_key)
    except Exception as exc:
        _raise_license_error(exc)


@router.post("/{license_id}/usage")
def usage(license_id: str, payload: dict, request: Request, license_payload: dict = Depends(validate_license)):
    if license_payload.get("licenseId") != license_id and license_payload.get("licenseKey") != license_id:
        error = LicenseError("O token nao corresponde ao licenseId informado.", "LICENSE_MISMATCH", 403)
        _raise_license_error(error)

    try:
        return register_usage(license_id, payload or {})
    except Exception as exc:
        _raise_license_error(exc)
