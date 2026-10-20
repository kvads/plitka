from fastapi.testclient import TestClient
from uuid import uuid4

from backend.main import app
from backend.geometry.wall_geometry import wall_area


client = TestClient(app)


def square(size=2000, thickness=100):
    vertices = [
        {"id": f"v{i}", "x": x, "y": y}
        for i, (x, y) in enumerate([(0, 0), (size, 0), (size, size), (0, size)])
    ]
    segments = [
        {"id": f"s{i}", "startVertexId": f"v{i}", "endVertexId": f"v{(i + 1) % 4}", "chainId": f"c{i}"}
        for i in range(4)
    ]
    chains = [
        {"id": f"c{i}", "startVertexId": s["startVertexId"], "endVertexId": s["endVertexId"],
         "segmentIds": [s["id"]], "thicknessMm": thickness}
        for i, s in enumerate(segments)
    ]
    return {"vertices": vertices, "segments": segments, "chains": chains,
            "voids": [], "constraints": [], "fieldInputs": {}}


def request(graph, version=4):
    return {"schemaVersion": version, "requestId": "r1", "draftRevision": 0,
            "basisKey": "", "graph": graph}


def test_v4_requires_positive_wall_thickness():
    graph = square()
    assert client.post("/api/plan/validate", json=request(graph, 3)).status_code == 422
    for value in (None, 0, -1, "wide"):
        bad = square()
        if value is None:
            del bad["chains"][0]["thicknessMm"]
        else:
            bad["chains"][0]["thicknessMm"] = value
        assert client.post("/api/plan/validate", json=request(bad)).status_code == 422


def test_v4_graph_precision_and_user_issue_text():
    precise = square()
    precise['vertices'][0]['x'] = 0.01
    assert client.post('/api/plan/validate', json=request(precise)).status_code == 422
    duplicate = square()
    duplicate['vertices'][1]['x'] = 0
    result = client.post('/api/plan/validate', json=request(duplicate))
    assert result.status_code == 200
    issues = result.json()['issues']
    collisions = [item for item in issues if item['code'] == 'coincident_vertices']
    assert collisions
    assert all('(' not in item['message'] and 'вершины v' not in item['message'].lower() for item in collisions)
    assert all(item['entityIds'] for item in collisions)


def test_diagonal_t_junction_uses_one_tenth_grid_vertex_and_rejects_overlap_atomically():
    empty = {'vertices': [], 'segments': [], 'chains': [], 'voids': [],
             'constraints': [], 'fieldInputs': {}}
    first_command = {'type': 'drawWall', 'start': {'x': -1000.1, 'y': -1000.1},
                     'end': {'x': 1000.1, 'y': 1000.1}, 'thicknessMm': 100.1}
    first = command(empty, first_command, 'diagonal').json()
    assert first['status'] == 'applied'
    branch_command = {'type': 'drawWall', 'start': {'x': 500.1, 'y': 900.1},
                      'end': {'x': 500.1, 'y': 100.1}, 'thicknessMm': 100.1}
    branch = command(first['graph'], branch_command, 'branch').json()
    assert branch['status'] == 'applied'
    graph = branch['graph']
    joint = [v for v in graph['vertices'] if v['x'] == v['y'] == 500.1]
    assert len(joint) == 1
    assert sum(joint[0]['id'] in (s['startVertexId'], s['endVertexId'])
               for s in graph['segments']) == 3
    assert all(round(v[axis] * 10) == v[axis] * 10 for v in graph['vertices'] for axis in ('x', 'y'))
    replay = command(first['graph'], branch_command, 'branch').json()
    assert replay['graph'] == graph
    assert replay['faces'] == branch['faces']
    overlap = command(graph, {'type': 'drawWall', 'start': {'x': 100, 'y': 100},
                              'end': {'x': 900, 'y': 900}, 'thicknessMm': 100}, 'overlap').json()
    assert overlap['status'] == 'invalid' and overlap['graph'] == graph
    assert overlap['issues'] and all('(' not in issue['message'] for issue in overlap['issues'])


