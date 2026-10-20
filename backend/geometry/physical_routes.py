"""Versioned validation, preview, commands, and deletion for physical walls."""

from typing import Literal

from fastapi import APIRouter, Request
from pydantic import Field
from shapely.geometry import Polygon, MultiPolygon
from shapely.ops import unary_union

from .graph_routes import read_request
from .models import Model
from .physical_models import PhysicalGraphV5
from .physical_validation import validate_physical_graph, canonical_basis_key
from .physical_commands import execute_physical
from .physical_junctions import polygon, validate_simple_contacts
from .physical_faces import derive_physical_faces
from .physical_measurements import derive_open_joint_angles


router = APIRouter(prefix="/api/v5/plan")


class PhysicalRequestV5(Model):
    schemaVersion: Literal[5]
    draftRevision: int = Field(ge=0)
    basisKey: str = Field(max_length=2_000_000)
    graph: PhysicalGraphV5


class PhysicalValidateRequestV5(PhysicalRequestV5):
    requestId: str = Field(min_length=1, max_length=100)


class PhysicalCommandRequestV5(PhysicalRequestV5):
    commandId: str = Field(min_length=1, max_length=100)
    command: dict


class PhysicalPreviewRequestV5(PhysicalRequestV5):
    requestId: str = Field(min_length=1, max_length=100)
    drawnEdge: list[dict] = Field(min_length=2, max_length=2)
    side: Literal["left", "right"]
    thicknessMm: float = Field(gt=0, le=100000)


class PhysicalDeletionPreviewRequestV5(PhysicalRequestV5):
    requestId: str = Field(min_length=1, max_length=100)
    target: dict


def _issue(code: str, message: str) -> dict:
    return {"code": code, "message": message, "entityIds": [],
            "scope": "global", "affectedRoomKeys": []}


def _base(req: PhysicalRequestV5, status: str, issues: list[dict]) -> dict:
    return {
        "schemaVersion": 5,
        "draftRevision": req.draftRevision,
        "basisKey": req.basisKey,
        "status": status,
        "graph": req.graph.model_dump(mode="json"),
        "affectedWallIds": [],
        "wallArea": [],
        "faces": [],
        "openJointAngles": [],
        "issues": issues,
    }


def _check_basis(req: PhysicalRequestV5) -> None:
    if req.basisKey != canonical_basis_key(req.graph):
        raise ValueError("Основа плана изменилась. Повторите действие с актуальной версией.")


def _area(graph: PhysicalGraphV5) -> list[dict]:
    if not graph.walls:
        return []
    union = unary_union([polygon(wall) for wall in graph.walls])
    polygons = list(union.geoms) if isinstance(union, MultiPolygon) else [union]
    def ring(coords):
        return [[round(x * 10) / 10, round(y * 10) / 10] for x, y in list(coords)[:-1]]
    return [{"outline": ring(shape.exterior.coords),
             "holes": [ring(interior.coords) for interior in shape.interiors]}
            for shape in polygons if isinstance(shape, Polygon) and shape.area > 0]


@router.post("/validate")
async def validate_route(request: Request):
    req = await read_request(request, PhysicalValidateRequestV5)
    if not isinstance(req, PhysicalValidateRequestV5):
        return req
    try:
        _check_basis(req)
        validate_physical_graph(req.graph)
        validate_simple_contacts(req.graph)
    except ValueError as exc:
        return {**_base(req, "invalid", [_issue("physical_graph", str(exc))]),
                "requestId": req.requestId}
    result = _base(req, "valid", [])
    result["requestId"] = req.requestId
    result["wallArea"] = _area(req.graph)
    result["faces"] = derive_physical_faces(req.graph)
    result["openJointAngles"] = derive_open_joint_angles(req.graph)
    return result


@router.post("/preview")
async def preview_route(request: Request):
    req = await read_request(request, PhysicalPreviewRequestV5)
    if not isinstance(req, PhysicalPreviewRequestV5):
        return req
    try:
        _check_basis(req)
        candidate, affected = execute_physical(req.graph, {
            "type": "drawWall", "drawnEdge": req.drawnEdge,
            "side": req.side, "thicknessMm": req.thicknessMm,
        }, req.requestId)
        validate_simple_contacts(candidate)
        result = {**_base(req, "valid", []), "requestId": req.requestId,
                  "graph": candidate.model_dump(mode="json"),
                  "affectedWallIds": affected, "wallArea": _area(candidate),
                  "faces": derive_physical_faces(candidate),
                  "openJointAngles": derive_open_joint_angles(candidate)}
        result["proposedWall"] = candidate.walls[-1].model_dump(mode="json")
        return result
    except ValueError as exc:
        return {**_base(req, "invalid", [_issue("physical_graph", str(exc))]),
                "requestId": req.requestId}


@router.post("/command")
async def command_route(request: Request):
    req = await read_request(request, PhysicalCommandRequestV5)
    if not isinstance(req, PhysicalCommandRequestV5):
        return req
    try:
        _check_basis(req)
        candidate, affected = execute_physical(req.graph, req.command, req.commandId)
        validate_simple_contacts(candidate)
        return {**_base(req, "applied", []), "commandId": req.commandId,
                "graph": candidate.model_dump(mode="json"),
                "affectedWallIds": affected, "wallArea": _area(candidate),
                "faces": derive_physical_faces(candidate),
                "openJointAngles": derive_open_joint_angles(candidate)}
    except ValueError as exc:
        return {**_base(req, "invalid", [_issue("physical_graph", str(exc))]),
                "commandId": req.commandId}


@router.post("/deletion-preview")
async def deletion_preview_route(request: Request):
    req = await read_request(request, PhysicalDeletionPreviewRequestV5)
    if not isinstance(req, PhysicalDeletionPreviewRequestV5):
        return req
    try:
        _check_basis(req)
        if set(req.target) != {"kind", "wallId"} or req.target["kind"] != "wall":
            raise ValueError("Выберите стену для удаления.")
        candidate, affected = execute_physical(req.graph, {
            "type": "deleteWall", "wallId": req.target["wallId"],
        }, req.requestId)
        validate_simple_contacts(candidate)
        before = {face["topologyKey"] for face in derive_physical_faces(req.graph)}
        after = {face["topologyKey"] for face in derive_physical_faces(candidate)}
        removed_joints = [joint.id for joint in req.graph.junctions
                          if any(part.wallId == req.target["wallId"] for part in joint.participants)]
        return {**_base(req, "ready", []), "requestId": req.requestId,
                "target": req.target, "impact": {
                    "wallIds": affected, "junctionIds": removed_joints,
                    "affectedRoomKeys": sorted(before | after),
                    "disappearedRoomKeys": sorted(before - after),
                }}
    except ValueError as exc:
        return {**_base(req, "invalid", [_issue("physical_graph", str(exc))]),
                "requestId": req.requestId, "target": req.target, "impact": None}
