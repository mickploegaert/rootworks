import { hash2, makeRng, vnoise } from '../../core/noise.ts';
import { P } from '../palette.ts';
import { PixelCanvas, blob, fillPoly, line, mix, pick, rect, shadowEllipse, shadowSweep, type RGB } from '../pixel/PixelCanvas.ts';
import { drawBox, drawCylinder, drawGable, footprint, isoCanvas, isoPt, type BoxSpec, type Face, type RoofFace } from '../pixel/iso3d.ts';
import type { Built, Glow } from './types.ts';

/** Lighting bias per face: light comes from the upper left. */
const BIAS = { top: 3.3, L: 2.4, R: 1.2 } as const;
const WARM = 0xffc070;

function start(w: number, d: number, h: number, pad = 8, extraTop = 0): Built {
  const { pc, ox, oy } = isoCanvas(w, d, h, pad, extraTop);
  return { pc, ox, oy, shadow: new PixelCanvas(pc.w, pc.h) };
}

/** Screen offset of a point on a building, for attaching glows and smoke. */
const at = (ox: number, oy: number, a: number, b: number, z: number) => {
  const [x, y] = isoPt(ox, oy, a, b, z);
  return { x: x - ox, y: y - oy };
};

/** Ivy climbing up from the ground in a few columns. */
function climber(f: Face, seed: number, cover = 0.3, maxLen = 20): RGB | null {
  const col = Math.floor(f.s / 3);
  if (hash2(col, seed, 4) > cover) return null;
  if (f.t > 4 + hash2(col, seed, 5) * maxLen) return null;
  const k = hash2(f.x, f.y, seed + 1);
  if (k < 0.15) return null;
  return pick(P.leaf, 1.6 + (f.kind === 'L' ? 1.2 : 0) + k * 2.6);
}

// 3x5 pixel font for signs
const GLYPHS: Record<string, string[]> = {
  W: ['101', '101', '101', '111', '101'], O: ['010', '101', '101', '101', '010'], R: ['110', '101', '110', '101', '101'],
  K: ['101', '101', '110', '101', '101'], S: ['011', '100', '010', '001', '110'], H: ['101', '101', '111', '101', '101'],
  P: ['110', '101', '110', '100', '100'], T: ['111', '010', '010', '010', '010'], E: ['111', '100', '110', '100', '111'],
};
function textAt(text: string, s0: number, t0: number, s: number, t: number): boolean {
  const cs = Math.floor(s - s0), row = Math.floor(t0 - t);
  if (cs < 0 || row < 0 || row > 4) return false;
  const g = GLYPHS[text[Math.floor(cs / 4)] ?? ''];
  return !!g && cs % 4 < 3 && g[row][cs % 4] === '1';
}

/** A lit, cross-mullioned window with a sill. (fx, fy) are px inside the window, (w, h) its size. */
function windowPane(fx: number, fy: number, w: number, h: number, lit: boolean, face: Face['kind']): RGB {
  if (fx < 1 || fx >= w - 1 || fy < 1 || fy >= h - 1) return pick(P.wood, face === 'L' ? 1.6 : 0.9); // frame
  if (Math.abs(fx - w / 2) < 0.6 || Math.abs(fy - h / 2) < 0.6) return pick(P.wood, face === 'L' ? 2.2 : 1.4); // mullions
  if (lit) return pick(P.amber, 3 + (fy / h) * 1.6 - (fx + fy) % 7 * 0.05);
  return pick(P.glass, 1.6 + ((fx + fy) % 9 < 2 ? 1.5 : 0) + (face === 'L' ? 0.5 : 0));
}

/** Terracotta tiles in staggered courses, with moss creeping up from the eaves. */
function tiles(f: RoofFace, ramp: readonly RGB[], seed: number): RGB {
  const course = Math.floor(f.up * 9);
  const off = (course % 2) * 3;
  const lit = f.kind === 'back' ? 3.2 : 2;
  let idx = lit + (hash2(Math.floor((f.s + off) / 6), course, seed) - 0.5) * 0.8;
  if ((f.up * 9) % 1 < 0.22) idx -= 1.3; // course shadow line
  if ((f.s + off) % 6 < 0.8) idx -= 0.6;
  if (f.up > 0.94) return pick(ramp, idx + 1); // ridge cap
  if (f.up < 0.35 && vnoise(f.x * 0.25, f.y * 0.25, seed) > 0.62) return pick(P.moss, 2.2 + hash2(f.x, f.y, 1) * 2);
  return pick(ramp, idx);
}

// ---------------------------------------------------------------- the workshop (4x3)

/** The robot workshop: brick base, cream timber-framed walls, terracotta gable roof, warm windows. */
export function lab(): Built {
  const H = 34, b = start(4, 3, H + 56, 12, 8), { pc, ox, oy } = b;
  shadowSweep(b.shadow!, footprint(ox, oy, -0.6, -0.6, 3.6, 2.6), H + 20, 80);
  const doorS0 = 52, doorS1 = 76; // on the long (left) face
  const glows: Glow[] = [];
  const lit = (face: string, i: number) => hash2(i, face === 'L' ? 1 : 2, 9) < 0.7;

  drawBox(pc, ox, oy, { a0: -0.5, b0: -0.5, a1: 3.5, b1: 2.5, z1: H }, (f) => {
    if (f.kind === 'top') return null;
    const { s, t } = f;
    // door
    if (f.kind === 'L' && s >= doorS0 && s <= doorS1 && t < 24) {
      if (s < doorS0 + 2 || s > doorS1 - 2 || t > 22) return pick(P.wood, 1.2);
      if (Math.abs(s - (doorS0 + doorS1) / 2) < 0.8) return pick(P.wood, 0.8);
      if (t > 10 && t < 12) return pick(P.copper, 4); // hinge band
      return pick(P.wood, 2.4 + ((s - doorS0) % 4 < 1 ? -0.7 : 0) + (vnoise(f.x * 0.5, f.y * 0.1, 3) - 0.5));
    }
    // brick base
    if (t < 11) {
      if (t >= 10) return pick(P.cream, BIAS[f.kind] + 0.6); // stone sill course
      const c = climber(f, f.kind === 'L' ? 3 : 4, 0.22, 14);
      if (c) return c;
      const row = Math.floor(t / 3), off = (row % 2) * 3;
      if (t % 3 < 1 || (s + off) % 7 < 1) return pick(P.cream, 1 + BIAS[f.kind] * 0.4);
      return pick(P.brick, BIAS[f.kind] - 0.2 + hash2(Math.floor((s + off) / 7), row, 5) * 1.4);
    }
    // timber frame: posts every 32px, rail under the eaves, braces at the corners
    const post = s % 32 < 2.5 || s > f.sw - 2.5;
    if (post || t > H - 3 || (t > 19 && t < 21)) return pick(P.wood, BIAS[f.kind] - 0.6 + (t > H - 3 ? 0.4 : 0));
    // windows: one per bay, lit warm
    const bay = Math.floor(s / 32), wx = s % 32 - 9, wy = t - 13;
    const isDoorBay = f.kind === 'L' && s > doorS0 - 6 && s < doorS1 + 6;
    if (!isDoorBay && wx >= 0 && wx < 14 && wy >= 0 && wy < 17) return windowPane(wx, wy, 14, 17, lit(f.kind, bay), f.kind);
    if (!isDoorBay && wx >= -1 && wx < 15 && wy >= -3 && wy < 0) { // flower box
      if (wy === -1 && hash2(f.x, 0, 7) > 0.4) return pick(P.flowers, 1 + hash2(f.x, 1, 8) * 4);
      if (wy === -1) return pick(P.leaf, 3.5);
      return pick(P.wood, BIAS[f.kind] - 0.4);
    }
    if (isDoorBay && t > 26 && t < 32 && s > doorS0 - 4 && s < doorS1 + 4) { // sign board
      if (textAt('WORKSHOP', doorS0 - 2, 30.5, s, t)) return pick(P.cream, 5);
      return pick(P.wood, 1.3 + (t < 27 || t > 31 ? -0.6 : 0));
    }
    // cream plaster with gentle weathering
    return pick(P.cream, BIAS[f.kind] + 0.3 + (vnoise(f.x * 0.12, f.y * 0.25, 6) - 0.5) * 0.8 - (t < 14 ? 0.4 : 0));
  });

  // the gable roof, ridge along the long axis
  drawGable(pc, ox, oy, { a0: -0.5, b0: -0.5, a1: 3.5, b1: 2.5, z1: H, ridge: 30, axis: 'u', overhang: 0.16 }, (f) => {
    if (f.kind === 'gable') {
      if (f.s < 2 || f.s > 94 || f.up < 1.5) return pick(P.wood, 0.9);
      const wx = f.s - 41, wy = f.up - 8; // round attic window
      if (Math.hypot(wx, wy * 1.2) < 6) return Math.hypot(wx, wy * 1.2) < 4.6 ? windowPane(wx + 5, wy + 5, 10, 10, true, 'R') : pick(P.wood, 1);
      return f.s % 6 < 1 ? pick(P.wood, 1) : pick(P.wood, 2 + (vnoise(f.x * 0.3, f.y * 0.1, 2) - 0.5)); // vertical boards
    }
    return tiles(f, P.roof, 11);
  });

  // chimney through the roof, a dormer-free ridge vent, and a little roof garden
  const chimney: BoxSpec = { a0: 2.55, b0: 0.25, a1: 2.95, b1: 0.65, z0: H + 14, z1: H + 44 };
  drawBox(pc, ox, oy, chimney, (f) => {
    if (f.kind === 'top') return pick(P.slate, 0.5);
    if (f.t > f.th - 3) return pick(P.cream, BIAS[f.kind] + 0.5);
    const row = Math.floor(f.t / 3), off = (row % 2) * 3;
    if (f.t % 3 < 1 || (f.s + off) % 6 < 1) return pick(P.cream, 1.2);
    return pick(P.brick, BIAS[f.kind] - 0.2 + hash2(Math.floor((f.s + off) / 6), row, 3) * 1.3);
  });
  const lantern = isoPt(ox, oy, (doorS0 + doorS1) / 64 - 0.5, 2.62, 25);
  rect(pc, lantern[0] - 2, lantern[1] - 3, 4, 5, (x) => pick(P.amber, x < lantern[0] ? 5 : 4));
  rect(pc, lantern[0] - 2, lantern[1] - 4, 4, 1, () => pick(P.steel, 1));
  pc.edgeDarken(0.62);

  for (const face of ['L', 'R'] as const) {
    const len = face === 'L' ? 128 : 96;
    for (let i = 0; i * 32 < len; i++) {
      const s = i * 32 + 16;
      if (!lit(face, i) || (face === 'L' && s > doorS0 - 6 && s < doorS1 + 6)) continue;
      glows.push({ ...(face === 'L' ? at(ox, oy, -0.5 + s / 32, 2.5, 21) : at(ox, oy, 3.5, -0.5 + s / 32, 21)), color: WARM, radius: 16, flicker: 0.05, alpha: 0.45 });
    }
  }
  glows.push({ x: lantern[0] - ox, y: lantern[1] - oy + 6, color: WARM, radius: 32, flicker: 0.12, alpha: 0.6 });
  const top = at(ox, oy, 2.75, 0.45, H + 46);
  b.fx = { glows, smoke: { x: top.x, y: top.y, rate: 1.4 } };
  return b;
}

