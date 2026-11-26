import { HEIGHT_UNIT, TILE_H, TILE_W } from '../core/iso.ts';
import { fbm, hash2, vnoise } from '../core/noise.ts';
import { MAX_HEIGHT, TileType, type World } from '../world/World.ts';
import { P } from './palette.ts';
import { PixelCanvas, bayer, mix, pick, tint, type RGB } from './pixel/PixelCanvas.ts';

/** How far (px) the sea sits below elevation 0: the drop at the island's edge, on top of a tile's elevation. */
export const CLIFF_EXTRA = 6;
const TOP = MAX_HEIGHT * HEIGHT_UNIT;
const MAX_WALL = MAX_HEIGHT * HEIGHT_UNIT + CLIFF_EXTRA;
export const WATER_FRAMES = 3;
/** Base colour of the open sea; the renderer clears to this so the sea reaches the screen edge. */
export const SEA_COLOR = 0x2c7186;

/** Soft ground darkening, e.g. under a tree canopy. World-space ground point and radii in px. */
export interface ShadeStamp { x: number; y: number; rx: number; ry: number; strength: number }

const NB: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Terrain chunk edge in tiles; matches the entity spatial index. */
export const TERRAIN_CHUNK = 16;
/** Offset so per-pixel noise uses positive, world-anchored coordinates: patterns line up across chunks. */
const PX0 = 1 << 14;

/** One baked chunk: RGBA pixels positioned in world space, plus its animated water overlay. */
export interface ChunkBake {
  cx: number;
  cy: number;
  /** World-space position of the top-left pixel. */
  x: number;
  y: number;
  w: number;
  h: number;
  pixels: Uint8ClampedArray;
  water: { x: number; y: number; w: number; h: number; frames: Uint8ClampedArray[] } | null;
}

/** Per-world data shared by all chunk bakes (computed once, e.g. inside the bake worker). */
export interface TerrainContext extends Ctx {}

export function terrainContext(world: World): TerrainContext {
  const N = world.width;
  const waterDepth = computeWaterDepth(world);
  const depthAt = (u: number, v: number) => {
    const fu = u - 0.5, fv = v - 0.5, i = Math.floor(fu), j = Math.floor(fv), a = fu - i, b = fv - j;
    const at = (x: number, y: number) => (world.inBounds(x, y) ? waterDepth[y * N + x] : 0);
    return at(i, j) * (1 - a) * (1 - b) + at(i + 1, j) * a * (1 - b) + at(i, j + 1) * (1 - a) * b + at(i + 1, j + 1) * a * b;
  };
  return { world, depthAt, mixed: mixedMask(world) };
}

/** Which tile's top surface is visible at a world-space point? (taller levels occlude lower ones) */
function surfaceAt(world: World, sx: number, sy: number) {
  for (let h = MAX_HEIGHT; h >= 0; h--) {
    const yy = sy + h * HEIGHT_UNIT;
    const u = sx / TILE_W + yy / TILE_H, v = yy / TILE_H - sx / TILE_W;
    const i = Math.floor(u), j = Math.floor(v);
    const t = world.get(i, j);
    if (t !== null && world.heightAt(i, j) === h) return { u, v, i, j, t, h };
  }
  return null;
}

const SEA_MARGIN = 44;
const enum K { Sea = 0, Surface = 1, Wall = 2 }

/**
 * Paints one 16 x 16-tile chunk. Every screen pixel is inverse-mapped to the terrain and belongs to
 * exactly one tile (its top surface, its cliff wall, or the sea in front of it); a chunk draws only the
 * pixels its own tiles own, so neighbouring chunks meet without seams or overlap. Outlines and the sea's
 * shallows look a little past the chunk edge so they continue across it.
 */
