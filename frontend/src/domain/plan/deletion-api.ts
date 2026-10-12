import { api } from "../../api";
import type {
  DeletionTarget,
  DeletionPreviewResponse,
  ProjectDocumentV3,
} from "./types";
export function deletionPreview(
  doc: ProjectDocumentV3,
  target: DeletionTarget,
  requestId: string,
) {
  return api<DeletionPreviewResponse>("plan/deletion-preview", {
    schemaVersion: 3,
    requestId,
    draftRevision: doc.plan.draftRevision,
    basisKey: JSON.stringify(doc.plan.draft),
    graph: doc.plan.draft,
    target,
  });
}
