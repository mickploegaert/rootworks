import { useCallback, useEffect, useState } from 'react';
import type { RegionId } from '../game/world/regions.ts';
import { WorldMap } from './WorldMap.tsx';
import { ItemIcon, Spark } from './ItemIcon.tsx';
import { SkillTree } from './SkillTree.tsx';
import { DevMenu } from './DevMenu.tsx';

import type { ResourceId } from '../game/resources/ResourceDefs.ts';
import type { CatalogEntry, Game, HudSnapshot, ResourceLine, SelectionInfo } from '../game/Game.ts';
import type { SlotId } from '../game/save/GameSave.ts';
import type { Settings } from '../game/save/Settings.ts';
import { SettingsForm } from './menu/MainMenu.tsx';
import type { BuildCategory } from '../game/building/BuildingDefs.ts';

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

interface Props {
  hud: HudSnapshot;
  onBuild(id: string | null): void;
  thumbnail(spriteId: string): string;
  onMenu(): void;
  game: Game;
  settings: Settings;
  onSetting<K extends keyof Settings>(id: K, value: Settings[K]): void;
  slot: SlotId;
  /** Travel to another region; returns why not, or null. */
  onTravel(id: RegionId): string | null;
}

/**
 * Presentation only: renders the game's HUD snapshot. Robots have no buttons (they are programmed);
 * the build menu is the one hands-on tool, and it only tells the game what to place.
 */
export function Hud({ hud, onBuild, thumbnail, onMenu, game, settings, onSetting, slot, onTravel }: Props) {
  const [researchOpen, setResearchOpen] = useState(false);
  const closeSkills = useCallback(() => setResearchOpen(false), []);
  const [mapOpen, setMapOpen] = useState(false);
  const [help, setHelp] = useState(false);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('input, textarea, select, [contenteditable="true"], .cm-editor')) return;
      const k = e.key.toLowerCase();
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (k === 'm') setMapOpen((o) => !o);
      if (k === 'k') setResearchOpen((o) => !o);
      if (k === 'b') document.querySelector<HTMLButtonElement>('.build-toggle')?.click();
      if (k === 'p') document.querySelector<HTMLButtonElement>('.code-tab, .code-head button.icon')?.click();
      if (e.key === '?') setHelp((o) => !o);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  const [paused, setPaused] = useState<null | 'menu' | 'settings'>(null);
  const rv = hud.research, buyable = rv.nodes.filter((n) => n.state === 'available').length;
  return (
    <>
      <header className="plate">
        <h1>ROOTWORKS</h1>
        <span>{hud.region.name} · {hud.timeOfDay}</span>
        <button type="button" className={`research-toggle ${mapOpen ? 'on' : ''}`} onClick={() => setMapOpen(true)} title="World map (M)">
          Map <small>{hud.region.name}</small>
        </button>
        <button type="button" className={`research-toggle ${researchOpen ? 'on' : ''}`} onClick={() => setResearchOpen(!researchOpen)} aria-expanded={researchOpen}>
          Skills <small className="sparks" title="Sparks: earned from lessons, commissions and the Lab. Spend them on skills."><Spark />{rv.sparks}{buyable ? ` · ${buyable} to learn` : ''}</small>
        </button>
        <button type="button" className="icon new-game" onClick={() => setPaused('menu')} title="Settings, save and quit">Menu</button>
      </header>
      {paused && (
        <div className="pause-veil" onKeyDown={(e) => e.key === 'Escape' && setPaused(null)}>
          <section className="panel pause" role="dialog" aria-label="Game menu">
            {paused === 'menu' ? (
              <>
                <h2>Game menu</h2>
                <p className="muted">Slot {slot} · the game saves automatically. Robots keep working while this is open.</p>
                <div className="pause-buttons">
                  <button type="button" autoFocus onClick={() => setPaused(null)}>Back to the valley</button>
                  <button type="button" onClick={() => setPaused('settings')}>Settings</button>
                  <button type="button" onClick={onMenu}>Save and quit to title</button>
                </div>
              </>
            ) : (
              <>
                <div className="row"><h2>Settings</h2><button type="button" className="icon" onClick={() => setPaused('menu')}>back</button></div>
                <SettingsForm settings={settings} onSetting={onSetting} />
              </>
            )}
          </section>
        </div>
      )}
      <StorageBar lines={hud.storage} />
      <Commissions list={hud.commissions} daily={hud.daily} challenges={hud.challenges} />
      {mapOpen && <WorldMap regions={hud.regions} onTravel={onTravel} onClose={() => setMapOpen(false)} />}
      {researchOpen && <SkillTree rv={rv} onBuy={(id) => game.buySkill(id)} onClose={closeSkills} />}
      {hud.selection && <Inspector sel={hud.selection} game={game} />}
      <DevMenu game={game} regions={hud.regions} onTravel={onTravel} />
      {help && (
        <section className="panel hotkeys" aria-label="Keyboard shortcuts" onClick={() => setHelp(false)}>
          <h2>Shortcuts</h2>
          <dl>
            {[['B', 'Build menu'], ['K', 'Skill tree'], ['P', 'Program editor'], ['M', 'World map'], ['Ctrl+Enter', 'Run the program'], ['R', 'Rotate while building'],
              ['Esc', 'Close / clear selection'], ['WASD', 'Scroll the map'], ['Wheel', 'Zoom'], ['?', 'This list']].map(([k, d]) => <div key={k}><dt><kbd>{k}</kbd></dt><dd>{d}</dd></div>)}
          </dl>
        </section>
      )}
      <RobotPanel robot={hud.robot} log={hud.log} />
      <BuildMenu catalog={hud.catalog} build={hud.build} onBuild={onBuild} thumbnail={thumbnail} />
      <aside className="hint">
        <b>Click</b> inspect · <b>Drag</b> pan · <b>B</b> build · <b>K</b> skills · <b>P</b> program · <b>?</b> all keys
      </aside>
    </>
  );
}


