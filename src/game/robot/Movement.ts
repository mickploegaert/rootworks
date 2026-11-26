import type { Robot } from '../entities/Robot.ts';
import type { Tile } from '../world/Pathfinder.ts';

export type MoveStatus = 'running' | 'done' | 'blocked';

/**
 * Moves a robot along a tile path at constant speed, centre to centre.
 * Before entering each tile it asks `canEnter`, so obstacles that appear mid-route stop it cleanly
 * at the current tile centre instead of walking through them.
 */
export class TileMover {
  private index = 0;
  private entering = false;

  constructor(private readonly path: Tile[]) {}

  get remaining(): Tile[] { return this.path.slice(this.index); }

  update(robot: Robot, dt: number, canEnter: (from: Tile, to: Tile) => boolean): MoveStatus {
    let budget = robot.speed * dt;
    while (budget > 0) {
      const next = this.path[this.index];
      if (!next) return 'done';
      if (!this.entering) {
        if (!canEnter({ x: robot.tileX, y: robot.tileY }, next)) return 'blocked';
        this.entering = true;
        robot.faceToward(next.x, next.y);
      }
      const tx = next.x + 0.5, ty = next.y + 0.5;
      const dx = tx - robot.posX, dy = ty - robot.posY, dist = Math.abs(dx) + Math.abs(dy);
      if (dist <= budget) {
        robot.posX = tx; robot.posY = ty;
        robot.tileX = next.x; robot.tileY = next.y;
        budget -= dist;
        this.index++;
        this.entering = false;
      } else {
        robot.posX += Math.sign(dx) * Math.min(Math.abs(dx), budget);
        robot.posY += Math.sign(dy) * Math.min(Math.abs(dy), budget);
        budget = 0;
      }
    }
    return this.index >= this.path.length ? 'done' : 'running';
  }
}
