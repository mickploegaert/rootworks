import { fbm, hash2, makeRng, vnoise } from '../core/noise.ts';
import { Prop } from '../entities/Prop.ts';
import { Robot } from '../entities/Robot.ts';
import { ResourceNode } from '../entities/ResourceNode.ts';
import { StorageDepot } from '../entities/StorageDepot.ts';
import type { EntityManager } from '../entities/EntityManager.ts';
import type { ResourceId } from '../resources/ResourceDefs.ts';
import { BIOMES, type BiomeId } from './biomes.ts';
import { PARCEL, TileType, World } from './World.ts';

export const MAP_SIZE = 256;
const C = MAP_SIZE / 2;
/** The cobbled yard around the starting workshop, in the middle of the starting valley. */
export const YARD = { x0: 124, y0: 124, x1: 132, y1: 133 };
/** Where the camera starts. */
export const START_TILE = { x: 129, y: 129 };
/** Fixed spots the tutorial programs refer to. */
export const TUTORIAL = { pile: { x: 129, y: 128 }, nextToPile: { x: 129, y: 129 } };
/**
 * The starting region, Brambleford Vale: the starting parcels and the ring of reclaimable land around them.
 * Its tiles keep the coordinates of the original 256 x 256 island, so existing saves load unchanged; everything
 * outside these bounds is open sea. The rest of the old island lives on as separate regions (see regions.ts).
 */
export const VALE_BOUNDS = { x0: 64, y0: 64, x1: 192, y1: 192 } as const;
/** Parcels unlocked at the start: the 2 x 2 in the centre (64 x 64 tiles). */
export const START_PARCELS: readonly [number, number][] = [[3, 3], [4, 3], [3, 4], [4, 4]];

/** The river: from a spring in the north-west highland, round the valley, out to the eastern coast. */
const RIVER: readonly [number, number][] = [[70, 60], [96, 74], [126, 86], [158, 96], [178, 124], [186, 156], [204, 186], [226, 212], [246, 236]];
const LAKE = { x: 196, y: 146, r: 6 };

/** Biome of each parcel ring (0 = starting valley) by compass sector. Sectors: N, NE, E, SE, S, SW, W, NW. */
const RING_BIOMES: Record<number, readonly BiomeId[]> = {
  0: ['meadow', 'meadow', 'meadow', 'meadow', 'meadow', 'meadow', 'meadow', 'meadow'],
  1: ['forest', 'forest', 'riverside', 'riverside', 'flowers', 'meadow', 'forest', 'highland'],
  2: ['highland', 'forest', 'riverside', 'beach', 'flowers', 'forest', 'highland', 'highland'],
  3: ['highland', 'beach', 'beach', 'beach', 'beach', 'beach', 'forest', 'highland'],
};

function parcelBiome(px: number, py: number): BiomeId {
  const n = MAP_SIZE / PARCEL, mid = (n - 1) / 2;
  const ring = Math.min(3, Math.max(0, Math.round(Math.max(Math.abs(px - mid), Math.abs(py - mid)) - 0.5)));
  // compass sector from the centre: screen-north is -x,-y in tile space
  const a = Math.atan2(py - mid, px - mid); // 0 = +x (screen SE)
  const sector = ((Math.round(a / (Math.PI / 4)) + 8 + 5) % 8); // rotate so 0 = N (-x-y)
  return RING_BIOMES[ring][sector];
}

/**
 * Builds the world. The player starts in a small yard (workshop, storage, charging bay, one robot)
 * in the middle of the starting valley; the surrounding parcels hold forest, river, highland and coast,
 * locked until reclaimed. Terrain is flat inside parcels: height changes, rivers and cliffs run along
 * parcel borders so factory land stays buildable.
 */
