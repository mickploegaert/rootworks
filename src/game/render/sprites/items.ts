import type { ResourceId } from '../../resources/ResourceDefs.ts';
import { P } from '../palette.ts';
import { PixelCanvas, blob, line, pick, rect, type RGB } from '../pixel/PixelCanvas.ts';

/** Item icons are 16 x 16, lit from the top left like the world, with a warm plum outline. */
export const ICON = 16;
const OUTLINE: RGB = [52, 30, 36];

/** Draw a 1px outline around everything painted so far, so icons read on any panel colour. */
function outline(pc: PixelCanvas): void {
  const solid = (x: number, y: number) => pc.alpha(x, y) > 0;
  const edge: [number, number][] = [];
  for (let y = 0; y < pc.h; y++) for (let x = 0; x < pc.w; x++) {
    if (!solid(x, y) && (solid(x + 1, y) || solid(x - 1, y) || solid(x, y + 1) || solid(x, y - 1))) edge.push([x, y]);
  }
  for (const [x, y] of edge) pc.set(x, y, OUTLINE);
}

/** A log seen from the front-left: bark body and a pale end with growth rings. */
function log(pc: PixelCanvas, x: number, y: number, len: number): void {
  for (let i = 0; i < len; i++) for (let j = 0; j < 4; j++) pc.set(x + i, y + j, pick(P.bark, j === 0 ? 4 : j === 3 ? 1 : 2.6 + ((i * 7 + j * 3) % 5 === 0 ? -1 : 0)));
  line(pc, x + 1, y + 1, x + len - 2, y + 1, pick(P.bark, 3)); // bark ridge
  // end grain: a 4x4 rounded face with rings
  const ex = x - 2;
  const face = [[1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [3, 1], [0, 2], [1, 2], [2, 2], [3, 2], [1, 3], [2, 3]];
  for (const [i, j] of face) pc.set(ex + i, y + j, pick(P.sand, 3.5 - j * 0.4));
  pc.set(ex + 1, y + 1, pick(P.wood, 4)); pc.set(ex + 2, y + 2, pick(P.wood, 3.6));
}

function timber(pc: PixelCanvas): void {
  log(pc, 5, 9, 9);
  log(pc, 3, 5, 9);
  log(pc, 7, 1, 7);
  pc.set(14, 4, pick(P.leaf, 4)); pc.set(15, 3, pick(P.leaf, 5)); // a fresh leaf sprig
}

function fieldstone(pc: PixelCanvas): void {
  blob(pc, 10.5, 10, 4.6, 3.8, P.stone.slice(0, 6), { style: 'rock', seed: 3, ragged: 0.1, bias: -0.08 });
  blob(pc, 5.5, 11, 3.8, 3.2, P.stone.slice(0, 5), { style: 'rock', seed: 7, ragged: 0.1, bias: -0.05 });
  blob(pc, 8, 5.5, 3.4, 3, P.stone.slice(1, 6), { style: 'rock', seed: 11, ragged: 0.1 });
  pc.set(7, 4, pick(P.stone, 6)); pc.set(9, 8, pick(P.stone, 5)); // specular glints
  pc.set(12, 12, pick(P.moss, 4)); pc.set(13, 12, pick(P.moss, 3)); pc.set(4, 13, pick(P.moss, 3));
}

function ore(pc: PixelCanvas, vein: readonly RGB[], seed: number, sparkle: RGB): void {
  blob(pc, 8, 9, 6.2, 5.4, P.slate, { style: 'rock', seed, ragged: 0.22,
    paint: (x, y, lit) => {
      const v = Math.sin(x * 1.3 + y * 0.7 + seed) + Math.sin(x * 0.4 - y * 1.6);
      return v > 1.1 ? pick(vein, lit * vein.length) : null;
    },
  });
  pc.set(6, 6, sparkle); pc.set(10, 9, sparkle); pc.set(5, 11, sparkle);
}

function scrap(pc: PixelCanvas): void {
  // a bent plate behind
  for (let j = 0; j < 6; j++) for (let i = 0; i < 8 - (j >> 1); i++) pc.set(1 + i + j, 9 + j - (i >> 2), pick(P.rust, 4 - j * 0.4 + ((i + j) % 4 === 0 ? -1 : 0)));
  // a cog
  const cx = 9.5, cy = 6.5;
  for (let y = 0; y < 14; y++) for (let x = 2; x < 16; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy, r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    const toothed = r < 4.2 || (r < 5.6 && Math.cos(a * 8) > 0.2);
    if (!toothed || r < 1.6) continue;
    pc.set(x, y, pick(P.steel, 3.6 - (dx + dy) * 0.28));
  }
  // a bolt
  rect(pc, 3, 3, 3, 2, pick(P.steel, 4));
  line(pc, 4, 5, 4, 7, pick(P.steel, 3));
  pc.set(3, 3, pick(P.steel, 5));
}

function planks(pc: PixelCanvas): void {
  for (let k = 0; k < 3; k++) {
    const y = 4 + k * 3, x0 = 1 + k, x1 = 14 - (k === 1 ? 1 : 0);
    for (let x = x0; x <= x1; x++) {
      pc.set(x, y, pick(P.sand, 4.6));
      pc.set(x, y + 1, pick(P.wood, (x * 5 + k) % 7 === 0 ? 3.6 : 5));
      pc.set(x, y + 2, pick(P.wood, 3));
    }
    pc.set(x1 - 3, y + 1, pick(P.wood, 2.6)); // a knot
  }
}

function bricks(pc: PixelCanvas): void {
  // three bricks stacked 2 + 1, each 7 x 4 with a lit top and a darker underside
  const brick = (x: number, y: number) => {
    for (let j = 0; j < 4; j++) for (let i = 0; i < 7; i++) {
      pc.set(x + i, y + j, pick(P.brick, j === 0 ? 5 : i === 0 ? 4 : 3.4 - j * 0.5 + ((i * 3 + j * 5) % 7 === 0 ? 0.7 : 0)));
    }
  };
  brick(1, 10); brick(8, 10); brick(4, 5);
}

function researchKit(pc: PixelCanvas): void {
  // a wooden case with a brass clasp...
  rect(pc, 1, 7, 14, 8, (x, y) => pick(P.wood, y === 7 ? 5 : x === 1 ? 2 : 3.4 - (y - 8) * 0.2));
  line(pc, 1, 10, 14, 10, pick(P.wood, 2));
  rect(pc, 7, 9, 2, 3, pick(P.amber, 4));
  // ...stuffed with notes and a teal sample vial
  rect(pc, 3, 4, 5, 3, (x) => pick(P.cream, 5 - (x === 3 ? 1 : 0)));
  line(pc, 4, 5, 6, 5, pick(P.cream, 2));
  rect(pc, 10, 1, 3, 6, (x, y) => (y === 1 ? pick(P.cream, 3) : pick(P.teal, x === 10 ? 5 : 3.6 + (y > 4 ? 0 : 1))));
  pc.set(10, 3, [240, 252, 244]);
}

const PAINTERS: Record<ResourceId, (pc: PixelCanvas) => void> = {
  wood: timber,
  stone: fieldstone,
  iron_ore: (pc) => ore(pc, P.ironOre.slice(1), 5, [255, 214, 170]),
  copper_ore: (pc) => ore(pc, P.copperOre, 9, [255, 200, 140]),
  scrap,
  planks,
  bricks,
  research_kit: researchKit,
};

/** The 16 x 16 icon of an item, the same everywhere it appears. */
export function itemIcon(id: ResourceId): PixelCanvas {
  const pc = new PixelCanvas(ICON, ICON);
  PAINTERS[id](pc);
  outline(pc);
  return pc;
}
