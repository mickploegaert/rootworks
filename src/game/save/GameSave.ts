import { SPARKS_PER_KIT } from '../research/ResearchSystem.ts';
import { CHAPTERS, OFFERING_ITEMS } from '../progress/Story.ts';
import { researchById } from '../research/ResearchDefs.ts';
import type { CosmeticId } from '../render/sprites/robot.ts';
import { BUILDINGS, buildingById } from '../building/BuildingDefs.ts';
import type { Entity } from '../entities/Entity.ts';
import { ConstructionSite } from '../entities/ConstructionSite.ts';
import { Machine } from '../entities/Machine.ts';
import { Prop } from '../entities/Prop.ts';
import { ResourceNode } from '../entities/ResourceNode.ts';
import { Robot as RobotClass, type Robot } from '../entities/Robot.ts';
import { RESOURCE_IDS, type ResourceId } from '../resources/ResourceDefs.ts';
import type { RunnerSave } from '../scripting/ProgramRunner.ts';
import type { LanguageId } from '../scripting/types.ts';
import type { Simulation } from '../Simulation.ts';
import { REGION_IDS, START_REGION, regionById, type RegionId } from '../world/regions.ts';
import type { KeyValueStorage } from './ProgramStore.ts';

/** Version 2: one diff per visited region. Version 1 files (one world, before regions) are migrated on load. */
export const SAVE_VERSION = 2;
const KEY = 'rootworks.game.v1';

type Amounts = Partial<Record<ResourceId, number>>;

/**
 * One region's state as a diff against its freshly generated world (which is rebuilt from `seed`):
 * reclaimed parcels, removed or depleted things, what the player built, robots, storage and their running program.
 */
export interface RegionSave {
  seed: number;
  parcels: number[];
  /** Generated entities that no longer exist (felled trees, cleared plants). */
  removed: string[];
  /** Generated deposits whose amount changed. */
  amounts: [string, number][];
  /** Player-built structures (sites under construction are saved as finished). Machines keep their recipe and buffers. */
  built: { sprite: string; x: number; y: number; recipe?: number; input?: Amounts; output?: Amounts }[];
  robots: { name?: string; x: number; y: number; facing: number; cargo: Amounts }[];
  storage: Amounts;
  /** The program the region's robots were running: one runner snapshot per robot (null where it had finished). */
  /** sources: each robot's own program (index = robot), absent in saves from before per-robot programs. */
  program: { language: LanguageId; source: string; runners: (RunnerSave | null)[]; sources?: (string | null)[] } | null;
}

/** Progress that belongs to the player, not to a place: it travels with them between regions. */
export interface Progress {
  research: string[];
  /** Research in progress. */
  researching: { id: string; kits: number } | null;
  /** Unspent Sparks (absent in saves from before the skill tree). */
  sparks?: number;
  /** Completed commissions. */
  commissions: string[];
  /** Challenge stars and best scores, and today's order (absent in older saves). */
  challenges?: { stars: [string, number][]; best: [string, number][]; daily: { day: string; got: number; done: boolean } };
  /** Milestones reached, items delivered in total, and Seedling's accessory (absent in older saves). */
  achievements?: { done: string[]; delivered: number; cosmetic: string | null };
  /** The valley's story: chapter, offerings given to the Heart Tree, its spring level (absent in older saves). */
  story?: { chapter: number; offered: Record<string, number>; level: number };
}

/** A save game: the world seed, which region is active, a diff per visited region, and the player's progress. */
export interface SaveFile extends Progress {
  version: typeof SAVE_VERSION;
  /** World seed; each region's seed derives from it (regions.ts). */
  seed: number;
  savedAt: number;
  /** Seconds of play (drives the day/night clock). */
  time: number;
  /** The region the player is in. */
  region: RegionId;
  /** Every region visited so far. A region never visited has no entry: it does not exist yet. */
  regions: Partial<Record<RegionId, RegionSave>>;
  /** Completed tutorial steps. */
  tutorial?: string[];
}