export function bakeChunk(tc: TerrainContext, cx: number, cy: number, stamps: ShadeStamp[]): ChunkBake {
  const { world } = tc;
  const S = TERRAIN_CHUNK, tx0 = cx * S, ty0 = cy * S, tx1 = tx0 + S, ty1 = ty0 + S;
  const left = (tx0 - ty1) * (TILE_W / 2), right = (tx1 - ty0) * (TILE_W / 2);
  const top = (tx0 + ty0) * (TILE_H / 2) - TOP - 2, bottom = (tx1 + ty1) * (TILE_H / 2) + MAX_WALL + 2;
  const W = right - left, H = bottom - top;
  // analysis region: the chunk plus a margin for outlines and sea distance
  const rx = left - SEA_MARGIN, ry = top - SEA_MARGIN, RW = W + SEA_MARGIN * 2, RH = H + SEA_MARGIN * 2;
  const kind = new Uint8Array(RW * RH);
  const own = new Uint8Array(RW * RH);
  const info: ({ u: number; v: number; t: TileType; d: number; wallH: number; left: boolean; h: number; toWater: boolean; toSea: boolean } | undefined)[] = new Array(RW * RH);
  const inChunk = (i: number, j: number) => i >= tx0 && i < tx1 && j >= ty0 && j < ty1;

  for (let px = 0; px < RW; px++) {
    const sx = rx + px + 0.5;
    let lastSurface = -1e9;
    // start above the region so walls hanging into it from higher tiles are found
    for (let py = -MAX_WALL; py < RH; py++) {
      const sy = ry + py + 0.5;
      const s = surfaceAt(world, sx, sy);
      if (py < 0) { if (s) lastSurface = py; continue; }
      const k = py * RW + px;
      if (s) {
        lastSurface = py;
        kind[k] = K.Surface;
        own[k] = inChunk(s.i, s.j) ? 1 : 0;
        if (own[k]) info[k] = { u: s.u, v: s.v, t: s.t, d: 0, wallH: 0, left: false, h: s.h, toWater: false, toSea: false };
        continue;
      }
      if (py - lastSurface > MAX_WALL) { // open sea in front of this tile
        const u = sx / TILE_W + sy / TILE_H, v = sy / TILE_H - sx / TILE_W;
        own[k] = inChunk(Math.floor(u), Math.floor(v)) ? 1 : 0;
        continue;
      }
      // cliff wall: the nearest top surface above whose wall reaches this far down
      for (let d = 1; d <= MAX_WALL; d++) {
        const w = surfaceAt(world, sx, sy - d);
        if (!w) continue;
        const isLeft = sx < (w.i - w.j) * (TILE_W / 2);
        const nb = isLeft ? [w.i, w.j + 1] : [w.i + 1, w.j];
        const nbT = world.get(nb[0], nb[1]);
        const wallH = nbT === null ? w.h * HEIGHT_UNIT + CLIFF_EXTRA : (w.h - world.heightAt(nb[0], nb[1])) * HEIGHT_UNIT;
        if (d > wallH) continue; // no wall facing here (an inner corner): look further up
        kind[k] = K.Wall;
        own[k] = inChunk(w.i, w.j) ? 1 : 0;
        if (own[k]) info[k] = { u: w.u, v: w.v, t: w.t, d, wallH, left: isLeft, h: w.h, toWater: nbT === TileType.Water, toSea: nbT === null };
        break;
      }
      if (kind[k] === K.Sea) {
        const u = sx / TILE_W + sy / TILE_H, v = sy / TILE_H - sx / TILE_W;
        own[k] = inChunk(Math.floor(u), Math.floor(v)) ? 1 : 0;
      }
    }
  }

  // canopy shade, rasterised in chunk space
  const shade = new Float32Array(W * H);
  for (const s of stamps) {
    const cxp = s.x - left, cyp = s.y - top;
    for (let y = Math.floor(cyp - s.ry); y <= cyp + s.ry; y++) for (let x = Math.floor(cxp - s.rx); x <= cxp + s.rx; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const r = Math.hypot((x - cxp) / s.rx, (y - cyp) / s.ry);
      if (r >= 1) continue;
      const a = (Math.floor((1 - r) * 3 + bayer(x + PX0, y + PX0)) / 3) * s.strength;
      shade[y * W + x] = Math.max(shade[y * W + x], a);
    }
  }

  // distance to land (for the sea's shallows), chamfer over the whole region
  const dist = new Float32Array(RW * RH);
  for (let i = 0; i < dist.length; i++) dist[i] = kind[i] ? 0 : 1e9;
  for (let y = 0; y < RH; y++) for (let x = 0; x < RW; x++) {
    const i = y * RW + x;
    if (x > 0) dist[i] = Math.min(dist[i], dist[i - 1] + 1);
    if (y > 0) dist[i] = Math.min(dist[i], dist[i - RW] + 1, x > 0 ? dist[i - RW - 1] + 1.4 : 1e9, x < RW - 1 ? dist[i - RW + 1] + 1.4 : 1e9);
  }
  for (let y = RH - 1; y >= 0; y--) for (let x = RW - 1; x >= 0; x--) {
    const i = y * RW + x;
    if (x < RW - 1) dist[i] = Math.min(dist[i], dist[i + 1] + 1);
    if (y < RH - 1) dist[i] = Math.min(dist[i], dist[i + RW] + 1, x < RW - 1 ? dist[i + RW + 1] + 1.4 : 1e9, x > 0 ? dist[i + RW - 1] + 1.4 : 1e9);
  }

  const pc = new PixelCanvas(W, H);
  const surf: number[] = [], falls: number[] = [];
  const isSea = (x: number, y: number) => x < 0 || y < 0 || x >= RW || y >= RH || kind[y * RW + x] === K.Sea;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const rxp = x + SEA_MARGIN, ryp = y + SEA_MARGIN, k = ryp * RW + rxp;
    if (!own[k]) continue;
    const gx = Math.floor(left + x) + PX0, gy = Math.floor(top + y) + PX0;
    let c: RGB;
    if (kind[k] === K.Sea) c = seaColor(gx, gy, dist[k]);
    else {
      const f = info[k]!;
      if (kind[k] === K.Surface) {
        c = topColor(tc, f.u, f.v, gx, gy, f.t, 0);
        const sh = shade[y * W + x];
        if (sh > 0) c = tint(c, 1 - sh * 0.38);
        if ((f.t === TileType.Water || tc.mixed[Math.floor(f.v) * world.width + Math.floor(f.u)]) && resolveType(world, f.u, f.v, f.t) === TileType.Water) surf.push(y * W + x, f.u, f.v, f.t, sh);
      } else if (f.t === TileType.Water) {
        c = waterfallColor(gx, f.d, f.wallH, 0);
        falls.push(y * W + x, f.d, f.wallH);
      } else c = wallColor(gx, f.d, f.left, f.t, f.h, f.wallH, f.toWater, f.toSea);
      // selective outline where land meets sea
      const bottomRight = isSea(rxp, ryp + 1) || isSea(rxp + 1, ryp);
      const topLeft = isSea(rxp, ryp - 1) || isSea(rxp - 1, ryp);
      if (bottomRight || topLeft) { const fct = bottomRight ? 0.5 : 0.75; c = [c[0] * fct, c[1] * fct * 0.9, c[2] * fct * 0.98]; }
    }
    pc.set(x, y, c);
  }

  let water: ChunkBake['water'] = null;
  if (surf.length || falls.length) {
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    const grow = (i: number) => { const x = i % W, y = (i - x) / W; x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); y0 = Math.min(y0, y); y1 = Math.max(y1, y + 1); };
    for (let k = 0; k < surf.length; k += 5) grow(surf[k]);
    for (let k = 0; k < falls.length; k += 3) grow(falls[k]);
    const frames: Uint8ClampedArray[] = [];
    for (let f = 0; f < WATER_FRAMES; f++) {
      const fc = new PixelCanvas(x1 - x0, y1 - y0);
      for (let k = 0; k < surf.length; k += 5) {
        const i = surf[k], x = i % W, y = (i - x) / W;
        const c = topColor(tc, surf[k + 1], surf[k + 2], Math.floor(left + x) + PX0, Math.floor(top + y) + PX0, surf[k + 3] as TileType, f);
        fc.set(x - x0, y - y0, surf[k + 4] > 0 ? tint(c, 1 - surf[k + 4] * 0.38) : c);
      }
      for (let k = 0; k < falls.length; k += 3) {
        const i = falls[k], x = i % W, y = (i - x) / W;
        fc.set(x - x0, y - y0, waterfallColor(Math.floor(left + x) + PX0, falls[k + 1], falls[k + 2], f));
      }
      frames.push(fc.data);
    }
    water = { x: left + x0, y: top + y0, w: x1 - x0, h: y1 - y0, frames };
  }
  return { cx, cy, x: left, y: top, w: W, h: H, pixels: pc.data, water };
}

