import { ScriptError } from '../types.ts';
import type { Expr, Stmt } from './ast.ts';

/** Which skill (see research/ResearchDefs.ts) teaches each language concept (Guided mode). */
const SKILL = { variables: 'counter', arithmetic: 'operators', comparisons: 'operators', decisions: 'sense', loops: 'loop', functions: 'functions', lists: 'lists' } as const;
const NAME: Record<string, string> = { counter: 'Variables', operators: 'Operators', sense: 'Sense', loop: 'Loops', functions: 'Functions', lists: 'Lists' };
const WHAT: Record<keyof typeof SKILL, string> = {
  variables: 'Variables', arithmetic: 'Arithmetic (+ - * /)', comparisons: 'Comparisons (< > == !=)', decisions: 'Decisions (if/else, and/or/not)', loops: 'Loops (while/for)', functions: 'Functions (def)', lists: 'Lists ([...])',
};

/**
 * Guided mode: refuse concepts the robots have not learned yet, with a message that says which skill teaches
 * them. Engineer mode skips this entirely; the game's own gates (robot functions) apply in both.
 */
export function checkFeatures(program: Stmt[], skills: ReadonlySet<string>): void {
  const need = (k: keyof typeof SKILL, line: number) => {
    if (skills.has(SKILL[k])) return;
    throw new ScriptError('syntax', `${WHAT[k]} need the ${NAME[SKILL[k]]} skill. Buy it with Sparks in the Skills tab, or switch to Engineer mode to use any Python.`, line);
  };
  const expr = (e: Expr): void => {
    switch (e.t) {
      case 'bin': need('arithmetic', e.line); expr(e.l); expr(e.r); return;
      case 'unary': if (e.op === 'not') need('decisions', e.line); else need('arithmetic', e.line); expr(e.e); return;
      case 'cmp': need('comparisons', e.line); break;
      case 'list': need('lists', e.line); break;
      case 'bool': case 'ifexp': need('decisions', e.line); break;
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
        case 'def': need('functions', s.line); s.params.forEach((p) => p.default && expr(p.default)); block(s.body); break;
        case 'return': need('functions', s.line); if (s.value) expr(s.value); break;
      }
    }
  };
  block(program);
}
