import type { GeometrySnapshot, Operation } from "../room/types";
export type Stage = "object" | "tile" | "rules" | "variants";
export type Acknowledgment = {
  measurementKey: string;
  entries: { wallId: string; kind: string; displayedValue: number }[];
};
export type RoomState = {
  draft: GeometrySnapshot;
  draftRevision: number;
  pendingEdit: {
    operation: Operation;
    basisGeometry: GeometrySnapshot;
    targetDraftRevision: number;
  } | null;
  confirmed: {
    geometry: GeometrySnapshot;
    geometryKey: string;
    measurementKey: string;
    acknowledgment: Acknowledgment | null;
    sourceDraftRevision: number;
  } | null;
  acknowledgment: Acknowledgment | null;
};
export type ProjectDocument = {
  schemaVersion: 2;
  id: string;
  name: string;
  address: string;
  documentRevision: number;
  room: RoomState;
  material: { tile: number; grout: number };
  rules: { gap: number; threshold: number; angle: number };
  fieldInputs: Record<string, string>;
  workflow: { requestedStage: Stage };
  viewport: {
    centerX: number;
    centerY: number;
    zoom: number;
    gridStepMm: number;
  };
};
const fail = () => {
  throw new Error(
    "Некорректный файл проекта: проверьте версию, поля и связи элементов.",
  );
};
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return fail();
  return v as Record<string, unknown>;
}
function exact(v: Record<string, unknown>, keys: string[]) {
  if (Object.keys(v).some((k) => !keys.includes(k))) fail();
}
function number(v: unknown) {
  if (typeof v !== "number" || !Number.isFinite(v)) fail();
}
function fields(v: unknown) {
  for (const val of Object.values(object(v)))
    if (typeof val !== "string" || val.length > 100) fail();
}
function id(v: unknown) {
  if (typeof v !== "string" || !v.length || v.length > 100) fail();
}
function finiteTree(v: unknown) {
  if (typeof v === "number") number(v);
  else if (v && typeof v === "object") Object.values(v).forEach(finiteTree);
}
export function geometry(value: unknown): GeometrySnapshot {
  const g = object(value);
  exact(g, ["outer", "holes", "constraints", "fieldInputs"]);
  fields(g.fieldInputs);
  if (
    !Array.isArray(g.holes) ||
    g.holes.length > 20 ||
    !Array.isArray(g.constraints)
  )
    fail();
  const ids = new Set<string>(),
    walls = new Set<string>(),
    first = new Set<string>();
  const add = (v: unknown) => {
    id(v);
    if (ids.has(v as string)) fail();
    ids.add(v as string);
  };
  [g.outer, ...(g.holes as unknown[])].forEach((entry, ci) => {
    const c = object(entry);
    exact(c, ["id", "kind", "closed", "winding", "vertices", "walls"]);
    add(c.id);
    if (
      c.kind !== (ci ? "hole" : "outer") ||
      typeof c.closed !== "boolean" ||
      !["ccw", "cw"].includes(c.winding as string) ||
      !Array.isArray(c.vertices) ||
      c.vertices.length > 100 ||
      !Array.isArray(c.walls)
    )
      fail();
    const vs = c.vertices as Record<string, unknown>[],
      ws = c.walls as Record<string, unknown>[];
    vs.forEach((v) => {
      exact(object(v), ["id", "x", "y"]);
      add(v.id);
      number(v.x);
      number(v.y);
    });
    if (ws.length !== (c.closed ? vs.length : Math.max(0, vs.length - 1)))
      fail();
    ws.forEach((w, i) => {
      exact(object(w), ["id", "startVertexId", "endVertexId"]);
      add(w.id);
      if (
        w.startVertexId !== vs[i].id ||
        w.endVertexId !== vs[(i + 1) % vs.length].id
      )
        fail();
      walls.add(w.id as string);
      if (!i) first.add(w.id as string);
    });
  });
  const kinds = new Set<string>();
  (g.constraints as Record<string, unknown>[]).forEach((c) => {
    exact(object(c), ["id", "kind", "wallId", "value", "fixed"]);
    add(c.id);
    number(c.value);
    if (
      typeof c.fixed !== "boolean" ||
      !walls.has(c.wallId as string) ||
      !["length", "interiorAngle", "firstWallOrientation"].includes(
        c.kind as string,
      )
    )
      fail();
    if (c.kind === "firstWallOrientation" && !first.has(c.wallId as string))
      fail();
    const k = c.wallId + ":" + c.kind;
    if (kinds.has(k)) fail();
    kinds.add(k);
  });
  return structuredClone(value) as GeometrySnapshot;
}
function ack(v: unknown) {
  if (v === null) return;
  const a = object(v);
  if (typeof a.measurementKey !== "string" || !Array.isArray(a.entries)) fail();
  (a.entries as unknown[]).forEach((e) => {
    const x = object(e);
    id(x.wallId);
    if (!["length", "interiorAngle"].includes(x.kind as string)) fail();
    number(x.displayedValue);
  });
}
export function parseDocument(value: unknown): ProjectDocument {
  const d = object(value);
  finiteTree(d);
  if (d.schemaVersion !== 2) fail();
  id(d.id);
  if (
    typeof d.name !== "string" ||
    !d.name.trim() ||
    d.name.trim().length > 120 ||
    typeof d.address !== "string" ||
    d.address.length > 300
  )
    fail();
  if (
    !Number.isInteger(d.documentRevision) ||
    (d.documentRevision as number) < 0
  )
    fail();
  const r = object(d.room);
  exact(r, [
    "draft",
    "draftRevision",
    "pendingEdit",
    "confirmed",
    "acknowledgment",
  ]);
  geometry(r.draft);
  if (!Number.isInteger(r.draftRevision) || (r.draftRevision as number) < 0)
    fail();
  ack(r.acknowledgment);
  if (r.confirmed !== null) {
    const c = object(r.confirmed);
    exact(c, [
      "geometry",
      "geometryKey",
      "measurementKey",
      "acknowledgment",
      "sourceDraftRevision",
    ]);
    geometry(c.geometry);
    if (
      typeof c.geometryKey !== "string" ||
      typeof c.measurementKey !== "string" ||
      !Number.isInteger(c.sourceDraftRevision)
    )
      fail();
    ack(c.acknowledgment);
  }
  if (r.pendingEdit !== null) {
    const pe = object(r.pendingEdit);
    geometry(pe.basisGeometry);
    exact(pe, ["operation", "basisGeometry", "targetDraftRevision"]);
    if (
      !Number.isInteger(pe.targetDraftRevision) ||
      pe.targetDraftRevision !== r.draftRevision
    )
      fail();
    const op = object(pe.operation);
    exact(op, [
      "type",
      "wallId",
      "contourId",
      "vertexId",
      "constraintId",
      "value",
      "x",
      "y",
    ]);
    const basis = geometry(pe.basisGeometry);
    const contours = [basis.outer, ...basis.holes];
    if (["setLength", "setInteriorAngle"].includes(op.type as string)) {
      number(op.value);
      if (!contours.some((c) => c.walls.some((w) => w.id === op.wallId)))
        fail();
    }
    if (op.type === "setOrientation") {
      number(op.value);
      if (!contours.some((c) => c.id === op.contourId && c.walls.length))
        fail();
    }
    if (op.type === "moveVertex") {
      number(op.x);
      number(op.y);
      if (!contours.some((c) => c.vertices.some((v) => v.id === op.vertexId)))
        fail();
    }
    if (
      op.type === "releaseConstraint" &&
      !basis.constraints.some((c) => c.id === op.constraintId)
    )
      fail();
    if (
      ![
        "setLength",
        "setInteriorAngle",
        "setOrientation",
        "moveVertex",
        "releaseConstraint",
        "reconcile",
      ].includes(op.type as string)
    )
      fail();
  }
  const m = object(d.material),
    rules = object(d.rules),
    view = object(d.viewport);
  exact(m, ["tile", "grout"]);
  exact(rules, ["gap", "threshold", "angle"]);
  exact(view, ["centerX", "centerY", "zoom", "gridStepMm"]);
  exact(object(d.workflow), ["requestedStage"]);
  ["tile", "grout"].forEach((k) => number(m[k]));
  ["gap", "threshold", "angle"].forEach((k) => number(rules[k]));
  ["centerX", "centerY", "zoom", "gridStepMm"].forEach((k) => number(view[k]));
  if ((view.zoom as number) <= 0 || (view.gridStepMm as number) <= 0) fail();
  fields(d.fieldInputs);
  if (
    !["object", "tile", "rules", "variants"].includes(
      object(d.workflow).requestedStage as string,
    )
  )
    fail();
  const copy = structuredClone(d) as ProjectDocument;
  return {
    schemaVersion: 2,
    id: copy.id,
    name: copy.name,
    address: copy.address,
    documentRevision: copy.documentRevision,
    room: copy.room,
    material: copy.material,
    rules: copy.rules,
    fieldInputs: copy.fieldInputs,
    workflow: copy.workflow,
    viewport: copy.viewport,
  };
}
