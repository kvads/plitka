import { parseDocument, type ProjectDocument } from "./schema";
import { createDocument, legacy } from "./migration";
export function download(
  name: string,
  data: string,
  type = "application/json",
) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function exportDocument(d: ProjectDocument) {
  download(
    "plitka-project.json",
    JSON.stringify(
      { format: "plitka-project", version: 2, project: parseDocument(d) },
      null,
      2,
    ),
  );
}
export async function importDocument(file: File, current?: ProjectDocument) {
  if (file.size > 2 * 1024 * 1024) throw new Error("Файл больше 2 МиБ.");
  const v = JSON.parse(await file.text());
  if (v.format !== undefined || v.version !== undefined) {
    if (v.format !== "plitka-project" || v.version !== 2)
      throw new Error("Неизвестная версия файла.");
    return parseDocument(v.project);
  }
  return createDocument(
    current?.name || "Импортированный проект",
    current?.address || "",
    legacy(v),
  );
}
