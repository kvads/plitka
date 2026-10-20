import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronsLeft, ChevronsRight, FolderOpen, MousePointer2, PencilRuler, RotateCcw } from "lucide-react";
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

const displayTenth = (value: number) => value.toLocaleString("ru-RU", {
  minimumFractionDigits: 1, maximumFractionDigits: 1,
});

type Removal =
  | { status: "deleted" | "alreadyMissing"; projectId: string; projects: ProjectDocumentV6[] }
  | { status: "conflict"; projectId: string; projects: ProjectDocumentV6[]; current: ProjectDocumentV6 };

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
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [projectMenu, setProjectMenu] = useState(false);
  const [wallTool, setWallTool] = useState(false);
  const [side, setSide] = useState<"left" | "right">("left");
  const [thicknessInput, setThicknessInput] = useState("100");
  const [selectedThicknessInput, setSelectedThicknessInput] = useState("");
  const [selectedWallId, setSelectedWallId] = useState<string | null>(null);
  const [selectedHandle, setSelectedHandle] = useState<"start" | "center" | "end" | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteProjectError, setDeleteProjectError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [deleteWallImpact, setDeleteWallImpact] = useState<PhysicalDeletionImpact | null>(null);
  const [deleteWallLoading, setDeleteWallLoading] = useState(false);
  const [deleteWallError, setDeleteWallError] = useState("");
  const deletionGeneration = useRef(0);
  const [layoutCache, setLayoutCache] = useState<Record<string, { key: string; variants: Layout[]; selected: number }>>({});
  const [layoutLoading, setLayoutLoading] = useState(false);
  const [layoutError, setLayoutError] = useState("");
  const [sharedLoading, setSharedLoading] = useState(false);
  const layoutGeneration = useRef(0);
  const failedAutomaticLayouts = useRef(new Set<string>());
  const thickness = Number(thicknessInput.replace(",", "."));
  const thicknessValid = Number.isInteger(thickness / 10) && thickness >= 10 && thickness <= 100000;
  const selected = doc.plan.draft.walls.find(wall => wall.id === selectedWallId);
  useEffect(() => { if (selectedWallId && !selected) {
    setSelectedWallId(null); setSelectedHandle(null); setDeleteWallImpact(null);
  } }, [selectedWallId, selected]);
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
    setSelectedWallId(wallId);
    setSelectedHandle(null);
    setDeleteWallImpact(null);
    setDeleteWallError("");
    setSelectedThicknessInput(String(doc.plan.draft.walls.find(wall => wall.id === wallId)?.thicknessMm ?? ""));
  };
  const layoutMode = doc.workflow.requestedStage === "variants";
  useEffect(() => {
    deletionGeneration.current++;
    setDeleteWallImpact(null);
    setDeleteWallLoading(false);
  }, [doc.plan.draftRevision, selectedWallId]);
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
    setModeMenuOpen(false);
    setProjectMenu(false);
    setWallTool(false);
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
      selectedHandle={selectedHandle} onSelectHandle={setSelectedHandle}
      onNudge={(handle, axis, direction) => {
        if (selectedWallId && !busy) void command({ type: "nudgeWallHandle",
          wallId: selectedWallId, handle, axis, direction });
      }}
      wallTool={wallTool && !layoutMode} side={side} thicknessMm={thicknessValid ? thickness : 100}
      onDrawWall={edge => { if (thicknessValid && !busy) void drawWall(edge, side, thickness); }} />
    <div className="canvas-sidebar-shell" data-overlay style={{ position: "absolute", top: 12, left: 12 }}>
      <button className="canvas-sidebar-toggle" aria-label={menuOpen ? "Свернуть меню" : "Раскрыть меню"}
        aria-expanded={menuOpen} onClick={() => setMenuOpen(value => !value)}>
        {menuOpen ? <ChevronsLeft /> : <ChevronsRight />}
      </button>
      {menuOpen && <aside className="canvas-sidebar" aria-label="Управление планом">
        <div className="canvas-title"><strong>{doc.name}</strong><small>{doc.address || "Адрес не указан"}</small></div>
        <button aria-label="Проекты" title="Проекты" onClick={onBack}><ArrowLeft /></button>
        <button aria-label="План" title="План" aria-pressed={!layoutMode} onClick={() => setMode("object")}><PencilRuler /></button>
        <button aria-label="Раскладка" title="Раскладка" aria-pressed={layoutMode} onClick={() => setMode("variants")}><MousePointer2 /></button>
        {!layoutMode && <button aria-label="Стена" title="Стена" aria-pressed={wallTool}
          onClick={() => { setWallTool(value => !value); setMenuOpen(false); setProjectMenu(false); }}><PencilRuler /></button>}
        <button aria-label="Проект" title="Проект" onClick={() => { setProjectMenu(value => !value); setMenuOpen(false); }}><FolderOpen /></button>
        <button aria-label="Отменить правку" title="Отменить правку" disabled={!project.canUndo || busy}
          onClick={() => project.undo()}><RotateCcw /></button>
      </aside>}
    </div>
    <div className="physical-mode-switch">
      <button aria-label="Переключить режим" aria-expanded={modeMenuOpen} className="canvas-sidebar-toggle"
        onClick={() => setModeMenuOpen(value => !value)}>{layoutMode ? "Раскладка" : "План"}</button>
      {modeMenuOpen && <nav aria-label="Режим проекта" className="physical-mode-options">
        <button aria-current={!layoutMode ? "page" : undefined} onClick={() => setMode("object")}>План</button>
        <button aria-current={layoutMode ? "page" : undefined} onClick={() => setMode("variants")}>Раскладка</button>
      </nav>}
    </div>
    {(wallTool || selected || projectMenu || layoutMode || doc.plan.pendingEdit) && <aside className="canvas-panel" data-overlay
      style={{ position: "absolute", right: 12, top: 62, maxWidth: "min(340px, calc(100vw - 72px))", maxHeight: "calc(100dvh - 74px)", overflowY: "auto" }}>
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
              draft: { walls: [], junctions: [] }, draftRevision: current.plan.draftRevision + 1,
              pendingEdit: null, restorePoint: { graph: current.plan.draft,
                bindings: current.rooms.map(room => ({ roomId: room.id, topologyKey: room.topologyKey })),
                selectedRoomId: current.selectedRoomId } },
              rooms: current.rooms.map(room => ({ ...room, binding: "detached" as const })),
              selectedRoomId: null }));
            setSelectedWallId(null);
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
        {room && selectedFace ? <>
          <label>Помещение<input aria-label="Название помещения" value={room.name}
            onChange={event => update(current => ({ ...current,
              rooms: current.rooms.map(item => item.id === room.id ? { ...item, name: event.target.value } : item) }))} /></label>
          <p>Полезная площадь: {selectedFace.areaMm2 === null ? "—" : displayTenth(selectedFace.areaMm2)} мм²</p>
          {doc.sharedGrid && !sharedGrid && <p role="status">
            Опорная раскладка устарела. Выберите {referenceRoom?.name ?? "опорное помещение"} и рассчитайте её заново.
          </p>}
          {sharedGrid && room.id === sharedGrid.referenceRoomId && <div role="group" aria-label="Общая сетка раскладки">
            <p>Это опорное помещение. В подключённых помещениях линии плитки сохраняют положение; площадь стен исключена из укладки.</p>
            <button onClick={() => update(current => ({ ...current, sharedGrid: null }))}>
              Отключить общую сетку
            </button>
          </div>}
          {sharedGrid && room.id !== sharedGrid.referenceRoomId && <div role="group" aria-label="Общая сетка раскладки">
            <p>{linked ? `Линии плитки продолжаются из помещения «${referenceRoom?.name}».` :
              `Можно продолжить линии плитки из помещения «${referenceRoom?.name}».`}</p>
            <button onClick={() => update(current => {
              if (!current.sharedGrid) return current;
              const linkedRoomIds = linked
                ? current.sharedGrid.linkedRoomIds.filter(id => id !== room.id)
                : [...current.sharedGrid.linkedRoomIds, room.id];
              return { ...current, sharedGrid: { ...current.sharedGrid, linkedRoomIds } };
            })}>{linked ? "Отвязать от общей сетки" : `Продолжить из «${referenceRoom?.name}»`}</button>
          </div>}
          {linked && sharedGrid ? <p>
            Плитка {displayTenth(sharedGrid.tile)} мм, шов {displayTenth(sharedGrid.grout)} мм,
            угол {displayTenth(sharedGrid.angle)}° — как в опорном помещении.
          </p> : <>
            {roomField("material", "tile", "Сторона плитки", 50, 2000, "мм")}
            {roomField("material", "grout", "Ширина шва", 0, 20, "мм")}
          </>}
          {roomField("rules", "gap", "Отступ", 0, 100, "мм")}
          {roomField("rules", "threshold", "Минимальный размер подрезки", 1, 1000, "мм")}
          {!linked && roomField("rules", "angle", "Угол раскладки", 0, 89.9, "°")}
          <button disabled={layoutLoading || !selectedFace.validation.valid || (linked && !sharedGrid)}
            onClick={() => void optimize()}>{layoutLoading ? "Рассчитываем…" :
              linked ? "Рассчитать с общей сеткой" : "Подобрать раскладку"}</button>
          {sharedLoading && <p role="status">Переносим линии плитки в подключённые помещения…</p>}
          {layoutError && <p role="alert" className="error">{layoutError}</p>}
          {cachedLayout && cachedLayout.key !== layoutKey && <p role="status">Раскладка требует пересчёта.</p>}
          {cachedLayout?.key === layoutKey && <>
            <p>Плиток: {activeLayout?.metrics.tiles ?? 0}; отход: {activeLayout?.metrics.waste_percent ?? 0}%</p>
            {activeLayout && !linked && room.id !== doc.sharedGrid?.referenceRoomId &&
              <button onClick={() => update(current => ({ ...current, sharedGrid: {
                referenceRoomId: room.id,
                referenceBasis: roomLayoutBasis(room, selectedFace),
                tile: room.material.tile, grout: room.material.grout,
                angle: activeLayout.angle, offsetX: activeLayout.offset_x,
                offsetY: activeLayout.offset_y, linkedRoomIds: [],
              } }))}>Сделать опорной раскладкой</button>}
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
        </> : room ? <p role="status">{response === null ? "Проверяем геометрию помещения…"
          : "Полезный контур помещения разомкнут или разделён. Соедините стены, чтобы рассчитать раскладку."}</p>
          : <p>Выберите замкнутое помещение на полотне.</p>}
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
          <button className="danger" disabled={busy || deleteWallLoading} onClick={async () => {
            const generation = ++deletionGeneration.current;
            setDeleteWallLoading(true);
            setDeleteWallError("");
            try {
              const preview = await physicalDeletionPreview(doc, selected.id);
              if (generation !== deletionGeneration.current) return;
              if (preview.status === "ready") setDeleteWallImpact(preview.impact);
              else setDeleteWallError(preview.issues[0]?.message ?? "Удаление недоступно.");
            } catch (cause) {
              if (generation === deletionGeneration.current) setDeleteWallError((cause as Error).message);
            } finally {
              if (generation === deletionGeneration.current) setDeleteWallLoading(false);
            }
          }}>{deleteWallLoading ? "Проверяем удаление…" : "Удалить стену"}</button>
          {deleteWallError && <p className="error" role="alert">{deleteWallError}</p>}
          {deleteWallImpact && <div role="dialog" aria-label="Удалить стену">
            <p>Будет удалена стена и {deleteWallImpact.junctionIds.length} связанных стыков.
              Затронутых помещений: {deleteWallImpact.affectedRoomKeys.length}.</p>
            <button onClick={() => setDeleteWallImpact(null)}>Отмена</button>
            <button className="danger" disabled={busy} onClick={() => {
              void command({ type: "deleteWall", wallId: selected.id });
              setDeleteWallImpact(null);
            }}>Удалить стену</button>
          </div>}
        </> : <>
          {!thicknessValid && <p role="alert">Введите толщину от 10 до 100000 мм с шагом 10 мм.</p>}
          <fieldset><legend>Сторона от проведённого края</legend>
            <label><input type="radio" name="wall-side" checked={side === "left"} onChange={() => setSide("left")} />Слева</label>
            <label><input type="radio" name="wall-side" checked={side === "right"} onChange={() => setSide("right")} />Справа</label>
          </fieldset>
          <p>Укажите начало и конец стены на полотне.</p>
        </>}
      </>}
      {error && <p className="error" role="alert">{error}</p>}
      {doc.plan.pendingEdit && !busy && <div role="group" aria-label="Незавершённое изменение">
        <button onClick={project.retryPending}>Повторить изменение</button>
        <button onClick={project.discardPending}>Отменить изменение</button>
      </div>}
    </aside>}
  </div>;
}