/** Stable identity of a generated entity: what it is and where. */
export const entityKey = (e: Entity) => `${e.spriteId}@${e.tileX},${e.tileY}`;

/** Sprites a save may place: only things from the build menu. */
const BUILDABLE_SPRITES = new Set(BUILDINGS.flatMap((b) => b.variants));

/** Capture a region's changes relative to its freshly generated state. */
export function captureRegion(sim: Simulation, generated: ReadonlyMap<string, number>): Omit<RegionSave, 'program'> {
  const present = new Set<string>();
  const amounts: [string, number][] = [];
  const built: RegionSave['built'] = [];
  for (const e of sim.entities.list()) {
    if (e.kind === 'robot' || e.kind === 'storage') continue;
    const k = entityKey(e);
    if (generated.has(k)) {
      present.add(k);
      if (e instanceof ResourceNode && e.amount !== generated.get(k)) amounts.push([k, e.amount]);
    } else if (e instanceof Machine) built.push({ sprite: e.spriteId, x: e.tileX, y: e.tileY, recipe: e.recipeIndex, input: e.input.snapshot(), output: e.output.snapshot() });
    else if ((e instanceof Prop || e instanceof ConstructionSite) && BUILDABLE_SPRITES.has(e.spriteId)) built.push({ sprite: e.spriteId, x: e.tileX, y: e.tileY });
  }
  return {
    seed: sim.seed ?? 0,
    parcels: sim.world.unlockedParcels(),
    removed: [...generated.keys()].filter((k) => !present.has(k)),
    amounts,
    built,
    robots: sim.robots.map((r) => ({ name: r.name, x: r.tileX, y: r.tileY, facing: r.facing, cargo: r.inventory.snapshot() })),
    storage: sim.storages[0]?.inventory.snapshot() ?? {},
  };
}

export function captureProgress(sim: Simulation): Progress {
  return {
    research: [...sim.research.completed],
    researching: null,
    sparks: sim.research.sparks,
    commissions: [...sim.commissions.done],
    challenges: { stars: [...sim.challenges.stars], best: [...sim.challenges.best], daily: { ...sim.challenges.daily } },
    achievements: { done: [...sim.achievements.done], delivered: sim.achievements.delivered, cosmetic: sim.achievements.cosmetic },
    story: { chapter: sim.story.chapter, offered: { ...sim.story.offered } as Record<string, number>, level: sim.story.level },
  };
}

/** Restore the player's progress (apply before the region, so research bonuses reach its robots). */
export function applyProgress(sim: Simulation, p: Progress): void {
  for (const r of p.research) sim.research.completed.add(r);
  // older saves: Counter also taught arithmetic and comparisons, Loop also def; kits fed to a project come back as Sparks
  if (sim.research.isDone('counter')) sim.research.completed.add('operators');
  if (sim.research.isDone('loop')) sim.research.completed.add('functions');
  if (sim.research.isDone('counter')) sim.research.completed.add('lists'); // lists were part of the old firmware too
  sim.research.sparks = (p.sparks ?? 0) + (p.researching ? p.researching.kits * SPARKS_PER_KIT : 0);
  for (const c of p.commissions) sim.commissions.done.add(c);
  if (p.challenges) {
    for (const [id, n] of p.challenges.stars) sim.challenges.stars.set(id, n);
    sim.challenges.best = new Map(p.challenges.best);
    sim.challenges.daily = { ...p.challenges.daily };
  }
  if (p.story) {
    sim.story.chapter = p.story.chapter; sim.story.level = p.story.level;
    sim.story.offered = Object.fromEntries(Object.entries(p.story.offered).filter(([id]) => (OFFERING_ITEMS as readonly string[]).includes(id)));
  }
  if (p.achievements) {
    for (const id of p.achievements.done) sim.achievements.done.add(id);
    sim.achievements.delivered = p.achievements.delivered;
    const c = p.achievements.cosmetic as CosmeticId | null;
    sim.achievements.cosmetic = c && sim.achievements.cosmetics.includes(c) ? c : null; // only what was earned
  }
}

