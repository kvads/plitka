import { normalizeRoomNames } from "./rooms";
import type { GraphSnapshot, PhysicalGraphV5, ProjectDocumentV4, ProjectDocumentV5, ProjectDocumentV6 } from "./types";
import { requireTenth } from "./precision";
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

/** Validate persisted v5 measurements without quantizing revisions or viewport state. */
export function parseV5(value: unknown): ProjectDocumentV5 {
  const input = obj(value);
  if (input.schemaVersion !== 5) fail();
  const parsed = parseV4({ ...input, schemaVersion: 4 });
  const tenth = (value: number | null | undefined) => {
    if (value != null) requireTenth(value);
  };
  const graph = (snapshot: GraphSnapshot) => {
    const connected = new Set(snapshot.segments.flatMap(s => [s.startVertexId, s.endVertexId]));
    for (const vertex of snapshot.vertices) {
      if (!connected.has(vertex.id)) fail();
      tenth(vertex.x); tenth(vertex.y);
    }
    for (const chain of snapshot.chains) tenth(chain.thicknessMm);
    for (const constraint of snapshot.constraints) {
      if (constraint.kind === 'angle') fail();
      tenth(constraint.value);
    }
  };
  graph(parsed.plan.draft);
  if (parsed.plan.pendingEdit) {
    graph(parsed.plan.pendingEdit.basisGraph);
    const command = parsed.plan.pendingEdit.command;
    if (['addVertex', 'moveVertex', 'connect', 'setAngle'].includes(command.type)) fail();
    const checkPoint = (point: {x: number; y: number}) => { tenth(point.x); tenth(point.y); };
    if (command.type === 'drawWall') { checkPoint(command.start); checkPoint(command.end); tenth(command.thicknessMm); }
    if (command.type === 'addTemplate') { checkPoint(command.origin); for (const n of [command.width, command.height, command.notchWidth, command.notchHeight, command.thicknessMm]) tenth(n); }
    if (command.type === 'setWallThickness') tenth(command.thicknessMm);
    if (command.type === 'setLength' || command.type === 'setOrientation') tenth(command.value);
  }
  if (parsed.plan.restorePoint) graph(parsed.plan.restorePoint.graph);
  for (const room of parsed.rooms) {
    for (const n of [room.material.tile, room.material.grout, room.rules.gap, room.rules.threshold, room.rules.angle]) tenth(n);
    for (const entry of room.acknowledgment?.entries ?? []) tenth(entry.displayedValue);
    if (room.confirmed) {
      graph(room.confirmed.graph);
      for (const entry of room.confirmed.acknowledgment?.entries ?? []) tenth(entry.displayedValue);
    }
  }
  return { ...parsed, schemaVersion: 5 };
}

const pointV6 = (value: unknown) => {
  const point = obj(value);
  exact(point, ["x", "y"]);
  requireTenth(num(point.x));
  requireTenth(num(point.y));
  return point as { x: number; y: number };
};

