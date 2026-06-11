from fastapi import APIRouter, HTTPException

from auth_service import AuthError, build_auth_error_response, validate_login


router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login")
def login(payload: dict):
    try:
        return validate_login(payload or {})
    except AuthError as exc:
        raise HTTPException(status_code=exc.status, detail=build_auth_error_response(exc)) from exc
