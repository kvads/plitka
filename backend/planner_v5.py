"""Canonical 0.1 mm layout calculation; legacy planner responses remain unchanged."""
from __future__ import annotations

import math
import numpy as np
import shapely
from shapely.affinity import rotate, translate
from shapely.geometry import Polygon, MultiPolygon, box
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
    if project.shower is not None:
        values.extend([project.shower.drainX, project.shower.drainY,
                       project.shower.drainWidth, project.shower.drainLength,
                       project.shower.slopePercent])
        if project.shower.vertices is not None:
            values.extend([project.shower.originX or 0, project.shower.originY or 0,
                           project.shower.rotationDeg or 0, project.shower.baseHeightMm or 0,
                           project.shower.recessDepthMm])
            values.extend(v for point in project.shower.vertices for v in point)
            for edge in project.shower.edges or []:
                values.extend(v for v in (edge.curbHeightMm, edge.curbWidthMm) if v is not None)
    if not all(valid_tenth(value) for value in values):
        raise ValueError('Допустим не более одного знака после запятой.')
    if (project.shower is not None and project.shower.drainType == 'point' and
            project.shower.drainLength != project.shower.drainWidth):
        raise ValueError('У точечного слива длина и ширина рамки должны совпадать.')
    if project.shower is not None and project.shower.vertices is not None:
        if project.shower.edges is None or len(project.shower.edges) != len(project.shower.vertices):
            raise ValueError('Количество рёбер поддона должно совпадать с количеством вершин.')
        for edge in project.shower.edges:
            if edge.kind == 'curb' and (edge.curbHeightMm is None or edge.curbWidthMm is None):
                raise ValueError('Для борта нужны высота и ширина.')
        if project.shower.recessDepthMm > (project.shower.baseHeightMm or 0):
            raise ValueError('Глубина чаши не может превышать высоту поддона.')


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
    value = 0 if abs(value) <= 1e-8 else value
    rounded = tenth(value)
    if value > 0 and rounded == 0 and not allow_zero:
        raise ValueError(f'{label}: положительная площадь меньше шага отображения.')
    if not allow_zero and rounded == 0:
        raise ValueError(f'{label}: нет пригодной площади.')
    return rounded


def _drain_polygon(shower):
    width = shower.drainWidth
    length = shower.drainLength
    if shower.drainType == 'linear' and shower.drainOrientation == 'vertical':
        width, length = length, width
    return box(shower.drainX - length / 2, shower.drainY - width / 2,
               shower.drainX + length / 2, shower.drainY + width / 2)


def _object_geometry(shower, room_region):
    if shower.vertices is None:
        return shower, None, None
    local = Polygon(shower.vertices)
    if not local.is_valid or local.is_empty or local.area <= 0:
        raise ValueError('Контур душевого поддона должен быть простым и иметь площадь.')
    angle = shower.rotationDeg or 0
    origin_x, origin_y = shower.originX or 0, shower.originY or 0
    footprint = translate(rotate(local, angle, origin=(0, 0)), origin_x, origin_y)
    footprint = _snap_geometry(footprint)
    if not room_region.covers(footprint):
        raise ValueError('Контур душевого поддона выходит за границы помещения.')
    radians = math.radians(angle)
    drain_x = origin_x + shower.drainX * math.cos(radians) - shower.drainY * math.sin(radians)
    drain_y = origin_y + shower.drainX * math.sin(radians) + shower.drainY * math.cos(radians)
    world_shower = shower.model_copy(update={'drainX': tenth(drain_x), 'drainY': tenth(drain_y)})
    return world_shower, footprint, local


def _object_transform(geometry, shower):
    return translate(rotate(geometry, shower.rotationDeg or 0, origin=(0, 0)),
                     shower.originX or 0, shower.originY or 0)


def _object_shower_zones(shower, local):
    drain = _drain_polygon(shower)
    local_region = shapely.difference(local, drain, grid_size=.1)
    return [(zone_id, axis, _snap_geometry(_object_transform(zone, shower)))
            for zone_id, axis, zone in _shower_zones(shower, local_region)]


