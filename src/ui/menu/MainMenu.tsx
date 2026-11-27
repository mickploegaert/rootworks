import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BloomMeter } from '../Story.tsx';
import type { SaveSlot, SlotId, SlotSummary } from '../../game/save/GameSave.ts';
import type { CosmeticId } from '../../game/render/sprites/robot.ts';
import { readAlbum } from '../album.ts';
import { SETTING_DEFS, type Settings } from '../../game/save/Settings.ts';
import { TUTORIAL_STEPS } from '../../game/tutorial/Tutorial.ts';
import type { MenuScene } from '../../game/menu/MenuScene.ts';

export interface StartRequest { slot: SlotId; fresh: boolean; tutorial: boolean }

interface Props {
  slots: { slot: SaveSlot; summary: SlotSummary | null }[];
  settings: Settings;
  onSetting<K extends keyof Settings>(id: K, value: Settings[K]): void;
  onStart(req: StartRequest): void;
  onDelete(slot: SlotId): void;
}

type Sheet = null | 'load' | 'settings' | 'credits' | 'tutorial' | { pickFor: 'play' | 'tutorial' } | { confirm: StartRequest; summary: SlotSummary };

const minutes = (s: number) => (s < 60 ? 'under a minute' : s < 3600 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);
const when = (t: number) => {
  const d = (Date.now() - t) / 1000;
  return d < 60 ? 'just now' : d < 3600 ? `${Math.round(d / 60)} min ago` : d < 86400 ? `${Math.round(d / 3600)} h ago` : new Date(t).toLocaleDateString();
};
const describe = (s: SlotSummary) => `${minutes(s.playSeconds)} played · ${s.robots} robot${s.robots === 1 ? '' : 's'} · ${s.research} research`;