// ---------------------------------------------------------------- small factory (2x2) with a tall chimney

export function factory(): Built {
  const H = 30, b = start(2, 2, H + 86, 10, 8), { pc, ox, oy } = b;
  shadowSweep(b.shadow!, footprint(ox, oy, -0.6, -0.6, 1.6, 1.6), H + 24, 80);
  // chimney behind the roof first, so the roof overlaps its base
  const stack: BoxSpec = { a0: -0.35, b0: -0.3, a1: 0.05, b1: 0.1, z1: H + 80 };
  drawBox(pc, ox, oy, stack, (f) => {
    if (f.kind === 'top') return pick(P.slate, 0.3);
    if (f.t > f.th - 6) return pick(P.copper, BIAS[f.kind] + 1 - (f.t > f.th - 2 ? 0.8 : 0));
    if (f.t % 22 < 2) return pick(P.cream, BIAS[f.kind] + 0.4);
    const row = Math.floor(f.t / 3), off = (row % 2) * 3;
    if (f.t % 3 < 1 || (f.s + off) % 6 < 1) return pick(P.cream, 1);
    return pick(P.brick, BIAS[f.kind] - 0.1 + hash2(Math.floor((f.s + off) / 6), row, 6) * 1.3 - (f.t > f.th - 16 ? 0.6 : 0));
  });
  drawBox(pc, ox, oy, { a0: -0.5, b0: -0.5, a1: 1.5, b1: 1.5, z1: H }, (f) => {
    if (f.kind === 'top') return null;
    // tall arched windows with many panes
    const wx = f.s % 21 - 5, wy = f.t - 8;
    const arch = wy > 13 ? Math.hypot(wx - 5.5, wy - 13) <= 5.5 : true;
    if (wx >= 0 && wx < 11 && wy >= 0 && wy < 19 && arch) {
      if (wx % 4 < 1 || wy % 5 < 1) return pick(P.steel, BIAS[f.kind] - 0.6);
      return pick(P.amber, 2.6 + wy * 0.08);
    }
    if (f.kind === 'R' && f.s > 22 && f.s < 40 && f.t < 20) { // roller door
      if (f.t > 18) return pick(P.steel, 1);
      return pick(P.steel, 2 + (f.t % 3 < 1 ? -0.8 : 0.4));
    }
    const c = climber(f, 21, 0.28, 18);
    if (c) return c;
    if (f.t > H - 3) return pick(P.cream, BIAS[f.kind] + 0.6);
    const row = Math.floor(f.t / 3), off = (row % 2) * 3;
    if (f.t % 3 < 1 || (f.s + off) % 7 < 1) return pick(P.cream, 1 + BIAS[f.kind] * 0.4);
    return pick(P.brick, BIAS[f.kind] - 0.2 + hash2(Math.floor((f.s + off) / 7), row, 4) * 1.4);
  });
  // copper roof, weathered to verdigris in streaks
  drawGable(pc, ox, oy, { a0: -0.5, b0: -0.5, a1: 1.5, b1: 1.5, z1: H, ridge: 22, axis: 'v', overhang: 0.12 }, (f) => {
    if (f.kind === 'gable') {
      if (f.up < 1.5 || f.s < 2 || f.s > 62) return pick(P.cream, 1.6);
      const wx = f.s - 26, wy = f.up - 6;
      if (wx >= 0 && wx < 12 && wy >= 0 && wy < 9) return windowPane(wx, wy, 12, 9, true, 'L');
      const row = Math.floor(f.up / 3), off = (row % 2) * 3;
      if (f.up % 3 < 1 || (f.s + off) % 7 < 1) return pick(P.cream, 1.6);
      return pick(P.brick, 2.2 + hash2(Math.floor((f.s + off) / 7), row, 7) * 1.4);
    }
    const seam = f.s % 8 < 1;
    const patina = vnoise(f.s * 0.08, f.up * 3, 4) > 0.55 && !seam;
    const lit = f.kind === 'back' ? 3.4 : 2.2;
    return patina ? pick(P.verdigris, lit - 0.3) : pick(P.copper, lit + (seam ? -1 : 0) - (f.up > 0.95 ? -1 : 0));
  });
  // pressure gauge and pipe on the right wall
  const g = isoPt(ox, oy, 1.5, 0.15, 20);
  blob(pc, g[0] + 1, g[1], 3.5, 3.5, P.cream, { style: 'smooth' });
  line(pc, g[0] + 1, g[1], g[0] + 3, g[1] - 2, pick(P.brick, 1));
  pc.edgeDarken(0.62);
  const top = at(ox, oy, -0.15, -0.1, H + 82);
  b.fx = {
    smoke: { x: top.x, y: top.y, rate: 0.9 },
    glows: [{ ...at(ox, oy, 0.5, 1.5, 16), color: WARM, radius: 26, flicker: 0.06, alpha: 0.4 }, { ...at(ox, oy, 1.5, 0.5, 16), color: WARM, radius: 22, flicker: 0.06, alpha: 0.35 }],
  };
  return b;
}

