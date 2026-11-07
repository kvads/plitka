export type Point = [number, number];
export type ShowerRequest = {
  drainType: "point" | "linear";
  drainX: number;
  drainY: number;
  drainWidth: number;
  drainLength: number;
  drainOrientation: "horizontal" | "vertical";
  slopePercent: number;
  id?: string;
  originX?: number;
  originY?: number;
  rotationDeg?: number;
  baseHeightMm?: number;
  recessDepthMm?: number;
  vertices?: Point[];
  edges?: { id: string; kind: "wall" | "open" | "curb" | "entry";
    curbHeightMm?: number; curbWidthMm?: number }[];
};
export type LayoutRequest = {
  outline: Point[];
  holes: Point[][];
  tile: number;
  grout: number;
  gap: number;
  threshold: number;
  angle: number;
  offset_x: number;
  offset_y: number;
  shower?: ShowerRequest;
};
export type Part = {
  id: string;
  source: number;
  rings: Point[][];
  center: Point;
  width: number;
  height: number;
  min_width: number;
  area: number;
  full: boolean;
  issues: string[];
  zoneId?: string | null;
  surfaceWidth?: number;
  surfaceHeight?: number;
  surfaceId?: "room-floor" | "shower-top";
};
export type SlopeZone = {
  id: string;
  rings: Point[][];
  axis: "east" | "west" | "north" | "south" | "horizontal" | "vertical";
  slopePercent: number;
  minHeightMm: number;
  maxHeightMm: number;
};
export type Layout = {
  offset_x: number;
  offset_y: number;
  angle: number;
  title?: string;
  parts: Part[];
  region: Point[][][];
  shower?: {
    drain: { type: "point" | "linear"; x: number; y: number; width: number; length: number;
      orientation: "horizontal" | "vertical"; rotationDeg?: number };
    zones: SlopeZone[];
    maxHeightMm: number;
    object?: {
      id: string; originX: number; originY: number; rotationDeg: number; baseHeightMm: number;
      recessDepthMm: number;
      footprint: Point[][];
      edges: { id: string; kind: "wall" | "open" | "curb" | "entry";
        curbHeightMm?: number; curbWidthMm?: number }[];
      surfaces: { id: string; edgeId: string; kind: "fascia" | "curb";
        edgeKind: "wall" | "open" | "curb" | "entry"; start: Point; end: Point;
        lengthMm: number; heightMm: number; widthMm: number; areaMm2: number;
        insideHeightMm?: number; outsideHeightMm?: number }[];
      surfaceParts: { id: string; surfaceId: string;
        surfaceKind: "fascia" | "curb-top" | "curb-inside" | "curb-outside";
        width: number; height: number; area: number; full: boolean; issues: string[] }[];
    };
  };
  metrics: {
    tiles: number;
    full: number;
    cut: number;
    fragments: number;
    warnings: number;
    min_width: number;
    symmetry: number | null;
    room_area: number;
    laying_area: number;
    covered_area: number;
    grout_area: number;
    waste_area: number;
    waste_percent: number;
  };
};
export const initial: LayoutRequest = {
  outline: [
    [0, 0],
    [4200, 0],
    [4200, 3600],
    [0, 3600],
  ],
  holes: [],
  tile: 600,
  grout: 2,
  gap: 10,
  threshold: 100,
  angle: 0,
  offset_x: 0,
  offset_y: 0,
};
export const path = (rings: Point[][]) =>
  rings.map((r) => "M" + r.map((p) => p.join(",")).join("L") + "Z").join(" ");
export const format = (n: number, _digits = 1) =>
  n.toLocaleString("ru-RU", { maximumFractionDigits: 1 });
export const manufacturingMillimetres = (n: number) => Math.floor(n + 0.5);
