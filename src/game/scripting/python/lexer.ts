import { ScriptError } from '../types.ts';

export type TokType = 'name' | 'keyword' | 'number' | 'string' | 'fstring' | 'op' | 'newline' | 'indent' | 'dedent' | 'eof';

export interface Token { type: TokType; value: string; line: number; col: number; num?: number }

export const KEYWORDS = new Set([
  'if', 'elif', 'else', 'while', 'for', 'in', 'def', 'return', 'break', 'continue', 'pass',
  'and', 'or', 'not', 'is', 'True', 'False', 'None', 'global',
]);
/** Python keywords we do not support yet: named so the error can say so instead of being confusing. */
const UNSUPPORTED = new Set(['class', 'import', 'from', 'try', 'except', 'finally', 'with', 'lambda', 'yield', 'async', 'await', 'raise', 'del', 'assert', 'nonlocal']);

const OPS3 = ['**=', '//='];
const OPS2 = ['**', '//', '==', '!=', '<=', '>=', '+=', '-=', '*=', '/=', '%=', '->'];
const OPS1 = '+-*/%<>=()[]{},:.';
const CLOSE: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

/**
 * Turns Python source into tokens, including INDENT/DEDENT for block structure.
 * Newlines inside brackets are ignored, as in Python.
 */
export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  const indents = [0];
  const brackets: { ch: string; line: number; col: number }[] = [];
  let i = 0, line = 1, col = 1, atLineStart = true;

  const err = (msg: string, l = line, c = col) => { throw new ScriptError('syntax', msg, l, c); };
  const push = (type: TokType, value: string, l = line, c = col, num?: number) => out.push({ type, value, line: l, col: c, num });
  const advance = (n = 1) => { for (let k = 0; k < n; k++) { if (src[i] === '\n') { line++; col = 1; } else col++; i++; } };

  while (i < src.length) {
    if (atLineStart && brackets.length === 0) {
      // measure indentation; skip blank and comment-only lines entirely
      let width = 0, j = i;
      while (src[j] === ' ' || src[j] === '\t') { width += src[j] === '\t' ? 4 : 1; j++; }
      if (src[j] === '\n' || src[j] === '#' || src[j] === '\r' || j >= src.length) {
        while (i < src.length && src[i] !== '\n') advance();
        if (i < src.length) advance();
        continue;
      }
      advance(j - i);
      atLineStart = false;
      const top = indents[indents.length - 1];
      if (width > top) {
        indents.push(width); push('indent', '', line, 1);
      } else if (width < top) {
        while (width < indents[indents.length - 1]) { indents.pop(); push('dedent', '', line, 1); }
        if (width !== indents[indents.length - 1]) err('This line\'s indentation does not line up with any block above it. Use the same number of spaces as the lines it belongs with.', line, 1);
      }
      continue;
    }
    const ch = src[i];
    if (ch === '\n') {
      if (brackets.length === 0) { push('newline', '\n'); atLineStart = true; }
      advance();
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') { advance(); continue; }
    if (ch === '#') { while (i < src.length && src[i] !== '\n') advance(); continue; }
    if (ch === '\\' && src[i + 1] === '\n') { advance(2); continue; }

    const l = line, c = col;
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i;
      while (/[0-9_]/.test(src[j] ?? '')) j++;
      if (src[j] === '.' && /[0-9]/.test(src[j + 1] ?? '')) { j++; while (/[0-9_]/.test(src[j] ?? '')) j++; }
      else if (src[j] === '.' && !/[A-Za-z_]/.test(src[j + 1] ?? '')) j++;
      const text = src.slice(i, j);
      if (/[A-Za-z_]/.test(src[j] ?? '')) err(`"${text}${src[j]}" is not a valid number or name. Names cannot start with a digit.`);
      advance(j - i);
      push('number', text, l, c, Number(text.replace(/_/g, '')));
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (/[A-Za-z0-9_]/.test(src[j] ?? '')) j++;
      const word = src.slice(i, j);
      if ((word === 'f' || word === 'F') && (src[j] === '"' || src[j] === "'")) {
        advance(1);
        push('fstring', readString(), l, c);
        continue;
      }
      if (UNSUPPORTED.has(word)) err(`"${word}" is a Python feature ROOTWORKS does not support yet.`);
      advance(j - i);
      push(KEYWORDS.has(word) ? 'keyword' : 'name', word, l, c);
      continue;
    }
    if (ch === '"' || ch === "'") { push('string', readString(), l, c); continue; }

    const three = src.slice(i, i + 3), two = src.slice(i, i + 2);
    const op = OPS3.includes(three) ? three : OPS2.includes(two) ? two : OPS1.includes(ch) ? ch : null;
    if (!op) err(`Unexpected character "${ch}".${ch === '!' ? ' Python uses "not" instead of "!".' : ch === '&' || ch === '|' ? ' Python uses "and" / "or".' : ''}`);
    if ('([{'.includes(op!)) brackets.push({ ch: op!, line: l, col: c });
    else if (op! in CLOSE) {
      const open = brackets.pop();
      if (!open) err(`There is a "${op}" here without a matching opening bracket.`);
      if (open!.ch !== CLOSE[op!]) err(`Mismatched brackets: "${open!.ch}" on line ${open!.line} is closed by "${op}".`);
    }
    advance(op!.length);
    push('op', op!, l, c);
  }
  if (brackets.length) {
    const b = brackets[brackets.length - 1];
    err(`The "${b.ch}" opened here is never closed.`, b.line, b.col);
  }
  if (out.length && out[out.length - 1].type !== 'newline') push('newline', '\n');
  while (indents.length > 1) { indents.pop(); push('dedent', ''); }
  push('eof', '');
  return out;

  function readString(): string {
    const q = src[i], l = line, c = col;
    const triple = src.slice(i, i + 3) === q.repeat(3);
    advance(triple ? 3 : 1);
    let s = '';
    for (;;) {
      if (i >= src.length || (!triple && src[i] === '\n')) err('This text (string) is never closed. Add a matching quote at the end.', l, c);
      if (triple ? src.slice(i, i + 3) === q.repeat(3) : src[i] === q) { advance(triple ? 3 : 1); return s; }
      if (src[i] === '\\') {
        const e = src[i + 1];
        s += e === 'n' ? '\n' : e === 't' ? '\t' : e === '\\' ? '\\' : e === "'" ? "'" : e === '"' ? '"' : e === '\n' ? '' : '\\' + (e ?? '');
        advance(2);
        continue;
      }
      s += src[i];
      advance();
    }
  }
}
