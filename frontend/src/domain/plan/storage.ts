import { cleanV4Document, parseV4 } from "./schema";
import type { ProjectDocumentV4 } from "./types";
export const KEY = "plitka-projects-v4";
const OLD_KEYS = ["plitka-project-v1", "plitka-projects-v1", "plitka-projects-v2", "plitka-projects-v3"];
const lock = <T>(fn: () => Promise<T> | T) =>
  navigator.locks
    ? navigator.locks.request("plitka-projects-write", fn)
    : Promise.reject(
        new Error(
          "Браузер не поддерживает блокировку записи. Откройте проект в современном браузере для безопасного сохранения.",
        ),
      );
export function readV3(): ProjectDocumentV4[] {
  const raw = localStorage.getItem(KEY);
  if (raw === null) return [];
  const value = JSON.parse(raw);
  if (
    value.schemaVersion !== 4 ||
    !Array.isArray(value.projects) ||
    Object.keys(value).some((k) => !["schemaVersion", "projects"].includes(k))
  )
    throw new Error("Повреждённый каталог v4. Данные не изменены.");
  const rows = value.projects.map(parseV4);
  if (new Set(rows.map((x: ProjectDocumentV4) => x.id)).size !== rows.length)
    throw new Error("Повтор проекта.");
  return rows;
}
export async function initializeV3() {
  return lock(async () => {
    if (localStorage.getItem(KEY) === null)
      localStorage.setItem(KEY, JSON.stringify({ schemaVersion: 4, projects: [] }));
    const raw = JSON.parse(localStorage.getItem(KEY)!);
    if (raw.schemaVersion !== 4 || !Array.isArray(raw.projects) ||
      Object.keys(raw).some((key) => !["schemaVersion", "projects"].includes(key)))
      throw new Error("Повреждённый каталог v4. Данные не изменены.");
    const cleaned = raw.projects.map((project: ProjectDocumentV4) => cleanV4Document(project));
    if (JSON.stringify(cleaned) !== JSON.stringify(raw.projects)) {
      cleaned.forEach(parseV4);
      localStorage.setItem(KEY, JSON.stringify({ schemaVersion: 4, projects: cleaned }));
    }
    const rows = readV3();
    for (const key of OLD_KEYS) localStorage.removeItem(key);
    return rows;
  });
}
export type SaveOutcome =
  | { status: "saved"; document: ProjectDocumentV4 }
  | { status: "skipped" };
export function saveV3(
  doc: ProjectDocumentV4,
  expected: number | null,
): Promise<ProjectDocumentV4>;
export function saveV3(
  doc: ProjectDocumentV4,
  expected: number | null,
  isCurrent: () => boolean,
): Promise<SaveOutcome>;
export async function saveV3(
  doc: ProjectDocumentV4,
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
        "Конфликт: проект изменён в другой вкладке. Загрузите сохранённую версию.",
      );
    const next = parseV4({
      ...doc,
      documentRevision: expected === null ? 0 : expected + 1,
    });
    localStorage.setItem(
      KEY,
      JSON.stringify({
        schemaVersion: 4,
        projects: old
          ? rows.map((x) => (x.id === doc.id ? next : x))
          : [...rows, next],
      }),
    );
    return isCurrent ? { status: "saved" as const, document: next } : next;
  });
}
export async function importV3(file: File, current?: ProjectDocumentV4) {
  if (file.size > 2 * 1024 * 1024) throw new Error("Файл больше 2 МиБ.");
  const v = JSON.parse(await file.text());
  if (v.format !== undefined || v.version !== undefined) {
    if (v.format !== "plitka-project") throw new Error("Неизвестный формат.");
    if (v.version === 4) return parseV4(v.project);
    throw new Error("Неизвестная версия файла.");
  }
  throw new Error("Файлы старой модели не импортируются.");
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
    localStorage.setItem(KEY, JSON.stringify({ schemaVersion: 4, projects: remaining }));
    return { status: 'deleted', projectId, projects: remaining };
  });
}
export const readV4 = readV3;
export const initializeV4 = initializeV3;
export const saveV4 = saveV3;
export const importV4 = importV3;
export const deleteV4 = deleteV3;
