import type { Entity } from './entities/Entity.ts';
import { EntityManager } from './entities/EntityManager.ts';
import { Robot } from './entities/Robot.ts';
import { StorageDepot } from './entities/StorageDepot.ts';
import type { ActionContext } from './robot/RobotAction.ts';
import { Pathfinder } from './world/Pathfinder.ts';
import type { World } from './world/World.ts';
import { BuildingSystem } from './building/BuildingSystem.ts';
import { ConstructionSite } from './entities/ConstructionSite.ts';
import type { Machine } from './entities/Machine.ts';
import { ResearchSystem } from './research/ResearchSystem.ts';
import { CommissionBoard } from './progress/Commissions.ts';
import { Robot as RobotClass } from './entities/Robot.ts';
import { PARCEL } from './world/World.ts';
import type { ResourceAmounts } from './inventory/Inventory.ts';
import type { ResourceId } from './resources/ResourceDefs.ts';
import { ResourceNode } from './entities/ResourceNode.ts';
import { applyProgress, applyRegion, captureRegion, entityKey, type Progress, type RegionSave } from './save/GameSave.ts';
import { START_REGION, regionById, type RegionId } from './world/regions.ts';

/** The game state and its rules. Owns the world and entities and ticks robot actions. No rendering. */
export class Simulation {
  readonly pathfinder: Pathfinder;
  private readonly contexts = new Map<Robot, ActionContext>();

  /** Player construction, allowed on unlocked parcels. */
  readonly building: BuildingSystem;
  readonly research = new ResearchSystem();
  readonly commissions = new CommissionBoard();

  constructor(readonly world: World, readonly entities: EntityManager) {
    this.pathfinder = new Pathfinder(world, entities);
    this.building = new BuildingSystem(world, entities, () => this.storages[0]?.inventory ?? null, this.research.completed);
  }

  get machines(): Machine[] { return this.entities.ofKind<Machine>('machine'); }

  // ------------------------------------------------------------ player actions on the world (not robots)

  /** Cost to reclaim the next parcel: grows with how much land is already open. */
  reclaimCost(): ResourceAmounts {
    const extra = Math.max(0, this.world.unlockedParcels().length - this.baseParcels);
    return { wood: 10 + extra * 6, stone: 6 + extra * 4 };
  }

