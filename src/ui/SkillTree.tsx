import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import type { ResearchView } from '../game/Game.ts';
import { researchById } from '../game/research/ResearchDefs.ts';
import { buildingById } from '../game/building/BuildingDefs.ts';
import { Spark } from './ItemIcon.tsx';
import { SkillIcon } from './SkillIcons.tsx';

type Node = ResearchView['nodes'][number];
type Pt = { x: number; y: number };

/**
 * The workshop's research board. Skills are laid out left to right by how deep they sit in the tree, in lanes that
 * group them by what they teach. Copper traces run only through the gutters between columns and rows, so they never
 * cross a card. Presentation only: what a skill needs and costs comes from ResearchDefs.
 */
const LANES: { id: string; label: string; hint: string; color: string; ids: string[] }[] = [
  { id: 'logic', label: 'Memory & logic', hint: 'Store values, calculate, decide', color: '#8fd0c0', ids: ['counter', 'operators', 'sense', 'lists'] },
  { id: 'flow', label: 'Control flow', hint: 'Repeat and reuse code', color: '#86c3e6', ids: ['loop', 'functions'] },
  { id: 'machines', label: 'Machines', hint: 'Buildings that make things', color: '#f0a060', ids: ['sawmill', 'kiln', 'windpower', 'gardening', 'feeder'] },
  { id: 'robots', label: 'Robot upgrades', hint: 'Faster and stronger robots', color: '#e8c56a', ids: ['speed1', 'speed2', 'speed3', 'yield1'] },
  { id: 'land', label: 'Land & logistics', hint: 'More land, cargo and robots', color: '#b5dc8e', ids: ['surveying', 'surveying2', 'cargo', 'cargo2', 'logistics', 'assembly'] },
];
const laneOf = (n: { id: string; branch: string }) =>
  LANES.find((l) => l.ids.includes(n.id)) ?? LANES[n.branch === 'code' ? 0 : n.branch === 'machines' ? 2 : 4];

/** What a skill teaches, shown in the detail panel: a short example and what it opens up. */
const LEARN: Record<string, { example?: string; unlocks: string }> = {
  loop: { example: 'while True:\n    go_to("scrap")\n    harvest()\n    deposit()', unlocks: 'while and for loops, break and continue' },
  counter: { example: 'trips = 0\ncargo = get_inventory()', unlocks: 'Variables, get_inventory(), get_position(), get_inventory_count()' },
  operators: { example: 'trips = trips + 1\nfull = trips >= 10', unlocks: 'Arithmetic + - * / and comparisons < > == !=' },
  sense: { example: 'if is_inventory_full():\n    deposit()\nelse:\n    harvest()', unlocks: 'if / else, and / or / not, can_harvest(), is_inventory_full(), get_nearby()' },
  lists: { example: 'for place in ["tree", "scrap"]:\n    go_to(place)\n    harvest()', unlocks: 'Lists [ ... ] and indexing like places[0]' },
  functions: { example: 'def gather(place):\n    go_to(place)\n    harvest()\n\ngather("tree")', unlocks: 'def, parameters and return values' },
  sawmill: { example: 'go_to("sawmill")\nput("wood")\ntake("planks")', unlocks: 'The Sawmill: 2 Timber become 3 Planks' },
  kiln: { example: 'go_to("kiln")\nput("stone")\ntake("bricks")', unlocks: 'The Kiln: Fieldstone becomes Bricks' },
  logistics: { example: 'deliver("wood", "workbench")', unlocks: 'deliver(item, place): storage to machine in one command' },
};

const NODE_W = 214, NODE_H = 62, COL = 292, ROW = 90, LEFT = 210, LANE_PAD = 30, LANE_GAP = 16, TOP = 20;

