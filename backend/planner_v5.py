"""Canonical 0.1 mm layout calculation; legacy planner responses remain unchanged."""
from __future__ import annotations

import math
import numpy as np
import shapely
from shapely.affinity import rotate
from shapely.geometry import Polygon, MultiPolygon
from shapely.ops import unary_union

from .planner import EPS, dominates, features, objectives, prepare, rings


def tenth(value: float) -> float:
    return math.copysign(math.floor(abs(value) * 10 + 0.5), value) / 10


def valid_tenth(value: float) -> bool:
    scaled = value * 10
    return math.isfinite(value) and math.isclose(scaled, round(scaled),
        rel_tol=0, abs_tol=math.ulp(scaled) * 8)


def validate_input(project) -> None:
    values = [project.tile, project.grout, project.gap, project.threshold,
              project.angle, project.offset_x, project.offset_y]
    values.extend(v for point in project.outline for v in point)
    values.extend(v for hole in project.holes for point in hole for v in point)
    if not all(valid_tenth(value) for value in values):
        raise ValueError('Допустим не более одного знака после запятой.')


def offset_ticks(value: float, period: float) -> int:
    ticks = int(math.copysign(math.floor(abs(value) * 10 + 0.5), value))
    period_ticks = math.floor(period * 10 + 0.5)
    if period_ticks <= 0:
        raise ValueError('Шаг плитки с швом должен быть положительным.')
    return ticks % period_ticks


def _polys(geometry):
    if geometry.is_empty:
        return []
    if geometry.geom_type == 'Polygon':
        return [geometry] if geometry.area > 0 else []
    return [poly for part in getattr(geometry, 'geoms', []) for poly in _polys(part)]


def _snap_ring(coords):
    points = [(tenth(x), tenth(y)) for x, y in coords]
    return points


def _snap_polygon(poly):
    snapped = Polygon(_snap_ring(poly.exterior.coords),
                      [_snap_ring(ring.coords) for ring in poly.interiors])
    if snapped.is_empty or snapped.area <= 0 or not snapped.is_valid:
        raise ValueError('После округления фрагмент плитки потерял пригодный контур.')
    return snapped


def _snap_geometry(geometry):
    original = _polys(geometry)
    if not original:
        raise ValueError('После округления область укладки не имеет площади.')
    snapped = [_snap_polygon(poly) for poly in original]
    result = snapped[0] if len(snapped) == 1 else MultiPolygon(snapped)
    if not result.is_valid or len(_polys(result)) != len(original):
        raise ValueError('После округления область изменила число фрагментов или перекрылась.')
    return result


def _area(value: float, label: str, *, allow_zero: bool = False) -> float:
    if value < -1e-8:
        raise ValueError(f'{label}: отрицательная площадь после округления.')
    value = max(value, 0)
    rounded = tenth(value)
    if value > 0 and rounded == 0:
        raise ValueError(f'{label}: положительная площадь меньше шага отображения.')
    if not allow_zero and rounded == 0:
        raise ValueError(f'{label}: нет пригодной площади.')
    return rounded


def _canonical_region(project, region):
    room = _snap_geometry(Polygon(project.outline, project.holes))
    area = _area(room.area, 'Помещение')
    canonical = _snap_geometry(region)
    _area(canonical.area, 'Область укладки')
    if not room.covers(canonical):
        raise ValueError('Область укладки выходит за границы помещения.')
    return room, canonical, area


