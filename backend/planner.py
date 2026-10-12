"""All coordinates and lengths are in mm; areas returned to the UI are in m².

One source tile per occupied grid cell. Disconnected fragments in the same cell
share that source tile. No nesting/reuse between different source cells.
"""
import math
import numpy as np
import shapely
from shapely.geometry import Polygon, box
from shapely.affinity import rotate
from shapely.validation import explain_validity

EPS = 1e-5

def polygons(geometry):
    if geometry.geom_type == 'Polygon':
        return [geometry] if geometry.area > EPS else []
    return [p for g in getattr(geometry, 'geoms', []) for p in polygons(g)]


def prepare(p):
    if any(abs(v) > 100000 for pt in p.outline for v in pt):
        raise ValueError('Координаты контура должны быть в пределах ±100 000 мм.')
    shell = Polygon(p.outline)
    if not shell.is_valid or shell.area < 1:
        raise ValueError('Некорректный контур: ' + explain_validity(shell))
    hole_polys = []
    for ring in p.holes:
        if not 3 <= len(ring) <= 100 or any(not math.isfinite(v) or abs(v) > 100000 for pt in ring for v in pt):
            raise ValueError('Отверстие: от 3 до 100 точек, координаты в пределах ±100 000 мм.')
        h = Polygon(ring)
        if not h.is_valid or h.area < 1 or not shell.contains(h) or shell.boundary.intersects(h):
            raise ValueError('Отверстия должны быть корректными и строго внутри комнаты.')
        if any(h.intersects(other) for other in hole_polys):
            raise ValueError('Отверстия не должны пересекаться или касаться друг друга.')
        hole_polys.append(h)
    room = Polygon(p.outline, p.holes)
    region = room.buffer(-p.gap, join_style=2) if p.gap else room
    if region.is_empty or region.area < 1:
        raise ValueError('Отступ от стен не оставляет площади для укладки.')
    local = rotate(region, -p.angle, origin=(0, 0))
    a, b, c, d = local.bounds
    period = p.tile + p.grout
    if (math.ceil((c-a)/period)+2)*(math.ceil((d-b)/period)+2) > 1600:
        raise ValueError('Слишком много плиток: увеличьте размер плитки или уменьшите помещение (до 1600 ячеек сетки).')
    return region, local


def rings(poly):
    return [list(map(list, poly.exterior.coords))] + [list(map(list, r.coords)) for r in poly.interiors]


def features(poly, p):
    rect = list(poly.minimum_rotated_rectangle.exterior.coords)
    width = min(math.dist(rect[i], rect[i+1]) for i in range(4))
    coords = list(poly.exterior.coords)[:-1]
    acute = False
    for i, pt in enumerate(coords):
        a, b = coords[i-1], coords[(i+1) % len(coords)]
        u, v = (a[0]-pt[0], a[1]-pt[1]), (b[0]-pt[0], b[1]-pt[1])
        norm = math.hypot(*u)*math.hypot(*v)
        if norm > EPS and (u[0]*v[0]+u[1]*v[1])/norm > math.cos(math.radians(30)):
            acute = True
    issues = []
    if width < p.threshold-EPS:
        issues.append('Узкая деталь')
    if poly.area < p.threshold**2:
        issues.append('Маленькая площадь')
    if acute:
        issues.append('Острое окончание < 30°')
    complex_shape = len(coords) > 4 or len(poly.interiors) > 0 or poly.convex_hull.area-poly.area > EPS
    if complex_shape:
        issues.append('Сложная форма — проверьте раскрой')
    return width, issues


