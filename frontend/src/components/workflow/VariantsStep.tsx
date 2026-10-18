import { useState, useRef } from "react";
import type { ResultSet } from "../../domain/project/results";
import type { Layout } from "../../types";
import { path, format as f } from "../../types";
import NumberField from "./NumberField";
export default function VariantsStep({
  result,
  busy,
  error,
  onChoose,
  onShift,
  onLock,
  onCancel,
  onExport,
}: {
  result: ResultSet;
  busy: boolean;
  error: string;
  onChoose: (l: Layout, i: number) => void;
  onShift: (x: number, y: number) => void;
  onLock: () => void;
  onCancel: () => void;
  onExport: (kind: "svg" | "csv") => void;
}) {
  const l = result.acceptedPlacement,
    [selectedId, setSelected] = useState<string | null>(null),
    [zoom, setZoom] = useState(1),
    [details, setDetails] = useState(false),
    [move, setMove] = useState(false);
  const selected = l.parts.find((p) => p.id === selectedId);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const pts = l.parts.flatMap((p) => p.rings.flat()),
    xs = pts.map((p) => p[0]),
    ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs),
    minY = Math.min(...ys),
    w = Math.max(...xs) - minX + 400,
    h = Math.max(...ys) - minY + 400;
  const pending = result.pendingPlacement;
  const blocked = busy || !!pending || !!error;
  return (
    <div className="variants-stage">
      <div className="variant-list">
        {result.variants.map((v, i) => (
          <button
            className={
              "variant " + (i === result.selectedVariantId ? "active" : "")
            }
            key={i}
            disabled={result.locked || busy}
            onClick={() => onChoose(v, i)}
          >
            <strong>{v.title || "Вариант " + (i + 1)}</strong>
            <span>
              {v.metrics.tiles} плиток · мин. {f(v.metrics.min_width, 1)} мм
            </span>
          </button>
        ))}
      </div>
      <div className="room-tools">
        <button onClick={() => setDetails(!details)}>
          {details ? "План" : "Детали"}
        </button>
        <button onClick={() => setMove(!move)} aria-pressed={move}>
          Сдвиг перетаскиванием
        </button>
        <button disabled={busy} onClick={onLock}>
          {result.locked ? "Разблокировать" : "Закрепить раскладку"}
        </button>
        <button disabled={blocked} onClick={() => onExport("svg")}>
          План с размерами · SVG
        </button>
        <button disabled={blocked} onClick={() => onExport("csv")}>
          Таблица деталей · CSV
        </button>
      </div>
      {!details ? (
        <div className="drawing">
          <svg
            aria-label="Интерактивный план раскладки"
            data-layout={JSON.stringify({ parts: l.parts, metrics: l.metrics })}
            viewBox={`${minX - 200 + (w - w / zoom) / 2} ${minY - 200 + (h - h / zoom) / 2} ${w / zoom} ${h / zoom}`}
            onPointerDown={(e) => {
              if (!move || result.locked) return;
              const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(
                e.currentTarget.getScreenCTM()!.inverse(),
              );
              drag.current = { x: p.x, y: p.y };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerUp={(e) => {
              if (!drag.current) return;
              const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(
                  e.currentTarget.getScreenCTM()!.inverse(),
                ),
                r = (l.angle * Math.PI) / 180,
                dx = p.x - drag.current.x,
                dy = p.y - drag.current.y;
              drag.current = null;
              onShift(
                l.offset_x + dx * Math.cos(r) + dy * Math.sin(r),
                l.offset_y - dx * Math.sin(r) + dy * Math.cos(r),
              );
            }}
            onPointerCancel={() => {
              drag.current = null;
            }}
          >
            {l.parts.map((p) => (
              <path
                key={p.id}
                className="tile"
                d={path(p.rings)}
                fill={
                  p.issues.length ? "#edc590" : p.full ? "#e0e9e4" : "#a7c9bb"
                }
                stroke="#6b897c"
                strokeWidth={selected?.id === p.id ? 10 : 2}
                fillRule="evenodd"
                onClick={() => !move && setSelected(p.id)}
              >
                <title>
                  {p.id}: {f(p.width, 1)} × {f(p.height, 1)}
                </title>
              </path>
            ))}
          </svg>
          <div className="zoom">
            <button
              aria-label="Уменьшить"
              onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
            >
              −
            </button>
            <span>{zoom * 100}%</span>
            <button
              aria-label="Увеличить"
              onClick={() => setZoom((z) => Math.min(3, z + 0.25))}
            >
              +
            </button>
          </div>
          {selected && (
            <div className="detail-popover">
              <button
                aria-label="Закрыть деталь"
                onClick={() => setSelected(null)}
              >
                ×
              </button>
              <strong>Деталь {selected.id}</strong>
              <p>
                {f(selected.width, 1)} × {f(selected.height, 1)} мм
              </p>
              <p>Минимальная ширина {f(selected.min_width, 1)} мм</p>
              <p>{selected.issues.join(" · ") || "Без предупреждений"}</p>
            </div>
          )}
        </div>
      ) : (
        <div className="details-table">
          <table>
            <thead>
              <tr>
                <th>Деталь</th>
                <th>Размер, мм</th>
                <th>Площадь, мм²</th>
                <th>Проверка</th>
              </tr>
            </thead>
            <tbody>
              {l.parts.map((p) => (
                <tr key={p.id}>
                  <td>{p.id}</td>
                  <td>
                    {f(p.width, 1)} × {f(p.height, 1)}
                  </td>
                  <td>{f(p.area, 3)}</td>
                  <td>{p.issues.join(" · ") || "Без замечаний"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="offset">
        <NumberField
          label="По X"
          value={pending?.x ?? l.offset_x}
          disabled={result.locked || busy}
          onCommit={(n) => {
            if (n !== null) onShift(n, pending?.y ?? l.offset_y);
          }}
        />
        <NumberField
          label="По Y"
          value={pending?.y ?? l.offset_y}
          disabled={result.locked || busy}
          onCommit={(n) => {
            if (n !== null) onShift(pending?.x ?? l.offset_x, n);
          }}
        />
        {pending && (
          <>
            <button
              disabled={busy}
              onClick={() => onShift(pending.x, pending.y)}
            >
              Повторить сдвиг
            </button>
            <button onClick={onCancel}>Отменить сдвиг</button>
          </>
        )}
      </div>
      <div className="stats">
        {[
          ["Площадь комнаты", f(l.metrics.room_area, 1) + " мм²"],
          ["Исходных плиток", l.metrics.tiles],
          ["Целых плиток", l.metrics.full],
          ["Площадь швов", f(l.metrics.grout_area, 1) + " мм²"],
          ["Подрезанных плиток", l.metrics.cut],
          ["Отходы материала", f(l.metrics.waste_percent, 1) + "%"],
          ["Деталей с замечаниями", l.metrics.warnings],
          ["Минимальная ширина", f(l.metrics.min_width, 1) + " мм"],
          ["Площадь покрытия", f(l.metrics.covered_area, 1) + " мм²"],
          [
            "Разница краёв",
            l.metrics.symmetry === null
              ? "Не применимо"
              : f(l.metrics.symmetry, 1) + " мм",
          ],
        ].map(([k, v]) => (
          <div key={k}>
            <span>{k}</span>
            <strong>{v}</strong>
          </div>
        ))}
      </div>
      <p className="footnote">
        Без повторного использования обрезков. Проверьте детали сложной формы
        перед резкой.
      </p>
    </div>
  );
}
