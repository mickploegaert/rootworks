import { hash2, vnoise } from '../../core/noise.ts';

export type RGB = readonly [number, number, number];

export const rgb = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
/** Colour ramp, dark -> light. */
export const ramp = (...hs: string[]): RGB[] => hs.map(rgb);
export const pick = (r: readonly RGB[], v: number): RGB => r[Math.max(0, Math.min(r.length - 1, Math.floor(v)))];
export const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const tint = (c: RGB, f: number): RGB => [c[0] * f, c[1] * f, c[2] * f];

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
/** 4x4 ordered-dither threshold in (0,1): add before flooring a ramp index for pixel-art gradients. */
export const bayer = (x: number, y: number): number => BAYER[(y & 3) * 4 + (x & 3)];

/** Cast-shadow colour: a warm plum, so shade reads as late-afternoon light rather than cold black. */
export const SHADOW: RGB = [46, 26, 40];

/** Light comes from the upper-left of the screen. */
export const LIGHT: readonly [number, number, number] = (() => {
  const l: [number, number, number] = [-0.55, -0.65, 0.52];
  const n = Math.hypot(...l);
  return [l[0] / n, l[1] / n, l[2] / n];
})();

/** CPU-side RGBA pixel buffer with hard-edged drawing helpers (no anti-aliasing, ever). */
export class PixelCanvas {
  readonly data: Uint8ClampedArray;

  constructor(readonly w: number, readonly h: number) {
    this.data = new Uint8ClampedArray(w * h * 4);
  }

  set(x: number, y: number, c: RGB, a = 255): void {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.data[i] = c[0]; this.data[i + 1] = c[1]; this.data[i + 2] = c[2]; this.data[i + 3] = a;
  }

  alpha(x: number, y: number): number {
    return x < 0 || y < 0 || x >= this.w || y >= this.h ? 0 : this.data[(y * this.w + x) * 4 + 3];
  }

  /** Darken pixels that touch transparency (selective outline). Bottom/right edges get the full factor. */
  edgeDarken(factor = 0.55): void {
    const src = this.data.slice();
    const a = (x: number, y: number) => (x < 0 || y < 0 || x >= this.w || y >= this.h ? 0 : src[(y * this.w + x) * 4 + 3]);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (!a(x, y)) continue;
      const bottomRight = !a(x, y + 1) || !a(x + 1, y);
      const topLeft = !a(x, y - 1) || !a(x - 1, y);
      if (!bottomRight && !topLeft) continue;
      const f = bottomRight ? factor : (1 + factor) / 2;
      const i = (y * this.w + x) * 4;
      this.data[i] *= f; this.data[i + 1] *= f * 0.9; this.data[i + 2] *= f * 0.98; // warm plum outline, never black
    }
  }

  toCanvas(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = this.w; c.height = this.h;
    c.getContext('2d')!.putImageData(new ImageData(this.data.slice(), this.w, this.h), 0, 0);
    return c;
  }
}

/** Even-odd polygon fill by pixel centres. `fn` returns the colour, or null to skip. */
export function fillPoly(pc: PixelCanvas, pts: readonly (readonly [number, number])[], fn: (x: number, y: number) => RGB | null, alpha = 255): void {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) {
    const px = x + 0.5, py = y + 0.5;
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
    if (!inside) continue;
    const c = fn(x, y);
    if (c) pc.set(x, y, c, alpha);
  }
}

export function line(pc: PixelCanvas, x0: number, y0: number, x1: number, y1: number, c: RGB): void {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= n; i++) pc.set(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), c);
}

export function rect(pc: PixelCanvas, x: number, y: number, w: number, h: number, fn: RGB | ((x: number, y: number) => RGB | null)): void {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const c = typeof fn === 'function' ? fn(x + i, y + j) : fn;
    if (c) pc.set(x + i, y + j, c);
  }
}

export interface BlobOpts {
  seed?: number;
  /** 'leaf' = clumpy foliage, 'rock' = hard facets, 'smooth' = dithered gradient. */
  style?: 'leaf' | 'rock' | 'smooth';
  /** Edge raggedness 0..1. */
  ragged?: number;
  /** Added to the lighting term; lets a whole canopy be lit as one object. */
  bias?: number;
  /** Extra per-pixel override, e.g. moss or ore flecks. Return null to keep the shaded colour. */
  paint?: (x: number, y: number, lit: number, dx: number, dy: number) => RGB | null;
}

