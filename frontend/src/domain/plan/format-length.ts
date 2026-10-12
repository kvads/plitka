export function formatPlanLength(mm: number): string {
  const meters = Math.abs(mm) >= 1000;
  return `${Number((meters ? mm / 1000 : mm).toFixed(meters ? 4 : 1)).toString().replace('.', ',')} ${meters ? 'м' : 'мм'}`;
}
