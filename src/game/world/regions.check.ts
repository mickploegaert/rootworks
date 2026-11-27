// Regions: only the active region exists; leaving keeps it as a diff; coming back restores it. Run with `npm run check`.
import assert from 'node:assert/strict';
import { RobotCommands, type CommandHandle } from '../api/RobotCommands.ts';
import { ResourceNode } from '../entities/ResourceNode.ts';
import { validateSave, type SaveFile } from '../save/GameSave.ts';
import { Simulation } from '../Simulation.ts';
import { REGIONS, regionLock } from './regions.ts';
import { composeSave, loadActiveRegion, travelSave } from './RegionTravel.ts';
import { TUTORIAL } from './WorldGenerator.ts';

const SEED = 1337;
const gens = () => Object.fromEntries(Simulation.generations);
const run = (sim: Simulation, h: CommandHandle) => { for (let i = 0; i < 3600 && !h.result; i++) sim.update(1 / 60); return h.result!; };
/** Save, write as JSON and read back through validation: exactly what the browser does between regions. */
const roundTrip = (s: SaveFile) => validateSave(JSON.parse(JSON.stringify(s)))!;
const save = (sim: Simulation, others: SaveFile['regions'], program: SaveFile['regions']['vale'] extends infer R ? R extends { program: infer P } ? P : never : never = null) =>
  roundTrip(composeSave(sim, others, { worldSeed: SEED, time: 10, program }));

Simulation.generations.clear();

// ---------------------------------------------------------------- a new game: only the valley is generated
let vale = loadActiveRegion(undefined, SEED);
assert.equal(vale.region, 'vale');
assert.deepEqual(gens(), { vale: 1 }, 'no other region is generated at the start');
assert.ok(vale.entities.count < 6000, `the valley only (${vale.entities.count} entities; the whole old island had ~18,000)`);

// play a little: harvest the tutorial pile, keep research going, give the robot cargo
const pile = vale.entities.at(TUTORIAL.pile.x, TUTORIAL.pile.y) as ResourceNode;
pile.take(6);
vale.robots[0].inventory.add('wood', 3);
vale.research.completed.add('counter');
const program = { language: 'python' as const, source: 'move("north")', runners: [null] };
let file = save(vale, {}, program);
assert.deepEqual(Object.keys(file.regions), ['vale'], 'a save holds only visited regions');

// ---------------------------------------------------------------- locks
assert.match(travelSave(file, 'quarry', vale.research.completed) as string, /Learn the Surveying skill/);
assert.match(travelSave(file, 'saltmarsh', vale.research.completed) as string, /later update/, 'future regions are on the map only');
assert.equal(travelSave(file, 'vale', vale.research.completed), 'You are already here');
for (const r of REGIONS) if (r.future) assert.equal(r.generate, undefined, `${r.id} has no generator: it can never be loaded`);

// ---------------------------------------------------------------- travel to the quarry: generated now, for the first time
vale.research.completed.add('surveying');
file = save(vale, {}, program);
const toQuarry = travelSave(file, 'quarry', vale.research.completed);
assert.ok(typeof toQuarry !== 'string', String(toQuarry));
file = roundTrip(toQuarry);
let quarry = loadActiveRegion(file, SEED);
assert.equal(quarry.region, 'quarry');
assert.deepEqual(gens(), { vale: 1, quarry: 1 }, 'the quarry is generated when entered, not before');
assert.ok(quarry.robots.length === 1 && quarry.storages.length === 1, 'a landing: one robot, one depot');
assert.ok(quarry.entities.ofKind<ResourceNode>('resource').some((n) => n.resourceId === 'iron_ore'), 'the quarry has ore');
assert.equal(quarry.entities.at(TUTORIAL.pile.x, TUTORIAL.pile.y), undefined, 'none of the valley is here');
assert.ok(quarry.research.isDone('counter') && quarry.research.isDone('surveying'), 'research travels with the player');
assert.equal(file.regions.vale!.program?.source, 'move("north")', 'the valley\'s program is kept, paused, in the save');

// work the quarry: mine some ore, finish a research project here
const api = new RobotCommands(quarry, quarry.robots[0]);
assert.ok(run(quarry, api.goTo('iron_ore')).ok);
const mined = run(quarry, api.harvest());
assert.ok(mined.ok, mined.error);
const ore = quarry.entities.ofKind<ResourceNode>('resource').find((n) => n.amount < n.maxAmount)!;
const oreLeft = ore.amount;
quarry.research.completed.add('gardening');
file = save(quarry, file.regions);
assert.deepEqual(Object.keys(file.regions).sort(), ['quarry', 'vale']);

// ---------------------------------------------------------------- back to the valley: exactly as left
const toVale = travelSave(file, 'vale', quarry.research.completed);
assert.ok(typeof toVale !== 'string');
file = roundTrip(toVale);
vale = loadActiveRegion(file, SEED);
assert.deepEqual(gens(), { vale: 2, quarry: 1 }, 'the valley is rebuilt from seed + diff; the quarry is not touched');
assert.equal((vale.entities.at(TUTORIAL.pile.x, TUTORIAL.pile.y) as ResourceNode).amount, 9, 'harvested pile stays harvested');
assert.deepEqual(vale.robots[0].inventory.snapshot(), { wood: 3 });
assert.ok(vale.research.isDone('gardening'), 'research done in the quarry counts here');
assert.equal(file.regions.vale!.program?.source, 'move("north")', 'the valley\'s program is there to resume');

// ---------------------------------------------------------------- and the quarry again: its changes survived
file = save(vale, file.regions);
file = roundTrip(travelSave(file, 'quarry', vale.research.completed) as SaveFile);
quarry = loadActiveRegion(file, SEED);
const again = quarry.entities.ofKind<ResourceNode>('resource').find((n) => n.tileX === ore.tileX && n.tileY === ore.tileY)!;
assert.equal(again.amount, oreLeft, 'mined ore stays mined');
assert.deepEqual(gens(), { vale: 2, quarry: 2 });
assert.equal(Simulation.generations.get('whisperwood'), undefined, 'never visited, never generated');

// whisperwood opens with gardening and is its own world
file = save(quarry, file.regions);
const toWood = travelSave(file, 'whisperwood', quarry.research.completed);
assert.ok(typeof toWood !== 'string');
const wood = loadActiveRegion(roundTrip(toWood), SEED);
assert.equal(wood.region, 'whisperwood');
assert.ok(wood.entities.ofKind<ResourceNode>('resource').filter((n) => n.resourceId === 'wood').length > 300, 'a forest');

// ---------------------------------------------------------------- inactive regions are data, never live objects
for (const r of Object.values(file.regions)) assert.ok(r && Array.isArray(r.removed) && typeof r.seed === 'number', 'plain JSON');
assert.ok(JSON.stringify(file).length < 200_000, `save size ${JSON.stringify(file).length} bytes`);

// determinism: the same region seed gives the same region
assert.equal(loadActiveRegion({ ...file, region: 'quarry', regions: {} }, SEED).entities.count, loadActiveRegion({ ...file, region: 'quarry', regions: {} }, SEED).entities.count);
assert.equal(regionLock(REGIONS.find((r) => r.id === 'whisperwood')!, new Set()), 'Learn the Gardening skill to travel here');

console.log('regions ok', JSON.stringify(gens()), `valley ${vale.entities.count}, quarry ${quarry.entities.count}, whisperwood ${wood.entities.count} entities`);
