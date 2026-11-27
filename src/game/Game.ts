import { RobotCommands } from './api/RobotCommands.ts';
import { Camera } from './camera/Camera.ts';
import { TILE_H, TILE_W, tileToWorld } from './core/iso.ts';
import { Emitter } from './core/Emitter.ts';
import type { Entity, TileRect } from './entities/Entity.ts';
import { ConstructionSite } from './entities/ConstructionSite.ts';
import { Machine } from './entities/Machine.ts';
import { ResourceNode } from './entities/ResourceNode.ts';
import type { Robot } from './entities/Robot.ts';
import { InputController } from './input/InputController.ts';
import { Renderer } from './render/Renderer.ts';
import { RESOURCES, RESOURCE_IDS, type ResourceId } from './resources/ResourceDefs.ts';
import type { ActionResult } from './robot/RobotAction.ts';
import { Simulation } from './Simulation.ts';
import type { SaveFile } from './save/GameSave.ts';
import type { RunnerSave } from './scripting/ProgramRunner.ts';
import { BUILDINGS, buildingById, type BuildCategory } from './building/BuildingDefs.ts';
import { LANGUAGES } from './scripting/adapters.ts';
import { createHostFunctions } from './scripting/hostApi.ts';
import { ProgramRunner, type RunState } from './scripting/ProgramRunner.ts';
import { ScriptError, type HostApi, type LanguageId } from './scripting/types.ts';
import { Tutorial, type TutorialStep } from './tutorial/Tutorial.ts';
import { isAdjacent } from './world/Pathfinder.ts';
import { PARCEL, TILE_INFO } from './world/World.ts';
import { RESEARCH, researchById } from './research/ResearchDefs.ts';
import type { ResourceAmounts } from './inventory/Inventory.ts';
import { BIOMES } from './world/biomes.ts';
import { REGIONS, START_REGION, regionById, regionLock, type RegionDef, type RegionId } from './world/regions.ts';
import { composeSave, loadActiveRegion, travelSave } from './world/RegionTravel.ts';

export interface ResourceLine { id: ResourceId; name: string; color: number; amount: number }

export interface SelectionInfo {
  tileX: number;
  tileY: number;
  tileName: string;
  elevation: number;
  biome: string;
  entity?: {
    name: string; description: string; kind: string;
    resource?: { id: ResourceId; name: string; use: string; color: number; amount: number; max: number; harvestTime: number; yieldPerAction: number; depleted: boolean };
    /** A building site: how far the drones are. */
    construction?: number;
    machine?: {
      recipes: { name: string; inputs: ResourceLine[]; outputs: ResourceLine[]; time: number }[];
      recipe: number; working: boolean; progress: number;
      input: ResourceLine[]; output: ResourceLine[]; inputCap: number; outputCap: number;
    };
    /** The starting workshop: where robots are assembled. */
    workshop?: { problem: string | null; cost: ResourceLine[]; robots: number };
    /** Ready code that works with this thing, for the inspector's "Program this" box. */
    program?: { code: string; note: string };
    /** A Lab: what it is researching, in words. */
    research?: string;
  };
  /** Land ownership of the selected tile's parcel. */
  parcel: { px: number; py: number; locked: boolean; problem: string | null; cost: ResourceLine[] };
}

export interface RegionView {
  id: RegionId;
  name: string;
  tagline: string;
  resources: string;
  /** active: you are here · visited: has a save · open: can be entered for the first time · locked: needs research · future: not in the game yet */
  state: 'active' | 'visited' | 'open' | 'locked' | 'future';
  lock: string | null;
  map: RegionDef['map'];
}

export interface ResearchView {
  firmware: number;
  current: string | null;
  progress: number;
  nodes: { id: string; name: string; description: string; kits: number; state: 'done' | 'current' | 'available' | 'locked'; needs: string[] }[];
}

/** Everything the HUD shows. Plain data, rebuilt by the game; React only renders it. */
export interface HudSnapshot {
  storage: ResourceLine[];
  robot: { name: string; state: string; x: number; y: number; used: number; capacity: number; cargo: ResourceLine[]; queue: string[]; progress: number };
  selection: SelectionInfo | null;
  log: { id: number; text: string; ok: boolean }[];
  tutorial: TutorialStep[];
  /** Everything buildable, with affordability. */
  catalog: CatalogEntry[];
  /** The structure being placed, if any, and why it can't go under the cursor. */
  build: { id: string; name: string; problem: string | null; overMap: boolean } | null;
  /** Time of day, e.g. "Dusk". */
  timeOfDay: string;
  research: ResearchView;
  commissions: { id: string; title: string; progress: number; target: number; reward: ResourceLine[] }[];
  robots: number;
  guided: boolean;
  region: { id: RegionId; name: string };
  regions: RegionView[];
}

