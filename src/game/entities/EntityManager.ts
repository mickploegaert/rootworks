import { Emitter } from '../core/Emitter.ts';
import type { Entity, EntityKind } from './Entity.ts';
import { Robot } from './Robot.ts';

/** Chunk edge in tiles for the spatial index (matches the renderer's terrain chunks). */
export const CHUNK = 16;

/**
 * All entities, indexed three ways: by id, by occupied tile (blocking footprints), and by chunk and
 * kind, so rendering, picking and per-tick updates never scan the whole world.
 */
export class EntityManager {
  readonly events = new Emitter<{ added: Entity; removed: Entity }>();
  private readonly byId = new Map<number, Entity>();
  private readonly occupied = new Map<number, Entity>();
  private readonly chunks = new Map<number, Set<Entity>>();
  private readonly kinds = new Map<EntityKind, Set<Entity>>();
  private readonly chunksAcross: number;

  constructor(private readonly width: number) {
    this.chunksAcross = Math.ceil(width / CHUNK);
  }

  private key(x: number, y: number) { return y * this.width + x; }
  chunkKey(cx: number, cy: number): number { return cy * this.chunksAcross + cx; }
  private chunkOf(e: Entity): number { return this.chunkKey(Math.floor(e.tileX / CHUNK), Math.floor(e.tileY / CHUNK)); }

  get count(): number { return this.byId.size; }
  has(e: Entity): boolean { return this.byId.get(e.id) === e; }
  list(): IterableIterator<Entity> { return this.byId.values(); }

  /** Entities whose reference tile lies in chunk (cx, cy). Robots are not chunk-indexed (they move). */
  inChunk(cx: number, cy: number): ReadonlySet<Entity> { return this.chunks.get(this.chunkKey(cx, cy)) ?? EMPTY; }

  ofKind<T extends Entity>(kind: EntityKind): T[] { return [...(this.kinds.get(kind) ?? EMPTY)] as T[]; }

  /** True when no blocking entity covers any tile of the rectangle. (Depleted deposits no longer block.) */
  isFree(x: number, y: number, w = 1, d = 1): boolean {
    for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) if (this.occupied.get(this.key(x + i, y + j))?.blocking) return false;
    return true;
  }

  /** Adds the entity; returns false if its footprint is already taken. */
  add(e: Entity): boolean {
    if (e.blocking) {
      if (!this.isFree(e.tileX, e.tileY, e.width, e.depth)) return false;
      for (let i = 0; i < e.width; i++) for (let j = 0; j < e.depth; j++) this.occupied.set(this.key(e.tileX + i, e.tileY + j), e);
    }
    this.byId.set(e.id, e);
    if (!(e instanceof Robot)) setAdd(this.chunks, this.chunkOf(e), e);
    setAdd(this.kinds, e.kind, e);
    this.events.emit('added', e);
    return true;
  }

  remove(e: Entity): void {
    if (!this.byId.delete(e.id)) return;
    for (let i = 0; i < e.width; i++) for (let j = 0; j < e.depth; j++) {
      const k = this.key(e.tileX + i, e.tileY + j);
      if (this.occupied.get(k) === e) this.occupied.delete(k);
    }
    this.chunks.get(this.chunkOf(e))?.delete(e);
    this.kinds.get(e.kind)?.delete(e);
    this.events.emit('removed', e);
  }

  /** Entity standing on a tile: a structure, deposit or plant first, then any robot. */
  at(x: number, y: number): Entity | undefined {
    const blocker = this.occupied.get(this.key(x, y));
    if (blocker) return blocker;
    for (const e of this.kinds.get('robot') ?? EMPTY) if (e.tileX === x && e.tileY === y) return e;
    // non-blocking things (plants, depleted deposits) are found through their chunk
    for (const e of this.inChunk(Math.floor(x / CHUNK), Math.floor(y / CHUNK))) {
      if (x >= e.tileX && x < e.tileX + e.width && y >= e.tileY && y < e.tileY + e.depth) return e;
    }
    return undefined;
  }

  /** Only robots have per-tick behaviour today; scenery is skipped. */
  update(dt: number): void {
    for (const e of this.kinds.get('robot') ?? EMPTY) e.update(dt);
  }
}

const EMPTY: ReadonlySet<Entity> = new Set();

function setAdd<K>(m: Map<K, Set<Entity>>, k: K, e: Entity): void {
  let s = m.get(k);
  if (!s) m.set(k, (s = new Set()));
  s.add(e);
}
