import type { ResourceAmounts } from '../inventory/Inventory.ts';
import type { Machine } from '../entities/Machine.ts';
import type { ResourceId } from '../resources/ResourceDefs.ts';
import type { Simulation } from '../Simulation.ts';
import { laneBonus } from '../research/Lanes.ts';

export interface Commission {
  id: string;
  title: string;
  /** Current progress and target, measured from the simulation's state. */
  measure(sim: Simulation): number;
  target: number;
  reward: ResourceAmounts;
  /** Sparks paid on completion: the main way to earn skills besides the Lab. */
  sparks: number;
  /** Who in the valley asked for it. */
  from: string;
}

const stored = (id: ResourceId) => (sim: Simulation) => sim.storages[0]?.inventory.get(id) ?? 0;
const batches = (machineId: string) => (sim: Simulation) => sim.machines.filter((m: Machine) => m.machineId === machineId).reduce((s, m) => s + m.batches, 0);
const hasMachine = (machineId: string) => (sim: Simulation) => (sim.machines.some((m) => m.machineId === machineId) ? 1 : 0);

/** Goals that give direction without forcing it: three are offered at a time, in this order. */
export const COMMISSIONS: readonly Commission[] = [
  { id: 'scrap10', title: 'Gather 10 scrap into storage', measure: stored('scrap'), target: 10, reward: { research_kit: 1 }, sparks: 2, from: 'Smith Bram' },
  { id: 'bench', title: 'Build a Workbench', measure: hasMachine('workbench'), target: 1, reward: { scrap: 6 }, sparks: 2, from: 'Smith Bram' },
  { id: 'wood20', title: 'Stock 20 timber', measure: stored('wood'), target: 20, reward: { research_kit: 1 }, sparks: 2, from: 'Miller Tobin' },
  { id: 'lab', title: 'Build a Research Lab', measure: hasMachine('lab'), target: 1, reward: { research_kit: 2 }, sparks: 3, from: 'Old Wren' },
  { id: 'kits5', title: 'Craft 5 research kits', measure: batches('workbench'), target: 5, reward: { scrap: 10 }, sparks: 3, from: 'Old Wren' },
  { id: 'planks30', title: 'Stock 30 planks', measure: stored('planks'), target: 30, reward: { research_kit: 2 }, sparks: 4, from: 'Miller Tobin' },
  { id: 'robots2', title: 'Run a fleet of 2 robots', measure: (sim) => sim.robots.length, target: 2, reward: { research_kit: 3 }, sparks: 4, from: 'Mayor Hazel' },
  { id: 'parcel', title: 'Reclaim a new parcel', measure: (sim) => sim.world.unlockedParcels().length - sim.baseParcels, target: 1, reward: { research_kit: 3 }, sparks: 4, from: 'Mayor Hazel' },
  { id: 'bricks20', title: 'Stock 20 bricks', measure: stored('bricks'), target: 20, reward: { research_kit: 2 }, sparks: 4, from: 'Smith Bram' },
  { id: 'research6', title: 'Learn 6 skills', measure: (sim) => sim.research.completed.size, target: 6, reward: { planks: 20 }, sparks: 5, from: 'Old Wren' },
];

/** Tracks which commissions are done; rewards go straight into storage. */
export class CommissionBoard {
  readonly done = new Set<string>();

  /** The (up to) three open commissions. */
  active(): Commission[] { return COMMISSIONS.filter((c) => !this.done.has(c.id)).slice(0, 3); }

  /** Complete any finished commissions; returns those completed now. */
  update(sim: Simulation): Commission[] {
    const finished = this.active().filter((c) => c.measure(sim) >= c.target);
    const store = sim.storages[0]?.inventory;
    for (const c of finished) {
      this.done.add(c.id);
      if (store) for (const [id, n] of Object.entries(c.reward)) store.add(id as ResourceId, n!);
      sim.research.sparks += c.sparks + (laneBonus('land', sim.research.completed) ? 1 : 0); // Land & logistics milestone
    }
    return finished;
  }
}
