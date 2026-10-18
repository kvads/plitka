import { formatPlanLength } from "../../domain/plan/format-length";
import { angleGeometry, type AngleTarget } from "../../domain/plan/angles";
import type { GraphSnapshot } from "../../domain/plan/types";
export default function DimensionOverlay({
  graph,
  scale,
  selectedSegment,
  angle,
  anglePair,
  activeTarget,
  onSector,
}: {
  graph: GraphSnapshot;
  scale: number;
  selectedSegment: string;
  anglePair?: Omit<AngleTarget, "sector">;
  activeTarget?: string;
  onSector?: (sector: "cw" | "ccw") => void;
  angle?: {
    vertexId: string;
    first: string;
    second: string;
    sector: "cw" | "ccw";
  };
}) {
  const vertices = new Map(graph.vertices.map((v) => [v.id, v]));
  const sectors = anglePair
    ? (["ccw", "cw"] as const)
    : angle
      ? [angle.sector]
      : [];
  const arc = sectors.map((sector) => {
    const target = anglePair
      ? { ...anglePair, sector }
      : angle
        ? {
            vertexId: angle.vertexId,
            firstSegmentId: angle.first,
            secondSegmentId: angle.second,
            sector,
          }
        : null;
    const geometry = target && angleGeometry(graph, target, 32 / scale);
    if (!geometry) return null;
    return (
      <g
        key={sector}
        data-target={anglePair ? "arc:" + sector : undefined}
        role={anglePair ? "button" : undefined}
        tabIndex={
          anglePair ? (activeTarget === "arc:" + sector ? 0 : -1) : undefined
        }
        aria-label={
          anglePair
            ? sector === "ccw"
              ? "Дуга против часовой стрелки"
              : "Дуга по часовой стрелке"
            : undefined
        }
        onKeyDown={(e) => {
          if (anglePair && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            e.stopPropagation();
            onSector?.(sector);
          }
        }}
      >
        <path
          d={geometry.path}
          fill="none"
          stroke="#555"
          strokeWidth={2 / scale}
        />
        {anglePair && (
          <path
            d={geometry.path}
            fill="none"
            stroke="transparent"
            strokeWidth={20 / scale}
            pointerEvents="stroke"
          />
        )}
        <text
          transform={`translate(${geometry.x},${geometry.y}) scale(1,-1)`}
          textAnchor="middle"
          fontSize={12 / scale}
          stroke="#fff"
          strokeWidth={3 / scale}
          paintOrder="stroke"
        >
          {geometry.value.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}°
        </text>
      </g>
    );
  });
  return (
    <g pointerEvents="none" fill="#333">
      {graph.segments.map((s) => {
        const a = vertices.get(s.startVertexId)!,
          b = vertices.get(s.endVertexId)!,
          length = Math.hypot(b.x - a.x, b.y - a.y);
        if (length * scale < 50) return null;
        const x = (a.x + b.x) / 2,
          y = (a.y + b.y) / 2;
        return (
          <g key={s.id}>
            <text
              transform={`translate(${x},${y}) scale(1,-1)`}
              dy={-9 / scale}
              textAnchor="middle"
              fontSize={12 / scale}
              stroke="#fff"
              strokeWidth={3 / scale}
              paintOrder="stroke"
            >
              {formatPlanLength(length)}
            </text>
            {s.id === selectedSegment && (
              <path
                d={`M ${x - 10 / scale} ${y - 5 / scale} L ${x} ${y} L ${x - 10 / scale} ${y + 5 / scale}`}
                transform={`rotate(${(Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI} ${x} ${y})`}
                fill="none"
                stroke="#555"
                strokeWidth={2 / scale}
              />
            )}
          </g>
        );
      })}
      {arc}
    </g>
  );
}