  /** Why a parcel can't be reclaimed, or null. */
  reclaimProblem(px: number, py: number): string | null {
    if (!this.research.isDone('surveying')) return 'Research Surveying first';
    if (this.world.isParcelUnlocked(px, py)) return 'Already yours';
    let land = false;
    for (let y = py * PARCEL; y < (py + 1) * PARCEL && !land; y++) for (let x = px * PARCEL; x < (px + 1) * PARCEL; x++) if (this.world.get(x, y) !== null) { land = true; break; }
    if (!land) return 'That is open sea';
    const next = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => this.world.isParcelUnlocked(px + dx, py + dy) && px + dx >= 0 && py + dy >= 0);
    if (!next) return 'Only land next to your valley can be reclaimed';
    return this.shortfall(this.reclaimCost());
  }

  reclaim(px: number, py: number): string | null {
    const problem = this.reclaimProblem(px, py);
    if (problem) return problem;
    this.pay(this.reclaimCost());
    this.world.setParcelUnlocked(px, py, true);
    return null;
  }

  static readonly ROBOT_COST: ResourceAmounts = { planks: 8, scrap: 6 };
  static readonly MAX_ROBOTS = 8;

  assembleProblem(): string | null {
    if (!this.research.isDone('assembly')) return 'Research Robot assembly first';
    if (this.robots.length >= Simulation.MAX_ROBOTS) return `The workshop can run at most ${Simulation.MAX_ROBOTS} robots for now`;
    return this.shortfall(Simulation.ROBOT_COST);
  }

  /** Build a robot at the charging bay (or the nearest free tile to the first robot's home). */
  assembleRobot(at: { x: number; y: number }): string | null {
    const problem = this.assembleProblem();
    if (problem) return problem;
    for (let r = 0; r < 6; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = at.x + dx, y = at.y + dy;
      if (!this.pathfinder.isPassable(x, y) || this.robots.some((b) => b.tileX === x && b.tileY === y)) continue;
      this.pay(Simulation.ROBOT_COST);
      const robot = new RobotClass(x, y, `RW-0${this.robots.length + 1}`);
      if (this.research.isDone('cargo')) robot.inventory.capacity = 16;
      this.entities.add(robot);
      return null;
    }
    return 'No room next to the bay';
  }

  private shortfall(cost: ResourceAmounts): string | null {
    const inv = this.storages[0]?.inventory;
    const missing = Object.entries(cost).filter(([id, n]) => (inv?.get(id as ResourceId) ?? 0) < n!);
    return missing.length ? `Need ${missing.map(([id, n]) => `${n! - (inv?.get(id as ResourceId) ?? 0)} more ${id.replace('_', ' ')}`).join(', ')}` : null;
  }

  private pay(cost: ResourceAmounts): void {
    const inv = this.storages[0]!.inventory;
    for (const [id, n] of Object.entries(cost)) inv.remove(id as ResourceId, n!);
  }

  /** The procedurally generated starting island. */
  /** Seed the world was generated from (null for hand-built test worlds). */
  seed: number | null = null;
  /** Generated entities by key, with their starting amount (deposits) or 0: the baseline a save is a diff from. */
  generated: ReadonlyMap<string, number> = new Map();

  /** Which region of the world map this simulation is. */
  region: RegionId = START_REGION;
  /** Parcels open when the region was generated: reclaiming counts from here. */
  baseParcels = 4;
  /** How often each region has been generated in this session (for tests: locked regions must stay at 0). */
  static readonly generations = new Map<RegionId, number>();

  /**
   * Build one region: generate it from its seed, then apply the player's progress and the region's saved diff.
   * This is the only place a region's world comes into existence; nothing else of the world map is loaded.
   */
  static generate(seed: number, saved?: Omit<RegionSave, 'program'> | null, region: RegionId = START_REGION, progress?: Progress): Simulation {
    const def = regionById(region);
    if (!def?.generate) throw new Error(`Region ${region} cannot be generated`);
    Simulation.generations.set(region, (Simulation.generations.get(region) ?? 0) + 1);
    const entities = new EntityManager(def.size);
    const world = def.generate(seed, entities);
    const sim = new Simulation(world, entities);
    sim.seed = seed;
    sim.region = region;
    sim.baseParcels = world.unlockedParcels().length;
    const gen = new Map<string, number>();
    for (const e of entities.list()) if (e.kind !== 'robot' && e.kind !== 'storage') gen.set(entityKey(e), e instanceof ResourceNode ? e.amount : 0);
    sim.generated = gen;
    if (progress) applyProgress(sim, progress);
    if (saved) applyRegion(sim, saved);
    return sim;
  }

  /** This region's part of a save game (its program is added by whoever runs it). */
  capture() { return captureRegion(this, this.generated); }

  private commissionTimer = 0;
  /** Commissions completed since the game last looked (it shows them, then clears the list). */
  readonly completedCommissions: import('./progress/Commissions.ts').Commission[] = [];

  get robots(): Robot[] { return this.entities.ofKind<Robot>('robot'); }
  get storages(): StorageDepot[] { return this.entities.ofKind<StorageDepot>('storage'); }

  /** Nearest depot by grid distance. */
  nearestStorage(from: Entity): StorageDepot | null {
    let best: StorageDepot | null = null, bestD = Infinity;
    for (const s of this.storages) {
      const d = Math.abs(s.tileX - from.tileX) + Math.abs(s.tileY - from.tileY);
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  }

  contextFor(robot: Robot): ActionContext {
    let ctx = this.contexts.get(robot);
    if (!ctx) {
      ctx = { robot, world: this.world, entities: this.entities, pathfinder: this.pathfinder, storage: () => this.nearestStorage(robot) };
      this.contexts.set(robot, ctx);
    }
    return ctx;
  }

  /** One fixed simulation step. */
  update(dt: number): void {
    this.entities.update(dt);
    for (const r of this.robots) r.queue.update(this.contextFor(r), dt);
    for (const m of this.machines) if (m.machineId !== 'lab') m.update(dt);
    this.research.update(dt, this.machines.filter((m) => m.machineId === 'lab'));
    this.commissionTimer -= dt;
    if (this.commissionTimer <= 0) { this.commissionTimer = 0.5; this.completedCommissions.push(...this.commissions.update(this)); }
    for (const site of this.entities.ofKind<ConstructionSite>('construction')) {
      site.update(dt);
      if (!site.done) continue;
      this.entities.remove(site);
      this.entities.add(BuildingSystem.finish(site));
    }
  }
}
