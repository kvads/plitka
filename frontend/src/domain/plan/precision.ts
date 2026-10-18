/** Decimal precision of persisted project measurements, in their declared units. */
export const DECIMAL_SCALE = 10;

export function isTenth(value: number): boolean {
  return Number.isFinite(value) &&
    Math.abs(value * DECIMAL_SCALE - Math.round(value * DECIMAL_SCALE)) <=
      Number.EPSILON * Math.max(1, Math.abs(value * DECIMAL_SCALE)) * 8;
}

export function roundTenth(value: number): number {
  if (!Number.isFinite(value)) throw new Error("Некорректное число.");
  const ticks = Math.round(Math.abs(value) * DECIMAL_SCALE);
  return (value < 0 ? -ticks : ticks) / DECIMAL_SCALE;
}

export function requireTenth(value: number): number {
  if (!isTenth(value)) throw new Error("Допустим не более одного знака после запятой.");
  return value;
}

export function canonicalCommand<T>(command: T): T {
  const visit = (value: unknown): unknown => {
    if (typeof value === 'number') return roundTenth(value);
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item)]));
    return value;
  };
  return visit(command) as T;
}
