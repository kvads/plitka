import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, ChevronsLeft, ChevronsRight, DoorOpen, FolderOpen, Grid3X3, LoaderCircle, MousePointer2, PencilRuler, RotateCcw, Trash2, X } from "lucide-react";
import PhysicalCanvas from "./PhysicalCanvas";
import ProjectMenu from "./ProjectMenu";
import { usePhysicalProject } from "../../domain/plan/usePhysicalProject";
import { deleteV6 } from "../../domain/plan/storage";
import type { ProjectDocumentV6 } from "../../domain/plan/types";
import { isTenth } from "../../domain/plan/precision";
import { newRoom } from "../../domain/plan/rooms";
import NumberField from "../workflow/NumberField";
import { api } from "../../api";
import type { Layout, LayoutRequest } from "../../types";
import { physicalDeletionPreview, type PhysicalDeletionImpact } from "../../domain/plan/deletion-api";
import { exportResult } from "../../domain/project/result-export";
import { activeSharedGrid, roomLayoutBasis, roomLayoutKey, roomLayoutRequest } from "../../domain/plan/shared-grid";
import "./canvas.css";

const RoomPreview3D = lazy(() => import("./RoomPreview3D"));

const displayTenth = (value: number) => value.toLocaleString("ru-RU", {
  minimumFractionDigits: 1, maximumFractionDigits: 1,
});
const roomCountText = (count: number) => {
  const mod100 = count % 100;
  const mod10 = count % 10;
  const noun = mod100 >= 11 && mod100 <= 14 ? "помещений"
    : mod10 === 1 ? "помещение" : mod10 >= 2 && mod10 <= 4 ? "помещения" : "помещений";
  return `${count} ${noun}`;
};

type Removal =
  | { status: "deleted" | "alreadyMissing"; projectId: string; projects: ProjectDocumentV6[] }
  | { status: "conflict"; projectId: string; projects: ProjectDocumentV6[]; current: ProjectDocumentV6 };

type PendingElementDeletion =
  | { kind: "wall"; wallId: string; impact: PhysicalDeletionImpact }
  | { kind: "door"; openingId: string; widthMm: number };

