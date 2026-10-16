import { normalizeRoomNames } from "./rooms";
import type { GraphSnapshot, ProjectDocumentV4 } from "./types";
const fail = (): never => {
  throw new Error(
    "Некорректный файл проекта: проверьте версию, поля и связи элементов.",
  );
};
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : fail();
const exact = (o: Obj, keys: string[]) => {
  if (Object.keys(o).some((k) => !keys.includes(k))) fail();
};
const str = (v: unknown, min = 0, max = 100) => {
  if (typeof v !== "string" || v.length < min || v.length > max) fail();
  return v as string;
};
const num = (v: unknown) => {
  if (typeof v !== "number" || !Number.isFinite(v)) fail();
  return v as number;
};
const integer = (v: unknown) => {
  if (num(v) < 0 || !Number.isInteger(v)) fail();
};
const bool = (v: unknown) => {
  if (typeof v !== "boolean") fail();
};
const arr = (v: unknown, max = 12600): unknown[] =>
  Array.isArray(v) && v.length <= max ? v : fail();
const fields = (v: unknown) =>
  Object.values(obj(v)).forEach((x) => str(x, 0, 100));
const choice = (v: unknown, vs: string[]) => {
  if (!vs.includes(v as string)) fail();
};
export function graphSchema(value: unknown): GraphSnapshot {
  const g = obj(value);
  exact(g, [
    "vertices",
    "segments",
    "chains",
    "voids",
    "constraints",
    "fieldInputs",
  ]);
  fields(g.fieldInputs);
  const ids = new Set<string>();
  const add = (v: unknown) => {
    const id = str(v, 1, 100);
    if (ids.has(id)) fail();
    ids.add(id);
    return id;
  };
  const vs = new Set<string>();
  for (const raw of arr(g.vertices, 2100)) {
    const v = obj(raw);
    exact(v, ["id", "x", "y"]);
    vs.add(add(v.id));
    num(v.x);
    num(v.y);
  }
  const ss = new Map<string, Obj>();
  for (const raw of arr(g.segments, 6300)) {
    const v = obj(raw);
    exact(v, ["id", "startVertexId", "endVertexId", "chainId"]);
    const id = add(v.id);
    if (
      !vs.has(str(v.startVertexId)) ||
      !vs.has(str(v.endVertexId)) ||
      v.startVertexId === v.endVertexId
    )
      fail();
    str(v.chainId, 1);
    ss.set(id, v);
  }
  const chains = new Map<string, string[]>(),
    used = new Set<string>();
  for (const raw of arr(g.chains, 6300)) {
    const v = obj(raw);
    exact(v, ["id", "startVertexId", "endVertexId", "segmentIds", "thicknessMm"]);
    if (num(v.thicknessMm) <= 0) fail();
    const id = add(v.id);
    if (!vs.has(str(v.startVertexId)) || !vs.has(str(v.endVertexId))) fail();
    let prev = v.startVertexId as string;
    const nodes = [prev];
    const items = arr(v.segmentIds, 6300);
    if (!items.length) fail();
    for (const sid of items) {
      const s = ss.get(str(sid)) ?? fail();
      if (
        s.chainId !== id ||
        s.startVertexId !== prev ||
        used.has(sid as string)
      )
        fail();
      used.add(sid as string);
      prev = s.endVertexId as string;
      nodes.push(prev);
    }
    if (prev !== v.endVertexId) fail();
    chains.set(id, nodes);
  }
  if (used.size !== ss.size) fail();
  const refs = (v: unknown) => {
    for (const raw of arr(v, 6300)) {
      const ref = obj(raw);
      exact(ref, ["segmentId", "forward"]);
      if (!ss.has(str(ref.segmentId))) fail();
      bool(ref.forward);
    }
  };
  for (const raw of arr(g.voids, 20)) {
    const v = obj(raw);
    exact(v, ["id", "boundary"]);
    add(v.id);
    refs(v.boundary);
  }
  const seen = new Set<string>();
  for (const raw of arr(g.constraints)) {
    const c = obj(raw);
    exact(c, ["id", "kind", "target", "value", "fixed"]);
    add(c.id);
    num(c.value);
    bool(c.fixed);
    const t = obj(c.target);
    const allowed: Record<string, string[]> = {
      segmentLength: ["segmentId"],
      chainLength: ["chainId", "range"],
      orientation: ["chainId"],
      angle: ["vertexId", "firstSegmentId", "secondSegmentId", "sector"],
      legacyUnbound: ["originalConstraint", "reason"],
    };
    const kind = str(c.kind);
    if (!allowed[kind]) fail();
    exact(t, allowed[kind]);
    if (kind === "segmentLength" && !ss.has(str(t.segmentId))) fail();
    if (
      ["chainLength", "orientation"].includes(kind) &&
      !chains.has(str(t.chainId))
    )
      fail();
    if (t.range != null) {
      const range = obj(t.range);
      exact(range, ["startVertexId", "endVertexId"]);
      const nodes = chains.get(t.chainId as string) ?? fail();
      const a = nodes.indexOf(str(range.startVertexId)),
        b = nodes.indexOf(str(range.endVertexId));
      if (a < 0 || a >= b) fail();
    }
    if (kind === "angle") {
      const id = str(t.vertexId);
      if (!vs.has(id) || t.firstSegmentId === t.secondSegmentId) fail();
      choice(t.sector, ["cw", "ccw"]);
      for (const sid of [t.firstSegmentId, t.secondSegmentId]) {
        const edge = ss.get(str(sid)) ?? fail();
        if (![edge.startVertexId, edge.endVertexId].includes(id)) fail();
      }
    }
    if (kind === "legacyUnbound") {
      obj(t.originalConstraint);
      str(t.reason, 1, 1000);
    }
    const k = JSON.stringify([
      kind,
      Object.keys(t)
        .filter((k) => t[k] !== null)
        .sort()
        .map((k) => [k, t[k]]),
    ]);
    if (seen.has(k)) fail();
    seen.add(k);
  }
  return structuredClone(value) as GraphSnapshot;
}

