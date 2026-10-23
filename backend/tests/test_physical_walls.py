"""Contract checks for the physical graph as it is introduced in stages."""

from fastapi.testclient import TestClient

from backend.main import app
from backend.geometry.physical_models import PhysicalGraphV5
from backend.geometry.physical_validation import canonical_basis_key, validate_physical_graph
from backend.geometry.physical_geometry import create_wall
from backend.geometry.physical_commands import execute_physical
from backend.geometry.physical_models import PhysicalPoint
from backend.geometry.physical_junctions import simple_contact, polygon
from backend.geometry.physical_measurements import face_measurements
from shapely.geometry import Polygon
from shapely.geometry import Point as ShapelyPoint
import pytest


client = TestClient(app)


def test_room_measurements_ignore_straight_junction_vertices():
    angles, dimensions = face_measurements([
        [0, 0], [50, 0], [1000, 0], [1000, 500],
        [1000, 1000], [0, 1000], [0, 500],
    ])

    assert len(angles) == 4
    assert {item["valueDeg"] for item in angles} == {90}
    assert len(dimensions) == 4
    assert [item["valueMm"] for item in dimensions] == [1000] * 4


def saved_wall():
    return {
        "walls": [{
            "id": "w1",
            "drawnEdge": [{"x": 0, "y": 0}, {"x": 1000, "y": 0}],
            "side": "left",
            "thicknessMm": 100,
            "corners": [
                {"x": 0, "y": 0}, {"x": 1000, "y": 0},
                {"x": 1000, "y": 100}, {"x": 0, "y": 100},
            ],
        }],
        "junctions": [],
        "openings": [],
    }


def request(graph):
    try:
        basis = canonical_basis_key(PhysicalGraphV5.model_validate(graph))
    except ValueError:
        basis = "invalid-graph"
    return {"schemaVersion": 5, "requestId": "saved-wall",
            "draftRevision": 2, "basisKey": basis, "graph": graph}


def command_request(graph):
    return {key: value for key, value in request(graph).items() if key != "requestId"}


def test_open_partition_keeps_one_room_and_excludes_wall_from_tile_layout():
    graph = {"walls": [], "junctions": []}
    walls = [
        ([(0, 0), (1000, 0)], "right"),
        ([(1000, 0), (1000, 1000)], "left"),
        ([(1000, 1000), (0, 1000)], "right"),
        ([(0, 1000), (0, 0)], "left"),
        ([(100, 500), (500, 500)], "left"),
    ]
    for index, (edge, side) in enumerate(walls):
        body = client.post("/api/v5/plan/command", json={
            **command_request(graph), "commandId": f"open-partition-{index}",
            "command": {"type": "drawWall", "drawnEdge": [
                {"x": x, "y": y} for x, y in edge],
                "side": side, "thicknessMm": 100},
        }).json()
        assert body["status"] == "applied", body.get("issues")
        graph = body["graph"]
    assert len(body["faces"]) == 1
    face = body["faces"][0]
    assert face["areaMm2"] == 760000
    layout = client.post("/api/v5/layout", json={
        **face["polygon"], "tile": 200, "grout": 2, "gap": 0,
        "threshold": 50, "angle": 0, "offset_x": 0, "offset_y": 0,
    })
    assert layout.status_code == 200, layout.text
    wall = Polygon([(100, 500), (500, 500), (500, 600), (100, 600)])
    for part in layout.json()["parts"]:
        assert Polygon(part["rings"][0], part["rings"][1:]).intersection(wall).area == 0


def test_saved_physical_wall_validates_before_draw_wall_exists():
    for graph, area_count in [({"walls": [], "junctions": [], "openings": []}, 0),
                              (saved_wall(), 1)]:
        result = client.post("/api/v5/plan/validate", json=request(graph))
        assert result.status_code == 200
        body = result.json()
        assert body["schemaVersion"] == 5
        assert body["status"] == "valid"
        assert body["graph"] == graph
        assert body["draftRevision"] == 2
        assert body["basisKey"] == request(graph)["basisKey"]
        assert len(body["wallArea"]) == area_count
        assert body["faces"] == body["openJointAngles"] == []


