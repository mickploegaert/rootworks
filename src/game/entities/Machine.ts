import { Inventory } from '../inventory/Inventory.ts';
import { MACHINES, type MachineDef, type MachineId, type Recipe } from '../production/MachineDefs.ts';
import type { ResourceId } from '../resources/ResourceDefs.ts';
import { Entity } from './Entity.ts';

/**
 * A production building. Robots `put` ingredients into its input buffer and `take` products from its
 * output buffer; between those, it works on its own: one batch at a time, blocked when output is full.
 */
export class Machine extends Entity {
  readonly kind = 'machine' as const;
  readonly def: MachineDef;
  readonly input: Inventory;
  readonly output: Inventory;
  recipeIndex = 0;
  /** Seconds into the current batch, or -1 when idle. */
  progress = -1;
  /** Finished batches, for statistics and commissions. */
  batches = 0;
  /** The Heart Tree's bloom stage, 0-5, set by the story. It takes offerings from stage 4, the festival. */
  stage = 0;

  constructor(x: number, y: number, spriteId: string, readonly machineId: MachineId, name: string, description: string, w: number, d: number) {
    super(x, y, spriteId, name, description, w, d);
    this.def = MACHINES[machineId];
    this.input = new Inventory(this.def.inputCap);
    this.output = new Inventory(this.def.outputCap);
  }

  get recipe(): Recipe | null { return this.def.recipes[this.recipeIndex] ?? null; }
  get working(): boolean { return this.progress >= 0; }

  /** What the input buffer accepts: the current recipe's ingredients (the Lab takes research kits). */
  accepts(id: ResourceId): boolean {
    if (this.machineId === 'lab') return id === 'research_kit';
    if (this.machineId === 'heart') return this.stage >= 4 && (id === 'planks' || id === 'bricks' || id === 'research_kit');
    return !!this.recipe && id in this.recipe.inputs;
  }

  setRecipe(i: number): void {
    if (i < 0 || i >= this.def.recipes.length || i === this.recipeIndex) return;
    this.recipeIndex = i;
    this.progress = -1;
  }

  /** Advance production. Returns true when a batch finished this tick. */
  override update(dt: number): boolean {
    const r = this.recipe;
    if (!r) return false;
    if (this.progress < 0) {
      if (!has(this.input, r.inputs)) return false;
      for (const [id, n] of Object.entries(r.inputs)) this.input.remove(id as ResourceId, n!);
      this.progress = 0;
    }
    this.progress += dt;
    if (this.progress < r.time) return false;
    const room = Object.values(r.outputs).reduce((s, n) => s + n!, 0);
    if (this.output.free < room) { this.progress = r.time; return false; } // blocked: waiting for a robot to empty it
    for (const [id, n] of Object.entries(r.outputs)) this.output.add(id as ResourceId, n!);
    this.progress = -1;
    this.batches++;
    return true;
  }
}

function has(inv: Inventory, need: Partial<Record<ResourceId, number>>): boolean {
  return Object.entries(need).every(([id, n]) => inv.get(id as ResourceId) >= n!);
}
