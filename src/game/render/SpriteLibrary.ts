import { Texture, TextureSource } from 'pixi.js';
import { PixelCanvas, swayFrames } from './pixel/PixelCanvas.ts';
import * as nature from './sprites/nature.ts';
import * as bld from './sprites/buildings.ts';
import { COSMETIC_IDS, ROBOT_POSES, SPROUT_STAGES, cosmeticCanvas, robotFrame, type RobotPose } from './sprites/robot.ts';
import { itemIcon } from './sprites/items.ts';
import { RESOURCE_IDS, type ResourceId } from '../resources/ResourceDefs.ts';
import { butterflyTexture, cloudTexture, glintTexture, moteTexture, smokeTexture, glowTexture } from './sprites/fx.ts';
import type { Built, SpriteFx } from './sprites/types.ts';

export interface SpriteAsset {
  /** One frame, wind-sway frames (leaning left -> right), or a looping animation. */
  frames: Texture[];
  /** If set, `frames` loop at this rate instead of following the wind. */
  fps?: number;
  shadow?: Texture;
  /** Anchor as a fraction of texture size. */
  anchorX: number;
  anchorY: number;
  fx?: SpriteFx;
  shade?: Built['shade'];
  /** First frame's pixels, kept for menu thumbnails. */
  source: PixelCanvas;
}

const toTexture = (pc: PixelCanvas): Texture => Texture.from(pc.toCanvas());

const BUILDERS: Record<string, () => Built> = {
  oak_0: () => nature.oak(0), oak_1: () => nature.oak(1), oak_2: () => nature.oak(2),
  heart_0: () => nature.heartTree(0), heart_1: () => nature.heartTree(1), heart_2: () => nature.heartTree(2),
  heart_3: () => nature.heartTree(3), heart_4: () => nature.heartTree(4), heart_5: () => nature.heartTree(5),
  maple_0: nature.maple, cherry_0: nature.cherry, willow_0: nature.willow, giant_tree: nature.giantTree,
  birch_0: () => nature.birch(0), birch_1: () => nature.birch(1),
  pine_0: () => nature.pine(0), pine_1: () => nature.pine(1),
  bush_0: () => nature.bush('plain', 0), bush_1: () => nature.bush('flower', 1), bush_berry: () => nature.bush('berry', 2), bush_autumn: () => nature.bush('autumn', 3),
  ivy_0: () => nature.ivyMound(0), ivy_1: () => nature.ivyMound(1),
  fern_0: () => nature.fern(0), fern_1: () => nature.fern(1),
  hosta_0: () => nature.broadleafPlant(0), hosta_1: () => nature.broadleafPlant(1),
  grass_0: () => nature.grassTuft(0), grass_1: () => nature.grassTuft(1), grass_2: () => nature.grassTuft(2),
  flowers_0: () => nature.flowers(0), flowers_1: () => nature.flowers(1), flowers_2: () => nature.flowers(2),
  flowers_3: () => nature.flowers(3), flowers_4: () => nature.flowers(4),
  mushroom: () => nature.mushroom(false), glowshroom: () => nature.mushroom(true),
  stump: nature.stump, log: nature.log, sticks_0: () => nature.sticks(0), sticks_1: () => nature.sticks(1),
  pebbles_0: () => nature.pebbles(0), pebbles_1: () => nature.pebbles(1),
  reeds_0: () => nature.reeds(0), reeds_1: () => nature.reeds(1),
  boulder_0: () => nature.stoneBoulder(0), boulder_1: () => nature.stoneBoulder(1), boulder_2: () => nature.stoneBoulder(2),
  iron_0: () => nature.oreNode('iron', 0), iron_1: () => nature.oreNode('iron', 1),
  copper_0: () => nature.oreNode('copper', 0), copper_1: () => nature.oreNode('copper', 1),
  scrap_0: () => nature.scrapPile(0), scrap_1: () => nature.scrapPile(1),
  lab: bld.lab, factory: bld.factory, greenhouse: bld.greenhouse, tank: bld.tank, turbine: bld.turbine,
  generator: bld.generator, depot: bld.depot, barrels: bld.barrels, crates: bld.crates, bay: bld.bay,
  lamp: bld.lamp, terminal: bld.terminal, conveyor_v: bld.conveyorV, pipe_u: bld.pipeU, fence_u: bld.fenceU,
  wall_u: () => bld.stoneWall('u'), wall_v: () => bld.stoneWall('v'),
  planter_0: () => bld.planter(0), planter_1: () => bld.planter(1), planter_2: () => bld.planter(2),
  bench: bld.bench, signpost: bld.signpost, mine: bld.mine,
  workbench: bld.workbench, lab_building: bld.labBuilding, sawmill: bld.sawmill, kiln: bld.kiln,
};

