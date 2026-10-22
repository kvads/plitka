import { api } from "../../api";
import type {
  DeletionTarget,
  DeletionPreviewResponse,
  ProjectDocumentV5,
  ProjectDocumentV6,
} from "./types";
import { physicalBasisKey } from "./physical-basis";
export function deletionPreview(
  doc: ProjectDocumentV5,
  target: DeletionTarget,
  requestId: string,
) {
  return api<DeletionPreviewResponse>("plan/deletion-preview", {
    schemaVersion: 4,
    requestId,
    draftRevision: doc.plan.draftRevision,
    basisKey: JSON.stringify(doc.plan.draft),
    graph: doc.plan.draft,
    target,
  });
}

export type PhysicalDeletionImpact = {
  wallIds: string[];
  junctionIds: string[];
  openingIds: string[];
  affectedRoomKeys: string[];
  disappearedRoomKeys: string[];
};

export async function physicalDeletionPreview(doc: ProjectDocumentV6, wallId: string,
  signal?: AbortSignal) {
  return api<{
    schemaVersion: 5; status: "ready" | "invalid";
    requestId: string; basisKey: string;
    target: { kind: "wall"; wallId: string };
    impact: PhysicalDeletionImpact | null;
    issues: { message: string }[];
  }>("v5/plan/deletion-preview", {
    schemaVersion: 5, requestId: crypto.randomUUID(),
    draftRevision: doc.plan.draftRevision,
    basisKey: await physicalBasisKey(doc.plan.draft),
    graph: doc.plan.draft, target: { kind: "wall", wallId },
  }, signal);
}
