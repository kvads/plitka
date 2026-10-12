import type { GraphSnapshot, Point, Vertex, CoincidentPair, Issue } from "./types";

export const VERTEX_SAFETY_RADIUS = 12;
export function coincidentPairs(graph: GraphSnapshot): CoincidentPair[] {
  const groups = new Map<string, Vertex[]>();
  for (const v of graph.vertices) {
    const key = JSON.stringify([v.x, v.y]);
    groups.set(key, [...(groups.get(key) || []), v]);
  }
  return [...groups.values()].flatMap(group => {
    const sorted = [...group].sort((a, b) => a.id.localeCompare(b.id));
    return sorted.flatMap((v, i) => sorted.slice(i + 1).map(w => ({
      vertexIds: [v.id, w.id] as [string, string], x: v.x, y: v.y,
    })));
  });
}
export function candidateCollisions(basis: GraphSnapshot, candidate: GraphSnapshot) {
  const old = new Set(coincidentPairs(basis).map(p => JSON.stringify(p)));
  return coincidentPairs(candidate).filter(p => !old.has(JSON.stringify(p)));
}
export function sameCoordinate(a: Point, b: Point) { return a.x === b.x && a.y === b.y; }

// All coordinates here are CSS pixels; callers own the current scene transform.
export function blockingVertices(point: Point, vertices: Vertex[]): string[] {
  return vertices.map(v => ({ id: v.id, distance: Math.hypot(v.x - point.x, v.y - point.y) }))
    .filter(v => v.distance <= VERTEX_SAFETY_RADIUS + 1e-9)
    .sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id))
    .map(v => v.id);
}
export function diagnosticIssues(issues: Issue[], graph: GraphSnapshot): Issue[] {
  const zero = issues.filter(i => i.code === "zero_wall");
  return issues.filter(i => {
    if (i.code === "coincident_vertices")
      return !zero.some(z => i.entityIds.every(id => z.entityIds.includes(id)));
    if (i.code === "chain_order") {
      const chain = graph.chains.find(c => i.entityIds.includes(c.id));
      // Only a single degenerate segment has no independent order defect.
      if (chain?.segmentIds.length === 1 && zero.some(z => z.entityIds.includes(chain.segmentIds[0]))) return false;
    }
    return true;
  });
}
