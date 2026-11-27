// Headless tests for the programming system: run with `npm run check`.
import assert from 'node:assert/strict';
import { RobotCommands } from './api/RobotCommands.ts';
import { EntityManager } from './entities/EntityManager.ts';
import { Robot } from './entities/Robot.ts';
import { ResourceNode } from './entities/ResourceNode.ts';
import { StorageDepot } from './entities/StorageDepot.ts';
import { ProgramStore, type KeyValueStorage } from './save/ProgramStore.ts';
import { LANGUAGES } from './scripting/adapters.ts';
import { createHostFunctions } from './scripting/hostApi.ts';
import { ProgramRunner, type RunLimits } from './scripting/ProgramRunner.ts';
import { PYTHON_EXAMPLES } from './scripting/templates.ts';
import { ScriptError, type HostApi } from './scripting/types.ts';
import { Simulation } from './Simulation.ts';
import { Tutorial } from './tutorial/Tutorial.ts';
import { TileType, World } from './world/World.ts';

const py = LANGUAGES.python;

/** Run a program with no game attached; returns printed lines (or throws the ScriptError). */
function runPure(src: string, limits?: Partial<RunLimits>, maxTicks = 10_000): { out: string[]; runner: ProgramRunner } {
  const out: string[] = [];
  const host: HostApi = { functions: new Map(), print: (t) => out.push(t) };
  const runner = new ProgramRunner(py.compile(src), host, { stepsPerTick: 400, idleStepLimit: 100_000, maxSteps: 1e7, ...limits });
  let err: ScriptError | null = null;
  runner.events.on('error', (e) => { err = e; });
  for (let i = 0; i < maxTicks && runner.isActive; i++) runner.tick();
  if (err) throw err;
  return { out, runner };
}
const outOf = (src: string) => runPure(src).out;
const fails = (src: string, re: RegExp, line?: number) => {
  try { runPure(src); } catch (e) {
    assert.ok(e instanceof ScriptError, `not a ScriptError: ${e}`);
    assert.match(e.message, re);
    if (line !== undefined) assert.equal(e.line, line, `wrong line for: ${e.message}`);
    return;
  }
  assert.fail(`expected an error matching ${re} for:\n${src}`);
};
const syntaxError = (src: string, re: RegExp, line?: number) => {
  try { py.compile(src); } catch (e) {
    assert.ok(e instanceof ScriptError && e.kind === 'syntax', String(e));
    assert.match(e.message, re);
    if (line !== undefined) assert.equal(e.line, line);
    return;
  }
  assert.fail(`expected a syntax error for:\n${src}`);
};

// ---------------------------------------------------------------- parsing
syntaxError('if True\n    pass', /Expected ":"/, 1);
syntaxError('x = (1 + 2', /never closed/, 1);
syntaxError('print("hi)', /never closed/, 1);
syntaxError('x = 1\n    y = 2', /indented/, 2);
syntaxError('if True:\n        a = 1\n    b = 2', /does not line up/, 3);
syntaxError('while True:\nmove("north")', /block is empty/, 2);
syntaxError('import os', /does not support/);
syntaxError('x = 1 2', /Is a comma or an operator missing/);
syntaxError('else:\n    pass', /must follow an if/);
syntaxError('5 = x', /left side of "="/);
syntaxError('x = [1, 2', /never closed/);
syntaxError('a[1:2]', /Slices/);
py.compile('# just a comment\n\n'); // empty programs are fine

// ---------------------------------------------------------------- values, variables, arithmetic
assert.deepEqual(outOf('x = 2\ny = x * 3 + 1\nprint(y, y / 2, y // 2, y % 4, 2 ** 10, -x)'), ['7 3.5 3 3 1024 -2']);
assert.deepEqual(outOf('s = "ro" + "ot"\nprint(s * 2, len(s), s.upper(), "o" in s)'), ['rootroot 4 ROOT True']);
assert.deepEqual(outOf('n = 3\nprint(f"{n} robots, {n * 2} arms")'), ['3 robots, 6 arms']);
assert.deepEqual(outOf('x = 1\nx += 4\nx -= 1\nx *= 3\nprint(x)'), ['12']);
assert.deepEqual(outOf('print(int("42") + 1, float("1.5"), str(7) + "!", abs(-3), round(2.567, 2))'), ['43 1.5 7! 3 2.57']);
assert.deepEqual(outOf('print(-7 // 2, -7 % 3, 1 < 2 < 3, 3 < 2 < 4, None, True and 5, 0 or "x")'), ['-4 2 True False None 5 x']);

