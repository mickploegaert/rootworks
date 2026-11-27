import { BlossomBranch } from './Blossom.tsx';
import { useState, type ReactElement } from 'react';
import type { RegionView } from '../game/Game.ts';
import type { RegionId } from '../game/world/regions.ts';

interface Props {
  regions: RegionView[];
  onTravel(id: RegionId): string | null;
  onClose(): void;
}

const W = 1000, H = 620;
const STATE_LABEL: Record<RegionView['state'], string> = {
  active: 'You are here', visited: 'Visited', open: 'Ready to explore', locked: 'Locked', future: 'Not charted yet',
};

/** A deterministic wobbly island outline around (cx, cy). */
function islandPath(cx: number, cy: number, r: number, seed: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const k = 1 + Math.sin(a * 3 + seed) * 0.12 + Math.sin(a * 5 + seed * 2.1) * 0.07 + Math.sin(a * 2 + seed * 0.7) * 0.08;
    pts.push(`${(cx + Math.cos(a) * r * k * 1.25).toFixed(1)},${(cy + Math.sin(a) * r * k * 0.78).toFixed(1)}`);
  }
  return `M${pts.join('L')}Z`;
}

/** Each region is drawn with its own silhouette: you can tell what is there before you can go. */
function regionArt(art: RegionView['map']['art'], cx: number, cy: number): ReactElement {
  switch (art) {
    case 'vale': return (
      <g>
        <path d={`M${cx - 70} ${cy + 8} q 35 -26 70 -6 t 70 -4`} stroke="#6f9c45" strokeWidth="10" fill="none" strokeLinecap="round" />
        <path d={`M${cx - 60} ${cy - 18} C ${cx - 20} ${cy - 2}, ${cx + 10} ${cy + 26}, ${cx + 64} ${cy + 18}`} stroke="#5fa8c0" strokeWidth="5" fill="none" className="wm-river" />
        <g transform={`translate(${cx - 8} ${cy - 12})`}>
          <rect x="-14" y="-4" width="28" height="14" fill="#c9a27a" stroke="#4a2c1c" strokeWidth="1.5" />
          <path d="M-18 -4 L0 -18 L18 -4 Z" fill="#b5523a" stroke="#4a2c1c" strokeWidth="1.5" />
          <rect x="-4" y="2" width="6" height="8" fill="#ffcf6e" className="wm-window" />
          <path className="wm-smoke" d="M8 -14 q 4 -8 0 -14 q -4 -6 2 -12" stroke="#f4e8d2" strokeWidth="3" fill="none" opacity=".55" />
        </g>
        {[[-48, 10], [-36, -26], [44, -16], [56, 6], [28, 26]].map(([x, y], i) => (
          <g key={i} transform={`translate(${cx + x} ${cy + y})`}><rect x="-1.5" y="0" width="3" height="7" fill="#6b4226" /><circle r="7" cy="-2" fill={i % 2 ? '#f0a6c8' : '#7cb84a'} /></g>
        ))}
      </g>
    );
    case 'peaks': return (
      <g>
        {[[-46, 12, 34], [-6, 2, 46], [40, 14, 32]].map(([x, y, h], i) => (
          <g key={i}>
            <path d={`M${cx + x - h * 0.8} ${cy + y + 14} L${cx + x} ${cy + y + 14 - h} L${cx + x + h * 0.8} ${cy + y + 14} Z`} fill="#8e857c" stroke="#3d342e" strokeWidth="1.5" />
            <path d={`M${cx + x - h * 0.25} ${cy + y + 14 - h * 0.7} L${cx + x} ${cy + y + 14 - h} L${cx + x + h * 0.25} ${cy + y + 14 - h * 0.7} L${cx + x + 4} ${cy + y + 14 - h * 0.62} Z`} fill="#f2ede4" />
            <path d={`M${cx + x} ${cy + y + 14 - h} L${cx + x + h * 0.8} ${cy + y + 14} L${cx + x + 2} ${cy + y + 14} Z`} fill="#000" opacity=".18" />
          </g>
        ))}
        {[[-20, 24], [18, 26], [-58, 26]].map(([x, y], i) => <circle key={i} cx={cx + x} cy={cy + y} r="3" fill={i === 1 ? '#d98a4e' : '#9aa7b4'} stroke="#3d342e" />)}
      </g>
    );
    case 'forest': return (
      <g>
        {[[-58, 8], [-38, -14], [-16, 10], [4, -18], [24, 6], [46, -10], [60, 14], [-6, 26], [34, 26], [-40, 26]].map(([x, y], i) => (
          <g key={i} transform={`translate(${cx + x} ${cy + y})`} className={i % 3 === 0 ? 'wm-sway' : undefined}>
            <rect x="-2" y="2" width="4" height="9" fill="#5a3a24" />
            <circle r={11 - (i % 3) * 1.5} fill={['#3f7a3a', '#4f8f45', '#5fa052'][i % 3]} stroke="#24401f" strokeWidth="1.2" />
          </g>
        ))}
        {[[-26, 30], [14, 32], [52, 30]].map(([x, y], i) => <circle key={i} className="wm-glow" cx={cx + x} cy={cy + y} r="2.5" fill="#9fffd8" />)}
      </g>
    );
    case 'coast': return (
      <g>
        <path d={`M${cx - 60} ${cy + 18} Q ${cx} ${cy - 30} ${cx + 60} ${cy + 18}`} stroke="#f1dfa8" strokeWidth="16" fill="none" strokeLinecap="round" />
        {[-30, 0, 30].map((x, i) => <path key={i} className="wm-wave" d={`M${cx + x - 12} ${cy + 30} q 6 -6 12 0 t 12 0`} stroke="#e8f4f2" strokeWidth="2" fill="none" />)}
        <path d={`M${cx - 10} ${cy - 6} l 14 -22 l 3 22 Z`} fill="#f4e8d2" stroke="#6e4c33" strokeWidth="1.2" />
      </g>
    );
    case 'works': return (
      <g>
        <rect x={cx - 52} y={cy - 6} width="104" height="22" fill="#8a5a3c" stroke="#3a2418" strokeWidth="1.5" />
        {[-34, -8, 22].map((x, i) => (
          <g key={i}>
            <rect x={cx + x} y={cy - 30 - i * 4} width="9" height={26 + i * 4} fill="#6e4030" stroke="#3a2418" strokeWidth="1.2" />
            <path className="wm-smoke" d={`M${cx + x + 4} ${cy - 34 - i * 4} q 5 -8 0 -14 q -5 -6 2 -12`} stroke="#d8cfc4" strokeWidth="4" fill="none" opacity=".45" />
          </g>
        ))}
      </g>
    );
    case 'root': return (
      <g>
        <ellipse cx={cx} cy={cy + 6} rx="46" ry="20" fill="#5e4a78" stroke="#2c2238" strokeWidth="1.5" />
        {[-1, 1].map((s) => <path key={s} d={`M${cx} ${cy - 2} C ${cx + s * 20} ${cy - 30}, ${cx + s * 50} ${cy - 10}, ${cx + s * 60} ${cy + 16}`} stroke="#3a2c24" strokeWidth="6" fill="none" strokeLinecap="round" />)}
        <circle className="wm-glow" cx={cx} cy={cy - 4} r="6" fill="#d7b8ff" />
      </g>
    );
  }
}

