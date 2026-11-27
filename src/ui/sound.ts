import type { ConsoleEntry } from '../game/Game.ts';

/** Synthesised sound effects: no audio files, a few soft notes each. Silent until the first user gesture (browser rule). */
let ctx: AudioContext | null = null;

function note(freq: number, at: number, len: number, volume: number, type: OscillatorType = 'triangle'): void {
  const c = ctx!, o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0, c.currentTime + at);
  g.gain.linearRampToValueAtTime(volume, c.currentTime + at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + at + len);
  o.connect(g).connect(c.destination);
  o.start(c.currentTime + at); o.stop(c.currentTime + at + len + 0.02);
}

const SOUNDS = {
  harvest: [[520, 0, 0.08], [660, 0.05, 0.08]],
  deposit: [[523, 0, 0.12], [659, 0.07, 0.12], [784, 0.14, 0.18]],
  fail: [[220, 0, 0.16], [185, 0.1, 0.2]],
  learn: [[523, 0, 0.15], [659, 0.1, 0.15], [784, 0.2, 0.15], [1047, 0.3, 0.35]],
  lesson: [[784, 0, 0.12], [1047, 0.09, 0.25]],
} as const satisfies Record<string, readonly (readonly [number, number, number])[]>;

export function play(name: keyof typeof SOUNDS, volume: number): void {
  if (volume <= 0 || typeof AudioContext === 'undefined') return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    for (const [f, at, len] of SOUNDS[name]) note(f, at, len, 0.08 * volume, name === 'fail' ? 'sine' : 'triangle');
  } catch { /* audio unavailable: play silently */ }
}

/** The sound for a console line, if it has one. */
export function soundFor(e: ConsoleEntry): keyof typeof SOUNDS | null {
  if (e.kind === 'fail' || e.kind === 'error') return 'fail';
  if (e.kind === 'ok' && /\bcollected\b/.test(e.text)) return 'harvest';
  if (e.kind === 'ok' && /\bstored\b/.test(e.text)) return 'deposit';
  if (e.kind === 'system' && e.text.startsWith('New skill')) return 'learn';
  if (e.kind === 'system' && /^(Lesson done|Tutorial complete)/.test(e.text)) return 'lesson';
  return null;
}
