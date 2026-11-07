import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Bath, BrickWall, Check, ChevronDown, ChevronsLeft, ChevronsRight, Cuboid, DoorOpen, Grid3X3, LoaderCircle, MousePointer2, PencilRuler, RotateCcw, Trash2, X } from "lucide-react";
import PhysicalCanvas from "./PhysicalCanvas";
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

const Broom = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
  strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
  <path d="m15 4 5 5" /><path d="m17.5 6.5-9 9" />
  <path d="m7 14 3 3-1.5 4H3l-1-1 1.5-5.5Z" /><path d="m3 18 3 3" />
</svg>;

const RoomPreview3D = lazy(() => import("./RoomPreview3D"));
const compactViewQuery = "(max-width: 700px), (hover: none) and (pointer: coarse) and (max-height: 700px)";

const displayTenth = (value: number) => value.toLocaleString("ru-RU", {
  minimumFractionDigits: 1, maximumFractionDigits: 1,
});
const pointOnSegment = (point: [number, number], start: [number, number], end: [number, number]) => {
  const dx = end[0] - start[0], dy = end[1] - start[1];
  const length = Math.hypot(dx, dy);
  if (length < .001) return Math.hypot(point[0] - start[0], point[1] - start[1]) < .01;
  const cross = Math.abs((point[0] - start[0]) * dy - (point[1] - start[1]) * dx) / length;
  const dot = (point[0] - start[0]) * dx + (point[1] - start[1]) * dy;
  return cross <= .01 && dot >= -.01 && dot <= length * length + .01;
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
  const constrainFrom = (origin: { x: number; y: number }, movement: { x: number; y: number }) => {
    const target = { x: origin.x + movement.x, y: origin.y + movement.y };
    if (showerFitsRoom(tray, target.x, target.y, polygon, clearance)) return target;
    let low = 0, high = 1;
    for (let iteration = 0; iteration < 24; iteration++) {
      const ratio = (low + high) / 2;
      const x = origin.x + movement.x * ratio, y = origin.y + movement.y * ratio;
      if (showerFitsRoom(tray, x, y, polygon, clearance)) low = ratio;
      else high = ratio;
    }
    return { x: Math.round((origin.x + movement.x * low) * 10) / 10,
      y: Math.round((origin.y + movement.y * low) * 10) / 10 };
  };
  const start = { x: startX, y: startY };
  const direct = constrainFrom(start, delta);
  const afterX = constrainFrom(start, { x: delta.x, y: 0 });
  const xThenY = constrainFrom(afterX, { x: 0, y: delta.y });
  const afterY = constrainFrom(start, { x: 0, y: delta.y });
  const yThenX = constrainFrom(afterY, { x: delta.x, y: 0 });
  return [direct, xThenY, yThenX].filter(candidate =>
    showerFitsRoom(tray, candidate.x, candidate.y, polygon, clearance))
    .sort((a, b) => Math.hypot(a.x - desiredX, a.y - desiredY) -
      Math.hypot(b.x - desiredX, b.y - desiredY))[0] ?? direct;
};
const wallAwareShowerEdges = (tray: ShowerTray,
  polygon: { outline: number[][]; holes: number[][][] }, clearance = 0) => {
  if (!tray.vertices?.length) return tray.edges;
  const radians = (tray.rotationDeg ?? 0) * Math.PI / 180;
  const cosine = Math.cos(radians), sine = Math.sin(radians);
  const vertices = tray.vertices.map(([x, y]) => [
    (tray.originX ?? 0) + x * cosine - y * sine,
    (tray.originY ?? 0) + x * sine + y * cosine,
  ] as [number, number]);
  const boundaries = [polygon.outline as [number, number][],
    ...(polygon.holes as [number, number][][])];
  return vertices.map((start, index) => {
    const end = vertices[(index + 1) % vertices.length];
    const samples: [number, number][] = [start,
      [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2], end];
    const distance = Math.max(...samples.map(point => Math.min(...boundaries.flatMap(ring =>
      ring.map((edgeStart, edgeIndex) => distanceToSegment(point, edgeStart,
        ring[(edgeIndex + 1) % ring.length]))))));
    const previous = tray.edges?.[index];
    return distance <= clearance + .6
      ? { id: previous?.id ?? `edge-${index + 1}`, kind: "wall" as const }
      : previous ?? { id: `edge-${index + 1}`, kind: "open" as const };
  });
};
type ShowerVertexLock = "free" | "previous" | "next";
const showerWorldVertices = (tray: ShowerTray) => {
  const radians = (tray.rotationDeg ?? 0) * Math.PI / 180;
  const cosine = Math.cos(radians), sine = Math.sin(radians);
  return (tray.vertices ?? []).map(([x, y]) => [
    (tray.originX ?? 0) + x * cosine - y * sine,
    (tray.originY ?? 0) + x * sine + y * cosine,
  ] as [number, number]);
};
const nearestBoundaryPoint = (point: [number, number],
  polygon: { outline: number[][]; holes: number[][][] }) => {
  let nearest = point, distance = Number.POSITIVE_INFINITY;
  for (const ring of [polygon.outline as [number, number][],
    ...(polygon.holes as [number, number][][])]) {
    ring.forEach((start, index) => {
      const end = ring[(index + 1) % ring.length];
      const dx = end[0] - start[0], dy = end[1] - start[1];
      const squared = dx * dx + dy * dy;
      const ratio = squared < .001 ? 0 : Math.max(0, Math.min(1,
        ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / squared));
      const candidate: [number, number] = [start[0] + ratio * dx, start[1] + ratio * dy];
      const candidateDistance = Math.hypot(point[0] - candidate[0], point[1] - candidate[1]);
      if (candidateDistance < distance) { distance = candidateDistance; nearest = candidate; }
    });
  }
  return { point: nearest, distance };
};
const constrainedShowerVertexDelta = (tray: ShowerTray, index: number,
  delta: { x: number; y: number }, polygon: { outline: number[][]; holes: number[][][] },
  lock: ShowerVertexLock) => {
  const worldVertices = showerWorldVertices(tray);
  const current = worldVertices[index];
  if (!current) return { x: 0, y: 0 };
  let movement = delta;
  if (lock !== "free" && worldVertices.length > 1) {
    const neighborIndex = lock === "previous"
      ? (index - 1 + worldVertices.length) % worldVertices.length
      : (index + 1) % worldVertices.length;
    const neighbor = worldVertices[neighborIndex];
    const dx = current[0] - neighbor[0], dy = current[1] - neighbor[1];
    const length = Math.hypot(dx, dy);
    if (length > .001) {
      const ux = dx / length, uy = dy / length;
      const projection = delta.x * ux + delta.y * uy;
      movement = { x: ux * projection, y: uy * projection };
    }
  }
  let desired: [number, number] = [current[0] + movement.x, current[1] + movement.y];
  const boundary = nearestBoundaryPoint(desired, polygon);
  if (boundary.distance <= 20) desired = boundary.point;
  const radians = (tray.rotationDeg ?? 0) * Math.PI / 180;
  const cosine = Math.cos(radians), sine = Math.sin(radians);
  const candidateVertices = (tray.vertices ?? []).map(point => [...point] as [number, number]);
  const toLocal = (point: [number, number]): [number, number] => {
    const x = point[0] - (tray.originX ?? 0), y = point[1] - (tray.originY ?? 0);
    return [x * cosine + y * sine, -x * sine + y * cosine];
  };
  const fits = (point: [number, number]) => {
    candidateVertices[index] = toLocal(point);
    return showerFitsRoom({ ...tray, vertices: candidateVertices }, tray.originX ?? 0,
      tray.originY ?? 0, polygon);
  };
  if (!fits(desired)) {
    let low = 0, high = 1;
    for (let iteration = 0; iteration < 24; iteration++) {
      const ratio = (low + high) / 2;
      const point: [number, number] = [current[0] + (desired[0] - current[0]) * ratio,
        current[1] + (desired[1] - current[1]) * ratio];
      if (fits(point)) low = ratio; else high = ratio;
    }
    desired = [current[0] + (desired[0] - current[0]) * low,
      current[1] + (desired[1] - current[1]) * low];
  }
  return { x: Math.round((desired[0] - current[0]) * 10) / 10,
    y: Math.round((desired[1] - current[1]) * 10) / 10 };
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
  | { kind: "door"; openingId: string; widthMm: number }
  | { kind: "shower"; roomId: string };

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
  const projectMenuRoot = useRef<HTMLDivElement>(null);
  const projectMenuTrigger = useRef<HTMLButtonElement>(null);
  const [layoutCache, setLayoutCache] = useState<Record<string, { key: string; variants: Layout[]; selected: number }>>({});
  const [layoutLoading, setLayoutLoading] = useState(false);
  const [layoutError, setLayoutError] = useState("");
  const [layoutNotice, setLayoutNotice] = useState("");
  const [sharedLoading, setSharedLoading] = useState(false);
  const [layoutScope, setLayoutScope] = useState<"room" | "through">(
    () => initial.sharedGrid ? "through" : "room");
  const [room3D, setRoom3D] = useState(false);
  const [showerTool, setShowerTool] = useState(false);
  const [showerSettingsOpen, setShowerSettingsOpen] = useState(false);
  const [showerPreviewLoading, setShowerPreviewLoading] = useState(false);
  const [showerPreviewLayout, setShowerPreviewLayout] = useState<Layout | null>(null);
  const showerPreviewGeneration = useRef(0);
  const [selectedShowerVertex, setSelectedShowerVertex] = useState<{
    roomId: string; index: number } | null>(null);
  const [showerVertexLock, setShowerVertexLock] = useState<ShowerVertexLock>("free");
  const [showerAddVertex, setShowerAddVertex] = useState(false);
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
    if (!projectMenu) return;
    const pointerDown = (event: PointerEvent) => {
      if (!projectMenuRoot.current?.contains(event.target as Node)) setProjectMenu(false);
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setProjectMenu(false);
      projectMenuTrigger.current?.focus();
    };
    window.addEventListener("pointerdown", pointerDown);
    window.addEventListener("keydown", keyDown);
    return () => {
      window.removeEventListener("pointerdown", pointerDown);
      window.removeEventListener("keydown", keyDown);
    };
  }, [projectMenu]);
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
  useEffect(() => {
    if (!showerSettingsOpen || !room?.showerTray || !selectedFace?.polygon) return;
    const controller = new AbortController();
    const key = layoutKey;
    const generation = ++showerPreviewGeneration.current;
    setShowerPreviewLoading(true);
    setShowerPreviewLayout(null);
    api<Layout>("v5/layout", roomLayoutRequest(room, selectedFace, null), controller.signal)
      .then(layout => {
        if (generation !== showerPreviewGeneration.current) return;
        setShowerPreviewLayout(layout);
        setLayoutCache(cache => ({ ...cache, [room.id]: {
          key, variants: [layout], selected: 0,
        } }));
      })
      .catch(cause => { if (!controller.signal.aborted) setLayoutError((cause as Error).message); })
      .finally(() => { if (!controller.signal.aborted && generation === showerPreviewGeneration.current)
        setShowerPreviewLoading(false); });
    return () => controller.abort();
  }, [showerSettingsOpen, layoutKey]);
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
    initialTray.edges = targetFace?.polygon
      ? wallAwareShowerEdges(initialTray, targetFace.polygon)
      : initialTray.edges;
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
  const updateShowerGeometry = (change: Partial<ShowerTray>) => {
    if (!room?.showerTray) return;
    const tray = { ...room.showerTray, ...change };
    if (selectedFace?.polygon)
      tray.edges = wallAwareShowerEdges(tray, selectedFace.polygon);
    updateShowerTray(tray);
  };
  const moveShowerVertex = (roomId: string, index: number, delta: { x: number; y: number },
    lock = showerVertexLock) => {
    const targetRoom = doc.rooms.find(candidate => candidate.id === roomId);
    const targetFace = response?.faces.find(candidate => candidate.topologyKey === targetRoom?.topologyKey);
    if (!targetRoom?.showerTray?.vertices || !targetFace?.polygon) return;
    const accepted = constrainedShowerVertexDelta(targetRoom.showerTray, index, delta,
      targetFace.polygon, lock);
    const world = showerWorldVertices(targetRoom.showerTray)[index];
    if (!world) return;
    const nextWorld: [number, number] = [world[0] + accepted.x, world[1] + accepted.y];
    const radians = (targetRoom.showerTray.rotationDeg ?? 0) * Math.PI / 180;
    const cosine = Math.cos(radians), sine = Math.sin(radians);
    const x = nextWorld[0] - (targetRoom.showerTray.originX ?? 0);
    const y = nextWorld[1] - (targetRoom.showerTray.originY ?? 0);
    const vertices = targetRoom.showerTray.vertices.map((point, pointIndex) => pointIndex === index
      ? [Math.round((x * cosine + y * sine) * 10) / 10,
        Math.round((-x * sine + y * cosine) * 10) / 10] as [number, number]
      : point);
    const tray = { ...targetRoom.showerTray, vertices };
    tray.edges = wallAwareShowerEdges(tray, targetFace.polygon);
    update(current => ({ ...current, rooms: current.rooms.map(candidate =>
      candidate.id === roomId ? { ...candidate, showerTray: tray } : candidate) }));
  };
  const addShowerVertex = (roomId: string, edgeIndex: number, worldPoint: { x: number; y: number }) => {
    const targetRoom = doc.rooms.find(candidate => candidate.id === roomId);
    if (!targetRoom?.showerTray?.vertices || targetRoom.showerTray.vertices.length >= 24) return;
    const tray = targetRoom.showerTray;
    const currentVertices = targetRoom.showerTray.vertices;
    const radians = (tray.rotationDeg ?? 0) * Math.PI / 180;
    const cosine = Math.cos(radians), sine = Math.sin(radians);
    const x = worldPoint.x - (tray.originX ?? 0), y = worldPoint.y - (tray.originY ?? 0);
    const local: [number, number] = [x * cosine + y * sine, -x * sine + y * cosine];
    const start = currentVertices[edgeIndex], end = currentVertices[(edgeIndex + 1) % currentVertices.length];
    const dx = end[0] - start[0], dy = end[1] - start[1];
    const squared = dx * dx + dy * dy;
    const ratio = squared < .001 ? .5 : Math.max(.05, Math.min(.95,
      ((local[0] - start[0]) * dx + (local[1] - start[1]) * dy) / squared));
    const inserted: [number, number] = [Math.round((start[0] + dx * ratio) * 10) / 10,
      Math.round((start[1] + dy * ratio) * 10) / 10];
    const vertices = [...currentVertices];
    vertices.splice(edgeIndex + 1, 0, inserted);
    const edges = [...(tray.edges ?? [])];
    const sourceEdge = edges[edgeIndex] ?? { id: `edge-${edgeIndex + 1}`, kind: "open" as const };
    edges.splice(edgeIndex, 1, sourceEdge, { ...sourceEdge, id: `edge-${crypto.randomUUID()}` });
    updateShowerGeometry({ vertices, edges });
    setSelectedShowerVertex({ roomId, index: edgeIndex + 1 });
    setShowerVertexLock("free");
    setShowerAddVertex(false);
  };
  const adjustShower = (key: "baseHeightMm" | "recessDepthMm" | "slopePercent" |
    "drainX" | "drainY" | "drainWidth" | "drainLength", delta: number,
  min: number, max: number) => {
    if (!room?.showerTray) return;
    const value = Math.max(min, Math.min(max, Number(room.showerTray[key] ?? 0) + delta));
    updateShowerTray({ [key]: Math.round(value * 10) / 10 });
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
    setSelectedShowerVertex(null);
    setShowerVertexLock("free");
    setShowerAddVertex(false);
    setInteractionTool("select");
    if (mode === "variants") {
      chooseWall(null);
      chooseDoor(null);
      setPendingElementDeletion(null);
      setDeleteWallError("");
    }
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
    setSelectedShowerVertex(null);
    setShowerVertexLock("free");
    setShowerAddVertex(false);
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
  const clearProject = () => {
    update(current => ({ ...current, plan: { ...current.plan,
      draft: { walls: [], junctions: [], openings: [] }, draftRevision: current.plan.draftRevision + 1,
      pendingEdit: null, restorePoint: { graph: current.plan.draft,
        bindings: current.rooms.map(room => ({ roomId: room.id, topologyKey: room.topologyKey })),
        selectedRoomId: current.selectedRoomId } },
      rooms: current.rooms.map(room => ({ ...room, binding: "detached" as const, showerTray: null })),
      selectedRoomId: null }));
    setSelectedWallId(null);
    setSelectedDoorId(null);
    setConfirmClear(false);
    projectMenuTrigger.current?.focus();
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
      faces={response?.faces ?? []} openJointAngles={response?.openJointAngles ?? []}
      selectedRoomKey={room?.topologyKey}
      highlightRooms={layoutMode} roomMissing={roomMissing}
      roomNames={Object.fromEntries(doc.rooms.filter(item => item.topologyKey).map(item => [item.topologyKey!, item.name]))}
      layouts={layoutMode ? visibleLayouts : []}
      showerObjects={doc.rooms.flatMap(candidate => candidate.binding === "attached" && candidate.showerTray?.vertices
        ? [{ roomId: candidate.id, tray: candidate.showerTray, selected: candidate.id === room?.id }]
        : [])}
      showerTool={!compactView && !layoutMode && showerTool}
      selectedShowerVertex={selectedShowerVertex}
      showerAddVertex={showerAddVertex}
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
        const origin = constrainedShowerOrigin(targetRoom.showerTray, delta, targetFace.polygon);
        if (origin.x === targetRoom.showerTray.originX && origin.y === targetRoom.showerTray.originY) return;
        const movedTray = { ...targetRoom.showerTray, originX: origin.x, originY: origin.y };
        movedTray.edges = wallAwareShowerEdges(movedTray, targetFace.polygon);
        update(current => ({ ...current, rooms: current.rooms.map(candidate =>
          candidate.id === roomId && candidate.showerTray ? { ...candidate,
            showerTray: movedTray } : candidate) }));
      }}
      onSelectShower={roomId => {
        chooseWall(null); chooseDoor(null);
        setSelectedShowerVertex(null); setShowerVertexLock("free"); setShowerAddVertex(false);
        update(current => ({ ...current, selectedRoomId: roomId }));
      }}
      onSelectShowerVertex={(roomId, index) => {
        chooseWall(null); chooseDoor(null);
        setSelectedShowerVertex({ roomId, index });
        setShowerVertexLock("free"); setShowerAddVertex(false);
        update(current => ({ ...current, selectedRoomId: roomId }));
      }}
      constrainShowerVertexMove={(roomId, index, delta) => {
        const targetRoom = doc.rooms.find(candidate => candidate.id === roomId);
        const targetFace = response?.faces.find(candidate => candidate.topologyKey === targetRoom?.topologyKey);
        if (!targetRoom?.showerTray || !targetFace?.polygon) return { x: 0, y: 0 };
        return constrainedShowerVertexDelta(targetRoom.showerTray, index, delta,
          targetFace.polygon, showerVertexLock);
      }}
      onMoveShowerVertex={moveShowerVertex}
      onNudgeShowerVertex={(roomId, index, delta) => moveShowerVertex(roomId, index, delta, "free")}
      onAddShowerVertex={addShowerVertex}
      constrainShowerMove={(roomId, delta) => {
        const targetRoom = doc.rooms.find(candidate => candidate.id === roomId);
        const targetFace = response?.faces.find(candidate => candidate.topologyKey === targetRoom?.topologyKey);
        if (!targetRoom?.showerTray || !targetFace?.polygon) return { x: 0, y: 0 };
        const origin = constrainedShowerOrigin(targetRoom.showerTray, delta, targetFace.polygon);
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
      onDeleteShower={roomId => setPendingElementDeletion({ kind: "shower", roomId })}
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
    {!compactView && <div ref={projectMenuRoot} className="physical-project-menu"
      data-open={projectMenu || undefined} data-overlay>
      <button ref={projectMenuTrigger} type="button" className="physical-project-trigger"
        aria-label="Проект" aria-expanded={projectMenu} aria-controls="physical-project-actions"
        onClick={() => { setProjectMenu(value => !value); setMenuOpen(false); }}>
        <span>{doc.name}</span><ChevronDown aria-hidden="true" />
      </button>
      {projectMenu && <div id="physical-project-actions" className="physical-project-actions"
        role="menu" aria-label="Быстрые действия проекта">
        <button type="button" role="menuitem" onClick={() => {
          setProjectMenu(false); setConfirmClear(true);
        }}><Broom /><span>Очистить</span></button>
        <button type="button" role="menuitem" className="danger" onClick={() => {
          setProjectMenu(false); setConfirmDelete(true);
        }}><Trash2 aria-hidden="true" /><span>Удалить проект</span></button>
      </div>}
    </div>}
    {confirmClear && <div className="canvas-modal physical-project-confirmation" data-overlay>
      <section role="alertdialog" aria-modal="true" aria-labelledby="clear-project-title"
        onKeyDown={event => { if (event.key === "Escape") {
          setConfirmClear(false); projectMenuTrigger.current?.focus();
        } }}>
        <h2 id="clear-project-title">Очистить проект?</h2>
        <p>Все стены, помещения и поддоны проекта будут удалены.</p>
        <div className="delete-project-actions">
          <button type="button" autoFocus onClick={() => {
            setConfirmClear(false); projectMenuTrigger.current?.focus();
          }}>Отмена</button>
          <button type="button" className="danger" onClick={clearProject}>Очистить</button>
        </div>
      </section>
    </div>}
    {confirmDelete && <div className="canvas-modal physical-project-confirmation" data-overlay>
      <section role="alertdialog" aria-modal="true" aria-labelledby="delete-project-title"
        onKeyDown={event => { if (event.key === "Escape" && !deleting) {
          setConfirmDelete(false); projectMenuTrigger.current?.focus();
        } }}>
        <h2 id="delete-project-title">Удалить проект?</h2>
        <p>Проект будет удалён без возможности восстановления.</p>
        {deleteProjectError && <p role="alert" className="error">{deleteProjectError}</p>}
        <div className="delete-project-actions">
          <button type="button" autoFocus disabled={deleting} onClick={() => {
            setConfirmDelete(false); projectMenuTrigger.current?.focus();
          }}>Отмена</button>
          <button type="button" className="danger" disabled={deleting} onClick={async () => {
            setDeleting(true);
            setDeleteProjectError("");
            try {
              const result = await deleteV6(doc.id, doc.documentRevision);
              if (result.status === "conflict")
                setDeleteProjectError("Проект изменён в другой вкладке. Обновите страницу перед удалением.");
              else onRemoved(result);
            } catch (cause) { setDeleteProjectError((cause as Error).message); }
            finally { setDeleting(false); }
          }}>Удалить проект</button>
        </div>
      </section>
    </div>}
    {showerSettingsOpen && room?.showerTray && selectedFace?.polygon &&
      <div className="canvas-modal shower-settings-modal" data-overlay>
        <section role="dialog" aria-modal="true" aria-labelledby="shower-settings-title"
          onKeyDown={event => { if (event.key === "Escape") setShowerSettingsOpen(false); }}>
          <header><div><h2 id="shower-settings-title">Настройка поддона в 3D</h2>
            <p>Изменения сразу отображаются в модели.</p></div>
            <button type="button" aria-label="Закрыть настройку поддона"
              onClick={() => setShowerSettingsOpen(false)}><X aria-hidden="true" /></button></header>
          <div className="shower-settings-layout">
            <div className="shower-settings-preview"
              data-shower-preview-key={showerPreviewLayout ? layoutKey : undefined}>
              <Suspense fallback={<div role="status">Загружаем 3D…</div>}>
                <RoomPreview3D rooms={[{ id: room.id, name: room.name, polygon: selectedFace.polygon,
                  layout: showerPreviewLayout }]} title={room.name} tileSize={room.material.tile}
                  through={false} multiRoom={false} graph={doc.plan.draft} />
              </Suspense>
              {showerPreviewLoading && <div className="shower-preview-loading" role="status">
                Обновляем модель…
              </div>}
            </div>
            <aside className="shower-settings-controls" aria-label="Параметры поддона">
              {([
                ["baseHeightMm", "Высота", 10, 0, 1000, "мм"],
                ["recessDepthMm", "Углубление", 5, 0, room.showerTray.baseHeightMm ?? 1000, "мм"],
                ["slopePercent", "Уклон", .1, .1, 10, "%"],
              ] as const).map(([key, label, step, min, max, unit]) => <div className="shower-stepper" key={key}>
                <span>{label}</span><div><button type="button" aria-label={`Уменьшить: ${label}`}
                  onClick={() => adjustShower(key, -step, min, max)}>−</button>
                  <strong>{displayTenth(Number(room.showerTray![key] ?? 0))} {unit}</strong>
                  <button type="button" aria-label={`Увеличить: ${label}`}
                    onClick={() => adjustShower(key, step, min, max)}>+</button></div>
              </div>)}
              <div className="shower-settings-group"><strong>Слив</strong>
                <div className="shower-choice-row">
                  {(["point", "linear"] as const).map(type => <button type="button" key={type}
                    aria-pressed={room.showerTray!.drainType === type}
                    onClick={() => updateShowerTray({ drainType: type,
                      ...(type === "point" ? { drainLength: room.showerTray!.drainWidth } : {}) })}>
                    {type === "point" ? "Точечный" : "Линейный"}</button>)}
                </div>
                {room.showerTray.drainType === "linear" && <button type="button"
                  onClick={() => updateShowerTray({ drainOrientation:
                    room.showerTray!.drainOrientation === "horizontal" ? "vertical" : "horizontal" })}>
                  Повернуть слив · {room.showerTray.drainOrientation === "horizontal" ? "горизонтально" : "вертикально"}
                </button>}
                <div className="shower-drain-nudge" role="group" aria-label="Положение слива">
                  <button type="button" aria-label="Сдвинуть слив влево" onClick={() => adjustShower("drainX", -25, 0, 100000)}>←</button>
                  <button type="button" aria-label="Сдвинуть слив вверх" onClick={() => adjustShower("drainY", 25, 0, 100000)}>↑</button>
                  <button type="button" aria-label="Сдвинуть слив вниз" onClick={() => adjustShower("drainY", -25, 0, 100000)}>↓</button>
                  <button type="button" aria-label="Сдвинуть слив вправо" onClick={() => adjustShower("drainX", 25, 0, 100000)}>→</button>
                </div>
              </div>
              <div className="shower-settings-group"><strong>Стороны поддона</strong>
                <p>Стороны у стен автоматически создаются без борта.</p>
                {room.showerTray.edges?.map((edge, index) => {
                  const kinds = ["wall", "open", "curb", "entry"] as const;
                  const labels = { wall: "у стены · без борта", open: "открытая",
                    curb: "с бортом", entry: "вход" };
                  return <button type="button" key={edge.id} onClick={() => {
                    const kind = kinds[(kinds.indexOf(edge.kind) + 1) % kinds.length];
                    const edges = [...room.showerTray!.edges!];
                    edges[index] = { id: edge.id, kind, ...(kind === "curb"
                      ? { curbHeightMm: edge.curbHeightMm ?? 80, curbWidthMm: edge.curbWidthMm ?? 100 }
                      : {}) };
                    updateShowerTray({ edges });
                  }}>Сторона {index + 1}: {labels[edge.kind]}</button>;
                })}
              </div>
            </aside>
          </div>
        </section>
      </div>}
    <div className="canvas-sidebar-shell" data-overlay style={{ position: "absolute", top: 12, left: 12 }}>
      <button className="canvas-sidebar-toggle" aria-label={menuOpen ? "Свернуть меню" : "Раскрыть меню"}
        aria-expanded={menuOpen} onClick={() => setMenuOpen(value => !value)}>
        {menuOpen ? <ChevronsLeft /> : <ChevronsRight />}
      </button>
      {menuOpen && <aside className="canvas-sidebar" aria-label={compactView ? "Навигация по проекту" : "Управление планом"}>
        <button aria-label="Проекты" title="Проекты" onClick={onBack}><ArrowLeft /></button>
        {!compactView && !layoutMode && <button aria-label="Стена" title="Стена" aria-pressed={wallTool}
          onClick={() => { setWallTool(value => !value); setDoorTool(false); chooseDoor(null);
            setInteractionTool("select");
            setMenuOpen(false); setProjectMenu(false); }}><BrickWall /></button>}
        {!compactView && !layoutMode && <button aria-label="Дверной проём" title="Дверной проём" aria-pressed={doorTool}
          onClick={() => { setDoorTool(value => !value); setWallTool(false); chooseWall(null);
            setInteractionTool("select");
            setMenuOpen(false); setProjectMenu(false); }}><DoorOpen /></button>}
        {!compactView && !layoutMode && <button aria-label="Поддон" title="Разместить душевой поддон"
          aria-pressed={showerTool} onClick={() => {
            setShowerTool(value => !value); setWallTool(false); setDoorTool(false);
            chooseWall(null); chooseDoor(null); setInteractionTool("select");
            setMenuOpen(false); setProjectMenu(false);
          }}><Bath /></button>}
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
    {deleteWallError && <div className="physical-delete-error" role="alert" data-overlay>
      {deleteWallError}
    </div>}
    {!compactView && !room3D && (wallTool || doorTool || selected || selectedDoor ||
      (!layoutMode && room?.showerTray) || layoutMode || doc.plan.pendingEdit) && <aside className="canvas-panel" data-overlay data-layout-mode={layoutMode || undefined}
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
      {layoutMode ? <>
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
          {room.showerTray && <div className="shower-layout-summary">
            <div><strong>Душевой поддон</strong>
              <span>Контур и положение настраиваются в режиме «План».</span></div>
            <button type="button" onClick={() => setShowerSettingsOpen(true)}>
              <Cuboid aria-hidden="true" />Настроить в 3D
            </button>
          </div>}
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
        {room?.showerTray && !selected && !selectedDoor && !wallTool && !doorTool ? <>
          <h2>Поддон на плане</h2>
          <p className="muted">Перетаскивайте весь поддон или выберите вершину. Джойстик двигает строго по осям с шагом 1 мм.</p>
          {selectedShowerVertex?.roomId === room.id && room.showerTray.vertices?.[selectedShowerVertex.index]
            ? (() => {
              const index = selectedShowerVertex.index;
              const vertices = room.showerTray!.vertices!;
              const angle = (neighborIndex: number) => {
                const point = vertices[index], neighbor = vertices[neighborIndex];
                const degrees = Math.atan2(point[1] - neighbor[1], point[0] - neighbor[0]) * 180 / Math.PI;
                return displayTenth(((degrees % 180) + 180) % 180);
              };
              const previous = (index - 1 + vertices.length) % vertices.length;
              const next = (index + 1) % vertices.length;
              return <section className="shower-vertex-controls" aria-labelledby="selected-shower-vertex">
                <div><strong id="selected-shower-vertex">Вершина {index + 1}</strong>
                  <span>Перетаскивайте жёлтую точку или используйте джойстик.</span></div>
                <fieldset><legend>Направление свободного движения</legend>
                  <div className="shower-lock-options">
                    <button type="button" aria-pressed={showerVertexLock === "free"}
                      onClick={() => setShowerVertexLock("free")}>Свободно</button>
                    <button type="button" aria-pressed={showerVertexLock === "previous"}
                      onClick={() => setShowerVertexLock("previous")}>Предыдущее ребро · {angle(previous)}°</button>
                    <button type="button" aria-pressed={showerVertexLock === "next"}
                      onClick={() => setShowerVertexLock("next")}>Следующее ребро · {angle(next)}°</button>
                  </div>
                </fieldset>
                <button type="button" disabled={vertices.length <= 3} onClick={() => {
                  const nextVertices = [...vertices]; nextVertices.splice(index, 1);
                  const edges = [...(room.showerTray!.edges ?? [])]; edges.splice(index, 1);
                  updateShowerGeometry({ vertices: nextVertices, edges });
                  setSelectedShowerVertex(null); setShowerVertexLock("free");
                }}>Удалить выбранную вершину</button>
              </section>;
            })()
            : <p className="shower-vertex-hint">Выберите белую вершину на контуре, чтобы изменить её.</p>}
          <button type="button" className="shower-add-vertex" aria-pressed={showerAddVertex}
            disabled={(room.showerTray.vertices?.length ?? 0) >= 24}
            onClick={() => { setShowerAddVertex(value => !value); setSelectedShowerVertex(null);
              setShowerVertexLock("free"); }}>
            {showerAddVertex ? "Отменить добавление вершины" : "Добавить вершину"}
          </button>
          {showerAddVertex && <p role="status" className="muted">Нажмите «+» на нужном ребре поддона.</p>}
          <button type="button" className="shower-open-3d" onClick={() => setShowerSettingsOpen(true)}>
            <Cuboid aria-hidden="true" />Настроить поддон в 3D
          </button>
        </> : selectedDoor || doorTool ? <>
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
          ? "Удалить стену?" : pendingElementDeletion.kind === "door"
            ? "Удалить дверной проём?" : "Удалить поддон?"}</h2>
        {pendingElementDeletion.kind === "wall" ? <p>
          Будет удалена стена, {pendingElementDeletion.impact.junctionIds.length} связанных стыков
          {pendingElementDeletion.impact.openingIds.length
            ? ` и дверных проёмов: ${pendingElementDeletion.impact.openingIds.length}` : ""}.
          Затронутых помещений: {pendingElementDeletion.impact.affectedRoomKeys.length}.
        </p> : pendingElementDeletion.kind === "door"
          ? <p>Будет удалён дверной проём шириной {displayTenth(pendingElementDeletion.widthMm)} мм.</p>
          : <p>Поддон и его настройки будут удалены из помещения.</p>}
        <div className="delete-project-actions">
          <button ref={deleteCancelButton} type="button" disabled={busy}
            onClick={() => setPendingElementDeletion(null)}>Отмена</button>
          <button type="button" className="danger" disabled={busy} onClick={() => {
            if (pendingElementDeletion.kind === "wall") {
              void command({ type: "deleteWall", wallId: pendingElementDeletion.wallId });
              chooseWall(null);
            } else if (pendingElementDeletion.kind === "door") {
              void command({ type: "deleteDoorOpening", openingId: pendingElementDeletion.openingId });
              chooseDoor(null);
            } else {
              update(current => ({ ...current, rooms: current.rooms.map(item =>
                item.id === pendingElementDeletion.roomId ? { ...item, showerTray: null } : item) }));
              setSelectedShowerVertex(null); setShowerVertexLock("free"); setShowerAddVertex(false);
            }
            setPendingElementDeletion(null);
          }}>{pendingElementDeletion.kind === "wall" ? "Удалить стену"
            : pendingElementDeletion.kind === "door" ? "Удалить проём" : "Удалить поддон"}</button>
        </div>
      </section>
    </div>}
  </div>;
}
