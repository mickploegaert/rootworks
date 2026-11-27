import { Application, Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import type { CosmeticId } from './sprites/robot.ts';
import { HEIGHT_UNIT, tileToWorld, uvToWorld } from '../core/iso.ts';
import { PARCEL } from '../world/World.ts';
import type { Camera } from '../camera/Camera.ts';
import type { TileRect } from '../entities/Entity.ts';
import type { EntityManager } from '../entities/EntityManager.ts';
import type { World } from '../world/World.ts';
import { AmbientFx } from './AmbientFx.ts';
import { DayNight, type Daylight } from './DayNight.ts';
import { EntityRenderer } from './EntityRenderer.ts';
import { SelectionOverlay } from './SelectionOverlay.ts';
import { SpriteLibrary } from './SpriteLibrary.ts';
import { ChunkedTerrain } from './ChunkedTerrain.ts';
import { SEA_COLOR, TERRAIN_CHUNK, type ShadeStamp } from './TerrainBaker.ts';

export interface Ghost { spriteId: string; rect: TileRect; valid: boolean }

/**
 * One Pixi application and one sprite library for the whole session, shared by the title screen and the game.
 * Pixi v8 keeps a global batch pool: destroying one Application and creating another hands the new one dead batches.
 * Reusing them also makes switching screens fast: the art is painted once.
 */
let sharedApp: Promise<Application> | null = null;
let sharedLib: SpriteLibrary | null = null;
function appFor(host: HTMLElement): Promise<Application> {
  sharedApp ??= (async () => {
    const app = new Application();
    await app.init({ background: SEA_COLOR, antialias: false, roundPixels: true, resolution: window.devicePixelRatio || 1, autoDensity: true });
    return app;
  })();
  return sharedApp.then((app) => { host.appendChild(app.canvas); app.resizeTo = host; app.resize(); return app; });
}

/** Owns the Pixi application and the layered scene graph. Reads simulation state; never mutates it. */
export class Renderer {
  app!: Application;
  private readonly ticks: ((t: { deltaMS: number }) => void)[] = [];
  private onResize: ((w: number, h: number) => void) | null = null;
  private host: HTMLElement | null = null;
  readonly selection: SelectionOverlay;
  /** The container the camera transforms. */
  readonly worldContainer = new Container();
  readonly dayNight: DayNight;
  daylight: Daylight;
  private lib!: SpriteLibrary;
  private entityRenderer!: EntityRenderer;
  private ambient!: AmbientFx;
  private terrain!: ChunkedTerrain;
  private readonly shade = new Sprite(Texture.WHITE);
  private readonly ghost = new Sprite(Texture.EMPTY);
  /** Locked parcels are veiled; the frontier of the unlocked land is outlined. */
  private readonly parcels = new Graphics();

  /** `dayStart` is where in the day (0..1) the clock starts. */
  constructor(private readonly world: World, dayStart?: number) {
    this.selection = new SelectionOverlay(world);
    this.dayNight = new DayNight(480, dayStart);
    this.daylight = this.dayNight.at(0);
  }

  async init(host: HTMLElement, entities: EntityManager, camera: Camera): Promise<void> {
    const world = this.world;
    this.host = host;
    this.app = await appFor(host);
    camera.setViewport(this.app.screen.width, this.app.screen.height);
    this.onResize = (w: number, h: number) => camera.setViewport(w, h);
    this.app.renderer.on('resize', this.onResize);

    const lib = (this.lib = sharedLib ??= new SpriteLibrary());
    // canopy shade is baked into the ground: stamps from the chunk's own and neighbouring entities
    const stampsFor = (cx: number, cy: number): ShadeStamp[] => {
      const out: ShadeStamp[] = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const e of entities.inChunk(cx + dx, cy + dy)) {
        const shade = lib.has(e.spriteId) ? lib.get(e.spriteId).shade : undefined;
        if (!shade) continue;
        const p = tileToWorld(e.tileX, e.tileY);
        out.push({ x: p.x + shade.dx, y: p.y - world.heightAt(e.tileX, e.tileY) * HEIGHT_UNIT + shade.dy, rx: shade.rx, ry: shade.ry, strength: shade.strength });
      }
      return out;
    };
    void TERRAIN_CHUNK;
    this.terrain = new ChunkedTerrain(world, stampsFor);
    const layers: Container[] = [this.terrain.ground, this.terrain.water];
    await this.terrain.ready(this.view(camera));
    this.entityRenderer = new EntityRenderer(lib, entities, world);
    const waterTiles: { x: number; y: number }[] = [];
    for (let y = 0; y < world.height && waterTiles.length < 400; y += 2) for (let x = 0; x < world.width; x += 2) if (world.get(x, y) === 6) waterTiles.push({ x, y });
    this.ambient = new AmbientFx(lib, world, waterTiles);
    // time-of-day light: multiplied over everything below it; lamps and glows sit above so they shine at night
    this.shade.blendMode = 'multiply';
    this.shade.position.set(-20000, -20000);
    this.shade.width = this.shade.height = 40000;
    this.ghost.alpha = 0.7;
    this.ghost.zIndex = 1e9;
    this.entityRenderer.bodies.addChild(this.ghost);
    // back to front: ground, water, markers, shadows, y-sorted bodies, daylight, lights/smoke, atmosphere
    this.worldContainer.addChild(
      ...layers, this.selection.view, this.ambient.ground,
      this.entityRenderer.shadows, this.entityRenderer.bodies, this.shade, this.parcels, this.entityRenderer.fx, this.ambient.top,
    );
    this.app.stage.addChild(this.worldContainer);
    this.drawParcels();
  }

  /** Redraw the veil over locked parcels (call after unlocking one). */
  drawParcels(): void {
    const w = this.world, g = this.parcels, P = w.parcelsAcross, lift = HEIGHT_UNIT;
    g.clear();
    const corner = (u: number, v: number) => { const p = uvToWorld(u, v); return [p.x, p.y - lift]; };
    for (let py = 0; py < P; py++) for (let px = 0; px < P; px++) {
      if (w.isParcelUnlocked(px, py)) continue;
      const u0 = px * PARCEL, v0 = py * PARCEL, u1 = u0 + PARCEL, v1 = v0 + PARCEL;
      g.poly([...corner(u0, v0), ...corner(u1, v0), ...corner(u1, v1), ...corner(u0, v1)]).fill({ color: 0x2e1f2a, alpha: 0.34 });
    }
    // frontier: edges between an unlocked and a locked parcel (not the world's own edge)
    const lockedAt = (px: number, py: number) => px >= 0 && py >= 0 && px < P && py * PARCEL < w.height && !w.isParcelUnlocked(px, py);
    for (let py = 0; py < P; py++) for (let px = 0; px < P; px++) {
      if (!w.isParcelUnlocked(px, py)) continue;
      const u0 = px * PARCEL, v0 = py * PARCEL, u1 = u0 + PARCEL, v1 = v0 + PARCEL;
      const edges: [boolean, number[], number[]][] = [
        [lockedAt(px, py - 1), corner(u0, v0), corner(u1, v0)], [lockedAt(px + 1, py), corner(u1, v0), corner(u1, v1)],
        [lockedAt(px, py + 1), corner(u1, v1), corner(u0, v1)], [lockedAt(px - 1, py), corner(u0, v1), corner(u0, v0)],
      ];
      for (const [locked, a, b] of edges) {
        if (!locked) continue;
        for (let i = 0; i < 32; i += 2) { // dashed: a hint, not a wall
          const t0 = i / 32, t1 = (i + 1) / 32;
          g.moveTo(a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0).lineTo(a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1);
        }
      }
    }
    g.stroke({ width: 2, color: 0xffcf6e, alpha: 0.55 });
  }

  /** Preview of a structure being placed. */
  setGhost(g: Ghost | null): void {
    this.selection.setGhost(g && g.rect, g?.valid ?? false);
    if (!g) { this.ghost.visible = false; return; }
    const a = this.lib.get(g.spriteId);
    const p = tileToWorld(g.rect.x, g.rect.y);
    this.ghost.texture = a.frames[0];
    this.ghost.anchor.set(a.anchorX, a.anchorY);
    this.ghost.position.set(p.x, p.y - this.world.heightAt(g.rect.x, g.rect.y) * HEIGHT_UNIT);
    this.ghost.tint = g.valid ? 0xffffff : 0xff8070;
    this.ghost.visible = true;
  }

  /** Clouds, motes, butterflies on or off (reduced motion). */
  /** The sprout on the robots' heads grows with the firmware tier. */
  setRobotStage(tier: number): void { if (this.entityRenderer) this.entityRenderer.robotStage = tier; }

  setAmbient(on: boolean): void { this.ambient.top.visible = this.ambient.ground.visible = on; }

  /** A small preview image of a sprite, for menus. */
  /** The intro's hold on Seedling and its first spark (see EntityRenderer). */
  get cinematic() { return this.entityRenderer.cinematic; }
  /** The intro hides the land-claim outlines: a film shot, not a map. */
  showParcels(on: boolean): void { this.parcels.visible = on; }
  flash(tileX: number, tileY: number, color: number): void { this.entityRenderer.flash(tileX, tileY, color); }
  cheer(seconds: number): void { this.entityRenderer.cheer(seconds); }
  thumbnail(spriteId: string): string { return this.lib.thumbnail(spriteId); }
  spriteIds(): string[] { return this.lib.ids(); }
  hasSprite(id: string): boolean { return this.lib.has(id); }

  /** A small JPEG of what is on screen, for the album (null if the GPU cannot read back). */
  async snapshot(): Promise<string | null> {
    try {
      const { width, height } = this.app.screen;
      return await this.app.renderer.extract.base64({ target: this.app.stage, frame: new Rectangle(0, 0, width, height), resolution: Math.min(1, 384 / width), format: 'jpg', quality: 0.75 });
    } catch { return null; }
  }

  /** What Seedling and the other robots wear. */
  setCosmetic(id: CosmeticId | null): void { if (this.entityRenderer) this.entityRenderer.cosmetic = id; }

  /** The camera's view in world space, with a margin so chunks load just before they scroll in. */
  view(camera: Camera) {
    const a = camera.screenToWorld(-200, -200), b = camera.screenToWorld(this.app.screen.width + 200, this.app.screen.height + 200);
    return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
  }

  render(t: number, dt: number, camera: Camera): void {
    this.daylight = this.dayNight.at(t);
    this.shade.tint = this.daylight.tint;
    this.entityRenderer.setVisible(this.terrain.update(this.view(camera), t));
    this.entityRenderer.update(t, dt, this.daylight.night);
    this.ambient.update(t, dt, this.daylight.night);
    this.selection.update(t);
  }

  /** Run every frame until this renderer is destroyed. */
  onTick(fn: (dt: number) => void): void {
    const f = (t: { deltaMS: number }) => fn(Math.min(t.deltaMS / 1000, 0.1));
    this.ticks.push(f);
    this.app.ticker.add(f);
  }

  /** Tear down this scene; the shared application and sprite library stay for the next one. */
  destroy(): void {
    this.terrain?.destroy();
    if (!this.app) return;
    for (const f of this.ticks) this.app.ticker.remove(f);
    if (this.onResize) this.app.renderer.off('resize', this.onResize);
    this.app.stage.removeChild(this.worldContainer);
    this.worldContainer.destroy({ children: true });
    if (this.app.canvas.parentElement === this.host) this.app.canvas.remove(); // a newer scene may already own it
  }
}
