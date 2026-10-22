import { useEffect, useRef, useState } from "react";
import type { OpenJointAngleV5, PhysicalGraphV5, PhysicalPolygonV5, PhysicalRoomV5, Point, ProjectDocumentV6 } from "../../domain/plan/types";
import { clampZoom, viewportAtAnchor, worldPoint, zoomAroundWorld } from "../../domain/room/viewport";
import { roundTenth } from "../../domain/plan/precision";
import type { Layout } from "../../types";
import { physicalPreview, type PhysicalPreviewResponse } from "../../domain/plan/physical-preview";
import { splitWallDimensions } from "../../domain/plan/physical-dimensions";
import { alignCubeAttachmentToGuides, centeredWallGeometry, immediateJointAngles, nearestCubeAttachment,
  type PhysicalAttachment } from "../../domain/plan/physical-draw";

type Viewport = ProjectDocumentV6["viewport"];
type Handle = "start" | "center" | "end";
type Gesture = { id: number; client: Point; viewport: Viewport; moved: boolean;
  wallId: string | null; roomKey: string | null; handle: Handle | null;
  arrow: { axis: "x" | "y"; direction: -1 | 1 } | null };
type WallTarget = { point: Point; attachment: PhysicalAttachment | null };
type Props = {
  graph: PhysicalGraphV5;
  draftRevision: number;
  wallArea: PhysicalPolygonV5[];
  faces?: PhysicalRoomV5[];
  openJointAngles?: OpenJointAngleV5[];
  selectedRoomKey?: string | null;
  onSelectRoom?: (key: string) => void;
  highlightRooms?: boolean;
  roomMissing?: Record<string, boolean>;
  roomNames?: Record<string, string>;
  layouts?: { roomId: string; layout: Layout }[];
  viewport: Viewport;
  onViewport: (viewport: Viewport) => void;
  selectedWallId: string | null;
  onSelectWall: (wallId: string | null) => void;
  selectedHandle?: Handle | null;
  onSelectHandle?: (handle: Handle) => void;
  onNudge?: (handle: Handle, axis: "x" | "y", direction: -1 | 1) => void;
  wallTool: boolean;
  thicknessMm: number;
  onDrawWall: (edge: [Point, Point]) => void;
  onResetWallTool: () => void;
};

const svgPath = (polygon: PhysicalPolygonV5) =>
  [polygon.outline, ...polygon.holes]
    .map(ring => ring.map(([x, y], index) => `${index ? "L" : "M"}${x} ${-y}`).join(" ") + " Z")
    .join(" ");

const wallPath = (corners: Point[]) =>
  corners.map((point, index) => `${index ? "L" : "M"}${point.x} ${-point.y}`).join(" ") + " Z";

const displayTenth = (value: number) => value.toLocaleString("ru-RU", {
  minimumFractionDigits: 1, maximumFractionDigits: 1,
});

const precisePoint = (point: Point): Point =>
  ({ x: roundTenth(point.x), y: roundTenth(point.y) });

