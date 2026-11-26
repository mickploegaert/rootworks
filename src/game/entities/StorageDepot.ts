import { Inventory } from '../inventory/Inventory.ts';
import { Entity } from './Entity.ts';

/** Where robots deliver what they collect. Unlimited capacity for now. */
export class StorageDepot extends Entity {
  readonly kind = 'storage' as const;
  readonly inventory = new Inventory();

  constructor(x: number, y: number, width = 2, depth = 1) {
    super(x, y, 'depot', 'Storage Depot', 'A sturdy little barn where robots deliver what they collect.', width, depth);
  }
}
