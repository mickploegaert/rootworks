import { CommandHandle, DIRECTIONS, type CommandResult, type Direction, type RobotCommands } from '../api/RobotCommands.ts';
import { RESOURCES, type ResourceId } from '../resources/ResourceDefs.ts';
import { ScriptError, type HostFunction, type HostValue, type Pending } from './types.ts';

/** Messages the bindings report while a program runs (shown in the console). */
export interface HostLog {
  action(text: string): void;
  result(text: string, ok: boolean): void;
}

const resName = (id: string) => RESOURCES[id as ResourceId]?.name ?? id;

function friendly(r: CommandResult): string {
  const e = r.error ?? 'failed';
  if (e === 'blocked') return 'the way is blocked (edge of the island, water, an object, or a slope too steep)';
  if (e === 'stopped') return 'stopped';
  return e;
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

/** Firmware tiers by number. */
export const FIRMWARE_NAMES = ['Boot', 'Counter', 'Sense', 'Loop'] as const;

/**
 * The game functions available to player programs, built on RobotCommands. This is the only bridge
 * between interpreters and the game: no interpreter touches the simulation directly, and adding a
 * function here makes it available to every language at once.
 */
export function createHostFunctions(cmd: RobotCommands, log: HostLog, firmware: () => number = () => 99): Map<string, HostFunction> {
  const fns = new Map<string, HostFunction>();
  /** `tier`: firmware needed (gates are identical in Guided and Engineer mode). `optional`: trailing params that may be left out. */
  const def = (name: string, params: string[], doc: string, call: (args: HostValue[]) => HostValue | Pending, opts: { tier?: number; optional?: number } = {}) => {
    const max = params.length, min = max - (opts.optional ?? 0), tier = opts.tier ?? 0;
    fns.set(name, {
      name, params, doc,
      call: (args) => {
        if (firmware() < tier) {
          throw new ScriptError('runtime', `${name}() needs the ${FIRMWARE_NAMES[tier]} firmware (T${tier}). Research it at the Lab to unlock it.`);
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
  });
  def('move_to', ['x', 'y'], 'Walk to tile (x, y) along the shortest route. Returns True on arrival.', ([x, y]) => {
    const tx = int('move_to', 'x', x), ty = int('move_to', 'y', y);
    return act(`move_to(${tx}, ${ty})`, cmd.moveTo(tx, ty));
  });
  def('move_to_storage', [], 'Walk next to the storage depot. Returns True on arrival.', () => act('move_to_storage()', cmd.returnToStorage()));

  // resources
  def('harvest', [], 'Harvest the deposit next to the robot (the one in front first). Returns True if anything was collected.', () =>
    act('harvest()', cmd.harvest(), (r) => `collected ${r.data?.amount} ${resName(String(r.data?.resource))}${r.data?.remaining === 0 ? ' (deposit used up)' : ''}`));
  def('can_harvest', [], 'True if a deposit with stock is next to the robot and its cargo has room.', () => cmd.canHarvestHere(), { tier: 2 });
  def('get_resource_type', [], 'Resource of the adjacent deposit ("wood", "stone", "iron_ore", "copper_ore", "scrap"), or None.', () => cmd.adjacentResource(), { tier: 2 });

  // inventory
  def('get_inventory', [], 'Cargo as a dictionary, e.g. {"wood": 4}.', () => cmd.inventory() as HostValue, { tier: 1 });
  def('get_inventory_capacity', [], 'How many units the robot can carry in total.', () => cmd.capacity().max, { tier: 1 });
  def('get_inventory_count', [], 'How many units the robot is carrying.', () => cmd.capacity().used, { tier: 1 });
  def('is_inventory_full', [], 'True when the robot cannot carry any more.', () => cmd.capacity().used >= cmd.capacity().max, { tier: 2 });

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
  def('get_position', [], 'The robot\'s tile as [x, y].', () => { const p = cmd.position(); return [p.x, p.y]; }, { tier: 1 });
  def('get_robot_status', [], 'What the robot is doing: "idle", "moving", "harvesting", "returning" or "depositing".', () => cmd.state(), { tier: 2 });

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
  }, { optional: 2 });
  def('go_to', ['place'], 'Walk next to the nearest "storage", "workbench", "sawmill", "kiln" or "lab", or the nearest deposit of a resource ("wood", "stone", "scrap"...). Returns True on arrival.', ([p]) => {
    if (typeof p !== 'string') throw new ScriptError('runtime', `go_to() needs a place name, like "sawmill", but got ${describe(p)}.`);
    return act(`go_to("${p}")`, cmd.goTo(p));
  });
  def('get_nearby', [], 'Name of the machine or storage next to the robot ("sawmill", "storage"...), or None.', () => cmd.adjacentPlace(), { tier: 2 });
  return fns;
}