export default function PhysicalCanvas({ graph, draftRevision, wallArea, faces = [], openJointAngles = [],
  selectedRoomKey, onSelectRoom,
  highlightRooms = false, roomMissing = {}, roomNames = {}, layouts = [], viewport, onViewport,
  selectedWallId, onSelectWall, selectedHandle, onSelectHandle, onNudge,
  wallTool, thicknessMm, onDrawWall, onResetWallTool }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  const pinch = useRef<{ anchor: Point; distance: number; zoom: number } | null>(null);
  const suppressTap = useRef(false);
  const wheelViewport = useRef(viewport);
  const [liveViewport, setLiveViewport] = useState<Viewport | null>(null);
  const [size, setSize] = useState({ width: 1000, height: 700 });
  const [start, setStart] = useState<Point | null>(null);
  const [startFace, setStartFace] = useState<PhysicalAttachment | null>(null);
  const [hover, setHover] = useState<Point | null>(null);
  const [hoverFace, setHoverFace] = useState<PhysicalAttachment | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [cursorFace, setCursorFace] = useState<{ normal: Point } | null>(null);
  const [serverPreview, setServerPreview] = useState<{ key: string; response: PhysicalPreviewResponse } | null>(null);
  const mobile = window.matchMedia("(hover: none) and (pointer: coarse)").matches;
  const shown = liveViewport ?? viewport;
  const span = 9000 / shown.zoom;
  const height = span * size.height / Math.max(1, size.width);
  const viewBox = `${shown.centerX - span / 2} ${-shown.centerY - height / 2} ${span} ${height}`;
  const pixelScale = size.width / span;
  const targetSpacingPx = 52;

  useEffect(() => { wheelViewport.current = viewport; }, [viewport]);

  useEffect(() => {
    const node = svg.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const node = svg.current;
    if (!node) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = node.getBoundingClientRect();
      const current = wheelViewport.current;
      const span = 9000 / current.zoom;
      const anchor: Point = {
        x: current.centerX + (event.clientX - rect.left - rect.width / 2) * span / rect.width,
        y: current.centerY - (event.clientY - rect.top - rect.height / 2) * span / rect.width,
      };
      const zoom = clampZoom(current.zoom * Math.exp(-event.deltaY * 0.0015), rect.width);
      const next = zoomAroundWorld(current, anchor, zoom, rect.width);
      wheelViewport.current = next;
      onViewport(next);
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, [onViewport]);
  useEffect(() => {
    setStart(null); setStartFace(null); setHover(null); setHoverFace(null);
    setCursor(null); setCursorFace(null);
  }, [wallTool]);
  useEffect(() => {
    if (!wallTool) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (start) {
          setStart(null);
          setStartFace(null);
          setHover(null);
          setHoverFace(null);
          setServerPreview(null);
        } else {
          onResetWallTool();
        }
      }
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [start, wallTool, onResetWallTool]);
  const geometry = start && hover && wallTool
    ? centeredWallGeometry(graph, start, hover, thicknessMm, [startFace, hoverFace]) : null;
  const previewKey = JSON.stringify([graph, draftRevision, geometry?.edge, thicknessMm]);
  useEffect(() => {
    setServerPreview(null);
    if (!wallTool || !geometry || !Number.isFinite(thicknessMm)) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      physicalPreview(graph, draftRevision, geometry.edge, "left", thicknessMm, controller.signal)
        .then(response => {
          if (!controller.signal.aborted) setServerPreview({ key: previewKey, response });
        }).catch(() => {});
    }, 60);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [previewKey]);
  const world = (clientX: number, clientY: number) => {
    try { return svg.current ? worldPoint(svg.current, clientX, clientY) : null; }
    catch { return null; }
  };
  const corners = graph.walls.flatMap(wall => wall.corners).filter((corner, index, all) =>
    all.findIndex(other => other.x === corner.x && other.y === corner.y) === index);
  const insideWall = (point: Point) => graph.walls.some(wall => {
    const polygon = wall.corners;
    for (let index = 0; index < polygon.length; index++) {
      const a = polygon[index], b = polygon[(index + 1) % polygon.length];
      const dx = b.x - a.x, dy = b.y - a.y;
      const ratio = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)));
      if (Math.hypot(point.x - a.x - ratio * dx, point.y - a.y - ratio * dy) <= .1) return true;
    }
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i], b = polygon[j];
      if ((a.y > point.y) !== (b.y > point.y) &&
          point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  });
  const guideDirections: Point[] = [{ x: 1, y: 0 }, { x: 0, y: 1 }];
  const startAttachment = start && wallTool ? startFace : null;
  if (startAttachment && guideDirections.every(direction =>
    Math.abs(startAttachment.normal.x * direction.x + startAttachment.normal.y * direction.y) < .999999))
    guideDirections.unshift(startAttachment.normal);
  if (start && wallTool) for (const wall of graph.walls) {
    for (const [a, b] of [[wall.corners[0], wall.corners[1]],
      [wall.corners[3], wall.corners[2]]]) {
      const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
      if (length < .1) continue;
      const ratio = Math.max(0, Math.min(1, ((start.x - a.x) * dx + (start.y - a.y) * dy) / (length * length)));
      const distance = Math.hypot(start.x - a.x - ratio * dx, start.y - a.y - ratio * dy);
      if (distance > .1000001) continue;
      const normal = { x: -dy / length, y: dx / length };
      if (guideDirections.every(other => Math.abs(normal.x * other.x + normal.y * other.y) < .999999))
        guideDirections.unshift(normal);
    }
  }
  const guideStep = Math.max(1, Math.ceil(targetSpacingPx / Math.max(0.01, pixelScale * 100)));
  const guideTargets: Point[] = [];
  if (start && mobile && wallTool) for (const direction of guideDirections) {
    for (const sign of [-1, 1]) {
      for (let index = guideStep; index <= 200; index += guideStep) {
        const distance = index * 100;
        const ideal = { x: start.x + sign * direction.x * distance,
          y: start.y + sign * direction.y * distance };
        const point = { x: roundTenth(ideal.x), y: roundTenth(ideal.y) };
        if (Math.hypot(point.x - ideal.x, point.y - ideal.y) > .0800001 || insideWall(point)) continue;
        if (Math.abs(point.x - shown.centerX) > span / 2 ||
            Math.abs(point.y - shown.centerY) > height / 2) continue;
        if (guideTargets.every(other => Math.hypot(other.x - point.x, other.y - point.y) * pixelScale >= targetSpacingPx))
          guideTargets.push(point);
      }
    }
  }
  const guideLabels = start ? guideTargets.filter((point, index) => {
    const angle = Math.atan2(point.y - start.y, point.x - start.x);
    return guideTargets.findIndex(other =>
      Math.abs(Math.atan2(other.y - start.y, other.x - start.x) - angle) < .01) === index;
  }) : [];
  const measuredGuideAngle = (point: Point) => {
    if (!start) return 90;
    const vx = point.x - start.x, vy = point.y - start.y, distance = Math.hypot(vx, vy);
    let best: number | null = null;
    for (const wall of graph.walls) {
      const a = wall.drawnEdge[0], b = wall.drawnEdge[1];
      const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
      const ratio = ((start.x - a.x) * dx + (start.y - a.y) * dy) / (length * length);
      if (length < .1 || ratio < -.001 || ratio > 1.001 ||
          Math.abs((start.x - a.x) * dy - (start.y - a.y) * dx) / length > wall.thicknessMm + .1)
        continue;
      const cosine = Math.abs((vx * dx + vy * dy) / (distance * length));
      const measured = Math.acos(Math.max(0, Math.min(1, cosine))) * 180 / Math.PI;
      if (best === null || Math.abs(90 - measured) < Math.abs(90 - best)) best = measured;
    }
    return best ?? 90;
  };
  const visibleCorners = corners.filter(corner => corners.every(other =>
    other === corner || Math.hypot(other.x - corner.x, other.y - corner.y) * pixelScale >= targetSpacingPx));
  const mobileTargets: Point[] = (() => {
    if (!mobile || !wallTool) return [];
    const result = [...visibleCorners];
    for (const point of guideTargets)
      if (result.every(other => Math.hypot(point.x - other.x, point.y - other.y) * pixelScale >= targetSpacingPx))
        result.push(point);
    return result;
  })();
  const target = (point: Point): WallTarget => {
    const radius = (mobile ? 18 : 14) / Math.max(pixelScale, 0.01);
    // A cursor square touching an existing wall must sit against one of its
    // exposed faces. Face selection comes before point targets so a corner
    // cannot leave half of the square embedded in the host wall.
    const face = nearestCubeAttachment(graph, point, radius, thicknessMm);
    if (face) {
      const attachment = start ? alignCubeAttachmentToGuides(start, point, face,
        guideDirections, thicknessMm, (mobile ? 18 : 12) / Math.max(pixelScale, .01) +
          (startFace?.tangentialShift ?? 0)) : face;
      return { point: attachment.center, attachment };
    }
    const candidates = mobile ? mobileTargets : corners;
    const ranked = candidates.map(candidate => ({ point: candidate,
      distance: Math.hypot(point.x - candidate.x, point.y - candidate.y),
      priority: !mobile || visibleCorners.some(corner => corner.x === candidate.x && corner.y === candidate.y) ? 0
        : guideTargets.some(guide => guide.x === candidate.x && guide.y === candidate.y) ? 1 : 2,
    })).filter(candidate => candidate.distance <= radius)
      .sort((a, b) => a.priority - b.priority || a.distance - b.distance);
    const nearest = ranked[0] ?? null;
    if (nearest && mobile && corners.filter(corner =>
      Math.hypot(corner.x - nearest.point.x, corner.y - nearest.point.y) * pixelScale < targetSpacingPx).length > 1)
      return { point: precisePoint(point), attachment: null };
    if (nearest) return { point: nearest.point, attachment: null };
    if (start) {
      let aligned: Point | null = null;
      // If the first cube was shifted along a face to align its outer corner,
      // absorb the same displacement while choosing a guide. The user can
      // continue the original pointer motion without introducing a tiny slope.
      let bestDistance = (mobile ? 18 : 12) / Math.max(pixelScale, .01) +
        (startFace?.tangentialShift ?? 0);
      for (const direction of guideDirections) {
        const distanceAlong = (point.x - start.x) * direction.x +
          (point.y - start.y) * direction.y;
        const candidate = { x: start.x + distanceAlong * direction.x,
          y: start.y + distanceAlong * direction.y };
        const distance = Math.hypot(point.x - candidate.x, point.y - candidate.y);
        if (Math.abs(distanceAlong) >= .1 && distance < bestDistance) {
          aligned = candidate;
          bestDistance = distance;
        }
      }
      if (aligned) return { point: precisePoint(aligned), attachment: null };
    }
    return { point: precisePoint(point), attachment: null };
  };
  const begin = (event: React.PointerEvent<SVGSVGElement>) => {
    const node = svg.current;
    if (!node) return;
    node.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const anchor = world(midpoint.x, midpoint.y);
      if (anchor) pinch.current = { anchor, distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: shown.zoom };
      gesture.current = null;
      suppressTap.current = true;
      return;
    }
    const wallId = (event.target as Element).closest("[data-wall-id]")?.getAttribute("data-wall-id") ?? null;
    const roomKey = (event.target as Element).closest("[data-room-key]")?.getAttribute("data-room-key") ?? null;
    const handle = (event.target as Element).closest("[data-wall-handle]")?.getAttribute("data-wall-handle") as Handle | null;
    const arrowNode = (event.target as Element).closest("[data-nudge-axis]");
    const arrow = arrowNode ? { axis: arrowNode.getAttribute("data-nudge-axis") as "x" | "y",
      direction: Number(arrowNode.getAttribute("data-nudge-direction")) as -1 | 1 } : null;
    gesture.current = { id: event.pointerId, client: { x: event.clientX, y: event.clientY },
      viewport: shown, moved: false, wallId, roomKey, handle, arrow };
  };
  const move = (event: React.PointerEvent<SVGSVGElement>) => {
    if (pointers.current.has(event.pointerId))
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch.current && pointers.current.size >= 2 && svg.current) {
      const [a, b] = [...pointers.current.values()];
      const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const rect = svg.current.getBoundingClientRect();
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const next = viewportAtAnchor(viewport, pinch.current.anchor, midpoint, rect,
        pinch.current.zoom * distance / Math.max(1, pinch.current.distance));
      setLiveViewport(next);
      return;
    }
    const current = gesture.current;
    if (current?.id === event.pointerId && svg.current) {
      const dx = event.clientX - current.client.x, dy = event.clientY - current.client.y;
      if (Math.hypot(dx, dy) > 5) current.moved = true;
      if (current.moved) {
        const units = 9000 / current.viewport.zoom / Math.max(1, size.width);
        setLiveViewport({ ...current.viewport,
          centerX: current.viewport.centerX - dx * units,
          centerY: current.viewport.centerY + dy * units });
      }
    } else if (wallTool && event.pointerType === "mouse") {
      const point = world(event.clientX, event.clientY);
      const snapped = point ? target(point) : null;
      setCursor(snapped?.point ?? null);
      setCursorFace(snapped?.attachment ? { normal: snapped.attachment.normal } : null);
      setHover(snapped?.point ?? null);
      setHoverFace(snapped?.attachment ?? null);
    }
  };
  const finish = (event: React.PointerEvent<SVGSVGElement>, cancelled = false) => {
    pointers.current.delete(event.pointerId);
    if (pinch.current) {
      if (pointers.current.size < 2) {
        pinch.current = null;
        if (liveViewport) onViewport(liveViewport);
        setLiveViewport(null);
        suppressTap.current = false;
      }
      gesture.current = null;
      return;
    }
    const current = gesture.current;
    gesture.current = null;
    if (!current || current.id !== event.pointerId) return;
    if (current.moved) {
      if (liveViewport) onViewport(liveViewport);
      setLiveViewport(null);
      return;
    }
    if (cancelled || suppressTap.current) { suppressTap.current = false; return; }
    if (current.arrow && selectedHandle) {
      onNudge?.(selectedHandle, current.arrow.axis, current.arrow.direction);
      return;
    }
    if (current.handle) {
      onSelectHandle?.(current.handle);
      return;
    }
    if (wallTool) {
      const point = world(event.clientX, event.clientY);
      if (!point) return;
      const selected = target(point);
      if (!start) {
        setStart(selected.point);
        setStartFace(selected.attachment);
        setHover(selected.point);
        setHoverFace(selected.attachment);
      } else if (Math.hypot(selected.point.x - start.x, selected.point.y - start.y) >= 0.1) {
        const finished = centeredWallGeometry(graph, start, selected.point, thicknessMm,
          [startFace, selected.attachment]);
        if (finished) onDrawWall(finished.edge);
        setStart(null);
        setStartFace(null);
      }
    } else {
      if (current.roomKey) onSelectRoom?.(current.roomKey);
      else onSelectWall(current.wallId);
    }
  };
  const preview = geometry?.corners;
  const previewStart = preview ? {
    x: (preview[0].x + preview[3].x) / 2,
    y: (preview[0].y + preview[3].y) / 2,
  } : start;
  const previewEnd = preview ? {
    x: (preview[1].x + preview[2].x) / 2,
    y: (preview[1].y + preview[2].y) / 2,
  } : hover;
  const acceptedPreview = serverPreview?.key === previewKey && serverPreview.response.status === "valid"
    ? serverPreview.response : null;
  const previewWallId = acceptedPreview?.affectedWallIds[0];
  const previewAngles = previewWallId ? acceptedPreview!.openJointAngles.filter(angle =>
    angle.wallId === previewWallId) : geometry ? immediateJointAngles(geometry) : [];
  const splitDimensions = splitWallDimensions(
    acceptedPreview?.graph ?? graph, acceptedPreview?.wallArea ?? wallArea, 17 / pixelScale);
  const otherFaceDimensions = selectedRoomKey ? faces.find(face => face.topologyKey === selectedRoomKey)
    ?.freeDimensions.filter(dimension => !splitDimensions.some(segment =>
      Math.abs(dimension.valueMm - segment.lengthMm) <= .2 &&
      ((Math.hypot(dimension.from.x - segment.from.x, dimension.from.y - segment.from.y) <= .2 &&
        Math.hypot(dimension.to.x - segment.to.x, dimension.to.y - segment.to.y) <= .2) ||
       (Math.hypot(dimension.from.x - segment.to.x, dimension.from.y - segment.to.y) <= .2 &&
        Math.hypot(dimension.to.x - segment.from.x, dimension.to.y - segment.from.y) <= .2)))) ?? [] : [];
  const previewLength = previewStart && previewEnd && wallTool
    ? Math.hypot(previewEnd.x - previewStart.x, previewEnd.y - previewStart.y) : 0;
  const cursorFootprint = cursor ? (() => {
    const normal = cursorFace?.normal ?? { x: 1, y: 0 };
    const lateral = { x: -normal.y, y: normal.x };
    const center = cursor;
    return [-1, 1, 1, -1].map((along, index) => ({
      x: center.x + (normal.x * along + lateral.x * (index < 2 ? -1 : 1)) * thicknessMm / 2,
      y: center.y + (normal.y * along + lateral.y * (index < 2 ? -1 : 1)) * thicknessMm / 2,
    }));
  })() : null;
  const jointAngleMark = (angle: OpenJointAngleV5, key: string, pending = false) => {
    const corner = angle.corner, rays = angle.rays;
    const radius = Math.max(24 / pixelScale, Math.min(30, thicknessMm * .35));
    const bisector = rays ? { x: rays[0].x + rays[1].x,
      y: rays[0].y + rays[1].y } : null;
    const bisectorLength = bisector ? Math.hypot(bisector.x, bisector.y) : 0;
    const position = corner && bisector && bisectorLength > .01
      ? { x: corner.x + bisector.x / bisectorLength * (radius + 17 / pixelScale),
        y: corner.y + bisector.y / bisectorLength * (radius + 17 / pixelScale) }
      : angle.anchor;
    const arc = corner && rays ? (() => {
      const first = { x: corner.x + rays[0].x * radius, y: corner.y + rays[0].y * radius };
      const last = { x: corner.x + rays[1].x * radius, y: corner.y + rays[1].y * radius };
      const sweep = rays[0].x * rays[1].y - rays[0].y * rays[1].x < 0 ? 1 : 0;
      return `M${first.x} ${-first.y} A${radius} ${radius} 0 0 ${sweep} ${last.x} ${-last.y}`;
    })() : null;
    return <g key={key}>
      {arc && <path data-wall-angle-arc d={arc} fill="none" stroke="#a33"
        strokeWidth={1.4 / pixelScale} />}
      <text data-wall-preview-angle={pending || undefined}
        x={position.x} y={-position.y}
        textAnchor="middle" fontSize={13 / pixelScale} fontWeight={600}
        fill="#8f2929" stroke="#fff" strokeWidth={3 / pixelScale} paintOrder="stroke">
        {displayTenth(angle.valueDeg)}°
      </text>
    </g>;
  };
  const selectedWall = graph.walls.find(wall => wall.id === selectedWallId);
  const selectedFace = faces.find(face => face.topologyKey === selectedRoomKey);
  const handlePoints: Record<Handle, Point> | null = selectedWall ? {
    start: { x: (selectedWall.corners[0].x + selectedWall.corners[3].x) / 2,
      y: (selectedWall.corners[0].y + selectedWall.corners[3].y) / 2 },
    center: { x: selectedWall.corners.reduce((sum, point) => sum + point.x, 0) / 4,
      y: selectedWall.corners.reduce((sum, point) => sum + point.y, 0) / 4 },
    end: { x: (selectedWall.corners[1].x + selectedWall.corners[2].x) / 2,
      y: (selectedWall.corners[1].y + selectedWall.corners[2].y) / 2 },
  } : null;
  const grid = (step: number, color: string, width: number) => {
    const left = shown.centerX - span / 2, right = shown.centerX + span / 2;
    const bottom = shown.centerY - height / 2, top = shown.centerY + height / 2;
    const lines: React.ReactNode[] = [];
    const stronger = step === 10 ? 100 : step === 100 ? 1000 : 0;
    for (let x = Math.ceil(left / step) * step; x <= right; x += step)
      if (!stronger || x % stronger !== 0)
        lines.push(<line key={`x${step}-${x}`} x1={x} x2={x} y1={-bottom} y2={-top} stroke={color} strokeWidth={width / pixelScale} />);
    for (let y = Math.ceil(bottom / step) * step; y <= top; y += step)
      if (!stronger || y % stronger !== 0)
        lines.push(<line key={`y${step}-${y}`} x1={left} x2={right} y1={-y} y2={-y} stroke={color} strokeWidth={width / pixelScale} />);
    return lines;
  };
  return <><svg ref={svg} data-geometry data-physical-canvas tabIndex={0}
    role="application" aria-label="Полотно проекта" viewBox={viewBox}
    style={{ width: "100%", height: "100%", touchAction: "none", display: "block", background: "#fff" }}
    onPointerDown={begin} onPointerMove={move} onPointerUp={event => finish(event)}
    onPointerCancel={event => finish(event, true)}>
    <defs>
      <pattern id="physical-wall-cursor-hatch" patternUnits="userSpaceOnUse"
        width={8 / pixelScale} height={8 / pixelScale} patternTransform="rotate(45)">
        <rect width={8 / pixelScale} height={8 / pixelScale} fill="#bcbcbc" />
        <line x1="0" y1="0" x2="0" y2={8 / pixelScale}
          stroke="#666" strokeWidth={1 / pixelScale} />
      </pattern>
    </defs>
    <g pointerEvents="none">
      {pixelScale * 10 >= 6 && grid(10, "#e8e8e8", .5)}
      {pixelScale * 100 >= 6 && grid(100, "#a5a5a5", 1)}
      {grid(1000, "#555", 1.35)}
      {previewStart && wallTool && guideDirections.map((direction, index) =>
        <line key={`guide-${index}`}
          x1={previewStart.x - direction.x * span} y1={-previewStart.y + direction.y * span}
          x2={previewStart.x + direction.x * span} y2={-previewStart.y - direction.y * span}
          stroke="#777" strokeDasharray={`${6 / pixelScale} ${5 / pixelScale}`}
          strokeWidth={1 / pixelScale} />)}
      {start && wallTool && mobile && guideLabels.map((point, index) =>
        <text key={`ruler-${index}`} x={point.x + 10 / pixelScale}
          y={-point.y - 9 / pixelScale} fontSize={11 / pixelScale} fill="#444">
          {displayTenth(Math.hypot(point.x - start.x, point.y - start.y))} мм · {displayTenth(measuredGuideAngle(point))}°
        </text>)}
    </g>
    {mobile && wallTool && <g pointerEvents="none">
      {mobileTargets.map(point => <g key={`${point.x}:${point.y}`} data-mobile-target
        data-guide-target={guideTargets.some(guide => guide.x === point.x && guide.y === point.y) || undefined}>
        <circle cx={point.x} cy={-point.y} r={22 / pixelScale} fill="transparent" />
        <circle cx={point.x} cy={-point.y} r={5 / pixelScale}
          fill="#fff" stroke="#555" strokeWidth={1.5 / pixelScale} />
      </g>)}
    </g>}
    {faces.filter(face => face.polygon).map(face => <path key={face.topologyKey}
      data-room-key={face.topologyKey} d={svgPath(face.polygon!)}
      tabIndex={0} role="button"
      aria-label={`${roomNames[face.topologyKey] ?? "Помещение"} — ${roomMissing[face.topologyKey] ? "без раскладки" : "раскладка готова"}`}
      onKeyDown={event => { if (event.key === "Enter" || event.key === " ") {
        event.preventDefault(); onSelectRoom?.(face.topologyKey);
      } }}
      fill={highlightRooms && roomMissing[face.topologyKey] ? "#fff4bb" : "#fff"}
      stroke={face.topologyKey === selectedRoomKey ? "#444" : "none"}
      strokeWidth={2 / pixelScale} />)}
    {layouts.flatMap(({ roomId, layout }) => layout.parts.map(part => <path key={`${roomId}:${part.id}`}
      data-layout-room-id={roomId} pointerEvents="none"
      d={part.rings.map(ring => ring.map(([x, y], index) =>
        `${index ? "L" : "M"}${x} ${-y}`).join(" ") + " Z").join(" ")}
      fill={part.full ? "#eee" : "#ccc"} fillRule="evenodd"
      stroke="#777" strokeWidth={Math.max(0.7 / pixelScale, 0.15)} />))}
    <g pointerEvents="none">
      {(acceptedPreview?.wallArea ?? wallArea).map((shape, index) => <path key={index} d={svgPath(shape)} fill="#aaa" fillRule="evenodd"
        stroke="#292929" strokeWidth={2 / pixelScale} />)}
      {preview && !acceptedPreview && <g data-immediate-wall-preview>
        <path d={wallPath(preview)} fill="#aaa" stroke="none" />
        {[0, 2].map(index => <line key={index}
          x1={preview[index].x} y1={-preview[index].y}
          x2={preview[index + 1].x} y2={-preview[index + 1].y}
          stroke="#292929" strokeWidth={2 / pixelScale} />)}
        {!geometry?.attachments[0] && <line x1={preview[0].x} y1={-preview[0].y}
          x2={preview[3].x} y2={-preview[3].y} stroke="#292929" strokeWidth={2 / pixelScale} />}
        {!geometry?.attachments[1] && <line x1={preview[1].x} y1={-preview[1].y}
          x2={preview[2].x} y2={-preview[2].y} stroke="#292929" strokeWidth={2 / pixelScale} />}
      </g>}
      {acceptedPreview?.proposedWall && <path d={wallPath(acceptedPreview.proposedWall.corners)}
        fill="#77777780" stroke="#333" strokeWidth={2 / pixelScale} />}
      {previewStart && <circle data-wall-start cx={previewStart.x} cy={-previewStart.y}
        r={8 / pixelScale} fill="#333" />}
      {wallTool && !start && cursorFootprint && <g data-wall-cursor>
        <path d={wallPath(cursorFootprint)} fill="url(#physical-wall-cursor-hatch)"
          stroke="#333" strokeWidth={1.5 / pixelScale} />
        {thicknessMm * pixelScale >= 20 && cursorFootprint.map((corner, index) =>
          <circle key={index} data-wall-cursor-corner cx={corner.x} cy={-corner.y}
            r={2 / pixelScale} fill="#fff" stroke="#333" strokeWidth={1 / pixelScale} />)}
        {cursor && <circle data-wall-cursor-center
          cx={cursor.x} cy={-cursor.y}
          r={2 / pixelScale} fill="#333" />}
      </g>}
      {previewLength >= .1 && previewStart && previewEnd && <text data-wall-preview-length
        x={(previewStart.x + previewEnd.x) / 2}
        y={-(previewStart.y + previewEnd.y) / 2 - 18 / pixelScale}
        textAnchor="middle" fontSize={13 / pixelScale} fontWeight={600}
        fill="#222" stroke="#fff" strokeWidth={3 / pixelScale} paintOrder="stroke">
        {displayTenth(previewLength)} мм
      </text>}
      {previewAngles.map((angle, index) => jointAngleMark(angle, `${angle.junctionId}:${index}`, true))}
    </g>
    {graph.walls.map(wall => <path key={wall.id} data-wall-id={wall.id}
      tabIndex={wallTool ? -1 : 0} role="button" aria-label="Выбрать стену"
      aria-pressed={wall.id === selectedWallId}
      onKeyDown={event => { if (!wallTool && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault(); onSelectWall(wall.id);
      } }}
      d={wallPath(wall.corners)} fill={wall.id === selectedWallId ? "#55555577" : "#00000000"}
      stroke={wall.id === selectedWallId ? "#111" : "none"}
      strokeWidth={wall.id === selectedWallId ? 2 / pixelScale : 0} />)}
    {handlePoints && !wallTool && Object.entries(handlePoints).map(([handle, point]) =>
      <g key={handle} data-wall-handle={handle} role="button" tabIndex={0}
        aria-label={`Точка стены: ${handle === "start" ? "начало" : handle === "end" ? "конец" : "середина"}`}
        onKeyDown={event => { if (event.key === "Enter" || event.key === " ") {
          event.preventDefault(); onSelectHandle?.(handle as Handle);
        } }}>
        <circle cx={point.x} cy={-point.y} r={22 / pixelScale} fill="transparent" />
        <circle cx={point.x} cy={-point.y} r={7 / pixelScale}
          fill={selectedHandle === handle ? "#555" : "#fff"}
          stroke="#222" strokeWidth={2 / pixelScale} pointerEvents="none" />
      </g>)}
    {handlePoints && selectedHandle && !wallTool && ([
      ["x", -1, "←", -56, 0], ["x", 1, "→", 56, 0],
      ["y", 1, "↑", 0, -56], ["y", -1, "↓", 0, 56],
    ] as const).map(([axis, direction, label, offsetX, offsetY]) => {
      const point = handlePoints[selectedHandle];
      const x = point.x + offsetX / pixelScale, y = -point.y + offsetY / pixelScale;
      return <g key={`${axis}${direction}`} data-nudge-axis={axis} data-nudge-direction={direction}
        role="button" tabIndex={0} aria-label={`Сдвинуть ${selectedHandle === "center" ? "стену" : "точку стены"} ${label} на 1 мм`}
        onKeyDown={event => { if (event.key === "Enter" || event.key === " ") {
          event.preventDefault(); onNudge?.(selectedHandle, axis, direction);
        } }}>
        <circle cx={x} cy={y} r={22 / pixelScale} fill="#fff"
          stroke="#bbb" strokeWidth={1 / pixelScale} />
        <text x={x} y={y + 5 / pixelScale} textAnchor="middle"
          fontSize={17 / pixelScale} fill="#333" pointerEvents="none">{label}</text>
      </g>;
    })}
    <g pointerEvents="none" fill="#333" fontSize={12 / pixelScale} textAnchor="middle">
      {splitDimensions.map((dimension, index) => <text key={`segment-${index}`}
        data-wall-segment-length={dimension.wallId}
        x={dimension.anchor.x} y={-dimension.anchor.y}
        stroke="#fff" strokeWidth={3 / pixelScale} paintOrder="stroke">
        {displayTenth(dimension.lengthMm)} мм
      </text>)}
      {selectedWallId && openJointAngles.filter(angle => angle.wallId === selectedWallId)
        .map((angle, index) => jointAngleMark(angle,
          `${angle.junctionId}:${angle.adjacentWallId}:${index}`))}
      {selectedFace?.innerAngles.map((angle, index) => <text key={`a${index}`}
        x={angle.anchor.x} y={-angle.anchor.y}>{displayTenth(angle.valueDeg)}°</text>)}
      {otherFaceDimensions.map((dimension, index) => <text key={`d${index}`}
        x={dimension.anchor.x}
        y={-dimension.anchor.y}>
        {displayTenth(dimension.valueMm)} мм
      </text>)}
    </g>
  </svg>
    {start && wallTool && <button type="button" className="physical-cancel-wall-start"
      onClick={() => {
        setStart(null); setStartFace(null); setHover(null); setHoverFace(null); setServerPreview(null);
      }}>
      Отменить начало стены
    </button>}
  </>;
}
