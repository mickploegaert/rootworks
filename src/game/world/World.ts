import { HEIGHT_UNIT, worldToUV } from '../core/iso.ts';
import { BIOME_IDS, type BiomeId } from './biomes.ts';

export enum TileType { Grass, Moss, Dirt, Path, Concrete, Shore, Water, Rock, Sand }

export const MAX_HEIGHT = 3;
/** Parcel edge in tiles: the unit in which the player unlocks land. */
export const PARCEL = 32;

export interface TileInfo { name: string; walkable: boolean; buildable: boolean }

export const TILE_INFO: Readonly<Record<TileType, TileInfo>> = {
  [TileType.Grass]: { name: 'Meadow grass', walkable: true, buildable: true },
  [TileType.Moss]: { name: 'Forest floor', walkable: true, buildable: true },
  [TileType.Dirt]: { name: 'Bare soil', walkable: true, buildable: true },
  [TileType.Path]: { name: 'Worn path', walkable: true, buildable: true },
  [TileType.Concrete]: { name: 'Cobbled yard', walkable: true, buildable: true },
  [TileType.Shore]: { name: 'Muddy shore', walkable: true, buildable: false },
  [TileType.Water]: { name: 'Pond water', walkable: false, buildable: false },
  [TileType.Rock]: { name: 'Mossy rock', walkable: true, buildable: false },
  [TileType.Sand]: { name: 'Sand', walkable: true, buildable: false },
};

const VOID = 255;

export interface WorldData { width: number; height: number; cells: Uint8Array; heights: Uint8Array; biomes: Uint8Array; unlocked: Uint8Array }

/** Tile grid. Pure data: knows nothing about rendering or entities. */
export class World {
  private readonly cells: Uint8Array;
  private readonly heights: Uint8Array;
  private readonly biomes: Uint8Array;
  private readonly unlocked: Uint8Array;
  readonly parcelsAcross: number;

  constructor(readonly width: number, readonly height: number) {
    this.cells = new Uint8Array(width * height).fill(VOID);
    this.heights = new Uint8Array(width * height);
    this.biomes = new Uint8Array(width * height);
    this.parcelsAcross = Math.ceil(width / PARCEL);
    this.unlocked = new Uint8Array(this.parcelsAcross * Math.ceil(height / PARCEL)).fill(1);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  /** Tile type at (x,y), or null outside the island. */
  get(x: number, y: number): TileType | null {
    if (!this.inBounds(x, y)) return null;
    const v = this.cells[y * this.width + x];
    return v === VOID ? null : (v as TileType);
  }

  /** Make a tile empty (open sea). */
  clear(x: number, y: number): void { if (this.inBounds(x, y)) this.cells[y * this.width + x] = VOID; }

  set(x: number, y: number, t: TileType): void {
    if (this.inBounds(x, y)) this.cells[y * this.width + x] = t;
  }

  /** Elevation level 0..MAX_HEIGHT. */
  heightAt(x: number, y: number): number {
    return this.inBounds(x, y) ? this.heights[y * this.width + x] : 0;
  }

  setHeight(x: number, y: number, h: number): void {
    if (this.inBounds(x, y)) this.heights[y * this.width + x] = h;
  }

  biomeAt(x: number, y: number): BiomeId {
    return BIOME_IDS[this.inBounds(x, y) ? this.biomes[y * this.width + x] : 0];
  }

  setBiome(x: number, y: number, b: BiomeId): void {
    if (this.inBounds(x, y)) this.biomes[y * this.width + x] = BIOME_IDS.indexOf(b);
  }

  /** Raw arrays, e.g. to rebuild the world inside a worker. */
  exportData(): WorldData {
    return { width: this.width, height: this.height, cells: this.cells.slice(), heights: this.heights.slice(), biomes: this.biomes.slice(), unlocked: this.unlocked.slice() };
  }

  static fromData(d: WorldData): World {
    const w = new World(d.width, d.height);
    w.cells.set(d.cells); w.heights.set(d.heights); w.biomes.set(d.biomes); w.unlocked.set(d.unlocked);
    return w;
  }

  // ---- parcels: land is unlocked in PARCEL x PARCEL squares

  isUnlocked(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.unlocked[Math.floor(y / PARCEL) * this.parcelsAcross + Math.floor(x / PARCEL)] === 1;
  }

  isParcelUnlocked(px: number, py: number): boolean { return this.unlocked[py * this.parcelsAcross + px] === 1; }

  setParcelUnlocked(px: number, py: number, on: boolean): void {
    if (px >= 0 && py >= 0 && px < this.parcelsAcross && py * PARCEL < this.height) this.unlocked[py * this.parcelsAcross + px] = on ? 1 : 0;
  }

  /** Indices (py * parcelsAcross + px) of unlocked parcels, for saving. */
  unlockedParcels(): number[] { return [...this.unlocked.keys()].filter((i) => this.unlocked[i]); }

  /** Tile under a world-space point, accounting for elevation (taller tiles occlude lower ones). */
  pick(wx: number, wy: number): { x: number; y: number } | null {
    for (let h = MAX_HEIGHT; h >= 0; h--) {
      const uv = worldToUV(wx, wy + h * HEIGHT_UNIT);
      const x = Math.floor(uv.x), y = Math.floor(uv.y);
      if (this.get(x, y) !== null && this.heightAt(x, y) === h) return { x, y };
    }
    return null;
  }

  /** Walkable ground that nothing else is built on is up to the EntityManager; this is terrain only. */
  isWalkable(x: number, y: number): boolean {
    const t = this.get(x, y);
    return t !== null && TILE_INFO[t].walkable && this.isUnlocked(x, y);
  }
}