/** A lit, textured ellipsoid. Drawing several, back to front, builds canopies, bushes and boulders. */
export function blob(pc: PixelCanvas, cx: number, cy: number, rx: number, ry: number, colors: readonly RGB[], o: BlobOpts = {}): void {
  const seed = o.seed ?? 0, style = o.style ?? 'smooth', ragged = o.ragged ?? 0.25;
  const n = colors.length;
  for (let y = Math.floor(cy - ry - 2); y <= Math.ceil(cy + ry + 2); y++) for (let x = Math.floor(cx - rx - 2); x <= Math.ceil(cx + rx + 2); x++) {
    const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
    const r2 = dx * dx + dy * dy;
    const lim = 1 + (vnoise(x * 0.4, y * 0.4, seed) - 0.5) * ragged * 2;
    if (r2 > lim) continue;
    const nz = Math.sqrt(Math.max(0, 1 - Math.min(1, r2)));
    let lit = (dx * LIGHT[0] + dy * LIGHT[1] + nz * LIGHT[2]) * 0.5 + 0.5; // 0..1
    if (style === 'leaf') {
      lit += (vnoise(x * 0.34 + seed, y * 0.42, seed) - 0.5) * 0.6 + (hash2(x, y, seed + 5) - 0.5) * 0.16 + (bayer(x, y) - 0.5) * 0.1;
    } else if (style === 'rock') {
      lit += (vnoise(x * 0.16, y * 0.16, seed) - 0.5) * 0.5 + (hash2(x, y, seed) - 0.5) * 0.06;
    } else lit += (bayer(x, y) - 0.5) * 0.18;
    lit += o.bias ?? 0;
    let idx = lit * (n - 0.01);
    if (style === 'rock') idx = Math.round(idx);
    const over = o.paint?.(x, y, lit, dx, dy);
    pc.set(x, y, over ?? pick(colors, idx));
  }
}

/** Soft dithered elliptical ground shadow. */
export function shadowEllipse(pc: PixelCanvas, cx: number, cy: number, rx: number, ry: number, alpha = 90): void {
  for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
    const r = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry);
    if (r <= 0.8 || (r <= 1 && bayer(x, y) > (r - 0.8) * 5)) pc.set(x, y, SHADOW, alpha);
  }
}

/** Shadow of a convex footprint swept along the light direction. */
export function shadowSweep(pc: PixelCanvas, foot: readonly (readonly [number, number])[], height: number, alpha = 90): void {
  const dx = height * 0.6, dy = height * 0.3;
  const all = [...foot, ...foot.map(([x, y]) => [x + dx, y + dy] as [number, number])];
  fillPoly(pc, hull(all), () => SHADOW, alpha);
}

function hull(points: (readonly [number, number])[]): [number, number][] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: readonly number[], a: readonly number[], b: readonly number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const build = (arr: (readonly [number, number])[]) => {
    const out: (readonly [number, number])[] = [];
    for (const pt of arr) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], pt) <= 0) out.pop();
      out.push(pt);
    }
    out.pop();
    return out;
  };
  return [...build(p), ...build(p.reverse())].map(([x, y]) => [x, y]);
}

/** Horizontally shear rows above `baseY` to make wind-sway frames that stay pixel-perfect. */
export function swayFrames(pc: PixelCanvas, baseY: number, amp: number, count = 5): PixelCanvas[] {
  const frames: PixelCanvas[] = [];
  for (let k = 0; k < count; k++) {
    const lean = amp * ((k - (count - 1) / 2) / ((count - 1) / 2));
    const f = new PixelCanvas(pc.w, pc.h);
    for (let y = 0; y < pc.h; y++) {
      const wgt = Math.max(0, (baseY - y) / baseY);
      const shift = Math.round(lean * wgt * wgt);
      for (let x = 0; x < pc.w; x++) {
        const sx = x - shift;
        if (sx < 0 || sx >= pc.w) continue;
        const si = (y * pc.w + sx) * 4, di = (y * pc.w + x) * 4;
        f.data[di] = pc.data[si]; f.data[di + 1] = pc.data[si + 1]; f.data[di + 2] = pc.data[si + 2]; f.data[di + 3] = pc.data[si + 3];
      }
    }
    frames.push(f);
  }
  return frames;
}
