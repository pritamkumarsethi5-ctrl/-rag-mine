"""Synthetic, deterministic mine graph and tunnel geometry.

Coordinates: x = east (m), y = elevation (m, negative = below portal), z = north (m).
Nothing here was captured by a real scanner: it is generated geometry.
"""
from __future__ import annotations

import bisect
import math
import random
from dataclasses import dataclass, field

Vec3 = tuple[float, float, float]


def _dist(a: Vec3, b: Vec3) -> float:
    return math.dist(a, b)


@dataclass(frozen=True)
class Node:
    id: str
    name: str
    kind: str  # portal | junction | dead_end | exit
    pos: Vec3
    checkpoint: str | None = None
    emergency_exit: bool = False


@dataclass
class Segment:
    id: str
    name: str
    a: str
    b: str
    width_m: float
    zone: str
    kind: str  # main | branch
    restricted: bool
    polyline: list[Vec3]
    cum: list[float] = field(default_factory=list)
    length_m: float = 0.0

    def __post_init__(self) -> None:
        self.cum = [0.0]
        for p, q in zip(self.polyline, self.polyline[1:]):
            self.cum.append(self.cum[-1] + _dist(p, q))
        self.length_m = self.cum[-1]


def heading_deg(tx: float, tz: float) -> float:
    """Compass-style heading: 0 = north (+z), 90 = east (+x)."""
    return (math.degrees(math.atan2(tx, tz)) + 360.0) % 360.0