def test_square_wall_area_and_usable_room():
    response = client.post("/api/plan/validate", json=request(square()))
    assert response.status_code == 200
    body = response.json()
    assert body["schemaVersion"] == 4
    assert body["wallArea"]
    face = body["faces"][0]
    assert face["axisPolygon"]
    assert face["areaMm2"] == 1900 * 1900
    assert wall_area(square()).area == 800_000


def test_v4_routes_keep_the_axis_contract_for_an_open_old_tab():
    graph = square()
    validated = client.post("/api/plan/validate", json=request(graph))
    assert validated.status_code == 200
    old = validated.json()
    assert old["schemaVersion"] == 4
    assert old["graph"] == graph
    assert old["faces"][0]["axisPolygon"]
    assert old["faces"][0]["areaMm2"] == 1900 * 1900

    edited = client.post("/api/plan/command", json={
        "schemaVersion": 4, "commandId": "old-tab-wall", "draftRevision": 0,
        "basisKey": "", "graph": graph,
        "command": {"type": "setWallThickness", "chainId": "c0", "thicknessMm": 150},
    })
    assert edited.status_code == 200
    assert edited.json()["schemaVersion"] == 4
    assert edited.json()["graph"]["chains"][0]["thicknessMm"] == 150

    deleted = client.post("/api/plan/deletion-preview", json={
        "schemaVersion": 4, "requestId": "old-tab-delete", "draftRevision": 0,
        "basisKey": "", "graph": graph,
        "target": {"kind": "room", "topologyKey": old["faces"][0]["topologyKey"]},
    })
    assert deleted.status_code == 200
    assert deleted.json()["schemaVersion"] == 4
    assert deleted.json()["status"] == "ready"


def test_thickness_change_can_save_invalid_room():
    graph = square()
    command = {"schemaVersion": 4, "commandId": "thick", "draftRevision": 0,
               "basisKey": "", "graph": graph,
               "command": {"type": "setWallThickness", "chainId": "c0", "thicknessMm": 5000}}
    response = client.post("/api/plan/command", json=command)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "applied"
    assert body["graph"]["chains"][0]["thicknessMm"] == 5000
    assert body["faces"][0]["polygon"] is None
    assert body["faces"][0]["areaMm2"] is None
    assert body["faces"][0]["validation"]["valid"] is False


def command(graph, value, command_id=None):
    return client.post("/api/plan/command", json={"schemaVersion": 4,
        "commandId": command_id or str(uuid4()), "draftRevision": 0, "basisKey": "",
        "graph": graph, "command": value})


def test_nudge_wall_handle_moves_one_millimeter_and_reports_shared_walls():
    graph = square()
    before = client.post("/api/plan/validate", json=request(graph)).json()
    result = command(graph, {"type": "nudgeWallHandle", "chainId": "c0",
        "handle": "end", "axis": "x", "direction": 1}).json()
    assert result["status"] == "applied"
    vertices = {v["id"]: v for v in result["graph"]["vertices"]}
    assert vertices["v1"]["x"] == 2001
    assert vertices["v0"]["x"] == 0
    assert set(result["affectedChainIds"]) == {"c0", "c1"}
    assert result["faces"][0]["areaMm2"] != before["faces"][0]["areaMm2"]
    assert result["wallArea"] != before["wallArea"]
    assert graph["vertices"][1]["x"] == 2000


def test_nudge_wall_handle_rejects_unknown_chain_and_invalid_direction():
    graph = square()
    missing = command(graph, {"type": "nudgeWallHandle", "chainId": "missing",
        "handle": "end", "axis": "x", "direction": 1}).json()
    assert missing["status"] == "invalid" and missing["graph"] == graph
    invalid = command(graph, {"type": "nudgeWallHandle", "chainId": "c0",
        "handle": "end", "axis": "x", "direction": 2})
    assert invalid.status_code == 422


def test_nudge_wall_handle_replay_is_deterministic_and_keeps_request_basis():
    graph = square()
    payload = {"schemaVersion": 4, "commandId": "nudge-repeat", "draftRevision": 7,
        "basisKey": "basis-7", "graph": graph,
        "command": {"type": "nudgeWallHandle", "chainId": "c0", "handle": "end", "axis": "x", "direction": 1}}
    first = client.post("/api/plan/command", json=payload).json()
    again = client.post("/api/plan/command", json=payload).json()
    assert first == again
    assert first["commandId"] == "nudge-repeat"
    assert first["draftRevision"] == 7 and first["basisKey"] == "basis-7"
    assert graph["vertices"][1]["x"] == 2000


