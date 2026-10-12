import { parseV3 } from "./schema";
import { migrateV2, createV3 } from "./migration";
import { legacy } from "../project/migration";
import type { ProjectDocumentV3 } from "./types";
export const KEY = "plitka-projects-v3";
const lock = <T>(fn: () => Promise<T> | T) =>
  navigator.locks
    ? navigator.locks.request("plitka-projects-write", fn)
    : Promise.reject(
        new Error(
          "Браузер не поддерживает блокировку записи. Откройте проект в современном браузере для безопасного сохранения.",
        ),
      );
export function readV3(): ProjectDocumentV3[] {
  const raw = localStorage.getItem(KEY);
  if (raw === null) return [];
  const value = JSON.parse(raw);
  if (
    value.schemaVersion !== 3 ||
    !Array.isArray(value.projects) ||
    Object.keys(value).some((k) => !["schemaVersion", "projects"].includes(k))
  )
    throw new Error("Повреждённый каталог v3. Резервные данные не изменены.");
  const rows = value.projects.map(parseV3);
  if (new Set(rows.map((x: ProjectDocumentV3) => x.id)).size !== rows.length)
    throw new Error("Повтор проекта.");
  return rows;
}
export async function initializeV3() {
  return lock(async () => {
    if (localStorage.getItem(KEY) !== null) return readV3();
    const old = localStorage.getItem("plitka-projects-v2");
    let rows: ProjectDocumentV3[] = [];
    if (old !== null) {
      const c = JSON.parse(old);
      if (c.schemaVersion !== 2 || !Array.isArray(c.projects))
        throw new Error("Повреждённый каталог v2.");
      rows = await Promise.all(c.projects.map(migrateV2));
    } else {
      const raw = localStorage.getItem("plitka-projects-v1"),
        single = localStorage.getItem("plitka-project-v1");
      const c = raw
        ? JSON.parse(raw)
        : single
          ? [
              {
                name: "Мой первый проект",
                address: "",
                plan: JSON.parse(single),
              },
            ]
          : [];
      if (!Array.isArray(c)) throw new Error("Повреждённый каталог.");
      rows = await Promise.all(
        c.map((x) => createV3(x.name, x.address, legacy(x.plan), x.id)),
      );
    }
    if (new Set(rows.map((x) => x.id)).size !== rows.length)
      throw new Error("Повтор проекта.");
    localStorage.setItem(
      KEY,
      JSON.stringify({ schemaVersion: 3, projects: rows }),
    );
    return rows;
  });
}
export type SaveOutcome =
  | { status: "saved"; document: ProjectDocumentV3 }
  | { status: "skipped" };
export function saveV3(
  doc: ProjectDocumentV3,
  expected: number | null,
): Promise<ProjectDocumentV3>;
export function saveV3(
  doc: ProjectDocumentV3,
  expected: number | null,
  isCurrent: () => boolean,
): Promise<SaveOutcome>;
export async function saveV3(
  doc: ProjectDocumentV3,
  expected: number | null,
  isCurrent?: () => boolean,
) {
  if (isCurrent && !isCurrent()) return { status: "skipped" as const };
  return lock(() => {
    if (isCurrent && !isCurrent()) return { status: "skipped" as const };
    const rows = readV3(),
      old = rows.find((x) => x.id === doc.id);
    if ((old?.documentRevision ?? null) !== expected)
      throw new Error(
        "Конфликт: проект изменён в другой вкладке. Скачайте мой черновик или загрузите сохранённую версию.",
      );
    const next = parseV3({
      ...doc,
      documentRevision: expected === null ? 0 : expected + 1,
    });
    localStorage.setItem(
      KEY,
      JSON.stringify({
        schemaVersion: 3,
        projects: old
          ? rows.map((x) => (x.id === doc.id ? next : x))
          : [...rows, next],
      }),
    );
    return isCurrent ? { status: "saved" as const, document: next } : next;
  });
}
export async function importV3(file: File, current?: ProjectDocumentV3) {
  if (file.size > 2 * 1024 * 1024) throw new Error("Файл больше 2 МиБ.");
  const v = JSON.parse(await file.text());
  if (v.format !== undefined || v.version !== undefined) {
    if (v.format !== "plitka-project") throw new Error("Неизвестный формат.");
    if (v.version === 3) return parseV3(v.project);
    if (v.version === 2) return migrateV2(v.project);
    throw new Error("Неизвестная версия файла.");
  }
  return createV3(
    current?.name || "Импортированный проект",
    current?.address || "",
    legacy(v),
  );
}

export async function deleteV3(projectId: string, expectedRevision: number): Promise<import('./types').DeleteProjectOutcome> {
  if (!projectId.trim() || !Number.isInteger(expectedRevision) || expectedRevision < 0)
    throw new Error('Некорректное подтверждение удаления проекта.');
  return lock(() => {
    const projects = readV3();
    const current = projects.find(p => p.id === projectId);
    if (!current) return { status: 'alreadyMissing', projectId, projects };
    if (current.documentRevision !== expectedRevision)
      return { status: 'conflict', projectId, projects, current };
    const remaining = projects.filter(p => p.id !== projectId);
    localStorage.setItem(KEY, JSON.stringify({ schemaVersion: 3, projects: remaining }));
    return { status: 'deleted', projectId, projects: remaining };
  });
}
