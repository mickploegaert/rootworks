import { P } from '../palette.ts';
import { PixelCanvas, blob, line, pick, shadowEllipse } from '../pixel/PixelCanvas.ts';
import { drawBox, isoCanvas } from '../pixel/iso3d.ts';
import type { Built } from './types.ts';

const BIAS = { top: 3.4, L: 2.6, R: 1.4 } as const;
/** Screen direction (dx, dy) each facing looks toward: 0:+x(SE) 1:+y(SW) 2:-x(NW) 3:-y(NE). */
const LOOK: readonly [number, number][] = [[1, 0.5], [-1, 0.5], [-1, -0.5], [1, -0.5]];

/**
 * One frame of the worker robot: a little cream-and-copper machine on rubber treads with a round
 * head, one big friendly eye and a lamp on its antenna.
 * facing: 0..3 as above; anim 0/1 alternates tread stripes, the antenna lamp and a small head bob.
 */
export function robotFrame(facing: number, anim: number): Built {
  const { pc, ox, oy } = isoCanvas(1, 1, 40, 8, 8);
  const b: Built = { pc, ox, oy, shadow: new PixelCanvas(pc.w, pc.h) };
  shadowEllipse(b.shadow!, ox + 4, oy + 3, 14, 5, 85);
  const alongU = facing === 0 || facing === 2;
  const away = facing >= 2;

  const tread = (c: number) => {
    const spec = alongU ? { a0: -0.3, a1: 0.3, b0: c - 0.09, b1: c + 0.09 } : { b0: -0.3, b1: 0.3, a0: c - 0.09, a1: c + 0.09 };
    drawBox(pc, ox, oy, { ...spec, z1: 6 }, (f) => {
      if (f.kind === 'top') return pick(P.slate, 1.6);
      const stripe = (f.s + anim * 3) % 5 < 2.5;
      if (f.t > 4.5 || f.t < 1) return pick(P.slate, 0.6);
      return pick(P.slate, (stripe ? 2.2 : 1.2) + (f.kind === 'L' ? 0.6 : 0));
    });
  };

  tread(-0.26);
  // body: cream shell with a copper belly band and a little hatch
  drawBox(pc, ox, oy, { a0: -0.21, b0: -0.21, a1: 0.21, b1: 0.21, z0: 4, z1: 16 }, (f) => {
    if (f.kind === 'top') return pick(P.cream, 4.6);
    if (f.t > 6 && f.t < 9) return pick(P.copper, BIAS[f.kind] + 1.4);
    if (f.t < 2) return pick(P.copper, BIAS[f.kind] - 0.4);
    if (Math.abs(f.s - f.sw / 2) < 2.5 && f.t > 10 && f.t < 14) return pick(P.amber, 3.4 + anim); // status light
    return pick(P.cream, BIAS[f.kind] + 0.9 - (f.s < 1 || f.s > f.sw - 1 ? 0.8 : 0));
  });
  tread(0.26);

  // little copper arms on both visible sides
  const [lx] = LOOK[facing];
  for (const side of [-1, 1]) {
    const ax = ox + side * 11, ay = oy - 10 + (side === Math.sign(lx) ? 1 : 0);
    line(pc, ax, ay - 3, ax + side, ay + 2, pick(P.copper, 3.5));
    pc.set(ax + side, ay + 3, pick(P.copper, 5));
  }

  // round head that bobs a pixel
  const hx = ox, hy = oy - 24 - (anim ? 1 : 0);
  line(pc, hx, hy + 7, hx, hy + 9, pick(P.slate, 2)); // neck
  blob(pc, hx, hy, 9.5, 8.5, P.cream.slice(1), { style: 'smooth' });
  for (let x = hx - 8; x <= hx + 8; x++) if (pc.alpha(x, hy + 5)) pc.set(x, hy + 5, pick(P.copper, 3 - (x - hx) * 0.08)); // chin seam

  if (!away) {
    // the eye: dark glass, warm iris, a sparkle
    const ex = hx + lx * 3.5, ey = hy + 0.5;
    blob(pc, ex, ey, 4.2, 4.4, [P.slate[0], P.slate[1]], { style: 'smooth' });
    blob(pc, ex + lx * 0.6, ey + 0.5, 2, 2.2, P.amber.slice(3), { style: 'smooth' });
    pc.set(ex - 1, ey - 2, [255, 248, 230]);
    pc.set(ex - 2, ey - 1, [255, 248, 230]);
    // rosy cheek on the far side of the face
    pc.set(ex + lx * 5, ey + 3, [232, 140, 120]);
  } else {
    // back of the head: a copper vent plate
    for (let k = 0; k < 3; k++) line(pc, hx - 3 - lx * 2, hy - 1 + k * 2, hx + 3 - lx * 2, hy - 1 + k * 2, pick(P.copper, 2.4));
  }

  // antenna with a warm lamp
  const tx = hx + (away ? 2 : -2), top = hy - 15;
  line(pc, hx, hy - 8, tx, top + 2, pick(P.copper, 3));
  blob(pc, tx, top, 2, 2, anim ? P.amber.slice(3) : P.amber.slice(1, 4), { style: 'smooth' });
  if (anim) pc.set(tx, top - 1, [255, 250, 220]);
  pc.edgeDarken(0.6);
  return b;
}