class MineGraph:
    def __init__(self, nodes: list[Node], segments: list[Segment]) -> None:
        self.nodes: dict[str, Node] = {n.id: n for n in nodes}
        self.segments: dict[str, Segment] = {s.id: s for s in segments}
        self.adj: dict[str, list[str]] = {n: [] for n in self.nodes}
        for s in segments:
            if s.a not in self.nodes or s.b not in self.nodes:
                raise ValueError(f"Segment {s.id} references unknown node")
            self.adj[s.a].append(s.id)
            self.adj[s.b].append(s.id)
        self._apsp: dict[str, dict[str, float]] | None = None

    # ---- topology -------------------------------------------------------
    def other_end(self, seg_id: str, node_id: str) -> str:
        s = self.segments[seg_id]
        if node_id == s.a:
            return s.b
        if node_id == s.b:
            return s.a
        raise ValueError(f"{node_id} is not an end of {seg_id}")

    def degree(self, node_id: str) -> int:
        return len(self.adj[node_id])

    def segment_between(self, u: str, v: str) -> str | None:
        for sid in self.adj[u]:
            if self.other_end(sid, u) == v:
                return sid
        return None

    def neighbors_of_segment(self, seg_id: str) -> list[str]:
        s = self.segments[seg_id]
        out: list[str] = []
        for n in (s.a, s.b):
            for sid in self.adj[n]:
                if sid != seg_id and sid not in out:
                    out.append(sid)
        return out

    def is_connected(self) -> bool:
        if not self.nodes:
            return True
        start = next(iter(self.nodes))
        seen = {start}
        stack = [start]
        while stack:
            u = stack.pop()
            for sid in self.adj[u]:
                v = self.other_end(sid, u)
                if v not in seen:
                    seen.add(v)
                    stack.append(v)
        return len(seen) == len(self.nodes)

    def total_length(self) -> float:
        return sum(s.length_m for s in self.segments.values())

    def dead_ends(self) -> list[str]:
        return [n.id for n in self.nodes.values() if n.kind == "dead_end"]

    def exits(self) -> list[str]:
        return [n.id for n in self.nodes.values() if n.emergency_exit]

    def is_dead_end_segment(self, seg_id: str) -> bool:
        s = self.segments[seg_id]
        return self.degree(s.a) == 1 or self.degree(s.b) == 1

    def node_distance(self, u: str, v: str) -> float:
        """Shortest path length over the FULL graph (ignores hazards)."""
        if self._apsp is None:
            ids = list(self.nodes)
            d = {i: {j: (0.0 if i == j else math.inf) for j in ids} for i in ids}
            for s in self.segments.values():
                d[s.a][s.b] = min(d[s.a][s.b], s.length_m)
                d[s.b][s.a] = min(d[s.b][s.a], s.length_m)
            for k in ids:
                for i in ids:
                    for j in ids:
                        if d[i][k] + d[k][j] < d[i][j]:
                            d[i][j] = d[i][k] + d[k][j]
            self._apsp = d
        return self._apsp[u][v]

    def distance_to_segment(self, seg_id: str, offset: float, target_seg: str) -> float:
        """Path distance from a point on a segment to the nearest point of target_seg."""
        if seg_id == target_seg:
            return 0.0
        s = self.segments[seg_id]
        t = self.segments[target_seg]
        off = max(0.0, min(offset, s.length_m))
        best = math.inf
        for n, d0 in ((s.a, off), (s.b, s.length_m - off)):
            for m in (t.a, t.b):
                best = min(best, d0 + self.node_distance(n, m))
        return best

    # ---- geometry -------------------------------------------------------
    def locate(self, seg_id: str, offset: float) -> tuple[Vec3, Vec3]:
        """Return (position, unit tangent a->b) at `offset` metres along a segment."""
        s = self.segments[seg_id]
        off = max(0.0, min(offset, s.length_m))
        i = bisect.bisect_right(s.cum, off) - 1
        i = max(0, min(i, len(s.polyline) - 2))
        p, q = s.polyline[i], s.polyline[i + 1]
        seg_len = s.cum[i + 1] - s.cum[i]
        u = 0.0 if seg_len <= 0 else (off - s.cum[i]) / seg_len
        pos = (p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u, p[2] + (q[2] - p[2]) * u)
        n = _dist(p, q) or 1.0
        tan = ((q[0] - p[0]) / n, (q[1] - p[1]) / n, (q[2] - p[2]) / n)
        return pos, tan

    def subpath(self, seg_id: str, start: float, end: float) -> list[Vec3]:
        """Polyline points between two offsets (direction follows start -> end)."""
        s = self.segments[seg_id]
        lo, hi = (start, end) if start <= end else (end, start)
        pts: list[Vec3] = [self.locate(seg_id, lo)[0]]
        for off, p in zip(s.cum, s.polyline):
            if lo + 1e-6 < off < hi - 1e-6:
                pts.append(p)
        pts.append(self.locate(seg_id, hi)[0])
        if start > end:
            pts.reverse()
        return pts

    # ---- serialisation --------------------------------------------------
    def to_dict(self) -> dict:
        return {
            "simulated": True,
            "total_length_m": round(self.total_length(), 1),
            "connected": self.is_connected(),
            "nodes": [
                {
                    "id": n.id, "name": n.name, "kind": n.kind, "pos": list(n.pos),
                    "checkpoint": n.checkpoint, "emergency_exit": n.emergency_exit,
                    "degree": self.degree(n.id),
                }
                for n in self.nodes.values()
            ],
            "segments": [
                {
                    "id": s.id, "name": s.name, "a": s.a, "b": s.b,
                    "length_m": round(s.length_m, 1), "width_m": s.width_m,
                    "zone": s.zone, "kind": s.kind, "restricted": s.restricted,
                    "polyline": [[round(c, 2) for c in p] for p in s.polyline],
                    "connected_segments": self.neighbors_of_segment(s.id),
                    "dead_end": self.is_dead_end_segment(s.id),
                }
                for s in self.segments.values()
            ],
        }


def _build_polyline(a: Vec3, b: Vec3, rng: random.Random, step: float = 10.0) -> list[Vec3]:
    d = _dist(a, b)
    n = max(2, round(d / step))
    phase = rng.uniform(0, 2 * math.pi)
    amp = min(3.5, d * 0.035)
    dx, dz = b[0] - a[0], b[2] - a[2]
    norm = math.hypot(dx, dz) or 1.0
    px, pz = -dz / norm, dx / norm
    pts: list[Vec3] = []
    for i in range(n + 1):
        u = i / n
        lat = amp * math.sin(math.pi * u) * math.sin(phase + u * 3.0)
        pts.append((
            a[0] + dx * u + px * lat,
            a[1] + (b[1] - a[1]) * u,
            a[2] + dz * u + pz * lat,
        ))
    pts[0], pts[-1] = a, b
    return pts