/** Open sea: shallow turquoise near land with a ring of surf, fading to the flat colour the renderer clears to. */
function seaColor(x: number, y: number, d: number): RGB {
  const base: RGB = [(SEA_COLOR >> 16) & 255, (SEA_COLOR >> 8) & 255, SEA_COLOR & 255];
  if (d < 3) return pick(P.water, 5.6 + (hash2(x, y, 9) > 0.6 ? 0.8 : 0));
  if (d < 7) return hash2(x >> 1, y, 4) > 0.45 ? pick(P.water, 4.6) : pick(P.water, 3.6);
  if (d < 40) {
    const k = (d - 7) / 33;
    let c = mix(pick(P.water, 3.2), base, Math.floor(k * 4 + bayer(x, y)) / 4);
    if (y % 4 === 0 && hash2(Math.floor(x / 6), y, 12) < 0.05 * (1 - k)) c = mix(c, pick(P.water, 5), 0.45);
    return c;
  }
  return hash2(x, y, 11) < 0.0016 ? pick(P.water, 4.5) : base;
}

/** Falling water: bright streaks sliding downward, foam where it lands. */
function waterfallColor(px: number, d: number, wallH: number, phase: number): RGB {
  const fromBottom = wallH - d;
  if (fromBottom < 3) return pick(P.water, 5.2 + hash2(px, phase * 7 + fromBottom, 3) * 1.8); // churning foam
  if (d < 2) return pick(P.water, 6); // the lip catches the light
  // vertical ribbons of water; bright highlights slide down them
  const lane = hash2(Math.floor(px / 2), 0, 5);
  const slide = (d + phase * (wallH / 3) + lane * wallH) % wallH;
  return pick(P.water, 3.6 + lane * 1.4 + (slide < 2.5 ? 1.6 : 0));
}

