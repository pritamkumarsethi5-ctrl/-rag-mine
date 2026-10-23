"""Movement along the mine graph, shared by the rover and the simulated workers."""
from __future__ import annotations

from .mine_graph import MineGraph, Vec3
from .routing import Leg, Route


class Traveller:
    def __init__(self, graph: MineGraph, seg_id: str, off: float) -> None:
        self.graph = graph
        self.seg = seg_id
        self.off = off
        self.dir = 1  # +1 toward segment.b, -1 toward segment.a
        self.legs: list[Leg] = []

    # ---- position -----------------------------------------------------
    def pos(self) -> Vec3:
        return self.graph.locate(self.seg, self.off)[0]

    def heading(self) -> float:
        from .mine_graph import heading_deg
        _, tan = self.graph.locate(self.seg, self.off)
        return heading_deg(tan[0] * self.dir, tan[2] * self.dir)

    def node_at(self, tol: float = 0.6) -> str | None:
        s = self.graph.segments[self.seg]
        if self.off <= tol:
            return s.a
        if self.off >= s.length_m - tol:
            return s.b
        return None

    def remaining_m(self) -> float:
        return sum(l.length for l in self.legs)

    # ---- routing --------------------------------------------------------
    def set_route(self, route: Route | None) -> None:
        self.legs = []
        if route is None or not route.found:
            return
        self.legs = [Leg(l.segment_id, l.start_offset, l.end_offset, l.to_node) for l in route.legs]
        if self.legs:
            # a route may begin at a node of a different segment: same physical point
            self.seg = self.legs[0].segment_id
            self.off = self.legs[0].start_offset
            self.dir = self.legs[0].sign

    def advance(self, dist: float) -> list[tuple[str, float, float]]:
        """Move along planned legs. Returns the (segment, lo, hi) intervals travelled."""
        covered: list[tuple[str, float, float]] = []
        while dist > 1e-9 and self.legs:
            leg = self.legs[0]
            remaining = abs(leg.end_offset - self.off)
            step = min(dist, remaining)
            new_off = self.off + leg.sign * step
            covered.append((leg.segment_id, min(self.off, new_off), max(self.off, new_off)))
            self.seg = leg.segment_id
            self.dir = leg.sign
            self.off = new_off
            dist -= step
            leg.start_offset = self.off
            if step >= remaining - 1e-9:
                self.off = leg.end_offset
                self.legs.pop(0)
                if self.legs:
                    nxt = self.legs[0]
                    self.seg, self.off = nxt.segment_id, nxt.start_offset
        return covered

    def move_free(self, dist: float, direction: int, pick_next) -> tuple[list[tuple[str, float, float]], bool]:
        """Manual driving. `pick_next(node_id, seg_id)` returns the next segment id or None.

        Returns (covered intervals, blocked_at_end).
        """
        covered: list[tuple[str, float, float]] = []
        seg_len = lambda: self.graph.segments[self.seg].length_m
        while dist > 1e-9:
            seg = self.graph.segments[self.seg]
            target = seg.length_m if direction > 0 else 0.0
            remaining = abs(target - self.off)
            step = min(dist, remaining)
            new_off = self.off + direction * step
            if step > 0:
                covered.append((self.seg, min(self.off, new_off), max(self.off, new_off)))
            self.off = new_off
            dist -= step
            if step >= remaining - 1e-9:
                node = seg.b if direction > 0 else seg.a
                nxt = pick_next(node, self.seg)
                if nxt is None:
                    return covered, True
                ns = self.graph.segments[nxt]
                self.seg = nxt
                if ns.a == node:
                    self.off, direction = 0.0, 1
                else:
                    self.off, direction = ns.length_m, -1
                self.dir = direction
        return covered, False


def add_interval(intervals: list[list[float]], lo: float, hi: float) -> None:
    """Insert [lo, hi] into a sorted list of disjoint intervals, merging overlaps."""
    if hi - lo < 1e-6:
        return
    merged: list[list[float]] = []
    placed = False
    for a, b in intervals:
        if b < lo - 0.25:
            merged.append([a, b])
        elif a > hi + 0.25:
            if not placed:
                merged.append([lo, hi])
                placed = True
            merged.append([a, b])
        else:
            lo, hi = min(lo, a), max(hi, b)
    if not placed:
        merged.append([lo, hi])
    merged.sort()
    intervals[:] = merged


def covered_length(intervals: list[list[float]]) -> float:
    return sum(b - a for a, b in intervals)
