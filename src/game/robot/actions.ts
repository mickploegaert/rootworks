import type { TileRect } from '../entities/Entity.ts';
import { Machine } from '../entities/Machine.ts';
import { ResourceNode } from '../entities/ResourceNode.ts';
import { StorageDepot } from '../entities/StorageDepot.ts';
import { RESOURCE_IDS, type ResourceId } from '../resources/ResourceDefs.ts';
import { isAdjacent, type Tile } from '../world/Pathfinder.ts';
import { TileMover } from './Movement.ts';
import { RobotAction, type ActionContext, type ActionStatus } from './RobotAction.ts';
import { RobotState } from './RobotState.ts';

/** Shared walking behaviour: follow a path, re-plan once if something blocks the way. */
abstract class WalkAction extends RobotAction {
  private mover: TileMover | null = null;
  private replanned = false;

  protected abstract plan(ctx: ActionContext): Tile[] | null;
  protected abstract unreachable(): string;

  start(ctx: ActionContext): ActionStatus {
    const path = this.plan(ctx);
    if (!path) return this.fail(this.unreachable());
    this.mover = new TileMover(path);
    return path.length ? 'running' : 'done';
  }

  override route(): Tile[] { return this.mover?.remaining ?? []; }

  override update(ctx: ActionContext, dt: number): ActionStatus {
    const status = this.mover!.update(ctx.robot, dt, (a, b) => ctx.pathfinder.canStep(a, b));
    if (status !== 'blocked') return status;
    if (this.replanned) return this.fail('path blocked');
    this.replanned = true;
    return this.start(ctx);
  }
}

/** Walk to a specific tile. */
export class MoveToAction extends WalkAction {
  readonly name: string;
  readonly state = RobotState.Moving;
  constructor(readonly target: Tile) { super(); this.name = `moveTo(${target.x}, ${target.y})`; }
  protected plan(ctx: ActionContext) {
    if (!ctx.world.inBounds(this.target.x, this.target.y) || ctx.world.get(this.target.x, this.target.y) === null) return null;
    return ctx.pathfinder.findPath({ x: ctx.robot.tileX, y: ctx.robot.tileY }, this.target);
  }
  protected unreachable() {
    return `tile (${this.target.x}, ${this.target.y}) is not reachable`;
  }
}

/** Walk to the nearest tile next to a rectangle (a deposit, a building). */
export class ApproachAction extends WalkAction {
  readonly name: string;
  constructor(readonly rect: TileRect, readonly state: RobotState = RobotState.Moving, label = 'approach') {
    super();
    this.name = `${label}(${rect.x}, ${rect.y})`;
  }
  protected plan(ctx: ActionContext) {
    const target = ctx.entities.at(this.rect.x, this.rect.y);
    if (target) ctx.robot.destination = target;
    return ctx.pathfinder.findPathToAdjacent({ x: ctx.robot.tileX, y: ctx.robot.tileY }, this.rect);
  }
  protected unreachable() { return 'no reachable tile next to the target'; }
}

/** Walk to the storage depot (state: Returning). */
export class ReturnToStorageAction extends WalkAction {
  readonly name = 'returnToStorage()';
  readonly state = RobotState.Returning;
  protected plan(ctx: ActionContext) {
    const s = ctx.storage();
    return s ? ctx.pathfinder.findPathToAdjacent({ x: ctx.robot.tileX, y: ctx.robot.tileY }, s.rect) : null;
  }
  protected unreachable() { return 'storage is not reachable'; }
}

/** Take exactly one step to a neighbouring tile. Fails rather than detouring. */
export class StepAction extends WalkAction {
  readonly name: string;
  readonly state = RobotState.Moving;
  constructor(readonly dx: number, readonly dy: number, label: string) { super(); this.name = `move(${label})`; }
  protected plan(ctx: ActionContext) {
    const from = { x: ctx.robot.tileX, y: ctx.robot.tileY }, to = { x: from.x + this.dx, y: from.y + this.dy };
    return ctx.pathfinder.canStep(from, to) ? [to] : null;
  }
  protected unreachable() { return 'blocked'; }
}

