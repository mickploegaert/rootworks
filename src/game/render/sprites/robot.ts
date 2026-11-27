import { P } from '../palette.ts';
import { PixelCanvas, blob, line, pick, shadowEllipse, type RGB } from '../pixel/PixelCanvas.ts';
import { drawBox, isoCanvas } from '../pixel/iso3d.ts';
import type { Built } from './types.ts';

const BIAS = { top: 3.4, L: 2.6, R: 1.4 } as const;
/** Screen direction (dx, dy) each facing looks toward: 0:+x(SE) 1:+y(SW) 2:-x(NW) 3:-y(NE). */
const LOOK: readonly [number, number][] = [[1, 0.5], [-1, 0.5], [-1, -0.5], [1, -0.5]];

/** What the robot is doing, as an animation. Frame counts per pose. */
export type RobotPose = 'idle' | 'walk' | 'work' | 'error';
export const ROBOT_POSES: Readonly<Record<RobotPose, number>> = { idle: 6, walk: 4, work: 4, error: 2 };
/** Sprout growth stages: the sprout on Seedling's head grows with each firmware tier. */
export const SPROUT_STAGES = 4;

const LEAF = P.leaf, STEM: RGB = [86, 120, 52];

/** A 2px-thick copper arm from shoulder to hand, with a little claw. */
function arm(pc: PixelCanvas, sx: number, sy: number, hx: number, hy: number, near: boolean): void {
  const c = near ? 4 : 2.6;
  line(pc, sx, sy, hx, hy, pick(P.copper, c));
  line(pc, sx + 1, sy, hx + 1, hy, pick(P.copper, c - 1.2));
  pc.set(hx, hy + 1, pick(P.steel, near ? 4 : 2)); pc.set(hx + 1, hy + 1, pick(P.steel, near ? 3 : 1.6));
  pc.set(hx, hy + 2, pick(P.steel, 2));
}

/** The sprout: a stem with stage + 1 leaves, and a flower bud at the last stage. `sway` tilts it (-1..1). */
function sprout(pc: PixelCanvas, x: number, y: number, stage: number, sway: number): void {
  const h = 5 + stage * 2;
  for (let k = 0; k <= h; k++) pc.set(x + Math.round((k / h) * sway), y - k, k < 2 ? pick(P.copper, 3) : STEM);
  const tipX = x + Math.round(sway), tipY = y - h;
  const leaves = Math.min(stage + 1, 3);
  for (let i = 0; i < leaves; i++) {
    const side = i % 2 ? -1 : 1, ly = tipY + 1 + i * 2, lx = x + Math.round(((h - (ly - tipY)) / h) * sway);
    blob(pc, lx + side * 3.4, ly - 0.5, 3.4, 1.9, LEAF.slice(3, 7), { style: 'smooth' });
    pc.set(lx + side * 6, ly - 2, pick(LEAF, 6));
    line(pc, lx + side, ly - 0.5, lx + side * 5, ly - 1, pick(LEAF, 3)); // midrib
  }
  if (stage >= 3) { // a small flower: the valley is blooming
    blob(pc, tipX, tipY - 1.5, 2.6, 2.2, P.flowers.slice(1, 3), { style: 'smooth' });
    pc.set(tipX, tipY - 1, P.amber[5]);
  }
}

/**
 * One frame of Seedling, the worker robot: a cream-and-copper machine on rubber treads with a round head,
 * one big friendly eye and a sprout growing from its head (it grows with firmware research).
 */
