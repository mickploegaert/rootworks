import { Emitter } from '../core/Emitter.ts';
import type { ResourceId } from '../resources/ResourceDefs.ts';

export type ResourceAmounts = Partial<Record<ResourceId, number>>;

/**
 * A bag of resources with a shared capacity (total units across all types).
 * Used by robots (small capacity) and storage (unlimited); reusable for machines later.
 */
export class Inventory {
  readonly events = new Emitter<{ changed: Inventory }>();
  private readonly items = new Map<ResourceId, number>();
  private count = 0;

  /** Total units it can hold; upgrades (research) may raise it. */
  constructor(public capacity = Infinity) {}

  get total(): number { return this.count; }
  get free(): number { return this.capacity - this.count; }
  get isEmpty(): boolean { return this.count === 0; }
  get isFull(): boolean { return this.count >= this.capacity; }

  get(id: ResourceId): number { return this.items.get(id) ?? 0; }

  /** Adds up to `n` units; returns how many were accepted (limited by free capacity). */
  add(id: ResourceId, n: number): number {
    const accepted = Math.max(0, Math.min(Math.floor(n), this.free));
    if (!accepted) return 0;
    this.items.set(id, this.get(id) + accepted);
    this.count += accepted;
    this.events.emit('changed', this);
    return accepted;
  }

  /** Removes up to `n` units; returns how many were removed. */
  remove(id: ResourceId, n: number): number {
    const removed = Math.max(0, Math.min(Math.floor(n), this.get(id)));
    if (!removed) return 0;
    const left = this.get(id) - removed;
    if (left) this.items.set(id, left); else this.items.delete(id);
    this.count -= removed;
    this.events.emit('changed', this);
    return removed;
  }

  /** Moves everything the target can accept; returns what moved. */
  transferAllTo(target: Inventory): ResourceAmounts {
    const moved: ResourceAmounts = {};
    for (const [id, n] of [...this.items]) {
      const accepted = target.add(id, n);
      if (accepted) { this.remove(id, accepted); moved[id] = accepted; }
    }
    return moved;
  }

  entries(): [ResourceId, number][] { return [...this.items]; }

  snapshot(): ResourceAmounts { return Object.fromEntries(this.items); }
}
