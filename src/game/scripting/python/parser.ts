import { ScriptError } from '../types.ts';
import type { Expr, Param, Stmt, Target } from './ast.ts';
import { tokenize, type Token } from './lexer.ts';

const COMPARE = new Set(['==', '!=', '<', '>', '<=', '>=']);
const AUG = new Set(['=', '+=', '-=', '*=', '/=', '//=', '%=', '**=']);

/** Recursive-descent parser for the ROOTWORKS Python subset. Produces an AST or a friendly ScriptError. */
export function parse(src: string, lineOffset = 0): Stmt[] {
  return new Parser(tokenize(src), lineOffset).program();
}

class Parser {
  private p = 0;
  constructor(private readonly toks: Token[], private readonly lineOffset: number) {}

  private get tok(): Token { return this.toks[this.p]; }
  // a method, not a getter, so TypeScript does not keep a narrowed type across this.p++
  private type(): Token['type'] { return this.toks[this.p].type; }
  private ln(t: Token = this.tok): number { return t.line + this.lineOffset; }
  private err(msg: string, t: Token = this.tok): never { throw new ScriptError('syntax', msg, this.ln(t), t.col); }
  private is(value: string, type?: Token['type']): boolean { const t = this.tok; return t.value === value && (!type || t.type === type) && t.type !== 'string'; }
  private next(): Token { return this.toks[this.p++]; }
  private accept(value: string): boolean { if (this.is(value)) { this.p++; return true; } return false; }
  private expect(value: string, msg: string): Token { if (!this.is(value)) this.err(msg); return this.next(); }
  private show(t: Token): string { return t.type === 'newline' ? 'the end of the line' : t.type === 'eof' ? 'the end of the program' : t.type === 'indent' ? 'an indented line' : `"${t.value}"`; }

  program(): Stmt[] {
    const body: Stmt[] = [];
    while (this.type() !== 'eof') {
      if (this.type() === 'newline') { this.p++; continue; }
      body.push(...this.statement());
    }
    return body;
  }

  private statement(): Stmt[] {
    const t = this.tok;
    if (t.type === 'keyword') {
      switch (t.value) {
        case 'if': return [this.ifStmt()];
        case 'while': {
          this.p++;
          const test = this.expr();
          return [{ t: 'while', test, body: this.block('while'), line: this.ln(t) }];
        }
        case 'for': {
          this.p++;
          const target = this.targetList();
          this.expect('in', 'Expected "in" in the for loop, as in: for i in range(5):');
          const iter = this.expr();
          return [{ t: 'for', target, iter, body: this.block('for'), line: this.ln(t) }];
        }
        case 'def': return [this.defStmt()];
        case 'elif': case 'else': this.err(`"${t.value}" must follow an if block at the same indentation.`);
      }
    }
    if (t.type === 'indent') this.err('This line is indented, but nothing above it opens a block. Remove the extra spaces (blocks start after a line ending with ":").');
    const stmts = [this.simple()];
    while (this.accept(';')) if (this.type() !== 'newline') stmts.push(this.simple());
    if (this.type() !== 'newline') this.err(`Expected the line to end here, but found ${this.show(this.tok)}.${this.type() === 'name' || this.type() === 'string' || this.type() === 'number' ? ' Is a comma or an operator missing?' : ''}`);
    this.p++;
    return stmts;
  }

  private ifStmt(): Stmt {
    const t = this.next(); // if / elif
    const test = this.expr();
    const body = this.block(t.value);
    let orelse: Stmt[] = [];
    if (this.is('elif', 'keyword')) orelse = [this.ifStmt()];
    else if (this.is('else', 'keyword')) { this.p++; orelse = this.block('else'); }
    return { t: 'if', test, body, orelse, line: this.ln(t) };
  }

  private defStmt(): Stmt {
    const t = this.next();
    if (this.type() !== 'name') this.err('Expected a function name after "def".');
    const name = this.next().value;
    this.expect('(', `Expected "(" after the function name, as in: def ${name}():`);
    const params: Param[] = [];
    while (!this.is(')')) {
      if (this.type() !== 'name') this.err('Expected a parameter name.');
      const p: Param = { name: this.next().value };
      if (params.some((q) => q.name === p.name)) this.err(`The parameter "${p.name}" appears twice.`);
      if (this.accept('=')) p.default = this.expr();
      else if (params.some((q) => q.default)) this.err('Parameters without a default value must come before those with one.');
      params.push(p);
      if (!this.accept(',')) break;
    }
    this.expect(')', 'Expected ")" to close the parameter list.');
    if (this.accept('->')) this.expr(); // type hints are allowed and ignored
    return { t: 'def', name, params, body: this.block('def'), line: this.ln(t) };
  }

