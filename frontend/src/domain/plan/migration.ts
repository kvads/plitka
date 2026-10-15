import type { GeometrySnapshot } from "../room/types";
import { createDocument as createV2 } from "../project/migration";
import { parseDocument, type ProjectDocument as V2 } from "../project/schema";
import { legacyAcknowledgment } from "../project/legacy-v2";
import { geometryKey } from "../project/keys";
import type {
  GraphSnapshot,
  ProjectDocumentV3,
  DimensionConstraint,
  DirectedSegmentRef,
} from "./types";
import { newRoom } from "./rooms";
import { parseV3 } from "./schema";
import { emptyGraph, type ProjectDocumentV4 } from "./types";
export function convertGraph(
  g: GeometrySnapshot,
  projectId: string,
): GraphSnapshot {
  const occupied = new Set(
    [
      ...g.outer.vertices,
      ...g.holes.flatMap((h) => h.vertices),
      ...g.outer.walls,
      ...g.holes.flatMap((h) => h.walls),
      ...g.constraints,
      ...g.holes,
    ].map((x) => x.id),
  );
  const chains = new Map<string, string>();
  for (const wall of [g.outer, ...g.holes].flatMap((c) => c.walls)) {
    let hash = 2166136261;
    for (const char of wall.id)
      hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    let id = `chain:${(hash >>> 0).toString(16)}`,
      suffix = 0;
    while (occupied.has(id))
      id = `chain:${(hash >>> 0).toString(16)}:${++suffix}`;
    occupied.add(id);
    chains.set(wall.id, id);
  }
  const chain = (id: string) => chains.get(id)!;
  void projectId;
  const result: GraphSnapshot = {
    vertices: [],
    segments: [],
    chains: [],
    voids: [],
    constraints: [],
    fieldInputs: structuredClone(g.fieldInputs),
  };
  for (const contour of [g.outer, ...g.holes]) {
    result.vertices.push(...structuredClone(contour.vertices));
    for (const wall of contour.walls) {
      const chainId = chain(wall.id);
      result.segments.push({ ...wall, chainId });
      result.chains.push({
        id: chainId,
        startVertexId: wall.startVertexId,
        endVertexId: wall.endVertexId,
        segmentIds: [wall.id],
        thicknessMm: 100,
      });
    }
    if (contour.kind === "hole")
      result.voids.push({
        id: contour.id,
        boundary: contour.walls.map((w) => ({
          segmentId: w.id,
          forward: true,
        })),
      });
    for (const c of g.constraints.filter((c) =>
      contour.walls.some((w) => w.id === c.wallId),
    )) {
      const i = contour.walls.findIndex((w) => w.id === c.wallId),
        w = contour.walls[i],
        next = contour.walls[(i + 1) % contour.walls.length];
      let con: DimensionConstraint;
      if (c.kind === "length")
        con = {
          id: c.id,
          kind: "chainLength",
          target: { chainId: chain(c.wallId) },
          value: c.value,
          fixed: c.fixed,
        };
      else if (c.kind === "firstWallOrientation")
        con = {
          id: c.id,
          kind: "orientation",
          target: { chainId: chain(c.wallId) },
          value: c.value,
          fixed: c.fixed,
        };
      else if (next && w.endVertexId === next.startVertexId)
        con = {
          id: c.id,
          kind: "angle",
          target: {
            vertexId: w.endVertexId,
            firstSegmentId: w.id,
            secondSegmentId: next.id,
            sector: contour.winding === "ccw" ? "cw" : "ccw",
          },
          value: c.value,
          fixed: c.fixed,
        };
      else
        con = {
          id: c.id,
          kind: "legacyUnbound",
          target: {
            originalConstraint: structuredClone(c),
            reason: "Выберите два луча для прежнего угла",
          },
          value: c.value,
          fixed: c.fixed,
        };
      result.constraints.push(con);
    }
  }
  for (const [key, text] of Object.entries(g.fieldInputs)) {
    const index = key.lastIndexOf(":"),
      id = key.slice(0, index),
      kind = key.slice(index + 1);
    let mapped = key;
    if (["x", "y"].includes(kind)) mapped = `vertex:${id}:${kind}`;
    if (kind === "length" && chains.has(id))
      mapped = `chain:${chain(id)}:length`;
    if (kind === "firstWallOrientation" && chains.has(id))
      mapped = `chain:${chain(id)}:orientation`;
    if (kind === "interiorAngle") {
      const c = result.constraints.find(
        (c) => c.kind === "angle" && c.target.firstSegmentId === id,
      );
      if (c) mapped = `angle:${c.id}:value`;
    }
    if (mapped !== key) {
      delete result.fieldInputs[key];
      result.fieldInputs[mapped] = text;
    }
  }
  return result;
}
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v)
        .filter(([, x]) => x !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, x]) => [k, canonical(x)]),
    );
  return v;
}
export async function hash(v: unknown) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(canonical(v))),
  );
  return [...new Uint8Array(bytes)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
function cycle(a: string[]) {
  if (!a.length) return a;
  return a
    .map((_, i) => [...a.slice(i), ...a.slice(0, i)])
    .sort((a, b) =>
      JSON.stringify(a) < JSON.stringify(b)
        ? -1
        : JSON.stringify(a) > JSON.stringify(b)
          ? 1
          : 0,
    )[0];
}
export async function legacyTopology(
  g: GraphSnapshot,
  outer: DirectedSegmentRef[],
  holes: DirectedSegmentRef[][],
) {
  const ss = new Map(g.segments.map((s) => [s.id, s]));
  const ring = (refs: DirectedSegmentRef[]) =>
    cycle(
      refs.map((r) => ss.get(r.segmentId)!.chainId + (r.forward ? "+" : "-")),
    );
  return hash([
    ring(outer),
    holes
      .map(ring)
      .sort((a, b) =>
        JSON.stringify(a) < JSON.stringify(b)
          ? -1
          : JSON.stringify(a) > JSON.stringify(b)
            ? 1
            : 0,
      ),
  ]);
}
export async function migrateV2(value: unknown): Promise<ProjectDocumentV3> {
  const old = parseDocument(value),
    g = convertGraph(old.room.draft, old.id);
  const boundary = (snap: GeometrySnapshot) => {
    const refs = (c: GeometrySnapshot["outer"], positive: boolean) => {
      const r = c.walls.map((w) => ({ segmentId: w.id, forward: true }));
      return (c.winding === "ccw") === positive
        ? r
        : r.reverse().map((x) => ({ ...x, forward: false }));
    };
    return {
      outer: refs(snap.outer, true),
      holes: snap.holes.map((h) => refs(h, false)),
    };
  };
  const b = boundary(old.room.draft);
  const room = newRoom(
    old.room.draft.outer.closed
      ? await legacyTopology(g, b.outer, b.holes)
      : null,
  );
  room.material = old.material;
  room.rules = old.rules;
  room.fieldInputs = Object.fromEntries(
    Object.entries(old.fieldInputs).map(([k, v]) => [
      k.replace(/^(material|rules)\./, ""),
      v,
    ]),
  );
  // Verified legacy approval is retained as data. Rebinding to graph keys occurs
  // only after a read-only validation confirms the same converted snapshot.
  if (old.room.confirmed) {
    const c = old.room.confirmed,
      cg = convertGraph(c.geometry, old.id),
      cb = boundary(c.geometry),
      tk = await legacyTopology(cg, cb.outer, cb.holes);
    const ack = c.acknowledgment;
    const valid =
      !!ack &&
      c.geometryKey === geometryKey(c.geometry) &&
      ack.measurementKey === legacyAcknowledgment(c.geometry).measurementKey &&
      JSON.stringify(ack.entries) ===
        JSON.stringify(legacyAcknowledgment(c.geometry).entries);
    const proof = await hash(cg);
    room.confirmed = {
      graph: cg,
      boundary: cb,
      topologyKey: tk,
      dependencyKey: "legacy:" + proof,
      geometryKey: "legacy:" + proof,
      measurementKey: "legacy:" + proof,
      acknowledgment: valid
        ? {
            measurementKey: "legacy:" + proof,
            entries: ack.entries.map((e) => ({
              key: e.wallId + ":" + e.kind,
              kind: e.kind,
              displayedValue: e.displayedValue,
            })),
          }
        : null,
      sourceDraftRevision: c.sourceDraftRevision,
    };
    if (valid && geometryKey(old.room.draft) === geometryKey(c.geometry))
      room.acknowledgment = room.confirmed.acknowledgment;
  }
  return parseV3({
    schemaVersion: 4,
    id: old.id,
    name: old.name,
    address: old.address,
    documentRevision: old.documentRevision,
    plan: {
      draft: g,
      draftRevision: old.room.draftRevision,
      pendingEdit: null,
      restorePoint: room.confirmed
        ? {
            graph: room.confirmed.graph,
            bindings: [
              { roomId: room.id, topologyKey: room.confirmed.topologyKey },
            ],
            selectedRoomId: room.id,
          }
        : null,
    },
    rooms: [room],
    selectedRoomId: room.binding === "attached" ? room.id : null,
    workflow: old.workflow,
    viewport: old.viewport,
  });
}
export async function createV3(
  name: string,
  address = "",
  plan?: Parameters<typeof createV2>[2],
  id?: string,
) {
  return migrateV2(
    createV2(
      name,
      address,
      plan,
      id as ReturnType<typeof crypto.randomUUID> | undefined,
    ),
  );
}

export function createV4(name: string, address = "", id = crypto.randomUUID()): ProjectDocumentV4 {
  return {
    schemaVersion: 4,
    id,
    name,
    address,
    documentRevision: 0,
    plan: { draft: emptyGraph(), draftRevision: 0, pendingEdit: null, restorePoint: null },
    rooms: [],
    selectedRoomId: null,
    workflow: { requestedStage: "object" },
    viewport: { centerX: 0, centerY: 0, zoom: 1, gridStepMm: 100 },
  };
}