def test_door_opening_cuts_only_its_wall_and_can_be_resized_and_deleted():
    graph = saved_wall()
    added = client.post("/api/v5/plan/command", json={
        **command_request(graph), "commandId": "front-door",
        "command": {"type": "addDoorOpening", "wallId": "w1",
                    "offsetMm": 500, "widthMm": 800},
    }).json()
    assert added["status"] == "applied", added["issues"]
    assert added["graph"]["openings"] == [{
        "id": "door-front-door", "wallId": "w1", "offsetMm": 500, "widthMm": 800,
    }]
    assert len(added["wallArea"]) == 2
    assert sum(Polygon(area["outline"], area["holes"]).area
               for area in added["wallArea"]) == 20000

    resized = client.post("/api/v5/plan/command", json={
        **command_request(added["graph"]), "commandId": "resize-door",
        "command": {"type": "setDoorWidth", "openingId": "door-front-door",
                    "widthMm": 600},
    }).json()
    assert resized["status"] == "applied", resized["issues"]
    assert resized["graph"]["openings"][0]["widthMm"] == 600

    deleted = client.post("/api/v5/plan/command", json={
        **command_request(resized["graph"]), "commandId": "delete-door",
        "command": {"type": "deleteDoorOpening", "openingId": "door-front-door"},
    }).json()
    assert deleted["status"] == "applied"
    assert deleted["graph"]["openings"] == []
    assert len(deleted["wallArea"]) == 1


def test_internal_door_connects_two_rooms_and_splits_threshold_area_between_them():
    graph = {"walls": [], "junctions": [], "openings": []}
    walls = [
        ([(0, 0), (1200, 0)], "right"),
        ([(1200, 0), (1200, 1000)], "left"),
        ([(1200, 1000), (0, 1000)], "right"),
        ([(0, 1000), (0, 0)], "left"),
        ([(600, 0), (600, 1000)], "left"),
    ]
    for index, (edge, side) in enumerate(walls):
        result = client.post("/api/v5/plan/command", json={
            **command_request(graph), "commandId": f"door-room-{index}",
            "command": {"type": "drawWall", "drawnEdge": [
                {"x": x, "y": y} for x, y in edge],
                "side": side, "thicknessMm": 100},
        }).json()
        assert result["status"] == "applied", result["issues"]
        graph = result["graph"]
    before = sorted(face["areaMm2"] for face in result["faces"])
    opened = client.post("/api/v5/plan/command", json={
        **command_request(graph), "commandId": "between-rooms",
        "command": {"type": "addDoorOpening", "wallId": "wall-door-room-4",
                    "offsetMm": 500, "widthMm": 800},
    }).json()
    assert opened["status"] == "applied", opened["issues"]
    assert len(opened["faces"]) == 2
    assert sorted(face["areaMm2"] for face in opened["faces"]) == [
        before[0] + 40000, before[1] + 40000]
    assert all(len(face["connectedRoomKeys"]) == 1 and
               face["doorIds"] == ["door-between-rooms"]
               for face in opened["faces"])
    assert {face["connectedRoomKeys"][0] for face in opened["faces"]} == {
        face["topologyKey"] for face in opened["faces"]}


def test_physical_model_rejects_axes_and_invalid_stored_corners():
    bad = saved_wall()
    bad["vertices"] = []
    assert client.post("/api/v5/plan/validate", json=request(bad)).status_code == 422
    bad = saved_wall()
    bad["walls"][0]["corners"][2]["y"] = 100.01
    result = client.post("/api/v5/plan/validate", json=request(bad))
    assert result.status_code == 200
    assert result.json()["status"] == "invalid"
    assert result.json()["graph"] == bad


def test_physical_basis_is_independent_of_graph_list_order():
    wall = saved_wall()["walls"][0]
    other = {**wall, "id": "w2"}
    first = PhysicalGraphV5.model_validate({"walls": [wall, other], "junctions": []})
    second = PhysicalGraphV5.model_validate({"walls": [other, wall], "junctions": []})
    validate_physical_graph(first)
    assert canonical_basis_key(first) == canonical_basis_key(second)


def test_stored_diagonal_wall_keeps_quantized_width():
    diagonal = {
        "walls": [{
            "id": "diagonal",
            "drawnEdge": [{"x": 2000, "y": 0}, {"x": 3000, "y": 1000}],
            "side": "left", "thicknessMm": 100,
            "corners": [{"x": 2000, "y": 0}, {"x": 3000, "y": 1000},
                        {"x": 2929.3, "y": 1070.7}, {"x": 1929.3, "y": 70.7}],
        }], "junctions": [],
    }
    result = client.post("/api/v5/plan/validate", json=request(diagonal))
    assert result.status_code == 200
    assert result.json()["status"] == "valid"
    assert result.json()["wallArea"][0]["outline"] == [
        [2000, 0], [3000, 1000], [2929.3, 1070.7], [1929.3, 70.7]]


