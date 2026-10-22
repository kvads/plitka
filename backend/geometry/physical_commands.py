"""Atomic commands on the physical wall graph."""

from copy import deepcopy
import hashlib
import math
from shapely.geometry import LineString, Point as ShapelyPoint

from .physical_geometry import create_wall
from .physical_junctions import simple_contact, polygon, rebuild_simple_contacts
from .physical_models import PhysicalGraphV5, PhysicalPoint, PhysicalWallV5
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
    if not polygon(wall).intersects(polygon(existing)):
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
                if (polygon(candidate).intersection(polygon(existing)).area <= .02 and
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
            if shared_cap.is_empty:
                continue
            if isinstance(shared_cap, ShapelyPoint):
                host_ends = [ShapelyPoint(second.corners[index].x, second.corners[index].y)
                             for index in second_indices]
                # A cap merely touching a host corner is still a regular
                # cap-to-long-edge junction. A point inside the host cap is an
                # explicit end-to-end snap and needs the shared miter.
                if min(shared_cap.distance(point) for point in host_ends) <= .15:
                    continue
            elif shared_cap.length < .1:
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
                    if polygon(changed_first).intersection(polygon(changed_second)).area > .02:
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
    """Repair old rectangular cap overlaps without moving the host walls."""
    repaired = deepcopy(graph)
    walls = {wall.id: index for index, wall in enumerate(repaired.walls)}
    for joint in graph.junctions:
        if len(joint.participants) != 2:
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
        for neighbor in next_graph.walls:
            if neighbor.id != old.id:
                replacement = _miter_contact(replacement, neighbor)
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
        for index, wall in enumerate(next_graph.walls):
            if wall.id not in moves:
                continue
            for neighbor in next_graph.walls:
                if neighbor.id != wall.id:
                    wall = _miter_contact(wall, neighbor)
            next_graph.walls[index] = wall
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
