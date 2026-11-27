import { Emitter } from '../core/Emitter.ts';
import type { Machine } from '../entities/Machine.ts';
import { RESEARCH, researchById, type Firmware, type ResearchNode } from './ResearchDefs.ts';

/** Seconds a Lab needs to turn one Research Kit into Sparks. */
export const KIT_SECONDS = 4;
export const SPARKS_PER_KIT = 2;

/**
 * Skills and the one currency that buys them. Sparks come from lessons, commissions and Labs (which turn
 * Research Kits into Sparks); the player spends them in the skill tree and the skill applies at once.
 */
export class ResearchSystem {
  readonly events = new Emitter<{ completed: ResearchNode; sparked: number }>();
  readonly completed = new Set<string>();
  sparks = 0;
  /** Seconds into the kit each lab is processing (-1: idle). */
  private readonly labTimers = new Map<Machine, number>();

  isDone(id: string): boolean { return this.completed.has(id); }

  available(n: ResearchNode): boolean { return !this.completed.has(n.id) && n.requires.every((r) => this.completed.has(r)); }

  /** Programming skills learned (0..3+): the robots' firmware level, shown as the sprout on Seedling's head. */
  get firmware(): Firmware {
    return Math.min(3, RESEARCH.filter((n) => n.code && this.completed.has(n.id)).length) as Firmware;
  }

  /** Why a skill can't be bought right now, or null. */
  problem(id: string): string | null {
    const n = researchById(id);
    if (!n) return 'Unknown skill';
    if (this.completed.has(id)) return 'Already learned';
    if (!this.available(n)) return `Needs ${n.requires.filter((r) => !this.completed.has(r)).map((r) => researchById(r)?.name ?? r).join(', ')} first`;
    if (this.sparks < n.cost) return `Needs ${n.cost - this.sparks} more Sparks`;
    return null;
  }

  /** Spend Sparks on a skill. Returns why not, or null when learned. */
  buy(id: string): string | null {
    const p = this.problem(id);
    if (p) return p;
    const n = researchById(id)!;
    this.sparks -= n.cost;
    this.completed.add(id);
    this.events.emit('completed', n);
    return null;
  }

  /** Each tick: every Lab with kits turns them into Sparks, one kit at a time. */
  update(dt: number, labs: Machine[]): void {
    for (const lab of labs) {
      let t = this.labTimers.get(lab) ?? -1;
      if (t < 0) {
        if (lab.input.remove('research_kit', 1) === 0) { lab.progress = 0; continue; }
        t = 0;
      }
      t += dt;
      if (t >= KIT_SECONDS) {
        t = -1;
        this.sparks += SPARKS_PER_KIT;
        this.events.emit('sparked', SPARKS_PER_KIT);
      }
      this.labTimers.set(lab, t);
      lab.progress = Math.max(0, t); // shown as the lab's activity
    }
  }

  static get nodes(): readonly ResearchNode[] { return RESEARCH; }
}