def test_invalid_physical_command_is_atomic():
    graph = saved_wall()
    result = client.post("/api/v5/plan/command", json={
        "schemaVersion": 5, "commandId": "not-yet", "draftRevision": 3,
        "basisKey": "fixture-basis", "graph": graph,
        "command": {"type": "drawWall", "drawnEdge": [
            {"x": 0, "y": 50}, {"x": 1000, "y": 50}],
            "side": "left", "thicknessMm": 100},
    })
    assert result.status_code == 200
    body = result.json()
    assert body["schemaVersion"] == 5
    assert body["status"] == "invalid"
    assert body["graph"] == graph
    assert body["draftRevision"] == 3


def test_draw_wall_preview_and_commit_share_a_seamless_t_joint():
    original = saved_wall()
    edge = [{"x": 500, "y": -500}, {"x": 500, "y": 50}]
    preview = client.post("/api/v5/plan/preview", json={
        **request(original), "requestId": "joint-one", "drawnEdge": edge,
        "side": "left", "thicknessMm": 150,
    }).json()
    committed = client.post("/api/v5/plan/command", json={
        **command_request(original), "commandId": "joint-one",
        "command": {"type": "drawWall", "drawnEdge": edge,
                    "side": "left", "thicknessMm": 150},
    }).json()
    assert preview["status"] == "valid"
    assert committed["status"] == "applied"
    assert preview["graph"] == committed["graph"]
    assert preview["wallArea"] == committed["wallArea"]
    assert len(committed["wallArea"]) == 1
    new = committed["graph"]["walls"][1]
    assert new["drawnEdge"][1] == {"x": 500, "y": 0}
    assert new["corners"] == [
        {"x": 500, "y": -500}, {"x": 500, "y": 0},
        {"x": 350, "y": 0}, {"x": 350, "y": -500},
    ]
    joint = committed["graph"]["junctions"][0]
    assert joint["id"] == "joint-joint-one"
    assert {p["wallId"] for p in joint["participants"]} == {"w1", "wall-joint-one"}
    assert len(committed["openJointAngles"]) == 4
    assert all(item["valueDeg"] == 90 and item["label"] == "Угол стыка"
               for item in committed["openJointAngles"])
    assert client.post("/api/v5/plan/validate", json=request(committed["graph"])).json()["status"] == "valid"


def test_draw_wall_forms_one_l_outline_at_the_outer_corner():
    graph = saved_wall()
    body = client.post("/api/v5/plan/command", json={
        **command_request(graph), "commandId": "l-corner",
        "command": {"type": "drawWall", "drawnEdge": [
            {"x": 100, "y": -500}, {"x": 100, "y": 100}],
            "side": "right", "thicknessMm": 100},
    }).json()
    assert body["status"] == "applied"
    assert len(body["wallArea"]) == 1
    assert body["wallArea"][0]["holes"] == []
    assert body["graph"]["walls"][1]["drawnEdge"][1] == {"x": 100, "y": 0}


def test_l_junction_redefines_both_wall_caps_on_one_shared_miter():
    graph = saved_wall()
    body = client.post("/api/v5/plan/command", json={
        **command_request(graph), "commandId": "shared-l-miter",
        "command": {"type": "drawWall", "drawnEdge": [
            {"x": 1000, "y": 0}, {"x": 1000, "y": 500}],
            "side": "left", "thicknessMm": 100},
    }).json()

    assert body["status"] == "applied", body["issues"]
    horizontal, vertical = body["graph"]["walls"]
    shared_cap = [{"x": 1000, "y": 0}, {"x": 900, "y": 100}]
    assert [horizontal["corners"][1], horizontal["corners"][2]] == shared_cap
    assert [vertical["corners"][0], vertical["corners"][3]] == shared_cap
    assert horizontal["drawnEdge"][1] == {"x": 1000, "y": 0}
    assert vertical["drawnEdge"][0] == {"x": 1000, "y": 0}
    assert [part["edge"] for part in body["graph"]["junctions"][0]["participants"]] == [
        "endCap", "startCap"]
    assert len(body["wallArea"]) == 1


def test_wall_can_join_an_existing_l_corner_without_stale_junction_data():
    graph = {"walls": [], "junctions": [], "openings": []}
    for command_id, edge in [
        ("occupied-corner-vertical", [(450, 150), (450, 950)]),
        ("occupied-corner-bottom", [(450, 950), (900, 950)]),
    ]:
        result = client.post("/api/v5/plan/command", json={
            **command_request(graph), "commandId": command_id,
            "command": {"type": "drawWall", "drawnEdge": [
                {"x": x, "y": y} for x, y in edge],
                "side": "right", "thicknessMm": 50},
        }).json()
        assert result["status"] == "applied", result["issues"]
        graph = result["graph"]

    old_joint_id = graph["junctions"][0]["id"]
    joined = client.post("/api/v5/plan/command", json={
        **command_request(graph), "commandId": "join-occupied-corner",
        "command": {"type": "drawWall", "drawnEdge": [
            {"x": 100, "y": 900}, {"x": 500, "y": 900}],
            "side": "left", "thicknessMm": 50},
    }).json()

    assert joined["status"] == "applied", joined["issues"]
    assert len(joined["graph"]["junctions"]) == 3
    repaired = next(item for item in joined["graph"]["junctions"]
                    if item["id"] == old_joint_id)
    assert {part["point"]["y"] for part in repaired["participants"]} == {900}
    validated = client.post("/api/v5/plan/validate",
                            json=request(joined["graph"])).json()
    assert validated["status"] == "valid", validated["issues"]


