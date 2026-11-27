import type { Entity } from './entities/Entity.ts';
import { StoryBook } from './progress/Story.ts';
import { EntityManager } from './entities/EntityManager.ts';
import { ROBOT_CAPACITY, Robot } from './entities/Robot.ts';
import { StorageDepot } from './entities/StorageDepot.ts';
import type { ActionContext } from './robot/RobotAction.ts';
import { Pathfinder } from './world/Pathfinder.ts';
import type { World } from './world/World.ts';
import { BuildingSystem } from './building/BuildingSystem.ts';
import { ConstructionSite } from './entities/ConstructionSite.ts';
import { ResearchSystem } from './research/ResearchSystem.ts';
import { CommissionBoard } from './progress/Commissions.ts';
import { ChallengeBoard } from './progress/Challenges.ts';
import { laneBonus } from './research/Lanes.ts';
import { AchievementBook } from './progress/Achievements.ts';
import { Robot as RobotClass } from './entities/Robot.ts';
import { PARCEL } from './world/World.ts';
import type { ResourceAmounts } from './inventory/Inventory.ts';
import type { ResourceId } from './resources/ResourceDefs.ts';
import { ResourceNode } from './entities/ResourceNode.ts';
import { Machine } from './entities/Machine.ts';
import { Prop } from './entities/Prop.ts';
import { BUILDINGS, type BuildingDef } from './building/BuildingDefs.ts';
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
  readonly challenges = new ChallengeBoard();
  readonly achievements = new AchievementBook();
  /** The valley's story and the Heart Tree (progress, shared by all regions). */
  readonly story = new StoryBook();
  /** Story moments since the game last looked: a chapter finished, a spring level, the tree's Sparks. */
  readonly storyEvents: NonNullable<ReturnType<StoryBook['update']>>[] = [];

  constructor(readonly world: World, readonly entities: EntityManager) {
    this.pathfinder = new Pathfinder(world, entities);
    this.building = new BuildingSystem(world, entities, () => this.storages[0]?.inventory ?? null, this.research.completed);
  }

  get machines(): Machine[] { return this.entities.ofKind<Machine>('machine'); }

  // ------------------------------------------------------------ player actions on the world (not robots)

  /** Cost to reclaim the next parcel: grows with how much land is already open. */
  reclaimCost(): ResourceAmounts {
    const extra = Math.max(0, this.world.unlockedParcels().length - this.baseParcels);
    const k = this.research.isDone('surveying2') ? 0.7 : 1; // Surveying II
    return { wood: Math.ceil((10 + extra * 6) * k), stone: Math.ceil((6 + extra * 4) * k) };
  }

  /** Why a parcel can't be reclaimed, or null. */
  reclaimProblem(px: number, py: number): string | null {
    if (!this.research.isDone('surveying')) return 'Learn the Surveying skill first';
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
    if (!this.research.isDone('assembly')) return 'Learn the Robot assembly skill first';
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
      this.applySkills(robot);
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
    for (const r of sim.robots) sim.applySkills(r); // a region entered for the first time gets skill-built robots too
    return sim;
  }

  /** This region's part of a save game (its program is added by whoever runs it). */
  capture() { return captureRegion(this, this.generated); }

  private commissionTimer = 0;
  /** Machines within reach of a windmill work faster; refreshed every couple of seconds. */
  private boosted = new Set<Machine>();
  private boostTimer = 0;
  static readonly WIND_RANGE = 6;
  static readonly WIND_BOOST = 1.5;
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

  /** A robot's stats from the skills learned: cargo, speed, harvest yield. Safe to call again at any time. */
  applySkills(robot: Robot): void {
    const r = this.research;
    robot.inventory.capacity = (r.isDone('cargo2') ? 22 : r.isDone('cargo') ? 16 : ROBOT_CAPACITY) + (laneBonus('robots', r.completed) ? 2 : 0);
    robot.harvestSpeed = laneBonus('flow', r.completed) ? 1.15 : 1;
    robot.speed = 2.2 * (1 + 0.2 * ['speed1', 'speed2', 'speed3'].filter((s) => r.isDone(s)).length);
    robot.yieldBonus = r.isDone('yield1') ? 1 : 0;
  }

  /** Feeder skill: machines near storage pull their recipe's ingredients from it, every half second. */
  feed(): void {
    const store = this.storages[0];
    if (!store || !this.research.isDone('feeder')) return;
    for (const m of this.machines) {
      const rc = m.recipe;
      if (!rc || Math.abs(m.tileX - store.tileX) > 3 || Math.abs(m.tileY - store.tileY) > 3) continue;
      for (const [id, n] of Object.entries(rc.inputs) as [ResourceId, number][]) {
        const want = Math.min(n * 2 - m.input.get(id), store.inventory.get(id), m.input.free);
        if (want > 0) m.input.add(id, store.inventory.remove(id, want));
      }
    }
  }

  /** The building definition of something the player built (not part of the generated world), or null. */
  playerBuilding(e: Entity): BuildingDef | null {
    if (!(e instanceof Machine || e instanceof Prop || e instanceof ConstructionSite) || this.generated.has(entityKey(e))) return null;
    const id = e instanceof ConstructionSite ? e.buildingId : null;
    return BUILDINGS.find((b) => b.id === id || b.variants.includes(e.spriteId)) ?? null;
  }

  /** Take a player building down: half its cost back (all of it for an unfinished site), plus what a machine held. */
  demolish(e: Entity): string | null {
    const def = this.playerBuilding(e), store = this.storages[0]?.inventory;
    if (!def || !store) return 'Only buildings you built can be taken down';
    const share = e instanceof ConstructionSite ? 1 : 0.5;
    for (const [id, n] of Object.entries(def.cost) as [ResourceId, number][]) store.add(id, Math.floor(n * share));
    if (e instanceof Machine) for (const inv of [e.input, e.output]) for (const [id, n] of inv.entries()) store.add(id, n);
    for (const r of this.robots) if (r.destination === e) r.destination = null;
    this.entities.remove(e);
    return null;
  }

  /** Move a player building to another spot, contents and all. Free of charge. */
  move(e: Entity, x: number, y: number): string | null {
    const def = this.playerBuilding(e);
    if (!def) return 'Only buildings you built can be moved';
    this.entities.remove(e); // its own tiles must not block the check
    const problem = this.building.check(def.id, x, y, true);
    if (!problem) {
      e.tileX = x; e.tileY = y;
      for (const v of [...this.entities.list()]) { // plants underfoot make way, as when building
        if (v instanceof Prop && v.category === 'vegetation' && v.tileX >= x && v.tileX < x + def.width && v.tileY >= y && v.tileY < y + def.depth) this.entities.remove(v);
      }
    }
    this.entities.add(e);
    return problem;
  }

  /** Machines with a windmill within WIND_RANGE tiles. */
  windBoosted(): Set<Machine> {
    const mills = this.entities.ofKind('prop').filter((p) => p.spriteId === 'turbine');
    const near = (m: Machine) => mills.some((w) => Math.abs(w.tileX - m.tileX) <= Simulation.WIND_RANGE && Math.abs(w.tileY - m.tileY) <= Simulation.WIND_RANGE);
    return new Set(mills.length ? this.machines.filter(near) : []);
  }

  /** One fixed simulation step. */
  update(dt: number): void {
    this.entities.update(dt);
    for (const r of this.robots) r.queue.update(this.contextFor(r), dt);
    this.boostTimer -= dt;
    if (this.boostTimer <= 0) { this.boostTimer = 2; this.boosted = this.windBoosted(); }
    const lane = laneBonus('machines', this.research.completed) ? 1.1 : 1; // Machines milestone
    for (const m of this.machines) if (m.machineId !== 'lab' && m.machineId !== 'heart') m.update((this.boosted.has(m) ? dt * Simulation.WIND_BOOST : dt) * lane);
    this.research.update(dt, this.machines.filter((m) => m.machineId === 'lab'));
    this.commissionTimer -= dt;
    if (this.commissionTimer <= 0) {
      this.commissionTimer = 0.5; this.feed(); this.completedCommissions.push(...this.commissions.update(this));
      const ev = this.story.update(this, 0.5, this.machines.find((m) => m.machineId === 'heart'));
      if (ev) this.storyEvents.push(ev);
    }
    for (const site of this.entities.ofKind<ConstructionSite>('construction')) {
      site.update(dt);
      if (!site.done) continue;
      this.entities.remove(site);
      this.entities.add(BuildingSystem.finish(site));
    }
  }
}