// ---------------------------------------------------------------- greenhouse (2x2)

export function greenhouse(): Built {
  const H = 24, b = start(2, 2, H + 30, 10, 4), { pc, ox, oy } = b;
  shadowSweep(b.shadow!, footprint(ox, oy, -0.5, -0.5, 1.5, 1.5), H, 50);
  const plants = (f: { x: number; y: number }, low: boolean): RGB | null => {
    const n = vnoise(f.x * 0.35, f.y * 0.35, 5);
    if (!low || n < 0.38) return null;
    const h = hash2(f.x, f.y, 6);
    if (h > 0.93) return [214, 70, 54]; // tomatoes
    if (h > 0.88) return pick(P.flowers, 1);
    return pick(P.leaf, 2 + n * 3);
  };
  drawBox(pc, ox, oy, { a0: -0.5, b0: -0.5, a1: 1.5, b1: 1.5, z1: H }, (f) => {
    if (f.kind === 'top') return null;
    if (f.t < 5) { // brick plinth
      const row = Math.floor(f.t / 3), off = (row % 2) * 3;
      return f.t % 3 < 1 || (f.s + off) % 7 < 1 ? pick(P.cream, 1.4) : pick(P.brick, BIAS[f.kind] + hash2(Math.floor((f.s + off) / 7), row, 3));
    }
    if (f.s % 11 < 1.2 || f.t > H - 2 || f.t < 6 || f.s > f.sw - 1.2) return pick(P.cream, BIAS[f.kind] + 1.4); // white-painted frame
    const green = plants(f, f.t < 16);
    const glass = pick(P.glass, (f.kind === 'L' ? 3.2 : 2.4) + ((f.s + f.t * 2) % 19 < 3 ? 1 : 0));
    return green ? mix(green, glass, 0.3) : mix(glass, pick(P.leaf, 3), 0.25);
  });
  drawGable(pc, ox, oy, { a0: -0.5, b0: -0.5, a1: 1.5, b1: 1.5, z1: H, ridge: 18, axis: 'u', overhang: 0.04 }, (f) => {
    if (f.kind === 'gable') {
      if (f.s % 11 < 1.2 || f.up < 1) return pick(P.cream, 3);
      return mix(pick(P.glass, 2.6), pick(P.leaf, 3), 0.3);
    }
    if (f.s % 11 < 1.2 || f.up > 0.95 || f.up < 0.06) return pick(P.cream, f.kind === 'back' ? 4.6 : 3.4);
    const refl = (f.s * 0.5 + f.up * 40) % 17 < 3 ? 1.4 : 0;
    return mix(pick(P.glass, (f.kind === 'back' ? 3.4 : 2.6) + refl), pick(P.leaf, 3.5), 0.22);
  });
  pc.edgeDarken(0.65);
  return b;
}

// ---------------------------------------------------------------- water tower (1x1)

export function tank(): Built {
  const R = 19, Z = 34, TH = 24, b = start(1, 1, Z + TH + 30, 8, 4), { pc, ox, oy } = b;
  shadowEllipse(b.shadow!, ox + 26, oy + 10, 34, 13, 75);
  // four legs with cross braces
  const legs: [number, number][] = [[-0.32, -0.32], [0.32, -0.32], [-0.32, 0.32], [0.32, 0.32]];
  for (const [a, bb] of legs) drawBox(pc, ox, oy, { a0: a - 0.05, b0: bb - 0.05, a1: a + 0.05, b1: bb + 0.05, z1: Z }, (f) => pick(P.wood, BIAS[f.kind] - 0.3));
  for (const [p, q] of [[[-0.32, 0.32], [0.32, 0.32]], [[0.32, -0.32], [0.32, 0.32]]] as const) {
    const a = isoPt(ox, oy, p[0], p[1], 4), c = isoPt(ox, oy, q[0], q[1], Z - 4);
    const a2 = isoPt(ox, oy, p[0], p[1], Z - 4), c2 = isoPt(ox, oy, q[0], q[1], 4);
    line(pc, a[0], a[1], c[0], c[1], pick(P.wood, 1.6)); line(pc, a2[0], a2[1], c2[0], c2[1], pick(P.wood, 1.6));
  }
  // wooden stave tank with copper hoops
  drawCylinder(pc, ox, oy - Z, R, TH, (nx, t, cap, x) => {
    if (cap) return pick(P.wood, 3.5);
    if (Math.abs(t - 5) < 1.2 || Math.abs(t - 17) < 1.2) return pick(P.copper, 4 - nx * 2);
    const stave = Math.floor((Math.asin(Math.max(-1, Math.min(1, nx))) + 2) * 9);
    return pick(P.wood, 3.4 - nx * 2 + (hash2(stave, 0, 3) - 0.5) * 0.8 + (x % 3 === 0 && Math.abs(nx) > 0.3 ? -0.3 : 0));
  });
  // conical copper roof
  const baseY = oy - Z - TH, coneH = 16;
  for (let k = 0; k <= coneH; k++) {
    const r = (R + 2) * (1 - k / coneH), cy = baseY - k;
    for (let x = Math.floor(ox - r); x <= ox + r; x++) {
      const nx = (x + 0.5 - ox) / Math.max(1, r);
      for (let dy = 0; dy <= Math.max(1, r / 2) * Math.sqrt(Math.max(0, 1 - nx * nx)); dy++) {
        pc.set(x, cy + dy, (k + x) % 5 === 0 && k < coneH - 3 ? pick(P.verdigris, 2.5 - nx) : pick(P.copper, 4 - nx * 2 - (dy > 1 ? 0.4 : 0)));
      }
    }
  }
  pc.set(ox, baseY - coneH - 1, pick(P.copper, 5)); pc.set(ox, baseY - coneH - 2, pick(P.copper, 5));
  // ladder
  for (let y = oy - Z - 2; y < oy - 2; y++) { pc.set(ox + 10, y, pick(P.wood, 1.5)); pc.set(ox + 14, y, pick(P.wood, 1.5)); if (y % 4 === 0) line(pc, ox + 10, y, ox + 14, y, pick(P.wood, 2.5)); }
  pc.edgeDarken(0.62);
  return b;
}

// ---------------------------------------------------------------- windmill (1x1), sails turn via looping frames

export function turbine(): Built {
  const H = 76, FR = 4;
  const make = (frame: number): Built => {
    const b = start(1, 1, H + 60, 36, 4), { pc, ox, oy } = b;
    shadowSweep(b.shadow!, footprint(ox, oy, -0.4, -0.4, 0.4, 0.4), H, 70);
    // tapered plastered tower
    for (let y = oy - H; y <= oy + 11; y++) {
      const f = Math.max(0, (oy - y) / H), hw = 22 - f * 9;
      for (let x = Math.floor(ox - hw); x <= ox + hw; x++) {
        const nx = (x + 0.5 - ox) / hw;
        if (y > oy + (hw / 2) * Math.sqrt(Math.max(0, 1 - nx * nx))) continue; // round base
        let col = pick(P.cream, 3.6 - nx * 1.8 + (vnoise(x * 0.2, y * 0.2, 4) - 0.5) * 0.6);
        if (Math.abs(nx + 0.1) < 0.16 && y > oy - 16 && y < oy + 2) col = pick(P.wood, 1.6 + (y % 4 < 1 ? -0.6 : 0)); // door
        if (Math.abs(nx) < 0.14 && y > oy - 50 && y < oy - 42) col = pick(P.amber, 4); // lit window
        if (f < 0.25 && hash2(x, y, 3) < (0.25 - f) * 2.4 && nx < 0.3) col = pick(P.leaf, 2 + (nx < 0 ? 1.4 : 0));
        pc.set(x, y, col);
      }
    }
    // wooden cap
    for (let k = 0; k < 14; k++) {
      const r = 15 * (1 - k / 16), cy = oy - H - k;
      for (let x = Math.floor(ox - r); x <= ox + r; x++) {
        const nx = (x + 0.5 - ox) / Math.max(1, r);
        for (let dy = 0; dy < 4; dy++) pc.set(x, cy + dy, pick(P.wood, 3.6 - nx * 2 - (k % 3 === 0 ? 0.5 : 0)));
      }
    }
    // four lattice sails around the hub
    const hx = ox - 3, hy = oy - H + 2;
    for (let k = 0; k < 4; k++) {
      const ang = (k / 4) * Math.PI * 2 + (frame / FR) * (Math.PI / 2);
      const ca = Math.cos(ang), sa = Math.sin(ang);
      for (let i = 2; i <= 42; i++) {
        const x = hx + ca * i, y = hy + sa * i * 0.85;
        pc.set(x, y, pick(P.wood, 1.4)); // stock
        if (i > 10) for (let w = 1; w <= 7; w++) {
          const px = x - sa * w, py = y + ca * w * 0.85;
          const frameLine = w === 7 || i % 6 === 0;
          pc.set(px, py, frameLine ? pick(P.wood, 2.2) : pick(P.cream, 4 - w * 0.12));
        }
      }
    }
    blob(pc, hx, hy, 3, 3, P.wood, { style: 'smooth' });
    pc.edgeDarken(0.62);
    return b;
  };
  const b = make(0);
  b.frames = [1, 2, 3].map((f) => make(f).pc);
  b.fps = 5;
  b.fx = { glows: [{ x: 0, y: -46, color: WARM, radius: 14, flicker: 0.1, alpha: 0.5 }] };
  return b;
}

