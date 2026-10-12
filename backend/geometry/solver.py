import math
import uuid
import numpy as np
from scipy.optimize import least_squares
from .validation import validate, measurements


def construct_chains(g, anchors, orientation_holds):
    """Construct fully specified chains exactly; leave other contours to TRF.

    Rotations/translations preserve the operation's hard anchors. No grid snapping
    or topology repair is applied. A proven closure conflict is kept distinct
    from failure of a numerical search.
    """
    candidate = g.model_copy(deep=True)
    fixed = {(x.wallId, x.kind): x.value for x in g.constraints if x.fixed}
    constructed = False
    for c in [candidate.outer, *candidate.holes]:
        n = len(c.walls)
        if not n or not all((w.id, "length") in fixed for w in c.walls):
            continue
        if not all((w.id, "interiorAngle") in fixed for w in c.walls[:-1]):
            continue
        # A closed chain also needs its final angle to prove incompatibility.
        if c.closed and (c.walls[-1].id, "interiorAngle") not in fixed:
            continue
        points = [(0.0, 0.0)]
        direction = 0.0
        for i, w in enumerate(c.walls):
            x, y = points[-1]
            length = fixed[w.id, "length"]
            points.append(
                (x + length * math.cos(direction), y + length * math.sin(direction))
            )
            if i < n - 1:
                direction += math.radians(
                    (1 if c.winding == "ccw" else -1)
                    * (180 - fixed[w.id, "interiorAngle"])
                )
        if c.closed and math.hypot(*points[-1]) > 0.1:
            return None, True
        points = points[: len(c.vertices)]
        # Prefer the operation's incoming wall, then the explicit orientation.
        held = next(
            (h for h in orientation_holds if any(v.id == h[0] for v in c.vertices)),
            None,
        )
        ai = next((i for i, v in enumerate(c.vertices) if v.id in anchors), 0)
        wi = ai if ai < n else 0
        if held:
            wi = next(i for i, v in enumerate(c.vertices) if v.id == held[0])
            target_angle = held[2]
        elif (c.walls[0].id, "firstWallOrientation") in fixed:
            wi = 0
            target_angle = math.radians(fixed[c.walls[0].id, "firstWallOrientation"])
        else:
            a, b = c.vertices[wi], c.vertices[(wi + 1) % len(c.vertices)]
            target_angle = math.atan2(b.y - a.y, b.x - a.x)
        a, b = points[wi], points[(wi + 1) % len(points)]
        rotation = target_angle - math.atan2(b[1] - a[1], b[0] - a[0])
        co, si = math.cos(rotation), math.sin(rotation)
        rotated = [(x * co - y * si, x * si + y * co) for x, y in points]
        target = anchors.get(c.vertices[ai].id, (c.vertices[ai].x, c.vertices[ai].y))
        dx, dy = target[0] - rotated[ai][0], target[1] - rotated[ai][1]
        for v, (x, y) in zip(c.vertices, rotated):
            v.x, v.y = x + dx, y + dy
        if any(
            v.id in anchors and math.dist((v.x, v.y), anchors[v.id]) > 0.0001
            for v in c.vertices
        ):
            return None, False
        constructed = True
    if not constructed:
        return None, False
    report = validate(candidate)
    if report["status"] == "valid" or (
        report["status"] == "incomplete"
        and all(i["code"] == "OPEN_CONTOUR" for i in report["issues"])
    ):
        return candidate, False
    return None, False


