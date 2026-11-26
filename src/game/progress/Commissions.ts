import type { ResourceAmounts } from '../inventory/Inventory.ts';
import type { Machine } from '../entities/Machine.ts';
import type { ResourceId } from '../resources/ResourceDefs.ts';
import type { Simulation } from '../Simulation.ts';

export interface Commission {
  id: string;
  title: string;
  /** Current progress and target, measured from the simulation's state. */
  measure(sim: Simulation): number;
  target: number;
  reward: ResourceAmounts;
}

const stored = (id: ResourceId) => (sim: Simulation) => sim.storages[0]?.inventory.get(id) ?? 0;
const batches = (machineId: string) => (sim: Simulation) => sim.machines.filter((m: Machine) => m.machineId === machineId).reduce((s, m) => s + m.batches, 0);
const hasMachine = (machineId: string) => (sim: Simulation) => (sim.machines.some((m) => m.machineId === machineId) ? 1 : 0);

/** Goals that give direction without forcing it: three are offered at a time, in this order. */
export const COMMISSIONS: readonly Commission[] = [
  { id: 'scrap10', title: 'Gather 10 scrap into storage', measure: stored('scrap'), target: 10, reward: { research_kit: 1 } },
  { id: 'bench', title: 'Build a Workbench', measure: hasMachine('workbench'), target: 1, reward: { scrap: 6 } },
  { id: 'wood20', title: 'Stock 20 timber', measure: stored('wood'), target: 20, reward: { research_kit: 1 } },
  { id: 'lab', title: 'Build a Research Lab', measure: hasMachine('lab'), target: 1, reward: { research_kit: 2 } },
  { id: 'kits5', title: 'Craft 5 research kits', measure: batches('workbench'), target: 5, reward: { scrap: 10 } },
  { id: 'planks30', title: 'Stock 30 planks', measure: stored('planks'), target: 30, reward: { research_kit: 2 } },
  { id: 'robots2', title: 'Run a fleet of 2 robots', measure: (sim) => sim.robots.length, target: 2, reward: { research_kit: 3 } },
  { id: 'parcel', title: 'Reclaim a new parcel', measure: (sim) => sim.world.unlockedParcels().length - sim.baseParcels, target: 1, reward: { research_kit: 3 } },
  { id: 'bricks20', title: 'Stock 20 bricks', measure: stored('bricks'), target: 20, reward: { research_kit: 2 } },
  { id: 'research6', title: 'Complete 6 research projects', measure: (sim) => sim.research.completed.size, target: 6, reward: { planks: 20 } },
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
    }
    return finished;
  }
}
