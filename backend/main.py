import json
import hashlib
import hmac
import os
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field
from .planner import calculate, optimize, prepare
from .planner_v5 import calculate_v5, optimize_v5
from .database import (
    ProjectConflict,
    check_database,
    delete_project,
    list_projects,
    save_project,
)
from psycopg import Error as DatabaseError


class Project(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, extra="forbid")
    outline: list[tuple[float, float]] = Field(min_length=3, max_length=100)
    holes: list[list[tuple[float, float]]] = Field(default_factory=list, max_length=20)
    tile: float = Field(default=600, ge=50, le=2000)
    grout: float = Field(default=2, ge=0, le=20)
    gap: float = Field(default=10, ge=0, le=100)
    threshold: float = Field(default=100, ge=1, le=1000)
    angle: float = Field(default=0, ge=0, lt=90)
    offset_x: float = Field(default=0, ge=-100000, le=100000)
    offset_y: float = Field(default=0, ge=-100000, le=100000)


class ProjectSave(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, extra="forbid")
    document: dict[str, Any]
    expectedRevision: int | None = Field(default=None, ge=0)


class PasswordLogin(BaseModel):
    model_config = ConfigDict(extra="forbid")
    password: str = Field(min_length=8, max_length=8)


app = FastAPI(title="Plitka — планировщик раскладки", version="1.0.0")

AUTH_COOKIE = "plitka_session"
AUTH_EXEMPT_PATHS = {"/api/auth/status", "/api/auth/login", "/api/health", "/api/ready"}


def _configured_password() -> str | None:
    password = os.environ.get("APP_PASSWORD")
    if password is not None and len(password) != 8:
        raise RuntimeError("APP_PASSWORD must contain exactly 8 characters")
    return password


def _session_token(password: str) -> str:
    return hmac.new(password.encode(), b"plitka-session-v1", hashlib.sha256).hexdigest()


def _authenticated(request: Request, password: str) -> bool:
    token = request.cookies.get(AUTH_COOKIE, "")
    return hmac.compare_digest(token, _session_token(password))


@app.middleware("http")
async def password_gate(request: Request, call_next):
    try:
        password = _configured_password()
    except RuntimeError:
        return JSONResponse({"detail": "Application password is misconfigured"}, status_code=503)
    if (
        password
        and request.url.path.startswith("/api/")
        and request.url.path not in AUTH_EXEMPT_PATHS
        and not _authenticated(request, password)
    ):
        return JSONResponse({"detail": "Authentication required"}, status_code=401)
    return await call_next(request)


@app.get("/api/auth/status")
def auth_status(request: Request):
    try:
        password = _configured_password()
    except RuntimeError:
        raise HTTPException(503, "Application password is misconfigured") from None
    return {"enabled": password is not None, "authenticated": not password or _authenticated(request, password)}


@app.post("/api/auth/login")
def auth_login(credentials: PasswordLogin, request: Request, response: Response):
    try:
        password = _configured_password()
    except RuntimeError:
        raise HTTPException(503, "Application password is misconfigured") from None
    if not password or not hmac.compare_digest(credentials.password, password):
        raise HTTPException(401, "Invalid password")
    forwarded_proto = request.headers.get("x-forwarded-proto", "").split(",", 1)[0].strip()
    response.set_cookie(
        AUTH_COOKIE,
        _session_token(password),
        httponly=True,
        secure=request.url.scheme == "https" or forwarded_proto == "https",
        samesite="strict",
        max_age=7 * 24 * 60 * 60,
        path="/",
    )
    return {"authenticated": True}


@app.post("/api/auth/logout")
def auth_logout(response: Response):
    response.delete_cookie(AUTH_COOKIE, path="/", samesite="strict")
    return {"authenticated": False}


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/ready")
def readiness():
    try:
        database = check_database()
    except DatabaseError:
        raise HTTPException(503, "Database unavailable") from None
    return {"status": "ok", "database": database}


def _database_error() -> HTTPException:
    return HTTPException(503, "Database unavailable")


@app.get("/api/projects")
def projects_index():
    try:
        return {"projects": list_projects()}
    except (DatabaseError, RuntimeError):
        raise _database_error() from None


@app.put("/api/projects/{project_id}")
def projects_save(project_id: str, request: ProjectSave):
    document = request.document
    expected_document_revision = request.expectedRevision if request.expectedRevision is not None else 0
    if (
        not project_id
        or len(project_id) > 100
        or document.get("id") != project_id
        or document.get("schemaVersion") != 6
        or isinstance(document.get("documentRevision"), bool)
        or not isinstance(document.get("documentRevision"), int)
        or document.get("documentRevision") != expected_document_revision
    ):
        raise HTTPException(422, "Invalid project document")
    try:
        size = len(json.dumps(document, ensure_ascii=False, allow_nan=False).encode())
    except (TypeError, ValueError):
        raise HTTPException(422, "Invalid project document") from None
    if size > 2 * 1024 * 1024:
        raise HTTPException(413, "Project document is too large")
    try:
        return {"document": save_project(project_id, document, request.expectedRevision)}
    except ProjectConflict as conflict:
        raise HTTPException(
            409,
            detail={"message": "Project revision conflict", "current": conflict.current},
        ) from None
    except (DatabaseError, RuntimeError):
        raise _database_error() from None


@app.delete("/api/projects/{project_id}")
def projects_delete(project_id: str, expectedRevision: int = Query(ge=0)):
    try:
        return {"status": delete_project(project_id, expectedRevision)}
    except ProjectConflict as conflict:
        raise HTTPException(
            409,
            detail={"message": "Project revision conflict", "current": conflict.current},
        ) from None
    except (DatabaseError, RuntimeError):
        raise _database_error() from None


@app.post("/api/layout")
def layout(project: Project):
    try:
        region, local = prepare(project)
        return calculate(project, region, local, project.offset_x, project.offset_y)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.post("/api/optimize")
def search(project: Project):
    try:
        return optimize(project)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.post("/api/v5/layout")
def layout_v5(project: Project):
    try:
        return calculate_v5(project, project.offset_x, project.offset_y)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.post("/api/v5/optimize")
def search_v5(project: Project):
    try:
        return optimize_v5(project)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


from .geometry.routes import router as geometry_router

app.include_router(geometry_router)
from .geometry.graph_routes import router as graph_router
app.include_router(graph_router)
from .geometry.physical_routes import router as physical_graph_router
app.include_router(physical_graph_router)

DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if DIST.exists():
    app.mount("/", StaticFiles(directory=DIST, html=True), name="frontend")
