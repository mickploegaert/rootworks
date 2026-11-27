import type { ResourceAmounts } from '../inventory/Inventory.ts';

export interface Recipe {
  id: string;
  name: string;
  inputs: ResourceAmounts;
  outputs: ResourceAmounts;
  /** Seconds per batch. */
  time: number;
}

export type MachineId = 'workbench' | 'sawmill' | 'kiln' | 'lab' | 'heart';

export interface MachineDef {
  id: MachineId;
  name: string;
  /** The first recipe is the default. The Lab has none: it consumes research kits instead. */
  recipes: readonly Recipe[];
  /** Total units the input and output buffers hold. Small on purpose: machines need a steady supply. */
  inputCap: number;
  outputCap: number;
}

export const MACHINES: Readonly<Record<MachineId, MachineDef>> = {
  workbench: {
    id: 'workbench', name: 'Workbench', inputCap: 12, outputCap: 6,
    recipes: [
      { id: 'kit_wood', name: 'Research kit', inputs: { wood: 2, scrap: 1 }, outputs: { research_kit: 1 }, time: 5 },
      { id: 'kit_planks', name: 'Research kit (planks)', inputs: { planks: 2, scrap: 1 }, outputs: { research_kit: 2 }, time: 6 },
    ],
  },
  sawmill: {
    id: 'sawmill', name: 'Sawmill', inputCap: 12, outputCap: 12,
    recipes: [{ id: 'planks', name: 'Planks', inputs: { wood: 2 }, outputs: { planks: 3 }, time: 4 }],
  },
  kiln: {
    id: 'kiln', name: 'Kiln', inputCap: 12, outputCap: 8,
    recipes: [{ id: 'bricks', name: 'Bricks', inputs: { stone: 3 }, outputs: { bricks: 2 }, time: 6 }],
  },
  lab: { id: 'lab', name: 'Research Lab', inputCap: 10, outputCap: 0, recipes: [] },
  /** The Heart Tree: not built, it was always there. It takes offerings for the valley's festival. */
  heart: { id: 'heart', name: 'Heart Tree', inputCap: 999, outputCap: 0, recipes: [] },
};
