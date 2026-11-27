import type { Machine } from '../entities/Machine.ts';
import type { ResourceId } from '../resources/ResourceDefs.ts';
import type { Simulation } from '../Simulation.ts';

/**
 * The valley's story: the Heart Tree, the old cherry the research station was built around, wakes one bloom stage per
 * chapter. Each chapter is a letter from someone in the valley with three goals. The last one is the Blossom Festival,
 * an offering your robots must carry into the tree by program. After it, Eternal Spring: ever larger offerings raise the
 * tree's level, and the tree gives Sparks every minute, more with each level.
 */
export interface Objective { text: string; target: number; measure(sim: Simulation, book: StoryBook): number }
export interface Chapter { id: string; title: string; from: string; letter: string; done: string; sparks: number; objectives: Objective[] }

/** What the Heart Tree takes as offerings. */
export const OFFERING_ITEMS: readonly ResourceId[] = ['planks', 'bricks', 'research_kit'];

const machines = (id: string) => (sim: Simulation) => sim.machines.filter((m) => m.machineId === id).length;
const stored = (id: ResourceId) => (sim: Simulation) => sim.storages[0]?.inventory.get(id) ?? 0;
const offered = (id: ResourceId) => (_: Simulation, b: StoryBook) => b.offered[id] ?? 0;

export const CHAPTERS: readonly Chapter[] = [
  {
    id: 'awake', title: 'Waking up', from: 'Old Wren', sparks: 4,
    letter: 'The station has been silent for years, and the old cherry in the yard has slept just as long. If that little robot still runs, show me it can work on its own.',
    done: 'You did it: the robot works by itself. And look at the old tree: there are buds on its branches.',
    objectives: [
      { text: 'Deliver 30 items to storage', target: 30, measure: (sim) => sim.achievements.delivered },
      { text: 'Learn Loops', target: 1, measure: (sim) => (sim.research.isDone('loop') ? 1 : 0) },
      { text: 'Build a Workbench', target: 1, measure: machines('workbench') },
    ],
  },
  {
    id: 'yard', title: 'The yard restored', from: 'Smith Bram', sparks: 6,
    letter: 'A yard is only a yard when its machines turn. Get the Lab running and a Sawmill singing, and stock some planks: we will need them.',
    done: 'The machines are humming again. The Heart Tree has its first blossoms: the valley remembers.',
    objectives: [
      { text: 'Build a Research Lab', target: 1, measure: machines('lab') },
      { text: 'Build a Sawmill', target: 1, measure: machines('sawmill') },
      { text: 'Stock 30 planks', target: 30, measure: stored('planks') },
    ],
  },
  {
    id: 'team', title: 'A working valley', from: 'Mayor Hazel', sparks: 8,
    letter: 'One robot is a helper. A team is a valley. Assemble a second robot, teach your robots more, and show me some clever programs.',
    done: 'A whole team at work. Half the Heart Tree is in bloom; people come to sit under it again.',
    objectives: [
      { text: 'Have 2 robots', target: 2, measure: (sim) => sim.robots.length },
      { text: 'Learn 8 skills', target: 8, measure: (sim) => sim.research.completed.size },
      { text: 'Earn 3 challenge stars', target: 3, measure: (sim) => [...sim.challenges.stars.values()].reduce((s, n) => s + n, 0) },
    ],
  },
  {
    id: 'reach', title: 'Roots and reach', from: 'Gardener Ivy', sparks: 10,
    letter: "The Heart Tree's roots run under the whole valley. Reclaim more land, catch the wind, and keep the goods flowing.",
    done: 'The valley is waking up everywhere the roots reach. The tree is nearly in full bloom: it is time to plan the festival.',
    objectives: [
      { text: 'Reclaim a new parcel', target: 1, measure: (sim) => sim.world.unlockedParcels().length - sim.baseParcels },
      { text: 'Build a Windmill', target: 1, measure: (sim) => sim.entities.ofKind('prop').filter((p) => p.spriteId === 'turbine').length },
      { text: 'Deliver 500 items in total', target: 500, measure: (sim) => sim.achievements.delivered },
    ],
  },
  {
    id: 'festival', title: 'The Blossom Festival', from: 'the whole valley', sparks: 20,
    letter: 'Everyone brings a gift to the Heart Tree for the festival. Program your robots to carry the offering into the tree: go_to("heart") and put().',
    done: 'The Heart Tree is in full bloom and the lanterns are lit. Happy festival! The tree will give Sparks every minute from now on: Eternal Spring.',
    objectives: [
      { text: 'Offer 100 planks', target: 100, measure: offered('planks') },
      { text: 'Offer 60 bricks', target: 60, measure: offered('bricks') },
      { text: 'Offer 30 research kits', target: 30, measure: offered('research_kit') },
    ],
  },
];

