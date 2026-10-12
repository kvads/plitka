import type { GraphSnapshot, DimensionConstraint } from "./types";
export interface AngleTarget {
  vertexId: string;
  firstSegmentId: string;
  secondSegmentId: string;
  sector: "cw" | "ccw";
}
export function angleGeometry(
  graph: GraphSnapshot,
  target: AngleTarget,
  radius: number,
) {
  const p = graph.vertices.find((v) => v.id === target.vertexId),
    first = graph.segments.find((s) => s.id === target.firstSegmentId),
    second = graph.segments.find((s) => s.id === target.secondSegmentId);
  if (!p || !first || !second) return null;
  const other = (s: typeof first) =>
    graph.vertices.find(
      (v) =>
        v.id === (s.startVertexId === p.id ? s.endVertexId : s.startVertexId),
    );
  const a = other(first),
    b = other(second);
  if (!a || !b) return null;
  const start = Math.atan2(a.y - p.y, a.x - p.x),
    end = Math.atan2(b.y - p.y, b.x - p.x),
    direction = target.sector === "ccw" ? 1 : -1;
  const span = ((end - start) * direction + Math.PI * 2) % (Math.PI * 2),
    middle = start + (direction * span) / 2;
  return {
    value: (span * 180) / Math.PI,
    path: `M ${p.x + radius * Math.cos(start)} ${p.y + radius * Math.sin(start)} A ${radius} ${radius} 0 ${span > Math.PI ? 1 : 0} ${direction === 1 ? 1 : 0} ${p.x + radius * Math.cos(end)} ${p.y + radius * Math.sin(end)}`,
    x: p.x + radius * 1.55 * Math.cos(middle),
    y: p.y + radius * 1.55 * Math.sin(middle),
  };
}
export function matchingAngle(
  graph: GraphSnapshot,
  target: AngleTarget,
): DimensionConstraint | undefined {
  return graph.constraints.find(
    (c) =>
      c.kind === "angle" &&
      c.target.vertexId === target.vertexId &&
      ((c.target.firstSegmentId === target.firstSegmentId &&
        c.target.secondSegmentId === target.secondSegmentId &&
        c.target.sector === target.sector) ||
        (c.target.firstSegmentId === target.secondSegmentId &&
          c.target.secondSegmentId === target.firstSegmentId &&
          c.target.sector !== target.sector)),
  );
}
