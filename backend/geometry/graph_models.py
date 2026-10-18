"""Versioned planar graph contract. Invalid measurements are valid drafts."""
from typing import Annotated, Literal
from pydantic import Field, model_validator
from .models import Model, Vertex
from .precision import assert_graph_precision, is_tenth

Id = Annotated[str, Field(min_length=1, max_length=100)]

class Segment(Model):
    id: Id
    startVertexId: Id
    endVertexId: Id
    chainId: Id

class WallChain(Model):
    id: Id
    startVertexId: Id
    endVertexId: Id
    segmentIds: list[Id] = Field(min_length=1, max_length=6300)
    thicknessMm: float = Field(gt=0, allow_inf_nan=False)

class DirectedRef(Model):
    segmentId: Id
    forward: bool

class Void(Model):
    id: Id
    boundary: list[DirectedRef] = Field(max_length=6300)

class Range(Model):
    startVertexId: Id
    endVertexId: Id

class Target(Model):
    segmentId: Id | None = None
    chainId: Id | None = None
    range: Range | None = None
    vertexId: Id | None = None
    firstSegmentId: Id | None = None
    secondSegmentId: Id | None = None
    sector: Literal['cw','ccw'] | None = None
    originalConstraint: dict | None = None
    reason: str | None = Field(default=None, max_length=1000)

class DimensionConstraint(Model):
    id: Id
    kind: Literal['segmentLength','chainLength','angle','orientation','legacyUnbound']
    target: Target
    value: float
    fixed: bool

    @model_validator(mode='after')
    def target_shape(self):
        required = {'segmentLength': {'segmentId'}, 'chainLength': {'chainId'}, 'orientation': {'chainId'}, 'angle': {'vertexId','firstSegmentId','secondSegmentId','sector'}, 'legacyUnbound': {'originalConstraint','reason'}}[self.kind]
        present = {k for k,v in self.target.model_dump().items() if v is not None}
        if not required <= present or present - required - ({'range'} if self.kind=='chainLength' else set()):
            raise ValueError('Неверная цель размерного условия')
        return self

class GraphSnapshot(Model):
    vertices: list[Vertex] = Field(max_length=2100)
    segments: list[Segment] = Field(max_length=6300)
    chains: list[WallChain] = Field(max_length=6300)
    voids: list[Void] = Field(max_length=20)
    constraints: list[DimensionConstraint] = Field(max_length=12600)
    fieldInputs: dict[str, Annotated[str, Field(max_length=100)]]

    @model_validator(mode='after')
    def references(self):
        all_items = [*self.vertices,*self.segments,*self.chains,*self.voids,*self.constraints]
        if len({x.id for x in all_items}) != len(all_items):
            raise ValueError('Повтор ID внутри снимка')
        vs={v.id:v for v in self.vertices}; ss={s.id:s for s in self.segments}; cs={c.id:c for c in self.chains}
        for s in self.segments:
            if s.startVertexId not in vs or s.endVertexId not in vs or s.startVertexId==s.endVertexId or s.chainId not in cs:
                raise ValueError('Неверная ссылка участка')
        used=[]
        for c in self.chains:
            if c.startVertexId not in vs or c.endVertexId not in vs: raise ValueError('Неверные концы стены')
            previous=c.startVertexId
            for sid in c.segmentIds:
                if sid not in ss or ss[sid].chainId!=c.id or ss[sid].startVertexId!=previous: raise ValueError('Неверный порядок цепи')
                previous=ss[sid].endVertexId; used.append(sid)
            if previous!=c.endVertexId: raise ValueError('Неверный конец цепи')
        if len(used)!=len(set(used)) or set(used)!=set(ss): raise ValueError('Участок должен принадлежать одной цепи')
        for void in self.voids:
            if any(ref.segmentId not in ss for ref in void.boundary): raise ValueError('Неверная ссылка отверстия')
        targets=set()
        for c in self.constraints:
            t=c.target
            if t.segmentId and t.segmentId not in ss or t.chainId and t.chainId not in cs: raise ValueError('Неверная ссылка условия')
            if c.kind=='angle':
                if t.vertexId not in vs or t.firstSegmentId==t.secondSegmentId: raise ValueError('Неверный угол')
                for sid in [t.firstSegmentId,t.secondSegmentId]:
                    if sid not in ss or t.vertexId not in [ss[sid].startVertexId,ss[sid].endVertexId]: raise ValueError('Лучи должны иметь общий узел')
            if t.range:
                ch=cs[t.chainId]; ordered=[ch.startVertexId]+[ss[x].endVertexId for x in ch.segmentIds]
                if t.range.startVertexId not in ordered or t.range.endVertexId not in ordered or ordered.index(t.range.startVertexId)>=ordered.index(t.range.endVertexId): raise ValueError('Неверный диапазон цепи')
            key=(c.kind,t.model_dump_json())
            if key in targets: raise ValueError('Повтор условия')
            targets.add(key)
        return self

