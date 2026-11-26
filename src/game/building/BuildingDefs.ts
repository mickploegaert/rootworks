import type { ResourceAmounts } from '../inventory/Inventory.ts';
import type { MachineId } from '../production/MachineDefs.ts';

export type BuildCategory = 'garden' | 'decor' | 'production' | 'energy' | 'science';

export interface BuildingDef {
  id: string;
  name: string;
  description: string;
  category: BuildCategory;
  /** Sprite ids the player can cycle through with "rotate" (orientation or style). */
  variants: readonly string[];
  width: number;
  depth: number;
  cost: ResourceAmounts;
  /** Research id that unlocks it, or null if available from the start. */
  requires: string | null;
  /** A working machine rather than scenery. */
  machine?: MachineId;
  /** Seconds the construction drones need. */
  buildTime?: number;
}

/** Everything the player can build. Locked entries are shown so players can see what lies ahead. */
export const BUILDINGS: readonly BuildingDef[] = [
  { id: 'workbench', name: 'Workbench', description: 'Crafts research kits from timber and scrap. Robots put() ingredients in and take() kits out.', category: 'production', variants: ['workbench'], width: 2, depth: 2, cost: { scrap: 6 }, requires: null, machine: 'workbench', buildTime: 4 },
  { id: 'lab', name: 'Research Lab', description: 'Turns research kits into discoveries. Robots put() kits in; choose what to research in the Research panel.', category: 'science', variants: ['lab_building'], width: 2, depth: 2, cost: { wood: 4, scrap: 6 }, requires: null, machine: 'lab', buildTime: 6 },
  { id: 'sawmill', name: 'Sawmill', description: 'Saws 2 timber into 3 planks.', category: 'production', variants: ['sawmill'], width: 2, depth: 2, cost: { wood: 6, scrap: 4 }, requires: 'sawmill', machine: 'sawmill', buildTime: 6 },
  { id: 'kiln', name: 'Kiln', description: 'Fires 3 fieldstone into 2 bricks.', category: 'production', variants: ['kiln'], width: 2, depth: 2, cost: { stone: 8, planks: 4 }, requires: 'kiln', machine: 'kiln', buildTime: 6 },
  { id: 'planter', name: 'Vegetable Bed', description: 'A raised bed for cabbages, carrots or sunflowers.', category: 'garden', variants: ['planter_0', 'planter_1', 'planter_2'], width: 1, depth: 1, cost: { wood: 3 }, requires: 'gardening' },
  { id: 'fence', name: 'Picket Fence', description: 'Keeps the yard tidy.', category: 'decor', variants: ['fence_u'], width: 1, depth: 1, cost: { wood: 1 }, requires: null },
  { id: 'wall', name: 'Stone Wall', description: 'Low dry-stone wall. Rotate to turn it.', category: 'decor', variants: ['wall_u', 'wall_v'], width: 1, depth: 1, cost: { stone: 2 }, requires: null },
  { id: 'lamp', name: 'Lantern', description: 'Warm light for the long evenings.', category: 'decor', variants: ['lamp'], width: 1, depth: 1, cost: { scrap: 2, wood: 1 }, requires: null },
  { id: 'bench', name: 'Bench', description: 'Somewhere to sit and watch the robots work.', category: 'decor', variants: ['bench'], width: 1, depth: 1, cost: { wood: 3 }, requires: null },
  { id: 'crates', name: 'Crates', description: 'Stacked spare parts.', category: 'decor', variants: ['crates', 'barrels'], width: 1, depth: 1, cost: { wood: 3 }, requires: null },
  { id: 'windmill', name: 'Windmill', description: 'Turns in the breeze. Will power machines.', category: 'energy', variants: ['turbine'], width: 1, depth: 1, cost: { planks: 10, stone: 6 }, requires: 'windpower' },
  { id: 'greenhouse', name: 'Greenhouse', description: 'Glass and white timber, warm inside all year.', category: 'garden', variants: ['greenhouse'], width: 2, depth: 2, cost: { planks: 8, scrap: 6 }, requires: 'gardening' },
  { id: 'boiler', name: 'Boiler', description: 'Copper boiler that raises steam.', category: 'energy', variants: ['generator'], width: 1, depth: 1, cost: { copper_ore: 6, iron_ore: 4 }, requires: 'Steam Power' },
  { id: 'pipe', name: 'Copper Pipe', description: 'Carries steam between machines.', category: 'production', variants: ['pipe_u'], width: 1, depth: 1, cost: { copper_ore: 1 }, requires: 'Steam Power' },
  { id: 'conveyor', name: 'Conveyor', description: 'Moves items along by itself.', category: 'production', variants: ['conveyor_v'], width: 1, depth: 1, cost: { wood: 2, iron_ore: 1 }, requires: 'Logistics' },
  { id: 'factory', name: 'Small Factory', description: 'Brick mill under a copper roof.', category: 'production', variants: ['factory'], width: 2, depth: 2, cost: { stone: 20, wood: 12, iron_ore: 8 }, requires: 'Smelting' },
  { id: 'watertower', name: 'Water Tower', description: 'Stores rainwater for the gardens.', category: 'garden', variants: ['tank'], width: 1, depth: 1, cost: { wood: 12, copper_ore: 4 }, requires: 'Irrigation' },
];

export const buildingById = (id: string): BuildingDef | undefined => BUILDINGS.find((b) => b.id === id);
