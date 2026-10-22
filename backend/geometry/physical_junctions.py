"""Detect simple physical contacts without inventing axial vertices."""

import hashlib

from shapely.geometry import LineString, Point as ShapelyPoint, Polygon

from .physical_models import (JunctionParticipantV5, PhysicalPoint,
                              PhysicalWallV5, WallJunctionV5, PhysicalGraphV5)


def polygon(wall: PhysicalWallV5) -> Polygon:
    return Polygon([(p.x, p.y) for p in wall.corners])


def _edges(wall: PhysicalWallV5):
    a, b, c, d = wall.corners
    return {"drawn": (a, b), "opposite": (d, c),
            "startCap": (a, d), "endCap": (b, c)}


def _line(pair):
    return LineString([(p.x, p.y) for p in pair])


def rounded_contact_overlap_limit(first: PhysicalWallV5, second: PhysicalWallV5) -> float:
    """Area of a sub-0.2 mm strip caused by tenth-mm vertex rounding."""
    cap_lengths = [
        _line(edge).length
        for wall in (first, second)
        for edge in (_edges(wall)["startCap"], _edges(wall)["endCap"])
    ]
    return .2 * max(first.thicknessMm, second.thicknessMm, *cap_lengths)


def _point_on_edge(edge, point):
    return _line(edge).distance(ShapelyPoint(point.x, point.y)) <= 0.1 + 1e-7


def _attachment(edge, point):
    return ("end" if any(abs(p.x - point.x) <= 0.1 and
                         abs(p.y - point.y) <= 0.1 for p in edge)
            else "interior")


def simple_contact(existing: PhysicalWallV5, new: PhysicalWallV5,
                   junction_id: str) -> WallJunctionV5 | None:
    """Return one contact where a new short cap meets an existing long edge."""
    old_polygon, new_polygon = polygon(existing), polygon(new)
    overlap = old_polygon.intersection(new_polygon)
    has_overlap = overlap.area > 0.01
    has_material_overlap = overlap.area > rounded_contact_overlap_limit(existing, new)
    if has_material_overlap and (overlap.geom_type != "Polygon" or len(overlap.interiors)):
        raise ValueError("Перекрытие стен выходит за локальную область стыка.")
    edges_old, edges_new = _edges(existing), _edges(new)
    candidates = []
    for cap_wall, cap_edges, long_wall, long_edges in (
        (new, edges_new, existing, edges_old),
        (existing, edges_old, new, edges_new),
    ):
        for cap_name in ("startCap", "endCap"):
            cap = _line(cap_edges[cap_name])
            for long_name in ("drawn", "opposite"):
                long = _line(long_edges[long_name])
                shared = cap.intersection(long)
                shared_length = shared.length
                anchor = (shared if isinstance(shared, ShapelyPoint) else
                          shared.interpolate(shared_length / 2) if shared_length else None)
                # Tenth-millimetre rounding can leave a correctly projected
                # cap parallel to its host face with a sub-tolerance gap. Use
                # the projected overlap rather than requiring an exact GEOS
                # line intersection in that case.
                if shared_length < 0.1 - 1e-7 and not isinstance(shared, ShapelyPoint):
                    cap_points = [ShapelyPoint(point.x, point.y)
                                  for point in cap_edges[cap_name]]
                    if all(long.distance(point) <= 0.1 + 1e-7 for point in cap_points):
                        positions = sorted(long.project(point) for point in cap_points)
                        start = max(0.0, positions[0])
                        finish = min(long.length, positions[1])
                        if finish - start >= 0.1 - 1e-7:
                            shared_length = finish - start
                            anchor = long.interpolate((start + finish) / 2)
                if (shared_length >= 0.1 - 1e-7 or
                        (has_overlap and isinstance(shared, ShapelyPoint))):
                    if has_material_overlap:
                        cap_a, cap_b = cap_edges[cap_name]
                        long_a, long_b = long_edges[long_name]
                        dx, dy = cap_wall.drawnEdge[1].x - cap_wall.drawnEdge[0].x, cap_wall.drawnEdge[1].y - cap_wall.drawnEdge[0].y
                        ex, ey = long_b.x - long_a.x, long_b.y - long_a.y
                        sine = abs(dx * ey - dy * ex) / max(1e-9, (dx * dx + dy * dy) ** .5 * (ex * ex + ey * ey) ** .5)
                        if sine < .1:
                            continue
                        # The incoming short cap must remain before the receiving wall's far face.
                        def depth(point):
                            signed = (ex * (point.y - long_a.y) - ey * (point.x - long_a.x)) / max(1e-9, (ex * ex + ey * ey) ** .5)
                            opposite = long_edges["opposite" if long_name == "drawn" else "drawn"][0]
                            inward = ex * (opposite.y - long_a.y) - ey * (opposite.x - long_a.x)
                            return signed * (1 if inward >= 0 else -1)
                        if max(depth(cap_a), depth(cap_b)) > long_wall.thicknessMm + .1:
                            continue
                        if max(depth(cap_a), depth(cap_b)) < -.1:
                            continue
                        # Only the swept local cap strip may overlap the receiving wall.
                        line_start = cap_wall.drawnEdge[0 if cap_name == "startCap" else 1]
                        if cap_name == "startCap":
                            dx, dy = -dx, -dy
                        axis_length = max(1e-9, (dx * dx + dy * dy) ** .5)
                        if any((((vx - line_start.x) * dx + (vy - line_start.y) * dy) / axis_length
                                < -long_wall.thicknessMm / sine - .1 or
                                ((vx - line_start.x) * dx + (vy - line_start.y) * dy) / axis_length > .1)
                               for vx, vy in overlap.exterior.coords):
                            continue
                    if anchor is None:
                        continue
                    point = PhysicalPoint(x=round(anchor.x * 10) / 10,
                                          y=round(anchor.y * 10) / 10)
                    if _point_on_edge(cap_edges[cap_name], point) and _point_on_edge(long_edges[long_name], point):
                        candidates.append((cap_wall, cap_name, long_wall, long_name, point))
    if not candidates and not has_overlap:
        cap_contacts = []
        for first_name in ("startCap", "endCap"):
            for second_name in ("startCap", "endCap"):
                shared = _line(edges_old[first_name]).intersection(_line(edges_new[second_name]))
                if shared.length >= 0.1 - 1e-7:
                    anchor = shared.interpolate(shared.length / 2)
                    point = PhysicalPoint(x=round(anchor.x * 10) / 10,
                                          y=round(anchor.y * 10) / 10)
                    if (_point_on_edge(edges_old[first_name], point) and
                            _point_on_edge(edges_new[second_name], point)):
                        cap_contacts.append((first_name, second_name, point))
        if len(cap_contacts) == 1:
            first_name, second_name, point = cap_contacts[0]
            return WallJunctionV5(id=junction_id, participants=[
                JunctionParticipantV5(wallId=existing.id, edge=first_name, point=point,
                                      attachment="end"),
                JunctionParticipantV5(wallId=new.id, edge=second_name, point=point,
                                      attachment="end"),
            ])
    if len(candidates) != 1:
        if not old_polygon.disjoint(new_polygon):
            raise ValueError("Допустим только контакт торца с физической гранью стены.")
        return None
    cap_wall, cap_name, long_wall, long_name, point = candidates[0]
    long_edges = _edges(long_wall)
    return WallJunctionV5(id=junction_id, participants=[
        JunctionParticipantV5(wallId=long_wall.id, edge=long_name, point=point,
                              attachment=_attachment(long_edges[long_name], point)),
        JunctionParticipantV5(wallId=cap_wall.id, edge=cap_name, point=point,
                              attachment="end"),
    ])


