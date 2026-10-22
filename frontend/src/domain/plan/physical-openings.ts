import type { DoorOpeningV5, PhysicalGraphV5, PhysicalWallV5, Point } from "./types";
import { roundTenth } from "./precision";

export function openingCorners(wall: PhysicalWallV5,
  opening: Pick<DoorOpeningV5, "offsetMm" | "widthMm">): [Point, Point, Point, Point] {
  const [start, end] = wall.drawnEdge;
  const dx = end.x - start.x, dy = end.y - start.y;
  const length = Math.hypot(dx, dy), ux = dx / length, uy = dy / length;
  const sign = wall.side === "left" ? 1 : -1;
  const nx = -uy * sign, ny = ux * sign;
  const first = opening.offsetMm - opening.widthMm / 2;
  const last = opening.offsetMm + opening.widthMm / 2;
  const a = { x: start.x + ux * first, y: start.y + uy * first };
  const b = { x: start.x + ux * last, y: start.y + uy * last };
  return [a, b,
    { x: b.x + nx * wall.thicknessMm, y: b.y + ny * wall.thicknessMm },
    { x: a.x + nx * wall.thicknessMm, y: a.y + ny * wall.thicknessMm }];
}

export function openingOffset(graph: PhysicalGraphV5, wallId: string,
  point: Point, widthMm: number): number | null {
  const wall = graph.walls.find(candidate => candidate.id === wallId);
  if (!wall) return null;
  const [start, end] = wall.drawnEdge;
  const dx = end.x - start.x, dy = end.y - start.y, length = Math.hypot(dx, dy);
  const minimum = widthMm / 2 + 10;
  if (length < widthMm + 20) return null;
  const projected = ((point.x - start.x) * dx + (point.y - start.y) * dy) / length;
  return roundTenth(Math.max(minimum, Math.min(length - minimum, projected)));
}
