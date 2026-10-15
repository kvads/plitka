import copy
from .graph_models import GraphSnapshot
from .topology import new_id,add_vertex,connect,draw_wall
from .graph_validation import maps,validate,issue,constraint_ids,collision_issues,GeometryRejection
from .faces import inspect
from .graph_solver import solve
from .deletion import cascade, apply_deletion, remove_condition_raw
from .wall_geometry import disconnected_wall_overlaps
DIMENSION={'setLength','setAngle','setOrientation','releaseConstraint','reconcile'}

def apply_condition(g,c):
    t=c['type'];condition=None
    if t=='setLength':
        target=c['target'];target={'chainId':target['id'],**({'range':target['range']} if target.get('range') else {})} if target['kind']=='chain' else {'segmentId':target['id']}
        condition=dict(id=c['constraintId'],kind='chainLength' if 'chainId' in target else 'segmentLength',target=target,value=c['value'],fixed=True)
    elif t=='setAngle':condition=dict(id=c['constraintId'],kind='angle',target={k:c[k] for k in ['vertexId','firstSegmentId','secondSegmentId','sector']},value=c['value'],fixed=True)
    elif t=='setOrientation':condition=dict(id=c['constraintId'],kind='orientation',target={'chainId':c['chainId']},value=c['value'],fixed=True)
    if condition:g['constraints']=[x for x in g['constraints'] if x['id']!=condition['id']]+[condition]
    if t=='releaseConstraint':
        match=next((x for x in g['constraints'] if x['id']==c['constraintId']),None)
        if not match:raise ValueError('Условие не найдено')
        match['fixed']=False


def delete_elements(g,c,command_id):
    result, impact = cascade(g, c['segmentIds'], c['vertexIds'], command_id)
    if not set(impact['constraintIds']) <= set(c['acknowledgedConstraintIds']):
        raise ValueError('Подтвердите удаление всех связанных размерных условий')
    g.clear()
    g.update(result)

def execute(basis,c,command_id):
    g=copy.deepcopy(basis);split={};status='applied';failure=None;rejected=[];t=c['type']
    try:
        if t in DIMENSION:
            apply_condition(g,c);GraphSnapshot.model_validate(g);desired=copy.deepcopy(g);candidate,ok=solve(g,c,basis)
            rejected=collision_issues(basis,candidate)
            if ok and not rejected:g=candidate
            else:g=desired;status='unresolved';failure=None if rejected else 'Не удалось согласовать все введённые размеры. Исправьте условия или снимите фиксацию.'
        elif t=='addVertex':add_vertex(g,c['point'],command_id)
        elif t=='connect':split=connect(g,c['fromVertexId'],c['to'],command_id,c['thicknessMm'])
        elif t=='drawWall':split=draw_wall(g,c['start'],c['end'],c['thicknessMm'],command_id)
        elif t=='setWallThickness':
            chain=next((chain for chain in g['chains'] if chain['id']==c['chainId']),None)
            if chain is None:raise ValueError('Стена не найдена')
            chain['thicknessMm']=c['thicknessMm']
            overlaps=disconnected_wall_overlaps(g,chain['id'])
            if overlaps:raise GeometryRejection([issue('physical_overlap','Толщина стены накладывается на несоединённую стену',[chain['id'],*overlaps])])
        elif t=='moveVertex':
            candidate,ok=solve(g,c,basis)
            collisions=collision_issues(basis,candidate)
            if collisions:raise GeometryRejection(collisions)
            if not ok:raise ValueError('Перемещение нарушает геометрию или фиксированные размеры')
            g=candidate
        elif t=='deleteElements':delete_elements(g,c,command_id)
        elif t=='deleteRoom':g=apply_deletion(g,dict(kind='room',topologyKey=c['topologyKey']),c['impactKey'],command_id)
        elif t=='deleteVoid':g=apply_deletion(g,dict(kind='void',voidId=c['voidId']),c['impactKey'],command_id)
        elif t=='deleteConstraint':
            if not any(x['id']==c['constraintId'] for x in g['constraints']):raise ValueError('Условие не найдено')
            remove_condition_raw(g,next(x for x in g['constraints'] if x['id']==c['constraintId']))
            g['constraints']=[x for x in g['constraints'] if x['id']!=c['constraintId']]
        elif t=='markVoid':g['voids'].append(dict(id=new_id(command_id,'void'),boundary=c['boundary']))
        elif t=='unmarkVoid':g['voids']=[v for v in g['voids'] if v['id']!=c['voidId']]
        elif t=='addTemplate':
            x,y=c['origin']['x'],c['origin']['y'];w,h=c['width'],c['height'];points=[(x,y),(x+w,y),(x+w,y+h),(x,y+h)]
            if c['shape']=='lShape':
                nw,nh=c.get('notchWidth'),c.get('notchHeight')
                if not nw or not nh or nw>=w or nh>=h:raise ValueError('Размер выреза должен быть меньше сторон заготовки')
                points=[(x,y),(x+w,y),(x+w,y+h-nh),(x+w-nw,y+h-nh),(x+w-nw,y+h),(x,y+h)]
            ids=[add_vertex(g,dict(x=p[0],y=p[1]),command_id,'template:'+str(i)) for i,p in enumerate(points)]
            for i,a in enumerate(ids):split.update(connect(g,a,{'vertexId':ids[(i+1)%len(ids)]},command_id+':'+str(i),c['thicknessMm']))
        GraphSnapshot.model_validate(g)
        collisions=collision_issues(basis,g)
        if collisions:raise GeometryRejection(collisions)
        if t not in DIMENSION and t not in ('deleteElements','deleteRoom','deleteVoid','deleteConstraint','unmarkVoid'):
            before={(e['code'],tuple(e['entityIds'])) for e in validate(basis)}
            errors=[e for e in validate(g) if (e['code'],tuple(e['entityIds'])) not in before]
            if errors:raise GeometryRejection(errors)
    except GeometryRejection as exc:
        g=copy.deepcopy(basis);split={};status='invalid';rejected=exc.issues;failure=None
    except (ValueError,KeyError,StopIteration) as exc:
        g=copy.deepcopy(basis);split={};status='invalid';failure=str(exc) or 'Проверьте выбранные элементы'
    result=inspect(g);result['status']=status
    result['issues']=rejected+result['issues']
    for err in rejected:
        err['affectedRoomKeys']=[f['topologyKey'] for f in result['faces'] if set(err['entityIds']) & set(f['dependencyIds'])]
        for f in result['faces']:
            if f['topologyKey'] in err['affectedRoomKeys']:
                f['validation']['valid']=False;f['validation']['issues'].append(err)
    if failure:result['issues'].append(issue('unresolved' if status=='unresolved' else 'command_invalid',failure,[], 'global'))
    old={x['id'] for k in ['vertices','segments','chains','voids','constraints'] for x in basis[k]};new={x['id'] for k in ['vertices','segments','chains','voids','constraints'] for x in g[k]}
    result.update(splitMap=split,addedIds=sorted(new-old),removedIds=sorted(old-new),affectedChainIds=sorted(ch['id'] for ch in g['chains'] if ch not in basis['chains']))
    return result
