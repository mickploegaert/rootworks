import type { RobotPose } from '../render/sprites/robot.ts';

/**
 * The first-time intro: about 40 seconds in the real valley at dawn, with the real Seedling.
 *   1. The forgotten world: the camera drifts over the hills, the giant tree and the sleeping Heart Tree.
 *   2. Seedling awakens: powered down in the yard, its eye opens, it looks around, its sprout glows, it hops up.
 *   3. The first spark: it walks to the old terminal and works on it; the terminal, lantern and bay light up.
 *   4. ROOTWORKS: the camera pulls back over the yard and the title appears; then the game begins.
 * Everything is data below (shots, captions, beats), so the sequence can be retimed without touching the director.
 */

/** A camera move: from one tile (and zoom) to another, between two times. */
interface Shot { start: number; end: number; from: [number, number, number]; to: [number, number, number] }
/** Something that happens once, at a time. */
type Beat = { at: number; do: (h: IntroHost) => void };

/** What the director needs from the game. */
export interface IntroHost {
  /** Put the camera on a tile (fractional) at a zoom. */
  look(tx: number, ty: number, zoom: number): void;
  /** Seedling's forced pose (null: its normal one), how powered-down it looks, its sprout's glow. */
  seedling: { pose: RobotPose | null; dim: number; glow: number };
  face(facing: 0 | 1 | 2 | 3): void;
  walkTo(tx: number, ty: number): void;
  flash(tx: number, ty: number, color: number): void;
  /** A sound cue; also the hook for music later (see IntroEvent.phase). */
  cue(name: 'wake' | 'glow' | 'spark' | 'title'): void;
  /** Tell the overlay what to show. */
  emit(e: IntroEvent): void;
}

export interface IntroEvent {
  phase: 'world' | 'wake' | 'spark' | 'title' | 'done';
  caption: string | null;
  /** How long the caption stays, in seconds (for its fade). */
  captionFor: number;
  /** Bumped when the screen should dip to black (a cut between shots, or the end). */
  dip: number;
  title: boolean;
}

export const INTRO_LENGTH = 40;
/** Where the old terminal stands (WorldGenerator's starting structures), and the lights it wakes. */
const TERMINAL = { x: 127, y: 129 }, LANTERN = { x: 128, y: 128 }, BAY = { x: 128, y: 130 };

const SHOTS: readonly Shot[] = [
  { start: 0, end: 7, from: [91, 94, 2], to: [104, 108, 2] }, // from the old mine in the hills, down toward the valley
  { start: 7, end: 13.5, from: [115, 119, 2], to: [121, 128.5, 2] }, // past the giant tree to the sleeping Heart Tree
  { start: 13.5, end: 24, from: [128.4, 129.4, 3], to: [129.2, 130.1, 3] }, // a slow push in on Seedling
  { start: 24, end: 31, from: [129.2, 130.1, 3], to: [128, 129.6, 3] }, // follow it to the terminal
  { start: 31, end: 37.5, from: [128, 129.6, 3], to: [125, 128.5, 1.5] }, // pull back over the yard: the title
];
const CAPTIONS: readonly { start: number; end: number; text: string }[] = [
  { start: 0.8, end: 6.2, text: 'The valley has been quiet for a very long time.' },
  { start: 7.6, end: 12.9, text: 'Moss took the old machines. Even the great cherry fell asleep.' },
  { start: 14.2, end: 17.6, text: 'But not everything was gone.' },
  { start: 24.6, end: 28.2, text: 'One spark is all it takes.' },
];
/** Shot changes dip to black around their cut. */
const DIPS = [6.55, 13.05, 38.9];

const smooth = (k: number) => k * k * (3 - 2 * k);

/** A value eased in 12 small steps, as beats. */
const tween = (key: 'dim' | 'glow', from: number, to: number, at: number, len: number): Beat[] =>
  Array.from({ length: 13 }, (_, i) => ({ at: at + (len * i) / 12, do: (x: IntroHost) => { x.seedling[key] = from + ((to - from) * smooth(i / 12)); } }));

