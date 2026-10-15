import { roomLabelPoint } from "../../domain/plan/room-label";
import {
  rangeSegments,
  chainNodes,
  type EditorState,
  type EditorTool,
} from "../../domain/plan/editor-state";
import {
  blockingVertices,
  VERTEX_SAFETY_RADIUS,
} from "../../domain/plan/vertex-safety";
import DimensionOverlay from "./DimensionOverlay";
import { useRef, useState, useEffect, useLayoutEffect } from "react";
import type {
  GraphSnapshot,
  FaceCandidate,
  ProjectDocumentV4,
  Point,
  DiagnosticSelection,
} from "../../domain/plan/types";
import type { Layout } from "../../types";
import { path } from "../../types";
import { snap } from "../../domain/room/snapping";
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
  onSector,
  onCanvasFocus,
  faces,
  wallArea = [],
  roomNames = {},
  selectedKey,
  viewport,
  tool,
  wallThickness = 100,
  onDrawWall,
  selectedVertex,
  selectedSegment,
  startVertex,
  diagnostic,
  blockedVertex,
  onBlocked,
  onPoint,
  onSelection,
  onRoom,
  onMove,
  onViewport,
  layout,
  angle,
  onShift,
  onPart,
  onCancel,
  children,
}: {
  graph: GraphSnapshot;
  onCanvasFocus: () => void;
  onSector: (sector: "cw" | "ccw") => void;
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
  selectedKey?: string | null;
  viewport: ProjectDocumentV4["viewport"];
  tool: Tool;
  wallThickness?: number;
  onDrawWall?: (start: Point, end: Point) => void;
  selectedVertex: string;
  selectedSegment: string;
  startVertex: string | null;
  diagnostic: DiagnosticSelection | null;
  blockedVertex: string;
  onBlocked: (ids: string[], point: Point) => void;
  onPoint: (
    p: Point,
    target: { vertexId?: string; segmentId?: string },
  ) => void;
  onSelection: (v: string, s: string) => void;
  onRoom: (f: FaceCandidate) => void;
  onMove: (v: string, p: Point) => void;
  onViewport: (v: ProjectDocumentV4["viewport"]) => void;
  layout?: Layout;
  angle?: {
    vertexId: string;
    first: string;
    second: string;
    sector: "cw" | "ccw";
  };
  onShift?: (x: number, y: number) => void;
  onPart?: (id: string) => void;
  onCancel: () => void;
  children: React.ReactNode;
}) {
  const svg = useRef<SVGSVGElement>(null),
    touches = useRef(new Map<number, Point>()),
    pinch = useRef<{ distance: number; zoom: number; anchor: Point } | null>(null),
    suppressTouch = useRef(false),
    gesture = useRef<{
      id: number;
      client: Point;
      world: Point;
      vertexId?: string;
      target?: string;
      viewport: typeof viewport;
      dragged: boolean;
    } | null>(null);
  const [preview, setPreview] = useState<(Point & { type: string }) | null>(
      null,
    ),
    [dragPoint, setDragPoint] = useState<Point | null>(null),
    [pendingPoint, setPendingPoint] = useState<Point | null>(null),
    [pendingMove, setPendingMove] = useState<{ vertexId: string; point: Point } | null>(null),
    [wallPreview, setWallPreview] = useState<{ start: Point; end: Point } | null>(null),
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
      const leftEdge = Math.max(rect.left, Math.min(rect.right, sideRight + 8));
      const rightEdge = panelRect && panelRect.top < rect.bottom && panelRect.height > rect.height * .5
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
  const width = 9000 / renderedViewport.zoom,
    height = (width * size.height) / Math.max(1, size.width),
    left = renderedViewport.centerX - width / 2 - sidebarShift * width / Math.max(1, size.width),
    bottom =
      renderedViewport.centerY - height / 2 - (panelLift * width) / Math.max(1, size.width);
  const vs = new Map(graph.vertices.map((v) => [v.id, v]));
  // The viewBox shares the observed viewport aspect ratio, so scale is uniform.
  // Derive render sizes from current props, never the previous render's CTM.
  const screenScale = () => Math.max(size.width, 1) / width;
  const blockers = (point: Point) => {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return null;
    const screen = (p: Point) =>
      new DOMPoint(p.x, -p.y).matrixTransform(matrix);
    return blockingVertices(
      screen(point),
      graph.vertices.map((v) => ({ id: v.id, x: screen(v).x, y: screen(v).y })),
    );
  };
  const placementPoint = pendingPoint && tool === "addVertex" ? { ...pendingPoint, type: "Вершина" } : preview;
  const previewBlocked =
    placementPoint && tool === "addVertex"
      ? blockingVertices(
          { x: placementPoint.x * screenScale(), y: placementPoint.y * screenScale() },
          graph.vertices.map((v) => ({
            id: v.id,
            x: v.x * screenScale(),
            y: v.y * screenScale(),
          })),
        )
      : [];
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
    if (vertex && tool !== "angle")
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
    if ((tool === "connect" || tool === "wall") && hit) return { ...hit.p, type: hit.type };
    return snap(p.x, p.y, viewport.gridStepMm, r);
  };
  const clear = () => {
    gesture.current = null;
    setDragPoint(null);
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
  useEffect(() => { clear(); setPendingPoint(null); setPendingMove(null); touches.current.clear(); pinch.current = null; }, [tool]);
  const [active, setActive] = useState(""),
    [cursor, setCursor] = useState<Point>({
      x: viewport.centerX,
      y: viewport.centerY,
    }),
    [keyboardMove, setKeyboardMove] = useState<string | null>(null);
  useEffect(() => {
    setKeyboardMove(null);
    setCursor({ x: viewport.centerX, y: viewport.centerY });
  }, [tool]);
  useEffect(() => {
    setActive("");
    setKeyboardMove(null);
    setCursor({ x: viewport.centerX, y: viewport.centerY });
    clear();
    setPendingPoint(null);
    setPendingMove(null);
    touches.current.clear();
    pinch.current = null;
  }, [resetEpoch]);
  const touchPoint = (e: React.PointerEvent) => snapped(e, e.pointerType === "touch" && (tool === "addVertex" || tool === "move") ? 48 : 0);
  const beginPinch = () => {
    const [a, b] = [...touches.current.values()];
    const anchor = clientWorld((a.x + b.x) / 2, (a.y + b.y) / 2);
    if (!anchor) return;
    pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: viewport.zoom, anchor };
    suppressTouch.current = true;
    setPendingPoint(null);
    setPendingMove(null);
    clear();
  };
  const updatePinch = () => {
    if (!pinch.current || touches.current.size < 2 || !svg.current) return;
    const [a, b] = [...touches.current.values()];
    const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    const zoom = Math.max(0.2, Math.min(8, pinch.current.zoom * distance / Math.max(1, pinch.current.distance)));
    const rect = svg.current.getBoundingClientRect();
    const span = 9000 / zoom;
    onViewport({ ...viewport, zoom,
      centerX: pinch.current.anchor.x - (middle.x - rect.left - rect.width / 2 - sidebarShift) * span / rect.width,
      centerY: pinch.current.anchor.y + (middle.y - rect.top - rect.height / 2 + panelLift) * span / rect.width,
    });
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
      onVoid(hole.id);
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
    ...(editor.interaction.kind === "angleSector" ? ["arc:ccw", "arc:cw"] : []),
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
      : editor.interaction.kind === "angleSector"
        ? ["arc:ccw", "arc:cw"]
        : tool === "angle"
          ? targets.filter((t) => t.startsWith("segment:"))
          : tool === "move"
            ? targets.filter((t) => t.startsWith("vertex:"))
            : targets;
  useEffect(() => {
    if (active && !targets.includes(active)) {
      setActive("");
      svg.current?.focus();
      setKeyboardMove(null);
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
  const pick = (id: string, keyboard = false) => {
    const split = id.indexOf(":"),
      kind = id.slice(0, split),
      value = id.slice(split + 1);
    setActive(id);
    if (tool === "angle" && kind !== "arc" && kind !== "segment") return;
    if (kind === "arc") {
      onSector(value as "cw" | "ccw");
      return;
    }
    if (kind === "vertex") {
      const v = vs.get(value);
      if (!v) return;
      if (
        editor.interaction.kind === "rangeFirst" ||
        editor.interaction.kind === "rangeSecond"
      )
        onSelection(value, "");
      else if (tool === "connect") onPoint(v, { vertexId: value });
      else if (tool === "move" && keyboard) {
        if (keyboardMove) {
          onMove(keyboardMove, cursor);
          setKeyboardMove(null);
        } else {
          setKeyboardMove(value);
          setCursor(v);
        }
      } else onSelection(value, "");
    } else if (kind === "segment") {
      const s = graph.segments.find((s) => s.id === value);
      if (!s) return;
      const a = vs.get(s.startVertexId)!,
        b = vs.get(s.endVertexId)!;
      if (tool === "connect")
        onPoint(
          keyboard ? cursor : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
          { segmentId: value },
        );
      else onSelection("", value);
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
      if (tool === "connect" && kind === "segment") {
        const edge = graph.segments.find((s) => s.id === id)!,
          a = vs.get(edge.startVertexId)!,
          b = vs.get(edge.endVertexId)!;
        setCursor({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      }
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
  const grid = viewport.gridStepMm;
  const xs: number[] = [],
    ys: number[] = [];
  // Draw only a readable level of the grid; the document's snapping step stays exact.
  const stride = Math.max(1, Math.ceil(16 / (grid * screenScale()))),
    visible = grid * stride;
  for (
    let x = Math.ceil(left / visible) * visible;
    x < left + width;
    x += visible
  )
    xs.push(x);
  for (
    let y = Math.ceil(bottom / visible) * visible;
    y < bottom + height;
    y += visible
  )
    ys.push(y);
  return (
    <div
      className="project-canvas"
      data-project-canvas
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          clear();
          setPendingPoint(null);
          setPendingMove(null);
          onCancel();
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
            setKeyboardMove(null);
            clear();
            setPendingPoint(null);
            setPendingMove(null);
            onCancel();
            return;
          }
          const step = e.shiftKey ? 1 : viewport.gridStepMm;
          if (e.key.startsWith("Arrow")) {
            e.preventDefault();
            e.stopPropagation();
            if (tool === "pan") {
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
            if (tool === "addVertex" || keyboardMove) {
              setCursor((p) => ({
                x:
                  p.x +
                  (e.key === "ArrowRight"
                    ? step
                    : e.key === "ArrowLeft"
                      ? -step
                      : 0),
                y:
                  p.y +
                  (e.key === "ArrowUp"
                    ? step
                    : e.key === "ArrowDown"
                      ? -step
                      : 0),
              }));
              return;
            }
            if (
              tool === "connect" &&
              startVertex &&
              active.startsWith("segment:") &&
              (e.key === "ArrowLeft" || e.key === "ArrowRight")
            ) {
              const s = graph.segments.find((s) => s.id === active.slice(8))!,
                a = vs.get(s.startVertexId)!,
                b = vs.get(s.endVertexId)!,
                dx = b.x - a.x,
                dy = b.y - a.y,
                l = Math.hypot(dx, dy);
              const t = Math.max(
                0,
                Math.min(
                  1,
                  ((cursor.x - a.x) * dx + (cursor.y - a.y) * dy) / (l * l) +
                    (e.key === "ArrowRight" ? step : -step) / l,
                ),
              );
              setCursor({ x: a.x + t * dx, y: a.y + t * dy });
              return;
            }
            const delta =
                e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1,
              i = eligible.indexOf(active),
              next = eligible[(i + delta + eligible.length) % eligible.length];
            if (next) {
              focusTarget(next);
              if (next.startsWith("segment:")) {
                const s = graph.segments.find((s) => s.id === next.slice(8))!,
                  a = vs.get(s.startVertexId)!,
                  b = vs.get(s.endVertexId)!;
                setCursor({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
              }
            }
            return;
          }
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            if (tool === "addVertex") {
              const ids = blockers(cursor);
              if (ids?.length) onBlocked(ids, cursor);
              else if (ids) onPoint(cursor, {});
            } else if (active) pick(active, true);
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
            setPendingPoint(null);
            setPendingMove(null);
            setPreview(touchPoint(e));
          }
          const p = world(e);
          if (!p) return;
          const hit = target(
            p,
            (e.pointerType === "mouse" ? 8 : 12) / screenScale(),
          );
          gesture.current = {
            id: e.pointerId,
            client: { x: e.clientX, y: e.clientY },
            world: p,
            target:
              (e.target as Element)
                .closest("[data-target]")
                ?.getAttribute("data-target") || undefined,
            vertexId: hit && "vertexId" in hit ? hit.vertexId : undefined,
            viewport: { ...viewport },
            dragged: false,
          };
          if (tool === "wall") {
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
          if (tool === "wall") setWallPreview((current) => current ? { ...current, end: touchPoint(e) ?? current.end } : current);
          if (Math.hypot(e.clientX - g.client.x, e.clientY - g.client.y) > 4)
            g.dragged = true;
          if (tool === "move" && g.vertexId) setDragPoint(touchPoint(e));
          if (tool === "pan" && g.dragged)
            setLiveViewport(panViewport(g, e.clientX, e.clientY));
        }}
        onPointerCancel={(e) => {
          const wasPinching = !!pinch.current;
          touches.current.delete(e.pointerId);
          pinch.current = null;
          setPendingPoint(null);
          setPendingMove(null);
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
              if (!touches.current.size) { pinch.current = null; suppressTouch.current = false; }
              clear();
              return;
            }
          }
          const g = gesture.current;
          if (!g) return;
          if (tool === "pan") {
            if (g.dragged) onViewport(panViewport(g, e.clientX, e.clientY));
            clear();
            return;
          }
          if (tool === "wall") {
            const end = touchPoint(e);
            const start = wallPreview?.start ?? g.world;
            if (end && Math.hypot(end.x - start.x, end.y - start.y) > 1)
              onDrawWall?.({ x: start.x, y: start.y }, firstWallContact(start, end).axis);
            clear();
            return;
          }
          const p = world(e),
            s = touchPoint(e);
          if (!p || !s) {
            clear();
            return;
          }
          if (tool === "addVertex" && e.pointerType === "touch") {
            setPendingPoint({ x: s.x, y: s.y });
            setPreview(s);
            gesture.current = null;
            return;
          }
          if (tool === "move" && e.pointerType === "touch" && g.dragged && g.vertexId) {
            setPendingMove({ vertexId: g.vertexId, point: { x: s.x, y: s.y } });
            clear();
            return;
          }
          if (g.dragged) {
            if (tool === "move" && g.vertexId)
              onMove(g.vertexId, { x: s.x, y: s.y });
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
            if (
              (tool === "select" || tool === "move" || tool === "angle") &&
              direct
            )
              pick(direct);
            else if (tool === "selectRoom") chooseRoom(p);
            else if (tool === "select" || tool === "move" || tool === "angle") {
              if (hit)
                onSelection(
                  "vertexId" in hit ? hit.vertexId : "",
                  "segmentId" in hit ? hit.segmentId : "",
                );
              else chooseRoom(p);
            } else if (tool === "addVertex") {
              const ids = blockers(s);
              if (ids === null) {
                clear();
                return;
              }
              if (ids.length) onBlocked(ids, { x: s.x, y: s.y });
              else onPoint({ x: s.x, y: s.y }, {});
            } else
              onPoint(
                tool === "connect" && hit ? hit.p : { x: s.x, y: s.y },
                hit
                  ? {
                      ...("vertexId" in hit
                        ? { vertexId: hit.vertexId }
                        : { segmentId: hit.segmentId }),
                    }
                  : {},
              );
          }
          clear();
        }}
      >
        <g transform="scale(1,-1)">
          <g className="canvas-grid" pointerEvents="none">
            {xs.map((x) => (
              <line
                key={"x" + x}
                x1={x}
                x2={x}
                y1={bottom}
                y2={bottom + height}
              />
            ))}
            {ys.map((y) => (
              <line key={"y" + y} x1={left} x2={left + width} y1={y} y2={y} />
            ))}
          </g>
          {faces.map((f) => (
            <path
              key={f.topologyKey}
              d={path([(f.polygon ?? f.axisPolygon).outline, ...(f.polygon ?? f.axisPolygon).holes] as [
                number,
                number,
              ][][])}
              className={
                "room-face " + (f.topologyKey === selectedKey ? "selected" : "")
              }
              fillRule="evenodd"
              {...targetProps(
                "room",
                f.topologyKey,
                roomNames[f.topologyKey] || `Помещение ${faces.indexOf(f) + 1}`,
              )}
            />
          ))}
          {faces.map(f => {
            const name = roomNames[f.topologyKey];
            if (!name) return null;
            const shape = f.polygon ?? f.axisPolygon;
            const [x,y,labelWidth] = roomLabelPoint(shape.outline, shape.holes);
            const maxChars = Math.max(1, Math.floor(labelWidth * screenScale() / 8) - 2);
            return <text key={'label:'+f.topologyKey} data-room-label={f.topologyKey} x={x} y={y} transform={`translate(0,${2*y}) scale(1,-1)`} textAnchor="middle" dominantBaseline="middle" fontSize={14 / screenScale()} pointerEvents="none" fill="#263b35" aria-label={name}><title>{name}</title>{name.length > maxChars ? name.slice(0, Math.max(0,maxChars-1))+'…' : name}</text>;
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
              fill={p.issues.length ? "#edcc9e" : "#bdd3c8"}
              fillRule="evenodd"
              stroke="#718e81"
              strokeWidth={1 / screenScale()}
              onClick={() => {
                if (!gesture.current?.dragged) onPart?.(p.id);
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
                    (s.id === selectedSegment ||
                    (editor.interaction.kind === "angleSecond" &&
                      s.id === editor.interaction.firstSegmentId) ||
                    (editor.interaction.kind === "angleSector" &&
                      [
                        editor.interaction.firstSegmentId,
                        editor.interaction.secondSegmentId,
                      ].includes(s.id)) ||
                    selectedRange.includes(s.id) ||
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
          <DimensionOverlay
            graph={graph}
            scale={screenScale()}
            selectedSegment={selectedSegment}
            angle={
              editor.context.kind === "angle"
                ? {
                    vertexId: editor.context.vertexId,
                    first: editor.context.firstSegmentId,
                    second: editor.context.secondSegmentId,
                    sector: editor.context.sector,
                  }
                : angle
            }
            anglePair={
              editor.interaction.kind === "angleSector"
                ? editor.interaction
                : undefined
            }
            activeTarget={active}
            onSector={onSector}
          />
          {tool === "addVertex" &&
            graph.vertices.map((v) => (
              <circle
                key={"safety:" + v.id}
                data-safety-vertex={v.id}
                cx={v.x}
                cy={v.y}
                r={VERTEX_SAFETY_RADIUS / screenScale()}
                className={
                  "vertex-safety-zone " +
                  (previewBlocked.includes(v.id) || blockedVertex === v.id
                    ? "blocked"
                    : "")
                }
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            ))}
          {graph.vertices.map((v) => (
            <circle
              key={v.id}
              cx={v.x}
              cy={v.y}
              r={
                (v.id === selectedVertex ||
                v.id === startVertex ||
                v.id === blockedVertex ||
                rangeEnds.includes(v.id)
                  ? 7
                  : 4) / screenScale()
              }
              className={
                "graph-vertex " +
                (v.id === selectedVertex ||
                v.id === startVertex ||
                v.id === blockedVertex ||
                rangeEnds.includes(v.id)
                  ? "selected"
                  : "")
              }
              {...targetProps(
                "vertex",
                v.id,
                `Вершина ${graph.vertices.indexOf(v) + 1}`,
              )}
              pointerEvents={tool === "angle" ? "none" : "all"}
            />
          ))}
          {(tool === "addVertex" ||
            keyboardMove ||
            (tool === "connect" && startVertex)) && (
            <circle
              data-keyboard-cursor
              cx={cursor.x}
              cy={cursor.y}
              r={8 / screenScale()}
              fill="none"
              stroke="#ad5b24"
              strokeWidth={2 / screenScale()}
              pointerEvents="none"
            />
          )}
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
                  fill="#fff9e7"
                  stroke="#946537"
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
          {placementPoint && ["addVertex", "connect", "move"].includes(tool) && (
            <circle
              cx={placementPoint.x}
              cy={placementPoint.y}
              r={8 / screenScale()}
              fill="none"
              stroke={previewBlocked.length ? "#a5352b" : "#b86b38"}
              data-placement-blocked={previewBlocked.length ? "true" : "false"}
              strokeDasharray={
                previewBlocked.length
                  ? `${3 / screenScale()} ${2 / screenScale()}`
                  : undefined
              }
              strokeWidth={2 / screenScale()}
              pointerEvents="none"
            />
          )}
          {startVertex && preview && vs.has(startVertex) && (
            <line
              x1={vs.get(startVertex)!.x}
              y1={vs.get(startVertex)!.y}
              x2={preview.x}
              y2={preview.y}
              stroke="#b86b38"
              strokeDasharray={`${6 / screenScale()} ${4 / screenScale()}`}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          )}
          {dragPoint && gesture.current?.vertexId && (
            <circle
              data-drag-preview
              cx={dragPoint.x}
              cy={dragPoint.y}
              r={8 / screenScale()}
              fill="#b86b38"
              pointerEvents="none"
            />
          )}
          {pendingMove && (
            <circle
              cx={pendingMove.point.x}
              cy={pendingMove.point.y}
              r={10 / screenScale()}
              fill="none"
              stroke="#b86b38"
              strokeWidth={2 / screenScale()}
              pointerEvents="none"
            />
          )}
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
            {diagnostic.vertexIds.map((id, i) => {
              const v = vs.get(id);
              if (!v) return null;
              return (
                <g
                  key={id}
                  data-diagnostic-vertex={id}
                  transform={`translate(${v.x},${-v.y}) scale(${1 / screenScale()})`}
                >
                  <circle r={10 + i * 3} className="diagnostic-node" />
                  <text x="20" y={-20 - i * 24}>
                    Вершина {graph.vertices.findIndex((v) => v.id === id) + 1}
                  </text>
                </g>
              );
            })}
          </g>
        )}
      </svg>
      {placementPoint && previewBlocked.length > 0 && (
        <span className="snap-status" aria-live="off">
          Зона безопасности: точку создать нельзя
        </span>
      )}
      {pendingPoint && tool === "addVertex" && (
        <div className="mobile-placement" data-overlay role="group" aria-label="Размещение вершины">
          <button onClick={() => {
            const ids = blockers(pendingPoint);
            if (ids?.length) onBlocked(ids, pendingPoint);
            else if (ids) onPoint(pendingPoint, {});
            setPendingPoint(null);
            setPreview(null);
          }}>Поставить вершину</button>
          <button onClick={() => { setPendingPoint(null); setPreview(null); }}>Отмена</button>
        </div>
      )}
      {pendingMove && tool === "move" && (
        <div className="mobile-placement" data-overlay role="group" aria-label="Перемещение вершины">
          <button onClick={() => {
            onMove(pendingMove.vertexId, pendingMove.point);
            setPendingMove(null);
          }}>Переместить вершину</button>
          <button onClick={() => setPendingMove(null)}>Отмена</button>
        </div>
      )}
      {children}
    </div>
  );
}