/** Eternal Spring: offering for the tree's next level (it grows with every level). */
export const springOffering = (level: number): Partial<Record<ResourceId, number>> => ({ planks: 60 * (level + 1), bricks: 40 * (level + 1), research_kit: 15 * (level + 1) });

/** Where the story is: the current chapter (CHAPTERS.length = Eternal Spring), offerings, and the tree's spring level. */
export class StoryBook {
  chapter = 0;
  offered: Partial<Record<ResourceId, number>> = {};
  level = 0;
  private sparkClock = 0;

  get eternal(): boolean { return this.chapter >= CHAPTERS.length; }
  /** The Heart Tree's bloom stage, 0 (asleep) to 5 (festival). */
  get bloom(): number { return Math.min(CHAPTERS.length, this.chapter); }
  get current(): Chapter | null { return CHAPTERS[this.chapter] ?? null; }
  /** Does the tree take offerings now? During the festival and in Eternal Spring. */
  get open(): boolean { return this.chapter >= CHAPTERS.length - 1; }

  progress(sim: Simulation): { text: string; value: number; target: number }[] {
    if (this.eternal) {
      return Object.entries(springOffering(this.level)).map(([id, n]) => ({ text: `Offer ${n} ${id === 'research_kit' ? 'research kits' : id}`, value: Math.min(n!, this.offered[id as ResourceId] ?? 0), target: n! }));
    }
    return this.current!.objectives.map((o) => ({ text: o.text, value: Math.min(o.target, o.measure(sim, this)), target: o.target }));
  }

  /**
   * Called twice a second: takes offerings out of the tree, finishes a chapter (or a spring level) when its goals are
   * met, and in Eternal Spring pays the tree's Sparks. Returns what just happened, for the game to tell the player.
   */
  update(sim: Simulation, dt: number, heart: Machine | undefined): { chapter?: Chapter; level?: number; sparks?: number } | null {
    if (heart) {
      heart.stage = this.bloom;
      for (const id of OFFERING_ITEMS) {
        const n = heart.input.get(id);
        if (n) { heart.input.remove(id, n); this.offered[id] = (this.offered[id] ?? 0) + n; }
      }
    }
    if (this.eternal) {
      const need = springOffering(this.level);
      if (Object.entries(need).every(([id, n]) => (this.offered[id as ResourceId] ?? 0) >= n!)) {
        for (const [id, n] of Object.entries(need)) this.offered[id as ResourceId]! -= n!;
        this.level++;
        return { level: this.level };
      }
      this.sparkClock += dt;
      if (this.sparkClock >= 60) { this.sparkClock -= 60; sim.research.sparks += this.level + 1; return { sparks: this.level + 1 }; }
      return null;
    }
    const ch = this.current!;
    if (!ch.objectives.every((o) => o.measure(sim, this) >= o.target)) return null;
    this.chapter++;
    sim.research.sparks += ch.sparks;
    if (ch.id === 'festival') this.offered = {}; // the festival gift is given; spring offerings start fresh
    return { chapter: ch };
  }
}
