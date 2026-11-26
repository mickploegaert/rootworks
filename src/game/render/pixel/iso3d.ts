import { TILE_H, TILE_W } from '../../core/iso.ts';
import { PixelCanvas, type RGB } from './PixelCanvas.ts';

const HW = TILE_W / 2; // 32 px per tile unit horizontally
const HH = TILE_H / 2; // 16 px per tile unit vertically

export interface Face {
  kind: 'top' | 'L' | 'R';
  /** Position along the face in px (top: along +x tile axis). */
  s: number;
  /** Height above the box base in px (top: along +y axis in px). */
  t: number;
  /** Face extents in px. */
  sw: number;
  th: number;
  x: number;
  y: number;
}

export interface BoxSpec {
  /** Footprint in tile units relative to the reference tile centre. */
  a0: number; b0: number; a1: number; b1: number;
  z0?: number; z1: number;
}

/** Screen point of tile-unit coords (a,b) at height z, relative to origin (ox,oy). */
export const isoPt = (ox: number, oy: number, a: number, b: number, z = 0): [number, number] => [ox + (a - b) * HW, oy + (a + b) * HH - z];

/** Allocates a canvas big enough for a w x d footprint of height h. Origin = centre of the reference tile. */
export function isoCanvas(w: number, d: number, h: number, pad = 6, extraTop = 0): { pc: PixelCanvas; ox: number; oy: number } {
  const left = d * HW + pad, right = w * HW + pad;
  const top = HH + h + pad + extraTop, bottom = (w + d - 1) * HH + pad + 8;
  return { pc: new PixelCanvas(Math.ceil(left + right), Math.ceil(top + bottom)), ox: Math.ceil(left), oy: Math.ceil(top) };
}

/** Footprint polygon (screen px) of a tile-unit rectangle, for shadows. */
export const footprint = (ox: number, oy: number, a0: number, b0: number, a1: number, b1: number): [number, number][] =>
  [isoPt(ox, oy, a0, b0), isoPt(ox, oy, a1, b0), isoPt(ox, oy, a1, b1), isoPt(ox, oy, a0, b1)];

/** Draws an axis-aligned isometric box by inverse-mapping every pixel to a face. */
export function drawBox(pc: PixelCanvas, ox: number, oy: number, box: BoxSpec, shade: (f: Face) => RGB | null): void {
  const { a0, b0, a1, b1 } = box, z0 = box.z0 ?? 0, z1 = box.z1;
  const top = isoPt(ox, oy, a0, b0, z1)[1] - 1, bot = isoPt(ox, oy, a1, b1, z0)[1] + 1;
  const xl = isoPt(ox, oy, a0, b1)[0] - 1, xr = isoPt(ox, oy, a1, b0)[0] + 1;
  for (let y = Math.floor(top); y <= Math.ceil(bot); y++) for (let x = Math.floor(xl); x <= Math.ceil(xr); x++) {
    const px = x + 0.5, py = y + 0.5, dx = (px - ox) / HW;
    // top face (z = z1)
    const sum = (py - oy + z1) / HH;
    let a = (sum + dx) / 2, b = (sum - dx) / 2;
    let f: Face | null = null;
    if (a >= a0 && a < a1 && b >= b0 && b < b1) {
      f = { kind: 'top', s: (a - a0) * HW, t: (b - b0) * HW, sw: (a1 - a0) * HW, th: (b1 - b0) * HW, x, y };
    } else {
      // left face (b = b1)
      a = dx + b1;
      let z = oy + (a + b1) * HH - py;
      if (a >= a0 && a < a1 && z >= z0 && z < z1) {
        f = { kind: 'L', s: (a - a0) * HW, t: z - z0, sw: (a1 - a0) * HW, th: z1 - z0, x, y };
      } else {
        // right face (a = a1)
        b = a1 - dx;
        z = oy + (a1 + b) * HH - py;
        if (b >= b0 && b < b1 && z >= z0 && z < z1) f = { kind: 'R', s: (b - b0) * HW, t: z - z0, sw: (b1 - b0) * HW, th: z1 - z0, x, y };
      }
    }
    if (!f) continue;
    const c = shade(f);
    if (c) pc.set(x, y, c);
  }
}

