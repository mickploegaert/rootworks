import { ScriptError, type HostFunction, type HostValue } from '../types.ts';

// Python value model shared by the compiler and the virtual machine: types, printing, equality,
// operators, methods and built-ins. Everything here is plain data, so a running program can be saved.

export class PyDict {
  readonly m = new Map<string, [Val, Val]>();
  static key(k: Val, line: number): string {
    if (typeof k === 'string') return 's' + k;
    if (typeof k === 'number') return 'n' + k;
    if (typeof k === 'boolean') return 'n' + (k ? 1 : 0);
    if (k === null) return 'N';
    throw new ScriptError('runtime', `TypeError: ${typeName(k)} cannot be used as a dictionary key.`, line);
  }
  get(k: Val, line: number): Val | undefined { return this.m.get(PyDict.key(k, line))?.[1]; }
  set(k: Val, v: Val, line: number): void { this.m.set(PyDict.key(k, line), [k, v]); }
}
/** A user-defined function: an index into the program's compiled code objects plus its default values. */
export interface PyFunc { kind: 'func'; name: string; code: number; defaults: Val[] }
export interface Builtin { kind: 'builtin'; name: string; fn: (args: Val[], line: number) => Val }
export interface HostFn { kind: 'host'; fn: HostFunction }
/** A for-loop iterator: a snapshot of the items and a position. */
export class PyIter { constructor(public items: Val[], public i = 0) {} }
export type Val = null | boolean | number | string | Val[] | PyDict | PyFunc | Builtin | HostFn | PyIter;

const MAX_LIST = 10_000;
const MAX_STR = 100_000;
export const MAX_DEPTH = 100;
/** Tuples are arrays marked immutable. */
export const tuples = new WeakSet<Val[]>();
export const tuple = (items: Val[]) => { tuples.add(items); return items; };

export const isFn = (v: Val): v is PyFunc | Builtin | HostFn => typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof PyDict) && !(v instanceof PyIter);

export function typeName(v: Val): string {
  if (v === null) return 'None';
  if (typeof v === 'boolean') return 'bool';
  if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'float';
  if (typeof v === 'string') return 'str';
  if (Array.isArray(v)) return tuples.has(v) ? 'tuple' : 'list';
  if (v instanceof PyDict) return 'dict';
  if (v instanceof PyIter) return 'iterator';
  return 'function';
}

export function fmtNum(n: number): string {
  if (Number.isInteger(n)) return String(n);
  if (!Number.isFinite(n)) return n > 0 ? 'inf' : n < 0 ? '-inf' : 'nan';
  return String(Math.round(n * 1e12) / 1e12);
}

export function repr(v: Val): string {
  if (typeof v === 'string') return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
  return str(v);
}

export function str(v: Val): string {
  if (v === null) return 'None';
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (typeof v === 'number') return fmtNum(v);
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) {
    const inner = v.map(repr).join(', ');
    return tuples.has(v) ? `(${inner}${v.length === 1 ? ',' : ''})` : `[${inner}]`;
  }
  if (v instanceof PyDict) return `{${[...v.m.values()].map(([k, x]) => `${repr(k)}: ${repr(x)}`).join(', ')}}`;
  if (v instanceof PyIter) return '<iterator>';
  return `<function ${v.kind === 'host' ? v.fn.name : v.name}>`;
}

export function truthy(v: Val): boolean {
  if (v === null) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (v instanceof PyDict) return v.m.size > 0;
  return true;
}

export function eq(a: Val, b: Val): boolean {
  if (typeof a === 'boolean') a = a ? 1 : 0;
  if (typeof b === 'boolean') b = b ? 1 : 0;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => eq(x, b[i]));
  if (a instanceof PyDict && b instanceof PyDict) {
    if (a.m.size !== b.m.size) return false;
    for (const [k, [, v]] of a.m) { const o = b.m.get(k); if (!o || !eq(v, o[1])) return false; }
    return true;
  }
  return a === b;
}

export function toPy(v: HostValue): Val {
  if (Array.isArray(v)) return v.map(toPy);
  if (v !== null && typeof v === 'object') {
    const d = new PyDict();
    for (const [k, x] of Object.entries(v)) d.set(k, toPy(x), 0);
    return d;
  }
  return v;
}

