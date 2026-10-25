"""Find usable floor polygons enclosed by physical wall footprints."""

import hashlib
import json

from shapely.geometry import LineString, MultiPolygon, Polygon
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
        wall = walls[opening.wallId]
        opening_shape, drawn_half, opposite_half = opening_parts(wall, opening)
        drawn_edge = opening_shape.boundary.intersection(LineString([
            (wall.corners[0].x, wall.corners[0].y),
            (wall.corners[1].x, wall.corners[1].y),
        ]))
        opposite_edge = opening_shape.boundary.intersection(LineString([
            (wall.corners[3].x, wall.corners[3].y),
            (wall.corners[2].x, wall.corners[2].y),
        ]))
        sides = []
        for edge in (drawn_edge, opposite_edge):
            matches = sorted(((candidate["floor"].boundary.intersection(edge).length,
                               candidate) for candidate in candidates),
                             key=lambda item: item[0], reverse=True)
            sides.append(matches[0][1] if matches and matches[0][0] > opening.widthMm / 2 else None)
        first, second = sides
        # The door frame normally sits inside the wall thickness rather than
        # flush with the room face.  Keep the reveal/threshold half belonging
        # to every room even when the other side of the opening is outdoors or
        # otherwise has no derived room.  Previously those one-sided reveals
        # were discarded, so the layout stopped at the wall face.
        for candidate, half in ((first, drawn_half), (second, opposite_half)):
            if candidate is None:
                continue
            candidate["shape"] = candidate["shape"].union(half)
            if opening.id not in candidate["doorIds"]:
                candidate["doorIds"].append(opening.id)
        if first is not None and second is not None and first is not second:
            first["connectedRoomKeys"].add(second["topologyKey"])
            second["connectedRoomKeys"].add(first["topologyKey"])

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