// ---------------------------------------------------------------- boiler (1x1): steam and a warm firebox

export function generator(): Built {
  const b = start(1, 1, 50, 8, 4), { pc, ox, oy } = b;
  shadowEllipse(b.shadow!, ox + 12, oy + 4, 24, 9, 80);
  drawBox(pc, ox, oy, { a0: -0.4, b0: -0.4, a1: 0.4, b1: 0.4, z1: 8 }, (f) => {
    if (f.kind === 'top') return pick(P.cream, 3);
    if (f.kind === 'L' && Math.abs(f.s - f.sw / 2) < 5 && f.t > 1 && f.t < 7) return pick(P.amber, 3.5 + f.t * 0.2); // firebox
    const row = Math.floor(f.t / 3), off = (row % 2) * 3;
    return f.t % 3 < 1 || (f.s + off) % 7 < 1 ? pick(P.cream, 1.2) : pick(P.brick, BIAS[f.kind] + hash2(Math.floor((f.s + off) / 7), row, 2));
  });
  drawCylinder(pc, ox, oy - 8, 15, 26, (nx, t, cap, x, y, ny) => {
    if (cap) return Math.hypot(nx, ny) < 0.3 ? pick(P.copper, 5) : pick(P.copper, 4.2 - nx);
    if (t % 9 < 1.2) return pick(P.copper, 2.4 - nx * 2);
    if (t % 9 > 7 && (x + y) % 4 === 0) return pick(P.copper, 5); // rivets
    return pick(P.copper, 4 - nx * 2.4);
  });
  // pressure gauge, valve wheel and exhaust pipe
  blob(pc, ox - 6, oy - 22, 3.5, 3.5, P.cream, { style: 'smooth' });
  line(pc, ox - 6, oy - 22, ox - 4, oy - 24, pick(P.brick, 1));
  for (let a = 0; a < 12; a++) pc.set(ox + 7 + Math.cos(a / 2) * 3, oy - 18 + Math.sin(a / 2) * 3, [196, 64, 48]);
  drawCylinder(pc, ox + 5, oy - 34, 2.5, 12, (nx, _t, cap) => pick(P.copper, cap ? 1 : 3.4 - nx * 2));
  pc.edgeDarken(0.62);
  b.fx = {
    smoke: { x: 5, y: -48, rate: 0.55 },
    glows: [{ ...at(ox, oy, 0, 0.4, 4), color: 0xff9a40, radius: 18, flicker: 0.35, alpha: 0.6 }],
  };
  return b;
}

// ---------------------------------------------------------------- storage depot: a little barn (2x1)

export function depot(): Built {
  const H = 22, b = start(2, 1, H + 30, 10, 4), { pc, ox, oy } = b;
  shadowSweep(b.shadow!, footprint(ox, oy, -0.55, -0.5, 1.55, 0.5), H + 10, 80);
  drawBox(pc, ox, oy, { a0: -0.45, b0: -0.4, a1: 1.45, b1: 0.4, z1: H }, (f) => {
    if (f.kind === 'top') return null;
    if (f.s < 2 || f.s > f.sw - 2 || f.t > H - 2) return pick(P.cream, BIAS[f.kind] + 1); // painted trim
    if (f.kind === 'L' && f.s > 18 && f.s < 44 && f.t < 18) { // big doors with X braces
      const u = (f.s - 18) % 13, v = f.t;
      if (u < 1 || f.t > 16 || f.t < 1) return pick(P.cream, 3.2);
      if (Math.abs(u - v * 0.7) < 1 || Math.abs(12 - u - v * 0.7) < 1) return pick(P.cream, 3.2);
      return pick(P.brick, 2.4 + (f.s % 3 < 1 ? -0.6 : 0));
    }
    const c = climber(f, 41, 0.25, 12);
    if (c) return c;
    // vertical barn boards
    return pick(P.brick, BIAS[f.kind] + 0.1 + (f.s % 3 < 1 ? -0.7 : 0) + (vnoise(f.x * 0.6, f.y * 0.08, 3) - 0.5) * 0.7);
  });
  drawGable(pc, ox, oy, { a0: -0.45, b0: -0.4, a1: 1.45, b1: 0.4, z1: H, ridge: 14, axis: 'u', overhang: 0.12 }, (f) => {
    if (f.kind === 'gable') {
      if (f.up > 2 && f.up < 8 && Math.abs(f.s - 13) < 4) return pick(P.amber, 3.6); // hay loft window
      return f.s % 3 < 1 ? pick(P.brick, 1.4) : pick(P.brick, 2.2);
    }
    return tiles(f, P.slate, 21);
  });
  // a few crates and a sack beside the door
  const c = isoPt(ox, oy, 1.2, 0.6);
  drawBox(pc, c[0], c[1], { a0: -0.15, b0: -0.12, a1: 0.15, b1: 0.12, z1: 10 }, (f) => pick(P.wood, BIAS[f.kind] + 0.3 + (f.kind !== 'top' && f.t % 4 < 1 ? -0.8 : 0)));
  blob(pc, c[0] - 16, c[1] + 2, 5, 4, P.cream, { style: 'smooth' });
  pc.edgeDarken(0.62);
  b.fx = { glows: [{ ...at(ox, oy, 0.5, 0.45, 20), color: WARM, radius: 24, flicker: 0.12, alpha: 0.5 }] };
  return b;
}

// ---------------------------------------------------------------- yard furniture

export function lamp(): Built {
  const b = start(1, 1, 50, 14, 6), { pc, ox, oy } = b;
  shadowSweep(b.shadow!, footprint(ox, oy, -0.05, -0.05, 0.05, 0.05), 42, 70);
  rect(pc, ox - 1, oy - 40, 2, 40, (x) => pick(P.steel, x < ox ? 2.6 : 1));
  rect(pc, ox - 3, oy - 3, 6, 3, (x) => pick(P.steel, x < ox ? 2 : 0.8));
  // lantern: copper hood, warm glass
  fillPoly(pc, [[ox - 5, oy - 47], [ox + 5, oy - 47], [ox + 3, oy - 51], [ox - 3, oy - 51]], (x) => pick(P.copper, x < ox ? 4 : 2.6));
  rect(pc, ox - 4, oy - 46, 8, 6, (x, y) => (x === ox - 4 || x === ox + 3 ? pick(P.steel, 1) : pick(P.amber, y < oy - 43 ? 5 : 4)));
  rect(pc, ox - 3, oy - 40, 6, 1, () => pick(P.steel, 1));
  pc.edgeDarken(0.6);
  b.fx = { glows: [{ x: 0, y: -40, color: WARM, radius: 44, flicker: 0.1, alpha: 0.6 }] };
  return b;
}

