import { P } from '../palette.ts';
import { PixelCanvas, blob, line, pick, shadowEllipse, type RGB } from '../pixel/PixelCanvas.ts';
import { drawBox, drawCylinder, isoCanvas } from '../pixel/iso3d.ts';
import type { Built } from './types.ts';

/** Screen direction (dx, dy) each facing looks toward: 0:+x(SE) 1:+y(SW) 2:-x(NW) 3:-y(NE). */
const LOOK: readonly [number, number][] = [[1, 0.5], [-1, 0.5], [-1, -0.5], [1, -0.5]];

/** What the robot is doing, as an animation. Frame counts per pose. */
export type RobotPose = 'idle' | 'walk' | 'work' | 'celebrate' | 'error';
export const ROBOT_POSES: Readonly<Record<RobotPose, number>> = { idle: 6, walk: 4, work: 4, celebrate: 4, error: 2 };
/** Sprout growth stages: the sprout on Seedling's head grows with each programming skill. */
export const SPROUT_STAGES = 4;
/** Where the basket's opening is, relative to the ground point, per facing: cargo is drawn there. */
export const BASKET: readonly [number, number][] = [[-8, -27], [8, -27], [8, -29], [-8, -29]];

const LEAF = P.leaf, STEM: RGB = [86, 120, 52];
const INK: RGB = [44, 30, 34];

/** A 2px copper arm from shoulder to hand, ending in a small steel claw. */
function arm(pc: PixelCanvas, sx: number, sy: number, hx: number, hy: number, near: boolean): void {
  const c = near ? 4 : 2.6;
  line(pc, sx, sy, hx, hy, pick(P.copper, c));
  line(pc, sx + 1, sy, hx + 1, hy, pick(P.copper, c - 1.2));
  pc.set(sx, sy, pick(P.copper, c + 1)); // shoulder bolt
  pc.set(hx, hy + 1, pick(P.steel, near ? 4 : 2)); pc.set(hx + 1, hy + 1, pick(P.steel, near ? 3 : 1.6));
  pc.set(hx - 1, hy + 2, pick(P.steel, 2)); pc.set(hx + 2, hy + 2, pick(P.steel, 1.6));
}

/** The sprout in its copper socket: a stem with up to three leaves, and a flower at the last stage. */
function sprout(pc: PixelCanvas, x: number, y: number, stage: number, sway: number): void {
  pc.set(x - 1, y + 1, pick(P.copper, 4)); pc.set(x, y + 1, pick(P.copper, 3)); pc.set(x + 1, y + 1, pick(P.copper, 2)); // socket
  const h = 5 + stage * 2;
  for (let k = 0; k <= h; k++) pc.set(x + Math.round((k / h) * sway), y - k, k < 1 ? pick(P.copper, 3) : STEM);
  const tipX = x + Math.round(sway), tipY = y - h;
  const leaves = Math.min(stage + 1, 3);
  for (let i = 0; i < leaves; i++) {
    const side = i % 2 ? -1 : 1, ly = tipY + 1 + i * 2, lx = x + Math.round(((h - (ly - tipY)) / h) * sway);
    blob(pc, lx + side * 3.4, ly - 0.5, 3.4, 1.9, LEAF.slice(3, 7), { style: 'smooth' });
    pc.set(lx + side * 6, ly - 2, pick(LEAF, 6));
    line(pc, lx + side, ly - 0.5, lx + side * 5, ly - 1, pick(LEAF, 3)); // midrib
  }
  if (stage >= 3) {
    blob(pc, tipX, tipY - 1.5, 2.6, 2.2, P.flowers.slice(1, 3), { style: 'smooth' });
    pc.set(tipX, tipY - 1, P.amber[5]);
  }
}

type Eye = 'open' | 'blink' | 'happy' | 'focus' | 'worried';

