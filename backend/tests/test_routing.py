import math

from app.mine_graph import build_default_mine
from app.routing import NO_ROUTE_MESSAGE, Location, nearest_exit, plan_route, plan_routes

G = build_default_mine()


def test_shortest_route_matches_graph_distance():
    r = plan_route(G, Location.at_node("PORTAL"), "J-04")
    assert r.found
    assert math.isclose(r.distance_m, G.node_distance("PORTAL", "J-04"), rel_tol=1e-6)
    assert r.nodes[0] == "PORTAL" and r.nodes[-1] == "J-04"


def test_route_from_mid_segment_uses_correct_offsets():
    start = Location.on_segment("S02", 20.0)
    r = plan_route(G, start, "J-02")
    assert r.found
    assert math.isclose(r.distance_m, G.segments["S02"].length_m - 20.0, rel_tol=1e-6)
    assert r.legs[0].segment_id == "S02" and r.legs[0].sign == 1


def test_blocked_segment_is_never_used():
    base = plan_route(G, Location.at_node("PORTAL"), "J-04")
    for sid in base.segment_ids():
        r = plan_route(G, Location.at_node("PORTAL"), "J-04", blocked={sid})
        assert (not r.found) or sid not in r.segment_ids()


def test_blocked_main_tunnel_reroutes_through_loop():
    r = plan_route(G, Location.at_node("J-02"), "J-03", blocked={"S03"})
    assert r.found and "S03" not in r.segment_ids()
    assert r.distance_m > G.segments["S03"].length_m


def test_no_safe_route_when_destination_cut_off():
    r = plan_route(G, Location.at_node("PORTAL"), "X-02", blocked={"S11"})
    assert not r.found and r.reason == "no_safe_route"
    assert r.to_dict()["message"] == NO_ROUTE_MESSAGE == "NO SAFE SIMULATED ROUTE AVAILABLE."


def test_restricted_area_is_avoided_by_callers_blocking_it():
    restricted = {s.id for s in G.segments.values() if s.restricted}
    r = plan_route(G, Location.at_node("J-05"), "DE-02", blocked=restricted)
    assert not r.found


def test_hazard_penalty_prefers_other_route_but_warns_when_unavoidable():
    base = plan_route(G, Location.at_node("J-02"), "J-03")
    assert base.segment_ids() == ["S03"]
    pen = {"S03": (10.0, "gas_warning")}
    r = plan_route(G, Location.at_node("J-02"), "J-03", penalties=pen)
    assert "S03" not in r.segment_ids()
    only = plan_route(G, Location.at_node("J-04"), "DE-01", penalties={"S05": (3.0, "gas_warning")})
    assert only.found and only.warnings and only.warnings[0]["segment_id"] == "S05"


def test_worker_standing_in_blocked_segment_can_leave_but_not_reenter():
    r = plan_route(G, Location.on_segment("S03", 30.0), "PORTAL", blocked={"S03"})
    assert r.found
    assert r.legs[0].segment_id == "S03"  # leaving the hazard
    assert "S03" not in r.segment_ids()[1:]


def test_alternate_route_is_distinct():
    rs = plan_routes(G, Location.at_node("J-01"), "J-03")
    assert len(rs) == 2 and rs[0].signature() != rs[1].signature() and rs[1].distance_m >= rs[0].distance_m


def test_nearest_exit_and_blocked_exit():
    r = nearest_exit(G, Location.on_segment("S11", 30.0))
    assert r.found and r.dest_node == "X-02"
    r2 = nearest_exit(G, Location.at_node("J-06"), blocked={"S11"})
    assert r2.found and r2.dest_node != "X-02"
    allb = nearest_exit(G, Location.at_node("DE-01"), blocked=set(G.segments))
    assert not allb.found


def test_unknown_destination():
    assert plan_route(G, Location.at_node("PORTAL"), "NOPE").reason == "unknown_destination"


def test_instructions_are_derived_from_geometry():
    r = plan_route(G, Location.at_node("PORTAL"), "J-04")
    ins = r.instructions
    assert ins[0]["type"] == "start" and ins[-1]["type"] == "arrive"
    assert [i["segment_id"] for i in ins[:-1]] == r.segment_ids()
    assert math.isclose(sum(i["distance_m"] for i in ins), r.distance_m, abs_tol=0.5 * len(ins))
    for i in ins[1:-1]:
        assert i["type"] in ("turn", "continue") and i["junction_name"]
    # reversing the route flips every turn direction
    back = plan_route(G, Location.at_node("J-04"), "PORTAL").instructions
    flip = {"left": "right", "right": "left", "slight_left": "slight_right", "slight_right": "slight_left",
            "sharp_left": "sharp_right", "sharp_right": "sharp_left", "straight": "straight"}
    fwd_turns = [i["turn"] for i in ins[1:-1]]
    back_turns = [i["turn"] for i in back[1:-1]]
    assert [flip[t] for t in reversed(fwd_turns)] == back_turns


def test_route_path_is_continuous_polyline():
    r = plan_route(G, Location.at_node("PORTAL"), "X-03")
    assert r.found and len(r.path) > 5
    assert math.isclose(sum(math.dist(a, b) for a, b in zip(r.path, r.path[1:])), r.distance_m, rel_tol=0.02)
