import type { Tool } from "./ProjectCanvas";
import { MousePointer2, Plus, Waypoints, Ruler, Move, Hand, ScanSearch, BrickWall } from "lucide-react";
import SidebarIconButton from "./SidebarIconButton";
const tools = [
  { id: "select", name: "Выбрать", icon: MousePointer2 },
  { id: "addVertex", name: "Добавить вершину", icon: Plus },
  { id: "connect", name: "Соединить стены", icon: Waypoints },
  { id: "wall", name: "Стена", icon: BrickWall },
  { id: "angle", name: "Угол", icon: Ruler },
  { id: "move", name: "Переместить вершину", icon: Move },
  { id: "pan", name: "Переместить полотно", icon: Hand },
  { id: "selectRoom", name: "Выбрать помещение", icon: ScanSearch },
] as const;
export default function ToolPalette({
  selected,
  onSelect,
}: {
  selected: Tool;
  onSelect: (tool: Tool) => void;
}) {
  return (
    <div className="canvas-tools" role="toolbar" aria-label="Инструменты плана">
      {tools.map((t) => (
        <SidebarIconButton
          key={t.id}
          icon={t.icon}
          label={t.name}
          aria-pressed={selected === t.id}
          onClick={() => onSelect(t.id as Tool)}
        />
      ))}
    </div>
  );
}