function computeWaterDepth(world: World): Float32Array {
  const N = world.width, out = new Float32Array(N * N);
  let frontier: number[] = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (world.get(x, y) !== TileType.Water) continue;
    if (NB.some(([dx, dy]) => world.get(x + dx, y + dy) !== TileType.Water)) { out[y * N + x] = 1; frontier.push(y * N + x); }
  }
  for (let d = 2; frontier.length; d++) {
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % N, y = Math.floor(i / N);
      for (const [dx, dy] of NB) {
        const nx = x + dx, ny = y + dy;
        if (world.get(nx, ny) === TileType.Water && !out[ny * N + nx]) { out[ny * N + nx] = d; next.push(ny * N + nx); }
      }
    }
    frontier = next;
  }
  return out;
}

/** Tile type at a point after organic border wobble. Concrete stays crisp and never spills. */
function resolveType(world: World, u: number, v: number, t0: TileType): TileType {
  const amp = t0 === TileType.Concrete ? 0.1 : 0.55;
  const du = (vnoise(u * 2.3, v * 2.3, 11) - 0.5) * amp, dv = (vnoise(u * 2.3 + 40, v * 2.3 + 17, 12) - 0.5) * amp;
  const t = world.get(Math.floor(u + du), Math.floor(v + dv)) ?? t0;
  return t === TileType.Concrete && t0 !== TileType.Concrete ? t0 : t;
}

/** Type of the (wobbled) neighbour at an offset, for edge treatments. */
function neighbour(world: World, u: number, v: number, du: number, dv: number, t0: TileType): TileType {
  return resolveType(world, u + du, v + dv, t0);
}

