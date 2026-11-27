import type { KeyValueStorage } from './ProgramStore.ts';

/**
 * Player settings. Each option is declared once in SETTING_DEFS (label, help, choices, default):
 * the settings screen renders from it, so adding an option is one entry here plus the code that reads it.
 */
export interface Settings {
  autosave: number;
  reducedMotion: boolean;
  uiScale: number;
  editorFont: number;
  showTutorial: boolean;
  sound: number;
}

interface Choice<T> { value: T; label: string }
export interface SettingDef<K extends keyof Settings = keyof Settings> {
  id: K;
  group: 'Gameplay' | 'Display' | 'Accessibility' | 'Programming';
  label: string;
  help: string;
  choices: readonly Choice<Settings[K]>[];
}

export const SETTING_DEFS: readonly SettingDef[] = [
  { id: 'autosave', group: 'Gameplay', label: 'Autosave', help: 'How often the game saves to your current slot. It always saves when you leave.',
    choices: [{ value: 30, label: 'Every 30 s' }, { value: 60, label: 'Every minute' }, { value: 300, label: 'Every 5 min' }, { value: 0, label: 'Only on exit' }] },
  { id: 'sound', group: 'Gameplay', label: 'Sound effects', help: 'Soft clicks and chimes when robots harvest, deliver and learn.',
    choices: [{ value: 0.6, label: 'On' }, { value: 0.25, label: 'Quiet' }, { value: 0, label: 'Off' }] },
  { id: 'showTutorial', group: 'Programming', label: 'Tutorial checklist', help: 'Show the tutorial steps above the editor until you finish them.',
    choices: [{ value: true, label: 'Show' }, { value: false, label: 'Hide' }] },
  { id: 'editorFont', group: 'Programming', label: 'Editor text size', help: 'Font size of the code editor and console.',
    choices: [{ value: 12, label: 'Small' }, { value: 14, label: 'Medium' }, { value: 16, label: 'Large' }, { value: 19, label: 'Extra large' }] },
  { id: 'uiScale', group: 'Display', label: 'Interface size', help: 'Scale of the panels, buttons and text around the map.',
    choices: [{ value: 0.9, label: '90%' }, { value: 1, label: '100%' }, { value: 1.15, label: '115%' }, { value: 1.3, label: '130%' }] },
  { id: 'reducedMotion', group: 'Accessibility', label: 'Reduce motion', help: 'Turns off drifting clouds, insects and the slow title-screen camera.',
    choices: [{ value: false, label: 'Off' }, { value: true, label: 'On' }] },
];

const KEY = 'rootworks.settings.v1';

export function defaultSettings(prefersReducedMotion = false): Settings {
  return { autosave: 30, reducedMotion: prefersReducedMotion, uiScale: 1, editorFont: 14, showTutorial: true, sound: 0.6 };
}

/** Reads and writes settings; anything stored that isn't one of an option's choices falls back to the default. */
export class SettingsStore {
  private data: Settings;

  constructor(private readonly storage: KeyValueStorage | null, prefersReducedMotion = false) {
    this.data = defaultSettings(prefersReducedMotion);
    try {
      const raw = JSON.parse(storage?.getItem(KEY) || '{}') as Record<string, unknown>;
      for (const def of SETTING_DEFS) {
        if (def.choices.some((c) => c.value === raw[def.id])) (this.data as unknown as Record<string, unknown>)[def.id] = raw[def.id];
      }
    } catch { /* corrupt: defaults */ }
  }

  get value(): Readonly<Settings> { return this.data; }

  set<K extends keyof Settings>(id: K, value: Settings[K]): Settings {
    this.data = { ...this.data, [id]: value };
    try { this.storage?.setItem(KEY, JSON.stringify(this.data)); } catch { /* memory only */ }
    return this.data;
  }
}
