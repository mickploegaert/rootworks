import { fbm, hash2, vnoise } from '../core/noise.ts';
import type { EntityManager } from '../entities/EntityManager.ts';
import { Machine } from '../entities/Machine.ts';
import { Prop } from '../entities/Prop.ts';
import { ResourceNode } from '../entities/ResourceNode.ts';
import { Robot } from '../entities/Robot.ts';
import { StorageDepot } from '../entities/StorageDepot.ts';
import { MACHINES, type MachineId } from '../production/MachineDefs.ts';
import type { ResourceId } from '../resources/ResourceDefs.ts';
import type { BiomeId } from '../world/biomes.ts';
import { TileType, World } from '../world/World.ts';

export const DIORAMA_SIZE = 46;
/** The tile the title camera circles around: the heart of the works. */
export const DIORAMA_FOCUS = { x: 24, y: 23 };

/**
 * The title-screen world: a hand-composed valley that shows what ROOTWORKS becomes, not where it starts.
 * Highland and a waterfall at the back, the works in the middle, gardens and the shore at the front.
 * It is a real world: real machines, and robots running real Python programs.
 */
export function buildDiorama(entities: EntityManager): { world: World; programs: { robot: Robot; source: string }[] } {
  const N = DIORAMA_SIZE, world = new World(N, N), seed = 7;
  const C = N / 2;
  const set = (x: number, y: number, t: TileType, h: number, b: BiomeId) => { world.set(x, y, t); world.setHeight(x, y, h); world.setBiome(x, y, b); };

  // --- land: an island, high at the back (low x + y is the top of the screen) ---------------------
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const d = Math.hypot(x + 0.5 - C, (y + 0.5 - C) * 1.05) / (C - 1.5) + (fbm(x * 0.09, y * 0.09, 3, seed) - 0.5) * 0.22;
    if (d >= 1) continue;
    const back = x + y + (vnoise(x * 0.2, y * 0.2, seed + 1) - 0.5) * 5;
    let h = 1, t = TileType.Grass, b: BiomeId = 'meadow';
    if (back < 30) { h = 2; t = vnoise(x * 0.25, y * 0.25, seed + 2) > 0.6 ? TileType.Rock : TileType.Grass; b = 'highland'; }
    if (back < 15 && Math.hypot(x - 8, y - 7) < 7) { h = 3; t = TileType.Rock; }
    if (x > 31 && y < 26 && h === 1) { t = TileType.Moss; b = 'forest'; }
    if (b === 'meadow' && fbm(x * 0.12, y * 0.12 + 9, 2, seed + 3) > 0.62) b = 'flowers';
    if (d > 0.88) { t = TileType.Sand; h = 0; b = 'beach'; }
    set(x, y, t, h, b);
  }

  // --- the river: summit spring, a waterfall off the highland, out to the sea at the front left --------
  const river: [number, number][] = [[9, 9], [10, 14], [11, 18], [10, 23], [9, 29], [11, 35], [13, 41], [14, 46]];
  let level = 9;
  for (let i = 0; i < river.length - 1; i++) {
    const [ax, ay] = river[i], [bx, by] = river[i + 1];
    const steps = Math.ceil(Math.hypot(bx - ax, by - ay) * 3);
    for (let s = 0; s <= steps; s++) {
      const px = ax + ((bx - ax) * s) / steps, py = ay + ((by - ay) * s) / steps;
      const cx = Math.floor(px), cy = Math.floor(py);
      if (world.get(cx, cy) === null) continue;
      level = Math.min(level, world.heightAt(cx, cy));
      const r = 1.1 + vnoise(px * 0.2, py * 0.2, seed + 4) * 0.7;
      for (let y = Math.floor(py - r - 1); y <= py + r + 1; y++) for (let x = Math.floor(px - r - 1); x <= px + r + 1; x++) {
        if (world.get(x, y) === null || Math.hypot(x + 0.5 - px, y + 0.5 - py) > r) continue;
        const was = world.get(x, y) === TileType.Water ? world.heightAt(x, y) : 9;
        set(x, y, TileType.Water, Math.min(was, level), 'riverside');
      }
    }
  }
  // a mill pond by the gardens
  for (let y = 30; y < 40; y++) for (let x = 30; x < 40; x++) {
    if (Math.hypot(x - 35, (y - 35) * 1.2) + (vnoise(x * 0.4, y * 0.4, seed + 5) - 0.5) * 1.6 < 3.2 && world.get(x, y) !== null) set(x, y, TileType.Water, 0, 'riverside');
  }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const t = world.get(x, y);
    if ((t === TileType.Grass || t === TileType.Moss) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => world.get(x + a, y + b) === TileType.Water) && hash2(x, y, seed) < 0.6) {
      world.set(x, y, TileType.Shore); world.setBiome(x, y, 'riverside');
    }
  }

  // --- the works: a cobbled yard with paths out to the forest, the hills and the gardens -------------
  for (let y = 16; y <= 30; y++) for (let x = 17; x <= 31; x++) {
    if (world.get(x, y) === null || world.heightAt(x, y) !== 1 || world.get(x, y) === TileType.Water) continue;
    const edge = x === 17 || x === 31 || y === 16 || y === 30;
    if (edge && hash2(x, y, seed + 6) > 0.6) continue;
    set(x, y, TileType.Concrete, 1, 'yard');
  }
  const path = (pts: [number, number][]) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1], n = Math.max(Math.abs(bx - ax), Math.abs(by - ay)) * 2;
      for (let s = 0; s <= n; s++) {
        const x = Math.round(ax + ((bx - ax) * s) / n), y = Math.round(ay + ((by - ay) * s) / n), t = world.get(x, y);
        if (t === TileType.Grass || t === TileType.Moss || t === TileType.Shore) world.set(x, y, TileType.Path);
      }
    }
  };
  path([[31, 22], [36, 19], [40, 14]]);
  path([[24, 30], [27, 35], [26, 40]]);
  path([[17, 24], [13, 25]]);

  // --- structures ------------------------------------------------------------------------------------
  const prop = (x: number, y: number, sprite: string, name: string, w = 1, d = 1, blocking = true) =>
    entities.add(new Prop(x, y, sprite, name, '', blocking ? 'structure' : 'vegetation', w, d, blocking));
  const machine = (x: number, y: number, sprite: string, id: MachineId) => entities.add(new Machine(x, y, sprite, id, MACHINES[id].name, '', 2, 2));
  prop(19, 17, 'lab', 'Workshop', 4, 3);
  machine(25, 17, 'kiln', 'kiln');
  machine(28, 19, 'sawmill', 'sawmill');
  machine(19, 22, 'workbench', 'workbench');
  machine(20, 26, 'lab_building', 'lab');
  entities.add(new StorageDepot(25, 25));
  prop(28, 26, 'factory', 'Small Factory', 2, 2);
  prop(23, 21, 'terminal', 'Terminal');
  prop(24, 22, 'bay', 'Charging Bay');
  for (const [x, y] of [[23, 16], [30, 23], [22, 29], [17, 21], [27, 24]]) prop(x, y, 'lamp', 'Lantern');
  prop(30, 17, 'tank', 'Water Tower');
  prop(18, 29, 'turbine', 'Windmill');
  prop(14, 27, 'turbine', 'Windmill');
  prop(27, 29, 'generator', 'Boiler');
  for (let y = 26; y <= 28; y++) prop(31, y, 'conveyor_v', 'Conveyor');
  prop(26, 28, 'pipe_u', 'Copper Pipe');
  for (const [x, y, s] of [[29, 22, 'crates'], [30, 21, 'barrels'], [22, 25, 'barrels'], [18, 25, 'crates']] as const) prop(x, y, s, s);
  prop(23, 30, 'bench', 'Bench');
  prop(24, 31, 'signpost', 'Signpost');
  // gardens by the pond
  prop(32, 30, 'greenhouse', 'Greenhouse', 2, 2);
  for (let i = 0; i < 4; i++) prop(28 + i, 32, `planter_${i % 3}`, 'Vegetable Bed');
  for (let i = 0; i < 5; i++) prop(27 + i, 34, 'fence_u', 'Fence');
  for (let i = 0; i < 4; i++) prop(15 + i, 13 + i, 'wall_u', 'Stone Wall');

  // --- resources: the forest (east), stone and ore up the hill, salvage by the shore ----------------
  const node = (x: number, y: number, sprite: string, res: ResourceId, amount: number) => {
    const t = world.get(x, y);
    if (t === null || t === TileType.Water || t === TileType.Path || t === TileType.Concrete || !entities.isFree(x, y)) return;
    entities.add(new ResourceNode(x, y, sprite, res, amount));
  };
  const rnd = (i: number) => hash2(i, i * 7, seed + 20);
  const trees = ['oak_0', 'oak_2', 'cherry_0', 'oak_1', 'maple_0', 'birch_1', 'cherry_0', 'birch_0'];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const b = world.biomeAt(x, y), r = hash2(x, y, seed + 21), t = world.get(x, y);
    if (t === null || t === TileType.Water || t === TileType.Path || t === TileType.Concrete) continue;
    if (b === 'forest' && r < 0.4) node(x, y, trees[Math.floor(hash2(x, y, 3) * trees.length)], 'wood', 400);
    else if (b === 'highland' && r < 0.05) node(x, y, `boulder_${(x + y) % 3}`, 'stone', 400);
    else if (b === 'highland' && r < 0.075) node(x, y, `iron_${x % 2}`, 'iron_ore', 40);
    else if (b === 'highland' && r < 0.09) node(x, y, `copper_${y % 2}`, 'copper_ore', 30);
    else if (b === 'highland' && r < 0.13) node(x, y, (x + y) % 3 === 0 ? 'cherry_0' : `oak_${x % 3}`, 'wood', 40);
    else if (b === 'riverside' && t === TileType.Shore && r < 0.12) node(x, y, 'willow_0', 'wood', 40);
    else if ((b === 'meadow' || b === 'flowers') && r < 0.025) node(x, y, r < 0.012 ? 'cherry_0' : 'oak_0', 'wood', 40);
  }
  for (let i = 0; i < 6; i++) node(14 + Math.floor(rnd(i) * 6), 18 + Math.floor(rnd(i + 9) * 4), `boulder_${i % 3}`, 'stone', 400);
  node(34, 36 + 4, 'scrap_0', 'scrap', 40); node(21, 37, 'scrap_1', 'scrap', 40);
  node(10, 6, 'giant_tree', 'wood', 999);

  // --- ground cover ------------------------------------------------------------------------------------
  const cover: Partial<Record<BiomeId, string[]>> = {
    meadow: ['grass_0', 'grass_1', 'grass_2', 'bush_0', 'flowers_0', 'flowers_2', 'bush_berry', 'pebbles_0'],
    flowers: ['flowers_0', 'flowers_1', 'flowers_2', 'flowers_3', 'flowers_4', 'bush_1'],
    forest: ['fern_0', 'fern_1', 'hosta_0', 'mushroom', 'glowshroom', 'ivy_0', 'stump', 'log'],
    highland: ['grass_2', 'pebbles_1', 'bush_autumn', 'sticks_0'],
    riverside: ['reeds_0', 'reeds_1', 'hosta_1'],
    beach: ['pebbles_0', 'sticks_1'],
  };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const t = world.get(x, y), ids = cover[world.biomeAt(x, y)];
    if (!ids || t === null || t === TileType.Water || t === TileType.Path || t === TileType.Concrete || !entities.isFree(x, y)) continue;
    const r = hash2(x, y, seed + 30);
    if (r > (world.biomeAt(x, y) === 'beach' ? 0.08 : 0.42)) continue;
    prop(x, y, ids[Math.floor(hash2(x, y, seed + 31) * ids.length)], 'Plant', 1, 1, false);
  }

  // --- the crew: each robot runs a real program, so the machines really turn ----------------------------
  const crew = (x: number, y: number, name: string, source: string) => {
    const robot = new Robot(x, y, name);
    entities.add(robot);
    return { robot, source };
  };
  const programs = [
    crew(27, 22, 'Fern', `while True:
    go_to("wood")
    while can_harvest():
        harvest()
    go_to("sawmill")
    put()
`),
    crew(26, 23, 'Pip', `while True:
    go_to("sawmill")
    take()
    go_to("storage")
    put()
`),
    crew(22, 23, 'Cobble', `while True:
    go_to("stone")
    while can_harvest():
        harvest()
    go_to("kiln")
    put()
    take()
    go_to("storage")
    put()
`),
  ];
  return { world, programs };
}