function layout(nodes: Node[]) {
  const req = (id: string) => researchById(id)?.requires ?? [];
  const depth = new Map<string, number>();
  const d = (id: string): number => {
    if (!depth.has(id)) depth.set(id, 1 + Math.max(0, ...req(id).map(d)));
    return depth.get(id)!;
  };
  const pos = new Map<string, Pt>();
  const lanes: { lane: (typeof LANES)[number]; y: number; h: number }[] = [];
  let y = TOP;
  for (const lane of LANES) {
    const mine = nodes.filter((n) => laneOf(n) === lane);
    if (!mine.length) continue;
    const row = new Map<string, number>();
    let rows = 1;
    for (let col = 1; col <= Math.max(...mine.map((n) => d(n.id))); col++) {
      // children follow their parents' rows, so traces stay short and do not cross
      const here = mine.filter((n) => d(n.id) === col)
        .map((n) => { const ps = req(n.id).filter((r) => row.has(r)); return { n, key: ps.length ? ps.reduce((s, r) => s + row.get(r)!, 0) / ps.length : 0 }; })
        .sort((a, b) => a.key - b.key);
      const used = new Set<number>();
      for (const { n, key } of here) {
        let r = Math.round(key);
        while (used.has(r)) r++;
        used.add(r); row.set(n.id, r); rows = Math.max(rows, r + 1);
      }
    }
    for (const n of mine) pos.set(n.id, { x: LEFT + (d(n.id) - 1) * COL, y: y + LANE_PAD + row.get(n.id)! * ROW });
    const h = LANE_PAD * 2 + rows * ROW - (ROW - NODE_H);
    lanes.push({ lane, y, h });
    y += h + LANE_GAP;
  }
  const cols = Math.max(...nodes.map((n) => d(n.id)));
  return { pos, lanes, width: LEFT + cols * COL - (COL - NODE_W) + 60, height: y };
}

/** An orthogonal path through the given corners, with small rounded bends like bent copper. */
function trace(pts: Pt[], r = 8): string {
  let s = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const k1 = Math.min(r, Math.hypot(b.x - a.x, b.y - a.y) / 2), k2 = Math.min(r, Math.hypot(c.x - b.x, c.y - b.y) / 2);
    const ux = Math.sign(b.x - a.x), uy = Math.sign(b.y - a.y), vx = Math.sign(c.x - b.x), vy = Math.sign(c.y - b.y);
    s += ` L${b.x - ux * k1},${b.y - uy * k1} Q${b.x},${b.y} ${b.x + vx * k2},${b.y + vy * k2}`;
  }
  const z = pts[pts.length - 1];
  return `${s} L${z.x},${z.y}`;
}

const STATUS: Record<Node['state'], string> = { done: 'Learned', available: 'Ready to learn', expensive: 'Need more Sparks', locked: 'Locked' };

