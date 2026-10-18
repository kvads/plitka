import type { ProjectDocumentV5 } from "../../domain/plan/types";
export default function ProjectMenu({
  doc,
  onUpdate,
  onClear,
  onDelete,
  onRestore,
  onClose,
}: {
  doc: ProjectDocumentV5;
  onUpdate: (fn: (d: ProjectDocumentV5) => ProjectDocumentV5) => unknown;
  onClear: () => void;
  onDelete: () => void;
  onRestore: () => void;
  onClose: () => void;
}) {
  return (
    <aside
      className="canvas-panel project-menu"
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
      <button className="danger" onClick={onClear}>
        Очистить проект
      </button>
      <button className="danger" onClick={onDelete}>Удалить проект</button>
    </aside>
  );
}
