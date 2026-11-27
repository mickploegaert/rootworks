import { hash2, makeRng, vnoise } from '../../core/noise.ts';
import { P } from '../palette.ts';
import { PixelCanvas, blob, fillPoly, line, mix, pick, ramp, rect, shadowEllipse, tint, type RGB } from '../pixel/PixelCanvas.ts';
import { drawCylinder } from '../pixel/iso3d.ts';
import { newBuilt, type Built } from './types.ts';

// ---------------------------------------------------------------- helpers

/** Tapered, left-lit trunk with a root flare. */
function trunk(pc: PixelCanvas, cx: number, baseY: number, topY: number, w: number, seed: number, colors: readonly RGB[] = P.bark, lean = 0): void {
  for (let y = Math.floor(topY); y <= baseY; y++) {
    const f = (baseY - y) / Math.max(1, baseY - topY);
    const flare = Math.max(0, y - (baseY - 8)) * 0.8;
    const hw = (w / 2) * (1 - f * 0.35) + flare;
    const mx = cx + lean * f * f;
    for (let x = Math.floor(mx - hw); x < Math.ceil(mx + hw); x++) {
      const nx = (x + 0.5 - mx) / hw;
      let idx = colors.length * 0.55 - nx * 1.7 + (vnoise(x * 0.9, y * 0.12, seed) - 0.5) * 1.6;
      if (vnoise(x * 1.7, y * 0.3, seed + 3) > 0.72) idx -= 1.1;
      pc.set(x, y, pick(colors, idx));
    }
  }
}

/** A thick shaded line (branch, root). */
function limb(pc: PixelCanvas, x0: number, y0: number, x1: number, y1: number, w0: number, w1: number, colors: readonly RGB[] = P.bark): void {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
  for (let i = 0; i <= n; i++) {
    const t = i / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t, r = (w0 + (w1 - w0) * t) / 2;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r + 0.3) continue;
      pc.set(x + dx, y + dy, pick(colors, colors.length * 0.5 - (dx + dy) / Math.max(1, r) * 1.2));
    }
  }
}

/** Surface roots spreading over the ground from a trunk base. */
function roots(pc: PixelCanvas, cx: number, cy: number, n: number, len: number, w: number, seed: number): void {
  const rng = makeRng(seed);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng() * 0.6;
    const l = len * (0.6 + rng() * 0.5);
    const ex = cx + Math.cos(a) * l, ey = cy + Math.sin(a) * l * 0.45;
    limb(pc, cx + Math.cos(a) * w * 0.3, cy - 2, ex, ey, w, 1);
  }
}

/**
 * A canopy built from many overlapping leaf clumps, lit as a single volume: a dark core first,
 * then clumps sorted back-to-front with a light bias toward the upper-left, then sun-caught leaves.
 */
function canopy(pc: PixelCanvas, cx: number, cy: number, rx: number, ry: number, colors: readonly RGB[], seed: number, n: number, cmin: number, cmax: number): void {
  const rng = makeRng(seed);
  blob(pc, cx, cy + ry * 0.08, rx * 0.84, ry * 0.82, colors, { style: 'leaf', seed, ragged: 0.3, bias: -0.3 });
  const pts: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = rng() * Math.PI * 2, r = Math.sqrt(rng());
    pts.push([cx + Math.cos(a) * r * rx * 0.8, cy + Math.sin(a) * r * ry * 0.8, cmin + rng() * (cmax - cmin)]);
  }
  pts.sort((p, q) => p[1] - q[1]);
  pts.forEach(([x, y, r], i) => {
    const bias = -((x - cx) / rx) * 0.16 - ((y - cy) / ry) * 0.2 + 0.04;
    blob(pc, x, y, r * 1.15, r * 0.92, colors, { style: 'leaf', seed: seed + i * 3, ragged: 0.42, bias });
  });
  const top = colors[colors.length - 1], near = colors[colors.length - 2];
  for (let i = 0; i < n * 10; i++) {
    const x = Math.round(cx + (rng() * 2 - 1) * rx), y = Math.round(cy + (rng() * 2 - 1) * ry);
    if ((x - cx) / rx + (y - cy) / ry > -0.25 || !pc.alpha(x, y) || !pc.alpha(x, y - 1)) continue;
    pc.set(x, y, rng() > 0.4 ? near : top);
  }
}

