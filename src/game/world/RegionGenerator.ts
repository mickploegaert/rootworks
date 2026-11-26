import { fbm, hash2, makeRng, vnoise } from '../core/noise.ts';
import type { EntityManager } from '../entities/EntityManager.ts';
import { Prop } from '../entities/Prop.ts';
import { ResourceNode } from '../entities/ResourceNode.ts';
import { Robot } from '../entities/Robot.ts';
import { StorageDepot } from '../entities/StorageDepot.ts';
import type { ResourceId } from '../resources/ResourceDefs.ts';
import { BIOMES, type BiomeId } from './biomes.ts';
import { TileType, World } from './World.ts';

export type RegionKind = 'quarry' | 'whisperwood';

/** Tile size of a generated region. */
export const REGION_SIZE = 96;

/**
 * Builds a region other than the starting valley: an island with its own terrain and resources, and a small
 * landing (depot, charging bay, one robot) so it can be worked as soon as the player arrives. Deterministic per seed.
 */
export function generateRegion(kind: RegionKind, seed: number, entities: EntityManager): World {
  const N = REGION_SIZE, C = N / 2, world = new World(N, N), rnd = makeRng(seed);
  const set = (x: number, y: number, t: TileType, h: number, b: BiomeId) => { world.set(x, y, t); world.setHeight(x, y, h); world.setBiome(x, y, b); };
  const landing = (x: number, y: number) => Math.abs(x - C) <= 5 && Math.abs(y - C - 2) <= 5;

  // --- land ---------------------------------------------------------------------------------------
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const d = Math.hypot(x + 0.5 - C, y + 0.5 - C) / (C - 3) + (fbm(x * 0.06, y * 0.06, 3, seed) - 0.5) * 0.35;
    if (d >= 1) continue;
    if (d > 0.9) { set(x, y, TileType.Sand, 0, 'beach'); continue; }
    if (kind === 'quarry') {
      // terraces: flat benches (good building ground) separated by cliffs, rising toward the back
      const rise = fbm(x * 0.035, y * 0.035, 3, seed + 1) + (C * 2 - x - y) / (N * 3);
      const h = landing(x, y) ? 1 : Math.max(1, Math.min(3, 1 + Math.floor(rise * 3.2 - 0.6)));
      const rock = vnoise(x * 0.2, y * 0.2, seed + 2) > 0.55 || h === 3;
      set(x, y, rock ? TileType.Rock : vnoise(x * 0.3, y * 0.3, seed + 5) > 0.7 ? TileType.Dirt : TileType.Grass, h, 'highland');
    } else {
      set(x, y, TileType.Moss, 1, 'forest');
    }
  }
  // a stream through the forest; a quarry pool in the lowest bench
  if (kind === 'whisperwood') {
    for (let t = 0; t <= 1; t += 0.004) {
      const px = 10 + t * (N - 20), py = C + Math.sin(t * 6.2 + seed % 7) * 14 + 18 * (t - 0.5);
      for (let y = Math.floor(py - 2); y <= py + 2; y++) for (let x = Math.floor(px - 2); x <= px + 2; x++) {
        if (world.get(x, y) === null || landing(x, y) || Math.hypot(x + 0.5 - px, y + 0.5 - py) > 1.4) continue;
        set(x, y, TileType.Water, 0, 'riverside');
      }
    }
  } else {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (world.get(x, y) === null || Math.hypot(x - (C + 18), y - (C + 16)) > 4.5 + vnoise(x * 0.4, y * 0.4, seed) * 1.5) continue;
      set(x, y, TileType.Water, 0, 'riverside');
    }
  }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const t = world.get(x, y);
    if ((t === TileType.Grass || t === TileType.Moss) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => world.get(x + a, y + b) === TileType.Water)) {
      world.set(x, y, TileType.Shore); world.setBiome(x, y, 'riverside');
    }
  }

  // --- the landing ---------------------------------------------------------------------------------
  for (let y = C - 3; y <= C + 7; y++) for (let x = C - 5; x <= C + 5; x++) if (hash2(x, y, seed) < 0.85 || (Math.abs(x - C) < 5 && y > C - 3 && y < C + 7)) set(x, y, TileType.Concrete, 1, 'yard');
  const structure = (x: number, y: number, sprite: string, name: string, desc: string) => entities.add(new Prop(x, y, sprite, name, desc, 'structure'));
  entities.add(new StorageDepot(C + 1, C + 3));
  structure(C - 1, C + 3, 'bay', 'Charging Bay', 'A field bay, carried here in crates.');
  structure(C - 2, C - 1, 'lamp', 'Lantern', 'Lit the night the first robot arrived.');
  structure(C + 3, C + 6, 'signpost', 'Signpost', kind === 'quarry' ? 'Ore up the terraces. Mind the edges.' : 'Follow the stream. Mind the mushrooms.');
  structure(C - 4, C + 5, 'crates', 'Supply crates', 'Spare parts from the valley.');

  // --- resources -----------------------------------------------------------------------------------
  const node = (x: number, y: number, sprite: string, res: ResourceId, amount: number) => {
    const t = world.get(x, y);
    if (t === null || t === TileType.Water || t === TileType.Concrete || t === TileType.Sand || landing(x, y)) return;
    entities.add(new ResourceNode(x, y, sprite, res, amount));
  };
  for (let i = 0; i < 6; i++) node(C - 8 + Math.floor(rnd() * 16), C + 9 + Math.floor(rnd() * 5), `scrap_${i % 2}`, 'scrap', 15);
  if (kind === 'quarry') {
    for (let i = 0; i < 900; i++) {
      const x = Math.floor(rnd() * N), y = Math.floor(rnd() * N), r = rnd(), h = world.heightAt(x, y);
      if (r < 0.1 + h * 0.05) node(x, y, `iron_${i % 2}`, 'iron_ore', 40 + h * 10);
      else if (r < 0.18 + h * 0.04) node(x, y, `copper_${i % 2}`, 'copper_ore', 30 + h * 10);
      else if (r < 0.32) node(x, y, `boulder_${i % 3}`, 'stone', 40);
    }
  }

  // --- vegetation ------------------------------------------------------------------------------------
  const forestTrees = ['oak_0', 'oak_2', 'birch_0', 'oak_1', 'maple_0', 'birch_1', 'cherry_0', 'giant_tree'];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const t = world.get(x, y);
    if (t === null || t === TileType.Water || t === TileType.Concrete || landing(x, y) || !entities.isFree(x, y)) continue;
    const r = rnd(), biome = BIOMES[world.biomeAt(x, y)];
    if (kind === 'whisperwood' && t === TileType.Moss && r < 0.34 + (fbm(x * 0.07, y * 0.07, 2, seed + 3) - 0.5) * 0.5) {
      const id = forestTrees[Math.floor(rnd() * (forestTrees.length - 1))];
      node(x, y, id, 'wood', 18 + Math.floor(rnd() * 12));
      continue;
    }
    if (kind === 'quarry' && t !== TileType.Rock && r < 0.025) { node(x, y, rnd() < 0.4 ? 'cherry_0' : `oak_${x % 3}`, 'wood', 16); continue; }
    if (rnd() > biome.cover * (kind === 'whisperwood' ? 0.9 : 0.5)) continue;
    const ids = kind === 'whisperwood' && rnd() < 0.25 ? ['glowshroom', 'mushroom', 'fern_0'] : biome.plants[Math.floor(rnd() * biome.plants.length)].ids;
    entities.add(new Prop(x, y, ids[Math.floor(rnd() * ids.length)], 'Plant', 'Growing wild.', 'vegetation', 1, 1, false));
  }
  if (kind === 'whisperwood' && entities.isFree(C + 14, C - 14, 2, 2) && world.get(C + 15, C - 13) === TileType.Moss) entities.add(new ResourceNode(C + 14, C - 14, 'giant_tree', 'wood', 120, 120, 2, 2));

  entities.add(new Robot(C, C + 4, kind === 'quarry' ? 'RW-Q1 "Flint"' : 'RW-W1 "Moss"'));
  return world;
}
