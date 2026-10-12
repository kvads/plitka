import { measurements } from "../../domain/room/measurements";
import { normalizeOrientation } from "../../domain/room/dimensions";
import type {
  Contour,
  GeometrySnapshot,
  Operation,
  ValidationResult,
} from "../../domain/room/types";
import NumberField from "../workflow/NumberField";
export default function WallInspector({
  g,
  c,
  wallId,
  validation,
  onSelect,
  onOperation,
  onRaw,
}: {
  g: GeometrySnapshot;
  c: Contour;
  wallId: string;
  validation: ValidationResult | null;
  onSelect: (id: string) => void;
  onOperation: (op: Operation) => void;
  onRaw: (key: string, text: string | null) => void;
}) {
  const wall = c.walls.find((w) => w.id === wallId) || c.walls[0];
  if (!wall) return <p>Добавьте минимум две вершины.</p>;
  const i = c.walls.indexOf(wall),
    a = c.vertices[i],
    b = c.vertices[(i + 1) % c.vertices.length];
  const m = (validation?.measurements ?? measurements(g)).find(
    (m) => m.wallId === wall.id,
  );
  function field(
    kind: "length" | "interiorAngle",
    label: string,
    value: number,
    min: number,
    max: number,
  ) {
    const con = g.constraints.find(
      (x) => x.wallId === wall.id && x.kind === kind && x.fixed,
    );
    const key = wall.id + ":" + kind;
    return (
      <div>
        <NumberField
          commitUnchanged
          label={label}
          value={con?.value ?? Math.round(value * 10) / 10}
          raw={g.fieldInputs[key]}
          min={min}
          max={max}
          unit={kind === "length" ? "мм" : "°"}
          onCommit={(n, t) => {
            if (n === null) {
              onRaw(key, t);
              return;
            }
            onOperation({
              type: kind === "length" ? "setLength" : "setInteriorAngle",
              wallId: wall!.id,
              value: n,
            });
          }}
        />
        <small>
          {con ? "Введено · зафиксировано" : "Вычислено по рисунку"}
        </small>
        {con && (
          <button
            onClick={() =>
              onOperation({ type: "releaseConstraint", constraintId: con.id })
            }
          >
            Снять фиксацию {kind === "length" ? "длины" : "угла"}
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="wall-inspector">
      <label>
        Стена
        <select
          aria-label="Стена"
          value={wall.id}
          onChange={(e) => onSelect(e.target.value)}
        >
          {c.walls.map((w, n) => (
            <option key={w.id} value={w.id}>
              Стена {n + 1}: {n + 1} → {((n + 1) % c.vertices.length) + 1}
            </option>
          ))}
        </select>
      </label>
      <p>
        Начало ({a.x.toFixed(1)}; {a.y.toFixed(1)}) → конец ({b.x.toFixed(1)};{" "}
        {b.y.toFixed(1)})
      </p>
      {field(
        "length",
        "Длина стены",
        m?.length ?? Math.hypot(b.x - a.x, b.y - a.y),
        0.1,
        200000,
      )}
      {(c.closed || i + 2 < c.vertices.length) &&
        field(
          "interiorAngle",
          "Внутренний угол",
          m?.interiorAngle ?? 90,
          0.1,
          359.9,
        )}
      {i === 0 && (
        <>
          <NumberField
            commitUnchanged
            label="Направление первой стены"
            raw={g.fieldInputs[wall.id + ":firstWallOrientation"]}
            value={
              g.constraints.find(
                (x) =>
                  x.wallId === wall.id &&
                  x.kind === "firstWallOrientation" &&
                  x.fixed,
              )?.value ??
              m?.orientation ??
              0
            }
            min={-360}
            max={360}
            unit="°"
            onCommit={(n, t) =>
              n === null
                ? onRaw(wall.id + ":firstWallOrientation", t)
                : onOperation({
                    type: "setOrientation",
                    contourId: c.id,
                    value: normalizeOrientation(n),
                  })
            }
          />
          {g.constraints
            .filter(
              (x) =>
                x.wallId === wall.id &&
                x.kind === "firstWallOrientation" &&
                x.fixed,
            )
            .map((x) => (
              <button
                key={x.id}
                onClick={() =>
                  onOperation({ type: "releaseConstraint", constraintId: x.id })
                }
              >
                Снять фиксацию направления
              </button>
            ))}
        </>
      )}
    </div>
  );
}