const SHADOW_ALPHA = 85;

// ---------------------------------------------------------------- trees

function broadleaf(colors: readonly RGB[], seed: number, s: number, opts: { trunkColors?: readonly RGB[] } = {}): Built {
  const b = newBuilt(120, 140, 60, 128), { pc } = b;
  shadowEllipse(b.shadow!, 60 + 18 * s, 130, 38 * s, 12 * s, SHADOW_ALPHA);
  const cy = 128 - 72 * s;
  trunk(pc, 60, 129, cy + 6, 11 * s, seed, opts.trunkColors);
  limb(pc, 60, cy + 22 * s, 60 - 22 * s, cy - 2, 5 * s, 2);
  limb(pc, 60, cy + 18 * s, 60 + 20 * s, cy - 6, 5 * s, 2);
  roots(pc, 60, 128, 5, 13 * s, 4 * s, seed);
  canopy(pc, 60, cy, 44 * s, 33 * s, colors, seed, Math.round(28 * s), 7 * s, 12 * s);
  pc.edgeDarken(0.6);
  b.sway = 2;
  b.shade = { dx: 14, dy: 2, rx: 48 * s, ry: 24 * s, strength: 0.85 };
  return b;
}

export const oak = (v: number) => broadleaf(v === 1 ? P.leafWarm : P.leaf, 100 + v * 13, [1, 0.86, 1.06][v]);
export const maple = () => broadleaf(P.maple, 140, 0.95);
export const cherry = () => broadleaf(P.cherry, 160, 0.88);

export function birch(v: number): Built {
  const b = newBuilt(84, 136, 42, 126), { pc } = b, seed = 180 + v, s = v ? 0.85 : 1;
  shadowEllipse(b.shadow!, 42 + 12, 127, 24 * s, 8 * s, SHADOW_ALPHA);
  const top = 126 - 92 * s;
  trunk(pc, 42, 127, top, 6, seed, [...P.white, [250, 250, 245] as const]);
  // dark lenticels across the bark
  for (let y = top; y < 126; y++) if (hash2(y, seed, 1) < 0.18) {
    const w = 1 + Math.floor(hash2(y, seed, 2) * 3);
    for (let x = 40 - w; x < 41 + w; x++) if (pc.alpha(x, y)) pc.set(x, y, [44, 40, 40]);
  }
  limb(pc, 42, top + 40 * s, 30, top + 24 * s, 2, 1, P.white);
  canopy(pc, 42, 126 - 80 * s, 28 * s, 36 * s, P.birch, seed, Math.round(20 * s), 5, 8.5);
  pc.edgeDarken(0.6);
  b.sway = 2.5;
  b.shade = { dx: 10, dy: 2, rx: 30 * s, ry: 15 * s, strength: 0.6 };
  return b;
}

export function pine(v: number): Built {
  const b = newBuilt(80, 140, 40, 130), { pc } = b;
  const s = v === 0 ? 1 : 0.82, seed = 200 + v;
  shadowEllipse(b.shadow!, 40 + 13, 131, 24 * s, 8 * s, SHADOW_ALPHA);
  trunk(pc, 40, 131, 130 - 28 * s, 7, seed);
  const tiers = 6;
  for (let k = 0; k < tiers; k++) {
    const f0 = k / tiers;
    const top = 130 - (112 - k * 15) * s - 4, bot = 130 - (70 - k * 13) * s, hw = (8 + k * 4.4) * s;
    for (let y = Math.floor(top); y <= bot + 4; y++) {
      const f = (y - top) / (bot - top);
      const w = hw * Math.min(1, Math.pow(Math.max(0, f), 0.85)) + (y % 3 === 0 ? hash2(y, seed + k, 1) * 3 : 0);
      for (let x = Math.floor(40 - w); x <= Math.ceil(40 + w); x++) {
        const xr = (x + 0.5 - 40) / Math.max(1, w);
        if (y > bot + Math.abs(xr) * 4 - 1) continue; // drooping tips
        let lit = 0.62 - xr * 0.3 - (1 - f) * 0.18 + f0 * 0.04 + (hash2(x >> 1, y, seed + k) - 0.5) * 0.36;
        if (y > bot + Math.abs(xr) * 4 - 3) lit -= 0.28; // shadowed underside
        if (xr < -0.2 && hash2(x, y, seed + 9) < 0.08) lit += 0.3; // sunlit needles
        pc.set(x, y, pick(P.pine, lit * 5.99));
      }
    }
  }
  pc.edgeDarken(0.6);
  b.sway = 1.5;
  b.shade = { dx: 10, dy: 2, rx: 26 * s, ry: 13 * s, strength: 0.7 };
  return b;
}