// ---------------------------------------------------------------- conditions
assert.deepEqual(outOf(`
x = 15
if x > 20:
    print("big")
elif x > 10:
    print("medium")
else:
    print("small")
if not x == 15 or x != 15:
    print("never")
print("ok" if x % 5 == 0 else "no")
`), ['medium', 'ok']);

// ---------------------------------------------------------------- loops
assert.deepEqual(outOf(`
total = 0
for i in range(1, 11):
    if i % 2 == 0:
        continue
    total += i
print(total)
n = 0
while True:
    n += 1
    if n >= 5:
        break
print(n)
for i, name in enumerate(["a", "b"]):
    print(i, name)
for c in "hi":
    print(c)
`), ['25', '5', '0 a', '1 b', 'h', 'i']);

// ---------------------------------------------------------------- lists and dictionaries
assert.deepEqual(outOf(`
items = [3, 1, 2]
items.append(5)
items.sort()
print(items, items[0], items[-1], len(items), max(items), sum(items))
d = {"wood": 4}
d["stone"] = 2
print(d, d.get("iron", 0), "wood" in d, sorted(d.keys()))
x, y = [7, 8]
print(x + y)
`), ['[1, 2, 3, 5] 1 5 4 5 11', "{'wood': 4, 'stone': 2} 0 True ['stone', 'wood']", '15']);

// ---------------------------------------------------------------- functions, scope, recursion
assert.deepEqual(outOf(`
def add(a, b=10):
    return a + b
def fact(n):
    if n <= 1:
        return 1
    return n * fact(n - 1)
count = 0
def bump():
    global count
    count += 1
bump()
bump()
def local_only():
    count = 99
    return count
print(add(1), add(1, 2), fact(6), count, local_only(), count)
`), ['11 3 720 2 99 2']);

// ---------------------------------------------------------------- runtime errors are friendly and point at the line
fails('x = 1\nprint(y)', /NameError: "y" is not defined/, 2);
fails('harvst = 1\nprint(harvest)', /Did you mean "harvst"/, 2);
fails('print(1 / 0)', /divide by zero/, 1);
fails('print("a" + 1)', /convert the number first/, 1);
fails('x = [1]\nprint(x[5])', /out of range/, 2);
fails('def f():\n    return f()\nf()', /RecursionError/);
fails('def f(a):\n    pass\nf()', /takes 1 argument, but 0 were given/, 3);
fails('d = {}\nprint(d["k"])', /KeyError/, 2);
fails('x = 5\nx()', /not a function/, 2);
fails('def f():\n    print(z)\n    z = 1\nf()', /UnboundLocalError/, 2);
fails('x = [0] * 20000', /limited to/, 1);

// ---------------------------------------------------------------- safety limits
// a loop that never touches the robot is stopped, not frozen
fails('while True:\n    pass', /without the robot doing anything/);
// the step budget per tick keeps the frame responsive: 1000 steps need several ticks
{
  const { runner } = runPure('i = 0\nwhile i < 300:\n    i += 1', { stepsPerTick: 50 });
  assert.equal(runner.state, 'finished');
  assert.ok(runner.stepCount > 600);
}
// the absolute step cap applies even when the idle check is generous
assert.throws(() => runPure('i = 0\nwhile True:\n    i += 1', { maxSteps: 1000, idleStepLimit: 1e9 }),
  (e: unknown) => e instanceof ScriptError && e.kind === 'limit' && /limit of 1,000 steps/.test(e.message));

// ---------------------------------------------------------------- the sandbox: only registered functions exist
fails('eval("1")', /NameError/);
fails('open("x.txt")', /NameError/);
fails('__import__("os")', /NameError/);
fails('window.alert(1)', /NameError/);
fails('print.__class__', /must be called as a method/);
fails('"x".constructor("return 1")()', /no method "constructor"/);

// ---------------------------------------------------------------- Guided mode: syntax follows the skills bought, in any order
{
  const g = (src: string, ...skills: string[]) => py.compile(src, { guided: true, skills: new Set(skills) });
  g('move("north")\nharvest()');
  assert.throws(() => g('x = 1'), /Variables need the Variables skill/);
  g('while True:\n    harvest()', 'loop'); // loops first: automation does not wait for variables
  assert.throws(() => g('x = 1 + 2', 'counter'), /Arithmetic .* Operators skill/);
  g('x = 1 + 2', 'counter', 'operators');
  assert.throws(() => g('if can_harvest():\n    harvest()', 'counter', 'operators'), /Decisions .* Sense skill/);
  assert.throws(() => g('while True:\n    harvest()', 'sense'), (e: unknown) => e instanceof ScriptError && /Loops/.test(e.message) && e.line === 1);
  assert.throws(() => g('def f():\n    harvest()', 'loop'), /Functions \(def\) need the Functions skill/);
  py.compile('while True:\n    harvest()', { guided: false, skills: new Set() }); // Engineer mode: any syntax
}

