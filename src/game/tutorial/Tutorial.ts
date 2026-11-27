import type { ActionResult } from '../robot/RobotAction.ts';

export interface TutorialStep {
  id: string;
  /** What to do, as a short goal. */
  label: string;
  /** Why it matters: one sentence. */
  why: string;
  /** How to do it, in plain words. */
  how: string;
  /** Ready-to-insert code for this step, or null when the step is done outside the editor (building, research panel). */
  code: string | null;
  done: boolean;
}

/**
 * The first-hour lessons. Each step teaches one idea through play: the player runs real code, sees the robot do it,
 * and gets something useful out of it. Ids are stored in saves, so keep them (a removed id is simply skipped).
 */
const STEPS: readonly Omit<TutorialStep, 'done'>[] = [
  {
    id: 'move', label: 'Send Seedling to the scrap pile',
    why: 'Robots only do what a program tells them. go_to() finds the way for you: no counting steps.',
    how: 'Press Run. The green line in the editor shows which command Seedling is doing.',
    code: 'go_to("scrap")',
  },
  {
    id: 'harvest', label: 'Harvest your first resource',
    why: 'Everything you build starts as raw resources. Seedling carries them in its cargo hold (see the robot panel).',
    how: 'Add harvest() under go_to("scrap") and Run again.',
    code: 'harvest()',
  },
  {
    id: 'deposit', label: 'Bring the cargo home',
    why: 'Cargo only counts once it is in storage. Storage pays for buildings: watch the bar at the top fill up.',
    how: 'deposit() walks to the storage depot by itself and unloads everything.',
    code: 'deposit()',
  },
  {
    id: 'automate', label: 'Make Seedling work by itself',
    why: 'Each lesson earned you a Spark. Three Sparks buy Loops: code that repeats forever. That is automation.',
    how: 'Open Skills (top), buy Loops, then put your commands inside while True: and Run. Press Stop to end it.',
    code: 'while True:\n    go_to("scrap")\n    harvest()\n    deposit()',
  },
  {
    id: 'workbench', label: 'Build a Workbench',
    why: 'Machines turn resources into better things. The Workbench crafts Research Kits.',
    how: 'Collect 6 Scrap Metal, then open Build (bottom left), pick the Workbench and click a free spot.',
    code: null,
  },
  {
    id: 'kit', label: 'Craft a Research Kit',
    why: 'A Research Kit is worth 2 Sparks at the Lab: the steady way to earn skills once the lessons run out.',
    how: 'Bring 2 Timber and 1 Scrap Metal to the Workbench, put() them in, and take() the kit out.',
    code: 'go_to("tree")\nharvest()\ngo_to("scrap")\nharvest()\ngo_to("workbench")\nput()\ntake("research_kit")',
  },
  {
    id: 'lab', label: 'Build a Research Lab',
    why: 'The Lab turns Research Kits into Sparks, the currency of the Skills tab.',
    how: 'Build menu, Science tab. It costs Timber and Scrap Metal from storage.',
    code: null,
  },
  {
    id: 'research', label: 'Turn a Research Kit into Sparks',
    why: 'The Lab turns every Research Kit into 2 Sparks. Sparks buy new skills: Variables, Sense, machines, more robots.',
    how: 'Carry kits to the Lab: go_to("lab") and put("research_kit"). Then spend the Sparks in the Skills tab.',
    code: 'go_to("lab")\nput("research_kit")',
  },
];

export const TUTORIAL_STEPS = STEPS.length;
/** Lessons inserted after release: saves made before them must not lose their later progress. */
const ADDED_LATER = new Set(['automate']);

/** Which step a successful robot action completes. Only actions started by a program count. */
function stepFor(r: ActionResult): string | null {
  if (!r.ok) return null;
  if (/^(move|moveTo|go_to|approach)\(/.test(r.action) || r.action === 'returnToStorage()') return 'move';
  if (r.action.startsWith('harvest(')) return 'harvest';
  if (r.action === 'deposit()' || (r.action.startsWith('put(') && r.data?.into === 'storage')) return 'deposit';
  if (r.action.startsWith('take(') && (r.data?.moved as Record<string, number> | undefined)?.research_kit) return 'kit';
  return null;
}

/** The first-hour tutorial: steps completed in order, by code the player runs and things they build. */
export class Tutorial {
  private readonly done = new Set<string>();

  constructor(completed: readonly string[] = []) {
    const later = (i: number) => STEPS.slice(i + 1).some((s) => completed.includes(s.id));
    STEPS.forEach((s, i) => {
      if (this.done.size < i) return; // progress is a prefix
      // a lesson added in an update counts as done when the save is already past it
      if (completed.includes(s.id) || (ADDED_LATER.has(s.id) && later(i))) this.done.add(s.id);
    });
  }

  get steps(): TutorialStep[] { return STEPS.map((s) => ({ ...s, done: this.done.has(s.id) })); }
  get complete(): boolean { return this.done.size === STEPS.length; }
  get completed(): string[] { return [...this.done]; }

  /** Milestones reached ahead of time (a building finished early): they complete as soon as their turn comes. */
  private readonly achieved = new Set<string>();

  /** Complete a step reached by something other than a robot action (a building finished, research done). */
  mark(id: string): boolean {
    this.achieved.add(id);
    return this.advance();
  }

  private advance(): boolean {
    let any = false;
    for (let next = STEPS.find((s) => !this.done.has(s.id)); next && this.achieved.has(next.id); next = STEPS.find((s) => !this.done.has(s.id))) {
      this.done.add(next.id);
      any = true;
    }
    return any;
  }

  /** Returns true if this result completed the next step. */
  observe(r: ActionResult): boolean {
    const next = STEPS.find((s) => !this.done.has(s.id));
    if (!next || stepFor(r) !== next.id) return false;
    this.done.add(next.id);
    this.advance();
    return true;
  }
}