def _object_surfaces(shower, footprint):
    if footprint is None or shower.edges is None:
        return []
    coords = list(footprint.exterior.coords)[:-1]
    surfaces = []
    for index, edge in enumerate(shower.edges):
        start, end = coords[index], coords[(index + 1) % len(coords)]
        length = math.dist(start, end)
        if edge.kind != 'wall':
            height = shower.baseHeightMm or 0
            surfaces.append({'id': f'{edge.id}:fascia', 'edgeId': edge.id, 'kind': 'fascia',
                'edgeKind': edge.kind, 'start': [tenth(start[0]), tenth(start[1])],
                'end': [tenth(end[0]), tenth(end[1])], 'lengthMm': tenth(length),
                'heightMm': tenth(height), 'widthMm': 0, 'areaMm2': tenth(length * height)})
        if edge.kind == 'curb':
            height, width = edge.curbHeightMm or 0, edge.curbWidthMm or 0
            inside_height = height + shower.recessDepthMm
            surfaces.append({'id': f'{edge.id}:curb', 'edgeId': edge.id, 'kind': 'curb',
                'edgeKind': edge.kind, 'start': [tenth(start[0]), tenth(start[1])],
                'end': [tenth(end[0]), tenth(end[1])], 'lengthMm': tenth(length),
                'heightMm': tenth(height), 'widthMm': tenth(width),
                'insideHeightMm': tenth(inside_height), 'outsideHeightMm': tenth(height),
                'areaMm2': tenth(length * (width + inside_height + height))})
    return surfaces


def _tile_rect_surface(surface_id: str, surface_kind: str, width: float, height: float,
                       tile: float, grout: float, threshold: float):
    parts = []
    step = tile + grout
    row = 0
    y = 0.0
    while y < height - EPS:
        piece_height = min(tile, height - y)
        column = 0
        x = 0.0
        while x < width - EPS:
            piece_width = min(tile, width - x)
            if piece_width > EPS and piece_height > EPS:
                issues = [] if min(piece_width, piece_height) >= threshold else ['Узкая подрезка']
                parts.append({'id': f'{surface_id}:{row + 1}.{column + 1}',
                    'surfaceId': surface_id, 'surfaceKind': surface_kind,
                    'width': tenth(piece_width), 'height': tenth(piece_height),
                    'area': _area(piece_width * piece_height, 'Деталь поверхности'),
                    'full': math.isclose(piece_width, tile, abs_tol=EPS) and
                            math.isclose(piece_height, tile, abs_tol=EPS),
                    'issues': issues})
            x += step
            column += 1
        y += step
        row += 1
    return parts


def _object_surface_parts(shower, surfaces, project):
    parts = []
    for surface in surfaces:
        length = surface['lengthMm']
        if surface['kind'] == 'fascia' and surface['heightMm'] > 0:
            parts.extend(_tile_rect_surface(surface['id'], 'fascia', length,
                surface['heightMm'], project.tile, project.grout, project.threshold))
        elif surface['kind'] == 'curb':
            dimensions = [('curb-top', surface['widthMm']),
                          ('curb-inside', surface['insideHeightMm']),
                          ('curb-outside', surface['outsideHeightMm'])]
            for kind, height in dimensions:
                if height > 0:
                    parts.extend(_tile_rect_surface(f"{surface['edgeId']}:{kind}", kind,
                        length, height, project.tile, project.grout, project.threshold))
    return parts


def _shower_height(shower, x: float, y: float) -> float:
    if shower.vertices is not None:
        x -= shower.originX or 0
        y -= shower.originY or 0
        radians = math.radians(-(shower.rotationDeg or 0))
        x, y = x * math.cos(radians) - y * math.sin(radians), \
               x * math.sin(radians) + y * math.cos(radians)
    slope = shower.slopePercent / 100
    if shower.drainType == 'point':
        distance = max(abs(x - shower.drainX), abs(y - shower.drainY))
    elif shower.drainOrientation == 'horizontal':
        distance = abs(y - shower.drainY)
    else:
        distance = abs(x - shower.drainX)
    return tenth(distance * slope)


