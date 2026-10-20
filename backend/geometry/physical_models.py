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


class PhysicalGraphV5(Model):
    walls: list[PhysicalWallV5] = Field(max_length=6300)
    junctions: list[WallJunctionV5] = Field(max_length=12600)

    @model_validator(mode="after")
    def references(self):
        wall_ids = [wall.id for wall in self.walls]
        junction_ids = [joint.id for joint in self.junctions]
        if len(wall_ids) != len(set(wall_ids)) or len(junction_ids) != len(set(junction_ids)):
            raise ValueError("Повтор идентификатора стены или стыка.")
        known = set(wall_ids)
        if any(part.wallId not in known for joint in self.junctions for part in joint.participants):
            raise ValueError("Стык ссылается на отсутствующую стену.")
        if known.intersection(junction_ids):
            raise ValueError("Идентификатор стыка совпадает с идентификатором стены.")
        return self