function StorageBar({ lines }: { lines: ResourceLine[] }) {
  return (
    <section className="panel storage" aria-label="Stored resources">
      <span className="label">Storage</span>
      {lines.map((l) => (
        <span key={l.id} className={`res ${l.amount ? '' : 'empty'}`}>
          <ItemIcon id={l.id} explain /><span className="res-name">{l.name}</span><b>{l.amount}</b>
        </span>
      ))}
    </section>
  );
}

function RobotPanel({ robot, log }: { robot: HudSnapshot['robot']; log: HudSnapshot['log'] }) {
  const pct = (robot.used / robot.capacity) * 100;
  return (
    <section className="panel robot" aria-label="Robot status">
      <div className="row"><h2>{robot.name}</h2><span className={`state s-${robot.state}`}>{robot.state}</span></div>
      <p className="muted">Tile {robot.x}, {robot.y}{robot.queue.length > 1 ? ` · ${robot.queue.length - 1} queued` : ''}</p>
      {robot.progress > 0 && <div className="bar progress"><div style={{ width: `${robot.progress * 100}%` }} /></div>}
      <div className="row cargo-head"><span className="label">Cargo</span><span>{robot.used} / {robot.capacity}</span></div>
      <div className="bar"><div style={{ width: `${pct}%` }} className={pct >= 100 ? 'full' : ''} /></div>
      <div className="cargo">
        {robot.cargo.length ? robot.cargo.map((l) => <span key={l.id} className="res"><ItemIcon id={l.id} explain />{l.name}<b>{l.amount}</b></span>)
          : <span className="muted">empty</span>}
      </div>
      {log.length > 0 && (
        <ul className="log">
          {log.map((m) => <li key={m.id} className={m.ok ? 'ok' : 'err'}>{m.text}</li>)}
        </ul>
      )}
    </section>
  );
}

const CATEGORIES: { id: BuildCategory | 'all'; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'garden', label: 'Garden' }, { id: 'decor', label: 'Yard' },
  { id: 'production', label: 'Production' }, { id: 'science', label: 'Science' }, { id: 'energy', label: 'Energy' },
];

