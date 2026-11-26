import { Container, Sprite, Texture } from 'pixi.js';
import { HEIGHT_UNIT, depthOf, footprintDepth, tileToWorld, uvToWorld } from '../core/iso.ts';
import { hash2 } from '../core/noise.ts';
import type { Entity } from '../entities/Entity.ts';
import { CHUNK, type EntityManager } from '../entities/EntityManager.ts';
import { ConstructionSite } from '../entities/ConstructionSite.ts';
import { Machine } from '../entities/Machine.ts';
import { ResourceNode } from '../entities/ResourceNode.ts';
import { Robot } from '../entities/Robot.ts';
import { RESOURCES, type ResourceId } from '../resources/ResourceDefs.ts';
import { RobotState } from '../robot/RobotState.ts';
import type { World } from '../world/World.ts';
import type { SpriteAsset, SpriteLibrary } from './SpriteLibrary.ts';

interface Particle { s: Sprite; vx: number; vy: number; age: number; life: number; gravity: number }
interface Smoke { x: number; y: number; rate: number; puffs: { s: Sprite; age: number; life: number }[]; timer: number }

interface View {
  entity: Entity;
  body: Sprite;
  shadow?: Sprite;
  asset?: SpriteAsset;
  glows: { s: Sprite; flicker: number; ph: number; alpha: number }[];
  beacon?: { s: Sprite; ph: number };
  smoke?: Smoke;
  glints: { s: Sprite; ph: number; period: number }[];
  frame: number;
  depleted: boolean;
  /** Displayed elevation in px (robots ease between levels). */
  lift: number;
  fxTimer: number;
  /** Construction drone hovering over a building site. */
  drone?: Sprite;
}

/** What a deposit looks like once emptied. */
const DEPLETED_SPRITE: Partial<Record<ResourceId, string>> = {
  wood: 'stump', stone: 'pebbles_1', iron_ore: 'pebbles_0', copper_ore: 'pebbles_0', scrap: 'sticks_1',
};

/** Mirrors simulation entities as sprites: y-sorted bodies, shadows, wind sway, lights, smoke and activity effects. */
export class EntityRenderer {
  readonly shadows = new Container();
  readonly bodies = new Container();
  readonly fx = new Container();
  private readonly views = new Map<number, View>();
  private readonly particles: Particle[] = [];

  /** Chunk keys currently on screen: only their entities (plus robots) have sprites. */
  private visibleChunks = new Set<number>();

  constructor(private readonly lib: SpriteLibrary, private readonly entities: EntityManager, private readonly world: World) {
    this.bodies.sortableChildren = true;
    for (const r of entities.ofKind('robot')) this.add(r);
    entities.events.on('added', (e) => { if (this.wanted(e)) this.add(e); });
    entities.events.on('removed', (e) => this.remove(e));
  }

  private chunkKeyOf(e: Entity): number {
    return this.entities.chunkKey(Math.floor(e.tileX / CHUNK), Math.floor(e.tileY / CHUNK));
  }

  private wanted(e: Entity): boolean { return e instanceof Robot || this.visibleChunks.has(this.chunkKeyOf(e)); }

  /**
   * Show the entities of exactly these chunks: sprites are created as chunks scroll in and destroyed as
   * they scroll out, so a world of tens of thousands of objects costs only what is on screen.
   */
  setVisible(keys: readonly number[]): void {
    const next = new Set(keys);
    const across = Math.ceil(this.world.width / CHUNK);
    for (const k of next) if (!this.visibleChunks.has(k)) {
      for (const e of this.entities.inChunk(k % across, Math.floor(k / across))) if (!this.views.has(e.id)) this.add(e);
    }
    for (const k of this.visibleChunks) if (!next.has(k)) {
      for (const e of this.entities.inChunk(k % across, Math.floor(k / across))) this.remove(e);
    }
    this.visibleChunks = next;
  }

  /** World-space ground point of an entity's reference tile, raised by its elevation. */
  private groundOf(e: Entity) {
    const p = tileToWorld(e.tileX, e.tileY);
    return { x: p.x, y: p.y - this.world.heightAt(e.tileX, e.tileY) * HEIGHT_UNIT };
  }

