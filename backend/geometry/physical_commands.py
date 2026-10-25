"""Atomic commands on the physical wall graph."""

from copy import deepcopy
import hashlib
import math
from shapely.geometry import LineString, Point as ShapelyPoint

from .physical_geometry import create_wall
from .physical_junctions import (simple_contact, polygon, rebuild_simple_contacts,
                                 rounded_contact_overlap_limit)
from .physical_models import DoorOpeningV5, PhysicalGraphV5, PhysicalPoint, PhysicalWallV5
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


def _door_width(value: object) -> float:
    if (isinstance(value, bool) or not isinstance(value, (int, float)) or
            not math.isfinite(value) or not 300 <= value <= 3000 or value % 10 != 0):
        raise ValueError("Ширина дверного проёма должна быть от 300 до 3000 мм с шагом 10 мм.")
    return value


def _reveal_depth(value: object, thickness: float) -> float:
    if (isinstance(value, bool) or not isinstance(value, (int, float)) or
            not math.isfinite(value) or not 0 <= value <= thickness or
            abs(round(value * 10) - value * 10) > 1e-7):
        raise ValueError("Глубина откоса должна быть от 0 до толщины стены с шагом 0,1 мм.")
    return round(value * 10) / 10


def _trim_to_first_face(points: list[PhysicalPoint], existing) -> list[PhysicalPoint]:
    """Stop a drawn edge on the first physical boundary it reaches."""
    line = LineString([(point.x, point.y) for point in points])
    receiving = polygon(existing)
    # A snapped start may lie on the receiving cap and travel through its
    # local corner before leaving the host. That short passage is the overlap
    # needed to construct a shared miter, not an obstacle that should collapse
    # the entire new wall to the first exit point.
    if receiving.boundary.distance(ShapelyPoint(points[0].x, points[0].y)) <= .15:
        return points
    hit = line.intersection(receiving.boundary)
    if hit.is_empty:
        return points
    if isinstance(hit, ShapelyPoint):
        hits = [hit]
    elif hasattr(hit, "geoms") and all(isinstance(item, ShapelyPoint) for item in hit.geoms):
        hits = list(hit.geoms)
    else:
        return points
    candidates = sorted(((line.project(item), item) for item in hits), key=lambda row: row[0])
    start_inside = receiving.contains(ShapelyPoint(points[0].x, points[0].y))
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


def _miter_contact(wall: PhysicalWallV5, existing: PhysicalWallV5) -> PhysicalWallV5:
    """Stop each long edge separately at the same receiving physical face."""
    # Coordinates are persisted at tenth-millimetre precision. A cap which
    # was projected onto an oblique host face can therefore end up a few
    # hundredths of a millimetre away from it; still run the exact miter in
    # that rounding band.
    if polygon(wall).distance(polygon(existing)) > .15:
        return wall
    a, b, c, d = wall.corners
    length = math.hypot(b.x - a.x, b.y - a.y)
    ux, uy = (b.x - a.x) / length, (b.y - a.y) / length
    limit = min(length / 2, 10 * max(wall.thicknessMm, existing.thicknessMm))
    candidates = []
    for host_a, host_b in ((existing.corners[0], existing.corners[1]),
                           (existing.corners[3], existing.corners[2]),
                           (existing.corners[0], existing.corners[3]),
                           (existing.corners[1], existing.corners[2])):
        vx, vy = host_b.x - host_a.x, host_b.y - host_a.y
        denominator = ux * vy - uy * vx
        if abs(denominator) < .1 * math.hypot(vx, vy):
            continue
        for cap_indices in ((0, 3), (1, 2)):
            corners = list(wall.corners)
            distances = []
            for index in cap_indices:
                corner = corners[index]
                ox, oy = host_a.x - corner.x, host_a.y - corner.y
                distance = (ox * vy - oy * vx) / denominator
                ratio = (ox * uy - oy * ux) / denominator
                if not -.001 <= ratio <= 1.001 or abs(distance) > limit:
                    break
                distances.append(abs(distance))
                corners[index] = PhysicalPoint(
                    x=round((corner.x + ux * distance) * 10) / 10,
                    y=round((corner.y + uy * distance) * 10) / 10)
            if len(distances) != 2:
                continue
            if all(corners[index] == wall.corners[index] for index in cap_indices):
                continue
            candidate = wall.model_copy(update={"corners": corners,
                "drawnEdge": [corners[0], corners[1]]})
            try:
                validate_physical_graph(PhysicalGraphV5(walls=[candidate], junctions=[]))
                if (polygon(candidate).intersection(polygon(existing)).area <=
                        rounded_contact_overlap_limit(candidate, existing) and
                        simple_contact(existing, candidate, "miter-probe")):
                    candidates.append((sum(distances), candidate))
            except ValueError:
                pass
    return min(candidates, key=lambda item: item[0])[1] if candidates else wall


