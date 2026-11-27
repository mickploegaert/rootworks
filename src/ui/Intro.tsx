import { useEffect, useState } from 'react';
import type { Game } from '../game/Game.ts';
import type { IntroEvent } from '../game/cinematic/Intro.ts';
import { BlossomIcon, Petals } from './Blossom.tsx';

/**
 * The intro's frame over the game: letterbox bars, captions, dips to black between shots, the title, and Skip.
 * The game drives the shots (game/cinematic/Intro.ts); this only listens. It blocks input while it plays.
 */
export function IntroOverlay({ game, onActive }: { game: Game; onActive(on: boolean): void }) {
  const [ev, setEv] = useState<IntroEvent | null>(null);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => game.events.on('intro', (e) => {
    if (e.phase === 'done') { setLeaving(true); window.setTimeout(() => { setEv(null); setLeaving(false); onActive(false); }, 900); return; }
    setEv(e); onActive(true);
  }), [game, onActive]);
  useEffect(() => {
    if (!ev || leaving) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); game.skipIntro(); } };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [ev, leaving, game]);
  if (!ev) return null;
  const ending = ev.dip >= 3; // the last dip holds black until the game takes over
  return (
    <div className={`intro ${leaving ? 'leaving' : ''} ${ending ? 'ending' : ''}`} role="dialog" aria-label="Intro" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <div className="intro-bar top" /><div className="intro-bar bottom" />
      {ev.caption && <p key={ev.caption} className="intro-caption" style={{ animationDuration: `${ev.captionFor}s` }}>{ev.caption}</p>}
      {ev.title && (
        <div className="intro-title">
          <Petals trigger="title" count={30} />
          <h1><BlossomIcon />ROOTWORKS<BlossomIcon /></h1>
          <p>Program the robots. Wake the valley.</p>
        </div>
      )}
      {!leaving && <div key={ev.dip} className={`intro-dip ${ev.dip === 0 ? 'in' : ending ? 'hold' : ''}`} />}
      {leaving && <div className="intro-dip out" />}
      {!leaving && <button type="button" className="intro-skip" autoFocus onClick={() => game.skipIntro()}>Skip intro <kbd>Esc</kbd></button>}
    </div>
  );
}
