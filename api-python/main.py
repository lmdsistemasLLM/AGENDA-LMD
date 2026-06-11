import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles


def _load_environment() -> None:
    candidates = [
        Path.cwd() / ".env",
        Path(__file__).resolve().parent / ".env",
        Path(__file__).resolve().parent.parent / "backend" / ".env",
        Path(os.getenv("APPDATA", "")) / "Agenda LMD" / ".env" if os.getenv("APPDATA") else None,
    ]
    for candidate in candidates:
        if candidate and candidate.exists():
            load_dotenv(candidate)
            return
    load_dotenv()


_load_environment()

from routes.auth import router as auth_router  # noqa: E402
from routes.agendamentos import router as agendamentos_router  # noqa: E402
from routes.licenses import router as licenses_router  # noqa: E402


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


@app.get("/api/health")
def health():
    return {"ok": True}


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

    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "3001"))
    uvicorn.run(app, host=host, port=port)
