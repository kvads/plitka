import { api } from "../../api";
import type {
  DeletionTarget,
  DeletionPreviewResponse,
  ProjectDocumentV5,
} from "./types";
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
