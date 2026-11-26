import type { TileRect } from '../entities/Entity.ts';
import type { EntityManager } from '../entities/EntityManager.ts';
import type { World } from './World.ts';

export interface Tile { x: number; y: number }

const DIRS: readonly Tile[] = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
/** Robots can climb or descend one elevation level per step. */
const MAX_STEP = 1;

/** Grid navigation on the 4-connected isometric tile grid. */
export class Pathfinder {
  constructor(private readonly world: World, private readonly entities: EntityManager) {}

  /** Inside the island, walkable terrain, and not covered by a blocking entity. */
  isPassable(x: number, y: number): boolean {
    return this.world.isWalkable(x, y) && this.entities.isFree(x, y);
  }

  /** Can a robot step directly between two neighbouring tiles? */
  canStep(from: Tile, to: Tile): boolean {
    return Math.abs(from.x - to.x) + Math.abs(from.y - to.y) === 1
      && this.isPassable(to.x, to.y)
      && Math.abs(this.world.heightAt(from.x, from.y) - this.world.heightAt(to.x, to.y)) <= MAX_STEP;
  }

  /** Shortest path from `from` to `to`, excluding the start tile. Null when unreachable. */
  findPath(from: Tile, to: Tile): Tile[] | null {
    if (from.x === to.x && from.y === to.y) return [];
    if (!this.isPassable(to.x, to.y)) return null;
    return this.search(from, (t) => t.x === to.x && t.y === to.y, (t) => Math.abs(t.x - to.x) + Math.abs(t.y - to.y));
  }

  /** Shortest path to any tile orthogonally adjacent to `rect`. Empty when already adjacent. */
  findPathToAdjacent(from: Tile, rect: TileRect): Tile[] | null {
    if (isAdjacent(from, rect)) return [];
    const dist = (t: Tile) => Math.max(rect.x - t.x, 0, t.x - (rect.x + rect.w - 1)) + Math.max(rect.y - t.y, 0, t.y - (rect.y + rect.d - 1));
    return this.search(from, (t) => isAdjacent(t, rect), (t) => Math.max(0, dist(t) - 1));
  }

  /** Hard cap on explored tiles, so an unreachable goal on a big map costs milliseconds, not seconds. */
  static MAX_NODES = 40_000;

  /** A* over the tile grid with a binary-heap open list. */
  private search(from: Tile, isGoal: (t: Tile) => boolean, h: (t: Tile) => number): Tile[] | null {
    const W = this.world.width;
    const key = (t: Tile) => t.y * W + t.x;
    const start = key(from);
    const g = new Map<number, number>([[start, 0]]);
    const parent = new Map<number, number>();
    const heap = new MinHeap();
    heap.push(start, h(from));
    const closed = new Set<number>();
    while (heap.size) {
      const best = heap.pop();
      if (closed.has(best)) continue;
      closed.add(best);
      if (closed.size > Pathfinder.MAX_NODES) return null;
      const cur = { x: best % W, y: Math.floor(best / W) };
      if (isGoal(cur)) {
        const path: Tile[] = [];
        for (let k = best; k !== start; k = parent.get(k)!) path.push({ x: k % W, y: Math.floor(k / W) });
        return path.reverse();
      }
      for (const d of DIRS) {
        const n = { x: cur.x + d.x, y: cur.y + d.y };
        const nk = key(n);
        if (closed.has(nk) || !this.canStep(cur, n)) continue;
        const ng = g.get(best)! + 1;
        if (ng >= (g.get(nk) ?? Infinity)) continue;
        g.set(nk, ng); parent.set(nk, best); heap.push(nk, ng + h(n));
      }
    }
    return null;
  }
}

/** Binary min-heap of (key, priority); stale duplicates are skipped by the caller's closed set. */
class MinHeap {
  private readonly keys: number[] = [];
  private readonly prio: number[] = [];
  get size(): number { return this.keys.length; }
  push(k: number, p: number): void {
    const { keys, prio } = this;
    let i = keys.push(k) - 1;
    prio.push(p);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (prio[up] <= p) break;
      keys[i] = keys[up]; prio[i] = prio[up]; i = up;
    }
    keys[i] = k; prio[i] = p;
  }
  pop(): number {
    const { keys, prio } = this;
    const top = keys[0], k = keys.pop()!, p = prio.pop()!;
    if (keys.length) {
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i, mp = p;
        if (l < keys.length && prio[l] < mp) { m = l; mp = prio[l]; }
        if (r < keys.length && prio[r] < mp) { m = r; }
        if (m === i) break;
        keys[i] = keys[m]; prio[i] = prio[m]; i = m;
      }
      keys[i] = k; prio[i] = p;
    }
    return top;
  }
}

/** Is the tile orthogonally next to (not inside) the rectangle? */
export function isAdjacent(t: Tile, r: TileRect): boolean {
  const inX = t.x >= r.x && t.x < r.x + r.w, inY = t.y >= r.y && t.y < r.y + r.d;
  return (inX && (t.y === r.y - 1 || t.y === r.y + r.d)) || (inY && (t.x === r.x - 1 || t.x === r.x + r.w));
}
