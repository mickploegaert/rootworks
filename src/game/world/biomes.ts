/**
 * Biomes: the environments of the island. Each defines what grows there; terrain colour comes from
 * the tile types the generator lays down. New environments (caves, desert, crystal fields...)
 * are added by extending BIOME_IDS and BIOMES, then teaching WorldGenerator where they appear.
 */
export const BIOME_IDS = ['meadow', 'flowers', 'forest', 'highland', 'riverside', 'beach', 'yard'] as const;
export type BiomeId = (typeof BIOME_IDS)[number];

export interface Plant {
  /** Sprite ids; one is picked at random. */
  ids: readonly string[];
  name: string;
  desc: string;
  weight: number;
}

export interface BiomeDef {
  id: BiomeId;
  name: string;
  /** Tree chance per tile (0..1) before the forest-density bonus. */
  trees: number;
  treeIds: readonly string[];
  /** Chance a non-tree tile gets ground cover. */
  cover: number;
  plants: readonly Plant[];
}

const grass: Plant = { ids: ['grass_0', 'grass_1', 'grass_2'], name: 'Tall grass', desc: 'Waist-high and swaying.', weight: 4 };
const flowers: Plant = { ids: ['flowers_0', 'flowers_1', 'flowers_2', 'flowers_3', 'flowers_4'], name: 'Wildflowers', desc: 'A scatter of small blooms.', weight: 3 };
const bushes: Plant = { ids: ['bush_0', 'bush_0', 'bush_1', 'bush_autumn'], name: 'Bush', desc: 'Dense shrub.', weight: 2 };

export const BIOMES: Readonly<Record<BiomeId, BiomeDef>> = {
  meadow: {
    id: 'meadow', name: 'Green meadow', trees: 0.025, treeIds: ['oak_0', 'oak_2', 'oak_1', 'oak_0', 'birch_0', 'cherry_0'], cover: 0.5,
    plants: [grass, flowers, bushes, { ids: ['bush_berry'], name: 'Berry bush', desc: 'Heavy with red berries.', weight: 0.8 },
      { ids: ['pebbles_0', 'pebbles_1'], name: 'Pebbles', desc: 'Smooth little stones.', weight: 0.6 }],
  },
  flowers: {
    id: 'flowers', name: 'Flower field', trees: 0.01, treeIds: ['cherry_0'], cover: 0.8,
    plants: [{ ...flowers, weight: 6 }, { ...grass, weight: 1 }, { ids: ['bush_1'], name: 'Flowering bush', desc: 'Covered in white blossom.', weight: 0.8 }],
  },
  forest: {
    id: 'forest', name: 'Old forest', trees: 0.42, treeIds: ['oak_0', 'oak_2', 'oak_0', 'oak_2', 'oak_1', 'birch_0', 'birch_1', 'birch_0', 'maple_0'], cover: 0.75,
    plants: [{ ids: ['fern_0', 'fern_1'], name: 'Fern', desc: 'Unfurling in the shade.', weight: 3 },
      { ids: ['hosta_0', 'hosta_1'], name: 'Broadleaf', desc: 'Big shade-loving leaves.', weight: 1.5 },
      { ids: ['mushroom'], name: 'Toadstools', desc: 'A ring of red caps.', weight: 1 },
      { ids: ['glowshroom'], name: 'Glowcaps', desc: 'Faintly glowing caps. Fireflies gather around them at dusk.', weight: 0.6 },
      { ids: ['sticks_0', 'sticks_1'], name: 'Fallen branches', desc: 'Brittle and dry.', weight: 1 },
      { ids: ['log'], name: 'Fallen log', desc: 'Hollow and home to beetles.', weight: 0.8 },
      { ids: ['stump'], name: 'Tree stump', desc: 'A mossy seat.', weight: 0.6 }],
  },
  highland: {
    id: 'highland', name: 'Rocky highland', trees: 0.3, treeIds: ['cherry_0', 'oak_2', 'oak_0', 'cherry_0'], cover: 0.4,
    plants: [{ ids: ['fern_1'], name: 'Mountain fern', desc: 'Rooted in the cracks.', weight: 2 },
      { ids: ['pebbles_0', 'pebbles_1'], name: 'Scree', desc: 'Loose stones from the cliffs.', weight: 2 },
      { ids: ['grass_2'], name: 'Hill grass', desc: 'Wiry and tough.', weight: 2 }],
  },
  riverside: {
    id: 'riverside', name: 'Riverbank', trees: 0.05, treeIds: ['willow_0'], cover: 0.45,
    plants: [{ ids: ['reeds_0', 'reeds_1'], name: 'Reeds', desc: 'Swaying at the water edge.', weight: 4 },
      { ids: ['hosta_0'], name: 'Water-leaf', desc: 'Broad leaves on wet soil.', weight: 1 }, grass],
  },
  beach: {
    id: 'beach', name: 'Sandy cove', trees: 0, treeIds: [], cover: 0.16,
    plants: [{ ids: ['grass_2'], name: 'Dune grass', desc: 'Holds the sand together.', weight: 3 },
      { ids: ['pebbles_0'], name: 'Shells and pebbles', desc: 'Washed up by the tide.', weight: 2 },
      { ids: ['log'], name: 'Driftwood', desc: 'Bleached by sun and salt.', weight: 1 }],
  },
  yard: {
    id: 'yard', name: 'Workshop yard', trees: 0, treeIds: [], cover: 0.06,
    plants: [{ ids: ['grass_0', 'grass_1'], name: 'Weeds', desc: 'Pushing up between the cobbles.', weight: 3 },
      { ids: ['ivy_0', 'ivy_1'], name: 'Ivy', desc: 'Creeping over the stones.', weight: 1 }],
  },
};