export function robotFrame(facing: number, pose: RobotPose, frame: number, stage = 0): Built {
  const { pc, ox, oy } = isoCanvas(1, 1, 48, 10, 8);
  const b: Built = { pc, ox, oy, shadow: new PixelCanvas(pc.w, pc.h) };
  shadowEllipse(b.shadow!, ox + 4, oy + 3, 14, 5, 85);
  const alongU = facing === 0 || facing === 2;
  const away = facing >= 2;
  const [lx] = LOOK[facing];
  const front = Math.sign(lx);

  // per-pose motion: body bob, head lean toward the work, arm swing
  const walk = pose === 'walk', work = pose === 'work', err = pose === 'error';
  const bob = walk ? (frame % 2) : pose === 'idle' ? (frame === 2 || frame === 3 ? 1 : 0) : work ? (frame >= 2 ? 1 : 0) : 0;
  const lean = work && frame >= 2 ? front : 0;
  const shake = err ? (frame ? 1 : -1) : 0;

  const tread = (c: number) => {
    const spec = alongU ? { a0: -0.3, a1: 0.3, b0: c - 0.09, b1: c + 0.09 } : { b0: -0.3, b1: 0.3, a0: c - 0.09, a1: c + 0.09 };
    drawBox(pc, ox, oy, { ...spec, z1: 6 }, (f) => {
      if (f.kind === 'top') return pick(P.slate, 1.6);
      const stripe = (f.s + (walk ? frame : 0) * 1.5) % 4 < 2;
      if (f.t > 4.5 || f.t < 1) return pick(P.slate, 0.6);
      return pick(P.slate, (stripe ? 2.4 : 1.2) + (f.kind === 'L' ? 0.6 : 0));
    });
  };

  const light: readonly RGB[] = err ? P.brick.slice(3) : work ? P.glowTeal.slice(3) : P.amber.slice(2);
  tread(-0.26);
  // body: cream shell with a copper belly band, rivets and a status light that tells the robot's mood
  drawBox(pc, ox + shake, oy - bob, { a0: -0.21, b0: -0.21, a1: 0.21, b1: 0.21, z0: 4, z1: 17 }, (f) => {
    if (f.kind === 'top') return pick(P.cream, 4.6);
    if (f.t > 6 && f.t < 9) return pick(P.copper, BIAS[f.kind] + 1.4 + ((f.s | 0) % 5 === 2 ? 1 : 0));
    if (f.t < 2) return pick(P.copper, BIAS[f.kind] - 0.4);
    if (Math.abs(f.s - f.sw / 2) < 2.5 && f.t > 10.5 && f.t < 14.5) return pick(light, 1 + (frame % 2));
    return pick(P.cream, BIAS[f.kind] + 0.9 - (f.s < 1 || f.s > f.sw - 1 ? 0.8 : 0));
  });
  tread(0.26);

  // arms: the far one first; the near one (screen side the robot looks toward) holds a wrench while working
  for (const side of [-front || -1, front || 1]) {
    const near = side === front;
    const sx = ox + shake + side * 10, sy = oy - 13 - bob;
    let hx = sx + side * 2, hy = sy + 6;
    if (walk) hy += (frame + (near ? 0 : 2)) % 4 < 2 ? -1 : 1, hx += (frame + (near ? 0 : 2)) % 4 < 2 ? side : 0;
    if (pose === 'idle') hy += frame === 4 ? -1 : 0;
    if (work && near) { const up = frame < 2; hx = sx + side * (up ? 4 : 6); hy = up ? sy - 6 + frame : sy + 4; }
    if (err) { hx = sx + side * 4; hy = sy - 5 + frame * 2; }
    arm(pc, sx, sy, hx, hy, near);
    if (work && near) { // wrench
      line(pc, hx + side, hy - 1, hx + side * 3, hy - 4 + (frame < 2 ? 0 : 5), pick(P.steel, 4));
      pc.set(hx + side * 3, hy - 5 + (frame < 2 ? 0 : 5), pick(P.steel, 5));
    }
  }

  // round head on a short neck
  const hx = ox + shake + lean, hy = oy - 27 - bob;
  line(pc, hx, hy + 7, hx, hy + 10, pick(P.slate, 2));
  blob(pc, hx, hy, 9.5, 8.5, P.cream.slice(1), { style: 'smooth' });
  for (let x = hx - 8; x <= hx + 8; x++) if (pc.alpha(x, hy + 5)) pc.set(x, hy + 5, pick(P.copper, 3 - (x - hx) * 0.08)); // chin seam
  // ear bolts
  pc.set(hx - 9, hy, pick(P.copper, 4)); pc.set(hx + 9, hy, pick(P.copper, 2));

  if (!away) {
    const ex = hx + lx * 3.5, ey = hy + 0.5;
    const blink = pose === 'idle' && frame === 5;
    if (blink) {
      line(pc, ex - 3, ey + 1, ex + 3, ey + 1, pick(P.slate, 0));
    } else if (work && frame >= 2) { // a content squint: ^
      line(pc, ex - 3, ey + 1, ex, ey - 2, pick(P.slate, 0)); line(pc, ex, ey - 2, ex + 3, ey + 1, pick(P.slate, 0));
    } else {
      blob(pc, ex, ey, 4.2, 4.4, [P.slate[0], P.slate[1]], { style: 'smooth' });
      const iris = err ? P.brick.slice(3) : P.amber.slice(3);
      const look = walk ? lx * 0.8 : 0.6 * lx;
      blob(pc, ex + look, ey + 0.5 + (err ? frame : 0), err ? 1.4 : 2, err ? 1.6 : 2.2, iris, { style: 'smooth' });
      pc.set(ex - 1, ey - 2, [255, 248, 230]);
      pc.set(ex - 2, ey - 1, [255, 248, 230]);
    }
    pc.set(ex + lx * 5, ey + 3, [232, 140, 120]); // rosy cheek
    if (err) { // a worried brow
      line(pc, ex - 3, ey - 6 + (lx > 0 ? 1 : 0), ex + 3, ey - 6 + (lx > 0 ? 0 : 1), pick(P.slate, 1));
    }
  } else {
    for (let k = 0; k < 3; k++) line(pc, hx - 3 - lx * 2, hy - 1 + k * 2, hx + 3 - lx * 2, hy - 1 + k * 2, pick(P.copper, 2.4));
  }

  // the sprout sways a little in every pose; it bounces while walking
  const sway = walk ? [0, 1, 0, -1][frame] : pose === 'idle' ? [0, 0, 1, 1, 0, -1][frame] : err ? (frame ? 1 : -1) : 0;
  sprout(pc, hx + (away ? 1 : -1), hy - 8, Math.max(0, Math.min(SPROUT_STAGES - 1, stage)), sway);
  pc.edgeDarken(0.6);
  return b;
}
