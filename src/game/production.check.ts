// Phase 2 production loop, headless: machines, construction, research, firmware gates. Run with `npm run check`.
import assert from 'node:assert/strict';
import { RobotCommands, type CommandHandle } from './api/RobotCommands.ts';
import { EntityManager } from './entities/EntityManager.ts';
import { Machine } from './entities/Machine.ts';
import { ResourceNode } from './entities/ResourceNode.ts';
import { Robot } from './entities/Robot.ts';
import { Prop } from './entities/Prop.ts';
import { StorageDepot } from './entities/StorageDepot.ts';
import { LANGUAGES } from './scripting/adapters.ts';
import { createHostFunctions } from './scripting/hostApi.ts';
import { ProgramRunner } from './scripting/ProgramRunner.ts';
import { ScriptError } from './scripting/types.ts';
import { Simulation } from './Simulation.ts';
import { applyProgress, captureProgress } from './save/GameSave.ts';
import { ChallengeBoard, dailyOrder } from './progress/Challenges.ts';
import { TileType, World } from './world/World.ts';
import { isAdjacent } from './world/Pathfinder.ts';

function field() {
  const world = new World(16, 12);
  for (let y = 0; y < 12; y++) for (let x = 0; x < 16; x++) { world.set(x, y, TileType.Grass); world.setHeight(x, y, 1); }
  const entities = new EntityManager(16);
  const robot = new Robot(4, 6), storage = new StorageDepot(0, 10);
  entities.add(robot); entities.add(storage);
  const sim = new Simulation(world, entities);
  return { sim, robot, storage, api: new RobotCommands(sim, robot) };
}
function run(sim: Simulation, h: CommandHandle, max = 60 * 60) {
  for (let i = 0; i < max && !h.result; i++) sim.update(1 / 60);
  assert.ok(h.result, 'command did not finish');
  return h.result!;
}
const ticks = (sim: Simulation, seconds: number) => { for (let i = 0; i < seconds * 60; i++) sim.update(1 / 60); };

// ---------------------------------------------------------------- construction: placing creates a site that drones finish
{
  const { sim, storage } = field();
  storage.inventory.add('scrap', 6);
  assert.equal(sim.building.place('workbench', 0, 5, 3), null);
  assert.equal(sim.entities.at(5, 3)!.kind, 'construction');
  assert.equal(storage.inventory.get('scrap'), 0, 'paid up front');
  ticks(sim, 3);
  assert.equal(sim.entities.at(5, 3)!.kind, 'construction', 'still building after 3 s');
  ticks(sim, 2);
  const wb = sim.entities.at(6, 4);
  assert.ok(wb instanceof Machine && wb.machineId === 'workbench', 'finished after 4 s; the 2x2 footprint is the machine');
}