/** Find the deposit a harvest refers to: an explicit tile, or else the adjacent one in front first. */
export function findHarvestTarget(ctx: ActionContext, at?: Tile): ResourceNode | null {
  const r = ctx.robot, here = { x: r.tileX, y: r.tileY };
  if (at) {
    const e = ctx.entities.at(at.x, at.y);
    return e instanceof ResourceNode ? e : null;
  }
  // the deposit the last go_to() headed for wins, so go_to("tree") + harvest() never picks the scrap pile beside it
  const d = r.destination;
  if (d instanceof ResourceNode && !d.depleted && isAdjacent(here, d.rect)) return d;
  const ahead = [[1, 0], [0, 1], [-1, 0], [0, -1]][r.facing];
  const order = [ahead, [1, 0], [0, 1], [-1, 0], [0, -1]];
  for (const [dx, dy] of order) {
    const e = ctx.entities.at(here.x + dx, here.y + dy);
    if (e instanceof ResourceNode && !e.depleted) return e;
  }
  return null;
}

/** Why a harvest would fail right now, or null if it can proceed. */
export function harvestProblem(ctx: ActionContext, node: ResourceNode | null, requireAdjacent = true): string | null {
  if (!node) return 'no resource deposit there';
  if (node.depleted) return 'deposit is depleted';
  if (ctx.robot.inventory.isFull) return 'inventory is full';
  if (requireAdjacent && !isAdjacent({ x: ctx.robot.tileX, y: ctx.robot.tileY }, node.rect)) return 'not next to the deposit';
  return null;
}

/** Spend the deposit's harvest time, then move up to `yieldPerAction` units into the robot's inventory. */
export class HarvestAction extends RobotAction {
  readonly name: string;
  readonly state = RobotState.Harvesting;
  private node: ResourceNode | null = null;
  private elapsed = 0;

  constructor(readonly at?: Tile) { super(); this.name = at ? `harvest(${at.x}, ${at.y})` : 'harvest()'; }

  start(ctx: ActionContext): ActionStatus {
    this.node = findHarvestTarget(ctx, this.at);
    const problem = harvestProblem(ctx, this.node);
    if (problem) return this.fail(problem);
    const n = this.node!;
    ctx.robot.faceToward(n.tileX, n.tileY);
    ctx.robot.focus = { x: n.tileX, y: n.tileY };
    return 'running';
  }

  override update(ctx: ActionContext, dt: number): ActionStatus {
    const node = this.node!, def = node.def;
    this.elapsed += dt;
    ctx.robot.progress = Math.min(1, this.elapsed / def.harvestTime);
    if (this.elapsed < def.harvestTime) return 'running';
    // re-check: another robot may have emptied it, or cargo changed
    const problem = harvestProblem(ctx, node);
    if (problem) return this.fail(problem);
    const amount = node.take(Math.min(def.yieldPerAction + ctx.robot.yieldBonus, ctx.robot.inventory.free));
    ctx.robot.inventory.add(node.resourceId, amount);
    this.data = { resource: node.resourceId, amount, remaining: node.amount };
    return 'done';
  }
}

/** Unload all cargo into the adjacent storage depot. */
export class DepositAction extends RobotAction {
  readonly name = 'deposit()';
  readonly state = RobotState.Depositing;
  static readonly DURATION = 0.8;
  private elapsed = 0;

  start(ctx: ActionContext): ActionStatus {
    const s = ctx.storage();
    if (!s) return this.fail('no storage depot');
    if (ctx.robot.inventory.isEmpty) return this.fail('nothing to deposit');
    if (!isAdjacent({ x: ctx.robot.tileX, y: ctx.robot.tileY }, s.rect)) return this.fail('not next to storage');
    ctx.robot.faceToward(s.tileX, s.tileY);
    ctx.robot.focus = { x: s.tileX, y: s.tileY };
    return 'running';
  }

  override update(ctx: ActionContext, dt: number): ActionStatus {
    this.elapsed += dt;
    ctx.robot.progress = Math.min(1, this.elapsed / DepositAction.DURATION);
    if (this.elapsed < DepositAction.DURATION) return 'running';
    const s = ctx.storage();
    if (!s) return this.fail('no storage depot');
    this.data = { deposited: ctx.robot.inventory.transferAllTo(s.inventory) };
    return 'done';
  }
}