export function generateWorld(seed: number, entities: EntityManager, bounds = VALE_BOUNDS): World {
  const world = new World(MAP_SIZE, MAP_SIZE);
  const rnd = makeRng(seed);
  const P = MAP_SIZE / PARCEL;
  const inside = (x: number, y: number, w = 1, d = 1) => x >= bounds.x0 && y >= bounds.y0 && x + w <= bounds.x1 && y + d <= bounds.y1;
  // Outside the region no entity is created, but the random sequence must stay exactly as it was (saves are diffs
  // against the generated world): there, occupancy is kept as bare tile keys and every rnd() call still happens.
  const shadow = new Set<number>();
  const tileKey = (x: number, y: number) => y * MAP_SIZE + x;

  // --- Land, biomes and heights --------------------------------------------------
  const seaDist = (x: number, y: number) => Math.hypot(x + 0.5 - C, y + 0.5 - C) / 122 + (fbm(x * 0.03, y * 0.03, 3, seed) - 0.5) * 0.3;
  const heightOf = (b: BiomeId) => (b === 'highland' ? 2 : b === 'beach' ? 1 : 1);
  for (let y = 0; y < MAP_SIZE; y++) for (let x = 0; x < MAP_SIZE; x++) {
    const d = seaDist(x, y);
    if (d >= 1) continue;
    // borders wobble a couple of tiles so they read as landscape, not a grid
    const wx = x + Math.round((vnoise(x * 0.12, y * 0.12, seed + 11) - 0.5) * 5);
    const wy = y + Math.round((vnoise(x * 0.12 + 50, y * 0.12, seed + 12) - 0.5) * 5);
    const biome = parcelBiome(Math.max(0, Math.min(P - 1, Math.floor(wx / PARCEL))), Math.max(0, Math.min(P - 1, Math.floor(wy / PARCEL))));
    let t = TileType.Grass, h = heightOf(biome);
    if (biome === 'forest') t = TileType.Moss;
    if (biome === 'highland' && vnoise(x * 0.18, y * 0.18, seed + 3) > 0.62) t = TileType.Rock;
    if (biome === 'highland' && Math.hypot(x - 64, y - 64) < 26 + (vnoise(x * 0.1, y * 0.1, 7) - 0.5) * 10) h = 3; // the summit
    let b: BiomeId = biome;
    if (d > 0.9) { t = TileType.Sand; h = 0; b = 'beach'; } // every coast has a strand
    else if (biome === 'beach') { b = 'meadow'; } // inland of the strand, coast parcels are dune meadow
    if (b === 'meadow' && fbm(x * 0.05 + 7, y * 0.05, 2, seed + 40) > 0.6) b = 'flowers';
    world.set(x, y, t);
    world.setHeight(x, y, h);
    world.setBiome(x, y, b);
  }

  // --- The river: never flows uphill, so it can only fall where the land steps down ------
  let level = 9;
  for (let i = 0; i < RIVER.length - 1; i++) {
    const [ax, ay] = RIVER[i], [bx, by] = RIVER[i + 1];
    const steps = Math.ceil(Math.hypot(bx - ax, by - ay) * 3);
    for (let s = 0; s <= steps; s++) {
      const px = ax + ((bx - ax) * s) / steps, py = ay + ((by - ay) * s) / steps;
      const cx = Math.floor(px), cy = Math.floor(py);
      if (world.get(cx, cy) === null) break;
      level = Math.min(level, world.heightAt(cx, cy));
      const r = 1.3 + vnoise(px * 0.1, py * 0.1, seed + 9) * 0.8;
      for (let y = Math.floor(py - r - 1); y <= py + r + 1; y++) for (let x = Math.floor(px - r - 1); x <= px + r + 1; x++) {
        if (world.get(x, y) === null || Math.hypot(x + 0.5 - px, y + 0.5 - py) > r) continue;
        const was = world.get(x, y) === TileType.Water ? world.heightAt(x, y) : 9;
        world.set(x, y, TileType.Water); world.setHeight(x, y, Math.min(was, level)); world.setBiome(x, y, 'riverside');
      }
    }
  }
  for (let y = LAKE.y - 10; y <= LAKE.y + 10; y++) for (let x = LAKE.x - 10; x <= LAKE.x + 10; x++) {
    const d = Math.hypot(x - LAKE.x, y - LAKE.y) + (vnoise(x * 0.3, y * 0.3, seed + 4) - 0.5) * 2;
    if (d < LAKE.r) { world.set(x, y, TileType.Water); world.setHeight(x, y, 0); world.setBiome(x, y, 'riverside'); }
  }
  // muddy banks along all water
  for (let y = 0; y < MAP_SIZE; y++) for (let x = 0; x < MAP_SIZE; x++) {
    const t = world.get(x, y);
    if (t !== TileType.Grass && t !== TileType.Moss) continue;
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => world.get(x + a, y + b) === TileType.Water) && hash2(x, y, seed + 2) < 0.7) {
      world.set(x, y, TileType.Shore); world.setBiome(x, y, 'riverside');
    }
  }

  // --- The workshop yard and paths to the parcel edges ------------------------------
  for (let y = YARD.y0; y <= YARD.y1; y++) for (let x = YARD.x0; x <= YARD.x1; x++) {
    const edge = x === YARD.x0 || x === YARD.x1 || y === YARD.y0 || y === YARD.y1;
    if (edge && hash2(x, y, seed) > 0.75) continue;
    world.set(x, y, TileType.Concrete);
  }
  for (let y = YARD.y0 - 1; y <= YARD.y1 + 1; y++) for (let x = YARD.x0 - 1; x <= YARD.x1 + 1; x++) world.setBiome(x, y, 'yard');
  const path = (pts: [number, number][]) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      const n = Math.max(Math.abs(bx - ax), Math.abs(by - ay)) * 2;
      for (let s = 0; s <= n; s++) {
        const x = Math.round(ax + ((bx - ax) * s) / n), y = Math.round(ay + ((by - ay) * s) / n);
        const t = world.get(x, y);
        if (t === TileType.Grass || t === TileType.Moss || t === TileType.Shore) world.set(x, y, TileType.Path);
      }
    }
  };
  path([[129, 134], [134, 146], [150, 156], [170, 160]]); // south-east, toward the river
  path([[123, 128], [110, 120], [96, 100]]); // north-west, up to the old mine
  path([[133, 129], [146, 126], [160, 118]]); // north-east
  path([[127, 134], [118, 150], [104, 162]]); // south-west

  // --- Parcels: only the starting valley is open ---------------------------------------
  for (let py = 0; py < P; py++) for (let px = 0; px < P; px++) world.setParcelUnlocked(px, py, false);
  for (const [px, py] of START_PARCELS) world.setParcelUnlocked(px, py, true);

  // --- Starting structures --------------------------------------------------------------
  const prop = (x: number, y: number, sprite: string, name: string, desc: string, w = 1, d = 1) =>
    entities.add(new Prop(x, y, sprite, name, desc, 'structure', w, d));
  prop(125, 125, 'lab', 'Workshop', 'Where robots are built and repaired. The stove is always warm.', 4, 3);
  prop(128, 130, 'bay', 'Charging Bay', 'The robot’s cradle. A soft glow means it is fully charged.');
  prop(127, 129, 'terminal', 'Terminal', 'Brass console where robot programs are loaded.');
  prop(128, 128, 'lamp', 'Lantern', 'A warm lantern on an iron post.');
  prop(128, 134, 'signpost', 'Signpost', 'River to the east. Old mine up in the hills.');
  entities.add(new StorageDepot(130, 132));
  placeMine(world, entities);

  // --- Resources --------------------------------------------------------------------------
  const node = (x: number, y: number, sprite: string, res: ResourceId, amt: number, w = 1) => {
    for (let i = 0; i < w; i++) for (let j = 0; j < w; j++) {
      const t = world.get(x + i, y + j);
      if (t === null || t === TileType.Water || t === TileType.Path) return false; // the tutorial pile sits on the yard's cobbles
    }
    if (inside(x, y, w, w)) return entities.add(new ResourceNode(x, y, sprite, res, amt, amt, w, w));
    for (let i = 0; i < w; i++) for (let j = 0; j < w; j++) if (shadow.has(tileKey(x + i, y + j))) return false;
    for (let i = 0; i < w; i++) for (let j = 0; j < w; j++) shadow.add(tileKey(x + i, y + j));
    return true;
  };
  node(TUTORIAL.pile.x, TUTORIAL.pile.y, 'scrap_0', 'scrap', 15);
  node(119, 118, 'giant_tree', 'wood', 80, 2);
  // the starting valley: salvage, a few boulders
  for (let i = 0; i < 18; i++) {
    const x = 100 + Math.floor(rnd() * 56), y = 100 + Math.floor(rnd() * 56);
    if (x >= YARD.x0 - 2 && x <= YARD.x1 + 2 && y >= YARD.y0 - 2 && y <= YARD.y1 + 2) continue;
    if (i < 8) node(x, y, `scrap_${i % 2}`, 'scrap', 15);
    else node(x, y, `boulder_${i % 3}`, 'stone', 30);
  }
  // the wider world: ore clusters in the highland, stone everywhere, willows by the water
  for (let i = 0; i < 2200; i++) {
    const x = Math.floor(rnd() * MAP_SIZE), y = Math.floor(rnd() * MAP_SIZE);
    if (world.isUnlocked(x, y)) continue;
    const b = world.biomeAt(x, y), t = world.get(x, y), r = rnd();
    if (t === null) continue;
    if (b === 'highland') {
      if (r < 0.12) node(x, y, `iron_${i % 2}`, 'iron_ore', 40);
      else if (r < 0.2) node(x, y, `copper_${i % 2}`, 'copper_ore', 30);
      else if (r < 0.3) node(x, y, `boulder_${i % 3}`, 'stone', 30);
    } else if (b === 'riverside' && t === TileType.Shore && r < 0.06) node(x, y, 'willow_0', 'wood', 24);
    else if ((b === 'meadow' || b === 'flowers') && r < 0.02) node(x, y, `boulder_${i % 3}`, 'stone', 30);
  }

  // --- Vegetation by biome ---------------------------------------------------------------
  for (let y = 0; y < MAP_SIZE; y++) for (let x = 0; x < MAP_SIZE; x++) {
    const t = world.get(x, y);
    const kept = inside(x, y);
    if (t === null || t === TileType.Water || t === TileType.Path || (kept ? !entities.isFree(x, y) : shadow.has(tileKey(x, y)))) continue;
    const biome = BIOMES[world.biomeAt(x, y)];
    const r = rnd();
    const treeChance = biome.trees + (biome.id === 'forest' ? (fbm(x * 0.08, y * 0.08, 2, seed + 3) - 0.5) * 0.5 : 0);
    if (biome.treeIds.length && r < treeChance) {
      const sprite = biome.treeIds[Math.floor(rnd() * biome.treeIds.length)], amount = 12 + Math.floor(rnd() * 9);
      if (kept) entities.add(new ResourceNode(x, y, sprite, 'wood', amount));
      else shadow.add(tileKey(x, y));
      continue;
    }
    if (rnd() > biome.cover * 0.6) continue; // sparser than the old island: a big world needs breathing room
    const total = biome.plants.reduce((s, p) => s + p.weight, 0);
    let pickW = rnd() * total;
    const plant = biome.plants.find((p) => (pickW -= p.weight) < 0) ?? biome.plants[0];
    const sprite = plant.ids[Math.floor(rnd() * plant.ids.length)];
    if (kept) entities.add(new Prop(x, y, sprite, plant.name, plant.desc, 'vegetation', 1, 1, false));
  }

  entities.add(new Robot(129, 130));
  carveCoast(world, entities, bounds, seed);
  return world;
}

