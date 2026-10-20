"""Atomic commands on the physical wall graph."""

from copy import deepcopy
import hashlib
import math
from shapely.geometry import LineString, Point as ShapelyPoint

from .physical_geometry import create_wall
from .physical_junctions import simple_contact, polygon, rebuild_simple_contacts
from .physical_models import PhysicalGraphV5, PhysicalPoint
from .physical_validation import validate_physical_graph


def _fields(command: dict, required: set[str], optional: set[str] = frozenset()) -> None:
    if not isinstance(command, dict) or not required <= command.keys() or command.keys() - required - optional:
        raise ValueError("Проверьте параметры команды стены.")


def _new_thickness(value: object) -> float:
    if (isinstance(value, bool) or not isinstance(value, (int, float)) or
            not math.isfinite(value) or not 10 <= value <= 100000 or
            value % 10 != 0):
        raise ValueError("Толщина стены должна быть от 10 до 100000 мм с шагом 10 мм.")
    return value


def _trim_to_first_face(points: list[PhysicalPoint], existing) -> list[PhysicalPoint]:
    """Stop a drawn edge on the first physical boundary it reaches."""
    line = LineString([(point.x, point.y) for point in points])
    hit = line.intersection(polygon(existing).boundary)
    if hit.is_empty:
        return points
    if isinstance(hit, ShapelyPoint):
        hits = [hit]
    elif hasattr(hit, "geoms") and all(isinstance(item, ShapelyPoint) for item in hit.geoms):
        hits = list(hit.geoms)
    else:
        return points
    candidates = sorted(((line.project(item), item) for item in hits), key=lambda row: row[0])
    start_inside = polygon(existing).contains(ShapelyPoint(points[0].x, points[0].y))
    if start_inside:
        distance, item = candidates[0]
        if distance < line.length - 0.1:
            return [PhysicalPoint(x=round(item.x * 10) / 10,
                                  y=round(item.y * 10) / 10), points[1]]
    else:
        for distance, item in candidates:
            if distance > 0.1 and distance < line.length - 0.1:
                return [points[0], PhysicalPoint(x=round(item.x * 10) / 10,
                                                 y=round(item.y * 10) / 10)]
    return points


def _complete_oblique_contact(points: list[PhysicalPoint], existing, side: str,
                              thickness_mm: float) -> list[PhysicalPoint]:
    """Carry both longitudinal edges into the receiving wall's near face.

    A square end cut at the first edge hit leaves the opposite corner short
    for one diagonal orientation. The local overlap is consumed by the wall
    union, giving the visible joint its correctly unequal outer/inner edges.
    """
    receiving = polygon(existing)
    wall = create_wall("contact-probe", points, side, thickness_mm)
    start, finish = points
    dx, dy = finish.x - start.x, finish.y - start.y
    length = math.hypot(dx, dy)
    if length < .1:
        return points
    ux, uy = dx / length, dy / length
    # Search a local continuation of either short cap's opposite corner.
    # The user's first click can lie on the receiving face too.
    extension_limit = min(thickness_mm * 10, existing.thicknessMm * 10)
    for cap_index, opposite in ((0, wall.corners[3]), (1, wall.corners[2])):
        cap = points[cap_index]
        cap_point = ShapelyPoint(cap.x, cap.y)
        if (receiving.boundary.distance(cap_point) > .15 or
                receiving.contains(cap_point) or
                receiving.buffer(.1).covers(ShapelyPoint(opposite.x, opposite.y))):
            continue
        direction = -1 if cap_index == 0 else 1
        ray = LineString([(opposite.x, opposite.y),
                          (opposite.x + direction * ux * extension_limit,
                           opposite.y + direction * uy * extension_limit)])
        hits = ray.intersection(receiving.boundary)
        if isinstance(hits, ShapelyPoint):
            candidates = [hits]
        elif hasattr(hits, "geoms"):
            candidates = [item for item in hits.geoms if isinstance(item, ShapelyPoint)]
        else:
            continue
        for hit in sorted(candidates, key=ray.project):
            distance = ray.project(hit)
            if distance <= .1 or distance >= extension_limit:
                continue
            for correction in (0, -.1, .1, -.2, .2):
                shifted = PhysicalPoint(
                    x=round((cap.x + direction * ux * (distance + correction)) * 10) / 10,
                    y=round((cap.y + direction * uy * (distance + correction)) * 10) / 10)
                candidate = [shifted, finish] if cap_index == 0 else [start, shifted]
                try:
                    if simple_contact(existing, create_wall("contact-probe", candidate,
                                                             side, thickness_mm), "probe"):
                        return candidate
                except ValueError:
                    pass
    return points


