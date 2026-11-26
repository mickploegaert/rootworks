import { Container, Sprite } from 'pixi.js';
import { HEIGHT_UNIT, TILE_H, TILE_W, tileToWorld } from '../core/iso.ts';
import { hash2, makeRng } from '../core/noise.ts';
import { TileType, type World } from '../world/World.ts';
import type { SpriteLibrary } from './SpriteLibrary.ts';

interface Mote { s: Sprite; x: number; y: number; ph: number; sp: number }
interface Twinkle { s: Sprite; x: number; y: number; ph: number; period: number }
interface Butterfly { s: Sprite; frames: Sprite['texture'][]; x: number; y: number; ph: number; r: number }

/**
 * World-wide atmosphere: drifting cloud shadows, pollen by day and fireflies by night,
 * butterflies over the flower fields, and sparkles on the water.
 */
export class AmbientFx {
  /** Drawn above entities. */
  readonly top = new Container();
  /** Drawn right above the ground, under entities. */
  readonly ground = new Container();
  private readonly clouds: { s: Sprite; vx: number; vy: number }[] = [];
  private readonly motes: Mote[] = [];
  private readonly twinkles: Twinkle[] = [];
  private readonly butterflies: Butterfly[] = [];
  private readonly span: number;

  constructor(lib: SpriteLibrary, world: World, waterTiles: { x: number; y: number }[]) {
    const rnd = makeRng(99);
    const N = world.width;
    this.span = N * TILE_W;
    const cx = 0, cy = (N * TILE_H) / 2;

    for (let i = 0; i < 3; i++) {
      const s = new Sprite(lib.clouds[i % 2]);
      s.anchor.set(0.5); s.scale.set(2 + i * 0.5); s.alpha = 0.14;
      s.position.set(cx + (rnd() - 0.5) * this.span * 0.8, cy + (rnd() - 0.5) * this.span * 0.4);
      this.clouds.push({ s, vx: 9 + rnd() * 6, vy: 4 + rnd() * 3 });
      this.top.addChild(s);
    }
    for (let i = 0; i < 60; i++) {
      const s = new Sprite(lib.mote);
      s.anchor.set(0.5); s.blendMode = 'add';
      const x = cx + (rnd() - 0.5) * this.span * 0.7, y = cy + (rnd() - 0.5) * this.span * 0.35;
      this.motes.push({ s, x, y, ph: rnd() * 6.28, sp: 0.4 + rnd() * 0.8 });
      this.top.addChild(s);
    }
    // butterflies live where the flowers are: meadow and flower-field tiles
    const homes: { x: number; y: number }[] = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (world.get(x, y) === TileType.Grass && world.biomeAt(x, y) === 'flowers') homes.push({ x, y });
    for (let i = 0; i < Math.min(14, homes.length); i++) {
      const h = homes[Math.floor(rnd() * homes.length)], c = tileToWorld(h.x, h.y);
      const frames = lib.butterflies[i % lib.butterflies.length];
      const s = new Sprite(frames[0]);
      s.anchor.set(0.5);
      this.butterflies.push({ s, frames, x: c.x, y: c.y - world.heightAt(h.x, h.y) * HEIGHT_UNIT - 14, ph: rnd() * 20, r: 18 + rnd() * 26 });
      this.top.addChild(s);
    }
    for (const t of waterTiles) {
      if (hash2(t.x, t.y, 3) > 0.55) continue;
      const c = tileToWorld(t.x, t.y), lift = world.heightAt(t.x, t.y) * HEIGHT_UNIT;
      const s = new Sprite(lib.glint);
      s.anchor.set(0.5); s.blendMode = 'add'; s.scale.set(0.7);
      this.twinkles.push({ s, x: c.x + (hash2(t.x, t.y, 4) - 0.5) * 36, y: c.y - lift + (hash2(t.x, t.y, 5) - 0.5) * 14, ph: hash2(t.x, t.y, 6) * 6, period: 2 + hash2(t.x, t.y, 7) * 3 });
      this.ground.addChild(s);
    }
  }

  /** `night` is 0 in daylight and 1 at midnight. */
  update(t: number, dt: number, night: number): void {
    for (const c of this.clouds) {
      c.s.x += c.vx * dt; c.s.y += c.vy * dt;
      if (c.s.x > this.span * 0.7) { c.s.x -= this.span * 1.4; c.s.y -= this.span * 0.15; }
      if (c.s.y > this.span * 0.7) c.s.y -= this.span * 0.55;
      c.s.alpha = 0.14 * (1 - night);
    }
    // the same particles are pollen in daylight and fireflies after dusk
    for (const m of this.motes) {
      const k = t * m.sp + m.ph;
      m.s.position.set(m.x + Math.sin(k * 0.7) * 26, m.y + Math.cos(k) * 14 - ((t * 4 * m.sp) % 20));
      const blink = Math.max(0, Math.sin(k * 2.1));
      m.s.alpha = (0.18 + 0.4 * blink) * (1 - night) + night * blink * blink;
      m.s.scale.set(1 + night * 0.6);
    }
    for (const b of this.butterflies) {
      const k = t * 0.5 + b.ph;
      b.s.position.set(b.x + Math.sin(k) * b.r + Math.sin(k * 2.7) * 6, b.y + Math.sin(k * 1.3) * b.r * 0.4 + Math.abs(Math.sin(t * 6 + b.ph)) * -3);
      b.s.texture = b.frames[Math.floor(t * 9 + b.ph) % 2];
      b.s.alpha = 1 - night;
    }
    for (const w of this.twinkles) {
      const p = ((t + w.ph) % w.period) / w.period;
      w.s.position.set(w.x, w.y);
      w.s.alpha = p < 0.25 ? Math.sin((p / 0.25) * Math.PI) * 0.9 * (1 - night * 0.6) : 0;
    }
  }
}
