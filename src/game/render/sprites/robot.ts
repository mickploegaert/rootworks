import { P } from '../palette.ts';
import { PixelCanvas, blob, line, pick, rect, shadowEllipse, type RGB } from '../pixel/PixelCanvas.ts';
import { drawBox, drawCylinder, isoCanvas } from '../pixel/iso3d.ts';
import type { Built } from './types.ts';

/** Screen direction (dx, dy) each facing looks toward: 0:+x(SE) 1:+y(SW) 2:-x(NW) 3:-y(NE). */
const LOOK: readonly [number, number][] = [[1, 0.5], [-1, 0.5], [-1, -0.5], [1, -0.5]];

/** What the robot is doing, as an animation. Frame counts per pose. */
export type RobotPose = 'idle' | 'walk' | 'work' | 'celebrate' | 'error' | 'sleep' | 'rest';
/** `sleep`: powered down, slumped, eye shut (the intro). `rest`: sat down after a long wait, looking around. */
export const ROBOT_POSES: Readonly<Record<RobotPose, number>> = { idle: 6, walk: 4, work: 4, celebrate: 4, error: 2, sleep: 2, rest: 4 };
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
  if (stage >= 3) { // a cherry blossom: a round pink flower with notched petals round a golden heart, lit from the top left
    const cy = tipY - 3;
    for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) {
      const d = Math.hypot(x, y), a = Math.atan2(y, x);
      if (d > 3.2 || (d > 2 && Math.cos(5 * (a + 0.31)) < -0.6)) continue;
      pc.set(tipX + x, cy + y, d < 1.2 ? [178, 82, 118] : x + y < -1 ? [252, 214, 228] : x + y > 2 ? [218, 122, 158] : [240, 163, 191]);
    }
    pc.set(tipX, cy, P.amber[5]);
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

/** How a pose moves the robot in a frame: shared with the renderer, so accessories sit exactly on the head. */
export function poseMotion(facing: number, pose: RobotPose, frame: number) {
  const front = Math.sign(LOOK[facing][0]);
  const hop = pose === 'celebrate' ? [0, 2, 3, 1][frame] : 0;
  const bob = pose === 'walk' ? frame % 2 : pose === 'idle' ? (frame === 2 || frame === 3 ? 1 : 0) : pose === 'work' ? (frame >= 2 ? 1 : 0) : 0;
  const lift = hop - bob - (pose === 'sleep' ? 2 + frame : pose === 'rest' ? 3 : 0); // positive = up; asleep it sinks and slowly breathes
  const lean = (pose === 'work' && frame >= 2) || pose === 'sleep' ? front : 0;
  const shake = pose === 'error' ? (frame ? 1 : -1) : 0;
  return { hop, lift, lean, shake };
}

/** Head centre relative to the robot's ground point, for a facing, pose and frame. */
export function robotHead(facing: number, pose: RobotPose, frame: number): { x: number; y: number } {
  const m = poseMotion(facing, pose, frame);
  return { x: m.shake + m.lean, y: -28 - m.lift };
}

export type CosmeticId = 'goggles' | 'crown' | 'scarf';
export const COSMETIC_IDS: readonly CosmeticId[] = ['goggles', 'crown', 'scarf'];

/** An accessory for Seedling, drawn around a head centred at (14, 14) of a 28 x 28 canvas, per facing. */
export function cosmeticCanvas(id: CosmeticId, facing: number): PixelCanvas {
  const pc = new PixelCanvas(28, 28), cx = 14, cy = 14, [lx] = LOOK[facing], away = facing >= 2;
  if (id === 'goggles') { // copper rims pushed up on the forehead, a leather strap round the head
    for (let x = -9; x <= 9; x++) pc.set(cx + x, cy - 4 + (Math.abs(x) > 7 ? 1 : 0), pick(P.wood, 1.6));
    if (!away) for (const dx of [-3, 3]) {
      const gx = cx + dx + lx * 2;
      blob(pc, gx, cy - 5, 2.6, 2.4, P.copper.slice(2, 6), { style: 'smooth' });
      blob(pc, gx, cy - 5, 1.5, 1.4, P.glass.slice(2), { style: 'smooth' });
      pc.set(gx - 1, cy - 6, [235, 250, 255]);
    } else rect(pc, cx - 2 - lx * 2, cy - 6, 4, 3, () => pick(P.copper, 3)); // the buckle at the back
  } else if (id === 'crown') { // a ring of leaves and small flowers round the sprout
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2, x = cx + Math.cos(a) * 7, y = cy - 8 + Math.sin(a) * 2.4;
      blob(pc, x, y, 1.6, 1.1, P.leaf.slice(3, 6), { style: 'smooth' });
      if (k % 3 === 0) { pc.set(x, y - 1, P.flowers[k % 2 ? 2 : 1]); pc.set(x + 1, y - 1, P.flowers[0]); }
    }
  } else { // a knitted scarf round the neck, its tail on the side away from the look
    for (let x = -5; x <= 5; x++) for (let y = 0; y < 3; y++) pc.set(cx + x, cy + 6 + y + (Math.abs(x) > 3 ? 1 : 0), pick(P.brick, 3.8 - y * 0.6 + ((x + y) % 2 ? 0.4 : 0)));
    for (let y = 0; y < 4; y++) for (let x = 0; x < 2; x++) pc.set(cx - lx * 4 + x, cy + 9 + y, pick(P.brick, 3 - y * 0.3 + (y % 2 ? 0.4 : 0))); // the loose end
  }
  pc.edgeDarken(0.65);
  return pc;
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
  const walk = pose === 'walk', work = pose === 'work', err = pose === 'error', cheer = pose === 'celebrate', sleep = pose === 'sleep', rest = pose === 'rest';

  // motion: the treads stay on the ground; body, head and arms carry the pose
  const { hop, lift, lean, shake } = poseMotion(facing, pose, frame);
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

  const light: readonly RGB[] = sleep ? P.slate.slice(1) : err ? P.brick.slice(3) : work ? P.glowTeal.slice(3) : cheer ? P.amber.slice(3) : P.amber.slice(2);
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
    if (sleep) { hx = sx + side * 2; hy = sy + 9; } // arms hang
    if (rest) { hx = sx + side * 5; hy = sy + 6; } // hands on the knees
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
    const eye: Eye = (pose === 'idle' && frame === 5) || sleep ? 'blink' : cheer || (work && frame >= 2) ? 'happy' : work ? 'focus' : err ? 'worried' : 'open';
    face(pc, hx, hy, lx, eye, walk ? lx * 0.8 : rest ? [-1.6, 0, 1.6, 0][frame] : 0.6 * lx); // resting, it looks about
    pc.set(hx + lx * 8.5, hy + 3.5, [232, 140, 120]); // rosy cheek
  } else {
    for (let k = 0; k < 3; k++) line(pc, hx - 3 - lx * 2, hy - 1 + k * 2, hx + 3 - lx * 2, hy - 1 + k * 2, pick(P.copper, 2.4)); // vent
  }

  const sway = walk ? [0, 1, 0, -1][frame] : pose === 'idle' ? [0, 0, 1, 1, 0, -1][frame] : err ? (frame ? 1 : -1) : cheer ? [0, -1, 0, 1][frame] : 0;
  sprout(pc, hx + (away ? 1 : -1), hy - 8, Math.max(0, Math.min(SPROUT_STAGES - 1, stage)), sway);
  pc.edgeDarken(0.6);
  return b;
}