def test_l_junction_rebuilds_both_caps_after_thickness_change():
    joined = client.post("/api/v5/plan/command", json={
        **command_request(saved_wall()), "commandId": "resize-l-source",
        "command": {"type": "drawWall", "drawnEdge": [
            {"x": 1000, "y": 0}, {"x": 1000, "y": 500}],
            "side": "left", "thicknessMm": 100},
    }).json()["graph"]

    for wall_id in ("w1", "wall-resize-l-source"):
        changed = client.post("/api/v5/plan/command", json={
            **command_request(joined), "commandId": "resize-l-" + wall_id,
            "command": {"type": "setWallThickness", "wallId": wall_id,
                        "thicknessMm": 150},
        }).json()
        assert changed["status"] == "applied", changed["issues"]
        first, second = changed["graph"]["walls"]
        assert [first["corners"][1], first["corners"][2]] == [
            second["corners"][0], second["corners"][3]]
        assert first["corners"][1] != first["corners"][2]


def test_validation_normalizes_saved_square_l_caps_to_shared_miter():
    horizontal = create_wall("old-horizontal", [PhysicalPoint(x=0, y=0),
        PhysicalPoint(x=1000, y=0)], "left", 100)
    vertical = create_wall("old-vertical", [PhysicalPoint(x=1000, y=100),
        PhysicalPoint(x=1000, y=500)], "left", 100)
    joint = simple_contact(horizontal, vertical, "old-square-corner")
    assert joint is not None
    old = PhysicalGraphV5(walls=[horizontal, vertical], junctions=[joint])

    body = client.post("/api/v5/plan/validate", json=request(old.model_dump())).json()

    assert body["status"] == "valid"
    first, second = body["normalizedGraph"]["walls"]
    assert [first["corners"][1], first["corners"][2]] == [
        second["corners"][0], second["corners"][3]]
    assert first["corners"][1] != first["corners"][2]
    assert body["normalizedGraph"]["junctions"][0]["id"] == "old-square-corner"


def test_collinear_wall_continuation_joins_both_physical_end_caps():
    graph = saved_wall()
    result = client.post("/api/v5/plan/command", json={
        **command_request(graph), "commandId": "continue-wall",
        "command": {"type": "drawWall", "drawnEdge": [
            {"x": 1000, "y": 0}, {"x": 1500, "y": 0}],
            "side": "left", "thicknessMm": 100},
    }).json()
    assert result["status"] == "applied", result["issues"]
    assert len(result["wallArea"]) == 1
    assert [part["edge"] for part in result["graph"]["junctions"][0]["participants"]] == [
        "endCap", "startCap"]
    assert len(result["wallArea"][0]["outline"]) == 6


def test_draw_wall_can_keep_its_thickness_default_and_stable_command_id():
    base = {"walls": [], "junctions": []}
    command = {"type": "drawWall", "drawnEdge": [
        {"x": 0, "y": 0}, {"x": 1000, "y": 0}], "side": "right"}
    body = {**command_request(base), "commandId": "stable", "command": command}
    first = client.post("/api/v5/plan/command", json=body).json()
    second = client.post("/api/v5/plan/command", json=body).json()
    assert first == second
    assert first["status"] == "applied"
    assert first["graph"]["walls"][0]["thicknessMm"] == 100
    assert first["graph"]["walls"][0]["corners"][2] == {"x": 1000, "y": -100}


def test_set_wall_thickness_keeps_drawn_edge_and_rejects_bad_input_atomically():
    graph = saved_wall()
    command = {"type": "setWallThickness", "wallId": "w1", "thicknessMm": 150}
    result = client.post("/api/v5/plan/command", json={
        **command_request(graph), "commandId": "thicker", "command": command,
    }).json()
    assert result["status"] == "applied"
    wall = result["graph"]["walls"][0]
    assert wall["drawnEdge"] == graph["walls"][0]["drawnEdge"]
    assert wall["corners"][2:] == [{"x": 1000, "y": 150}, {"x": 0, "y": 150}]
    command["thicknessMm"] = 100000.1
    rejected = client.post("/api/v5/plan/command", json={
        **command_request(graph), "commandId": "bad", "command": command,
    }).json()
    assert rejected["status"] == "invalid"
    assert rejected["graph"] == graph


