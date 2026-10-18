import copy,math
import numpy as np
from scipy.optimize import least_squares
from .graph_validation import maps,xy,measure,validate,issue,constraint_ids,collision_issues
from .precision import canonical_graph


def solve(g,command,basis):
    vs,ss,cs=maps(g);bv,bs,bc=maps(basis)
    seed=set()
    if command['type']=='moveVertex':seed.add(command['vertexId'])
    if command['type']=='setLength':seed.add(command['target']['id'])
    for k in ['vertexId','chainId','firstSegmentId','secondSegmentId']:
        if command.get(k):seed.add(command[k])
    if command.get('constraintId'):
        match=next((c for c in g['constraints'] if c['id']==command['constraintId']),None)
        if match:seed.update(constraint_ids(match))
    if not seed:seed=set(vs)|set(ss)|set(cs)
    changed=True
    while changed:
        before=len(seed)
        for edge in ss.values():
            targets={edge['id'],edge['chainId'],edge['startVertexId'],edge['endVertexId']}
            if seed & targets:seed.update(targets)
        for c in g['constraints']:
            targets=set(constraint_ids(c))
            if c['fixed'] and seed & targets:seed.update(targets)
        changed=before!=len(seed)
    fixed=[c for c in g['constraints'] if c['fixed'] and set(constraint_ids(c)) & seed]
    if any(c['kind']=='legacyUnbound' or (c['kind'] in ('segmentLength','chainLength') and c['value']<=0) or (c['kind']=='angle' and (not 0<c['value']<360 or c['value']==180)) for c in fixed):return g,False
    ids=[id for id in vs if id in seed];anchors={};direction=None
    # Operation anchors are hard coordinates, removed from the variable vector.
    if command['type']=='setLength':
        target=command['target'];edge=ss.get(target['id']) if target['kind']=='segment' else cs.get(target['id'])
        if not edge:return g,False
        start,end=edge['startVertexId'],edge['endVertexId']
        if target.get('range'):start,end=target['range']['startVertexId'],target['range']['endVertexId']
        anchors[start]=xy(bv[start]);a,b=bv[start],bv[end];angle=math.atan2(b['y']-a['y'],b['x']-a['x']);direction=(start,end,angle)
        # Exact initial candidate for a free dimension; all fixed conditions are checked later.
        vs[end]['x']=a['x']+command['value']*math.cos(angle);vs[end]['y']=a['y']+command['value']*math.sin(angle)
    elif command['type']=='moveVertex':anchors[command['vertexId']]=(command['point']['x'],command['point']['y'])
    elif command['type']=='setOrientation':anchors[cs[command['chainId']]['startVertexId']]=xy(bv[cs[command['chainId']]['startVertexId']])
    elif ids:anchors[ids[0]]=xy(vs[ids[0]])
    free=[id for id in ids if id not in anchors];initial=np.array([v for id in free for v in xy(vs[id])],dtype=float)
    def set_coords(x):
        for id,p in anchors.items():vs[id]['x'],vs[id]['y']=p
        for i,id in enumerate(free):vs[id]['x'],vs[id]['y']=float(x[2*i]),float(x[2*i+1])
    def residual(x):
        set_coords(x);res=[]
        for c in fixed:
            val=measure(c,vs,ss,cs)
            if val is None:res.append(1e6);continue
            delta=val-c['value']
            if c['kind'] in ('angle','orientation'):delta=(delta+180)%360-180
            res.append(delta)
        for ch in cs.values():
            if ch['id'] not in seed:continue
            a,b=vs[ch['startVertexId']],vs[ch['endVertexId']];dx,dy=b['x']-a['x'],b['y']-a['y'];length=max(math.hypot(dx,dy),1e-6)
            for sid in ch['segmentIds'][:-1]:
                p=vs[ss[sid]['endVertexId']];res.append(((p['x']-a['x'])*dy-(p['y']-a['y'])*dx)/length)
        if direction:
            a,b,theta=direction;p,q=vs[a],vs[b];res.append(((q['x']-p['x'])*math.sin(theta)-(q['y']-p['y'])*math.cos(theta)))
        # Very weak regularization selects a nearby solution for underdetermined plans.
        res.extend((x-initial)*1e-9)
        return res
    if free:
        try:
            fit=least_squares(residual,initial,method='trf',loss='linear',max_nfev=200,xtol=1e-12,ftol=1e-12,gtol=1e-12)
            set_coords(fit.x)
        except (ValueError,FloatingPointError):return g,False
    else:set_coords([])
    # Validate the same one-decimal geometry that the command will persist.
    canonical_graph(g)
    errors=[e for e in validate(g) if e["scope"]=="global" or set(e["entityIds"]) & seed]
    return g,not errors and not collision_issues(basis,g)
