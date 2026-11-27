import { CommandHandle, DIRECTIONS, type CommandResult, type Direction, type RobotCommands } from '../api/RobotCommands.ts';
import { RESOURCES, type ResourceId } from '../resources/ResourceDefs.ts';
import { researchById } from '../research/ResearchDefs.ts';
import { ScriptError, type HostFunction, type HostValue, type Pending } from './types.ts';

/** Messages the bindings report while a program runs (shown in the console). */
export interface HostLog {
  action(text: string): void;
  result(text: string, ok: boolean): void;
}

const resName = (id: string) => RESOURCES[id as ResourceId]?.name ?? id;

/** What to try next, for the failures beginners hit most. Matched on the start of the robot's error. */
const TIPS: [string, string][] = [
  ['no resource deposit there', 'Seedling must stand next to a deposit first: try go_to("tree") or go_to("scrap") on the line before.'],
  ['not next to the deposit', 'Walk there first with go_to("tree") (or "stone", "scrap").'],
  ['inventory is full', 'The cargo hold is full: deposit() it at storage, then harvest again.'],
  ['deposit is depleted', 'This one is used up. go_to() the same kind again to find the next one.'],
  ['no machine or storage next to', 'Walk to the machine first, for example go_to("workbench").'],
  ['the robot is carrying nothing', 'Harvest something first, or take() it from storage.'],
  ['nothing to deposit', 'The cargo hold is empty: harvest() something first.'],
  ['there is no reachable', 'Build it first (Build menu), or check its name in Commands & help.'],
];

function friendly(r: CommandResult): string {
  const e = r.error ?? 'failed';
  if (e === 'blocked') return 'the way is blocked (edge of the island, water, an object, or a slope too steep). Tip: go_to() finds a way around for you.';
  if (e === 'stopped') return 'stopped';
  const tip = TIPS.find(([start]) => e.startsWith(start));
  return tip ? `${e}. Tip: ${tip[1]}` : e;
}

function int(name: string, label: string, v: HostValue): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new ScriptError('runtime', `${name}() needs a number for ${label}, but got ${describe(v)}.`);
  return Math.trunc(v);
}

export function describe(v: HostValue): string {
  if (v === null) return 'None';
  if (typeof v === 'string') return `the text "${v}"`;
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (Array.isArray(v)) return 'a list';
  if (typeof v === 'object') return 'a dictionary';
  return String(v);
}

/** Friendly names players type, mapped to the game's ids. Resource names follow the HUD ("Timber", "Scrap Metal"). */
const PLACE_ALIASES: Record<string, string> = {
  wood: 'wood', tree: 'wood', trees: 'wood', timber: 'wood', log: 'wood', logs: 'wood',
  stone: 'stone', stones: 'stone', rock: 'stone', rocks: 'stone', fieldstone: 'stone', boulder: 'stone',
  scrap: 'scrap', scrap_metal: 'scrap', metal: 'scrap', junk: 'scrap',
  iron: 'iron_ore', iron_ore: 'iron_ore', copper: 'copper_ore', copper_ore: 'copper_ore',
  storage: 'storage', depot: 'storage', home: 'storage',
  workbench: 'workbench', bench: 'workbench', sawmill: 'sawmill', kiln: 'kiln', lab: 'lab', research_lab: 'lab',
  heart: 'heart', heart_tree: 'heart', cherry: 'heart',
};
export const PLACE_HINT = '"tree", "stone", "scrap", "iron", "copper", "storage", "workbench", "sawmill", "kiln", "lab", "heart"';
export const placeAlias = (p: string): string | null => PLACE_ALIASES[p.trim().toLowerCase().replace(/[\s-]+/g, '_')] ?? null;


/**
 * The game functions available to player programs, built on RobotCommands. This is the only bridge
 * between interpreters and the game: no interpreter touches the simulation directly, and adding a
 * function here makes it available to every language at once.
 */