def _shower_zones(shower, region):
    min_x, min_y, max_x, max_y = region.bounds
    radius = max(max_x - min_x, max_y - min_y, 1) * 4
    x, y = shower.drainX, shower.drainY
    if shower.drainType == 'point':
        candidates = [
            ('east', 'east', Polygon([(x, y), (x + radius, y - radius),
                                      (x + radius, y + radius)])),
            ('north', 'north', Polygon([(x, y), (x + radius, y + radius),
                                        (x - radius, y + radius)])),
            ('west', 'west', Polygon([(x, y), (x - radius, y + radius),
                                      (x - radius, y - radius)])),
            ('south', 'south', Polygon([(x, y), (x - radius, y - radius),
                                        (x + radius, y - radius)])),
        ]
    elif shower.drainOrientation == 'horizontal':
        candidates = [
            ('north', 'north', box(min_x - radius, y, max_x + radius, max_y + radius)),
            ('south', 'south', box(min_x - radius, min_y - radius, max_x + radius, y)),
        ]
    else:
        candidates = [
            ('east', 'east', box(x, min_y - radius, max_x + radius, max_y + radius)),
            ('west', 'west', box(min_x - radius, min_y - radius, x, max_y + radius)),
        ]
    zones = []
    for base_id, axis, candidate in candidates:
        polys = _polys(shapely.intersection(region, candidate, grid_size=.1))
        for index, poly in enumerate(polys):
            zones.append((base_id if len(polys) == 1 else f'{base_id}-{index+1}', axis, poly))
    if not zones:
        raise ValueError('Не удалось построить уклонные зоны душевого поддона.')
    covered = unary_union([zone[2] for zone in zones])
    if not covered.buffer(.11, join_style="mitre").covers(region):
        raise ValueError('Уклонные зоны не покрывают весь душевой поддон.')
    if sum(zone[2].area for zone in zones) - covered.area > .02:
        raise ValueError('Уклонные зоны душевого поддона перекрываются.')
    return zones


def _canonical_region(project, region):
    room = _snap_geometry(Polygon(project.outline, project.holes))
    area = _area(room.area, 'Помещение')
    canonical = _snap_geometry(region)
    _area(canonical.area, 'Область укладки')
    if not room.covers(canonical):
        raise ValueError('Область укладки выходит за границы помещения.')
    return room, canonical, area