export function toHost(v: Val, line: number): HostValue {
  if (Array.isArray(v)) return v.map((x) => toHost(x, line));
  if (v instanceof PyDict) {
    const o: { [k: string]: HostValue } = {};
    for (const [k, x] of v.m.values()) o[str(k)] = toHost(x, line);
    return o;
  }
  if (isFn(v) || v instanceof PyIter) throw new ScriptError('runtime', `TypeError: ${typeName(v)} cannot be passed to a game command.`, line);
  return v;
}

// ------------------------------------------------------------ helpers

export function levenshtein(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}

export function num(v: Val, what: string, line: number): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  throw new ScriptError('runtime', `TypeError: ${what} needs a number, but got ${typeName(v)} ${repr(v)}.`, line);
}

export function intArg(v: Val, what: string, line: number): number {
  const n = num(v, what, line);
  if (!Number.isInteger(n)) throw new ScriptError('runtime', `TypeError: ${what} needs a whole number, but got ${fmtNum(n)}.`, line);
  return n;
}

export function checkList(n: number, line: number): void {
  if (n > MAX_LIST) throw new ScriptError('limit', `MemoryError: lists are limited to ${MAX_LIST} items in ROOTWORKS.`, line);
}

export function iterate(v: Val, line: number): Val[] {
  if (Array.isArray(v)) return [...v];
  if (typeof v === 'string') return [...v];
  if (v instanceof PyDict) return [...v.m.values()].map(([k]) => k);
  throw new ScriptError('runtime', `TypeError: you can't loop over ${typeName(v)} ${repr(v)}. Loop over a list, a string or range(...).`, line);
}

export function compareOrder(op: string, a: Val, b: Val, line: number): boolean {
  const okNum = (typeof a === 'number' || typeof a === 'boolean') && (typeof b === 'number' || typeof b === 'boolean');
  const okStr = typeof a === 'string' && typeof b === 'string';
  if (!okNum && !okStr) throw new ScriptError('runtime', `TypeError: can't compare ${typeName(a)} and ${typeName(b)} with "${op}".`, line);
  const x = okNum ? num(a, '', line) : a, y = okNum ? num(b, '', line) : b;
  return op === '<' ? x < y : op === '>' ? x > y : op === '<=' ? x <= y : x >= y;
}

export function binop(op: string, a: Val, b: Val, line: number): Val {
  const bad = (hint = ''): never => {
    throw new ScriptError('runtime', `TypeError: can't use "${op}" between ${typeName(a)} and ${typeName(b)}.${hint}`, line);
  };
  if (op === '+') {
    if (typeof a === 'string' && typeof b === 'string') {
      if (a.length + b.length > MAX_STR) throw new ScriptError('limit', 'MemoryError: text is too long.', line);
      return a + b;
    }
    if (Array.isArray(a) && Array.isArray(b)) { checkList(a.length + b.length, line); return tuples.has(a) ? tuple([...a, ...b]) : [...a, ...b]; }
    if (typeof a === 'string' || typeof b === 'string') bad(' To join text and numbers, convert the number first: "x = " + str(x)');
  }
  if (op === '*') {
    const seq = typeof a === 'string' || Array.isArray(a) ? a : typeof b === 'string' || Array.isArray(b) ? b : null;
    if (seq !== null) {
      const n = intArg(seq === a ? b : a, 'repeating with "*"', line);
      const len = seq.length * Math.max(0, n);
      if (typeof seq === 'string') { if (len > MAX_STR) throw new ScriptError('limit', 'MemoryError: text is too long.', line); return seq.repeat(Math.max(0, n)); }
      checkList(len, line);
      return Array.from({ length: len }, (_, i) => seq[i % seq.length]);
    }
  }
  if ((typeof a !== 'number' && typeof a !== 'boolean') || (typeof b !== 'number' && typeof b !== 'boolean')) bad();
  const x = num(a, '', line), y = num(b, '', line);
  switch (op) {
    case '+': return x + y;
    case '-': return x - y;
    case '*': return x * y;
    case '/': if (y === 0) throw new ScriptError('runtime', 'ZeroDivisionError: you can\'t divide by zero.', line); return x / y;
    case '//': if (y === 0) throw new ScriptError('runtime', 'ZeroDivisionError: you can\'t divide by zero.', line); return Math.floor(x / y);
    case '%': if (y === 0) throw new ScriptError('runtime', 'ZeroDivisionError: modulo by zero.', line); return x - Math.floor(x / y) * y;
    case '**': return x ** y;
  }
  return bad();
}

