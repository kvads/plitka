export type Vertex = { id: string; x: number; y: number };
export type Segment = {
  id: string;
  startVertexId: string;
  endVertexId: string;
  chainId: string;
};
export type WallChain = {
  id: string;
  startVertexId: string;
  endVertexId: string;
  segmentIds: string[];
  thicknessMm: number;
};
export type DirectedSegmentRef = { segmentId: string; forward: boolean };
export type LengthRange = { startVertexId: string; endVertexId: string };
export type ConstraintTarget = {
  segmentId?: string;
  chainId?: string;
  range?: LengthRange | null;
  vertexId?: string;
  firstSegmentId?: string;
  secondSegmentId?: string;
  sector?: "cw" | "ccw";
  originalConstraint?: unknown;
  reason?: string;
};
export type DimensionConstraint = {
  id: string;
  kind:
    | "segmentLength"
    | "chainLength"
    | "angle"
    | "orientation"
    | "legacyUnbound";
  target: ConstraintTarget;
  value: number;
  fixed: boolean;
};
export type GraphSnapshot = {
  vertices: Vertex[];
  segments: Segment[];
  chains: WallChain[];
  voids: { id: string; boundary: DirectedSegmentRef[] }[];
  constraints: DimensionConstraint[];
  fieldInputs: Record<string, string>;
};
export type Issue = {
  code: string;
  message: string;
  entityIds: string[];
  fieldKey?: string;
  scope: "global" | "component" | "room";
  affectedRoomKeys: string[];
};
export type Measurement = {
  key: string;
  kind: string;
  target: ConstraintTarget;
  value: number | null;
  source: "entered" | "derived";
};
export type FaceCandidate = {
  topologyKey: string;
  outer: DirectedSegmentRef[];
  holes: DirectedSegmentRef[][];
  axisPolygon: { outline: number[][]; holes: number[][][] };
  polygon: { outline: number[][]; holes: number[][][] } | null;
  areaMm2: number | null;
  dependencyIds: string[];
  dependencyKey: string;
  geometryKey: string;
  measurementKey: string;
  validation: { valid: boolean; issues: Issue[] };
};
export type Point = { x: number; y: number };
export type PhysicalWallV5 = {
  id: string;
  drawnEdge: [Point, Point];
  side: "left" | "right";
  thicknessMm: number;
  corners: [Point, Point, Point, Point];
};
export type WallJunctionV5 = {
  id: string;
  participants: {
    wallId: string;
    edge: "drawn" | "opposite" | "startCap" | "endCap";
    point: Point;
    attachment: "end" | "interior";
  }[];
};
export type DoorOpeningV5 = {
  id: string;
  wallId: string;
  offsetMm: number;
  widthMm: number;
};
export type PhysicalGraphV5 = {
  walls: PhysicalWallV5[];
  junctions: WallJunctionV5[];
  openings?: DoorOpeningV5[];
};
export type PhysicalCommandV5 =
  | { type: "drawWall"; drawnEdge: [Point, Point]; side: "left" | "right"; thicknessMm?: number }
  | { type: "addDoorOpening"; wallId: string; offsetMm: number; widthMm: number }
  | { type: "setDoorWidth"; openingId: string; widthMm: number }
  | { type: "deleteDoorOpening"; openingId: string }
  | { type: "setWallThickness"; wallId: string; thicknessMm: number }
  | { type: "nudgeWallHandle"; wallId: string; handle: "start" | "center" | "end"; axis: "x" | "y"; direction: -1 | 1 }
  | { type: "deleteWall"; wallId: string };