def test_thickness_change_recomputes_contact_point_with_stable_junction_id():
    initial = saved_wall()
    joined = client.post("/api/v5/plan/command", json={
        **command_request(initial), "commandId": "join-thickness",
        "command": {"type": "drawWall", "drawnEdge": [
            {"x": 500, "y": -500}, {"x": 500, "y": 0}],
            "side": "left", "thicknessMm": 100},
    }).json()["graph"]
    old_joint = joined["junctions"][0]
    changed = client.post("/api/v5/plan/command", json={
        **command_request(joined), "commandId": "thicker-joined",
        "command": {"type": "setWallThickness", "wallId": "wall-join-thickness",
                    "thicknessMm": 150},
    }).json()
    assert changed["status"] == "applied", changed["issues"]
    assert changed["graph"]["junctions"][0]["id"] == old_joint["id"]
    assert changed["graph"]["junctions"][0]["participants"][0]["point"] != old_joint["participants"][0]["point"]


def test_nudge_wall_handle_moves_only_requested_endpoint_or_both():
    graph = saved_wall()
    for handle, expected in [
        ("start", [{"x": 1, "y": 0}, {"x": 1000, "y": 0}]),
        ("end", [{"x": 0, "y": 0}, {"x": 1001, "y": 0}]),
        ("center", [{"x": 1, "y": 0}, {"x": 1001, "y": 0}]),
    ]:
        response = client.post("/api/v5/plan/command", json={
            **command_request(graph), "commandId": f"move-{handle}",
            "command": {"type": "nudgeWallHandle", "wallId": "w1",
                        "handle": handle, "axis": "x", "direction": 1},
        }).json()
        assert response["status"] == "applied", response["issues"]
        assert response["graph"]["walls"][0]["drawnEdge"] == expected


def test_invalid_nudge_is_atomic_and_can_be_followed_by_valid_nudge():
    graph = saved_wall()
    invalid = client.post("/api/v5/plan/command", json={
        **command_request(graph), "commandId": "bad-nudge",
        "command": {"type": "nudgeWallHandle", "wallId": "w1",
                    "handle": "center", "axis": "x", "direction": 2},
    }).json()
    assert invalid["status"] == "invalid"
    assert invalid["graph"] == graph
    valid = client.post("/api/v5/plan/command", json={
        **command_request(graph), "commandId": "good-nudge",
        "command": {"type": "nudgeWallHandle", "wallId": "w1",
                    "handle": "center", "axis": "x", "direction": 1},
    }).json()
    assert valid["status"] == "applied"


def test_center_nudge_moves_the_attached_branch_and_keeps_junction_id():
    base = saved_wall()
    joined = client.post("/api/v5/plan/command", json={
        **command_request(base), "commandId": "join-for-nudge",
        "command": {"type": "drawWall", "drawnEdge": [
            {"x": 500, "y": -500}, {"x": 500, "y": 0}],
            "side": "left", "thicknessMm": 100},
    }).json()["graph"]
    moved = client.post("/api/v5/plan/command", json={
        **command_request(joined), "commandId": "nudge-connected",
        "command": {"type": "nudgeWallHandle", "wallId": "w1",
                    "handle": "center", "axis": "y", "direction": 1},
    }).json()
    assert moved["status"] == "applied", moved["issues"]
    assert moved["graph"]["walls"][0]["drawnEdge"][0]["y"] == 1
    assert moved["graph"]["walls"][1]["drawnEdge"][1]["y"] == 1
    assert moved["graph"]["junctions"][0]["id"] == joined["junctions"][0]["id"]


def test_parallel_overlap_is_not_mistaken_for_a_local_joint():
    graph = saved_wall()
    for edge in (
        [{"x": 0, "y": 50}, {"x": 1000, "y": 50}],
        [{"x": 100, "y": 0}, {"x": 900, "y": 0}],
    ):
        result = client.post("/api/v5/plan/command", json={
            **command_request(graph), "commandId": "overlap", "command": {
                "type": "drawWall", "drawnEdge": edge,
                "side": "left", "thicknessMm": 100},
        }).json()
        assert result["status"] == "invalid"
        assert result["graph"] == graph


def test_diagonal_cap_allows_only_local_contact_wedge():
    graph = saved_wall()
    result = client.post("/api/v5/plan/command", json={
        **command_request(graph), "commandId": "diagonal-wedge",
        "command": {"type": "drawWall", "drawnEdge": [
            {"x": 0, "y": -500}, {"x": 500, "y": 0}],
            "side": "left", "thicknessMm": 100},
    }).json()
    assert result["status"] == "applied", result["issues"]
    assert len(result["graph"]["junctions"]) == 1
    assert len(result["wallArea"]) == 1


