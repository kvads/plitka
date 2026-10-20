import type { PhysicalGraphV5, PhysicalPolygonV5, Point } from "./types";

export type WallSegmentDimension = {
  wallId: string;
  from: Point;
  to: Point;
  anchor: Point;
  lengthMm: number;
};

// Measure only the exposed parts of a long wall face. A branch wall removes its
// contact interval from the union boundary, leaving the two useful spans.
export function splitWallDimensions(
  graph: PhysicalGraphV5, wallArea: PhysicalPolygonV5[], labelOffsetMm: number,
): WallSegmentDimension[] {
  const boundary = wallArea.flatMap(area => [area.outline, ...area.holes]);
  const result: WallSegmentDimension[] = [];
  for (const wall of graph.walls) {
    for (const [startIndex, endIndex] of [[0, 1], [3, 2]]) {
      const start = wall.corners[startIndex], end = wall.corners[endIndex];
      const dx = end.x - start.x, dy = end.y - start.y;
      const length = Math.hypot(dx, dy);
      if (length < .1) continue;
      const ux = dx / length, uy = dy / length;
      const intervals: [number, number][] = [];
      for (const ring of boundary) for (let index = 0; index < ring.length; index++) {
        const first = ring[index], last = ring[(index + 1) % ring.length];
        const distanceA = Math.abs((first[0] - start.x) * uy - (first[1] - start.y) * ux);
        const distanceB = Math.abs((last[0] - start.x) * uy - (last[1] - start.y) * ux);
        if (distanceA > .15 || distanceB > .15) continue;
        const a = Math.max(0, Math.min(length, (first[0] - start.x) * ux + (first[1] - start.y) * uy));
        const b = Math.max(0, Math.min(length, (last[0] - start.x) * ux + (last[1] - start.y) * uy));
        if (Math.abs(a - b) > .1) intervals.push([Math.min(a, b), Math.max(a, b)]);
      }
      intervals.sort((a, b) => a[0] - b[0]);
      const merged: [number, number][] = [];
      for (const interval of intervals) {
        const previous = merged[merged.length - 1];
        if (previous && interval[0] <= previous[1] + .1)
          previous[1] = Math.max(previous[1], interval[1]);
        else merged.push([...interval]);
      }
      if (merged.length < 2) continue;
      const wallCenter = wall.corners.reduce((sum, corner) =>
        ({ x: sum.x + corner.x / 4, y: sum.y + corner.y / 4 }), { x: 0, y: 0 });
      for (const [a, b] of merged) {
        if (b - a < .1) continue;
        const midpoint = { x: start.x + (a + b) / 2 * ux,
          y: start.y + (a + b) / 2 * uy };
        const towardWall = (wallCenter.x - midpoint.x) * -uy +
          (wallCenter.y - midpoint.y) * ux;
        const outward = towardWall >= 0 ? -1 : 1;
        result.push({ wallId: wall.id,
          from: { x: start.x + a * ux, y: start.y + a * uy },
          to: { x: start.x + b * ux, y: start.y + b * uy },
          anchor: { x: midpoint.x - outward * uy * labelOffsetMm,
            y: midpoint.y + outward * ux * labelOffsetMm },
          lengthMm: Math.round((b - a) * 10) / 10 });
      }
    }
  }
  return result;
}
