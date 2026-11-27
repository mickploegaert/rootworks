import type { CommandHandle, CommandResult } from '../api/RobotCommands.ts';

export type LanguageId = 'python' | 'java' | 'typescript';

export type ScriptErrorKind = 'syntax' | 'runtime' | 'limit' | 'unavailable';

/** Any problem with a player's program, phrased for the player. Line numbers are 1-based. */
export class ScriptError extends Error {
  constructor(readonly kind: ScriptErrorKind, message: string, readonly line?: number, readonly col?: number) {
    super(message);
  }
}

/** Values that cross between a program and the game. Plain data only. */
export type HostValue = null | boolean | number | string | HostValue[] | { [key: string]: HostValue };

/** A host function's result when it started a robot action: the program waits until the handle settles. */
export interface Pending {
  readonly pending: CommandHandle;
  /** Turns the action's outcome into the value the program receives. */
  readonly map: (r: CommandResult) => HostValue;
}

export const isPending = (v: unknown): v is Pending => typeof v === 'object' && v !== null && 'pending' in v;

/** A game function exposed to programs. Names are canonical (snake_case); adapters may alias them. */
export interface HostFunction {
  readonly name: string;
  readonly params: readonly string[];
  readonly doc: string;
  /** Skill needed (none: from the start) and a ready-to-insert call, for the command palette. */
  readonly skill?: string;
  readonly example?: string;
  /** Throws ScriptError('runtime') on bad arguments. */
  call(args: HostValue[]): HostValue | Pending;
}

/** What a program can reach: the registered game functions and an output channel. Nothing else. */
export interface HostApi {
  readonly functions: ReadonlyMap<string, HostFunction>;
  print(text: string): void;
}

/** Why a program stopped running for now. */
export type RunResult =
  /** Used its step budget for this tick; continues next tick. */
  | { kind: 'budget' }
  /** Started a robot action; call `resume` with its mapped result once it settles. */
  | { kind: 'wait'; pending: Pending }
  | { kind: 'done' };

/** A running program. Throws ScriptError from `run` on runtime errors and limits. */
export interface ProgramInstance {
  run(budget: number): RunResult;
  /** Deliver the result of the action the program is waiting for. */
  resume(value: HostValue): void;
  /** Line being executed (or waited on). */
  readonly line: number | null;
  /** The program's own variables and their values as text, for the debugger. */
  variables?(): [string, string][];
  /** Statements executed by the last `run`. */
  readonly executed: number;
  /** JSON-serialisable snapshot of the whole running program. */
  save(): unknown;
}

export interface CompiledProgram {
  start(host: HostApi): ProgramInstance;
  /** Continue a program from a `save()` snapshot made with the same source. */
  restore(host: HostApi, state: unknown): ProgramInstance;
}

/** Guided mode limits syntax to the skills the robots have learned; Engineer mode allows everything. */
export interface CompileOptions { guided: boolean; skills: ReadonlySet<string> }

/** One programming language. Every adapter targets the same HostApi, so all languages control robots identically. */
export interface LanguageAdapter {
  readonly id: LanguageId;
  readonly name: string;
  /** False while a language is still being built: compile() then explains instead of running. */
  readonly available: boolean;
  /** Throws ScriptError('syntax' | 'unavailable'). */
  compile(source: string, options?: CompileOptions): CompiledProgram;
}
