"""Route planning over the synthetic mine graph (Dijkstra).

Blocked segments are never used (except that the segment a traveller is
already standing in may be used to *leave* it). Penalised segments (e.g. gas
warning, unknown data) cost more but are reported as route warnings.
"""
from __future__ import annotations

import heapq
import math
from dataclasses import dataclass, field
from typing import Iterable

from .mine_graph import MineGraph

NO_ROUTE_MESSAGE = "NO SAFE SIMULATED ROUTE AVAILABLE."


@dataclass
class Location:
    segment_id: str | None = None
    offset: float = 0.0
    node_id: str | None = None

    @staticmethod
    def at_node(node_id: str) -> "Location":
        return Location(node_id=node_id)

    @staticmethod
    def on_segment(segment_id: str, offset: float) -> "Location":
        return Location(segment_id=segment_id, offset=offset)


@dataclass
class Leg:
    segment_id: str
    start_offset: float
    end_offset: float
    to_node: str | None

    @property
    def length(self) -> float:
        return abs(self.end_offset - self.start_offset)

    @property
    def sign(self) -> int:
        return 1 if self.end_offset >= self.start_offset else -1


@dataclass
class Route:
    found: bool
    dest_node: str
    reason: str | None = None  # None | no_safe_route | unknown_destination
    legs: list[Leg] = field(default_factory=list)
    nodes: list[str] = field(default_factory=list)
    distance_m: float = 0.0
    cost: float = math.inf
    eta_s: float = 0.0
    warnings: list[dict] = field(default_factory=list)
    instructions: list[dict] = field(default_factory=list)
    path: list[list[float]] = field(default_factory=list)

    def signature(self) -> tuple:
        return tuple((l.segment_id, l.to_node) for l in self.legs)

    def segment_ids(self) -> list[str]:
        return [l.segment_id for l in self.legs]

    def to_dict(self, include_path: bool = True) -> dict:
        d = {
            "found": self.found,
            "dest_node": self.dest_node,
            "reason": self.reason,
            "message": None if self.found else NO_ROUTE_MESSAGE,
            "distance_m": round(self.distance_m, 1),
            "eta_s": round(self.eta_s, 1),
            "nodes": self.nodes,
            "segments": [
                {"segment_id": l.segment_id, "length_m": round(l.length, 1), "to_node": l.to_node}
                for l in self.legs
            ],
            "warnings": self.warnings,
            "instructions": self.instructions,
        }
        if include_path:
            d["path"] = [[round(c, 2) for c in p] for p in self.path]
        return d


def _normalise_start(graph: MineGraph, start: Location) -> list[tuple[str, float, Leg | None]]:
    if start.node_id is not None:
        if start.node_id not in graph.nodes:
            raise KeyError(start.node_id)
        return [(start.node_id, 0.0, None)]
    assert start.segment_id is not None
    seg = graph.segments[start.segment_id]
    off = max(0.0, min(start.offset, seg.length_m))
    if off <= 0.05:
        return [(seg.a, 0.0, None)]
    if off >= seg.length_m - 0.05:
        return [(seg.b, 0.0, None)]
    return [
        (seg.a, off, Leg(seg.id, off, 0.0, seg.a)),
        (seg.b, seg.length_m - off, Leg(seg.id, off, seg.length_m, seg.b)),
    ]


def plan_route(
    graph: MineGraph,
    start: Location,
    dest_node: str,
    blocked: Iterable[str] = (),
    penalties: dict[str, tuple[float, str]] | None = None,
    speed_mps: float = 1.1,
) -> Route:
    """Shortest safe route from `start` to node `dest_node`."""
    if dest_node not in graph.nodes:
        return Route(False, dest_node, reason="unknown_destination")
    blocked_set = set(blocked)
    pen = penalties or {}
    sources = _normalise_start(graph, start)

    dist: dict[str, float] = {}
    prev: dict[str, tuple[str, str] | Leg | None] = {}
    heap: list[tuple[float, str]] = []
    for node, c0, leg in sources:
        if c0 < dist.get(node, math.inf):
            dist[node] = c0
            prev[node] = leg  # None => starts exactly at node
            heapq.heappush(heap, (c0, node))

    while heap:
        d, u = heapq.heappop(heap)
        if d > dist.get(u, math.inf):
            continue
        if u == dest_node:
            break
        for sid in graph.adj[u]:
            if sid in blocked_set:
                continue
            seg = graph.segments[sid]
            v = graph.other_end(sid, u)
            mult = pen.get(sid, (1.0, ""))[0]
            nd = d + seg.length_m * mult
            if nd < dist.get(v, math.inf) - 1e-9:
                dist[v] = nd
                prev[v] = (u, sid)
                heapq.heappush(heap, (nd, v))

    if dest_node not in dist:
        return Route(False, dest_node, reason="no_safe_route")

    # reconstruct
    legs_rev: list[Leg] = []
    nodes_rev: list[str] = [dest_node]
    cur = dest_node
    while True:
        p = prev[cur]
        if p is None:
            break
        if isinstance(p, Leg):
            legs_rev.append(p)
            break
        u, sid = p
        seg = graph.segments[sid]
        if u == seg.a:
            legs_rev.append(Leg(sid, 0.0, seg.length_m, cur))
        else:
            legs_rev.append(Leg(sid, seg.length_m, 0.0, cur))
        nodes_rev.append(u)
        cur = u
    legs = list(reversed(legs_rev))
    nodes = list(reversed(nodes_rev))

    distance = sum(l.length for l in legs)
    warnings: list[dict] = []
    seen: set[str] = set()
    for l in legs:
        if l.segment_id in pen and pen[l.segment_id][0] > 1.0 and l.segment_id not in seen:
            seen.add(l.segment_id)
            warnings.append({"segment_id": l.segment_id, "reason": pen[l.segment_id][1], "multiplier": pen[l.segment_id][0]})

    path: list[list[float]] = []
    for l in legs:
        for p in graph.subpath(l.segment_id, l.start_offset, l.end_offset):
            pt = list(p)
            if not path or path[-1] != pt:
                path.append(pt)

    route = Route(
        True, dest_node, None, legs, nodes, distance, dist[dest_node],
        distance / max(speed_mps, 0.01), warnings, [], path,
    )
    route.instructions = build_instructions(graph, route)
    return route


