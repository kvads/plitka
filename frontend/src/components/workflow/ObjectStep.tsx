import { useState } from "react";
import type { ProjectDocument } from "../../domain/project/schema";
import type {
  GeometrySnapshot,
  Operation,
  ValidationResult,
} from "../../domain/room/types";
import {
  contour,
  rebuild,
  replaceContour,
  uid,
} from "../../domain/room/commands";
import { acknowledgment } from "../../domain/project/keys";
import RoomCanvas from "../room/RoomCanvas";
import WallInspector from "../room/WallInspector";
import GeometryIssues from "../room/GeometryIssues";
import MeasurementsApproval from "../room/MeasurementsApproval";
export default function ObjectStep({
  doc,
  validation,
  busy,
  onGeometry,
  onOperation,
  onViewport,
  onApprove,
  onConfirm,
  onUndo,
  onDiscard,
  onRetry,
}: {
  doc: ProjectDocument;
  validation: ValidationResult | null;
  busy: boolean;
  onGeometry: (g: GeometrySnapshot) => void;
  onOperation: (op: Operation) => void;
  onViewport: (v: ProjectDocument["viewport"]) => void;
  onApprove: () => void;
  onConfirm: () => void;
  onUndo: () => void;
  onDiscard: () => void;
  onRetry: () => void;
}) {
  const g = doc.room.draft;
  const [cid, setCid] = useState(g.outer.id),
    [wid, setWid] = useState(""),
    [draw, setDraw] = useState(false);
  const c = [g.outer, ...g.holes].find((c) => c.id === cid) || g.outer;
  const approval = validation
    ? acknowledgment(g, validation.measurements)
    : null;
  function selectWall(id: string) {
    const found = [g.outer, ...g.holes].find((c) =>
      c.walls.some((w) => w.id === id),
    );
    if (found) setCid(found.id);
    setWid(id);
  }
  function add(x: number, y: number) {
    if (c.vertices.length >= 100 || c.closed) return;
    onGeometry(
      replaceContour(
        g,
        rebuild({ ...c, vertices: [...c.vertices, { id: uid(), x, y }] }),
      ),
    );
  }
  function shape(l = false) {
    const outer = contour(
      l
        ? [
            [0, 0],
            [4200, 0],
            [4200, 2100],
            [2700, 2100],
            [2700, 3600],
            [0, 3600],
          ]
        : [
            [0, 0],
            [4200, 0],
            [4200, 3600],
            [0, 3600],
          ],
    );
    onGeometry({ outer, holes: [], constraints: [], fieldInputs: {} });
    setCid(outer.id);
    setWid("");
    setDraw(false);
  }
  return (
    <>
      <div className="room-tools">
        <button onClick={() => shape()}>Прямоугольник</button>
        <button onClick={() => shape(true)}>Г-образное</button>
        <button
          onClick={() => {
            const outer = contour([], "outer", false);
            onGeometry({ outer, holes: [], constraints: [], fieldInputs: {} });
            setCid(outer.id);
            setDraw(true);
          }}
        >
          Нарисовать контур
        </button>
        <button
          disabled={g.holes.length >= 20}
          onClick={() => {
            const h = contour([], "hole", false);
            onGeometry({ ...g, holes: [...g.holes, h] });
            setCid(h.id);
            setDraw(true);
          }}
        >
          Добавить отверстие
        </button>
        <button onClick={onUndo}>Отменить правку</button>
        <button onClick={onDiscard}>Отказаться от черновика</button>
      </div>
      <div className="room-grid-layout">
        <div>
          <RoomCanvas
            geometry={g}
            viewport={doc.viewport}
            active={c}
            selected={wid || c.walls[0]?.id || ""}
            draw={draw && !c.closed}
            onPoint={add}
            onMove={(id, x, y) =>
              onOperation({ type: "moveVertex", vertexId: id, x, y })
            }
            onWall={selectWall}
            onViewport={onViewport}
            issues={validation?.issues.flatMap((x) => x.wallIds) || []}
          />
          <GeometryIssues validation={validation} onSelect={selectWall} />
          {busy && <p role="status">Проверяем геометрию…</p>}
          <p className="room-area">
            Площадь помещения:{" "}
            <strong>
              {validation?.areaMm2 !== null && validation?.areaMm2 !== undefined
                ? validation.areaMm2.toLocaleString("ru-RU", {
                    maximumFractionDigits: 1,
                  })
                : "—"}{" "}
              мм²
            </strong>
          </p>
        </div>
        <aside className="room-sidebar">
          <label>
            Контур
            <select
              aria-label="Контур"
              value={c.id}
              onChange={(e) => {
                setCid(e.target.value);
                setWid("");
              }}
            >
              {[g.outer, ...g.holes].map((x, i) => (
                <option key={x.id} value={x.id}>
                  {i ? "Отверстие " + i : "Контур комнаты"}
                </option>
              ))}
            </select>
          </label>
          {c.kind === "hole" && (
            <button
              onClick={() => {
                const ids = new Set(c.walls.map((w) => w.id));
                const removed = [...ids, ...c.vertices.map((v) => v.id)];
                onGeometry({
                  ...g,
                  holes: g.holes.filter((h) => h.id !== c.id),
                  fieldInputs: Object.fromEntries(
                    Object.entries(g.fieldInputs).filter(
                      ([key]) =>
                        !removed.some((id) => key.startsWith(id + ":")),
                    ),
                  ),
                  constraints: g.constraints.filter((x) => !ids.has(x.wallId)),
                });
                setCid(g.outer.id);
              }}
            >
              Удалить отверстие и его условия
            </button>
          )}
          {!c.closed && (
            <>
              <button
                disabled={c.vertices.length < 3}
                onClick={() => {
                  onGeometry(
                    replaceContour(g, rebuild({ ...c, closed: true })),
                  );
                  setDraw(false);
                }}
              >
                Замкнуть ({c.vertices.length})
              </button>
              <button
                onClick={() =>
                  onGeometry(
                    replaceContour(g, {
                      ...c,
                      winding: c.winding === "ccw" ? "cw" : "ccw",
                    }),
                  )
                }
              >
                Сторона углов: {c.winding === "ccw" ? "слева" : "справа"}
              </button>
            </>
          )}
          <WallInspector
            g={g}
            c={c}
            wallId={wid}
            validation={validation}
            onSelect={setWid}
            onOperation={onOperation}
            onRaw={(key, text) =>
              onGeometry({
                ...g,
                fieldInputs: { ...g.fieldInputs, [key]: text || "" },
              })
            }
          />
        </aside>
      </div>
      {doc.room.pendingEdit && (
        <button onClick={onRetry} disabled={busy}>
          Повторить согласование
        </button>
      )}
      {validation?.status === "valid" && !doc.room.pendingEdit && approval && (
        <>
          <MeasurementsApproval
            geometry={g}
            value={approval}
            approved={
              doc.room.acknowledgment?.measurementKey ===
              approval.measurementKey
            }
            onApprove={onApprove}
          />
          <button
            className="dark"
            disabled={
              busy ||
              (approval.entries.length > 0 &&
                doc.room.acknowledgment?.measurementKey !==
                  approval.measurementKey)
            }
            onClick={onConfirm}
          >
            Подтвердить помещение
          </button>
        </>
      )}
    </>
  );
}
