import { Entity } from './Entity.ts';

export type PropCategory = 'vegetation' | 'structure' | 'debris';

/** Static scenery: plants, ruins and machinery shells with no gameplay behaviour yet. */
export class Prop extends Entity {
  readonly kind = 'prop' as const;

  constructor(
    x: number, y: number, spriteId: string, name: string, description: string,
    readonly category: PropCategory, width = 1, depth = 1,
    /** Small decorative plants can be walked through. */
    private readonly solid = true,
  ) {
    super(x, y, spriteId, name, description, width, depth);
  }

  override get blocking(): boolean { return this.solid; }
}
