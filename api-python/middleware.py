from fastapi import Header, HTTPException, Request

from license_service import LicenseError, build_error_response, verify_token


def _extract_bearer(authorization: str | None) -> str | None:
    if authorization and authorization.startswith("Bearer "):
        return authorization[7:]
    return None


async def validate_license(request: Request, authorization: str | None = Header(default=None)) -> dict:
    token = _extract_bearer(authorization)
    if not token:
        error = LicenseError("Authorization Bearer token ausente.", "MISSING_TOKEN", 401)
        raise HTTPException(status_code=401, detail=build_error_response(error))

    try:
        payload = verify_token(token)
    except LicenseError as exc:
        raise HTTPException(status_code=exc.status, detail=build_error_response(exc)) from exc

    request.state.license = {
        "licenseId": payload.get("licenseId") or payload.get("licenseKey"),
        "licenseKey": payload.get("licenseKey"),
        "cnpj": payload.get("cnpj"),
        "features": payload.get("features") if isinstance(payload.get("features"), list) else [],
        "status": payload.get("status"),
        "maxUsers": payload.get("maxUsers") or 1,
        "raw": payload,
    }
    return request.state.license
