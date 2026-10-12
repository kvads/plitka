import math
from shapely.geometry import Polygon, LineString
from .models import Geometry


def measurements(g):
    result = []
    fixed = {(x.wallId, x.kind): x for x in g.constraints if x.fixed}
    for c in [g.outer, *g.holes]:
        v = c.vertices
        for i, w in enumerate(c.walls):
            a, b = v[i], v[(i + 1) % len(v)]
            angle = None
            if c.closed or i + 2 < len(v):
                d = v[(i + 2) % len(v)]
                u = (b.x - a.x, b.y - a.y)
                z = (d.x - b.x, d.y - b.y)
                if math.hypot(*u) > 1e-10 and math.hypot(*z) > 1e-10:
                    turn = math.degrees(
                        math.atan2(u[0] * z[1] - u[1] * z[0], u[0] * z[0] + u[1] * z[1])
                    )
                    angle = 180 - (1 if c.winding == "ccw" else -1) * turn
            result.append(
                dict(
                    wallId=w.id,
                    length=math.hypot(b.x - a.x, b.y - a.y),
                    interiorAngle=angle,
                    orientation=math.degrees(math.atan2(b.y - a.y, b.x - a.x)) % 360,
                    lengthSource="entered" if (w.id, "length") in fixed else "derived",
                    angleSource="entered"
                    if (w.id, "interiorAngle") in fixed
                    else "derived",
                )
            )
    return result


def validate(g: Geometry):
    issues = []
    ms = measurements(g)
    index = {m["wallId"]: m for m in ms}
    incomplete = False
    polys = []

    def issue(code, message, c=None, walls=None, **extra):
        item = dict(
            code=code,
            message=message,
            wallIds=walls or [],
            vertexIds=[],
            constraintIds=[],
        )
        if c:
            item["contourId"] = c.id
        item.update(extra)
        issues.append(item)

    if g.fieldInputs:
        issue("INVALID_INPUT", "Исправьте введённые значения.")
        incomplete = True
    for c in [g.outer, *g.holes]:
        coords = [(v.x, v.y) for v in c.vertices]
        if not c.closed or len(set(coords)) < 3:
            issue(
                "OPEN_CONTOUR", "Замкните контур: нужны минимум три разные вершины.", c
            )
            incomplete = True
        if any(abs(x) > 100000 or abs(y) > 100000 for x, y in coords):
            issue(
                "COORDINATE_RANGE", "Координаты должны быть в пределах ±100 000 мм.", c
            )
        segs = []
        for i, w in enumerate(c.walls):
            a, b = coords[i], coords[(i + 1) % len(coords)]
            if math.dist(a, b) < 1e-9:
                issue("ZERO_LENGTH", "Стена имеет нулевую длину.", c, [w.id])
            segs.append(LineString([a, b]))
        for i, a in enumerate(segs):
            for j in range(i + 1, len(segs)):
                inter = a.intersection(segs[j])
                adjacent = j == i + 1 or (c.closed and i == 0 and j == len(segs) - 1)
                if not inter.is_empty and (not adjacent or inter.geom_type != "Point"):
                    issue(
                        "INTERSECTION",
                        "Стены пересекаются, накладываются или касаются.",
                        c,
                        [c.walls[i].id, c.walls[j].id],
                    )
        poly = Polygon(coords) if c.closed and len(coords) >= 3 else None
        if poly is not None:
            if not poly.is_valid or poly.area <= 0:
                issue(
                    "INVALID_POLYGON",
                    "Контур должен иметь ненулевую площадь и не пересекаться.",
                    c,
                    [w.id for w in c.walls],
                )
            elif (poly.exterior.is_ccw) != (c.winding == "ccw"):
                issue("WINDING", "Изменилось направление обхода контура.", c)
        polys.append(poly)
    shell = polys[0]
    for i, h in enumerate(polys[1:]):
        c = g.holes[i]
        if h is not None and h.is_valid and shell is not None and shell.is_valid:
            if not shell.contains(h) or shell.boundary.intersects(h):
                issue(
                    "HOLE_OUTSIDE",
                    "Отверстие должно быть строго внутри комнаты.",
                    c,
                    [w.id for w in c.walls],
                )
            for other in polys[1 : i + 1]:
                if other is not None and other.is_valid and h.intersects(other):
                    issue(
                        "HOLE_OVERLAP",
                        "Отверстия не должны пересекаться или касаться.",
                        c,
                        [w.id for w in c.walls],
                    )
    for con in g.constraints:
        if not con.fixed:
            continue
        m = index[con.wallId]
        expected = con.value
        invalid = (con.kind == "length" and expected <= 0) or (
            con.kind == "interiorAngle"
            and (expected <= 0 or expected >= 360 or expected == 180)
        )
        actual = m[
            {
                "length": "length",
                "interiorAngle": "interiorAngle",
                "firstWallOrientation": "orientation",
            }[con.kind]
        ]
        if invalid:
            issue(
                "INVALID_DIMENSION",
                "Недопустимый размер: длина > 0, угол между 0° и 360°, кроме 180°.",
                walls=[con.wallId],
                constraintIds=[con.id],
            )
            continue
        if actual is None:
            issue(
                "ANGLE_UNDEFINED",
                "Для угла нужна следующая стена.",
                walls=[con.wallId],
                constraintIds=[con.id],
            )
            continue
        delta = (
            abs(actual - expected)
            if con.kind != "firstWallOrientation"
            else abs((actual - expected + 180) % 360 - 180)
        )
        if delta > 0.1:
            issue(
                "DIMENSION_MISMATCH",
                "Заданный размер не соответствует форме.",
                walls=[con.wallId],
                constraintIds=[con.id],
                expected=expected,
                actual=actual,
                deviation=delta,
                unit="мм" if con.kind == "length" else "°",
            )
    status = (
        "incomplete"
        if incomplete
        else (
            "constraint_conflict"
            if any(
                x["code"]
                in ["INVALID_DIMENSION", "DIMENSION_MISMATCH", "ANGLE_UNDEFINED"]
                for x in issues
            )
            else "invalid_topology"
        )
        if issues
        else "valid"
    )
    area = shell.area - sum(h.area for h in polys[1:]) if status == "valid" else None
    gap = (
        math.dist(
            (g.outer.vertices[0].x, g.outer.vertices[0].y),
            (g.outer.vertices[-1].x, g.outer.vertices[-1].y),
        )
        if g.outer.vertices and not g.outer.closed
        else 0
    )
    return dict(
        status=status, issues=issues, measurements=ms, areaMm2=area, closureGapMm=gap
    )
