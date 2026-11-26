import type { EntityManager } from '../entities/EntityManager.ts';
import type { Robot } from '../entities/Robot.ts';
import type { StorageDepot } from '../entities/StorageDepot.ts';
import type { Pathfinder } from '../world/Pathfinder.ts';
import type { World } from '../world/World.ts';
import type { RobotState } from './RobotState.ts';

/** Everything an action may read or change. Passed in by the Simulation each tick. */
export interface ActionContext {
  robot: Robot;
  world: World;
  entities: EntityManager;
  pathfinder: Pathfinder;
  /** Nearest storage depot to the robot, if any. */
  storage(): StorageDepot | null;
}

export type ActionStatus = 'running' | 'done' | 'failed';

/** Outcome reported back to whoever queued the action (UI now, language adapters later). */
export interface ActionResult {
  ok: boolean;
  action: string;
  error?: string;
  /** Action-specific data, e.g. what was harvested or deposited. */
  data?: Record<string, unknown>;
}

/**
 * One unit of robot work. The queue calls `start` once, then `update` every tick until it
 * returns 'done' or 'failed'. Actions are plain simulation objects: no rendering, no DOM.
 */
export abstract class RobotAction {
  abstract readonly name: string;
  /** Robot state while this action runs. */
  abstract readonly state: RobotState;
  error?: string;
  data?: Record<string, unknown>;

  abstract start(ctx: ActionContext): ActionStatus;
  update(_ctx: ActionContext, _dt: number): ActionStatus { return 'done'; }
  /** Tiles still to walk, for route previews. */
  route(): { x: number; y: number }[] { return []; }
  /** Called when the action is stopped early (queue cleared). */
  cancel(_ctx: ActionContext): void {}

  protected fail(message: string): ActionStatus {
    this.error = message;
    return 'failed';
  }
}
