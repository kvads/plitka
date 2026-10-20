import math
import pytest
from fastapi.testclient import TestClient
from shapely.geometry import Polygon, MultiPolygon, box
from shapely.ops import unary_union
from backend.main import app, Project
from backend.planner import prepare, calculate, optimize, dominates
from backend.planner_v5 import calculate_v5
from backend.geometry.faces import inspect

client = TestClient(app)


def test_three_rooms_share_world_grid_phase_across_wall_width():
    tile, grout, offset_x, offset_y = 200, 2, 73.2, 41.6
    layouts = []
    for left in (0, 1100, 2200):
        room = Project(outline=[(left, 0), (left + 1000, 0),
                                (left + 1000, 1000), (left, 1000)],
                       tile=tile, grout=grout, gap=0, threshold=50, angle=0)
        layouts.append(calculate_v5(room, offset_x, offset_y))
    for layout in layouts:
        assert layout["offset_x"] == offset_x
        assert layout["offset_y"] == offset_y
        assert layout["parts"]
        for part in layout["parts"]:
            polygon = Polygon(part["rings"][0], part["rings"][1:])
            assert not polygon.intersects(box(1000.1, 0.1, 1099.9, 999.9))
            assert not polygon.intersects(box(2100.1, 0.1, 2199.9, 999.9))
            if part["full"]:
                first_x = min(x for x, _ in part["rings"][0])
                first_y = min(y for _, y in part["rings"][0])
                for coordinate, offset in ((first_x, offset_x), (first_y, offset_y)):
                    phase_error = (coordinate - offset) % (tile + grout)
                    assert min(phase_error, tile + grout - phase_error) < .01


def test_physical_wall_room_uses_1900mm_inner_polygon_for_planner():
    vertices = [{"id": f"v{i}", "x": x, "y": y} for i, (x, y) in enumerate(
        [(0, 0), (2000, 0), (2000, 2000), (0, 2000)])]
    segments = [{"id": f"s{i}", "startVertexId": f"v{i}",
                 "endVertexId": f"v{(i + 1) % 4}", "chainId": f"c{i}"}
                for i in range(4)]
    chains = [{"id": f"c{i}", "startVertexId": segment["startVertexId"],
               "endVertexId": segment["endVertexId"], "segmentIds": [segment["id"]],
               "thicknessMm": 100} for i, segment in enumerate(segments)]
    graph = {"vertices": vertices, "segments": segments, "chains": chains,
             "voids": [], "constraints": [], "fieldInputs": {}}
    face = inspect(graph)["faces"][0]
    assert face["areaMm2"] == 3_610_000
    assert face["polygon"]["outline"] != face["axisPolygon"]["outline"]
    region, _ = prepare(project(outline=face["polygon"]["outline"], holes=face["polygon"]["holes"]))
    assert region.area == 3_610_000


def test_oversized_wall_room_keeps_usable_polygon_but_blocks_planning():
    import math
    count = 101
    vertices = [{"id": f"v{i}", "x": 1000 * math.cos(2 * math.pi * i / count),
                 "y": 1000 * math.sin(2 * math.pi * i / count)} for i in range(count)]
    segments = [{"id": f"s{i}", "startVertexId": f"v{i}",
                 "endVertexId": f"v{(i + 1) % count}", "chainId": f"c{i}"}
                for i in range(count)]
    chains = [{"id": f"c{i}", "startVertexId": segment["startVertexId"],
               "endVertexId": segment["endVertexId"], "segmentIds": [segment["id"]],
               "thicknessMm": 100} for i, segment in enumerate(segments)]
    graph = {"vertices": vertices, "segments": segments, "chains": chains,
             "voids": [], "constraints": [], "fieldInputs": {}}
    face = inspect(graph)["faces"][0]
    assert face["polygon"] is not None
    assert face["areaMm2"] > 0
    assert face["validation"]["valid"] is False
    assert any(item["code"] == "planner_limit" for item in face["validation"]["issues"])

def project(**kw):
    return Project(**({'outline':[(0,0),(1200,0),(1200,1200),(0,1200)],'tile':600,'gap':0,'grout':0} | kw))

def test_exact_grid():
    p=project()
    region,local=prepare(p)
    v=calculate(p,region,local,0,0)
    assert v['metrics']['full']==4
    assert v['metrics']['cut']==0
    assert v['metrics']['waste_area']==0
    assert v['metrics']['symmetry']==0