class Point(Model):
    x: float
    y: float
class AddVertex(Model):
    type: Literal['addVertex']
    point: Point
class VertexDestination(Model):
    vertexId: Id
class WallDestination(Model):
    segmentId: Id
    point: Point
class Connect(Model):
    type: Literal['connect']
    fromVertexId: Id
    to: VertexDestination | WallDestination
    thicknessMm: float = Field(gt=0, allow_inf_nan=False)
class DrawWall(Model):
    type: Literal['drawWall']
    start: Point
    end: Point
    thicknessMm: float = Field(gt=0, allow_inf_nan=False)
class SetWallThickness(Model):
    type: Literal['setWallThickness']
    chainId: Id
    thicknessMm: float = Field(gt=0, allow_inf_nan=False)
class MoveVertex(Model):
    type: Literal['moveVertex']
    vertexId: Id
    point: Point
class NudgeWallHandle(Model):
    type: Literal['nudgeWallHandle']
    chainId: Id
    handle: Literal['start','center','end']
    axis: Literal['x','y']
    direction: Literal[-1,1]
class LengthTarget(Model):
    kind: Literal['segment','chain']
    id: Id
    range: Range | None = None
class SetLength(Model):
    type: Literal['setLength']
    constraintId: Id
    target: LengthTarget
    value: float
class SetAngle(Model):
    type: Literal['setAngle']
    constraintId: Id
    vertexId: Id
    firstSegmentId: Id
    secondSegmentId: Id
    sector: Literal['cw','ccw']
    value: float
class SetOrientation(Model):
    type: Literal['setOrientation']
    constraintId: Id
    chainId: Id
    value: float
class ReleaseConstraint(Model):
    type: Literal['releaseConstraint']
    constraintId: Id
class DeleteElements(Model):
    type: Literal['deleteElements']
    vertexIds: list[Id] = Field(max_length=2100)
    segmentIds: list[Id] = Field(max_length=6300)
    acknowledgedConstraintIds: list[Id] = Field(max_length=12600)
class DeleteRoom(Model):
    type: Literal['deleteRoom']
    topologyKey: str = Field(min_length=1,max_length=100000)
    impactKey: str = Field(min_length=1,max_length=100)
class DeleteVoid(Model):
    type: Literal['deleteVoid']
    voidId: Id
    impactKey: str = Field(min_length=1,max_length=100)
class DeleteConstraint(Model):
    type: Literal['deleteConstraint']
    constraintId: Id
class MarkVoid(Model):
    type: Literal['markVoid']
    boundary: list[DirectedRef] = Field(max_length=6300)
class UnmarkVoid(Model):
    type: Literal['unmarkVoid']
    voidId: Id
class AddTemplate(Model):
    type: Literal['addTemplate']
    shape: Literal['rectangle','lShape']
    origin: Point
    width: float = Field(gt=0,le=200000)
    height: float = Field(gt=0,le=200000)
    notchWidth: float | None = Field(default=None,gt=0)
    notchHeight: float | None = Field(default=None,gt=0)
    thicknessMm: float = Field(gt=0, allow_inf_nan=False)
class Reconcile(Model):
    type: Literal['reconcile']
