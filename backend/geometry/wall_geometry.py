"""Physical wall areas derived from the axis graph."""

from shapely.geometry import LineString, Polygon
from math import hypot
from shapely.ops import unary_union
from shapely.geometry.polygon import orient

from .graph_validation import maps, xy


def chain_line(chain, segments, vertices):
    points = [xy(vertices[chain["startVertexId"]])]
    points.extend(xy(vertices[segments[sid]["endVertexId"]]) for sid in chain["segmentIds"])
    return LineString(points)


def wall_area(graph):
    vertices, segments, chains = maps(graph)
    bands = []
    incident = {}
    for chain in chains.values():
        line = chain_line(chain, segments, vertices)
        bands.append(line.buffer(chain["thicknessMm"] / 2, cap_style=2, join_style=2))
        points = list(line.coords)
        for origin, neighbor in ((points[0], points[1]), (points[-1], points[-2])):
            incident.setdefault(origin, []).append((neighbor, chain["thicknessMm"] / 2))

    # Flat caps are kept at free ends. At a shared endpoint, cap the joined
    # center with a mitred square so separate chains do not leave a corner
    # missing from the physical wall area.
    for origin, edges in incident.items():
        if len(edges) < 2:
            continue
        neighbor, radius = max(edges, key=lambda edge: edge[1])
        dx, dy = neighbor[0] - origin[0], neighbor[1] - origin[1]
        length = hypot(dx, dy)
        if length == 0:
            continue
        ux, uy = dx / length, dy / length
        nx, ny = -uy, ux
        bands.append(Polygon([
            (origin[0] + sx * ux * radius + sy * nx * radius,
             origin[1] + sx * uy * radius + sy * ny * radius)
            for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))
        ]))
    return unary_union(bands) if bands else Polygon()


def polygons(geometry):
    if geometry.is_empty:
        return []
    if geometry.geom_type == "Polygon":
        return [geometry]
    if geometry.geom_type == "MultiPolygon":
        return list(geometry.geoms)
    return [part for part in geometry.geoms if part.geom_type == "Polygon"]


def polygon_data(poly):
    poly = orient(poly, sign=1)
    return {
        "outline": [list(p) for p in list(poly.exterior.coords)[:-1]],
        "holes": [[list(p) for p in list(ring.coords)[:-1]] for ring in poly.interiors],
    }


def wall_area_data(graph):
    return [polygon_data(poly) for poly in polygons(wall_area(graph))]


def disconnected_wall_overlaps(graph, changed_chain_id):
    """Return walls newly touched by a chain without any topological path."""
    vertices, segments, chains = maps(graph)
    members = {
        cid: {vertex_id for sid in chain["segmentIds"]
              for vertex_id in (segments[sid]["startVertexId"], segments[sid]["endVertexId"])}
        for cid, chain in chains.items()
    }
    connected = {changed_chain_id}
    while True:
        more = {cid for cid, points in members.items()
                if cid not in connected and any(points & members[known] for known in connected)}
        if not more:
            break
        connected |= more
    changed = chains[changed_chain_id]
    band = chain_line(changed, segments, vertices).buffer(
        changed["thicknessMm"] / 2, cap_style=2, join_style=2)
    return [cid for cid, chain in chains.items() if cid not in connected and
            band.intersection(chain_line(chain, segments, vertices).buffer(
                chain["thicknessMm"] / 2, cap_style=2, join_style=2)).area > 1e-7]