export interface CatalogEntry {
  id: string; name: string; description: string; category: BuildCategory; sprite: string;
  cost: (ResourceLine & { have: number })[];
  /** Research needed first, or null when available. */
  locked: string | null;
}

export type ConsoleKind = 'system' | 'action' | 'ok' | 'fail' | 'print' | 'error';
export interface ConsoleEntry { id: number; kind: ConsoleKind; text: string; line?: number }

export interface ProgramStatus {
  state: RunState | 'idle';
  language: LanguageId | null;
  /** Line being executed (or waited on). */
  line: number | null;
  /** Line of the last syntax/runtime error. */
  errorLine: number | null;
}

export type PlayerCommand = 'move' | 'harvest' | 'deposit' | 'stop';

export interface GameEvents {
  hud: HudSnapshot;
  console: ConsoleEntry;
  program: ProgramStatus;
  /** Completed tutorial step ids, whenever they change (for saving). */
  tutorial: string[];
  /** A snippet the player chose to add to their program. */
  insertCode: string;
}

const CONSOLE_MAX_PRINT = 2000;

const STEP = 1 / 60;
const LOG_SIZE = 5;

const line = (id: ResourceId, amount: number): ResourceLine => ({ id, name: RESOURCES[id].name, color: RESOURCES[id].color, amount });

/** Short names go_to() understands, per resource (see PLACE_ALIASES in hostApi). */
const PLACE_OF: Partial<Record<ResourceId, string>> = { wood: 'tree', stone: 'stone', scrap: 'scrap', iron_ore: 'iron', copper_ore: 'copper' };
const MACHINE_CODE: Record<string, string> = {
  workbench: 'go_to("workbench")\nput()                 # timber and scrap in\ntake("research_kit")  # waits for the kit',
  sawmill: 'go_to("sawmill")\nput("wood")\ntake("planks")',
  kiln: 'go_to("kiln")\nput("stone")\ntake("bricks")',
  lab: 'go_to("lab")\nput("research_kit")',
};

/** Code that works with a selected thing: the bridge from "I see it" to "I can program it". */
function programFor(e: Entity): { code: string; note: string } | undefined {
  if (e instanceof ResourceNode) {
    const place = PLACE_OF[e.resourceId];
    if (e.depleted || !place) return undefined;
    return { code: `go_to("${place}")\nharvest()\ndeposit()`, note: `go_to("${place}") picks the nearest one. For exactly this one: go_to(${e.tileX}, ${e.tileY}).` };
  }
  if (e instanceof Machine && MACHINE_CODE[e.machineId]) return { code: MACHINE_CODE[e.machineId], note: 'Machines work by themselves once a robot puts the ingredients in.' };
  if (e.kind === 'storage') return { code: 'deposit()', note: 'deposit() walks here and unloads everything. take("wood") takes things back out.' };
  return undefined;
}

/**
 * Composition root: wires simulation, camera, input and renderer together and runs the loop.
 * Also hosts the temporary developer controls, which go through the same RobotCommands API
 * that the programming languages will use later.
 */
export class Game {
  readonly events = new Emitter<GameEvents>();
  readonly sim: Simulation;
  /** Language-neutral command API for the starting robot. */
  readonly commands: RobotCommands;
  private readonly robot: Robot;
  private readonly camera: Camera;
  /** The region being played. Only this region is generated, rendered and simulated. */
  readonly region: RegionDef;
  /** Saved diffs of the other visited regions, carried through untouched: they are not loaded or simulated. */
  private readonly regionSaves: SaveFile['regions'];
  private readonly worldSeed: number;
  private readonly renderer: Renderer;
  private input!: InputController;
  private selected: { x: number; y: number } | null = null;
  private buildTool: { id: string; variant: number } | null = null;
  private hoverTile: { x: number; y: number } | null = null;
  private log: HudSnapshot['log'] = [];
  private logId = 0;
  private acc = 0;
  private time = 0;
  private hudTimer = 0;
  private lastHud = '';
  /** One VM per robot: every robot runs the same program with its own variables. */
  private runners: (ProgramRunner | null)[] = [];
  /** Guided mode: syntax follows the firmware. Set by the editor. */
  guided = true;
  private program: ProgramStatus = { state: 'idle', language: null, line: null, errorLine: null };
  private consoleId = 0;
  /** The last state change came from Step: its pause is not announced. */
  private lastStep = false;
  private readonly tutorial: Tutorial;

