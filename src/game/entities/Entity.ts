export type EntityKind = 'prop' | 'resource' | 'robot' | 'storage' | 'machine' | 'construction';

/** Axis-aligned tile rectangle. */
export interface TileRect { x: number; y: number; w: number; d: number }

let nextId = 1;

/** Base class for everything that lives on the map. Simulation-only: no rendering types. */
export abstract class Entity {
  readonly id = nextId++;
  abstract readonly kind: EntityKind;

  constructor(
    public tileX: number,
    public tileY: number,
    /** Key into the renderer's sprite library. */
    public readonly spriteId: string,
    public readonly name: string,
    public readonly description: string,
    /** Footprint in tiles, anchored at (tileX, tileY) and extending +x / +y. */
    public readonly width = 1,
    public readonly depth = 1,
  ) {}

  /** Whether other things may not share this entity's tiles. */
  get blocking(): boolean { return true; }

  /** Footprint as a tile rectangle. */
  get rect(): TileRect { return { x: this.tileX, y: this.tileY, w: this.width, d: this.depth }; }

  update(_dt: number): void {}
}
