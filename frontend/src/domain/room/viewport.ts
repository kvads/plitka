export function worldPoint(svg: SVGSVGElement, x: number, y: number) {
  const p = new DOMPoint(x, y).matrixTransform(svg.getScreenCTM()!.inverse());
  return { x: p.x, y: -p.y };
}
