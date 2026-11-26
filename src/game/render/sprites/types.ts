import { PixelCanvas } from '../pixel/PixelCanvas.ts';

export interface Glow { x: number; y: number; color: number; radius: number; flicker?: number; alpha?: number }

/** Ambient effects a sprite asks the renderer to attach. Offsets are px from the sprite origin (ground point). */
export interface SpriteFx {
  smoke?: { x: number; y: number; rate?: number; tint?: number };
  glows?: Glow[];
  /** Rectangle (centre + half-size) in which twinkles appear, e.g. ore glints. */
  glint?: { x: number; y: number; rx: number; ry: number; color: number };
  /** Blinking warning light. */
  beacon?: { x: number; y: number; color: number };
}

/** A procedurally painted sprite, before it becomes a GPU texture. */
export interface Built {
  pc: PixelCanvas;
  /** Ground anchor inside the canvas. */
  ox: number;
  oy: number;
  shadow?: PixelCanvas;
  /** Wind sway: max horizontal shift in px at the top of the sprite. */
  sway?: number;
  /** Extra looping animation frames (pc is frame 0) and their playback rate. */
  frames?: PixelCanvas[];
  fps?: number;
  fx?: SpriteFx;
  /** Soft darkening baked into the ground beneath (canopy shade). Offset from the origin in px. */
  shade?: { dx: number; dy: number; rx: number; ry: number; strength: number };
}

export const newBuilt = (w: number, h: number, ox: number, oy: number): Built => ({
  pc: new PixelCanvas(w, h), ox, oy, shadow: new PixelCanvas(w, h),
});
