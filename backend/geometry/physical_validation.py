"""Validation and stable identity for the physical wall graph."""

import hashlib
import json
import math

from shapely.geometry import Polygon, Point as ShapelyPoint, LineString

from .physical_models import PhysicalGraphV5, PhysicalPoint, PhysicalWallV5
from .physical_openings import opening_parts
from .precision import is_tenth


TOLERANCE_MM = 0.1


def _pair(point: PhysicalPoint) -> tuple[float, float]:
    return point.x, point.y


def _near(a: PhysicalPoint, b: PhysicalPoint) -> bool:
    return math.dist(_pair(a), _pair(b)) <= TOLERANCE_MM + 1e-9


def _edge(wall: PhysicalWallV5, name: str) -> tuple[PhysicalPoint, PhysicalPoint]:
    a, b, c, d = wall.corners
    return {
        "drawn": (a, b), "opposite": (d, c),
        "startCap": (a, d), "endCap": (b, c),
    }[name]


def validate_physical_graph(graph: PhysicalGraphV5) -> None:
    """Reject stored walls that disagree with their canonical physical edge."""
    walls = {wall.id: wall for wall in graph.walls}
    for wall in graph.walls:
        points = (*wall.drawnEdge, *wall.corners)
        if not all(is_tenth(value) for point in points for value in _pair(point)) or not is_tenth(wall.thicknessMm):
            raise ValueError("Допустим не более одного знака после запятой.")
        if wall.corners[:2] != wall.drawnEdge:
            raise ValueError("Сохранённый край стены не совпадает с её углами.")
        a, b, c, d = wall.corners
        ux, uy = b.x - a.x, b.y - a.y
        length = math.hypot(ux, uy)
        if length < TOLERANCE_MM:
            raise ValueError("Длина стены должна быть положительной.")
        signed_widths = [
            (ux * (p.y - q.y) - uy * (p.x - q.x)) / length
            for p, q in ((c, b), (d, a))
        ]
        expected = wall.thicknessMm if wall.side == "left" else -wall.thicknessMm
        if any(abs(width - expected) > 2 * TOLERANCE_MM + 1e-7 for width in signed_widths):
            raise ValueError("Физическая ширина стены не соответствует толщине.")
        # A joined wall may have a mitred cap: its two corners stop at
        # different positions on the receiving wall's physical face.
        if abs((c.x - d.x) * uy - (c.y - d.y) * ux) / length > 2 * TOLERANCE_MM + 1e-7:
            raise ValueError("Продольные грани стены должны быть параллельны.")
        polygon = Polygon([_pair(p) for p in wall.corners])
        if not polygon.is_valid or polygon.area <= 0:
            raise ValueError("Физический контур стены недопустим.")

    opening_intervals: dict[str, list[tuple[float, float]]] = {}
    for opening in graph.openings:
        wall = walls[opening.wallId]
        length = math.dist(_pair(wall.drawnEdge[0]), _pair(wall.drawnEdge[1]))
        if not is_tenth(opening.offsetMm) or not is_tenth(opening.widthMm):
            raise ValueError("Размер и положение дверного проёма должны иметь шаг 0,1 мм.")
        if opening.widthMm % 10 != 0:
            raise ValueError("Ширина дверного проёма должна иметь шаг 10 мм.")
        first, last = opening.offsetMm - opening.widthMm / 2, opening.offsetMm + opening.widthMm / 2
        if first < 10 or last > length - 10:
            raise ValueError("Дверной проём не помещается на выбранном участке стены.")
        intervals = opening_intervals.setdefault(wall.id, [])
        if any(first < other_last + 10 and last > other_first - 10
               for other_first, other_last in intervals):
            raise ValueError("Дверные проёмы на одной стене пересекаются.")
        intervals.append((first, last))
        opening_shape = opening_parts(wall, opening)[0]
        if any(opening_shape.intersection(Polygon([_pair(point) for point in other.corners])).area > .1
               for other in graph.walls if other.id != wall.id):
            raise ValueError("Дверной проём пересекает сочленение стен.")

    for joint in graph.junctions:
        positions = []
        for part in joint.participants:
            wall = walls[part.wallId]
            if not is_tenth(part.point.x) or not is_tenth(part.point.y):
                raise ValueError("Точка стыка должна иметь шаг 0,1 мм.")
            first, last = _edge(wall, part.edge)
            line = LineString((_pair(first), _pair(last)))
            if line.distance(ShapelyPoint(_pair(part.point))) > TOLERANCE_MM + 1e-7:
                raise ValueError("Точка стыка не лежит на указанной грани.")
            at_end = _near(part.point, first) or _near(part.point, last)
            if part.attachment == "interior" and (part.edge.endswith("Cap") or at_end):
                raise ValueError("Неверный вид примыкания к стене.")
            if part.attachment == "end" and not (part.edge.endswith("Cap") or at_end):
                raise ValueError("Конец стены не совпадает со стыком.")
            positions.append(part.point)
        if any(not _near(positions[0], position) for position in positions[1:]):
            raise ValueError("Участники стыка не имеют общей точки контакта.")


def canonical_basis_key(graph: PhysicalGraphV5) -> str:
    wall_data = [wall.model_dump(mode="json") for wall in sorted(graph.walls, key=lambda wall: wall.id)]
    joint_data = []
    for joint in sorted(graph.junctions, key=lambda joint: joint.id):
        row = joint.model_dump(mode="json")
        row["participants"].sort(key=lambda part: part["wallId"])
        joint_data.append(row)
    opening_data = [opening.model_dump(mode="json")
                    for opening in sorted(graph.openings, key=lambda opening: opening.id)]
    def tenths(value):
        if isinstance(value, dict):
            return {key: tenths(item) for key, item in value.items()}
        if isinstance(value, list):
            return [tenths(item) for item in value]
        if isinstance(value, (float, int)) and not isinstance(value, bool):
            return round(value * 10)
        return value
    encoded = json.dumps(tenths({"walls": wall_data, "junctions": joint_data,
                                 "openings": opening_data}), sort_keys=True,
                         ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return "physical-v5:" + hashlib.sha256(encoded).hexdigest()
