import { ScriptError, isPending, type HostApi, type HostValue, type Pending, type ProgramInstance, type RunResult } from '../types.ts';
import { BIN_OPS, CMP_OPS, Op, UNARY_OPS, type Code } from './compiler.ts';
import {
  MAX_DEPTH, PyDict, PyIter, binop, callMethod, compareOrder, eq, isFn, iterate, levenshtein, listIndex, makeBuiltins,
  repr, str, toHost, toPy, truthy, tuple, tuples, typeName, type Builtin, type HostFn, type Val,
} from './values.ts';

/** Marks a local variable that has not been assigned yet. */
const UNSET = Symbol('unset');
type Slot = Val | typeof UNSET;

interface Frame { code: number; pc: number; locals: Slot[]; stack: Val[] }

/** A suspended host call: re-issued after loading a save, since robot actions are not saved mid-way. */
interface WaitingCall { name: string; args: HostValue[] }

/**
 * Stack-based virtual machine for compiled programs. All of its state (frames, globals, values)
 * is plain data, so `save()` can serialise a program mid-run and `restore` can continue it later.
 * It reaches the game only through the HostApi functions; there is no path to JavaScript.
 */
export class VM implements ProgramInstance {
  private frames: Frame[] = [];
  private readonly globals = new Map<string, Val>();
  private readonly builtins: Map<string, Val>;
  private waiting: WaitingCall | null = null;
  private reissue = false;
  private done = false;
  line: number | null = null;
  executed = 0;

  constructor(private readonly codes: Code[], private readonly host: HostApi) {
    this.builtins = new Map<string, Val>(makeBuiltins((t) => host.print(t)));
    for (const [name, fn] of host.functions) this.builtins.set(name, { kind: 'host', fn } satisfies HostFn);
    this.frames.push({ code: 0, pc: 0, locals: [], stack: [] });
  }

  resume(value: HostValue): void {
    if (!this.waiting) return;
    this.waiting = null;
    this.top.stack.push(toPy(value));
  }

  private get top(): Frame { return this.frames[this.frames.length - 1]; }

