import { ScriptError } from '../types.ts';
import type { Expr, Stmt, Target } from './ast.ts';

/** Bytecode instructions. Each instruction is an (op, arg) pair; `lines` holds the source line per pair. */
export const enum Op {
  CONST, LOAD_NAME, STORE_NAME, LOAD_FAST, STORE_FAST, LOAD_GLOBAL, STORE_GLOBAL,
  POP, DUP, DUP2, ROT2, ROT3,
  BIN, UNARY, CMP,
  /** *_KEEP: jump keeping the value on the stack, or pop it and fall through (short-circuit and/or). */
  JUMP, JUMP_IF_FALSE, JUMP_IF_TRUE, JUMP_IF_FALSE_KEEP, JUMP_IF_TRUE_KEEP,
  BUILD_LIST, BUILD_TUPLE, BUILD_DICT, BUILD_STR,
  INDEX, STORE_INDEX, UNPACK,
  CALL, CALL_METHOD, RETURN, MAKE_FUNCTION,
  GET_ITER, FOR_ITER,
  /** Start of a statement or loop turn: the step counter and the "current line" live here. */
  STMT,
}

export const BIN_OPS = ['+', '-', '*', '/', '//', '%', '**'] as const;
export const CMP_OPS = ['==', '!=', '<', '>', '<=', '>=', 'in', 'not in', 'is', 'is not'] as const;
export const UNARY_OPS = ['-', '+', 'not'] as const;

/** One compiled function (or the module body, code 0). */
export interface Code {
  name: string;
  params: string[];
  nDefaults: number;
  /** Flat (op, arg) pairs. */
  ops: number[];
  /** Source line per instruction pair. */
  lines: number[];
  consts: (number | string | boolean | null)[];
  names: string[];
  /** Local variable names; parameters first. Empty for the module. */
  locals: string[];
  isModule: boolean;
}

interface Loop { kind: 'while' | 'for'; continueAt: number; breaks: number[] }

/** Compiles a parsed program to code objects. Code 0 is the module; functions follow. */
export function compile(program: Stmt[]): Code[] {
  const codes: Code[] = [];
  new FunctionCompiler(codes, '<module>', [], 0, program, null);
  return codes;
}

class FunctionCompiler {
  private readonly code: Code;
  private readonly loops: Loop[] = [];
  private readonly localSet: Set<string>;
  private line = 1;

  constructor(private readonly codes: Code[], name: string, params: string[], nDefaults: number, body: Stmt[], locals: Set<string> | null) {
    this.localSet = locals ?? new Set();
    this.code = { name, params, nDefaults, ops: [], lines: [], consts: [], names: [], locals: locals ? [...params, ...[...locals].filter((n) => !params.includes(n))] : [], isModule: !locals };
    codes.push(this.code);
    this.block(body);
    this.emit(Op.CONST, this.konst(null));
    this.emit(Op.RETURN);
  }

  // ---- emit helpers
  private emit(op: Op, arg = 0): number {
    this.code.ops.push(op, arg);
    this.code.lines.push(this.line);
    return this.code.ops.length / 2 - 1;
  }
  private get here(): number { return this.code.ops.length / 2; }
  private patch(at: number, target = this.here): void { this.code.ops[at * 2 + 1] = target; }
  private konst(v: number | string | boolean | null): number {
    const i = this.code.consts.findIndex((c) => c === v && typeof c === typeof v);
    return i >= 0 ? i : this.code.consts.push(v) - 1;
  }
  private nameIdx(n: string): number {
    const i = this.code.names.indexOf(n);
    return i >= 0 ? i : this.code.names.push(n) - 1;
  }
  private err(msg: string, line: number): never { throw new ScriptError('syntax', msg, line); }

  private load(name: string): void {
    if (this.code.isModule) this.emit(Op.LOAD_NAME, this.nameIdx(name));
    else if (this.localSet.has(name)) this.emit(Op.LOAD_FAST, this.code.locals.indexOf(name));
    else this.emit(Op.LOAD_GLOBAL, this.nameIdx(name));
  }
  private store(name: string): void {
    if (this.code.isModule) this.emit(Op.STORE_NAME, this.nameIdx(name));
    else if (this.localSet.has(name)) this.emit(Op.STORE_FAST, this.code.locals.indexOf(name));
    else this.emit(Op.STORE_GLOBAL, this.nameIdx(name));
  }

