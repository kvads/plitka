import { faceMemory, boundaryMemory } from "./room-identity";
import type {
  GraphSnapshot,
  RoomRecord,
  FaceCandidate,
  ProjectDocumentV4,
  Measurement,
} from "./types";
export const uid = () => crypto.randomUUID();
export function newRoom(key: string | null, name = "Помещение"): RoomRecord {
  return {
    id: uid(),
    topologyKey: key,
    binding: key ? "attached" : "detached",
    name,
    material: { tile: 600, grout: 2 },
    rules: { gap: 10, threshold: 100, angle: 0 },
    fieldInputs: {},
    acknowledgment: null,
    confirmed: null,
    boundaryMemory: null,
  };
}
export function nextRoomName(rooms: RoomRecord[]) {
  const max = Math.max(0, ...rooms.map(r => Number(/^Помещение (\d+)$/.exec(r.name)?.[1] || 0)));
  return `Помещение ${max + 1}`;
}
export function normalizeRoomNames(rooms: RoomRecord[]) {
  const result = rooms.map(r => ({...r, boundaryMemory: r.boundaryMemory ?? null}));
  for (const r of result) if (!r.name.trim()) r.name = nextRoomName(result);
  return result;
}
export async function bindRooms(doc: ProjectDocumentV4, faces: FaceCandidate[]): Promise<ProjectDocumentV4> {
  const rooms = normalizeRoomNames(doc.rooms);
  const memories = await Promise.all(faces.map(f => faceMemory(doc.plan.draft, f)));
  for (const r of rooms) {
    const c = r.confirmed;
    if (!r.boundaryMemory && r.binding === 'detached' && c && c.topologyKey === r.topologyKey) {
      const outline = c.boundary.outer.map(ref => {
        const seg = c.graph.segments.find(s => s.id === ref.segmentId)!;
        const v = c.graph.vertices.find(v => v.id === (ref.forward ? seg.startVertexId : seg.endVertexId))!;
        return [v.x, v.y];
      });
      r.boundaryMemory = await boundaryMemory(c.graph, c.boundary.outer, outline);
    }
  }
  const assigned = new Map<number, number>(), used = new Set<number>();
  const tier = (attached: boolean, key: 'full' | 'topologyKey' | 'geometryKey') => {
    const candidates = faces.map((f, fi) => assigned.has(fi) ? [] : rooms.flatMap((r, ri) => {
      if (used.has(ri) || (attached && r.binding !== 'attached')) return [];
      const match = key === 'full' ? r.topologyKey === f.topologyKey : r.boundaryMemory?.[key] === memories[fi][key];
      return match ? [ri] : [];
    }));
    candidates.forEach((rs, fi) => {
      if (rs.length === 1 && candidates.filter(xs => xs.includes(rs[0])).length === 1) { assigned.set(fi, rs[0]); used.add(rs[0]); }
    });
  };
  tier(true, 'full'); tier(true, 'topologyKey'); tier(false, 'full'); tier(false, 'topologyKey'); tier(false, 'geometryKey');
  rooms.forEach(r => r.binding = 'detached');
  faces.forEach((f, fi) => {
    let ri = assigned.get(fi);
    if (ri === undefined) { ri = rooms.length; rooms.push({...newRoom(f.topologyKey, nextRoomName(rooms)), boundaryMemory: null}); }
    Object.assign(rooms[ri], {binding: 'attached', topologyKey: f.topologyKey, boundaryMemory: memories[fi]});
  });
  return {...doc, rooms, selectedRoomId: rooms.some(r => r.id === doc.selectedRoomId && r.binding === 'attached') ? doc.selectedRoomId : null};
}
export function relevantMeasurements(
  face: FaceCandidate,
  measurements: Measurement[],
) {
  const deps = new Set(face.dependencyIds);
  const pairs = [face.outer, ...face.holes].flatMap((ring) =>
    ring.map((r, i) => [
      ring[(i + ring.length - 1) % ring.length].segmentId,
      r.segmentId,
    ]),
  );
  return measurements.filter(
    (m) =>
      Object.values(m.target).some(
        (x) => typeof x === "string" && deps.has(x),
      ) &&
      (m.kind !== "angle" ||
        m.source === "entered" ||
        (m.target.sector === "cw" &&
          pairs.some(
            ([a, b]) =>
              a === m.target.firstSegmentId && b === m.target.secondSegmentId,
          ))),
  );
}
export function subsetGraph(
  g: GraphSnapshot,
  face: FaceCandidate,
): GraphSnapshot {
  const deps = new Set(face.dependencyIds);
  // A confirmed snapshot is closed over references, including released conditions.
  const collect = (value: unknown): void => {
    if (typeof value === "string") deps.add(value);
    else if (value && typeof value === "object")
      Object.values(value).forEach(collect);
  };
  g.constraints.filter((c) => deps.has(c.id)).forEach((c) => collect(c.target));
  let previous = -1;
  while (previous !== deps.size) {
    previous = deps.size;
    g.voids
      .filter((v) => deps.has(v.id))
      .forEach((v) => v.boundary.forEach((r) => deps.add(r.segmentId)));
    g.segments
      .filter((s) => deps.has(s.id))
      .forEach((s) =>
        [s.chainId, s.startVertexId, s.endVertexId].forEach((id) =>
          deps.add(id),
        ),
      );
    g.chains
      .filter((c) => deps.has(c.id))
      .forEach((c) =>
        [c.startVertexId, c.endVertexId, ...c.segmentIds].forEach((id) =>
          deps.add(id),
        ),
      );
  }
  return {
    vertices: g.vertices.filter((x) => deps.has(x.id)),
    segments: g.segments.filter((x) => deps.has(x.id)),
    chains: g.chains.filter((x) => deps.has(x.id)),
    voids: g.voids.filter((x) => deps.has(x.id)),
    constraints: g.constraints.filter((x) => deps.has(x.id)),
    fieldInputs: Object.fromEntries(
      Object.entries(g.fieldInputs).filter(([k]) =>
        [...deps].some((id) => k.includes(":" + id + ":")),
      ),
    ),
  };
}
export function ready(
  room: RoomRecord | undefined,
  face: FaceCandidate | undefined,
) {
  return (
    !!room &&
    !!face &&
    face.validation.valid &&
    !!face.polygon &&
    face.areaMm2 !== null &&
    room.binding === "attached"
  );
}
export function materialReady(r?: RoomRecord) {
  return (
    !!r &&
    r.material.tile >= 50 &&
    r.material.tile <= 2000 &&
    r.material.grout >= 0 &&
    r.material.grout <= 20 &&
    !["tile", "grout"].some(
      (k) =>
        r.fieldInputs[k] !== undefined &&
        (!r.fieldInputs[k].trim() ||
          !Number.isFinite(Number(r.fieldInputs[k].replace(",", ".")))),
    )
  );
}
export function rulesReady(r?: RoomRecord) {
  return (
    !!r &&
    r.rules.gap >= 0 &&
    r.rules.gap <= 100 &&
    r.rules.threshold >= 1 &&
    r.rules.threshold <= 1000 &&
    r.rules.angle >= 0 &&
    r.rules.angle < 90 &&
    !Object.values(r.fieldInputs).some(
      (v) => !v.trim() || !Number.isFinite(Number(v.replace(",", "."))),
    )
  );
}
export function pendingAffectsRoom(
  doc: ProjectDocumentV4,
  face?: FaceCandidate,
) {
  const pending = doc.plan.pendingEdit;
  if (!pending) return false;
  if (!face) return true;
  const command = pending.command;
  if (command.type === "addVertex") return false;
  if (["connect", "drawWall", "addTemplate", "reconcile"].includes(command.type))
    return true;
  const graph = doc.plan.draft,
    ids = new Set<string>();
  const collect = (v: unknown): void => {
    if (typeof v === "string") ids.add(v);
    else if (v && typeof v === "object") Object.values(v).forEach(collect);
  };
  collect(command);
  let previous = -1;
  while (previous !== ids.size) {
    previous = ids.size;
    graph.constraints.forEach((c) => {
      if (ids.has(c.id)) collect(c.target);
    });
    graph.voids.forEach((v) => {
      if (ids.has(v.id)) v.boundary.forEach((r) => ids.add(r.segmentId));
    });
    graph.segments.forEach((s) => {
      const refs = [s.id, s.chainId, s.startVertexId, s.endVertexId];
      if (refs.some((id) => ids.has(id))) refs.forEach((id) => ids.add(id));
    });
  }
  return face.dependencyIds.some((id) => ids.has(id));
}
