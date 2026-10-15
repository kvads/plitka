import type { GraphSnapshot, DirectedSegmentRef, FaceCandidate } from './types';
async function digest(value: unknown) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(['outer-v1', value])));
  return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('');
}
function cycle(items: unknown[]) {
  return items.map((_, i) => JSON.stringify([...items.slice(i), ...items.slice(0, i)])).sort()[0] || '[]';
}
export async function boundaryMemory(graph: GraphSnapshot, outer: DirectedSegmentRef[], outline: number[][]) {
  const chains = outer.map(r => [graph.segments.find(s => s.id === r.segmentId)!.chainId, r.forward] as const);
  const compressed = chains.filter((v, i) => JSON.stringify(v) !== JSON.stringify(chains[(i + chains.length - 1) % chains.length]));
  const chainCycle = compressed.length ? compressed : chains.slice(0, 1);
  let points = outline.map(p => p.map(n => Object.is(n, -0) ? 0 : n));
  if (JSON.stringify(points[0]) === JSON.stringify(points.at(-1))) points.pop();
  let changed = true;
  while (changed && points.length > 3) {
    changed = false;
    for (let i = 0; i < points.length; i++) {
      const a = points[(i + points.length - 1) % points.length], b = points[i], c = points[(i + 1) % points.length];
      if ((b[0]-a[0])*(c[1]-b[1]) === (b[1]-a[1])*(c[0]-b[0]) && (b[0]-a[0])*(b[0]-c[0])+(b[1]-a[1])*(b[1]-c[1]) <= 0) { points.splice(i, 1); changed = true; break; }
    }
  }
  return {
    topologyKey: await digest([cycle(chainCycle), cycle([...chainCycle].reverse().map(([id, forward]) => [id, !forward]))].sort()[0]),
    geometryKey: await digest([cycle(points), cycle([...points].reverse())].sort()[0]),
  };
}
export const faceMemory = (g: GraphSnapshot, f: FaceCandidate) => boundaryMemory(g, f.outer, f.axisPolygon.outline);