/** Names assigned anywhere in a function body (excluding nested defs' bodies): Python makes them local. */

export function listIndex(seq: Val[] | string, idx: Val, line: number): number {
  const i = intArg(idx, 'an index', line);
  const j = i < 0 ? seq.length + i : i;
  if (j < 0 || j >= seq.length) throw new ScriptError('runtime', `IndexError: index ${i} is out of range (the ${typeof seq === 'string' ? 'text' : 'list'} has ${seq.length} item${seq.length === 1 ? '' : 's'}).`, line);
  return j;
}

/** list / dict / str methods, e.g. `items.append(x)`. */
export function callMethod(obj: Val, name: string, args: Val[], line: number): Val {
  const arity = (n: number, m = n) => {
    if (args.length < n || args.length > m) throw new ScriptError('runtime', `TypeError: .${name}() takes ${n === m ? n : `${n} to ${m}`} argument${m === 1 ? '' : 's'}, but ${args.length} were given.`, line);
  };
  if (Array.isArray(obj) && !tuples.has(obj)) {
    switch (name) {
      case 'append': arity(1); checkList(obj.length + 1, line); obj.push(args[0]); return null;
      case 'pop': {
        arity(0, 1);
        if (!obj.length) throw new ScriptError('runtime', 'IndexError: pop from an empty list.', line);
        const i = args.length ? listIndex(obj, args[0], line) : obj.length - 1;
        return obj.splice(i, 1)[0];
      }
      case 'insert': arity(2); checkList(obj.length + 1, line); obj.splice(intArg(args[0], 'insert position', line), 0, args[1]); return null;
      case 'remove': {
        arity(1);
        const i = obj.findIndex((x) => eq(x, args[0]));
        if (i < 0) throw new ScriptError('runtime', `ValueError: ${repr(args[0])} is not in the list.`, line);
        obj.splice(i, 1); return null;
      }
      case 'index': {
        arity(1);
        const i = obj.findIndex((x) => eq(x, args[0]));
        if (i < 0) throw new ScriptError('runtime', `ValueError: ${repr(args[0])} is not in the list.`, line);
        return i;
      }
      case 'count': arity(1); return obj.filter((x) => eq(x, args[0])).length;
      case 'reverse': arity(0); obj.reverse(); return null;
      case 'sort': arity(0); obj.sort((a, b) => (compareOrder('<', a, b, line) ? -1 : eq(a, b) ? 0 : 1)); return null;
    }
  }
  if (obj instanceof PyDict) {
    switch (name) {
      case 'get': arity(1, 2); return obj.get(args[0], line) ?? (args[1] ?? null);
      case 'keys': arity(0); return [...obj.m.values()].map(([k]) => k);
      case 'values': arity(0); return [...obj.m.values()].map(([, v]) => v);
      case 'items': arity(0); return [...obj.m.values()].map(([k, v]) => tuple([k, v]));
      case 'pop': {
        arity(1, 2);
        const v = obj.get(args[0], line);
        if (v === undefined) { if (args.length > 1) return args[1]; throw new ScriptError('runtime', `KeyError: ${repr(args[0])}`, line); }
        obj.m.delete(PyDict.key(args[0], line)); return v;
      }
    }
  }
  if (typeof obj === 'string') {
    switch (name) {
      case 'upper': arity(0); return obj.toUpperCase();
      case 'lower': arity(0); return obj.toLowerCase();
      case 'strip': arity(0); return obj.trim();
      case 'startswith': arity(1); return obj.startsWith(str(args[0]));
      case 'endswith': arity(1); return obj.endsWith(str(args[0]));
      case 'replace': arity(2); return obj.split(str(args[0])).join(str(args[1]));
      case 'split': arity(0, 1); return args.length ? obj.split(str(args[0])) : obj.split(/\s+/).filter(Boolean);
      case 'join': arity(1); return iterate(args[0], line).map((x) => {
        if (typeof x !== 'string') throw new ScriptError('runtime', 'TypeError: join() needs a list of text values.', line);
        return x;
      }).join(obj);
    }
  }
  throw new ScriptError('runtime', `AttributeError: ${typeName(obj)} has no method "${name}".`, line);
}

