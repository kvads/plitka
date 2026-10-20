"""Measurements in usable floor space and open physical wall junctions."""

import math

from shapely.geometry import Point as ShapelyPoint, Polygon

from .physical_junctions import polygon
from .physical_models import PhysicalGraphV5, PhysicalWallV5


def _round(value: float) -> float:
    return round(value * 10) / 10


def face_measurements(outline: list[list[float]]) -> tuple[list[dict], list[dict]]:
    floor = Polygon(outline)
    angles, dimensions = [], []
    if not floor.is_valid or floor.area <= 0:
        return angles, dimensions
    representative = floor.representative_point()
    for index, (x, y) in enumerate(outline):
        px, py = outline[index - 1]
        nx, ny = outline[(index + 1) % len(outline)]
        before, after = (px - x, py - y), (nx - x, ny - y)
        lengths = (math.hypot(*before), math.hypot(*after))
        if min(lengths) < 0.1:
            continue
        cosine = max(-1, min(1, (before[0] * after[0] + before[1] * after[1]) /
                              (lengths[0] * lengths[1])))
        angle = math.degrees(math.acos(cosine))
        cross = before[0] * after[1] - before[1] * after[0]
        if (floor.exterior.is_ccw and cross > 0) or (not floor.exterior.is_ccw and cross < 0):
            angle = 360 - angle
        candidate = ShapelyPoint(x + (representative.x - x) * .08,
                                 y + (representative.y - y) * .08)
        if not floor.covers(candidate):
            candidate = representative
        angles.append({"valueDeg": _round(angle),
                       "anchor": {"x": _round(candidate.x), "y": _round(candidate.y)}})
        middle = ShapelyPoint((x + nx) / 2, (y + ny) / 2)
        dimension_anchor = ShapelyPoint(middle.x + (representative.x - middle.x) * .08,
                                        middle.y + (representative.y - middle.y) * .08)
        if not floor.covers(dimension_anchor):
            dimension_anchor = representative
        dimensions.append({"valueMm": _round(lengths[1]),
                           "from": {"x": _round(x), "y": _round(y)},
                           "to": {"x": _round(nx), "y": _round(ny)},
                           "anchor": {"x": _round(dimension_anchor.x),
                                      "y": _round(dimension_anchor.y)}})
    return angles, dimensions


def _wall_vector(wall: PhysicalWallV5, edge: str) -> tuple[float, float]:
    a, b = wall.drawnEdge
    dx, dy = b.x - a.x, b.y - a.y
    length = math.hypot(dx, dy)
    sign = -1 if edge == "endCap" else 1
    return sign * dx / length, sign * dy / length


def derive_open_joint_angles(graph: PhysicalGraphV5) -> list[dict]:
    walls = {wall.id: wall for wall in graph.walls}
    result = []
    for joint in graph.junctions:
        for index, part in enumerate(joint.participants):
            for other in joint.participants[index + 1:]:
                first = _wall_vector(walls[part.wallId], part.edge)
                second = _wall_vector(walls[other.wallId], other.edge)
                cosine = abs(first[0] * second[0] + first[1] * second[1])
                angle = _round(math.degrees(math.acos(max(0, min(1, cosine)))))
                anchor = None
                # Search radially for a label anchor outside every occupied wall.
                radius = max(walls[part.wallId].thicknessMm,
                             walls[other.wallId].thicknessMm) + 30
                for step in range(16):
                    theta = 2 * math.pi * (step + .5) / 16
                    x = _round(part.point.x + radius * math.cos(theta))
                    y = _round(part.point.y + radius * math.sin(theta))
                    probe = ShapelyPoint(x, y)
                    if all(not polygon(wall).buffer(0.1).covers(probe) for wall in graph.walls):
                        anchor = {"x": x, "y": y}
                        break
                if anchor is None:
                    continue
                for wall_id, adjacent_id in ((part.wallId, other.wallId),
                                             (other.wallId, part.wallId)):
                    result.append({"junctionId": joint.id, "wallId": wall_id,
                                   "adjacentWallId": adjacent_id,
                                   "valueDeg": angle, "label": "Угол стыка",
                                   "anchor": anchor})
    return result
