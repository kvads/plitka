import type { GeometrySnapshot, Measurement } from "./types";
/** Measurements use world millimetres and the turn at the wall's end vertex. */
export function measurements(g: GeometrySnapshot): Measurement[] {
  return [g.outer, ...g.holes].flatMap((c) =>
    c.walls.map((w, i) => {
      const a = c.vertices[i],
        b = c.vertices[(i + 1) % c.vertices.length];
      const dx = b.x - a.x,
        dy = b.y - a.y;
      let interiorAngle: number | null = null;
      if (c.closed || i + 2 < c.vertices.length) {
        const d = c.vertices[(i + 2) % c.vertices.length];
        const ex = d.x - b.x,
          ey = d.y - b.y;
        if (Math.hypot(dx, dy) > 1e-10 && Math.hypot(ex, ey) > 1e-10)
          interiorAngle =
            180 -
            ((c.winding === "ccw" ? 1 : -1) *
              Math.atan2(dx * ey - dy * ex, dx * ex + dy * ey) *
              180) /
              Math.PI;
      }
      const fixed = (kind: string) =>
        g.constraints.some(
          (x) => x.fixed && x.wallId === w.id && x.kind === kind,
        );
      return {
        wallId: w.id,
        length: Math.hypot(dx, dy),
        interiorAngle,
        orientation: ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360,
        lengthSource: fixed("length") ? "entered" : "derived",
        angleSource: fixed("interiorAngle") ? "entered" : "derived",
      };
    }),
  );
}