def _line_intersection(first_a: PhysicalPoint, first_b: PhysicalPoint,
                       second_a: PhysicalPoint, second_b: PhysicalPoint) -> PhysicalPoint | None:
    ux, uy = first_b.x - first_a.x, first_b.y - first_a.y
    vx, vy = second_b.x - second_a.x, second_b.y - second_a.y
    denominator = ux * vy - uy * vx
    if abs(denominator) < .1 * math.hypot(ux, uy) * math.hypot(vx, vy):
        return None
    ox, oy = second_a.x - first_a.x, second_a.y - first_a.y
    distance = (ox * vy - oy * vx) / denominator
    return PhysicalPoint(x=round((first_a.x + distance * ux) * 10) / 10,
                         y=round((first_a.y + distance * uy) * 10) / 10)


def _replace_cap(wall: PhysicalWallV5, cap_index: int,
                 drawn: PhysicalPoint, opposite: PhysicalPoint) -> PhysicalWallV5:
    corners = list(wall.corners)
    corners[cap_index] = drawn
    corners[3 if cap_index == 0 else 2] = opposite
    edge = list(wall.drawnEdge)
    edge[cap_index] = drawn
    return wall.model_copy(update={"drawnEdge": edge, "corners": corners})


def _restore_square_cap(wall: PhysicalWallV5, cap_index: int) -> PhysicalWallV5:
    """Remove a joint miter from one cap while preserving the drawn edge.

    A cap-to-cap joint may move either or both cap corners.  The drawn edge is
    the wall's user-authored baseline, so its canonical perpendicular offset
    is also the canonical free cap after that joint is removed.
    """
    canonical = create_wall(wall.id, wall.drawnEdge, wall.side, wall.thicknessMm)
    opposite_index = 3 if cap_index == 0 else 2
    return _replace_cap(wall, cap_index, canonical.corners[cap_index],
                        canonical.corners[opposite_index])


