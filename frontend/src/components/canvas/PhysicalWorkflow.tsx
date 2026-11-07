import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Bath, Check, ChevronsLeft, ChevronsRight, Cuboid, DoorOpen, FolderOpen, Grid3X3, LoaderCircle, MousePointer2, PencilRuler, RotateCcw, Trash2, X } from "lucide-react";
import PhysicalCanvas from "./PhysicalCanvas";
import ProjectMenu from "./ProjectMenu";
import { usePhysicalProject } from "../../domain/plan/usePhysicalProject";
import { deleteV6 } from "../../domain/plan/storage";
import type { ProjectDocumentV6, ShowerTray } from "../../domain/plan/types";
import { isTenth } from "../../domain/plan/precision";
import { physicalGraphCanonicalJson } from "../../domain/plan/physical-basis";
import { newRoom } from "../../domain/plan/rooms";
import NumberField from "../workflow/NumberField";
import { api } from "../../api";
import type { Layout, LayoutRequest } from "../../types";
import { physicalDeletionPreview, type PhysicalDeletionImpact } from "../../domain/plan/deletion-api";
import { exportResult } from "../../domain/project/result-export";
import { activeSharedGrid, roomLayoutBasis, roomLayoutKey, roomLayoutRequest } from "../../domain/plan/shared-grid";
import "./canvas.css";

const RoomPreview3D = lazy(() => import("./RoomPreview3D"));
const compactViewQuery = "(max-width: 700px), (hover: none) and (pointer: coarse) and (max-height: 700px)";