// ---------------------------------------------------------------- the whole loop: harvest-free version with stocked cargo
{
  const { sim, robot, storage, api } = field();
  const bench = new Machine(5, 3, 'workbench', 'workbench', 'Workbench', '', 2, 2);
  const lab = new Machine(9, 3, 'lab_building', 'lab', 'Research Lab', '', 2, 2);
  sim.entities.add(bench); sim.entities.add(lab);
  robot.inventory.add('wood', 4); robot.inventory.add('scrap', 2); robot.inventory.add('stone', 1);

  let r = run(sim, api.goTo('workbench'));
  assert.ok(r.ok, r.error);
  r = run(sim, api.put());
  assert.ok(r.ok, r.error);
  assert.deepEqual(r.data!.moved, { wood: 4, scrap: 2 }, 'only what the recipe uses');
  assert.equal(robot.inventory.get('stone'), 1, 'stone stays in the robot');
  r = run(sim, api.take());
  assert.ok(r.ok, 'take() at a working machine waits for the batch');
  assert.equal(robot.inventory.get('research_kit'), 1);
  ticks(sim, 6); // the second batch
  assert.equal(bench.output.get('research_kit'), 1);
  r = run(sim, api.take('research_kit'));
  assert.ok(r.ok); assert.equal(robot.inventory.get('research_kit'), 2);
  r = run(sim, api.take());
  assert.equal(r.ok, false, 'an idle machine with nothing ready fails at once');

  // the Lab turns kits into Sparks, Sparks buy skills at once
  sim.research.sparks = 0; // the Workbench and Lab commissions already paid out: start from nothing
  assert.equal(sim.research.firmware, 0);
  assert.equal(sim.research.buy('sense'), 'Needs Operators first');
  assert.equal(sim.research.buy('loop'), 'Needs 3 more Sparks');
  assert.ok(run(sim, api.goTo('lab')).ok);
  r = run(sim, api.put('research_kit'));
  assert.ok(r.ok, r.error);
  ticks(sim, 9);
  assert.equal(sim.research.sparks, 4, 'two kits, 2 Sparks each, 4 s per kit');
  assert.equal(sim.research.buy('loop'), null);
  assert.ok(sim.research.isDone('loop'));
  assert.equal(sim.research.sparks, 1);
  assert.equal(sim.research.firmware, 1, 'one programming skill');

  // a machine refuses what its recipe doesn't use; storage takes anything
  run(sim, api.goTo('workbench'));
  r = run(sim, api.put('stone'));
  assert.equal(r.ok, false); assert.match(r.error!, /does not use stone/);
  assert.ok(run(sim, api.goTo('storage')).ok);
  assert.ok(run(sim, api.put()).ok);
  assert.equal(storage.inventory.get('stone'), 1);
  // taking from storage feeds machines: the basis of logistics programs
  r = run(sim, api.take('stone'));
  assert.ok(r.ok); assert.equal(robot.inventory.get('stone'), 1);
  assert.equal(run(sim, api.goTo('kiln')).error, 'there is no reachable kiln');
}

// ---------------------------------------------------------------- firmware gates on the robot API
{
  const { sim, robot } = field();
  const skills = new Set<string>();
  const out: string[] = [];
  const host = { functions: createHostFunctions(new RobotCommands(sim, robot), { action() {}, result() {} }, () => skills), print: (t: string) => out.push(t) };
  const errOf = (src: string) => {
    const runner = new ProgramRunner(LANGUAGES.python.compile(src), host);
    let err: ScriptError | null = null;
    runner.events.on('error', (e) => { err = e; });
    for (let i = 0; i < 600 && runner.isActive; i++) { runner.tick(); sim.update(1 / 60); }
    return err as ScriptError | null;
  };
  assert.equal(errOf('move("north")'), null, 'T0 functions always work');
  assert.match(errOf('print(get_position())')!.message, /needs the Variables skill/);
  skills.add('counter');
  assert.equal(errOf('print(get_position())'), null);
  assert.match(errOf('print(can_harvest())')!.message, /needs the Sense skill/);
  skills.add('sense');
  assert.equal(errOf('print(can_harvest(), get_nearby())'), null);
}

// ---------------------------------------------------------------- reclaiming land, assembling robots, commissions
{
  const sim = Simulation.generate(1337);
  const store = sim.storages[0].inventory;
  assert.equal(sim.reclaimProblem(5, 3), 'Learn the Surveying skill first');
  sim.research.completed.add('surveying');
  assert.match(sim.reclaimProblem(5, 3)!, /Need 10 more wood/);
  store.add('wood', 40); store.add('stone', 30);
  assert.equal(sim.reclaimProblem(5, 2), 'Only land next to your valley can be reclaimed');
  assert.equal(sim.reclaimProblem(6, 3), 'That is open sea', 'beyond the valley lies the sea: other land is other regions');
  assert.equal(sim.reclaim(5, 3), null);
  assert.ok(sim.world.isUnlocked(5 * 32 + 5, 3 * 32 + 5));
  assert.equal(store.get('wood'), 30);
  assert.deepEqual(sim.reclaimCost(), { wood: 16, stone: 10 }, 'the next parcel costs more');
  assert.equal(sim.reclaimProblem(5, 2), null, 'now adjacent');

  assert.equal(sim.assembleProblem(), 'Learn the Robot assembly skill first');
  sim.research.completed.add('assembly'); sim.research.completed.add('cargo');
  store.add('planks', 8); store.add('scrap', 6);
  assert.equal(sim.assembleRobot({ x: 128, y: 130 }), null);
  assert.equal(sim.robots.length, 2);
  assert.equal(sim.robots[1].inventory.capacity, 16, 'cargo research applies to new robots');

  // commissions measure the world and pay into storage
  store.add('scrap', 10);
  const kitsBefore = store.get('research_kit');
  for (let i = 0; i < 60; i++) sim.update(1 / 60);
  assert.ok(sim.commissions.done.has('scrap10'));
  assert.ok(sim.commissions.done.has('wood20'), 'the 30 timber in storage also counts');
  assert.equal(store.get('research_kit'), kitsBefore + 2, 'both rewards paid (one kit each)');
  assert.ok(!sim.commissions.done.has('bench'), 'no workbench yet');
  assert.equal(sim.commissions.active().length, 3);

  // go_to("wood") finds the nearest reachable tree on owned land
  const api = new RobotCommands(sim, sim.robots[0]);
  assert.ok(run(sim, api.goTo('wood')).ok);
  const h = run(sim, api.harvest());
  assert.ok(h.ok, h.error); assert.equal(h.data!.resource, 'wood');
  assert.equal(run(sim, api.goTo('unobtainium')).ok, false);
}

