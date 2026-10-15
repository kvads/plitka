import { api } from "../../api";
import type {
  DeletionTarget,
  DeletionPreviewResponse,
  ProjectDocumentV4,
} from "./types";
export function deletionPreview(
  doc: ProjectDocumentV4,
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
