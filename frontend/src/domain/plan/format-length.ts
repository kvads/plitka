export function formatPlanLength(mm: number): string {
  return `${Number(mm.toFixed(1)).toString().replace('.', ',')} мм`;
}
