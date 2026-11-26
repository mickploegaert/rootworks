import { Container, Sprite, Texture } from 'pixi.js';
import type { World } from '../world/World.ts';
import { TERRAIN_CHUNK, type ChunkBake, type ShadeStamp } from './TerrainBaker.ts';
import type { WorkerIn } from './terrain.worker.ts';

interface LoadedChunk { sprite: Sprite; water: { sprite: Sprite; frames: Texture[] } | null; lastSeen: number }

/** Keep at most this many baked chunks; older, off-screen ones are dropped. */
const MAX_LOADED = 72;

/**
 * Streams terrain in 16 x 16-tile chunks: bakes the ones the camera can see (nearest first) in a pool of
 * Web Workers, shows them as sprites, animates their water, and drops chunks that have been off-screen longest.
 */
export class ChunkedTerrain {
  readonly ground = new Container();
  readonly water = new Container();
  private readonly loaded = new Map<number, LoadedChunk>();
  private readonly pending = new Set<number>();
  private readonly workers: Worker[] = [];
  private readonly idle: Worker[] = [];
  private readonly across: number;
  private frameCounter = 0;
  private waiters: { keys: number[]; resolve: () => void }[] = [];

  constructor(world: World, private readonly stampsFor: (cx: number, cy: number) => ShadeStamp[]) {
    this.across = Math.ceil(world.width / TERRAIN_CHUNK);
    const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
    const data = world.exportData();
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./terrain.worker.ts', import.meta.url), { type: 'module' });
      w.postMessage({ type: 'init', world: data } satisfies WorkerIn);
      w.onmessage = (e: MessageEvent<ChunkBake>) => { this.receive(e.data); this.idle.push(w); };
      this.workers.push(w);
      this.idle.push(w);
    }
  }

  /** World-space bounding box of a chunk's pixels (approximate, for visibility tests). */
  static bounds(cx: number, cy: number) {
    const S = TERRAIN_CHUNK, x0 = cx * S, y0 = cy * S;
    return { left: (x0 - y0 - S) * 32, right: (x0 + S - y0) * 32, top: (x0 + y0) * 16 - 40, bottom: (x0 + y0 + 2 * S) * 16 + 40 };
  }

  /** Chunks whose pixels intersect a world-space rectangle, nearest to its centre first. */
  visible(rect: { x0: number; y0: number; x1: number; y1: number }): number[] {
    const out: { k: number; d: number }[] = [];
    const mx = (rect.x0 + rect.x1) / 2, my = (rect.y0 + rect.y1) / 2;
    for (let cy = 0; cy < this.across; cy++) for (let cx = 0; cx < this.across; cx++) {
      const b = ChunkedTerrain.bounds(cx, cy);
      if (b.right < rect.x0 || b.left > rect.x1 || b.bottom < rect.y0 || b.top > rect.y1) continue;
      out.push({ k: cy * this.across + cx, d: Math.hypot((b.left + b.right) / 2 - mx, (b.top + b.bottom) / 2 - my) });
    }
    return out.sort((a, b) => a.d - b.d).map((o) => o.k);
  }

  /** Call every frame with the camera's view (plus a margin). Returns the visible chunk keys. */
  update(rect: { x0: number; y0: number; x1: number; y1: number }, t: number): number[] {
    this.frameCounter++;
    const want = this.visible(rect);
    for (const k of want) {
      const c = this.loaded.get(k);
      if (c) { c.lastSeen = this.frameCounter; continue; }
      if (this.pending.has(k) || !this.idle.length) continue;
      this.request(k);
    }
    const f = Math.floor(t * 3);
    for (const c of this.loaded.values()) if (c.water) c.water.sprite.texture = c.water.frames[f % c.water.frames.length];
    if (this.loaded.size > MAX_LOADED) this.evict(new Set(want));
    return want;
  }

  /** Resolves once all chunks covering `rect` are baked (used for the first frame). */
  ready(rect: { x0: number; y0: number; x1: number; y1: number }): Promise<void> {
    const keys = this.visible(rect);
    for (const k of keys) if (!this.loaded.has(k) && !this.pending.has(k)) this.queued.push(k);
    this.pump();
    return new Promise((resolve) => { this.waiters.push({ keys, resolve }); this.checkWaiters(); });
  }

  /** Re-bake a chunk (after something that changes its ground shade, for instance). */
  invalidate(cx: number, cy: number): void {
    const k = cy * this.across + cx;
    const c = this.loaded.get(k);
    if (c) { this.drop(k, c); }
  }

  private readonly queued: number[] = [];
  private pump(): void {
    while (this.queued.length && this.idle.length) {
      const k = this.queued.shift()!;
      if (!this.loaded.has(k) && !this.pending.has(k)) this.request(k);
    }
  }

  private request(k: number): void {
    const w = this.idle.pop()!;
    const cx = k % this.across, cy = Math.floor(k / this.across);
    this.pending.add(k);
    w.postMessage({ type: 'bake', cx, cy, stamps: this.stampsFor(cx, cy) } satisfies WorkerIn);
  }

  private receive(b: ChunkBake): void {
    const k = b.cy * this.across + b.cx;
    this.pending.delete(k);
    const sprite = new Sprite(texture(b.pixels, b.w, b.h));
    sprite.position.set(b.x, b.y);
    this.ground.addChild(sprite);
    let water: LoadedChunk['water'] = null;
    if (b.water) {
      const frames = b.water.frames.map((f) => texture(f, b.water!.w, b.water!.h));
      const ws = new Sprite(frames[0]);
      ws.position.set(b.water.x, b.water.y);
      this.water.addChild(ws);
      water = { sprite: ws, frames };
    }
    this.loaded.set(k, { sprite, water, lastSeen: this.frameCounter });
    this.pump();
    this.checkWaiters();
  }

  private checkWaiters(): void {
    this.waiters = this.waiters.filter((w) => {
      if (w.keys.every((k) => this.loaded.has(k))) { w.resolve(); return false; }
      return true;
    });
  }

  private evict(keep: Set<number>): void {
    const old = [...this.loaded].filter(([k]) => !keep.has(k)).sort((a, b) => a[1].lastSeen - b[1].lastSeen);
    for (const [k, c] of old.slice(0, this.loaded.size - MAX_LOADED)) this.drop(k, c);
  }

  private drop(k: number, c: LoadedChunk): void {
    c.sprite.destroy({ texture: true, textureSource: true });
    if (c.water) { c.water.sprite.destroy(); c.water.frames.forEach((f) => f.destroy(true)); }
    this.loaded.delete(k);
  }

  /** Stop the bakers and free every baked chunk (canvas and GPU texture): leaving a region must not leave its terrain behind. */
  destroy(): void {
    this.workers.forEach((w) => w.terminate());
    for (const [k, c] of [...this.loaded]) this.drop(k, c);
  }
}

function texture(pixels: Uint8ClampedArray, w: number, h: number): Texture {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(pixels), w, h), 0, 0);
  return Texture.from(c);
}