/** The world map: every region at a glance. Only the active region is loaded; the rest are drawn from metadata. */
export function WorldMap({ regions, onTravel, onClose }: Props) {
  const active = regions.find((r) => r.state === 'active')!;
  const [picked, setPicked] = useState<RegionId>(active.id);
  const [problem, setProblem] = useState<string | null>(null);
  const sel = regions.find((r) => r.id === picked)!;
  const pos = (r: RegionView) => ({ x: (r.map.x / 100) * W, y: (r.map.y / 100) * H });
  const a = pos(active);

  return (
    <div className="map-veil" role="dialog" aria-label="World map" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <section className="panel world-map">
        <header className="row">
          <BlossomBranch className="orn-head" length={130} seed={8} side="up" />
          <h2>World map</h2>
          <span className="muted">One region is loaded at a time. Your robots in other regions wait, paused, until you return.</span>
          <button type="button" className="icon" onClick={onClose} aria-label="Close the map" autoFocus>close</button>
        </header>
        <div className="map-body">
          <svg viewBox={`0 0 ${W} ${H}`} className="map-svg" role="img" aria-label="Regions of the world">
            <defs>
              <pattern id="wm-waves" width="60" height="24" patternUnits="userSpaceOnUse">
                <path d="M0 12 q 15 -8 30 0 t 30 0" stroke="#8fc6d2" strokeWidth="1.4" fill="none" opacity=".35" />
              </pattern>
              <filter id="wm-faded"><feColorMatrix type="saturate" values="0.35" /><feComponentTransfer><feFuncR type="linear" slope=".8" /><feFuncG type="linear" slope=".8" /><feFuncB type="linear" slope=".85" /></feComponentTransfer></filter>
              <radialGradient id="wm-fog"><stop offset="0" stopColor="#e8e2d8" stopOpacity=".38" /><stop offset="1" stopColor="#e8e2d8" stopOpacity="0" /></radialGradient>
            </defs>
            <rect width={W} height={H} fill="#2c7186" />
            <rect width={W} height={H} fill="url(#wm-waves)" className="wm-sea" />
            {/* routes from where you are to the places you can go */}
            {regions.filter((r) => r.id !== active.id && r.state !== 'future').map((r) => {
              const b = pos(r);
              return <path key={r.id} d={`M${a.x} ${a.y} Q ${(a.x + b.x) / 2} ${(a.y + b.y) / 2 - 60} ${b.x} ${b.y}`} stroke={r.lock ? '#8e787e' : '#f0a3bf'} strokeWidth="3" strokeDasharray="2 10" strokeLinecap="round" fill="none" opacity=".8" className="wm-route" />;
            })}
            {regions.map((r, i) => {
              const { x, y } = pos(r);
              const dim = r.state === 'locked' || r.state === 'future';
              return (
                <g key={r.id} className={`wm-region s-${r.state} ${picked === r.id ? 'picked' : ''}`} tabIndex={0} role="button" aria-label={`${r.name}: ${STATE_LABEL[r.state]}`}
                  onClick={() => { setPicked(r.id); setProblem(null); }} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { setPicked(r.id); setProblem(null); } }}>
                  <path d={islandPath(x, y + 6, 92, i * 1.7 + 1)} fill="#d9c48c" />
                  <g filter={dim ? 'url(#wm-faded)' : undefined}>
                    <path d={islandPath(x, y, 84, i * 1.7 + 1)} fill={r.map.hue} stroke="#3a2a1c" strokeWidth="2" />
                    {regionArt(r.map.art, x, y)}
                  </g>
                  {dim && <ellipse cx={x} cy={y} rx="110" ry="70" fill="url(#wm-fog)" className="wm-fog" />}
                  {r.state === 'active' && <ellipse cx={x} cy={y + 4} rx="120" ry="78" fill="none" stroke="#f0a3bf" strokeWidth="3" className="wm-pulse" />}
                  <g transform={`translate(${x} ${y + 74})`}>
                    <rect x={-r.name.length * 4.6 - 14} y="-13" width={r.name.length * 9.2 + 28} height="26" rx="3" fill="#2a1c21" stroke={r.state === 'active' ? '#f0a3bf' : '#5e414a'} strokeWidth="2" />
                    <text textAnchor="middle" y="5" fill={dim ? '#c2a98b' : '#f4e8d2'} fontSize="15" fontWeight="700">{r.name}</text>
                    {dim && (
                      <g transform={`translate(${-r.name.length * 4.6 - 26} -9)`} aria-hidden>
                        <path d="M3 8 V5 a5 5 0 0 1 10 0 V8" stroke="#c2a98b" strokeWidth="2" fill="none" />
                        <rect x="1" y="8" width="14" height="10" rx="1.5" fill="#c2a98b" />
                      </g>
                    )}
                  </g>
                  {r.state === 'active' && (
                    <g transform={`translate(${x + 70} ${y - 52})`} className="wm-flag">
                      <rect x="-1.5" y="0" width="3" height="34" fill="#4a2c1c" />
                      <path d="M1.5 1 L28 8 L1.5 15 Z" fill="#f0a3bf" stroke="#4a1c2e" />
                    </g>
                  )}
                </g>
              );
            })}
          </svg>
          <aside className="map-detail">
            <span className={`map-state s-${sel.state}`}>{STATE_LABEL[sel.state]}</span>
            <h3>{sel.name}</h3>
            <p>{sel.tagline}</p>
            <p className="muted"><b>Resources:</b> {sel.resources}</p>
            {sel.lock && <p className="map-lock">{sel.lock}</p>}
            {sel.state === 'active'
              ? <p className="muted">This region is loaded and running.</p>
              : <button type="button" className="map-travel" disabled={!!sel.lock} onClick={() => setProblem(onTravel(sel.id))}>
                  {sel.state === 'visited' ? `Travel to ${sel.name}` : `Explore ${sel.name}`}
                </button>}
            {sel.state === 'open' && <p className="muted">First visit: the region is generated when you arrive. A field robot waits at the landing.</p>}
            {sel.state === 'visited' && <p className="muted">Everything is as you left it: buildings, robots and their programs.</p>}
            {problem && <p className="map-lock">{problem}</p>}
          </aside>
        </div>
      </section>
    </div>
  );
}