const displayTenth = (value: number) => value.toLocaleString("ru-RU", {
  minimumFractionDigits: 1, maximumFractionDigits: 1,
});
const pointOnSegment = (point: [number, number], start: [number, number], end: [number, number]) => {
  const dx = end[0] - start[0], dy = end[1] - start[1];
  const length = Math.hypot(dx, dy);
  if (length < .001) return Math.hypot(point[0] - start[0], point[1] - start[1]) < .2;
  const cross = Math.abs((point[0] - start[0]) * dy - (point[1] - start[1]) * dx) / length;
  const dot = (point[0] - start[0]) * dx + (point[1] - start[1]) * dy;
  return cross <= .2 && dot >= -.2 && dot <= length * length + .2;
};
const distanceToSegment = (point: [number, number], start: [number, number], end: [number, number]) => {
  const dx = end[0] - start[0], dy = end[1] - start[1];
  const squared = dx * dx + dy * dy;
  if (squared < .001) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const ratio = Math.max(0, Math.min(1,
    ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / squared));
  return Math.hypot(point[0] - start[0] - ratio * dx, point[1] - start[1] - ratio * dy);
};
const pointInRing = (point: [number, number], ring: [number, number][]) => {
  if (ring.some((start, index) => pointOnSegment(point, start, ring[(index + 1) % ring.length]))) return true;
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const a = ring[index], b = ring[previous];
    if ((a[1] > point[1]) !== (b[1] > point[1]) &&
        point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
};
const showerFitsRoom = (tray: ShowerTray, originX: number, originY: number,
  polygon: { outline: number[][]; holes: number[][][] }, clearance = 0) => {
  if (!tray.vertices?.length) return false;
  const radians = (tray.rotationDeg ?? 0) * Math.PI / 180;
  const cosine = Math.cos(radians), sine = Math.sin(radians);
  const vertices = tray.vertices.map(([x, y]) => [originX + x * cosine - y * sine,
    originY + x * sine + y * cosine] as [number, number]);
  const outline = polygon.outline as [number, number][];
  const holes = polygon.holes as [number, number][][];
  for (let index = 0; index < vertices.length; index++) {
    const start = vertices[index], end = vertices[(index + 1) % vertices.length];
    for (let step = 0; step <= 16; step++) {
      const ratio = step / 16;
      const point: [number, number] = [start[0] + (end[0] - start[0]) * ratio,
        start[1] + (end[1] - start[1]) * ratio];
      if (!pointInRing(point, outline) || holes.some(hole => pointInRing(point, hole))) return false;
      const nearBoundary = (ring: [number, number][]) => ring.some((edgeStart, edgeIndex) =>
        distanceToSegment(point, edgeStart, ring[(edgeIndex + 1) % ring.length]) < clearance - .05);
      if (clearance > 0 && (nearBoundary(outline) || holes.some(nearBoundary))) return false;
    }
  }
  return true;
};
const constrainedShowerOrigin = (tray: ShowerTray, delta: { x: number; y: number },
  polygon: { outline: number[][]; holes: number[][][] }, clearance = 0) => {
  const startX = tray.originX ?? 0, startY = tray.originY ?? 0;
  const desiredX = Math.round((startX + delta.x) * 10) / 10;
  const desiredY = Math.round((startY + delta.y) * 10) / 10;
  if (showerFitsRoom(tray, desiredX, desiredY, polygon, clearance)) return { x: desiredX, y: desiredY };
  let low = 0, high = 1;
  for (let iteration = 0; iteration < 24; iteration++) {
    const ratio = (low + high) / 2;
    const x = startX + delta.x * ratio, y = startY + delta.y * ratio;
    if (showerFitsRoom(tray, x, y, polygon, clearance)) low = ratio;
    else high = ratio;
  }
  return { x: Math.round((startX + delta.x * low) * 10) / 10,
    y: Math.round((startY + delta.y * low) * 10) / 10 };
};
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
  const responseMatchesDraft = useMemo(() => !!response &&
    physicalGraphCanonicalJson(response.graph) === physicalGraphCanonicalJson(doc.plan.draft),
  [response, doc.plan.draft]);
  const [menuOpen, setMenuOpen] = useState(() => !window.matchMedia("(hover: none) and (pointer: coarse)").matches);
  const [projectMenu, setProjectMenu] = useState(false);
  const [wallTool, setWallTool] = useState(false);
  const [doorTool, setDoorTool] = useState(false);
  const [thicknessInput, setThicknessInput] = useState("100");
  const [doorWidthInput, setDoorWidthInput] = useState("800");
  const [selectedDoorWidthInput, setSelectedDoorWidthInput] = useState("");
  const [selectedDoorRevealInput, setSelectedDoorRevealInput] = useState("");
  const [selectedDoorOppositeRevealInput, setSelectedDoorOppositeRevealInput] = useState("");
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
  const [room3D, setRoom3D] = useState(false);
  const [showerTool, setShowerTool] = useState(false);
  const [compactView, setCompactView] = useState(() => window.matchMedia(compactViewQuery).matches);
  const [viewRoomId, setViewRoomId] = useState(initial.selectedRoomId);
  const [viewViewport, setViewViewport] = useState(initial.viewport);
  const layoutGeneration = useRef(0);
  const failedAutomaticLayouts = useRef(new Set<string>());
  const thickness = Number(thicknessInput.replace(",", "."));
  const thicknessValid = Number.isInteger(thickness / 10) && thickness >= 10 && thickness <= 100000;
  const selected = doc.plan.draft.walls.find(wall => wall.id === selectedWallId);
  const selectedDoor = (doc.plan.draft.openings ?? []).find(opening => opening.id === selectedDoorId);
  const selectedDoorWall = doc.plan.draft.walls.find(wall => wall.id === selectedDoor?.wallId);
  const doorWidth = Number(doorWidthInput.replace(",", "."));
  const doorWidthValid = Number.isInteger(doorWidth / 10) && doorWidth >= 300 && doorWidth <= 3000;
  const selectedDoorWidth = Number(selectedDoorWidthInput.replace(",", "."));
  const selectedDoorWidthValid = Number.isInteger(selectedDoorWidth / 10) && selectedDoorWidth >= 300 && selectedDoorWidth <= 3000;
  const selectedDoorReveal = Number(selectedDoorRevealInput.replace(",", "."));
  const selectedDoorOppositeReveal = Number(selectedDoorOppositeRevealInput.replace(",", "."));
  const selectedDoorRevealValid = !!selectedDoorWall && isTenth(selectedDoorReveal) &&
    isTenth(selectedDoorOppositeReveal) && selectedDoorReveal >= 0 && selectedDoorOppositeReveal >= 0 &&
    Math.abs(selectedDoorReveal + selectedDoorOppositeReveal - selectedDoorWall.thicknessMm) < 0.05;
  useEffect(() => { if (selectedWallId && !selected) {
    setSelectedWallId(null); setSelectedHandle(null);
  } }, [selectedWallId, selected]);
  useEffect(() => { if (selectedDoorId && !selectedDoor) setSelectedDoorId(null); }, [selectedDoorId, selectedDoor]);
  useEffect(() => {
    const media = window.matchMedia(compactViewQuery);
    const changed = () => setCompactView(media.matches);
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, []);
  useEffect(() => {
    if (!compactView) return;
    setViewRoomId(doc.selectedRoomId);
    setViewViewport(doc.viewport);
    setWallTool(false);
    setDoorTool(false);
    setInteractionTool("select");
    setProjectMenu(false);
  }, [compactView]);
  const room = doc.rooms.find(item => item.id === (compactView ? viewRoomId : doc.selectedRoomId));
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
  const previewRooms = useMemo(() => {
    return doc.rooms.flatMap(candidate => {
      if (candidate.binding !== "attached") return [];
      const face = response?.faces.find(item => item.topologyKey === candidate.topologyKey);
      if (!face?.polygon || !face.validation.valid) return [];
      const cached = layoutCache[candidate.id];
      const key = roomLayoutKey(doc, candidate, face, sharedGrid);
      return [{ id: candidate.id, name: candidate.name, polygon: face.polygon,
        layout: cached?.key === key ? cached.variants[cached.selected] : null }];
    });
  }, [sharedGrid, doc, response, layoutCache]);
  const previewMultiple = previewRooms.length > 1;
  const previewThrough = layoutScope === "through" && previewMultiple;
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
    const opening = (doc.plan.draft.openings ?? []).find(opening => opening.id === openingId);
    const wall = doc.plan.draft.walls.find(wall => wall.id === opening?.wallId);
    setSelectedDoorWidthInput(String(opening?.widthMm ?? ""));
    const reveal = opening ? opening.revealDepthMm ?? (wall?.thicknessMm ?? 0) / 2 : null;
    setSelectedDoorRevealInput(reveal === null ? "" : String(reveal));
    setSelectedDoorOppositeRevealInput(reveal === null ? "" : String((wall?.thicknessMm ?? 0) - reveal));
  };
  const setDoorRevealFromOpeningSide = (value: string) => {
    setSelectedDoorRevealInput(value);
    const parsed = Number(value.replace(",", "."));
    if (selectedDoorWall && isTenth(parsed) && parsed >= 0 && parsed <= selectedDoorWall.thicknessMm)
      setSelectedDoorOppositeRevealInput(String(Math.round((selectedDoorWall.thicknessMm - parsed) * 10) / 10));
  };
  const setDoorRevealFromOppositeSide = (value: string) => {
    setSelectedDoorOppositeRevealInput(value);
    const parsed = Number(value.replace(",", "."));
    if (selectedDoorWall && isTenth(parsed) && parsed >= 0 && parsed <= selectedDoorWall.thicknessMm)
      setSelectedDoorRevealInput(String(Math.round((selectedDoorWall.thicknessMm - parsed) * 10) / 10));
  };
  const layoutMode = compactView || doc.workflow.requestedStage === "variants";
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
        !responseMatchesDraft) return;
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
  }, [layoutMode, sharedGrid, response, responseMatchesDraft, doc.plan.draft, doc.rooms, layoutCache]);
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
  const showerField = (key: keyof Pick<ShowerTray, "drainX" | "drainY" | "drainWidth" |
    "drainLength" | "slopePercent" | "originX" | "originY" | "rotationDeg" |
    "baseHeightMm" | "recessDepthMm">, label: string, min: number, max: number, unit: string) =>
    room?.showerTray && <NumberField label={label} value={room.showerTray[key] ?? 0}
      raw={room.fieldInputs[`shower.${key}`]} min={min} max={max} unit={unit}
      onCommit={(number, text) => update(current => ({ ...current,
        rooms: current.rooms.map(item => item.id === room.id && item.showerTray ? {
          ...item,
          showerTray: number !== null && isTenth(number) && number >= min && number <= max
            ? { ...item.showerTray, [key]: number,
              ...(key === "drainWidth" && item.showerTray.drainType === "point"
                ? { drainLength: number } : {}),
              ...(key === "baseHeightMm" ? {
                recessDepthMm: Math.min(item.showerTray.recessDepthMm ?? 0, number),
              } : {}) } : item.showerTray,
          fieldInputs: { ...item.fieldInputs, [`shower.${key}`]: text },
        } : item),
      }))} />;
  const toggleShowerTray = (enabled: boolean, placement?: { x: number; y: number },
    targetRoom = room, targetFace = selectedFace) => {
    if (!targetRoom) return;
    const outline = (targetFace?.polygon?.outline ?? []) as [number, number][];
    const xs = outline.map(point => point[0]), ys = outline.map(point => point[1]);
    const minX = xs.length ? Math.min(...xs) : 0, maxX = xs.length ? Math.max(...xs) : 1200;
    const minY = ys.length ? Math.min(...ys) : 0, maxY = ys.length ? Math.max(...ys) : 1200;
    const centerX = placement?.x ?? (minX + maxX) / 2;
    const centerY = placement?.y ?? (minY + maxY) / 2;
    const roomWidth = xs.length ? Math.max(...xs) - Math.min(...xs) : 1200;
    const roomHeight = ys.length ? Math.max(...ys) - Math.min(...ys) : 1200;
    const width = Math.max(300, Math.min(900, Math.floor(roomWidth * .7 / 10) * 10));
    const height = Math.max(300, Math.min(900, Math.floor(roomHeight * .7 / 10) * 10));
    const originX = Math.round(Math.max(minX, Math.min(maxX - width, centerX - width / 2)) * 10) / 10;
    const originY = Math.round(Math.max(minY, Math.min(maxY - height, centerY - height / 2)) * 10) / 10;
    const initialTray: ShowerTray = {
      id: `shower-${targetRoom.id}`, originX, originY, rotationDeg: 0,
      baseHeightMm: 150, recessDepthMm: 40,
      vertices: [[0, 0], [width, 0], [width, height], [0, height]],
      edges: [0, 1, 2, 3].map(index => ({ id: `edge-${index + 1}`, kind: "open" as const })),
      drainType: "linear", drainX: width / 2, drainY: Math.min(140, height / 3),
      drainWidth: 70, drainLength: Math.max(200, Math.min(700, width - 100)),
      drainOrientation: "horizontal", slopePercent: 2,
    };
    setLayoutScope("room");
    update(current => ({ ...current, sharedGrid: enabled ? null : current.sharedGrid,
      selectedRoomId: targetRoom.id,
      rooms: current.rooms.map(item => item.id === targetRoom.id
        ? { ...item, showerTray: enabled ? item.showerTray ?? initialTray : null } : item) }));
  };
  const updateShowerTray = (change: Partial<ShowerTray>) => {
    if (!room) return;
    update(current => ({ ...current, rooms: current.rooms.map(item =>
      item.id === room.id && item.showerTray
        ? { ...item, showerTray: { ...item.showerTray, ...change } } : item) }));
  };
  useEffect(() => {
    if (!response || !responseMatchesDraft) return;
    const faceKeys = new Set(response.faces.map(face => face.topologyKey));
    const known = new Set(doc.rooms.map(item => item.topologyKey));
    const missing = response.faces.filter(face => !known.has(face.topologyKey));
    const rebinding = doc.rooms.some(item => (item.binding === "attached") !== faceKeys.has(item.topologyKey ?? ""));
    const orphanShower = doc.rooms.some(item => item.showerTray && !faceKeys.has(item.topologyKey ?? ""));
    if (!missing.length && !rebinding && !orphanShower) return;
    update(current => {
      const next = current.rooms.map(item => {
        const attached = faceKeys.has(item.topologyKey ?? "");
        return { ...item, binding: attached ? "attached" as const : "detached" as const,
          showerTray: attached ? item.showerTray : null };
      });
      let suffix = Math.max(0, ...next.map(item => Number(/^Помещение (\d+)$/.exec(item.name)?.[1] ?? 0)));
      for (const face of missing) {
        if (next.some(item => item.topologyKey === face.topologyKey)) continue;
        const created = newRoom(face.topologyKey, `Помещение ${++suffix}`);
        next.push({ ...created, showerTray: created.showerTray ?? null, confirmed: null });
      }
      return { ...current, rooms: next };
    });
  }, [response, responseMatchesDraft, doc.plan.draft, doc.rooms, update]);
  const setMode = (mode: "object" | "variants") => {
    update(current => ({ ...current, workflow: { requestedStage: mode } }));
    setRoom3D(false);
    setMenuOpen(false);
    setProjectMenu(false);
    setWallTool(false);
    setDoorTool(false);
    setShowerTool(false);
    setInteractionTool("select");
  };
  const showRoomPreview = () => {
    if (!layoutMode)
      update(current => ({ ...current, workflow: { requestedStage: "variants" } }));
    setRoom3D(true);
    setMenuOpen(false);
    setProjectMenu(false);
    setWallTool(false);
    setDoorTool(false);
    setShowerTool(false);
    setInteractionTool("select");
  };
  useEffect(() => {
    if (!room3D) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setRoom3D(false);
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [room3D]);
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
    {room3D ? <div className="room-preview-fullscreen">
      {previewRooms.length ? <Suspense fallback={
        <div className="room-preview-fullscreen-loading" role="status">Загружаем 3D-помещение…</div>
      }>
        <RoomPreview3D rooms={previewRooms}
          title={previewThrough ? "Сквозная раскладка" : previewMultiple ? "Все помещения" : previewRooms[0].name}
          tileSize={sharedGrid?.tile ?? room?.material.tile ?? 0} through={previewThrough}
          multiRoom={previewMultiple}
          graph={doc.plan.draft} />
      </Suspense> : <div className="room-preview-empty" role="status">
        <Cuboid aria-hidden="true" />
        <strong>Нет выбранного помещения</strong>
        <span>Вернитесь в режим «Раскладка» и выберите замкнутое помещение.</span>
      </div>}
    </div> : <PhysicalCanvas graph={doc.plan.draft} draftRevision={doc.plan.draftRevision}
      wallArea={response?.wallArea ?? []}
      faces={response?.faces ?? []} selectedRoomKey={room?.topologyKey}
      highlightRooms={layoutMode} roomMissing={roomMissing}
      roomNames={Object.fromEntries(doc.rooms.filter(item => item.topologyKey).map(item => [item.topologyKey!, item.name]))}
      layouts={layoutMode ? visibleLayouts : []}
      showerObjects={layoutMode ? doc.rooms.flatMap(candidate => candidate.binding === "attached" && candidate.showerTray?.vertices
        ? [{ roomId: candidate.id, tray: candidate.showerTray, selected: candidate.id === room?.id }]
        : []) : []}
      showerTool={!compactView && layoutMode && showerTool}
      onPlaceShower={(roomKey, point) => {
        const targetRoom = doc.rooms.find(candidate => candidate.topologyKey === roomKey);
        const targetFace = response?.faces.find(candidate => candidate.topologyKey === roomKey);
        if (targetRoom && targetFace) toggleShowerTray(true, point, targetRoom, targetFace);
        setShowerTool(false);
      }}
      onMoveShower={(roomId, delta) => {
        const targetRoom = doc.rooms.find(candidate => candidate.id === roomId);
        const targetFace = response?.faces.find(candidate => candidate.topologyKey === targetRoom?.topologyKey);
        if (!targetRoom?.showerTray || !targetFace?.polygon) return;
        const origin = constrainedShowerOrigin(targetRoom.showerTray, delta, targetFace.polygon,
          targetRoom.rules.gap);
        if (origin.x === targetRoom.showerTray.originX && origin.y === targetRoom.showerTray.originY) return;
        update(current => ({ ...current, rooms: current.rooms.map(candidate =>
          candidate.id === roomId && candidate.showerTray ? { ...candidate,
            showerTray: { ...candidate.showerTray, originX: origin.x, originY: origin.y } } : candidate) }));
      }}
      constrainShowerMove={(roomId, delta) => {
        const targetRoom = doc.rooms.find(candidate => candidate.id === roomId);
        const targetFace = response?.faces.find(candidate => candidate.topologyKey === targetRoom?.topologyKey);
        if (!targetRoom?.showerTray || !targetFace?.polygon) return { x: 0, y: 0 };
        const origin = constrainedShowerOrigin(targetRoom.showerTray, delta, targetFace.polygon,
          targetRoom.rules.gap);
        return { x: origin.x - (targetRoom.showerTray.originX ?? 0),
          y: origin.y - (targetRoom.showerTray.originY ?? 0) };
      }}
      onSelectRoom={key => {
        const id = doc.rooms.find(item => item.topologyKey === key)?.id ?? null;
        if (compactView) setViewRoomId(id);
        else update(current => ({ ...current, selectedRoomId: id }));
      }}
      viewport={compactView ? viewViewport : doc.viewport}
      onViewport={viewport => compactView ? setViewViewport(viewport)
        : update(current => ({ ...current, viewport }))}
      selectedWallId={compactView ? null : selectedWallId}
      onSelectWall={wallId => { if (!compactView) chooseWall(wallId); }}
      selectedDoorId={compactView ? null : selectedDoorId}
      onSelectDoor={openingId => { if (!compactView) chooseDoor(openingId); }}
      deleteTool={!compactView && interactionTool === "delete" && !layoutMode}
      onDeleteWall={wallId => { void requestWallDeletion(wallId); }}
      onDeleteDoor={requestDoorDeletion}
      selectedHandle={selectedHandle} onSelectHandle={setSelectedHandle}
      onNudge={(handle, axis, direction) => {
        if (selectedWallId && !busy) void command({ type: "nudgeWallHandle",
          wallId: selectedWallId, handle, axis, direction });
      }}
      wallTool={!compactView && wallTool && !layoutMode} thicknessMm={thicknessValid ? thickness : 100}
      onDrawWall={edge => { if (thicknessValid && !busy) void drawWall(edge, "left", thickness); }}
      onResetWallTool={() => setWallTool(false)}
      doorTool={!compactView && doorTool && !layoutMode} doorWidthMm={doorWidthValid ? doorWidth : 800}
      onPlaceDoor={(wallId, offsetMm) => {
        if (doorWidthValid && !busy) void command({ type: "addDoorOpening", wallId, offsetMm,
          widthMm: doorWidth });
      }}
      onResetDoorTool={() => setDoorTool(false)} />}
    <div className="canvas-sidebar-shell" data-overlay style={{ position: "absolute", top: 12, left: 12 }}>
      <button className="canvas-sidebar-toggle" aria-label={menuOpen ? "Свернуть меню" : "Раскрыть меню"}
        aria-expanded={menuOpen} onClick={() => setMenuOpen(value => !value)}>
        {menuOpen ? <ChevronsLeft /> : <ChevronsRight />}
      </button>
      {menuOpen && <aside className="canvas-sidebar" aria-label={compactView ? "Навигация по проекту" : "Управление планом"}>
        <div className="canvas-title"><strong>{doc.name}</strong><small>{doc.address || "Адрес не указан"}</small></div>
        <button aria-label="Проекты" title="Проекты" onClick={onBack}><ArrowLeft /></button>
        {!compactView && !layoutMode && <button aria-label="Стена" title="Стена" aria-pressed={wallTool}
          onClick={() => { setWallTool(value => !value); setDoorTool(false); chooseDoor(null);
            setInteractionTool("select");
            setMenuOpen(false); setProjectMenu(false); }}><PencilRuler /></button>}
        {!compactView && !layoutMode && <button aria-label="Дверной проём" title="Дверной проём" aria-pressed={doorTool}
          onClick={() => { setDoorTool(value => !value); setWallTool(false); chooseWall(null);
            setInteractionTool("select");
            setMenuOpen(false); setProjectMenu(false); }}><DoorOpen /></button>}
        {!compactView && <button aria-label="Проект" title="Проект" onClick={() => { setProjectMenu(value => !value); setMenuOpen(false); }}><FolderOpen /></button>}
        {!compactView && <button aria-label="Отменить правку" title="Отменить правку" disabled={!project.canUndo || busy}
          onClick={() => project.undo()}><RotateCcw /></button>}
      </aside>}
    </div>
    {compactView && <div className="mobile-readonly-status" role="status" data-overlay>
      Просмотр — редактирование доступно на компьютере
    </div>}
    <div className="physical-mode-switch" role="group" aria-label="Режим проекта" data-overlay
      data-compact={compactView || undefined}>
      {!compactView && <button type="button" aria-pressed={!layoutMode && !room3D} onClick={() => setMode("object")}>
        <PencilRuler aria-hidden="true" />
        <span>План</span>
      </button>}
      <button type="button" aria-pressed={layoutMode && !room3D}
        onClick={() => compactView ? setRoom3D(false) : setMode("variants")}>
        <Grid3X3 aria-hidden="true" />
        <span>{compactView ? "План" : "Раскладка"}</span>
      </button>
      <button type="button" aria-pressed={room3D} onClick={showRoomPreview}>
        <Cuboid aria-hidden="true" />
        <span>3D</span>
      </button>
    </div>
    {!compactView && !layoutMode && !room3D && <div className="physical-interaction-tools" role="toolbar"
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
    {!compactView && layoutMode && !room3D && <div className="physical-interaction-tools shower-placement-tools"
      role="toolbar" aria-label="Инструменты раскладки" data-overlay>
      <button type="button" aria-label="Поддон" title="Разместить душевой поддон"
        aria-pressed={showerTool} onClick={() => setShowerTool(value => !value)}>
        <Bath aria-hidden="true" />
      </button>
    </div>}
    {deleteWallError && <div className="physical-delete-error" role="alert" data-overlay>
      {deleteWallError}
    </div>}
    {!compactView && !room3D && (wallTool || doorTool || selected || selectedDoor || projectMenu || layoutMode || doc.plan.pendingEdit) && <aside className="canvas-panel" data-overlay data-layout-mode={layoutMode || undefined}
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
          <fieldset className="shower-tray-fields">
            <legend>Душевой поддон</legend>
            {!room.showerTray && <p className="muted">Выберите инструмент «Поддон» и укажите место внутри помещения.</p>}
            {room.showerTray && <button type="button" className="shower-remove"
              onClick={() => toggleShowerTray(false)}><Trash2 aria-hidden="true" />Удалить поддон</button>}
            {room.showerTray && <>
              {room.showerTray.vertices && <>
                <div className="shower-object-grid">
                  {showerField("rotationDeg", "Поворот", -360, 360, "°")}
                  {showerField("baseHeightMm", "Высота поддона", 0, 1000, "мм")}
                  {showerField("recessDepthMm", "Глубина чаши", 0,
                    room.showerTray.baseHeightMm ?? 1000, "мм")}
                </div>
                <label>Форма<select aria-label="Форма поддона" value={room.showerTray.vertices.length === 6 ? "l" : "custom"}
                  onChange={event => {
                    const xs = room.showerTray!.vertices!.map(point => point[0]);
                    const ys = room.showerTray!.vertices!.map(point => point[1]);
                    const width = Math.max(...xs) || 900, height = Math.max(...ys) || 900;
                    const vertices: [number, number][] = event.target.value === "l"
                      ? [[0, 0], [width, 0], [width, height * .55], [width * .55, height * .55],
                        [width * .55, height], [0, height]]
                      : [[0, 0], [width, 0], [width, height], [0, height]];
                    updateShowerTray({ vertices, edges: vertices.map((_, index) => ({
                      id: `edge-${index + 1}`, kind: "open",
                    })), ...(event.target.value === "l"
                      ? { drainX: Math.round(width * .5 * 10) / 10,
                        drainY: Math.round(height * .3 * 10) / 10 } : {}) });
                  }}>
                  <option value="custom">Прямоугольник / своя</option>
                  <option value="l">Г-образная</option>
                </select></label>
                <details className="shower-shape-details">
                  <summary>Контур и борта ({room.showerTray.vertices.length} углов)</summary>
                  <div className="shower-vertex-list">
                    {room.showerTray.vertices.map((point, index) => <div key={index} className="shower-vertex-row">
                      <strong>Угол {index + 1}</strong>
                      <label>X, мм<input type="number" step="0.1" value={point[0]}
                        onChange={event => {
                          const value = Number(event.target.value);
                          if (!Number.isFinite(value)) return;
                          const vertices = room.showerTray!.vertices!.map((item, itemIndex) =>
                            itemIndex === index ? [Math.round(value * 10) / 10, item[1]] as [number, number] : item);
                          updateShowerTray({ vertices });
                        }} /></label>
                      <label>Y, мм<input type="number" step="0.1" value={point[1]}
                        onChange={event => {
                          const value = Number(event.target.value);
                          if (!Number.isFinite(value)) return;
                          const vertices = room.showerTray!.vertices!.map((item, itemIndex) =>
                            itemIndex === index ? [item[0], Math.round(value * 10) / 10] as [number, number] : item);
                          updateShowerTray({ vertices });
                        }} /></label>
                      <label>Ребро после угла<select value={room.showerTray!.edges?.[index]?.kind ?? "open"}
                        onChange={event => {
                          const edges = [...(room.showerTray!.edges ?? [])];
                          const kind = event.target.value as NonNullable<ShowerTray["edges"]>[number]["kind"];
                          edges[index] = { id: edges[index]?.id ?? `edge-${index + 1}`, kind,
                            ...(kind === "curb" ? { curbHeightMm: edges[index]?.curbHeightMm ?? 80,
                              curbWidthMm: edges[index]?.curbWidthMm ?? 100 } : {}) };
                          updateShowerTray({ edges });
                        }}>
                        <option value="wall">Примыкание к стене — без борта</option>
                        <option value="open">Открытый торец</option>
                        <option value="curb">Борт, включая сторону у стены</option>
                        <option value="entry">Вход без борта</option>
                      </select></label>
                      {room.showerTray!.edges?.[index]?.kind === "curb" && <>
                        <label>Высота борта, мм<input type="number" min="10" max="500" step="0.1"
                          value={room.showerTray!.edges[index].curbHeightMm ?? 80}
                          onChange={event => {
                            const value = Number(event.target.value);
                            if (!Number.isFinite(value)) return;
                            const edges = [...room.showerTray!.edges!];
                            edges[index] = { ...edges[index], curbHeightMm: Math.round(value * 10) / 10 };
                            updateShowerTray({ edges });
                          }} /></label>
                        <label>Ширина борта, мм<input type="number" min="10" max="500" step="0.1"
                          value={room.showerTray!.edges[index].curbWidthMm ?? 100}
                          onChange={event => {
                            const value = Number(event.target.value);
                            if (!Number.isFinite(value)) return;
                            const edges = [...room.showerTray!.edges!];
                            edges[index] = { ...edges[index], curbWidthMm: Math.round(value * 10) / 10 };
                            updateShowerTray({ edges });
                          }} /></label>
                      </>}
                    </div>)}
                  </div>
                  <div className="shower-vertex-actions">
                    <button type="button" disabled={room.showerTray.vertices.length >= 24}
                      onClick={() => {
                        const vertices = [...room.showerTray!.vertices!];
                        const first = vertices[0], last = vertices[vertices.length - 1];
                        vertices.push([Math.round((first[0] + last[0]) * 5) / 10,
                          Math.round((first[1] + last[1]) * 5) / 10]);
                        updateShowerTray({ vertices, edges: [...(room.showerTray!.edges ?? []),
                          { id: `edge-${vertices.length}`, kind: "open" }] });
                      }}>Добавить угол</button>
                    <button type="button" disabled={room.showerTray.vertices.length <= 3}
                      onClick={() => updateShowerTray({
                        vertices: room.showerTray!.vertices!.slice(0, -1),
                        edges: room.showerTray!.edges?.slice(0, -1),
                      })}>Удалить последний</button>
                  </div>
                  <small className="muted">Координаты углов задаются относительно положения поддона. Форма может быть выпуклой или вогнутой, но линии не должны пересекаться.</small>
                </details>
              </>}
              <label>Тип слива<select value={room.showerTray.drainType}
                onChange={event => {
                  const drainType = event.target.value as ShowerTray["drainType"];
                  updateShowerTray({ drainType,
                    ...(drainType === "point" ? { drainLength: room.showerTray!.drainWidth } : {}) });
                }}>
                <option value="point">Точечный</option>
                <option value="linear">Линейный</option>
              </select></label>
              {room.showerTray.drainType === "linear" && <label>Направление<select
                value={room.showerTray.drainOrientation}
                onChange={event => updateShowerTray({
                  drainOrientation: event.target.value as ShowerTray["drainOrientation"],
                })}>
                <option value="horizontal">Горизонтальный</option>
                <option value="vertical">Вертикальный</option>
              </select></label>}
              {showerField("drainX", room.showerTray.vertices ? "Слив X внутри поддона" : "Координата слива X", -100000, 100000, "мм")}
              {showerField("drainY", room.showerTray.vertices ? "Слив Y внутри поддона" : "Координата слива Y", -100000, 100000, "мм")}
              {showerField("drainWidth", "Ширина рамки", 50, 2000, "мм")}
              {room.showerTray.drainType === "linear" &&
                showerField("drainLength", "Длина слива", 100, 3000, "мм")}
              {showerField("slopePercent", "Уклон", .1, 10, "%")}
              <small className="muted">Плитки на линиях перелома будут разделены на плоские детали.</small>
            </>}
          </fieldset>
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
            <p className="muted">Производственные размеры реза округлены до целого миллиметра.</p>
            {activeLayout?.shower && <p className="shower-result-summary" role="status">
              Поддон: {activeLayout.shower.zones.length} уклонных зон, перепад до {
                displayTenth(activeLayout.shower.maxHeightMm)} мм.
            </p>}
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
            <label>Откос со стороны открывания, мм<input type="number" min="0"
              max={selectedDoorWall?.thicknessMm ?? 0} step="0.1"
              value={selectedDoorRevealInput}
              onChange={event => setDoorRevealFromOpeningSide(event.target.value)} /></label>
            <label>Откос с противоположной стороны, мм<input type="number" min="0"
              max={selectedDoorWall?.thicknessMm ?? 0} step="0.1"
              value={selectedDoorOppositeRevealInput}
              onChange={event => setDoorRevealFromOppositeSide(event.target.value)} /></label>
            {!selectedDoorRevealValid && <p role="alert">
              Введите два откоса от 0 до {displayTenth(selectedDoorWall?.thicknessMm ?? 0)} мм.
              Их сумма должна совпадать с толщиной стены, шаг — 0,1 мм.
            </p>}
            <small className="muted">Положение коробки внутри стены. Измените любой откос — второй
              пересчитается автоматически. Вместе: {displayTenth(selectedDoorWall?.thicknessMm ?? 0)} мм.</small>
            <button disabled={busy || !selectedDoorWidthValid || !selectedDoorRevealValid}
              onClick={() => void command({
                type: "setDoorProperties", openingId: selectedDoor.id,
                widthMm: selectedDoorWidth, revealDepthMm: selectedDoorReveal,
              })}>Применить параметры</button>
            <button onClick={() => chooseDoor(null)}>Снять выделение</button>
          </> : <>
            <p>Нажмите на стену — проём разместится по центру указанной точки.</p>
            <small className="muted">Новая коробка ставится по центру стены. После размещения можно отдельно задать откос с каждой стороны.</small>
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