export function createHostFunctions(cmd: RobotCommands, log: HostLog, skills: () => ReadonlySet<string> | null = () => null): Map<string, HostFunction> {
  const fns = new Map<string, HostFunction>();
  /** `skill`: skill needed (null skills = everything; gates are identical in Guided and Engineer mode). `optional`: trailing params that may be left out. */
  const def = (name: string, params: string[], doc: string, call: (args: HostValue[]) => HostValue | Pending, opts: { skill?: string; optional?: number; example?: string } = {}) => {
    const max = params.length, min = max - (opts.optional ?? 0), skill = opts.skill;
    fns.set(name, {
      name, params, doc, skill, example: opts.example ?? `${name}()`,
      call: (args) => {
        const have = skills();
        if (skill && have && !have.has(skill)) {
          throw new ScriptError('runtime', `${name}() needs the ${researchById(skill)?.name ?? skill} skill. Buy it with Sparks in the Skills tab.`);
        }
        if (args.length < min || args.length > max) {
          const want = max ? `${min === max ? max : `${min} to ${max}`} argument${max > 1 ? 's' : ''} (${params.join(', ')})` : 'no arguments';
          throw new ScriptError('runtime', `${name}() takes ${want}, but ${args.length} ${args.length === 1 ? 'was' : 'were'} given.`);
        }
        return call(args);
      },
    });
  };
  /** Start an action and give the program True/False when it finishes. */
  const act = (label: string, handle: CommandHandle, onOk?: (r: CommandResult) => string | null): Pending => {
    log.action(label);
    return {
      pending: handle,
      map: (r) => {
        if (r.ok) { const msg = onOk?.(r); if (msg) log.result(msg, true); }
        else log.result(`${label} failed: ${friendly(r)}`, false);
        return r.ok;
      },
    };
  };

  // movement
  def('move', ['direction'], 'Step one tile: "north", "south", "east" or "west". Returns True if the robot moved.', ([d]) => {
    if (typeof d !== 'string' || !(d.toLowerCase() in DIRECTIONS)) {
      throw new ScriptError('runtime', `move() expects "north", "south", "east" or "west", but got ${describe(d)}.`);
    }
    return act(`move("${d.toLowerCase()}")`, cmd.move(d.toLowerCase() as Direction));
  }, { example: 'move("north")' });
  def('move_to', ['x', 'y'], 'Walk to tile (x, y) along the shortest route. Returns True on arrival.', ([x, y]) => {
    const tx = int('move_to', 'x', x), ty = int('move_to', 'y', y);
    return act(`move_to(${tx}, ${ty})`, cmd.moveTo(tx, ty));
  }, { example: 'move_to(128, 130)' });
  def('move_to_storage', [], 'Walk next to the storage depot. Returns True on arrival.', () => act('move_to_storage()', cmd.returnToStorage()));

  // resources
  def('harvest', [], 'Harvest the deposit next to the robot (the one in front first). Returns True if anything was collected.', () =>
    act('harvest()', cmd.harvest(), (r) => `collected ${r.data?.amount} ${resName(String(r.data?.resource))}${r.data?.remaining === 0 ? ' (deposit used up)' : ''}`));
  def('can_harvest', [], 'True if a deposit with stock is next to the robot and its cargo has room.', () => cmd.canHarvestHere(), { skill: 'sense', example: 'while can_harvest():' });
  def('get_resource_type', [], 'Resource of the adjacent deposit ("wood", "stone", "iron_ore", "copper_ore", "scrap"), or None.', () => cmd.adjacentResource(), { skill: 'sense' });

  // inventory
  def('get_inventory', [], 'Cargo as a dictionary, e.g. {"wood": 4}.', () => cmd.inventory() as HostValue, { skill: 'counter', example: 'cargo = get_inventory()' });
  def('get_inventory_capacity', [], 'How many units the robot can carry in total.', () => cmd.capacity().max, { skill: 'counter' });
  def('get_inventory_count', [], 'How many units the robot is carrying.', () => cmd.capacity().used, { skill: 'counter' });
  def('is_inventory_full', [], 'True when the robot cannot carry any more.', () => cmd.capacity().used >= cmd.capacity().max, { skill: 'sense', example: 'if is_inventory_full():' });

  // storage: walks to the depot if needed, then unloads
  def('deposit', [], 'Walk to storage and unload all cargo. Returns True if anything was stored.', () => {
    log.action('deposit()');
    const walk = cmd.returnToStorage(), unload = cmd.deposit();
    return {
      pending: unload,
      map: (r: CommandResult) => {
        if (r.ok) {
          const parts = Object.entries((r.data?.deposited ?? {}) as Record<string, number>).map(([id, n]) => `${n} ${resName(id)}`);
          log.result(`stored ${parts.join(', ')}`, true);
          return true;
        }
        const cause = walk.result && !walk.result.ok ? walk.result : r;
        log.result(`deposit() failed: ${friendly(cause)}`, false);
        return false;
      },
    };
  });

  // robot information
  def('get_position', [], 'The robot\'s tile as [x, y].', () => { const p = cmd.position(); return [p.x, p.y]; }, { skill: 'counter', example: 'x, y = get_position()' });
  def('get_robot_status', [], 'What the robot is doing: "idle", "moving", "harvesting", "returning" or "depositing".', () => cmd.state(), { skill: 'sense' });

  // machines
  const itemArg = (name: string, v: HostValue | undefined) => {
    if (v === undefined || v === null) return undefined;
    if (typeof v !== 'string') throw new ScriptError('runtime', `${name}() needs the item as text, like "wood", but got ${describe(v)}.`);
    return v;
  };
  const amountArg = (name: string, v: HostValue | undefined) => (v === undefined ? undefined : int(name, 'the amount', v));
  const listMoved = (r: CommandResult) => Object.entries((r.data?.moved ?? {}) as Record<string, number>).map(([id, k]) => `${k} ${resName(id)}`).join(', ');
  def('put', ['item', 'amount'], 'Put cargo into the machine (or storage) next to the robot. put() puts everything it can use; put("wood", 2) puts two timber.', ([item, n]) => {
    const it = itemArg('put', item), amt = amountArg('put', n);
    return act(`put(${it ? `"${it}"` : ''}${amt !== undefined ? `, ${amt}` : ''})`, cmd.put(it, amt), (r) => `put ${listMoved(r)} into the ${String(r.data?.into)}`);
  }, { optional: 2 });
  def('take', ['item', 'amount'], 'Take products from the machine (or storage) next to the robot. take() takes everything that fits.', ([item, n]) => {
    const it = itemArg('take', item), amt = amountArg('take', n);
    return act(`take(${it ? `"${it}"` : ''}${amt !== undefined ? `, ${amt}` : ''})`, cmd.take(it, amt), (r) => `took ${listMoved(r)} from the ${String(r.data?.from)}`);
  }, { optional: 2, example: 'take("research_kit")' });
  def('go_to', ['place', 'y'], 'Walk next to a place: the nearest "tree", "stone", "scrap", "iron", "copper", "storage", "workbench", "sawmill", "kiln", "lab" or "heart" (the Heart Tree). Or give a tile: go_to(12, 8). Returns True on arrival.', ([p, y]) => {
    if (typeof p === 'number' || Array.isArray(p)) {
      const [px, py] = Array.isArray(p) ? p : [p, y];
      const tx = int('go_to', 'x', px ?? null), ty = int('go_to', 'y', py ?? null);
      return act(`go_to(${tx}, ${ty})`, cmd.approach(tx, ty));
    }
    if (typeof p !== 'string') throw new ScriptError('runtime', `go_to() needs a place name in quotes, like go_to("tree"), but got ${describe(p)}.`);
    const place = placeAlias(p);
    if (!place) throw new ScriptError('runtime', `go_to() doesn't know a place called "${p}". Try one of: ${PLACE_HINT}.`);
    return act(`go_to("${p}")`, cmd.goTo(place));
  }, { optional: 1, example: 'go_to("tree")' });
  def('deliver', ['item', 'place', 'amount'], 'Fetch an item from storage and put it into a machine: deliver("wood", "workbench"). Takes as much as fits unless you give an amount.', ([item, place, n]) => {
    if (typeof item !== 'string' || typeof place !== 'string') throw new ScriptError('runtime', `deliver() needs an item and a place in quotes, like deliver("wood", "workbench"), but got ${describe(item ?? null)} and ${describe(place ?? null)}.`);
    const target = placeAlias(place);
    if (!target) throw new ScriptError('runtime', `deliver() doesn't know a place called "${place}". Try one of: ${PLACE_HINT}.`);
    const amt = amountArg('deliver', n);
    log.action(`deliver("${item}", "${place}")`);
    // four queued steps; the result reports the first one that failed
    const steps = [cmd.goTo('storage'), cmd.take(item, amt), cmd.goTo(target), cmd.put(item, amt)];
    return {
      pending: steps[3],
      map: (r: CommandResult) => {
        const failed = steps.map((h) => h.result).find((x) => x && !x.ok) ?? (r.ok ? null : r);
        if (failed) { log.result(`deliver() failed: ${friendly(failed)}`, false); return false; }
        log.result(`delivered ${listMoved(r)} to the ${String(r.data?.into)}`, true);
        return true;
      },
    };
  }, { skill: 'logistics', optional: 1, example: 'deliver("wood", "workbench")' });
  def('get_stock', [], 'Everything in storage as a dictionary, e.g. {"wood": 12, "scrap": 4}. Use stock["wood"] or stock.get("planks", 0).', () => cmd.stock() as HostValue, { skill: 'counter', example: 'stock = get_stock()' });
  def('recipe', ['machine'], 'What a machine needs and makes, as a dictionary: recipe("sawmill") gives {"needs": {"wood": 2}, "makes": {"planks": 3}, "seconds": 4}.', ([m]) => {
    const r = typeof m === 'string' ? cmd.recipe(placeAlias(m) ?? m) : null;
    if (!r) throw new ScriptError('runtime', `recipe() needs a machine in quotes: "workbench", "sawmill" or "kiln", but got ${describe(m ?? null)}.`);
    return r as unknown as HostValue;
  }, { skill: 'counter', example: 'needs = recipe("sawmill")["needs"]' });
  def('get_nearby', [], 'Name of the machine or storage next to the robot ("sawmill", "storage"...), or None.', () => cmd.adjacentPlace(), { skill: 'sense' });
  return fns;
}