// ------------------------------------------------------------ logistics: machines and storage

/** Structures a robot can exchange items with: machines and storage depots. */
export type Exchange = Machine | StorageDepot;

/** The machine or depot next to the robot that it would use: the one in front first. */
/**
 * The machine or storage next to the robot that an exchange should use. With several neighbours, the one
 * go_to() walked to comes first, then the one ahead; `fits` (e.g. "uses this item") picks among them.
 */
export function adjacentExchange(ctx: ActionContext, kind?: string, fits?: (e: Exchange) => boolean): Exchange | null {
  const r = ctx.robot;
  const ahead = [[1, 0], [0, 1], [-1, 0], [0, -1]][r.facing];
  const found: Exchange[] = [];
  const dest = r.destination;
  if ((dest instanceof Machine || dest instanceof StorageDepot) && isAdjacent({ x: r.tileX, y: r.tileY }, dest.rect) && ctx.entities.has(dest)) found.push(dest);
  for (const [dx, dy] of [ahead, [1, 0], [0, 1], [-1, 0], [0, -1]]) {
    const e = ctx.entities.at(r.tileX + dx, r.tileY + dy);
    if ((e instanceof Machine || e instanceof StorageDepot) && (!kind || placeName(e) === kind) && !found.includes(e)) found.push(e);
  }
  return found.find((e) => !fits || fits(e)) ?? found[0] ?? null;
}

/** The name programs use for a structure: "storage" or the machine id ("sawmill", "lab"...). */
export const placeName = (e: Exchange) => (e instanceof StorageDepot ? 'storage' : e.machineId);

const isItem = (s: string | undefined): s is ResourceId => !!s && (RESOURCE_IDS as readonly string[]).includes(s);

/** Move items from the robot into the adjacent machine's input (or a depot). */
export class PutAction extends RobotAction {
  readonly name: string;
  readonly state = RobotState.Depositing;
  static readonly DURATION = 0.5;
  private elapsed = 0;
  private target: Exchange | null = null;
  constructor(readonly item?: string, readonly amount?: number) { super(); this.name = `put(${item ?? ''})`; }

  start(ctx: ActionContext): ActionStatus {
    if (this.item !== undefined && !isItem(this.item)) return this.fail(`"${this.item}" is not an item`);
    const items = this.item ? [this.item as ResourceId] : ctx.robot.inventory.entries().map(([id]) => id);
    this.target = adjacentExchange(ctx, undefined, (e) => e instanceof StorageDepot || items.some((id) => e.accepts(id)));
    if (!this.target) return this.fail('no machine or storage next to the robot');
    if (ctx.robot.inventory.isEmpty) return this.fail('the robot is carrying nothing');
    ctx.robot.faceToward(this.target.tileX, this.target.tileY);
    ctx.robot.focus = { x: this.target.tileX, y: this.target.tileY };
    return 'running';
  }

  override update(ctx: ActionContext, dt: number): ActionStatus {
    this.elapsed += dt;
    ctx.robot.progress = Math.min(1, this.elapsed / PutAction.DURATION);
    if (this.elapsed < PutAction.DURATION) return 'running';
    const t = this.target!, inv = ctx.robot.inventory;
    const dest = t instanceof Machine ? t.input : t.inventory;
    const moved: Partial<Record<ResourceId, number>> = {};
    for (const [id, have] of inv.entries()) {
      if (this.item && id !== this.item) continue;
      if (t instanceof Machine && !t.accepts(id)) continue;
      const n = dest.add(id, Math.min(have, this.amount ?? have));
      if (n) { inv.remove(id, n); moved[id] = n; }
    }
    if (!Object.keys(moved).length) {
      if (t instanceof Machine && this.item && !t.accepts(this.item as ResourceId)) return this.fail(`the ${t.def.name.toLowerCase()} does not use ${this.item}`);
      return this.fail(dest.isFull ? `the ${placeName(t)} is full` : 'nothing the machine can use');
    }
    this.data = { moved, into: placeName(t) };
    return 'done';
  }
}