/** Python built-ins available to every program. `print` goes to the host's console. */
export function makeBuiltins(print: (text: string) => void): Map<string, Builtin> {
  const out = new Map<string, Builtin>();
  const b = (name: string, fn: (args: Val[], line: number) => Val) => out.set(name, { kind: 'builtin', name, fn });
  const arity = (name: string, args: Val[], n: number, m: number, line: number) => {
    if (args.length < n || args.length > m) throw new ScriptError('runtime', `TypeError: ${name}() takes ${n === m ? n : `${n} to ${m}`} argument${m === 1 ? '' : 's'}, but ${args.length} were given.`, line);
  };
  b('print', (args) => { print(args.map(str).join(' ')); return null; });
  b('len', (args, line) => {
    arity('len', args, 1, 1, line);
    const v = args[0];
    if (typeof v === 'string' || Array.isArray(v)) return v.length;
    if (v instanceof PyDict) return v.m.size;
    throw new ScriptError('runtime', `TypeError: ${typeName(v)} has no length.`, line);
  });
  b('range', (args, line) => {
    arity('range', args, 1, 3, line);
    const [start, stop, step] = args.length === 1 ? [0, intArg(args[0], 'range()', line), 1]
      : [intArg(args[0], 'range()', line), intArg(args[1], 'range()', line), args.length > 2 ? intArg(args[2], 'range()', line) : 1];
    if (step === 0) throw new ScriptError('runtime', 'ValueError: range() step cannot be zero.', line);
    const n = Math.max(0, Math.ceil((stop - start) / step));
    checkList(n, line);
    return Array.from({ length: n }, (_, i) => start + i * step);
  });
  b('str', (args, line) => { arity('str', args, 0, 1, line); return args.length ? str(args[0]) : ''; });
  b('int', (args, line) => {
    arity('int', args, 1, 1, line);
    const v = args[0];
    if (typeof v === 'string') {
      const n = Number(v.trim());
      if (!v.trim() || !Number.isInteger(n)) throw new ScriptError('runtime', `ValueError: "${v}" is not a whole number.`, line);
      return n;
    }
    return Math.trunc(num(v, 'int()', line));
  });
  b('float', (args, line) => {
    arity('float', args, 1, 1, line);
    const v = args[0];
    if (typeof v === 'string') { const n = Number(v.trim()); if (!v.trim() || Number.isNaN(n)) throw new ScriptError('runtime', `ValueError: "${v}" is not a number.`, line); return n; }
    return num(v, 'float()', line);
  });
  b('bool', (args, line) => { arity('bool', args, 0, 1, line); return args.length ? truthy(args[0]) : false; });
  b('abs', (args, line) => { arity('abs', args, 1, 1, line); return Math.abs(num(args[0], 'abs()', line)); });
  b('round', (args, line) => {
    arity('round', args, 1, 2, line);
    const p = 10 ** (args.length > 1 ? intArg(args[1], 'round()', line) : 0);
    return Math.round(num(args[0], 'round()', line) * p) / p;
  });
  const extreme = (name: string, pickA: (a: Val, b: Val, line: number) => boolean) => b(name, (args, line) => {
    const items = args.length === 1 ? iterate(args[0], line) : args;
    if (!items.length) throw new ScriptError('runtime', `ValueError: ${name}() needs at least one value.`, line);
    return items.reduce((a, x) => (pickA(a, x, line) ? a : x));
  });
  extreme('min', (a, x, line) => !compareOrder('<', x, a, line));
  extreme('max', (a, x, line) => !compareOrder('>', x, a, line));
  b('sum', (args, line) => { arity('sum', args, 1, 1, line); return iterate(args[0], line).reduce<number>((s, x) => s + num(x, 'sum()', line), 0); });
  b('list', (args, line) => { arity('list', args, 0, 1, line); return args.length ? iterate(args[0], line) : []; });
  b('sorted', (args, line) => {
    arity('sorted', args, 1, 1, line);
    return iterate(args[0], line).sort((a, x) => (compareOrder('<', a, x, line) ? -1 : eq(a, x) ? 0 : 1));
  });
  b('enumerate', (args, line) => { arity('enumerate', args, 1, 1, line); return iterate(args[0], line).map((x, i) => tuple([i, x])); });
  return out;
}
