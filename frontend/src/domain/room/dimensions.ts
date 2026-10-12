import type { DimensionConstraint, GeometrySnapshot } from "./types";
export const normalizeOrientation = (angle: number) =>
  ((angle % 360) + 360) % 360;
/** Preserve a released condition's identity and provenance when entering it again. */
export function fixDimension(
  g: GeometrySnapshot,
  wallId: string,
  kind: DimensionConstraint["kind"],
  value: number,
) {
  const existing = g.constraints.find(
    (x) => x.wallId === wallId && x.kind === kind,
  );
  if (existing) {
    existing.value = value;
    existing.fixed = true;
  } else
    g.constraints.push({
      id: crypto.randomUUID(),
      wallId,
      kind,
      value,
      fixed: true,
    });
}
