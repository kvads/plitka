import { fixDimension } from "./dimensions";
import type { Point } from "../../types";
import type { Contour, GeometrySnapshot, Operation } from "./types";
export const uid = () => crypto.randomUUID();
export function contour(
  points: Point[],
  kind: "outer" | "hole" = "outer",
  closed = true,
): Contour {
  const vertices = points.map(([x, y]) => ({ id: uid(), x, y }));
  const c: Contour = {
    id: uid(),
    kind,
    closed,
    winding: "ccw",
    vertices,
    walls: [],
  };
  return rebuild(c);
}
export function rebuild(c: Contour): Contour {
  const n = c.vertices.length;
  const count = c.closed ? n : Math.max(0, n - 1);
  const walls = Array.from({ length: count }, (_, i) => {
    const a = c.vertices[i].id,
      b = c.vertices[(i + 1) % n].id;
    return (
      c.walls.find((w) => w.startVertexId === a && w.endVertexId === b) || {
        id: uid(),
        startVertexId: a,
        endVertexId: b,
      }
    );
  });
  const sum = c.vertices.reduce((s, v, i) => {
    const b = c.vertices[(i + 1) % n];
    return s + v.x * b.y - b.x * v.y;
  }, 0);
  return {
    ...c,
    walls,
    winding: c.closed && sum !== 0 ? (sum > 0 ? "ccw" : "cw") : c.winding,
  };
}
export function replaceContour(
  g: GeometrySnapshot,
  c: Contour,
): GeometrySnapshot {
  const next = {
    ...g,
    outer: c.kind === "outer" ? c : g.outer,
    holes:
      c.kind === "hole" ? g.holes.map((h) => (h.id === c.id ? c : h)) : g.holes,
  };
  const ids = new Set(
    [next.outer, ...next.holes].flatMap((h) => h.walls.map((w) => w.id)),
  );
  const remaining = new Set(
    [next.outer, ...next.holes].flatMap((h) => [
      ...h.vertices.map((v) => v.id),
      ...h.walls.map((w) => w.id),
    ]),
  );
  const removed = [g.outer, ...g.holes]
    .flatMap((h) => [
      ...h.vertices.map((v) => v.id),
      ...h.walls.map((w) => w.id),
    ])
    .filter((id) => !remaining.has(id));
  return {
    ...next,
    fieldInputs: Object.fromEntries(
      Object.entries(g.fieldInputs).filter(
        ([key]) => !removed.some((id) => key.startsWith(id + ":")),
      ),
    ),
    constraints: g.constraints.filter((x) => ids.has(x.wallId)),
  };
}
export function applyOperation(source: GeometrySnapshot, op: Operation) {
  const g = structuredClone(source),
    cs = [g.outer, ...g.holes];
  if (op.type === "releaseConstraint") {
    const x = g.constraints.find((x) => x.id === op.constraintId);
    if (x) x.fixed = false;
    return g;
  }
  if (op.type === "moveVertex") {
    const v = cs.flatMap((c) => c.vertices).find((v) => v.id === op.vertexId);
    if (v) {
      v.x = op.x!;
      v.y = op.y!;
    }
    return g;
  }
  if (op.type === "reconcile") return g;
  const c = cs.find((c) =>
    op.type === "setOrientation"
      ? c.id === op.contourId
      : c.walls.some((w) => w.id === op.wallId),
  );
  if (!c) return g;
  const w =
    op.type === "setOrientation"
      ? c.walls[0]
      : c.walls.find((w) => w.id === op.wallId)!;
  const kind =
    op.type === "setLength"
      ? "length"
      : op.type === "setInteriorAngle"
        ? "interiorAngle"
        : "firstWallOrientation";
  fixDimension(g, w.id, kind, op.value!);
  if (op.type === "setLength" && op.value! > 0) {
    const a = c.vertices.find((v) => v.id === w.startVertexId)!,
      b = c.vertices.find((v) => v.id === w.endVertexId)!;
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    if (l) {
      b.x = a.x + ((b.x - a.x) * op.value!) / l;
      b.y = a.y + ((b.y - a.y) * op.value!) / l;
    }
  }
  return g;
}
