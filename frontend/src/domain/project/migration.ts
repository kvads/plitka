import { initial, type LayoutRequest } from "../../types";
import { contour, uid } from "../room/commands";
import type { ProjectDocument } from "./schema";
export function legacy(value: unknown): LayoutRequest {
  const p = value as LayoutRequest;
  if (
    !p ||
    !Array.isArray(p.outline) ||
    !Array.isArray(p.holes) ||
    p.holes.length > 20
  )
    throw new Error("Некорректная геометрия проекта.");
  for (const r of [p.outline, ...p.holes])
    if (
      !Array.isArray(r) ||
      r.length < 3 ||
      r.length > 100 ||
      !r.every(
        (v) =>
          Array.isArray(v) &&
          v.length === 2 &&
          v.every((n) => typeof n === "number" && Number.isFinite(n)),
      )
    )
      throw new Error("Некорректные координаты.");
  for (const k of [
    "tile",
    "grout",
    "gap",
    "threshold",
    "angle",
    "offset_x",
    "offset_y",
  ] as const)
    if (typeof p[k] !== "number" || !Number.isFinite(p[k]))
      throw new Error("Некорректные параметры.");
  return p;
}
export function createDocument(
  name: string,
  address = "",
  plan: LayoutRequest = initial,
  id = uid(),
): ProjectDocument {
  return {
    schemaVersion: 2,
    id,
    name,
    address,
    documentRevision: 0,
    room: {
      draft: {
        outer: contour(plan.outline),
        holes: plan.holes.map((h) => contour(h, "hole")),
        constraints: [],
        fieldInputs: {},
      },
      draftRevision: 0,
      pendingEdit: null,
      confirmed: null,
      acknowledgment: null,
    },
    material: { tile: plan.tile, grout: plan.grout },
    rules: { gap: plan.gap, threshold: plan.threshold, angle: plan.angle },
    fieldInputs: {},
    workflow: { requestedStage: "object" },
    viewport: { centerX: 2100, centerY: 1800, zoom: 1, gridStepMm: 100 },
  };
}