export function willow(): Built {
  const b = newBuilt(132, 136, 66, 126), { pc } = b, seed = 220;
  shadowEllipse(b.shadow!, 66 + 16, 127, 46, 14, SHADOW_ALPHA);
  trunk(pc, 66, 127, 64, 13, seed, P.bark, -6);
  roots(pc, 66, 126, 5, 16, 4, seed);
  const cx = 62, cy = 58;
  canopy(pc, cx, cy, 48, 24, P.willow, seed, 22, 7, 11);
  // weeping strands
  for (let x = cx - 50; x <= cx + 50; x += 2) {
    const xr = (x - cx) / 50;
    if (Math.abs(xr) > 1) continue;
    const y0 = cy + Math.sqrt(1 - xr * xr) * 12;
    const len = 18 + hash2(x, seed, 3) * 34 * (1 - Math.abs(xr) * 0.4);
    for (let i = 0; i < len; i++) {
      const sx = x + Math.round(Math.sin(i * 0.15 + x) * 0.6);
      const lit = 0.55 - xr * 0.3 - (i / len) * 0.15 + (hash2(sx, i, seed) - 0.5) * 0.3;
      pc.set(sx, y0 + i, pick(P.willow, lit * 5.99 + (i > len - 3 ? 1 : 0)));
    }
  }
  pc.edgeDarken(0.6);
  b.sway = 3;
  b.shade = { dx: 12, dy: 2, rx: 50, ry: 24, strength: 0.75 };
  return b;
}

/** The ancient tree that grew up beside the lab: the landmark of the start area. Occupies 2x2 tiles. */
export function giantTree(): Built {
  const W = 240, H = 260;
  const b = newBuilt(W, H, 120, 228), { pc } = b, seed = 260;
  const gx = 120, gy = 228 + 16; // trunk stands at the footprint centre
  shadowEllipse(b.shadow!, gx + 34, gy + 2, 92, 30, SHADOW_ALPHA);
  roots(pc, gx, gy, 9, 46, 9, seed);
  trunk(pc, gx, gy, gy - 118, 30, seed, P.bark, 4);
  limb(pc, gx, gy - 80, gx - 62, gy - 132, 13, 4);
  limb(pc, gx + 4, gy - 90, gx + 66, gy - 140, 12, 4);
  limb(pc, gx, gy - 110, gx - 10, gy - 168, 11, 4);
  // moss creeping up the trunk
  for (let y = gy - 100; y < gy; y++) for (let x = gx - 20; x < gx + 20; x++)
    if (pc.alpha(x, y) && x < gx - 2 && vnoise(x * 0.3, y * 0.15, 3) > 0.6) pc.set(x, y, pick(P.moss, 2.5 + hash2(x, y, 1) * 2));
  canopy(pc, gx - 44, gy - 150, 52, 36, P.leaf, seed + 1, 26, 10, 15);
  canopy(pc, gx + 48, gy - 146, 50, 34, P.leaf, seed + 2, 26, 10, 15);
  canopy(pc, gx, gy - 176, 70, 44, P.leaf, seed + 3, 44, 11, 17);
  canopy(pc, gx + 6, gy - 128, 58, 26, P.leaf, seed + 4, 22, 9, 13);
  // lanterns hung in the branches
  const pods: [number, number][] = [[-50, -118], [-18, -104], [30, -110], [62, -122], [8, -138]];
  for (const [dx, dy] of pods) {
    line(pc, gx + dx, gy + dy - 8, gx + dx, gy + dy - 2, pick(P.leaf, 1));
    blob(pc, gx + dx, gy + dy, 2.5, 3, P.amber.slice(2), { style: 'smooth' }); // hanging lanterns
  }
  pc.edgeDarken(0.6);
  b.sway = 1;
  b.shade = { dx: 26, dy: 4, rx: 110, ry: 52, strength: 0.9 };
  b.fx = { glows: pods.map(([dx, dy]) => ({ x: dx, y: dy + 16, color: 0xffc070, radius: 14, flicker: 0.3, alpha: 0.5 })) };
  return b;
}

