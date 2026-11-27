import type { ResourceId } from '../resources/ResourceDefs.ts';

/** What one program run achieved, measured while it runs (items delivered to storage by its robots). */
export interface RunStats { delivered: number; byItem: Partial<Record<ResourceId, number>>; lines: number; robots: number; seconds: number }

export interface Challenge {
  id: string;
  title: string;
  description: string;
  /** Bronze, silver, gold thresholds. */
  tiers: readonly [number, number, number];
  /** Is a bigger number better (items per minute) or a smaller one (lines of code)? */
  better: 'higher' | 'lower';
  unit: string;
  /** The run's score, or null while it does not count yet. */
  measure(s: RunStats): number | null;
}

/** Optional goals for the programs the player writes: faster, shorter, bigger. Each star pays Sparks once. */
export const CHALLENGES: readonly Challenge[] = [
  { id: 'sprint', title: 'Supply sprint', description: 'Items delivered per minute by one program run (it must run a full minute).', tiers: [8, 16, 30], better: 'higher', unit: '/min',
    measure: (s) => (s.seconds >= 60 ? Math.round((s.delivered / s.seconds) * 60) : null) },
  { id: 'compact', title: 'Compact code', description: 'Deliver 20 items with a program of as few lines as you can.', tiers: [12, 8, 5], better: 'lower', unit: ' lines',
    measure: (s) => (s.delivered >= 20 ? s.lines : null) },
  { id: 'haul', title: 'Big haul', description: 'Items delivered by a single program run.', tiers: [50, 150, 400], better: 'higher', unit: ' items',
    measure: (s) => s.delivered },
  { id: 'fleet', title: 'Fleet work', description: 'Robots running one program while it delivers 30 items.', tiers: [2, 3, 4], better: 'higher', unit: ' robots',
    measure: (s) => (s.delivered >= 30 ? s.robots : null) },
];

export const SPARKS_PER_STAR = 2;

export function starsFor(c: Challenge, v: number | null): number {
  if (v === null) return 0;
  return c.tiers.filter((t) => (c.better === 'higher' ? v >= t : v <= t)).length;
}

/** Lines that count as code: not blank, not only a comment. */
export const codeLines = (source: string) => source.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).length;

/** The people of the valley who send commissions and the daily order. */
export const VILLAGERS = ['Mayor Hazel', 'Smith Bram', 'Old Wren', 'Miller Tobin', 'Gardener Ivy'] as const;

/** Today's order: the same for everyone on the same day, a fresh one tomorrow. */
export function dailyOrder(day: string): { day: string; item: ResourceId; amount: number; sparks: number; from: string } {
  let h = 2166136261;
  for (const ch of day) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const items: ResourceId[] = ['wood', 'scrap', 'stone'];
  return { day, item: items[h % 3], amount: 25 + ((h >>> 3) % 5) * 5, sparks: 5, from: VILLAGERS[(h >>> 7) % VILLAGERS.length] };
}
export const today = () => new Date().toISOString().slice(0, 10);

/** Best stars per challenge and today's order progress; part of the player's progress. */
export class ChallengeBoard {
  readonly stars = new Map<string, number>();
  best = new Map<string, number>();
  daily = { day: '', got: 0, done: false };

  /** Score a run; returns the challenges that earned new stars (and how many new stars). */
  evaluate(s: RunStats): { c: Challenge; stars: number; gained: number }[] {
    const out: { c: Challenge; stars: number; gained: number }[] = [];
    for (const c of CHALLENGES) {
      const v = c.measure(s);
      if (v === null) continue;
      const prev = this.best.get(c.id);
      if (prev === undefined || (c.better === 'higher' ? v > prev : v < prev)) this.best.set(c.id, v);
      const stars = starsFor(c, v), had = this.stars.get(c.id) ?? 0;
      if (stars > had) { this.stars.set(c.id, stars); out.push({ c, stars, gained: stars - had }); }
    }
    return out;
  }

  /** Count a delivery toward today's order; true when this delivery completed it. */
  deliver(item: ResourceId, n: number, day = today()): boolean {
    if (this.daily.day !== day) this.daily = { day, got: 0, done: false };
    const order = dailyOrder(day);
    if (this.daily.done || item !== order.item) return false;
    this.daily.got += n;
    if (this.daily.got < order.amount) return false;
    this.daily.done = true;
    return true;
  }
}
