import argparse
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from config_store import candidate_env_paths
from firebird_configuration import (
    apply_runtime_overrides,
    load_json_payload,
    save_env_configuration,
    save_runtime_selection,
)
from firebird_support import FirebirdConfigurationError, diagnostics_snapshot, test_connection


def _parse_cli_args():
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--env-file")
    parser.add_argument("--apply-firebird-config")
    parser.add_argument("--persist-firebird-env", action="store_true")
    parser.add_argument("--persist-firebird-runtime", action="store_true")
    parser.add_argument("--print-firebird-diagnostics", action="store_true")
    parser.add_argument("--test-firebird-connection", action="store_true")
    parser.add_argument("--json", action="store_true")
    return parser.parse_known_args()


CLI_ARGS, CLI_REMAINDER = _parse_cli_args()
if CLI_ARGS.env_file:
    os.environ["AGENDA_ENV_PATH"] = str(Path(CLI_ARGS.env_file).resolve())
if (CLI_ARGS.print_firebird_diagnostics or CLI_ARGS.test_firebird_connection) and not os.getenv("JWT_SECRET"):
    os.environ["JWT_SECRET"] = "AGENDA_LMD_DIAGNOSTIC_ONLY_SECRET"


def _load_environment() -> None:
    for candidate in candidate_env_paths():
        if candidate.exists():
            load_dotenv(candidate)
            return
    load_dotenv()


_load_environment()


def _apply_cli_configuration() -> dict:
    if not CLI_ARGS.apply_firebird_config:
        return {}

    payload = load_json_payload(CLI_ARGS.apply_firebird_config)
    apply_runtime_overrides(payload)
    return payload


CLI_FIREBIRD_PAYLOAD = _apply_cli_configuration()

from routes.auth import router as auth_router  # noqa: E402
from routes.diagnostics import router as diagnostics_router  # noqa: E402
from routes.agendamentos import router as agendamentos_router  # noqa: E402
from routes.licenses import router as licenses_router  # noqa: E402
from routes.settings import router as settings_router  # noqa: E402


app = FastAPI(title="Agenda LMD API Local")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    ],
    allow_origin_regex=r"^file://.*$",
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)

app.include_router(licenses_router)
app.include_router(auth_router)
app.include_router(agendamentos_router)
app.include_router(diagnostics_router)
app.include_router(settings_router)


@app.get("/api/health")
def health():
    diagnostics = diagnostics_snapshot()
    return {
        "ok": True,
        "service": "agenda-lmd-api",
        "validationStatus": diagnostics.get("validationStatus"),
        "processArchitecture": diagnostics.get("processArchitecture"),
        "providerRequested": diagnostics.get("providerRequested"),
        "providerSelected": diagnostics.get("providerSelected"),
        "clientPath": diagnostics.get("clientPath"),
    }


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    if isinstance(exc.detail, dict):
        return JSONResponse(status_code=exc.status_code, content=exc.detail)
    return JSONResponse(status_code=exc.status_code, content={"error": exc.detail})


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    print(f"Erro interno em {request.url.path}: {exc}")
    return JSONResponse(
        status_code=500,
        content={
            "error": str(exc) or "Erro interno do servidor.",
            "code": "INTERNAL_SERVER_ERROR",
            "status": 500,
        },
    )


def _frontend_dist_path() -> Path | None:
    configured = os.getenv("FRONTEND_DIST")
    candidates = []
    if configured:
        candidates.append(Path(configured))

    current_dir = Path(__file__).resolve().parent
    candidates.extend([
        current_dir / "frontend",
        current_dir.parent / "frontend",
        current_dir.parent / "dist-app",
        current_dir.parent / "app",
        Path.cwd() / "frontend",
        Path.cwd() / "dist-app",
        Path.cwd().parent / "frontend",
    ])

    for candidate in candidates:
        if candidate and (candidate / "index.html").exists():
            return candidate
    return None


frontend_dist = _frontend_dist_path()
if frontend_dist:
    assets_path = frontend_dist / "assets"
    if assets_path.exists():
        app.mount("/assets", StaticFiles(directory=assets_path), name="assets")

    @app.get("/")
    def serve_index():
        return FileResponse(frontend_dist / "index.html")

    @app.get("/{full_path:path}")
    def serve_spa(full_path: str):
        requested_file = frontend_dist / full_path
        if requested_file.is_file():
            return FileResponse(requested_file)
        return FileResponse(frontend_dist / "index.html")


if __name__ == "__main__":
    import uvicorn

    runtime_path = None
    env_path = None
    if CLI_FIREBIRD_PAYLOAD and CLI_ARGS.persist_firebird_runtime:
        runtime_path = save_runtime_selection(CLI_FIREBIRD_PAYLOAD)
    if CLI_FIREBIRD_PAYLOAD and CLI_ARGS.persist_firebird_env:
        env_path = save_env_configuration(CLI_FIREBIRD_PAYLOAD)

    if CLI_ARGS.print_firebird_diagnostics:
        payload = diagnostics_snapshot()
        if runtime_path:
            payload["runtimeConfigPath"] = runtime_path
        if env_path:
            payload["envPath"] = env_path
        print(json.dumps(payload, ensure_ascii=True, indent=2) if CLI_ARGS.json else payload)
        sys.exit(0)

    if CLI_ARGS.test_firebird_connection:
        try:
            payload = test_connection()
            if runtime_path:
                payload["runtimeConfigPath"] = runtime_path
            if env_path:
                payload["envPath"] = env_path
            print(json.dumps(payload, ensure_ascii=True, indent=2) if CLI_ARGS.json else payload)
            sys.exit(0)
        except FirebirdConfigurationError as exc:
            payload = exc.diagnostics or {"error": str(exc)}
            payload.setdefault("error", str(exc))
            if runtime_path:
                payload["runtimeConfigPath"] = runtime_path
            if env_path:
                payload["envPath"] = env_path
            print(json.dumps(payload, ensure_ascii=True, indent=2) if CLI_ARGS.json else payload)
            sys.exit(1)

    if CLI_FIREBIRD_PAYLOAD and (CLI_ARGS.persist_firebird_runtime or CLI_ARGS.persist_firebird_env):
        payload = {
            "ok": True,
            "runtimeConfigPath": runtime_path,
            "envPath": env_path,
            "diagnostics": diagnostics_snapshot(),
        }
        print(json.dumps(payload, ensure_ascii=True, indent=2) if CLI_ARGS.json else payload)
        sys.exit(0)

    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "3001"))
    uvicorn.run(app, host=host, port=port)