def test_diagonal_contact_extends_short_outer_edge_to_receiving_wall():
    graph = saved_wall()
    edge = [{"x": 100, "y": -500}, {"x": 600, "y": 20}]
    preview = client.post("/api/v5/plan/preview", json={
        **request(graph), "requestId": "diagonal-join", "drawnEdge": edge,
        "side": "right", "thicknessMm": 100,
    }).json()
    committed = client.post("/api/v5/plan/command", json={
        **command_request(graph), "commandId": "diagonal-join",
        "command": {"type": "drawWall", "drawnEdge": edge,
                    "side": "right", "thicknessMm": 100},
    }).json()
    assert preview["status"] == "valid", preview["issues"]
    assert committed["status"] == "applied", committed["issues"]
    assert preview["graph"] == committed["graph"]
    wall = committed["graph"]["walls"][1]
    assert wall["drawnEdge"][1]["y"] == 0
    assert wall["corners"][2]["y"] == 0
    assert len(committed["graph"]["junctions"]) == 1
    assert len(committed["wallArea"]) == 1
    assert committed["openJointAngles"][0]["valueDeg"] > 0
    assert client.post("/api/v5/plan/validate", json=request(committed["graph"])).json()["status"] == "valid"


def test_joint_angles_follow_two_free_corners_of_diagonal_wall():
    graph = saved_wall()
    result = client.post("/api/v5/plan/command", json={
        **command_request(graph), "commandId": "diagonal-corners",
        "command": {"type": "drawWall", "drawnEdge": [
            {"x": 100, "y": -500}, {"x": 600, "y": 0}],
            "side": "right", "thicknessMm": 100},
    }).json()
    assert result["status"] == "applied", result["issues"]
    labels = [angle for angle in result["openJointAngles"]
              if angle["wallId"] == "wall-diagonal-corners"]
    assert sorted(angle["valueDeg"] for angle in labels) == [45, 135]
    assert labels[0]["anchor"] != labels[1]["anchor"]
    assert labels[0]["corner"] != labels[1]["corner"]
    assert all(angle["corner"]["y"] == 0 for angle in labels)


def test_diagonal_wall_started_on_a_face_connects_both_width_corners():
    graph = saved_wall()
    result = client.post("/api/v5/plan/command", json={
        **command_request(graph), "commandId": "diagonal-start",
        "command": {"type": "drawWall", "drawnEdge": [
            {"x": 500, "y": 0}, {"x": 1000, "y": -500}],
            "side": "right", "thicknessMm": 100},
    }).json()
    assert result["status"] == "applied", result["issues"]
    new = result["graph"]["walls"][1]
    assert new["drawnEdge"][0]["y"] == 0
    assert new["corners"][3]["y"] == 0
    assert len(result["graph"]["junctions"]) == 1
    assert sorted(angle["valueDeg"] for angle in result["openJointAngles"]
                  if angle["wallId"] == new["id"]) == [45, 135]
    assert client.post("/api/v5/plan/validate", json=request(result["graph"])).json()["status"] == "valid"


def test_slanted_branch_stores_both_cap_vertices_on_vertical_wall_face():
    host = create_wall("host-vertical", [PhysicalPoint(x=0, y=0),
        PhysicalPoint(x=0, y=1000)], "right", 100)
    graph = PhysicalGraphV5(walls=[host], junctions=[])
    result, _ = execute_physical(graph, {"type": "drawWall", "drawnEdge": [
        {"x": 100, "y": 500}, {"x": 600, "y": 800}],
        "side": "left", "thicknessMm": 100}, "angled-vertical")
    branch = result.walls[1]
    assert branch.corners[0].x == branch.corners[3].x == 100
    assert branch.corners[0].y != branch.corners[3].y
    assert polygon(branch).intersection(polygon(host)).area == 0
    assert len(result.junctions) == 1
    validate_physical_graph(result)
    resized, _ = execute_physical(result, {"type": "setWallThickness",
        "wallId": branch.id, "thicknessMm": 110}, "resize-angled-vertical")
    assert resized.walls[1].corners[0].x == resized.walls[1].corners[3].x == 100
    validate_physical_graph(resized)