  /** Source of the running program, kept for saving. */
  private programSource: { language: LanguageId; source: string } | null = null;

  private constructor(seed: number, tutorialDone: readonly string[], dayStart?: number, private readonly loaded?: SaveFile) {
    this.worldSeed = loaded?.seed ?? seed;
    this.region = regionById(loaded?.region ?? START_REGION)!;
    this.regionSaves = { ...(loaded?.regions ?? {}) };
    this.sim = loadActiveRegion(loaded, this.worldSeed);
    const b = this.region.bounds;
    this.camera = new Camera({ minX: ((b.x0 - b.y1) * TILE_W) / 2, maxX: ((b.x1 - b.y0) * TILE_W) / 2, minY: ((b.x0 + b.y0) * TILE_H) / 2, maxY: ((b.x1 + b.y1) * TILE_H) / 2 });
    if (loaded) this.time = loaded.time;
    this.robot = this.sim.robots[0];
    this.commands = new RobotCommands(this.sim, this.robot);
    this.renderer = new Renderer(this.sim.world, dayStart);
    this.robot.queue.events.on('finished', (r) => this.report(r));
    this.tutorial = new Tutorial(tutorialDone);
    this.sim.research.events.on('completed', (n) => this.onResearch(n.id, n.name));
    this.sim.research.events.on('autoPicked', (n) => this.out('system', `The Lab had Research Kits but no project, so it started on ${n.name}. You can change it in the Research panel.`));
    this.sim.entities.events.on('added', (e) => {
      if (e instanceof Machine && (e.machineId === 'workbench' || e.machineId === 'lab')) this.tutorialMark(e.machineId);
    });
  }

  /** The game functions for one robot; console lines are tagged with its name once there are several. */
  private hostFor(robot: Robot): HostApi {
    const tag = () => (this.sim.robots.length > 1 ? `[${robot.name}] ` : '');
    const fns = createHostFunctions(new RobotCommands(this.sim, robot), {
      action: (text) => this.out('action', tag() + text),
      result: (text, ok) => this.out(ok ? 'ok' : 'fail', tag() + text),
    }, () => this.sim.research.firmware);
    return { functions: fns, print: (text) => this.out('print', tag() + (text.length > CONSOLE_MAX_PRINT ? text.slice(0, CONSOLE_MAX_PRINT) + '...' : text)) };
  }

  private get programActive(): boolean { return this.runners.some((r) => r?.isActive); }

  private tutorialMark(id: string): void { if (this.tutorial.mark(id)) this.tutorialProgress(); }

  private tutorialProgress(): void {
    const step = this.tutorial.steps.filter((s) => s.done).at(-1)!;
    this.out('system', this.tutorial.complete ? 'Tutorial complete! Your valley is yours to grow.' : `Tutorial step done: ${step.label}.`);
    this.events.emit('tutorial', this.tutorial.completed);
    this.emitHud(true);
  }

  private onResearch(id: string, name: string): void {
    this.out('system', `Research complete: ${name}.`);
    this.note(`Researched ${name}`, true);
    if (id === 'cargo') for (const r of this.sim.robots) r.inventory.capacity = 16;
    this.renderer.setRobotStage(this.sim.research.firmware);
    this.tutorialMark('research');
  }

  static async create(host: HTMLElement, opts: { seed?: number; tutorialDone?: readonly string[]; dayStart?: number; save?: SaveFile | null } = {}): Promise<Game> {
    const g = new Game(opts.seed ?? 1337, opts.save?.tutorial ?? opts.tutorialDone ?? [], opts.dayStart, opts.save ?? undefined);
    await g.init(host);
    const p = g.loaded?.regions[g.region.id]?.program;
    if (p) g.runProgram(p.language, p.source, p.runners); // continue where the save left off
    return g;
  }

  /** Everything needed to continue this game later. */
  save(): SaveFile {
    const runners = this.runners.map((r) => r?.save() ?? null);
    const program = this.programSource && runners.some(Boolean) ? { ...this.programSource, runners } : null;
    return composeSave(this.sim, this.regionSaves, { worldSeed: this.worldSeed, time: this.time, tutorial: this.tutorial.completed, program });
  }