/** Wooden picket fence along +x. */
export function fenceU(): Built {
  const b = start(1, 1, 20, 8), { pc, ox, oy } = b;
  shadowSweep(b.shadow!, footprint(ox, oy, -0.5, -0.04, 0.5, 0.04), 12, 50);
  drawBox(pc, ox, oy, { a0: -0.5, b0: -0.03, a1: 0.5, b1: 0.03, z1: 16 }, (f) => {
    if (f.kind === 'top') return null;
    const p = f.s % 6;
    const rail = (f.t > 3 && f.t < 5) || (f.t > 10 && f.t < 12);
    const picket = p < 3.5 && f.t < 15 - Math.abs(p - 1.75) * 1.4;
    if (!rail && !picket) return null;
    if (f.t < 4 && hash2(Math.floor(f.s / 2), 0, 9) < 0.35) return pick(P.leaf, 3 + hash2(f.x, f.y, 2) * 2);
    return pick(P.cream, (f.kind === 'L' ? 3.6 : 2.4) + (rail ? -0.8 : 0) + (p < 1 ? 0.5 : 0) - (f.t < 3 ? 0.6 : 0));
  });
  pc.edgeDarken(0.7);
  return b;
}

/** Low dry-stone garden wall along an axis. */
export function stoneWall(axis: 'u' | 'v'): Built {
  const b = start(1, 1, 20, 8), { pc, ox, oy } = b;
  const box = axis === 'u' ? { a0: -0.5, b0: -0.13, a1: 0.5, b1: 0.13 } : { a0: -0.13, b0: -0.5, a1: 0.13, b1: 0.5 };
  shadowSweep(b.shadow!, footprint(ox, oy, box.a0, box.b0, box.a1, box.b1), 12, 70);
  drawBox(pc, ox, oy, { ...box, z1: 12 }, (f) => {
    if (f.kind === 'top') return vnoise(f.x * 0.3, f.y * 0.3, 2) > 0.45 ? pick(P.moss, 3 + hash2(f.x, f.y, 1) * 2) : pick(P.stone, 4.4);
    const row = Math.floor(f.t / 4), off = hash2(row, 0, 3) * 7;
    const cell = Math.floor((f.s + off) / 7);
    if (f.t % 4 < 1 || (f.s + off) % 7 < 1) return pick(P.stone, 0.8);
    if (hash2(cell, row, 5) > 0.82) return pick(P.moss, 2.4 + (f.kind === 'L' ? 1 : 0));
    return pick(P.stone, BIAS[f.kind] + 0.4 + (hash2(cell, row, 4) - 0.5) * 1.4);
  });
  pc.edgeDarken(0.6);
  return b;
}

/** Raised vegetable bed: 0 cabbages, 1 carrots, 2 sunflowers. */
export function planter(v: number): Built {
  const b = start(1, 1, v === 2 ? 50 : 22, 8, 4), { pc, ox, oy } = b, rng = makeRng(1500 + v);
  shadowSweep(b.shadow!, footprint(ox, oy, -0.42, -0.42, 0.42, 0.42), 8, 70);
  drawBox(pc, ox, oy, { a0: -0.42, b0: -0.42, a1: 0.42, b1: 0.42, z1: 8 }, (f) => {
    if (f.kind === 'top') return f.s < 2 || f.t < 2 || f.s > f.sw - 2 || f.t > f.th - 2 ? pick(P.wood, 4) : pick(P.dirt, 1.4 + hash2(f.x, f.y, 2) * 1.4);
    return pick(P.wood, BIAS[f.kind] + (f.t % 4 < 1 ? -0.7 : 0.2));
  });
  for (let i = 0; i < 6; i++) {
    const a = -0.25 + (i % 3) * 0.25, bb = -0.15 + Math.floor(i / 3) * 0.3;
    const [x, y] = isoPt(ox, oy, a, bb, 8);
    if (v === 0) blob(pc, x, y - 2, 4, 3, P.grassCool, { style: 'leaf', seed: i, ragged: 0.3, bias: 0.1 });
    else if (v === 1) { for (let k = 0; k < 4; k++) line(pc, x, y, x - 2 + k, y - 4 - rng() * 2, pick(P.leaf, 3 + k * 0.4)); pc.set(x, y, pick(P.maple, 4)); }
    else if (i % 2 === 0) {
      line(pc, x, y, x, y - 30 - rng() * 8, pick(P.leaf, 2.5));
      const hy = y - 32 - rng() * 6;
      blob(pc, x, hy, 4, 4, P.amber.slice(2), { style: 'smooth' });
      pc.set(x, hy, pick(P.bark, 1)); pc.set(x + 1, hy, pick(P.bark, 1));
    }
  }
  pc.edgeDarken(0.65);
  if (v === 2) b.sway = 1;
  return b;
}

export function bench(): Built {
  const b = start(1, 1, 18, 8), { pc, ox, oy } = b;
  shadowSweep(b.shadow!, footprint(ox, oy, -0.35, -0.12, 0.35, 0.12), 8, 70);
  for (const a of [-0.3, 0.3]) drawBox(pc, ox, oy, { a0: a - 0.03, b0: -0.12, a1: a + 0.03, b1: 0.12, z1: 7 }, (f) => pick(P.steel, BIAS[f.kind] - 0.4));
  drawBox(pc, ox, oy, { a0: -0.36, b0: -0.12, a1: 0.36, b1: 0.12, z0: 7, z1: 9 }, (f) => pick(P.wood, BIAS[f.kind] + 0.6 + (f.kind === 'top' && f.t % 5 < 1 ? -0.8 : 0)));
  drawBox(pc, ox, oy, { a0: -0.36, b0: -0.13, a1: 0.36, b1: -0.09, z0: 9, z1: 17 }, (f) => pick(P.wood, BIAS[f.kind] + 0.4 + (f.kind !== 'top' && f.t % 4 < 1 ? -0.8 : 0)));
  pc.edgeDarken(0.62);
  return b;
}

export function signpost(): Built {
  const b = newSmall(36, 52, 18, 46), { pc } = b;
  shadowEllipse(b.shadow!, 24, 46, 8, 3, 60);
  rect(pc, 17, 12, 2, 34, (x) => pick(P.wood, x === 17 ? 3 : 1.6));
  fillPoly(pc, [[6, 14], [27, 12], [31, 15], [27, 18], [6, 20]], (x, y) => pick(P.wood, 3.4 - (y > 17 ? 0.8 : 0) + (x % 5 === 0 ? -0.4 : 0)));
  fillPoly(pc, [[29, 23], [9, 24], [5, 27], [9, 30], [29, 29]], (x, y) => pick(P.wood, 3 - (y > 28 ? 0.8 : 0) + (x % 5 === 0 ? -0.4 : 0)));
  for (let x = 9; x < 25; x += 2) { pc.set(x, 16, pick(P.cream, 4)); pc.set(x + 3, 26, pick(P.cream, 4)); }
  for (let i = 0; i < 6; i++) pc.set(14 + i, 44 - (i % 2), pick(P.leaf, 3 + i * 0.3));
  pc.edgeDarken(0.62);
  return b;
}

function newSmall(w: number, h: number, ox: number, oy: number): Built {
  return { pc: new PixelCanvas(w, h), ox, oy, shadow: new PixelCanvas(w, h) };
}