def test_validation_repairs_a_saved_rectangular_cap_overlap():
    host = create_wall("host-vertical", [PhysicalPoint(x=0, y=0),
        PhysicalPoint(x=0, y=1000)], "right", 100)
    branch = create_wall("old-branch", [PhysicalPoint(x=100, y=500),
        PhysicalPoint(x=600, y=800)], "left", 100)
    joint = simple_contact(host, branch, "old-joint")
    assert joint is not None
    old = PhysicalGraphV5(walls=[host, branch], junctions=[joint])
    body = client.post("/api/v5/plan/validate", json=request(old.model_dump())).json()
    assert body["status"] == "valid"
    fixed = PhysicalGraphV5.model_validate(body["normalizedGraph"])
    assert fixed.walls[1].corners[0].x == fixed.walls[1].corners[3].x == 100
    assert fixed.junctions[0].id == "old-joint"
    validate_physical_graph(fixed)
    again = client.post("/api/v5/plan/validate", json=request(fixed.model_dump())).json()
    assert "normalizedGraph" not in again


def test_new_wall_thickness_uses_ten_millimeter_steps():
    for value in (0.1, 55, 105.5, 100010):
        drawn = client.post("/api/v5/plan/command", json={
            **command_request({"walls": [], "junctions": []}),
            "commandId": f"bad-width-{value}",
            "command": {"type": "drawWall", "drawnEdge": [
                {"x": 0, "y": 0}, {"x": 1000, "y": 0}],
                "side": "left", "thicknessMm": value},
        }).json()
        assert drawn["status"] == "invalid"
        resized = client.post("/api/v5/plan/command", json={
            **command_request(saved_wall()), "commandId": f"bad-resize-{value}",
            "command": {"type": "setWallThickness", "wallId": "w1",
                        "thicknessMm": value},
        }).json()
        assert resized["status"] == "invalid"


def test_malformed_thickness_is_atomic_in_physical_command():
    graph = saved_wall()
    result = client.post("/api/v5/plan/command", json={
        **command_request(graph), "commandId": "malformed",
        "command": {"type": "setWallThickness", "wallId": "w1", "thicknessMm": "150"},
    })
    assert result.status_code == 200
    assert result.json()["status"] == "invalid"
    assert result.json()["graph"] == graph


def test_stale_physical_basis_rejects_without_mutating_graph():
    graph = saved_wall()
    response = client.post("/api/v5/plan/command", json={
        **command_request(graph), "basisKey": "stale", "commandId": "stale-command",
        "command": {"type": "setWallThickness", "wallId": "w1", "thicknessMm": 150},
    }).json()
    assert response["status"] == "invalid"
    assert response["graph"] == graph
    assert response["draftRevision"] == 2


def test_physical_deletion_preview_and_command_remove_wall_and_joint_atomically():
    initial = saved_wall()
    joined = client.post("/api/v5/plan/command", json={
        **command_request(initial), "commandId": "join-for-delete",
        "command": {"type": "drawWall", "drawnEdge": [
            {"x": 500, "y": -500}, {"x": 500, "y": 0}],
            "side": "left", "thicknessMm": 100},
    }).json()["graph"]
    preview = client.post("/api/v5/plan/deletion-preview", json={
        **request(joined), "target": {"kind": "wall", "wallId": "wall-join-for-delete"},
    }).json()
    assert preview["status"] == "ready"
    assert preview["graph"] == joined
    assert preview["impact"]["wallIds"] == ["wall-join-for-delete"]
    assert preview["impact"]["junctionIds"] == ["joint-join-for-delete"]
    applied = client.post("/api/v5/plan/command", json={
        **command_request(joined), "commandId": "delete-one",
        "command": {"type": "deleteWall", "wallId": "wall-join-for-delete"},
    }).json()
    assert applied["status"] == "applied"
    assert applied["graph"] == initial


def test_four_physical_walls_can_form_one_closed_free_area():
    specs = [
        ("bottom", ((0, 0), (1000, 0)), "right"),
        ("right", ((1000, 0), (1000, 1000)), "left"),
        ("top", ((1000, 1000), (0, 1000)), "right"),
        ("left", ((0, 1000), (0, 0)), "left"),
    ]
    walls = [create_wall(name, [PhysicalPoint(x=x, y=y) for x, y in edge], side, 100)
             for name, edge, side in specs]
    joints = [joint for index, wall in enumerate(walls)
              for other in walls[index + 1:]
              if (joint := simple_contact(wall, other, f"joint-{wall.id}-{other.id}"))]
    assert len(joints) == 4
    graph = PhysicalGraphV5(walls=walls, junctions=joints)
    validate_physical_graph(graph)
    response = client.post("/api/v5/plan/validate", json=request(graph.model_dump(mode="json"))).json()
    assert response["status"] == "valid"
    assert len(response["wallArea"]) == 1
    assert len(response["wallArea"][0]["holes"]) == 1
    assert len(response["faces"]) == 1
    assert response["faces"][0]["areaMm2"] == 800000
    assert len(response["faces"][0]["innerAngles"]) == 4
    assert all(item["valueDeg"] == 90 for item in response["faces"][0]["innerAngles"])
    floor = Polygon(response["faces"][0]["polygon"]["outline"])
    occupied = [Polygon([(p.x, p.y) for p in wall.corners]) for wall in walls]
    for angle in response["faces"][0]["innerAngles"]:
        anchor = ShapelyPoint(angle["anchor"]["x"], angle["anchor"]["y"])
        assert floor.covers(anchor)
        assert all(not wall.contains(anchor) for wall in occupied)