  private add(e: Entity): void {
    const isRobot = e instanceof Robot;
    const asset = isRobot ? this.lib.get('robot_1_0') : this.lib.get(e.spriteId);
    const body = new Sprite(asset.frames[0]);
    body.anchor.set(asset.anchorX, asset.anchorY);
    this.bodies.addChild(body);
    const v: View = { entity: e, body, asset: isRobot ? undefined : asset, glows: [], glints: [], frame: -1, depleted: false, lift: 0, fxTimer: 0 };
    if (asset.shadow) {
      v.shadow = new Sprite(asset.shadow);
      v.shadow.anchor.set(asset.anchorX, asset.anchorY);
      this.shadows.addChild(v.shadow);
    }
    const base = this.groundOf(e);
    v.lift = this.world.heightAt(e.tileX, e.tileY) * HEIGHT_UNIT;
    if (!isRobot) {
      body.position.set(base.x, base.y);
      v.shadow?.position.set(base.x, base.y);
      // depth of the footprint's centre, not its front tile: a front-tile depth draws anything standing beside a
      // multi-tile building (a robot on its right, a tree on its left) behind it, so robots seemed to walk through walls
      body.zIndex = footprintDepth(e.tileX, e.tileY, e.width, e.depth);
      if (e instanceof ConstructionSite) {
        v.drone = new Sprite(this.lib.glint);
        v.drone.anchor.set(0.5); v.drone.tint = 0xffe8b0; v.drone.blendMode = 'add';
        this.fx.addChild(v.drone);
      } else this.attachFx(v, base, e);
    }
    this.views.set(e.id, v);
    if (e instanceof ResourceNode && e.depleted) this.deplete(v, e, false); // already empty when it scrolled into view
  }

  private attachFx(v: View, base: { x: number; y: number }, e: Entity): void {
    const fx = v.asset?.fx;
    if (!fx) return;
    for (const g of fx.glows ?? []) {
      const s = new Sprite(this.lib.glowTexture(g.radius, g.color));
      s.anchor.set(0.5); s.blendMode = 'add'; s.position.set(base.x + g.x, base.y + g.y);
      this.fx.addChild(s);
      v.glows.push({ s, flicker: g.flicker ?? 0.2, ph: hash2(e.id, v.glows.length, 1) * 20, alpha: g.alpha ?? 0.55 });
    }
    if (fx.beacon) {
      const s = new Sprite(this.lib.glowTexture(6, fx.beacon.color));
      s.anchor.set(0.5); s.blendMode = 'add'; s.position.set(base.x + fx.beacon.x, base.y + fx.beacon.y);
      this.fx.addChild(s);
      v.beacon = { s, ph: hash2(e.id, 0, 7) * 3 };
    }
    if (fx.smoke) v.smoke = { x: base.x + fx.smoke.x, y: base.y + fx.smoke.y, rate: fx.smoke.rate ?? 0.9, puffs: [], timer: 0 };
    if (fx.glint) {
      const g = fx.glint;
      for (let i = 0; i < 3; i++) {
        const s = new Sprite(this.lib.glint);
        s.anchor.set(0.5); s.blendMode = 'add'; s.alpha = 0;
        s.position.set(base.x + g.x + (hash2(e.id, i, 2) - 0.5) * 2 * g.rx, base.y + g.y + (hash2(e.id, i, 3) - 0.5) * 2 * g.ry);
        this.fx.addChild(s);
        v.glints.push({ s, ph: hash2(e.id, i, 4) * 9, period: 2.5 + hash2(e.id, i, 5) * 3 });
      }
    }
  }

  private detachFx(v: View): void {
    v.glows.forEach((g) => g.s.destroy()); v.glows = [];
    v.glints.forEach((g) => g.s.destroy()); v.glints = [];
    v.beacon?.s.destroy(); v.beacon = undefined;
    v.smoke?.puffs.forEach((p) => p.s.destroy()); v.smoke = undefined;
  }

  private remove(e: Entity): void {
    const v = this.views.get(e.id);
    if (!v) return;
    this.detachFx(v);
    v.body.destroy(); v.shadow?.destroy(); v.drone?.destroy();
    this.views.delete(e.id);
  }

