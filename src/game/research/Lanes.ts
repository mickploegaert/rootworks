/**
 * The research board's lanes: skills grouped by what they teach. Learning enough of a lane (three, or all of a shorter
 * one) earns its milestone bonus. The board draws these; the simulation applies the bonuses.
 */
export interface Lane { id: LaneId; label: string; hint: string; color: string; ids: readonly string[]; bonus: string }
export type LaneId = 'logic' | 'flow' | 'machines' | 'robots' | 'land';

export const LANES: readonly Lane[] = [
  { id: 'logic', label: 'Memory & logic', hint: 'Store values, calculate, decide', color: '#8fd0c0', ids: ['counter', 'operators', 'sense', 'lists'], bonus: 'The Lab makes 3 Sparks per kit' },
  { id: 'flow', label: 'Control flow', hint: 'Repeat and reuse code', color: '#86c3e6', ids: ['loop', 'functions'], bonus: 'Harvesting is 15% faster' },
  { id: 'machines', label: 'Machines', hint: 'Buildings that make things', color: '#f0a060', ids: ['sawmill', 'kiln', 'windpower', 'gardening', 'feeder'], bonus: 'Machines work 10% faster' },
  { id: 'robots', label: 'Robot upgrades', hint: 'Faster and stronger robots', color: '#e8c56a', ids: ['speed1', 'speed2', 'speed3', 'yield1'], bonus: 'Robots carry 2 more' },
  { id: 'land', label: 'Land & logistics', hint: 'More land, cargo and robots', color: '#b5dc8e', ids: ['surveying', 'surveying2', 'cargo', 'cargo2', 'logistics', 'assembly'], bonus: 'Commissions pay 1 extra Spark' },
];

/** Skills a lane needs for its bonus. */
export const laneGoal = (l: Lane) => Math.min(3, l.ids.length);
export const laneCount = (l: Lane, done: ReadonlySet<string>) => l.ids.filter((id) => done.has(id)).length;
export const laneBonus = (id: LaneId, done: ReadonlySet<string>) => { const l = LANES.find((x) => x.id === id)!; return laneCount(l, done) >= laneGoal(l); };
