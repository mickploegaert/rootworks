import { RESOURCES, type ResourceDef, type ResourceId } from '../resources/ResourceDefs.ts';
import { Entity } from './Entity.ts';

/** A harvestable deposit. Once depleted it stops blocking movement and can no longer be harvested. */
export class ResourceNode extends Entity {
  readonly kind = 'resource' as const;

  constructor(
    x: number, y: number, spriteId: string, readonly resourceId: ResourceId,
    public amount: number, readonly maxAmount = amount, width = 1, depth = 1,
  ) {
    super(x, y, spriteId, RESOURCES[resourceId].name + ' deposit', RESOURCES[resourceId].description, width, depth);
  }

  get def(): ResourceDef { return RESOURCES[this.resourceId]; }
  get depleted(): boolean { return this.amount <= 0; }
  override get blocking(): boolean { return !this.depleted; }

  /** Removes up to `n` units from the deposit; returns how many were taken. */
  take(n: number): number {
    const taken = Math.max(0, Math.min(Math.floor(n), this.amount));
    this.amount -= taken;
    return taken;
  }
}