  /** Swap a deposit to its emptied look. */
  private deplete(v: View, node: ResourceNode, burst = true): void {
    v.depleted = true;
    this.detachFx(v);
    const a = this.lib.get(DEPLETED_SPRITE[node.resourceId] ?? 'pebbles_0');
    v.asset = a; v.frame = -1;
    v.body.texture = a.frames[0];
    v.body.anchor.set(a.anchorX, a.anchorY);
    if (v.shadow && a.shadow) { v.shadow.texture = a.shadow; v.shadow.anchor.set(a.anchorX, a.anchorY); }
    const p = this.groundOf(node);
    if (burst) for (let i = 0; i < 14; i++) this.burst(p.x, p.y - 10, RESOURCES[node.resourceId].color, 1.4);
  }

  /** `night` (0..1) brightens lamps and glows after dark. */
  update(t: number, dt: number, night = 0): void {
    const lampBoost = 1 + night * 1.1;
    for (const v of this.views.values()) {
      const e = v.entity;
      if (e instanceof Robot) { this.updateRobot(v, e, t, dt); continue; }
      if (e instanceof ResourceNode && e.depleted && !v.depleted) this.deplete(v, e);
      const a = v.asset;
      if (a && a.frames.length > 1) {
        let f: number;
        if (a.fps) f = e instanceof Machine && !e.working ? 0 : Math.floor(t * a.fps) % a.frames.length; // machines move only while working
        else { // travelling wind wave plus slow gusts
          const w = Math.sin(t * 1.5 + e.tileX * 0.35 + e.tileY * 0.22) * 0.65 + Math.sin(t * 0.43 + e.tileX * 0.1) * 0.35;
          f = Math.round(((w + 1) / 2) * (a.frames.length - 1));
        }
        if (f !== v.frame) { v.frame = f; v.body.texture = a.frames[f]; }
      }
      const idle = e instanceof Machine && !e.working && e.machineId !== 'lab' ? 0.2 : 1; // a cold kiln barely glows
      for (const g of v.glows) g.s.alpha = idle * Math.min(1, g.alpha * lampBoost) * (1 + g.flicker * (Math.sin(t * 9 + g.ph) * 0.6 + Math.sin(t * 23 + g.ph * 2) * 0.4));
      if (e instanceof ConstructionSite) this.updateSite(v, e, t, dt);
      if (v.beacon) v.beacon.s.alpha = ((t + v.beacon.ph) % 1.6) < 0.35 ? 1 : 0.1;
      if (v.smoke) this.updateSmoke(v.smoke, dt, !(e instanceof Machine) || e.working);
      for (const g of v.glints) {
        const p = ((t + g.ph) % g.period) / g.period;
        g.s.alpha = p < 0.12 ? Math.sin((p / 0.12) * Math.PI) : 0;
      }
    }
    this.updateParticles(dt);
  }

  private updateRobot(v: View, r: Robot, t: number, dt: number): void {
    const moving = r.state === RobotState.Moving || r.state === RobotState.Returning;
    const anim = (moving ? Math.floor(t * 8) : Math.floor(t * 1.4)) % 2;
    const asset = this.lib.get(`robot_${r.facing}_${anim}`);
    if (v.body.texture !== asset.frames[0]) { v.body.texture = asset.frames[0]; v.shadow!.texture = asset.shadow!; }
    // ease elevation so steps up/down are a smooth climb rather than a jump
    const target = this.world.heightAt(Math.floor(r.posX), Math.floor(r.posY)) * HEIGHT_UNIT;
    v.lift += (target - v.lift) * (1 - Math.exp(-dt * 14));
    const p = uvToWorld(r.posX, r.posY);
    let bob = 0;
    if (moving) bob = Math.round(Math.abs(Math.sin(t * 16)));
    else if (r.state === RobotState.Harvesting) bob = Math.round(Math.abs(Math.sin(t * 22)) * 2);
    const x = Math.round(p.x), y = Math.round(p.y - v.lift);
    v.body.position.set(x, y - bob);
    v.shadow!.position.set(x, y);
    v.body.zIndex = depthOf(r.posX, r.posY) + 1;

    // activity effects: chips fly off a deposit while harvesting; cargo streams into storage on deposit
    v.fxTimer -= dt;
    if (r.focus && v.fxTimer <= 0 && (r.state === RobotState.Harvesting || r.state === RobotState.Depositing)) {
      v.fxTimer = 0.18;
      const f = tileToWorld(r.focus.x, r.focus.y);
      const fy = f.y - this.world.heightAt(r.focus.x, r.focus.y) * HEIGHT_UNIT;
      if (r.state === RobotState.Harvesting) {
        const node = [...this.views.values()].find((w) => w.entity instanceof ResourceNode && w.entity.tileX === r.focus!.x && w.entity.tileY === r.focus!.y)?.entity as ResourceNode | undefined;
        this.burst(f.x, fy - 12, node ? RESOURCES[node.resourceId].color : 0xffffff, 1);
      } else {
        const [id] = r.inventory.entries()[0] ?? ['scrap'];
        const s = this.spawn(x, y - 18, RESOURCES[id].color);
        s.vx = (f.x - x) * 1.6; s.vy = (fy - 20 - (y - 18)) * 1.6 - 40; s.gravity = 80; s.life = 0.6;
      }
    }
  }

