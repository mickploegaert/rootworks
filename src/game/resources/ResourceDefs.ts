/** Everything that can sit in an inventory: raw resources gathered from the world, and products made by machines. */
export type ResourceId = 'wood' | 'stone' | 'iron_ore' | 'copper_ore' | 'scrap' | 'planks' | 'bricks' | 'research_kit';

export const RESOURCE_IDS: readonly ResourceId[] = ['wood', 'stone', 'iron_ore', 'copper_ore', 'scrap', 'planks', 'bricks', 'research_kit'];
/** Gathered from deposits in the world. */
export const RAW_IDS: readonly ResourceId[] = ['wood', 'stone', 'iron_ore', 'copper_ore', 'scrap'];

export interface ResourceDef {
  id: ResourceId;
  name: string;
  description: string;
  /** What the player can do with it, in one or two plain sentences (shown wherever the item appears). */
  use: string;
  /** UI accent colour (0xRRGGBB). */
  color: number;
  /** Gathered from the world (true) or made by a machine (false). */
  raw: boolean;
  /** Seconds one harvest action takes (raw resources only). */
  harvestTime: number;
  /** Most units one harvest action can collect. */
  yieldPerAction: number;
}

export const RESOURCES: Readonly<Record<ResourceId, ResourceDef>> = {
  wood: { id: 'wood', raw: true, name: 'Timber', description: 'Fast-growing hardwood. Fuel, fibre and building stock.', use: 'Builds the Research Lab and yard decorations. The Workbench turns 2 Timber + 1 Scrap Metal into a Research Kit; the Sawmill saws it into Planks.', color: 0xb07a44, harvestTime: 2.0, yieldPerAction: 4 },
  stone: { id: 'stone', raw: true, name: 'Fieldstone', description: 'Weathered granite boulders, good for foundations.', use: 'Builds stone walls, and the Kiln fires it into Bricks. Reclaiming new land costs it too.', color: 0x9aa4ac, harvestTime: 2.6, yieldPerAction: 3 },
  iron_ore: { id: 'iron_ore', raw: true, name: 'Iron Ore', description: 'Rust-red seams of iron. The backbone of industry.', use: 'Needed for later machines (conveyors, factories). Find it in the Old Quarry.', color: 0xd9824a, harvestTime: 3.2, yieldPerAction: 2 },
  copper_ore: { id: 'copper_ore', raw: true, name: 'Copper Ore', description: 'Green-streaked malachite, rich in copper.', use: 'Needed for steam power: boilers and copper pipes. Find it in the Old Quarry.', color: 0x4fd1a6, harvestTime: 3.2, yieldPerAction: 2 },
  scrap: { id: 'scrap', raw: true, name: 'Scrap Metal', description: 'Salvage left behind when the research station closed.', use: 'Builds the Workbench, the Research Lab and lanterns. Every Research Kit needs 1.', color: 0xa3abb3, harvestTime: 1.6, yieldPerAction: 3 },
  planks: { id: 'planks', raw: false, name: 'Planks', description: 'Sawn timber for buildings and research kits.', use: 'Make Research Kits twice as fast at the Workbench, and build greenhouses, windmills and kilns.', color: 0xd9a868, harvestTime: 0, yieldPerAction: 0 },
  bricks: { id: 'bricks', raw: false, name: 'Bricks', description: 'Kiln-fired bricks for sturdier buildings.', use: 'Sturdy building material for bigger structures.', color: 0xc96a4a, harvestTime: 0, yieldPerAction: 0 },
  research_kit: { id: 'research_kit', raw: false, name: 'Research Kit', description: 'Notes, samples and parts. The Lab turns them into discoveries.', use: 'Fuel for research. Carry it to a Research Lab with go_to("lab") and put("research_kit"); the Lab uses it to research the project picked in the Research panel.', color: 0x8fd0c0, harvestTime: 0, yieldPerAction: 0 },
};