/** Strict stored physical graph, independent of the retired axial schema. */
export function physicalGraphSchema(value: unknown): PhysicalGraphV5 {
  const graph = obj(value);
  exact(graph, ["walls", "junctions"]);
  const ids = new Set<string>(), walls = new Map<string, Obj>();
  for (const raw of arr(graph.walls, 6300)) {
    const wall = obj(raw);
    exact(wall, ["id", "drawnEdge", "side", "thicknessMm", "corners"]);
    const id = str(wall.id, 1, 100);
    if (ids.has(id)) fail();
    ids.add(id);
    walls.set(id, wall);
    choice(wall.side, ["left", "right"]);
    if (requireTenth(num(wall.thicknessMm)) < 0.1 || num(wall.thicknessMm) > 100000) fail();
    const drawn = arr(wall.drawnEdge, 2), corners = arr(wall.corners, 4);
    if (drawn.length !== 2 || corners.length !== 4) fail();
    const edge = drawn.map(pointV6), points = corners.map(pointV6);
    if (edge.some((p, index) => p.x !== points[index].x || p.y !== points[index].y)) fail();
    const [a, b, c, d] = points;
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
    if (length < 0.1) fail();
    const widths = [[c, b], [d, a]].map(([p, q]) => (dx * (p.y - q.y) - dy * (p.x - q.x)) / length);
    const expected = (wall.side === "left" ? 1 : -1) * (wall.thicknessMm as number);
    if (widths.some(width => Math.abs(width - expected) > 0.2000001)) fail();
    if (Math.abs((c.x - d.x) * dy - (c.y - d.y) * dx) / length > 0.2000001) fail();
  }
  const edgePoints = (wall: Obj, name: string) => {
    const [a, b, c, d] = (wall.corners as unknown[]).map(pointV6);
    return ({ drawn: [a, b], opposite: [d, c], startCap: [a, d], endCap: [b, c] } as Record<string, typeof a[]>)[name];
  };
  for (const raw of arr(graph.junctions)) {
    const joint = obj(raw);
    exact(joint, ["id", "participants"]);
    const id = str(joint.id, 1, 100);
    if (ids.has(id)) fail();
    ids.add(id);
    const parts = arr(joint.participants, 6300);
    if (parts.length < 2) fail();
    const seen = new Set<string>(), positions: {x:number;y:number}[] = [];
    for (const rawPart of parts) {
      const part = obj(rawPart);
      exact(part, ["wallId", "edge", "point", "attachment"]);
      const wallId = str(part.wallId, 1, 100), wall = walls.get(wallId) ?? fail();
      if (seen.has(wallId)) fail();
      seen.add(wallId);
      choice(part.edge, ["drawn", "opposite", "startCap", "endCap"]);
      choice(part.attachment, ["end", "interior"]);
      const p = pointV6(part.point), [a, b] = edgePoints(wall, part.edge as string);
      const vx = b.x - a.x, vy = b.y - a.y;
      const ratio = ((p.x - a.x) * vx + (p.y - a.y) * vy) / (vx * vx + vy * vy);
      const foot = {x: a.x + Math.max(0, Math.min(1, ratio)) * vx,
                    y: a.y + Math.max(0, Math.min(1, ratio)) * vy};
      if (Math.hypot(p.x - foot.x, p.y - foot.y) > 0.1000001) fail();
      const cap = part.edge === "startCap" || part.edge === "endCap";
      const atEnd = Math.min(Math.hypot(p.x-a.x,p.y-a.y), Math.hypot(p.x-b.x,p.y-b.y)) <= 0.1000001;
      if (part.attachment === "interior" ? cap || atEnd : !cap && !atEnd) fail();
      positions.push(p);
    }
    if (positions.slice(1).some(p => Math.hypot(p.x-positions[0].x,p.y-positions[0].y) > 0.1000001)) fail();
  }
  return structuredClone(value) as PhysicalGraphV5;
}

