import { roomLabelPoint } from "../../domain/plan/room-label";
import {
  rangeSegments,
  chainNodes,
  type EditorState,
  type EditorTool,
  type PendingWallStart,
  type SnapCandidate,
} from "../../domain/plan/editor-state";
import DimensionOverlay from "./DimensionOverlay";
import { useRef, useState, useEffect, useLayoutEffect } from "react";
import type {
  GraphSnapshot,
  FaceCandidate,
  ProjectDocumentV5,
  Point,
  DiagnosticSelection,
} from "../../domain/plan/types";
import type { Layout } from "../../types";
import { path } from "../../types";
import { snap } from "../../domain/room/snapping";
import { selectedWallAngles } from "../../domain/plan/selected-wall-angles";
import { selectedWallFootprint } from "../../domain/plan/selected-wall-footprint";
import { roundTenth } from "../../domain/plan/precision";
import { clampZoom, gridScreenStep, viewportAtAnchor, worldPoint, zoomAroundWorld } from "../../domain/room/viewport";
export type Tool = EditorTool;
export default function ProjectCanvas({
  graph,
  editor,
  resetEpoch,
  panelOpen,
  sidebarOpen,
  highlightedSegments,
  onVoid,
  onConstraint,
  onCanvasFocus,
  faces,
  wallArea = [],
  roomNames = {},
  roomMissing = {},
  selectedKey,
  viewport,
  tool,
  wallThickness = 100,
  onDrawWall,
  selectedVertex,
  selectedSegment,
  selectedWallHandle,
  onWallHandleSelect,
  diagnostic,
  onSelection,
  onRoom,
  onViewport,
  layout,
  onShift,
  onPart,
  onCancel,
  onDeactivate,
  children,
}: {
  graph: GraphSnapshot;
  onCanvasFocus: () => void;
  resetEpoch: number;
  panelOpen: boolean;
  sidebarOpen: boolean;
  editor: EditorState;
  highlightedSegments?: string[];
  onVoid: (id: string) => void;
  onConstraint: (id: string) => void;
  faces: FaceCandidate[];
  wallArea?: { outline: number[][]; holes: number[][][] }[];
  roomNames?: Record<string, string>;
  roomMissing?: Record<string, boolean>;
  selectedKey?: string | null;
  viewport: ProjectDocumentV5["viewport"];
  tool: Tool;
  wallThickness?: number;
  onDrawWall?: (start: Point, end: Point) => void;
  selectedVertex: string;
  selectedSegment: string;
  selectedWallHandle?: "start" | "center" | "end" | null;
  onWallHandleSelect?: (handle: "start" | "center" | "end") => void;
  diagnostic: DiagnosticSelection | null;
  onSelection: (v: string, s: string) => void;
  onRoom: (f: FaceCandidate) => void;
  onViewport: (v: ProjectDocumentV5["viewport"]) => void;
  layout?: Layout;
  onShift?: (x: number, y: number) => void;
  onPart?: (id: string) => void;
  onCancel: () => void;
  onDeactivate: () => void;
  children: React.ReactNode;
}) {
  const svg = useRef<SVGSVGElement>(null),
    touches = useRef(new Map<number, Point>()),
    pinch = useRef<{ distance: number; zoom: number; anchor: Point; viewport: typeof viewport } | null>(null),
    pinchResult = useRef<typeof viewport | null>(null),
    suppressTouch = useRef(false),
    gesture = useRef<{
      id: number;
      client: Point;
      world: Point;
      target?: string;
      wallHandle?: "start" | "center" | "end";
      viewport: typeof viewport;
      dragged: boolean;
    } | null>(null);
  const [preview, setPreview] = useState<(Point & { type: string }) | null>(
      null,
    ),
    [wallPreview, setWallPreview] = useState<{ start: Point; end: Point } | null>(null),
    [pendingWallStart, setPendingWallStart] = useState<PendingWallStart | null>(null),
    [hoverWallPoint, setHoverWallPoint] = useState<Point | null>(null),
    [liveViewport, setLiveViewport] = useState<typeof viewport | null>(null);
  const [size, setSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const [panelLift, setPanelLift] = useState(0);
  const [sidebarShift, setSidebarShift] = useState(0);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    if (svg.current) observer.observe(svg.current);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const canvas = svg.current?.parentElement;
    if (!canvas || !svg.current) return;
    const panel = canvas.querySelector<HTMLElement>(".canvas-panel");
    const sidebar = canvas.querySelector<HTMLElement>(".canvas-sidebar-shell");
    const measure = () => {
      const rect = svg.current!.getBoundingClientRect();
      const sideRight = sidebarOpen ? (sidebar?.getBoundingClientRect().right ?? rect.left) : rect.left - 8;
      const panelRect = panelOpen ? panel?.getBoundingClientRect() : undefined;
      const tallPanel = panelRect && panelRect.top < rect.bottom && panelRect.height > rect.height * .5;
      const panelOnLeft = tallPanel && panelRect.left + panelRect.width / 2 < rect.left + rect.width / 2;
      const leftEdge = Math.max(rect.left, Math.min(rect.right,
        panelOnLeft ? panelRect.right + 8 : sideRight + 8));
      const rightEdge = tallPanel && !panelOnLeft
        ? Math.min(rect.right, panelRect.left - 8) : rect.right;
      const nextShift = (Math.max(leftEdge, rightEdge) + leftEdge) / 2 - (rect.left + rect.width / 2);
      setSidebarShift((current) => Math.abs(current - nextShift) < .5 ? current : nextShift);
      const topEdge = rect.top;
      const bottomEdge = panelRect && panelRect.top > rect.top + rect.height * .5
        ? Math.min(rect.bottom, panelRect.top - 8) : rect.bottom;
      const nextLift = (rect.top + rect.height / 2) - (topEdge + bottomEdge) / 2;
      setPanelLift((current) => Math.abs(current - nextLift) < .5 ? current : nextLift);
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const element of [svg.current, panel, sidebar]) if (element) observer.observe(element);
    return () => observer.disconnect();
  }, [panelOpen, sidebarOpen, size.width, size.height]);
  const renderedViewport = liveViewport ?? viewport;
  useEffect(() => {
    const limited = clampZoom(viewport.zoom, size.width);
    if (limited !== viewport.zoom && !pinch.current)
      onViewport({ ...viewport, zoom: limited });
  }, [size.width, viewport.zoom]);
  useEffect(() => {
    const node = svg.current;
    if (!node) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = node.getBoundingClientRect();
      const nextZoom = clampZoom(viewport.zoom * Math.exp(-event.deltaY * 0.0015), rect.width);
      if (nextZoom === viewport.zoom) return;
      let anchor: Point;
      try { anchor = worldPoint(node, event.clientX, event.clientY); }
      catch { return; }
      onViewport(zoomAroundWorld(viewport, anchor, nextZoom, rect.width));
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, [viewport, onViewport, sidebarShift, panelLift]);
  const width = 9000 / renderedViewport.zoom,
    height = (width * size.height) / Math.max(1, size.width),
    left = renderedViewport.centerX - width / 2 - sidebarShift * width / Math.max(1, size.width),
    bottom =
      renderedViewport.centerY - height / 2 - (panelLift * width) / Math.max(1, size.width);
  const vs = new Map(graph.vertices.map((v) => [v.id, v]));
  const selectedChain = graph.segments.find((segment) => segment.id === selectedSegment)?.chainId;
  const selectedWall = graph.chains.find((chain) => chain.id === selectedChain);
  const selectedFootprint = selectedWall ? selectedWallFootprint(graph, selectedWall.id) : null;
  const selectedAngles = selectedWall ? selectedWallAngles(graph, selectedWall.id) : [];
  // The viewBox shares the observed viewport aspect ratio, so scale is uniform.
  // Derive render sizes from current props, never the previous render's CTM.
  const screenScale = () => Math.max(size.width, 1) / width;
  const wallHandlePoints = selectedWall ? (() => {
    const a = vs.get(selectedWall.startVertexId)!;
    const b = vs.get(selectedWall.endVertexId)!;
    return [a, b, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }];
  })() : [];
  const angleLabels: Point[] = [];
  const selectedAngleVisuals = selectedAngles.map((angle) => {
    const start = Math.atan2(angle.from.y, angle.from.x);
    const delta = Math.atan2(angle.from.x * angle.to.y - angle.from.y * angle.to.x,
      angle.from.x * angle.to.x + angle.from.y * angle.to.y);
    const middle = start + delta / 2;
    let label: Point = angle.origin;
    for (let step = 0; step < 16; step++) {
      const radius = (43 + step * 16) / screenScale();
      label = { x: angle.origin.x + Math.cos(middle) * radius,
        y: angle.origin.y + Math.sin(middle) * radius };
      if (angleLabels.every(other => Math.hypot(label.x - other.x, label.y - other.y) * screenScale() >= 45) &&
          wallHandlePoints.every(handle => Math.hypot(label.x - handle.x, label.y - handle.y) * screenScale() >= 34)) break;
    }
    angleLabels.push(label);
    return { angle, start, delta, label };
  });
  const clientWorld = (clientX: number, clientY: number) => {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return null;
    const p = new DOMPoint(clientX, clientY).matrixTransform(
      matrix.inverse(),
    );
    return { x: p.x, y: -p.y };
  };
  const world = (e: React.PointerEvent) => clientWorld(e.clientX, e.clientY);
  const target = (p: Point, r: number) => {
    const vertex = graph.vertices.find(
      (v) => Math.hypot(v.x - p.x, v.y - p.y) <= r,
    );
    if (vertex)
      return {
        p: { x: vertex.x, y: vertex.y },
        vertexId: vertex.id,
        type: "Вершина",
      };
    let best: { p: Point; segmentId: string; type: string } | null = null,
      distance = r;
    for (const s of graph.segments) {
      const a = vs.get(s.startVertexId)!,
        b = vs.get(s.endVertexId)!,
        dx = b.x - a.x,
        dy = b.y - a.y,
        t = Math.max(
          0,
          Math.min(
            1,
            ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy),
          ),
        );
      const q = { x: a.x + t * dx, y: a.y + t * dy },
        d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < distance) {
        distance = d;
        best = { p: q, segmentId: s.id, type: "Стена" };
      }
    }
    return best;
  };
  const snapped = (e: React.PointerEvent, offset = 0) => {
    const p = clientWorld(e.clientX, e.clientY - offset);
    if (!p) return null;
    const r = (e.pointerType === "mouse" ? 8 : 12) / screenScale(),
      hit = target(p, r);
    if (tool === "wall" && hit) return { ...hit.p, type: hit.type };
    return snap(p.x, p.y, viewport.gridStepMm, r);
  };
  const clear = () => {
    gesture.current = null;
    setPreview(null);
    setLiveViewport(null);
    setWallPreview(null);
  };
  const firstWallContact = (start: Point, end: Point) => {
    const dx = end.x - start.x, dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-6) return { axis: end, visible: end };
    let best = length;
    let visible = length;
    for (const segment of graph.segments) {
      const a = vs.get(segment.startVertexId)!, b = vs.get(segment.endVertexId)!;
      const ex = b.x - a.x, ey = b.y - a.y;
      const cross = dx * ey - dy * ex;
      if (Math.abs(cross) < 1e-7) continue;
      const qx = a.x - start.x, qy = a.y - start.y;
      const t = (qx * ey - qy * ex) / cross;
      const u = (qx * dy - qy * dx) / cross;
      if (t <= 1e-6 || t > 1 || u < -1e-6 || u > 1 + 1e-6) continue;
      const distance = t * length;
      if (distance < best) {
        best = distance;
        const thickness = graph.chains.find((chain) => chain.id === segment.chainId)?.thicknessMm ?? 0;
        const sine = Math.abs(cross) / (length * Math.hypot(ex, ey));
        visible = Math.max(0, distance - thickness / (2 * Math.max(sine, 1e-6)));
      }
    }
    const point = (distance: number) => ({ x: start.x + dx * distance / length, y: start.y + dy * distance / length });
    return { axis: point(best), visible: point(visible) };
  };
  const wallPreviewShape = wallPreview && wallThickness > 0 && Number.isFinite(wallThickness)
    ? (() => {
        const end = firstWallContact(wallPreview.start, wallPreview.end).visible;
        const dx = end.x - wallPreview.start.x, dy = end.y - wallPreview.start.y;
        const length = Math.hypot(dx, dy);
        if (length < 1e-6) return null;
        const nx = -dy / length * wallThickness / 2, ny = dx / length * wallThickness / 2;
        const a = wallPreview.start;
        return [[a.x + nx, a.y + ny], [end.x + nx, end.y + ny], [end.x - nx, end.y - ny], [a.x - nx, a.y - ny]] as [number, number][];
      })() : null;
  const panViewport = (start: NonNullable<typeof gesture.current>, clientX: number, clientY: number) => {
    const pixels = Math.max(1, svg.current?.getBoundingClientRect().width ?? size.width);
    const unitsPerPixel = 9000 / start.viewport.zoom / pixels;
    return {
      ...start.viewport,
      centerX: start.viewport.centerX - (clientX - start.client.x) * unitsPerPixel,
      centerY: start.viewport.centerY + (clientY - start.client.y) * unitsPerPixel,
    };
  };
  useEffect(() => { clear(); setPendingWallStart(null); setHoverWallPoint(null); touches.current.clear(); pinch.current = null; }, [tool]);
  const [active, setActive] = useState("");
  useEffect(() => {
    setActive("");
    clear();
    setPendingWallStart(null);
    setHoverWallPoint(null);
    touches.current.clear();
    pinch.current = null;
  }, [resetEpoch]);
  const touchPoint = (e: React.PointerEvent) => snapped(e);
  const beginPinch = () => {
    const [a, b] = [...touches.current.values()];
    const anchor = clientWorld((a.x + b.x) / 2, (a.y + b.y) / 2);
    if (!anchor) return;
    pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: viewport.zoom, anchor, viewport: { ...viewport } };
    pinchResult.current = null;
    suppressTouch.current = true;
    clear();
  };
  const updatePinch = () => {
    if (!pinch.current || touches.current.size < 2 || !svg.current) return;
    const [a, b] = [...touches.current.values()];
    const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    const zoom = clampZoom(pinch.current.zoom * distance / Math.max(1, pinch.current.distance), size.width);
    const rect = svg.current.getBoundingClientRect();
    const next = viewportAtAnchor(pinch.current.viewport, pinch.current.anchor,
      middle, rect, zoom, sidebarShift, panelLift);
    pinchResult.current = next;
    setLiveViewport(next);
  };
  const voidRings = graph.voids.map((v) => ({
    id: v.id,
    points: v.boundary.map((ref) => {
      const s = graph.segments.find((s) => s.id === ref.segmentId)!;
      const p = vs.get(ref.forward ? s.startVertexId : s.endVertexId)!;
      return [p.x, p.y];
    }),
  }));
  const contains = (p: Point, ring: number[][]) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i],
        b = ring[j];
      if (
        a[1] > p.y !== b[1] > p.y &&
        p.x < ((b[0] - a[0]) * (p.y - a[1])) / (b[1] - a[1]) + a[0]
      )
        inside = !inside;
    }
    return inside;
  };
  const chooseRoom = (p: Point) => {
    const hole = voidRings.find((v) => contains(p, v.points));
    if (hole) {
      if (tool !== "selectRoom") onVoid(hole.id);
      return;
    }
    const candidates = faces.filter(
      (f) =>
        contains(p, (f.polygon ?? f.axisPolygon).outline) &&
        !(f.polygon ?? f.axisPolygon).holes.some((r) => contains(p, r)),
    );
    if (candidates.length === 1) onRoom(candidates[0]);
    else onSelection("", "");
  };
  const targets = [
    ...graph.vertices.map((v) => "vertex:" + v.id),
    ...graph.segments.map((s) => "segment:" + s.id),
    ...faces.map((f) => "room:" + f.topologyKey),
    ...graph.voids.map((v) => "void:" + v.id),
    ...graph.constraints.map((c) => "constraint:" + c.id),
  ];
  const eligible =
    editor.interaction.kind === "rangeFirst" ||
    editor.interaction.kind === "rangeSecond"
      ? chainNodes(graph, editor.interaction.chainId).map(
          (id) => "vertex:" + id,
        )
      : targets;
  useEffect(() => {
    if (active && !targets.includes(active)) {
      setActive("");
      svg.current?.focus();
    }
  }, [graph, editor.interaction.kind, editor.context.kind, tool]);
  const focusTarget = (id: string) => {
    setActive(id);
    requestAnimationFrame(() => {
      const target = [
        ...(svg.current?.querySelectorAll<SVGElement>("[data-target]") || []),
      ].find((el) => el.dataset.target === id);
      target?.focus();
    });
  };
  const pick = (id: string) => {
    const split = id.indexOf(":"),
      kind = id.slice(0, split),
      value = id.slice(split + 1);
    setActive(id);
    if (kind === "vertex") {
      const v = vs.get(value);
      if (!v) return;
      if (
        editor.interaction.kind === "rangeFirst" ||
        editor.interaction.kind === "rangeSecond"
      )
        onSelection(value, "");
      else onSelection(value, "");
    } else if (kind === "segment") {
      const s = graph.segments.find((s) => s.id === value);
      if (!s) return;
      onSelection("", value);
    } else if (kind === "room") {
      const f = faces.find((f) => f.topologyKey === value);
      if (f) onRoom(f);
    } else if (kind === "void") onVoid(value);
    else if (kind === "constraint") onConstraint(value);
  };
  const targetProps = (kind: string, id: string, label: string) => ({
    "data-target": kind + ":" + id,
    role: "button",
    tabIndex: active === kind + ":" + id ? 0 : -1,
    "aria-label": label,
    onFocus: () => {
      setActive(kind + ":" + id);
      onCanvasFocus();
    },
  });
  const selectedRange =
    editor.context.kind === "range"
      ? rangeSegments(
          graph,
          editor.context.chainId,
          editor.context.startVertexId,
          editor.context.endVertexId,
        )
      : [];
  const rangeEnds =
    editor.context.kind === "range"
      ? [editor.context.startVertexId, editor.context.endVertexId]
      : editor.interaction.kind === "rangeSecond"
        ? [editor.interaction.firstVertexId]
        : [];
  const gridLines = (step: number) => {
    const xs: number[] = [], ys: number[] = [];
    for (let x = Math.ceil(left / step) * step; x < left + width; x += step) xs.push(x);
    for (let y = Math.ceil(bottom / step) * step; y < bottom + height; y += step) ys.push(y);
    return { xs, ys };
  };
  const thousandGrid = gridLines(1000);
  const majorGrid = gridScreenStep(100, size.width, renderedViewport.zoom) >= 6 - 1e-6
    ? gridLines(100) : null;
  const minorGrid = gridScreenStep(10, size.width, renderedViewport.zoom) >= 6 - 1e-6
    ? gridLines(10) : null;
  const candidateSpacing = renderedViewport.zoom < 1 ? 100 : 44;
  const candidateStep = Math.max(100, Math.ceil(candidateSpacing / Math.max(1, 100 * screenScale())) * 100);
  const wallCandidates: SnapCandidate[] = [];
  const addCandidate = (point: Point, type: SnapCandidate["type"], vertexId?: string) => {
    if (point.x < left || point.x > left + width || point.y < bottom || point.y > bottom + height) return;
    if (wallCandidates.some((candidate) => Math.hypot(candidate.point.x - point.x, candidate.point.y - point.y) < 1)) return;
    if (type !== "wallEnd" && wallCandidates.some((candidate) =>
      Math.hypot(candidate.point.x - point.x, candidate.point.y - point.y) * screenScale() < 44)) return;
    wallCandidates.push({ point, screen: { x: (point.x - left) * screenScale(), y: (bottom + height - point.y) * screenScale() }, type, allowed: true, vertexId });
  };
  for (const chain of graph.chains)
    for (const id of [chain.startVertexId, chain.endVertexId]) {
      const vertex = vs.get(id);
      if (vertex) addCandidate({ x: vertex.x, y: vertex.y }, "wallEnd", id);
    }
  if (pendingWallStart?.vertexId) {
    for (const segment of graph.segments.filter((item) =>
      item.startVertexId === pendingWallStart.vertexId || item.endVertexId === pendingWallStart.vertexId)) {
      const a = vs.get(segment.startVertexId)!, b = vs.get(segment.endVertexId)!;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (!len) continue;
      const perp = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
      const limit = Math.min(100, Math.ceil(Math.hypot(width, height) / 100));
      for (let i = -limit; i <= limit; i++) if (i)
        addCandidate({ x: roundTenth(pendingWallStart.point.x + perp.x * i * 100),
          y: roundTenth(pendingWallStart.point.y + perp.y * i * 100) }, "perpendicularGuide");
    }
  }
  for (let x = Math.ceil(left / candidateStep) * candidateStep; x <= left + width; x += candidateStep)
    for (let y = Math.ceil(bottom / candidateStep) * candidateStep; y <= bottom + height; y += candidateStep)
      addCandidate({ x, y }, "majorGrid");
  const pickWallCandidate = (clientX: number, clientY: number) => {
    const point = clientWorld(clientX, clientY);
    if (!point) return null;
    const nearby = wallCandidates.filter((candidate) =>
      Math.hypot(candidate.point.x - point.x, candidate.point.y - point.y) * screenScale() <= 22);
    const ends = nearby.filter((candidate) => candidate.type === "wallEnd");
    if (ends.length > 1) return null;
    return nearby[0] ?? null;
  };
  return (
    <div
      className="project-canvas"
      data-project-canvas
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          clear();
          setPendingWallStart(null);
          setHoverWallPoint(null);
          onDeactivate();
        }
      }}
    >
      <svg
        ref={svg}
        role="group"
        tabIndex={active ? -1 : 0}
        onKeyDown={(e) => {
          if (e.key === "Tab") {
            const input =
              svg.current?.parentElement?.querySelector<HTMLInputElement>(
                ".canvas-panel input:not(:disabled)",
              );
            if (input && !e.shiftKey) {
              e.preventDefault();
              input.focus();
            }
            return;
          }
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            clear();
            setPendingWallStart(null);
            setHoverWallPoint(null);
            onDeactivate();
            return;
          }
          const step = e.shiftKey ? 1 : viewport.gridStepMm;
          if (e.key.startsWith("Arrow")) {
            e.preventDefault();
            e.stopPropagation();
            if (tool === "pan" && editor.interaction.kind === "idle") {
              onViewport({
                ...viewport,
                centerX:
                  viewport.centerX +
                  (e.key === "ArrowRight"
                    ? step
                    : e.key === "ArrowLeft"
                      ? -step
                      : 0),
                centerY:
                  viewport.centerY +
                  (e.key === "ArrowUp"
                    ? step
                    : e.key === "ArrowDown"
                      ? -step
                      : 0),
              });
              return;
            }
            const delta =
                e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1,
              i = eligible.indexOf(active),
              next = eligible[(i + delta + eligible.length) % eligible.length];
            if (next) {
              focusTarget(next);
            }
            return;
          }
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            if (active) pick(active);
          }
        }}
        aria-label="Редактор плана помещений"
        data-geometry={JSON.stringify(graph)}
        data-layout={
          layout
            ? JSON.stringify({ offset_x: layout.offset_x, offset_y: layout.offset_y, parts: layout.parts, metrics: layout.metrics })
            : undefined
        }
        viewBox={`${left} ${-bottom - height} ${width} ${height}`}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          if (e.pointerType === "touch") {
            e.preventDefault();
            touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (touches.current.size === 2) beginPinch();
            if (touches.current.size > 1) {
              e.currentTarget.setPointerCapture(e.pointerId);
              return;
            }
            suppressTouch.current = false;
            setPreview(touchPoint(e));
          }
          const p = world(e);
          if (!p) return;
          gesture.current = {
            id: e.pointerId,
            client: { x: e.clientX, y: e.clientY },
            world: p,
            target:
              (e.target as Element)
                .closest("[data-target]")
                ?.getAttribute("data-target") || undefined,
            wallHandle: (e.target as Element).closest("[data-wall-handle]")?.getAttribute("data-wall-handle") as "start" | "center" | "end" | undefined,
            viewport: { ...viewport },
            dragged: false,
          };
          if (tool === "wall" && e.pointerType !== "touch") {
            const point = touchPoint(e) ?? p;
            setWallPreview({ start: { x: point.x, y: point.y }, end: { x: point.x, y: point.y } });
          }
          if (e.nativeEvent.isTrusted)
            e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (e.pointerType === "touch" && touches.current.has(e.pointerId)) {
            touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (pinch.current) { updatePinch(); return; }
            if (suppressTouch.current) return;
          }
          setPreview(touchPoint(e));
          const g = gesture.current;
          if (!g) return;
          if (tool === "wall" && e.pointerType !== "touch") setWallPreview((current) => current ? { ...current, end: touchPoint(e) ?? current.end } : current);
          if (Math.hypot(e.clientX - g.client.x, e.clientY - g.client.y) > 4)
            g.dragged = true;
          if ((tool === "pan" || tool === "selectRoom" || (tool === "wall" && e.pointerType === "touch")) && g.dragged)
            setLiveViewport(panViewport(g, e.clientX, e.clientY));
          if (tool === "wall" && e.pointerType === "touch" && !g.dragged)
            setHoverWallPoint(pickWallCandidate(e.clientX, e.clientY)?.point ?? null);
        }}
        onPointerCancel={(e) => {
          const wasPinching = !!pinch.current;
          touches.current.delete(e.pointerId);
          pinch.current = null;
          pinchResult.current = null;
          clear();
          if (!wasPinching) onCancel();
        }}
        onLostPointerCapture={(e) => {
          touches.current.delete(e.pointerId);
          if (!touches.current.size) { pinch.current = null; suppressTouch.current = false; }
          clear();
        }}
        onPointerUp={(e) => {
          if (e.pointerType === "touch") {
            touches.current.delete(e.pointerId);
            if (pinch.current || suppressTouch.current) {
              if (pinch.current && pinchResult.current) onViewport(pinchResult.current);
              if (!touches.current.size) { pinch.current = null; suppressTouch.current = false; }
              pinchResult.current = null;
              clear();
              return;
            }
          }
          const g = gesture.current;
          if (!g) return;
          if (g.wallHandle && !g.dragged) {
            onWallHandleSelect?.(g.wallHandle);
            clear();
            return;
          }
          if (tool === "pan") {
            if (g.dragged) onViewport(panViewport(g, e.clientX, e.clientY));
            else if (g.target?.startsWith("segment:") || g.target?.startsWith("room:")) pick(g.target);
            else onSelection("", "");
            clear();
            return;
          }
          if (tool === "selectRoom" && g.dragged) {
            onViewport(panViewport(g, e.clientX, e.clientY));
            clear();
            return;
          }
          if (tool === "wall") {
            if (e.pointerType === "touch") {
              if (g.dragged) onViewport(panViewport(g, e.clientX, e.clientY));
              else {
                const candidate = pickWallCandidate(e.clientX, e.clientY);
                if (candidate) {
                  if (!pendingWallStart) setPendingWallStart({ point: candidate.point, source: candidate.type === "wallEnd" ? "wallEnd" : "grid", vertexId: candidate.vertexId });
                  else if (Math.hypot(candidate.point.x - pendingWallStart.point.x, candidate.point.y - pendingWallStart.point.y) > 1) {
                    onDrawWall?.(pendingWallStart.point, firstWallContact(pendingWallStart.point, candidate.point).axis);
                    setPendingWallStart(null);
                    setHoverWallPoint(null);
                  }
                }
              }
              clear();
              return;
            }
            const end = touchPoint(e);
            const start = wallPreview?.start ?? g.world;
            if (end && Math.hypot(end.x - start.x, end.y - start.y) > 1)
              onDrawWall?.({ x: start.x, y: start.y }, firstWallContact(start, end).axis);
            clear();
            return;
          }
          const p = world(e);
          if (!p) {
            clear();
            return;
          }
          if (g.dragged) {
            if (layout && onShift)
              onShift(
                layout.offset_x + p.x - g.world.x,
                layout.offset_y + p.y - g.world.y,
              );
          } else {
            const hit = target(
              p,
              (e.pointerType === "mouse" ? 8 : 12) / screenScale(),
            );
            const direct = g.target;
            if (tool === "select" && direct)
              pick(direct);
            else if (tool === "selectRoom") chooseRoom(p);
            else if (tool === "select") {
              if (hit)
                onSelection(
                  "vertexId" in hit ? hit.vertexId : "",
                  "segmentId" in hit ? hit.segmentId : "",
                );
              else chooseRoom(p);
            }
          }
          clear();
        }}
      >
        <g transform="scale(1,-1)">
          <defs><pattern id="wall-cursor-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="4" height="4" fill="#e6e6e6" /><line x1="0" y1="0" x2="0" y2="4" stroke="#666" strokeWidth="1" />
          </pattern></defs>
          <g className="canvas-grid canvas-grid-minor" pointerEvents="none">
            {minorGrid?.xs.filter((x) => Math.round(x / 10) % 10 !== 0).map((x) => (
              <line key={"mx" + x} x1={x} x2={x} y1={bottom} y2={bottom + height} />
            ))}
            {minorGrid?.ys.filter((y) => Math.round(y / 10) % 10 !== 0).map((y) => (
              <line key={"my" + y} x1={left} x2={left + width} y1={y} y2={y} />
            ))}
          </g>
          <g className="canvas-grid canvas-grid-major" pointerEvents="none">
            {majorGrid?.xs.filter((x) => Math.round(x / 100) % 10 !== 0).map((x) => (
              <line
                key={"x" + x}
                x1={x}
                x2={x}
                y1={bottom}
                y2={bottom + height}
              />
            ))}
            {majorGrid?.ys.filter((y) => Math.round(y / 100) % 10 !== 0).map((y) => (
              <line key={"y" + y} x1={left} x2={left + width} y1={y} y2={y} />
            ))}
          </g>
          <g className="canvas-grid canvas-grid-thousand" pointerEvents="none">
            {thousandGrid.xs.map((x) => <line key={"tx" + x} x1={x} x2={x} y1={bottom} y2={bottom + height} />)}
            {thousandGrid.ys.map((y) => <line key={"ty" + y} x1={left} x2={left + width} y1={y} y2={y} />)}
          </g>
          {tool === "wall" && matchMedia("(hover: none) and (pointer: coarse)").matches &&
            <g className="wall-candidates" pointerEvents="none">
              {wallCandidates.map((candidate, index) =>
                <circle key={index} data-candidate={candidate.type} cx={candidate.point.x} cy={candidate.point.y}
                  r={5 / screenScale()} />)}
            </g>}
          {pendingWallStart && <g className="wall-ruler" pointerEvents="none">
            <line className="ruler-axis" x1={left} y1={pendingWallStart.point.y} x2={left + width} y2={pendingWallStart.point.y} />
            <line className="ruler-axis" x1={pendingWallStart.point.x} y1={bottom} x2={pendingWallStart.point.x} y2={bottom + height} />
            {pendingWallStart.vertexId && graph.segments.filter((segment) =>
              segment.startVertexId === pendingWallStart.vertexId || segment.endVertexId === pendingWallStart.vertexId).map((segment) => {
                const a = vs.get(segment.startVertexId)!, b = vs.get(segment.endVertexId)!;
                const len = Math.hypot(b.x - a.x, b.y - a.y);
                if (!len) return null;
                const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
                const reach = Math.hypot(width, height);
                return <line key={segment.id} className="ruler-perpendicular"
                  x1={pendingWallStart.point.x - nx * reach} y1={pendingWallStart.point.y - ny * reach}
                  x2={pendingWallStart.point.x + nx * reach} y2={pendingWallStart.point.y + ny * reach} />;
              })}
            {hoverWallPoint && <>
              <line x1={pendingWallStart.point.x} y1={pendingWallStart.point.y} x2={hoverWallPoint.x} y2={hoverWallPoint.y} />
              <line className="ruler-axis" x1={pendingWallStart.point.x} y1={pendingWallStart.point.y} x2={hoverWallPoint.x} y2={pendingWallStart.point.y} />
              <line className="ruler-axis" x1={hoverWallPoint.x} y1={pendingWallStart.point.y} x2={hoverWallPoint.x} y2={hoverWallPoint.y} />
              <text x={(pendingWallStart.point.x + hoverWallPoint.x) / 2} y={(pendingWallStart.point.y + hoverWallPoint.y) / 2}
                transform={`translate(0,${pendingWallStart.point.y + hoverWallPoint.y}) scale(1,-1)`}
                fontSize={14 / screenScale()} textAnchor="middle">
                {Math.round(Math.hypot(hoverWallPoint.x - pendingWallStart.point.x, hoverWallPoint.y - pendingWallStart.point.y))} мм
              </text>
            </>}
          </g>}
          {faces.map((f) => (
            <path
              key={f.topologyKey}
              d={path([(f.polygon ?? f.axisPolygon).outline, ...(f.polygon ?? f.axisPolygon).holes] as [
                number,
                number,
              ][][])}
              className={"room-face " + (f.topologyKey === selectedKey ? "selected " : "") + (roomMissing[f.topologyKey] ? "missing-layout" : "")}
              fillRule="evenodd"
              {...targetProps(
                "room",
                f.topologyKey,
                `${roomNames[f.topologyKey] || `Помещение ${faces.indexOf(f) + 1}`}${roomMissing[f.topologyKey] ? ", нет актуальной раскладки" : ""}`,
              )}
            />
          ))}
          {faces.map(f => {
            const name = roomNames[f.topologyKey];
            if (!name) return null;
            const shape = f.polygon ?? f.axisPolygon;
            const [x,y,labelWidth] = roomLabelPoint(shape.outline, shape.holes);
            const maxChars = Math.max(1, Math.floor(labelWidth * screenScale() / 8) - 2);
            return <text key={'label:'+f.topologyKey} data-room-label={f.topologyKey} x={x} y={y} transform={`translate(0,${2*y}) scale(1,-1)`} textAnchor="middle" dominantBaseline="middle" fontSize={14 / screenScale()} pointerEvents="none" fill="#333" aria-label={name}><title>{name}</title>{name.length > maxChars ? name.slice(0, Math.max(0,maxChars-1))+'…' : name}</text>;
          })}
          {voidRings.map((v, i) => (
            <path
              key={v.id}
              d={path([v.points] as [number, number][][])}
              className="void-face"
              {...targetProps("void", v.id, `Отверстие ${i + 1}`)}
            />
          ))}
          {layout?.parts.map((p) => (
            <path
              key={p.id}
              d={path(p.rings)}
              fill={p.issues.length ? "#bbb" : "#d4d4d4"}
              fillRule="evenodd"
              stroke="#777"
              strokeWidth={1 / screenScale()}
              onClick={() => {
                if (tool !== "selectRoom" && !gesture.current?.dragged) onPart?.(p.id);
              }}
            />
          ))}
          {wallPreviewShape && <path className="physical-wall-preview"
            d={path([wallPreviewShape])} pointerEvents="none" />}
          {wallArea.map((polygon, index) => (
            <path key={`wall-area:${index}`} className="physical-wall"
              d={path([polygon.outline, ...polygon.holes] as [number, number][][])}
              fillRule="evenodd" pointerEvents="none" />
          ))}
          {selectedFootprint && <path data-selected-wall-footprint={selectedWall?.id}
            className="selected-wall-footprint" d={path([selectedFootprint.map((point) => [point.x, point.y]) as [number, number][]])}
            pointerEvents="none" />}
          {tool === "wall" && preview && matchMedia("(hover: hover) and (pointer: fine)").matches &&
            <rect className="wall-cursor" x={preview.x - 5} y={preview.y - 5} width="10" height="10"
              fill="url(#wall-cursor-hatch)" pointerEvents="none" />}
          {graph.segments.map((s) => {
            const a = vs.get(s.startVertexId)!,
              b = vs.get(s.endVertexId)!;
            return (
              <g
                key={s.id}
                {...targetProps(
                  "segment",
                  s.id,
                  `Стена ${graph.segments.indexOf(s) + 1}`,
                )}
              >
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  className={
                    "graph-wall " +
                    (selectedRange.includes(s.id) ||
                    highlightedSegments?.includes(s.id)
                      ? "selected"
                      : "")
                  }
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="none"
                />
                <rect
                  x={Math.min(a.x, b.x) - 10 / screenScale()}
                  y={Math.min(a.y, b.y) - 10 / screenScale()}
                  width={Math.max(Math.abs(a.x - b.x), 1) + 20 / screenScale()}
                  height={Math.max(Math.abs(a.y - b.y), 1) + 20 / screenScale()}
                  fill="none"
                  pointerEvents="none"
                />
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke="transparent"
                  strokeWidth={20 / screenScale()}
                  pointerEvents="stroke"
                />
              </g>
            );
          })}
          {(editor.interaction.kind === "rangeFirst" || editor.interaction.kind === "rangeSecond") &&
            chainNodes(graph, editor.interaction.chainId).map((id) => {
              const vertex = vs.get(id);
              return vertex ? <circle key={`range:${id}`} cx={vertex.x} cy={vertex.y}
                r={12 / screenScale()} fill="transparent"
                {...targetProps("vertex", id, "Конец диапазона стены")}
              /> : null;
            })}
          {selectedWall && editor.interaction.kind === "idle" &&
            <g className="selected-wall-angles" pointerEvents="none">
              {selectedAngleVisuals.map(({ angle, start, delta, label }) => {
                const radius = 29 / screenScale();
                const points = Array.from({ length: 9 }, (_, step) => {
                  const theta = start + delta * step / 8;
                  return `${angle.origin.x + Math.cos(theta) * radius},${angle.origin.y + Math.sin(theta) * radius}`;
                }).join(' ');
                return <g key={`${angle.junctionVertexId}:${angle.adjacentChainId}`}>
                  <polyline data-angle-arc points={points} fill="none" stroke="#444" strokeWidth={2 / screenScale()} />
                  <text data-angle-label transform={`translate(${label.x},${label.y}) scale(1,-1)`} textAnchor="middle"
                    dominantBaseline="middle" fontSize={12 / screenScale()} fill="#333"
                    stroke="#fff" strokeWidth={3 / screenScale()} paintOrder="stroke">
                    {angle.value.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}°
                  </text>
                </g>;
              })}
            </g>}
          {selectedWall && editor.interaction.kind === "idle" && (["start", "center", "end"] as const).map((handle) => {
            const a = vs.get(selectedWall.startVertexId)!;
            const b = vs.get(selectedWall.endVertexId)!;
            const point = handle === "start" ? a : handle === "end" ? b : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            return <g key={handle} data-wall-handle={handle} aria-label={`Точка стены: ${handle === "start" ? "начало" : handle === "end" ? "конец" : "середина"}`}>
              <circle cx={point.x} cy={point.y} r={22.1 / screenScale()} fill="transparent" />
              <circle className={"wall-handle " + (selectedWallHandle === handle ? "selected" : "")} cx={point.x} cy={point.y} r={7 / screenScale()} pointerEvents="none" />
            </g>;
          })}
          <DimensionOverlay
            graph={graph}
            scale={screenScale()}
            selectedSegment={selectedSegment}
            activeTarget={active}
          />
          {graph.constraints.map((c, i) => {
            const edge = graph.segments.find(
              (s) =>
                s.id === c.target.segmentId ||
                s.chainId === c.target.chainId ||
                s.id === c.target.firstSegmentId,
            );
            const vertex = vs.get(c.target.vertexId || "");
            const a = vertex || (edge ? vs.get(edge.startVertexId) : undefined),
              b = edge ? vs.get(edge.endVertexId) : undefined;
            const x = a ? (a.x + (b?.x ?? a.x)) / 2 : left + width / 2,
              y = a
                ? (a.y + (b?.y ?? a.y)) / 2
                : viewport.centerY - (i * 30) / screenScale();
            return (
              <g
                key={c.id}
                {...targetProps("constraint", c.id, `Условие ${i + 1}`)}
                transform={`translate(${x},${y - 28 / screenScale()}) scale(1,-1)`}
              >
                <rect
                  x={-12 / screenScale()}
                  y={-12 / screenScale()}
                  width={24 / screenScale()}
                  height={24 / screenScale()}
                  rx={5 / screenScale()}
                  fill="#eee"
                  stroke="#666"
                  strokeWidth={1 / screenScale()}
                />
                <text
                  textAnchor="middle"
                  dy={4 / screenScale()}
                  fontSize={12 / screenScale()}
                >
                  {c.fixed ? "●" : "○"}
                </text>
              </g>
            );
          })}
        </g>
        {diagnostic && (
          <g
            className="diagnostic-overlay"
            pointerEvents="none"
            aria-hidden="true"
          >
            {diagnostic.segmentIds.map((id) => {
              const wall = graph.segments.find((s) => s.id === id);
              if (!wall) return null;
              const a = vs.get(wall.startVertexId)!,
                b = vs.get(wall.endVertexId)!;
              return (
                <g key={id} data-diagnostic-wall={id}>
                  <line
                    x1={a.x}
                    y1={-a.y}
                    x2={b.x}
                    y2={-b.y}
                    className="diagnostic-wall"
                    vectorEffect="non-scaling-stroke"
                  />
                  <g
                    transform={`translate(${(a.x + b.x) / 2},${-(a.y + b.y) / 2}) scale(${1 / screenScale()})`}
                  >
                    <path
                      d="M -8 -8 L 8 8 M -8 8 L 8 -8"
                      className="diagnostic-wall"
                    />
                  </g>
                </g>
              );
            })}
          </g>
        )}
      </svg>
      {pendingWallStart && <button className="cancel-wall-start" type="button"
        onClick={() => { setPendingWallStart(null); setHoverWallPoint(null); clear(); }}>
        Отменить начало стены
      </button>}
      {children}
    </div>
  );
}
