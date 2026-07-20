from fastapi import APIRouter

from settings_service import persist_settings, read_current_settings


router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("")
@router.get("/")
def get_settings():
    return read_current_settings()


@router.post("")
@router.post("/")
def save_settings(payload: dict | None = None):
    return persist_settings(payload or {})
