export type Point = [number, number];
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
};
export type Layout = {
  offset_x: number;
  offset_y: number;
  angle: number;
  title?: string;
  parts: Part[];
  region: Point[][][];
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
export const format = (n: number, digits = 0) =>
  n.toLocaleString("ru-RU", { maximumFractionDigits: digits });