// ---------------------------------------------------------------- undergrowth

/** Russet for autumn shrubs: muted, so a bush never reads as a resource or a fire. */
const AUTUMN = ramp('#3e2a18', '#5c3a1e', '#7a4e26', '#946232', '#ab7a42', '#c49656', '#d8b070');

export function bush(kind: 'plain' | 'flower' | 'berry' | 'autumn', v = 0): Built {
  const b = newBuilt(60, 46, 30, 38), { pc } = b, seed = 300 + v * 7 + kind.length * 11;
  shadowEllipse(b.shadow!, 30 + 7, 39, 19, 6, SHADOW_ALPHA);
  canopy(pc, 30, 27, 20, 12, kind === 'autumn' ? AUTUMN : P.leaf, seed, 10, 5, 8);
  const rng = makeRng(seed);
  const dots: RGB[] = kind === 'berry' ? [[176, 30, 52], [255, 112, 120]] : kind === 'flower' ? [[245, 240, 230], [250, 220, 120]] : [];
  for (let i = 0; i < 16 && dots.length; i++) {
    const x = 13 + Math.floor(rng() * 34), y = 16 + Math.floor(rng() * 18);
    if (pc.alpha(x, y) && pc.alpha(x + 1, y + 1)) { pc.set(x, y, dots[0]); pc.set(x + 1, y, dots[0]); pc.set(x, y - 1, dots[1]); }
  }
  pc.edgeDarken(0.6);
  b.sway = 1;
  b.shade = { dx: 4, dy: 1, rx: 20, ry: 9, strength: 0.5 };
  return b;
}

/** Low spreading ivy that creeps over ground and wall bases. */
export function ivyMound(v: number): Built {
  const b = newBuilt(68, 34, 34, 28), { pc } = b, seed = 340 + v;
  shadowEllipse(b.shadow!, 38, 28, 26, 6, 60);
  canopy(pc, 34, 22, 28, 7, P.leaf, seed, 12, 4, 6);
  pc.edgeDarken(0.65);
  return b;
}

export function fern(v: number): Built {
  const b = newBuilt(60, 42, 30, 36), { pc } = b, rng = makeRng(400 + v);
  shadowEllipse(b.shadow!, 34, 36, 15, 4, 70);
  const fronds = 9 + v * 2;
  const order = Array.from({ length: fronds }, (_, i) => i).sort((a, c) => Math.abs(c - fronds / 2) - Math.abs(a - fronds / 2));
  for (const i of order) {
    const a = (i / (fronds - 1) - 0.5) * 2.8 + (rng() - 0.5) * 0.2;
    const len = 15 + rng() * 8;
    for (let s = 1; s <= len; s++) {
      const t = s / len;
      const x = 30 + Math.sin(a) * s * (0.95 + t * 0.3), y = 35 - Math.cos(a) * s * 0.85 + t * t * 9 * Math.abs(Math.sin(a));
      const col = pick(P.leaf, 2.4 + (Math.sin(a) < 0 ? 1.4 : 0) + t * 1.8);
      pc.set(x, y, col);
      if (s % 2 === 0 && t < 0.94) {
        const l = Math.round(3 * (1 - t)) + 1;
        for (let k = 1; k <= l; k++) {
          pc.set(Math.round(x) - k, Math.round(y) + Math.ceil(k / 2), tint(col, 0.88 + (k === 1 ? 0.1 : 0)));
          pc.set(Math.round(x) + k, Math.round(y) + Math.ceil(k / 2), tint(col, 0.78));
        }
      }
    }
  }
  pc.edgeDarken(0.65);
  b.sway = 1.5;
  return b;
}