/** Apply a validated region diff to the region's freshly generated simulation. */
export function applyRegion(sim: Simulation, s: Omit<RegionSave, 'program'>): void {
  const { world, entities } = sim;
  const P = world.parcelsAcross;
  for (let py = 0; py < P; py++) for (let px = 0; px < P; px++) world.setParcelUnlocked(px, py, false);
  for (const i of s.parcels) world.setParcelUnlocked(i % P, Math.floor(i / P), true);
  const removed = new Set(s.removed), amounts = new Map(s.amounts);
  for (const e of [...entities.list()]) {
    if (e.kind === 'robot' || e.kind === 'storage') continue;
    const k = entityKey(e);
    if (removed.has(k)) entities.remove(e);
    else if (e instanceof ResourceNode && amounts.has(k)) e.amount = Math.max(0, Math.min(e.maxAmount, amounts.get(k)!));
  }
  for (const b of s.built) {
    const def = BUILDINGS.find((d) => d.variants.includes(b.sprite));
    if (!def) continue; // only build-menu structures can come from a save
    if (def.machine) {
      const m = new Machine(b.x, b.y, b.sprite, def.machine, def.name, def.description, def.width, def.depth);
      m.setRecipe(b.recipe ?? 0);
      for (const [id, n] of Object.entries(b.input ?? {})) m.input.add(id as ResourceId, n!);
      for (const [id, n] of Object.entries(b.output ?? {})) m.output.add(id as ResourceId, n!);
      entities.add(m);
    } else entities.add(new Prop(b.x, b.y, b.sprite, def.name, def.description, 'structure', def.width, def.depth));
  }
  for (let i = sim.robots.length; i < Math.min(s.robots.length, 8); i++) entities.add(new RobotClass(s.robots[i].x, s.robots[i].y, s.robots[i].name ?? `RW-0${i + 1}`));
  sim.robots.forEach((r: Robot, i) => {
    const saved = s.robots[i];
    if (!saved || !world.inBounds(saved.x, saved.y)) return;
    sim.applySkills(r);
    r.tileX = saved.x; r.tileY = saved.y; r.posX = saved.x + 0.5; r.posY = saved.y + 0.5;
    r.facing = (saved.facing & 3) as Robot['facing'];
    for (const [id, n] of Object.entries(saved.cargo)) r.inventory.add(id as ResourceId, n!);
  });
  const store = sim.storages[0]?.inventory;
  if (store) for (const [id, n] of Object.entries(s.storage)) store.add(id as ResourceId, n!);
}

// ------------------------------------------------------------ validation (saves come from outside the program)

const isNum = (v: unknown, min = -Infinity, max = Infinity): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const isInt = (v: unknown, min = -Infinity, max = Infinity): v is number => isNum(v, min, max) && Number.isInteger(v);
const amountsOk = (o: unknown) => typeof o === 'object' && o !== null && !Array.isArray(o)
  && Object.entries(o).every(([k, n]) => RESOURCE_IDS.includes(k as ResourceId) && isInt(n, 0, 1e9));
const stringsOk = (a: unknown, max = 100_000, len = 80) => Array.isArray(a) && a.length <= max && a.every((c) => typeof c === 'string' && c.length < len);