def test_nudge_multisegment_wall_center_moves_junctions_but_end_keeps_interior_fixed():
    graph = {"vertices": [
        {"id": "a", "x": 0, "y": 0}, {"id": "m", "x": 1000, "y": 0},
        {"id": "b", "x": 2000, "y": 0}, {"id": "far", "x": 1000, "y": 1000}],
        "segments": [
            {"id": "s0", "startVertexId": "a", "endVertexId": "m", "chainId": "main"},
            {"id": "s1", "startVertexId": "m", "endVertexId": "b", "chainId": "main"},
            {"id": "branch", "startVertexId": "m", "endVertexId": "far", "chainId": "side"}],
        "chains": [
            {"id": "main", "startVertexId": "a", "endVertexId": "b", "segmentIds": ["s0", "s1"], "thicknessMm": 100},
            {"id": "side", "startVertexId": "m", "endVertexId": "far", "segmentIds": ["branch"], "thicknessMm": 100}],
        "voids": [], "constraints": [], "fieldInputs": {}}
    center = command(graph, {"type": "nudgeWallHandle", "chainId": "main",
        "handle": "center", "axis": "x", "direction": 1}).json()
    assert center["status"] == "applied"
    positions = {v["id"]: v for v in center["graph"]["vertices"]}
    assert [positions[id]["x"] for id in ("a", "m", "b", "far")] == [1, 1001, 2001, 1000]
    assert set(center["affectedChainIds"]) == {"main", "side"}
    invalid = command(graph, {"type": "nudgeWallHandle", "chainId": "main",
        "handle": "end", "axis": "y", "direction": 1}).json()
    assert invalid["status"] == "invalid" and invalid["graph"] == graph


def test_nudge_rejects_new_disconnected_physical_overlap_atomically():
    graph = {"vertices": [
        {"id": "a", "x": 0, "y": 0}, {"id": "b", "x": 1000, "y": 0},
        {"id": "c", "x": 0, "y": 100.5}, {"id": "d", "x": 1000, "y": 100.5}],
        "segments": [
            {"id": "s0", "startVertexId": "a", "endVertexId": "b", "chainId": "w0"},
            {"id": "s1", "startVertexId": "c", "endVertexId": "d", "chainId": "w1"}],
        "chains": [
            {"id": "w0", "startVertexId": "a", "endVertexId": "b", "segmentIds": ["s0"], "thicknessMm": 100},
            {"id": "w1", "startVertexId": "c", "endVertexId": "d", "segmentIds": ["s1"], "thicknessMm": 100}],
        "voids": [], "constraints": [], "fieldInputs": {}}
    result = command(graph, {"type": "nudgeWallHandle", "chainId": "w0",
        "handle": "center", "axis": "y", "direction": 1}).json()
    assert result["status"] == "invalid"
    assert result["graph"] == graph
    assert any(issue["code"] == "physical_overlap" for issue in result["issues"])


def test_draw_wall_first_contact_and_joined_area():
    empty = {"vertices": [], "segments": [], "chains": [], "voids": [],
             "constraints": [], "fieldInputs": {}}
    first = command(empty, {"type": "drawWall", "start": {"x": 0, "y": 0},
        "end": {"x": 1000, "y": 0}, "thicknessMm": 100}).json()
    assert first["status"] == "applied"
    assert wall_area(first["graph"]).bounds == (0, -50, 1000, 50)
    second = command(first["graph"], {"type": "drawWall",
        "start": {"x": 500, "y": 500}, "end": {"x": 500, "y": -500},
        "thicknessMm": 100}).json()
    assert second["status"] == "applied"
    assert max(v["y"] for v in second["graph"]["vertices"] if v["x"] == 500) == 500
    assert min(v["y"] for v in second["graph"]["vertices"] if v["x"] == 500) == 0
    assert len(second["wallArea"]) == 1
    assert wall_area(second["graph"]).area == 145000
    third = command(second["graph"], {"type": "drawWall",
        "start": {"x": 1000, "y": 0}, "end": {"x": 1000, "y": 1000},
        "thicknessMm": 100}).json()
    assert third["status"] == "applied"


