import type { ProjectDocument } from "./schema";
import type { LayoutRequest } from "../../types";
export function layoutRequest(d: ProjectDocument, x = 0, y = 0): LayoutRequest {
  const g = d.room.confirmed!.geometry;
  return {
    outline: g.outer.vertices.map((v) => [v.x, v.y]),
    holes: g.holes.map((h) => h.vertices.map((v) => [v.x, v.y])),
    ...d.material,
    ...d.rules,
    offset_x: x,
    offset_y: y,
  };
}