/** Move items from the adjacent machine's output (or a depot) into the robot. */
export class TakeAction extends RobotAction {
  readonly name: string;
  readonly state = RobotState.Harvesting;
  static readonly DURATION = 0.5;
  static readonly MAX_WAIT = 30;
  private elapsed = 0;
  private target: Exchange | null = null;
  constructor(readonly item?: string, readonly amount?: number) { super(); this.name = `take(${item ?? ''})`; }

  start(ctx: ActionContext): ActionStatus {
    if (this.item !== undefined && !isItem(this.item)) return this.fail(`"${this.item}" is not an item`);
    const has = (e: Exchange) => (e instanceof Machine ? e.output : e.inventory).entries().some(([id]) => !this.item || id === this.item);
    this.target = adjacentExchange(ctx, undefined, (e) => has(e) || (e instanceof Machine && e.working));
    if (!this.target) return this.fail('no machine or storage next to the robot');
    if (ctx.robot.inventory.isFull) return this.fail('inventory is full');
    ctx.robot.faceToward(this.target.tileX, this.target.tileY);
    ctx.robot.focus = { x: this.target.tileX, y: this.target.tileY };
    return 'running';
  }

  override update(ctx: ActionContext, dt: number): ActionStatus {
    this.elapsed += dt;
    ctx.robot.progress = Math.min(1, this.elapsed / TakeAction.DURATION);
    if (this.elapsed < TakeAction.DURATION) return 'running';
    const t = this.target!, inv = ctx.robot.inventory;
    const src = t instanceof Machine ? t.output : t.inventory;
    // at a working machine with nothing ready, wait for the batch: beginners need no polling loop
    const ready = src.entries().some(([id]) => !this.item || id === this.item);
    if (!ready && t instanceof Machine && t.working && this.elapsed < TakeAction.MAX_WAIT) { ctx.robot.progress = Math.max(0, t.progress) / (t.recipe?.time ?? 1); return 'running'; }
    const moved: Partial<Record<ResourceId, number>> = {};
    for (const [id, have] of src.entries()) {
      if (this.item && id !== this.item) continue;
      const n = inv.add(id, Math.min(have, this.amount ?? have));
      if (n) { src.remove(id, n); moved[id] = n; }
    }
    if (!Object.keys(moved).length) return this.fail(inv.isFull ? 'inventory is full' : `nothing${this.item ? ` called ${this.item}` : ''} to take`);
    this.data = { moved, from: placeName(t) };
    return 'done';
  }
}

/** How many of the nearest deposits go_to("wood") tries to path to before giving up. */
const RESOURCE_TRIES = 6;

/** Walk next to the nearest structure with that name ("storage", "sawmill", "lab"...), or the nearest deposit of a raw resource ("wood"). */
export class GoToAction extends WalkAction {
  readonly name: string;
  readonly state = RobotState.Moving;
  constructor(readonly place: string) { super(); this.name = `go_to(${place})`; }
  protected plan(ctx: ActionContext) {
    const r = ctx.robot, here = { x: r.tileX, y: r.tileY };
    const dist = (e: { tileX: number; tileY: number }) => Math.abs(e.tileX - here.x) + Math.abs(e.tileY - here.y);
    const isResource = (RESOURCE_IDS as readonly string[]).includes(this.place);
    const candidates = isResource
      ? ctx.entities.ofKind<ResourceNode>('resource').filter((n) => n.resourceId === this.place && !n.depleted && ctx.world.isUnlocked(n.tileX, n.tileY))
        .sort((a, b) => dist(a) - dist(b)).slice(0, RESOURCE_TRIES)
      : [...ctx.entities.ofKind<Machine>('machine'), ...ctx.entities.ofKind<StorageDepot>('storage')]
        .filter((e) => placeName(e) === this.place).sort((a, b) => dist(a) - dist(b));
    for (const c of candidates) {
      const p = ctx.pathfinder.findPathToAdjacent(here, c.rect);
      if (p) { r.destination = c; return p; }
    }
    return null;
  }
  protected unreachable() { return `there is no reachable ${this.place}`; }
}