/** The robot's charging cradle: a wooden deck with a copper coil and a soft lamp. */
export function bay(): Built {
  const b = start(1, 1, 26, 8, 4), { pc, ox, oy } = b;
  shadowSweep(b.shadow!, footprint(ox, oy, -0.46, -0.46, 0.46, 0.46), 8, 70);
  drawBox(pc, ox, oy, { a0: -0.46, b0: -0.46, a1: 0.46, b1: 0.46, z1: 5 }, (f) => {
    if (f.kind === 'top') {
      const dx = (f.s - f.sw / 2) / (f.sw / 2), dy = (f.t - f.th / 2) / (f.th / 2), r = Math.hypot(dx, dy);
      if (r > 0.5 && r < 0.66) return pick(P.copper, 4.2 + (dx < 0 ? 0.8 : 0));
      if (r < 0.14) return pick(P.amber, 4.5);
      return pick(P.wood, 3.4 + (f.s % 6 < 1 ? -0.9 : 0) + (hash2(Math.floor(f.s / 6), 0, 3) - 0.5) * 0.6);
    }
    return pick(P.wood, BIAS[f.kind] + (f.t < 1 ? -1 : 0));
  });
  for (const [a, bb] of [[-0.38, -0.38], [0.38, -0.38]] as const) {
    drawBox(pc, ox, oy, { a0: a - 0.05, b0: bb - 0.05, a1: a + 0.05, b1: bb + 0.05, z0: 5, z1: 22 }, (f) =>
      f.kind === 'top' ? pick(P.amber, 5) : pick(P.copper, BIAS[f.kind] + 0.6 + (f.t % 5 < 1 ? -1 : 0)));
  }
  pc.edgeDarken(0.62);
  b.fx = { glows: [{ x: 0, y: -4, color: 0xffc878, radius: 26, flicker: 0.25, alpha: 0.4 }] };
  return b;
}

/** Brass console with a warm amber screen: where programs will be uploaded. */
export function terminal(): Built {
  const b = start(1, 1, 30, 8, 4), { pc, ox, oy } = b;
  shadowSweep(b.shadow!, footprint(ox, oy, -0.2, -0.15, 0.2, 0.15), 22, 75);
  drawBox(pc, ox, oy, { a0: -0.2, b0: -0.15, a1: 0.2, b1: 0.15, z1: 22 }, (f) => {
    if (f.kind === 'L' && f.t > 9 && f.t < 19 && f.s > 3 && f.s < f.sw - 3) {
      const row = Math.floor((f.t - 10) / 2);
      return f.t % 2 < 1 && hash2(row, Math.floor(f.s / 2), 4) > 0.35 ? pick(P.amber, 4.6) : pick(P.amber, 1.4);
    }
    if (f.kind === 'L' && f.t > 3 && f.t < 6) return hash2(Math.floor(f.s / 3), 0, 2) > 0.5 ? pick(P.cream, 4) : pick(P.wood, 1);
    if (f.t > f.th - 2 || f.s < 1.5 || f.s > f.sw - 1.5) return pick(P.copper, BIAS[f.kind] + 1);
    return pick(P.wood, BIAS[f.kind] + 0.4);
  });
  pc.edgeDarken(0.62);
  b.fx = { glows: [{ ...at(ox, oy, 0, 0.15, 14), color: 0xffb860, radius: 16, flicker: 0.2, alpha: 0.45 }] };
  return b;
}

export function barrels(): Built {
  const b = start(1, 1, 20, 10, 2), { pc, ox, oy } = b;
  shadowEllipse(b.shadow!, ox + 8, oy + 2, 26, 9, 80);
  ([[-12, 0], [10, 4], [-2, -8]] as const).forEach(([dx, dy], i) => {
    drawCylinder(pc, ox + dx, oy + dy + 6, 9, 17, (nx, t, cap, x) => {
      if (cap) return Math.abs(nx) > 0.82 ? pick(P.copper, 4) : pick(P.wood, 3.6 + nx * -0.6);
      if (Math.abs(t - 3) < 1.2 || Math.abs(t - 13) < 1.2) return pick(P.copper, 4 - nx * 2);
      return pick(P.wood, 3.4 - nx * 2.2 + (x % 4 === 0 ? -0.4 : 0) + (hash2(x, i, 2) - 0.5) * 0.4);
    });
  });
  pc.edgeDarken(0.6);
  return b;
}

export function crates(): Built {
  const b = start(1, 1, 44, 8, 4), { pc, ox, oy } = b;
  shadowSweep(b.shadow!, footprint(ox, oy, -0.4, -0.4, 0.4, 0.4), 36, 80);
  const crate = (box: BoxSpec, seed: number) => drawBox(pc, ox, oy, box, (f) => {
    if (f.s < 3 || f.s > f.sw - 3 || f.t < 3 || f.t > f.th - 3) return pick(P.wood, BIAS[f.kind] + 1.2);
    let idx = BIAS[f.kind] + (hash2(Math.floor(f.t / 6), seed, 3) - 0.5) * 1.2;
    if (f.t % 6 < 1) idx -= 1.2;
    if (f.kind !== 'top' && Math.abs(f.s - (f.t * f.sw) / f.th) < 1.6) idx -= 1.1;
    return pick(P.wood, idx);
  });
  crate({ a0: -0.4, b0: -0.4, a1: 0.4, b1: 0.4, z1: 24 }, 1);
  crate({ a0: -0.22, b0: -0.2, a1: 0.3, b1: 0.26, z0: 24, z1: 40 }, 2);
  pc.edgeDarken(0.6);
  return b;
}

/** Copper pipe run along +x on stone supports. */
export function pipeU(): Built {
  const b = start(1, 1, 22, 8), { pc, ox, oy } = b;
  shadowSweep(b.shadow!, footprint(ox, oy, -0.5, -0.1, 0.5, 0.1), 12, 70);
  for (const a of [-0.25, 0.25]) drawBox(pc, ox, oy, { a0: a - 0.06, b0: -0.1, a1: a + 0.06, b1: 0.1, z1: 8 }, (f) => pick(P.stone, BIAS[f.kind] + 0.6));
  drawBox(pc, ox, oy, { a0: -0.5, b0: -0.09, a1: 0.5, b1: 0.09, z0: 7, z1: 15 }, (f) => {
    const flange = f.s < 2 || (f.s > 30 && f.s < 34) || f.s > f.sw - 2;
    if (f.kind === 'top') return pick(P.copper, flange ? 6 : 5);
    return pick(P.copper, (flange ? 2 : 1.6) + (f.t / f.th) * 3.2 - (f.kind === 'R' ? 0.8 : 0));
  });
  pc.edgeDarken(0.6);
  return b;
}

/** Short wooden conveyor along +y; the belt runs via looping frames. */
export function conveyorV(): Built {
  const make = (frame: number): Built => {
    const b = start(1, 1, 14, 8), { pc, ox, oy } = b;
    shadowSweep(b.shadow!, footprint(ox, oy, -0.3, -0.5, 0.3, 0.5), 8, 70);
    for (const bb of [-0.4, 0.38]) drawBox(pc, ox, oy, { a0: -0.24, b0: bb - 0.06, a1: 0.24, b1: bb + 0.06, z1: 5 }, (f) => pick(P.wood, BIAS[f.kind] - 0.3));
    drawBox(pc, ox, oy, { a0: -0.3, b0: -0.5, a1: 0.3, b1: 0.5, z0: 5, z1: 11 }, (f) => {
      if (f.kind === 'top') {
        if (f.s < 3 || f.s > f.sw - 3) return pick(P.copper, 4 - (f.s < 3 ? 0 : 1.2));
        return pick(P.slate, 1.4 + ((f.t + frame * 2) % 6 < 1.2 ? 1.4 : 0));
      }
      if (f.kind === 'L' && f.t > 1.5 && f.t < f.th - 1.5 && (f.s + frame * 3) % 9 < 1.5) return pick(P.copper, 3.6); // turning rollers
      return pick(P.wood, BIAS[f.kind] + (f.t < 1.5 ? -1 : 0));
    });
    pc.edgeDarken(0.6);
    return b;
  };
  const b = make(0);
  b.frames = [1, 2].map((f) => make(f).pc);
  b.fps = 6;
  return b;
}


