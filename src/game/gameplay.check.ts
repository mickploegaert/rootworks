// Headless gameplay tests: run with `npm run check`. Uses the real simulation, no rendering.
import assert from 'node:assert/strict';
import { RobotCommands, type CommandResult } from './api/RobotCommands.ts';
import { EntityManager } from './entities/EntityManager.ts';
import { Prop } from './entities/Prop.ts';
import { ROBOT_CAPACITY, Robot } from './entities/Robot.ts';
import { ResourceNode } from './entities/ResourceNode.ts';
import { StorageDepot } from './entities/StorageDepot.ts';
import { Inventory } from './inventory/Inventory.ts';
import { RobotState } from './robot/RobotState.ts';
import { Simulation } from './Simulation.ts';
import { TileType, World } from './world/World.ts';

// 10x6 test field. Water wall at x=4 (y 0..4) forces a detour through y=5; (7,5) is an unclimbable 3-level pillar.
const world = new World(10, 6);
for (let y = 0; y < 6; y++) for (let x = 0; x < 10; x++) { world.set(x, y, TileType.Grass); world.setHeight(x, y, 1); }
for (let y = 0; y < 5; y++) world.set(4, y, TileType.Water);
world.setHeight(7, 5, 3);
const entities = new EntityManager(10);
const robot = new Robot(0, 2);
const storage = new StorageDepot(0, 4);
const rock = new ResourceNode(2, 2, 'boulder_0', 'stone', 30);
const tree = new ResourceNode(8, 1, 'oak_0', 'wood', 5);
[robot, storage, rock, tree].forEach((e) => assert.ok(entities.add(e)));
const sim = new Simulation(world, entities);
const api = new RobotCommands(sim, robot);

let ticks = 0;
async function run(p: Promise<CommandResult>, onTick?: () => void, maxTicks = 60 * 120): Promise<CommandResult> {
  let result: CommandResult | undefined;
  p.then((r) => { result = r; });
  for (let i = 0; i < maxTicks && !result; i++) { sim.update(1 / 60); ticks++; onTick?.(); await Promise.resolve(); }
  await Promise.resolve();
  assert.ok(result, 'command did not finish');
  return result!;
}
const at = (x: number, y: number) => assert.deepEqual(api.position(), { x, y });

// --- inventory unit behaviour
{
  const inv = new Inventory(5);
  assert.equal(inv.add('wood', 3), 3);
  assert.equal(inv.add('stone', 9), 2, 'clamped to capacity');
  assert.ok(inv.isFull);
  assert.equal(inv.remove('wood', 10), 3);
  const target = new Inventory(1);
  assert.deepEqual(inv.transferAllTo(target), { stone: 1 });
  assert.equal(inv.get('stone'), 1, 'what does not fit stays behind');
}

// --- world boundary
let r = await run(api.move('west'));
assert.equal(r.ok, false); assert.equal(r.error, 'blocked'); at(0, 2);

// --- one step, consistent timing (1 tile at 2.2 tiles/s ≈ 27 ticks)
ticks = 0;
r = await run(api.move('east'));
assert.ok(r.ok); at(1, 2);
assert.ok(ticks >= 26 && ticks <= 29, `step took ${ticks} ticks`);
assert.equal(robot.posX, 1.5); // ends exactly on the tile centre

// --- blocked terrain: water is not walkable, the pathfinder detours round it
assert.equal(api.canReach(4, 1), false);
assert.equal(api.canReach(7, 5), false, 'three levels up is too steep');
r = await run(api.moveTo(7, 5));
assert.equal(r.ok, false); assert.match(r.error!, /not reachable/); at(1, 2);
r = await run(api.moveTo(5, 2));
assert.ok(r.ok); at(5, 2);

// --- dynamic obstacle mid-route: the robot re-plans instead of walking through
{
  const p = api.moveTo(5, 0); // shortest route is straight through (5,1)
  sim.update(1 / 60); // route planned, not yet stepping
  assert.deepEqual(robot.queue.running!.route()[0], { x: 5, y: 1 });
  assert.ok(entities.add(new Prop(5, 1, 'crates', 'Crates', '', 'structure')));
  let entered = false;
  r = await run(p, () => { if (Math.floor(robot.posX) === 5 && Math.floor(robot.posY) === 1) entered = true; });
  assert.ok(r.ok, r.error); at(5, 0);
  assert.ok(!entered && robot.posX === 5.5, 'robot must route around the new obstacle');
}

