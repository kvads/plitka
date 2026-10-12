import { formatPlanLength } from "../../domain/plan/format-length";
import DeleteProjectDialog from "./DeleteProjectDialog";
import type { DeleteProjectIntent, DeleteProjectOutcome } from "../../domain/plan/types";
import ObjectContextPanel from "./ObjectContextPanel";
import DeletionPreview from "./DeletionPreview";
import ProjectMenu from "./ProjectMenu";
import CanvasDialog from "./CanvasDialog";
import { editorReducer, initialEditor } from "../../domain/plan/editor-state";
import type { ImportPreview } from "../../domain/plan/project-lifecycle";
import { useState, useRef, useEffect, useReducer } from "react";
import {
  diagnosticIssues,
  sameCoordinate,
} from "../../domain/plan/vertex-safety";
import { deletionConditions } from "../../domain/plan/commands";
import ToolPalette from "./ToolPalette";
import ProjectCanvas, { type Tool } from "./ProjectCanvas";
import NumberField from "../workflow/NumberField";
import type {
  ProjectDocumentV3,
  GraphCommand,
  FaceCandidate,
  DiagnosticSelection,
} from "../../domain/plan/types";
import { emptyGraph } from "../../domain/plan/types";
import { useGraphProject } from "../../domain/plan/useGraphProject";
import {
  ready,
  pendingAffectsRoom,
  materialReady,
  rulesReady,
  relevantMeasurements,
  subsetGraph,
} from "../../domain/plan/rooms";
import { importV3 } from "../../domain/plan/storage";
import { download } from "../../domain/project/import-export";
import { exportResult } from "../../domain/project/result-export";
import { api } from "../../api";
import { format as f, type Layout, type LayoutRequest } from "../../types";
import "./canvas.css";
const stages = ["object", "variants"] as const;
const names = ["План", "Варианты"];
export default function GraphWorkflow({
  initial,
  onSaved,
  onBack,
  onRemoved,
}: {
  initial: ProjectDocumentV3;
  onSaved: (d: ProjectDocumentV3) => void;
  onBack: () => void;
  onRemoved: (outcome: DeleteProjectOutcome) => void;
}) {
  const h = useGraphProject(initial, onSaved, onRemoved),
    { doc, response, busy } = h,
    room = doc.rooms.find((r) => r.id === doc.selectedRoomId),
    face = response?.faces.find((f) => f.topologyKey === room?.topologyKey);
  const [editor, dispatchEditor] = useReducer(
    editorReducer,
    undefined,
    initialEditor,
  );
  const [nameError, setNameError] = useState("");
  const [dimensionTarget, setDimensionTarget] = useState<string[]>([]);
  const [deleteIntent, setDeleteIntent] = useState<DeleteProjectIntent | null>(null);
  const [projectMenu, setProjectMenu] = useState(false),
    [clearDialog, setClearDialog] = useState(false);
  const [tool, setTool] = useState<Tool>("select"),
    [vertex, setVertex] = useState(""),
    [segment, setSegment] = useState(""),
    [diagnostic, setDiagnostic] = useState<DiagnosticSelection | null>(null),
    [blockedVertex, setBlockedVertex] = useState(""),
    [start, setStart] = useState<string | null>(null),
    [panel, setPanel] = useState(initial.workflow.requestedStage !== "object"),
    [preview, setPreview] = useState<ImportPreview | null>(null),
    [restore, setRestore] = useState(false);
  const [results, setResults] = useState<{
      epoch: number;
      graphKey: string;
      roomId: string;
      key: string;
      variants: Layout[];
      accepted: Layout;
      selected: number;
      stale: boolean;
      locked: boolean;
      pending: { x: number; y: number } | null;
    } | null>(null),
    [loading, setLoading] = useState(false),
    [resultError, setResultError] = useState(""),
    [part, setPart] = useState("");
  const modalOrigin = useRef<HTMLElement | null>(null);
  const closeModal = () => {
    setPreview(null);
    setRestore(false);
    requestAnimationFrame(() => modalOrigin.current?.focus());
  };
  const resultGeneration = useRef(0),
    alive = useRef(true),
    stageHeading = useRef<HTMLHeadingElement>(null),
    menuButton = useRef<HTMLButtonElement>(null),
    file = useRef<HTMLInputElement>(null),
    previewRevision = useRef(0),
    importRequest = useRef(0);
  useEffect(() => {
    if (h.transition.reason === "deleteAttempt") {
      setLoading(false); setPreview(null); resultGeneration.current++; importRequest.current++;
    }
    const reset = ["clearProject", "undoClear", "import"].includes(
      h.transition.reason,
    );
    dispatchEditor({
      type: "accept",
      graph: doc.plan.draft,
      faces: response?.faces || [],
      reset,
    });
    if (!doc.plan.draft.vertices.some((v) => v.id === vertex)) setVertex("");
    if (!doc.plan.draft.segments.some((s) => s.id === segment)) setSegment("");
    if (start && !doc.plan.draft.vertices.some((v) => v.id === start))
      setStart(null);
    if (reset) {
      setVertex("");
      setSegment("");
      setStart(null);
      setTool("select");
      setPreview(null);
      setRestore(false);
      setProjectMenu(false);
      setResults(null);
      setLoading(false);
      setResultError("");
      setPart("");
      setDiagnostic(null);
      setBlockedVertex("");
      setPanel(false);
      resultGeneration.current++;
      importRequest.current++;
    }
  }, [h.transition.sequence]);
  const previousEditor = useRef(editor);
  useEffect(() => {
    const previous = previousEditor.current;
    previousEditor.current = editor;
    if (
      editor.context.kind === "none" &&
      editor.interaction.kind === "idle" &&
      stage === "object"
    ) {
      setPanel(false);
      if (
        previous.context.kind !== "none" ||
        previous.interaction.kind !== "idle"
      )
        requestAnimationFrame(() =>
          document.querySelector<SVGSVGElement>("svg[data-geometry]")?.focus(),
        );
    }
  }, [editor.context, editor.interaction]);
  const currentKey = JSON.stringify([
      doc.id, room?.id,
      face?.dependencyKey, face?.geometryKey, face?.measurementKey,
      room?.material,
      room?.rules,
    ]),
    canRoom = ready(room, face) && !busy && JSON.stringify(response?.graph) === JSON.stringify(doc.plan.draft) && !pendingAffectsRoom(doc, face),
    canTile = canRoom && materialReady(room),
    canRules = canTile && rulesReady(room);
  const stage = doc.workflow.requestedStage === "object" ? "object" : "variants",
    index = stages.indexOf(stage);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      resultGeneration.current++;
    };
  }, []);
  useEffect(() => {
    resultGeneration.current++;
    setLoading(false);
    if (results && (results.key !== currentKey || results.roomId !== room?.id))
      setResults((r) => (r ? { ...r, stale: true } : r));
  }, [currentKey, room?.id, JSON.stringify(room?.fieldInputs)]);
  useEffect(() => {
    if (
      results &&
      room?.id === results.roomId &&
      (!face || !materialReady(room) || !rulesReady(room))
    ) {
      resultGeneration.current++;
      setResults((r) => (r ? { ...r, stale: true } : r));
    }
  }, [face?.dependencyKey, face?.topologyKey, JSON.stringify(room?.fieldInputs)]);
  const invalidate = () => {
    resultGeneration.current++;
    setLoading(false);
    setResults((r) => (r ? { ...r, stale: true } : r));
  };
  const navigate = (target: typeof stage) => {
    h.cancelDeletion();
    h.update((d) => ({ ...d, workflow: { requestedStage: target } }));
    setProjectMenu(false);
    dispatchEditor({ type: "cancel" });
    setVertex("");
    setSegment("");
    setStart(null);
    setPanel(true);
    requestAnimationFrame(() => stageHeading.current?.focus());
  };
  const selectRoom = (f: FaceCandidate) => {
    setNameError("");
    h.cancelDeletion();
    const r = doc.rooms.find(
      (r) => r.topologyKey === f.topologyKey && r.binding === "attached",
    );
    if (r) {
      if (r.id !== doc.selectedRoomId) {
        resultGeneration.current++;
        setResults(null);
        setLoading(false);
      }
      dispatchEditor({
        type: "context",
        context: { kind: "room", roomId: r.id, topologyKey: f.topologyKey },
      });
      setVertex("");
      setSegment("");
      setPanel(true);
      setProjectMenu(false);
      h.update((d) => ({
        ...d,
        selectedRoomId: r.id,
        workflow: d.workflow,
      }));
    }
  };
  const run = (c: GraphCommand, raw?: { key: string; text: string }) => {
    setDiagnostic(null);
    setBlockedVertex("");
    const values = (x: unknown): unknown[] =>
      x && typeof x === "object" ? Object.values(x).flatMap(values) : [x];
    if (
      [
        "setLength",
        "setAngle",
        "setOrientation",
        "releaseConstraint",
        "deleteConstraint",
      ].includes(c.type) &&
      face &&
      values(c).some(
        (v) => typeof v === "string" && face.dependencyIds.includes(v),
      )
    )
      invalidate();
    if (c.type === "addTemplate")
      h.update((d) => ({
        ...d,
        viewport: {
          ...d.viewport,
          centerX: c.origin.x + c.width / 2,
          centerY: c.origin.y + c.height / 2,
          zoom: 1,
        },
      }));
    void h.execute(c, raw);
  };
  const g = doc.plan.draft;
  useEffect(() => {
    setDiagnostic(null);
    setBlockedVertex("");
  }, [doc.id, h.change, tool]);
  useEffect(() => {
    setDiagnostic((current) =>
      current &&
      response?.issues.some(
        (i) =>
          i.code === current.issueCode &&
          [...current.vertexIds, ...current.segmentIds].some((id) =>
            i.entityIds.includes(id),
          ),
      )
        ? current
        : null,
    );
  }, [response]);
  const visibleIssues = diagnosticIssues(response?.issues || [], g);
  const placementBlocked = (ids: string[], point: { x: number; y: number }) => {
    setDiagnostic(null);
    setVertex("");
    setSegment("");
    setBlockedVertex(ids[0]);
    const existing = g.vertices.find((v) => v.id === ids[0])!;
    const label = `вершина ${g.vertices.indexOf(existing) + 1}`;
    h.setError(
      sameCoordinate(existing, point)
        ? `В этой точке уже есть ${label}. Выберите другое место.`
        : `Слишком близко к вершине ${g.vertices.indexOf(existing) + 1}. Увеличьте масштаб или выберите другое место.`,
    );
  };
  const field = (key: string, text: string) => {
    if (face?.dependencyIds.some((id) => key.includes(":" + id + ":")))
      invalidate();
    const next = h.update((d) => ({
      ...d,
      plan: {
        ...d.plan,
        draftRevision: d.plan.draftRevision + 1,
        draft: {
          ...d.plan.draft,
          fieldInputs: { ...d.plan.draft.fieldInputs, [key]: text },
        },
      },
    }));
    void h.validate(next);
  };
  const roomFields = (
    kind: "material" | "rules",
    key: string,
    label: string,
    min: number,
    max: number,
    unit: string,
  ) =>
    room && (
      <NumberField
        label={label}
        value={(room[kind] as Record<string, number>)[key]}
        raw={room.fieldInputs[key]}
        min={min}
        max={max}
        unit={unit}
        onCommit={(n, text) => {
          invalidate();
          h.roomUpdate(room.id, (r) => ({
            ...r,
            [kind]: {
              ...r[kind],
              [key]: n ?? (r[kind] as Record<string, number>)[key],
            },
            fieldInputs: { ...r.fieldInputs, [key]: text },
          }));
        }}
      />
    );
  const request = (): LayoutRequest => {
    if (!room || !face || !canRules)
      throw new Error("Выберите помещение с корректной геометрией и параметрами.");
    return {
      outline: face.polygon.outline as [number, number][],
      holes: face.polygon.holes as [number, number][][],
      ...room.material,
      ...room.rules,
      offset_x: 0,
      offset_y: 0,
    };
  };
  const resultInputsCurrent = () => {
    const live = h.ref.current;
    const selected = live.rooms.find(r => r.id === live.selectedRoomId);
    return !!room && !!face && selected?.id === room.id && selected.binding === 'attached' &&
      selected.topologyKey === room.topologyKey && materialReady(selected) && rulesReady(selected) &&
      JSON.stringify([selected.material, selected.rules, selected.fieldInputs]) === JSON.stringify([room.material, room.rules, room.fieldInputs]) &&
      !pendingAffectsRoom(live, face) && JSON.stringify(subsetGraph(live.plan.draft, face)) === JSON.stringify(subsetGraph(g, face));
  };
  const optimize = async () => {
    if (!canRules) return;
    const token = ++resultGeneration.current,
      capturedEpoch = h.epoch.current,
      key = currentKey,
      roomId = room!.id;
    setLoading(true);
    setResultError("");
    try {
      const r = await api<{ variants: Layout[] }>("optimize", request());
      if (
        token !== resultGeneration.current ||
        !alive.current ||
        !h.current(capturedEpoch) || !resultInputsCurrent()
      )
        return;
      if (!r.variants.length) throw new Error("Варианты не найдены.");
      setResults({
        epoch: capturedEpoch,
        graphKey: JSON.stringify(subsetGraph(g, face!)),
        roomId,
        key,
        variants: r.variants,
        accepted: r.variants[0],
        selected: 0,
        stale: false,
        locked: false,
        pending: null,
      });

    } catch (e) {
      if (
        token === resultGeneration.current &&
        alive.current &&
        h.current(capturedEpoch) && resultInputsCurrent()
      )
        setResultError((e as Error).message);
    } finally {
      if (
        token === resultGeneration.current &&
        alive.current &&
        h.current(capturedEpoch) && resultInputsCurrent()
      )
        setLoading(false);
    }
  };
  const shift = async (x: number, y: number) => {
    if (!results || results.locked || results.stale) return;
    const token = ++resultGeneration.current,
      capturedEpoch = h.epoch.current;
    setResults((r) => (r ? { ...r, pending: { x, y } } : r));
    setLoading(true);
    setResultError("");
    try {
      const r = await api<Layout>("layout", {
        ...request(),
        offset_x: x,
        offset_y: y,
      });
      if (
        token !== resultGeneration.current ||
        !alive.current ||
        !h.current(capturedEpoch) || !resultInputsCurrent()
      )
        return;
      setResults((old) => (old ? { ...old, accepted: r, pending: null } : old));
    } catch (e) {
      if (
        token === resultGeneration.current &&
        alive.current &&
        h.current(capturedEpoch) && resultInputsCurrent()
      )
        setResultError((e as Error).message);
    } finally {
      if (
        token === resultGeneration.current &&
        alive.current &&
        h.current(capturedEpoch) && resultInputsCurrent()
      )
        setLoading(false);
    }
  };
  const exportFile = () =>
    download(
      "plitka-project.json",
      JSON.stringify(
        { format: "plitka-project", version: 3, project: doc },
        null,
        2,
      ),
    );
  const selectedLayout =
    results &&
    !results.stale &&
    results.roomId === room?.id &&
    stage === "variants"
      ? results.accepted
      : undefined;
  const exportSuspended = busy || pendingAffectsRoom(doc, face);
  const blockedExport =
    !canRules ||
    exportSuspended ||
    loading ||
    !!results?.stale ||
    !!results?.pending ||
    !!resultError;
  const downloadResult = (format: "svg" | "csv") => {
    const live = h.ref.current,
      liveRoom = live.rooms.find((r) => r.id === live.selectedRoomId);
    const liveKey = JSON.stringify([
      live.id, liveRoom?.id,
      face?.dependencyKey, face?.geometryKey, face?.measurementKey,
      liveRoom?.material,
      liveRoom?.rules,
    ]);
    if (
      !results ||
      !face ||
      blockedExport ||
      !h.current(results.epoch) ||
      results.key !== liveKey ||
      !materialReady(liveRoom) ||
      !rulesReady(liveRoom) ||
      pendingAffectsRoom(live, face) ||
      results.graphKey !== JSON.stringify(subsetGraph(live.plan.draft, face))
    )
      return;
    exportResult(format, results.accepted);
  };
  const selectConstraint = (id: string) => {
    h.cancelDeletion();
    const c = g.constraints.find((c) => c.id === id);
    if (!c) return;
    setPanel(true);
    setProjectMenu(false);
    if (c.kind === "angle")
      dispatchEditor({
        type: "context",
        context: {
          kind: "angle",
          vertexId: c.target.vertexId!,
          firstSegmentId: c.target.firstSegmentId!,
          secondSegmentId: c.target.secondSegmentId!,
          sector: c.target.sector!,
          constraintId: id,
        },
      });
    else if (c.target.range && c.target.chainId)
      dispatchEditor({
        type: "context",
        context: {
          kind: "range",
          chainId: c.target.chainId,
          ...c.target.range,
          constraintId: id,
        },
      });
    else
      dispatchEditor({ type: "context", context: { kind: "constraint", id } });
  };
  const deleteObject = () => {
    const context = editor.context;
    if (context.kind === "room")
      void h.requestDeletion({
        kind: "room",
        topologyKey: context.topologyKey,
      });
    else if (context.kind === "void")
      void h.requestDeletion({ kind: "void", voidId: context.id });
    else if (context.kind === "vertex" || context.kind === "segment") {
      const conditions = deletionConditions(
        g,
        context.kind === "vertex" ? context.id : undefined,
        context.kind === "segment" ? context.id : undefined,
      );
      if (
        window.confirm(
          `Удалить выбранный элемент и связанные условия (${conditions.length})? ${conditions.map((c) => `${c.kind}: ${c.value}`).join(", ")}`,
        )
      )
        run({
          type: "deleteElements",
          vertexIds: context.kind === "vertex" ? [context.id] : [],
          segmentIds: context.kind === "segment" ? [context.id] : [],
          acknowledgedConstraintIds: conditions.map((c) => c.id),
        });
    }
  };
  const selectObject = (v: string, s: string) => {
    h.cancelDeletion();
    setProjectMenu(false);
    setDiagnostic(null);
    setBlockedVertex("");
    setVertex(v);
    setSegment(s);
    setPanel(true);
    if (
      editor.interaction.kind === "rangeFirst" ||
      editor.interaction.kind === "rangeSecond"
    ) {
      if (v) dispatchEditor({ type: "rangeVertex", id: v, graph: g });
      return;
    }
    if (tool === "angle") {
      if (s) dispatchEditor({ type: "angleSegment", id: s, graph: g });
      return;
    }
    dispatchEditor({
      type: "context",
      context: v
        ? { kind: "vertex", id: v }
        : s
          ? { kind: "segment", id: s }
          : { kind: "none" },
    });
    if (!v && !s) setPanel(false);
  };
  return (
    <ProjectCanvas
      graph={g}
      onCancel={() => {
        setStart(null);
        dispatchEditor({ type: "cancel" });
        setPanel(false);
      }}
      faces={response?.faces || []}
      roomNames={Object.fromEntries(doc.rooms.filter(r => r.binding === "attached").map(r => [r.topologyKey!, r.name]))}
      selectedKey={room?.topologyKey}
      viewport={doc.viewport}
      tool={stage === "object" ? tool : "pan"}
      selectedVertex={vertex}
      selectedSegment={segment}
      startVertex={start}
      diagnostic={diagnostic}
      blockedVertex={blockedVertex}
      onBlocked={placementBlocked}
      layout={selectedLayout}
      onPart={(id) => {
        setPart(id);
        setPanel(true);
      }}
      onShift={
        results && !results.locked && !results.stale
          ? (x, y) => void shift(x, y)
          : undefined
      }
      editor={editor}
      resetEpoch={h.epoch.current}
      panelOpen={panel || projectMenu}
      onCanvasFocus={() => setPanel(false)}
      onSector={(sector) => {
        dispatchEditor({ type: "sector", sector });
        setPanel(true);
        requestAnimationFrame(() =>
          document
            .querySelector<HTMLInputElement>(
              '[aria-label="Угол между стенами"]',
            )
            ?.focus(),
        );
      }}
      highlightedSegments={
        h.deletion?.impact?.segmentIds || (panel ? dimensionTarget : [])
      }
      onVoid={(id) => {
        h.cancelDeletion();
        dispatchEditor({ type: "context", context: { kind: "void", id } });
        setPanel(true);
        setProjectMenu(false);
        setVertex("");
        setSegment("");
      }}
      onConstraint={selectConstraint}
      onViewport={(viewport) => h.update((d) => ({ ...d, viewport }))}
      onSelection={selectObject}
      onRoom={selectRoom}
      onMove={(vertexId, point) => run({ type: "moveVertex", vertexId, point })}
      onPoint={(p, target) => {
        if (stage !== "object") return;
        if (tool === "addVertex") run({ type: "addVertex", point: p });
        if (tool === "connect") {
          if (!start) {
            if (target.vertexId) setStart(target.vertexId);
            else h.setError("Выберите начальную вершину.");
          } else if (target.vertexId || target.segmentId) {
            run({
              type: "connect",
              fromVertexId: start,
              to: target.vertexId
                ? { vertexId: target.vertexId }
                : { segmentId: target.segmentId!, point: p },
            });
            setStart(null);
          } else h.setError("Выберите конечную вершину или стену.");
        }
      }}
    >
      <header
        className="canvas-top"
        data-context={editor.context.kind}
        data-overlay
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button onClick={onBack}>← Проекты</button>
        <div className="canvas-title">
          <strong>{doc.name}</strong>
          <small>{doc.address || "Адрес не указан"}</small>
        </div>
        <nav aria-label="Этапы проекта">
          {stages.map((x, i) => (
            <button
              key={x}
              aria-current={stage === x ? "step" : undefined}
              onClick={() => navigate(x)}
            >
              {i + 1}. {names[i]}
            </button>
          ))}
        </nav>
        <button
          onClick={() => {
            setProjectMenu((p) => !p);
            setPanel(false);
          }}
        >
          Проект
        </button>
        <button
          disabled={!h.canUndo}
          onClick={() => {
            resultGeneration.current++;
            setLoading(false);
            h.cancel();
          }}
        >
          Отменить правку
        </button>
        <button
          ref={menuButton}
          aria-label="Параметры"
          aria-expanded={panel}
          onClick={() => {
            if (!panel && stage === "object" && editor.context.kind === "none")
              dispatchEditor({
                type: "context",
                context: { kind: "tool", tool },
              });
            setProjectMenu(false);
            setPanel(!panel);
          }}
        >
          Параметры
          {response?.issues.length ? ` · ${response.issues.length}` : ""}
        </button>
      </header>
      {stage === "object" && (
        <ToolPalette
          selected={tool}
          onSelect={(tool) => {
            h.cancelDeletion();
            setTool(tool);
            setStart(null);
            setVertex("");
            setSegment("");
            setProjectMenu(false);
            dispatchEditor(
              tool === "angle"
                ? { type: "interaction", interaction: { kind: "angleFirst" } }
                : { type: "context", context: { kind: "tool", tool } },
            );
            setPanel(tool === "pan");
            requestAnimationFrame(() =>
              document.querySelector<SVGSVGElement>("[data-geometry]")?.focus(),
            );
          }}
        />
      )}
      {projectMenu && (
        <ProjectMenu
          doc={doc}
          onUpdate={h.update}
          onClose={() => setProjectMenu(false)}
          onClear={() => setClearDialog(true)}
          onDelete={() => setDeleteIntent(h.deleteIntent())}
          onRestore={() => setRestore(true)}
        />
      )}
      {deleteIntent && <DeleteProjectDialog intent={deleteIntent} onCancel={() => setDeleteIntent(null)} onConfirm={h.deleteProject} refreshIntent={h.deleteIntent} onDone={() => setDeleteIntent(null)} />}
      {clearDialog && (
        <CanvasDialog
          title="Очистить проект"
          onCancel={() => setClearDialog(false)}
        >
          <p>
            Будут удалены весь план, помещения, параметры плитки и правила.
            Название и адрес сохранятся. Очистку можно отменить до закрытия
            проекта.
          </p>
          <button onClick={() => setClearDialog(false)}>Отмена</button>
          <button
            className="danger"
            onClick={() => {
              setClearDialog(false);
              setProjectMenu(false);
              h.clearProject();
            }}
          >
            Очистить
          </button>
        </CanvasDialog>
      )}
      {panel && !projectMenu && (
        <aside
          className={
            "canvas-panel " +
            (editor.interaction.kind !== "idle" ? "interaction-panel" : "")
          }
          data-overlay
          onPointerDown={(e) => e.stopPropagation()}
          onFocusCapture={(e) => {
            const label = (e.target as HTMLElement).getAttribute("aria-label");
            const wall =
              editor.context.kind === "segment"
                ? g.segments.find((s) => s.id === segment)
                : undefined;
            const chain = g.chains.find((c) => c.id === wall?.chainId);
            setDimensionTarget(
              wall
                ? label === "Длина участка"
                  ? [wall.id]
                  : ["Общая длина стены", "Направление стены"].includes(
                        label || "",
                      )
                    ? chain?.segmentIds || []
                    : []
                : [],
            );
          }}
          onBlurCapture={() => setDimensionTarget([])}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setPanel(false);
              setStart(null);
              menuButton.current?.focus();
            }
          }}
        >
          <div className="panel-heading">
            <h2 ref={stageHeading} tabIndex={-1}>
              {stage !== "object"
                ? names[index]
                : editor.context.kind === "vertex"
                  ? "Вершина"
                  : editor.context.kind === "segment"
                    ? "Стена"
                    : editor.context.kind === "room"
                      ? "Помещение"
                      : editor.context.kind === "angle"
                        ? "Угол"
                        : editor.context.kind === "range"
                          ? "Диапазон стены"
                          : editor.context.kind === "void"
                            ? "Отверстие"
                            : editor.context.kind === "constraint"
                              ? "Условие"
                              : "Инструмент"}
            </h2>
            <button
              aria-label="Закрыть параметры"
              onClick={() => {
                setPanel(false);
                menuButton.current?.focus();
              }}
            >
              ×
            </button>
          </div>
          {stage === "object" && (
            <>
              <ObjectContextPanel
                context={editor.context}
                interaction={editor.interaction}
                graph={g}
                onCommand={run}
                onRaw={field}
                onRange={(chainId) => {
                  dispatchEditor({
                    type: "interaction",
                    interaction: { kind: "rangeFirst", chainId },
                  });
                  setVertex("");
                  setSegment("");
                }}
                onDelete={deleteObject}
                onConstraint={selectConstraint}
              >
                {editor.context.kind === "tool" && (
                  <p className="muted">
                    Выберите объект на плане. Стрелки — выбор, Enter — действие,
                    Esc — отмена.
                  </p>
                )}
                {editor.context.kind === "room" && face && (
                  <>
                    <div className="room-area">
                      {f(face.areaMm2 / 1e6, 6)} м²
                    </div>
                    <button className="danger" onClick={deleteObject}>
                      Удалить помещение
                    </button>
                    <button
                      onClick={() => {
                        if (
                          window.confirm(
                            "Сделать выбранную область отверстием?",
                          )
                        )
                          run({ type: "markVoid", boundary: face.outer });
                      }}
                    >
                      Исключить из укладки
                    </button>
                  </>
                )}
                {editor.context.kind === "tool" &&
                  editor.context.tool === "pan" && (
                    <NumberField
                      label="Шаг сетки"
                      value={doc.viewport.gridStepMm}
                      min={1}
                      onCommit={(n) => {
                        if (n !== null && n >= 1)
                          h.update((d) => ({
                            ...d,
                            viewport: { ...d.viewport, gridStepMm: n },
                          }));
                      }}
                    />
                  )}
              </ObjectContextPanel>
              {editor.error && <p role="alert">{editor.error}</p>}
              {!!response?.issues.length && (
                <div className="geometry-issues">
                  {visibleIssues.map((e, i) => {
                    const walls = g.segments.filter((s) =>
                      e.entityIds.includes(s.id),
                    );
                    const ids = new Set([
                      ...e.entityIds,
                      ...walls.flatMap((w) => [w.startVertexId, w.endVertexId]),
                    ]);
                    const vertices = g.vertices.filter((v) => ids.has(v.id));
                    return (
                      <button
                        key={i}
                        onClick={() => {
                          setVertex("");
                          setSegment("");
                          setBlockedVertex("");
                          dispatchEditor({
                            type: "context",
                            context: { kind: "tool", tool: "select" },
                          });
                          setDiagnostic({
                            issueCode: e.code,
                            segmentIds: walls.map((w) => w.id),
                            vertexIds: vertices.map((v) => v.id),
                          });
                          if (window.matchMedia("(max-width: 700px)").matches) {
                            setPanel(false);
                            requestAnimationFrame(() =>
                              menuButton.current?.focus(),
                            );
                          }
                          if (vertices.length)
                            h.update((d) => ({
                              ...d,
                              viewport: {
                                ...d.viewport,
                                centerX:
                                  vertices.reduce((sum, v) => sum + v.x, 0) /
                                  vertices.length,
                                centerY:
                                  vertices.reduce((sum, v) => sum + v.y, 0) /
                                  vertices.length,
                              },
                            }));
                        }}
                      >
                        <span>{e.message}</span>
                        {e.code === "zero_wall" &&
                          vertices.length === 2 &&
                          sameCoordinate(vertices[0], vertices[1]) && (
                            <small>
                              Две разные вершины находятся в одной точке.
                            </small>
                          )}
                        {doc.plan.pendingEdit &&
                          e.code === "coincident_vertices" && (
                            <small>Положение в сохранённом плане:</small>
                          )}
                        {walls.map((w) => (
                          <small key={w.id}>
                            Стена {g.segments.indexOf(w) + 1} · {w.id}
                          </small>
                        ))}
                        {vertices.map((v) => (
                          <small key={v.id}>
                            Вершина {g.vertices.indexOf(v) + 1} · {v.id}: ({v.x}
                            ; {v.y}) мм
                          </small>
                        ))}
                        <span className="issue-action">Показать на плане</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {editor.context.kind === "room" && face && (
                <>
                  <details open>
                    <summary>Вычисленные размеры выбранной комнаты</summary>
                    <div className="measurements">
                      {relevantMeasurements(face, response!.measurements)
                        .filter((m) => m.source === "derived")
                        .map((m) => (
                          <div key={m.key}>
                            {m.kind === "angle"
                              ? "Угол"
                              : m.kind === "chainLength"
                                ? "Общая длина"
                                : "Участок"}
                            : {f(m.value || 0, 1)}{" "}
                            {m.kind === "angle" ? "°" : "мм"}
                          </div>
                        ))}
                    </div>
                  </details>
                </>
              )}
            </>
          )}
          {stage === "variants" && <>
            <label>Помещение<select aria-label="Помещение" value={room?.id || ''} onChange={e => {
              const target = doc.rooms.find(r => r.id === e.target.value);
              const candidate = response?.faces.find(f => f.topologyKey === target?.topologyKey);
              if (candidate) selectRoom(candidate);
            }}><option value="">Выберите помещение</option>{doc.rooms.filter(r => r.binding === 'attached').map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
            {!room && <p>Выберите замкнутое помещение для подбора. Создать или исправить его можно на странице «План».</p>}
            {room && !canRoom && <p role="status">{busy ? 'Проверяем геометрию…' : 'Исправьте геометрию или незавершённую правку помещения на плане.'}</p>}
          </>}
          {room && (stage === 'variants' || editor.context.kind === 'room') && <label>Название помещения<input aria-label="Название помещения" key={room.id + room.name} defaultValue={room.name} maxLength={120} onBlur={e => {
            const name = e.target.value.trim();
            if (!name || name.length > 120) { e.target.value = room.name; setNameError('Название должно содержать от 1 до 120 символов.'); return; }
            setNameError("");
            if (name !== room.name) h.roomUpdate(room.id, r => ({...r, name}));
          }} onChange={() => setNameError('')} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />{nameError && <small role="alert">{nameError}</small>}</label>}
          {stage === "variants" && room && (
            <>
              {roomFields("material", "tile", "Сторона плитки", 50, 2000, "мм")}
              {roomFields("material", "grout", "Ширина шва", 0, 20, "мм")}
            </>
          )}
          {stage === "variants" && room && (
            <>
              {roomFields("rules", "gap", "Отступ от стен", 0, 100, "мм")}
              {roomFields(
                "rules",
                "threshold",
                "Минимальная ширина детали",
                1,
                1000,
                "мм",
              )}
              {roomFields("rules", "angle", "Угол укладки", 0, 89.9, "°")}
              <button
                className="dark"
                disabled={!canRules || loading}
                onClick={() => void optimize()}
              >
                {loading ? "Подбираем…" : "Подобрать раскладку"}
              </button>
            </>
          )}
          {stage === "variants" && results && (
            <>
              <div className="variant-list">
                {results.variants.map((l, i) => (
                  <button
                    key={i}
                    aria-pressed={results.selected === i}
                    disabled={results.locked || results.stale || loading}
                    onClick={() => {
                      resultGeneration.current++;
                      setLoading(false);
                      setResultError("");
                      setResults((r) =>
                        r
                          ? { ...r, selected: i, accepted: l, pending: null }
                          : r,
                      );
                    }}
                  >
                    {l.title || `Вариант ${i + 1}`} · {l.metrics.tiles} плиток
                  </button>
                ))}
              </div>
              <p>
                {results.stale
                  ? "Результат устарел. Выполните новый подбор."
                  : `Плиток: ${results.accepted.metrics.tiles}; подрезок: ${results.accepted.metrics.cut}; отходы: ${f(results.accepted.metrics.waste_percent, 1)}%`}
              </p>
              <p>Без повторного использования обрезков</p>
              <NumberField
                label="Сдвиг X"
                min={-100000}
                max={100000}
                value={results.pending?.x ?? results.accepted.offset_x}
                disabled={results.locked || results.stale}
                onCommit={(n) => {
                  if (n !== null) void shift(n, results.accepted.offset_y);
                }}
              />
              <NumberField
                label="Сдвиг Y"
                min={-100000}
                max={100000}
                value={results.pending?.y ?? results.accepted.offset_y}
                disabled={results.locked || results.stale}
                onCommit={(n) => {
                  if (n !== null) void shift(results.accepted.offset_x, n);
                }}
              />
              {results.pending && (
                <button
                  onClick={() => {
                    resultGeneration.current++;
                    setLoading(false);
                    setResultError("");
                    setResults((r) => (r ? { ...r, pending: null } : r));
                  }}
                >
                  Отменить сдвиг
                </button>
              )}
              <button
                onClick={() =>
                  setResults((r) => (r ? { ...r, locked: !r.locked } : r))
                }
              >
                {results.locked ? "Разблокировать" : "Закрепить раскладку"}
              </button>
              <label>
                Деталь
                <select
                  aria-label="Деталь"
                  value={part}
                  onChange={(e) => setPart(e.target.value)}
                >
                  <option value="">Выберите деталь</option>
                  {results.accepted.parts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id}: {f(p.width, 1)} × {f(p.height, 1)} мм
                    </option>
                  ))}
                </select>
              </label>
              {part && (
                <p>
                  {results.accepted.parts
                    .find((p) => p.id === part)
                    ?.issues.join(", ") || "Без замечаний"}
                </p>
              )}
              <button
                disabled={blockedExport}
                onClick={() => downloadResult("svg")}
              >
                План с размерами · SVG
              </button>
              <button
                disabled={blockedExport}
                onClick={() => downloadResult("csv")}
              >
                Таблица деталей · CSV
              </button>
            </>
          )}
          {resultError && <p role="alert">{resultError}</p>}
          <div className="stage-actions">
            {index > 0 && (
              <button onClick={() => navigate(stages[index - 1])}>Назад</button>
            )}
            {index === 0 && (
              <button
                onClick={() => navigate(stages[index + 1])}
              >
                Далее
              </button>
            )}
          </div>
        </aside>
      )}
      <footer
        className="canvas-status"
        data-overlay
        data-pending={!!doc.plan.pendingEdit}
      >
        <span role="status">{busy ? "Проверяем геометрию…" : h.saved}</span>
        {h.saved === "Не сохранено" && (
          <button onClick={h.retrySave}>Повторить сохранение</button>
        )}
        {doc.plan.pendingEdit && (
          <button onClick={() => void h.retry()}>Повторить действие</button>
        )}
        <span>Сетка {formatPlanLength(doc.viewport.gridStepMm)}</span>
        <button
          aria-label="Уменьшить"
          onClick={() =>
            h.update((d) => ({
              ...d,
              viewport: {
                ...d.viewport,
                zoom: Math.max(0.2, d.viewport.zoom / 1.25),
              },
            }))
          }
        >
          −
        </button>
        <button
          aria-label="Увеличить"
          onClick={() =>
            h.update((d) => ({
              ...d,
              viewport: {
                ...d.viewport,
                zoom: Math.min(8, d.viewport.zoom * 1.25),
              },
            }))
          }
        >
          +
        </button>
        <button onClick={exportFile}>Скачать проект</button>
        <button
          onClick={(e) => {
            modalOrigin.current = e.currentTarget;
            file.current?.click();
          }}
        >
          Открыть файл
        </button>
        <input
          hidden
          ref={file}
          type="file"
          accept=".json"
          onChange={async (e) => {
            const input = e.currentTarget,
              f = input.files?.[0];
            input.value = "";
            if (!f) return;
            const epoch = h.epoch.current,
              requestId = ++importRequest.current,
              localRevision = h.localRevision.current;
            previewRevision.current = doc.documentRevision;
            setPreview(null);
            try {
              const document = await importV3(f, h.ref.current);
              if (
                !alive.current ||
                !h.current(epoch) ||
                requestId !== importRequest.current ||
                localRevision !== h.localRevision.current
              )
                return;
              setPreview({
                document,
                projectId: doc.id,
                lifecycleEpoch: epoch,
                requestId,
                localRevision,
              });
            } catch (e) {
              if (
                alive.current &&
                h.current(epoch) &&
                requestId === importRequest.current &&
                localRevision === h.localRevision.current
              )
                h.setError((e as Error).message);
            }
          }}
        />
      </footer>
      {h.deletion?.status === "ready" && (
        <DeletionPreview
          preview={h.deletion}
          rooms={doc.rooms}
          onCancel={h.cancelDeletion}
          onConfirm={() => {
            invalidate();
            h.confirmDeletion();
          }}
        />
      )}
      {h.error && (
        <div className="canvas-error" role="alert" data-overlay>
          <span>{h.error}</span>
          <button onClick={() => void h.retry()}>Повторить</button>
          <button onClick={exportFile}>Скачать мой черновик</button>
          <button onClick={() => location.reload()}>
            Загрузить сохранённую версию
          </button>
          {doc.plan.pendingEdit && (
            <button onClick={() => h.cancel()}>Отменить действие</button>
          )}
        </div>
      )}
      {(preview || restore) && (
        <div
          className="canvas-modal"
          data-overlay
          role="dialog"
          aria-modal="true"
          aria-label={preview ? "Импорт проекта" : "Восстановление плана"}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              closeModal();
            }
            if (e.key === "Tab") {
              const els = [
                ...e.currentTarget.querySelectorAll<HTMLButtonElement>(
                  "button",
                ),
              ];
              const i = els.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              e.preventDefault();
              els[
                (i + (e.shiftKey ? -1 : 1) + els.length) % els.length
              ]?.focus();
            }
          }}
        >
          <section>
            <h2>
              {preview ? preview.document.name : "Восстановить весь план?"}
            </h2>
            <p>
              {preview
                ? preview.document.address
                : doc.plan.restorePoint
                  ? `Изменятся все комнаты и общие стены: ${doc.rooms.map((r) => r.name).join(", ")}. Параметры плитки сохранятся.`
                  : "Подтверждённого плана ещё нет. Очистить всё полотно? Параметры комнат сохранятся."}
            </p>
            <button
              autoFocus
              onClick={() => {
                if (preview) {
                  if (
                    doc.documentRevision !== previewRevision.current ||
                    !h.current(preview.lifecycleEpoch) ||
                    h.localRevision.current !== preview.localRevision
                  ) {
                    h.setError(
                      "Конфликт: проект изменился после предпросмотра.",
                    );
                    return;
                  }
                  invalidate();
                  h.replaceDocument(preview.document);
                  closeModal();
                } else {
                  const saved = doc.plan.restorePoint;
                  invalidate();
                  const next: ProjectDocumentV3 = {
                    ...doc,
                    plan: {
                      ...doc.plan,
                      draft: saved
                        ? structuredClone(saved.graph)
                        : emptyGraph(),
                      pendingEdit: null,
                    },
                    rooms: saved
                      ? doc.rooms.map((r) => ({
                          ...r,
                          binding: saved.bindings.some(
                            (b) => b.roomId === r.id && b.topologyKey,
                          )
                            ? "attached"
                            : "detached",
                          topologyKey:
                            saved.bindings.find((b) => b.roomId === r.id)
                              ?.topologyKey ?? null,
                        }))
                      : doc.rooms,
                    selectedRoomId: saved?.selectedRoomId ?? null,
                    workflow: doc.workflow,
                  };
                  h.replaceDocument(next, "restore");
                  setProjectMenu(false);
                  closeModal();
                }
              }}
            >
              {preview ? "Заменить открытый проект" : "Восстановить план"}
            </button>
            <button
              onClick={() => {
                closeModal();
              }}
            >
              Отмена
            </button>
          </section>
        </div>
      )}
    </ProjectCanvas>
  );
}