  // ---- statements
  private block(ss: Stmt[]): void { for (const s of ss) this.stmt(s); }

  private stmt(s: Stmt): void {
    this.line = s.line;
    if (s.t !== 'def' && s.t !== 'global') this.emit(Op.STMT);
    switch (s.t) {
      case 'expr': this.expr(s.e); this.emit(Op.POP); return;
      case 'pass': case 'global': return;
      case 'assign': {
        if (s.op === '=') { this.expr(s.value); this.assign(s.target); return; }
        const op = BIN_OPS.indexOf(s.op.slice(0, -1) as (typeof BIN_OPS)[number]);
        if (s.target.t === 'name') {
          this.load(s.target.id); this.expr(s.value); this.emit(Op.BIN, op); this.store(s.target.id);
        } else if (s.target.t === 'index') {
          this.expr(s.target.obj); this.expr(s.target.idx); this.emit(Op.DUP2); this.emit(Op.INDEX);
          this.expr(s.value); this.emit(Op.BIN, op); this.emit(Op.ROT3); this.emit(Op.STORE_INDEX);
        } else this.err('You can only update one variable at a time with this operator.', s.line);
        return;
      }
      case 'if': {
        this.expr(s.test);
        const toElse = this.emit(Op.JUMP_IF_FALSE);
        this.block(s.body);
        if (s.orelse.length) {
          const toEnd = this.emit(Op.JUMP);
          this.patch(toElse);
          this.block(s.orelse);
          this.patch(toEnd);
        } else this.patch(toElse);
        return;
      }
      case 'while': {
        const top = this.here;
        const loop: Loop = { kind: 'while', continueAt: top, breaks: [] };
        this.line = s.line;
        this.emit(Op.STMT);
        this.expr(s.test);
        const exit = this.emit(Op.JUMP_IF_FALSE);
        this.loops.push(loop); this.block(s.body); this.loops.pop();
        this.line = s.line;
        this.emit(Op.JUMP, top);
        this.patch(exit);
        loop.breaks.forEach((b) => this.patch(b));
        return;
      }
      case 'for': {
        this.expr(s.iter);
        this.emit(Op.GET_ITER);
        const top = this.here;
        const loop: Loop = { kind: 'for', continueAt: top, breaks: [] };
        this.line = s.line;
        this.emit(Op.STMT);
        const exit = this.emit(Op.FOR_ITER);
        this.assign(s.target);
        this.loops.push(loop); this.block(s.body); this.loops.pop();
        this.line = s.line;
        this.emit(Op.JUMP, top);
        this.patch(exit);
        loop.breaks.forEach((b) => this.patch(b));
        return;
      }
      case 'break': case 'continue': {
        const loop = this.loops.at(-1);
        if (!loop) this.err(`"${s.t}" can only be used inside a loop.`, s.line);
        if (s.t === 'continue') { this.emit(Op.JUMP, loop.continueAt); return; }
        if (loop.kind === 'for') this.emit(Op.POP); // drop the iterator
        loop.breaks.push(this.emit(Op.JUMP));
        return;
      }
      case 'return':
        if (this.code.isModule) this.err('"return" can only be used inside a function (def).', s.line);
        if (s.value) this.expr(s.value); else this.emit(Op.CONST, this.konst(null));
        this.emit(Op.RETURN);
        return;
      case 'def': {
        this.line = s.line;
        this.emit(Op.STMT);
        for (const p of s.params) if (p.default) this.expr(p.default);
        const idx = this.codes.length;
        new FunctionCompiler(this.codes, s.name, s.params.map((p) => p.name), s.params.filter((p) => p.default).length, s.body, localNames(s.body, s.params.map((p) => p.name)));
        this.line = s.line;
        this.emit(Op.MAKE_FUNCTION, idx | (s.params.filter((p) => p.default).length << 16));
        this.store(s.name);
        return;
      }
    }
  }

  private assign(t: Target): void {
    if (t.t === 'name') { this.store(t.id); return; }
    if (t.t === 'tuple') {
      this.emit(Op.UNPACK, t.items.length);
      for (const item of t.items) this.assign(item);
      return;
    }
    // stack: value -> value obj idx
    this.expr(t.obj); this.expr(t.idx); this.emit(Op.STORE_INDEX);
  }

