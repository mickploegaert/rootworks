import type { CosmeticId } from '../render/sprites/robot.ts';

export interface Achievement { id: string; title: string; description: string; cosmetic?: CosmeticId }

/** Milestones of a valley: each one is photographed for the album, and some dress Seedling up. */
export const ACHIEVEMENTS: readonly Achievement[] = [
  { id: 'first_program', title: 'Hello, Seedling', description: 'Run your first program.' },
  { id: 'first_delivery', title: 'Special delivery', description: 'Bring cargo home to storage.' },
  { id: 'automation', title: 'Hands off', description: 'Learn Loops: Seedling can work by itself.' },
  { id: 'first_machine', title: 'Maker', description: 'Build your first machine.' },
  { id: 'skills5', title: 'Bright spark', description: 'Learn 5 skills.', cosmetic: 'goggles' },
  { id: 'star', title: 'Star pupil', description: 'Earn a challenge star.' },
  { id: 'daily', title: 'Good neighbour', description: 'Deliver a daily order.', cosmetic: 'crown' },
  { id: 'fleet', title: 'Fleet', description: 'Have two robots at work.' },
  { id: 'hundred', title: 'Hundredfold', description: 'Deliver 100 items in total.', cosmetic: 'scarf' },
];

export const COSMETIC_NAMES: Record<CosmeticId, string> = { goggles: 'Copper goggles', crown: 'Flower crown', scarf: 'Red scarf' };

/** Which milestones are reached, items delivered so far, and what Seedling wears. Part of the player's progress. */
export class AchievementBook {
  readonly done = new Set<string>();
  delivered = 0;
  cosmetic: CosmeticId | null = null;

  /** Reach a milestone; returns it the first time, null after that. */
  unlock(id: string): Achievement | null {
    const a = ACHIEVEMENTS.find((x) => x.id === id);
    if (!a || this.done.has(id)) return null;
    this.done.add(id);
    return a;
  }

  /** Accessories earned so far. */
  get cosmetics(): CosmeticId[] { return ACHIEVEMENTS.filter((a) => a.cosmetic && this.done.has(a.id)).map((a) => a.cosmetic!); }
}
