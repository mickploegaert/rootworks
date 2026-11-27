import { P } from '../palette.ts';
import { PixelCanvas, pick, type RGB } from '../pixel/PixelCanvas.ts';

/** Sakura pink, dark to light: the Blossom accent of the interface and its ornaments. */
export const SAKURA: readonly RGB[] = [[122, 52, 82], [178, 82, 118], [218, 122, 158], [240, 163, 191], [250, 200, 218], [255, 232, 240]];

/** A five-petal cherry blossom of radius `r` (2 or 3), centred on (cx, cy); or a bud. */
function flower(pc: PixelCanvas, cx: number, cy: number, open = true, r = 3): void {
  if (!open) { // a bud
    pc.set(cx, cy, SAKURA[2]); pc.set(cx + 1, cy, SAKURA[3]); pc.set(cx, cy - 1, SAKURA[4]); pc.set(cx + 1, cy + 1, SAKURA[1]);
    return;
  }
  // a round flower with five notches between the petals, lit from the upper left
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
    const d = Math.hypot(x, y), a = Math.atan2(y, x);
    if (d > r + 0.1 || (d > r * 0.63 && Math.cos(5 * (a + 0.31)) < -0.55)) continue;
    const lit = -(x + y) * 0.25;
    pc.set(cx + x, cy + y, d < r * 0.37 ? SAKURA[1] : pick(SAKURA, 3.6 + lit - d * 0.15 + (d < r * 0.67 ? 0.8 : 0)));
  }
  pc.set(cx, cy, P.amber[4]); // stamens
}

/**
 * A cherry branch for a panel's edge. Its woody base is at the right edge (x = w - 1); it tapers to the left with a
 * few kinks, side twigs and clusters of blossom of mixed sizes, with bare stretches between. `w` sets its length;
 * `seed` varies it. `side` keeps twigs and clusters above the limb ('up': rest it on a top edge or a header's
 * bottom line) or below it ('down': hang it from a bottom edge), clear of the text.
 */
export function blossomBranch(w = 64, seed = 1, side: 'up' | 'down' | 'both' = 'both'): PixelCanvas {
  const h = 30, pc = new PixelCanvas(w, h);
  let r = (seed * 7919) % 233280;
  const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  const base = side === 'up' ? 21 : side === 'down' ? 8 : 14;
  const clampY = (y: number) => Math.max(3, Math.min(h - 4, y));
  // the limb: a kinked line from the base to the tip, thick at the base
  const pts: [number, number][] = [[w - 1, base]];
  for (let x = w - 1; x > 3;) { x = Math.max(2, x - 9 - Math.floor(rnd() * 9)); pts.push([x, base + Math.round((rnd() - 0.5) * 5)]); }
  for (let k = 1; k < pts.length; k++) {
    const [x0, y0] = pts[k - 1], [x1, y1] = pts[k];
    for (let x = x0; x >= x1; x--) {
      const y = Math.round(y0 + ((y1 - y0) * (x0 - x)) / Math.max(1, x0 - x1)), thick = 1 + Math.round((2 * x) / w);
      pc.set(x, y - 1, pick(P.bark, 4)); // lit top
      for (let t = 0; t < thick; t++) pc.set(x, y + t, pick(P.bark, 2.8 - t * 0.7));
    }
  }
  const dir = () => (side === 'up' ? -1 : side === 'down' ? 1 : rnd() > 0.5 ? -1 : 1);
  const cluster = (cx: number, cy: number, n: number) => {
    for (let i = 0; i < n; i++) {
      const fx = cx + Math.round((rnd() - 0.5) * 7), fy = clampY(cy + Math.round((rnd() - 0.5) * 5));
      const roll = rnd();
      flower(pc, fx, fy, roll > 0.18, roll > 0.6 ? 3 : 2);
    }
  };
  // twigs from the kinks, each ending in a cluster; the woody base stays bare
  for (let k = 1; k < pts.length; k++) {
    const [x, y] = pts[k];
    if (x > w - 12) continue;
    const d = dir(), len = 4 + Math.floor(rnd() * 6);
    let tx = x, ty = y;
    for (let s = 1; s <= len; s++) { tx = x - Math.round(s * 0.7); ty = clampY(y + d * s); pc.set(tx, ty, pick(P.bark, 2.4)); }
    cluster(tx, ty, 2 + Math.floor(rnd() * 3));
    if (rnd() > 0.55) { pc.set(x + 2, y + d, pick(P.leaf, 4)); pc.set(x + 3, y + d, pick(P.leaf, 5)); pc.set(x + 2, y + d * 2, pick(P.leaf, 3)); }
    if (rnd() > 0.5) flower(pc, x + 3, clampY(y + d * 3), rnd() > 0.4, 2); // a lone blossom on the limb
  }
  const [tx, ty] = pts[pts.length - 1];
  cluster(tx + 2, clampY(ty + dir() * 2), 2); // the tip
  pc.edgeDarken(0.75);
  return pc;
}

/** A single blossom on a 9 x 9 canvas, for icons (the Run button, the running line). */
export function blossomIcon(): PixelCanvas {
  const pc = new PixelCanvas(9, 9);
  flower(pc, 4, 4);
  pc.edgeDarken(0.8);
  return pc;
}
