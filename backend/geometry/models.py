from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, strict=True)


class Vertex(Model):
    id: str = Field(min_length=1, max_length=100)
    x: float
    y: float


class Wall(Model):
    id: str = Field(min_length=1, max_length=100)
    startVertexId: str
    endVertexId: str


class Contour(Model):
    id: str = Field(min_length=1, max_length=100)
    kind: Literal["outer", "hole"]
    closed: bool
    winding: Literal["ccw", "cw"]
    vertices: list[Vertex] = Field(max_length=100)
    walls: list[Wall] = Field(max_length=100)


class Constraint(Model):
    id: str = Field(min_length=1, max_length=100)
    kind: Literal["length", "interiorAngle", "firstWallOrientation"]
    wallId: str
    value: float
    fixed: bool


class Geometry(Model):
    outer: Contour
    holes: list[Contour] = Field(max_length=20)
    constraints: list[Constraint] = Field(max_length=6300)
    fieldInputs: dict[str, str]

    @model_validator(mode="after")
    def references(self):
        ids, wall_ids, first_ids = set(), set(), set()
        for c in [self.outer, *self.holes]:
            for item in [c, *c.vertices, *c.walls]:
                if item.id in ids:
                    raise ValueError("Повтор ID внутри снимка")
                ids.add(item.id)
            n = len(c.vertices)
            if len(c.walls) != (n if c.closed else max(0, n - 1)):
                raise ValueError("Неверные связи стен")
            for i, w in enumerate(c.walls):
                if (
                    w.startVertexId != c.vertices[i].id
                    or w.endVertexId != c.vertices[(i + 1) % n].id
                ):
                    raise ValueError("Стена должна связывать соседние вершины")
                wall_ids.add(w.id)
            if c.walls:
                first_ids.add(c.walls[0].id)
        if self.outer.kind != "outer" or any(c.kind != "hole" for c in self.holes):
            raise ValueError("Неверный вид контура")
        seen = set()
        for con in self.constraints:
            if (
                con.id in ids
                or con.wallId not in wall_ids
                or (con.wallId, con.kind) in seen
            ):
                raise ValueError("Неверная ссылка или повтор условия")
            ids.add(con.id)
            seen.add((con.wallId, con.kind))
            if con.kind == "firstWallOrientation" and con.wallId not in first_ids:
                raise ValueError("Ориентация доступна только первой стене")
        if any(len(v) > 100 for v in self.fieldInputs.values()):
            raise ValueError("Слишком длинный ввод")
        return self


class Request(Model):
    requestId: str = Field(min_length=1, max_length=100)
    draftRevision: int = Field(ge=0)
    geometry: Geometry


class Operation(Model):
    type: Literal[
        "setLength",
        "setInteriorAngle",
        "setOrientation",
        "moveVertex",
        "releaseConstraint",
        "reconcile",
    ]
    wallId: str | None = None
    contourId: str | None = None
    vertexId: str | None = None
    constraintId: str | None = None
    value: float | None = None
    x: float | None = None
    y: float | None = None


class SolveRequest(Request):
    operation: Operation