/** Broad-leaved plant (hosta-like) that thrives in the shade of the ruins. */
export function broadleafPlant(v: number): Built {
  const b = newBuilt(56, 40, 28, 34), { pc } = b, rng = makeRng(450 + v);
  shadowEllipse(b.shadow!, 32, 34, 16, 5, 70);
  const leaves = 7;
  for (let k = 0; k < leaves; k++) {
    const a = -Math.PI / 2 + (k / (leaves - 1) - 0.5) * 2.6 + (rng() - 0.5) * 0.3;
    const L = 13 + rng() * 5, Wd = 5 + rng() * 2;
    const cx = 28 + Math.cos(a) * L * 0.75, cy = 33 + Math.sin(a) * L * 0.55;
    const ca = Math.cos(a), sa = Math.sin(a);
    for (let y = Math.floor(cy - L); y <= cy + L; y++) for (let x = Math.floor(cx - L); x <= cx + L; x++) {
      const dx = x + 0.5 - cx, dy = (y + 0.5 - cy) / 0.7;
      const lx = dx * ca + dy * sa, ly = -dx * sa + dy * ca;
      if ((lx / L) ** 2 + (ly / Wd) ** 2 > 1) continue;
      const col = Math.abs(ly) < 0.7 ? pick(P.grassWarm, 4.5) : pick(P.grassCool, 3 + (ly < 0 ? 1.4 : 0) + (lx / L) * 0.8 + (k / leaves) * 0.5);
      pc.set(x, y, col);
    }
  }
  pc.edgeDarken(0.6);
  b.sway = 1;
  return b;
}

export function grassTuft(v: number): Built {
  const b = newBuilt(40, 38, 20, 33), { pc } = b, rng = makeRng(500 + v);
  shadowEllipse(b.shadow!, 23, 33, 11, 3, 55);
  const blades = 14 + v * 3;
  for (let i = 0; i < blades; i++) {
    const bx = 20 + (i / (blades - 1) - 0.5) * 18 + (rng() - 0.5) * 2, h = 10 + rng() * 16, lean = (rng() - 0.5) * 10;
    const dry = rng() < 0.18;
    const ramp = dry ? P.grassWarm : P.grass;
    for (let s = 0; s <= h; s++) {
      const t = s / h, x = bx + lean * t * t, y = 33 - s;
      const col = pick(ramp, 2 + t * 3.8 + (lean < 0 ? 0.6 : 0) + (dry ? 0.8 : 0));
      pc.set(x, y, col);
      if (t < 0.45) pc.set(x + 1, y, tint(col, 0.8));
    }
    if (dry && rng() < 0.5) { const tx = bx + lean, ty = 33 - h; pc.set(tx, ty - 1, pick(P.grassWarm, 6)); pc.set(tx, ty - 2, pick(P.grassWarm, 5)); }
  }
  pc.edgeDarken(0.7);
  b.sway = 2;
  return b;
}