/** The face: one big eye under a copper brow plate. The brow carries the expression. */
function face(pc: PixelCanvas, hx: number, hy: number, lx: number, eye: Eye, lookX: number): void {
  const ex = hx + lx * 3.5, ey = hy + 0.5;
  // brow plate: a short copper bar; tilted for worry, lowered for focus
  const tilt = eye === 'worried' ? 2 : 0, low = eye === 'focus' ? 1 : 0;
  for (let i = -3; i <= 3; i++) {
    const by = ey - 6 + low + Math.round((i / 3) * tilt * Math.sign(-lx || 1) * 0.5) - (eye === 'happy' ? 1 : 0);
    pc.set(ex + i, by, pick(P.copper, 3.2 - Math.abs(i) * 0.3));
  }
  if (eye === 'blink') { line(pc, ex - 3, ey + 1, ex + 3, ey + 1, INK); return; }
  if (eye === 'happy') { line(pc, ex - 3, ey + 1, ex, ey - 2, INK); line(pc, ex, ey - 2, ex + 3, ey + 1, INK); line(pc, ex - 2, ey + 1, ex, ey - 1, INK); return; }
  blob(pc, ex, ey, 4.2, eye === 'focus' ? 3.4 : 4.4, [P.slate[0], P.slate[1]], { style: 'smooth' });
  const iris = eye === 'worried' ? P.brick.slice(3) : P.amber.slice(3);
  blob(pc, ex + lookX, ey + 0.5, eye === 'worried' ? 1.5 : 2, eye === 'worried' ? 1.7 : 2.2, iris, { style: 'smooth' });
  pc.set(ex - 1, ey - 2, [255, 248, 230]); pc.set(ex - 2, ey - 1, [255, 248, 230]);
}

/**
 * One frame of Seedling, the worker robot: a round cream body on two rubber treads, a wicker basket on its back,
 * a round head with one big eye under a copper brow, and a sprout in a copper socket that grows with its skills.
 */