// ---------------------------------------------------------------- unavailable languages say so honestly
assert.equal(LANGUAGES.java.available, false);
assert.throws(() => LANGUAGES.java.compile('move("north");'), (e: unknown) => e instanceof ScriptError && e.kind === 'unavailable');
assert.throws(() => LANGUAGES.typescript.compile('move("north");'), (e: unknown) => e instanceof ScriptError && e.kind === 'unavailable');

// ---------------------------------------------------------------- real robot control through player code
function field() {
  const world = new World(10, 8);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 10; x++) { world.set(x, y, TileType.Grass); world.setHeight(x, y, 1); }
  const entities = new EntityManager(10);
  const robot = new Robot(2, 4), storage = new StorageDepot(0, 6), pile = new ResourceNode(2, 2, 'scrap_0', 'scrap', 15);
  [robot, storage, pile].forEach((e) => entities.add(e));
  const sim = new Simulation(world, entities);
  const log: string[] = [], out: string[] = [];
  const host: HostApi = {
    functions: createHostFunctions(new RobotCommands(sim, robot), { action: (t) => log.push('> ' + t), result: (t, ok) => log.push((ok ? '+ ' : '- ') + t) }),
    print: (t) => out.push(t),
  };
  return { sim, robot, storage, pile, host, log, out };
}
function play(f: ReturnType<typeof field>, src: string, maxTicks = 60 * 600, limits?: Partial<RunLimits>) {
  const runner = new ProgramRunner(py.compile(src), f.host, { stepsPerTick: 400, idleStepLimit: 100_000, maxSteps: 1e7, ...limits });
  let err: ScriptError | null = null, ticks = 0;
  runner.events.on('error', (e) => { err = e; });
  for (; ticks < maxTicks && runner.isActive; ticks++) { runner.tick(); f.sim.update(1 / 60); }
  return { runner, err: err as ScriptError | null, ticks };
}

{ // the spec's first example, step by step and over many ticks
  const f = field();
  const { runner, err, ticks } = play(f, 'move("north")\nharvest()\nmove("east")\nharvest()\ndeposit()');
  assert.equal(err, null);
  assert.equal(runner.state, 'finished');
  assert.ok(ticks > 60 * 4, `program must take real time, took ${ticks} ticks`);
  assert.equal(f.robot.inventory.total, 0);
  assert.equal(f.storage.inventory.get('scrap'), 3, 'second harvest() failed (nothing adjacent after moving east), first stored');
  assert.ok(f.log.some((l) => l.startsWith('- harvest() failed: no resource deposit there. Tip: Seedling must stand next to')), f.log.join('\n'));
  assert.ok(f.log.some((l) => l.startsWith('+ stored 3 Scrap Metal')));
}
{ // the program waits for each action before running the next line
  const f = field();
  const runner = new ProgramRunner(py.compile('move("north")\nprint("arrived", get_position())'), f.host);
  for (let i = 0; i < 10; i++) { runner.tick(); f.sim.update(1 / 60); }
  assert.deepEqual(f.out, [], 'print must wait until the move finished');
  assert.equal(runner.line, 1);
  for (let i = 0; i < 60 && runner.isActive; i++) { runner.tick(); f.sim.update(1 / 60); }
  assert.deepEqual(f.out, ['arrived [2, 3]']);
}
{ // loops, functions and queries driving the robot until the deposit is used up
  const f = field();
  const { err, runner } = play(f, PYTHON_EXAMPLES.find((e) => e.id === 'loops')!.code.replace(/move_to\(\d+, \d+\)/, 'move_to(2, 3)'));
  assert.equal(err, null, err?.message);
  assert.equal(runner.state, 'finished');
  assert.equal(f.storage.inventory.get('scrap'), 15);
  assert.ok(f.pile.depleted);
  assert.deepEqual(f.out, ['Trip 1 done.', 'Trip 2 done.', 'The pile is empty.']);
}
{ // the spec's advanced example: while True + can_harvest(), runs until stopped
  const f = field();
  const runner = new ProgramRunner(py.compile('while True:\n    if can_harvest():\n        harvest()\n\n    move("north")'), f.host);
  for (let i = 0; i < 60 * 20; i++) { runner.tick(); f.sim.update(1 / 60); }
  assert.equal(runner.state, 'running', 'blocked moves return False quickly but are robot actions, so no idle-limit error');
  runner.stop();
  assert.equal(runner.state, 'stopped');
  assert.ok(f.robot.inventory.total > 0);
}
{ // cancellation mid-action, and pause/resume
  const f = field();
  const runner = new ProgramRunner(py.compile('move_to(9, 4)\nprint("done")'), f.host);
  for (let i = 0; i < 30; i++) { runner.tick(); f.sim.update(1 / 60); }
  runner.pause();
  const x = f.robot.posX;
  for (let i = 0; i < 600; i++) { runner.tick(); f.sim.update(1 / 60); }
  assert.ok(f.robot.posX > x, 'the current action completes while paused');
  assert.deepEqual(f.out, [], 'but the program does not continue');
  runner.resume();
  for (let i = 0; i < 10; i++) { runner.tick(); f.sim.update(1 / 60); }
  assert.deepEqual(f.out, ['done']);
}
{ // bad arguments to game commands
  const f = field();
  assert.match(play(f, 'move("up")').err!.message, /expects "north", "south", "east" or "west"/);
  assert.match(play(f, 'harvest(1)').err!.message, /takes no arguments, but 1 was given/);
  assert.match(play(f, 'move_to("a", 2)').err!.message, /needs a number for x/);
  assert.equal(play(f, 'x = get_inventory_capacity()\nprint(x, get_robot_status(), get_inventory(), get_resource_type())').err, null);
  assert.deepEqual(f.out.at(-1), '10 idle {} None');
}