  // ---- expressions
  private expr(e: Expr): void {
    const saved = this.line;
    this.line = e.line;
    switch (e.t) {
      case 'num': case 'str': this.emit(Op.CONST, this.konst(e.v)); break;
      case 'const': this.emit(Op.CONST, this.konst(e.v)); break;
      case 'name': this.load(e.id); break;
      case 'fstr':
        for (const p of e.parts) {
          if (typeof p === 'string') this.emit(Op.CONST, this.konst(p)); else this.expr(p);
        }
        this.emit(Op.BUILD_STR, e.parts.length);
        break;
      case 'list': e.items.forEach((x) => this.expr(x)); this.emit(Op.BUILD_LIST, e.items.length); break;
      case 'tuple': e.items.forEach((x) => this.expr(x)); this.emit(Op.BUILD_TUPLE, e.items.length); break;
      case 'dict':
        e.keys.forEach((k, i) => { this.expr(k); this.expr(e.values[i]); });
        this.emit(Op.BUILD_DICT, e.keys.length);
        break;
      case 'bin': this.expr(e.l); this.expr(e.r); this.emit(Op.BIN, BIN_OPS.indexOf(e.op as (typeof BIN_OPS)[number])); break;
      case 'unary': this.expr(e.e); this.emit(Op.UNARY, UNARY_OPS.indexOf(e.op)); break;
      case 'bool': {
        this.expr(e.l);
        const j = this.emit(e.op === 'and' ? Op.JUMP_IF_FALSE_KEEP : Op.JUMP_IF_TRUE_KEEP);
        this.expr(e.r);
        this.patch(j);
        break;
      }
      case 'ifexp': {
        this.expr(e.test);
        const toElse = this.emit(Op.JUMP_IF_FALSE);
        this.expr(e.then);
        const toEnd = this.emit(Op.JUMP);
        this.patch(toElse);
        this.expr(e.else);
        this.patch(toEnd);
        break;
      }
      case 'cmp': {
        // a < b < c  ==  a < b and b < c, evaluating b once
        this.expr(e.items[0]);
        const cleanups: number[] = [];
        for (let i = 0; i < e.ops.length; i++) {
          this.expr(e.items[i + 1]);
          const last = i === e.ops.length - 1;
          if (!last) { this.emit(Op.DUP); this.emit(Op.ROT3); }
          this.emit(Op.CMP, CMP_OPS.indexOf(e.ops[i] as (typeof CMP_OPS)[number]));
          if (!last) cleanups.push(this.emit(Op.JUMP_IF_FALSE_KEEP)); // keeps False when jumping, pops True otherwise
        }
        if (cleanups.length) {
          const toEnd = this.emit(Op.JUMP);
          cleanups.forEach((c) => this.patch(c));
          this.emit(Op.ROT2); this.emit(Op.POP); // drop the leftover middle operand under the False result
          this.patch(toEnd);
        }
        break;
      }
      case 'index': this.expr(e.obj); this.expr(e.idx); this.emit(Op.INDEX); break;
      case 'attr': return this.err(`"${e.name}" must be called as a method, like value.${e.name}(...).`, e.line);
      case 'call': {
        if (e.fn.t === 'attr') {
          this.expr(e.fn.obj);
          e.args.forEach((a) => this.expr(a));
          this.line = e.line;
          this.emit(Op.CALL_METHOD, this.nameIdx(e.fn.name) | (e.args.length << 16));
        } else {
          this.expr(e.fn);
          e.args.forEach((a) => this.expr(a));
          this.line = e.line;
          this.emit(Op.CALL, e.args.length);
        }
        break;
      }
    }
    this.line = saved;
  }
}

/** Names assigned anywhere in a function body (not in nested defs' bodies): Python makes them local. */
function localNames(body: Stmt[], params: string[]): Set<string> {
  const names = new Set(params), globals = new Set<string>();
  const addTarget = (t: Target) => { if (t.t === 'name') names.add(t.id); else if (t.t === 'tuple') t.items.forEach(addTarget); };
  const walk = (ss: Stmt[]) => {
    for (const s of ss) {
      if (s.t === 'assign') addTarget(s.target);
      else if (s.t === 'for') { addTarget(s.target); walk(s.body); }
      else if (s.t === 'def') names.add(s.name);
      else if (s.t === 'global') s.names.forEach((n) => globals.add(n));
      else if (s.t === 'if') { walk(s.body); walk(s.orelse); }
      else if (s.t === 'while') walk(s.body);
    }
  };
  walk(body);
  globals.forEach((g) => names.delete(g));
  return names;
}