@pytest.mark.parametrize('angle',[0,17,45,89])
def test_coverage_holes_rotation_and_nonoverlap(angle):
    p=project(outline=[(0,0),(1700,0),(1700,800),(1000,800),(1000,1600),(0,1600)],holes=[[(200,200),(400,200),(400,450),(200,450)]],angle=angle,gap=10)
    region,local=prepare(p)
    v=calculate(p,region,local,77,159)
    pieces=[Polygon(part['rings'][0],part['rings'][1:]) for part in v['parts']]
    union=unary_union(pieces)
    assert region.symmetric_difference(union).area < 1e-4
    assert abs(sum(poly.area for poly in pieces)-union.area)<1e-4
    assert v['metrics']['symmetry'] is None


def test_grout_and_material_accounting():
    p=project(grout=2,gap=10)
    region,local=prepare(p)
    v=calculate(p,region,local,200,200)
    m=v['metrics']
    assert m['grout_area'] > 0
    assert abs(m['covered_area']+m['grout_area']-m['laying_area']) < .0002
    assert abs(m['waste_area']+m['covered_area']-m['tiles']*.36)<.0002
    assert m['warnings']==0


def test_periodic_offsets():
    p=project(grout=3,angle=23)
    r,l=prepare(p)
    a=calculate(p,r,l,80,90)
    b=calculate(p,r,l,683,-513)
    assert a==b


def test_disconnected_fragments_share_source():
    p=project(outline=[(0,0),(500,0),(500,500),(350,500),(350,100),(150,100),(150,500),(0,500)])
    r,l=prepare(p)
    v=calculate(p,r,l,0,200)
    assert v['metrics']['fragments']>v['metrics']['tiles']
    assert len(set(part['source'] for part in v['parts']))==v['metrics']['tiles']


def test_optimization_balances_3200_example():
    result=optimize(project(outline=[(0,0),(3200,0),(3200,3200),(0,3200)]))
    assert result['evaluated']>64
    vs=result['variants']
    assert max(v['metrics']['min_width'] for v in vs)>=400
    assert all(not dominates(a,b) for a in vs for b in vs)

@pytest.mark.parametrize('extra',[
    {'outline':[(0,0),(100,100),(0,100),(100,0)]},
    {'holes':[[(1100,1100),(1500,1100),(1500,1500),(1100,1500)]]},
    {'holes':[[(0,0),(100,0),(100,100),(0,100)]]},
    {'gap':100,'outline':[(0,0),(100,0),(100,100),(0,100)]},
    {'tile':50,'outline':[(0,0),(100000,0),(100000,100000),(0,100000)]},
    {'tile':0},
])
def test_invalid_requests(extra):
    payload=project().model_dump()|extra
    res=client.post('/api/layout',json=payload)
    assert res.status_code==422


def test_api_contract():
    assert client.get('/api/health').json()=={'status':'ok'}
    r=client.post('/api/optimize',json=project().model_dump())
    assert r.status_code==200
    assert r.json()['variants'][0]['parts']
    assert r.json()['variants'][0]['metrics']['room_area'] == 1.44


def test_v5_layout_units_and_legacy_comparison():
    payload = project().model_dump()
    old = client.post('/api/layout', json=payload)
    new = client.post('/api/v5/layout', json=payload)
    assert old.status_code == new.status_code == 200
    a = old.json()['metrics']['room_area'] * 1_000_000
    b = new.json()['metrics']['room_area']
    assert abs(a-b) <= max(100, a * 0.001)
    assert b == 1_440_000
    assert new.json()['parts'][0]['area'] > 1
    body = new.json()
    pieces = [Polygon(part['rings'][0], part['rings'][1:]) for part in body['parts']]
    assert body['metrics']['fragments'] == len(pieces)
    assert body['metrics']['tiles'] == body['metrics']['full'] + body['metrics']['cut']
    assert body['metrics']['covered_area'] == round(unary_union(pieces).area, 1)
    assert all(part['area'] == round(piece.area, 1) for part, piece in zip(body['parts'], pieces))
    assert all(value * 10 == round(value * 10) for value in [
        body['metrics'][key] for key in ('room_area', 'laying_area', 'covered_area', 'grout_area', 'waste_area', 'waste_percent')])


