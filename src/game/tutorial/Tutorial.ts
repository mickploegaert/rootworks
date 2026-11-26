import type { ActionResult } from '../robot/RobotAction.ts';

export interface TutorialStep { id: string; label: string; hint: string; done: boolean }

const STEPS: readonly Omit<TutorialStep, 'done'>[] = [
  { id: 'move', label: 'Move the robot', hint: 'move("north")', },
  { id: 'harvest', label: 'Harvest a resource', hint: 'harvest()' },
  { id: 'storage', label: 'Go to storage', hint: 'move_to_storage()' },
  { id: 'deposit', label: 'Deposit the cargo', hint: 'deposit()' },
  { id: 'workbench', label: 'Build a Workbench', hint: 'Build menu' },
  { id: 'kit', label: 'Craft a research kit', hint: 'put() then take()' },
  { id: 'lab', label: 'Build a Research Lab', hint: 'Build menu' },
  { id: 'research', label: 'Finish your first research', hint: 'put("research_kit")' },
];

export const TUTORIAL_STEPS = STEPS.length;

/** Which step a successful robot action completes. Only actions started by a program count. */
function stepFor(r: ActionResult): string | null {
  if (!r.ok) return null;
  if (r.action.startsWith('move(') || r.action.startsWith('moveTo(')) return 'move';
  if (r.action.startsWith('harvest(')) return 'harvest';
  if (r.action === 'returnToStorage()' || r.action === 'go_to(storage)') return 'storage';
  if (r.action === 'deposit()' || (r.action.startsWith('put(') && r.data?.into === 'storage')) return 'deposit';
  if (r.action.startsWith('take(') && (r.data?.moved as Record<string, number> | undefined)?.research_kit) return 'kit';
  return null;
}

/** The first-hour tutorial: steps completed in order, by code the player runs and things they build. */
export class Tutorial {
  private readonly done = new Set<string>();

  constructor(completed: readonly string[] = []) {
    for (const s of STEPS) { if (!completed.includes(s.id)) break; this.done.add(s.id); }
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