/** An old timbered mine entrance cut into the hillside, with rails and a little cart. */
export function mine(): Built {
  const b = start(1, 1, 48, 22, 4), { pc, ox, oy } = b;
  shadowEllipse(b.shadow!, ox + 10, oy + 6, 34, 12, 70);
  // rock mound
  const rock = P.stone.slice(0, 6);
  blob(pc, ox + 4, oy - 16, 34, 24, rock, { style: 'rock', seed: 71, ragged: 0.2 });
  blob(pc, ox - 14, oy - 6, 20, 14, rock, { style: 'rock', seed: 72, ragged: 0.2 });
  blob(pc, ox + 6, oy - 34, 20, 12, P.moss, { style: 'leaf', seed: 73, ragged: 0.4, bias: 0.05 });
  // tunnel mouth facing south-west, framed by timber
  const mx = ox - 12, my = oy - 2;
  fillPoly(pc, [[mx - 8, my], [mx - 8, my - 16], [mx + 8, my - 20], [mx + 8, my - 4]], (x, y) => pick(P.slate, 0.2 + Math.max(0, (my - y - 12)) * 0.05 + (x > mx + 4 ? 0.3 : 0)));
  for (const dx of [-9, 8]) rect(pc, mx + dx, my - 20 + (dx > 0 ? -1 : 3), 2, 18, (x) => pick(P.wood, x === mx + dx ? 3.4 : 2));
  line(pc, mx - 10, my - 16, mx + 10, my - 22, pick(P.wood, 3.6)); line(pc, mx - 10, my - 15, mx + 10, my - 21, pick(P.wood, 2.2));
  // rails out of the tunnel and a cart
  line(pc, mx - 5, my - 1, mx - 26, my + 9, pick(P.steel, 3)); line(pc, mx + 3, my - 3, mx - 18, my + 13, pick(P.steel, 3));
  for (let k = 0; k < 5; k++) line(pc, mx - 6 - k * 4, my + k * 2, mx + 2 - k * 4, my - 3 + k * 2 + 1, pick(P.wood, 1.6));
  const cx = mx - 16, cy = my + 6;
  drawBox(pc, cx, cy, { a0: -0.16, b0: -0.12, a1: 0.16, b1: 0.12, z0: 2, z1: 9 }, (f) => (f.kind === 'top' ? pick(P.stone, 2 + hash2(f.x, f.y, 1) * 2.5) : pick(P.rust, BIAS[f.kind] + (f.t < 1.5 || f.t > f.th - 1.5 ? 1 : 0))));
  pc.edgeDarken(0.6);
  b.fx = { glows: [{ x: mx - ox + 9, y: my - oy - 16, color: WARM, radius: 18, flicker: 0.25, alpha: 0.5 }] };
  rect(pc, mx + 8, my - 18, 2, 3, () => pick(P.amber, 5));
  return b;
}

// ---------------------------------------------------------------- Phase 2 machines (2x2 each)

const brickFace = (f: Face, base: number, seed: number): RGB => {
  const row = Math.floor(f.t / 3), off = (row % 2) * 3;
  if (f.t % 3 < 1 || (f.s + off) % 7 < 1) return pick(P.cream, 1.2 + base * 0.3);
  return pick(P.brick, base + hash2(Math.floor((f.s + off) / 7), row, seed) * 1.3);
};

/** Workbench: a timber lean-to with a heavy table, vice and tools in front. */
export function workbench(): Built {
  const b = start(2, 2, 44, 10, 4), { pc, ox, oy } = b;
  shadowSweep(b.shadow!, footprint(ox, oy, -0.5, -0.5, 1.5, 1.5), 26, 75);
  drawBox(pc, ox, oy, { a0: -0.45, b0: -0.45, a1: 1.45, b1: 1.45, z1: 3 }, (f) => pick(P.wood, BIAS[f.kind] + (f.kind === 'top' && f.s % 8 < 1 ? -0.9 : 0.3)));
  drawBox(pc, ox, oy, { a0: -0.45, b0: -0.45, a1: 1.45, b1: -0.25, z0: 3, z1: 26 }, (f) => {
    if (f.kind === 'L' && f.t > 10 && f.t < 20 && f.s % 9 < 2) return pick(P.steel, 3 + (f.t > 17 ? 1 : 0)); // hanging tools
    return pick(P.wood, BIAS[f.kind] + (f.s % 5 < 1 ? -0.8 : 0) + (vnoise(f.x * 0.4, f.y * 0.1, 3) - 0.5) * 0.5);
  });
  for (const a of [-0.4, 1.4]) drawBox(pc, ox, oy, { a0: a - 0.05, b0: 0.9, a1: a + 0.05, b1: 1.0, z0: 3, z1: 24 }, (f) => pick(P.wood, BIAS[f.kind]));
  drawGable(pc, ox, oy, { a0: -0.5, b0: -0.5, a1: 1.5, b1: 1.0, z1: 24, ridge: 10, axis: 'u', overhang: 0.1 }, (f) => (f.kind === 'gable' ? pick(P.wood, 2) : tiles(f, P.slate, 31)));
  drawBox(pc, ox, oy, { a0: 0.0, b0: 0.2, a1: 1.1, b1: 0.75, z0: 3, z1: 13 }, (f) => {
    if (f.kind === 'top') return pick(P.wood, 4.2 + (f.s % 7 < 1 ? -0.8 : 0));
    return f.t > 8 ? pick(P.wood, BIAS[f.kind] + 0.6) : f.s % 14 < 2 ? pick(P.wood, BIAS[f.kind]) : null; // legs
  });
  const [vx, vy] = isoPt(ox, oy, 0.15, 0.45, 13);
  rect(pc, vx - 3, vy - 5, 6, 5, (x) => pick(P.steel, x < vx ? 3.4 : 2)); // vice
  const [kx, ky] = isoPt(ox, oy, 0.8, 0.45, 13);
  rect(pc, kx - 4, ky - 4, 8, 4, (x) => pick(P.teal, x < kx ? 4 : 3)); // a research kit in progress
  line(pc, kx - 4, ky - 2, kx + 3, ky - 2, pick(P.cream, 4));
  pc.edgeDarken(0.62);
  b.fx = { glows: [{ ...at(ox, oy, 0.5, 0.5, 20), color: WARM, radius: 22, flicker: 0.1, alpha: 0.35 }] };
  return b;
}

/** Research lab: brick, tall windows, and a copper observatory dome with a telescope. */
export function labBuilding(): Built {
  const H = 30, b = start(2, 2, H + 44, 10, 4), { pc, ox, oy } = b;
  shadowSweep(b.shadow!, footprint(ox, oy, -0.5, -0.5, 1.5, 1.5), H + 24, 80);
  drawBox(pc, ox, oy, { a0: -0.5, b0: -0.5, a1: 1.5, b1: 1.5, z1: H }, (f) => {
    if (f.kind === 'top') return pick(P.slate, 2 + (f.s % 10 < 1 || f.t % 10 < 1 ? -0.8 : 0));
    if (f.t > H - 3) return pick(P.cream, BIAS[f.kind] + 0.8);
    const wx = f.s % 21 - 6, wy = f.t - 8;
    if (wx >= 0 && wx < 9 && wy >= 0 && wy < 16) return windowPane(wx, wy, 9, 16, hash2(Math.floor(f.s / 21), f.kind === 'L' ? 1 : 2, 3) < 0.7, f.kind);
    if (f.kind === 'L' && f.s > 26 && f.s < 38 && f.t < 18) return f.s < 28 || f.s > 36 || f.t > 16 ? pick(P.cream, 3) : pick(P.teal, 2.4 + (f.t % 4 < 1 ? -0.6 : 0)); // door
    return climber(f, 51, 0.22, 14) ?? brickFace(f, BIAS[f.kind] - 0.1, 9);
  });
  const [dx, dy] = isoPt(ox, oy, 0.5, 0.5, H);
  blob(pc, dx, dy - 8, 18, 15, P.copper, { style: 'smooth', paint: (x, y, lit) => ((x + y) % 9 === 0 ? pick(P.verdigris, 2 + lit * 2) : null) });
  // a brass telescope poking out of the dome's slot
  for (let i = 0; i <= 14; i++) {
    const x = dx - 3 + i * 0.9, y = dy - 9 - i, w = i > 11 ? 2 : 1;
    for (let k = -w; k <= w; k++) pc.set(x + k, y, k < 0 ? pick(P.steel, 4.4) : k === 0 ? pick(P.steel, 3) : pick(P.steel, 1.4));
  }
  pc.set(dx + 10, dy - 23, pick(P.glass, 5)); pc.set(dx + 11, dy - 23, pick(P.glass, 4));
  pc.edgeDarken(0.62);
  b.fx = { glows: [{ ...at(ox, oy, 0.5, 1.5, 16), color: 0xbfe6c8, radius: 26, flicker: 0.08, alpha: 0.35 }, { ...at(ox, oy, 1.5, 0.5, 16), color: WARM, radius: 20, flicker: 0.08, alpha: 0.3 }] };
  return b;
}