def test_room_identity_stays_stable_when_usable_area_changes():
    specs = [
        (((0, 0), (1000, 0)), "right"),
        (((1000, 0), (1000, 1000)), "left"),
        (((1000, 1000), (0, 1000)), "right"),
        (((0, 1000), (0, 0)), "left"),
    ]
    graph = {"walls": [], "junctions": []}
    for index, (edge, side) in enumerate(specs):
        response = client.post("/api/v5/plan/command", json={
            **command_request(graph), "commandId": f"room-{index}",
            "command": {"type": "drawWall", "drawnEdge": [
                {"x": x, "y": y} for x, y in edge], "side": side, "thicknessMm": 100},
        }).json()
        assert response["status"] == "applied", response["issues"]
        graph = response["graph"]
    original = response["faces"][0]
    changed = client.post("/api/v5/plan/command", json={
        **command_request(graph), "commandId": "room-thicker",
        "command": {"type": "setWallThickness", "wallId": "wall-room-1",
                    "thicknessMm": 150},
    }).json()
    assert changed["status"] == "applied", changed["issues"]
    updated = changed["faces"][0]
    assert updated["topologyKey"] == original["topologyKey"]
    assert updated["geometryKey"] != original["geometryKey"]
    assert updated["areaMm2"] == original["areaMm2"] - 50000
    assert sorted(item["valueMm"] for item in response["faces"][0]["freeDimensions"]) == [800, 800, 1000, 1000]
    floor = Polygon(response["faces"][0]["polygon"]["outline"])
    from shapely.geometry import Point as FloorPoint
    assert all(floor.covers(FloorPoint(item["anchor"]["x"], item["anchor"]["y"]))
               for item in response["faces"][0]["innerAngles"] + response["faces"][0]["freeDimensions"])


def test_four_draw_commands_close_a_physical_room():
    graph = {"walls": [], "junctions": []}
    walls = [
        ([(0, 0), (1000, 0)], "right"),
        ([(1000, 0), (1000, 1000)], "left"),
        ([(1000, 1000), (0, 1000)], "right"),
        ([(0, 1000), (0, 0)], "left"),
    ]
    for index, (edge, side) in enumerate(walls):
        response = client.post("/api/v5/plan/command", json={
            **command_request(graph), "commandId": f"room-{index}",
            "command": {"type": "drawWall", "drawnEdge": [
                {"x": x, "y": y} for x, y in edge],
                "side": side, "thicknessMm": 100},
        }).json()
        assert response["status"] == "applied", response["issues"]
        graph = response["graph"]
    assert len(graph["walls"]) == 4
    assert len(graph["junctions"]) == 4
    assert len(response["faces"]) == 1
    assert response["faces"][0]["areaMm2"] == 800000


@pytest.mark.parametrize("start,end,side,width", [
    ((0, 0), (1000, 0), "left", 100),
    ((0, 0), (1000, 0), "right", 150),
    ((200, 300), (1200, 1300), "left", 100),
    ((200, 300), (1200, 1300), "right", 150),
])
def test_four_corners_are_derived_from_visible_edge(start, end, side, width):
    points = [PhysicalPoint(x=x, y=y) for x, y in (start, end)]
    wall = create_wall("wall", points, side, width)
    assert wall.corners[:2] == points
    assert all(round(value * 10) == value * 10 for point in wall.corners
               for value in (point.x, point.y))
    assert Polygon([(p.x, p.y) for p in wall.corners]).area > 0
    validate_physical_graph(PhysicalGraphV5(walls=[wall], junctions=[]))
    assert create_wall("wall", points, side, width) == wall


def test_wall_rejects_zero_length_and_out_of_range_thickness():
    edge = [PhysicalPoint(x=0, y=0), PhysicalPoint(x=0, y=0)]
    with pytest.raises(ValueError):
        create_wall("wall", edge, "left", 100)
    edge[1] = PhysicalPoint(x=1000, y=0)
    for width in (0, 100000.1, 100.01):
        with pytest.raises(ValueError):
            create_wall("wall", edge, "left", width)