def test_draw_wall_overlap_rejects_atomically():
    graph = square()
    result = command(graph, {"type": "drawWall", "start": {"x": 100, "y": 10},
        "end": {"x": 1500, "y": 10}, "thicknessMm": 100}).json()
    assert result["status"] == "invalid"
    assert result["graph"] == graph


def test_thickness_changes_usable_geometry_but_keeps_room_identity():
    before = client.post("/api/plan/validate", json=request(square())).json()["faces"][0]
    after = command(square(), {"type": "setWallThickness", "chainId": "c0", "thicknessMm": 200}).json()
    face = after["faces"][0]
    assert after["status"] == "applied"
    assert face["topologyKey"] == before["topologyKey"]
    assert face["geometryKey"] != before["geometryKey"]
    assert face["dependencyKey"] != before["dependencyKey"]
    assert face["areaMm2"] == 1900 * 1850


def test_wall_command_contract_rejects_missing_thickness():
    graph = square()
    for path, body in [
        ("/api/plan/command", {"commandId": "missing", "command": {
            "type": "drawWall", "start": {"x": 10, "y": 10}, "end": {"x": 20, "y": 10}}}),
        ("/api/plan/deletion-preview", {"requestId": "missing", "target": {
            "kind": "room", "topologyKey": "missing"}}),
    ]:
        missing = square()
        del missing["chains"][0]["thicknessMm"]
        assert client.post(path, json={"schemaVersion": 4, "draftRevision": 0,
            "basisKey": "", "graph": missing, **body}).status_code == 422
        assert client.post(path, json={"schemaVersion": 3, "draftRevision": 0,
            "basisKey": "", "graph": graph, **body}).status_code == 422
    room_key = client.post("/api/plan/validate", json=request(graph)).json()["faces"][0]["topologyKey"]
    preview = client.post("/api/plan/deletion-preview", json={"schemaVersion": 4,
        "requestId": "preview", "draftRevision": 0, "basisKey": "",
        "graph": graph, "target": {"kind": "room", "topologyKey": room_key}})
    assert preview.status_code == 200
    assert preview.json()["schemaVersion"] == 4


def test_ten_first_contacts_stop_at_the_existing_axis():
    empty = {"vertices": [], "segments": [], "chains": [], "voids": [],
             "constraints": [], "fieldInputs": {}}
    horizontal = command(empty, {"type": "drawWall", "start": {"x": 0, "y": 0},
        "end": {"x": 2000, "y": 0}, "thicknessMm": 100}).json()["graph"]
    for index in range(10):
        x = 100 + index * 180
        result = command(horizontal, {"type": "drawWall",
            "start": {"x": x, "y": 700}, "end": {"x": x, "y": -700},
            "thicknessMm": 100}).json()
        assert result["status"] == "applied"
        chain = result["graph"]["chains"][-1]
        end = next(v for v in result["graph"]["vertices"] if v["id"] == chain["endVertexId"])
        assert end["x"] == x and end["y"] == 0
        assert abs(wall_area(result["graph"]).area - 265000) < 1e-6
        reversed_graph = {**result["graph"], "chains": list(reversed(result["graph"]["chains"]))}
        assert abs(wall_area(reversed_graph).area - wall_area(result["graph"]).area) < 1e-6


def test_delete_preserves_other_wall_thickness():
    graph = square(thickness=175)
    result = command(graph, {"type": "deleteElements", "vertexIds": [],
        "segmentIds": ["s0"], "acknowledgedConstraintIds": []}).json()
    assert result["status"] == "applied"
    assert result["graph"]["chains"]
    assert all(chain["thicknessMm"] == 175 for chain in result["graph"]["chains"])