function BuildMenu({ catalog, build, onBuild, thumbnail }: { catalog: CatalogEntry[]; build: HudSnapshot['build']; onBuild(id: string | null): void; thumbnail(s: string): string }) {
  const [open, setOpen] = useState(false);
  const [cat, setCat] = useState<BuildCategory | 'all'>('all');
  const shown = catalog.filter((c) => cat === 'all' || c.category === cat);
  return (
    <div className="build-dock">
      {build && (
        <div className={`panel build-banner ${build.problem ? 'bad' : ''}`} role="status">
          <b>{build.name}</b>
          <span>{build.problem ?? (build.overMap ? 'Click to place' : 'Point at a spot on the island')}</span>
          <span className="keys"><kbd>R</kbd> rotate · <kbd>Esc</kbd> done</span>
        </div>
      )}
      {open && (
        <section className="panel build-menu" aria-label="Build menu">
          <nav className="tabs" role="tablist">
            {CATEGORIES.map((c) => (
              <button key={c.id} type="button" role="tab" aria-selected={cat === c.id} className={cat === c.id ? 'on' : ''} onClick={() => setCat(c.id)}>{c.label}</button>
            ))}
          </nav>
          <div className="cards">
            {shown.map((c) => {
              const afford = c.cost.every((x) => x.have >= x.amount);
              return (
                <button key={c.id} type="button" className={`card ${build?.id === c.id ? 'on' : ''} ${c.locked ? 'locked' : ''}`}
                  disabled={!!c.locked} title={c.locked ? `${c.description} Needs the ${c.locked} skill.` : c.description}
                  onClick={() => onBuild(build?.id === c.id ? null : c.id)}>
                  <img src={thumbnail(c.sprite)} alt="" />
                  <span className="name">{c.name}</span>
                  {c.locked
                    ? <span className="lock">Skill: {c.locked}</span>
                    : <span className={`cost ${afford ? '' : 'short'}`}>
                        {c.cost.map((x) => <span key={x.id} className={x.have >= x.amount ? '' : 'miss'}><ItemIcon id={x.id} />{x.amount}</span>)}
                      </span>}
                </button>
              );
            })}
          </div>
        </section>
      )}
      <button type="button" className={`build-toggle ${open ? 'on' : ''}`} onClick={() => { setOpen(!open); if (open) onBuild(null); }} aria-expanded={open}>
        {open ? 'Close' : 'Build'}
      </button>
    </div>
  );
}

function Cost({ lines }: { lines: ResourceLine[] }) {
  return <span className="costs">{lines.map((l) => <span key={l.id} className="res"><ItemIcon id={l.id} explain />{l.amount} {l.name}</span>)}</span>;
}

/** The board on the left: today's order, the villagers' commissions, and the optional challenges with stars. */
function Commissions({ list, daily, challenges }: { list: HudSnapshot['commissions']; daily: HudSnapshot['daily']; challenges: HudSnapshot['challenges'] }) {
  const [tab, setTab] = useState<'orders' | 'challenges'>('orders');
  const stars = challenges.reduce((s, c) => s + c.stars, 0);
  return (
    <section className="panel commissions" aria-label="Commission board">
      <nav className="tabs board-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'orders'} className={tab === 'orders' ? 'on' : ''} onClick={() => setTab('orders')}>Orders</button>
        <button type="button" role="tab" aria-selected={tab === 'challenges'} className={tab === 'challenges' ? 'on' : ''} onClick={() => setTab('challenges')}>Challenges <small>{stars}/{challenges.length * 3}</small></button>
      </nav>
      {tab === 'orders' ? (
        <>
          <div className={`commission daily ${daily.done ? 'done' : ''}`}>
            <span className="label">Today's order · {daily.from}</span>
            <div className="row"><span className="res"><ItemIcon id={daily.item.id} explain />{daily.item.amount} {daily.item.name}</span><b>{daily.done ? 'Done' : `${daily.got}/${daily.item.amount}`}</b></div>
            <div className="bar"><div style={{ width: `${(daily.got / daily.item.amount) * 100}%` }} /></div>
            <span className="muted">Deliver it to storage today · reward <b className="sparks"><Spark />{daily.sparks}</b></span>
          </div>
          {list.map((c) => (
            <div key={c.id} className="commission">
              <div className="row"><span>{c.title}</span><b>{c.progress}/{c.target}</b></div>
              <div className="bar"><div style={{ width: `${(c.progress / c.target) * 100}%` }} /></div>
              <span className="muted">{c.from} · <b className="sparks"><Spark />{c.sparks}</b> <Cost lines={c.reward} /></span>
            </div>
          ))}
        </>
      ) : (
        <>
          <p className="muted challenge-intro">Optional goals for your programs. Every new star pays 2 Sparks.</p>
          {challenges.map((c) => (
            <div key={c.id} className="commission challenge" title={c.description}>
              <div className="row"><span>{c.title}</span><span className="stars" aria-label={`${c.stars} of 3 stars`}>{[0, 1, 2].map((k) => <i key={k} className={k < c.stars ? 'on' : ''} />)}</span></div>
              <span className="muted">{c.description}</span>
              <span className="muted tiers">{c.tiers.map((t, k) => <span key={k} className={k < c.stars ? 'got' : ''}>{c.better === 'lower' ? '≤' : '≥'}{t}{c.unit}</span>)}
                {c.best !== null && <span className="best">best {c.best}{c.unit}</span>}</span>
            </div>
          ))}
        </>
      )}
    </section>
  );
}

