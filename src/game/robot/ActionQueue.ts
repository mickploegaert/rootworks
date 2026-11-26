import { Emitter } from '../core/Emitter.ts';
import type { ActionContext, ActionResult, RobotAction } from './RobotAction.ts';
import { RobotState } from './RobotState.ts';

interface Entry { action: RobotAction; resolve: (r: ActionResult) => void; onSettled?: (r: ActionResult) => void }

/** Max actions that may start and finish within a single tick (instant actions chain). */
const MAX_PER_TICK = 8;

/**
 * FIFO of robot actions. Exactly one action runs at a time; the next starts only when it
 * completes. A failure cancels everything queued behind it, since later steps usually depend on it.
 */
export class ActionQueue {
  readonly events = new Emitter<{ finished: ActionResult }>();
  private readonly pending: Entry[] = [];
  private current: Entry | null = null;

  get size(): number { return this.pending.length + (this.current ? 1 : 0); }
  get running(): RobotAction | null { return this.current?.action ?? null; }
  get labels(): string[] { return [this.current, ...this.pending].filter((e): e is Entry => !!e).map((e) => e.action.name); }

  /**
   * Queue an action; the promise settles when it finishes, fails or is cancelled. Never rejects.
   * `onSettled` is called synchronously at that moment, within the simulation tick (the promise
   * resolves a microtask later), so script engines can resume deterministically.
   */
  enqueue(action: RobotAction, onSettled?: (r: ActionResult) => void): Promise<ActionResult> {
    return new Promise((resolve) => this.pending.push({ action, resolve, onSettled }));
  }

  /** Cancel the running action and everything pending. */
  clear(ctx: ActionContext, reason = 'cancelled'): void {
    if (this.current) {
      this.current.action.cancel(ctx);
      this.settle(this.current, { ok: false, action: this.current.action.name, error: reason });
      this.current = null;
    }
    for (const e of this.pending.splice(0)) this.settle(e, { ok: false, action: e.action.name, error: reason });
    ctx.robot.state = RobotState.Idle;
    ctx.robot.progress = 0;
    ctx.robot.focus = null;
  }

  update(ctx: ActionContext, dt: number): void {
    for (let i = 0; i < MAX_PER_TICK; i++) {
      let status;
      if (!this.current) {
        const next = this.pending.shift();
        if (!next) { ctx.robot.state = RobotState.Idle; return; }
        this.current = next;
        ctx.robot.state = next.action.state;
        status = next.action.start(ctx);
      } else {
        status = this.current.action.update(ctx, dt);
      }
      if (status === 'running') return;

      const done = this.current;
      this.current = null;
      ctx.robot.progress = 0;
      ctx.robot.focus = null;
      const a = done.action;
      this.settle(done, status === 'done' ? { ok: true, action: a.name, data: a.data } : { ok: false, action: a.name, error: a.error ?? 'failed' });
      if (status === 'failed') this.clear(ctx, `skipped: ${a.name} failed`);
      dt = 0; // a chained action starts this tick but does not consume time already spent
    }
  }

  private settle(e: Entry, result: ActionResult): void {
    e.onSettled?.(result);
    e.resolve(result);
    this.events.emit('finished', result);
  }
}
