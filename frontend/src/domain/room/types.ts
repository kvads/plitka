export type Vertex = { id: string; x: number; y: number };
export type Wall = { id: string; startVertexId: string; endVertexId: string };
export type Contour = {
  id: string;
  kind: "outer" | "hole";
  closed: boolean;
  winding: "ccw" | "cw";
  vertices: Vertex[];
  walls: Wall[];
};
export type DimensionConstraint = {
  id: string;
  kind: "length" | "interiorAngle" | "firstWallOrientation";
  wallId: string;
  value: number;
  fixed: boolean;
};
export type GeometrySnapshot = {
  outer: Contour;
  holes: Contour[];
  constraints: DimensionConstraint[];
  fieldInputs: Record<string, string>;
};
export type Measurement = {
  wallId: string;
  length: number;
  interiorAngle: number | null;
  orientation: number;
  lengthSource: "entered" | "derived";
  angleSource: "entered" | "derived";
};
export type Issue = {
  code: string;
  message: string;
  contourId?: string;
  wallIds: string[];
  vertexIds: string[];
  constraintIds: string[];
  expected?: number;
  actual?: number;
  deviation?: number;
  unit?: string;
};
export type ValidationResult = {
  status:
    | "valid"
    | "incomplete"
    | "constraint_conflict"
    | "invalid_topology"
    | "unresolved";
  issues: Issue[];
  measurements: Measurement[];
  areaMm2: number | null;
  closureGapMm: number | null;
};
export type Operation = {
  type:
    | "setLength"
    | "setInteriorAngle"
    | "setOrientation"
    | "moveVertex"
    | "releaseConstraint"
    | "reconcile";
  wallId?: string;
  contourId?: string;
  vertexId?: string;
  constraintId?: string;
  value?: number;
  x?: number;
  y?: number;
};
export type GeometryResponse = {
  requestId: string;
  draftRevision: number;
  geometry?: GeometrySnapshot;
  validation: ValidationResult;
  changedWallIds?: string[];
};