// ---------------------------------------------------------------- two machines side by side: put() picks the right neighbour
{
  const { sim, robot } = field();
  const bench = new Machine(5, 3, 'workbench', 'workbench', 'Workbench', '', 2, 2); // tiles (5..6, 3..4)
  const lab = new Machine(7, 5, 'lab_building', 'lab', 'Research Lab', '', 2, 2); // tiles (7..8, 5..6)
  sim.entities.add(bench); sim.entities.add(lab);
  const api = new RobotCommands(sim, robot);
  assert.ok(run(sim, api.moveTo(7, 4)).ok); // (7, 4) touches the bench at (6, 4) and the lab at (7, 5)
  assert.ok(isAdjacent({ x: 7, y: 4 }, bench.rect) && isAdjacent({ x: 7, y: 4 }, lab.rect));
  robot.facing = 2; // looking at the bench
  robot.inventory.add('research_kit', 1); robot.inventory.add('wood', 2);
  let r = run(sim, api.put('research_kit'));
  assert.equal(r.data?.into ?? r.error, 'lab', 'the bench does not use kits, so the lab gets them');
  r = run(sim, api.put('wood'));
  assert.equal(r.data?.into ?? r.error, 'workbench');
  // and after go_to("lab") the lab comes first even when facing elsewhere
  robot.inventory.add('research_kit', 1);
  robot.destination = lab; robot.facing = 2;
  assert.equal(run(sim, api.put()).data?.into, 'lab');
}

