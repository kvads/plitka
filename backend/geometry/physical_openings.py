"""Geometry shared by door validation, rendering, and room derivation."""

import math

from shapely.geometry import Polygon

from .physical_models import DoorOpeningV5, PhysicalWallV5


def opening_parts(wall: PhysicalWallV5, opening: DoorOpeningV5
                  ) -> tuple[Polygon, Polygon, Polygon]:
    """Return the full opening and its two threshold halves."""
    start, end = wall.drawnEdge
    dx, dy = end.x - start.x, end.y - start.y
    length = math.hypot(dx, dy)
    ux, uy = dx / length, dy / length
    sign = 1 if wall.side == "left" else -1
    nx, ny = -uy * sign, ux * sign
    first = opening.offsetMm - opening.widthMm / 2
    last = opening.offsetMm + opening.widthMm / 2
    drawn_a = (start.x + ux * first, start.y + uy * first)
    drawn_b = (start.x + ux * last, start.y + uy * last)
    middle_a = (drawn_a[0] + nx * wall.thicknessMm / 2,
                drawn_a[1] + ny * wall.thicknessMm / 2)
    middle_b = (drawn_b[0] + nx * wall.thicknessMm / 2,
                drawn_b[1] + ny * wall.thicknessMm / 2)
    opposite_a = (drawn_a[0] + nx * wall.thicknessMm,
                  drawn_a[1] + ny * wall.thicknessMm)
    opposite_b = (drawn_b[0] + nx * wall.thicknessMm,
                  drawn_b[1] + ny * wall.thicknessMm)
    drawn_half = Polygon([drawn_a, drawn_b, middle_b, middle_a])
    opposite_half = Polygon([middle_a, middle_b, opposite_b, opposite_a])
    return drawn_half.union(opposite_half), drawn_half, opposite_half
