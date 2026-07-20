from fastapi import APIRouter, HTTPException

from firebird_configuration import apply_runtime_overrides, save_env_configuration, save_runtime_selection
from firebird_support import FirebirdConfigurationError, diagnostics_snapshot, test_connection


router = APIRouter(prefix="/api/diagnostics/firebird", tags=["firebird-diagnostics"])


@router.get("")
@router.get("/")
def get_diagnostics():
    return diagnostics_snapshot()


@router.post("/config")
def save_configuration(payload: dict | None = None):
    body = payload or {}
    apply_runtime_overrides(body)
    runtime_path = save_runtime_selection(body)
    env_path = save_env_configuration(body) if body.get("persistToEnv") else None
    diagnostics = diagnostics_snapshot()
    return {
        "ok": True,
        "runtimeConfigPath": runtime_path,
        "envPath": env_path,
        "diagnostics": diagnostics,
    }


@router.post("/test")
def run_test(payload: dict | None = None):
    body = payload or {}
    apply_runtime_overrides(body)

    runtime_path = save_runtime_selection(body) if body.get("persistRuntimeConfig") else None
    env_path = save_env_configuration(body) if body.get("persistToEnv") else None

    try:
        diagnostics = test_connection()
        return {
            "ok": True,
            "runtimeConfigPath": runtime_path,
            "envPath": env_path,
            "diagnostics": diagnostics,
        }
    except FirebirdConfigurationError as exc:
        detail = exc.diagnostics or {}
        detail.setdefault("error", str(exc))
        detail["runtimeConfigPath"] = runtime_path
        detail["envPath"] = env_path
        raise HTTPException(status_code=500, detail=detail) from exc
