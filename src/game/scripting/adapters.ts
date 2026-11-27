import { compile } from './python/compiler.ts';
import { parse } from './python/parser.ts';
import { VM, type VMState } from './python/vm.ts';
import { checkFeatures } from './python/features.ts';
import { ScriptError, type CompileOptions, type CompiledProgram, type LanguageAdapter, type LanguageId } from './types.ts';

/** Python: a real tokenizer and parser, compiled to bytecode for the sandboxed, saveable VM. */
export class PythonAdapter implements LanguageAdapter {
  readonly id = 'python' as const;
  readonly name = 'Python';
  readonly available = true;

  compile(source: string, options?: CompileOptions): CompiledProgram {
    const ast = parse(source);
    if (options?.guided) checkFeatures(ast, options.skills);
    const codes = compile(ast);
    return {
      start: (host) => new VM(codes, host),
      restore: (host, state) => VM.restore(codes, host, state as VMState),
    };
  }
}

/**
 * Placeholder for a language that is not implemented yet. It shares the adapter interface so the
 * editor, saving and language switching already work; compiling explains instead of running.
 */
export class PlannedAdapter implements LanguageAdapter {
  readonly available = false;
  constructor(readonly id: LanguageId, readonly name: string) {}

  compile(): CompiledProgram {
    throw new ScriptError('unavailable', `${this.name} support is still being built, so this program can't run yet. Your ${this.name} code is saved. Switch to Python to run programs now.`);
  }
}

export const LANGUAGES: Readonly<Record<LanguageId, LanguageAdapter>> = {
  python: new PythonAdapter(),
  java: new PlannedAdapter('java', 'Java'),
  typescript: new PlannedAdapter('typescript', 'TypeScript'),
};

export const LANGUAGE_IDS: readonly LanguageId[] = ['python', 'java', 'typescript'];