export function flowers(v: number): Built {
  const b = grassTuft((v % 3) + 4);
  const { pc } = b, rng = makeRng(600 + v);
  const stem = pick(P.leaf, 2.5);
  const n = v === 3 ? 6 : 7;
  for (let i = 0; i < n; i++) {
    const x = 8 + Math.floor(rng() * 24), h = 11 + Math.floor(rng() * 12), top = 33 - h;
    line(pc, x, 33, x, top, stem);
    if (v === 0) { // pink cosmos
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) pc.set(x + dx, top + dy, [236, 96, 150]);
      pc.set(x, top, [255, 214, 120]);
    } else if (v === 1) { // buttercups
      pc.set(x, top, [255, 222, 70]); pc.set(x + 1, top, [246, 190, 40]); pc.set(x, top - 1, [255, 244, 160]);
    } else if (v === 2) { // daisies
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1]]) pc.set(x + dx, top + dy, [248, 248, 240]);
      pc.set(x, top, [250, 200, 60]);
    } else if (v === 3) { // lavender spikes
      for (let k = 0; k < 6; k++) pc.set(x + (k % 2), top + k, k < 2 ? [190, 160, 240] : [140, 104, 210]);
    } else { // poppies
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [-1, -1], [0, 0]]) pc.set(x + dx, top + dy, [222, 52, 40]);
      pc.set(x + 1, top - 1, [255, 110, 80]); pc.set(x, top, [40, 20, 24]);
    }
  }
  return b;
}

export function mushroom(glow = false): Built {
  const b = newBuilt(32, 26, 16, 21), { pc } = b;
  shadowEllipse(b.shadow!, 19, 22, 10, 3, 70);
  const capCols: RGB[] = glow ? P.glowTeal.slice(1) : [[96, 22, 34], [160, 36, 48], [214, 64, 66], [240, 120, 110]];
  const cap = (cx: number, cy: number, r: number) => {
    rect(pc, cx - 1, cy, 3, Math.round(r + 2), (x) => pick(P.white, x < cx ? 1.2 : 0));
    blob(pc, cx, cy, r, r * 0.62, capCols, { style: 'smooth' });
    if (!glow) { pc.set(cx - 1, cy - 1, [250, 245, 235]); pc.set(cx + 2, cy, [250, 245, 235]); }
  };
  cap(10, 11, 5); cap(19, 14, 4); cap(14, 17, 3); cap(23, 18, 2.5);
  pc.edgeDarken(0.65);
  if (glow) b.fx = { glows: [{ x: 0, y: -6, color: 0xe8f0a0, radius: 14, flicker: 0.25, alpha: 0.35 }] };
  return b;
}

export function stump(): Built {
  const b = newBuilt(48, 38, 24, 30), { pc } = b;
  shadowEllipse(b.shadow!, 30, 31, 15, 5, SHADOW_ALPHA);
  roots(pc, 24, 30, 4, 10, 3, 9);
  drawCylinder(pc, 24, 30, 11, 11, (nx, _t, cap, x, y, cy) => {
    if (cap) {
      const r = Math.hypot(nx, cy);
      if (r > 0.55 && r < 1 && vnoise(x * 0.3, y * 0.3, 5) > 0.55) return pick(P.moss, 2 + nx);
      return pick(P.wood, 3.2 + Math.sin(r * 14) * 0.8);
    }
    return pick(P.bark, 2.5 - nx * 1.6 + (vnoise(x * 1.2, y * 0.2, 6) - 0.5) * 1.6);
  });
  pc.edgeDarken(0.6);
  return b;
}

/** Fallen log lying along the +x tile axis, built from shaded cross-sections. */
export function log(): Built {
  const b = newBuilt(64, 40, 32, 28), { pc } = b;
  shadowEllipse(b.shadow!, 38, 30, 26, 7, 75);
  const R = 6.5, x0 = 14, y0 = 19, len = 38;
  for (let s = 0; s <= len; s++) {
    const cx = x0 + s * 0.89, cy = y0 + s * 0.45;
    for (let dy = -R; dy <= R; dy++) {
      const x = Math.round(cx), y = Math.round(cy + dy);
      const n = dy / R;
      let col = pick(P.bark, 3.2 - (n + 1) * 1.4 + (vnoise(s * 0.4, dy * 0.8, 3) - 0.5) * 1.4);
      if (n < -0.3 && vnoise(s * 0.25, dy * 0.4, 4) > 0.5) col = pick(P.moss, 3 + (-n) * 1.5);
      pc.set(x, y, col); pc.set(x + 1, y, col);
    }
  }
  // end grain
  const ex = x0 + len * 0.89 + 1, ey = y0 + len * 0.45;
  for (let dy = -R; dy <= R; dy++) for (let dx = -3; dx <= 3; dx++) {
    const r = Math.hypot(dx / 3.5, dy / R);
    if (r > 1) continue;
    pc.set(ex + dx, ey + dy, pick(P.wood, 3.8 + Math.sin(r * 9) * 0.8 - r));
  }
  pc.edgeDarken(0.6);
  return b;
}

