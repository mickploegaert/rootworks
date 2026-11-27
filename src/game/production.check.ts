// Phase 2 production loop, headless: machines, construction, research, firmware gates. Run with `npm run check`.
import assert from 'node:assert/strict';
import { RobotCommands, type CommandHandle } from './api/RobotCommands.ts';
import { EntityManager } from './entities/EntityManager.ts';
import { Machine } from './entities/Machine.ts';
import { ResourceNode } from './entities/ResourceNode.ts';
import { Robot } from './entities/Robot.ts';
import { StorageDepot } from './entities/StorageDepot.ts';
import { LANGUAGES } from './scripting/adapters.ts';
import { createHostFunctions } from './scripting/hostApi.ts';
import { ProgramRunner } from './scripting/ProgramRunner.ts';
import { ScriptError } from './scripting/types.ts';
import { Simulation } from './Simulation.ts';
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

  // research Counter (2 kits) at the lab
  assert.equal(sim.research.firmware, 0);
  assert.equal(sim.research.select('sense'), 'Needs Counter firmware (T1) first');
  assert.equal(sim.research.select('counter'), null);
  assert.ok(run(sim, api.goTo('lab')).ok);
  r = run(sim, api.put('research_kit'));
  assert.ok(r.ok, r.error);
  ticks(sim, 9);
  assert.ok(sim.research.isDone('counter'), 'two kits at 4 s each');
  assert.equal(sim.research.firmware, 1);

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
  let tier = 0;
  const out: string[] = [];
  const host = { functions: createHostFunctions(new RobotCommands(sim, robot), { action() {}, result() {} }, () => tier), print: (t: string) => out.push(t) };
  const errOf = (src: string) => {
    const runner = new ProgramRunner(LANGUAGES.python.compile(src), host);
    let err: ScriptError | null = null;
    runner.events.on('error', (e) => { err = e; });
    for (let i = 0; i < 600 && runner.isActive; i++) { runner.tick(); sim.update(1 / 60); }
    return err as ScriptError | null;
  };
  assert.equal(errOf('move("north")'), null, 'T0 functions always work');
  assert.match(errOf('print(get_position())')!.message, /needs the Counter firmware \(T1\)/);
  tier = 1;
  assert.equal(errOf('print(get_position())'), null);
  assert.match(errOf('print(can_harvest())')!.message, /Sense firmware \(T2\)/);
  tier = 2;
  assert.equal(errOf('print(can_harvest(), get_nearby())'), null);
}

// ---------------------------------------------------------------- reclaiming land, assembling robots, commissions
{
  const sim = Simulation.generate(1337);
  const store = sim.storages[0].inventory;
  assert.equal(sim.reclaimProblem(5, 3), 'Research Surveying first');
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

  assert.equal(sim.assembleProblem(), 'Research Robot assembly first');
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
  const host = { functions: createHostFunctions(new RobotCommands(sim, robot), { action() {}, result() {} }, () => 0), print: (t: string) => out.push(t) };
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

// ---------------------------------------------------------------- kits in a Lab never sit unexplained: no project picked starts the first open one
{
  const { sim } = field();
  const lab = new Machine(9, 3, 'lab_building', 'lab', 'Research Lab', '', 2, 2);
  sim.entities.add(lab);
  const picked: string[] = [];
  sim.research.events.on('autoPicked', (n) => picked.push(n.id));
  lab.input.add('research_kit', 2);
  ticks(sim, 9);
  assert.deepEqual(picked, ['counter']);
  assert.ok(sim.research.isDone('counter'));
}
console.log('production ok');
