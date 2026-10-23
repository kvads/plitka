import { cleanV4Document, parseV4, parseV5, parseV6 } from "./schema";
import { parseV6Import } from "./migration";
import type { ProjectDocumentV4, ProjectDocumentV5, ProjectDocumentV6 } from "./types";
const OLD_KEY = "plitka-projects-v4";
export const KEY = "plitka-projects-v5";
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
  const raw = localStorage.getItem(OLD_KEY);
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
    if (localStorage.getItem(OLD_KEY) === null)
      localStorage.setItem(OLD_KEY, JSON.stringify({ schemaVersion: 4, projects: [] }));
    const raw = JSON.parse(localStorage.getItem(OLD_KEY)!);
    if (raw.schemaVersion !== 4 || !Array.isArray(raw.projects) ||
      Object.keys(raw).some((key) => !["schemaVersion", "projects"].includes(key)))
      throw new Error("Повреждённый каталог v4. Данные не изменены.");
    const cleaned = raw.projects.map((project: ProjectDocumentV4) => cleanV4Document(project));
    if (JSON.stringify(cleaned) !== JSON.stringify(raw.projects)) {
      cleaned.forEach(parseV4);
      localStorage.setItem(OLD_KEY, JSON.stringify({ schemaVersion: 4, projects: cleaned }));
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
      OLD_KEY,
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

export async function deleteV3(projectId: string, expectedRevision: number): Promise<
  | { status: 'deleted' | 'alreadyMissing'; projectId: string; projects: ProjectDocumentV4[] }
  | { status: 'conflict'; projectId: string; projects: ProjectDocumentV4[]; current: ProjectDocumentV4 }
> {
  if (!projectId.trim() || !Number.isInteger(expectedRevision) || expectedRevision < 0)
    throw new Error('Некорректное подтверждение удаления проекта.');
  return lock(() => {
    const projects = readV3();
    const current = projects.find(p => p.id === projectId);
    if (!current) return { status: 'alreadyMissing', projectId, projects };
    if (current.documentRevision !== expectedRevision)
      return { status: 'conflict', projectId, projects, current };
    const remaining = projects.filter(p => p.id !== projectId);
    localStorage.setItem(OLD_KEY, JSON.stringify({ schemaVersion: 4, projects: remaining }));
    return { status: 'deleted', projectId, projects: remaining };
  });
}
export const readV4 = readV3;
export const initializeV4 = initializeV3;
export const saveV4 = saveV3;
export const importV4 = importV3;
export const deleteV4 = deleteV3;

const V5_OLD_KEYS = [...OLD_KEYS, OLD_KEY];
export function readV5(): ProjectDocumentV5[] {
  const raw = localStorage.getItem(KEY);
  if (raw === null) return [];
  const value = JSON.parse(raw);
  if (value.schemaVersion !== 5 || !Array.isArray(value.projects) ||
      Object.keys(value).some(k => !["schemaVersion", "projects"].includes(k)))
    throw new Error("Повреждённый каталог v5. Данные не изменены.");
  const rows: ProjectDocumentV5[] = value.projects.map(parseV5);
  if (new Set(rows.map(row => row.id)).size !== rows.length)
    throw new Error("Повтор проекта.");
  return rows;
}

export async function initializeV5(): Promise<ProjectDocumentV5[]> {
  return lock(() => {
    if (localStorage.getItem(KEY) === null)
      localStorage.setItem(KEY, JSON.stringify({ schemaVersion: 5, projects: [] }));
    const rows = readV5();
    for (const key of V5_OLD_KEYS) localStorage.removeItem(key);
    return rows;
  });
}

export function saveV5(doc: ProjectDocumentV5, expected: number | null): Promise<ProjectDocumentV5>;
export function saveV5(doc: ProjectDocumentV5, expected: number | null, isCurrent: () => boolean): Promise<{status:"saved";document:ProjectDocumentV5}|{status:"skipped"}>;
export async function saveV5(doc: ProjectDocumentV5, expected: number | null, isCurrent?: () => boolean) {
  if (isCurrent && !isCurrent()) return { status: "skipped" as const };
  return lock(() => {
    if (isCurrent && !isCurrent()) return { status: "skipped" as const };
    const rows = readV5();
    const old = rows.find(row => row.id === doc.id);
    if ((old?.documentRevision ?? null) !== expected)
      throw new Error("Конфликт: проект изменён в другой вкладке. Загрузите сохранённую версию.");
    const next = parseV5({ ...doc, documentRevision: expected === null ? 0 : expected + 1 });
    localStorage.setItem(KEY, JSON.stringify({ schemaVersion: 5,
      projects: old ? rows.map(row => row.id === doc.id ? next : row) : [...rows, next] }));
    return isCurrent ? { status: "saved" as const, document: next } : next;
  });
}

export async function importV5(file: File): Promise<ProjectDocumentV5> {
  if (file.size > 2 * 1024 * 1024) throw new Error("Файл больше 2 МиБ.");
  const value = JSON.parse(await file.text());
  if (value.format !== "plitka-project" || value.version !== 5)
    throw new Error("Файлы прежних версий не импортируются.");
  return parseV5(value.project);
}

export async function deleteV5(projectId: string, expectedRevision: number): Promise<import('./types').DeleteProjectOutcome> {
  if (!projectId.trim() || !Number.isInteger(expectedRevision) || expectedRevision < 0)
    throw new Error('Некорректное подтверждение удаления проекта.');
  return lock(() => {
    const projects = readV5();
    const current = projects.find(p => p.id === projectId);
    if (!current) return { status: 'alreadyMissing', projectId, projects };
    if (current.documentRevision !== expectedRevision)
      return { status: 'conflict', projectId, projects, current };
    const remaining = projects.filter(p => p.id !== projectId);
    localStorage.setItem(KEY, JSON.stringify({ schemaVersion: 5, projects: remaining }));
    return { status: 'deleted', projectId, projects: remaining };
  });
}

export const KEY_V6 = "plitka-projects-v6";
const V6_OLD_KEYS = [...V5_OLD_KEYS, KEY];
const V6_DATABASE_MIGRATED = "plitka-projects-v6-database-migrated";

class DatabaseUnavailable extends Error {}

function writeV6(projects: ProjectDocumentV6[]) {
  localStorage.setItem(KEY_V6, JSON.stringify({ schemaVersion: 6, projects }));
}

async function projectRequest(path = "", init?: RequestInit): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(`/api/projects${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new Error("Нет связи с сервером. Проект не сохранён.");
  }
  let value: unknown;
  try { value = await response.json(); } catch { value = null; }
  if (response.status === 503) throw new DatabaseUnavailable();
  if (response.status === 409)
    throw new Error("Конфликт: проект изменён в другой вкладке. Загрузите сохранённую версию.");
  if (!response.ok)
    throw new Error(`Сервер не сохранил проект (HTTP ${response.status}).`);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Сервер вернул некорректный ответ.");
  return value as Record<string, unknown>;
}

async function readDatabaseV6(): Promise<ProjectDocumentV6[]> {
  const value = await projectRequest();
  if (!Array.isArray(value.projects))
    throw new Error("Сервер вернул некорректный каталог проектов.");
  const rows = value.projects.map(parseV6);
  if (new Set(rows.map(row => row.id)).size !== rows.length)
    throw new Error("Сервер вернул повтор проекта.");
  return rows;
}

async function saveDatabaseV6(doc: ProjectDocumentV6, expected: number | null) {
  const value = await projectRequest(`/${encodeURIComponent(doc.id)}`, {
    method: "PUT",
    body: JSON.stringify({ document: doc, expectedRevision: expected }),
  });
  return parseV6(value.document);
}

export function readV6(): ProjectDocumentV6[] {
  const raw = localStorage.getItem(KEY_V6);
  if (raw === null) return [];
  const value = JSON.parse(raw) as Record<string, unknown>;
  if (value.schemaVersion !== 6 || !Array.isArray(value.projects) ||
      Object.keys(value).some(key => key !== "schemaVersion" && key !== "projects"))
    throw new Error("Повреждённый каталог v6. Данные не изменены.");
  const rows = value.projects.map(parseV6);
  if (new Set(rows.map(row => row.id)).size !== rows.length)
    throw new Error("Повтор проекта.");
  return rows;
}

export async function initializeV6(): Promise<ProjectDocumentV6[]> {
  return lock(async () => {
    if (localStorage.getItem(KEY_V6) === null) {
      writeV6([]);
      if (localStorage.getItem(KEY_V6) === null)
        throw new Error("Новый каталог не сохранён. Прежние проекты не удалены.");
    }
    const local = readV6();
    let rows: ProjectDocumentV6[];
    try {
      rows = await readDatabaseV6();
      // First database-backed launch migrates the browser catalog without
      // overwriting projects that may already have been created elsewhere.
      if (localStorage.getItem(V6_DATABASE_MIGRATED) !== "yes") {
        for (const document of local) {
          if (!rows.some(row => row.id === document.id)) {
            try {
              rows.push(await saveDatabaseV6({ ...document, documentRevision: 0 }, null));
            } catch (error) {
              if (!(error instanceof Error) || !error.message.startsWith("Конфликт:")) throw error;
              rows = await readDatabaseV6();
            }
          }
        }
        localStorage.setItem(V6_DATABASE_MIGRATED, "yes");
      }
      writeV6(rows);
    } catch (error) {
      if (!(error instanceof DatabaseUnavailable)) throw error;
      // Running without PGHOST remains supported for geometry development.
      rows = local;
    }
    // Each launch resumes a partially interrupted cleanup after validating v6.
    for (const key of V6_OLD_KEYS) localStorage.removeItem(key);
    return rows;
  });
}

export function saveV6(doc: ProjectDocumentV6, expected: number | null): Promise<ProjectDocumentV6>;
export function saveV6(doc: ProjectDocumentV6, expected: number | null,
                       isCurrent: () => boolean): Promise<{status:"saved";document:ProjectDocumentV6}|{status:"skipped"}>;
export async function saveV6(doc: ProjectDocumentV6, expected: number | null, isCurrent?: () => boolean) {
  if (isCurrent && !isCurrent()) return { status: "skipped" as const };
  return lock(async () => {
    if (isCurrent && !isCurrent()) return { status: "skipped" as const };
    const rows = readV6(), old = rows.find(row => row.id === doc.id);
    if ((old?.documentRevision ?? null) !== expected)
      throw new Error("Конфликт: проект изменён в другой вкладке. Загрузите сохранённую версию.");
    // A newer draft can be queued while the preceding database save is still
    // in flight.  It was derived from the previous in-memory revision, but its
    // CAS basis is the revision returned by that save.  Keep the document and
    // expected revision in sync before sending them to the server.
    const candidate = parseV6({ ...doc, documentRevision: expected ?? 0 });
    let next: ProjectDocumentV6;
    try {
      next = await saveDatabaseV6(candidate, expected);
    } catch (error) {
      if (!(error instanceof DatabaseUnavailable)) throw error;
      next = parseV6({ ...candidate, documentRevision: expected === null ? 0 : expected + 1 });
    }
    writeV6(old ? rows.map(row => row.id === doc.id ? next : row) : [...rows, next]);
    return isCurrent ? { status: "saved" as const, document: next } : next;
  });
}

export async function deleteV6(projectId: string, expectedRevision: number): Promise<
  | { status: 'deleted' | 'alreadyMissing'; projectId: string; projects: ProjectDocumentV6[] }
  | { status: 'conflict'; projectId: string; projects: ProjectDocumentV6[]; current: ProjectDocumentV6 }
> {
  if (!projectId.trim() || !Number.isInteger(expectedRevision) || expectedRevision < 0)
    throw new Error("Некорректное подтверждение удаления проекта.");
  return lock(async () => {
    const projects = readV6(), current = projects.find(row => row.id === projectId);
    if (!current) return { status: "alreadyMissing", projectId, projects };
    if (current.documentRevision !== expectedRevision)
      return { status: "conflict", projectId, projects, current };
    try {
      const value = await projectRequest(
        `/${encodeURIComponent(projectId)}?expectedRevision=${expectedRevision}`,
        { method: "DELETE" },
      );
      if (value.status === "alreadyMissing") {
        const remaining = projects.filter(row => row.id !== projectId);
        writeV6(remaining);
        return { status: "alreadyMissing", projectId, projects: remaining };
      }
      if (value.status !== "deleted")
        throw new Error("Сервер вернул некорректный результат удаления.");
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Конфликт:")) {
        const latest = await readDatabaseV6();
        writeV6(latest);
        const serverCurrent = latest.find(row => row.id === projectId);
        if (!serverCurrent) return { status: "alreadyMissing", projectId, projects: latest };
        return { status: "conflict", projectId, projects: latest, current: serverCurrent };
      }
      if (!(error instanceof DatabaseUnavailable)) throw error;
    }
    const remaining = projects.filter(row => row.id !== projectId);
    writeV6(remaining);
    return { status: "deleted", projectId, projects: remaining };
  });
}

export async function importV6(file: File): Promise<ProjectDocumentV6> {
  if (file.size > 2 * 1024 * 1024) throw new Error("Файл больше 2 МиБ.");
  return parseV6Import(JSON.parse(await file.text()));
}
