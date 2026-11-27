import { useEffect, useState } from 'react';
import type { Game, RegionView } from '../game/Game.ts';
import type { RegionId } from '../game/world/regions.ts';

/**
 * Developer cheats for testing. Opened by typing "login" (anywhere outside a text field, or in the command search).
 * shortcut: the credential check runs in the browser, so this only keeps cheats out of sight; it is not security.
 * Move it behind a server if cheats ever affect other players.
 */
const CREDENTIAL = '68dfef8b16384aaad592a91abf2141d0771d3952be4fc31d63651c667e46f3a1'; // sha-256 of "name:password"
const KEY = 'rootworks.dev';
export const LOGIN_EVENT = 'rootworks:login';

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const loggedIn = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };

const QUICK: { code: string; label: string }[] = [
  { code: 'unlockall', label: 'Unlock every skill' }, { code: 'sparks 100', label: '+100 Sparks' }, { code: 'rich', label: '+500 of everything' },
  { code: 'builder', label: 'Finish construction' }, { code: 'land', label: 'Reclaim all land' }, { code: 'fleet', label: 'Add a robot' },
  { code: 'skiptutorial', label: 'Skip the tutorial' }, { code: 'full', label: 'Fill robot cargo' },
];

export function DevMenu({ game, regions, onTravel }: { game: Game; regions: RegionView[]; onTravel(id: RegionId): string | null }) {
  const [dev, setDev] = useState(loggedIn);
  const [view, setView] = useState<null | 'login' | 'menu' | 'gallery'>(null);
  const [name, setName] = useState(''), [pass, setPass] = useState(''), [msg, setMsg] = useState(''), [code, setCode] = useState('');

  useEffect(() => {
    let typed = '';
    const open = () => setView(loggedIn() ? 'menu' : 'login');
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select, .cm-editor')) return;
      typed = (typed + e.key.toLowerCase()).slice(-5);
      if (typed === 'login') open();
    };
    window.addEventListener('keydown', key);
    window.addEventListener(LOGIN_EVENT, open);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener(LOGIN_EVENT, open); };
  }, []);

  const login = async () => {
    try {
      if (await sha256(`${name.trim()}:${pass}`) !== CREDENTIAL) { setMsg('Wrong name or password.'); return; }
    } catch { setMsg('Login needs a secure page (https or localhost).'); return; }
    localStorage.setItem(KEY, '1');
    setDev(true); setPass(''); setMsg('Welcome back. Everything below is a cheat.'); setView('menu');
  };
  const run = (c: string) => setMsg(game.cheat(c));

  return (
    <>
      {dev && !view && <button type="button" className="dev-badge" onClick={() => setView('menu')} title="Developer cheats">DEV</button>}
      {view === 'login' && (
        <div className="pause-veil">
          <form className="panel dev-login" onSubmit={(e) => { e.preventDefault(); void login(); }}>
            <h2>Developer login</h2>
            <label>Name<input autoFocus value={name} onChange={(e) => setName(e.target.value)} autoComplete="username" /></label>
            <label>Password<input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" /></label>
            {msg && <p className="muted">{msg}</p>}
            <div className="row"><button type="button" onClick={() => setView(null)}>Cancel</button><button type="submit" className="primary">Log in</button></div>
          </form>
        </div>
      )}
      {view === 'menu' && (
        <section className="panel dev-menu" aria-label="Developer cheats">
          <div className="row"><h2>Developer cheats</h2><button type="button" className="icon" onClick={() => setView(null)}>close</button></div>
          <div className="dev-grid">{QUICK.map((q) => <button key={q.code} type="button" onClick={() => run(q.code)}>{q.label}</button>)}</div>
          <span className="label">Game speed</span>
          <div className="dev-row">{[1, 2, 4, 10].map((x) => <button key={x} type="button" onClick={() => run(`speed ${x}`)}>x{x}</button>)}</div>
          <span className="label">Travel</span>
          <div className="dev-row">
            {regions.filter((r) => r.state !== 'future').map((r) => (
              <button key={r.id} type="button" disabled={r.state === 'active'} onClick={() => setMsg(onTravel(r.id) ?? `Travelling to ${r.name}...`)}>{r.name}</button>
            ))}
          </div>
          <form className="dev-row" onSubmit={(e) => { e.preventDefault(); if (code.trim()) run(code); setCode(''); }}>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Cheat code, e.g. sparks 50" aria-label="Cheat code" />
            <button type="submit">Run</button>
          </form>
          {msg && <p className="muted">{msg}</p>}
          <div className="dev-row">
            <button type="button" onClick={() => setView('gallery')}>Model gallery</button>
            <button type="button" onClick={() => { localStorage.removeItem(KEY); setDev(false); setView(null); }}>Log out</button>
          </div>
        </section>
      )}
      {view === 'gallery' && (
        <div className="gallery" role="dialog" aria-label="Model gallery">
          <header className="skilltree-head"><h2>Model gallery</h2><span className="muted">Every painted model in the game, at 2x.</span>
            <button type="button" className="skilltree-close" onClick={() => setView('menu')}>Back</button></header>
          <div className="gallery-grid">
            {game.spriteIds().map((id) => <figure key={id}><img src={game.thumbnail(id)} alt="" onLoad={(e) => { const i = e.currentTarget; i.style.width = `${Math.min(i.naturalWidth * 2, 400)}px`; }} /><figcaption>{id}</figcaption></figure>)}
          </div>
        </div>
      )}
    </>
  );
}