/** Fallen branches and twigs. */
export function sticks(v: number): Built {
  const b = newBuilt(44, 24, 22, 18), { pc } = b, rng = makeRng(650 + v);
  for (let i = 0; i < 4; i++) {
    const x = 8 + rng() * 26, y = 10 + rng() * 8, dx = (rng() - 0.5) * 22, dy = (rng() - 0.5) * 6;
    limb(pc, x, y, x + dx, y + dy, 2.2, 1.2);
    limb(pc, x + dx * 0.5, y + dy * 0.5, x + dx * 0.5 + 4, y + dy * 0.5 - 3, 1.4, 1);
  }
  for (let i = 0; i < 6; i++) pc.set(6 + rng() * 32, 8 + rng() * 12, pick(P.maple, 2 + rng() * 3));
  pc.edgeDarken(0.7);
  return b;
}

export function pebbles(v: number): Built {
  const b = newBuilt(30, 20, 15, 14), { pc } = b, rng = makeRng(700 + v);
  shadowEllipse(b.shadow!, 18, 15, 10, 3, 60);
  for (let i = 0; i < 3 + v * 2; i++) blob(pc, 6 + rng() * 18, 8 + rng() * 5, 2.5 + rng() * 2.5, 2 + rng() * 1.5, P.stone.map((c) => tint(c, 0.85)), { style: 'rock', seed: i + v * 4, ragged: 0.15 });
  pc.edgeDarken(0.6);
  return b;
}

export function reeds(v: number): Built {
  const b = newBuilt(36, 56, 18, 50), { pc } = b, rng = makeRng(800 + v);
  shadowEllipse(b.shadow!, 22, 50, 11, 3, 50);
  for (let i = 0; i < 11; i++) {
    const bx = 18 + (i / 10 - 0.5) * 18 + (rng() - 0.5) * 3, h = 20 + rng() * 22, lean = (rng() - 0.5) * 8;
    for (let s = 0; s <= h; s++) {
      const t = s / h;
      pc.set(bx + lean * t * t, 50 - s, pick(P.leaf, 2 + t * 3 + (lean < 0 ? 0.6 : 0)));
    }
    if (i % 3 === 1) {
      const hx = Math.round(bx + lean * 0.72), hy = Math.round(50 - h * 0.85);
      rect(pc, hx - 1, hy - 3, 3, 7, (x) => pick(P.bark, x < hx ? 3.5 : 1.5));
    }
  }
  pc.edgeDarken(0.7);
  b.sway = 2;
  return b;
}

/** Shared boulder shape; `paint` decorates it (moss, ore). */
function boulder(seed: number, scale: number, colors: readonly RGB[], paint?: (x: number, y: number, lit: number, dx: number, dy: number) => RGB | null): Built {
  const b = newBuilt(68, 58, 34, 48), { pc } = b;
  shadowEllipse(b.shadow!, 34 + 13 * scale, 48, 25 * scale, 8 * scale, SHADOW_ALPHA);
  const parts: [number, number, number, number][] = [[-14, -3, 11, 9], [15, -2, 10, 8], [0, -13, 20, 15], [-4, -4, 17, 9]];
  parts.forEach(([dx, dy, rx, ry], i) => blob(pc, 34 + dx * scale, 48 + dy * scale, rx * scale, ry * scale, colors, { style: 'rock', seed: seed + i, ragged: 0.22, paint }));
  // cracks
  const rng = makeRng(seed);
  for (let i = 0; i < 3; i++) {
    let x = 24 + rng() * 20, y = 30 + rng() * 10;
    for (let k = 0; k < 8; k++) { if (pc.alpha(x, y)) pc.set(x, y, colors[0]); x += rng() > 0.5 ? 1 : 0; y += 1; }
  }
  pc.edgeDarken(0.55);
  return b;
}