const isGrassy = (t: TileType) => t === TileType.Grass || t === TileType.Moss;
const isEarth = (t: TileType) => t === TileType.Dirt || t === TileType.Path || t === TileType.Shore;

function cliffRamp(t: TileType, h: number) {
  return t === TileType.Rock || h >= 3 ? P.stone : P.dirt;
}

function wallColor(px: number, d: number, left: boolean, t: TileType, h: number, wallH: number, toWater: boolean, toSea: boolean): RGB {
  const lit = left ? 0.9 : 0;
  const fromBottom = wallH - d;
  if (toSea && fromBottom < 2) return pick(P.water, 5.4 + hash2(px, d, 6) * 1.2); // surf at the foot
  if (t === TileType.Sand) return pick(P.sand, 1.6 + lit + (d < 2 ? 1.6 : 0) - (toSea && fromBottom < 4 ? 1 : 0) + (hash2(px, d, 2) - 0.5) * 0.6);
  if (t === TileType.Concrete) {
    // dressed cream stone: staggered blocks with dark joints, moss and a little ivy at the foot
    if (d < 2) return pick(P.cream, 3.4 + lit * 0.6);
    const row = Math.floor((d - 2) / 6), off = (row % 2) * 8;
    if ((d - 2) % 6 < 1 || (px + off) % 16 < 1) return pick(P.cream, 0.6 + lit * 0.5);
    if (hash2(Math.floor(px / 3), 7, 2) < 0.16 && d < 5 + hash2(Math.floor(px / 3), 7, 3) * 12) return pick(P.leaf, 1.8 + lit * 0.8 + hash2(px, d, 4) * 2.4);
    if (fromBottom < 4 && vnoise(px * 0.4, 0, 9) > 0.45) return pick(P.moss, 2 + hash2(px, d, 2) * 2);
    return pick(P.cream, 1.7 + lit + (hash2(Math.floor((px + off) / 16), row, 5) - 0.5) * 0.9);
  }
  if (isGrassy(t) && d <= 2) return pick(P.grass, 1.2 + (d === 1 ? 1.6 : 0.4) + hash2(px, d, 3) * 1.6 + lit * 0.3);
  const ramp = cliffRamp(t, h);
  const strata = (d + vnoise(px * 0.05, 0, 4) * 9) / 7;
  const band = Math.floor(strata) % 2;
  let idx = 1.3 + lit + band * 0.8 + (vnoise(px * 0.2, d * 0.35, 5) - 0.5) * 1.3 - d * 0.02;
  const hh = hash2(px, d, 7);
  if (hh < 0.05) idx += 1.5; else if (hh > 0.95) idx -= 1;
  if (ramp === P.dirt && hash2(Math.floor(px / 3), 0, 9) < 0.13 && d < 13) return pick(P.bark, 1.3 + lit * 0.5); // roots
  if (d <= 5 && hh > 0.4 && (isGrassy(t) || t === TileType.Rock)) return pick(P.moss, 1.4 + lit * 0.8 + hh);
  if (vnoise(px * 0.12, d * 0.2, 12) > 0.7 && d < wallH * 0.6) return pick(P.moss, 1 + lit * 0.5 + hh * 1.5);
  const base = pick(ramp, idx);
  if (toWater && fromBottom < 3) return mix(base, [20, 70, 90], 0.45); // wet line
  return fromBottom < 3 ? tint(base, 0.78) : base;
}

interface Ctx { world: World; depthAt: (u: number, v: number) => number; mixed: Uint8Array }

/** Tiles whose 3x3 neighbourhood holds more than one type: only these need border treatment. */
function mixedMask(world: World): Uint8Array {
  const N = world.width, out = new Uint8Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const t = world.get(x, y);
    for (let dy = -1; dy <= 1 && !out[y * N + x]; dy++) for (let dx = -1; dx <= 1; dx++) {
      const n = world.get(x + dx, y + dy);
      if (n !== null && n !== t) { out[y * N + x] = 1; break; }
    }
  }
  return out;
}

