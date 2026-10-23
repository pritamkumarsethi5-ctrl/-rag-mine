import type { MineMap, Snapshot } from "../types";

export interface ExitRoute { exit: string; reachable: boolean; distance_m: number; segments: string[] }

/** Dijkstra over the synthetic graph from the middle of a segment to every emergency exit.
 *  Segments that are not traversable (critical hazard, blocked, restricted) are never used. */
export function routesFromSegment(mine: MineMap, snap: Snapshot, segId: string): ExitRoute[] {
  const seg = mine.segments.find((s) => s.id === segId);
  if (!seg) return [];
  const dist = new Map<string, number>(), prev = new Map<string, { node: string; seg: string } | null>();
  const half = seg.length_m / 2;
  dist.set(seg.a, half); prev.set(seg.a, null);
  dist.set(seg.b, Math.min(dist.get(seg.b) ?? Infinity, half)); prev.set(seg.b, null);
  const todo = new Set([seg.a, seg.b]);
  while (todo.size) {
    let u = "", best = Infinity;
    todo.forEach((n) => { const d = dist.get(n)!; if (d < best) { best = d; u = n; } });
    todo.delete(u);
    for (const s of mine.segments) {
      if (s.a !== u && s.b !== u) continue;
      const live = snap.segments[s.id];
      if (!live?.traversable) continue;
      const v = s.a === u ? s.b : s.a;
      const nd = best + s.length_m;
      if (nd < (dist.get(v) ?? Infinity) - 1e-9) { dist.set(v, nd); prev.set(v, { node: u, seg: s.id }); todo.add(v); }
    }
  }
  return mine.nodes.filter((n) => n.emergency_exit).map((n) => {
    if (!dist.has(n.id)) return { exit: n.id, reachable: false, distance_m: 0, segments: [] };
    const segs: string[] = [];
    let cur = n.id;
    while (prev.get(cur)) { const p = prev.get(cur)!; segs.unshift(p.seg); cur = p.node; }
    return { exit: n.id, reachable: true, distance_m: dist.get(n.id)!, segments: [segId, ...segs] };
  }).sort((a, b) => (a.reachable === b.reachable ? a.distance_m - b.distance_m : a.reachable ? -1 : 1));
}
