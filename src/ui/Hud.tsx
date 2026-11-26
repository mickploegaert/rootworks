import { useEffect, useState } from 'react';
import type { RegionId } from '../game/world/regions.ts';
import { WorldMap } from './WorldMap.tsx';
import type { CatalogEntry, Game, HudSnapshot, ResearchView, ResourceLine, SelectionInfo } from '../game/Game.ts';
import { FIRMWARE_NAMES } from '../game/scripting/hostApi.ts';
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
  const [mapOpen, setMapOpen] = useState(false);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, select, [contenteditable="true"], .cm-editor')) return;
      if (e.key === 'm' || e.key === 'M') setMapOpen((o) => !o);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  const [paused, setPaused] = useState<null | 'menu' | 'settings'>(null);
  const rv = hud.research, current = rv.nodes.find((n) => n.id === rv.current);
  return (
    <>
      <header className="plate">
        <h1>ROOTWORKS</h1>
        <span>{hud.region.name} · {hud.timeOfDay}</span>
        <button type="button" className={`research-toggle ${mapOpen ? 'on' : ''}`} onClick={() => setMapOpen(true)} title="World map (M)">
          Map <small>{hud.region.name}</small>
        </button>
        <button type="button" className={`research-toggle ${researchOpen ? 'on' : ''}`} onClick={() => setResearchOpen(!researchOpen)} aria-expanded={researchOpen}>
          Research <small>T{rv.firmware} {FIRMWARE_NAMES[rv.firmware] ?? ''}{current ? ` · ${current.name} ${Math.round(rv.progress * 100)}%` : ''}</small>
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
      <Commissions list={hud.commissions} />
      {mapOpen && <WorldMap regions={hud.regions} onTravel={onTravel} onClose={() => setMapOpen(false)} />}
      {researchOpen && <ResearchPanel rv={rv} onSelect={(id) => game.selectResearch(id)} onClose={() => setResearchOpen(false)} />}
      {hud.selection && <Inspector sel={hud.selection} game={game} />}
      <RobotPanel robot={hud.robot} log={hud.log} />
      <BuildMenu catalog={hud.catalog} build={hud.build} onBuild={onBuild} thumbnail={thumbnail} />
      <aside className="hint">
        <b>Click</b> inspect · <b>Drag</b> pan · <b>Wheel</b> zoom · <b>WASD</b> scroll · <b>Esc</b> clear
      </aside>
    </>
  );
}

function Swatch({ color }: { color: number }) {
  return <i className="swatch" style={{ background: hex(color) }} />;
}

function StorageBar({ lines }: { lines: ResourceLine[] }) {
  return (
    <section className="panel storage" aria-label="Stored resources">
      <span className="label">Storage</span>
      {lines.map((l) => (
        <span key={l.id} className={`res ${l.amount ? '' : 'empty'}`} title={l.name}>
          <Swatch color={l.color} />{l.name}<b>{l.amount}</b>
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
        {robot.cargo.length ? robot.cargo.map((l) => <span key={l.id} className="res"><Swatch color={l.color} />{l.name}<b>{l.amount}</b></span>)
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
                  disabled={!!c.locked} title={c.locked ? `${c.description} Requires research: ${c.locked}.` : c.description}
                  onClick={() => onBuild(build?.id === c.id ? null : c.id)}>
                  <img src={thumbnail(c.sprite)} alt="" />
                  <span className="name">{c.name}</span>
                  {c.locked
                    ? <span className="lock">Research: {c.locked}</span>
                    : <span className={`cost ${afford ? '' : 'short'}`}>
                        {c.cost.map((x) => <span key={x.id} className={x.have >= x.amount ? '' : 'miss'}><Swatch color={x.color} />{x.amount}</span>)}
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
  return <span className="costs">{lines.map((l) => <span key={l.id} className="res"><Swatch color={l.color} />{l.amount} {l.name}</span>)}</span>;
}

function Commissions({ list }: { list: HudSnapshot['commissions'] }) {
  if (!list.length) return null;
  return (
    <section className="panel commissions" aria-label="Commissions">
      <span className="label">Commission board</span>
      {list.map((c) => (
        <div key={c.id} className="commission">
          <div className="row"><span>{c.title}</span><b>{c.progress}/{c.target}</b></div>
          <div className="bar"><div style={{ width: `${(c.progress / c.target) * 100}%` }} /></div>
          <span className="muted">Reward: <Cost lines={c.reward} /></span>
        </div>
      ))}
    </section>
  );
}

function ResearchPanel({ rv, onSelect, onClose }: { rv: ResearchView; onSelect(id: string | null): void; onClose(): void }) {
  return (
    <section className="panel research" aria-label="Research">
      <div className="row">
        <h2>Research</h2>
        <span className="muted">Robots put research kits into a Lab; each kit is a step of progress.</span>
        <button type="button" className="icon" onClick={onClose} aria-label="Close research">close</button>
      </div>
      <div className="nodes">
        {rv.nodes.map((n) => (
          <button key={n.id} type="button" className={`node n-${n.state}`} disabled={n.state === 'done' || n.state === 'locked'}
            onClick={() => onSelect(n.state === 'current' ? null : n.id)} aria-pressed={n.state === 'current'}>
            <span className="row"><b>{n.name}</b><span className="kits">{n.kits} kits</span></span>
            <span className="desc">{n.description}</span>
            {n.state === 'current' && <span className="bar progress"><span style={{ width: `${rv.progress * 100}%` }} /></span>}
            <span className="status">{n.state === 'done' ? 'Done' : n.state === 'current' ? 'Researching: click to pause' : n.state === 'locked' ? `Needs ${n.needs.join(', ')}` : 'Click to research'}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function Inspector({ sel, game }: { sel: SelectionInfo; game: Game }) {
  const r = sel.entity?.resource, m = sel.entity?.machine, w = sel.entity?.workshop, p = sel.parcel;
  return (
    <aside className="panel inspector">
      <h2>{sel.entity ? sel.entity.name : sel.tileName}</h2>
      <p className="muted">{sel.biome} · {sel.tileName} · tile {sel.tileX}, {sel.tileY}{sel.elevation > 1 ? ` · elevation ${sel.elevation}` : ''}</p>
      {sel.entity && <p>{sel.entity.description}</p>}
      {r && (
        <>
          <div className="row"><span><Swatch color={r.color} />{r.name}</span><b>{r.amount} / {r.max}</b></div>
          <div className="bar"><div style={{ width: `${(r.amount / r.max) * 100}%`, background: hex(r.color) }} /></div>
          <p className="muted">{r.depleted ? 'Depleted.' : `${r.yieldPerAction} per harvest · ${r.harvestTime.toFixed(1)} s`}</p>
        </>
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