export default function PhysicalWorkflow({ initial, onSaved, onRemoved, onBack }: {
  initial: ProjectDocumentV6;
  onSaved: (document: ProjectDocumentV6) => void;
  onRemoved: (result: Removal) => void;
  onBack: () => void;
}) {
  const project = usePhysicalProject(initial, onSaved);
  const { doc, update, command, drawWall, busy, error } = project;
  const response = project.response?.draftRevision === doc.plan.draftRevision ? project.response : null;
  const [menuOpen, setMenuOpen] = useState(() => !window.matchMedia("(hover: none) and (pointer: coarse)").matches);
  const [projectMenu, setProjectMenu] = useState(false);
  const [wallTool, setWallTool] = useState(false);
  const [doorTool, setDoorTool] = useState(false);
  const [thicknessInput, setThicknessInput] = useState("100");
  const [doorWidthInput, setDoorWidthInput] = useState("800");
  const [selectedDoorWidthInput, setSelectedDoorWidthInput] = useState("");
  const [selectedDoorId, setSelectedDoorId] = useState<string | null>(null);
  const [selectedThicknessInput, setSelectedThicknessInput] = useState("");
  const [selectedWallId, setSelectedWallId] = useState<string | null>(null);
  const [selectedHandle, setSelectedHandle] = useState<"start" | "center" | "end" | null>(null);
  const [interactionTool, setInteractionTool] = useState<"select" | "delete">("select");
  const [deleting, setDeleting] = useState(false);
  const [deleteProjectError, setDeleteProjectError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [pendingElementDeletion, setPendingElementDeletion] = useState<PendingElementDeletion | null>(null);
  const [deleteWallLoading, setDeleteWallLoading] = useState(false);
  const [deleteWallError, setDeleteWallError] = useState("");
  const deletionGeneration = useRef(0);
  const deleteCancelButton = useRef<HTMLButtonElement>(null);
  const [layoutCache, setLayoutCache] = useState<Record<string, { key: string; variants: Layout[]; selected: number }>>({});
  const [layoutLoading, setLayoutLoading] = useState(false);
  const [layoutError, setLayoutError] = useState("");
  const [layoutNotice, setLayoutNotice] = useState("");
  const [sharedLoading, setSharedLoading] = useState(false);
  const [layoutScope, setLayoutScope] = useState<"room" | "through">(
    () => initial.sharedGrid ? "through" : "room");
  const layoutGeneration = useRef(0);
  const failedAutomaticLayouts = useRef(new Set<string>());
  const thickness = Number(thicknessInput.replace(",", "."));
  const thicknessValid = Number.isInteger(thickness / 10) && thickness >= 10 && thickness <= 100000;
  const selected = doc.plan.draft.walls.find(wall => wall.id === selectedWallId);
  const selectedDoor = (doc.plan.draft.openings ?? []).find(opening => opening.id === selectedDoorId);
  const doorWidth = Number(doorWidthInput.replace(",", "."));
  const doorWidthValid = Number.isInteger(doorWidth / 10) && doorWidth >= 300 && doorWidth <= 3000;
  const selectedDoorWidth = Number(selectedDoorWidthInput.replace(",", "."));
  const selectedDoorWidthValid = Number.isInteger(selectedDoorWidth / 10) && selectedDoorWidth >= 300 && selectedDoorWidth <= 3000;
  useEffect(() => { if (selectedWallId && !selected) {
    setSelectedWallId(null); setSelectedHandle(null);
  } }, [selectedWallId, selected]);
  useEffect(() => { if (selectedDoorId && !selectedDoor) setSelectedDoorId(null); }, [selectedDoorId, selectedDoor]);
  const room = doc.rooms.find(item => item.id === doc.selectedRoomId);
  const selectedFace = response?.faces.find(face => face.topologyKey === room?.topologyKey);
  const sharedGrid = activeSharedGrid(doc, response?.faces ?? []);
  const referenceRoom = doc.rooms.find(item => item.id === doc.sharedGrid?.referenceRoomId);
  const linked = !!room && !!doc.sharedGrid?.linkedRoomIds.includes(room.id);
  const layoutKey = room ? roomLayoutKey(doc, room, selectedFace, sharedGrid) : "";
  const cachedLayout = room ? layoutCache[room.id] : undefined;
  const activeLayout = cachedLayout?.key === layoutKey ? cachedLayout.variants[cachedLayout.selected] : null;
  const visibleLayouts = doc.rooms.flatMap(candidate => {
    const face = response?.faces.find(item => item.topologyKey === candidate.topologyKey);
    const cached = layoutCache[candidate.id];
    return face?.polygon && cached?.key === roomLayoutKey(doc, candidate, face, sharedGrid)
      ? [{ roomId: candidate.id, layout: cached.variants[cached.selected] }] : [];
  });
  const selectedThickness = Number(selectedThicknessInput.replace(",", "."));
  const selectedThicknessValid = Number.isInteger(selectedThickness / 10) && selectedThickness >= 10 && selectedThickness <= 100000;
  const chooseWall = (wallId: string | null) => {
    setSelectedDoorId(null);
    setSelectedWallId(wallId);
    setSelectedHandle(null);
    setDeleteWallError("");
    setSelectedThicknessInput(String(doc.plan.draft.walls.find(wall => wall.id === wallId)?.thicknessMm ?? ""));
  };
  const chooseDoor = (openingId: string | null) => {
    setSelectedDoorId(openingId);
    setSelectedWallId(null);
    setSelectedHandle(null);
    setSelectedDoorWidthInput(String((doc.plan.draft.openings ?? [])
      .find(opening => opening.id === openingId)?.widthMm ?? ""));
  };
  const layoutMode = doc.workflow.requestedStage === "variants";
  useEffect(() => {
    deletionGeneration.current++;
    setPendingElementDeletion(null);
    setDeleteWallLoading(false);
  }, [doc.plan.draftRevision]);
  useEffect(() => {
    if (pendingElementDeletion) deleteCancelButton.current?.focus();
  }, [pendingElementDeletion]);
  const roomMissing = Object.fromEntries((response?.faces ?? []).map(face => {
    const candidate = doc.rooms.find(item => item.topologyKey === face.topologyKey);
    return [face.topologyKey, !candidate || layoutCache[candidate.id]?.key !==
      roomLayoutKey(doc, candidate, face, sharedGrid)];
  }));
  useEffect(() => { layoutGeneration.current++; setLayoutLoading(false); }, [layoutKey]);
  const optimize = async () => {
    if (!room || !selectedFace?.polygon) return;
    if (linked && !sharedGrid) {
      setLayoutError("Сначала пересчитайте раскладку опорного помещения.");
      return;
    }
    const request: LayoutRequest = roomLayoutRequest(room, selectedFace, linked ? sharedGrid : null);
    const generation = ++layoutGeneration.current;
    const capturedKey = layoutKey;
    setLayoutLoading(true);
    setLayoutError("");
    setLayoutNotice("");
    try {
      const variants = linked
        ? [await api<Layout>("v5/layout", request)]
        : (await api<{ variants: Layout[] }>("v5/optimize", request)).variants;
      if (generation !== layoutGeneration.current) return;
      if (!variants.length) throw new Error("Варианты раскладки не найдены.");
      setLayoutCache(cache => ({ ...cache, [room.id]: {
        key: capturedKey, variants, selected: 0,
      } }));
      failedAutomaticLayouts.current.delete(`${room.id}:${capturedKey}`);
      if (doc.sharedGrid?.referenceRoomId === room.id && !linked)
        update(current => current.sharedGrid?.referenceRoomId === room.id ? ({ ...current,
          sharedGrid: { ...current.sharedGrid, referenceBasis: roomLayoutBasis(room, selectedFace),
            tile: room.material.tile, grout: room.material.grout, angle: variants[0].angle,
            offsetX: variants[0].offset_x, offsetY: variants[0].offset_y } }) : current);
    } catch (cause) {
      if (generation === layoutGeneration.current) setLayoutError((cause as Error).message);
    } finally {
      if (generation === layoutGeneration.current) setLayoutLoading(false);
    }
  };
  const optimizeThrough = async () => {
    if (!room || !selectedFace?.polygon) return;
    const generation = ++layoutGeneration.current;
    const capturedKey = roomLayoutKey({ ...doc, sharedGrid: null }, room, selectedFace, null);
    setLayoutLoading(true);
    setLayoutError("");
    setLayoutNotice("");
    try {
      const variants = (await api<{ variants: Layout[] }>("v5/optimize",
        roomLayoutRequest(room, selectedFace, null))).variants;
      if (generation !== layoutGeneration.current) return;
      if (!variants.length) throw new Error("Варианты раскладки не найдены.");
      const selected = variants[0];
      const linkedRoomIds = doc.rooms.flatMap(candidate => {
        if (candidate.id === room.id || candidate.binding !== "attached") return [];
        const face = response?.faces.find(item => item.topologyKey === candidate.topologyKey);
        return face?.polygon && face.validation.valid ? [candidate.id] : [];
      });
      setLayoutCache(cache => ({ ...cache, [room.id]: {
        key: capturedKey, variants, selected: 0,
      } }));
      update(current => ({ ...current, sharedGrid: {
        referenceRoomId: room.id,
        referenceBasis: roomLayoutBasis(room, selectedFace),
        tile: room.material.tile, grout: room.material.grout,
        angle: selected.angle, offsetX: selected.offset_x, offsetY: selected.offset_y,
        linkedRoomIds,
      } }));
    } catch (cause) {
      if (generation === layoutGeneration.current) setLayoutError((cause as Error).message);
    } finally {
      if (generation === layoutGeneration.current) setLayoutLoading(false);
    }
  };
  const resetLayout = () => {
    layoutGeneration.current++;
    failedAutomaticLayouts.current.clear();
    setLayoutLoading(false);
    setSharedLoading(false);
    setLayoutError("");
    if (layoutScope === "through") {
      setLayoutCache({});
      if (doc.sharedGrid) update(current => ({ ...current, sharedGrid: null }));
      setLayoutNotice("Сквозная раскладка сброшена. Параметры и стены сохранены.");
      return;
    }
    if (room) setLayoutCache(cache => {
      const next = { ...cache };
      delete next[room.id];
      return next;
    });
    setLayoutNotice("Раскладка помещения сброшена. Параметры и стены сохранены.");
  };
  useEffect(() => {
    if (!layoutMode || !sharedGrid || !response || response.status === "invalid" ||
        JSON.stringify(response.graph) !== JSON.stringify(doc.plan.draft)) return;
    const pending = [sharedGrid.referenceRoomId, ...sharedGrid.linkedRoomIds].flatMap(id => {
      const candidate = doc.rooms.find(item => item.id === id);
      const face = response.faces.find(item => item.topologyKey === candidate?.topologyKey);
      if (!candidate || candidate.binding !== "attached" || !face?.polygon || !face.validation.valid) return [];
      const key = roomLayoutKey(doc, candidate, face, sharedGrid);
      return layoutCache[id]?.key === key || failedAutomaticLayouts.current.has(`${id}:${key}`)
        ? [] : [{ id, key, candidate, face }];
    });
    if (!pending.length) { setSharedLoading(false); return; }
    const controller = new AbortController();
    setSharedLoading(true);
    Promise.allSettled(pending.map(item => api<Layout>("v5/layout",
      roomLayoutRequest(item.candidate, item.face, sharedGrid), controller.signal))).then(results => {
      if (controller.signal.aborted) return;
      const completed = results.flatMap((result, index) =>
        result.status === "fulfilled" ? [{ id: pending[index].id,
          key: pending[index].key, layout: result.value }] : []);
      const failures = results.flatMap((result, index) => {
        if (result.status === "fulfilled") return [];
        failedAutomaticLayouts.current.add(`${pending[index].id}:${pending[index].key}`);
        return [`${pending[index].candidate.name}: ${(result.reason as Error).message}`];
      });
      setLayoutCache(cache => {
        const next = { ...cache };
        for (const result of completed) next[result.id] = {
          key: result.key, variants: [result.layout], selected: 0,
        };
        return next;
      });
      setLayoutError(failures.length ? failures.join("; ") : "");
    }).finally(() => { if (!controller.signal.aborted) setSharedLoading(false); });
    return () => controller.abort();
  }, [layoutMode, sharedGrid, response, doc.plan.draft, doc.rooms, layoutCache]);
  const roomField = (kind: "material" | "rules", key: string, label: string,
    min: number, max: number, unit: string) => room && <NumberField
      label={label} value={(room[kind] as Record<string, number>)[key]}
      raw={room.fieldInputs[key]} min={min} max={max} unit={unit}
      onCommit={(number, text) => update(current => ({ ...current,
        rooms: current.rooms.map(item => item.id === room.id ? {
          ...item,
          [kind]: number !== null && isTenth(number) && number >= min && number <= max
            ? { ...item[kind], [key]: number } : item[kind],
          fieldInputs: { ...item.fieldInputs, [key]: text },
        } : item),
      }))} />;
  useEffect(() => {
    if (!response || response.status === "invalid" ||
        JSON.stringify(response.graph) !== JSON.stringify(doc.plan.draft)) return;
    const faceKeys = new Set(response.faces.map(face => face.topologyKey));
    const known = new Set(doc.rooms.map(item => item.topologyKey));
    const missing = response.faces.filter(face => !known.has(face.topologyKey));
    const rebinding = doc.rooms.some(item => (item.binding === "attached") !== faceKeys.has(item.topologyKey ?? ""));
    if (!missing.length && !rebinding) return;
    update(current => {
      const next = current.rooms.map(item => ({ ...item,
        binding: faceKeys.has(item.topologyKey ?? "") ? "attached" as const : "detached" as const }));
      let suffix = Math.max(0, ...next.map(item => Number(/^Помещение (\d+)$/.exec(item.name)?.[1] ?? 0)));
      for (const face of missing) {
        if (next.some(item => item.topologyKey === face.topologyKey)) continue;
        const created = newRoom(face.topologyKey, `Помещение ${++suffix}`);
        next.push({ ...created, confirmed: null });
      }
      return { ...current, rooms: next };
    });
  }, [response, doc.plan.draft, doc.rooms, update]);
  const setMode = (mode: "object" | "variants") => {
    update(current => ({ ...current, workflow: { requestedStage: mode } }));
    setMenuOpen(false);
    setProjectMenu(false);
    setWallTool(false);
    setDoorTool(false);
    setInteractionTool("select");
  };
  const activateInteractionTool = (tool: "select" | "delete") => {
    setInteractionTool(tool);
    setWallTool(false);
    setDoorTool(false);
    setProjectMenu(false);
    setPendingElementDeletion(null);
    setDeleteWallError("");
    if (tool === "delete") {
      chooseWall(null);
      chooseDoor(null);
    }
  };
  const requestWallDeletion = async (wallId: string) => {
    if (busy || deleteWallLoading) return;
    const generation = ++deletionGeneration.current;
    setDeleteWallLoading(true);
    setDeleteWallError("");
    try {
      const preview = await physicalDeletionPreview(doc, wallId);
      if (generation !== deletionGeneration.current) return;
      if (preview.status === "ready" && preview.impact)
        setPendingElementDeletion({ kind: "wall", wallId, impact: preview.impact });
      else setDeleteWallError(preview.issues[0]?.message ?? "Удаление недоступно.");
    } catch (cause) {
      if (generation === deletionGeneration.current) setDeleteWallError((cause as Error).message);
    } finally {
      if (generation === deletionGeneration.current) setDeleteWallLoading(false);
    }
  };
  const requestDoorDeletion = (openingId: string) => {
    if (busy) return;
    const opening = (doc.plan.draft.openings ?? []).find(item => item.id === openingId);
    if (opening) setPendingElementDeletion({ kind: "door", openingId, widthMm: opening.widthMm });
  };
  return <div className="app physical-editor" style={{ position: "relative", height: "100dvh", overflow: "hidden" }}>
    <PhysicalCanvas graph={doc.plan.draft} draftRevision={doc.plan.draftRevision}
      wallArea={response?.wallArea ?? []}
      faces={response?.faces ?? []} selectedRoomKey={room?.topologyKey}
      highlightRooms={layoutMode} roomMissing={roomMissing}
      roomNames={Object.fromEntries(doc.rooms.filter(item => item.topologyKey).map(item => [item.topologyKey!, item.name]))}
      layouts={layoutMode ? visibleLayouts : []}
      onSelectRoom={key => update(current => ({ ...current,
        selectedRoomId: current.rooms.find(item => item.topologyKey === key)?.id ?? null }))}
      viewport={doc.viewport} onViewport={viewport => update(current => ({ ...current, viewport }))}
      selectedWallId={selectedWallId} onSelectWall={chooseWall}
      selectedDoorId={selectedDoorId} onSelectDoor={chooseDoor}
      deleteTool={interactionTool === "delete" && !layoutMode}
      onDeleteWall={wallId => { void requestWallDeletion(wallId); }}
      onDeleteDoor={requestDoorDeletion}
      selectedHandle={selectedHandle} onSelectHandle={setSelectedHandle}
      onNudge={(handle, axis, direction) => {
        if (selectedWallId && !busy) void command({ type: "nudgeWallHandle",
          wallId: selectedWallId, handle, axis, direction });
      }}
      wallTool={wallTool && !layoutMode} thicknessMm={thicknessValid ? thickness : 100}
      onDrawWall={edge => { if (thicknessValid && !busy) void drawWall(edge, "left", thickness); }}
      onResetWallTool={() => setWallTool(false)}
      doorTool={doorTool && !layoutMode} doorWidthMm={doorWidthValid ? doorWidth : 800}
      onPlaceDoor={(wallId, offsetMm) => {
        if (doorWidthValid && !busy) void command({ type: "addDoorOpening", wallId, offsetMm,
          widthMm: doorWidth });
      }}
      onResetDoorTool={() => setDoorTool(false)} />
    <div className="canvas-sidebar-shell" data-overlay style={{ position: "absolute", top: 12, left: 12 }}>
      <button className="canvas-sidebar-toggle" aria-label={menuOpen ? "Свернуть меню" : "Раскрыть меню"}
        aria-expanded={menuOpen} onClick={() => setMenuOpen(value => !value)}>
        {menuOpen ? <ChevronsLeft /> : <ChevronsRight />}
      </button>
      {menuOpen && <aside className="canvas-sidebar" aria-label="Управление планом">
        <div className="canvas-title"><strong>{doc.name}</strong><small>{doc.address || "Адрес не указан"}</small></div>
        <button aria-label="Проекты" title="Проекты" onClick={onBack}><ArrowLeft /></button>
        {!layoutMode && <button aria-label="Стена" title="Стена" aria-pressed={wallTool}
          onClick={() => { setWallTool(value => !value); setDoorTool(false); chooseDoor(null);
            setInteractionTool("select");
            setMenuOpen(false); setProjectMenu(false); }}><PencilRuler /></button>}
        {!layoutMode && <button aria-label="Дверной проём" title="Дверной проём" aria-pressed={doorTool}
          onClick={() => { setDoorTool(value => !value); setWallTool(false); chooseWall(null);
            setInteractionTool("select");
            setMenuOpen(false); setProjectMenu(false); }}><DoorOpen /></button>}
        <button aria-label="Проект" title="Проект" onClick={() => { setProjectMenu(value => !value); setMenuOpen(false); }}><FolderOpen /></button>
        <button aria-label="Отменить правку" title="Отменить правку" disabled={!project.canUndo || busy}
          onClick={() => project.undo()}><RotateCcw /></button>
      </aside>}
    </div>
    <div className="physical-mode-switch" role="group" aria-label="Режим проекта" data-overlay>
      <button type="button" aria-pressed={!layoutMode} onClick={() => setMode("object")}>
        <PencilRuler aria-hidden="true" />
        <span>План</span>
      </button>
      <button type="button" aria-pressed={layoutMode} onClick={() => setMode("variants")}>
        <Grid3X3 aria-hidden="true" />
        <span>Раскладка</span>
      </button>
    </div>
    {!layoutMode && <div className="physical-interaction-tools" role="toolbar"
      aria-label="Действие с элементами плана" data-overlay>
      <button type="button" aria-label="Выбрать элемент" title="Выбрать элемент"
        aria-pressed={interactionTool === "select" && !wallTool && !doorTool}
        onClick={() => activateInteractionTool("select")}>
        <MousePointer2 aria-hidden="true" />
      </button>
      <button type="button" className="physical-delete-tool"
        aria-label={deleteWallLoading ? "Проверяем удаление" : "Удалить элемент"}
        title={deleteWallLoading ? "Проверяем удаление" : "Удалить элемент"}
        aria-pressed={interactionTool === "delete" && !wallTool && !doorTool}
        disabled={deleteWallLoading || busy}
        onClick={() => activateInteractionTool("delete")}>
        {deleteWallLoading ? <LoaderCircle className="is-loading" aria-hidden="true" />
          : <Trash2 aria-hidden="true" />}
      </button>
    </div>}
    {deleteWallError && <div className="physical-delete-error" role="alert" data-overlay>
      {deleteWallError}
    </div>}
    {(wallTool || doorTool || selected || selectedDoor || projectMenu || layoutMode || doc.plan.pendingEdit) && <aside className="canvas-panel" data-overlay data-layout-mode={layoutMode || undefined}
      style={{ position: "absolute", right: 12, top: 62, maxWidth: "min(340px, calc(100vw - 72px))", maxHeight: "calc(100dvh - 138px)", overflowY: "auto" }}>
      {wallTool && !layoutMode && <button type="button" className="physical-reset-wall-tool"
        onClick={() => setWallTool(false)} title="Также можно нажать Esc без начатой стены">
        <X aria-hidden="true" />
        <span>Завершить инструмент «Стена»</span>
      </button>}
      {doorTool && !layoutMode && <button type="button" className="physical-reset-wall-tool"
        onClick={() => setDoorTool(false)} title="Также можно нажать Esc">
        <X aria-hidden="true" />
        <span>Завершить инструмент «Дверь»</span>
      </button>}
      {projectMenu ? <>
        <ProjectMenu doc={doc} embedded onUpdate={update} onClose={() => setProjectMenu(false)}
          onClear={() => setConfirmClear(true)} onDelete={() => setConfirmDelete(true)}
          onRestore={() => {
            const snapshot = doc.plan.restorePoint;
            if (!snapshot) return;
            update(current => ({ ...current, plan: { ...current.plan,
              draft: snapshot.graph, draftRevision: current.plan.draftRevision + 1,
              restorePoint: null, pendingEdit: null },
              rooms: current.rooms.map(item => {
                const match = snapshot.bindings.find(binding => binding.roomId === item.id);
                return match ? { ...item, topologyKey: match.topologyKey, binding: "attached" as const } : item;
              }),
              selectedRoomId: snapshot.selectedRoomId }));
          }} />
        {confirmClear && <div role="dialog" aria-label="Очистить проект">
          <p>Все стены и помещения проекта будут удалены.</p>
          <button onClick={() => setConfirmClear(false)}>Отмена</button>
          <button className="danger" onClick={() => {
            update(current => ({ ...current, plan: { ...current.plan,
              draft: { walls: [], junctions: [], openings: [] }, draftRevision: current.plan.draftRevision + 1,
              pendingEdit: null, restorePoint: { graph: current.plan.draft,
                bindings: current.rooms.map(room => ({ roomId: room.id, topologyKey: room.topologyKey })),
                selectedRoomId: current.selectedRoomId } },
              rooms: current.rooms.map(room => ({ ...room, binding: "detached" as const })),
              selectedRoomId: null }));
            setSelectedWallId(null);
            setSelectedDoorId(null);
            setConfirmClear(false);
          }}>Очистить проект</button>
        </div>}
        {confirmDelete && <div role="dialog" aria-label="Удалить проект">
          <p>Проект будет удалён без возможности восстановления.</p>
          {deleteProjectError && <p role="alert" className="error">{deleteProjectError}</p>}
          <button disabled={deleting} onClick={() => setConfirmDelete(false)}>Отмена</button>
          <button className="danger" disabled={deleting} onClick={async () => {
            setDeleting(true);
            setDeleteProjectError("");
            try {
              const result = await deleteV6(doc.id, doc.documentRevision);
              if (result.status === "conflict") setDeleteProjectError("Проект изменён в другой вкладке. Обновите страницу перед удалением.");
              else onRemoved(result);
            } catch (cause) { setDeleteProjectError((cause as Error).message); }
            finally { setDeleting(false); }
          }}>Удалить проект</button>
        </div>}
      </> : layoutMode ? <>
        <h2>Раскладка</h2>
        {room && selectedFace?.polygon ? <Suspense fallback={
          <div className="room-preview-loading" role="status">Загружаем 3D-просмотр…</div>
        }>
          <RoomPreview3D polygon={selectedFace.polygon} layout={activeLayout}
            roomName={room.name} tileSize={sharedGrid?.tile ?? room.material.tile} />
        </Suspense> : null}
        {room && selectedFace ? <>
          <fieldset className="layout-scope">
            <legend><span className="layout-step-number">1</span> Выберите способ</legend>
            <div role="group" aria-label="Область расчёта раскладки">
              <button type="button" aria-pressed={layoutScope === "room"} onClick={() => {
                setLayoutScope("room");
                if (doc.sharedGrid) update(current => ({ ...current, sharedGrid: null }));
              }}>{layoutScope === "room" && <Check aria-hidden="true" />}<span>Одно помещение</span></button>
              <button type="button" aria-pressed={layoutScope === "through"} onClick={() =>
                setLayoutScope("through")}>{layoutScope === "through" && <Check aria-hidden="true" />}
                <span>Сквозная раскладка</span></button>
            </div>
            <p className="muted">{layoutScope === "through"
              ? "Одна сетка для всех помещений: швы продолжаются через стены, а стены исключаются из площади плитки."
              : "Каждое помещение получает независимую сетку и может иметь собственное положение швов."}</p>
          </fieldset>
          <section className="layout-step" aria-labelledby="layout-params-step">
            <div className="layout-step-heading">
              <span className="layout-step-number">2</span>
              <div><h3 id="layout-params-step">Задайте параметры</h3>
                <p>{layoutScope === "through"
                  ? `Плитка, шов и угол — для всей сетки. Отступ и подрезка — для «${room.name}».`
                  : `Для помещения «${room.name}».`}</p></div>
            </div>
            <label>Название помещения<input aria-label="Название помещения" value={room.name}
              onChange={event => update(current => ({ ...current,
                rooms: current.rooms.map(item => item.id === room.id ? { ...item, name: event.target.value } : item) }))} /></label>
            <p>Полезная площадь: {selectedFace.areaMm2 === null ? "—" : displayTenth(selectedFace.areaMm2)} мм²</p>
          {doc.sharedGrid && !sharedGrid && <p role="status">
            Опорная раскладка устарела. Выберите {referenceRoom?.name ?? "опорное помещение"} и рассчитайте её заново.
          </p>}
          {layoutScope === "through" || !linked ? <>
            {roomField("material", "tile", "Сторона плитки", 50, 2000, "мм")}
            {roomField("material", "grout", "Ширина шва", 0, 20, "мм")}
          </> : <p>Плитка {displayTenth(sharedGrid?.tile ?? room.material.tile)} мм, шов {
            displayTenth(sharedGrid?.grout ?? room.material.grout)} мм — как в помещении «{referenceRoom?.name}».</p>}
          {roomField("rules", "gap", "Отступ", 0, 100, "мм")}
          {roomField("rules", "threshold", "Минимальный размер подрезки", 1, 1000, "мм")}
          {(layoutScope === "through" || !linked) && roomField("rules", "angle", "Угол раскладки", 0, 89.9, "°")}
          </section>
          <button disabled={layoutLoading || !selectedFace.validation.valid ||
              (layoutScope === "through" && doc.rooms.filter(item => item.binding === "attached").length < 2) ||
              (layoutScope === "room" && linked && !sharedGrid)}
            onClick={() => void (layoutScope === "through" ? optimizeThrough() : optimize())}>
            {layoutLoading ? "Рассчитываем…" : layoutScope === "through"
              ? `${sharedGrid ? "Пересчитать" : "Рассчитать"} ${
                roomCountText(doc.rooms.filter(item => item.binding === "attached").length)} от «${room.name}»`
              : linked ? "Рассчитать с общей сеткой" : "Подобрать раскладку"}
          </button>
          {sharedLoading && <p role="status">Переносим линии плитки в подключённые помещения…</p>}
          {layoutError && <p role="alert" className="error">{layoutError}</p>}
          {layoutNotice && <p role="status" className="layout-notice">{layoutNotice}</p>}
          {cachedLayout && cachedLayout.key !== layoutKey && <p role="status">Раскладка требует пересчёта.</p>}
          {layoutScope === "through" && sharedGrid && <div className="layout-success" role="status">
            <strong>Сквозная раскладка готова</strong>
            <span>{roomCountText(1 + sharedGrid.linkedRoomIds.length)} одной сеткой. Начало — «{referenceRoom?.name}».</span>
            <small>Швы продолжаются через стены; площадь стен в плитку не включена.</small>
          </div>}
          {cachedLayout?.key === layoutKey && <>
            <p>Плиток: {activeLayout?.metrics.tiles ?? 0}; отход: {activeLayout?.metrics.waste_percent ?? 0}%</p>
            <div className="variant-list">{cachedLayout.variants.map((variant, index) =>
              <button key={index} aria-pressed={cachedLayout.selected === index}
                onClick={() => {
                  setLayoutCache(cache => ({ ...cache,
                    [room.id]: { ...cache[room.id], selected: index } }));
                  if (doc.sharedGrid?.referenceRoomId === room.id)
                    update(current => current.sharedGrid?.referenceRoomId === room.id ? ({ ...current,
                      sharedGrid: { ...current.sharedGrid, referenceBasis: roomLayoutBasis(room, selectedFace),
                        tile: room.material.tile, grout: room.material.grout, angle: variant.angle,
                        offsetX: variant.offset_x, offsetY: variant.offset_y } }) : current);
                }}>
                {variant.title || (linked ? "Общая сетка" : `Вариант ${index + 1}`)}
              </button>)}</div>
            {activeLayout && <div className="physical-result-exports">
              <button onClick={() => exportResult("svg", activeLayout)}>Скачать план · SVG</button>
              <button onClick={() => exportResult("csv", activeLayout)}>Таблица деталей · CSV</button>
            </div>}
          </>}
          {(layoutScope === "through" ? !!doc.sharedGrid || visibleLayouts.length > 0 : !!activeLayout) &&
            <button type="button" className="layout-reset" onClick={resetLayout}>
              <RotateCcw aria-hidden="true" />
              <span>Сбросить раскладку</span>
            </button>}
        </> : room ? <p role="status">{response === null ? "Проверяем геометрию помещения…"
          : "Полезный контур помещения разомкнут или разделён. Соедините стены, чтобы рассчитать раскладку."}</p>
          : <p>Выберите замкнутое помещение на полотне.</p>}
      </> : <>
        {selectedDoor || doorTool ? <>
          <h2>{selectedDoor ? "Дверной проём" : "Новая дверь"}</h2>
          <label>Ширина проёма, мм<input type="number" min="300" max="3000" step="10"
            value={selectedDoor ? selectedDoorWidthInput : doorWidthInput}
            onChange={event => selectedDoor
              ? setSelectedDoorWidthInput(event.target.value) : setDoorWidthInput(event.target.value)} /></label>
          {!(selectedDoor ? selectedDoorWidthValid : doorWidthValid) && <p role="alert">
            Введите ширину от 300 до 3000 мм с шагом 10 мм.
          </p>}
          {selectedDoor ? <>
            <button disabled={busy || !selectedDoorWidthValid} onClick={() => void command({
              type: "setDoorWidth", openingId: selectedDoor.id, widthMm: selectedDoorWidth,
            })}>Применить ширину</button>
            <button onClick={() => chooseDoor(null)}>Снять выделение</button>
          </> : <>
            <p>Нажмите на стену — проём разместится по центру указанной точки.</p>
            <small className="muted">У торцов и сочленений сохраняется необходимый участок стены.</small>
          </>}
        </> : <>
        <h2>{selected ? "Стена" : "Новая стена"}</h2>
        <label>Толщина, мм<input type="number" min="10" max="100000" step="10"
          value={selected ? selectedThicknessInput : thicknessInput}
          onChange={event => selected ? setSelectedThicknessInput(event.target.value) : setThicknessInput(event.target.value)} /></label>
        {selected ? <>
          <div className="physical-handle-controls" role="group" aria-label="Точки выбранной стены">
            {(["start", "center", "end"] as const).map((handle, index) =>
              <button key={handle} aria-pressed={selectedHandle === handle}
                onClick={() => setSelectedHandle(handle)}>{["Начало", "Середина", "Конец"][index]}</button>)}
          </div>
          {selectedHandle && <div className="physical-nudge-controls" role="group" aria-label="Сдвиг точки стены">
            {([ ["x", -1, "←"], ["x", 1, "→"], ["y", 1, "↑"], ["y", -1, "↓"] ] as const)
              .map(([axis, direction, label]) => <button key={`${axis}${direction}`}
                disabled={busy} aria-label={`Сдвинуть точку стены ${label} на 1 мм`}
                onClick={() => void command({ type: "nudgeWallHandle", wallId: selected.id,
                  handle: selectedHandle, axis, direction })}>{label}</button>)}
          </div>}
          {!selectedThicknessValid && <p role="alert">Введите толщину от 10 до 100000 мм с шагом 10 мм.</p>}
          <button disabled={busy || !selectedThicknessValid} onClick={() => void command({
            type: "setWallThickness", wallId: selected.id, thicknessMm: selectedThickness,
          })}>Применить толщину</button>
          <button onClick={() => setSelectedWallId(null)}>Снять выделение</button>
        </> : <>
          {!thicknessValid && <p role="alert">Введите толщину от 10 до 100000 мм с шагом 10 мм.</p>}
          <p>Укажите начало и конец стены на полотне.</p>
        </>}
        </>}
      </>}
      {error && <div className="error" role="alert">
        <span>{error}</span>
        <button type="button" onClick={project.clearError}>Закрыть</button>
      </div>}
      {doc.plan.pendingEdit && !busy && <div role="group" aria-label="Незавершённое изменение">
        <button onClick={project.retryPending}>Повторить изменение</button>
        <button onClick={project.discardPending}>Отменить изменение</button>
      </div>}
    </aside>}
    {pendingElementDeletion && <div className="canvas-modal physical-delete-confirmation" data-overlay>
      <section role="alertdialog" aria-modal="true" aria-labelledby="physical-delete-title"
        onKeyDown={event => { if (event.key === "Escape") setPendingElementDeletion(null); }}>
        <h2 id="physical-delete-title">{pendingElementDeletion.kind === "wall"
          ? "Удалить стену?" : "Удалить дверной проём?"}</h2>
        {pendingElementDeletion.kind === "wall" ? <p>
          Будет удалена стена, {pendingElementDeletion.impact.junctionIds.length} связанных стыков
          {pendingElementDeletion.impact.openingIds.length
            ? ` и дверных проёмов: ${pendingElementDeletion.impact.openingIds.length}` : ""}.
          Затронутых помещений: {pendingElementDeletion.impact.affectedRoomKeys.length}.
        </p> : <p>Будет удалён дверной проём шириной {displayTenth(pendingElementDeletion.widthMm)} мм.</p>}
        <div className="delete-project-actions">
          <button ref={deleteCancelButton} type="button" disabled={busy}
            onClick={() => setPendingElementDeletion(null)}>Отмена</button>
          <button type="button" className="danger" disabled={busy} onClick={() => {
            if (pendingElementDeletion.kind === "wall") {
              void command({ type: "deleteWall", wallId: pendingElementDeletion.wallId });
              chooseWall(null);
            } else {
              void command({ type: "deleteDoorOpening", openingId: pendingElementDeletion.openingId });
              chooseDoor(null);
            }
            setPendingElementDeletion(null);
          }}>{pendingElementDeletion.kind === "wall" ? "Удалить стену" : "Удалить проём"}</button>
        </div>
      </section>
    </div>}
  </div>;
}
