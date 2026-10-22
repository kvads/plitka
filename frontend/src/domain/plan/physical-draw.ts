import type { OpenJointAngleV5, PhysicalGraphV5, Point } from "./types";
import { roundTenth } from "./precision";

export type PhysicalFace = { point: Point; normal: Point; from: Point; to: Point; distance: number };
export type PhysicalAttachment = PhysicalFace & { center: Point; tangentialShift: number };

const rounded = (point: Point): Point => ({ x: roundTenth(point.x), y: roundTenth(point.y) });
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const add = (a: Point, b: Point, amount = 1): Point =>
  ({ x: a.x + b.x * amount, y: a.y + b.y * amount });
const difference = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;

const inside = (corners: Point[], point: Point) => {
  let contained = false;
  for (let i = 0, j = corners.length - 1; i < corners.length; j = i++) {
    const a = corners[i], b = corners[j];
    if ((a.y > point.y) !== (b.y > point.y) &&
        point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) contained = !contained;
  }
  return contained;
};

export function nearestPhysicalFace(graph: PhysicalGraphV5, point: Point, radius: number): PhysicalFace | null {
  let nearest: PhysicalFace | null = null;
  for (const wall of graph.walls) {
    const corners = wall.corners;
    for (const [from, to] of [[corners[0], corners[1]], [corners[1], corners[2]],
      [corners[2], corners[3]], [corners[3], corners[0]]]) {
      const delta = difference(to, from), lengthSq = dot(delta, delta);
      if (lengthSq < .01) continue;
      const ratio = dot(difference(point, from), delta) / lengthSq;
      if (ratio < 0 || ratio > 1) continue;
      const projected = add(from, delta, ratio);
      const distance = Math.hypot(point.x - projected.x, point.y - projected.y);
      if (distance >= radius || (nearest && distance >= nearest.distance)) continue;
      const length = Math.sqrt(lengthSq);
      let normal = { x: -delta.y / length, y: delta.x / length };
      const probe = add(projected, normal, .5);
      if (inside(corners, probe)) normal = { x: -normal.x, y: -normal.y };
      // A face buried under another wall is not an available snap surface.
      if (graph.walls.some(other => other !== wall && inside(other.corners, add(projected, normal, .5))))
        continue;
      nearest = { point: rounded(projected), normal, from, to, distance };
    }
  }
  return nearest;
}

export function nearestCubeAttachment(graph: PhysicalGraphV5, point: Point,
                                      radius: number, thicknessMm: number): PhysicalAttachment | null {
  const pointerInsideWall = graph.walls.some(wall => inside(wall.corners, point));
  const reach = thicknessMm / 2 + radius;
  const face = nearestPhysicalFace(graph, point,
    pointerInsideWall ? Number.POSITIVE_INFINITY : reach + .001);
  if (!face) return null;
  const segment = difference(face.to, face.from);
  const faceLength = Math.hypot(segment.x, segment.y);
  const tangent = { x: segment.x / faceLength, y: segment.y / faceLength };
  const along = dot(difference(face.point, face.from), tangent);
  // Keep the complete touching side of the cursor on the selected face. Close
  // to either end this acts as a corner alignment: the cursor moves inward by
  // just enough for its outer corner to coincide with the host corner instead
  // of creating a small protrusion or notch in the joined outline.
  const inset = Math.min(thicknessMm / 2, faceLength / 2);
  const alignedAlong = Math.max(inset, Math.min(faceLength - inset, along));
  const contact = rounded(add(face.from, tangent, alignedAlong));
  const center = rounded(add(contact, face.normal, thicknessMm / 2));
  // Once the cursor square touches a wall, it belongs on the nearest exposed
  // face. Comparing with the future center left thick host walls with a dead
  // zone where the cursor could remain inside their surface.
  return pointerInsideWall || Math.hypot(point.x - face.point.x, point.y - face.point.y) <= reach
    ? { ...face, point: contact, center, tangentialShift: Math.abs(alignedAlong - along) } : null;
}

function intersectionOnFace(origin: Point, direction: Point, face: PhysicalFace): number | null {
  const segment = difference(face.to, face.from);
  const denominator = cross(direction, segment);
  if (Math.abs(denominator) < .1 * Math.hypot(segment.x, segment.y)) return null;
  const offset = difference(face.from, origin);
  const along = cross(offset, segment) / denominator;
  const ratio = cross(offset, direction) / denominator;
  return ratio >= -.001 && ratio <= 1.001 ? along : null;
}