def calculate(p, region, local, dx, dy, detail=True):
    step = p.tile+p.grout
    dx, dy = dx % step, dy % step
    x0,y0,x1,y1 = local.bounds
    xs = np.arange(math.floor((x0-dx)/step), math.ceil((x1-dx)/step)) * step + dx
    ys = np.arange(math.floor((y0-dy)/step), math.ceil((y1-dy)/step)) * step + dy
    xx,yy = np.meshgrid(xs,ys)
    cells = shapely.box(xx.ravel(), yy.ravel(), xx.ravel()+p.tile, yy.ravel()+p.tile)
    clipped = shapely.intersection(cells, local)
    areas = shapely.area(clipped)
    occupied = np.flatnonzero(areas > EPS)
    full = cuts = warnings = fragments = 0
    min_width = p.tile
    parts = []
    for n, index in enumerate(occupied):
        geom, area = clipped[index], areas[index]
        whole = bool(abs(area-p.tile**2) < max(EPS, p.tile**2*1e-9))
        full += int(whole)
        cuts += int(not whole)
        for sub, poly in enumerate(polygons(geom)):
            fragments += 1
            width, issues = (p.tile, []) if whole else features(poly,p)
            if not whole:
                min_width = min(min_width, width)
            warnings += int(bool(issues))
            if detail:
                world = rotate(poly, p.angle, origin=(0,0))
                bounds = poly.bounds
                center = world.representative_point()
                parts.append({'id':f'{n+1}' + (f'.{sub+1}' if len(polygons(geom)) > 1 else ''),
                    'source':n+1, 'rings':rings(world), 'center':[center.x,center.y],
                    'width':round(bounds[2]-bounds[0],2), 'height':round(bounds[3]-bounds[1],2),
                    'min_width':round(width,2), 'area':round(poly.area/1e6,6),
                    'full':whole, 'issues':issues})
    used = float(sum(areas[occupied]))
    purchased = len(occupied)*p.tile**2
    symmetry = None
    # Comparable opposing walls exist only for an axis-aligned rectangle in grid space.
    if len(polygons(local)) == 1 and not local.interiors and abs(local.area-box(*local.bounds).area)<EPS:
        def opposite(lo, hi, offset):
            left = p.tile-((lo-offset) % step)
            right = (hi-offset) % step
            left = max(0, left)
            right = min(p.tile, right) if right > EPS else p.tile
            return abs(left-right)
        symmetry = round((opposite(x0,x1,dx)+opposite(y0,y1,dy))/2,2)
    metrics = {'tiles':len(occupied), 'full':full, 'cut':cuts, 'fragments':fragments,
        'warnings':warnings, 'min_width':round(min_width,2), 'symmetry':symmetry,
        'room_area':round(Polygon(p.outline,p.holes).area/1e6,4),
        'laying_area':round(region.area/1e6,4), 'covered_area':round(used/1e6,4),
        'grout_area':round((region.area-used)/1e6,4),
        'waste_area':round((purchased-used)/1e6,4),
        'waste_percent':round(100*(purchased-used)/purchased,1) if purchased else 0}
    return {'offset_x':round(dx,4), 'offset_y':round(dy,4), 'angle':p.angle,
        'metrics':metrics, 'parts':parts, 'region':[rings(g) for g in polygons(region)] if detail else []}


def objectives(v):
    m=v['metrics']
    return (m['warnings'], -m['min_width'], m['cut'], m['tiles'], m['symmetry'] or 0)


def dominates(a,b):
    x,y=objectives(a),objectives(b)
    return all(i<=j for i,j in zip(x,y)) and any(i<j for i,j in zip(x,y))


def optimize(p):
    region, local = prepare(p)
    step = p.tile+p.grout
    x0,y0,x1,y1 = local.bounds
    offsets_x = {i*step/8 for i in range(8)} | {((x0+x1-p.tile)/2) % step, ((x0+x1-p.tile)/2+step/2) % step, x0 % step}
    offsets_y = {i*step/8 for i in range(8)} | {((y0+y1-p.tile)/2) % step, ((y0+y1-p.tile)/2+step/2) % step, y0 % step}
    found = {}
    def evaluate(dx,dy):
        key = (round(dx % step,4),round(dy % step,4))
        if key not in found:
            found[key] = calculate(p,region,local,*key,detail=False)
    for dx in sorted(offsets_x):
        for dy in sorted(offsets_y):
            evaluate(dx,dy)
    seeds = sorted(found.values(), key=objectives)[:3]
    for seed in seeds:
        for sx in (-step/32,0,step/32):
            for sy in (-step/32,0,step/32):
                evaluate(seed['offset_x']+sx,seed['offset_y']+sy)
    values = list(found.values())
    frontier = [v for v in values if not any(dominates(w,v) for w in values)]
    selections = []
    criteria = [('Широкие подрезки', lambda v:(v['metrics']['warnings'],-v['metrics']['min_width'])),
        ('Меньше подрезок', lambda v:(v['metrics']['warnings'],v['metrics']['cut'])),
        ('Меньше материала', lambda v:(v['metrics']['warnings'],v['metrics']['tiles']))]
    if values[0]['metrics']['symmetry'] is not None:
        criteria.insert(1,('Баланс краёв',lambda v:(v['metrics']['warnings'],v['metrics']['symmetry'])))
    for title, key in criteria:
        for v in sorted(frontier,key=lambda v:(key(v),objectives(v))):
            if not any(all(min(abs(v[k]-s[k]),step-abs(v[k]-s[k])) < step/16 for k in ('offset_x','offset_y')) for s in selections):
                selections.append({**v,'title':title})
                break
    if not selections:
        selections = [{**min(values,key=objectives),'title':'Компромисс'}]
    result = [{**calculate(p,region,local,v['offset_x'],v['offset_y']), 'title':v['title']} for v in selections]
    return {'variants':result,'evaluated':len(values), 'pareto_count':len(frontier),
        'note':'Приближённый поиск с уточнением; точный глобальный оптимум не гарантируется. Все границы равнозначны. Узкие перешейки сложных деталей требуют ручной проверки.'}