  private spawn(x: number, y: number, color: number): Particle {
    const s = new Sprite(Texture.WHITE);
    s.width = 2; s.height = 2; s.tint = color; s.anchor.set(0.5); s.position.set(x, y);
    this.fx.addChild(s);
    const p = { s, vx: 0, vy: 0, age: 0, life: 0.5, gravity: 160 };
    this.particles.push(p);
    return p;
  }

  private burst(x: number, y: number, color: number, power: number): void {
    for (let i = 0; i < 3; i++) {
      const p = this.spawn(x + (Math.random() - 0.5) * 12, y, color);
      p.vx = (Math.random() - 0.5) * 60 * power; p.vy = -30 - Math.random() * 50 * power; p.life = 0.4 + Math.random() * 0.3;
    }
  }

  private updateParticles(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += dt;
      if (p.age >= p.life) { p.s.destroy(); this.particles.splice(i, 1); continue; }
      p.vy += p.gravity * dt;
      p.s.x += p.vx * dt; p.s.y += p.vy * dt;
      p.s.alpha = 1 - p.age / p.life;
    }
  }

  /** A site shows its finished building as a ghost that fills in, with a drone welding sparks over it. */
  private updateSite(v: View, site: ConstructionSite, t: number, dt: number): void {
    v.body.alpha = 0.25 + 0.6 * site.progress;
    v.body.tint = 0xd8e4ff;
    const p = this.groundOf(site);
    const cx = p.x + (site.width - site.depth) * 16, cy = p.y + (site.width + site.depth - 2) * 8;
    const dx = Math.sin(t * 2.1) * 18, dy = -46 + Math.sin(t * 3.3) * 6;
    v.drone!.position.set(cx + dx, cy + dy);
    v.fxTimer -= dt;
    if (v.fxTimer <= 0) { v.fxTimer = 0.12; this.burst(cx + dx * 0.6, cy - 12 + Math.random() * 8, 0xffd080, 0.5); }
  }

  private updateSmoke(s: Smoke, dt: number, active = true): void {
    s.timer -= dt;
    if (s.timer <= 0 && active) {
      s.timer = s.rate;
      const sp = new Sprite(this.lib.smoke);
      sp.anchor.set(0.5); sp.position.set(s.x, s.y);
      this.fx.addChild(sp);
      s.puffs.push({ s: sp, age: 0, life: 6 });
    }
    for (let i = s.puffs.length - 1; i >= 0; i--) {
      const p = s.puffs[i];
      p.age += dt;
      const k = p.age / p.life;
      if (k >= 1) { p.s.destroy(); s.puffs.splice(i, 1); continue; }
      p.s.position.set(s.x + k * 34 + Math.sin(p.age * 1.3) * 3, s.y - k * 60);
      p.s.scale.set(0.5 + k * 1.6);
      p.s.alpha = 0.35 * (1 - k) * Math.min(1, k * 8);
    }
  }
}
