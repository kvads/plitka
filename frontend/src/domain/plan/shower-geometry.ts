import type { ShowerTray } from "./types";

export type ShowerEdge = NonNullable<ShowerTray["edges"]>[number];
type Point = [number, number];

const cross = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0];

const lineIntersection = (first: Point, firstDirection: Point,
  second: Point, secondDirection: Point, vertex: Point, limit: number) => {
  const denominator = cross(firstDirection, secondDirection);
  if (Math.abs(denominator) < 1e-8) return null;
  const delta: Point = [second[0] - first[0], second[1] - first[1]];
  const ratio = cross(delta, secondDirection) / denominator;
  const point: Point = [first[0] + firstDirection[0] * ratio,
    first[1] + firstDirection[1] * ratio];
  return Math.hypot(point[0] - vertex[0], point[1] - vertex[1]) <= limit ? point : null;
};

export const curbWallShapes = (points: Point[], edges: ShowerEdge[] | undefined) => {
  if (points.length < 3 || !edges?.length) return [];
  const area = points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0);
  const direction = area >= 0 ? 1 : -1;
  const frames = points.map((start, index) => {
    const edge = edges[index], end = points[(index + 1) % points.length];
    if (edge?.kind !== "curb" || !edge.curbWidthMm || !end) return null;
    const dx = end[0] - start[0], dy = end[1] - start[1], length = Math.hypot(dx, dy);
    if (length < .1) return null;
    const tangent: Point = [dx / length, dy / length];
    const outward: Point = [dy / length * direction, -dx / length * direction];
    const width = edge.curbWidthMm;
    return { index, start, end, tangent, outward, width,
      baseOuterStart: [start[0] + outward[0] * width,
        start[1] + outward[1] * width] as Point,
      baseOuterEnd: [end[0] + outward[0] * width,
        end[1] + outward[1] * width] as Point };
  });
  return frames.flatMap((frame, index) => {
    if (!frame) return [];
    const previous = frames[(index - 1 + frames.length) % frames.length];
    const next = frames[(index + 1) % frames.length];
    const startLimit = Math.max(frame.width, previous?.width ?? 0) * 10 + .1;
    const endLimit = Math.max(frame.width, next?.width ?? 0) * 10 + .1;
    const outerStart = previous ? lineIntersection(previous.baseOuterStart, previous.tangent,
      frame.baseOuterStart, frame.tangent, frame.start, startLimit) ?? frame.baseOuterStart
      : frame.baseOuterStart;
    const outerEnd = next ? lineIntersection(frame.baseOuterStart, frame.tangent,
      next.baseOuterStart, next.tangent, frame.end, endLimit) ?? frame.baseOuterEnd
      : frame.baseOuterEnd;
    return [{ ...frame, outerStart, outerEnd,
      points: [frame.start, frame.end, outerEnd, outerStart] as Point[] }];
  });
};

const distanceToSegment = (point: [number, number], start: [number, number], end: [number, number]) => {
  const dx = end[0] - start[0], dy = end[1] - start[1];
  const squared = dx * dx + dy * dy;
  if (squared < .001) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const ratio = Math.max(0, Math.min(1,
    ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / squared));
  return Math.hypot(point[0] - start[0] - ratio * dx, point[1] - start[1] - ratio * dy);
};

