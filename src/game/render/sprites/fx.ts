import { fbm, hash2 } from '../../core/noise.ts';
import { PixelCanvas, bayer, type RGB } from '../pixel/PixelCanvas.ts';

const unhex = (c: number): RGB => [(c >> 16) & 255, (c >> 8) & 255, c & 255];

/** Dithered radial light, drawn with additive blending. Quantised to a few steps to stay pixel-art. */
export function glowTexture(radius: number, color: number): PixelCanvas {
  const pc = new PixelCanvas(radius * 2, radius * 2), c = unhex(color);
  for (let y = 0; y < pc.h; y++) for (let x = 0; x < pc.w; x++) {
    const d = Math.hypot(x + 0.5 - radius, (y + 0.5 - radius) * 1.5) / radius;
    if (d >= 1) continue;
    const a = Math.floor((1 - d) * (1 - d) * 5 + bayer(x, y)) / 5;
    if (a > 0) pc.set(x, y, c, Math.min(255, a * 150));
  }
  return pc;
}

/** Soft grey smoke puff. */
export function smokeTexture(): PixelCanvas {
  const pc = new PixelCanvas(14, 14);
  for (let y = 0; y < 14; y++) for (let x = 0; x < 14; x++) {
    const d = Math.hypot(x - 6.5, y - 6.5) / 6.5 + (hash2(x, y, 4) - 0.5) * 0.35;
    if (d > 1) continue;
    const l = 150 + (1 - d) * 70 - (x + y > 14 ? 25 : 0);
    pc.set(x, y, [l, l + 4, l + 8], d > 0.72 && bayer(x, y) < 0.5 ? 0 : 255);
  }
  return pc;
}

export function moteTexture(color: number): PixelCanvas {
  const pc = new PixelCanvas(3, 3), c = unhex(color);
  pc.set(1, 1, c); pc.set(0, 1, c, 110); pc.set(2, 1, c, 110); pc.set(1, 0, c, 110); pc.set(1, 2, c, 110);
  return pc;
}

/** 4-point star twinkle. */
export function glintTexture(color: number): PixelCanvas {
  const pc = new PixelCanvas(7, 7), c = unhex(color);
  pc.set(3, 3, [255, 255, 255]);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) pc.set(3 + dx, 3 + dy, c);
  pc.set(3 + 2, 3, c, 150); pc.set(3 - 2, 3, c, 150); pc.set(3, 3 + 2, c, 150); pc.set(3, 3 - 2, c, 150);
  return pc;
}

/** Large drifting cloud shadow, dithered at the edge. */
export function cloudTexture(seed: number): PixelCanvas {
  const W = 220, H = 110, pc = new PixelCanvas(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = (x - W / 2) / (W / 2), dy = (y - H / 2) / (H / 2);
    const v = 1 - Math.hypot(dx, dy) + (fbm(x * 0.05, y * 0.09, 3, seed) - 0.5) * 0.9;
    const a = Math.floor(v * 4 + bayer(x, y) * 0.99) / 4;
    if (a > 0.2) pc.set(x, y, [8, 20, 24], Math.min(1, a) * 255);
  }
  return pc;
}

/** A tiny butterfly, wings open or folded (two frames make it flutter). */
export function butterflyTexture(color: number, open: boolean): PixelCanvas {
  const pc = new PixelCanvas(5, 4), c = unhex(color), dark: RGB = [60, 40, 40];
  pc.set(2, 1, dark); pc.set(2, 2, dark);
  if (open) { pc.set(0, 0, c); pc.set(1, 1, c); pc.set(0, 1, c); pc.set(4, 0, c); pc.set(3, 1, c); pc.set(4, 1, c); pc.set(1, 2, c); pc.set(3, 2, c); }
  else { pc.set(1, 0, c); pc.set(1, 1, c); pc.set(3, 0, c); pc.set(3, 1, c); }
  return pc;
}