def execute_physical(graph: PhysicalGraphV5, command: dict,
                     command_id: str) -> tuple[PhysicalGraphV5, list[str]]:
    """Return a new graph or raise without mutating the input graph."""
    validate_physical_graph(graph)
    kind = command.get("type") if isinstance(command, dict) else None
    if kind == "drawWall":
        _fields(command, {"type", "drawnEdge", "side"}, {"thicknessMm"})
        if len(command_id) > 94:
            raise ValueError("Идентификатор команды слишком длинный.")
        edge = command["drawnEdge"]
        if not isinstance(edge, list) or len(edge) != 2:
            raise ValueError("Выберите две точки края стены.")
        try:
            points = [PhysicalPoint.model_validate(point) for point in edge]
        except Exception as exc:
            raise ValueError("Выберите две точки края стены.") from exc
        wall_id = "wall-" + command_id
        if any(wall.id == wall_id for wall in graph.walls):
            raise ValueError("Команда стены уже применена.")
        thickness_mm = _new_thickness(command.get("thicknessMm", 100))
        next_graph = deepcopy(graph)
        for existing in next_graph.walls:
            points = _trim_to_first_face(points, existing)
            points = _complete_oblique_contact(points, existing, command["side"],
                                               thickness_mm)
        wall = create_wall(wall_id, points, command["side"], thickness_mm)
        for existing in next_graph.walls:
            suffix = hashlib.sha256((command_id + "\0" + existing.id).encode()).hexdigest()[:20]
            joint_id = "joint-" + command_id if len(next_graph.walls) == 1 else "joint-" + suffix
            joint = simple_contact(existing, wall, joint_id)
            if joint:
                next_graph.junctions.append(joint)
        next_graph.walls.append(wall)
        validate_physical_graph(next_graph)
        return next_graph, [wall_id]
    if kind == "setWallThickness":
        _fields(command, {"type", "wallId", "thicknessMm"})
        if not isinstance(command["wallId"], str):
            raise ValueError("Выберите стену.")
        next_graph = deepcopy(graph)
        index = next((i for i, wall in enumerate(next_graph.walls)
                      if wall.id == command["wallId"]), None)
        if index is None:
            raise ValueError("Стена не найдена.")
        old = next_graph.walls[index]
        replacement = create_wall(old.id, old.drawnEdge, old.side,
                                  _new_thickness(command["thicknessMm"]))
        next_graph.walls[index] = replacement
        next_graph = rebuild_simple_contacts(next_graph, graph)
        validate_physical_graph(next_graph)
        return next_graph, [old.id]
    if kind == "nudgeWallHandle":
        _fields(command, {"type", "wallId", "handle", "axis", "direction"})
        if (command["handle"] not in ("start", "center", "end") or
                command["axis"] not in ("x", "y") or
                type(command["direction"]) is not int or command["direction"] not in (-1, 1)):
            raise ValueError("Выберите точку стены и направление смещения.")
        next_graph = deepcopy(graph)
        selected = next((wall for wall in next_graph.walls if wall.id == command["wallId"]), None)
        if selected is None:
            raise ValueError("Стена не найдена.")
        dx = command["direction"] if command["axis"] == "x" else 0
        dy = command["direction"] if command["axis"] == "y" else 0
        moves: dict[str, set[int]] = {selected.id: (
            {0, 1} if command["handle"] == "center" else
            {0} if command["handle"] == "start" else {1})}
        for joint in graph.junctions:
            selected_part = next((part for part in joint.participants if part.wallId == selected.id), None)
            if selected_part is None:
                continue
            if selected_part.edge == "startCap" and 0 not in moves[selected.id]:
                continue
            if selected_part.edge == "endCap" and 1 not in moves[selected.id]:
                continue
            if selected_part.edge in ("drawn", "opposite") and command["handle"] != "center":
                continue
            for part in joint.participants:
                if part.wallId == selected.id or part.attachment != "end":
                    continue
                neighbor = next(wall for wall in graph.walls if wall.id == part.wallId)
                start_distance = min((part.point.x - corner.x) ** 2 + (part.point.y - corner.y) ** 2
                                     for corner in (neighbor.corners[0], neighbor.corners[3]))
                end_distance = min((part.point.x - corner.x) ** 2 + (part.point.y - corner.y) ** 2
                                   for corner in (neighbor.corners[1], neighbor.corners[2]))
                moves.setdefault(neighbor.id, set()).add(0 if start_distance <= end_distance else 1)
        for index, wall in enumerate(next_graph.walls):
            endpoints = moves.get(wall.id)
            if not endpoints:
                continue
            edge = [PhysicalPoint(x=point.x + (dx if i in endpoints else 0),
                                  y=point.y + (dy if i in endpoints else 0))
                    for i, point in enumerate(wall.drawnEdge)]
            next_graph.walls[index] = create_wall(wall.id, edge, wall.side, wall.thicknessMm)
        next_graph = rebuild_simple_contacts(next_graph, graph)
        validate_physical_graph(next_graph)
        return next_graph, list(moves)
    if kind == "deleteWall":
        _fields(command, {"type", "wallId"})
        wall_id = command["wallId"]
        if not isinstance(wall_id, str) or not any(wall.id == wall_id for wall in graph.walls):
            raise ValueError("Стена не найдена.")
        next_graph = PhysicalGraphV5(
            walls=[wall for wall in graph.walls if wall.id != wall_id],
            junctions=[joint for joint in graph.junctions
                       if all(part.wallId != wall_id for part in joint.participants)],
        )
        validate_physical_graph(next_graph)
        return next_graph, [wall_id]
    raise ValueError("Неизвестная команда стены.")