function Inspector({ sel, game }: { sel: SelectionInfo; game: Game }) {
  const r = sel.entity?.resource, m = sel.entity?.machine, w = sel.entity?.workshop, p = sel.parcel;
  return (
    <aside className="panel inspector">
      {sel.entity?.sprite && <img className="inspector-preview" src={game.thumbnail(sel.entity.sprite)} alt="" />}
      <h2>{sel.entity ? sel.entity.name : sel.tileName}</h2>
      <p className="muted">{sel.biome} · {sel.tileName} · tile {sel.tileX}, {sel.tileY}{sel.elevation > 1 ? ` · elevation ${sel.elevation}` : ''}</p>
      {sel.entity && <p>{sel.entity.description}</p>}
      {r && (
        <>
          <div className="row"><span className="res"><ItemIcon id={r.id as ResourceId} explain />{r.name}</span><b>{r.amount} / {r.max}</b></div>
          <div className="bar"><div style={{ width: `${(r.amount / r.max) * 100}%`, background: hex(r.color) }} /></div>
          <p className="muted">{r.depleted ? 'Depleted.' : `${r.yieldPerAction} per harvest · ${r.harvestTime.toFixed(1)} s`}</p>
          <p className="use"><b>What it's for:</b> {r.use}</p>
        </>
      )}
      {sel.entity?.research && <p className="use">{sel.entity.research}</p>}
      {sel.entity?.program && (
        <div className="program-this">
          <span className="label">Program this</span>
          <div className="snippet">
            <pre>{sel.entity.program.code}</pre>
            <button type="button" onClick={() => game.insertCode(sel.entity!.program!.code)} title="Add this code to your program">Insert</button>
          </div>
          <p className="muted">{sel.entity.program.note}</p>
        </div>
      )}
      {sel.entity?.construction !== undefined && (
        <>
          <div className="row"><span className="label">Under construction</span><b>{Math.round(sel.entity.construction * 100)}%</b></div>
          <div className="bar progress"><div style={{ width: `${sel.entity.construction * 100}%` }} /></div>
        </>
      )}
      {m && m.recipes.length > 0 && (
        <>
          <div className="recipes">
            {m.recipes.map((rc, i) => (
              <button key={i} type="button" className={i === m.recipe ? 'on' : ''} onClick={() => game.setRecipe(i)} aria-pressed={i === m.recipe}>
                <Cost lines={rc.inputs} /> → <Cost lines={rc.outputs} /> <span className="muted">{rc.time}s</span>
              </button>
            ))}
          </div>
          <div className="bar progress"><div style={{ width: `${m.progress * 100}%` }} /></div>
          <p className="muted">{m.working ? 'Working' : 'Idle: robots put() the inputs in'}</p>
        </>
      )}
      {m && (
        <div className="buffers">
          <span className="label">In</span><span>{m.input.length ? <Cost lines={m.input} /> : <span className="muted">empty</span>}</span>
          {m.recipes.length > 0 && <><span className="label">Out</span><span>{m.output.length ? <Cost lines={m.output} /> : <span className="muted">empty</span>}</span></>}
        </div>
      )}
      {w && (
        <div className="action-box">
          <span className="label">Robot assembly · {w.robots} robot{w.robots === 1 ? '' : 's'}</span>
          <button type="button" onClick={() => game.assembleRobot()} disabled={!!w.problem}>Assemble a robot</button>
          <span className={w.problem ? 'muted' : ''}>{w.problem ?? <>Costs <Cost lines={w.cost} /></>}</span>
        </div>
      )}
      {p.locked && (
        <div className="action-box">
          <span className="label">Unclaimed land</span>
          <button type="button" onClick={() => game.reclaimSelected()} disabled={!!p.problem}>Reclaim this parcel</button>
          <span className={p.problem ? 'muted' : ''}>{p.problem ?? <>Costs <Cost lines={p.cost} /></>}</span>
        </div>
      )}
    </aside>
  );
}