  /** Execute up to `budget` statements; stops early to wait for a robot action or when the program ends. */
  run(budget: number): RunResult {
    this.executed = 0;
    if (this.done) return { kind: 'done' };
    if (this.reissue && this.waiting) { // after loading a save: start the interrupted robot action again
      this.reissue = false;
      const fn = this.host.functions.get(this.waiting.name)!;
      const r = fn.call(this.waiting.args);
      if (isPending(r)) return { kind: 'wait', pending: r };
      this.resume(r);
    }
    for (;;) {
      const f = this.top;
      const code = this.codes[f.code];
      const op = code.ops[f.pc * 2] as Op, arg = code.ops[f.pc * 2 + 1], line = code.lines[f.pc];
      const st = f.stack;
      f.pc++;
      try {
        switch (op) {
          case Op.STMT:
            if (this.executed >= budget) { f.pc--; return { kind: 'budget' }; }
            this.executed++;
            this.line = line;
            break;
          case Op.CONST: st.push(code.consts[arg]); break;
          case Op.LOAD_NAME: case Op.LOAD_GLOBAL: st.push(this.lookup(code.names[arg], line)); break;
          case Op.STORE_NAME: case Op.STORE_GLOBAL: this.globals.set(code.names[arg], st.pop()!); break;
          case Op.LOAD_FAST: {
            const v = f.locals[arg];
            if (v === UNSET || v === undefined) throw new ScriptError('runtime', `UnboundLocalError: "${code.locals[arg]}" is used before it gets a value in this function.`, line);
            st.push(v);
            break;
          }
          case Op.STORE_FAST: f.locals[arg] = st.pop()!; break;
          case Op.POP: st.pop(); break;
          case Op.DUP: st.push(st[st.length - 1]); break;
          case Op.DUP2: st.push(st[st.length - 2], st[st.length - 1]); break;
          case Op.ROT2: { const a = st.pop()!, b = st.pop()!; st.push(a, b); break; }
          case Op.ROT3: { const c = st.pop()!, b = st.pop()!, a = st.pop()!; st.push(c, a, b); break; }
          case Op.BIN: { const b = st.pop()!, a = st.pop()!; st.push(binop(BIN_OPS[arg], a, b, line)); break; }
          case Op.UNARY: {
            const v = st.pop()!, o = UNARY_OPS[arg];
            if (o === 'not') st.push(!truthy(v));
            else {
              if (typeof v !== 'number' && typeof v !== 'boolean') throw new ScriptError('runtime', `TypeError: "${o}" needs a number, but got ${typeName(v)} ${repr(v)}.`, line);
              st.push(o === '-' ? -Number(v) : Number(v));
            }
            break;
          }
          case Op.CMP: { const b = st.pop()!, a = st.pop()!; st.push(compare(CMP_OPS[arg], a, b, line)); break; }
          case Op.JUMP: f.pc = arg; break;
          case Op.JUMP_IF_FALSE: if (!truthy(st.pop()!)) f.pc = arg; break;
          case Op.JUMP_IF_TRUE: if (truthy(st.pop()!)) f.pc = arg; break;
          case Op.JUMP_IF_FALSE_KEEP: if (!truthy(st[st.length - 1])) f.pc = arg; else st.pop(); break;
          case Op.JUMP_IF_TRUE_KEEP: if (truthy(st[st.length - 1])) f.pc = arg; else st.pop(); break;
          case Op.BUILD_LIST: st.push(st.splice(st.length - arg, arg)); break;
          case Op.BUILD_TUPLE: st.push(tuple(st.splice(st.length - arg, arg))); break;
          case Op.BUILD_DICT: {
            const items = st.splice(st.length - arg * 2, arg * 2), d = new PyDict();
            for (let i = 0; i < items.length; i += 2) d.set(items[i], items[i + 1], line);
            st.push(d);
            break;
          }
          case Op.BUILD_STR: st.push(st.splice(st.length - arg, arg).map(str).join('')); break;
          case Op.INDEX: {
            const idx = st.pop()!, obj = st.pop()!;
            if (Array.isArray(obj) || typeof obj === 'string') st.push(obj[listIndex(obj, idx, line)]);
            else if (obj instanceof PyDict) {
              const v = obj.get(idx, line);
              if (v === undefined) throw new ScriptError('runtime', `KeyError: the dictionary has no key ${repr(idx)}. Use .get(key, default) to avoid this error.`, line);
              st.push(v);
            } else throw new ScriptError('runtime', `TypeError: ${typeName(obj)} cannot be indexed with [ ].`, line);
            break;
          }
          case Op.STORE_INDEX: {
            const idx = st.pop()!, obj = st.pop()!, v = st.pop()!;
            if (Array.isArray(obj)) {
              if (tuples.has(obj)) throw new ScriptError('runtime', 'TypeError: tuples cannot be changed.', line);
              obj[listIndex(obj, idx, line)] = v;
            } else if (obj instanceof PyDict) obj.set(idx, v, line);
            else throw new ScriptError('runtime', `TypeError: ${typeName(obj)} does not support item assignment.`, line);
            break;
          }
          case Op.UNPACK: {
            const items = iterate(st.pop()!, line);
            if (items.length !== arg) throw new ScriptError('runtime', `ValueError: expected ${arg} values to unpack, but got ${items.length}.`, line);
            for (let i = items.length - 1; i >= 0; i--) st.push(items[i]);
            break;
          }
          case Op.GET_ITER: st.push(new PyIter(iterate(st.pop()!, line))); break;
          case Op.FOR_ITER: {
            const it = st[st.length - 1] as PyIter;
            if (it.i < it.items.length) st.push(it.items[it.i++]);
            else { st.pop(); f.pc = arg; }
            break;
          }
          case Op.MAKE_FUNCTION: {
            const idx = arg & 0xffff, nDef = arg >> 16;
            st.push({ kind: 'func', name: this.codes[idx].name, code: idx, defaults: st.splice(st.length - nDef, nDef) });
            break;
          }
          case Op.CALL_METHOD: {
            const name = code.names[arg & 0xffff], n = arg >> 16;
            const args = st.splice(st.length - n, n), obj = st.pop()!;
            st.push(callMethod(obj, name, args, line));
            break;
          }
          case Op.CALL: {
            const args = st.splice(st.length - arg, arg), fn = st.pop()!;
            const r = this.call(fn, args, line);
            if (r === null) break; // a user function frame was pushed
            if (r.wait) return { kind: 'wait', pending: r.wait };
            st.push(r.value);
            break;
          }
          case Op.RETURN: {
            const v = st.pop()!;
            this.frames.pop();
            if (!this.frames.length) { this.done = true; this.line = null; return { kind: 'done' }; }
            this.top.stack.push(v);
            break;
          }
        }
      } catch (e) {
        if (e instanceof ScriptError && e.line === undefined) throw new ScriptError(e.kind, e.message, line);
        throw e;
      }
    }
  }