// ---------------------------------------------------------------- saving a program mid-run (VM snapshots)
{ // pure computation: save after a few ticks, restore from JSON, and the output is identical to an uninterrupted run
  const src = `def fib(n):
    a, b = 0, 1
    for i in range(n):
        a, b = b, a + b
    return a
d = {"xs": []}
shared = d["xs"]
for k in range(40):
    shared.append(fib(k % 12))
    if k % 7 == 0:
        print(k, len(d["xs"]), sum(shared))
print("end", d["xs"] is shared)`;
  const full = runPure(src, { stepsPerTick: 25 }).out;
  const out: string[] = [];
  const host: HostApi = { functions: new Map(), print: (t) => out.push(t) };
  const limits = { stepsPerTick: 25, idleStepLimit: 1e6, maxSteps: 1e7 };
  let r = new ProgramRunner(py.compile(src), host, limits);
  for (let i = 0; i < 9; i++) r.tick();
  const snap = JSON.parse(JSON.stringify(r.save()));
  r = new ProgramRunner(py.compile(src), host, limits, snap); // a fresh VM from the snapshot
  for (let i = 0; i < 1000 && r.isActive; i++) r.tick();
  assert.equal(r.state, 'finished');
  assert.deepEqual(out, full, 'restored run must match, including shared references');
  assert.equal(out.at(-1), 'end True');
}
{ // waiting on a robot action: after loading, the interrupted action is issued again from the robot's tile
  const f = field();
  const src = `for i in range(3):
    move("east")
print("at", get_position())`;
  let r = new ProgramRunner(py.compile(src), f.host);
  for (let i = 0; i < 40; i++) { r.tick(); f.sim.update(1 / 60); } // part-way through the second step
  const snap = JSON.parse(JSON.stringify(r.save()));
  const g = field(); // "after loading": a fresh world with the robot on its last completed tile
  g.robot.tileX = f.robot.tileX; g.robot.tileY = f.robot.tileY; g.robot.posX = f.robot.tileX + 0.5; g.robot.posY = f.robot.tileY + 0.5;
  r = new ProgramRunner(py.compile(src), g.host, undefined, snap);
  for (let i = 0; i < 600 && r.isActive; i++) { r.tick(); g.sim.update(1 / 60); }
  assert.equal(r.state, 'finished');
  assert.deepEqual(g.out, ['at [5, 4]'], 'three steps east of (2,4), none lost or doubled');
}

