"""Construct canonical four-corner walls from a user-selected visible edge."""

import math

from shapely.geometry import Polygon

from .physical_models import PhysicalPoint, PhysicalWallV5
from .physical_validation import validate_physical_graph
from .physical_models import PhysicalGraphV5
from .precision import is_tenth


def _round_tenth(value: float) -> float:
    result = round(value * 10) / 10
    return 0.0 if result == 0 else result


def create_wall(wall_id: str, drawn_edge: list[PhysicalPoint], side: str,
                thickness_mm: float) -> PhysicalWallV5:
    """Keep the drawn edge fixed; derive the other edge with full precision first."""
    if len(drawn_edge) != 2 or side not in ("left", "right"):
        raise ValueError("Выберите край и сторону стены.")
    if (isinstance(thickness_mm, bool) or not isinstance(thickness_mm, (int, float)) or
            not math.isfinite(thickness_mm) or not is_tenth(thickness_mm) or
            not 0.1 <= thickness_mm <= 100000):
        raise ValueError("Толщина стены должна быть от 0,1 до 100000 мм с шагом 0,1 мм.")
    if any(not is_tenth(value) for point in drawn_edge for value in (point.x, point.y)):
        raise ValueError("Координаты края должны иметь шаг 0,1 мм.")
    start, end = drawn_edge
    dx, dy = end.x - start.x, end.y - start.y
    length = math.hypot(dx, dy)
    if length < 0.1 - 1e-9:
        raise ValueError("Длина стены должна быть положительной.")
    sign = 1 if side == "left" else -1
    offset_x = -dy * thickness_mm * sign / length
    offset_y = dx * thickness_mm * sign / length
    opposite_end = PhysicalPoint(x=_round_tenth(end.x + offset_x),
                                 y=_round_tenth(end.y + offset_y))
    opposite_start = PhysicalPoint(x=_round_tenth(start.x + offset_x),
                                   y=_round_tenth(start.y + offset_y))
    wall = PhysicalWallV5(id=wall_id, drawnEdge=drawn_edge, side=side,
                          thicknessMm=thickness_mm,
                          corners=[start, end, opposite_end, opposite_start])
    validate_physical_graph(PhysicalGraphV5(walls=[wall], junctions=[]))
    polygon = Polygon([(point.x, point.y) for point in wall.corners])
    if not polygon.is_valid or polygon.area <= 0:
        raise ValueError("Физический контур стены недопустим.")
    return wall
