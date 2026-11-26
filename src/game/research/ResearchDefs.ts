export type Firmware = 0 | 1 | 2 | 3;

export interface ResearchNode {
  id: string;
  name: string;
  description: string;
  /** Research kits the Lab consumes. */
  kits: number;
  /** Seconds the Lab spends per kit. */
  secondsPerKit: number;
  requires: readonly string[];
  /** Robot firmware tier this node installs, if any. */
  firmware?: Firmware;
  /** Building ids this unlocks in the build menu. */
  unlocksBuildings?: readonly string[];
}

/** The first research tree (Act I). Each node does one visible thing. */
export const RESEARCH: readonly ResearchNode[] = [
  { id: 'counter', name: 'Counter firmware (T1)', description: 'Robots can hold values: variables, numbers, text and arithmetic, plus get_inventory() and get_position().', kits: 2, secondsPerKit: 4, requires: [], firmware: 1 },
  { id: 'sawmill', name: 'Sawmill', description: 'Saw timber into planks: better research kits and sturdier buildings.', kits: 2, secondsPerKit: 4, requires: [], unlocksBuildings: ['sawmill'] },
  { id: 'sense', name: 'Sense firmware (T2)', description: 'Robots can decide: if/else, comparisons and logic, plus can_harvest(), is_inventory_full() and friends.', kits: 3, secondsPerKit: 5, requires: ['counter'], firmware: 2 },
  { id: 'kiln', name: 'Kiln', description: 'Fire fieldstone into bricks.', kits: 3, secondsPerKit: 5, requires: ['sawmill'], unlocksBuildings: ['kiln'] },
  { id: 'loop', name: 'Loop firmware (T3)', description: 'Robots can repeat: while and for loops. Your robots can now work unattended.', kits: 4, secondsPerKit: 6, requires: ['sense', 'sawmill'], firmware: 3 },
  { id: 'surveying', name: 'Surveying', description: 'Reclaim overgrown land next to your valley, one parcel at a time, and chart the road to the Old Quarry.', kits: 3, secondsPerKit: 6, requires: ['sawmill'] },
  { id: 'assembly', name: 'Robot assembly', description: 'The workshop can assemble a second robot. One program can run on many robots.', kits: 5, secondsPerKit: 6, requires: ['loop'] },
  { id: 'cargo', name: 'Cargo racks', description: 'Robots carry 16 units instead of 10.', kits: 4, secondsPerKit: 6, requires: ['loop'] },
  { id: 'windpower', name: 'Wind power', description: 'Windmills. Machines will need power later on.', kits: 4, secondsPerKit: 6, requires: ['kiln'], unlocksBuildings: ['windmill'] },
  { id: 'gardening', name: 'Gardening', description: 'Vegetable beds and greenhouses for a greener valley, and a path into Whisperwood.', kits: 2, secondsPerKit: 4, requires: ['counter'], unlocksBuildings: ['planter', 'greenhouse'] },
];

export const researchById = (id: string) => RESEARCH.find((r) => r.id === id);
