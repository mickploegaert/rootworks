import { Inventory } from '../inventory/Inventory.ts';
import { ActionQueue } from '../robot/ActionQueue.ts';
import { RobotState } from '../robot/RobotState.ts';
import { Entity } from './Entity.ts';

export type Facing = 0 | 1 | 2 | 3; // 0:+x(SE) 1:+y(SW) 2:-x(NW) 3:-y(NE)

export const ROBOT_CAPACITY = 10;

/**
 * A worker robot: position, facing, cargo and its action queue. The robot itself holds no behaviour;
 * actions (robot/actions) drive it, and the Simulation ticks its queue.
 */
export class Robot extends Entity {
  readonly kind = 'robot' as const;
  /** Continuous position in tile units; a tile's centre is (x + 0.5, y + 0.5). */
  posX: number;
  posY: number;
  facing: Facing = 1;
  state: RobotState = RobotState.Idle;
  /** 0..1 progress of a timed action (harvest, deposit), for presentation. */
  progress = 0;
  /** Tile the robot is working on, if any. */
  focus: { x: number; y: number } | null = null;
  /** Where the last go_to() was headed: put() and take() prefer it when several structures are adjacent. */
  destination: Entity | null = null;
  readonly inventory = new Inventory(ROBOT_CAPACITY);
  readonly queue = new ActionQueue();
  /** Tiles per second. */
  speed = 2.2;
  /** Speech bubble for presentation: the line the robot's program is on, or what went wrong. */
  bubble: { text: string; error: boolean } | null = null;
  /** Extra units every harvest() collects (Sharp tools). */
  yieldBonus = 0;

  constructor(x: number, y: number, name = 'RW-01 "Seedling"') {
    super(x, y, 'robot', name, 'A salvaged utility bot. It follows queued commands.');
    this.posX = x + 0.5;
    this.posY = y + 0.5;
  }

  override get blocking(): boolean { return false; }

  /** Turn to face a neighbouring tile direction. */
  faceToward(x: number, y: number): void {
    const dx = x + 0.5 - this.posX, dy = y + 0.5 - this.posY;
    if (Math.abs(dx) >= Math.abs(dy)) this.facing = dx >= 0 ? 0 : 2;
    else this.facing = dy >= 0 ? 1 : 3;
  }
}