def plan_routes(
    graph: MineGraph,
    start: Location,
    dest_node: str,
    blocked: Iterable[str] = (),
    penalties: dict[str, tuple[float, str]] | None = None,
    speed_mps: float = 1.1,
) -> list[Route]:
    """Primary route plus (if one exists) the cheapest distinct alternate."""
    blocked_set = set(blocked)
    primary = plan_route(graph, start, dest_node, blocked_set, penalties, speed_mps)
    if not primary.found:
        return [primary]
    alts: dict[tuple, Route] = {}
    for sid in set(primary.segment_ids()):
        r = plan_route(graph, start, dest_node, blocked_set | {sid}, penalties, speed_mps)
        if r.found and r.signature() != primary.signature():
            alts.setdefault(r.signature(), r)
    if alts:
        return [primary, min(alts.values(), key=lambda r: r.cost)]
    return [primary]


def nearest_exit(
    graph: MineGraph,
    start: Location,
    blocked: Iterable[str] = (),
    penalties: dict[str, tuple[float, str]] | None = None,
    speed_mps: float = 1.1,
) -> Route:
    best: Route | None = None
    for ex in graph.exits():
        r = plan_route(graph, start, ex, blocked, penalties, speed_mps)
        if r.found and (best is None or r.cost < best.cost):
            best = r
    if best is not None:
        return best
    return Route(False, "", reason="no_safe_route")


# ---- turn-by-turn instructions derived from the real route geometry -------

def _turn_class(angle_deg: float) -> str:
    a = abs(angle_deg)
    side = "left" if angle_deg > 0 else "right"
    if a < 20:
        return "straight"
    if a < 60:
        return f"slight_{side}"
    if a < 135:
        return side
    return f"sharp_{side}"


def _dir_xz(graph: MineGraph, leg: Leg, at_end: bool) -> tuple[float, float]:
    off = leg.end_offset if at_end else leg.start_offset
    seg = graph.segments[leg.segment_id]
    # tangent a->b at this offset; nudge inside the leg so we read the right polyline piece
    probe = off - leg.sign * 0.01 if at_end else off + leg.sign * 0.01
    probe = max(0.0, min(seg.length_m, probe))
    _, tan = graph.locate(leg.segment_id, probe)
    return tan[0] * leg.sign, tan[2] * leg.sign


def instruction_text(ins: dict) -> str:
    t = ins["type"]
    d = round(ins.get("distance_m", 0))
    name = ins.get("segment_name", "")
    if t == "start":
        return f"Continue through {name} for {d} m."
    if t == "turn":
        side = ins["turn"].replace("_", " ")
        return f"Turn {side} at {ins['junction_name']} onto {name}. Continue for {d} m."
    if t == "continue":
        return f"Continue straight at {ins['junction_name']} onto {name} for {d} m."
    if t == "arrive":
        return f"Destination is ahead: {ins['node_name']}."
    if t == "reroute":
        return "Route changed because a hazard was detected."
    return ""


def build_instructions(graph: MineGraph, route: Route) -> list[dict]:
    out: list[dict] = []
    cum = 0.0
    for i, leg in enumerate(route.legs):
        seg = graph.segments[leg.segment_id]
        base = {"segment_id": seg.id, "segment_name": seg.name, "distance_m": round(leg.length, 1), "at_distance_m": round(cum, 1)}
        if i == 0:
            ins = {"type": "start", **base}
        else:
            prev_leg = route.legs[i - 1]
            jn = prev_leg.to_node or ""
            ix, iz = _dir_xz(graph, prev_leg, at_end=True)
            ox, oz = _dir_xz(graph, leg, at_end=False)
            cross = ix * oz - iz * ox
            dot = ix * ox + iz * oz
            turn = _turn_class(math.degrees(math.atan2(cross, dot)))
            ins = {
                "type": "continue" if turn == "straight" else "turn",
                "turn": turn,
                "junction_id": jn,
                "junction_name": graph.nodes[jn].name if jn in graph.nodes else jn,
                **base,
            }
        ins["text"] = instruction_text(ins)
        out.append(ins)
        cum += leg.length
    dest = graph.nodes.get(route.dest_node)
    arrive = {
        "type": "arrive", "node_id": route.dest_node, "node_name": dest.name if dest else route.dest_node,
        "distance_m": 0.0, "at_distance_m": round(cum, 1),
    }
    arrive["text"] = instruction_text(arrive)
    out.append(arrive)
    return out