  /**
   * Leave for another region: the save to load next, or why the trip is not possible. This region's state
   * (programs included, frozen mid-step) goes into the save and is not simulated while the player is away.
   */
  travel(target: RegionId): SaveFile | string {
    return travelSave(this.save(), target, this.sim.research.completed);
  }

  /** The world map as the HUD shows it: every region, but only metadata. */
  private regionsView(): RegionView[] {
    return REGIONS.map((r) => {
      const lock = regionLock(r, this.sim.research.completed);
      const visited = !!this.regionSaves[r.id] || r.id === this.region.id;
      return {
        id: r.id, name: r.name, tagline: r.tagline, resources: r.resources, lock, map: r.map,
        state: r.id === this.region.id ? 'active' : r.future ? 'future' : lock ? 'locked' : visited ? 'visited' : 'open',
      };
    });
  }

  private async init(host: HTMLElement): Promise<void> {
    const c = tileToWorld(this.region.spawn.x, this.region.spawn.y);
    this.camera.snapTo({ x: c.x, y: c.y - 30 }, 2);
    await this.renderer.init(host, this.sim.entities, this.camera);
    this.renderer.setRobotStage(this.sim.research.firmware);
    this.input = new InputController(this.renderer.app.canvas, this.camera, {
      onHover: (p) => {
        this.hoverTile = p && this.tileAt(p.x, p.y);
        this.renderer.selection.setHover(this.hoverTile && !this.buildTool ? this.rectFor(this.hoverTile) : null);
        this.updateGhost();
      },
      onClick: (x, y) => this.click(this.tileAt(x, y)),
      onEscape: () => (this.buildTool ? this.setBuildTool(null) : this.select(null)),
      onRotate: () => this.rotateBuildTool(),
    });
    this.renderer.onTick((dt) => this.frame(dt));
    this.emitHud(true);
  }

  // ------------------------------------------------------------ player controls

  /**
   * Left click inspects, or places the structure chosen in the build menu.
   * It never moves the robot: robots act exclusively through programs.
   */
  private click(t: { x: number; y: number } | null): void {
    if (!this.buildTool) { this.select(t); return; }
    if (!t) return;
    const def = buildingById(this.buildTool.id)!;
    const problem = this.sim.building.place(def.id, this.buildTool.variant, t.x, t.y);
    this.note(problem ?? `Built ${def.name}`, !problem);
    this.updateGhost();
  }

  // ------------------------------------------------------------ building

  /** Choose a structure to place (null leaves build mode). Placement is the one hands-on action players have. */
  setBuildTool(id: string | null): void {
    this.buildTool = id && buildingById(id) ? { id, variant: 0 } : null;
    if (this.buildTool) this.select(null);
    this.updateGhost();
    this.emitHud(true);
  }

  rotateBuildTool(): void {
    if (!this.buildTool) return;
    this.buildTool.variant++;
    this.updateGhost();
  }

  /** PNG data URL preview of a sprite, for the build menu. */
  thumbnail(spriteId: string): string { return this.renderer.thumbnail(spriteId); }

  private updateGhost(): void {
    const tool = this.buildTool, t = this.hoverTile;
    if (!tool || !t) { this.renderer.setGhost(null); return; }
    const def = buildingById(tool.id)!;
    const problem = this.sim.building.check(def.id, t.x, t.y);
    this.renderer.setGhost({ spriteId: def.variants[tool.variant % def.variants.length], rect: { x: t.x, y: t.y, w: def.width, d: def.depth }, valid: !problem });
    this.ghostProblem = problem;
  }

  private ghostProblem: string | null = null;

