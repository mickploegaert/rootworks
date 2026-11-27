import { useEffect, useState } from 'react';
import { blossomBranch, blossomIcon } from '../game/render/sprites/blossom.ts';

const urls: { icon?: string } = {};
const branches = new Map<string, string>();
type Side = 'up' | 'down' | 'both';
const branchUrl = (w: number, seed: number, side: Side) => { const k = `${w}:${seed}:${side}`; let u = branches.get(k); if (!u) branches.set(k, (u = blossomBranch(w, seed, side).toCanvas().toDataURL())); return u; };
const iconUrl = () => (urls.icon ??= blossomIcon().toCanvas().toDataURL());

/** A cherry branch that grows over a panel's corner; `length` in art pixels (shown at 2x). */
export function BlossomBranch({ className, length = 64, seed = 1, side = 'both' }: { className: string; length?: number; seed?: number; side?: Side }) {
  return <img className={`blossom-branch ${className}`} src={branchUrl(length, seed, side)} alt="" aria-hidden style={{ width: length * 2, height: 60 }} />;
}

/** One small blossom, for buttons and markers. */
export function BlossomIcon() {
  return <img className="blossom-icon" src={iconUrl()} alt="" aria-hidden />;
}

/** The blossom as a CSS url, for places only a background can reach (the editor's running line). */
export const blossomCss = () => `url(${iconUrl()})`;

/**
 * A short fall of petals (and a few leaves) whenever `trigger` changes to a new value: a program that finished,
 * a skill that was learned. Purely decorative; Reduce Motion hides it.
 */
export function Petals({ trigger, count = 14 }: { trigger: string | number | null; count?: number }) {
  const [burst, setBurst] = useState<{ key: string | number; items: { x: number; d: number; r: number; leaf: boolean }[] } | null>(null);
  useEffect(() => {
    if (trigger === null) return;
    setBurst({ key: trigger, items: Array.from({ length: count }, (_, i) => ({ x: Math.random() * 100, d: Math.random() * 0.6, r: Math.random() * 360, leaf: i % 5 === 4 })) });
    const t = window.setTimeout(() => setBurst(null), 2600);
    return () => window.clearTimeout(t);
  }, [trigger, count]);
  if (!burst) return null;
  return (
    <div className="petals" aria-hidden key={burst.key}>
      {burst.items.map((p, i) => <i key={i} className={p.leaf ? 'leaf' : ''} style={{ left: `${p.x}%`, animationDelay: `${p.d}s`, ['--r' as string]: `${p.r}deg` }} />)}
    </div>
  );
}
