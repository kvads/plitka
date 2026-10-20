import type { LayoutRequest } from "../../types";
import type { PhysicalRoomRecordV6, PhysicalRoomV5, ProjectDocumentV6, SharedLayoutGridV6 } from "./types";

export const roomLayoutBasis = (room: PhysicalRoomRecordV6, face: PhysicalRoomV5) =>
  JSON.stringify([face.geometryKey, room.material, room.rules]);

export function activeSharedGrid(doc: ProjectDocumentV6, faces: PhysicalRoomV5[]): SharedLayoutGridV6 | null {
  const grid = doc.sharedGrid;
  if (!grid) return null;
  const reference = doc.rooms.find(room => room.id === grid.referenceRoomId);
  const face = faces.find(candidate => candidate.topologyKey === reference?.topologyKey);
  if (!reference || reference.binding !== "attached" || !face?.polygon ||
      !face.validation.valid || roomLayoutBasis(reference, face) !== grid.referenceBasis ||
      reference.material.tile !== grid.tile || reference.material.grout !== grid.grout ||
      reference.rules.angle !== grid.angle) return null;
  return grid;
}

export function roomLayoutKey(doc: ProjectDocumentV6, room: PhysicalRoomRecordV6,
  face: PhysicalRoomV5 | undefined, grid: SharedLayoutGridV6 | null): string {
  const basis = JSON.stringify([doc.id, room.id, face?.geometryKey, room.material, room.rules]);
  if (!doc.sharedGrid?.linkedRoomIds.includes(room.id)) return basis;
  return JSON.stringify([basis, grid ? [grid.referenceRoomId, grid.tile, grid.grout,
    grid.angle, grid.offsetX, grid.offsetY] : "stale-shared-grid"]);
}

export function roomLayoutRequest(room: PhysicalRoomRecordV6, face: PhysicalRoomV5,
  grid: SharedLayoutGridV6 | null): LayoutRequest {
  if (!face.polygon) throw new Error("Полезный контур помещения отсутствует.");
  return {
    outline: face.polygon.outline as [number, number][],
    holes: face.polygon.holes as [number, number][][],
    tile: grid?.tile ?? room.material.tile,
    grout: grid?.grout ?? room.material.grout,
    angle: grid?.angle ?? room.rules.angle,
    gap: room.rules.gap,
    threshold: room.rules.threshold,
    offset_x: grid?.offsetX ?? 0,
    offset_y: grid?.offsetY ?? 0,
  };
}