  /**
   * Developer tool, deliberately not wired to any player-facing UI: drive the robot directly for
   * debugging (reachable from the browser console in dev builds as `__ROOTWORKS__.debugCommand('harvest')`).
   * Each command replaces whatever the robot was doing.
   */
  debugCommand(cmd: PlayerCommand): void {
    const c = this.commands, sel = this.selected;
    if (this.programActive) return this.note('A program is controlling the robot. Stop it to use manual controls.', false);
    if (cmd === 'stop') { c.stop(); return; }
    if (cmd === 'deposit') {
      if (this.robot.inventory.isEmpty) return this.note('Nothing to deposit', false);
      c.stop(); c.returnToStorage(); c.deposit();
      return;
    }
    if (cmd === 'harvest') {
      const node = sel && this.nodeAt(sel);
      if (!node) { // no deposit selected: harvest whatever is next to the robot
        if (!this.adjacentNode()) return this.note('Select a resource deposit to harvest', false);
        c.stop(); c.harvest();
        return;
      }
      if (!c.canHarvest(node.tileX, node.tileY)) {
        return this.note(node.depleted ? 'Deposit is depleted' : this.robot.inventory.isFull ? 'Inventory full: deposit first' : 'Deposit not reachable', false);
      }
      c.stop(); c.approach(node.tileX, node.tileY); c.harvest(node.tileX, node.tileY);
      return;
    }
    // move: to the selected tile, or next to whatever stands on it
    if (!sel) return this.note('Select a tile first', false);
    const e = this.sim.entities.at(sel.x, sel.y);
    if (e && e.blocking && e !== this.robot) { c.stop(); c.approach(sel.x, sel.y); return; }
    if (!c.canReach(sel.x, sel.y)) return this.note(`Tile (${sel.x}, ${sel.y}) is not reachable`, false);
    c.stop(); c.moveTo(sel.x, sel.y);
  }

  private nodeAt(t: { x: number; y: number }): ResourceNode | null {
    const e = this.sim.entities.at(t.x, t.y);
    return e instanceof ResourceNode ? e : null;
  }

  private adjacentNode(): ResourceNode | undefined {
    const here = { x: this.robot.tileX, y: this.robot.tileY };
    return this.sim.entities.ofKind<ResourceNode>('resource').find((n) => !n.depleted && isAdjacent(here, n.rect));
  }

  private report(r: ActionResult): void {
    if (this.programActive && this.tutorial.observe(r)) this.tutorialProgress();
    if (this.programActive) return; // the console reports program actions
    if (!r.ok) {
      if (r.error === 'stopped' || r.error?.startsWith('skipped')) return;
      return this.note(`${r.action}: ${r.error}`, false);
    }
    if (r.data && 'resource' in r.data) {
      const id = r.data.resource as ResourceId;
      this.note(`+${r.data.amount} ${RESOURCES[id].name}${r.data.remaining === 0 ? ' (deposit depleted)' : ''}`, true);
    } else if (r.data && 'deposited' in r.data) {
      const parts = Object.entries(r.data.deposited as Record<string, number>).map(([id, n]) => `${n} ${RESOURCES[id as ResourceId].name}`);
      this.note(`Stored ${parts.join(', ')}`, true);
    }
  }

  private note(text: string, ok: boolean): void {
    this.log = [{ id: ++this.logId, text, ok }, ...this.log].slice(0, LOG_SIZE);
    this.emitHud(true);
  }

  // ------------------------------------------------------------ loop

  private frame(dt: number): void {
    this.input.update(dt);
    // fixed-step simulation so robot programs run deterministically
    for (this.acc += dt; this.acc >= STEP; this.acc -= STEP) {
      for (const r of this.runners) r?.tick();
      this.sim.update(STEP);
    }
    this.time += dt;
    for (const c of this.sim.completedCommissions.splice(0)) {
      this.out('system', `Commission complete: ${c.title}. Reward added to storage.`);
      this.note(`Commission: ${c.title}`, true);
    }
    this.camera.update(dt);
    this.camera.apply(this.renderer.worldContainer);
    this.renderer.selection.setRoute(this.robot.queue.running?.route() ?? []);
    this.renderer.render(this.time, dt, this.camera);
    if ((this.hudTimer -= dt) <= 0) { this.hudTimer = 0.1; this.emitHud(); }
  }

  // ------------------------------------------------------------ selection + HUD

  private tileAt(sx: number, sy: number) {
    const w = this.camera.screenToWorld(sx, sy);
    return this.sim.world.pick(w.x, w.y);
  }

  /** Highlight rectangle for a tile: the whole footprint if a structure stands there. */
  private rectFor(t: { x: number; y: number }): TileRect {
    const e = this.sim.entities.at(t.x, t.y);
    return e && e.blocking ? e.rect : { x: t.x, y: t.y, w: 1, d: 1 };
  }

  private select(t: { x: number; y: number } | null): void {
    this.selected = t;
    this.renderer.selection.setSelected(t && this.rectFor(t));
    this.emitHud(true);
  }