def test_v5_rejects_input_outside_tenth_step():
    payload = project().model_dump()
    payload['outline'][1] = [1200.01, 0]
    assert client.post('/api/v5/layout', json=payload).status_code == 422
    assert client.post('/api/v5/optimize', json=payload).status_code == 422
    assert client.post('/api/layout', json=payload).status_code == 200


def test_v5_optimizer_counts_unique_valid_offsets():
    from backend.planner_v5 import offset_ticks
    assert offset_ticks(0, 602) == offset_ticks(602, 602)
    assert offset_ticks(-602, 602) == offset_ticks(0, 602)
    response = client.post('/api/v5/optimize', json=project().model_dump())
    assert response.status_code == 200
    result = response.json()
    assert result['evaluated'] >= result['pareto_count'] >= 1
    assert result['variants']
    for variant in result['variants']:
        assert variant['metrics']['room_area'] == 1_440_000
        assert variant['metrics']['tiles'] == variant['metrics']['full'] + variant['metrics']['cut']
        assert all(part['area'] >= 0.1 for part in variant['parts'])
        assert all(part['area'] * 10 == round(part['area'] * 10) for part in variant['parts'])


def test_v5_small_positive_fragment_is_checked_before_area_filtering():
    from backend.planner_v5 import _polys, _area
    tiny = Polygon([(0, 0), (0.1, 0), (0, 0.1)])
    assert 0 < tiny.area < 0.05
    assert len(_polys(tiny)) == 1
    assert _area(0.1, 'Фрагмент плитки') == 0.1
    with pytest.raises(ValueError, match='положительная площадь'):
        _area(tiny.area, 'Фрагмент плитки')


def test_v5_offset_rounding_uses_symmetric_tenths_and_one_periodic_key():
    from backend.planner_v5 import offset_ticks
    assert offset_ticks(0.05, 602) == 1
    assert offset_ticks(-0.05, 602) == 6019
    assert offset_ticks(0, 602) == offset_ticks(602, 602) == offset_ticks(-602, 602)


def test_v5_rejects_rounded_fragment_outside_region_without_partial_layout():
    payload = project(outline=[(0, 0), (1200.1, 0), (0, 1200.1)]).model_dump()
    for route in ('/api/v5/layout', '/api/v5/optimize'):
        response = client.post(route, json=payload)
        assert response.status_code == 422
        body = response.json()
        assert list(body) == ['detail']
        assert 'фрагмент' in body['detail'].lower()
        assert '(' not in body['detail']


def test_v5_rejects_self_intersection_and_colliding_fragments_after_rounding():
    from backend.planner_v5 import _snap_geometry
    simple_before_snap = Polygon([(0, 0), (1, 0), (1, 1), (0.04, 0.04), (0, 1)])
    separated_before_snap = MultiPolygon([box(0, 0, 1, 1), box(1.04, 0, 2.04, 1)])
    assert simple_before_snap.is_valid and separated_before_snap.is_valid
    with pytest.raises(ValueError, match='контур'):
        _snap_geometry(simple_before_snap)
    with pytest.raises(ValueError, match='перекрылась'):
        _snap_geometry(separated_before_snap)


def test_v5_optimizer_skips_invalid_best_candidate_before_ranking(monkeypatch):
    from backend import planner_v5
    evaluated = []
    def candidate(_project, dx, dy, *, detail=True):
        key = (planner_v5.offset_ticks(dx, 600), planner_v5.offset_ticks(dy, 600))
        if not detail:
            evaluated.append(key)
        if key == (0, 0):
            raise ValueError('Непригодный контур плитки.')
        return {'offset_x': key[0] / 10, 'offset_y': key[1] / 10,
                'metrics': {'warnings': 0, 'min_width': 100, 'cut': 1,
                            'tiles': 4, 'symmetry': 0}}
    monkeypatch.setattr(planner_v5, 'calculate_v5', candidate)
    result = planner_v5.optimize_v5(project())
    assert len(evaluated) == len(set(evaluated))
    assert result['evaluated'] == len(evaluated) - 1
    assert result['pareto_count'] >= 1
    assert all((variant['offset_x'], variant['offset_y']) != (0, 0)
               for variant in result['variants'])