def calculate_v5(project, dx: float, dy: float, *, detail: bool = True,
                 _region_override=None, _compose_object: bool = True):
    validate_input(project)
    try:
        region, _ = prepare(project) if _region_override is None else (_region_override, None)
    except ValueError as exc:
        raise ValueError('Некорректная область помещения или параметры раскладки.') from exc
    room_region = region
    drain = None
    object_footprint = None
    effective_shower = project.shower
    object_local = None
    if project.shower is not None:
        shower_room = _snap_geometry(Polygon(project.outline, project.holes))
        effective_shower, object_footprint, object_local = _object_geometry(project.shower, shower_room)
        region = object_footprint if object_footprint is not None else region
        drain = (_object_transform(_drain_polygon(project.shower), project.shower)
                 if object_footprint is not None else _drain_polygon(effective_shower))
        if not region.covers(drain):
            raise ValueError('Рамка слива должна полностью находиться внутри области укладки.')
        region = shapely.difference(region, drain, grid_size=.1)
        if region.is_empty or region.area <= 0:
            raise ValueError('После размещения слива не осталось области для укладки плитки.')
    room, canonical_region, room_area = _canonical_region(project, region)
    shower_zones = (_object_shower_zones(project.shower, object_local)
                    if project.shower is not None and object_local is not None
                    else _shower_zones(effective_shower, canonical_region) if effective_shower else [])
    step = project.tile + project.grout
    dx = offset_ticks(dx, step) / 10
    dy = offset_ticks(dy, step) / 10
    # Generate the grid in layout space, but clip the rotated, complete tile
    # cells against the already rounded canonical region. Clipping first and
    # rounding each fragment afterwards can move a vertex to the other side
    # of a diagonal boundary even though both came from the same intersection.
    canonical_local = rotate(canonical_region, -project.angle, origin=(0, 0))
    x0, y0, x1, y1 = canonical_local.bounds
    xs = np.arange(math.floor((x0-dx)/step), math.ceil((x1-dx)/step)) * step + dx
    ys = np.arange(math.floor((y0-dy)/step), math.ceil((y1-dy)/step)) * step + dy
    xx, yy = np.meshgrid(xs, ys)
    cell_x, cell_y = xx.ravel(), yy.ravel()
    local_x = np.stack((cell_x, cell_x + project.tile,
                        cell_x + project.tile, cell_x), axis=1)
    local_y = np.stack((cell_y, cell_y,
                        cell_y + project.tile, cell_y + project.tile), axis=1)
    radians = math.radians(project.angle)
    cosine, sine = math.cos(radians), math.sin(radians)
    world_cells = shapely.polygons(np.stack((
        local_x * cosine - local_y * sine,
        local_x * sine + local_y * cosine,
    ), axis=2))
    clipped = shapely.intersection(world_cells, canonical_region, grid_size=.1)
    parts = []
    polygons = []
    full = cuts = warnings = fragments = tiles = 0
    min_width = project.tile
    for index, geometry in enumerate(clipped):
        source_parts = []
        if shower_zones:
            for zone_id, axis, zone_geometry in shower_zones:
                for base_poly in _polys(geometry):
                    for poly in _polys(shapely.intersection(base_poly, zone_geometry, grid_size=.1)):
                        source_parts.append((zone_id, axis, poly))
        else:
            source_parts = [(None, None, poly) for poly in _polys(geometry)]
        if not source_parts:
            continue
        canonical_parts = []
        for zone_id, axis, poly in source_parts:
            _area(poly.area, 'Фрагмент плитки')
            # Fixed-precision GEOS operations can leave a harmless sub-grid
            # sliver along an angled boundary. Keep the canonical 0.1 mm
            # coordinates in the response and tolerate only that sliver.
            if not canonical_region.buffer(.11, join_style="mitre").covers(poly):
                raise ValueError('Фрагмент выходит за каноническую область укладки.')
            canonical_parts.append((len(canonical_parts), zone_id, axis, poly))
        whole = len(canonical_parts) == 1 and math.isclose(
            canonical_parts[0][3].area, project.tile ** 2, rel_tol=0, abs_tol=1e-7)
        tiles += 1
        full += int(whole)
        cuts += int(not whole)
        for sub, zone_id, axis, poly in canonical_parts:
            polygons.append(poly)
            fragments += 1
            width, issues = (project.tile, []) if whole else features(poly, project)
            if not whole:
                min_width = min(min_width, width)
            warnings += int(bool(issues))
            if detail:
                center = poly.representative_point()
                bx0, by0, bx1, by1 = poly.bounds
                planar_width, planar_height = bx1 - bx0, by1 - by0
                surface_width, surface_height = planar_width, planar_height
                if effective_shower is not None:
                    slope = effective_shower.slopePercent / 100
                    if axis in ('east', 'west'):
                        surface_width = math.hypot(planar_width, planar_width * slope)
                    elif axis in ('north', 'south'):
                        surface_height = math.hypot(planar_height, planar_height * slope)
                parts.append({'id': f'{index+1}' + (f'.{sub+1}' if len(source_parts)>1 else ''),
                    'source': index+1, 'rings': rings(poly),
                    'center': [tenth(center.x), tenth(center.y)],
                    'width': tenth(planar_width), 'height': tenth(planar_height),
                    'surfaceWidth': tenth(surface_width), 'surfaceHeight': tenth(surface_height),
                    'zoneId': zone_id,
                    'min_width': tenth(width), 'area': _area(poly.area, 'Фрагмент плитки'),
                    'full': whole, 'issues': issues})
    if not polygons:
        raise ValueError('В выбранном смещении не осталось пригодных фрагментов.')
    covered = unary_union(polygons)
    if sum(poly.area for poly in polygons) - covered.area > 1e-7:
        raise ValueError('После округления фрагменты плитки накладываются друг на друга.')
    used = _area(covered.area, 'Покрытая площадь')
    laying = _area(canonical_region.area, 'Область укладки')
    grout = _area(max(0, canonical_region.area - covered.area), 'Площадь швов', allow_zero=True)
    purchased = tiles * project.tile**2
    waste = _area(purchased - covered.area, 'Площадь отходов', allow_zero=True)
    symmetry = None
    if (len(_polys(canonical_local)) == 1 and not canonical_local.interiors and
            abs(canonical_local.area - shapely.box(*canonical_local.bounds).area) < EPS):
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
    result = {'offset_x': dx, 'offset_y': dy, 'angle': tenth(project.angle),
        'metrics': metrics, 'parts': parts,
        'region': [rings(poly) for poly in _polys(canonical_region)] if detail else []}
    if effective_shower is not None and detail:
        zone_results = []
        max_height = 0
        for zone_id, axis, zone in shower_zones:
            heights = [_shower_height(project.shower, x, y)
                       for ring in [zone.exterior, *zone.interiors]
                       for x, y in ring.coords]
            zone_max = max(heights, default=0)
            max_height = max(max_height, zone_max)
            zone_results.append({'id': zone_id, 'rings': rings(zone), 'axis': axis,
                'slopePercent': tenth(effective_shower.slopePercent),
                'minHeightMm': min(heights, default=0), 'maxHeightMm': zone_max})
        result['shower'] = {'drain': {'type': effective_shower.drainType,
            'x': tenth(effective_shower.drainX), 'y': tenth(effective_shower.drainY),
            'width': tenth(effective_shower.drainWidth),
            'length': tenth(effective_shower.drainLength),
            'orientation': effective_shower.drainOrientation,
            'rotationDeg': tenth(project.shower.rotationDeg or 0)},
            'zones': zone_results, 'maxHeightMm': tenth(max_height)}
        if object_footprint is not None:
            surfaces = _object_surfaces(project.shower, object_footprint)
            result['shower']['object'] = {
                'id': project.shower.id or 'shower-object',
                'originX': tenth(project.shower.originX or 0),
                'originY': tenth(project.shower.originY or 0),
                'rotationDeg': tenth(project.shower.rotationDeg or 0),
                'baseHeightMm': tenth(project.shower.baseHeightMm or 0),
                'recessDepthMm': tenth(project.shower.recessDepthMm),
                'footprint': rings(object_footprint),
                'edges': [edge.model_dump(exclude_none=True) for edge in project.shower.edges or []],
                'surfaces': surfaces,
            }
    if object_footprint is not None and project.shower is not None and _compose_object:
        surfaces = _object_surfaces(project.shower, object_footprint)
        surface_parts = _object_surface_parts(project.shower, surfaces, project)
        floor_region = shapely.difference(room_region, object_footprint, grid_size=.1)
        floor_result = None
        if not floor_region.is_empty and floor_region.area > EPS:
            floor_project = project.model_copy(update={'shower': None})
            floor_result = calculate_v5(floor_project, dx, dy, detail=detail,
                                        _region_override=floor_region, _compose_object=False)
        if detail:
            top_parts = [{**part, 'id': f"top:{part['id']}", 'surfaceId': 'shower-top'}
                         for part in result['parts']]
            floor_parts = [] if floor_result is None else [
                {**part, 'id': f"floor:{part['id']}", 'surfaceId': 'room-floor'}
                for part in floor_result['parts']]
            result['parts'] = floor_parts + top_parts
            result['region'] = ([] if floor_result is None else floor_result['region']) + result['region']
            result['shower']['object']['surfaceParts'] = surface_parts
        top_metrics = result['metrics']
        floor_metrics = floor_result['metrics'] if floor_result is not None else {
            key: 0 for key in top_metrics}
        surface_tiles = len(surface_parts)
        surface_full = sum(part['full'] for part in surface_parts)
        surface_covered = sum(part['area'] for part in surface_parts)
        surface_laying = sum(surface['areaMm2'] for surface in surfaces)
        surface_waste = surface_tiles * project.tile ** 2 - surface_covered
        total_tiles = floor_metrics['tiles'] + top_metrics['tiles'] + surface_tiles
        total_waste = floor_metrics['waste_area'] + top_metrics['waste_area'] + surface_waste
        result['metrics'] = {
            'tiles': total_tiles,
            'full': floor_metrics['full'] + top_metrics['full'] + surface_full,
            'cut': floor_metrics['cut'] + top_metrics['cut'] + surface_tiles - surface_full,
            'fragments': floor_metrics['fragments'] + top_metrics['fragments'] + surface_tiles,
            'warnings': floor_metrics['warnings'] + top_metrics['warnings'] +
                        sum(bool(part['issues']) for part in surface_parts),
            'min_width': tenth(min(floor_metrics['min_width'] or project.tile,
                                   top_metrics['min_width'] or project.tile,
                                   *(min(part['width'], part['height']) for part in surface_parts),
                                   project.tile)),
            'symmetry': None,
            'room_area': floor_metrics['room_area'] or top_metrics['room_area'],
            'laying_area': tenth(floor_metrics['laying_area'] + top_metrics['laying_area'] +
                                 surface_laying),
            'covered_area': tenth(floor_metrics['covered_area'] + top_metrics['covered_area'] +
                                  surface_covered),
            'grout_area': tenth(floor_metrics['grout_area'] + top_metrics['grout_area'] +
                                max(0, surface_laying - surface_covered)),
            'waste_area': tenth(total_waste),
            'waste_percent': tenth(100 * total_waste / (total_tiles * project.tile ** 2))
                             if total_tiles else 0,
        }
    return result


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
