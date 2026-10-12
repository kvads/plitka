import copy,math,uuid
from shapely.geometry import Point,LineString
from .graph_validation import maps,xy,line,EPS,issue,GeometryRejection

def new_id(command_id,role):return str(uuid.uuid5(uuid.NAMESPACE_URL,command_id+':'+role))
def add_vertex(g,p,command_id,role='vertex'):
    existing = [v['id'] for v in g['vertices'] if xy(v)==(p['x'],p['y'])]
    if existing:
        raise GeometryRejection([issue('coincident_vertices',
            f"В этой точке уже есть вершина: ({p['x']:.15g}; {p['y']:.15g}) мм", existing)])
    vid=new_id(command_id,role);g['vertices'].append(dict(id=vid,x=p['x'],y=p['y']));return vid

def junction_vertex(g,p,command_id,role):
    matches = [v for v in g['vertices'] if math.dist(xy(v),(p['x'],p['y']))<EPS]
    if len(matches)>1:
        raise GeometryRejection([issue('ambiguous_junction',
            'В месте сочленения несколько вершин. Сначала явно исправьте их положение.', sorted(v['id'] for v in matches))])
    return matches[0]['id'] if matches else add_vertex(g,p,command_id,role)

def connect(g,from_id,to,command_id):
    vs,ss,cs=maps(g)
    if from_id not in vs:raise ValueError('Начальная вершина не найдена')
    if 'vertexId' in to:
        end=to['vertexId']
        if end not in vs:raise ValueError('Конечная вершина не найдена')
    else:
        if to['segmentId'] not in ss:raise ValueError('Стена не найдена')
        wall=line(ss[to['segmentId']],vs);p=Point(to['point']['x'],to['point']['y']);projection=wall.interpolate(wall.project(p));end=junction_vertex(g,dict(x=projection.x,y=projection.y),command_id,'end')
    vs,ss,cs=maps(g)
    if from_id==end or math.dist(xy(vs[from_id]),xy(vs[end]))<EPS:raise ValueError('Нельзя создать нулевую стену')
    cid=new_id(command_id,'chain');sid=new_id(command_id,'segment');new=dict(id=sid,startVertexId=from_id,endVertexId=end,chainId=cid)
    new_line=line(new,vs);cuts={sid:[(0,from_id),(new_line.length,end)]}
    for old in g['segments']:
        l=line(old,vs);inter=l.intersection(new_line)
        if inter.is_empty:continue
        if inter.geom_type!='Point':raise ValueError('Стены накладываются друг на друга')
        vid=junction_vertex(g,dict(x=inter.x,y=inter.y),command_id,'intersection:'+str(round(inter.x,7))+':'+str(round(inter.y,7)))
        cuts.setdefault(old['id'],[(0,old['startVertexId']),(l.length,old['endVertexId'])]).append((l.project(inter),vid));cuts[sid].append((new_line.project(inter),vid))
    g['segments'].append(new);g['chains'].append(dict(id=cid,startVertexId=from_id,endVertexId=end,segmentIds=[sid]))
    originals={s['id']:copy.deepcopy(s) for s in g['segments']};split={};replacement={}
    for oldid,points in cuts.items():
        old=originals[oldid];ordered=[]
        for distance,vid in sorted(points,key=lambda p:(p[0],p[1])):
            if ordered and abs(distance-ordered[-1][0])<EPS:continue
            ordered.append((distance,vid))
        if len(ordered)<=2:continue
        children=[]
        for i,((_,a),(_,b)) in enumerate(zip(ordered,ordered[1:])):
            child=dict(id=new_id(command_id,f'split:{oldid}:{i}'),startVertexId=a,endVertexId=b,chainId=old['chainId']);children.append(child)
        split[oldid]=[c['id'] for c in children];replacement[oldid]=children
    g['segments']=[child for s in g['segments'] for child in replacement.get(s['id'],[s])]
    for chain in g['chains']:chain['segmentIds']=[child for sid in chain['segmentIds'] for child in split.get(sid,[sid])]
    for v in g['voids']:
        v['boundary']=[dict(segmentId=sid,forward=r['forward']) for r in v['boundary'] for sid in (split.get(r['segmentId'],[r['segmentId']]) if r['forward'] else list(reversed(split.get(r['segmentId'],[r['segmentId']]))))]
    for c in g['constraints']:
        t=c['target']
        if c['kind']=='segmentLength' and t['segmentId'] in split:
            old=originals[t['segmentId']];c['kind']='chainLength';c['target']=dict(chainId=old['chainId'],range=dict(startVertexId=old['startVertexId'],endVertexId=old['endVertexId']))
        if c['kind']=='angle':
            for k in ['firstSegmentId','secondSegmentId']:
                if t[k] in replacement:t[k]=next(s['id'] for s in replacement[t[k]] if t['vertexId'] in (s['startVertexId'],s['endVertexId']))
    return split