export const showerEdgeFrame = (tray: ShowerTray, index: number) => {
  const vertices = tray.vertices;
  if (!vertices?.length) return null;
  const radians = (tray.rotationDeg ?? 0) * Math.PI / 180;
  const cosine = Math.cos(radians), sine = Math.sin(radians);
  const world = vertices.map(([x, y]) => [
    (tray.originX ?? 0) + x * cosine - y * sine,
    (tray.originY ?? 0) + x * sine + y * cosine,
  ] as [number, number]);
  const start = world[index], end = world[(index + 1) % world.length];
  if (!start || !end) return null;
  const dx = end[0] - start[0], dy = end[1] - start[1], length = Math.hypot(dx, dy);
  if (length < .1) return null;
  const area = vertices.reduce((sum, point, pointIndex) => {
    const next = vertices[(pointIndex + 1) % vertices.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0);
  const direction = area >= 0 ? 1 : -1;
  const inward = { x: -dy / length * direction, y: dx / length * direction };
  const edge = tray.edges?.[index];
  const width = edge?.kind === "curb" ? edge.curbWidthMm ?? 0 : 0;
  return { start, end, inward, width,
    outerStart: [start[0] - inward.x * width, start[1] - inward.y * width] as [number, number],
    outerEnd: [end[0] - inward.x * width, end[1] - inward.y * width] as [number, number] };
};

export const curbAdjustedTray = (tray: ShowerTray, index: number, nextEdge: ShowerEdge,
  polygon: { outline: number[][]; holes: number[][][] }) => {
  const frame = showerEdgeFrame(tray, index);
  if (!frame || !tray.edges) return { ...tray, edges: tray.edges?.map((edge, edgeIndex) =>
    edgeIndex === index ? nextEdge : edge) };
  const boundaries = [polygon.outline as [number, number][],
    ...(polygon.holes as [number, number][][])];
  const midpoint: [number, number] = [(frame.outerStart[0] + frame.outerEnd[0]) / 2,
    (frame.outerStart[1] + frame.outerEnd[1]) / 2];
  const touchesWall = [frame.outerStart, midpoint, frame.outerEnd].every(point =>
    Math.min(...boundaries.flatMap(ring => ring.map((start, edgeIndex) =>
      distanceToSegment(point, start, ring[(edgeIndex + 1) % ring.length])))) <= .6);
  const newWidth = nextEdge.kind === "curb" ? nextEdge.curbWidthMm ?? 0 : 0;
  const difference = newWidth - frame.width;
  const edges = tray.edges.map((edge, edgeIndex) => edgeIndex === index ? nextEdge : edge);
  return { ...tray, edges,
    originX: Math.round(((tray.originX ?? 0) + (touchesWall ? frame.inward.x * difference : 0)) * 10) / 10,
    originY: Math.round(((tray.originY ?? 0) + (touchesWall ? frame.inward.y * difference : 0)) * 10) / 10 };
};

export const normalizedDrainPatch = (planWidth: number, planHeight: number) => {
  const width = Math.max(50, Math.round(planWidth * 10) / 10);
  const height = Math.max(50, Math.round(planHeight * 10) / 10);
  const horizontal = width >= height;
  const long = Math.max(width, height), short = Math.min(width, height);
  return {
    drainType: Math.abs(width - height) < .1 ? "point" as const : "linear" as const,
    drainOrientation: horizontal ? "horizontal" as const : "vertical" as const,
    drainLength: long,
    drainWidth: short,
  };
};

export const snapDrainToTrayEdge = (tray: ShowerTray) => {
  const vertices = tray.vertices ?? [];
  if (vertices.length < 3) return null;
  const area = vertices.reduce((sum, point, index) => {
    const next = vertices[(index + 1) % vertices.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0);
  const direction = area >= 0 ? 1 : -1;
  const candidates = vertices.flatMap((start, index) => {
    const end = vertices[(index + 1) % vertices.length];
    const dx = end[0] - start[0], dy = end[1] - start[1], length = Math.hypot(dx, dy);
    const horizontal = Math.abs(dy) < .1, vertical = Math.abs(dx) < .1;
    if ((!horizontal && !vertical) || length < tray.drainLength) return [];
    const inward = { x: -dy / length * direction, y: dx / length * direction };
    const planWidth = horizontal ? tray.drainLength : tray.drainWidth;
    const planHeight = horizontal ? tray.drainWidth : tray.drainLength;
    const halfAlong = (horizontal ? planWidth : planHeight) / 2;
    const low = horizontal ? Math.min(start[0], end[0]) : Math.min(start[1], end[1]);
    const high = horizontal ? Math.max(start[0], end[0]) : Math.max(start[1], end[1]);
    const along = Math.max(low + halfAlong, Math.min(high - halfAlong,
      horizontal ? tray.drainX : tray.drainY));
    const center: Point = horizontal
      ? [along, start[1] + inward.y * planHeight / 2]
      : [start[0] + inward.x * planWidth / 2, along];
    return [{ center, horizontal,
      distance: Math.hypot(center[0] - tray.drainX, center[1] - tray.drainY) }];
  }).sort((a, b) => a.distance - b.distance);
  const nearest = candidates[0];
  if (!nearest) return null;
  return { ...normalizedDrainPatch(
    nearest.horizontal ? tray.drainLength : tray.drainWidth,
    nearest.horizontal ? tray.drainWidth : tray.drainLength),
    drainX: Math.round(nearest.center[0] * 10) / 10,
    drainY: Math.round(nearest.center[1] * 10) / 10,
    drainSlopeMode: "edge" as const };
};

export const centerDrainPatch = (tray: ShowerTray) => {
  const vertices = tray.vertices ?? [];
  if (!vertices.length) return { drainSlopeMode: "surround" as const };
  return { drainSlopeMode: "surround" as const,
    drainX: Math.round(vertices.reduce((sum, point) => sum + point[0], 0) / vertices.length * 10) / 10,
    drainY: Math.round(vertices.reduce((sum, point) => sum + point[1], 0) / vertices.length * 10) / 10 };
};