  private selectionInfo(): SelectionInfo | null {
    const t = this.selected;
    if (!t) return null;
    const { world, entities } = this.sim;
    const e = entities.at(t.x, t.y);
    let entity: SelectionInfo['entity'];
    if (e) {
      entity = { name: e.name, description: e.description, kind: e.kind };
      if (e instanceof ResourceNode) {
        const d = e.def;
        entity.resource = { id: d.id, name: d.name, use: d.use, color: d.color, amount: e.amount, max: e.maxAmount, harvestTime: d.harvestTime, yieldPerAction: d.yieldPerAction, depleted: e.depleted };
        if (e.depleted) entity.name = `Depleted ${d.name.toLowerCase()} deposit`;
      }
    }
    if (e instanceof ConstructionSite && entity) entity.construction = e.progress;
    if (e instanceof Machine && entity) {
      const lines = (a: ResourceAmounts) => Object.entries(a).map(([id, n]) => line(id as ResourceId, n!));
      entity.machine = {
        recipes: e.def.recipes.map((r) => ({ name: r.name, inputs: lines(r.inputs), outputs: lines(r.outputs), time: r.time })),
        recipe: e.recipeIndex, working: e.working, progress: e.recipe ? Math.max(0, e.progress) / e.recipe.time : 0,
        input: e.input.entries().map(([id, n]) => line(id, n)), output: e.output.entries().map(([id, n]) => line(id, n)),
        inputCap: e.def.inputCap, outputCap: e.def.outputCap,
      };
    }
    if (entity && e) entity.program = programFor(e);
    if (e instanceof Machine && e.machineId === 'lab' && entity) {
      const r = this.sim.research, cur = r.current ? researchById(r.current) : null;
      entity.research = cur ? `Researching ${cur.name}: ${r.kitsDone} of ${cur.kits} kits used.` : 'No project picked yet. Open Research at the top to choose one (or the Lab picks the first when kits arrive).';
    }
    if ((e?.spriteId === 'lab' || e?.spriteId === 'bay') && entity) { // the workshop, or a region's field bay
      entity.workshop = { problem: this.sim.assembleProblem(), cost: Object.entries(Simulation.ROBOT_COST).map(([id, n]) => line(id as ResourceId, n!)), robots: this.sim.robots.length };
    }
    const px = Math.floor(t.x / PARCEL), py = Math.floor(t.y / PARCEL), locked = !world.isParcelUnlocked(px, py);
    const parcel = { px, py, locked, problem: locked ? this.sim.reclaimProblem(px, py) : null, cost: Object.entries(this.sim.reclaimCost()).map(([id, n]) => line(id as ResourceId, n!)) };
    return { tileX: t.x, tileY: t.y, tileName: TILE_INFO[world.get(t.x, t.y)!].name, elevation: world.heightAt(t.x, t.y), biome: BIOMES[world.biomeAt(t.x, t.y)].name, entity, parcel };
  }

  // ------------------------------------------------------------ player actions (UI): research, machines, land, robots

  selectResearch(id: string | null): void {
    const problem = this.sim.research.select(id);
    if (problem) this.note(problem, false);
    this.emitHud(true);
  }

  /** Choose the recipe of the selected machine. */
  setRecipe(i: number): void {
    const e = this.selected && this.sim.entities.at(this.selected.x, this.selected.y);
    if (e instanceof Machine) e.setRecipe(i);
    this.emitHud(true);
  }

  /** Reclaim the selected tile's parcel. */
  reclaimSelected(): void {
    if (!this.selected) return;
    const px = Math.floor(this.selected.x / PARCEL), py = Math.floor(this.selected.y / PARCEL);
    const problem = this.sim.reclaim(px, py);
    this.note(problem ?? 'New land reclaimed', !problem);
    if (!problem) { this.renderer.drawParcels(); this.out('system', 'A new parcel is yours: robots can work there and you can build on it.'); }
    this.emitHud(true);
  }

  assembleRobot(): void {
    const bay = [...this.sim.entities.list()].find((e) => e.spriteId === 'bay') ?? this.robot;
    const at = { x: bay.tileX, y: bay.tileY + 1 };
    const problem = this.sim.assembleRobot(at);
    this.note(problem ?? `${this.sim.robots.at(-1)!.name} assembled`, !problem);
    if (!problem) this.out('system', `A new robot joined. Press Run to start your program on all ${this.sim.robots.length} robots.`);
    this.emitHud(true);
  }

  setReducedMotion(on: boolean): void { this.renderer.setAmbient(!on); }

