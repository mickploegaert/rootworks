import type { Container } from 'pixi.js';
import type { Vec2 } from '../core/iso.ts';

/** Integer zoom steps keep every art pixel a whole number of screen pixels once the tween settles. */
export const ZOOM_LEVELS = [1, 2, 3, 4] as const;

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

/** Smooth 2D camera: pan + stepped zoom, tweened toward a target. Pure maths; the Renderer applies it. */
export class Camera {
  x = 0; y = 0; zoom = 2;
  private tx = 0; private ty = 0; private tz = 2;
  private viewW = 1; private viewH = 1;

  constructor(private readonly bounds: Bounds) {}

  setViewport(w: number, h: number): void { this.viewW = w; this.viewH = h; }

  /** Jump (no tween) to a world position and zoom level. */
  snapTo(p: Vec2, zoom: number): void {
    this.x = this.tx = p.x; this.y = this.ty = p.y; this.zoom = this.tz = zoom;
  }

  /** Eased pan toward a world position. */
  panTo(p: Vec2): void { this.tx = this.clampX(p.x); this.ty = this.clampY(p.y); }

  /** Immediate drag-pan by a screen-space delta. */
  dragBy(dx: number, dy: number): void {
    this.x = this.tx = this.clampX(this.x - dx / this.zoom);
    this.y = this.ty = this.clampY(this.y - dy / this.zoom);
  }

  /** Eased pan, for keyboard movement. Delta in world px. */
  nudge(dx: number, dy: number): void {
    this.tx = this.clampX(this.tx + dx); this.ty = this.clampY(this.ty + dy);
  }

  /** Step the zoom level in/out, keeping the world point under the cursor fixed. */
  zoomStep(dir: 1 | -1, sx: number, sy: number): void {
    const i = ZOOM_LEVELS.indexOf(this.tz as (typeof ZOOM_LEVELS)[number]);
    const next = ZOOM_LEVELS[Math.max(0, Math.min(ZOOM_LEVELS.length - 1, i + dir))];
    if (next === this.tz) return;
    const wp = this.screenToWorld(sx, sy);
    this.tz = next;
    this.tx = this.clampX(wp.x - (sx - this.viewW / 2) / next);
    this.ty = this.clampY(wp.y - (sy - this.viewH / 2) / next);
  }

  update(dt: number): void {
    const k = 1 - Math.exp(-dt * 12);
    this.x += (this.tx - this.x) * k; this.y += (this.ty - this.y) * k;
    this.zoom += (this.tz - this.zoom) * (1 - Math.exp(-dt * 14));
    if (Math.abs(this.tz - this.zoom) < 0.003) this.zoom = this.tz;
    if (Math.abs(this.tx - this.x) < 0.05) this.x = this.tx;
    if (Math.abs(this.ty - this.y) < 0.05) this.y = this.ty;
  }

  apply(world: Container): void {
    world.scale.set(this.zoom);
    world.position.set(Math.round(this.viewW / 2 - this.x * this.zoom), Math.round(this.viewH / 2 - this.y * this.zoom));
  }

  screenToWorld(sx: number, sy: number): Vec2 {
    return { x: (sx - this.viewW / 2) / this.zoom + this.x, y: (sy - this.viewH / 2) / this.zoom + this.y };
  }

  private clampX = (v: number) => Math.max(this.bounds.minX, Math.min(this.bounds.maxX, v));
  private clampY = (v: number) => Math.max(this.bounds.minY, Math.min(this.bounds.maxY, v));
}