  /** ":" then an indented block, or a single simple statement on the same line. */
  private block(what: string): Stmt[] {
    if (!this.is(':')) this.err(`Expected ":" at the end of the ${what} line.`);
    this.p++;
    if (this.type() !== 'newline') {
      const s = this.simple();
      if (this.type() !== 'newline') this.err(`Expected the line to end here, but found ${this.show(this.tok)}.`);
      this.p++;
      return [s];
    }
    this.p++;
    if (this.type() !== 'indent') this.err(`The ${what} block is empty. Indent the lines that belong to it (4 spaces), or write "pass".`);
    this.p++;
    const body: Stmt[] = [];
    while (this.type() !== 'dedent' && this.type() !== 'eof') body.push(...this.statement());
    if (this.type() === 'dedent') this.p++;
    return body;
  }

  private simple(): Stmt {
    const t = this.tok;
    if (t.type === 'keyword') {
      switch (t.value) {
        case 'pass': this.p++; return { t: 'pass', line: this.ln(t) };
        case 'break': this.p++; return { t: 'break', line: this.ln(t) };
        case 'continue': this.p++; return { t: 'continue', line: this.ln(t) };
        case 'return': {
          this.p++;
          const value = this.type() === 'newline' || this.is(';') ? null : this.exprList();
          return { t: 'return', value, line: this.ln(t) };
        }
        case 'global': {
          this.p++;
          const names: string[] = [];
          do { if (this.type() !== 'name') this.err('Expected a variable name after "global".'); names.push(this.next().value); } while (this.accept(','));
          return { t: 'global', names, line: this.ln(t) };
        }
      }
    }
    const e = this.exprList();
    if (this.type() === 'op' && AUG.has(this.tok.value)) {
      const op = this.next().value;
      const target = this.toTarget(e, op !== '=');
      const value = this.exprList();
      if (op === '=' && this.is('=')) this.err('Chained assignment (a = b = 1) is not supported. Assign each variable on its own line.');
      return { t: 'assign', target, op, value, line: this.ln(t) };
    }
    return { t: 'expr', e, line: this.ln(t) };
  }

  private toTarget(e: Expr, single: boolean): Target {
    if (e.t === 'name' || e.t === 'index') return e;
    if (e.t === 'tuple' && single) this.err('You can only update one variable at a time with this operator.');
    if (e.t === 'tuple') return { t: 'tuple', items: e.items.map((x) => this.toTarget(x, false)), line: e.line };
    if (e.t === 'cmp' || e.t === 'call' || e.t === 'num' || e.t === 'str') this.err(e.t === 'call' ? 'You cannot assign to a function call.' : 'The left side of "=" must be a variable name. To compare values use "==".');
    this.err('The left side of "=" must be a variable name.');
  }

  private targetList(): Target {
    const items: Target[] = [];
    do {
      if (this.type() !== 'name') this.err('Expected a variable name for the loop.');
      const t = this.next();
      items.push({ t: 'name', id: t.value, line: this.ln(t) });
    } while (this.accept(','));
    return items.length === 1 ? items[0] : { t: 'tuple', items, line: items[0].line };
  }

  /** a, b, c  (tuple) or a single expression. */
  private exprList(): Expr {
    const first = this.expr();
    if (!this.is(',')) return first;
    const items = [first];
    while (this.accept(',')) {
      if (this.type() === 'newline' || (this.type() === 'op' && AUG.has(this.tok.value))) break;
      items.push(this.expr());
    }
    return { t: 'tuple', items, line: first.line };
  }

  expr(): Expr {
    const e = this.or();
    if (this.is('if', 'keyword')) {
      this.p++;
      const test = this.or();
      this.expect('else', 'Expected "else" in the conditional expression: a if condition else b');
      return { t: 'ifexp', test, then: e, else: this.expr(), line: e.line };
    }
    return e;
  }

  private or(): Expr {
    let l = this.and();
    while (this.is('or', 'keyword')) { this.p++; l = { t: 'bool', op: 'or', l, r: this.and(), line: l.line }; }
    return l;
  }

  private and(): Expr {
    let l = this.not();
    while (this.is('and', 'keyword')) { this.p++; l = { t: 'bool', op: 'and', l, r: this.not(), line: l.line }; }
    return l;
  }

  private not(): Expr {
    if (this.is('not', 'keyword')) { const t = this.next(); return { t: 'unary', op: 'not', e: this.not(), line: this.ln(t) }; }
    return this.comparison();
  }

  private comparison(): Expr {
    const first = this.arith();
    const ops: string[] = [], items = [first];
    for (;;) {
      const t = this.tok;
      let op: string | null = null;
      if (t.type === 'op' && COMPARE.has(t.value)) { op = t.value; this.p++; }
      else if (this.is('in', 'keyword')) { op = 'in'; this.p++; }
      else if (this.is('not', 'keyword') && this.toks[this.p + 1]?.value === 'in') { op = 'not in'; this.p += 2; }
      else if (this.is('is', 'keyword')) { this.p++; op = this.accept('not') ? 'is not' : 'is'; }
      if (!op) break;
      ops.push(op);
      items.push(this.arith());
    }
    return ops.length ? { t: 'cmp', ops, items, line: first.line } : first;
  }

  private arith(): Expr {
    let l = this.term();
    while (this.is('+', 'op') || this.is('-', 'op')) { const op = this.next().value; l = { t: 'bin', op, l, r: this.term(), line: l.line }; }
    return l;
  }