export function centeredWallGeometry(graph: PhysicalGraphV5, start: Point, end: Point,
                                     thicknessMm: number,
                                     attachmentHints?: readonly [PhysicalAttachment | null,
                                       PhysicalAttachment | null]) {
  const delta = difference(end, start), length = Math.hypot(delta.x, delta.y);
  if (length < .1) return null;
  const direction = { x: delta.x / length, y: delta.y / length };
  const left = { x: -direction.y, y: direction.x };
  const offset = { x: -left.x * thicknessMm / 2, y: -left.y * thicknessMm / 2 };
  const attachments: [PhysicalAttachment | null, PhysicalAttachment | null] = attachmentHints
    ? [attachmentHints[0], attachmentHints[1]]
    : [nearestCubeAttachment(graph, start, .2, thicknessMm),
      nearestCubeAttachment(graph, end, .2, thicknessMm)];
  if (!attachments[0] && length <= thicknessMm / 2 + .1) return null;
  // A free first click identifies the whole cursor square, not its center.
  // Begin at the square boundary behind the drag direction so the complete
  // cursor footprint becomes the first section of the new wall. Attached
  // starts remain on the receiving face so joined walls stay continuous.
  const physicalStart = attachments[0] ? start : add(start, direction, -thicknessMm / 2);
  let drawnStart = rounded(add(physicalStart, offset));
  let drawnEnd = rounded(add(end, offset));
  const sideOffset = { x: left.x * thicknessMm, y: left.y * thicknessMm };
  for (const [index, face] of attachments.entries()) {
    if (!face) continue;
    const cap = index === 0 ? drawnStart : drawnEnd;
    // Only intersections with the real face segment may move the wall. Using
    // the infinite supporting line here made one corner fly far past an
    // oblique joint and produced a long triangular spike. A single local
    // corner intersection is sufficient: the server completes the exact
    // miter while the immediate preview remains a regular wall rectangle.
    const crossings = [cap, add(cap, sideOffset)]
      .map(point => intersectionOnFace(point, direction, face))
      .filter((value): value is number => value !== null);
    if (crossings.length === 0) {
      const center = add(cap, sideOffset, .5);
      const centerCrossing = intersectionOnFace(center, direction, face);
      if (centerCrossing !== null) crossings.push(centerCrossing);
    }
    if (crossings.length === 0) continue;
    // Move the cap to the closest real crossing regardless of sign. Depending
    // on the drag angle the selected face can be just ahead of the cursor
    // centre (shortening) or just behind it (extension).
    const adjustment = crossings.reduce((best, value) =>
      Math.abs(value) < Math.abs(best) ? value : best);
    if (Math.abs(adjustment) > thicknessMm * 10) continue;
    if (index === 0) drawnStart = rounded(add(drawnStart, direction, adjustment));
    else drawnEnd = rounded(add(drawnEnd, direction, adjustment));
  }
  const oppositeEnd = rounded(add(drawnEnd, sideOffset));
  const oppositeStart = rounded(add(drawnStart, sideOffset));
  const corners: [Point, Point, Point, Point] = [drawnStart, drawnEnd, oppositeEnd, oppositeStart];
  return { edge: [drawnStart, drawnEnd] as [Point, Point],
    corners,
    attachments, direction };
}

export function immediateJointAngles(geometry:
  NonNullable<ReturnType<typeof centeredWallGeometry>>): OpenJointAngleV5[] {
  const result: OpenJointAngleV5[] = [];
  for (const [endIndex, face] of geometry.attachments.entries()) {
    if (!face) continue;
    const cap = geometry.corners[endIndex];
    const opposite = geometry.corners[endIndex === 0 ? 3 : 2];
    const sides = [cap, opposite];
    const faceDirection = difference(face.to, face.from);
    const faceLength = Math.hypot(faceDirection.x, faceDirection.y);
    if (faceLength < .1) continue;
    const tangent = { x: faceDirection.x / faceLength, y: faceDirection.y / faceLength };
    const outward = endIndex === 0 ? geometry.direction
      : { x: -geometry.direction.x, y: -geometry.direction.y };
    const crossings = sides.map(point => intersectionOnFace(point, outward, face));
    if (crossings.some(value => value === null)) continue;
    const points = sides.map((point, index) => add(point, outward, crossings[index]!));
    if (Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) < .1) continue;
    const ordered = points.map((point, index) => ({ point, along: dot(difference(point, face.from), tangent), index }))
      .sort((a, b) => a.along - b.along);
    for (const [index, crossing] of ordered.entries()) {
      const ray = index === 0 ? { x: -tangent.x, y: -tangent.y } : tangent;
      const cosine = Math.max(-1, Math.min(1, dot(ray, outward)));
      const angle = roundTenth(Math.acos(cosine) * 180 / Math.PI);
      const sum = add(ray, outward), sumLength = Math.hypot(sum.x, sum.y);
      if (sumLength < .01) continue;
      const bisector = { x: sum.x / sumLength, y: sum.y / sumLength };
      const anchor = rounded(add(crossing.point, bisector, 35));
      result.push({ junctionId: `immediate-${endIndex}-${crossing.index}`, wallId: "preview",
        adjacentWallId: "existing", valueDeg: angle, label: "Угол стыка", anchor,
        corner: rounded(crossing.point), rays: [ray, outward] });
    }
  }
  return result;
}
