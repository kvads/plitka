import type { Tool } from "./ProjectCanvas";
import { MousePointer2, Hand, ScanSearch, BrickWall } from "lucide-react";
import SidebarIconButton from "./SidebarIconButton";
const tools = [
  { id: "select", name: "Выбрать", icon: MousePointer2 },
  { id: "wall", name: "Стена", icon: BrickWall },
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
