"""Physical wall graph contract for the v5 geometry API."""

from typing import Annotated, Literal

from pydantic import Field, model_validator

from .models import Model


Id = Annotated[str, Field(min_length=1, max_length=100)]


class PhysicalPoint(Model):
    x: float
    y: float


class PhysicalWallV5(Model):
    id: Id
    drawnEdge: list[PhysicalPoint] = Field(min_length=2, max_length=2)
    side: Literal["left", "right"]
    thicknessMm: float = Field(gt=0, le=100000)
    corners: list[PhysicalPoint] = Field(min_length=4, max_length=4)


class JunctionParticipantV5(Model):
    wallId: Id
    edge: Literal["drawn", "opposite", "startCap", "endCap"]
    point: PhysicalPoint
    attachment: Literal["end", "interior"]


class WallJunctionV5(Model):
    id: Id
    participants: list[JunctionParticipantV5] = Field(min_length=2, max_length=6300)

    @model_validator(mode="after")
    def unique_walls(self):
        ids = [part.wallId for part in self.participants]
        if len(ids) != len(set(ids)):
            raise ValueError("Стена может участвовать в стыке только один раз.")
        return self


class DoorOpeningV5(Model):
    id: Id
    wallId: Id
    offsetMm: float = Field(ge=0, le=10000000)
    widthMm: float = Field(ge=300, le=3000)
    # Distance from the wall's drawn edge to the door-frame plane.  None keeps
    # legacy openings centred and lets them follow later wall-thickness edits.
    revealDepthMm: float | None = Field(default=None, ge=0, le=100000)


class PhysicalGraphV5(Model):
    walls: list[PhysicalWallV5] = Field(max_length=6300)
    junctions: list[WallJunctionV5] = Field(max_length=12600)
    openings: list[DoorOpeningV5] = Field(default_factory=list, max_length=6300)

    @model_validator(mode="after")
    def references(self):
        wall_ids = [wall.id for wall in self.walls]
        junction_ids = [joint.id for joint in self.junctions]
        opening_ids = [opening.id for opening in self.openings]
        all_ids = wall_ids + junction_ids + opening_ids
        if len(all_ids) != len(set(all_ids)):
            raise ValueError("Повтор идентификатора стены, стыка или дверного проёма.")
        known = set(wall_ids)
        if any(part.wallId not in known for joint in self.junctions for part in joint.participants):
            raise ValueError("Стык ссылается на отсутствующую стену.")
        if any(opening.wallId not in known for opening in self.openings):
            raise ValueError("Дверной проём ссылается на отсутствующую стену.")
        return self
