"""Canonical decimal coordinates used by the v5 project with graph API v4."""
import math


def tenth(value: float) -> float:
    if not math.isfinite(value):
        raise ValueError('Ожидается конечное число.')
    return math.copysign(math.floor(abs(value) * 10 + 0.5), value) / 10


def is_tenth(value: float) -> bool:
    scaled = value * 10
    return math.isfinite(value) and math.isclose(scaled, round(scaled),
        rel_tol=0, abs_tol=math.ulp(scaled) * 8)


def canonical_graph(graph: dict) -> dict:
    """Round shared vertices once; every segment keeps its vertex ID."""
    for vertex in graph['vertices']:
        vertex['x'] = tenth(vertex['x'])
        vertex['y'] = tenth(vertex['y'])
    return graph


def assert_graph_precision(graph: dict) -> None:
    values = [coordinate for vertex in graph['vertices'] for coordinate in (vertex['x'], vertex['y'])]
    values.extend(chain['thicknessMm'] for chain in graph['chains'])
    values.extend(constraint['value'] for constraint in graph['constraints'])
    if not all(is_tenth(value) for value in values):
        raise ValueError('Допустим не более одного знака после запятой.')