/** The title screen: a living diorama of the works behind a menu that really does what it says. */
export function MainMenu({ slots, settings, onSetting, onStart, onDelete }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<MenuScene | null>(null);
  const [ready, setReady] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const firstButton = useRef<HTMLButtonElement>(null);

  // the backdrop is a separate chunk: the menu buttons work before it has loaded
  const latestLook = [...slots].map((s) => s.summary).filter((s): s is SlotSummary => !!s).sort((a, b) => b.savedAt - a.savedAt)[0];
  useEffect(() => {
    let dead = false;
    import('../../game/menu/MenuScene.ts').then(({ MenuScene }) => MenuScene.create(host.current!, settings.reducedMotion, { sprout: latestLook?.sprout ?? 0, cosmetic: (latestLook?.cosmetic ?? null) as CosmeticId | null })).then((s) => {
      if (dead) return s.destroy();
      scene.current = s;
      setReady(true);
    }).catch((e) => console.warn('Title backdrop unavailable:', e));
    return () => { dead = true; scene.current?.destroy(); scene.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- created once; motion changes are pushed below
  }, []);
  useEffect(() => { scene.current?.setReducedMotion(settings.reducedMotion); }, [settings.reducedMotion]);
  useEffect(() => { firstButton.current?.focus(); }, []);

  const saved = slots.filter((s): s is { slot: SaveSlot; summary: SlotSummary } => !!s.summary);
  const latest = [...saved].sort((a, b) => b.summary.savedAt - a.summary.savedAt)[0]?.summary;
  const empty = slots.find((s) => !s.summary)?.slot.id;
  const [, bump] = useState(0);
  /** Name a valley: kept beside its save, shown on the cards. */
  const rename = (id: SlotId) => {
    const slot = slots.find((s) => s.slot.id === id)!.slot;
    const name = window.prompt('Name this valley', slot.name ?? '');
    if (name === null) return;
    slot.rename(name);
    bump((n) => n + 1);
  };
  const unfinishedTutorial = [...saved].sort((a, b) => b.summary.savedAt - a.summary.savedAt).find((s) => s.summary.tutorialSteps < TUTORIAL_STEPS)?.summary;

  /** New game: an empty slot if there is one; otherwise the player picks which save to replace. */
  const newGame = (tutorial: boolean) => (empty ? onStart({ slot: empty, fresh: true, tutorial }) : setSheet({ pickFor: tutorial ? 'tutorial' : 'play' }));

  // arrow keys move between menu buttons; Esc closes a sheet
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && sheet) { setSheet(null); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const list = [...(e.currentTarget.querySelectorAll<HTMLButtonElement>('.menu-buttons button:not(:disabled)'))];
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    list[(i + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length].focus();
  };

  return (
    <div className={`title-screen ${ready ? 'ready' : ''} ${settings.reducedMotion ? 'still' : ''}`} onKeyDown={onKeyDown}>
      <div ref={host} className="title-backdrop" aria-hidden />
      <div className="title-shade" aria-hidden />

      <nav className="title-column" aria-label="Main menu">
        <Logo />
        <p className="tagline">Program the robots. Grow the works.</p>
        <div className="menu-buttons">
          <MenuButton ref={firstButton} label="Play" sub={empty ? 'Start a new valley' : 'All slots in use: choose one to replace'} onClick={() => newGame(false)} />
          {latest
            ? <ContinueCard s={latest} onContinue={() => onStart({ slot: latest.id, fresh: false, tutorial: false })} onRename={() => rename(latest.id)} />
            : <MenuButton label="Continue" sub="No saved game yet" disabled onClick={() => {}} />}
          <MenuButton label="Load game" sub={`${saved.length} of ${slots.length} slots used`} disabled={!saved.length} onClick={() => setSheet('load')} active={sheet === 'load'} />
          <MenuButton label="Tutorial" sub={unfinishedTutorial ? `Resume: step ${unfinishedTutorial.tutorialSteps + 1} of ${TUTORIAL_STEPS}` : 'Learn to program your first robot'} onClick={() => setSheet('tutorial')} active={sheet === 'tutorial'} />
          <MenuButton label="Settings" onClick={() => setSheet('settings')} active={sheet === 'settings'} />
          <MenuButton label="Credits" onClick={() => setSheet('credits')} active={sheet === 'credits'} />
        </div>
        <footer className="title-foot">
          <span>Prototype · Phase 2</span>
          <span>Programs in Python · Java and TypeScript later</span>
        </footer>
      </nav>

      {sheet && (
        <section className="menu-sheet" role="dialog" aria-modal="false" aria-label={typeof sheet === 'string' ? sheet : 'Choose a slot'}>
          <button type="button" className="sheet-close" onClick={() => setSheet(null)} aria-label="Close">×</button>
          {sheet === 'load' && (
            <SheetBody title="Load game">
              <SlotList slots={slots} render={(id, s) => s
                ? <>
                    <button type="button" className="slot-plain" onClick={() => rename(id)}>Rename</button><button type="button" className="slot-main" onClick={() => onStart({ slot: id, fresh: false, tutorial: false })}>Load</button>
                    <button type="button" className="slot-danger" onClick={() => { if (window.confirm(`Delete the game in slot ${id}? This cannot be undone.`)) onDelete(id); }}>Delete</button>
                  </>
                : <button type="button" className="slot-main" onClick={() => onStart({ slot: id, fresh: true, tutorial: false })}>New game here</button>} />
            </SheetBody>
          )}
          {typeof sheet === 'object' && 'pickFor' in sheet && (
            <SheetBody title="Choose a slot to replace">
              <p className="muted">All three slots hold a game. Starting over replaces one of them.</p>
              <SlotList slots={slots} render={(id, s) => (
                <button type="button" className="slot-danger" onClick={() => setSheet({ confirm: { slot: id, fresh: true, tutorial: sheet.pickFor === 'tutorial' }, summary: s! })}>Replace</button>
              )} />
            </SheetBody>
          )}
          {typeof sheet === 'object' && 'confirm' in sheet && (
            <SheetBody title={`Replace slot ${sheet.confirm.slot}?`}>
              <p>The game in this slot ({describe(sheet.summary)}, saved {when(sheet.summary.savedAt)}) will be overwritten by a new valley. Your programs are kept.</p>
              <div className="sheet-actions">
                <button type="button" className="slot-danger" onClick={() => onStart(sheet.confirm)}>Replace and start</button>
                <button type="button" className="slot-main" onClick={() => setSheet(null)}>Keep it</button>
              </div>
            </SheetBody>
          )}
          {sheet === 'tutorial' && (
            <SheetBody title="Tutorial">
              <p>You never steer a robot by hand: you write its program. The tutorial walks you from a first <code>go_to("scrap")</code> to crafting research kits and unlocking your first firmware, one step at a time.</p>
              <div className="sheet-actions column">
                {unfinishedTutorial && <button type="button" className="slot-main" onClick={() => onStart({ slot: unfinishedTutorial.id, fresh: false, tutorial: true })}>Resume in slot {unfinishedTutorial.id} (step {unfinishedTutorial.tutorialSteps + 1} of {TUTORIAL_STEPS})</button>}
                <button type="button" className={unfinishedTutorial ? 'slot-plain' : 'slot-main'} onClick={() => newGame(true)}>Start a fresh tutorial game{empty ? ` in slot ${empty}` : ''}</button>
              </div>
            </SheetBody>
          )}
          {sheet === 'settings' && (
            <SheetBody title="Settings">
              <SettingsForm settings={settings} onSetting={onSetting} />
            </SheetBody>
          )}
          {sheet === 'credits' && (
            <SheetBody title="Credits">
              <p>ROOTWORKS is a programming-first automation game in early development.</p>
              <dl className="credits">
                <dt>Art</dt><dd>Every sprite, tile and glow is painted procedurally in code. No image files.</dd>
                <dt>Built with</dt><dd>React, PixiJS, CodeMirror, TypeScript and Vite.</dd>
                <dt>Robot language</dt><dd>A Python subset compiled to bytecode and run in a sandboxed VM, so programs can pause, save and resume.</dd>
              </dl>
            </SheetBody>
          )}
        </section>
      )}
    </div>
  );
}

const MenuButton = ({ label, sub, onClick, disabled, active, ref }: { label: string; sub?: string; onClick(): void; disabled?: boolean; active?: boolean; ref?: React.Ref<HTMLButtonElement> }) => (
  <button ref={ref} type="button" className={`menu-button ${active ? 'on' : ''}`} onClick={onClick} disabled={disabled}>
    <span className="mb-label">{label}</span>
    {sub && <span className="mb-sub">{sub}</span>}
  </button>
);

const SheetBody = ({ title, children }: { title: string; children: ReactNode }) => (
  <>
    <h2>{title}</h2>
    {children}
  </>
);

/** Continue: the valley you played last, with its latest album photo and how far it has come. */
function ContinueCard({ s, onContinue, onRename }: { s: SlotSummary; onContinue(): void; onRename(): void }) {
  const photo = readAlbum().find((p) => p.image)?.image;
  return (
    <div className="continue-card">
      <button type="button" className="continue-main" onClick={onContinue}>
        <span className="continue-photo">{photo ? <img src={photo} alt="" /> : <i />}</span>
        <span className="continue-text">
          <span className="mb-label">Continue</span>
          <b>{s.name ?? `Valley ${s.id}`}</b>
          <span className="mb-sub mb-bloom"><BloomMeter bloom={s.bloom} /> Heart Tree {s.bloom >= 5 ? 'in full bloom' : `${s.bloom}/5 in bloom`}</span>
          <span className="mb-sub">{minutes(s.playSeconds)} played · {s.robots} robot{s.robots === 1 ? '' : 's'} · {s.sparks} Sparks · saved {when(s.savedAt)}</span>
        </span>
      </button>
      <button type="button" className="continue-rename" onClick={onRename} title="Name this valley">Rename</button>
    </div>
  );
}

function SlotList({ slots, render }: { slots: Props['slots']; render(id: SlotId, s: SlotSummary | null): ReactNode }) {
  return (
    <ul className="slots">
      {slots.map(({ slot, summary }) => (
        <li key={slot.id} className={summary ? '' : 'empty'}>
          <div className="slot-info">
            <b>{summary?.name ?? `Slot ${slot.id}`}{summary?.name && <small> · slot {slot.id}</small>}</b>
            <span className="muted">{summary ? `${describe(summary)} · saved ${when(summary.savedAt)}` : 'Empty'}</span>
          </div>
          <div className="slot-actions">{render(slot.id, summary)}</div>
        </li>
      ))}
    </ul>
  );
}

/** Rendered from SETTING_DEFS, grouped: new options appear here without UI work. */
export function SettingsForm({ settings, onSetting }: { settings: Settings; onSetting: Props['onSetting'] }) {
  const groups = [...new Set(SETTING_DEFS.map((d) => d.group))];
  return (
    <div className="settings">
      {groups.map((g) => (
        <fieldset key={g}>
          <legend>{g}</legend>
          {SETTING_DEFS.filter((d) => d.group === g).map((d) => (
            <div key={d.id} className="setting">
              <div className="setting-text"><span id={`set-${d.id}`}>{d.label}</span><small>{d.help}</small></div>
              <div className="segmented" role="radiogroup" aria-labelledby={`set-${d.id}`}>
                {d.choices.map((c) => (
                  <button key={String(c.value)} type="button" role="radio" aria-checked={settings[d.id] === c.value}
                    className={settings[d.id] === c.value ? 'on' : ''} onClick={() => onSetting(d.id, c.value as never)}>{c.label}</button>
                ))}
              </div>
            </div>
          ))}
        </fieldset>
      ))}
    </div>
  );
}

/** The wordmark: a brass cog whose lower teeth become roots. Inline SVG, no image files. */
function Logo() {
  return (
    <h1 className="logo" aria-label="ROOTWORKS">
      <svg className="logo-mark" viewBox="0 0 64 64" aria-hidden>
        <g fill="none" strokeLinecap="square">
          <path d="M32 6 l5 0 1 6 5 2 5-4 4 4-4 5 2 5 6 1 0 7 -6 1 -2 5 3 4" stroke="#ffcf6e" strokeWidth="4" />
          <path d="M32 6 l-5 0 -1 6 -5 2 -5-4 -4 4 4 5 -2 5 -6 1 0 7 6 1 2 5 -3 4" stroke="#d98a4e" strokeWidth="4" />
          <circle cx="32" cy="31" r="8" stroke="#ffcf6e" strokeWidth="4" />
          <path d="M32 39 v10 l-6 6 M32 49 l7 5 2 6 M26 55 l-6 2 M39 54 l6-1" stroke="#a9cf8e" strokeWidth="3" />
        </g>
      </svg>
      <span className="logo-word" aria-hidden>ROOT<span>WORKS</span></span>
    </h1>
  );
}