def _miter_end_caps(first: PhysicalWallV5, second: PhysicalWallV5
                    ) -> tuple[PhysicalWallV5, PhysicalWallV5] | None:
    """Join two nearby wall ends by moving both caps to one shared miter.

    A corner connection is different from a T-junction: both longitudinal
    outlines must meet at their intersections. Keeping either original square
    cap produces the wedge/overlap visible in the editor and cannot be stored
    as a physical cap-to-cap contact.
    """
    first_long = ((first.corners[0], first.corners[1]),
                  (first.corners[3], first.corners[2]))
    second_long = ((second.corners[0], second.corners[1]),
                   (second.corners[3], second.corners[2]))
    limit = 10 * max(first.thicknessMm, second.thicknessMm)
    candidates = []
    for first_cap in (0, 1):
        first_indices = (first_cap, 3 if first_cap == 0 else 2)
        first_center = PhysicalPoint(
            x=sum(first.corners[index].x for index in first_indices) / 2,
            y=sum(first.corners[index].y for index in first_indices) / 2)
        for second_cap in (0, 1):
            second_indices = (second_cap, 3 if second_cap == 0 else 2)
            first_cap_line = LineString([(first.corners[index].x, first.corners[index].y)
                                         for index in first_indices])
            second_cap_line = LineString([(second.corners[index].x, second.corners[index].y)
                                          for index in second_indices])
            shared_cap = first_cap_line.intersection(second_cap_line)
            eligible = False
            if isinstance(shared_cap, ShapelyPoint):
                # Even a single shared cap corner is an end-to-end wall
                # junction.  Both walls must therefore finish on the same
                # miter: leaving the original square caps makes the inner
                # corner of each wall visibly too long.
                eligible = True
            elif not shared_cap.is_empty and shared_cap.length >= .1:
                eligible = True
            if not eligible and shared_cap.is_empty:
                # Near a free host end, an oblique incoming cap can hit the
                # long face with its inner corner while its outer corner would
                # project just beyond the finite face. Treat that corner zone
                # as a miter and move both wall ends; rejecting it prevents a
                # diagonal brace from closing an otherwise valid L outline.
                first_dx = first.drawnEdge[1].x - first.drawnEdge[0].x
                first_dy = first.drawnEdge[1].y - first.drawnEdge[0].y
                second_dx = second.drawnEdge[1].x - second.drawnEdge[0].x
                second_dy = second.drawnEdge[1].y - second.drawnEdge[0].y
                cosine = abs(first_dx * second_dx + first_dy * second_dy) / max(
                    1e-9, math.hypot(first_dx, first_dy) * math.hypot(second_dx, second_dy))
                if cosine > .1:
                    reach = 2 * max(first.thicknessMm, second.thicknessMm)
                    for host_long in second_long:
                        shared_long = first_cap_line.intersection(LineString([
                            (host_long[0].x, host_long[0].y),
                            (host_long[1].x, host_long[1].y)]))
                        host_end = ShapelyPoint(host_long[second_cap].x,
                                                host_long[second_cap].y)
                        if (not shared_long.is_empty and
                                shared_long.distance(host_end) <= reach + .15):
                            eligible = True
                            break
            if not eligible:
                continue
            second_center = PhysicalPoint(
                x=sum(second.corners[index].x for index in second_indices) / 2,
                y=sum(second.corners[index].y for index in second_indices) / 2)
            if math.dist((first_center.x, first_center.y),
                         (second_center.x, second_center.y)) > limit:
                continue
            for crossed in (False, True):
                first_drawn = _line_intersection(*first_long[0],
                    *second_long[1 if crossed else 0])
                first_opposite = _line_intersection(*first_long[1],
                    *second_long[0 if crossed else 1])
                if first_drawn is None or first_opposite is None:
                    continue
                second_drawn = first_opposite if crossed else first_drawn
                second_opposite = first_drawn if crossed else first_opposite
                movements = [
                    math.dist((first_drawn.x, first_drawn.y),
                              (first.corners[first_indices[0]].x,
                               first.corners[first_indices[0]].y)),
                    math.dist((first_opposite.x, first_opposite.y),
                              (first.corners[first_indices[1]].x,
                               first.corners[first_indices[1]].y)),
                    math.dist((second_drawn.x, second_drawn.y),
                              (second.corners[second_indices[0]].x,
                               second.corners[second_indices[0]].y)),
                    math.dist((second_opposite.x, second_opposite.y),
                              (second.corners[second_indices[1]].x,
                               second.corners[second_indices[1]].y)),
                ]
                if max(movements) > limit:
                    continue
                changed_first = _replace_cap(first, first_cap, first_drawn, first_opposite)
                changed_second = _replace_cap(second, second_cap, second_drawn, second_opposite)
                try:
                    validate_physical_graph(PhysicalGraphV5(
                        walls=[changed_first, changed_second], junctions=[]))
                    if (polygon(changed_first).intersection(polygon(changed_second)).area >
                            rounded_contact_overlap_limit(changed_first, changed_second)):
                        continue
                    joint = simple_contact(changed_first, changed_second, "miter-cap-probe")
                    if not joint or not all(part.edge.endswith("Cap") for part in joint.participants):
                        continue
                    candidates.append((sum(movements), changed_first, changed_second))
                except ValueError:
                    pass
    if not candidates:
        return None
    _, changed_first, changed_second = min(candidates, key=lambda item: item[0])
    return changed_first, changed_second


