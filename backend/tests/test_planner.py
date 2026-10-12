import math
import pytest
from fastapi.testclient import TestClient
from shapely.geometry import Polygon
from shapely.ops import unary_union
from backend.main import app, Project
from backend.planner import prepare, calculate, optimize, dominates

client = TestClient(app)

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
