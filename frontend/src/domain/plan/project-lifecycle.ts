import type { ProjectDocumentV3 } from "./types";
import { emptyGraph } from "./types";
export interface HistoryEntry {
  kind: "edit" | "clearProject";
  before: ProjectDocumentV3;
}
export interface ImportPreview {
  document: ProjectDocumentV3;
  projectId: string;
  lifecycleEpoch: number;
  requestId: number;
  localRevision: number;
}
export const defaultViewport = {
  centerX: 2100,
  centerY: 1800,
  zoom: 1,
  gridStepMm: 100,
};
export function clearedProject(current: ProjectDocumentV3): ProjectDocumentV3 {
  return {
    ...current,
    plan: {
      draft: emptyGraph(),
      draftRevision: current.plan.draftRevision + 1,
      pendingEdit: null,
      restorePoint: null,
    },
    rooms: [],
    selectedRoomId: null,
    workflow: { requestedStage: "object" },
    viewport: { ...defaultViewport },
  };
}
export function restoredProject(
  current: ProjectDocumentV3,
  before: ProjectDocumentV3,
): ProjectDocumentV3 {
  const restored = structuredClone(before),
    revision = current.plan.draftRevision + 1;
  restored.documentRevision = current.documentRevision;
  restored.plan.draftRevision = revision;
  if (restored.plan.pendingEdit)
    restored.plan.pendingEdit.targetDraftRevision = revision;
  restored.workflow.requestedStage = restored.workflow.requestedStage === "object" ? "object" : "variants";
  return restored;
}
