import type { GraphSnapshot } from "./types";
export function deletionConditions(
  graph: GraphSnapshot,
  vertexId?: string,
  segmentId?: string,
) {
  const affected = new Set<string>(vertexId ? [vertexId] : []);
  for (const s of graph.segments)
    if (
      s.id === segmentId ||
      s.startVertexId === vertexId ||
      s.endVertexId === vertexId
    ) {
      affected.add(s.id);
      affected.add(s.chainId);
    }
  const touches = (v: unknown): boolean =>
    typeof v === "string"
      ? affected.has(v)
      : !!v && typeof v === "object" && Object.values(v).some(touches);
  return graph.constraints.filter((c) => touches(c.target));
}
