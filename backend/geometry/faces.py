"""Derived bounded faces, identity and scoped readiness of a planar graph."""
import hashlib,json,math
from shapely.geometry import Polygon,Point
from shapely.ops import polygonize_full
from shapely.geometry.polygon import orient
from .graph_validation import maps,xy,line,ring_coords,measure,validate,issue,constraint_ids,EPS
from .wall_geometry import wall_area, polygons, polygon_data

def key(value):
    def normalize(v):
        if isinstance(v,float) and v.is_integer():return int(v)
        if isinstance(v,list):return [normalize(x) for x in v]
        if isinstance(v,dict):return {k:normalize(x) for k,x in v.items()}
        return v
    return hashlib.sha256(json.dumps(normalize(value),sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
def canonical_cycle(items):
    if not items:return []
    return min(items[i:]+items[:i] for i in range(len(items)))
def refs_for(coords,ss,vs):
    refs=[]
    for a,b in zip(coords,coords[1:]):
        found=None
        for s in ss.values():
            start,end=xy(vs[s['startVertexId']]),xy(vs[s['endVertexId']])
            if math.dist(start,a)<EPS and math.dist(end,b)<EPS:found={'segmentId':s['id'],'forward':True};break
            if math.dist(end,a)<EPS and math.dist(start,b)<EPS:found={'segmentId':s['id'],'forward':False};break
        if found is None:return []
        refs.append(found)
    return refs

def topology(refs,ss):
    items=[]
    for r in refs:
        item=ss[r['segmentId']]['chainId']+('+' if r['forward'] else '-')
        if not items or items[-1]!=item:items.append(item)
    if len(items)>1 and items[0]==items[-1]:items.pop()
    return canonical_cycle(items)

def dependencies(g,refs):
    vs,ss,cs=maps(g);ids={r['segmentId'] for r in refs}
    changed=True
    while changed:
        before=len(ids)
        for s in ss.values():
            if s['id'] in ids or s['chainId'] in ids:
                ids.update([s['id'],s['chainId'],s['startVertexId'],s['endVertexId']])
        for c in g['constraints']:
            targets=set(constraint_ids(c))-{c['id']}
            if c['fixed'] and targets & ids:ids.update(targets|{c['id']})
        changed=before!=len(ids)
    for c in g['constraints']:
        if (set(constraint_ids(c))-{c['id']}) & ids: ids.add(c['id'])
    for v in g['voids']:
        if any(r['segmentId'] in ids for r in v['boundary']):ids.add(v['id'])
    return ids

def measurements(g):
    vs,ss,cs=maps(g);out=[]
    def add(kind,target,value):
        condition=next((c for c in g['constraints'] if c['kind']==kind and c['target']==target and c['fixed']),None)
        out.append(dict(key=key([kind,target]),kind=kind,target=target,value=value,source='entered' if condition else 'derived'))
    for s in ss.values():add('segmentLength',{'segmentId':s['id']},line(s,vs).length)
    for c in cs.values():add('chainLength',{'chainId':c['id']},sum(line(ss[x],vs).length for x in c['segmentIds']))
    for c in g['constraints']:
        if c['kind'] in ('angle','orientation') or c['target'].get('range'):add(c['kind'],c['target'],measure(c,vs,ss,cs))
    # Every pair of incident rays is available to the inspector, including 180°.
    for vid in vs:
        incident=[s for s in ss.values() if vid in (s['startVertexId'],s['endVertexId'])]
        for i,a in enumerate(incident):
            for b in incident[i+1:]:
                target=dict(vertexId=vid,firstSegmentId=a['id'],secondSegmentId=b['id'],sector='ccw')
                if not any(m['target']==target for m in out):add('angle',target,measure(dict(kind='angle',target=target),vs,ss,cs))
    return sorted(out,key=lambda m:m['key'])

def inspect(g):
    vs,ss,cs=maps(g);issues=validate(g);ms=measurements(g)
    occupied=wall_area(g)
    # Polygonization is diagnostic only. Any defect touching a candidate blocks it.
    lines=[line(s,vs) for s in ss.values() if line(s,vs).length>EPS]
    collection,_,_,_=polygonize_full(lines)
    voids=[]
    for v in g['voids']:
        coords=ring_coords(v['boundary'],ss,vs)
        if coords:
            p=Polygon(coords)
            if p.is_valid:voids.append((v,p))
    polys=[orient(p,sign=1) for p in collection.geoms if p.area>EPS]
    for v,p in voids:
        if not any(Polygon(q.exterior).contains(p) and Polygon(q.exterior).boundary.disjoint(p) for q in polys):
            issues.append(issue('void_outside','Отверстие должно находиться строго внутри помещения',[v['id'],*[r['segmentId'] for r in v['boundary']]]))
    faces=[]
    for poly in polys:
        if any(p.covers(poly.representative_point()) for _,p in voids):continue
        outer=refs_for(list(poly.exterior.coords),ss,vs);holes=[refs_for(list(h.coords),ss,vs) for h in poly.interiors]
        if not outer or any(not h for h in holes):continue
        tk=key([topology(outer,ss), sorted([topology(h,ss) for h in holes])]);refs=outer+[r for h in holes for r in h];deps=dependencies(g,refs)
        boundary_angles=[]
        for ring in [outer,*holes]:
            for index,current in enumerate(ring):
                previous=ring[index-1];edge=ss[current['segmentId']]
                target=dict(vertexId=edge['startVertexId'] if current['forward'] else edge['endVertexId'],firstSegmentId=previous['segmentId'],secondSegmentId=current['segmentId'],sector='cw')
                boundary_angles.append(target)
                if not any(m['target']==target and m['kind']=='angle' for m in ms):
                    entered=any(c['kind']=='angle' and c['target']==target and c['fixed'] for c in g['constraints'])
                    ms.append(dict(key=key(['angle',target]),kind='angle',target=target,value=measure(dict(kind='angle',target=target),vs,ss,cs),source='entered' if entered else 'derived'))
        ms.sort(key=lambda m:m['key'])

        relevant=[]
        for err in issues:
            affects=err['scope']=='global' or bool(set(err['entityIds']) & deps)
            for eid in err['entityIds']:
                if eid in ss and poly.intersects(line(ss[eid],vs)):affects=True
                if eid in vs and poly.covers(Point(xy(vs[eid]))):affects=True
            if affects:
                err['affectedRoomKeys'].append(tk);relevant.append(err)
        if len(outer)>100 or any(len(h)>100 for h in holes) or len(holes)>20:
            err=issue('planner_limit','Для расчёта допускается до 100 вершин на кольцо и 20 отверстий',list(deps),'room');err['affectedRoomKeys']=[tk];issues.append(err);relevant.append(err)
        subset={k:[x for x in g[k] if x['id'] in deps] for k in ['vertices','segments','chains','voids','constraints']}
        subset['fieldInputs']={k:v for k,v in g['fieldInputs'].items() if any(':'+eid+':' in k for eid in deps)}
        for k in ['vertices','segments','chains','voids','constraints']:subset[k].sort(key=lambda x:x['id'])
        axis_polygon=polygon_data(poly)
        usable=polygons(poly.difference(occupied))
        usable=[shape for shape in usable if shape.area>EPS]
        if len(usable)!=1:
            err=issue('unusable_room','Полезный контур помещения пуст или разделён стенами',sorted(deps),'room')
            err['affectedRoomKeys']=[tk];issues.append(err);relevant.append(err)
        polygon=polygon_data(usable[0]) if len(usable)==1 else None
        area=usable[0].area if len(usable)==1 else None
        dk=key(subset);selected_ms=[m for m in ms if set(v for v in m['target'].values() if isinstance(v,str)) & deps and (m['kind']!='angle' or m['target'] in boundary_angles or m['source']=='entered')]
        faces.append(dict(topologyKey=tk,outer=outer,holes=holes,axisPolygon=axis_polygon,polygon=polygon,areaMm2=area,dependencyIds=sorted(deps),dependencyKey=dk,geometryKey=key(polygon),measurementKey=key([dk,selected_ms]),validation=dict(valid=not relevant,issues=relevant)))
    return dict(status='invalid' if issues else 'valid',graph=g,wallArea=[polygon_data(shape) for shape in polygons(occupied)],faces=sorted(faces,key=lambda f:f['topologyKey']),measurements=ms,issues=issues)
