export type Firmware = 0 | 1 | 2 | 3;

export type SkillBranch = 'code' | 'machines' | 'expansion';

export interface ResearchNode {
  id: string;
  name: string;
  description: string;
  branch: SkillBranch;
  /** Sparks it costs. Bought at once: no waiting. */
  cost: number;
  requires: readonly string[];
  /** A programming skill: counts toward the robots' firmware (and the sprout on Seedling's head). */
  code?: boolean;
  /** Building ids this unlocks in the build menu. */
  unlocksBuildings?: readonly string[];
}

/**
 * The skill tree. Ids are stored in saves: keep them. Programming skills are independent of each other where possible,
 * so a player can buy Loops first and automate within minutes.
 */
export const RESEARCH: readonly ResearchNode[] = [
  // programming: each one teaches a real Python idea
  { id: 'loop', branch: 'code', code: true, name: 'Loops', description: 'while and for: repeat code, even forever. Your robot can work while you watch.', cost: 3, requires: [] },
  { id: 'counter', branch: 'code', code: true, name: 'Variables', description: 'Give a value a name and use it later: trips = 0. Also get_inventory() and get_position().', cost: 3, requires: [] },
  { id: 'operators', branch: 'code', code: true, name: 'Operators', description: 'Calculate and compare: + - * /, and < > == !=. trips = trips + 1.', cost: 3, requires: ['counter'] },
  { id: 'sense', branch: 'code', code: true, name: 'Sense', description: 'Decide with if/else and and/or/not, using sensors: can_harvest(), is_inventory_full() and more.', cost: 4, requires: ['operators'] },
  { id: 'lists', branch: 'code', code: true, name: 'Lists', description: 'Keep many values in one: places = ["tree", "scrap"], then for p in places. Indexing with places[0].', cost: 5, requires: ['operators'] },
  { id: 'functions', branch: 'code', code: true, name: 'Functions', description: 'def: give a group of lines a name and reuse it, like def gather(place).', cost: 5, requires: ['loop'] },
  // machines
  { id: 'sawmill', branch: 'machines', name: 'Sawmill', description: 'Saw timber into planks: Research Kits twice as fast, and sturdier buildings.', cost: 4, requires: [], unlocksBuildings: ['sawmill'] },
  { id: 'kiln', branch: 'machines', name: 'Kiln', description: 'Fire fieldstone into bricks: windmills are built from them.', cost: 6, requires: ['sawmill'], unlocksBuildings: ['kiln'] },
  { id: 'windpower', branch: 'machines', name: 'Wind power', description: 'Windmills: machines near one work 50% faster.', cost: 8, requires: ['kiln'], unlocksBuildings: ['windmill'] },
  { id: 'feeder', branch: 'machines', name: 'Feeder', description: 'Machines within 2 tiles of storage pull their own ingredients from it. Robots only keep storage stocked.', cost: 10, requires: ['sawmill', 'logistics'] },
  { id: 'gardening', branch: 'machines', name: 'Gardening', description: 'Vegetable beds and greenhouses for a greener valley, and the road into Whisperwood.', cost: 4, requires: [], unlocksBuildings: ['planter', 'greenhouse'] },
  // expansion
  { id: 'surveying', branch: 'expansion', name: 'Surveying', description: 'Reclaim overgrown land next to your valley, one parcel at a time, and chart the road to the Old Quarry.', cost: 5, requires: [] },
  { id: 'surveying2', branch: 'expansion', name: 'Surveying II', description: 'Better maps: reclaiming land costs 30% less.', cost: 7, requires: ['surveying'] },
  { id: 'speed1', branch: 'expansion', name: 'Speed I', description: 'Robots drive 20% faster.', cost: 3, requires: [] },
  { id: 'speed2', branch: 'expansion', name: 'Speed II', description: 'Another 20%: robots drive 40% faster than at the start.', cost: 6, requires: ['speed1'] },
  { id: 'speed3', branch: 'expansion', name: 'Speed III', description: 'Another 20%: 60% faster.', cost: 10, requires: ['speed2'] },
  { id: 'cargo', branch: 'expansion', name: 'Cargo I', description: 'Robots carry 16 units instead of 10.', cost: 6, requires: ['surveying'] },
  { id: 'cargo2', branch: 'expansion', name: 'Cargo II', description: 'Robots carry 22 units.', cost: 9, requires: ['cargo'] },
  { id: 'yield1', branch: 'expansion', name: 'Sharp tools', description: 'Every harvest() collects one unit more.', cost: 6, requires: ['speed1'] },
  { id: 'logistics', branch: 'expansion', name: 'Logistics', description: 'deliver("wood", "workbench"): fetch from storage and put it into a machine, in one command.', cost: 6, requires: ['cargo'] },
  { id: 'assembly', branch: 'expansion', name: 'Robot assembly', description: 'The workshop can assemble more robots. Each robot can run its own program.', cost: 8, requires: ['cargo', 'loop'] },
];

export const researchById = (id: string) => RESEARCH.find((r) => r.id === id);