def normalize_mitered_contacts(graph: PhysicalGraphV5) -> PhysicalGraphV5:
    """Repair old square or overlapping contacts with canonical shared caps."""
    repaired = deepcopy(graph)
    walls = {wall.id: index for index, wall in enumerate(repaired.walls)}
    for joint in graph.junctions:
        if len(joint.participants) != 2:
            continue
        first_index = walls[joint.participants[0].wallId]
        second_index = walls[joint.participants[1].wallId]
        cap_miter = _miter_end_caps(repaired.walls[first_index],
                                    repaired.walls[second_index])
        if cap_miter:
            repaired.walls[first_index], repaired.walls[second_index] = cap_miter
            continue
        for cap, host in ((joint.participants[0], joint.participants[1]),
                          (joint.participants[1], joint.participants[0])):
            if cap.edge not in ("startCap", "endCap") or host.edge not in ("drawn", "opposite"):
                continue
            index = walls[cap.wallId]
            repaired.walls[index] = _miter_contact(repaired.walls[index],
                                                     repaired.walls[walls[host.wallId]])
            break
    if repaired != graph:
        try:
            repaired = rebuild_simple_contacts(repaired, graph)
            validate_physical_graph(repaired)
        except ValueError:
            return graph
    return repaired


def execute_physical(graph: PhysicalGraphV5, command: dict,
                     command_id: str) -> tuple[PhysicalGraphV5, list[str]]:
    """Return a new graph or raise without mutating the input graph."""
    validate_physical_graph(graph)
    kind = command.get("type") if isinstance(command, dict) else None
    if kind == "addDoorOpening":
        _fields(command, {"type", "wallId", "offsetMm", "widthMm"})
        if len(command_id) > 92:
            raise ValueError("Идентификатор команды слишком длинный.")
        wall_id, offset = command["wallId"], command["offsetMm"]
        if (not isinstance(wall_id, str) or
                not any(wall.id == wall_id for wall in graph.walls)):
            raise ValueError("Выберите стену для дверного проёма.")
        if (isinstance(offset, bool) or not isinstance(offset, (int, float)) or
                not math.isfinite(offset)):
            raise ValueError("Выберите положение дверного проёма на стене.")
        next_graph = deepcopy(graph)
        opening = DoorOpeningV5(id="door-" + command_id, wallId=wall_id,
                                offsetMm=round(offset * 10) / 10,
                                widthMm=_door_width(command["widthMm"]))
        next_graph.openings.append(opening)
        validate_physical_graph(next_graph)
        return next_graph, [wall_id]
    if kind == "setDoorWidth":
        _fields(command, {"type", "openingId", "widthMm"})
        if not isinstance(command["openingId"], str):
            raise ValueError("Выберите дверной проём.")
        next_graph = deepcopy(graph)
        index = next((i for i, opening in enumerate(next_graph.openings)
                      if opening.id == command["openingId"]), None)
        if index is None:
            raise ValueError("Дверной проём не найден.")
        old = next_graph.openings[index]
        next_graph.openings[index] = old.model_copy(update={
            "widthMm": _door_width(command["widthMm"]),
        })
        validate_physical_graph(next_graph)
        return next_graph, [old.wallId]
    if kind == "setDoorProperties":
        _fields(command, {"type", "openingId", "widthMm", "revealDepthMm"})
        if not isinstance(command["openingId"], str):
            raise ValueError("Выберите дверной проём.")
        next_graph = deepcopy(graph)
        index = next((i for i, opening in enumerate(next_graph.openings)
                      if opening.id == command["openingId"]), None)
        if index is None:
            raise ValueError("Дверной проём не найден.")
        old = next_graph.openings[index]
        wall = next(wall for wall in next_graph.walls if wall.id == old.wallId)
        next_graph.openings[index] = old.model_copy(update={
            "widthMm": _door_width(command["widthMm"]),
            "revealDepthMm": _reveal_depth(command["revealDepthMm"], wall.thicknessMm),
        })
        validate_physical_graph(next_graph)
        return next_graph, [old.wallId]
    if kind == "deleteDoorOpening":
        _fields(command, {"type", "openingId"})
        opening_id = command["openingId"]
        opening = next((item for item in graph.openings if item.id == opening_id), None)
        if not isinstance(opening_id, str) or opening is None:
            raise ValueError("Дверной проём не найден.")
        next_graph = deepcopy(graph)
        next_graph.openings = [item for item in next_graph.openings if item.id != opening_id]
        validate_physical_graph(next_graph)
        return next_graph, [opening.wallId]
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
        for index, existing in enumerate(next_graph.walls):
            cap_miter = _miter_end_caps(wall, existing)
            if cap_miter:
                wall, next_graph.walls[index] = cap_miter
            else:
                wall = _miter_contact(wall, existing)
        for existing in next_graph.walls:
            suffix = hashlib.sha256((command_id + "\0" + existing.id).encode()).hexdigest()[:20]
            joint_id = "joint-" + command_id if len(next_graph.walls) == 1 else "joint-" + suffix
            joint = simple_contact(existing, wall, joint_id)
            if joint:
                next_graph.junctions.append(joint)
        next_graph.walls.append(wall)
        # Mitring the new wall can also move a cap of an existing wall. Any
        # junction already stored for that cap must follow the new physical
        # edge; otherwise a valid branch drawn into an occupied corner is
        # rejected as a stale saved junction.
        next_graph = rebuild_simple_contacts(next_graph, next_graph)
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
        for opening_index, opening in enumerate(next_graph.openings):
            if opening.wallId == old.id and opening.revealDepthMm is not None:
                next_graph.openings[opening_index] = opening.model_copy(update={
                    "revealDepthMm": min(opening.revealDepthMm, replacement.thicknessMm),
                })
        for neighbor_index, neighbor in enumerate(next_graph.walls):
            if neighbor_index == index:
                continue
            cap_miter = _miter_end_caps(next_graph.walls[index], neighbor)
            if cap_miter:
                next_graph.walls[index], next_graph.walls[neighbor_index] = cap_miter
            else:
                next_graph.walls[index] = _miter_contact(next_graph.walls[index], neighbor)
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
        for first_index, first in enumerate(next_graph.walls):
            for second_index in range(first_index + 1, len(next_graph.walls)):
                second = next_graph.walls[second_index]
                first_moved, second_moved = first.id in moves, second.id in moves
                if not first_moved and not second_moved:
                    continue
                cap_miter = _miter_end_caps(first, second)
                if cap_miter:
                    first, second = cap_miter
                else:
                    if first_moved:
                        first = _miter_contact(first, second)
                    if second_moved:
                        second = _miter_contact(second, first)
                next_graph.walls[first_index] = first
                next_graph.walls[second_index] = second
        next_graph = rebuild_simple_contacts(next_graph, graph)
        validate_physical_graph(next_graph)
        return next_graph, list(moves)
    if kind == "deleteWall":
        _fields(command, {"type", "wallId"})
        wall_id = command["wallId"]
        if not isinstance(wall_id, str) or not any(wall.id == wall_id for wall in graph.walls):
            raise ValueError("Стена не найдена.")
        surviving_joints = [joint for joint in graph.junctions
                            if all(part.wallId != wall_id for part in joint.participants)]
        occupied_caps = {(part.wallId, part.edge) for joint in surviving_joints
                         for part in joint.participants
                         if part.edge in ("startCap", "endCap")}
        freed_caps = {(part.wallId, part.edge) for joint in graph.junctions
                      if any(part.wallId == wall_id for part in joint.participants)
                      for part in joint.participants
                      if (part.wallId != wall_id and
                          part.edge in ("startCap", "endCap") and
                          (part.wallId, part.edge) not in occupied_caps)}
        remaining_walls = deepcopy([wall for wall in graph.walls if wall.id != wall_id])
        for index, wall in enumerate(remaining_walls):
            if (wall.id, "startCap") in freed_caps:
                wall = _restore_square_cap(wall, 0)
            if (wall.id, "endCap") in freed_caps:
                wall = _restore_square_cap(wall, 1)
            remaining_walls[index] = wall
        next_graph = PhysicalGraphV5(
            walls=remaining_walls,
            junctions=deepcopy(surviving_joints),
            openings=[opening for opening in graph.openings if opening.wallId != wall_id],
        )
        next_graph = rebuild_simple_contacts(next_graph, next_graph)
        validate_physical_graph(next_graph)
        return next_graph, [wall_id]
    raise ValueError("Неизвестная команда стены.")
