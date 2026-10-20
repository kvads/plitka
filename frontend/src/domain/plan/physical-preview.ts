import { api } from "../../api";
import type { PhysicalGraphResponseV5, PhysicalGraphV5, Point } from "./types";
import { physicalBasisKey } from "./physical-basis";

export type PhysicalPreviewResponse = PhysicalGraphResponseV5 & {
  proposedWall?: { corners: [Point, Point, Point, Point] };
};

export const physicalPreview = (
  graph: PhysicalGraphV5,
  draftRevision: number,
  drawnEdge: [Point, Point],
  side: "left" | "right",
  thicknessMm: number,
  signal: AbortSignal,
) => physicalBasisKey(graph).then(basisKey => api<PhysicalPreviewResponse>("v5/plan/preview", {
  schemaVersion: 5,
  requestId: crypto.randomUUID(),
  draftRevision,
  basisKey,
  graph, drawnEdge, side, thicknessMm,
}, signal));
