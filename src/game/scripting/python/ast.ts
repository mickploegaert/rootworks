/** Python subset syntax tree. Every node carries its 1-based source line. */

export type Expr =
  | { t: 'num'; v: number; line: number }
  | { t: 'str'; v: string; line: number }
  | { t: 'fstr'; parts: (string | Expr)[]; line: number }
  | { t: 'const'; v: boolean | null; line: number }
  | { t: 'name'; id: string; line: number }
  | { t: 'list'; items: Expr[]; line: number }
  | { t: 'tuple'; items: Expr[]; line: number }
  | { t: 'dict'; keys: Expr[]; values: Expr[]; line: number }
  | { t: 'bin'; op: string; l: Expr; r: Expr; line: number }
  | { t: 'unary'; op: '-' | '+' | 'not'; e: Expr; line: number }
  | { t: 'bool'; op: 'and' | 'or'; l: Expr; r: Expr; line: number }
  | { t: 'cmp'; ops: string[]; items: Expr[]; line: number }
  | { t: 'call'; fn: Expr; args: Expr[]; line: number }
  | { t: 'index'; obj: Expr; idx: Expr; line: number }
  | { t: 'attr'; obj: Expr; name: string; line: number }
  | { t: 'ifexp'; test: Expr; then: Expr; else: Expr; line: number };

/** Assignable targets. */
export type Target =
  | { t: 'name'; id: string; line: number }
  | { t: 'index'; obj: Expr; idx: Expr; line: number }
  | { t: 'tuple'; items: Target[]; line: number };

export interface Param { name: string; default?: Expr }

export type Stmt =
  | { t: 'expr'; e: Expr; line: number }
  | { t: 'assign'; target: Target; op: string; value: Expr; line: number }
  | { t: 'if'; test: Expr; body: Stmt[]; orelse: Stmt[]; line: number }
  | { t: 'while'; test: Expr; body: Stmt[]; line: number }
  | { t: 'for'; target: Target; iter: Expr; body: Stmt[]; line: number }
  | { t: 'def'; name: string; params: Param[]; body: Stmt[]; line: number }
  | { t: 'return'; value: Expr | null; line: number }
  | { t: 'break'; line: number }
  | { t: 'continue'; line: number }
  | { t: 'pass'; line: number }
  | { t: 'global'; names: string[]; line: number };