function beats(): Beat[] {
  return [
    { at: 0, do: (x) => { x.seedling.pose = 'sleep'; x.seedling.dim = 1; x.seedling.glow = 0; x.face(1); } },
    // 2. awake
    { at: 17, do: (x) => x.cue('wake') },
    ...tween('dim', 1, 0, 17, 1.2),
    { at: 17.5, do: (x) => { x.seedling.pose = 'idle'; } },
    { at: 18.5, do: (x) => x.face(0) },
    { at: 19.2, do: (x) => x.face(1) },
    { at: 19.9, do: (x) => x.face(0) },
    { at: 20.2, do: (x) => x.cue('glow') },
    ...tween('glow', 0, 1, 20.2, 1.4),
    { at: 21.8, do: (x) => { x.seedling.pose = 'celebrate'; } },
    { at: 22.9, do: (x) => { x.seedling.pose = 'idle'; x.face(1); } },
    // 3. the first spark
    { at: 24.2, do: (x) => { x.seedling.pose = null; x.walkTo(TERMINAL.x, TERMINAL.y); } },
    { at: 27.2, do: (x) => { x.face(2); x.seedling.pose = 'work'; } },
    { at: 28.5, do: (x) => { x.flash(TERMINAL.x, TERMINAL.y, 0xffd27a); x.cue('spark'); } },
    { at: 28.9, do: (x) => x.flash(LANTERN.x, LANTERN.y, 0xffe0a0) },
    { at: 29.2, do: (x) => x.flash(BAY.x, BAY.y, 0x9fe8ff) },
    { at: 29.7, do: (x) => { x.seedling.pose = 'celebrate'; x.face(1); } },
    { at: 30.8, do: (x) => { x.seedling.pose = null; } },
    { at: 33, do: (x) => x.cue('title') },
  ];
}


/** Plays the intro: call update every frame; it drives the host and reports when it is done. */
export class IntroDirector {
  time = 0;
  private readonly queue: Beat[];
  private dips = 0;
  private last = '';
  done = false;

  constructor(private readonly host: IntroHost, private readonly reducedMotion: boolean) {
    this.queue = beats().sort((a, b) => a.at - b.at);
  }

  update(dt: number): void {
    if (this.done) return;
    this.time += dt;
    const t = this.time, h = this.host;
    while (this.queue.length && this.queue[0].at <= t) this.queue.shift()!.do(h);
    // the camera: eased along the current shot; with Reduce Motion, each shot is a still at its end
    const shot = SHOTS.find((s) => t < s.end) ?? SHOTS[SHOTS.length - 1];
    const k = this.reducedMotion ? 1 : smooth(Math.min(1, Math.max(0, (t - shot.start) / (shot.end - shot.start))));
    const [x0, y0, z0] = shot.from, [x1, y1, z1] = shot.to;
    h.look(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, z0 + (z1 - z0) * k);
    while (this.dips < DIPS.length && DIPS[this.dips] <= t) this.dips++;
    const cap = CAPTIONS.find((c) => t >= c.start && t < c.end), caption = cap?.text ?? null;
    const title = t >= 33 && t < 39.2;
    const phase = t < 13.5 ? 'world' : t < 24 ? 'wake' : t < 31 ? 'spark' : 'title';
    const key = `${phase}|${caption}|${this.dips}|${title}`;
    if (key !== this.last) { this.last = key; h.emit({ phase, caption, captionFor: cap ? cap.end - t : 0, dip: this.dips, title }); }
    if (t >= INTRO_LENGTH) this.finish();
  }

  /** End now (the last frame, or Skip): Seedling back to normal; the game takes over. */
  finish(): void {
    if (this.done) return;
    this.done = true;
    Object.assign(this.host.seedling, { pose: null, dim: 0, glow: 0 });
    this.host.emit({ phase: 'done', caption: null, captionFor: 0, dip: this.dips, title: false });
  }
}