/** Validate all persisted v6 graph snapshots and subject values. */
export function parseV6(value: unknown): ProjectDocumentV6 {
  const doc = obj(value);
  exact(doc, ["schemaVersion", "id", "name", "address", "documentRevision", "plan", "rooms", "selectedRoomId", "workflow", "viewport", "sharedGrid"]);
  if (doc.schemaVersion !== 6) fail();
  str(doc.id, 1); str(doc.name, 1, 120); str(doc.address, 0, 300);
  integer(doc.documentRevision);
  const plan = obj(doc.plan);
  exact(plan, ["draft", "draftRevision", "pendingEdit", "restorePoint"]);
  physicalGraphSchema(plan.draft);
  integer(plan.draftRevision);
  const roomIds = new Set<string>();
  const acknowledgment = (value: unknown) => {
    if (value === null) return;
    const ack = obj(value);
    exact(ack, ["measurementKey", "entries"]);
    str(ack.measurementKey, 1, 100000);
    for (const raw of arr(ack.entries)) {
      const entry = obj(raw);
      exact(entry, ["key", "kind", "displayedValue"]);
      str(entry.key, 1, 100000); str(entry.kind, 1);
      requireTenth(num(entry.displayedValue));
    }
  };
  for (const raw of arr(doc.rooms)) {
    const room = obj(raw);
    exact(room, ["id", "topologyKey", "binding", "name", "material", "rules", "fieldInputs", "acknowledgment", "confirmed", "boundaryMemory"]);
    const id = str(room.id, 1);
    if (roomIds.has(id)) fail();
    roomIds.add(id);
    if (room.topologyKey !== null) str(room.topologyKey, 1, 100000);
    choice(room.binding, ["attached", "detached"]);
    str(room.name, 1, 120);
    fields(room.fieldInputs);
    acknowledgment(room.acknowledgment);
    if (room.boundaryMemory !== null) {
      const memory = obj(room.boundaryMemory);
      exact(memory, ["topologyKey", "geometryKey"]);
      str(memory.topologyKey, 1, 100000); str(memory.geometryKey, 1, 100000);
    }
    const material = obj(room.material), rules = obj(room.rules);
    exact(material, ["tile", "grout"]); exact(rules, ["gap", "threshold", "angle"]);
    for (const subject of [material.tile, material.grout, rules.gap, rules.threshold, rules.angle])
      requireTenth(num(subject));
    if (room.confirmed !== null) {
      const confirmed = obj(room.confirmed);
      exact(confirmed, ["graph", "topologyKey", "geometryKey", "dependencyKey", "measurementKey", "acknowledgment", "sourceDraftRevision"]);
      physicalGraphSchema(confirmed.graph);
      for (const key of ["topologyKey", "geometryKey", "dependencyKey", "measurementKey"])
        str(confirmed[key], 1, 100000);
      acknowledgment(confirmed.acknowledgment);
      integer(confirmed.sourceDraftRevision);
    }
  }
  if (doc.selectedRoomId !== null && !roomIds.has(str(doc.selectedRoomId))) fail();
  if (doc.sharedGrid !== undefined && doc.sharedGrid !== null) {
    const grid = obj(doc.sharedGrid);
    exact(grid, ["referenceRoomId", "referenceBasis", "tile", "grout", "angle", "offsetX", "offsetY", "linkedRoomIds"]);
    const referenceRoomId = str(grid.referenceRoomId, 1);
    if (!roomIds.has(referenceRoomId)) fail();
    str(grid.referenceBasis, 1, 100000);
    for (const value of [grid.tile, grid.grout, grid.angle, grid.offsetX, grid.offsetY])
      requireTenth(num(value));
    if (num(grid.tile) < 50 || num(grid.tile) > 2000 ||
        num(grid.grout) < 0 || num(grid.grout) > 20 ||
        num(grid.angle) < 0 || num(grid.angle) >= 90 ||
        Math.abs(num(grid.offsetX)) > 100000 || Math.abs(num(grid.offsetY)) > 100000) fail();
    const linked = new Set<string>();
    for (const raw of arr(grid.linkedRoomIds)) {
      const id = str(raw, 1);
      if (!roomIds.has(id) || id === referenceRoomId || linked.has(id)) fail();
      linked.add(id);
    }
  }
  if (plan.pendingEdit !== null) {
    const pending = obj(plan.pendingEdit);
    exact(pending, ["kind", "commandId", "command", "basisGraph", "targetDraftRevision"]);
    if (pending.kind !== "graphV5") fail();
    str(pending.commandId, 1);
    integer(pending.targetDraftRevision);
    if (pending.targetDraftRevision !== plan.draftRevision) fail();
    const graph = physicalGraphSchema(pending.basisGraph), command = obj(pending.command);
    const type = str(command.type);
    if (type === "drawWall") {
      exact(command, ["type", "drawnEdge", "side", "thicknessMm"]);
      const edge = arr(command.drawnEdge, 2);
      if (edge.length !== 2) fail();
      edge.forEach(pointV6);
      choice(command.side, ["left", "right"]);
      if (command.thicknessMm !== undefined && (num(command.thicknessMm) < 10 ||
          num(command.thicknessMm) > 100000 || num(command.thicknessMm) % 10 !== 0)) fail();
    } else if (type === "setWallThickness") {
      exact(command, ["type", "wallId", "thicknessMm"]);
      if (!graph.walls.some(w => w.id === str(command.wallId, 1))) fail();
      if (num(command.thicknessMm) < 10 || num(command.thicknessMm) > 100000 ||
          num(command.thicknessMm) % 10 !== 0) fail();
    } else if (type === "nudgeWallHandle") {
      exact(command, ["type", "wallId", "handle", "axis", "direction"]);
      if (!graph.walls.some(w => w.id === str(command.wallId, 1))) fail();
      choice(command.handle, ["start", "center", "end"]);
      choice(command.axis, ["x", "y"]);
      if (command.direction !== -1 && command.direction !== 1) fail();
    } else if (type === "deleteWall") {
      exact(command, ["type", "wallId"]);
      if (!graph.walls.some(w => w.id === str(command.wallId, 1))) fail();
    } else fail();
  }
  if (plan.restorePoint !== null) {
    const restore = obj(plan.restorePoint);
    exact(restore, ["graph", "bindings", "selectedRoomId"]);
    physicalGraphSchema(restore.graph);
    if (restore.selectedRoomId !== null && !roomIds.has(str(restore.selectedRoomId))) fail();
    for (const raw of arr(restore.bindings)) {
      const binding = obj(raw);
      exact(binding, ["roomId", "topologyKey"]);
      if (!roomIds.has(str(binding.roomId))) fail();
      if (binding.topologyKey !== null) str(binding.topologyKey, 1, 100000);
    }
  }
  const workflow = obj(doc.workflow);
  exact(workflow, ["requestedStage"]);
  choice(workflow.requestedStage, ["object", "tile", "rules", "variants"]);
  const viewport = obj(doc.viewport);
  exact(viewport, ["centerX", "centerY", "zoom", "gridStepMm"]);
  num(viewport.centerX); num(viewport.centerY);
  if (num(viewport.zoom) <= 0 || num(viewport.gridStepMm) <= 0) fail();
  if (new TextEncoder().encode(JSON.stringify(doc)).length > 2 * 1024 * 1024)
    throw new Error("Файл больше 2 МиБ.");
  const parsed = structuredClone(value) as ProjectDocumentV6;
  parsed.sharedGrid ??= null;
  return parsed;
}
