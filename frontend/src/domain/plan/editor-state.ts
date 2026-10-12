import type { GraphSnapshot, FaceCandidate, Point } from "./types";
export type EditorTool =
  | "select"
  | "addVertex"
  | "connect"
  | "move"
  | "pan"
  | "selectRoom"
  | "angle";
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
    }
  | {
      kind: "angle";
      vertexId: string;
      firstSegmentId: string;
      secondSegmentId: string;
      sector: "cw" | "ccw";
      constraintId?: string;
    };
export type ToolInteraction =
  | { kind: "idle" }
  | { kind: "connect"; firstVertexId: string | null }
  | { kind: "rangeFirst"; chainId: string }
  | { kind: "rangeSecond"; chainId: string; firstVertexId: string }
  | { kind: "angleFirst" }
  | { kind: "angleSecond"; firstSegmentId: string }
  | {
      kind: "angleSector";
      vertexId: string;
      firstSegmentId: string;
      secondSegmentId: string;
    }
  | { kind: "move"; vertexId: string; origin: Point; preview: Point }
  | { kind: "placeVertex"; cursor: Point };
export interface KeyboardState {
  activeTarget: string | null;
  cursor: Point;
  mode: "navigation" | "placement" | "movePreview";
}
export interface EditorState {
  context: EditorContext;
  interaction: ToolInteraction;
  keyboard: KeyboardState;
  error: string;
}
export const initialEditor = (): EditorState => ({
  context: { kind: "none" },
  interaction: { kind: "idle" },
  keyboard: { activeTarget: null, cursor: { x: 0, y: 0 }, mode: "navigation" },
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
    (c.kind === "angle" || c.kind === "range") &&
    c.constraintId &&
    !g.constraints.some((x) => x.id === c.constraintId)
  )
    return false;
  if (c.kind === "range")
    return (
      rangeSegments(g, c.chainId, c.startVertexId, c.endVertexId).length > 0
    );
  if (c.kind === "angle")
    return [c.firstSegmentId, c.secondSegmentId].every((id) =>
      g.segments.some(
        (s) =>
          s.id === id && [s.startVertexId, s.endVertexId].includes(c.vertexId),
      ),
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
  | { type: "angleSegment"; id: string; graph: GraphSnapshot }
  | { type: "sector"; sector: "cw" | "ccw" }
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
          : i.kind === "angleSecond"
            ? g.segments.some((s) => s.id === i.firstSegmentId)
            : i.kind === "angleSector"
              ? contextExists(
                  { ...i, kind: "angle", sector: "ccw" },
                  g,
                  action.faces,
                )
              : i.kind === "move"
                ? g.vertices.some((v) => v.id === i.vertexId)
                : i.kind === "connect"
                  ? i.firstVertexId === null ||
                    g.vertices.some((v) => v.id === i.firstVertexId)
                  : true;
    let context: EditorContext = contextExists(state.context, g, action.faces)
      ? state.context
      : { kind: "none" };
    if (context.kind === "angle" || context.kind === "range") {
      const selected = context;
      const condition = g.constraints.find((c) =>
        selected.kind === "range"
          ? c.kind === "chainLength" &&
            c.target.chainId === selected.chainId &&
            c.target.range?.startVertexId === selected.startVertexId &&
            c.target.range?.endVertexId === selected.endVertexId
          : c.kind === "angle" &&
            c.target.vertexId === selected.vertexId &&
            ((c.target.firstSegmentId === selected.firstSegmentId &&
              c.target.secondSegmentId === selected.secondSegmentId &&
              c.target.sector === selected.sector) ||
              (c.target.firstSegmentId === selected.secondSegmentId &&
                c.target.secondSegmentId === selected.firstSegmentId &&
                c.target.sector !== selected.sector)),
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
  if (action.type === "angleSegment") {
    if (i.kind !== "angleSecond")
      return {
        ...state,
        context: { kind: "none" },
        interaction: { kind: "angleSecond", firstSegmentId: action.id },
        error: "",
      };
    const a = action.graph.segments.find((s) => s.id === i.firstSegmentId),
      b = action.graph.segments.find((s) => s.id === action.id);
    const shared =
      a && b && a.id !== b.id
        ? [a.startVertexId, a.endVertexId].filter((id) =>
            [b.startVertexId, b.endVertexId].includes(id),
          )
        : [];
    const vertexId = shared.length === 1 ? shared[0] : undefined;
    if (!vertexId)
      return { ...state, error: "Выберите другую стену с общей вершиной." };
    return {
      ...state,
      interaction: {
        kind: "angleSector",
        vertexId,
        firstSegmentId: i.firstSegmentId,
        secondSegmentId: action.id,
      },
      context: { kind: "none" },
      error: "",
    };
  }
  if (action.type === "sector" && i.kind === "angleSector")
    return {
      ...state,
      context: { ...i, kind: "angle", sector: action.sector },
      interaction: { kind: "idle" },
      error: "",
    };
  return state;
}