  /** Call a value. Returns null when a user-function frame was pushed (execution continues inside it). */
  private call(fn: Val, args: Val[], line: number): { value: Val; wait?: undefined } | { wait: Pending; value?: undefined } | null {
    if (!isFn(fn)) throw new ScriptError('runtime', `TypeError: ${typeName(fn)} ${repr(fn)} is not a function, so it can't be called with ( ).`, line);
    if (fn.kind === 'builtin') return { value: fn.fn(args, line) };
    if (fn.kind === 'host') {
      const hostArgs = args.map((a) => toHost(a, line));
      let r;
      try { r = fn.fn.call(hostArgs); }
      catch (err) { if (err instanceof ScriptError) throw new ScriptError(err.kind, err.message, line); throw err; }
      if (isPending(r)) { this.waiting = { name: fn.fn.name, args: hostArgs }; return { wait: r }; }
      return { value: toPy(r) };
    }
    const code = this.codes[fn.code];
    const required = code.params.length - code.nDefaults;
    if (args.length < required || args.length > code.params.length) {
      const range = required === code.params.length ? `${required}` : `${required} to ${code.params.length}`;
      throw new ScriptError('runtime', `TypeError: ${fn.name}() takes ${range} argument${code.params.length === 1 ? '' : 's'}, but ${args.length} ${args.length === 1 ? 'was' : 'were'} given.`, line);
    }
    if (this.frames.length > MAX_DEPTH) throw new ScriptError('limit', `RecursionError: functions called each other more than ${MAX_DEPTH} levels deep. Does ${fn.name}() call itself forever?`, line);
    const locals: Slot[] = code.locals.map(() => UNSET);
    code.params.forEach((_, i) => { locals[i] = i < args.length ? args[i] : fn.defaults[i - required]; });
    this.frames.push({ code: fn.code, pc: 0, locals, stack: [] });
    return null;
  }

  private lookup(name: string, line: number): Val {
    const v = this.globals.get(name) ?? this.builtins.get(name);
    if (v !== undefined) return v;
    const known = [...this.globals.keys(), ...this.builtins.keys()];
    const best = known.map((k) => [k, levenshtein(name.toLowerCase(), k.toLowerCase())] as const).sort((a, b) => a[1] - b[1])[0];
    const hint = best && best[1] <= 2 ? ` Did you mean "${best[0]}"?` : ' If you meant text, put it in quotes.';
    throw new ScriptError('runtime', `NameError: "${name}" is not defined.${hint}`, line);
  }

  // ------------------------------------------------------------ saving

  /** Plain-JSON snapshot of the whole running program. */
  save(): VMState {
    const enc = new Encoder();
    return {
      v: 1, done: this.done, line: this.line, waiting: this.waiting,
      globals: [...this.globals].map(([k, v]) => [k, enc.val(v)]),
      frames: this.frames.map((f) => ({ code: f.code, pc: f.pc, locals: f.locals.map((l) => (l === UNSET ? { U: 1 } : enc.val(l))), stack: f.stack.map((x) => enc.val(x)) })),
    };
  }

  static restore(codes: Code[], host: HostApi, s: VMState): VM {
    const vm = new VM(codes, host);
    const dec = new Decoder(vm.builtins, codes.length);
    vm.done = s.done;
    vm.line = s.line;
    vm.waiting = s.waiting;
    vm.reissue = !!s.waiting;
    for (const [k, v] of s.globals) vm.globals.set(k, dec.val(v));
    vm.frames = s.frames.map((f) => {
      if (f.code >= codes.length) throw new Error('save does not match the program');
      return { code: f.code, pc: f.pc, locals: f.locals.map((l) => (isUnset(l) ? UNSET : dec.val(l))), stack: f.stack.map((x) => dec.val(x)) };
    });
    return vm;
  }
}

