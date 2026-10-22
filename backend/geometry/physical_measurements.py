"""Measurements in usable floor space and open physical wall junctions."""

import math

from shapely.geometry import LineString, Point as ShapelyPoint, Polygon

from .physical_junctions import polygon
from .physical_models import PhysicalGraphV5, PhysicalWallV5


def _round(value: float) -> float:
    return round(value * 10) / 10


def _without_collinear_vertices(outline: list[list[float]]) -> list[list[float]]:
    """Collapse measurement-only vertices that do not form a visible corner."""
    points = [list(point) for point in outline]
    changed = True
    while changed and len(points) > 3:
        changed = False
        for index, current in enumerate(points):
            previous = points[index - 1]
            following = points[(index + 1) % len(points)]
            incoming = (current[0] - previous[0], current[1] - previous[1])
            outgoing = (following[0] - current[0], following[1] - current[1])
            lengths = (math.hypot(*incoming), math.hypot(*outgoing))
            if min(lengths) < .1:
                points.pop(index)
                changed = True
                break
            cross = incoming[0] * outgoing[1] - incoming[1] * outgoing[0]
            same_direction = incoming[0] * outgoing[0] + incoming[1] * outgoing[1] > 0
            # Physical coordinates are stored to 0.1 mm. Allow one quantization
            # step while treating an otherwise straight boundary as one side.
            if same_direction and abs(cross) / max(lengths) <= .11:
                points.pop(index)
                changed = True
                break
    return points


def face_measurements(outline: list[list[float]]) -> tuple[list[dict], list[dict]]:
    floor = Polygon(outline)
    angles, dimensions = [], []
    if not floor.is_valid or floor.area <= 0:
        return angles, dimensions
    measurement_outline = _without_collinear_vertices(outline)
    representative = floor.representative_point()
    for index, (x, y) in enumerate(measurement_outline):
        px, py = measurement_outline[index - 1]
        nx, ny = measurement_outline[(index + 1) % len(measurement_outline)]
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


def _long_edges(wall: PhysicalWallV5):
    a, b, c, d = wall.corners
    return ((a, b), (d, c))


def _physical_joint_corners(host: PhysicalWallV5, branch: PhysicalWallV5,
                            host_edge: str) -> list[dict]:
    """Angles in free space at the two physical branch-to-face corners."""
    a, b, c, d = host.corners
    host_side = (a, b) if host_edge == "drawn" else (d, c)
    face = LineString([(point.x, point.y) for point in host_side])
    solid = polygon(host).union(polygon(branch))
    if not isinstance(solid, Polygon):
        return []
    outline = list(solid.exterior.coords)[:-1]
    result = []
    for first, last in _long_edges(branch):
        dx, dy = last.x - first.x, last.y - first.y
        length = math.hypot(dx, dy)
        if length < .1:
            continue
        # Rounded 0.1 mm corners can stop just before the receiving face.
        extended = LineString([(first.x, first.y),
                               (last.x + .2 * dx / length, last.y + .2 * dy / length)])
        hit = face.intersection(extended)
        if not isinstance(hit, ShapelyPoint):
            continue
        for index, (x, y) in enumerate(outline):
            if math.hypot(x - hit.x, y - hit.y) > .21:
                continue
            prev = outline[index - 1]
            following = outline[(index + 1) % len(outline)]
            first_ray = (prev[0] - x, prev[1] - y)
            second_ray = (following[0] - x, following[1] - y)
            lengths = (math.hypot(*first_ray), math.hypot(*second_ray))
            if min(lengths) < .1:
                continue
            u = (first_ray[0] / lengths[0], first_ray[1] / lengths[0])
            v = (second_ray[0] / lengths[1], second_ray[1] / lengths[1])
            bisector = (u[0] + v[0], u[1] + v[1])
            bisector_length = math.hypot(*bisector)
            if bisector_length < .01:
                continue
            nx, ny = bisector[0] / bisector_length, bisector[1] / bisector_length
            probe = ShapelyPoint(x + nx * 5, y + ny * 5)
            if solid.buffer(.1).covers(probe):
                continue
            angle = math.degrees(math.acos(max(-1, min(1, u[0] * v[0] + u[1] * v[1]))))
            anchor = {"x": _round(x + nx * 35), "y": _round(y + ny * 35)}
            if not solid.buffer(.1).covers(ShapelyPoint(anchor["x"], anchor["y"])):
                result.append({"valueDeg": _round(angle), "anchor": anchor,
                               "corner": {"x": _round(x), "y": _round(y)},
                               "rays": [{"x": u[0], "y": u[1]},
                                        {"x": v[0], "y": v[1]}]})
            break
    return result


def derive_open_joint_angles(graph: PhysicalGraphV5) -> list[dict]:
    walls = {wall.id: wall for wall in graph.walls}
    result = []
    for joint in graph.junctions:
        for index, part in enumerate(joint.participants):
            for other in joint.participants[index + 1:]:
                host_part = next((candidate for candidate in (part, other)
                                  if candidate.edge in ("drawn", "opposite")), None)
                branch_part = next((candidate for candidate in (part, other)
                                    if candidate.edge in ("startCap", "endCap")), None)
                if host_part and branch_part:
                    corners = _physical_joint_corners(walls[host_part.wallId],
                                                      walls[branch_part.wallId], host_part.edge)
                    if corners:
                        for corner in corners:
                            for wall_id, adjacent_id in ((part.wallId, other.wallId),
                                                         (other.wallId, part.wallId)):
                                result.append({"junctionId": joint.id, "wallId": wall_id,
                                               "adjacentWallId": adjacent_id,
                                               "label": "Угол стыка", **corner})
                        continue
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