/** Full-screen research board: lanes of skills, copper traces, a detail panel, zoom and pan. */
export function SkillTree({ rv, onBuy, onClose }: { rv: ResearchView; onBuy(id: string): void; onClose(): void }) {
  const { pos, lanes, width, height } = useMemo(() => layout(rv.nodes), [rv.nodes]);
  const byId = useMemo(() => new Map(rv.nodes.map((n) => [n.id, n])), [rv.nodes]);
  const recommended = rv.nodes.filter((n) => n.state === 'available').sort((a, b) => a.cost - b.cost)[0]
    ?? rv.nodes.filter((n) => n.state === 'expensive').sort((a, b) => a.cost - b.cost)[0];
  const [picked, setPicked] = useState<string | null>(null);
  const sel = byId.get(picked ?? '') ?? recommended ?? rv.nodes[0];

  // a skill that was just learned plays its unlock animation once
  const prev = useRef(new Map(rv.nodes.map((n) => [n.id, n.state])));
  const [fresh, setFresh] = useState<string | null>(null);
  useEffect(() => {
    const now = rv.nodes.find((n) => n.state === 'done' && prev.current.get(n.id) !== 'done');
    prev.current = new Map(rv.nodes.map((n) => [n.id, n.state]));
    if (!now) return;
    setFresh(now.id);
    const t = window.setTimeout(() => setFresh(null), 1600);
    return () => window.clearTimeout(t);
  }, [rv.nodes]);

  // view: zoom and pan the board inside the stage
  const stage = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const fit = useCallback(() => {
    const el = stage.current;
    if (!el) return;
    const k = Math.min(el.clientWidth / width, el.clientHeight / height, 1.15);
    setView({ k, x: (el.clientWidth - width * k) / 2, y: Math.max(0, (el.clientHeight - height * k) / 2) });
  }, [width, height]);
  useEffect(() => { fit(); window.addEventListener('resize', fit); return () => window.removeEventListener('resize', fit); }, [fit]);
  const focus = (id: string) => {
    const el = stage.current, p = pos.get(id);
    if (!el || !p) return;
    const k = Math.max(view.k, 0.9);
    setView({ k, x: el.clientWidth / 2 - (p.x + NODE_W / 2) * k, y: el.clientHeight / 2 - (p.y + NODE_H / 2) * k });
    setPicked(id);
  };
  const zoom = (factor: number, cx?: number, cy?: number) => setView((v) => {
    const el = stage.current!, k = Math.min(1.8, Math.max(0.4, v.k * factor));
    const px = cx ?? el.clientWidth / 2, py = cy ?? el.clientHeight / 2;
    return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
  });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const onDown = (e: RPointerEvent) => {
    if ((e.target as HTMLElement).closest('.tech')) return;
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: RPointerEvent) => {
    const d = drag.current;
    if (d) setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
  };
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => { e.preventDefault(); const r = el.getBoundingClientRect(); zoom(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - r.left, e.clientY - r.top); };
    el.addEventListener('wheel', wheel, { passive: false });
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => { el.removeEventListener('wheel', wheel); window.removeEventListener('keydown', key); };
  }, [onClose]); // eslint-disable-line react-hooks/exhaustive-deps -- zoom only reads the stage

  // traces: out of the parent's right edge, through the gutters, into the child's left edge
  const traces = rv.nodes.flatMap((n) => {
    const reqs = researchById(n.id)?.requires ?? [];
    return reqs.filter((r) => pos.has(r)).map((r, i) => {
      const a = pos.get(r)!, b = pos.get(n.id)!;
      const sy = a.y + NODE_H / 2, ey = b.y + NODE_H / 2 + (reqs.length > 1 ? (i - (reqs.length - 1) / 2) * 12 : 0);
      const gx1 = a.x + NODE_W + (COL - NODE_W) / 2, gx2 = b.x - (COL - NODE_W) / 2;
      const ch = b.y - (ROW - NODE_H) / 2; // the free channel just above the child's row
      const pts: Pt[] = gx1 === gx2
        ? [{ x: a.x + NODE_W, y: sy }, { x: gx1, y: sy }, { x: gx1, y: ey }, { x: b.x, y: ey }]
        : [{ x: a.x + NODE_W, y: sy }, { x: gx1, y: sy }, { x: gx1, y: ch }, { x: gx2, y: ch }, { x: gx2, y: ey }, { x: b.x, y: ey }];
      const from = byId.get(r)!;
      const cls = from.state !== 'done' ? 'off' : n.state === 'done' ? 'done' : 'flow';
      return { key: `${r}>${n.id}`, d: trace(pts), cls, color: laneOf(n).color, surge: fresh === r };
    });
  });

  const lane = sel ? laneOf(sel) : LANES[0];
  const learn = sel ? LEARN[sel.id] : undefined;
  const builds = sel ? (researchById(sel.id)?.unlocksBuildings ?? []).map((b) => buildingById(b)?.name ?? b) : [];
  const reqs = sel ? researchById(sel.id)?.requires ?? [] : [];
  const learned = rv.nodes.filter((n) => n.state === 'done').length;

  return (
    <div className="skilltree" role="dialog" aria-label="Skill tree">
      <header className="skilltree-head">
        <h2>Research board</h2>
        <span className="tech-progress"><b>{learned}</b> / {rv.nodes.length} skills</span>
        <span className="sparks-big"><Spark />{rv.sparks}</span>
        <nav className="lane-chips" aria-label="Jump to a category">
          {lanes.map(({ lane: l }) => (
            <button key={l.id} type="button" style={{ ['--lane' as string]: l.color }}
              onClick={() => { const first = rv.nodes.find((n) => laneOf(n) === l && n.state !== 'done') ?? rv.nodes.find((n) => laneOf(n) === l); if (first) focus(first.id); }}>
              <i />{l.label}
            </button>
          ))}
        </nav>
        <span className="tech-zoom">
          <button type="button" onClick={() => zoom(1 / 1.2)} aria-label="Zoom out">−</button>
          <button type="button" onClick={fit}>Fit</button>
          <button type="button" onClick={() => zoom(1.2)} aria-label="Zoom in">+</button>
        </span>
        {recommended && <button type="button" className="btn-primary" onClick={() => focus(recommended.id)}>Next skill</button>}
        <button type="button" className="skilltree-close" onClick={onClose}>Back <kbd>Esc</kbd></button>
      </header>
      <div className="skilltree-body">
        <div className="tech-stage" ref={stage} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => { drag.current = null; }}>
          <div className="tech-board" style={{ width, height, transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
            {lanes.map(({ lane: l, y, h }) => (
              <div key={l.id} className="tech-lane" style={{ top: y, height: h, ['--lane' as string]: l.color }}>
                <div className="tech-lane-label"><b>{l.label}</b><span>{l.hint}</span></div>
              </div>
            ))}
            <svg className="tech-traces" width={width} height={height} aria-hidden>
              {traces.map((t) => <path key={`b${t.key}`} d={t.d} className="trace-bed" />)}
              {traces.map((t) => <path key={t.key} d={t.d} className={`trace ${t.cls} ${t.surge ? 'surge' : ''}`} style={{ stroke: t.color }} />)}
            </svg>
            {rv.nodes.map((n) => {
              const p = pos.get(n.id)!, l = laneOf(n);
              return (
                <button key={n.id} type="button" className={`tech t-${n.state} ${sel?.id === n.id ? 'picked' : ''} ${fresh === n.id ? 'fresh' : ''}`}
                  style={{ left: p.x, top: p.y, width: NODE_W, height: NODE_H, ['--lane' as string]: l.color }}
                  onClick={() => setPicked(n.id)} onDoubleClick={() => n.state === 'available' && onBuy(n.id)} aria-pressed={sel?.id === n.id}>
                  <span className="tech-icon"><SkillIcon id={n.id} /></span>
                  <span className="tech-text">
                    <b>{n.name}</b>
                    <small>{n.state === 'done' ? 'Learned' : n.state === 'locked' ? `Needs ${n.needs.join(', ')}` : <><Spark />{n.cost}</>}</small>
                  </span>
                  {n.state === 'done' && <span className="tech-check" aria-hidden />}
                  {n.state === 'locked' && <span className="tech-lock" aria-hidden />}
                </button>
              );
            })}
          </div>
        </div>
        {sel && (
          <aside className="tech-detail" style={{ ['--lane' as string]: lane.color }}>
            <div className="tech-detail-head">
              <span className={`tech-icon big t-${sel.state}`}><SkillIcon id={sel.id} size={32} /></span>
              <div>
                <span className="label">{lane.label}</span>
                <h3>{sel.name}</h3>
                <span className={`tech-status s-${sel.state}`}>{STATUS[sel.state]}</span>
              </div>
            </div>
            <p className="tech-desc">{sel.description}</p>
            <section>
              <span className="label">You will be able to use</span>
              <p>{learn?.unlocks ?? sel.description}</p>
              {builds.length > 0 && <p className="tech-builds">Builds: {builds.join(', ')}</p>}
            </section>
            {learn?.example && (
              <section>
                <span className="label">Try it</span>
                <pre className="tech-example">{learn.example}</pre>
              </section>
            )}
            <section>
              <span className="label">Requires</span>
              {reqs.length === 0
                ? <p className="muted">Nothing: available from the start.</p>
                : <ul className="tech-reqs">{reqs.map((r) => {
                    const ok = byId.get(r)?.state === 'done';
                    return <li key={r} className={ok ? 'ok' : ''}><button type="button" className="icon" onClick={() => focus(r)}><i aria-hidden />{researchById(r)?.name ?? r}</button></li>;
                  })}</ul>}
            </section>
            <div className="tech-buy">
              <div className="tech-cost"><span>Cost</span><b><Spark />{sel.cost}</b><span className="muted">You have {rv.sparks}</span></div>
              <button type="button" className="skill-learn" disabled={sel.state !== 'available'} onClick={() => onBuy(sel.id)}>
                {sel.state === 'done' ? 'Learned' : sel.state === 'available' ? 'Learn skill' : sel.state === 'expensive' ? `${sel.cost - rv.sparks} more Sparks needed` : 'Learn the skills it needs first'}
              </button>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
