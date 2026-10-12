import { useLayoutEffect, useRef, useState } from "react";
import type { GeometrySnapshot, Contour } from "../../domain/room/types";
import { snap } from "../../domain/room/snapping";
import { worldPoint } from "../../domain/room/viewport";
import type { ProjectDocument } from "../../domain/project/schema";
export default function RoomCanvas({
  geometry,
  viewport,
  active,
  selected,
  draw,
  onPoint,
  onMove,
  onWall,
  onViewport,
  issues,
}: {
  geometry: GeometrySnapshot;
  viewport: ProjectDocument["viewport"];
  active: Contour;
  selected: string;
  draw: boolean;
  onPoint: (x: number, y: number) => void;
  onMove: (id: string, x: number, y: number) => void;
  onWall: (id: string) => void;
  onViewport: (v: ProjectDocument["viewport"]) => void;
  issues: string[];
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [preview, setPreview] = useState<{
    x: number;
    y: number;
    type: string;
  } | null>(null);
  const drag = useRef<string | null>(null);
  const pan = useRef<{ x: number; y: number; cx: number; cy: number } | null>(
    null,
  );
  const [panning, setPanning] = useState(false);
  const [panViewport, setPanViewport] = useState<
    ProjectDocument["viewport"] | null
  >(null);
  const view = panViewport ?? viewport;
  const [screenScale, setScreenScale] = useState(0.1);
  useLayoutEffect(() => {
    const el = svg.current;
    if (!el) return;
    const update = () => setScreenScale(Math.abs(el.getScreenCTM()?.a || 0.1));
    const observer = new ResizeObserver(update);
    observer.observe(el);
    update();
    return () => observer.disconnect();
  }, [viewport.zoom]);
  const px = (n: number) => n / screenScale;
  const w = 6000 / viewport.zoom,
    h = 4400 / viewport.zoom;
  const step = viewport.gridStepMm;
  function point(e: React.PointerEvent<SVGSVGElement>) {
    const p = worldPoint(e.currentTarget, e.clientX, e.clientY);
    const scale = e.currentTarget.getScreenCTM()?.a || 1;
    return snap(p.x, p.y, step, (e.pointerType === "mouse" ? 8 : 12) / scale);
  }
  return (
    <div className="room-board">
      <div className="canvas-toolbar">
        <button
          onClick={() =>
            onViewport({
              ...viewport,
              zoom: Math.max(0.5, viewport.zoom - 0.25),
            })
          }
          aria-label="Уменьшить"
        >
          −
        </button>
        <span>{Math.round(viewport.zoom * 100)}%</span>
        <button
          onClick={() =>
            onViewport({ ...viewport, zoom: Math.min(3, viewport.zoom + 0.25) })
          }
          aria-label="Увеличить"
        >
          +
        </button>
        <button aria-pressed={panning} onClick={() => setPanning(!panning)}>
          Перемещать полотно
        </button>
        {panning && (
          <div className="pan-controls">
            {[
              ["Влево", -500, 0],
              ["Вправо", 500, 0],
              ["Вверх", 0, 500],
              ["Вниз", 0, -500],
            ].map(([label, dx, dy]) => (
              <button
                key={label}
                onClick={() =>
                  onViewport({
                    ...viewport,
                    centerX: viewport.centerX + Number(dx) / viewport.zoom,
                    centerY: viewport.centerY + Number(dy) / viewport.zoom,
                  })
                }
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <label>
          Шаг сетки{" "}
          <select
            aria-label="Шаг сетки"
            value={step}
            onChange={(e) =>
              onViewport({ ...viewport, gridStepMm: +e.target.value })
            }
          >
            {[50, 100, 200, 500].map((n) => (
              <option key={n} value={n}>
                {n} мм
              </option>
            ))}
          </select>
        </label>
      </div>
      <svg
        ref={svg}
        className="room-canvas"
        aria-label="Редактор помещения"
        viewBox={`${view.centerX - w / 2} ${-view.centerY - h / 2} ${w} ${h}`}
        onPointerDown={(e) => {
          if (panning) {
            const p = worldPoint(e.currentTarget, e.clientX, e.clientY);
            pan.current = { ...p, cx: viewport.centerX, cy: viewport.centerY };
            e.currentTarget.setPointerCapture(e.pointerId);
          } else if (draw && !drag.current) {
            const p = point(e);
            onPoint(p.x, p.y);
          }
        }}
        onPointerMove={(e) => {
          const p = point(e);
          setPreview(p);
          if (pan.current) {
            const raw = worldPoint(e.currentTarget, e.clientX, e.clientY);
            setPanViewport({
              ...view,
              centerX: view.centerX + pan.current.x - raw.x,
              centerY: view.centerY + pan.current.y - raw.y,
            });
          }
        }}
        onPointerUp={(e) => {
          if (drag.current) {
            const p = point(e);
            onMove(drag.current, p.x, p.y);
            drag.current = null;
          }
          if (pan.current && panViewport) onViewport(panViewport);
          setPanViewport(null);
          pan.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
          pan.current = null;
          setPreview(null);
          setPanViewport(null);
        }}
      >
        <defs>
          <pattern
            id="room-grid"
            width={step}
            height={step}
            patternUnits="userSpaceOnUse"
          >
            <path
              d={`M ${step} 0 L 0 0 0 ${step}`}
              fill="none"
              stroke="#cfdbd5"
              strokeWidth={px(0.7)}
            />
            <circle cx="0" cy="0" r={px(1.4)} fill="#829f90" />
          </pattern>
          <marker
            id="wall-arrow"
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="4"
            orient="auto"
          >
            <path d="M0,0 L8,4 L0,8" fill="#187365" />
          </marker>
        </defs>
        <rect
          x={view.centerX - w / 2}
          y={-view.centerY - h / 2}
          width={w}
          height={h}
          fill="url(#room-grid)"
        />
        {[geometry.outer, ...geometry.holes].map((c) => (
          <g key={c.id}>
            <polygon
              points={c.vertices.map((v) => `${v.x},${-v.y}`).join(" ")}
              fill={
                c.closed ? (c.kind === "hole" ? "#fff" : "#b7d3c12b") : "none"
              }
            />
            {c.walls.map((wall, i) => {
              const a = c.vertices[i],
                b = c.vertices[(i + 1) % c.vertices.length];
              return (
                <g key={wall.id}>
                  <line
                    x1={a.x}
                    y1={-a.y}
                    x2={b.x}
                    y2={-b.y}
                    stroke={
                      issues.includes(wall.id)
                        ? "#b24b37"
                        : selected === wall.id
                          ? "#187365"
                          : "#536d64"
                    }
                    strokeWidth={px(selected === wall.id ? 3 : 1.5)}
                    markerEnd={
                      selected === wall.id ? "url(#wall-arrow)" : undefined
                    }
                  />
                  <line
                    data-wall-id={wall.id}
                    x1={a.x}
                    y1={-a.y}
                    x2={b.x}
                    y2={-b.y}
                    stroke="transparent"
                    strokeWidth={px(24)}
                    onPointerDown={(e) => {
                      if (!draw) {
                        e.stopPropagation();
                        onWall(wall.id);
                      }
                    }}
                  />
                  <text
                    x={(a.x + b.x) / 2}
                    y={-(a.y + b.y) / 2 - px(10)}
                    fontSize={px(12)}
                    textAnchor="middle"
                  >
                    {i + 1}
                  </text>
                </g>
              );
            })}
            {c.vertices.map((v) => (
              <circle
                key={v.id}
                data-vertex-id={v.id}
                cx={drag.current === v.id && preview ? preview.x : v.x}
                cy={drag.current === v.id && preview ? -preview.y : -v.y}
                r={px(4)}
                stroke="transparent"
                strokeWidth={px(20)}
                pointerEvents="all"
                fill={c.id === active.id ? "#187365" : "#879c93"}
                onPointerDown={(e) => {
                  if (!draw && !panning) {
                    e.stopPropagation();
                    drag.current = v.id;
                    svg.current?.setPointerCapture(e.pointerId);
                  }
                }}
              />
            ))}
          </g>
        ))}
        {preview && (
          <circle cx={preview.x} cy={-preview.y} r={px(4)} fill="#ce894b" />
        )}
      </svg>
      <div className="canvas-caption">
        {preview
          ? `${preview.type} · ${preview.x.toFixed(1)}, ${preview.y.toFixed(1)} мм`
          : "Выберите стену или вершину"}
        {draw ? " · Нажимайте, чтобы добавлять вершины" : ""}
      </div>
    </div>
  );
}