// --- harvesting needs adjacency, then fills the inventory up to capacity
r = await run(api.moveTo(1, 2));
assert.ok(r.ok);
r = await run(api.harvest(8, 1));
assert.equal(r.ok, false); assert.equal(r.error, 'not next to the deposit');
assert.ok(api.canHarvest(2, 2));
r = await run(api.harvest()); // adjacent rock, found automatically
assert.ok(r.ok); assert.deepEqual(r.data, { resource: 'stone', amount: 3, remaining: 27 });
assert.equal(robot.state, RobotState.Idle);
for (const expected of [3, 3, 1]) { // 3 + 3 + 3 + 1 = capacity 10
  r = await run(api.harvest());
  assert.ok(r.ok); assert.equal(r.data!.amount, expected);
}
assert.equal(robot.inventory.total, ROBOT_CAPACITY);
assert.equal(api.canHarvest(2, 2), false, 'full robot cannot harvest');
r = await run(api.harvest());
assert.equal(r.ok, false); assert.equal(r.error, 'inventory is full');
assert.equal(rock.amount, 20);

// --- return to storage and deposit
const states = new Set<RobotState>();
const ret = api.returnToStorage(), dep = api.deposit();
{
  let done = false;
  dep.then(() => { done = true; });
  for (let i = 0; i < 6000 && !done; i++) { sim.update(1 / 60); states.add(robot.state); await Promise.resolve(); }
}
assert.ok((await ret).ok); r = await dep;
assert.ok(r.ok, r.error);
assert.ok(states.has(RobotState.Returning) && states.has(RobotState.Depositing));
assert.equal(storage.inventory.get('stone'), 10);
assert.ok(robot.inventory.isEmpty);
r = await run(api.deposit());
assert.equal(r.ok, false); assert.equal(r.error, 'nothing to deposit');

// --- depletion: the deposit empties, stops blocking, and refuses further harvests
r = await run(api.approach(8, 1)); assert.ok(r.ok);
r = await run(api.harvest(8, 1)); assert.equal(r.data!.amount, 4);
r = await run(api.harvest(8, 1)); assert.equal(r.data!.amount, 1); assert.equal(r.data!.remaining, 0);
assert.ok(tree.depleted && !tree.blocking);
r = await run(api.harvest(8, 1));
assert.equal(r.ok, false); assert.equal(r.error, 'deposit is depleted');
assert.equal(api.canReach(8, 1), true, 'depleted deposit no longer blocks');

// --- a failure cancels everything queued behind it
const bad = api.moveTo(4, 0), after = api.move('south');
assert.equal((await run(bad)).ok, false);
const skipped = await after;
assert.equal(skipped.ok, false); assert.match(skipped.error!, /^skipped/);
assert.equal(robot.queue.size, 0);

// --- stop() cancels the running action
{
  const p = api.moveTo(0, 0);
  sim.update(1 / 60);
  api.stop();
  const res = await p;
  assert.equal(res.ok, false); assert.equal(res.error, 'stopped');
  assert.equal(robot.state, RobotState.Idle);
}

// --- unknown direction from a (future) language adapter is rejected, not thrown
r = await api.move('up' as never);
assert.equal(r.ok, false);

// --- building: costs, terrain, footprint, area, research locks; plants underfoot are cleared
{
  const b = sim.building;
  b.research.add('gardening');
  const bed = () => b.check('planter', 6, 3);
  storage.inventory.remove('stone', 100);
  assert.match(bed()!, /Need 3 Timber more/);
  storage.inventory.add('wood', 5);
  assert.equal(b.check('planter', 4, 1), "Can't build on pond water");
  world.setParcelUnlocked(0, 0, false);
  assert.equal(b.check('planter', 6, 3), 'Outside your building area', 'locked parcel');
  assert.equal(api.canReach(6, 3), false, 'robots cannot enter locked parcels');
  world.setParcelUnlocked(0, 0, true);
  assert.equal(b.check('boiler', 6, 3), 'Requires research: Steam Power');
  assert.match(b.check('planter', 2, 2)!, /is in the way/);
  assert.equal(b.check('greenhouse', 6, 4), 'The ground is not level', '(7,5) is the tall pillar');
  assert.ok(entities.add(new Prop(6, 3, 'grass_0', 'Tall grass', '', 'vegetation', 1, 1, false)));
  assert.equal(bed(), null);
  assert.equal(b.place('planter', 1, 6, 3), null);
  assert.equal(storage.inventory.get('wood'), 2, 'cost paid from storage');
  assert.equal(entities.at(6, 3)!.spriteId, 'planter_1', 'variant chosen by rotation; grass removed');
  assert.match(bed()!, /is in the way/);
  assert.equal(api.canReach(6, 3), false, 'buildings block robots');
  b.research.add('Steam Power');
  assert.match(b.check('boiler', 5, 2)!, /Need .*Copper Ore/);
}

console.log('gameplay ok');