def solve(original, op):
    g = original.model_copy(deep=True)
    contours = [g.outer, *g.holes]
    vertices = {v.id: v for c in contours for v in c.vertices}
    walls = {w.id: (c, i, w) for c in contours for i, w in enumerate(c.walls)}
    anchors = {}
    if op.type == "releaseConstraint":
        found = next((c for c in g.constraints if c.id == op.constraintId), None)
        if found is None:
            raise ValueError("Условие не найдено")
        found.fixed = False
    elif op.type == "moveVertex":
        if op.vertexId not in vertices or op.x is None or op.y is None:
            raise ValueError("Вершина не найдена")
        anchors[op.vertexId] = (op.x, op.y)
    elif op.type in ("setLength", "setInteriorAngle", "setOrientation"):
        if op.type == "setOrientation":
            c = next((c for c in contours if c.id == op.contourId), None)
            if c is None or not c.walls:
                raise ValueError("Контур не найден")
            key = c.walls[0].id
        else:
            key = op.wallId
        if key not in walls or op.value is None:
            raise ValueError("Стена или значение отсутствует")
        c, i, w = walls[key]
        a, b = vertices[w.startVertexId], vertices[w.endVertexId]
        kind = {
            "setLength": "length",
            "setInteriorAngle": "interiorAngle",
            "setOrientation": "firstWallOrientation",
        }[op.type]
        found = next(
            (x for x in g.constraints if x.wallId == key and x.kind == kind), None
        )
        if found:
            found.value = op.value
            found.fixed = True
        else:
            from .models import Constraint

            g.constraints.append(
                Constraint(
                    id=str(uuid.uuid4()),
                    kind=kind,
                    wallId=key,
                    value=op.value,
                    fixed=True,
                )
            )
        length = math.hypot(b.x - a.x, b.y - a.y)
        if op.type == "setLength" and length > 1e-10 and op.value > 0:
            anchors[a.id] = (a.x, a.y)
            anchors[b.id] = (
                a.x + (b.x - a.x) * op.value / length,
                a.y + (b.y - a.y) * op.value / length,
            )
        elif op.type == "setOrientation":
            anchors[a.id] = (a.x, a.y)
        elif op.type == "setInteriorAngle":
            # Fix incoming direction exactly, while its length remains free unless constrained.
            anchors[b.id] = (b.x, b.y)
    else:
        if op.type != "reconcile":
            raise ValueError("Неизвестная операция")
    invalid = validate(g)
    if g.fieldInputs or any(
        x["code"]
        in ("INVALID_DIMENSION", "COORDINATE_RANGE", "ANGLE_UNDEFINED", "ZERO_LENGTH")
        for x in invalid["issues"]
    ):
        return g, invalid, []
    # Remove rigid translation/rotation for contours with no operation anchor.
    orientation_holds = []
    for c in contours:
        if not c.walls:
            continue
        a, b = c.vertices[:2]
        if not any(v.id in anchors for v in c.vertices):
            anchors[a.id] = (a.x, a.y)
            if not any(
                x.fixed
                and x.kind == "firstWallOrientation"
                and x.wallId == c.walls[0].id
                for x in g.constraints
            ):
                orientation_holds.append((a.id, b.id, math.atan2(b.y - a.y, b.x - a.x)))
    if op.type == "setInteriorAngle":
        c, i, w = walls[op.wallId]
        a, b = vertices[w.startVertexId], vertices[w.endVertexId]
        orientation_holds.append((a.id, b.id, math.atan2(b.y - a.y, b.x - a.x)))
    for key, (x, y) in anchors.items():
        vertices[key].x = x
        vertices[key].y = y
    direct, conflict = construct_chains(g, anchors, orientation_holds)
    if conflict:
        report = validate(g)
        report["status"] = "constraint_conflict"
        report["issues"].insert(
            0,
            dict(
                code="CHAIN_CLOSURE_CONFLICT",
                message="Заданные длины и углы не замыкают контур. Снимите фиксацию или исправьте размер.",
                wallIds=[x.wallId for x in g.constraints if x.fixed],
                vertexIds=[],
                constraintIds=[x.id for x in g.constraints if x.fixed],
            ),
        )
        return g, report, []
    if direct is not None:
        report = validate(direct)
        old = {m["wallId"]: m for m in measurements(original)}
        return (
            direct,
            report,
            [m["wallId"] for m in report["measurements"] if m != old.get(m["wallId"])],
        )
    free = sorted(k for k in vertices if k not in anchors)

    def put(x):
        for i, k in enumerate(free):
            vertices[k].x = float(x[2 * i])
            vertices[k].y = float(x[2 * i + 1])

    def residual(x):
        put(x)
        index = {m["wallId"]: m for m in measurements(g)}
        out = []
        for con in g.constraints:
            if not con.fixed:
                continue
            m = index[con.wallId]
            kind = {
                "length": "length",
                "interiorAngle": "interiorAngle",
                "firstWallOrientation": "orientation",
            }[con.kind]
            actual = m[kind]
            delta = (actual - con.value) if actual is not None else 180
            if kind == "orientation":
                delta = (delta + 180) % 360 - 180
            out.append(delta / (1000 if kind == "length" else 1))
        for a, b, angle in orientation_holds:
            va, vb = vertices[a], vertices[b]
            delta = math.atan2(vb.y - va.y, vb.x - va.x) - angle
            out.append(math.degrees(math.atan2(math.sin(delta), math.cos(delta))))
        return np.array(out)

    candidate = g.model_copy(deep=True)
    if free:
        x = np.array([z for k in free for z in (vertices[k].x, vertices[k].y)])
        if len(residual(x)):
            result = least_squares(
                residual,
                x,
                method="trf",
                loss="linear",
                bounds=(-100000, 100000),
                max_nfev=200,
                ftol=1e-12,
                xtol=1e-12,
                gtol=1e-12,
            )
            put(result.x)
    report = validate(g)
    for a, b, angle in orientation_holds:
        va, vb = vertices[a], vertices[b]
        actual = math.atan2(vb.y - va.y, vb.x - va.x)
        delta = abs(
            math.degrees(math.atan2(math.sin(actual - angle), math.cos(actual - angle)))
        )
        if delta > 0.1:
            report["status"] = "unresolved"
            report["issues"].append(
                dict(
                    code="ANCHOR_DIRECTION",
                    message="Не удалось сохранить направление опорной стены.",
                    wallIds=[],
                    vertexIds=[a, b],
                    constraintIds=[],
                )
            )
    if report["status"] not in ("valid", "incomplete") or any(
        i["code"] != "OPEN_CONTOUR" for i in report["issues"]
    ):
        report["status"] = "unresolved"
        report["issues"].insert(
            0,
            dict(
                code="UNRESOLVED",
                message="Не удалось найти согласованную форму; проверьте размеры или снимите фиксацию.",
                wallIds=[c.wallId for c in g.constraints if c.fixed],
                vertexIds=[],
                constraintIds=[],
            ),
        )
        return candidate, report, []
    old = {m["wallId"]: m for m in measurements(original)}
    changed = [m["wallId"] for m in report["measurements"] if m != old.get(m["wallId"])]
    return g, report, changed
