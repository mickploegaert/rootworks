import { LANGUAGE_IDS } from '../scripting/adapters.ts';
import type { LanguageId } from '../scripting/types.ts';

/** The subset of the Web Storage API we use; injectable for tests and a future Steam save backend. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface ProgramSave {
  version: 1;
  language: LanguageId;
  /** One program per language; switching never overwrites another language's code. */
  code: Partial<Record<LanguageId, string>>;
  /** Completed tutorial steps by id. */
  tutorial: string[];
  /** Guided mode: syntax unlocks with firmware. Off is Engineer mode (any Python). */
  guided?: boolean;
}

const KEY = 'rootworks.programs.v1';
const MAX_CODE = 200_000;

/** Persists the player's programs and language choice. Never throws: storage may be full, blocked or corrupt. */
export class ProgramStore {
  private data: ProgramSave;

  constructor(private readonly storage: KeyValueStorage | null) {
    this.data = this.read();
  }

  get language(): LanguageId { return this.data.language; }
  get tutorial(): readonly string[] { return this.data.tutorial; }
  get guided(): boolean { return this.data.guided !== false; }
  setGuided(on: boolean): void { this.data.guided = on; this.write(); }

  /** Saved code for a language, or null if the player has none yet. */
  code(lang: LanguageId): string | null { return this.data.code[lang] ?? null; }

  setLanguage(lang: LanguageId): void { this.data.language = lang; this.write(); }
  setCode(lang: LanguageId, code: string): void { this.data.code[lang] = code.slice(0, MAX_CODE); this.write(); }
  setTutorial(done: string[]): void { this.data.tutorial = [...done]; this.write(); }

  private read(): ProgramSave {
    const fresh: ProgramSave = { version: 1, language: 'python', code: {}, tutorial: [] };
    try {
      const raw = this.storage?.getItem(KEY);
      if (!raw) return fresh;
      const d = JSON.parse(raw) as Partial<ProgramSave>;
      // validate: this is data from outside the program
      if (LANGUAGE_IDS.includes(d.language as LanguageId)) fresh.language = d.language as LanguageId;
      if (d.code && typeof d.code === 'object') {
        for (const l of LANGUAGE_IDS) if (typeof d.code[l] === 'string') fresh.code[l] = d.code[l]!.slice(0, MAX_CODE);
      }
      if (d.guided === false) fresh.guided = false;
      if (Array.isArray(d.tutorial)) fresh.tutorial = d.tutorial.filter((s): s is string => typeof s === 'string');
    } catch { /* corrupt or inaccessible save: start fresh */ }
    return fresh;
  }

  private write(): void {
    try { this.storage?.setItem(KEY, JSON.stringify(this.data)); } catch { /* quota / privacy mode: keep working in memory */ }
  }
}
