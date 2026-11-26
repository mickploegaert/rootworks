import { ConstructionSite } from '../entities/ConstructionSite.ts';
import { Machine } from '../entities/Machine.ts';
import { Prop } from '../entities/Prop.ts';
import { ResourceNode } from '../entities/ResourceNode.ts';
import { Robot } from '../entities/Robot.ts';
import type { EntityManager } from '../entities/EntityManager.ts';
import type { Inventory } from '../inventory/Inventory.ts';
import type { ResourceId } from '../resources/ResourceDefs.ts';
import { RESOURCES } from '../resources/ResourceDefs.ts';
import { TILE_INFO, type World } from '../world/World.ts';
import { buildingById, type BuildingDef } from './BuildingDefs.ts';

/**
 * Player construction: where structures may go, what they cost, and placing them.
 * Building is the one thing players do by hand; robots still act only through programs.
 */
export class BuildingSystem {
  constructor(
    private readonly world: World,
    private readonly entities: EntityManager,
    private readonly storage: () => Inventory | null,
    /** Completed research ids (shared with the research system). */
    readonly research: Set<string> = new Set(),
  ) {}

  isUnlocked(def: BuildingDef): boolean { return def.requires === null || this.research.has(def.requires); }

  /** Building is allowed on unlocked parcels. */
  inArea(x: number, y: number): boolean { return this.world.isUnlocked(x, y); }

  /** Missing resources as text, or null when affordable. */
  missing(def: BuildingDef): string | null {
    const inv = this.storage();
    const short = Object.entries(def.cost).filter(([id, n]) => (inv?.get(id as ResourceId) ?? 0) < n!)
      .map(([id, n]) => `${n! - (inv?.get(id as ResourceId) ?? 0)} ${RESOURCES[id as ResourceId].name}`);
    return short.length ? `Need ${short.join(', ')} more in storage` : null;
  }

  /** Why the building cannot go here, or null if it can. */
  check(defId: string, x: number, y: number): string | null {
    const def = buildingById(defId);
    if (!def) return 'Unknown building';
    if (!this.isUnlocked(def)) return `Requires research: ${def.requires}`;
    const h = this.world.heightAt(x, y);
    for (let i = 0; i < def.width; i++) for (let j = 0; j < def.depth; j++) {
      const tx = x + i, ty = y + j, t = this.world.get(tx, ty);
      if (t === null) return 'Off the edge of the island';
      if (!TILE_INFO[t].buildable) return `Can't build on ${TILE_INFO[t].name.toLowerCase()}`;
      if (this.world.heightAt(tx, ty) !== h) return 'The ground is not level';
      if (!this.inArea(tx, ty)) return 'Outside your building area';
      const e = this.entities.at(tx, ty);
      if (e instanceof Robot) return 'A robot is standing there';
      if (e && (e.blocking || e instanceof ResourceNode || e instanceof Machine || e instanceof ConstructionSite || (e instanceof Prop && e.category !== 'vegetation'))) return `${e.name} is in the way`;
    }
    return this.missing(def);
  }

  /** Build it: pay from storage, clear plants underfoot, add the structure. Returns the error, or null on success. */
  place(defId: string, variant: number, x: number, y: number): string | null {
    const problem = this.check(defId, x, y);
    if (problem) return problem;
    const def = buildingById(defId)!;
    const inv = this.storage()!;
    for (const [id, n] of Object.entries(def.cost)) inv.remove(id as ResourceId, n!);
    for (const e of [...this.entities.list()]) {
      if (e instanceof Prop && e.category === 'vegetation' && e.tileX >= x && e.tileX < x + def.width && e.tileY >= y && e.tileY < y + def.depth) this.entities.remove(e);
    }
    const sprite = def.variants[((variant % def.variants.length) + def.variants.length) % def.variants.length];
    this.entities.add(new ConstructionSite(x, y, def.id, sprite, def.name, def.width, def.depth, def.buildTime ?? 2));
    return null;
  }

  /** The finished structure a construction site turns into. */
  static finish(site: ConstructionSite): Machine | Prop {
    const def = buildingById(site.buildingId)!;
    return def.machine
      ? new Machine(site.tileX, site.tileY, site.targetSprite, def.machine, def.name, def.description, def.width, def.depth)
      : new Prop(site.tileX, site.tileY, site.targetSprite, def.name, def.description, 'structure', def.width, def.depth);
  }
}