def validate_simple_contacts(graph: PhysicalGraphV5) -> None:
    """Every touching pair needs its own registered, matching physical contact."""
    expected_pairs = {}
    for index, a in enumerate(graph.walls):
        for b in graph.walls[index + 1:]:
            expected = simple_contact(a, b, "expected")
            if expected:
                expected_pairs[frozenset((a.id, b.id))] = expected
    actual_pairs = {}
    for joint in graph.junctions:
        if len(joint.participants) != 2:
            raise ValueError("Многостенный стык пока недоступен.")
        pair = frozenset(part.wallId for part in joint.participants)
        if pair in actual_pairs:
            raise ValueError("Повтор стыка стен.")
        actual_pairs[pair] = joint
    if actual_pairs.keys() != expected_pairs.keys():
        raise ValueError("Сохранённые стыки не совпадают с физическими гранями.")
    for pair, expected in expected_pairs.items():
        for part in actual_pairs[pair].participants:
            match = next(item for item in expected.participants if item.wallId == part.wallId)
            if (part.edge != match.edge or part.attachment != match.attachment or
                    abs(part.point.x - match.point.x) > 0.1 or
                    abs(part.point.y - match.point.y) > 0.1):
                raise ValueError("Сохранённый стык не совпадает с физическими гранями.")


def rebuild_simple_contacts(graph: PhysicalGraphV5, previous: PhysicalGraphV5) -> PhysicalGraphV5:
    """Recompute physical contact points while retaining each existing ID."""
    old_ids = {frozenset(part.wallId for part in joint.participants): joint.id
               for joint in previous.junctions}
    new_joints = []
    current_pairs = set()
    for index, first in enumerate(graph.walls):
        for second in graph.walls[index + 1:]:
            pair = frozenset((first.id, second.id))
            digest = hashlib.sha256("\0".join(sorted(pair)).encode()).hexdigest()[:24]
            joint = simple_contact(first, second, old_ids.get(pair, "joint-" + digest))
            if joint:
                new_joints.append(joint)
                current_pairs.add(pair)
    if not old_ids.keys() <= current_pairs:
        raise ValueError("Изменение разрывает существующий стык стен.")
    graph.junctions = new_joints
    validate_simple_contacts(graph)
    return graph