def build_default_mine(seed: int = 7) -> MineGraph:
    """Deterministic synthetic mine: main tunnel, branches, loops, dead ends and exits."""
    nodes = [
        Node("PORTAL", "Portal (Main Entrance)", "portal", (0.0, 0.0, 0.0), checkpoint="CP-01", emergency_exit=True),
        Node("J-01", "Junction J-01", "junction", (70.0, -6.0, 10.0), checkpoint="CP-02"),
        Node("J-02", "Junction J-02", "junction", (140.0, -14.0, 0.0)),
        Node("J-03", "Junction J-03", "junction", (210.0, -22.0, -15.0), checkpoint="CP-03"),
        Node("J-04", "Junction J-04", "junction", (280.0, -30.0, -10.0)),
        Node("DE-01", "Dead End DE-01", "dead_end", (350.0, -38.0, 5.0)),
        Node("J-05", "Junction J-05", "junction", (75.0, -12.0, 70.0)),
        Node("J-09", "Junction J-09", "junction", (145.0, -18.0, 75.0)),
        Node("DE-02", "Dead End DE-02 (Old Workings)", "dead_end", (60.0, -20.0, 135.0)),
        Node("J-06", "Junction J-06", "junction", (130.0, -22.0, -60.0), checkpoint="CP-04"),
        Node("X-02", "Emergency Exit X-02 (Shaft)", "exit", (115.0, -6.0, -120.0), emergency_exit=True),
        Node("J-07", "Junction J-07", "junction", (215.0, -28.0, 55.0)),
        Node("J-08", "Junction J-08", "junction", (285.0, -34.0, 45.0)),
        Node("X-03", "Emergency Exit X-03 (Raise Bore)", "exit", (270.0, -24.0, 115.0), emergency_exit=True),
    ]
    spec = [
        # id, name, a, b, width, zone, kind, restricted
        ("S01", "Main Tunnel A (Portal Drift)", "PORTAL", "J-01", 5.0, "Main", "main", False),
        ("S02", "Main Tunnel B", "J-01", "J-02", 5.0, "Main", "main", False),
        ("S03", "Main Tunnel C", "J-02", "J-03", 5.0, "Main", "main", False),
        ("S04", "Main Tunnel D", "J-03", "J-04", 5.0, "Main", "main", False),
        ("S05", "Main Tunnel E (Dead End)", "J-04", "DE-01", 4.5, "Main", "main", False),
        ("S06", "North Branch 1", "J-01", "J-05", 4.0, "North", "branch", False),
        ("S07", "North Cross-cut", "J-05", "J-09", 4.0, "North", "branch", False),
        ("S08", "North Link", "J-09", "J-02", 4.0, "North", "branch", False),
        ("S09", "Old Workings (Restricted)", "J-05", "DE-02", 3.5, "North", "branch", True),
        ("S10", "South Branch", "J-02", "J-06", 4.0, "South", "branch", False),
        ("S11", "South Exit Drift", "J-06", "X-02", 3.5, "South", "branch", False),
        ("S12", "East Branch", "J-03", "J-07", 4.0, "East", "branch", False),
        ("S13", "East Cross-cut", "J-07", "J-08", 3.5, "East", "branch", False),
        ("S14", "East Link", "J-08", "J-04", 3.5, "East", "branch", False),
        ("S15", "East Raise Drift", "J-07", "X-03", 3.5, "East", "branch", False),
        ("S16", "North-East Link", "J-09", "J-07", 3.5, "East", "branch", False),
    ]
    by_id = {n.id: n for n in nodes}
    segs: list[Segment] = []
    for sid, name, a, b, w, zone, kind, restricted in spec:
        rng = random.Random(f"{seed}-{sid}")
        poly = _build_polyline(by_id[a].pos, by_id[b].pos, rng)
        segs.append(Segment(sid, name, a, b, w, zone, kind, restricted, poly))
    return MineGraph(nodes, segs)
