import type { GraphSnapshot, FaceCandidate, Point } from "./types";

// Canvas-only state. None of these objects are part of ProjectDocumentV4.
export type WallHandle = "start" | "center" | "end";
export type SelectedWall = { chainId: string; handle: WallHandle | null };
export type PendingWallStart = { point: Point; source: "wallEnd" | "grid"; vertexId?: string };
export type SnapCandidate = {
  point: Point;
  screen: Point;
  type: "wallEnd" | "perpendicularGuide" | "majorGrid";
  allowed: boolean;
  vertexId?: string;
};
export type RulerOverlay = {
  start: Point;
  candidate: Point | null;
  distanceMm: number | null;
  axes: ("horizontal" | "vertical")[];
  perpendiculars: { from: Point; direction: Point }[];
};
export type EditorTool = "select" | "wall" | "pan" | "selectRoom";
export type EditorContext =
  | { kind: "none" }
  | { kind: "project" }
  | { kind: "tool"; tool: EditorTool }
  | { kind: "vertex" | "segment" | "void" | "constraint"; id: string }
  | { kind: "room"; roomId: string; topologyKey: string }
  | {
      kind: "range";
      chainId: string;
      startVertexId: string;
      endVertexId: string;
      constraintId?: string;
    };
export type ToolInteraction =
  | { kind: "idle" }
  | { kind: "rangeFirst"; chainId: string }
  | { kind: "rangeSecond"; chainId: string; firstVertexId: string };
export interface EditorState {
  context: EditorContext;
  interaction: ToolInteraction;
  error: string;
}
export const initialEditor = (): EditorState => ({
  context: { kind: "none" },
  interaction: { kind: "idle" },
  error: "",
});
export function chainNodes(g: GraphSnapshot, id: string) {
  const chain = g.chains.find((c) => c.id === id);
  if (!chain) return [];
  const nodes = [chain.startVertexId];
  for (const id of chain.segmentIds) {
    const segment = g.segments.find((s) => s.id === id);
    if (
      !segment ||
      segment.startVertexId !== nodes.at(-1) ||
      nodes.includes(segment.endVertexId)
    )
      return [];
    nodes.push(segment.endVertexId);
  }
  return nodes.at(-1) === chain.endVertexId ? nodes : [];
}
export function canonicalRange(
  g: GraphSnapshot,
  chainId: string,
  a: string,
  b: string,
) {
  const nodes = chainNodes(g, chainId),
    i = nodes.indexOf(a),
    j = nodes.indexOf(b);
  return i >= 0 && j >= 0 && i !== j
    ? {
        startVertexId: nodes[Math.min(i, j)],
        endVertexId: nodes[Math.max(i, j)],
      }
    : null;
}
export function rangeSegments(
  g: GraphSnapshot,
  chainId: string,
  start: string,
  end: string,
) {
  const c = g.chains.find((c) => c.id === chainId),
    nodes = chainNodes(g, chainId),
    i = nodes.indexOf(start),
    j = nodes.indexOf(end);
  return c && i >= 0 && j > i ? c.segmentIds.slice(i, j) : [];
}
export function contextExists(
  c: EditorContext,
  g: GraphSnapshot,
  faces: FaceCandidate[],
) {
  if (c.kind === "vertex") return g.vertices.some((v) => v.id === c.id);
  if (c.kind === "segment") return g.segments.some((v) => v.id === c.id);
  if (c.kind === "void") return g.voids.some((v) => v.id === c.id);
  if (c.kind === "constraint") return g.constraints.some((v) => v.id === c.id);
  if (c.kind === "room")
    return faces.some((f) => f.topologyKey === c.topologyKey);
  if (
    c.kind === "range" &&
    c.constraintId &&
    !g.constraints.some((x) => x.id === c.constraintId)
  )
    return false;
  if (c.kind === "range")
    return (
      rangeSegments(g, c.chainId, c.startVertexId, c.endVertexId).length > 0
    );
  return true;
}
export type EditorAction =
  | { type: "reset" }
  | { type: "context"; context: EditorContext }
  | { type: "interaction"; interaction: ToolInteraction }
  | {
      type: "accept";
      graph: GraphSnapshot;
      faces: FaceCandidate[];
      reset?: boolean;
    }
  | { type: "rangeVertex"; id: string; graph: GraphSnapshot }
  | { type: "cancel" };
export function editorReducer(
  state: EditorState,
  action: EditorAction,
): EditorState {
  if (action.type === "reset") return initialEditor();
  if (action.type === "cancel")
    return {
      ...state,
      context: { kind: "none" },
      interaction: { kind: "idle" },
      error: "",
    };
  if (action.type === "context")
    return {
      ...state,
      context: action.context,
      interaction: { kind: "idle" },
      error: "",
    };
  if (action.type === "interaction")
    return {
      ...state,
      context: { kind: "none" },
      interaction: action.interaction,
      error: "",
    };
  if (action.type === "accept") {
    if (action.reset) return initialEditor();
    const i = state.interaction,
      g = action.graph;
    const valid =
      i.kind === "rangeFirst"
        ? g.chains.some((c) => c.id === i.chainId)
        : i.kind === "rangeSecond"
          ? chainNodes(g, i.chainId).includes(i.firstVertexId)
          : true;
    let context: EditorContext = contextExists(state.context, g, action.faces)
      ? state.context
      : { kind: "none" };
    if (context.kind === "range") {
      const selected = context;
      const condition = g.constraints.find((c) =>
          c.kind === "chainLength" &&
            c.target.chainId === selected.chainId &&
            c.target.range?.startVertexId === selected.startVertexId &&
            c.target.range?.endVertexId === selected.endVertexId,
      );
      if (condition) context = { ...context, constraintId: condition.id };
    }
    return {
      ...state,
      context,
      interaction: valid ? i : { kind: "idle" },
      error: "",
    };
  }
  const i = state.interaction;
  if (
    action.type === "rangeVertex" &&
    (i.kind === "rangeFirst" || i.kind === "rangeSecond")
  ) {
    if (!chainNodes(action.graph, i.chainId).includes(action.id))
      return { ...state, error: "Выберите вершину этой стены." };
    if (i.kind === "rangeFirst")
      return {
        ...state,
        interaction: {
          kind: "rangeSecond",
          chainId: i.chainId,
          firstVertexId: action.id,
        },
        error: "",
      };
    const range = canonicalRange(
      action.graph,
      i.chainId,
      i.firstVertexId,
      action.id,
    );
    if (!range) return { ...state, error: "Выберите другую вершину стены." };
    return {
      ...state,
      context: { kind: "range", chainId: i.chainId, ...range },
      interaction: { kind: "idle" },
      error: "",
    };
  }
  return state;
}
