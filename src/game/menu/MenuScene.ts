import { RobotCommands } from '../api/RobotCommands.ts';
import type { CosmeticId } from '../render/sprites/robot.ts';
import { Camera } from '../camera/Camera.ts';
import { TILE_H, TILE_W, tileToWorld } from '../core/iso.ts';
import { EntityManager } from '../entities/EntityManager.ts';
import { Renderer } from '../render/Renderer.ts';
import { LANGUAGES } from '../scripting/adapters.ts';
import { createHostFunctions } from '../scripting/hostApi.ts';
import { ProgramRunner } from '../scripting/ProgramRunner.ts';
import { Simulation } from '../Simulation.ts';
import { DIORAMA_FOCUS, DIORAMA_SIZE, buildDiorama } from './Diorama.ts';

const STEP = 1 / 60;
/** Golden hour, drifting into dusk so the lamps come on while the player reads the menu. */
const DAY_START = 0.55;

/** The living backdrop of the title screen: the real renderer and simulation, on a small composed world. */
export class MenuScene {
  private readonly sim: Simulation;
  private readonly renderer: Renderer;
  private readonly camera: Camera;
  private readonly runners: ProgramRunner[];
  private time = 0;
  private acc = 0;

  private constructor(private reducedMotion: boolean) {
    const entities = new EntityManager(DIORAMA_SIZE);
    const { world, programs } = buildDiorama(entities);
    this.sim = new Simulation(world, entities);
    const half = (DIORAMA_SIZE * TILE_W) / 2;
    this.camera = new Camera({ minX: -half, maxX: half, minY: 0, maxY: DIORAMA_SIZE * TILE_H });
    this.renderer = new Renderer(world, DAY_START);
    const silent = { action() {}, result() {} };
    this.runners = programs.map(({ robot, source }) =>
      new ProgramRunner(LANGUAGES.python.compile(source), { functions: createHostFunctions(new RobotCommands(this.sim, robot), silent), print() {} },
        { stepsPerTick: 200, idleStepLimit: 100_000, maxSteps: Number.MAX_SAFE_INTEGER }));
  }

  /** `look`: how far the player's Seedling has grown, and what it wears (from the latest save). */
  static async create(host: HTMLElement, reducedMotion: boolean, look: { sprout: number; cosmetic: CosmeticId | null } = { sprout: 0, cosmetic: null }): Promise<MenuScene> {
    const s = new MenuScene(reducedMotion);
    s.frameCamera(host.clientWidth);
    await s.renderer.init(host, s.sim.entities, s.camera);
    s.renderer.setAmbient(!reducedMotion);
    s.renderer.setRobotStage(look.sprout);
    s.renderer.setCosmetic(look.cosmetic);
    // let the works warm up so machines are already turning when the menu appears
    for (let i = 0; i < 60 * 8; i++) s.step();
    s.renderer.onTick((dt) => s.frame(dt));
    return s;
  }

  setReducedMotion(on: boolean): void { this.reducedMotion = on; this.renderer.setAmbient(!on); }

  /** Centre the works a little right of the screen middle: the menu sits on the left. */
  private frameCamera(viewW: number, t = 0): void {
    const zoom = viewW > 2200 ? 2 : 1;
    const c = tileToWorld(DIORAMA_FOCUS.x, DIORAMA_FOCUS.y);
    const drift = this.reducedMotion ? 0 : 1;
    const x = c.x - (viewW * 0.16) / zoom + Math.sin(t * 0.05) * 60 * drift;
    const y = c.y - 40 + Math.sin(t * 0.037) * 24 * drift;
    if (t === 0) this.camera.snapTo({ x, y }, zoom);
    else this.camera.panTo({ x, y });
  }

  private step(): void {
    for (const r of this.runners) r.tick();
    this.sim.update(STEP);
  }

  private frame(dt: number): void {
    for (this.acc += dt; this.acc >= STEP; this.acc -= STEP) this.step();
    this.time += dt;
    this.frameCamera(this.renderer.app.screen.width, this.time);
    this.camera.update(dt);
    this.camera.apply(this.renderer.worldContainer);
    this.renderer.render(this.time, dt, this.camera);
  }

  destroy(): void {
    for (const r of this.runners) r.stop();
    this.renderer.destroy();
  }
}