/** Sawmill: open timber shed, a big circular blade (turns while working), logs and planks. */
export function sawmill(): Built {
  const FR = 3;
  const make = (frame: number): Built => {
    const b = start(2, 2, 46, 12, 4), { pc, ox, oy } = b;
    shadowSweep(b.shadow!, footprint(ox, oy, -0.5, -0.5, 1.5, 1.5), 30, 75);
    for (const [a, bb] of [[-0.4, -0.4], [1.4, -0.4], [-0.4, 1.4], [1.4, 1.4]]) drawBox(pc, ox, oy, { a0: a - 0.06, b0: bb - 0.06, a1: a + 0.06, b1: bb + 0.06, z1: 26 }, (f) => pick(P.wood, BIAS[f.kind]));
    drawBox(pc, ox, oy, { a0: -0.45, b0: -0.45, a1: 1.45, b1: -0.3, z1: 26 }, (f) => pick(P.wood, BIAS[f.kind] + (f.s % 4 < 1 ? -0.8 : 0)));
    drawGable(pc, ox, oy, { a0: -0.5, b0: -0.5, a1: 1.5, b1: 1.5, z1: 26, ridge: 16, axis: 'u', overhang: 0.08 }, (f) => (f.kind === 'gable' ? pick(P.wood, 2.2 + (f.s % 4 < 1 ? -0.7 : 0)) : tiles(f, P.roof, 41)));
    drawBox(pc, ox, oy, { a0: 0.1, b0: 0.6, a1: 1.2, b1: 0.95, z1: 10 }, (f) => pick(P.steel, BIAS[f.kind] + 0.4));
    const [cx, cy] = isoPt(ox, oy, 0.65, 0.78, 16);
    for (let y = -9; y <= 9; y++) for (let x = -9; x <= 9; x++) {
      const r = Math.hypot(x, y);
      if (r > 9) continue;
      const ang = Math.atan2(y, x) + (frame / FR) * (Math.PI / 6);
      const tooth = r > 7.5 && Math.floor(((ang + 10) * 12) / Math.PI) % 2 === 0;
      if (r > 7.5 && !tooth) continue;
      pc.set(cx + x, cy + y, r < 2 ? pick(P.steel, 1) : pick(P.steel, 4.2 - x * 0.12 + (Math.floor(((ang + 10) * 3) / Math.PI) % 2 ? 0.4 : 0)));
    }
    for (let k = 0; k < 3; k++) {
      const [lx, ly] = isoPt(ox, oy, 1.25, 1.2 - k * 0.12, 3 + (k === 2 ? 6 : 0));
      drawCylinder(pc, lx - (k === 2 ? 3 : 0), ly, 5, 3, (nx, _t, cap) => (cap ? pick(P.wood, 4.5) : pick(P.bark, 2.5 - nx)));
    }
    const [px, py] = isoPt(ox, oy, -0.1, 1.2);
    for (let k = 0; k < 4; k++) rect(pc, px - 8, py - 3 - k * 2, 16, 2, (x) => pick(P.wood, 4 - (x - px + 8) * 0.06 - (k % 2) * 0.5));
    pc.edgeDarken(0.62);
    return b;
  };
  const b = make(0);
  b.frames = [1, 2].map((f) => make(f).pc);
  b.fps = 12;
  return b;
}

/**
 * Kiln: a bottle kiln. A brick drum with an iron hoop, a dome that sits on it without a seam, a tapering neck,
 * and an arched firebox facing the viewer where the coals glow. A stack of fired bricks waits beside it.
 */
export function kiln(): Built {
  const b = start(2, 2, 64, 10, 10), { pc, ox, oy } = b;
  shadowEllipse(b.shadow!, ox + 22, oy + 18, 46, 19, 85);
  const [cx, cy] = isoPt(ox, oy, 0.5, 0.5);
  const R = 24, H = 17, D = 22; // drum radius, drum height, dome height
  const brick = (x: number, y: number, base: number, seed: number): RGB => {
    const row = Math.floor(y / 3), off = (row & 1) * 3;
    if (y % 3 === 0 || (x + off) % 7 === 0) return pick(P.cream, 0.9 + base * 0.25);
    return pick(P.brick, base + (hash2(Math.floor((x + off) / 7), row, seed) - 0.5) * 0.9);
  };
  // drum (its top is painted too: the dome's base circle sits on it, so there is no hole)
  drawCylinder(pc, cx, cy, R, H, (nx, t, cap, x, y) => {
    if (cap) return brick(x, y, 2.6 - nx * 1.2, 5);
    if (t > H - 4 && t < H - 1) return pick(P.steel, 1.2 - nx * 0.8 + (t > H - 3 ? 0.5 : 0)); // iron hoop
    return brick(x, y, 2.9 - nx * 1.7 - (t < 2 ? 0.6 : 0), 5);
  });
  // dome: the upper half of an ellipse on the drum's top circle
  const ty = cy - H;
  for (let y = ty - D - 1; y <= ty; y++) for (let x = cx - R; x <= cx + R; x++) {
    const dx = (x + 0.5 - cx) / R, dy = (y + 0.5 - ty) / D;
    if (dx * dx + dy * dy > 1) continue;
    const lit = -dx * 0.9 - dy * 0.7; // light from the upper left
    pc.set(x, y, brick(x, y, 2.4 + lit * 1.4 + (dx * dx + dy * dy > 0.86 ? -0.5 : 0), 6));
  }
  // neck: a short flared chimney, sooty at the lip
  drawCylinder(pc, cx, ty - D + 5, 7, 13, (nx, t, cap, x, y, ny) => {
    if (cap) return nx * nx + ny * ny < 0.45 ? pick(P.slate, 0.2) : pick(P.brick, 1.6 - nx * 0.5); // the flue, sooty inside
    if (t > 10) return pick(P.steel, 1.6 - nx * 0.9); // iron collar
    return brick(x, y, 2.7 - nx * 1.6, 7);
  });
  // arched firebox facing the viewer, a little to the lit side
  const fx = cx - 9, fb = Math.round(cy + Math.sqrt(1 - ((fx - cx) / R) ** 2) * (R / 2)) - 1, fw = 6, fh = 12;
  for (let y = fb - fh - 1; y <= fb; y++) for (let x = fx - fw - 1; x <= fx + fw + 1; x++) {
    const ax = (x + 0.5 - fx) / fw, top = fb - fh + fw; // straight sides, round top
    const inArch = (u: number, h: number) => (y + 0.5 >= top ? Math.abs(u) <= 1 : u * u + ((y + 0.5 - top) / h) ** 2 <= 1);
    if (!inArch((x + 0.5 - fx) / (fw + 1), fw + 1)) continue;
    if (!inArch(ax, fw)) { pc.set(x, y, pick(P.cream, 2.8)); continue; } // stone arch ring
    const depth = (fb - y) / fh; // 0 at the floor
    pc.set(x, y, depth < 0.28 ? pick(P.amber, 5 - depth * 6 + (hash2(x, y, 3) > 0.6 ? 0.6 : 0)) : pick(P.rust, 0.6 + (1 - depth) * 1.6 - Math.abs(ax) * 0.5));
  }
  // fired bricks stacked beside the kiln
  drawBox(pc, ox, oy, { a0: 1.02, b0: 0.18, a1: 1.4, b1: 0.52, z1: 9 }, (f) => (f.t % 3 === 0 ? pick(P.cream, 1.6) : pick(P.brick, BIAS[f.kind] + (f.kind === 'top' ? 0.4 : 0))));
  pc.edgeDarken(0.62);
  b.fx = { glows: [{ x: fx - ox, y: fb - oy - 4, color: 0xff9a40, radius: 24, flicker: 0.35, alpha: 0.65 }], smoke: { x: cx - ox, y: ty - D - 6 - oy, rate: 0.8 } };
  return b;
}
