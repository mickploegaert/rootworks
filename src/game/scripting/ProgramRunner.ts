import { Emitter } from '../core/Emitter.ts';
import { ScriptError, type CompiledProgram, type HostApi, type Pending, type ProgramInstance } from './types.ts';

export type RunState = 'running' | 'paused' | 'finished' | 'error' | 'stopped';

export interface RunLimits {
  /** Statements (and loop turns) allowed per simulation tick. Keeps the game responsive. */
  stepsPerTick: number;
  /** Steps allowed without the robot doing anything: catches `while True: pass`. */
  idleStepLimit: number;
  /** Absolute cap on steps for one run. */
  maxSteps: number;
}

export const DEFAULT_LIMITS: RunLimits = { stepsPerTick: 400, idleStepLimit: 100_000, maxSteps: 50_000_000 };

export interface RunnerEvents {
  state: RunState;
  line: number | null;
  error: ScriptError;
}

/** What a runner needs to continue after loading a save. */
export interface RunnerSave { program: unknown; state: 'running' | 'paused'; steps: number; idle: number }

/**
 * Drives one program in step with the simulation. Each tick it runs the program until it starts a
 * robot action (then waits, possibly many ticks, for it to finish), uses up its step budget, or ends.
 * Language-agnostic: it only sees a ProgramInstance.
 */
export class ProgramRunner {
  readonly events = new Emitter<RunnerEvents>();
  private readonly instance: ProgramInstance;
  private waiting: Pending | null = null;
  private steps = 0;
  private idle = 0;
  private _state: RunState = 'running';
  private _line: number | null = null;
  /** Step mode: run one statement (and the robot action it starts), then pause again. */
  private stepping = false;

  constructor(program: CompiledProgram, host: HostApi, private readonly limits: RunLimits = DEFAULT_LIMITS, saved?: RunnerSave) {
    this.instance = saved ? program.restore(host, saved.program) : program.start(host);
    if (saved) { this._state = saved.state; this.steps = saved.steps; this.idle = saved.idle; this._line = this.instance.line; }
  }

  get state(): RunState { return this._state; }
  get line(): number | null { return this._line; }
  get stepCount(): number { return this.steps; }
  get variables(): [string, string][] { return this.instance.variables?.() ?? []; }
  get isActive(): boolean { return this._state === 'running' || this._state === 'paused'; }

  pause(): void { if (this._state === 'running') this.setState('paused'); }
  resume(): void { if (this._state === 'paused') { this.stepping = false; this.setState('running'); } }
  /** From a pause: do one line, wait for its robot action to finish, then pause again. */
  step(): void { if (this._state === 'paused') { this.stepping = true; this.setState('running'); } }
  get isStepping(): boolean { return this.stepping; }

  /** End the program now. The caller is responsible for cancelling the robot's queued actions. */
  stop(): void {
    if (!this.isActive) return;
    this.waiting = null;
    this.setState('stopped');
  }

  /** Snapshot for a save game, or null when the program is no longer running. */
  save(): RunnerSave | null {
    if (!this.isActive) return null;
    return { program: this.instance.save(), state: this._state as 'running' | 'paused', steps: this.steps, idle: this.idle };
  }

  /** Advance the program by up to one tick's worth of work. Call once per simulation tick. */
  tick(): void {
    if (this._state !== 'running') return;
    if (this.waiting) {
      const r = this.waiting.pending.result;
      if (!r) return; // robot still busy
      this.instance.resume(this.waiting.map(r));
      this.waiting = null;
      this.idle = 0;
      if (this.stepping) return this.finishStep();
    }
    try {
      const r = this.instance.run(this.stepping ? 1 : this.limits.stepsPerTick);
      this.steps += this.instance.executed;
      this.idle += this.instance.executed;
      this.setLine(this.instance.line);
      if (r.kind === 'done') { this.setState('finished'); return; }
      if (r.kind === 'wait') this.waiting = r.pending;
      else if (this.stepping) { this.stepping = false; this.setState('paused'); return; } // a line without a robot action: show the next one
      if (this.idle > this.limits.idleStepLimit) {
        throw new ScriptError('limit', `Your program ran ${this.limits.idleStepLimit.toLocaleString('en')} steps without the robot doing anything. It is probably stuck in a loop that never ends (for example "while True:" with nothing that moves or harvests). The program was stopped.`, this._line ?? undefined);
      }
      if (this.steps > this.limits.maxSteps) throw new ScriptError('limit', `The program reached the limit of ${this.limits.maxSteps.toLocaleString('en')} steps and was stopped.`, this._line ?? undefined);
    } catch (e) {
      const err = e instanceof ScriptError ? e
        : new ScriptError('runtime', `Something went wrong inside the interpreter (${e instanceof Error ? e.message : String(e)}). This is a bug in ROOTWORKS, not in your program.`, this._line ?? undefined);
      this.waiting = null;
      this.events.emit('error', err);
      this.setState('error');
    }
  }

  /** The stepped line's action is done: finish that statement (budget 0 stops at the next line), then pause there. */
  private finishStep(): void {
    try {
      const r = this.instance.run(0);
      this.setLine(this.instance.line);
      if (r.kind === 'done') { this.stepping = false; this.setState('finished'); return; }
      if (r.kind === 'wait') { this.waiting = r.pending; return; } // the same line started another action
    } catch (e) {
      this.stepping = false;
      this.events.emit('error', e instanceof ScriptError ? e : new ScriptError('runtime', String(e), this._line ?? undefined));
      this.setState('error');
      return;
    }
    this.stepping = false;
    this.setState('paused');
  }

  private setLine(line: number | null): void {
    if (line !== this._line) { this._line = line; this.events.emit('line', line); }
  }

  private setState(s: RunState): void {
    this._state = s;
    this.events.emit('state', s);
  }
}
