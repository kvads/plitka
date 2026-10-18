import type { Point, ProjectDocumentV5 } from "../plan/types";

export type Viewport = ProjectDocumentV5["viewport"];

export function worldPoint(svg: SVGSVGElement, x: number, y: number): Point {
  const matrix = svg.getScreenCTM();
  if (!matrix) throw new Error("Полотно пока недоступно.");
  const p = new DOMPoint(x, y).matrixTransform(matrix.inverse());
  return { x: p.x, y: -p.y };
}

export function clientPoint(svg: SVGSVGElement, point: Point): Point {
  const matrix = svg.getScreenCTM();
  if (!matrix) throw new Error("Полотно пока недоступно.");
  const p = new DOMPoint(point.x, -point.y).matrixTransform(matrix);
  return { x: p.x, y: p.y };
}

export const maxZoomForWidth = (width: number) =>
  Math.max(8, 5400 / Math.max(1, width));

export const clampZoom = (zoom: number, width: number) =>
  Math.min(maxZoomForWidth(width), Math.max(0.2, zoom));

export const gridScreenStep = (millimeters: number, width: number, zoom: number) =>
  millimeters * Math.max(1, width) * zoom / 9000;

export function zoomAroundWorld(viewport: Viewport, anchor: Point, zoom: number, width: number): Viewport {
  const nextZoom = clampZoom(zoom, width);
  const ratio = viewport.zoom / nextZoom;
  return {
    ...viewport,
    zoom: nextZoom,
    centerX: anchor.x + (viewport.centerX - anchor.x) * ratio,
    centerY: anchor.y + (viewport.centerY - anchor.y) * ratio,
  };
}

export function viewportAtAnchor(
  viewport: Viewport,
  anchor: Point,
  client: Point,
  rect: Pick<DOMRect, "left" | "top" | "width" | "height">,
  zoom: number,
  sidebarShift = 0,
  panelLift = 0,
): Viewport {
  const nextZoom = clampZoom(zoom, rect.width);
  const span = 9000 / nextZoom;
  const pixels = Math.max(1, rect.width);
  return {
    ...viewport,
    zoom: nextZoom,
    centerX: anchor.x - (client.x - rect.left - rect.width / 2 - sidebarShift) * span / pixels,
    centerY: anchor.y + (client.y - rect.top - rect.height / 2 + panelLift) * span / pixels,
  };
}
