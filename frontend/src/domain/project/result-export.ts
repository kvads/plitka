import { path, type Layout } from "../../types";
import { download } from "./import-export";
export function exportResult(kind: "svg" | "csv", layout: Layout) {
  if (kind === "csv") {
    download(
      "plitka-details.csv",
      "\uFEFFДеталь;Ширина мм;Высота мм;Площадь м²;Предупреждения\n" +
        layout.parts
          .map((p) =>
            [p.id, p.width, p.height, p.area, p.issues.join(", ")].join(";"),
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
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}"><title>План раскладки — размеры в мм</title>${layout.parts.map((p) => `<path d="${path(p.rings)}" fill="${p.issues.length ? "#f4d5aa" : "#c9ded4"}" stroke="#446357" stroke-width="3" fill-rule="evenodd"/><text x="${p.center[0]}" y="${p.center[1]}" font-size="28" text-anchor="middle">${p.id}: ${p.width.toFixed(1)} × ${p.height.toFixed(1)} мм</text>`).join("")}</svg>`,
    "image/svg+xml",
  );
}