  setGuided(on: boolean): void { this.guided = on; this.emitHud(true); }

  private researchView(): ResearchView {
    const r = this.sim.research;
    return {
      firmware: r.firmware, current: r.current, progress: r.progress,
      nodes: RESEARCH.map((n) => ({
        id: n.id, name: n.name, description: n.description, kits: n.kits,
        state: r.isDone(n.id) ? 'done' : r.current === n.id ? 'current' : r.available(n) ? 'available' : 'locked',
        needs: n.requires.filter((q) => !r.isDone(q)).map((q) => researchById(q)?.name ?? q),
      })),
    };
  }

  private emitHud(force = false): void {
    const r = this.robot;
    const storage = this.sim.storages[0]?.inventory;
    const snap: HudSnapshot = {
      storage: RESOURCE_IDS.filter((id) => RESOURCES[id].raw || (storage?.get(id) ?? 0) > 0).map((id) => line(id, storage?.get(id) ?? 0)),
      robot: {
        name: r.name, state: r.state, x: r.tileX, y: r.tileY, used: r.inventory.total, capacity: r.inventory.capacity,
        cargo: r.inventory.entries().map(([id, n]) => line(id, n)), queue: r.queue.labels, progress: Math.round(r.progress * 20) / 20,
      },
      selection: this.selectionInfo(),
      log: this.log,
      tutorial: this.tutorial.steps,
      catalog: BUILDINGS.map((d) => ({
        id: d.id, name: d.name, description: d.description, category: d.category, sprite: d.variants[0],
        cost: Object.entries(d.cost).map(([id, n]) => ({ ...line(id as ResourceId, n!), have: storage?.get(id as ResourceId) ?? 0 })),
        locked: this.sim.building.isUnlocked(d) ? null : (d.requires && researchById(d.requires)?.name) ?? d.requires,
      })),
      build: this.buildTool ? { id: this.buildTool.id, name: buildingById(this.buildTool.id)!.name, problem: this.hoverTile ? this.ghostProblem : null, overMap: !!this.hoverTile } : null,
      timeOfDay: this.renderer.daylight.label,
      research: this.researchView(),
      commissions: this.sim.commissions.active().map((c) => ({
        id: c.id, title: c.title, progress: Math.min(c.target, c.measure(this.sim)), target: c.target,
        reward: Object.entries(c.reward).map(([id, n]) => line(id as ResourceId, n!)),
      })),
      robots: this.sim.robots.length,
      guided: this.guided,
      region: { id: this.region.id, name: this.region.name },
      regions: this.regionsView(),
    };
    const key = JSON.stringify(snap);
    if (!force && key === this.lastHud) return;
    this.lastHud = key;
    this.events.emit('hud', snap);
  }

  // ------------------------------------------------------------ programs

  /** Compile and start a program. Replaces any running program and cancels manual commands. */
  runProgram(language: LanguageId, source: string, resumeFrom?: (RunnerSave | null)[]): void {
    this.stopProgram(true);
    for (const r of this.sim.robots) new RobotCommands(this.sim, r).stop();
    let compiled;
    try {
      compiled = LANGUAGES[language].compile(source, { guided: this.guided, firmware: this.sim.research.firmware });
    } catch (e) {
      this.reportError(e instanceof ScriptError ? e : new ScriptError('syntax', String(e)), language);
      return;
    }
    const robots = this.sim.robots;
    try {
      this.runners = robots.map((robot, i) => {
        if (resumeFrom && !resumeFrom[i]) return null; // this robot had already finished
        return new ProgramRunner(compiled, this.hostFor(robot), undefined, resumeFrom?.[i] ?? undefined);
      });
    } catch {
      this.runners = [];
      this.out('system', 'The saved program could not be resumed; press Run to start it again.');
      return;
    }
    const n = this.runners.filter(Boolean).length;
    this.out('system', resumeFrom ? 'Program resumed from your save.' : `Program started (${LANGUAGES[language].name})${n > 1 ? ` on ${n} robots` : ''}.`);
    this.programSource = { language, source };
    this.runners.forEach((runner, i) => {
      if (!runner) return;
      const robot = robots[i];
      if (i === 0 || !this.runners[0]) runner.events.on('line', (line) => this.setProgram({ ...this.program, line }));
      runner.events.on('error', (err) => { this.reportError(err, language, n > 1 ? robot.name : undefined); new RobotCommands(this.sim, robot).stop(); });
      runner.events.on('state', () => this.programStateChanged(language));
    });
    this.setProgram({ state: resumeFrom?.find(Boolean)?.state ?? 'running', language, line: null, errorLine: null });
    this.emitHud(true);
  }

