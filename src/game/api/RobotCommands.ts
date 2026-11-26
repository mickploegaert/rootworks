import type { Robot } from '../entities/Robot.ts';
import type { ResourceAmounts } from '../inventory/Inventory.ts';
import { ResourceNode } from '../entities/ResourceNode.ts';
import {
  ApproachAction, DepositAction, GoToAction, HarvestAction, MoveToAction, PutAction, ReturnToStorageAction, StepAction, TakeAction,
  adjacentExchange, findHarvestTarget, harvestProblem, placeName,
} from '../robot/actions.ts';
import type { ActionResult, RobotAction } from '../robot/RobotAction.ts';
import type { Simulation } from '../Simulation.ts';

/** Grid directions. north = -y (screen up-right), east = +x (screen down-right). */
export type Direction = 'north' | 'south' | 'east' | 'west';

export const DIRECTIONS: Readonly<Record<Direction, readonly [number, number]>> = {
  north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0],
};

export type CommandResult = ActionResult;

/**
 * Returned by every queued command. Awaitable like a promise, and `result` is set synchronously
 * the moment the action settles, so tick-driven interpreters can poll it without async code.
 */
export class CommandHandle implements PromiseLike<CommandResult> {
  result: CommandResult | null = null;
  private readonly promise: Promise<CommandResult>;

  constructor(start: (settle: (r: CommandResult) => void) => Promise<CommandResult>) {
    this.promise = start((r) => { this.result = r; });
  }

  static settled(r: CommandResult): CommandHandle {
    return new CommandHandle((settle) => { settle(r); return Promise.resolve(r); });
  }

  then<A = CommandResult, B = never>(ok?: ((r: CommandResult) => A | PromiseLike<A>) | null, err?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return this.promise.then(ok, err);
  }
}

/**
 * The language-neutral robot API. Every future language adapter (Python, Java, TypeScript)
 * maps its built-ins onto these methods, so all languages get exactly the same capabilities.
 *
 * - Commands queue an action and return a promise that settles when it completes (never rejects).
 * - Queries answer immediately from the current simulation state and do not queue anything.
 * - Arguments are plain numbers and strings, results plain data, so they cross any interpreter boundary.
 */
export class RobotCommands {
  constructor(private readonly sim: Simulation, readonly robot: Robot) {}

  // ------------------------------------------------------------ commands (queued)

  /** Step one tile in a grid direction. */
  move(direction: Direction): CommandHandle {
    const d = DIRECTIONS[direction];
    if (!d) return CommandHandle.settled({ ok: false, action: 'move', error: `unknown direction "${direction}"` });
    return this.queue(new StepAction(d[0], d[1], direction));
  }

  /** Walk to a tile along the shortest path. */
  moveTo(x: number, y: number): CommandHandle {
    return this.queue(new MoveToAction({ x, y }));
  }

  /** Walk next to whatever occupies a tile (deposit, building). */
  approach(x: number, y: number): CommandHandle {
    const e = this.sim.entities.at(x, y);
    return this.queue(new ApproachAction(e && e.blocking ? e.rect : { x, y, w: 1, d: 1 }));
  }

  /** Harvest an adjacent deposit: the given tile, or the one in front / any neighbour. */
  harvest(x?: number, y?: number): CommandHandle {
    return this.queue(new HarvestAction(x === undefined || y === undefined ? undefined : { x, y }));
  }

  returnToStorage(): CommandHandle {
    return this.queue(new ReturnToStorageAction());
  }

  deposit(): CommandHandle {
    return this.queue(new DepositAction());
  }

  /** Put items (all, or one kind, optionally a number) into the adjacent machine's input or a depot. */
  put(item?: string, amount?: number): CommandHandle { return this.queue(new PutAction(item, amount)); }

  /** Take items from the adjacent machine's output or a depot. */
  take(item?: string, amount?: number): CommandHandle { return this.queue(new TakeAction(item, amount)); }

  /** Walk next to the nearest "storage", "workbench", "sawmill", "kiln" or "lab". */
  goTo(place: string): CommandHandle { return this.queue(new GoToAction(place)); }

  /** Name of the machine or depot next to the robot, or null. */
  adjacentPlace(): string | null {
    const e = adjacentExchange(this.sim.contextFor(this.robot));
    return e ? placeName(e) : null;
  }

  /** Cancel the running command and everything queued. */
  stop(): void {
    this.robot.queue.clear(this.sim.contextFor(this.robot), 'stopped');
  }

  // ------------------------------------------------------------ queries (immediate)

  canReach(x: number, y: number): boolean {
    return this.sim.world.get(x, y) !== null && this.sim.pathfinder.findPath(this.here(), { x, y }) !== null;
  }

  /** Is there a harvestable deposit next to the robot right now (and room in its cargo)? */
  canHarvestHere(): boolean {
    const ctx = this.sim.contextFor(this.robot);
    return !harvestProblem(ctx, findHarvestTarget(ctx));
  }

  /** Resource type of the adjacent deposit the robot would harvest next, or null. */
  adjacentResource(): string | null {
    const node = findHarvestTarget(this.sim.contextFor(this.robot));
    return node && !node.depleted ? node.resourceId : null;
  }

  /** Could the robot harvest the deposit at (x,y)? True if it exists, has stock, there is cargo space and it can be reached. */
  canHarvest(x: number, y: number): boolean {
    const ctx = this.sim.contextFor(this.robot);
    const node = findHarvestTarget(ctx, { x, y });
    return !harvestProblem(ctx, node, false) && this.sim.pathfinder.findPathToAdjacent(this.here(), node!.rect) !== null;
  }

  /** Resource type at a tile, or null. */
  resourceAt(x: number, y: number): string | null {
    const e = this.sim.entities.at(x, y);
    return e instanceof ResourceNode && !e.depleted ? e.resourceId : null;
  }

  position(): { x: number; y: number } { return this.here(); }
  state(): string { return this.robot.state; }
  inventory(): ResourceAmounts { return this.robot.inventory.snapshot(); }
  capacity(): { used: number; max: number } { return { used: this.robot.inventory.total, max: this.robot.inventory.capacity }; }
  isBusy(): boolean { return this.robot.queue.size > 0; }

  private here() { return { x: this.robot.tileX, y: this.robot.tileY }; }

  private queue(a: RobotAction): CommandHandle {
    return new CommandHandle((settle) => this.robot.queue.enqueue(a, settle));
  }
}