function compare(op: string, a: Val, b: Val, line: number): boolean {
  switch (op) {
    case '==': return eq(a, b);
    case '!=': return !eq(a, b);
    case 'is': return a === b;
    case 'is not': return a !== b;
    case 'in': case 'not in': {
      let r: boolean;
      if (typeof b === 'string') {
        if (typeof a !== 'string') throw new ScriptError('runtime', `TypeError: "in" with text needs text on the left, not ${typeName(a)}.`, line);
        r = b.includes(a);
      } else if (Array.isArray(b)) r = b.some((x) => eq(x, a));
      else if (b instanceof PyDict) r = b.get(a, line) !== undefined;
      else throw new ScriptError('runtime', `TypeError: can't use "in" with ${typeName(b)}.`, line);
      return op === 'in' ? r : !r;
    }
    default: return compareOrder(op, a, b, line);
  }
}

// ------------------------------------------------------------ value (de)serialisation

/** Encoded value: primitives as themselves, containers tagged, shared/cyclic containers by reference. */
type Enc = null | boolean | number | string | { [k: string]: unknown };
export interface VMState {
  v: 1;
  done: boolean;
  line: number | null;
  waiting: WaitingCall | null;
  globals: [string, Enc][];
  frames: { code: number; pc: number; locals: Enc[]; stack: Enc[] }[];
}
const isUnset = (e: Enc) => typeof e === 'object' && e !== null && 'U' in e;

class Encoder {
  private readonly ids = new Map<object, number>();
  val(v: Val): Enc {
    if (v === null || typeof v !== 'object') return typeof v === 'number' && !Number.isFinite(v) ? { N: String(v) } : v;
    const seen = this.ids.get(v);
    if (seen !== undefined) return { R: seen };
    const id = this.ids.size;
    this.ids.set(v, id);
    if (Array.isArray(v)) return { [tuples.has(v) ? 'T' : 'L']: id, items: v.map((x) => this.val(x)) };
    if (v instanceof PyDict) return { D: id, entries: [...v.m.values()].map(([k, x]) => [this.val(k), this.val(x)]) };
    if (v instanceof PyIter) return { I: id, i: v.i, items: v.items.map((x) => this.val(x)) };
    if (v.kind === 'func') return { F: id, code: v.code, name: v.name, defaults: v.defaults.map((x) => this.val(x)) };
    if (v.kind === 'builtin') return { B: v.name };
    return { H: v.fn.name };
  }
}

class Decoder {
  private readonly byId = new Map<number, Val>();
  constructor(private readonly builtins: Map<string, Val>, private readonly nCodes: number) {}
  val(e: Enc): Val {
    if (e === null || typeof e !== 'object') return e;
    const o = e as Record<string, unknown>;
    if ('N' in o) return Number(o.N);
    if ('R' in o) return this.byId.get(o.R as number)!;
    if ('B' in o || 'H' in o) {
      const b = this.builtins.get((o.B ?? o.H) as string);
      if (!b) throw new Error(`save refers to an unknown function ${String(o.B ?? o.H)}`);
      return b as Builtin;
    }
    if ('L' in o || 'T' in o) {
      const arr: Val[] = [];
      this.byId.set((o.L ?? o.T) as number, 'T' in o ? tuple(arr) : arr);
      for (const x of o.items as Enc[]) arr.push(this.val(x));
      return arr;
    }
    if ('D' in o) {
      const d = new PyDict();
      this.byId.set(o.D as number, d);
      for (const [k, x] of o.entries as [Enc, Enc][]) d.set(this.val(k), this.val(x), 0);
      return d;
    }
    if ('I' in o) {
      const it = new PyIter([], o.i as number);
      this.byId.set(o.I as number, it);
      it.items = (o.items as Enc[]).map((x) => this.val(x));
      return it;
    }
    if ('F' in o) {
      if ((o.code as number) >= this.nCodes) throw new Error('save does not match the program');
      const fn: Val = { kind: 'func', name: o.name as string, code: o.code as number, defaults: [] };
      this.byId.set(o.F as number, fn);
      fn.defaults = (o.defaults as Enc[]).map((x) => this.val(x));
      return fn;
    }
    throw new Error('unreadable value in save');
  }
}