def test_split_delete_preserves_thickness_on_both_remainders():
    graph = {"vertices": [{"id": f"v{i}", "x": i * 1000, "y": 0} for i in range(4)],
        "segments": [{"id": f"s{i}", "startVertexId": f"v{i}",
                      "endVertexId": f"v{i+1}", "chainId": "chain"} for i in range(3)],
        "chains": [{"id": "chain", "startVertexId": "v0", "endVertexId": "v3",
                    "segmentIds": ["s0", "s1", "s2"], "thicknessMm": 175}],
        "voids": [], "constraints": [], "fieldInputs": {}}
    result = command(graph, {"type": "deleteElements", "vertexIds": [],
        "segmentIds": ["s1"], "acknowledgedConstraintIds": []}).json()
    assert result["status"] == "applied"
    assert len(result["graph"]["chains"]) == 2
    assert all(chain["thicknessMm"] == 175 for chain in result["graph"]["chains"])


def test_connect_and_template_keep_explicit_thickness():
    empty = {"vertices": [], "segments": [], "chains": [], "voids": [],
             "constraints": [], "fieldInputs": {}}
    template = command(empty, {"type": "addTemplate", "shape": "rectangle",
        "origin": {"x": 0, "y": 0}, "width": 2000, "height": 2000,
        "thicknessMm": 125}).json()
    assert template["status"] == "applied"
    assert len(template["graph"]["chains"]) == 4
    assert all(chain["thicknessMm"] == 125 for chain in template["graph"]["chains"])
    graph = template["graph"]
    graph["vertices"].append({"id": "free", "x": 1000, "y": -500})
    joined = command(graph, {"type": "connect", "fromVertexId": "free",
        "to": {"segmentId": graph["chains"][0]["segmentIds"][0], "point": {"x": 1000, "y": 0}},
        "thicknessMm": 80}).json()
    assert joined["status"] == "applied"
    assert next(chain for chain in joined["graph"]["chains"] if chain["thicknessMm"] == 80)
    assert all(chain["thicknessMm"] == 125 for chain in joined["graph"]["chains"] if chain["id"] != joined["graph"]["chains"][-1]["id"])


def test_replayed_wall_command_has_stable_ids_and_no_second_change():
    empty = {"vertices": [], "segments": [], "chains": [], "voids": [],
             "constraints": [], "fieldInputs": {}}
    draw = {"type": "drawWall", "start": {"x": 0, "y": 0},
            "end": {"x": 1000, "y": 0}, "thicknessMm": 100}
    first = command(empty, draw, "same-command").json()
    repeat = command(empty, draw, "same-command").json()
    assert first["graph"] == repeat["graph"]
    assert first["addedIds"] == repeat["addedIds"]
    assert len(first["graph"]["chains"]) == 1


def test_thickness_overlap_with_disconnected_wall_is_atomic():
    graph = {"vertices": [
        {"id": "a", "x": 0, "y": 0}, {"id": "b", "x": 1000, "y": 0},
        {"id": "c", "x": 0, "y": 1000}, {"id": "d", "x": 1000, "y": 1000}],
        "segments": [
            {"id": "s0", "startVertexId": "a", "endVertexId": "b", "chainId": "c0"},
            {"id": "s1", "startVertexId": "c", "endVertexId": "d", "chainId": "c1"}],
        "chains": [
            {"id": "c0", "startVertexId": "a", "endVertexId": "b", "segmentIds": ["s0"], "thicknessMm": 100},
            {"id": "c1", "startVertexId": "c", "endVertexId": "d", "segmentIds": ["s1"], "thicknessMm": 100}],
        "voids": [], "constraints": [], "fieldInputs": {}}
    result = command(graph, {"type": "setWallThickness", "chainId": "c0", "thicknessMm": 2000}).json()
    assert result["status"] == "invalid"
    assert result["graph"] == graph
    assert result["issues"][0]["code"] == "physical_overlap"


def test_thickness_command_rejects_invalid_values_without_graph_edit():
    graph = square()
    for value in (None, 0, -1, "thick"):
        response = command(graph, {"type": "setWallThickness", "chainId": "c0",
                                   "thicknessMm": value})
        assert response.status_code == 422
    assert all(chain["thicknessMm"] == 100 for chain in graph["chains"])
