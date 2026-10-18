import type { GraphSnapshot, Point } from "./types";
import { chainNodes } from "./editor-state";

/** The temporary physical strip of a straight wall chain, in world millimetres. */
export function selectedWallFootprint(graph: GraphSnapshot, chainId: string): Point[] | null {
  const chain = graph.chains.find((item) => item.id === chainId);
  if (!chain || !chain.segmentIds.length || !Number.isFinite(chain.thicknessMm) || chain.thicknessMm <= 0) return null;
  const start = graph.vertices.find((vertex) => vertex.id === chain.startVertexId);
  const end = graph.vertices.find((vertex) => vertex.id === chain.endVertexId);
  if (!start || !end) return null;
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  if (length < 1e-9) return null;
  const nodes = chainNodes(graph, chain.id);
  if (nodes.length !== chain.segmentIds.length + 1) return null;
  for (const id of nodes) {
    const vertex = graph.vertices.find((item) => item.id === id);
    if (!vertex || Math.abs((vertex.x - start.x) * (end.y - start.y) -
      (vertex.y - start.y) * (end.x - start.x)) / length > .051) return null;
  }
  const dx = -(end.y - start.y) * chain.thicknessMm / (2 * length);
  const dy = (end.x - start.x) * chain.thicknessMm / (2 * length);
  return [
    { x: start.x + dx, y: start.y + dy },
    { x: end.x + dx, y: end.y + dy },
    { x: end.x - dx, y: end.y - dy },
    { x: start.x - dx, y: start.y - dy },
  ];
}