export type PhysicalPolygonV5 = { outline: number[][]; holes: number[][][] };
export type PhysicalRoomV5 = {
  topologyKey: string;
  geometryKey: string;
  polygon: PhysicalPolygonV5 | null;
  areaMm2: number | null;
  validation: { valid: boolean; issues: Issue[] };
  innerAngles: { valueDeg: number; anchor: Point }[];
  freeDimensions: { valueMm: number; from: Point; to: Point; anchor: Point }[];
  connectedRoomKeys?: string[];
  doorIds?: string[];
};
export type OpenJointAngleV5 = {
  junctionId: string;
  wallId: string;
  adjacentWallId: string;
  valueDeg: number;
  label: "Угол стыка";
  anchor: Point;
  corner?: Point;
  rays?: [Point, Point];
};
export type PhysicalGraphResponseV5 = {
  schemaVersion: 5;
  requestId?: string;
  commandId?: string;
  draftRevision: number;
  basisKey: string;
  status: "valid" | "invalid" | "applied";
  graph: PhysicalGraphV5;
  normalizedGraph?: PhysicalGraphV5;
  affectedWallIds: string[];
  wallArea: PhysicalPolygonV5[];
  faces: PhysicalRoomV5[];
  openJointAngles: OpenJointAngleV5[];
  issues: Issue[];
};
export type GraphPendingV5 = {
  kind: "graphV5";
  commandId: string;
  command: PhysicalCommandV5;
  basisGraph: PhysicalGraphV5;
  targetDraftRevision: number;
};
export type ConfirmedPhysicalRoomV5 = {
  graph: PhysicalGraphV5;
  topologyKey: string;
  geometryKey: string;
  dependencyKey: string;
  measurementKey: string;
  acknowledgment: Acknowledgment | null;
  sourceDraftRevision: number;
};
export type PhysicalRoomRecordV6 = Omit<RoomRecord, "confirmed"> & {
  confirmed: ConfirmedPhysicalRoomV5 | null;
};
export type SharedLayoutGridV6 = {
  referenceRoomId: string;
  referenceBasis: string;
  tile: number;
  grout: number;
  angle: number;
  offsetX: number;
  offsetY: number;
  linkedRoomIds: string[];
};
export type ProjectDocumentV6 = Omit<ProjectDocumentV5, "schemaVersion" | "plan" | "rooms"> & {
  schemaVersion: 6;
  plan: {
    draft: PhysicalGraphV5;
    draftRevision: number;
    pendingEdit: GraphPendingV5 | null;
    restorePoint: {
      graph: PhysicalGraphV5;
      bindings: { roomId: string; topologyKey: string | null }[];
      selectedRoomId: string | null;
    } | null;
  };
  rooms: PhysicalRoomRecordV6[];
  sharedGrid?: SharedLayoutGridV6 | null;
};
export type GraphCommand =
  | { type: "addVertex"; point: Point }
  | {
      type: "connect";
      fromVertexId: string;
      to: { vertexId: string } | { segmentId: string; point: Point };
      thicknessMm: number;
    }
  | { type: "drawWall"; start: Point; end: Point; thicknessMm: number }
  | { type: "setWallThickness"; chainId: string; thicknessMm: number }
  | { type: "moveVertex"; vertexId: string; point: Point }
  | { type: "nudgeWallHandle"; chainId: string; handle: "start" | "center" | "end"; axis: "x" | "y"; direction: -1 | 1 }
  | {
      type: "setLength";
      constraintId: string;
      target: {
        kind: "segment" | "chain";
        id: string;
        range?: LengthRange | null;
      };
      value: number;
    }
  | {
      type: "setAngle";
      constraintId: string;
      vertexId: string;
      firstSegmentId: string;
      secondSegmentId: string;
      sector: "cw" | "ccw";
      value: number;
    }
  | {
      type: "setOrientation";
      constraintId: string;
      chainId: string;
      value: number;
    }
  | { type: "releaseConstraint"; constraintId: string }
  | {
      type: "deleteElements";
      vertexIds: string[];
      segmentIds: string[];
      acknowledgedConstraintIds: string[];
    }
  | { type: "markVoid"; boundary: DirectedSegmentRef[] }
  | { type: "unmarkVoid"; voidId: string }
  | {
      type: "addTemplate";
      shape: "rectangle" | "lShape";
      origin: Point;
      width: number;
      height: number;
      notchWidth?: number;
      notchHeight?: number;
      thicknessMm: number;
    }
  | { type: "deleteRoom"; topologyKey: string; impactKey: string }
  | { type: "deleteVoid"; voidId: string; impactKey: string }
  | { type: "deleteConstraint"; constraintId: string }
  | { type: "reconcile" };
