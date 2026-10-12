export function snap(x: number, y: number, step: number, threshold: number) {
  const gx = Math.round(x / step) * step,
    gy = Math.round(y / step) * step,
    dx = Math.abs(gx - x),
    dy = Math.abs(gy - y);
  if (Math.hypot(dx, dy) <= threshold) return { x: gx, y: gy, type: "Узел" };
  if (Math.min(dx, dy) <= threshold)
    return dx <= dy ? { x: gx, y, type: "Линия" } : { x, y: gy, type: "Линия" };
  return { x, y, type: "Свободно" };
}
