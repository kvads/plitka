import type { ProjectDocument } from "./schema";
export type DocumentAction =
  | { type: "replace"; document: ProjectDocument }
  | { type: "rev"; revision: number };
export function documentReducer(
  state: ProjectDocument,
  action: DocumentAction,
): ProjectDocument {
  return action.type === "replace"
    ? action.document
    : { ...state, documentRevision: action.revision };
}