// ---------------------------------------------------------------- persistence
{
  const mem = new Map<string, string>();
  const storage: KeyValueStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => { mem.set(k, v); } };
  const a = new ProgramStore(storage);
  assert.equal(a.language, 'python');
  a.setCode('python', 'print("py")');
  a.setLanguage('java');
  a.setCode('java', '// java');
  a.setTutorial(['move']);
  const b = new ProgramStore(storage); // "after refresh"
  assert.equal(b.language, 'java');
  assert.equal(b.code('python'), 'print("py")', 'switching language must not overwrite python');
  assert.equal(b.code('java'), '// java');
  assert.equal(b.code('typescript'), null);
  assert.deepEqual(b.tutorial, ['move']);
  b.saveSnippet('make_kit', 'deliver("wood", "workbench")'); b.saveSnippet('make_kit', 'put()');
  assert.deepEqual(new ProgramStore(storage).library, [{ name: 'make_kit', code: 'put()' }], 'the library survives a refresh; same name replaces');
  mem.set('rootworks.programs.v1', '{not json');
  assert.equal(new ProgramStore(storage).language, 'python', 'corrupt save falls back to defaults');
  mem.set('rootworks.programs.v1', JSON.stringify({ language: 'cobol', code: { python: 5 } }));
  const c = new ProgramStore(storage);
  assert.equal(c.language, 'python'); assert.equal(c.code('python'), null);
  assert.equal(new ProgramStore(null).language, 'python', 'works without storage');
}

// ---------------------------------------------------------------- tutorial progression
{
  const t = new Tutorial();
  assert.equal(t.observe({ ok: true, action: 'deposit()' }), false, 'steps complete in order');
  assert.equal(t.observe({ ok: true, action: 'move(north)' }), true);
  assert.equal(t.observe({ ok: false, action: 'harvest()' }), false);
  assert.equal(t.observe({ ok: true, action: 'harvest()' }), true);
  assert.equal(new Tutorial().observe({ ok: true, action: 'go_to(scrap)' }), true, 'go_to() is the first lesson');
  assert.equal(new Tutorial().observe({ ok: true, action: 'approach(3, 4)' }), true, 'go_to(x, y) counts too');
  assert.deepEqual(new Tutorial(['move', 'harvest', 'storage', 'deposit']).completed, ['move', 'harvest', 'deposit'], 'old saves with the removed storage step keep their progress');
  assert.equal(t.mark('lab'), false, 'built early: remembered, but not its turn yet');
  assert.equal(t.observe({ ok: true, action: 'deposit()' }), true);
  assert.equal(t.mark('workbench'), false, 'automation comes first');
  assert.equal(t.mark('automate'), true, 'buying Loops completes it, and the early Workbench with it');
  assert.equal(t.observe({ ok: true, action: 'take(research_kit)', data: { moved: { research_kit: 1 } } }), true);
  assert.ok(t.steps.find((s) => s.id === 'lab')!.done, 'the early Lab completes as soon as its turn comes');
  assert.equal(t.mark('research'), true);
  assert.ok(t.complete);
  assert.deepEqual(new Tutorial(['move', 'deposit']).completed, ['move'], 'restored progress must be a prefix');
  assert.deepEqual(new Tutorial(['move', 'harvest', 'deposit', 'workbench']).completed, ['move', 'harvest', 'deposit', 'automate', 'workbench'], 'a lesson added later does not cost old saves their progress');
  assert.deepEqual(new Tutorial(['move', 'harvest', 'deposit']).completed, ['move', 'harvest', 'deposit'], 'but it is still taught when the save has not passed it');
}


// ---------------------------------------------------------------- step mode: one line at a time, waiting for the robot's action
{
  let pending: { result: { ok: boolean; action: string } | null } | null = null;
  const fns = new Map([['act', { name: 'act', params: [], doc: '', call: () => ({ pending: (pending = { result: null }) as never, map: () => true }) }]]);
  const runner = new ProgramRunner(LANGUAGES.python.compile('a = 1\nact()\nb = 2\nprint(a + b)'), { functions: fns as never, print() {} });
  runner.pause();
  runner.step(); runner.tick();
  assert.equal(runner.state, 'paused', 'a line without an action pauses right after');
  assert.equal(runner.line, 2, 'and shows the next line');
  assert.deepEqual(runner.variables, [['a', '1']], 'the debugger sees the variable, not the functions');
  runner.step(); runner.tick(); runner.tick();
  assert.equal(runner.state, 'running', 'still waiting for the robot');
  pending!.result = { ok: true, action: 'act' };
  runner.tick();
  assert.equal(runner.state, 'paused', 'pauses once the action is done');
  assert.equal(runner.line, 3, 'on the next line, not the finished one');
  runner.resume();
  for (let i = 0; i < 5; i++) runner.tick();
  assert.equal(runner.state, 'finished');
}
console.log('scripting ok');