Command = Annotated[AddVertex|Connect|DrawWall|SetWallThickness|MoveVertex|NudgeWallHandle|SetLength|SetAngle|SetOrientation|ReleaseConstraint|DeleteElements|DeleteRoom|DeleteVoid|DeleteConstraint|MarkVoid|UnmarkVoid|AddTemplate|Reconcile, Field(discriminator='type')]
class ValidateRequest(Model):
    schemaVersion: Literal[4]
    requestId: Id
    draftRevision: int = Field(ge=0)
    basisKey: str = Field(max_length=2000000)
    graph: GraphSnapshot
    selectedRoomKey: str | None = Field(default=None,max_length=100000)

    @model_validator(mode='after')
    def decimal_precision(self):
        assert_graph_precision(self.graph.model_dump(exclude_none=True))
        return self
class CommandRequest(Model):
    schemaVersion: Literal[4]
    commandId: Id
    draftRevision: int = Field(ge=0)
    basisKey: str = Field(max_length=2000000)
    graph: GraphSnapshot
    command: Command
    selectedRoomKey: str | None = Field(default=None,max_length=100000)

    @model_validator(mode='after')
    def decimal_precision(self):
        assert_graph_precision(self.graph.model_dump(exclude_none=True))
        def values(item):
            if isinstance(item, dict):
                for value in item.values():
                    yield from values(value)
            elif isinstance(item, list):
                for value in item:
                    yield from values(value)
            elif isinstance(item, float):
                yield item
        if not all(is_tenth(value) for value in values(self.command.model_dump(exclude_none=True))):
            raise ValueError('Допустим не более одного знака после запятой.')
        return self

class Issue(Model):
    code: str
    message: str
    entityIds: list[Id]
    fieldKey: str | None = None
    scope: Literal['global','component','room']
    affectedRoomKeys: list[str]

class Measurement(Model):
    key: str
    kind: Literal['segmentLength','chainLength','angle','orientation','legacyUnbound']
    target: Target
    value: float | None
    source: Literal['entered','derived']

class PolygonData(Model):
    outline: list[list[float]]
    holes: list[list[list[float]]]

class FaceValidation(Model):
    valid: bool
    issues: list[Issue]

class FaceCandidate(Model):
    topologyKey: str
    outer: list[DirectedRef]
    holes: list[list[DirectedRef]]
    axisPolygon: PolygonData
    polygon: PolygonData | None
    areaMm2: float | None
    dependencyIds: list[Id]
    dependencyKey: str
    geometryKey: str
    measurementKey: str
    validation: FaceValidation

class GraphResponse(Model):
    schemaVersion: Literal[4]
    requestId: Id | None = None
    commandId: Id | None = None
    draftRevision: int
    basisKey: str
    status: Literal['valid','invalid','unresolved','applied']
    graph: GraphSnapshot
    wallArea: list[PolygonData]
    faces: list[FaceCandidate]
    measurements: list[Measurement]
    issues: list[Issue]
    splitMap: dict[str,list[Id]] | None = None
    addedIds: list[Id] | None = None
    removedIds: list[Id] | None = None
    affectedChainIds: list[Id] | None = None

class RoomDeletionTarget(Model):
    kind: Literal['room']
    topologyKey: str = Field(min_length=1,max_length=100000)
class VoidDeletionTarget(Model):
    kind: Literal['void']
    voidId: Id
DeletionTarget = Annotated[RoomDeletionTarget|VoidDeletionTarget, Field(discriminator='kind')]
class DeletionPreviewRequest(Model):
    schemaVersion: Literal[4]
    requestId: Id
    draftRevision: int = Field(ge=0)
    basisKey: str = Field(max_length=2000000)
    graph: GraphSnapshot
    target: DeletionTarget
class DeletionImpact(Model):
    impactKey: str
    segmentIds: list[Id]
    vertexIds: list[Id]
    retiredChainIds: list[Id]
    constraintIds: list[Id]
    voidIds: list[Id]
    affectedRoomKeys: list[str]
    disappearedRoomKeys: list[str]
class DeletionPreviewResponse(Model):
    schemaVersion: Literal[4]
    requestId: Id
    draftRevision: int
    basisKey: str
    target: DeletionTarget
    status: Literal['ready','invalid']
    impact: DeletionImpact | None
    issues: list[Issue]
