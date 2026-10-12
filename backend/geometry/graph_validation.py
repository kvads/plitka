"""Independent geometric verification; never repairs the user's graph."""
import math
from shapely.geometry import LineString, Point, Polygon

EPS=1e-7

def maps(g):
    return ({v['id']:v for v in g['vertices']}, {s['id']:s for s in g['segments']}, {c['id']:c for c in g['chains']})
def xy(v): return (v['x'],v['y'])
def line(s,vs): return LineString([xy(vs[s['startVertexId']]),xy(vs[s['endVertexId']])])
def issue(code,message,ids,scope='component'):
    return dict(code=code,message=message,entityIds=list(ids),scope=scope,affectedRoomKeys=[])
class GeometryRejection(ValueError):
    def __init__(self, errors):
        self.issues = errors
        super().__init__(errors[0]['message'])

def coincident_pairs(g):
    groups = {}
    for v in g['vertices']:
        groups.setdefault(xy(v), []).append(v['id'])
    return {(a, b): point for point, ids in groups.items()
            for i, a in enumerate(sorted(ids)) for b in sorted(ids)[i+1:]}

def collision_issues(basis, candidate):
    old = coincident_pairs(basis)
    return [issue('coincident_vertices',
                  f'Вершины {a} и {b} совпадают в ({point[0]:.15g}; {point[1]:.15g}) мм. Выберите другое положение.', [a, b])
            for (a, b), point in coincident_pairs(candidate).items() if old.get((a, b)) != point]

def ring_coords(refs,ss,vs):
    coords=[]; previous=None; first=None
    for ref in refs:
        s=ss[ref['segmentId']]; a,b=s['startVertexId'],s['endVertexId']
        if not ref['forward']: a,b=b,a
        if previous is not None and previous!=a: return None
        if first is None:first=a
        coords.append(xy(vs[a]));previous=b
    if previous!=first or len(set(coords))<3:return None
    return coords

def measure(c,vs,ss,cs):
    t=c['target'];kind=c['kind']
    if kind=='legacyUnbound': return None
    if kind=='segmentLength': return line(ss[t['segmentId']],vs).length
    if kind in ('chainLength','orientation'):
        ch=cs[t['chainId']];a=vs[ch['startVertexId']];b=vs[ch['endVertexId']]
        if kind=='orientation': return math.degrees(math.atan2(b['y']-a['y'],b['x']-a['x']))%360
        ids=ch['segmentIds']
        if t.get('range'):
            nodes=[ch['startVertexId']]+[ss[x]['endVertexId'] for x in ids]
            ids=ids[nodes.index(t['range']['startVertexId']):nodes.index(t['range']['endVertexId'])]
        return sum(line(ss[s],vs).length for s in ids)
    v=vs[t['vertexId']]
    angles=[]
    for k in ['firstSegmentId','secondSegmentId']:
        s=ss[t[k]];other=s['endVertexId'] if s['startVertexId']==v['id'] else s['startVertexId'];p=vs[other]
        if math.dist(xy(v),xy(p))<EPS:return None
        angles.append(math.degrees(math.atan2(p['y']-v['y'],p['x']-v['x'])))
    return ((angles[1]-angles[0])*(1 if t['sector']=='ccw' else -1))%360

def constraint_ids(c):
    t=c['target'];ids=[c['id']]
    for k in ['segmentId','chainId','vertexId','firstSegmentId','secondSegmentId']:
        if t.get(k):ids.append(t[k])
    if t.get('range'):ids.extend(t['range'].values())
    return ids

def validate(g, check_constraints=True):
    vs,ss,cs=maps(g);out=[];ls={sid:line(s,vs) for sid,s in ss.items()}
    for (a,b),point in coincident_pairs(g).items():
        out.append(issue('coincident_vertices', f'Координаты вершин совпадают: ({point[0]:.15g}; {point[1]:.15g}) мм', [a,b]))
    for v in vs.values():
        if abs(v['x'])>100000 or abs(v['y'])>100000:out.append(issue('coordinate_range','Координата вне диапазона ±100000 мм',[v['id']]))
    for sid,l in ls.items():
        if l.length<EPS:
            a,b=ss[sid]['startVertexId'],ss[sid]['endVertexId']
            message='Координаты концов стены совпадают' if xy(vs[a])==xy(vs[b]) else 'Длина стены слишком мала'
            out.append(issue('zero_wall',message,[sid,a,b]))
    ids=list(ss)
    for i,a in enumerate(ids):
        for b in ids[i+1:]:
            inter=ls[a].intersection(ls[b])
            if inter.is_empty:continue
            shared=set([ss[a]['startVertexId'],ss[a]['endVertexId']]) & set([ss[b]['startVertexId'],ss[b]['endVertexId']])
            if inter.geom_type!='Point' or inter.length>EPS:
                out.append(issue('overlap','Стены накладываются друг на друга',[a,b]))
            elif not any(Point(xy(vs[v])).distance(inter)<EPS for v in shared):
                out.append(issue('unnoded_crossing','Пересечение стен не имеет общего узла',[a,b]))
    for cid,ch in cs.items():
        base=LineString([xy(vs[ch['startVertexId']]),xy(vs[ch['endVertexId']])]);prev=-EPS
        for sid in ch['segmentIds']:
            s=ss[sid];p=Point(xy(vs[s['endVertexId']]))
            t=base.project(p)
            if base.length<EPS or base.distance(p)>EPS or t<=prev+EPS:
                out.append(issue('chain_order','Участки исходной стены должны лежать на одной прямой в исходном порядке',[cid,*ch['segmentIds']]))
                break
            prev=t
    voids=[]
    for v in g['voids']:
        coords=ring_coords(v['boundary'],ss,vs)
        poly=Polygon(coords) if coords else None
        if poly is None or not poly.is_valid or poly.area<EPS:
            out.append(issue('invalid_void','Отверстие должно иметь корректную замкнутую границу',[v['id'],*[r['segmentId'] for r in v['boundary']]]))
        else:voids.append((v,poly))
    for i,(v,p) in enumerate(voids):
        for w,q in voids[i+1:]:
            if p.intersects(q):out.append(issue('void_overlap','Отверстия не должны касаться или пересекаться',[v['id'],w['id']]))
    if check_constraints:
        for c in g['constraints']:
            value=measure(c,vs,ss,cs)
            if c['kind']=='legacyUnbound':out.append(issue('legacy_unbound',c['target'].get('reason','Проверьте старое условие'),constraint_ids(c)));continue
            if not c['fixed']:continue
            bad=value is None or (c['kind'] in ('chainLength','segmentLength') and c['value']<=0) or (c['kind']=='angle' and (c['value']<=0 or c['value']>=360 or abs(c['value']-180)<EPS))
            delta=abs((value or 0)-c['value'])
            if c['kind']=='orientation':delta=abs((delta+180)%360-180)
            if bad or delta>0.1:out.append(issue('constraint_conflict','Введённый размер не согласован с геометрией',constraint_ids(c)))
    for field,raw in g['fieldInputs'].items():
        try:
            if not raw.strip() or not math.isfinite(float(raw.replace(',','.'))):raise ValueError()
        except ValueError:
            out.append({**issue('invalid_number','Введите конечное число',[field.split(':',1)[1].rsplit(':',1)[0]] if field.count(':')>=2 else [field.rsplit(':',1)[0]] if ':' in field else [],'component'), 'fieldKey':field})
    return out
