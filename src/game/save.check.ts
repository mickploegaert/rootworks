// Phase 1 gate checks: save round-trips, determinism, and simulation cost with 20 robots running code.
// Run with `npm run check`.
import assert from 'node:assert/strict';
import { RobotCommands } from './api/RobotCommands.ts';
import { Robot } from './entities/Robot.ts';
import { Prop } from './entities/Prop.ts';
import { ResourceNode } from './entities/ResourceNode.ts';
import { SAVE_VERSION, SaveSlot, captureProgress, entityKey, validateSave, type RegionSave, type SaveFile } from './save/GameSave.ts';
import { SettingsStore } from './save/Settings.ts';
import { LANGUAGES } from './scripting/adapters.ts';
import { createHostFunctions } from './scripting/hostApi.ts';
import { ProgramRunner } from './scripting/ProgramRunner.ts';
import { Simulation } from './Simulation.ts';
import { TUTORIAL } from './world/WorldGenerator.ts';

const SEED = 1337;
const fullSave = (sim: Simulation, program: RegionSave['program'] = null): SaveFile =>
  ({ version: SAVE_VERSION, seed: SEED, savedAt: 1, time: 42, region: 'vale', regions: { vale: { ...sim.capture(), program } }, ...captureProgress(sim) });
/** Load the active region of a save, the way the game does. */
const load = (s: SaveFile) => Simulation.generate(s.regions[s.region]!.seed, s.regions[s.region], s.region, s);
/** Finish all construction now (drones take a few seconds). */
const finishSites = (sim: Simulation) => { for (let i = 0; i < 60 * 10; i++) sim.update(1 / 60); };

/** A hash of everything a player could notice in the simulation. */
function stateHash(sim: Simulation): string {
  const parts: string[] = [];
  for (const e of sim.entities.list()) {
    let s = `${e.kind}:${entityKey(e)}`;
    if (e instanceof ResourceNode) s += `:${e.amount}`;
    if (e instanceof Robot) s += `:${e.posX.toFixed(4)},${e.posY.toFixed(4)}:${JSON.stringify(e.inventory.snapshot())}`;
    parts.push(s);
  }
  parts.sort();
  parts.push(JSON.stringify(sim.storages[0]?.inventory.snapshot()), sim.world.unlockedParcels().join(','));
  let h = 0;
  for (const p of parts) for (let i = 0; i < p.length; i++) h = (Math.imul(h, 31) + p.charCodeAt(i)) | 0;
  return `${parts.length}:${h}`;
}

// ---------------------------------------------------------------- determinism of generation
assert.equal(stateHash(Simulation.generate(SEED)), stateHash(Simulation.generate(SEED)), 'same seed, same world');
assert.notEqual(stateHash(Simulation.generate(SEED)), stateHash(Simulation.generate(SEED + 1)), 'other seed, other world');

