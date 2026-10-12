import { parseDocument, type ProjectDocument } from "./schema";
import { createDocument, legacy } from "./migration";
export const KEY = "plitka-projects-v2";
export function readProjects(): ProjectDocument[] {
  const raw = localStorage.getItem(KEY);
  if (raw) {
    const c = JSON.parse(raw);
    if (c.schemaVersion !== 2 || !Array.isArray(c.projects))
      throw new Error("Повреждённый каталог. Исходные данные сохранены.");
    const docs = c.projects.map(parseDocument);
    if (new Set(docs.map((d: ProjectDocument) => d.id)).size !== docs.length)
      throw new Error("Повтор проекта.");
    return docs;
  }
  const old = localStorage.getItem("plitka-projects-v1"),
    single = localStorage.getItem("plitka-project-v1");
  const rows = old
    ? JSON.parse(old)
    : single
      ? [{ name: "Мой первый проект", address: "", plan: JSON.parse(single) }]
      : [];
  if (!Array.isArray(rows)) throw new Error("Повреждённый каталог.");
  const docs = rows.map((r) =>
    parseDocument(createDocument(r.name, r.address, legacy(r.plan), r.id)),
  );
  if (old || single)
    localStorage.setItem(
      KEY,
      JSON.stringify({ schemaVersion: 2, projects: docs }),
    );
  return docs;
}
export async function saveDocument(
  doc: ProjectDocument,
  expected: number | null,
): Promise<ProjectDocument> {
  const save = () => {
    const rows = readProjects(),
      old = rows.find((r) => r.id === doc.id);
    if ((old?.documentRevision ?? null) !== expected)
      throw new Error(
        "Конфликт: проект изменён в другой вкладке. Загрузите сохранённую версию или скачайте мой черновик.",
      );
    const next = parseDocument({
      ...doc,
      documentRevision: expected === null ? 0 : expected + 1,
    });
    localStorage.setItem(
      KEY,
      JSON.stringify({
        schemaVersion: 2,
        projects: old
          ? rows.map((r) => (r.id === doc.id ? next : r))
          : [...rows, next],
      }),
    );
    return next;
  };
  return navigator.locks
    ? navigator.locks.request("plitka-projects-write", save)
    : save();
}