function topColor(ctx: Ctx, u: number, v: number, px: number, py: number, t0: TileType, phase: number): RGB {
  const { world, depthAt } = ctx;
  const mixed = ctx.mixed[Math.floor(v) * world.width + Math.floor(u)] === 1;
  const t = mixed ? resolveType(world, u, v, t0) : t0;
  const h = hash2(px, py, 1);
  const b = bayer(px, py);

  switch (t) {
    case TileType.Grass:
    case TileType.Moss: {
      const forest = t === TileType.Moss;
      const g = fbm(u * 0.95, v * 0.95, 3, 5);
      const sun = clamp01((fbm(u * 0.33 + 10, v * 0.33, 2, 6) - 0.36) * 3.2);
      let base = (forest ? 1.6 : 2.5) + (g - 0.5) * 3.6;
      // nearby earth: ragged, lighter grass fringe
      let fringe = false;
      if (mixed) for (const [a, c] of NB) if (isEarth(neighbour(world, u, v, a * 0.11, c * 0.11, t0))) { fringe = true; break; }
      if (fringe) base += 1.1;
      let idx = Math.floor(base + b * 0.9);
      // vertical grass-blade tufts
      const cx = px >> 2, cy = py >> 2;
      if (hash2(cx, cy, 31) < (forest ? 0.1 : 0.17)) {
        const ox = px & 3, oy = py & 3;
        if (ox === 1 && oy === 3) idx -= 1;
        else if (ox === 1 && oy === 2) idx += 1;
        else if (ox === 1 && oy === 1) idx += 2;
        else if (ox === 2 && oy === 2) idx += 1;
        else if (ox === 0 && oy === 2 && hash2(cx, cy, 32) > 0.5) idx += 1;
      }
      if (h > 0.972) idx -= 1;
      let col: RGB;
      if (forest) col = pick(P.moss, idx);
      else col = mix(pick(P.grassCool, idx), pick(P.grassWarm, idx), sun);
      if (forest && hash2(px, py, 21) < 0.014) return pick(P.rust, 2.4 + h * 3); // leaf litter
      if (forest && hash2(px >> 1, py >> 1, 24) < 0.01) return pick(P.maple, 2.5 + h * 3);
      if (!forest) {
        const meadow = fbm(u * 0.55 + 7, v * 0.55, 2, 40);
        if (meadow > 0.56 && hash2(px * 5, py * 3, 22) < (meadow - 0.5) * 0.03) return pick(P.flowers, hash2(px, py, 23) * 5);
        if (hash2(px, py, 25) < 0.003) return pick(P.stone, 3 + h * 2);
      }
      return col;
    }
    case TileType.Dirt:
    case TileType.Path: {
      const n = fbm(u * 3, v * 3, 3, 8);
      let base = (t === TileType.Path ? 3.0 : 2.1) + (n - 0.5) * 3.2;
      if (mixed) for (const [a, c] of NB) if (isGrassy(neighbour(world, u, v, a * 0.1, c * 0.1, t0))) { base -= 0.9; break; }
      if (t === TileType.Path && Math.abs(vnoise(u * 5, v * 5, 18) - 0.5) < 0.05) base -= 0.9; // wheel-rut scuffs
      if (h < 0.014) return pick(P.stone, 2 + h * 100);
      if (h > 0.985) return pick(P.grass, 1 + b * 2);
      return pick(P.dirt, base + b * 0.9 + (h < 0.07 ? 0.9 : 0));
    }
    case TileType.Rock: {
      const n = fbm(u * 3.2, v * 3.2, 3, 44);
      const m = fbm(u * 2.4, v * 2.4, 3, 45);
      let idx = 2.2 + (n - 0.5) * 3 + b * 0.8;
      if (Math.abs(fbm(u * 4, v * 4, 3, 46) - 0.5) < 0.02) idx = 0.3;
      if (m > 0.55 && hash2(px, py, 47) < (m - 0.5) * 5) return pick(P.moss, 1.5 + b * 2.5);
      return pick(P.stone, idx);
    }
    case TileType.Sand: {
      const n = fbm(u * 2.4, v * 2.4, 3, 70);
      if (h < 0.006) return pick(P.flowers, 0); // shells
      if (h > 0.994) return pick(P.stone, 3 + b);
      const ripple = Math.sin((u - v) * 9 + n * 6) > 0.8 ? 0.7 : 0;
      return pick(P.sand, 2.6 + (n - 0.5) * 2 + ripple + (b - 0.5) * 0.8);
    }
    case TileType.Shore: {
      const n = fbm(u * 3.4, v * 3.4, 2, 14);
      let wet = false;
      if (mixed) for (const [a, c] of NB) if (neighbour(world, u, v, a * 0.16, c * 0.16, t0) === TileType.Water) { wet = true; break; }
      if (h < 0.02) return pick(P.stone, 2.5 + b * 2);
      return pick(P.dirt, (wet ? 0.5 : 1.4) + (n - 0.5) * 2.6 + b * 0.8);
    }
    case TileType.Water: {
      const d = depthAt(u, v);
      const r1 = Math.sin((u * 1.6 + v * 1.2) * 9 + phase * 1.57 + fbm(u * 2, v * 2, 2, 15) * 7);
      const r2 = Math.sin((u * 0.8 - v * 1.9) * 13 - phase * 1.1 + fbm(u * 3, v * 3, 2, 17) * 5);
      let val = 3.7 - Math.min(d, 3.4) * 0.6 + r1 * 0.3 + r2 * 0.2 + (fbm(u * 5, v * 5, 2, 16) - 0.5) * 0.7;
      // sky reflection: long pale streaks drifting across the surface
      if (r1 > 0.8 && r2 > 0.1) val += 1.4;
      if (hash2(px, py, 50 + phase) < 0.004) val = 6.4;
      let edge = false;
      if (mixed) for (const [a, c] of NB) if (neighbour(world, u, v, a * 0.13, c * 0.13, t0) !== TileType.Water) { edge = true; break; }
      if (edge) val = 5.1 + (h > 0.5 ? 0.6 : 0);
      let col = pick(P.water, val + (b - 0.5) * 0.9);
      // reflected tree line darkens the water near the bank
      const refl = clamp01(1.5 - d) * (0.35 + 0.15 * Math.sin(u * 7 + phase));
      col = mix(col, [22, 62, 50], refl * (edge ? 0 : 1));
      return col;
    }
    case TileType.Concrete: {
      // cobbled yard: staggered rows of rounded stones laid on the tile grid, moss in the joints
      const row = Math.floor(v * 4.5), off = (row % 2) * 0.5;
      const cu = u * 4.5 + off, cell = Math.floor(cu);
      const fu = cu - cell, fv = v * 4.5 - row;
      const edge = Math.min(fu, 1 - fu, fv, 1 - fv);
      const stone = hash2(cell, row, 61);
      // raised yard lip: light on the far edges, shadow on the near ones
      let lip = 0;
      if (mixed && neighbour(world, u, v, -0.07, -0.07, t0) !== TileType.Concrete) lip = 1.6;
      else if (mixed && neighbour(world, u, v, 0.05, 0.05, t0) !== TileType.Concrete) lip = -1.2;
      if (edge < 0.1) {
        const m = fbm(u * 2.6, v * 2.6, 2, 51);
        return m > 0.5 && h < (m - 0.4) * 1.4 ? pick(P.moss, 2.2 + b * 2) : pick(P.concrete, 0.6 + lip * 0.5);
      }
      // each stone is lit like a little dome: bright upper-left, darker lower-right
      const dome = (0.5 - fu) * 0.9 + (0.5 - fv) * 0.9;
      let idx = 2.7 + dome + (stone - 0.5) * 1.6 + lip + (b - 0.5) * 0.5;
      if (edge < 0.17) idx -= 0.6;
      const col = pick(P.concrete, idx);
      return stone > 0.9 ? mix(col, pick(P.brick, 3), 0.35) : stone < 0.07 ? mix(col, pick(P.cream, 3), 0.4) : col;
    }
  }
}
