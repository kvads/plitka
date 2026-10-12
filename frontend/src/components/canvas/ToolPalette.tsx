import type { Tool } from "./ProjectCanvas";
const tools: { id: Tool; name: string }[] = [
  { id: "select", name: "Выбрать" },
  { id: "addVertex", name: "Добавить вершину" },
  { id: "connect", name: "Соединить стены" },
  { id: "angle", name: "Угол" },
  { id: "move", name: "Переместить вершину" },
  { id: "pan", name: "Переместить полотно" },
  { id: "selectRoom", name: "Выбрать помещение" },
];
export default function ToolPalette({
  selected,
  onSelect,
}: {
  selected: Tool;
  onSelect: (tool: Tool) => void;
}) {
  return (
    <aside className="canvas-tools" data-overlay aria-label="Инструменты плана">
      {tools.map((t) => (
        <button
          key={t.id}
          aria-pressed={selected === t.id}
          onClick={() => onSelect(t.id)}
        >
          {t.name}
        </button>
      ))}
    </aside>
  );
}