export const robotSprite = (facing: number, pose: RobotPose, stage: number) => `robot_${facing}_${pose}_${stage}`;

/** Builds every texture once at startup. All art is painted procedurally: no image files. */
export class SpriteLibrary {
  private readonly assets = new Map<string, SpriteAsset>();
  private readonly glows = new Map<string, Texture>();
  private readonly thumbs = new Map<string, string>();
  /** Item icons, the same pixels the UI shows. */
  readonly items = new Map<ResourceId, Texture>();
  /** Seedling's accessories, per facing (key "goggles_1"). */
  readonly cosmetics = new Map<string, Texture>();
  readonly smoke: Texture;
  readonly glint: Texture;
  readonly mote: Texture;
  readonly clouds: Texture[];
  /** [colour][frame] */
  readonly butterflies: Texture[][];

  constructor() {
    TextureSource.defaultOptions.scaleMode = 'nearest';
    for (const [id, make] of Object.entries(BUILDERS)) this.register(id, make());
    // Seedling: every facing x pose x sprout stage is one looping animation (see robotSprite)
    for (let st = 0; st < SPROUT_STAGES; st++) for (let f = 0; f < 4; f++) for (const pose of Object.keys(ROBOT_POSES) as RobotPose[]) {
      const frames = Array.from({ length: ROBOT_POSES[pose] }, (_, k) => robotFrame(f, pose, k, st));
      this.register(robotSprite(f, pose, st), { ...frames[0], frames: frames.slice(1).map((b) => b.pc) });
    }
    for (const id of RESOURCE_IDS) this.items.set(id, toTexture(itemIcon(id)));
    for (const id of COSMETIC_IDS) for (let f = 0; f < 4; f++) this.cosmetics.set(`${id}_${f}`, toTexture(cosmeticCanvas(id, f)));
    this.smoke = toTexture(smokeTexture());
    this.glint = toTexture(glintTexture(0xffe8b0));
    this.mote = toTexture(moteTexture(0xfff2b8));
    this.clouds = [cloudTexture(3), cloudTexture(8)].map(toTexture);
    this.butterflies = [0xfff4d8, 0xffc848, 0xf08a5a].map((c) => [toTexture(butterflyTexture(c, true)), toTexture(butterflyTexture(c, false))]);
  }

  private register(id: string, b: Built): void {
    const canvases = b.frames ? [b.pc, ...b.frames] : b.sway ? swayFrames(b.pc, b.oy, b.sway) : [b.pc];
    this.assets.set(id, {
      frames: canvases.map(toTexture), fps: b.frames ? b.fps ?? 8 : undefined,
      shadow: b.shadow && toTexture(b.shadow),
      anchorX: b.ox / b.pc.w, anchorY: b.oy / b.pc.h, fx: b.fx, shade: b.shade, source: b.pc,
    });
  }

  has(id: string): boolean { return this.assets.has(id); }

  /** Every painted model (robot animation frames left out), for the dev gallery. */
  ids(): string[] { return Object.keys(BUILDERS); }

  get(id: string): SpriteAsset {
    const a = this.assets.get(id);
    if (!a) throw new Error(`Unknown sprite: ${id}`);
    return a;
  }

  /** PNG data URL of a sprite cropped to its pixels, for UI menus. Cached. */
  thumbnail(id: string): string {
    let url = this.thumbs.get(id);
    if (url) return url;
    const pc = this.get(id).source;
    let x0 = pc.w, y0 = pc.h, x1 = 0, y1 = 0;
    for (let y = 0; y < pc.h; y++) for (let x = 0; x < pc.w; x++) if (pc.alpha(x, y)) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const c = document.createElement('canvas');
    c.width = Math.max(1, x1 - x0 + 1); c.height = Math.max(1, y1 - y0 + 1);
    c.getContext('2d')!.drawImage(pc.toCanvas(), -x0, -y0);
    this.thumbs.set(id, (url = c.toDataURL()));
    return url;
  }

  glowTexture(radius: number, color: number): Texture {
    const k = `${radius}:${color}`;
    let t = this.glows.get(k);
    if (!t) this.glows.set(k, (t = toTexture(glowTexture(radius, color))));
    return t;
  }
}
