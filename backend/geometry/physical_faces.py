"""Find usable floor polygons enclosed by physical wall footprints."""

import hashlib
import json

from shapely.geometry import MultiPolygon, Polygon
from shapely.ops import unary_union

from .physical_junctions import polygon
from .physical_models import PhysicalGraphV5
from .physical_measurements import face_measurements
from .physical_openings import opening_parts


def _hash(value) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True,
                                     separators=(",", ":")).encode()).hexdigest()


def _ring(coordinates) -> list[list[float]]:
    return [[round(x * 10) / 10, round(y * 10) / 10] for x, y in list(coordinates)[:-1]]


def _canonical_ring(ring: list[list[float]]) -> list[list[int]]:
    points = [(round(x * 10), round(y * 10)) for x, y in ring]
    if not points:
        return []
    variants = []
    for ordered in (points, list(reversed(points))):
        start = min(range(len(ordered)), key=lambda i: ordered[i:] + ordered[:i])
        variants.append(ordered[start:] + ordered[:start])
    return [list(point) for point in min(variants)]


def derive_physical_faces(graph: PhysicalGraphV5) -> list[dict]:
    if not graph.walls:
        return []
    union = unary_union([polygon(wall) for wall in graph.walls])
    areas = list(union.geoms) if isinstance(union, MultiPolygon) else [union]
    candidates = []
    for area in areas:
        if not isinstance(area, Polygon):
            continue
        for interior in area.interiors:
            floor = Polygon(interior)
            if not floor.is_valid or floor.area < 0.1:
                continue
            outline = _ring(floor.exterior.coords)
            boundary = floor.boundary
            wall_ids = sorted(wall.id for wall in graph.walls
                              if polygon(wall).boundary.intersection(boundary).length > 0.1)
            joint_ids = sorted(joint.id for joint in graph.junctions
                               if {part.wallId for part in joint.participants}.issubset(wall_ids))
            topology_key = _hash({"walls": wall_ids, "junctions": joint_ids})
            inner_angles, free_dimensions = face_measurements(outline)
            candidates.append({
                "topologyKey": topology_key,
                "floor": floor,
                "shape": floor,
                "innerAngles": inner_angles,
                "freeDimensions": free_dimensions,
                "connectedRoomKeys": set(),
                "doorIds": [],
            })

    walls = {wall.id: wall for wall in graph.walls}
    for opening in graph.openings:
        _, drawn_half, opposite_half = opening_parts(walls[opening.wallId], opening)
        sides = []
        for half in (drawn_half, opposite_half):
            matches = sorted(((candidate["floor"].boundary.intersection(half.boundary).length,
                               candidate) for candidate in candidates),
                             key=lambda item: item[0], reverse=True)
            sides.append(matches[0][1] if matches and matches[0][0] > opening.widthMm / 2 else None)
        first, second = sides
        if first is None or second is None or first is second:
            continue
        for candidate, half, other in ((first, drawn_half, second),
                                       (second, opposite_half, first)):
            candidate["shape"] = candidate["shape"].union(half)
            candidate["connectedRoomKeys"].add(other["topologyKey"])
            candidate["doorIds"].append(opening.id)

    faces = []
    for candidate in candidates:
        shape = candidate.pop("shape")
        candidate.pop("floor")
        connected = sorted(candidate.pop("connectedRoomKeys"))
        outline = _ring(shape.exterior.coords)
        holes = [_ring(interior.coords) for interior in shape.interiors]
        faces.append({
            **candidate,
            "geometryKey": _hash({"outline": _canonical_ring(outline),
                                  "holes": sorted(_canonical_ring(hole) for hole in holes)}),
            "polygon": {"outline": outline, "holes": holes},
            "areaMm2": round(shape.area * 10) / 10,
            "validation": {"valid": True, "issues": []},
            "connectedRoomKeys": connected,
        })
    return sorted(faces, key=lambda face: face["topologyKey"])
