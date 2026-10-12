import type { GeometrySnapshot, Measurement } from "../room/types";
import type { ProjectDocument, Acknowledgment } from "./schema";
export const geometryKey = (g: GeometrySnapshot) => JSON.stringify(g);
export function acknowledgment(
  g: GeometrySnapshot,
  ms: Measurement[],
): Acknowledgment {
  const entries = ms
    .flatMap((m) => [
      {
        wallId: m.wallId,
        kind: "length",
        displayedValue: Math.round(m.length * 10) / 10,
        source: m.lengthSource,
      },
      ...(m.interiorAngle === null
        ? []
        : [
            {
              wallId: m.wallId,
              kind: "interiorAngle",
              displayedValue: Math.round(m.interiorAngle * 10) / 10,
              source: m.angleSource,
            },
          ]),
    ])
    .filter((e) => e.source === "derived")
    .map(({ source, ...e }) => e)
    .sort((a, b) => (a.wallId + a.kind).localeCompare(b.wallId + b.kind));
  return { entries, measurementKey: JSON.stringify([geometryKey(g), entries]) };
}
export const inputKey = (d: ProjectDocument) =>
  JSON.stringify([d.room.confirmed?.geometry, d.material, d.rules]);