def calculate_v5(project, dx: float, dy: float, *, detail: bool = True):
    validate_input(project)
    try:
        region, local = prepare(project)
    except ValueError as exc:
        raise ValueError('Некорректная область помещения или параметры раскладки.') from exc
    room, canonical_region, room_area = _canonical_region(project, region)
    step = project.tile + project.grout
    dx = offset_ticks(dx, step) / 10
    dy = offset_ticks(dy, step) / 10
    x0, y0, x1, y1 = local.bounds
    xs = np.arange(math.floor((x0-dx)/step), math.ceil((x1-dx)/step)) * step + dx
    ys = np.arange(math.floor((y0-dy)/step), math.ceil((y1-dy)/step)) * step + dy
    xx, yy = np.meshgrid(xs, ys)
    cells = shapely.box(xx.ravel(), yy.ravel(), xx.ravel()+project.tile, yy.ravel()+project.tile)
    clipped = shapely.intersection(cells, local)
    parts = []
    polygons = []
    full = cuts = warnings = fragments = tiles = 0
    min_width = project.tile
    for index, geometry in enumerate(clipped):
        source_parts = _polys(geometry)
        if not source_parts:
            continue
        canonical_parts = []
        for sub, source in enumerate(source_parts):
            world = rotate(source, project.angle, origin=(0, 0))
            poly = _snap_polygon(world)
            _area(poly.area, 'Фрагмент плитки')
            if not canonical_region.covers(poly):
                raise ValueError('После округления фрагмент выходит за область укладки.')
            canonical_parts.append((sub, poly))
        whole = len(canonical_parts) == 1 and math.isclose(
            canonical_parts[0][1].area, project.tile ** 2, rel_tol=0, abs_tol=1e-7)
        tiles += 1
        full += int(whole)
        cuts += int(not whole)
        for sub, poly in canonical_parts:
            polygons.append(poly)
            fragments += 1
            width, issues = (project.tile, []) if whole else features(poly, project)
            if not whole:
                min_width = min(min_width, width)
            warnings += int(bool(issues))
            if detail:
                center = poly.representative_point()
                bx0, by0, bx1, by1 = poly.bounds
                parts.append({'id': f'{index+1}' + (f'.{sub+1}' if len(source_parts)>1 else ''),
                    'source': index+1, 'rings': rings(poly),
                    'center': [tenth(center.x), tenth(center.y)],
                    'width': tenth(bx1-bx0), 'height': tenth(by1-by0),
                    'min_width': tenth(width), 'area': _area(poly.area, 'Фрагмент плитки'),
                    'full': whole, 'issues': issues})
    if not polygons:
        raise ValueError('В выбранном смещении не осталось пригодных фрагментов.')
    covered = unary_union(polygons)
    if sum(poly.area for poly in polygons) - covered.area > 1e-7:
        raise ValueError('После округления фрагменты плитки накладываются друг на друга.')
    used = _area(covered.area, 'Покрытая площадь')
    laying = _area(canonical_region.area, 'Область укладки')
    grout = _area(canonical_region.area - covered.area, 'Площадь швов', allow_zero=True)
    purchased = tiles * project.tile**2
    waste = _area(purchased - covered.area, 'Площадь отходов', allow_zero=True)
    symmetry = None
    if len(_polys(local)) == 1 and not local.interiors and abs(local.area-shapely.box(*local.bounds).area)<EPS:
        def opposite(lo, hi, offset):
            left = max(0, project.tile-((lo-offset) % step))
            right = (hi-offset) % step
            right = min(project.tile, right) if right > EPS else project.tile
            return abs(left-right)
        symmetry = tenth((opposite(x0,x1,dx)+opposite(y0,y1,dy))/2)
    metrics = {'tiles': tiles, 'full': full, 'cut': cuts, 'fragments': fragments,
        'warnings': warnings, 'min_width': tenth(min_width), 'symmetry': symmetry,
        'room_area': room_area, 'laying_area': laying, 'covered_area': used,
        'grout_area': grout, 'waste_area': waste,
        'waste_percent': tenth(100 * waste / purchased) if purchased else 0}
    return {'offset_x': dx, 'offset_y': dy, 'angle': tenth(project.angle),
        'metrics': metrics, 'parts': parts,
        'region': [rings(poly) for poly in _polys(canonical_region)] if detail else []}


def optimize_v5(project):
    validate_input(project)
    try:
        _, local = prepare(project)
    except ValueError as exc:
        raise ValueError('Некорректная область помещения или параметры раскладки.') from exc
    step = project.tile + project.grout
    x0, y0, x1, y1 = local.bounds
    offsets_x = {i*step/8 for i in range(8)} | {((x0+x1-project.tile)/2) % step, ((x0+x1-project.tile)/2+step/2) % step, x0 % step}
    offsets_y = {i*step/8 for i in range(8)} | {((y0+y1-project.tile)/2) % step, ((y0+y1-project.tile)/2+step/2) % step, y0 % step}
    found = {}
    reasons = []
    def evaluate(dx, dy):
        key = (offset_ticks(dx, step), offset_ticks(dy, step))
        if key in found:
            return
        try:
            found[key] = calculate_v5(project, key[0]/10, key[1]/10, detail=False)
        except ValueError as exc:
            found[key] = None
            reasons.append(str(exc))
    for dx in sorted(offsets_x):
        for dy in sorted(offsets_y):
            evaluate(dx, dy)
    values = [v for v in found.values() if v is not None]
    seeds = sorted(values, key=objectives)[:3]
    for seed in seeds:
        for sx in (-step/32, 0, step/32):
            for sy in (-step/32, 0, step/32):
                evaluate(seed['offset_x']+sx, seed['offset_y']+sy)
    values = [v for v in found.values() if v is not None]
    if not values:
        raise ValueError(reasons[0] if reasons else 'Нет пригодных вариантов раскладки.')
    frontier = [v for v in values if not any(dominates(w,v) for w in values)]
    selections = []
    criteria = [('Широкие подрезки', lambda v:(v['metrics']['warnings'],-v['metrics']['min_width'])),
        ('Меньше подрезок', lambda v:(v['metrics']['warnings'],v['metrics']['cut'])),
        ('Меньше материала', lambda v:(v['metrics']['warnings'],v['metrics']['tiles']))]
    if values[0]['metrics']['symmetry'] is not None:
        criteria.insert(1,('Баланс краёв',lambda v:(v['metrics']['warnings'],v['metrics']['symmetry'])))
    for title, key in criteria:
        for value in sorted(frontier,key=lambda v:(key(v),objectives(v))):
            if not any(all(min(abs(value[k]-s[k]),step-abs(value[k]-s[k])) < step/16 for k in ('offset_x','offset_y')) for s in selections):
                selections.append({**value, 'title': title})
                break
    if not selections:
        selections = [{**min(values,key=objectives),'title':'Компромисс'}]
    result = [{**calculate_v5(project, value['offset_x'], value['offset_y']), 'title':value['title']} for value in selections]
    return {'variants':result, 'evaluated':len(values), 'pareto_count':len(frontier),
        'note':'Приближённый поиск с уточнением; точный глобальный оптимум не гарантируется. Все границы равнозначны. Узкие перешейки сложных деталей требуют ручной проверки.'}
