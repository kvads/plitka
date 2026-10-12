import { useState } from "react";
import {
  angleGeometry,
  matchingAngle,
  type AngleTarget,
} from "../../domain/plan/angles";
import NumberField from "../workflow/NumberField";
import {
  chainNodes,
  rangeSegments,
  type EditorContext,
  type ToolInteraction,
} from "../../domain/plan/editor-state";
import type {
  GraphSnapshot,
  GraphCommand,
  DimensionConstraint,
} from "../../domain/plan/types";
export default function ObjectContextPanel({
  context,
  interaction,
  graph,
  onCommand,
  onRaw,
  onRange,
  onDelete,
  onConstraint,
  children,
}: {
  context: EditorContext;
  interaction: ToolInteraction;
  graph: GraphSnapshot;
  onCommand: (c: GraphCommand, raw?: { key: string; text: string }) => void;
  onRaw: (key: string, text: string) => void;
  onRange: (chainId: string) => void;
  onDelete: () => void;
  onConstraint: (id: string) => void;
  children?: React.ReactNode;
}) {
  const [point, setPoint] = useState({ x: 0, y: 0 }),
    [rawPoint, setRawPoint] = useState({ x: "0", y: "0" });
  const g = graph,
    vs = new Map(g.vertices.map((v) => [v.id, v]));
  const length = (id: string) => {
    const s = g.segments.find((s) => s.id === id);
    if (!s) return 0;
    const a = vs.get(s.startVertexId)!,
      b = vs.get(s.endVertexId)!;
    return Math.hypot(b.x - a.x, b.y - a.y);
  };
  const condition = (kind: string, id: string) =>
    g.constraints.find(
      (c) =>
        c.kind === kind &&
        (c.target.segmentId === id ||
          (c.target.chainId === id && !c.target.range)),
    );
  const actions = (c: DimensionConstraint) => (
    <div key={c.id} className="condition">
      <button onClick={() => onConstraint(c.id)}>
        {c.kind === "orientation"
          ? "Направление"
          : c.kind === "angle"
            ? "Угол"
            : c.kind === "legacyUnbound"
              ? "Старое условие"
              : "Размер"}
        : {c.value} · {c.fixed ? "фиксирован" : "вычисляется"}
      </button>
      <button
        disabled={!c.fixed}
        onClick={() =>
          onCommand({ type: "releaseConstraint", constraintId: c.id })
        }
      >
        Снять фиксацию
      </button>
      <button
        onClick={() =>
          onCommand({ type: "deleteConstraint", constraintId: c.id })
        }
      >
        Удалить условие
      </button>
    </div>
  );
  const lengthField = (
    kind: "segment" | "chain",
    id: string,
    label: string,
    range?: { startVertexId: string; endVertexId: string },
  ) => {
    const c = range
      ? g.constraints.find(
          (c) =>
            c.kind === "chainLength" &&
            c.target.chainId === id &&
            c.target.range?.startVertexId === range.startVertexId &&
            c.target.range.endVertexId === range.endVertexId,
        )
      : condition(kind === "chain" ? "chainLength" : "segmentLength", id);
    const key = range
      ? `constraint:${c?.id || `${id}-${range.startVertexId}-${range.endVertexId}`}:length`
      : `${kind}:${id}:length`;
    const value = range
      ? rangeSegments(g, id, range.startVertexId, range.endVertexId).reduce(
          (a, id) => a + length(id),
          0,
        )
      : kind === "segment"
        ? length(id)
        : g.chains
            .find((ch) => ch.id === id)!
            .segmentIds.reduce((a, id) => a + length(id), 0);
    return (
      <>
        <NumberField
          commitUnchanged
          label={label}
          min={0.1}
          value={c?.fixed ? c.value : value}
          raw={g.fieldInputs[key]}
          onCommit={(n, text) => {
            if (n === null) onRaw(key, text);
            else {
              const constraintId = c?.id || crypto.randomUUID();
              onCommand(
                {
                  type: "setLength",
                  constraintId,
                  target: { kind, id, ...(range ? { range } : {}) },
                  value: n,
                },
                {
                  key: range ? `constraint:${constraintId}:length` : key,
                  text,
                },
              );
            }
          }}
        />
        {c && actions(c)}
      </>
    );
  };
  if (interaction.kind === "rangeFirst" || interaction.kind === "rangeSecond")
    return (
      <p role="status">
        {interaction.kind === "rangeFirst"
          ? "Выберите первую вершину диапазона."
          : "Выберите вторую вершину этой стены."}{" "}
        Esc — отмена.
      </p>
    );
  if (
    interaction.kind === "angleFirst" ||
    interaction.kind === "angleSecond" ||
    interaction.kind === "angleSector"
  )
    return (
      <p role="status">
        {interaction.kind === "angleFirst"
          ? "Выберите первую стену."
          : interaction.kind === "angleSecond"
            ? "Выберите вторую стену с общей вершиной."
            : "Выберите одну из двух дуг на плане."}{" "}
        Esc — отмена.
      </p>
    );
  if (context.kind === "angle") {
    const c = matchingAngle(g, context),
      value = angleGeometry(g, context, 1)?.value || 0,
      id = c?.id;
    const oldKey = c
      ? `vertex:${c.target.vertexId}:angle-${g.segments.findIndex((s) => s.id === c.target.firstSegmentId)}-${g.segments.findIndex((s) => s.id === c.target.secondSegmentId)}-${c.target.sector}`
      : "";
    const key = id
      ? `angle:${id}:value`
      : `vertex:${context.vertexId}:angle-${g.segments.findIndex((s) => s.id === context.firstSegmentId)}-${g.segments.findIndex((s) => s.id === context.secondSegmentId)}-${context.sector}`;
    return (
      <>
        <p>
          {c?.fixed ? "Введённый угол" : "Вычисленный угол"} ·{" "}
          {value.toFixed(1)}°
        </p>
        <NumberField
          commitUnchanged
          label="Угол между стенами"
          value={c?.fixed ? c.value : value}
          raw={g.fieldInputs[key] ?? g.fieldInputs[oldKey]}
          min={0.000001}
          max={359.999999}
          unit="°"
          onCommit={(n, text) => {
            if (n === null) onRaw(key, text);
            else {
              const constraintId = id || crypto.randomUUID();
              onCommand(
                {
                  type: "setAngle",
                  constraintId,
                  ...(c
                    ? (c.target as AngleTarget)
                    : {
                        vertexId: context.vertexId,
                        firstSegmentId: context.firstSegmentId,
                        secondSegmentId: context.secondSegmentId,
                        sector: context.sector,
                      }),
                  value: n,
                },
                { key: `angle:${constraintId}:value`, text },
              );
            }
          }}
        />
        <p className="muted">
          Ручной угол: больше 0° и меньше 360°, кроме 180°.
        </p>
        {c && actions(c)}
      </>
    );
  }
  if (context.kind === "tool" && context.tool === "addVertex")
    return (
      <>
        <p>
          Нажмите на свободное место полотна. Стрелки перемещают курсор, Shift —
          шаг 1 мм, Enter ставит вершину.
        </p>
        <details>
          <summary>Точное положение</summary>
          {(["x", "y"] as const).map((axis) => (
            <NumberField
              key={axis}
              label={`Новая вершина ${axis.toUpperCase()}`}
              value={point[axis]}
              raw={rawPoint[axis]}
              onCommit={(n, text) => {
                setRawPoint((p) => ({ ...p, [axis]: text }));
                if (n !== null) setPoint((p) => ({ ...p, [axis]: n }));
              }}
            />
          ))}
          <button
            disabled={Object.values(rawPoint).some(
              (v) => !v.trim() || !Number.isFinite(Number(v.replace(",", "."))),
            )}
            onClick={() => onCommand({ type: "addVertex", point })}
          >
            Поставить точку
          </button>
        </details>
      </>
    );
  if (context.kind === "vertex")
    return (
      <>
        <p>
          Переместите вершину инструментом перемещения или удалите её вместе с
          примыкающими стенами.
        </p>
        <button className="danger" onClick={onDelete}>
          Удалить вершину
        </button>
      </>
    );
  if (context.kind === "segment") {
    const s = g.segments.find((s) => s.id === context.id);
    if (!s) return null;
    const chain = g.chains.find((c) => c.id === s.chainId)!,
      a = vs.get(chain.startVertexId)!,
      b = vs.get(chain.endVertexId)!;
    const orientation = condition("orientation", chain.id),
      key = `chain:${chain.id}:orientation`;
    return (
      <>
        {lengthField("segment", s.id, "Длина участка")}
        {lengthField("chain", chain.id, "Общая длина стены")}
        <button
          disabled={chainNodes(g, chain.id).length < 2}
          onClick={() => onRange(chain.id)}
        >
          Выбрать диапазон
        </button>
        <NumberField
          commitUnchanged
          label="Направление стены"
          unit="°"
          value={
            orientation?.fixed
              ? orientation.value
              : (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
          }
          raw={g.fieldInputs[key]}
          onCommit={(n, text) => {
            if (n === null) onRaw(key, text);
            else
              onCommand(
                {
                  type: "setOrientation",
                  chainId: chain.id,
                  constraintId: orientation?.id || crypto.randomUUID(),
                  value: n,
                },
                { key, text },
              );
          }}
        />
        {orientation && actions(orientation)}
        <button className="danger" onClick={onDelete}>
          Удалить стену
        </button>
      </>
    );
  }
  if (context.kind === "range")
    return (
      <>
        {lengthField("chain", context.chainId, "Длина диапазона", {
          startVertexId: context.startVertexId,
          endVertexId: context.endVertexId,
        })}
        <p>
          Выбранный участок стены выделен на плане. Начало диапазона остаётся на
          месте при изменении длины.
        </p>
      </>
    );
  if (context.kind === "constraint") {
    const c = g.constraints.find((c) => c.id === context.id);
    return c ? (
      <>
        {c.kind === "legacyUnbound" && (
          <p>Старое условие не связано с геометрией. Его можно удалить.</p>
        )}
        {actions(c)}
      </>
    ) : null;
  }
  if (context.kind === "void")
    return (
      <>
        <button className="danger" onClick={onDelete}>
          Удалить отверстие со стенами
        </button>
        <button
          onClick={() => onCommand({ type: "unmarkVoid", voidId: context.id })}
        >
          Снять роль отверстия
        </button>
        <p>Снятие роли сохраняет стены. Удаление убирает всю границу.</p>
      </>
    );
  return <>{children}</>;
}
