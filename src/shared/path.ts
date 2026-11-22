import type { MapDef } from './layout.js';

export interface Point {
  x: number;
  y: number;
}

/** 4-way BFS over walkable tiles. The target tile is always enterable. Returns [] if unreachable. */
export function findPath(map: MapDef, from: Point, to: Point): Point[] {
  const key = (p: Point) => p.y * map.w + p.x;
  if (from.x === to.x && from.y === to.y) return [from];
  const walk = (p: Point) => {
    if (p.x < 0 || p.y < 0 || p.x >= map.w || p.y >= map.h) return false;
    if (p.x === to.x && p.y === to.y) return true;
    return map.walkable.includes(map.rows[p.y]![p.x]!);
  };
  const prev = new Map<number, Point>();
  const seen = new Set([key(from)]);
  const queue: Point[] = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur.x === to.x && cur.y === to.y) {
      const path = [cur];
      let p = cur;
      while (key(p) !== key(from)) {
        p = prev.get(key(p))!;
        path.unshift(p);
      }
      return path;
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const n = { x: cur.x + dx, y: cur.y + dy };
      if (seen.has(key(n)) || !walk(n)) continue;
      seen.add(key(n));
      prev.set(key(n), cur);
      queue.push(n);
    }
  }
  return [];
}