  /** The program's overall state across all robots. */
  private programStateChanged(language: LanguageId): void {
    const states = this.runners.filter((r): r is ProgramRunner => !!r).map((r) => r.state);
    const state = states.includes('running') ? 'running' : states.includes('paused') ? 'paused' : states.includes('error') ? 'error' : states.every((s) => s === 'stopped') ? 'stopped' : 'finished';
    if (state === this.program.state) return;
    if (state === 'finished') this.out('system', `Program completed (${this.runners.reduce((s, r) => s + (r?.stepCount ?? 0), 0).toLocaleString('en')} steps).`);
    const stepping = this.runners.some((r) => r?.isStepping) || (state === 'paused' && this.program.state === 'running' && this.lastStep);
    if (state === 'paused' && !stepping) this.out('system', 'Paused. Robots finish their current action, then wait.');
    if (state === 'running' && this.program.state === 'paused' && !stepping) this.out('system', 'Resumed.');
    this.lastStep = this.runners.some((r) => r?.isStepping);
    if (state === 'error') return; // reportError already set the status
    this.setProgram({ ...this.program, state, language, line: state === 'finished' || state === 'stopped' ? null : this.program.line });
  }

  pauseProgram(): void { for (const r of this.runners) r?.pause(); }
  resumeProgram(): void { for (const r of this.runners) r?.resume(); }

  /** Run one line of the program (starting it paused first if needed), then pause: the debugger for beginners. */
  stepProgram(language: LanguageId, source: string): void {
    if (!this.programActive) {
      this.runProgram(language, source);
      if (!this.programActive) return; // did not compile
      this.lastStep = true; // the start-paused is part of stepping: no "Paused" message
      for (const r of this.runners) r?.pause();
    }
    for (const r of this.runners) r?.step();
  }

  /** The robot functions as the command palette lists them, in definition order. */
  commandReference(): { name: string; params: readonly string[]; doc: string; tier: number; example: string }[] {
    const fns = createHostFunctions(this.commands, { action() {}, result() {} });
    const first = ['go_to', 'harvest', 'deposit', 'put', 'take']; // what beginners need, before the finer controls
    const rank = (n: string) => (first.includes(n) ? first.indexOf(n) : first.length);
    return [...fns.values()].sort((a, b) => rank(a.name) - rank(b.name)).map((f) => ({ name: f.name, params: f.params, doc: f.doc, tier: f.tier ?? 0, example: f.example ?? `${f.name}()` }));
  }

  /** Ask the program editor to insert a snippet (from the inspector's "Program this" hints). */
  insertCode(code: string): void { this.events.emit('insertCode', code); }

  /** Stop the program and cancel whatever the robots were doing for it. */
  stopProgram(quiet = false): void {
    if (!this.programActive) return;
    for (const r of this.runners) r?.stop();
    for (const r of this.sim.robots) new RobotCommands(this.sim, r).stop();
    if (!quiet) this.out('system', 'Program stopped.');
    this.emitHud(true);
  }

  /** Current program status (for late subscribers). */
  get programStatus(): ProgramStatus { return this.program; }

  private reportError(err: ScriptError, language: LanguageId, robotName?: string): void {
    const where = (robotName ? `${robotName}, ` : '') + (err.line ? `Line ${err.line}: ` : '');
    const title = err.kind === 'syntax' ? 'Syntax error' : err.kind === 'limit' ? 'Execution limit' : err.kind === 'unavailable' ? 'Not available yet' : 'Runtime error';
    this.out('error', `${title}. ${where}${err.message}`, err.line);
    this.setProgram({ state: 'error', language, line: null, errorLine: err.line ?? null });
    this.emitHud(true);
  }

  private setProgram(p: ProgramStatus): void {
    this.program = p;
    this.events.emit('program', p);
  }

  private out(kind: ConsoleKind, text: string, line?: number): void {
    this.events.emit('console', { id: ++this.consoleId, kind, text, line });
  }

  /** Re-send the current HUD snapshot (e.g. to a listener that subscribed late). */
  refreshHud(): void { this.emitHud(true); }

  destroy(): void {
    for (const r of this.runners) r?.stop();
    this.input?.destroy();
    this.renderer.destroy();
  }
}