/** Outside the region is sea; a ragged strand of beach runs along its edge so it reads as a coast, not a cut. */
function carveCoast(world: World, entities: EntityManager, b: typeof VALE_BOUNDS, seed: number): void {
  for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++) {
    if (world.get(x, y) === null) continue;
    const edge = Math.min(x - b.x0, b.x1 - 1 - x, y - b.y0, b.y1 - 1 - y);
    const shore = 4 + vnoise(x * 0.09, y * 0.09, seed + 21) * 9;
    if (edge < shore - 3) world.clear(x, y);
    else if (edge < shore && world.get(x, y) !== TileType.Water) { world.set(x, y, TileType.Sand); world.setHeight(x, y, 0); world.setBiome(x, y, 'beach'); }
  }
  for (const e of [...entities.list()]) {
    let wet = false;
    for (let i = 0; i < e.width && !wet; i++) for (let j = 0; j < e.depth && !wet; j++) {
      const t = world.get(e.tileX + i, e.tileY + j);
      wet = t === null || (t === TileType.Sand && e.kind !== 'prop');
    }
    if (wet) entities.remove(e);
  }
}

/** An old mine entrance where the highland edge faces the valley (north-west of the start). */
function placeMine(world: World, entities: EntityManager): void {
  for (let r = 0; r < 24; r++) for (let y = 92 - r; y <= 92 + r; y++) for (let x = 92 - r; x <= 92 + r; x++) {
    const t = world.get(x, y);
    if (world.heightAt(x, y) !== 2 || (t !== TileType.Grass && t !== TileType.Rock)) continue;
    if (world.get(x, y + 1) === null || world.heightAt(x, y + 1) >= 2) continue; // needs a drop in front (south-west)
    entities.add(new Prop(x, y, 'mine', 'Old Mine', 'Timbered tunnel into the hill. Its deeper levels are still unexplored.', 'structure'));
    return;
  }
}
