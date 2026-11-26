import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Game, type HudSnapshot } from '../game/Game.ts';
import { ProgramStore, type KeyValueStorage } from '../game/save/ProgramStore.ts';
import { SaveSlot, type SlotId } from '../game/save/GameSave.ts';
import { SettingsStore, type Settings } from '../game/save/Settings.ts';
import { Hud } from './Hud.tsx';
import { MainMenu, type StartRequest } from './menu/MainMenu.tsx';

// the editor (CodeMirror + grammars) is a separate chunk so the world can load without waiting for it
const CodePanel = lazy(() => import('./code/CodePanel.tsx').then((m) => ({ default: m.CodePanel })));

/** localStorage can be missing or throw (privacy modes, sandboxed frames); saving then just stays in memory. */
function browserStorage(): KeyValueStorage | null {
  try { return window.localStorage; } catch { return null; }
}

/** Set while switching region: the old game's unmount-save would overwrite the save that says where we went. */
let leaving = false;

const prefersReducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function App() {
  const [storage] = useState(browserStorage);
  const [store] = useState(() => new ProgramStore(storage));
  const [settingsStore] = useState(() => new SettingsStore(storage, prefersReducedMotion()));
  const [settings, setSettings] = useState<Settings>(settingsStore.value);
  const [screen, setScreen] = useState<{ kind: 'menu' } | ({ kind: 'game'; run: number } & StartRequest)>({ kind: 'menu' });
  const [slotsVersion, setSlotsVersion] = useState(0);
  const slots = SaveSlot.all(storage);
  void slotsVersion; // bumping it re-reads the slots after a delete or a save

  const setSetting = <K extends keyof Settings>(id: K, value: Settings[K]) => setSettings(settingsStore.set(id, value));
  const style = { '--ui-scale': settings.uiScale, '--code-font': `${settings.editorFont}px` } as React.CSSProperties;

  return (
    <div className={`root ${settings.reducedMotion ? 'reduced-motion' : ''}`} style={style}>
      {screen.kind === 'menu'
        ? <MainMenu slots={slots} settings={settings} onSetting={setSetting}
            onStart={(req) => setScreen({ kind: 'game', run: Date.now(), ...req })}
            onDelete={(id) => { new SaveSlot(storage, id).clear(); setSlotsVersion((v) => v + 1); }} />
        : <GameView key={screen.run} slot={new SaveSlot(storage, screen.slot)} fresh={screen.fresh} tutorial={screen.tutorial}
            store={store} settings={settings} onSetting={setSetting}
            onExit={() => { setSlotsVersion((v) => v + 1); setScreen({ kind: 'menu' }); }}
            // travelling: the slot already holds the save with the new region active; a new GameView loads it
            onTravel={() => setScreen({ ...screen, fresh: false, run: Date.now() })} />}
    </div>
  );
}

interface GameViewProps {
  slot: SaveSlot;
  fresh: boolean;
  tutorial: boolean;
  store: ProgramStore;
  settings: Settings;
  onSetting<K extends keyof Settings>(id: K, value: Settings[K]): void;
  onExit(): void;
  onTravel(): void;
}

/** One running game in one save slot. Saves on an interval, when the page closes, and on the way back to the menu. */
function GameView({ slot, fresh, tutorial, store, settings, onSetting, onExit, onTravel }: GameViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hud, setHud] = useState<HudSnapshot | null>(null);
  const [codeOpen, setCodeOpen] = useState(true);

  useEffect(() => {
    let g: Game | undefined, dead = false;
    leaving = false;
    const offs: (() => void)[] = [];
    // let the loading screen paint before the (synchronous) art and terrain generation
    const timer = setTimeout(() => {
      const time = Number(new URLSearchParams(location.search).get('time')); // ?time=0.75 starts at night (for screenshots)
      Game.create(host.current!, { dayStart: time >= 0 && time < 1 && time ? time : undefined, tutorialDone: fresh ? [] : store.tutorial, save: fresh ? null : slot.load() }).then((created) => {
        if (dead) return created.destroy();
        g = created;
        if (import.meta.env.DEV) Object.assign(window, { __ROOTWORKS__: created }); // debug access only in dev builds
        offs.push(created.events.on('hud', setHud));
        created.setReducedMotion(settings.reducedMotion);
        created.refreshHud();
        setGame(created);
        // write at once: a new game replaces the slot's old one, and after travelling the arrival region is saved too
        slot.write(created.save());
        const save = () => { if (!leaving) slot.write(created.save()); };
        window.addEventListener('beforeunload', save);
        offs.push(() => window.removeEventListener('beforeunload', save), save);
      }).catch((e) => { console.error(e); setError(String(e?.message ?? e)); });
    }, 50);
    return () => { dead = true; clearTimeout(timer); offs.forEach((f) => f()); g?.destroy(); };
  }, [slot.id, fresh]); // eslint-disable-line react-hooks/exhaustive-deps -- one game per mount

  // autosave on the interval the player chose (0: only when leaving)
  useEffect(() => {
    if (!game || !settings.autosave) return;
    const t = window.setInterval(() => { if (!leaving) slot.write(game.save()); }, settings.autosave * 1000);
    return () => window.clearInterval(t);
  }, [game, settings.autosave, slot]);
  useEffect(() => { game?.setReducedMotion(settings.reducedMotion); }, [game, settings.reducedMotion]);

  const showTutorial = tutorial || settings.showTutorial;
  return (
    <div className={`app ${codeOpen ? 'code-open' : ''}`}>
      <div ref={host} className="viewport" />
      <div className="vignette" />
      {!game && <div className="loading">{error ? `Could not start: ${error}` : <><b>ROOTWORKS</b><span>Growing the valley...</span></>}</div>}
      {game && hud && (
        <div className="ui-layer">
          <Hud hud={hud} game={game} onBuild={(id) => game.setBuildTool(id)} thumbnail={(s) => game.thumbnail(s)} onMenu={onExit}
            settings={settings} onSetting={onSetting} slot={slot.id as SlotId}
            onTravel={(id) => {
              const next = game.travel(id);
              if (typeof next === 'string') return next;
              leaving = true; // the unmount must not save this region over the travel save
              slot.write(next);
              onTravel();
              return null;
            }} />
        </div>
      )}
      {game && hud && (
        <Suspense fallback={null}>
          <CodePanel game={game} store={store} tutorial={hud.tutorial} showTutorial={showTutorial} firmware={hud.research.firmware} open={codeOpen} onToggle={() => setCodeOpen((o) => !o)} />
        </Suspense>
      )}
    </div>
  );
}