/** Remove obsolete editor data while preserving every wall and its coordinates. */
export function cleanV4Graph(graph: GraphSnapshot): GraphSnapshot {
  const used = new Set(graph.segments.flatMap((segment) => [segment.startVertexId, segment.endVertexId]));
  for (const chain of graph.chains) {
    used.add(chain.startVertexId);
    used.add(chain.endVertexId);
  }
  const obsoleteField = (key: string) =>
    /^angle:[^:]+:value$/.test(key) ||
    /^vertex:[^:]+:angle-/.test(key) ||
    /^[^:]+:interiorAngle$/.test(key);
  return {
    ...graph,
    vertices: graph.vertices.filter((vertex) => used.has(vertex.id)),
    constraints: graph.constraints.filter((constraint) => constraint.kind !== "angle"),
    fieldInputs: Object.fromEntries(Object.entries(graph.fieldInputs).filter(([key]) => !obsoleteField(key))),
  };
}

export function cleanV4Document(value: ProjectDocumentV4): ProjectDocumentV4 {
  const document = structuredClone(value);
  document.plan.draft = cleanV4Graph(document.plan.draft);
  if (document.plan.pendingEdit) {
    const pending = document.plan.pendingEdit;
    if (["addVertex", "moveVertex", "connect", "setAngle"].includes(pending.command.type))
      document.plan.pendingEdit = null;
    else pending.basisGraph = cleanV4Graph(pending.basisGraph);
  }
  if (document.plan.restorePoint)
    document.plan.restorePoint.graph = cleanV4Graph(document.plan.restorePoint.graph);
  for (const room of document.rooms)
    if (room.confirmed) room.confirmed.graph = cleanV4Graph(room.confirmed.graph);
  if (JSON.stringify(document) !== JSON.stringify(value))
    document.documentRevision++;
  return document;
}
export function commandSchema(value: unknown, graph: GraphSnapshot) {
  const c = obj(value),
    vs = new Set(graph.vertices.map((v) => v.id)),
    ss = new Set(graph.segments.map((s) => s.id)),
    cs = new Set(graph.chains.map((c) => c.id));
  const point = (v: unknown) => {
    const p = obj(v);
    exact(p, ["x", "y"]);
    num(p.x);
    num(p.y);
  };
  const ref = (v: unknown, ids: Set<string>) => {
    if (!ids.has(str(v, 1))) fail();
  };
  const commandKeys: Record<string, string[]> = {
    addVertex: ["point"],
    connect: ["fromVertexId", "to", "thicknessMm"],
    drawWall: ["start", "end", "thicknessMm"],
    setWallThickness: ["chainId", "thicknessMm"],
    moveVertex: ["vertexId", "point"],
    nudgeWallHandle: ["chainId", "handle", "axis", "direction"],
    setLength: ["constraintId", "target", "value"],
    setAngle: [
      "constraintId",
      "vertexId",
      "firstSegmentId",
      "secondSegmentId",
      "sector",
      "value",
    ],
    setOrientation: ["constraintId", "chainId", "value"],
    releaseConstraint: ["constraintId"],
    deleteElements: ["vertexIds", "segmentIds", "acknowledgedConstraintIds"],
    markVoid: ["boundary"],
    unmarkVoid: ["voidId"],
    addTemplate: [
      "shape",
      "origin",
      "width",
      "height",
      "notchWidth",
      "notchHeight",
      "thicknessMm",
    ],
    deleteRoom: ["topologyKey", "impactKey"],
    deleteVoid: ["voidId", "impactKey"],
    deleteConstraint: ["constraintId"],
    reconcile: [],
  };
  const type = str(c.type);
  if (!commandKeys[type]) fail();
  exact(c, ["type", ...commandKeys[type]]);
  if (c.constraintId !== undefined) str(c.constraintId, 1);
  if (["setLength", "setAngle", "setOrientation"].includes(type)) num(c.value);
  if (type === "addVertex" || type === "moveVertex") point(c.point);
  if (type === "moveVertex") ref(c.vertexId, vs);
  if (type === "nudgeWallHandle") {
    ref(c.chainId, cs);
    choice(c.handle, ["start", "center", "end"]);
    choice(c.axis, ["x", "y"]);
    if (c.direction !== -1 && c.direction !== 1) fail();
  }
  if (type === "connect") {
    if (num(c.thicknessMm) <= 0) fail();
    ref(c.fromVertexId, vs);
    const to = obj(c.to);
    if (to.vertexId !== undefined) {
      exact(to, ["vertexId"]);
      ref(to.vertexId, vs);
    } else {
      exact(to, ["segmentId", "point"]);
      ref(to.segmentId, ss);
      point(to.point);
    }
  }
  if (type === "drawWall") {
    point(c.start);
    point(c.end);
    if (num(c.thicknessMm) <= 0) fail();
  }
  if (type === "setWallThickness") {
    ref(c.chainId, cs);
    if (num(c.thicknessMm) <= 0) fail();
  }
  if (type === "setLength") {
    const t = obj(c.target);
    exact(t, ["kind", "id", "range"]);
    choice(t.kind, ["segment", "chain"]);
    ref(t.id, t.kind === "chain" ? cs : ss);
    if (t.range != null) {
      const r = obj(t.range);
      exact(r, ["startVertexId", "endVertexId"]);
      const chain = graph.chains.find((ch) => ch.id === t.id) ?? fail();
      const nodes = [
        chain.startVertexId,
        ...chain.segmentIds.map(
          (id) => graph.segments.find((s) => s.id === id)!.endVertexId,
        ),
      ];
      if (
        nodes.indexOf(str(r.startVertexId)) < 0 ||
        nodes.indexOf(str(r.endVertexId)) <= nodes.indexOf(str(r.startVertexId))
      )
        fail();
    }
  }
  if (type === "setAngle") {
    ref(c.vertexId, vs);
    ref(c.firstSegmentId, ss);
    ref(c.secondSegmentId, ss);
    choice(c.sector, ["cw", "ccw"]);
    if (c.firstSegmentId === c.secondSegmentId) fail();
    for (const id of [c.firstSegmentId, c.secondSegmentId]) {
      const edge = graph.segments.find((s) => s.id === id)!;
      if (
        ![edge.startVertexId, edge.endVertexId].includes(c.vertexId as string)
      )
        fail();
    }
  }
  if (type === "setOrientation") ref(c.chainId, cs);
  if (type === "deleteRoom") {
    str(c.topologyKey, 1, 100000);
    str(c.impactKey, 1, 100);
  }
  if (type === "deleteVoid") {
    ref(c.voidId, new Set(graph.voids.map((v) => v.id)));
    str(c.impactKey, 1, 100);
  }
  if (type === "releaseConstraint" || type === "deleteConstraint")
    ref(c.constraintId, new Set(graph.constraints.map((c) => c.id)));
  if (type === "deleteElements") {
    arr(c.vertexIds, 2100).forEach((id) => ref(id, vs));
    arr(c.segmentIds, 6300).forEach((id) => ref(id, ss));
    arr(c.acknowledgedConstraintIds).forEach((id) =>
      ref(id, new Set(graph.constraints.map((c) => c.id))),
    );
  }
  if (type === "markVoid")
    for (const value of arr(c.boundary, 6300)) {
      const r = obj(value);
      exact(r, ["segmentId", "forward"]);
      ref(r.segmentId, ss);
      bool(r.forward);
    }
  if (type === "unmarkVoid")
    ref(c.voidId, new Set(graph.voids.map((v) => v.id)));
  if (type === "addTemplate") {
    if (num(c.thicknessMm) <= 0) fail();
    choice(c.shape, ["rectangle", "lShape"]);
    point(c.origin);
    if (num(c.width) <= 0 || num(c.height) <= 0) fail();
    for (const k of ["notchWidth", "notchHeight"])
      if (c[k] !== undefined) num(c[k]);
  }
  return value;
}
export function parseV4(value: unknown): ProjectDocumentV4 {
  const d = obj(value);
  exact(d, [
    "schemaVersion",
    "id",
    "name",
    "address",
    "documentRevision",
    "plan",
    "rooms",
    "selectedRoomId",
    "workflow",
    "viewport",
  ]);
  if (d.schemaVersion !== 4) fail();
  str(d.id, 1);
  if (str(d.name, 1, 120).trim() !== d.name) fail();
  str(d.address, 0, 300);
  integer(d.documentRevision);
  const plan = obj(d.plan);
  exact(plan, ["draft", "draftRevision", "pendingEdit", "restorePoint"]);
  graphSchema(plan.draft);
  integer(plan.draftRevision);
  const roomIds = new Set<string>();
  const ack = (value: unknown) => {
    if (value === null) return;
    const a = obj(value);
    exact(a, ["measurementKey", "entries"]);
    str(a.measurementKey, 1, 100000);
    for (const x of arr(a.entries)) {
      const e = obj(x);
      exact(e, ["key", "kind", "displayedValue"]);
      str(e.key, 1, 100000);
      str(e.kind, 1);
      num(e.displayedValue);
    }
  };
  for (const raw of arr(d.rooms)) {
    const room = obj(raw);
    exact(room, [
      "id",
      "topologyKey",
      "binding",
      "name",
      "material",
      "rules",
      "fieldInputs",
      "acknowledgment",
      "confirmed",
      "boundaryMemory",
    ]);
    if (room.boundaryMemory != null) {
      const memory = obj(room.boundaryMemory); exact(memory, ['topologyKey', 'geometryKey']);
      for (const key of ['topologyKey', 'geometryKey']) if (!/^[a-f0-9]{64}$/.test(str(memory[key],64,64))) fail();
    }
    const id = str(room.id, 1);
    if (roomIds.has(id)) fail();
    roomIds.add(id);
    if (room.topologyKey !== null) str(room.topologyKey, 1, 100000);
    choice(room.binding, ["attached", "detached"]);
    str(room.name, 0, 120);
    fields(room.fieldInputs);
    ack(room.acknowledgment);
    const m = obj(room.material),
      ru = obj(room.rules);
    exact(m, ["tile", "grout"]);
    exact(ru, ["gap", "threshold", "angle"]);
    [m.tile, m.grout, ru.gap, ru.threshold, ru.angle].forEach(num);
    if (room.confirmed !== null) {
      const c = obj(room.confirmed);
      exact(c, [
        "graph",
        "boundary",
        "topologyKey",
        "dependencyKey",
        "geometryKey",
        "measurementKey",
        "acknowledgment",
        "sourceDraftRevision",
      ]);
      const g = graphSchema(c.graph);
      const boundary = obj(c.boundary);
      exact(boundary, ["outer", "holes"]);
      const ids = new Set(g.segments.map((s) => s.id));
      for (const ring of [boundary.outer, ...arr(boundary.holes, 20)])
        for (const raw of arr(ring, 6300)) {
          const ref = obj(raw);
          exact(ref, ["segmentId", "forward"]);
          if (!ids.has(str(ref.segmentId))) fail();
          bool(ref.forward);
        }
      [c.topologyKey, c.dependencyKey, c.geometryKey, c.measurementKey].forEach(
        (v) => str(v, 1, 100000),
      );
      ack(c.acknowledgment);
      integer(c.sourceDraftRevision);
    }
  }
  if (d.selectedRoomId !== null && !roomIds.has(str(d.selectedRoomId))) fail();
  if (plan.pendingEdit !== null) {
    const p = obj(plan.pendingEdit);
    integer(p.targetDraftRevision);
    if (p.targetDraftRevision !== plan.draftRevision) fail();
    if (p.kind === "graphV4") {
      exact(p, [
        "kind",
        "commandId",
        "command",
        "basisGraph",
        "targetDraftRevision",
      ]);
      str(p.commandId, 1);
      commandSchema(p.command, graphSchema(p.basisGraph));
    } else fail();
  }
  if (plan.restorePoint !== null) {
    const restore = obj(plan.restorePoint);
    exact(restore, ["graph", "bindings", "selectedRoomId"]);
    graphSchema(restore.graph);
    if (
      restore.selectedRoomId !== null &&
      !roomIds.has(str(restore.selectedRoomId))
    )
      fail();
    for (const raw of arr(restore.bindings)) {
      const b = obj(raw);
      exact(b, ["roomId", "topologyKey"]);
      if (!roomIds.has(str(b.roomId))) fail();
      if (b.topologyKey !== null) str(b.topologyKey, 1, 100000);
    }
  }
  const w = obj(d.workflow);
  exact(w, ["requestedStage"]);
  choice(w.requestedStage, ["object", "tile", "rules", "variants"]);
  const v = obj(d.viewport);
  exact(v, ["centerX", "centerY", "zoom", "gridStepMm"]);
  num(v.centerX);
  num(v.centerY);
  if (num(v.zoom) <= 0 || num(v.gridStepMm) <= 0) fail();
  if (new TextEncoder().encode(JSON.stringify(d)).length > 2 * 1024 * 1024)
    throw new Error("Файл больше 2 МиБ.");
  const document = structuredClone(value) as ProjectDocumentV4;
  document.rooms = normalizeRoomNames(document.rooms);
  document.workflow.requestedStage = document.workflow.requestedStage === "object" ? "object" : "variants";
  return document;
}
export const parseV3 = parseV4;
