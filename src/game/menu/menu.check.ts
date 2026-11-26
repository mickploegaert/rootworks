// The title-screen diorama must be a working world: its robots' programs keep the machines turning.
import assert from 'node:assert/strict';
import { RobotCommands } from '../api/RobotCommands.ts';
import { EntityManager } from '../entities/EntityManager.ts';
import { LANGUAGES } from '../scripting/adapters.ts';
import { createHostFunctions } from '../scripting/hostApi.ts';
import { ProgramRunner } from '../scripting/ProgramRunner.ts';
import { Simulation } from '../Simulation.ts';
import { DIORAMA_SIZE, buildDiorama } from './Diorama.ts';

const entities = new EntityManager(DIORAMA_SIZE);
const { world, programs } = buildDiorama(entities);
const sim = new Simulation(world, entities);
const errors: string[] = [];
const runners = programs.map(({ robot, source }) => {
  const r = new ProgramRunner(LANGUAGES.python.compile(source), { functions: createHostFunctions(new RobotCommands(sim, robot), { action() {}, result() {} }), print() {} });
  r.events.on('error', (e) => errors.push(`${robot.name}: ${e.message}`));
  return r;
});
for (let i = 0; i < 60 * 180; i++) { for (const r of runners) r.tick(); sim.update(1 / 60); }
assert.deepEqual(errors, []);
const batches = Object.fromEntries(sim.machines.map((m) => [m.machineId, m.batches]));
assert.ok(batches.sawmill > 2, `sawmill turned ${batches.sawmill} times`);
assert.ok(batches.kiln > 0, `kiln fired ${batches.kiln} times`);
assert.ok(sim.storages[0].inventory.get('planks') > 0, 'planks hauled to storage');
console.log('menu ok', JSON.stringify(batches));
