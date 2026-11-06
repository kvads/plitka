import { format, manufacturingMillimetres, path, type Layout } from "../../types";
import { download } from "./import-export";

const samePoint = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]) < .01;

const simpleRing = (source: number[][]) => {
  const ring = source.length > 1 && samePoint(source[0], source[source.length - 1])
    ? source.slice(0, -1) : [...source];
  let changed = true;
  while (changed && ring.length > 3) {
    changed = false;
    for (let index = 0; index < ring.length; index++) {
      const before = ring[(index + ring.length - 1) % ring.length];
      const point = ring[index];
      const after = ring[(index + 1) % ring.length];
      const cross = (point[0] - before[0]) * (after[1] - point[1]) -
        (point[1] - before[1]) * (after[0] - point[0]);
      if (Math.abs(cross) < .01) {
        ring.splice(index, 1);
        changed = true;
        break;
      }
    }
  }
  return ring;
};

export const partDimensionSvg = (source: number[][], heightAt: (point: number[]) => number = () => 0) => {
  const ring = simpleRing(source);
  if (ring.length <= 4) return "";
  const area2 = ring.reduce((sum, point, index) => {
    const next = ring[(index + 1) % ring.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0);
  return ring.map((start, index) => {
    const end = ring[(index + 1) % ring.length];
    const dx = end[0] - start[0], dy = end[1] - start[1];
    const length = Math.hypot(dx, dy, heightAt(end) - heightAt(start));
    if (length < .1) return "";
    const direction = area2 >= 0 ? 1 : -1;
    const nx = -dy / length * direction, ny = dx / length * direction;
    const offset = Math.min(24, Math.max(10, length / 4));
    const x1 = start[0] + nx * offset, y1 = start[1] + ny * offset;
    const x2 = end[0] + nx * offset, y2 = end[1] + ny * offset;
    const tx = (x1 + x2) / 2 + nx * 12, ty = (y1 + y2) / 2 + ny * 12;
    let angle = Math.atan2(dy, dx) * 180 / Math.PI;
    if (angle > 90) angle -= 180;
    if (angle < -90) angle += 180;
    return `<g data-part-dimension="true"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#315247" stroke-width="1.5"/><text x="${tx}" y="${ty}" transform="rotate(${angle} ${tx} ${ty})" font-family="sans-serif" font-size="20" text-anchor="middle" dominant-baseline="middle" fill="#17392e" stroke="#fff" stroke-width="5" paint-order="stroke">${manufacturingMillimetres(length)} мм</text></g>`;
  }).join("");
};

const partHeight = (layout: Layout, zoneId: string | null | undefined, point: number[]) => {
  const shower = layout.shower;
  const zone = shower?.zones.find(candidate => candidate.id === zoneId);
  if (!shower || !zone) return 0;
  const slope = zone.slopePercent / 100;
  return zone.axis === "east" || zone.axis === "west"
    ? Math.abs(point[0] - shower.drain.x) * slope
    : Math.abs(point[1] - shower.drain.y) * slope;
};

export function exportResult(kind: "svg" | "csv", layout: Layout) {
  if (kind === "csv") {
    download(
      "plitka-details.csv",
      "\uFEFFДеталь;Зона уклона;Ширина по поверхности мм;Высота по поверхности мм;Площадь мм²;Предупреждения\n" +
        layout.parts
          .map((p) =>
            [p.id, p.zoneId ?? "", manufacturingMillimetres(p.surfaceWidth ?? p.width),
              manufacturingMillimetres(p.surfaceHeight ?? p.height), format(p.area),
              p.issues.join(", ")].join(";"),
          )
          .join("\n"),
      "text/csv;charset=utf-8",
    );
    return;
  }
  const points = layout.parts.flatMap((p) => p.rings.flat()),
    xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1]);
  const x = Math.min(...xs) - 150,
    y = Math.min(...ys) - 150,
    w = Math.max(...xs) - x + 150,
    h = Math.max(...ys) - y + 150;
  download(
    "plitka-plan.svg",
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}"><title>План раскладки — производственные размеры в мм, точность 1 мм</title>${layout.parts.map((p) => `<path d="${path(p.rings)}" fill="${p.issues.length ? "#f4d5aa" : "#c9ded4"}" stroke="#446357" stroke-width="3" fill-rule="evenodd"/>${partDimensionSvg(p.rings[0] ?? [], point => partHeight(layout, p.zoneId, point))}<text x="${p.center[0]}" y="${p.center[1]}" font-size="28" text-anchor="middle">${p.id}: ${manufacturingMillimetres(p.surfaceWidth ?? p.width)} × ${manufacturingMillimetres(p.surfaceHeight ?? p.height)} мм</text>`).join("")}</svg>`,
    "image/svg+xml",
  );
}