function regionSaveOk(s: RegionSave, worldSize: number): boolean {
  const P = Math.ceil(worldSize / 32);
  if (!s || typeof s !== 'object' || !isInt(s.seed)) return false;
  if (!Array.isArray(s.parcels) || !s.parcels.every((i) => isInt(i, 0, P * P - 1))) return false;
  if (!stringsOk(s.removed)) return false;
  if (!Array.isArray(s.amounts) || !s.amounts.every((a) => Array.isArray(a) && typeof a[0] === 'string' && isInt(a[1], 0, 1e9))) return false;
  if (!Array.isArray(s.built) || !s.built.every((b) => typeof b.sprite === 'string' && isInt(b.x, 0, worldSize - 1) && isInt(b.y, 0, worldSize - 1)
    && (b.recipe === undefined || isInt(b.recipe, 0, 20)) && (b.input === undefined || amountsOk(b.input)) && (b.output === undefined || amountsOk(b.output)))) return false;
  if (!Array.isArray(s.robots) || s.robots.length > 8 || !s.robots.every((r) => isInt(r.x, 0, worldSize - 1) && isInt(r.y, 0, worldSize - 1) && isInt(r.facing, 0, 3) && amountsOk(r.cargo)
    && (r.name === undefined || (typeof r.name === 'string' && r.name.length < 40)))) return false;
  if (!amountsOk(s.storage)) return false;
  if (s.program !== null) {
    const p = s.program;
    if (!p || typeof p.source !== 'string' || p.source.length > 200_000 || !['python', 'java', 'typescript'].includes(p.language)
      || !Array.isArray(p.runners) || p.runners.length > 200 || !p.runners.every((r) => r === null || typeof r === 'object')) return false;
    if (p.sources !== undefined && (!Array.isArray(p.sources) || p.sources.length > 200 || !p.sources.every((x) => x === null || (typeof x === 'string' && x.length <= 200_000)))) return false;
  }
  return true;
}

function progressOk(s: Partial<Progress> & { tutorial?: unknown }): boolean {
  if (s.researching !== null && (typeof s.researching !== 'object' || typeof s.researching.id !== 'string' || !isInt(s.researching.kits, 0, 1000))) return false;
  if (s.sparks !== undefined && !isInt(s.sparks, 0, 1_000_000)) return false;
  if (s.challenges !== undefined) {
    const c = s.challenges, pairs = (a: unknown) => Array.isArray(a) && a.length < 100 && a.every((x) => Array.isArray(x) && typeof x[0] === 'string' && typeof x[1] === 'number' && Number.isFinite(x[1]));
    if (!c || !pairs(c.stars) || !pairs(c.best) || !c.daily || typeof c.daily.day !== 'string' || !isInt(c.daily.got, 0, 1_000_000) || typeof c.daily.done !== 'boolean') return false;
  }
  if (s.achievements !== undefined) {
    const a = s.achievements;
    if (!a || !Array.isArray(a.done) || a.done.length > 100 || !a.done.every((x) => typeof x === 'string') || !isInt(a.delivered, 0, 1e12) || (a.cosmetic !== null && typeof a.cosmetic !== 'string')) return false;
  }
  if (s.story !== undefined) {
    const st = s.story;
    if (!st || !isInt(st.chapter, 0, CHAPTERS.length) || !isInt(st.level, 0, 10_000) || !st.offered || typeof st.offered !== 'object' || !Object.values(st.offered).every((n) => isInt(n, 0, 1e12))) return false;
  }
  if (s.tutorial !== undefined && !stringsOk(s.tutorial, 50, 40)) return false;
  if (s.commissions !== undefined && !stringsOk(s.commissions, 500)) return false;
  return stringsOk(s.research, 500);
}

/**
 * Before regions (version 1) a save was one world, the starting valley, with the player's progress mixed in.
 * It becomes a version 2 save whose only visited region is the valley, at the same coordinates.
 */
function migrateV1(v: Record<string, unknown>): SaveFile {
  const { seed, parcels, removed, amounts, built, robots, storage, program } = v as unknown as RegionSave;
  return {
    version: SAVE_VERSION, seed, savedAt: v.savedAt as number, time: v.time as number, region: START_REGION,
    regions: { [START_REGION]: { seed, parcels, removed, amounts, built, robots, storage, program } },
    research: v.research as string[], researching: v.researching as Progress['researching'],
    commissions: (v.commissions as string[] | undefined) ?? [], tutorial: v.tutorial as string[] | undefined,
  };
}