  private term(): Expr {
    let l = this.unary();
    while (['*', '/', '//', '%'].some((o) => this.is(o, 'op'))) { const op = this.next().value; l = { t: 'bin', op, l, r: this.unary(), line: l.line }; }
    return l;
  }

  private unary(): Expr {
    if (this.is('-', 'op') || this.is('+', 'op')) { const t = this.next(); return { t: 'unary', op: t.value as '-' | '+', e: this.unary(), line: this.ln(t) }; }
    return this.power();
  }

  private power(): Expr {
    const base = this.postfix();
    if (this.is('**', 'op')) { this.p++; return { t: 'bin', op: '**', l: base, r: this.unary(), line: base.line }; }
    return base;
  }

  private postfix(): Expr {
    let e = this.atom();
    for (;;) {
      if (this.is('(', 'op')) {
        this.p++;
        const args: Expr[] = [];
        while (!this.is(')')) {
          if (this.type() === 'name' && this.toks[this.p + 1]?.value === '=') this.err('Keyword arguments (name=value) are not supported yet. Pass values in order instead.');
          args.push(this.expr());
          if (!this.accept(',')) break;
        }
        this.expect(')', 'Expected ")" to close the function call, or a "," between arguments.');
        e = { t: 'call', fn: e, args, line: e.line };
      } else if (this.is('[', 'op')) {
        this.p++;
        if (this.is(':')) this.err('Slices ([a:b]) are not supported yet.');
        const idx = this.expr();
        if (this.is(':')) this.err('Slices ([a:b]) are not supported yet.');
        this.expect(']', 'Expected "]" to close the index.');
        e = { t: 'index', obj: e, idx, line: e.line };
      } else if (this.is('.', 'op')) {
        this.p++;
        if (this.type() !== 'name') this.err('Expected a method name after ".".');
        e = { t: 'attr', obj: e, name: this.next().value, line: e.line };
      } else return e;
    }
  }

  private atom(): Expr {
    const t = this.tok, line = this.ln(t);
    switch (t.type) {
      case 'number': this.p++; return { t: 'num', v: t.num!, line };
      case 'string': {
        this.p++;
        let v = t.value;
        while (this.type() === 'string') v += this.next().value; // "a" "b" concatenation
        return { t: 'str', v, line };
      }
      case 'fstring': this.p++; return { t: 'fstr', parts: this.fstringParts(t), line };
      case 'name': this.p++; return { t: 'name', id: t.value, line };
      case 'keyword':
        if (t.value === 'True' || t.value === 'False') { this.p++; return { t: 'const', v: t.value === 'True', line }; }
        if (t.value === 'None') { this.p++; return { t: 'const', v: null, line }; }
        this.err(`"${t.value}" cannot be used here.`);
        break;
      case 'op':
        if (t.value === '(') {
          this.p++;
          if (this.accept(')')) return { t: 'tuple', items: [], line };
          const e = this.exprList();
          this.expect(')', 'Expected ")" to close the bracket.');
          return e;
        }
        if (t.value === '[') {
          this.p++;
          const items: Expr[] = [];
          while (!this.is(']')) { items.push(this.expr()); if (!this.accept(',')) break; }
          this.expect(']', 'Expected "]" to close the list, or a "," between items.');
          return { t: 'list', items, line };
        }
        if (t.value === '{') {
          this.p++;
          const keys: Expr[] = [], values: Expr[] = [];
          while (!this.is('}')) {
            keys.push(this.expr());
            this.expect(':', 'Expected ":" between a dictionary key and its value.');
            values.push(this.expr());
            if (!this.accept(',')) break;
          }
          this.expect('}', 'Expected "}" to close the dictionary.');
          return { t: 'dict', keys, values, line };
        }
    }
    this.err(t.type === 'newline' || t.type === 'eof' ? 'This line ends too early: a value is missing.' : `Expected a value, but found ${this.show(t)}.`);
  }

  /** Split f"...{expr}..." into text and parsed expressions. */
  private fstringParts(t: Token): (string | Expr)[] {
    const parts: (string | Expr)[] = [];
    const s = t.value;
    let buf = '';
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '{' && s[i + 1] === '{') { buf += '{'; i++; continue; }
      if (s[i] === '}' && s[i + 1] === '}') { buf += '}'; i++; continue; }
      if (s[i] === '{') {
        const end = s.indexOf('}', i);
        if (end < 0) this.err('This f-string has a "{" without a closing "}".', t);
        const inner = s.slice(i + 1, end).trim();
        if (!inner) this.err('Empty {} in f-string.', t);
        if (buf) parts.push(buf);
        buf = '';
        const stmts = parse(inner, this.ln(t) - 1);
        const first = stmts[0];
        if (stmts.length !== 1 || first.t !== 'expr') this.err('Only expressions can go inside {} in an f-string.', t);
        parts.push(first.e);
        i = end;
        continue;
      }
      buf += s[i];
    }
    if (buf) parts.push(buf);
    return parts;
  }
}
