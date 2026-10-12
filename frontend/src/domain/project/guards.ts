import type { ProjectDocument } from "./schema";
import type { ValidationResult } from "../room/types";
import { geometryKey, acknowledgment } from "./keys";
export const materialReady = (d: ProjectDocument) =>
  d.material.tile >= 50 &&
  d.material.tile <= 2000 &&
  d.material.grout >= 0 &&
  d.material.grout <= 20 &&
  !Object.keys(d.fieldInputs).some((k) => k.startsWith("material."));
export const rulesReady = (d: ProjectDocument) =>
  d.rules.gap >= 0 &&
  d.rules.gap <= 100 &&
  d.rules.threshold >= 1 &&
  d.rules.threshold <= 1000 &&
  d.rules.angle >= 0 &&
  d.rules.angle < 90 &&
  !Object.keys(d.fieldInputs).some((k) => k.startsWith("rules."));
export function roomReady(d: ProjectDocument, v: ValidationResult | null) {
  const r = d.room;
  return !!(
    v?.status === "valid" &&
    !r.pendingEdit &&
    r.confirmed &&
    geometryKey(r.draft) === geometryKey(r.confirmed.geometry) &&
    (acknowledgment(r.draft, v.measurements).entries.length === 0 ||
      r.acknowledgment?.measurementKey ===
        acknowledgment(r.draft, v.measurements).measurementKey)
  );
}
