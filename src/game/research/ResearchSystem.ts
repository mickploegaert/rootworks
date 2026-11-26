import { Emitter } from '../core/Emitter.ts';
import type { Machine } from '../entities/Machine.ts';
import { RESEARCH, researchById, type Firmware, type ResearchNode } from './ResearchDefs.ts';

/**
 * Research progress. The player picks a node; any Lab with research kits in its input consumes them,
 * one kit at a time, until the node is complete. Labs work in parallel on the same node.
 */
export class ResearchSystem {
  readonly events = new Emitter<{ completed: ResearchNode }>();
  readonly completed = new Set<string>();
  current: string | null = null;
  /** Kits consumed toward `current`. */
  kitsDone = 0;
  /** Seconds into the kit each lab is processing. */
  private readonly labTimers = new Map<Machine, number>();

  isDone(id: string): boolean { return this.completed.has(id); }

  available(n: ResearchNode): boolean { return !this.completed.has(n.id) && n.requires.every((r) => this.completed.has(r)); }

  /** Highest robot firmware tier installed. */
  get firmware(): Firmware {
    let t: Firmware = 0;
    for (const id of this.completed) { const f = researchById(id)?.firmware; if (f !== undefined && f > t) t = f; }
    return t;
  }

  /** Choose what to research. Returns why it can't be chosen, or null. */
  select(id: string | null): string | null {
    if (id === null) { this.current = null; return null; }
    const n = researchById(id);
    if (!n) return 'Unknown research';
    if (this.completed.has(id)) return 'Already researched';
    if (!this.available(n)) return `Needs ${n.requires.filter((r) => !this.completed.has(r)).map((r) => researchById(r)?.name ?? r).join(', ')} first`;
    if (this.current !== id) { this.current = id; this.kitsDone = 0; }
    return null;
  }

  /** Called by the simulation each tick with all labs. */
  update(dt: number, labs: Machine[]): void {
    const n = this.current ? researchById(this.current) : null;
    if (!n) return;
    for (const lab of labs) {
      if (this.kitsDone >= n.kits) break;
      let t = this.labTimers.get(lab) ?? -1;
      if (t < 0) {
        if (lab.input.remove('research_kit', 1) === 0) continue;
        t = 0;
      }
      t += dt;
      if (t >= n.secondsPerKit) { this.kitsDone++; t = -1; }
      this.labTimers.set(lab, t);
      lab.progress = t; // shown as the lab's activity
    }
    if (this.kitsDone >= n.kits) {
      this.completed.add(n.id);
      this.current = null;
      this.kitsDone = 0;
      this.events.emit('completed', n);
    }
  }

  /** Progress of the current node, 0..1. */
  get progress(): number {
    const n = this.current ? researchById(this.current) : null;
    return n ? this.kitsDone / n.kits : 0;
  }

  static get nodes(): readonly ResearchNode[] { return RESEARCH; }
}