// ---------------------------------------------------------------- beginner movement: go_to("tree"), go_to(x, y), harvest() takes the go_to target
{
  const { sim, robot } = field();
  const tree = new ResourceNode(10, 6, 'oak_0', 'wood', 20), pile = new ResourceNode(10, 7, 'scrap_0', 'scrap', 20);
  sim.entities.add(tree); sim.entities.add(pile);
  const out: string[] = [];
  const host = { functions: createHostFunctions(new RobotCommands(sim, robot), { action() {}, result() {} }, () => new Set()), print: (t: string) => out.push(t) };
  const exec = (src: string) => {
    const runner = new ProgramRunner(LANGUAGES.python.compile(src), host);
    let err: ScriptError | null = null;
    runner.events.on('error', (e) => { err = e; });
    for (let i = 0; i < 60 * 60 && runner.isActive; i++) { runner.tick(); sim.update(1 / 60); }
    return err as ScriptError | null;
  };
  assert.equal(exec('print(go_to("Tree"))\nharvest()'), null);
  assert.equal(out.at(-1), 'True');
  assert.ok(robot.inventory.get('wood') > 0 && robot.inventory.get('scrap') === 0, 'harvest() picks the tree go_to went to, not the pile beside it');
  assert.equal(exec('go_to(10, 7)\nharvest()'), null);
  assert.ok(robot.inventory.get('scrap') > 0, 'go_to(x, y) walks next to that exact deposit');
  assert.equal(exec('go_to([4, 6])'), null, 'a position list from get_position() works too');
  assert.match(exec('go_to("treee")')!.message, /doesn't know a place called "treee". Try one of: "tree"/);
}

// ---------------------------------------------------------------- old saves: progress carries over into the skill tree
{
  const { sim } = field();
  applyProgress(sim, { research: ['counter', 'loop'], researching: { id: 'sense', kits: 2 }, commissions: [] });
  assert.ok(sim.research.isDone('operators') && sim.research.isDone('functions'), 'Counter taught arithmetic, Loop taught def');
  assert.equal(sim.research.sparks, 4, 'kits already fed to a project come back as Sparks');
  assert.equal(captureProgress(sim).sparks, 4);
}

// ---------------------------------------------------------------- windmills speed up machines in reach
{
  const { sim } = field();
  const near = new Machine(2, 2, 'sawmill', 'sawmill', 'Sawmill', '', 2, 2), far = new Machine(12, 2, 'sawmill', 'sawmill', 'Sawmill', '', 2, 2);
  sim.entities.add(near); sim.entities.add(far);
  sim.entities.add(new Prop(4, 5, 'turbine', 'Windmill', '', 'structure'));
  near.input.add('wood', 2); far.input.add('wood', 2);
  ticks(sim, 3);
  assert.equal(near.output.get('planks'), 3, 'boosted: a 4 s batch is done in under 3 s');
  assert.equal(far.output.get('planks'), 0, 'out of range: still working');
}

// ---------------------------------------------------------------- tiered robot skills, the Feeder and deliver()
{
  const { sim, robot, storage } = field();
  for (const id of ['speed1', 'speed2', 'cargo', 'cargo2', 'yield1']) sim.research.completed.add(id);
  sim.applySkills(robot);
  assert.equal(robot.inventory.capacity, 24, 'Cargo II (22) plus the Robot upgrades milestone (+2: Speed I, Speed II, Sharp tools)');
  assert.ok(Math.abs(robot.speed - 2.2 * 1.4) < 1e-9, 'two speed tiers');
  assert.equal(robot.yieldBonus, 1);
  // the Feeder fills a machine next to storage by itself
  const bench = new Machine(1, 7, 'workbench', 'workbench', 'Workbench', '', 2, 2);
  sim.entities.add(bench);
  storage.inventory.add('wood', 10); storage.inventory.add('scrap', 5);
  ticks(sim, 1);
  assert.equal(bench.input.get('wood'), 0, 'no Feeder skill: nothing moves');
  sim.research.completed.add('feeder');
  ticks(sim, 1);
  assert.ok(bench.input.get('wood') > 0 && bench.input.get('scrap') > 0, 'Feeder pulls the recipe inputs from storage');
  // deliver(): storage -> machine in one command
  sim.research.completed.delete('feeder'); // the Feeder would keep draining storage into the bench
  storage.inventory.add('wood', 10);
  const far = new Machine(12, 2, 'sawmill', 'sawmill', 'Sawmill', '', 2, 2);
  sim.entities.add(far);
  const skills = new Set(['logistics']);
  const dlog: string[] = [];
  const host = { functions: createHostFunctions(new RobotCommands(sim, robot), { action() {}, result: (t) => dlog.push(t) }, () => skills), print() {} };
  const runner = new ProgramRunner(LANGUAGES.python.compile('deliver("wood", "sawmill", 2)'), host);
  for (let i = 0; i < 60 * 60 && runner.isActive; i++) { runner.tick(); sim.update(1 / 60); }
  assert.equal(runner.state, 'finished');
  assert.ok(far.working || far.output.get('planks') > 0, dlog.join(' | ')); // the timber is already being sawn
  skills.clear();
  const locked = new ProgramRunner(LANGUAGES.python.compile('deliver("wood", "sawmill")'), host);
  let err = '';
  locked.events.on('error', (e) => { err = e.message; });
  for (let i = 0; i < 10 && locked.isActive; i++) locked.tick();
  assert.match(err, /needs the Logistics skill/);
  assert.throws(() => LANGUAGES.python.compile('xs = [1, 2]', { guided: true, skills: new Set(['counter']) }), /Lists \(\[\.\.\.\]\) need the Lists skill/);
}

// ---------------------------------------------------------------- challenges, today's order, dictionaries from the game
{
  const board = new ChallengeBoard();
  let got = board.evaluate({ delivered: 25, byItem: {}, lines: 6, robots: 1, seconds: 30 });
  assert.deepEqual(got.map((g) => [g.c.id, g.stars]), [['compact', 2]], 'compact counts once 20 items are in; sprint waits for a full minute');
  got = board.evaluate({ delivered: 40, byItem: {}, lines: 4, robots: 1, seconds: 60 });
  assert.deepEqual(got.map((g) => [g.c.id, g.gained]), [['sprint', 3], ['compact', 1]], '40/min is gold; 4 lines adds the third compact star');
  assert.equal(board.best.get('compact'), 4);
  const o = dailyOrder('2026-11-27');
  assert.deepEqual(dailyOrder('2026-11-27'), o, 'the same order all day');
  assert.equal(board.deliver(o.item === 'wood' ? 'scrap' : 'wood', 99, o.day), false, 'other items do not count');
  assert.equal(board.deliver(o.item, o.amount - 1, o.day), false);
  assert.equal(board.deliver(o.item, 1, o.day), true, 'the last unit completes it');
  assert.equal(board.deliver(o.item, 5, o.day), false, 'only once');
  assert.equal(board.deliver(o.item, 5, '2026-11-28'), false, 'a new day starts a new order');
  assert.equal(board.daily.day, '2026-11-28');

  const { sim, robot, storage } = field();
  storage.inventory.add('wood', 7);
  const out: string[] = [];
  const host = { functions: createHostFunctions(new RobotCommands(sim, robot), { action() {}, result() {} }, () => null), print: (t: string) => out.push(t) };
  const runner = new ProgramRunner(LANGUAGES.python.compile('print(get_stock()["wood"])\nprint(recipe("sawmill")["makes"]["planks"])'), host);
  for (let i = 0; i < 10 && runner.isActive; i++) runner.tick();
  assert.deepEqual(out, ['7', '3']);
}

// ---------------------------------------------------------------- milestones and the wardrobe survive a save
{
  const { sim } = field();
  assert.equal(sim.achievements.unlock('skills5')?.cosmetic, 'goggles');
  assert.equal(sim.achievements.unlock('skills5'), null, 'once');
  sim.achievements.delivered = 42; sim.achievements.cosmetic = 'goggles';
  const p = captureProgress(sim), { sim: b } = field();
  applyProgress(b, { ...p, achievements: { ...p.achievements!, done: [...p.achievements!.done] } });
  assert.deepEqual([...b.achievements.done], ['skills5']);
  assert.equal(b.achievements.delivered, 42);
  assert.equal(b.achievements.cosmetic, 'goggles');
  const { sim: c } = field();
  applyProgress(c, { ...p, achievements: { done: [], delivered: 0, cosmetic: 'crown' } });
  assert.equal(c.achievements.cosmetic, null, 'an accessory that was not earned is not worn');
}

// ---------------------------------------------------------------- player buildings can be moved and taken down; the world's own cannot
{
  const { sim, storage } = field();
  storage.inventory.add('scrap', 6);
  assert.equal(sim.building.place('workbench', 0, 5, 3), null);
  const site = sim.entities.at(5, 3)!;
  assert.ok(sim.playerBuilding(site));
  assert.equal(sim.demolish(site), null);
  assert.equal(storage.inventory.get('scrap'), 6, 'an unfinished site returns everything');
  sim.building.place('workbench', 0, 5, 3);
  ticks(sim, 5);
  const bench = sim.entities.at(5, 3) as Machine;
  bench.input.add('wood', 2);
  assert.equal(sim.move(bench, 9, 3), null);
  assert.equal(sim.entities.at(5, 3), undefined, 'old spot is free');
  assert.equal(sim.entities.at(10, 4), bench, 'same machine, new spot, contents kept');
  assert.equal(bench.input.get('wood'), 2);
  assert.match(sim.move(bench, 15, 3)!, /Off the edge/);
  assert.equal(sim.entities.at(9, 3), bench, 'a refused move changes nothing');
  const before = storage.inventory.get('scrap'); // the Workbench commission paid out meanwhile
  assert.equal(sim.demolish(bench), null);
  assert.equal(storage.inventory.get('scrap') - before, 3, 'a finished building returns half');
  assert.equal(storage.inventory.get('wood'), 2, 'and what it held');
  assert.equal(sim.demolish(storage), 'Only buildings you built can be taken down');
  const gen = Simulation.generate(1337);
  const workshop = [...gen.entities.list()].find((e) => e.spriteId === 'lab')!;
  assert.equal(gen.playerBuilding(workshop), null, 'the generated workshop is not yours to sell');
}

// ---------------------------------------------------------------- lane milestones: three skills in a lane earn its bonus
{
  const { sim, robot } = field();
  const lab = new Machine(9, 3, 'lab_building', 'lab', 'Research Lab', '', 2, 2);
  sim.entities.add(lab);
  for (const id of ['counter', 'operators']) sim.research.completed.add(id);
  sim.research.sparks = 0; lab.input.add('research_kit', 1);
  ticks(sim, 5);
  assert.equal(sim.research.sparks, 2, 'two logic skills: no bonus yet');
  sim.research.completed.add('sense'); sim.research.sparks = 0; lab.input.add('research_kit', 1);
  ticks(sim, 5);
  assert.equal(sim.research.sparks, 3, 'Memory & logic milestone: 3 Sparks per kit');
  sim.research.completed.add('loop'); sim.research.completed.add('functions');
  sim.applySkills(robot);
  assert.equal(robot.harvestSpeed, 1.15, 'Control flow has two skills: both earn its bonus');
}
console.log('production ok');

// ---------------------------------------------------------------- the story: chapters advance, the Heart Tree takes offerings by program
{
  const { sim, robot, storage, api } = field();
  const heart = new Machine(8, 2, 'heart_0', 'heart', 'Heart Tree', '', 2, 2);
  sim.entities.add(heart);
  sim.research.sparks = 0;
  assert.equal(sim.story.chapter, 0);
  robot.inventory.add('planks', 5);
  const early = run(sim, api.goTo('heart'));
  assert.ok(early.ok);
  assert.equal(run(sim, api.put('planks')).ok, false, 'a sleeping tree takes no offerings');
  // chapter 1: deliveries, Loops, a Workbench
  sim.achievements.delivered = 30; sim.research.completed.add('loop');
  sim.entities.add(new Machine(12, 8, 'workbench', 'workbench', 'Workbench', '', 2, 2));
  ticks(sim, 1);
  assert.equal(sim.story.chapter, 1, 'chapter 1 done');
  assert.equal(heart.stage, 1, 'the tree buds');
  assert.ok(sim.research.sparks >= 4, 'the chapter pays Sparks');
  assert.equal(sim.storyEvents.length, 1);
  // jump to the festival: offerings now go into the tree and count
  sim.story.chapter = 4; ticks(sim, 1);
  assert.ok(run(sim, api.put('planks')).ok, 'the festival tree takes planks');
  ticks(sim, 1);
  assert.equal(sim.story.offered.planks, 5);
  assert.equal(heart.input.total, 0, 'offerings are taken in');
  // the save keeps it
  const p = captureProgress(sim);
  const { sim: again } = field();
  applyProgress(again, p);
  assert.equal(again.story.chapter, 4); assert.equal(again.story.offered.planks, 5);
  // the festival finishes into Eternal Spring, where the tree pays Sparks every minute
  sim.story.offered = { planks: 100, bricks: 60, research_kit: 30 }; ticks(sim, 1);
  assert.ok(sim.story.eternal);
  const before = sim.research.sparks; ticks(sim, 63);
  assert.equal(sim.research.sparks - before, 1, 'Eternal Spring pays a Spark a minute');
  void storage;
}
console.log('story ok');