export type GraphResponse = {
  schemaVersion: 4;
  requestId?: string;
  commandId?: string;
  draftRevision: number;
  basisKey: string;
  status: "valid" | "invalid" | "unresolved" | "applied";
  graph: GraphSnapshot;
  wallArea: { outline: number[][]; holes: number[][][] }[];
  faces: FaceCandidate[];
  measurements: Measurement[];
  issues: Issue[];
  splitMap?: Record<string, string[]>;
  addedIds?: string[];
  removedIds?: string[];
  affectedChainIds?: string[];
};
export type Acknowledgment = {
  measurementKey: string;
  entries: { key: string; kind: string; displayedValue: number }[];
};
export type ConfirmedRoom = {
  graph: GraphSnapshot;
  boundary: { outer: DirectedSegmentRef[]; holes: DirectedSegmentRef[][] };
  topologyKey: string;
  dependencyKey: string;
  geometryKey: string;
  measurementKey: string;
  acknowledgment: Acknowledgment | null;
  sourceDraftRevision: number;
};
export type PlanPage = "plan" | "variants";
export type RoomReadiness = "no-selection" | "detached" | "validating" | "invalid" | "pending" | "ready";
export type RoomRecord = {
  boundaryMemory?: { topologyKey: string; geometryKey: string } | null;
  id: string;
  topologyKey: string | null;
  binding: "attached" | "detached";
  name: string;
  material: { tile: number; grout: number };
  rules: { gap: number; threshold: number; angle: number };
  fieldInputs: Record<string, string>;
  acknowledgment: Acknowledgment | null;
  confirmed: ConfirmedRoom | null;
};
export type GraphPending = {
  kind: "graphV4";
  commandId: string;
  command: GraphCommand;
  basisGraph: GraphSnapshot;
  targetDraftRevision: number;
};
export type ProjectDocumentV4 = {
  schemaVersion: 4;
  id: string;
  name: string;
  address: string;
  documentRevision: number;
  plan: {
    draft: GraphSnapshot;
    draftRevision: number;
    pendingEdit: GraphPending | null;
    restorePoint: {
      graph: GraphSnapshot;
      bindings: { roomId: string; topologyKey: string | null }[];
      selectedRoomId: string | null;
    } | null;
  };
  rooms: RoomRecord[];
  selectedRoomId: string | null;
  workflow: { requestedStage: "object" | "tile" | "rules" | "variants" };
  viewport: {
    centerX: number;
    centerY: number;
    zoom: number;
    gridStepMm: number;
  };
};
export type ProjectDocumentV5 = Omit<ProjectDocumentV4, "schemaVersion"> & { schemaVersion: 5 };
export type ProjectDocumentV3 = ProjectDocumentV4;
export const emptyGraph = (): GraphSnapshot => ({
  vertices: [],
  segments: [],
  chains: [],
  voids: [],
  constraints: [],
  fieldInputs: {},
});
export const dimensionCommand = (c: GraphCommand) =>
  [
    "setLength",
    "setAngle",
    "setOrientation",
    "releaseConstraint",
    "reconcile",
  ].includes(c.type);

// Derived runtime state; never part of ProjectDocumentV3.
export type CoincidentPair = {
  vertexIds: [string, string];
  x: number;
  y: number;
};
export type CandidateCollision = CoincidentPair;
export type VertexPlacementPreview = {
  point: Point;
  blockingVertexIds: string[];
  blocked: boolean;
};
export type DiagnosticSelection = {
  issueCode: string;
  segmentIds: string[];
  vertexIds: string[];
};

export type DeletionTarget =
  | { kind: "room"; topologyKey: string }
  | { kind: "void"; voidId: string };
export interface DeletionImpact {
  impactKey: string;
  segmentIds: string[];
  vertexIds: string[];
  retiredChainIds: string[];
  constraintIds: string[];
  voidIds: string[];
  affectedRoomKeys: string[];
  disappearedRoomKeys: string[];
}
export interface DeletionPreviewResponse {
  schemaVersion: 4;
  requestId: string;
  draftRevision: number;
  basisKey: string;
  target: DeletionTarget;
  status: "ready" | "invalid";
  impact: DeletionImpact | null;
  issues: GraphResponse["issues"];
}

export interface DeleteProjectIntent {
  projectId: string;
  expectedRevision: number;
  name: string;
  address: string;
  localRevision?: number;
  origin: 'list' | 'editor';
  requestId: string;
}
export type DeleteProjectOutcomeFor<D extends ProjectDocumentV5 | ProjectDocumentV6> =
  | { status: 'deleted' | 'alreadyMissing'; projectId: string; projects: D[] }
  | { status: 'conflict'; projectId: string; projects: D[]; current: D };
export type DeleteProjectOutcome = DeleteProjectOutcomeFor<ProjectDocumentV5>;
export type ProjectDeletionState = 'idle' | 'confirming' | 'deleting' | 'deleted' | 'failed' | 'conflict';