// ---------------------------------------------------------------- save round-trip
{
  const sim = Simulation.generate(SEED);
  const robot = sim.robots[0], store = sim.storages[0];
  const pile = sim.entities.at(TUTORIAL.pile.x, TUTORIAL.pile.y) as ResourceNode;
  pile.take(5);
  const plant = [...sim.entities.list()].find((e) => e instanceof Prop && e.category === 'vegetation' && sim.world.isUnlocked(e.tileX, e.tileY))!;
  sim.entities.remove(plant);
  store.inventory.add('wood', 7); store.inventory.add('scrap', 2);
  robot.inventory.add('stone', 3);
  robot.tileX = 126; robot.tileY = 131; robot.posX = 126.5; robot.posY = 131.5;
  sim.world.setParcelUnlocked(5, 4, true);
  sim.building.research.add('Steam Power');
  sim.research.completed.add('gardening');
  // build something on open, unlocked ground
  let built: { x: number; y: number } | null = null;
  for (let y = 100; y < 156 && !built; y++) for (let x = 100; x < 156 && !built; x++) if (!sim.building.check('planter', x, y)) built = { x, y };
  assert.ok(built, 'somewhere to build');
  assert.equal(sim.building.place('planter', 2, built!.x, built!.y), null);
  // a machine too, with ingredients in its buffer
  sim.storages[0].inventory.add('scrap', 6);
  let bench: { x: number; y: number } | null = null;
  for (let y = 100; y < 156 && !bench; y++) for (let x = 100; x < 156 && !bench; x++) if (!sim.building.check('workbench', x, y)) bench = { x, y };
  assert.equal(sim.building.place('workbench', 0, bench!.x, bench!.y), null);
  finishSites(sim);
  const wb = sim.entities.at(bench!.x, bench!.y) as import('./entities/Machine.ts').Machine;
  assert.equal(wb.kind, 'machine', 'drones finished the workbench');
  wb.input.add('wood', 3); wb.setRecipe(1);

  const save = JSON.parse(JSON.stringify(fullSave(sim)));
  assert.ok(validateSave(save), 'a real save validates');
  const loaded = load(save);
  assert.equal(stateHash(loaded), stateHash(sim), 'loaded world matches the saved one');
  assert.equal((loaded.entities.at(TUTORIAL.pile.x, TUTORIAL.pile.y) as ResourceNode).amount, 10);
  assert.equal(loaded.entities.at(built!.x, built!.y)!.spriteId, 'planter_2');
  assert.equal(loaded.storages[0].inventory.get('wood'), 7 - 3, 'cost of the planter was paid before saving');
  assert.ok(loaded.world.isParcelUnlocked(5, 4));
  assert.ok(loaded.building.research.has('Steam Power'));
  assert.deepEqual(loaded.robots[0].inventory.snapshot(), { stone: 3 });
  assert.deepEqual(JSON.parse(JSON.stringify(fullSave(loaded))), save, 'saving again gives the same file');

  // a version 1 save (one world, before regions) still loads: it becomes the valley region, unchanged
  const { regions, region: _r, version: _v, ...rest } = save;
  const v1 = JSON.parse(JSON.stringify({ ...rest, version: 1, ...regions.vale }));
  const migrated = validateSave(v1);
  assert.ok(migrated, 'a version 1 save validates');
  assert.equal(migrated!.version, SAVE_VERSION);
  assert.equal(migrated!.region, 'vale');
  assert.deepEqual(Object.keys(migrated!.regions), ['vale'], 'nothing but the valley exists in it');
  assert.equal(stateHash(load(migrated!)), stateHash(sim), 'the migrated valley is the saved one');
}

// ---------------------------------------------------------------- broken or hostile saves are refused, not trusted
{
  const good = JSON.parse(JSON.stringify(fullSave(Simulation.generate(SEED))));
  const bad = (patch: (s: Record<string, any>) => void) => { const s = structuredClone(good); patch(s); return validateSave(s); };
  assert.equal(bad((s) => { s.version = 99; }), null);
  assert.equal(bad((s) => { s.regions.vale.parcels = [-1]; }), null);
  assert.equal(bad((s) => { s.regions.vale.built = [{ sprite: 'lab', x: 1e6, y: 0 }]; }), null);
  assert.equal(bad((s) => { s.regions.vale.storage = { gold: 5 }; }), null);
  assert.equal(bad((s) => { s.regions.vale.robots = [{ x: 1, y: 1, facing: 9, cargo: {} }]; }), null);
  assert.equal(bad((s) => { s.region = 'atlantis'; }), null, 'unknown region');
  assert.equal(bad((s) => { s.region = 'saltmarsh'; }), null, 'a region not in the game yet cannot be active');
  assert.equal(bad((s) => { s.regions.quarry = { ...s.regions.vale, robots: [{ x: 200, y: 1, facing: 0, cargo: {} }] }; }), null, 'checked against the quarry size');
  assert.equal(validateSave('not a save'), null);
  // a sprite that is not in the build menu is skipped on load, never placed
  const sneaky = structuredClone(good);
  sneaky.regions.vale!.built = [{ sprite: 'giant_tree', x: 120, y: 120 }];
  assert.ok(!(load(sneaky).entities.at(120, 120)?.spriteId === 'giant_tree' && !Simulation.generate(SEED).entities.at(120, 120)));
}

