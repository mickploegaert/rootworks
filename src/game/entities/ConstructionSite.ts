import { Entity } from './Entity.ts';

/**
 * A building under construction. The workshop's construction drones work on it until it is complete,
 * then the simulation replaces it with the finished structure. Materials were paid when it was placed.
 */
export class ConstructionSite extends Entity {
  readonly kind = 'construction' as const;
  elapsed = 0;

  constructor(x: number, y: number, readonly buildingId: string, readonly targetSprite: string, name: string, w: number, d: number, readonly buildTime: number) {
    super(x, y, targetSprite, `${name} (under construction)`, 'Construction drones are building this.', w, d);
  }

  get progress(): number { return Math.min(1, this.elapsed / this.buildTime); }
  get done(): boolean { return this.elapsed >= this.buildTime; }

  override update(dt: number): void { this.elapsed += dt; }
}