const ROCK = P.stone.slice(0, 6).map((c) => mix(tint(c, 0.86), [70, 80, 70], 0.12));
const mossTop = (x: number, y: number, _l: number, _dx: number, dy: number): RGB | null =>
  dy < -0.05 && vnoise(x * 0.18, y * 0.22, 4) > 0.42 ? pick(P.moss, 2.2 + vnoise(x, y, 5) * 2.6) : null;

export function stoneBoulder(v: number): Built {
  return boulder(900 + v * 5, [1, 0.8, 1.05][v], ROCK, v !== 1 ? mossTop : undefined);
}

export function oreNode(kind: 'iron' | 'copper', v: number): Built {
  const ore = kind === 'iron' ? P.ironOre : P.copperOre, seed = (kind === 'iron' ? 950 : 990) + v * 9;
  const b = boulder(seed, v ? 0.9 : 1.05, ROCK.map((c) => tint(c, 0.85)), (x, y, lit) => {
    const vein = vnoise(x * 0.22 + (x + y) * 0.05, y * 0.3, seed);
    if (vein > 0.6 && hash2(x >> 1, y >> 1, seed) < 0.75) return pick(ore, lit * 4 + (vein - 0.6) * 6);
    return null;
  });
  // protruding crystalline chunks so the deposit reads at a glance
  const rng = makeRng(seed);
  for (let i = 0; i < 5; i++) {
    const cx = 20 + rng() * 28, cy = 32 + rng() * 12;
    const hgt = 6 + rng() * 7, w = 3 + rng() * 2;
    fillPoly(b.pc, [[cx - w, cy], [cx - w * 0.5, cy - hgt], [cx + w * 0.4, cy - hgt * 0.8], [cx + w, cy]], (x, y) => pick(ore, 1.4 + (x < cx ? 1.8 : 0) + ((cy - y) / hgt) * 1.2));
    b.pc.set(cx - w * 0.3, cy - hgt + 1, ore[ore.length - 1]);
  }
  b.pc.edgeDarken(0.55);
  b.fx = { glint: { x: 0, y: -16, rx: 18, ry: 11, color: kind === 'iron' ? 0xffc890 : 0xc4ffe0 } };
  return b;
}

export function scrapPile(v: number): Built {
  const b = newBuilt(60, 46, 30, 38), { pc } = b, rng = makeRng(1100 + v);
  shadowEllipse(b.shadow!, 30 + 9, 39, 22, 7, SHADOW_ALPHA);
  const plate = (cx: number, cy: number, w: number, h: number, tilt: number, colors: readonly RGB[]) => {
    const pts: [number, number][] = [[cx - w, cy - h + tilt], [cx + w, cy - h - tilt], [cx + w, cy + h - tilt], [cx - w, cy + h + tilt]];
    fillPoly(pc, pts, (x, y) => pick(colors, 2.4 - ((x - cx) / w) * 0.9 + (y < cy ? 0.7 : 0) + (hash2(x, y, 5) > 0.93 ? -1 : 0)));
  };
  for (let i = 0; i < 6; i++) plate(14 + rng() * 32, 28 + rng() * 6 - i * 1.6, 6 + rng() * 6, 2 + rng() * 3, (rng() - 0.5) * 6, i % 2 ? P.rust : P.steel);
  for (let i = 0; i < 3; i++) {
    const x = 12 + rng() * 32, y = 22 + rng() * 10, dx = (rng() - 0.3) * 18, dy = -8 - rng() * 8;
    limb(pc, x, y, x + dx, y + dy, 2.5, 2, P.steel);
  }
  // weeds through the pile
  for (let i = 0; i < 5; i++) { const x = 10 + rng() * 40; line(pc, x, 36, x + (rng() - 0.5) * 4, 26 - rng() * 8, pick(P.grass, 3 + rng() * 2)); }
  pc.edgeDarken(0.55);
  b.fx = { glint: { x: 0, y: -10, rx: 14, ry: 8, color: 0xffffff } };
  return b;
}
