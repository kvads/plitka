import type { ProjectDocumentV5, ProjectDocumentV6 } from "../../domain/plan/types";
export default function ProjectMenu<D extends ProjectDocumentV5 | ProjectDocumentV6>({
  doc,
  onUpdate,
  onClear,
  onDelete,
  onRestore,
  onClose,
  embedded = false,
}: {
  doc: D;
  onUpdate: (fn: (d: D) => D) => unknown;
  onClear: () => void;
  onDelete: () => void;
  onRestore: () => void;
  onClose: () => void;
  embedded?: boolean;
}) {
  const download = () => {
    const payload = { format: "plitka-project", version: doc.schemaVersion, project: doc };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = `${doc.name.trim().replace(/[^\p{L}\p{N} _-]/gu, "_") || "project"}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(href), 1000);
  };
  return (
    <aside
      className="canvas-panel project-menu"
      style={embedded ? { position: "static", width: "auto", padding: 0,
        border: 0, boxShadow: "none", background: "transparent" } : undefined}
      data-overlay
      aria-label="Меню проекта"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="panel-heading">
        <h2>Проект</h2>
        <button aria-label="Закрыть меню проекта" onClick={onClose}>
          ×
        </button>
      </div>
      <label>
        Название проекта
        <input
          value={doc.name}
          maxLength={120}
          onChange={(e) => {
            if (e.target.value.trim())
              onUpdate((d) => ({ ...d, name: e.target.value }));
          }}
        />
      </label>
      <label>
        Адрес объекта
        <input
          value={doc.address}
          maxLength={300}
          onChange={(e) => onUpdate((d) => ({ ...d, address: e.target.value }))}
        />
      </label>
      {doc.plan.restorePoint && <button onClick={onRestore}>
        Вернуть план к сохранённому снимку
      </button>}
      {doc.schemaVersion === 6 && <button onClick={download}>Скачать проект</button>}
      <button className="danger" onClick={onClear}>
        Очистить проект
      </button>
      <button className="danger" onClick={onDelete}>Удалить проект</button>
    </aside>
  );
}
