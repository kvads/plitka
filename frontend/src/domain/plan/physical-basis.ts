import type { PhysicalGraphV5 } from "./types";

/** Canonical representation independent of object/list insertion order. */
export function physicalGraphCanonicalJson(graph: PhysicalGraphV5): string {
  const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  const ordered = {
    walls: [...graph.walls].sort((a, b) => compare(a.id, b.id)),
    junctions: [...graph.junctions].sort((a, b) => compare(a.id, b.id))
      .map(joint => ({ ...joint, participants: [...joint.participants]
        .sort((a, b) => compare(a.wallId, b.wallId)) })),
    openings: [...(graph.openings ?? [])].sort((a, b) => compare(a.id, b.id)),
  };
  const normalize = (value: unknown): unknown => {
    if (typeof value === "number") return Math.round(value * 10);
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === "object") return Object.fromEntries(
      Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([key, item]) => [key, normalize(item)]));
    return value;
  };
  return JSON.stringify(normalize(ordered));
}

/** Stable key for a physical graph, independent of object/list insertion order. */
export async function physicalBasisKey(graph: PhysicalGraphV5): Promise<string> {
  const bytes = new TextEncoder().encode(physicalGraphCanonicalJson(graph));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return "physical-v5:" + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
