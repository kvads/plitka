import type { GraphSnapshot, Point } from "./types";

export type SelectedWallAngle = {
  junctionVertexId: string;
  adjacentChainId: string;
  value: number;
  origin: Point;
  from: Point;
  to: Point;
};

/** Smallest physical angle for every wall attached to the selected chain. */
export function selectedWallAngles(graph: GraphSnapshot, selectedChainId: string): SelectedWallAngle[] {
  const vertices = new Map(graph.vertices.map(v => [v.id, v]));
  const selected = graph.segments.filter(s => s.chainId === selectedChainId);
  const junctions = new Set(selected.flatMap(s => [s.startVertexId, s.endVertexId]));
  const candidates = new Map<string, SelectedWallAngle>();
  const rays = (vertexId: string, chainId: string) => graph.segments
    .filter(s => s.chainId === chainId && (s.startVertexId === vertexId || s.endVertexId === vertexId))
    .map(s => {
      const p = vertices.get(vertexId)!;
      const q = vertices.get(s.startVertexId === vertexId ? s.endVertexId : s.startVertexId)!;
      const length = Math.hypot(q.x - p.x, q.y - p.y);
      return length ? { x: (q.x - p.x) / length, y: (q.y - p.y) / length } : null;
    }).filter((v): v is Point => v !== null);
  for (const vertexId of junctions) {
    const origin = vertices.get(vertexId);
    if (!origin) continue;
    const own = rays(vertexId, selectedChainId);
    for (const chain of graph.chains) {
      if (chain.id === selectedChainId) continue;
      const other = rays(vertexId, chain.id);
      if (!other.length) continue;
      const key = `${vertexId}:${chain.id}`;
      for (const from of own) for (const to of other) {
        const value = Math.acos(Math.max(-1, Math.min(1, from.x * to.x + from.y * to.y))) * 180 / Math.PI;
        const previous = candidates.get(key);
        if (!previous || value < previous.value)
          candidates.set(key, { junctionVertexId: vertexId, adjacentChainId: chain.id,
            value, origin: { x: origin.x, y: origin.y }, from, to });
      }
    }
  }
  return [...candidates.values()].sort((a, b) =>
    a.junctionVertexId.localeCompare(b.junctionVertexId) || a.adjacentChainId.localeCompare(b.adjacentChainId));
}
