// Legacy approval is checked using the same measurements and keys as the v2 UI.
import type { GeometrySnapshot, Measurement } from "../room/types";
import { acknowledgment } from "./keys";
export function legacyAcknowledgment(g: GeometrySnapshot) {
  const ms: Measurement[] = [];
  for (const c of [g.outer, ...g.holes])
    for (let i = 0; i < c.walls.length; i++) {
      const w = c.walls[i],
        a = c.vertices[i],
        b = c.vertices[(i + 1) % c.vertices.length],
        d = c.vertices[(i + 2) % c.vertices.length];
      const u = { x: b.x - a.x, y: b.y - a.y },
        z = { x: d.x - b.x, y: d.y - b.y };
      const angle =
        c.closed || i + 2 < c.vertices.length
          ? 180 -
            ((c.winding === "ccw" ? 1 : -1) *
              Math.atan2(u.x * z.y - u.y * z.x, u.x * z.x + u.y * z.y) *
              180) /
              Math.PI
          : null;
      ms.push({
        wallId: w.id,
        length: Math.hypot(u.x, u.y),
        interiorAngle: angle,
        orientation: ((Math.atan2(u.y, u.x) * 180) / Math.PI + 360) % 360,
        lengthSource: g.constraints.some(
          (x) => x.fixed && x.wallId === w.id && x.kind === "length",
        )
          ? "entered"
          : "derived",
        angleSource: g.constraints.some(
          (x) => x.fixed && x.wallId === w.id && x.kind === "interiorAngle",
        )
          ? "entered"
          : "derived",
      });
    }
  return acknowledgment(g, ms);
}
