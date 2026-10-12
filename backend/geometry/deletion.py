"""Read-only deletion planning and atomic graph cascades (no geometry solver)."""
import copy
import hashlib
import json
from .graph_models import GraphSnapshot
from .graph_validation import constraint_ids, issue, GeometryRejection, validate
from .topology import new_id
from .faces import inspect


def remove_raw(graph, ids):
    graph['fieldInputs'] = {key: value for key, value in graph['fieldInputs'].items()
                            if not any(':' + id + ':' in key for id in ids)}


def remove_condition_raw(graph, condition):
    target, kind = condition['target'], condition['kind']
    keys = set()
    if kind == 'segmentLength':keys.add('segment:' + target['segmentId'] + ':length')
    if kind == 'chainLength' and not target.get('range'):keys.add('chain:' + target['chainId'] + ':length')
    if kind == 'orientation':keys.add('chain:' + target['chainId'] + ':orientation')
    if kind == 'angle':
        ids = [s['id'] for s in graph['segments']]
        first, second = target['firstSegmentId'], target['secondSegmentId']
        if first in ids and second in ids:
            keys.add(f"vertex:{target['vertexId']}:angle-{ids.index(first)}-{ids.index(second)}-{target['sector']}")
    graph['fieldInputs'] = {k:v for k,v in graph['fieldInputs'].items() if k not in keys}
    remove_raw(graph, {condition['id']})


def cascade(basis, segment_ids, vertex_ids, command_id, remove_orphans=False):
    g = copy.deepcopy(basis)
    vertices = set(vertex_ids)
    segments = set(segment_ids) | {s['id'] for s in g['segments']
                                  if {s['startVertexId'], s['endVertexId']} & vertices}
    by_segment = {s['id']: s for s in g['segments']}
    if not segments <= by_segment.keys() or not vertices <= {v['id'] for v in g['vertices']}:
        raise ValueError('Элемент не найден')
    retired = {by_segment[id]['chainId'] for id in segments}
    survivors = [s for s in g['segments'] if s['id'] not in segments]
    if remove_orphans:
        endpoints = {by_segment[id][key] for id in segments for key in ('startVertexId', 'endVertexId')}
        used = {s[key] for s in survivors for key in ('startVertexId', 'endVertexId')}
        vertices |= endpoints - used
    affected = vertices | segments | retired
    conditions = {c['id'] for c in g['constraints'] if set(constraint_ids(c)) & affected}
    voids = {v['id'] for v in g['voids'] if any(r['segmentId'] in segments for r in v['boundary'])}
    for condition in g['constraints']:
        if condition['id'] in conditions:remove_condition_raw(g,condition)
    g['vertices'] = [v for v in g['vertices'] if v['id'] not in vertices]
    g['segments'] = survivors
    g['constraints'] = [c for c in g['constraints'] if c['id'] not in conditions]
    g['voids'] = [v for v in g['voids'] if v['id'] not in voids]
    g['chains'] = [c for c in g['chains'] if c['id'] not in retired]
    for chain in basis['chains']:
        if chain['id'] not in retired:
            continue
        groups, group = [], []
        for sid in chain['segmentIds']:
            if sid in segments:
                if group:
                    groups.append(group)
                group = []
            else:
                group.append(sid)
        if group:
            groups.append(group)
        for index, group in enumerate(groups):
            cid = new_id(command_id, f'remainder:{chain["id"]}:{index}')
            for segment in survivors:
                if segment['id'] in group:
                    segment['chainId'] = cid
            g['chains'].append(dict(id=cid, startVertexId=by_segment[group[0]]['startVertexId'],
                                    endVertexId=by_segment[group[-1]]['endVertexId'], segmentIds=group))
    remove_raw(g, affected | conditions | voids)
    GraphSnapshot.model_validate(g)
    return g, dict(segmentIds=sorted(segments), vertexIds=sorted(vertices), retiredChainIds=sorted(retired),
                   constraintIds=sorted(conditions), voidIds=sorted(voids))


def boundary_closed(graph, boundary):
    ss = {s['id']: s for s in graph['segments']}
    if len(boundary) < 3 or len({r['segmentId'] for r in boundary}) != len(boundary):
        return False
    edges = []
    for ref in boundary:
        s = ss.get(ref['segmentId'])
        if not s:
            return False
        pair = (s['startVertexId'], s['endVertexId'])
        edges.append(pair if ref['forward'] else pair[::-1])
    return all(a[1] == b[0] for a, b in zip(edges, edges[1:] + edges[:1]))


def plan_deletion(basis, target):
    before = inspect(basis)['faces']
    if target['kind'] == 'room':
        matches = [f for f in before if f['topologyKey'] == target['topologyKey']]
        face = matches[0] if len(matches)==1 else None
        if not face:
            raise GeometryRejection([issue('deletion_target_missing', 'Помещение больше не существует.', [], 'global')])
        boundary = face['outer'] + [r for hole in face['holes'] for r in hole]
    else:
        void = next((v for v in basis['voids'] if v['id'] == target['voidId']), None)
        if not void or not boundary_closed(basis, void['boundary']) or any(e['code']=='invalid_void' and target['voidId'] in e['entityIds'] for e in validate(basis)):
            raise GeometryRejection([issue('deletion_target_missing', 'Замкнутая граница отверстия не найдена. Можно снять роль отверстия.', [target['voidId']], 'global')])
        boundary = void['boundary']
    # The actual face boundary, not dependencyIds (which also contains whole chains).
    graph, impact = cascade(basis, {r['segmentId'] for r in boundary}, set(), 'deletion-preview', True)
    after = inspect(graph)['faces']
    after_keys = {f['topologyKey'] for f in after}
    deleted = set(impact['segmentIds'])
    removed = set().union(*(set(impact[k]) for k in ('segmentIds','vertexIds','retiredChainIds','constraintIds','voidIds')))
    affected = {f['topologyKey'] for f in before if any(r['segmentId'] in deleted for r in f['outer'] + [r for hole in f['holes'] for r in hole])}
    affected |= {f['topologyKey'] for f in before if removed & set(f['dependencyIds'])}
    disappeared = {f['topologyKey'] for f in before if f['topologyKey'] not in after_keys}
    impact.update(affectedRoomKeys=sorted(affected | disappeared), disappearedRoomKeys=sorted(disappeared))
    payload = json.dumps(dict(graph=basis, target=target, impact=impact), sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False)
    impact['impactKey'] = hashlib.sha256(payload.encode()).hexdigest()
    return impact


def apply_deletion(basis, target, impact_key, command_id):
    impact = plan_deletion(basis, target)
    if impact['impactKey'] != impact_key:
        raise GeometryRejection([issue('deletion_preview_stale', 'План изменился. Откройте предварительный просмотр удаления заново.', [], 'global')])
    return cascade(basis, impact['segmentIds'], impact['vertexIds'], command_id)[0]