/** Returns the save (migrated to the current version) if it is well-formed, else null. Never throws. */
export function validateSave(raw: unknown): SaveFile | null {
  try {
    let s = raw as SaveFile;
    if (!s || typeof s !== 'object' || !isInt(s.seed) || !isNum(s.time, 0) || !isNum(s.savedAt, 0)) return null;
    if ((s.version as number) === 1) {
      if (!regionSaveOk(s as unknown as RegionSave, regionById(START_REGION)!.size) || !progressOk(s)) return null;
      s = migrateV1(s as unknown as Record<string, unknown>);
    }
    if (s.version !== SAVE_VERSION || !progressOk(s) || !stringsOk(s.commissions, 500)) return null;
    const active = regionById(s.region);
    if (!active || active.future || !s.regions || typeof s.regions !== 'object') return null;
    for (const [id, r] of Object.entries(s.regions)) {
      const def = regionById(id);
      if (!def || def.future || !REGION_IDS.includes(id as RegionId) || !regionSaveOk(r as RegionSave, def.size)) return null;
    }
    return s;
  } catch {
    return null;
  }
}

/** Save slots shown in Load Game. Slot 1 uses the original key, so saves from before slots existed load as slot 1. */
export const SLOT_IDS = [1, 2, 3] as const;
export type SlotId = (typeof SLOT_IDS)[number];

/** What the menu shows about a slot without starting the game. */
export interface SlotSummary {
  id: SlotId;
  savedAt: number;
  playSeconds: number;
  robots: number;
  research: number;
  regions: number;
  tutorialSteps: number;
  /** The player's name for this valley, if they gave it one. */
  name: string | null;
  sparks: number;
  /** Programming skills learned, 0..3: how far Seedling's sprout has grown. */
  sprout: number;
  cosmetic: string | null;
  /** The Heart Tree's bloom stage, 0..5. */
  bloom: number;
}

/** Reads and writes one save slot in browser storage. Never throws; a broken save is ignored, not fatal. */
export class SaveSlot {
  private readonly key: string;
  constructor(private readonly storage: KeyValueStorage | null, readonly id: SlotId = 1) {
    this.key = id === 1 ? KEY : `${KEY}.slot${id}`;
  }

  load(): SaveFile | null {
    try {
      const raw = this.storage?.getItem(this.key);
      return raw ? validateSave(JSON.parse(raw)) : null;
    } catch { return null; }
  }

  write(s: SaveFile): boolean {
    try { this.storage?.setItem(this.key, JSON.stringify(s)); return true; } catch { return false; }
  }

  clear(): void {
    try { this.storage?.removeItem?.(this.key); this.storage?.setItem(this.key, ''); this.storage?.removeItem?.(`${this.key}.name`); } catch { /* nothing to clear */ }
  }

  summary(): SlotSummary | null {
    const s = this.load();
    if (!s) return null;
    const regions = Object.values(s.regions);
    return {
      id: this.id, savedAt: s.savedAt, playSeconds: s.time, robots: regions.reduce((n, r) => n + (r?.robots.length ?? 0), 0),
      research: s.research.length, regions: regions.length, tutorialSteps: s.tutorial?.length ?? 0,
      name: this.name, sparks: s.sparks ?? 0, sprout: Math.min(3, s.research.filter((id) => researchById(id)?.code).length),
      cosmetic: s.achievements?.cosmetic ?? null, bloom: Math.min(CHAPTERS.length, s.story?.chapter ?? 0),
    };
  }

  /** The valley's name, kept beside the save (the game itself never writes it). */
  get name(): string | null {
    try { return this.storage?.getItem(`${this.key}.name`)?.slice(0, 40) || null; } catch { return null; }
  }

  rename(name: string): void {
    try { this.storage?.setItem(`${this.key}.name`, name.trim().slice(0, 40)); } catch { /* storage unavailable: keep playing */ }
  }

  /** Every slot, empty ones as null. */
  static all(storage: KeyValueStorage | null): { slot: SaveSlot; summary: SlotSummary | null }[] {
    return SLOT_IDS.map((id) => { const slot = new SaveSlot(storage, id); return { slot, summary: slot.summary() }; });
  }

  /** The slot saved most recently, if any. */
  static latest(storage: KeyValueStorage | null): SlotSummary | null {
    return SaveSlot.all(storage).map((s) => s.summary).filter((s): s is SlotSummary => !!s).sort((a, b) => b.savedAt - a.savedAt)[0] ?? null;
  }
}

export { buildingById };
