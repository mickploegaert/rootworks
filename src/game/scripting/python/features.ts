import { ScriptError } from '../types.ts';
import type { Expr, Stmt } from './ast.ts';

/** Which firmware tier first teaches each language concept (Guided mode). */
const TIER = { variables: 1, arithmetic: 1, decisions: 2, loops: 3 } as const;
const FIRMWARE = ['Boot', 'Counter', 'Sense', 'Loop'];
const WHAT: Record<keyof typeof TIER, string> = {
  variables: 'Variables', arithmetic: 'Arithmetic', decisions: 'Decisions (if/else, comparisons, and/or/not)', loops: 'Loops (while/for)',
};

/**
 * Guided mode: refuse concepts the robots' firmware has not unlocked yet, with a message that says what
 * unlocks them. Engineer mode skips this entirely; the game's own gates (robot functions) apply in both.
 */
export function checkFeatures(program: Stmt[], firmware: number): void {
  const need = (k: keyof typeof TIER, line: number) => {
    if (firmware >= TIER[k]) return;
    throw new ScriptError('syntax', `${WHAT[k]} unlock with the ${FIRMWARE[TIER[k]]} firmware (T${TIER[k]}). Research it at the Lab, or switch to Engineer mode to use any Python.`, line);
  };
  const expr = (e: Expr): void => {
    switch (e.t) {
      case 'bin': need('arithmetic', e.line); expr(e.l); expr(e.r); return;
      case 'unary': if (e.op === 'not') need('decisions', e.line); else need('arithmetic', e.line); expr(e.e); return;
      case 'bool': case 'cmp': case 'ifexp': need('decisions', e.line); break;
    }
    if (e.t === 'bool') { expr(e.l); expr(e.r); }
    else if (e.t === 'cmp') e.items.forEach(expr);
    else if (e.t === 'ifexp') { expr(e.test); expr(e.then); expr(e.else); }
    else if (e.t === 'call') { expr(e.fn); e.args.forEach(expr); }
    else if (e.t === 'list' || e.t === 'tuple') e.items.forEach(expr);
    else if (e.t === 'dict') { e.keys.forEach(expr); e.values.forEach(expr); }
    else if (e.t === 'index') { expr(e.obj); expr(e.idx); }
    else if (e.t === 'attr') expr(e.obj);
    else if (e.t === 'fstr') e.parts.forEach((p) => { if (typeof p !== 'string') expr(p); });
  };
  const block = (ss: Stmt[]): void => {
    for (const s of ss) {
      switch (s.t) {
        case 'expr': expr(s.e); break;
        case 'assign': need('variables', s.line); if (s.op !== '=') need('arithmetic', s.line); expr(s.value); break;
        case 'if': need('decisions', s.line); expr(s.test); block(s.body); block(s.orelse); break;
        case 'while': need('loops', s.line); expr(s.test); block(s.body); break;
        case 'for': need('loops', s.line); expr(s.iter); block(s.body); break;
        case 'break': case 'continue': need('loops', s.line); break;
        case 'def': s.params.forEach((p) => p.default && expr(p.default)); block(s.body); break;
        case 'return': if (s.value) expr(s.value); break;
      }
    }
  };
  block(program);
}
