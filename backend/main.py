from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field
from .planner import calculate, optimize, prepare
from .planner_v5 import calculate_v5, optimize_v5
from .database import check_database
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


app = FastAPI(title="Plitka — планировщик раскладки", version="1.0.0")


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