// ---------------------------------------------------------------- 20 robots running code: deterministic and cheap
const PROGRAM = `n = 0
while n < 400:
    if not move("east"):
        move("north")
    move("west")
    n += 1
    if n % 5 == 0:
        x, y = get_position()
`;
function fleet(): { sim: Simulation; runners: ProgramRunner[] } {
  const sim = Simulation.generate(SEED);
  const runners: ProgramRunner[] = [];
  for (let i = 0; i < 20; i++) {
    const r = i === 0 ? sim.robots[0] : new Robot(110 + (i % 10) * 3, 110 + Math.floor(i / 10) * 20, `RW-${i}`);
    if (i > 0) sim.entities.add(r);
    const host = { functions: createHostFunctions(new RobotCommands(sim, r), { action() {}, result() {} }), print() {} };
    runners.push(new ProgramRunner(LANGUAGES.python.compile(PROGRAM), host));
  }
  return { sim, runners };
}
{
  const a = fleet(), b = fleet();
  const startPos = a.sim.robots.map((r) => `${r.tileX},${r.tileY}`);
  const ticks = 600;
  const t0 = performance.now();
  for (let i = 0; i < ticks; i++) { for (const r of a.runners) r.tick(); a.sim.update(1 / 60); }
  const perTick = (performance.now() - t0) / ticks;
  for (let i = 0; i < ticks; i++) { for (const r of b.runners) r.tick(); b.sim.update(1 / 60); }
  assert.equal(stateHash(a.sim), stateHash(b.sim), 'two identical runs end in the identical state');
  assert.ok(a.runners.every((r) => r.state === 'running' || r.state === 'finished'), 'no robot program crashed');
  const moved = a.sim.robots.filter((r, i) => `${r.tileX},${r.tileY}` !== startPos[i] || a.runners[i].stepCount > 50).length;
  assert.ok(moved >= 18, `robots must actually be working (${moved}/20)`);
  assert.ok(a.runners.reduce((s, r) => s + r.stepCount, 0) > 20 * 40, 'programs executed real work');
  console.log(`20 robots running code: ${perTick.toFixed(2)} ms per tick (budget 16.7 ms per frame at 60 fps), ${a.sim.entities.count} entities`);
  assert.ok(perTick < 4, `simulation too slow: ${perTick.toFixed(2)} ms per tick`);
}

// ---------------------------------------------------------------- settings and save slots
{
  const mem = new Map<string, string>();
  const kv = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
  mem.set('rootworks.settings.v1', JSON.stringify({ autosave: 7, uiScale: 1.3, editorFont: '<script>' }));
  const st = new SettingsStore(kv, true);
  assert.equal(st.value.autosave, 30, 'a value that is not a listed choice falls back');
  assert.equal(st.value.uiScale, 1.3);
  assert.equal(st.value.editorFont, 14);
  assert.equal(st.value.reducedMotion, true, 'follows the OS preference by default');
  st.set('autosave', 0);
  assert.equal(new SettingsStore(kv).value.autosave, 0, 'persisted');

  const sim = Simulation.generate(1337);
  const save = (t: number): SaveFile => ({ ...fullSave(sim), savedAt: t, time: 5, tutorial: ['move'] });
  assert.equal(SaveSlot.latest(kv), null);
  new SaveSlot(kv, 2).write(save(100));
  new SaveSlot(kv, 1).write(save(50));
  assert.ok(mem.has('rootworks.game.v1'), 'slot 1 keeps the pre-slots key, so old saves still load');
  assert.equal(SaveSlot.latest(kv)!.id, 2, 'continue picks the most recent');
  assert.equal(SaveSlot.all(kv)[2].summary, null);
  assert.equal(new SaveSlot(kv, 2).summary()!.tutorialSteps, 1);
  new SaveSlot(kv, 2).clear();
  assert.equal(SaveSlot.latest(kv)!.id, 1);
}

console.log('save ok');
