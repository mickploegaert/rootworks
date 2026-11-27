import { Container, Graphics } from 'pixi.js';
import { HEIGHT_UNIT, uvToWorld } from '../core/iso.ts';
import type { TileRect } from '../entities/Entity.ts';
import type { World } from '../world/World.ts';

export type { TileRect };

/** Hover, selection and route markers drawn flat on the ground (raised to the tile's elevation). */
export class SelectionOverlay {
  /** Colour of the selection frame: follows the interface theme. */
  color = 0xf0a3bf;
  readonly view = new Container();
  private readonly hover = new Graphics();
  private readonly selected = new Graphics();
  private readonly route = new Graphics();
  private readonly ghost = new Graphics();

  constructor(private readonly world: World) { this.view.addChild(this.route, this.ghost, this.hover, this.selected); }

  private diamond(r: TileRect): number[] {
    const lift = this.world.heightAt(r.x, r.y) * HEIGHT_UNIT;
    return [uvToWorld(r.x, r.y), uvToWorld(r.x + r.w, r.y), uvToWorld(r.x + r.w, r.y + r.d), uvToWorld(r.x, r.y + r.d)]
      .flatMap((p) => [p.x, p.y - lift]);
  }

  setHover(r: TileRect | null): void {
    this.hover.clear();
    if (r) this.hover.poly(this.diamond(r)).fill({ color: 0xffffff, alpha: 0.12 }).stroke({ width: 1, color: 0xffffff, alpha: 0.55 });
  }

  setSelected(r: TileRect | null): void {
    this.selected.clear();
    if (r) this.selected.poly(this.diamond(r)).fill({ color: this.color, alpha: 0.16 }).stroke({ width: 2, color: this.color, alpha: 1 });
  }

  /** Footprint of a structure being placed: green when it fits, red when it does not. */
  setGhost(r: TileRect | null, valid: boolean): void {
    this.ghost.clear();
    if (r) this.ghost.poly(this.diamond(r)).fill({ color: valid ? 0x9ad66a : 0xff7060, alpha: 0.28 }).stroke({ width: 2, color: valid ? 0xc8f0a0 : 0xff9080, alpha: 0.9 });
  }

  /** Dots along the robot's planned route. */
  setRoute(tiles: { x: number; y: number }[]): void {
    this.route.clear();
    for (const t of tiles) {
      const c = uvToWorld(t.x + 0.5, t.y + 0.5);
      this.route.rect(Math.round(c.x) - 2, Math.round(c.y - this.world.heightAt(t.x, t.y) * HEIGHT_UNIT) - 1, 4, 2).fill({ color: 0x86f0c8, alpha: 0.8 });
    }
  }

  update(t: number): void {
    this.selected.alpha = 0.65 + Math.sin(t * 4) * 0.25;
  }
}
