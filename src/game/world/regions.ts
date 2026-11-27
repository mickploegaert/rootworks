import { hash2 } from '../core/noise.ts';
import { researchById } from '../research/ResearchDefs.ts';
import type { EntityManager } from '../entities/EntityManager.ts';
import type { World } from './World.ts';
import { START_TILE, VALE_BOUNDS, generateWorld } from './WorldGenerator.ts';
import { generateRegion } from './RegionGenerator.ts';

export type RegionId = 'vale' | 'quarry' | 'whisperwood' | 'saltmarsh' | 'ironworks' | 'greatroot';

/**
 * A region of the world map. Only the active region exists as a World with entities; every other region is just
 * this record (plus, once visited, its save diff). Adding a region = one entry here (and a generator).
 */
export interface RegionDef {
  id: RegionId;
  name: string;
  tagline: string;
  /** What the region is for, shown on the world map. */
  resources: string;
  /** Research that opens the region; null = open from the start. */
  requires: string | null;
  /** Not in the game yet: shown on the map as a promise, never loaded. */
  future?: boolean;
  /** Builds the region's world and its starting entities. Absent for future regions. */
  generate?: (seed: number, entities: EntityManager) => World;
  /** World size in tiles (square). */
  size: number;
  /** Tiles the camera may look at. */
  bounds: { x0: number; y0: number; x1: number; y1: number };
  /** Where the camera starts. */
  spawn: { x: number; y: number };
  /** World-map placement (0..100 of the map's width and height) and art. */
  map: { x: number; y: number; art: 'vale' | 'peaks' | 'forest' | 'coast' | 'works' | 'root'; hue: string };
}

const SIZE = 96;
const open = { x0: 0, y0: 0, x1: SIZE, y1: SIZE };
const centre = { x: SIZE / 2, y: SIZE / 2 + 2 };

export const REGIONS: readonly RegionDef[] = [
  {
    id: 'vale', name: 'Brambleford Vale', tagline: 'Meadows, a river and the old workshop.', resources: 'Timber, fieldstone, scrap',
    requires: null, generate: (seed, e) => generateWorld(seed, e), size: 256, bounds: VALE_BOUNDS, spawn: START_TILE,
    map: { x: 44, y: 56, art: 'vale', hue: '#8fbf5a' },
  },
  {
    id: 'quarry', name: 'Old Quarry', tagline: 'Terraced cliffs where the ore veins run close to the surface.', resources: 'Iron ore, copper ore, fieldstone',
    requires: 'surveying', generate: (seed, e) => generateRegion('quarry', seed, e), size: SIZE, bounds: open, spawn: centre,
    map: { x: 22, y: 30, art: 'peaks', hue: '#a3988c' },
  },
  {
    id: 'whisperwood', name: 'Whisperwood', tagline: 'Old trees, glowing mushrooms and soft moss.', resources: 'Timber in abundance, some stone',
    requires: 'gardening', generate: (seed, e) => generateRegion('whisperwood', seed, e), size: SIZE, bounds: open, spawn: centre,
    map: { x: 70, y: 28, art: 'forest', hue: '#4f8a4a' },
  },
  {
    id: 'saltmarsh', name: 'Saltmarsh Coast', tagline: 'Tidal flats and dunes along the western sea.', resources: 'Charted in a later update',
    requires: null, future: true, size: SIZE, bounds: open, spawn: centre, map: { x: 16, y: 74, art: 'coast', hue: '#d9c48c' },
  },
  {
    id: 'ironworks', name: 'Ironworks Plateau', tagline: 'Wide flat stone, made for big factories.', resources: 'Charted in a later update',
    requires: null, future: true, size: SIZE, bounds: open, spawn: centre, map: { x: 78, y: 72, art: 'works', hue: '#b0704a' },
  },
  {
    id: 'greatroot', name: 'The Great Root', tagline: 'Something vast grows under the hills.', resources: 'Unknown',
    requires: null, future: true, size: SIZE, bounds: open, spawn: centre, map: { x: 50, y: 14, art: 'root', hue: '#9a7fc0' },
  },
];

export const START_REGION: RegionId = 'vale';
export const REGION_IDS = REGIONS.map((r) => r.id) as readonly RegionId[];
export const regionById = (id: string): RegionDef | undefined => REGIONS.find((r) => r.id === id);

/**
 * Each region's seed comes from the world seed. The starting region uses the world seed itself, so saves made
 * before regions existed regenerate exactly the same valley.
 */
export function regionSeed(worldSeed: number, id: RegionId): number {
  return id === START_REGION ? worldSeed : Math.floor(hash2(worldSeed, REGION_IDS.indexOf(id) * 7919, 4242) * 2 ** 31);
}

/** Why the player cannot enter a region yet, or null. */
export function regionLock(def: RegionDef, researched: ReadonlySet<string>): string | null {
  if (def.future || !def.generate) return 'Not charted yet: this region arrives in a later update';
  if (def.requires && !researched.has(def.requires)) return `Learn the ${researchById(def.requires)?.name ?? def.requires} skill to travel here`;
  return null;
}
