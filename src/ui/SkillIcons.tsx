import type { ReactElement } from 'react';

/**
 * One 24 x 24 line icon per skill, drawn for ROOTWORKS: square caps and joins like riveted metal, a single
 * stroke weight, so every icon reads as the same set. currentColor follows the node's state.
 */
const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'square' as const, strokeLinejoin: 'miter' as const };

const ICONS: Record<string, ReactElement> = {
  // programming: each draws its idea
  loop: <g {...P}><path d="M19 12a7 7 0 1 1-2.05-4.95" /><path d="M17 3v4.5h-4.5" /><path d="M12 9v3l2 2" /></g>,
  counter: <g {...P}><rect x="4" y="7" width="16" height="12" /><path d="M4 11h16" /><path d="M9 4h6" /><path d="M9 15l2 2 3-4" strokeWidth={1.6} /></g>,
  operators: <g {...P}><path d="M7 5v8M3 9h8" /><path d="M20 15l-5 3 5 3" /><path d="M14 4l6 6" /></g>,
  sense: <g {...P}><path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z" /><rect x="10" y="10" width="4" height="4" fill="currentColor" /></g>,
  lists: <g {...P}><rect x="3" y="4" width="3" height="3" fill="currentColor" /><path d="M9 5.5h12" /><rect x="3" y="10.5" width="3" height="3" fill="currentColor" /><path d="M9 12h12" /><rect x="3" y="17" width="3" height="3" fill="currentColor" /><path d="M9 18.5h8" /></g>,
  functions: <g {...P}><path d="M8 3H6v6l-2 3 2 3v6h2" /><path d="M16 3h2v6l2 3-2 3v6h-2" /><path d="M10 12h4" /></g>,
  // machines
  sawmill: <g {...P}><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="1.5" fill="currentColor" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" /></g>,
  kiln: <g {...P}><path d="M5 20V12a7 7 0 0 1 14 0v8z" /><path d="M10 20v-4a2 2 0 0 1 4 0v4" /><path d="M12 3V1" /><path d="M3 20h18" /></g>,
  windpower: <g {...P}><path d="M12 12L12 3l3 2z" /><path d="M12 12l8 4-3 2z" /><path d="M12 12l-8 4 1-3z" /><path d="M12 12v10" /><path d="M8 22h8" /></g>,
  gardening: <g {...P}><path d="M12 21v-9" /><path d="M12 13c0-4 3-7 8-7 0 4-3 7-8 7z" /><path d="M12 15c0-3-2-5-6-5 0 3 2 5 6 5z" /><path d="M7 21h10" /></g>,
  feeder: <g {...P}><path d="M3 4h18l-6 7v5H9v-5z" /><path d="M12 16v5" /><path d="M9 18l3 3 3-3" /></g>,
  // robots and land
  surveying: <g {...P}><circle cx="12" cy="12" r="8" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /><path d="M9 15l2-5 4-1-2 5z" fill="currentColor" /></g>,
  surveying2: <g {...P}><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" /><path d="M9 4v14M15 6v14" /><path d="M11 11h2" /></g>,
  speed1: <g {...P}><path d="M9 6l6 6-6 6" /></g>,
  speed2: <g {...P}><path d="M5 6l6 6-6 6" /><path d="M12 6l6 6-6 6" /></g>,
  speed3: <g {...P}><path d="M2 6l6 6-6 6" /><path d="M9 6l6 6-6 6" /><path d="M16 6l6 6-6 6" /></g>,
  cargo: <g {...P}><rect x="4" y="7" width="16" height="13" /><path d="M4 12h16" /><path d="M10 7v5" /><path d="M8 3h8l2 4H6z" /></g>,
  cargo2: <g {...P}><rect x="2" y="10" width="9" height="10" /><rect x="13" y="10" width="9" height="10" /><rect x="7.5" y="2" width="9" height="8" /></g>,
  yield1: <g {...P}><path d="M14 4l6 6" /><path d="M3 21l10-10" /><path d="M11 5c3-2 7-2 9 0-3 0-5 1-6 3" /></g>,
  logistics: <g {...P}><path d="M4 8h14" /><path d="M14 4l4 4-4 4" /><path d="M20 16H6" /><path d="M10 12l-4 4 4 4" /></g>,
  assembly: <g {...P}><rect x="5" y="7" width="14" height="11" /><path d="M12 7V3" /><rect x="10.5" y="1.5" width="3" height="3" fill="currentColor" /><rect x="8" y="10" width="3" height="3" fill="currentColor" /><path d="M14 14h2" /><path d="M5 21h14" /></g>,
};

/** The icon of a skill (a plain dot for any skill added later without one). */
export function SkillIcon({ id, size = 24 }: { id: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="skill-icon">
      {ICONS[id] ?? <rect x="9" y="9" width="6" height="6" fill="currentColor" />}
    </svg>
  );
}