export function robotFrame(facing: number, pose: RobotPose, frame: number, stage = 0): Built {
  const { pc, ox, oy } = isoCanvas(1, 1, 48, 10, 8);
  const b: Built = { pc, ox, oy, shadow: new PixelCanvas(pc.w, pc.h) };
  const alongU = facing === 0 || facing === 2;
  const away = facing >= 2;
  const [lx] = LOOK[facing];
  const front = Math.sign(lx);
  const walk = pose === 'walk', work = pose === 'work', err = pose === 'error', cheer = pose === 'celebrate';

  // motion: the treads stay on the ground; body, head and arms carry the pose
  const hop = cheer ? [0, 2, 3, 1][frame] : 0;
  const bob = walk ? frame % 2 : pose === 'idle' ? (frame === 2 || frame === 3 ? 1 : 0) : work ? (frame >= 2 ? 1 : 0) : 0;
  const lift = hop - bob; // positive = up
  const lean = work && frame >= 2 ? front : 0;
  const shake = err ? (frame ? 1 : -1) : 0;
  shadowEllipse(b.shadow!, ox + 4, oy + 3, 14 - hop, 5, 85);

  const tread = (c: number) => {
    const spec = alongU ? { a0: -0.3, a1: 0.3, b0: c - 0.09, b1: c + 0.09 } : { b0: -0.3, b1: 0.3, a0: c - 0.09, a1: c + 0.09 };
    drawBox(pc, ox, oy - Math.min(hop, 1), { ...spec, z1: 6 }, (f) => {
      if (f.kind === 'top') return pick(P.slate, 1.6);
      const stripe = (f.s + (walk ? frame : 0) * 1.5) % 4 < 2;
      if (f.t > 4.5 || f.t < 1) return pick(P.slate, 0.6);
      return pick(P.slate, (stripe ? 2.4 : 1.2) + (f.kind === 'L' ? 0.6 : 0));
    });
    // wheel hubs on the outer face
    const [wx, wy] = [ox + (alongU ? 0 : c * 30), oy - 3 - Math.min(hop, 1) + (alongU ? c * 15 : 0)];
    pc.set(wx, wy, pick(P.copper, 4)); pc.set(wx + 1, wy, pick(P.copper, 3));
  };

  // the wicker basket rides on the robot's back: behind the body when it faces us, in front when it walks away
  const [bx, by] = BASKET[facing];
  const basket = () => {
    for (let y = -7; y <= 0; y++) for (let x = -5; x <= 5; x++) {
      const px = ox + shake + bx + x, py = oy + by - lift + y + 8;
      const weave = (x + y * 2) % 3 === 0 || y === -7;
      pc.set(px, py, pick(P.wood, y === -7 ? 4.6 : weave ? 2.2 : 3.6 - (x > 0 ? 0.6 : 0)));
    }
    line(pc, ox + shake + bx - 5, oy + by - lift + 1, ox + shake + bx + 5, oy + by - lift + 1, pick(P.wood, 4.8)); // rim
  };

  const light: readonly RGB[] = err ? P.brick.slice(3) : work ? P.glowTeal.slice(3) : cheer ? P.amber.slice(3) : P.amber.slice(2);
  tread(-0.26);
  if (!away) basket();
  // round body: a cream barrel with a copper belt, rivets and a status light on its front
  const bodyY = oy - 4 - lift;
  drawCylinder(pc, ox + shake, bodyY, 11, 13, (nx, t, cap, x) => {
    if (cap) return pick(P.cream, 4.4 - nx * 0.6);
    const lit = 3.6 - nx * 1.6;
    if (t > 5 && t < 8) return pick(P.copper, lit + ((x | 0) % 4 === 0 ? 0.8 : 0)); // belt with rivets
    if (t < 1.5) return pick(P.copper, lit - 1.4);
    if (Math.abs(nx - lx * 0.3) < 0.13 && t > 9 && t < 11.5) return pick(light, 1 + (frame % 2)); // status light, toward the look
    return pick(P.cream, lit + (t > 11 ? 0.4 : 0));
  });
  tread(0.26);
  if (away) basket();

  // arms: the far one first; the near one does the work
  for (const side of [-front || -1, front || 1]) {
    const near = side === front;
    const sx = ox + shake + side * 11, sy = oy - 13 - lift;
    let hx = sx + side * 2, hy = sy + 6;
    if (walk) { const swing = (frame + (near ? 0 : 2)) % 4 < 2; hy += swing ? -1 : 1; hx += swing ? side : 0; }
    if (pose === 'idle' && frame === 4) hy -= 1;
    if (work && near) { const up = frame < 2; hx = sx + side * (up ? 4 : 6); hy = up ? sy - 6 + frame : sy + 4; }
    if (err) { hx = sx + side * 4; hy = sy - 5 + frame * 2; }
    if (cheer) { hx = sx + side * 4; hy = sy - 9 - (frame % 2); }
    arm(pc, sx, sy, hx, hy, near);
    if (work && near) { // a wrench
      line(pc, hx + side, hy - 1, hx + side * 3, hy - 4 + (frame < 2 ? 0 : 5), pick(P.steel, 4));
      pc.set(hx + side * 3, hy - 5 + (frame < 2 ? 0 : 5), pick(P.steel, 5));
    }
  }

  // round head on a short neck
  const hx = ox + shake + lean, hy = oy - 28 - lift;
  line(pc, hx, hy + 7, hx, hy + 11, pick(P.slate, 2));
  blob(pc, hx, hy, 9.5, 8.5, P.cream.slice(1), { style: 'smooth' });
  for (let x = hx - 8; x <= hx + 8; x++) if (pc.alpha(x, hy + 5)) pc.set(x, hy + 5, pick(P.copper, 3 - (x - hx) * 0.08)); // chin seam
  pc.set(hx - 9, hy, pick(P.copper, 4)); pc.set(hx + 9, hy, pick(P.copper, 2)); // ear bolts

  if (!away) {
    const eye: Eye = pose === 'idle' && frame === 5 ? 'blink' : cheer || (work && frame >= 2) ? 'happy' : work ? 'focus' : err ? 'worried' : 'open';
    face(pc, hx, hy, lx, eye, walk ? lx * 0.8 : 0.6 * lx);
    pc.set(hx + lx * 8.5, hy + 3.5, [232, 140, 120]); // rosy cheek
  } else {
    for (let k = 0; k < 3; k++) line(pc, hx - 3 - lx * 2, hy - 1 + k * 2, hx + 3 - lx * 2, hy - 1 + k * 2, pick(P.copper, 2.4)); // vent
  }

  const sway = walk ? [0, 1, 0, -1][frame] : pose === 'idle' ? [0, 0, 1, 1, 0, -1][frame] : err ? (frame ? 1 : -1) : cheer ? [0, -1, 0, 1][frame] : 0;
  sprout(pc, hx + (away ? 1 : -1), hy - 8, Math.max(0, Math.min(SPROUT_STAGES - 1, stage)), sway);
  pc.edgeDarken(0.6);
  return b;
}
