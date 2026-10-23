import math

from app.mine_graph import build_default_mine


def test_graph_is_connected_and_deterministic():
    a, b = build_default_mine(), build_default_mine()
    assert a.is_connected()
    assert a.to_dict() == b.to_dict()


def test_segments_have_required_attributes():
    g = build_default_mine()
    for s in g.segments.values():
        assert s.id and s.name and s.length_m > 5 and s.width_m > 0
        assert s.a in g.nodes and s.b in g.nodes
        assert g.neighbors_of_segment(s.id), f"{s.id} has no connected segments"
    # polyline length equals the stored length
    for s in g.segments.values():
        assert math.isclose(s.length_m, sum(math.dist(p, q) for p, q in zip(s.polyline, s.polyline[1:])), rel_tol=1e-9)


def test_layout_contains_required_features():
    g = build_default_mine()
    assert len(g.dead_ends()) >= 2
    assert len(g.exits()) >= 3  # portal + two emergency exits
    assert any(n.kind == "junction" and g.degree(n.id) >= 3 for n in g.nodes.values())
    assert any(n.checkpoint for n in g.nodes.values())
    assert any(s.restricted for s in g.segments.values())
    assert any(s.kind == "main" for s in g.segments.values()) and any(s.kind == "branch" for s in g.segments.values())
    # the network contains loops (more segments than a tree would have)
    assert len(g.segments) > len(g.nodes) - 1


def test_locate_and_subpath_are_inside_segment():
    g = build_default_mine()
    s = g.segments["S03"]
    p0, _ = g.locate("S03", 0)
    p1, _ = g.locate("S03", s.length_m)
    assert p0 == s.polyline[0] and p1 == s.polyline[-1]
    sub = g.subpath("S03", 10, 40)
    assert math.isclose(sum(math.dist(a, b) for a, b in zip(sub, sub[1:])), 30, rel_tol=0.02)
    rev = g.subpath("S03", 40, 10)
    assert rev[0] == sub[-1] and rev[-1] == sub[0]


def test_distance_to_segment():
    g = build_default_mine()
    assert g.distance_to_segment("S02", 10, "S02") == 0
    d = g.distance_to_segment("S01", 0.0, "S02")
    assert math.isclose(d, g.segments["S01"].length_m, rel_tol=1e-6)