/** Upright cylinder. `shade` gets nx in [-1,1] across the body, t px above the base, and whether it is the top cap. */
export function drawCylinder(pc: PixelCanvas, ox: number, oy: number, R: number, h: number, shade: (nx: number, t: number, cap: boolean, x: number, y: number, ny: number) => RGB | null): void {
  const ry = R / 2;
  for (let y = Math.floor(oy - h - ry - 1); y <= Math.ceil(oy + ry + 1); y++) for (let x = Math.floor(ox - R - 1); x <= Math.ceil(ox + R + 1); x++) {
    const nx = (x + 0.5 - ox) / R;
    if (Math.abs(nx) > 1) continue;
    const e = Math.sqrt(1 - nx * nx) * ry;
    const py = y + 0.5;
    const capDy = (py - (oy - h)) / ry;
    if (nx * nx + capDy * capDy <= 1) {
      const c = shade(nx, h, true, x, y, capDy);
      if (c) pc.set(x, y, c);
    } else if (py >= oy - h && py <= oy + e) {
      const c = shade(nx, oy + e - py, false, x, y, 0);
      if (c) pc.set(x, y, c);
    }
  }
}

export interface GableSpec extends BoxSpec {
  /** Height (px) of the ridge above the eaves at z1. */
  ridge: number;
  /** Ridge runs along +x ('u') or +y ('v'). */
  axis: 'u' | 'v';
  /** How far (tile units) the roof sticks out past the walls. */
  overhang?: number;
}

export interface RoofFace {
  kind: 'front' | 'back' | 'gable';
  /** Roof: px along the ridge. Gable: px along the wall. */
  s: number;
  /** Roof: 0 at the eave .. 1 at the ridge. Gable: px above the eaves. */
  up: number;
  x: number;
  y: number;
}

/**
 * A pitched roof with a visible gable end, on top of walls drawn with drawBox (same spec, z0..z1).
 * Solved per pixel like drawBox: each roof plane is linear in screen space, so every pixel maps back
 * to exactly one point on it. Draw order is back slope, gable wall, front slope.
 */
export function drawGable(pc: PixelCanvas, ox: number, oy: number, g: GableSpec, shade: (f: RoofFace) => RGB | null): void {
  const o = g.overhang ?? 0.12, z = g.z1, R = g.ridge;
  const along = g.axis === 'u';
  // span across the ridge (c) and along it (l), in tile units
  const c0 = along ? g.b0 : g.a0, c1 = along ? g.b1 : g.a1, l0 = along ? g.a0 : g.b0, l1 = along ? g.a1 : g.b1;
  const half = (c1 - c0) / 2, mid = (c0 + c1) / 2, K = R / (HH * half);
  const top = oy - z - R - HH * 2, bot = oy + (g.a1 + g.b1 + 2 * o) * HH + 2;
  const xl = isoPt(ox, oy, g.a0 - o, g.b1 + o)[0] - 2, xr = isoPt(ox, oy, g.a1 + o, g.b0 - o)[0] + 2;
  const heightAt = (c: number) => z + R * (1 - Math.abs(c - mid) / half);

  for (let y = Math.floor(top); y <= Math.ceil(bot); y++) for (let x = Math.floor(xl); x <= Math.ceil(xr); x++) {
    const dx = (x + 0.5 - ox) / HW, sY = (y + 0.5 - oy) / HH;
    let hit: RoofFace | null = null;
    // back slope (rises toward the ridge from c0)
    {
      const c = along ? (sY - dx + (z - R * c0 / half) / HH) / (2 - K) : (sY + dx + (z - R * c0 / half) / HH) / (2 - K);
      const l = along ? dx + c : c - dx;
      if (c >= c0 - o && c <= mid && l >= l0 - o && l <= l1 + o) hit = { kind: 'back', s: (l - l0 + o) * HW, up: (c - c0 + o) / (half + o), x, y };
    }
    // gable wall at the far end of the ridge (the visible end)
    {
      const c = along ? g.a1 - dx : dx + g.b1; // b for axis u (R face), a for axis v (L face)
      const zz = along ? oy + (g.a1 + c) * HH - (y + 0.5) : oy + (c + g.b1) * HH - (y + 0.5);
      if (c >= c0 && c <= c1 && zz >= z && zz < heightAt(c)) hit = { kind: 'gable', s: (c - c0) * HW, up: zz - z, x, y };
    }
    // front slope (falls from the ridge toward c1)
    {
      const c = along ? (sY - dx + (z + R * c1 / half) / HH) / (2 + K) : (sY + dx + (z + R * c1 / half) / HH) / (2 + K);
      const l = along ? dx + c : c - dx;
      if (c >= mid && c <= c1 + o && l >= l0 - o && l <= l1 + o) hit = { kind: 'front', s: (l - l0 + o) * HW, up: (c1 + o - c) / (half + o), x, y };
    }
    if (!hit) continue;
    const col = shade(hit);
    if (col) pc.set(x, y, col);
  }
}
